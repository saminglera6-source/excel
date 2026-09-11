/**
 * sheet_sync_receiver.gs
 * ============================================================================
 * Receptor de la replicación de operaciones desde el panel de administración
 * (greatphonesweb). El panel manda un POST por cada venta, compra, preventa,
 * entrega de preventa, reparación, gasto, cambio de moneda, ajuste de caja,
 * movimiento de inversor, compra de accesorios y anulación/restauración.
 *
 * Body que llega: { secret, tipo, operationId, payload }
 *   - secret: debe matchear ERP_SYNC_SECRET (Propiedades del proyecto).
 *   - tipo: VENTA | COMPRA | PREVENTA | ENTREGA_PREVENTA | REPARACION | GASTO |
 *           CAMBIO_MONEDA | AJUSTE_CAJA | INVERSOR | COMPRA_ACCESORIOS |
 *           ANULACION | RESTAURACION
 *   - payload: objeto plano con los datos, ya con nombres en español (ver
 *     SHEET_SYNC_MAP más abajo para qué hoja usa cada tipo).
 *
 * ── DEPLOY ──────────────────────────────────────────────────────────────────
 *  1. Abrí el sheet "PRUEBA GP" → Extensiones → Apps Script.
 *  2. Archivo → Nuevo → Script, pegá este archivo completo (o agregalo tal cual
 *     se llama, sheet_sync_receiver.gs).
 *  3. Proyecto (ícono ⚙️) → Propiedades del proyecto → Propiedades de secuencia
 *     de comandos → Agregar propiedad:
 *         ERP_SYNC_SECRET = <una clave larga, random, que solo sepan vos y el panel>
 *  4. Implementar → Nueva implementación → tipo "Aplicación web".
 *         Ejecutar como: Yo (tu cuenta)
 *         Quién tiene acceso: Cualquier usuario
 *     Copiá la URL que termina en /exec.
 *  5. Esa URL va como ERP_SHEET_WEBHOOK_URL, y la misma clave del paso 3 como
 *     ERP_SHEET_SECRET, en el .env del panel (se lo pasás a Claude para que lo
 *     configure).
 *  6. Probá: en el panel, Sincronización ERP → Reintentar. Si algo no
 *     encuentra la hoja o la columna correcta, el error queda visible ahí
 *     mismo y se ajusta SHEET_SYNC_MAP / SINONIMOS de acá abajo.
 *
 * IMPORTANTE: esto NUNCA borra ni sobreescribe filas existentes salvo cuando
 * el tipo es ANULACION/RESTAURACION (solo toca la columna de estado) o
 * ENTREGA_PREVENTA (actualiza la fila de esa preventa). Todo lo demás agrega
 * una fila nueva al final de la hoja — igual que como se cargaría a mano.
 * ============================================================================
 */

// Qué hoja usa cada tipo de operación, y en qué columna está el número que
// identifica la fila (para poder ubicarla después, ej. al anular). Ajustá los
// nombres de hoja/columna si no coinciden exactamente con los tuyos.
var SHEET_SYNC_MAP = {
  VENTA: { hoja: 'Ventas', colId: 'N° Venta' },
  COMPRA: { hoja: 'Compras', colId: 'N° OP' },
  PREVENTA: { hoja: 'Preventas', colId: 'N° Preventa' },
  ENTREGA_PREVENTA: { hoja: 'Preventas', colId: 'N° Preventa' }, // actualiza la fila de la preventa
  REPARACION: { hoja: 'Reparaciones', colId: 'N° Rep' },
  GASTO: { hoja: 'Gastos', colId: 'N° Gasto' },
  CAMBIO_MONEDA: { hoja: 'Cambio de Moneda', colId: 'N° Operación' },
  AJUSTE_CAJA: { hoja: 'Ajuste de Caja', colId: 'N° Operación' },
  INVERSOR: { hoja: 'Inversores', colId: null }, // siempre fila nueva (hoja de movimientos)
  COMPRA_ACCESORIOS: { hoja: 'Compra Accesorios', colId: 'N° Compra' },
};

// A qué hoja va una ANULACION/RESTAURACION según el `source` interno del
// panel (no es el mismo string que `tipo` de arriba).
var FUENTE_A_TIPO = {
  VENTA: 'VENTA',
  COMPRA: 'COMPRA',
  PREORDER: 'PREVENTA',
  PREVENTA_ENTREGA: 'PREVENTA',
  REPAIR: 'REPARACION',
  GASTO: 'GASTO',
};

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var esperado = PropertiesService.getScriptProperties().getProperty('ERP_SYNC_SECRET');
    if (esperado && body.secret !== esperado) {
      return responder_({ ok: false, error: 'secreto inválido' }, 401);
    }

    var out;
    if (body.tipo === 'ANULACION' || body.tipo === 'RESTAURACION') {
      out = marcarEstado_(body);
    } else {
      out = escribirFila_(body);
    }
    return responder_(out, out.ok ? 200 : 400);
  } catch (err) {
    return responder_({ ok: false, error: String(err) }, 500);
  }
}

function doGet(e) {
  return responder_({ ok: true, msg: 'sheet-sync receiver activo' }, 200);
}

function escribirFila_(body) {
  var tipo = body.tipo;
  var payload = body.payload || {};
  var cfg = SHEET_SYNC_MAP[tipo];
  if (!cfg) return { ok: false, error: 'tipo desconocido: ' + tipo };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(cfg.hoja);
  if (!sheet) return { ok: false, error: 'no existe la hoja "' + cfg.hoja + '"' };

  // Entrega de preventa: actualiza la fila de la preventa en vez de crear una nueva.
  if (tipo === 'ENTREGA_PREVENTA' && cfg.colId) {
    var filaExistente = buscarFila_(sheet, cfg.colId, payload.numeroPreventa);
    if (filaExistente > 0) return actualizarFila_(sheet, filaExistente, payload);
  }

  // Compra de accesorios: una fila por línea, todas con el mismo N° de compra.
  if (tipo === 'COMPRA_ACCESORIOS' && Array.isArray(payload.lineas)) {
    var headersAcc = leerEncabezados_(sheet);
    payload.lineas.forEach(function (linea) {
      var base = Object.assign({}, payload, linea);
      delete base.lineas;
      sheet.appendRow(headersAcc.map(function (h) { return valorParaHeader_(h, base); }));
    });
    return { ok: true, filas: payload.lineas.length };
  }

  var headers = leerEncabezados_(sheet);
  sheet.appendRow(headers.map(function (h) { return valorParaHeader_(h, payload); }));
  return { ok: true, fila: sheet.getLastRow() };
}

function marcarEstado_(body) {
  var payload = body.payload || {};
  var fuente = String(payload.tipoOriginal || '').toUpperCase();
  var tipoDestino = FUENTE_A_TIPO[fuente];
  var cfg = tipoDestino ? SHEET_SYNC_MAP[tipoDestino] : null;
  if (!cfg) return { ok: false, error: 'no sé en qué hoja buscar la fuente "' + fuente + '"' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(cfg.hoja);
  if (!sheet) return { ok: false, error: 'no existe la hoja "' + cfg.hoja + '"' };

  var fila = buscarFila_(sheet, cfg.colId, payload.numeroOriginal);
  if (fila <= 0) return { ok: false, error: 'no se encontró ' + payload.numeroOriginal + ' en "' + cfg.hoja + '"' };

  var headers = leerEncabezados_(sheet);
  var colEstado = headers.indexOf('Estado de Registro');
  if (colEstado < 0) colEstado = headers.indexOf('Estado');
  if (colEstado >= 0) {
    sheet.getRange(fila, colEstado + 1).setValue(body.tipo === 'ANULACION' ? 'ANULADO' : 'ACTIVO');
  }
  return { ok: true, fila: fila };
}

function buscarFila_(sheet, colNombre, valor) {
  if (!colNombre || !valor) return -1;
  var headers = leerEncabezados_(sheet);
  var col = headers.indexOf(colNombre);
  if (col < 0 || sheet.getLastRow() < 2) return -1;
  var datos = sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < datos.length; i++) {
    if (String(datos[i][0]).trim() === String(valor).trim()) return i + 2;
  }
  return -1;
}

function actualizarFila_(sheet, fila, payload) {
  var headers = leerEncabezados_(sheet);
  headers.forEach(function (h, i) {
    var v = valorParaHeader_(h, payload);
    if (v !== '') sheet.getRange(fila, i + 1).setValue(v);
  });
  return { ok: true, fila: fila };
}

function leerEncabezados_(sheet) {
  return sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(function (h) { return String(h).trim(); });
}

// El header de la hoja y las claves del payload se normalizan igual (minúsculas,
// sin acentos, sin espacios) para matchear aunque no estén escritos idéntico.
// Si un header de la hoja no tiene ningún dato parecido en el payload, la
// celda queda vacía — nunca rompe la fila entera ni el resto de las columnas.
function normalizar_(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Sinónimos: cuando el nombre de columna de la hoja no es exactamente igual
// a la clave que manda el panel (ej. la hoja dice "N° Venta" y el panel manda
// "numero"), se resuelven acá.
var SINONIMOS = {
  nventa: 'numero', nop: 'numero', nrep: 'numero', ngasto: 'numero',
  npreventa: 'numero', noperacion: 'numero', ncompra: 'numero',
  telefono: 'telefono', tel: 'telefono',
  registradopor: 'operador', vendedor: 'vendedor',
  estadoderegistro: 'estado', estado: 'estado',
};

function valorParaHeader_(header, payload) {
  var norm = normalizar_(header);
  var clave = SINONIMOS[norm] || norm;
  for (var k in payload) {
    var nk = normalizar_(k);
    if (nk === clave || nk === norm) {
      var v = payload[k];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    }
  }
  if (clave === 'fecha' && !payload.fecha) return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
  return '';
}

function responder_(obj, code) {
  var out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}
