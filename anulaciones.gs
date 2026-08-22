// ============================================================
//  SISTEMA DE ANULACIONES — anulaciones.gs
//
//  Anulación tipo ERP: NUNCA borra filas. Marca ESTADO_REGISTRO = ANULADO
//  en el registro principal, en los movimientos de Libro Diario asociados
//  y en las relaciones cruzadas (Compra ↔ Preventa ↔ Venta ↔ Accesorios),
//  revirtiendo también sus efectos en Stock. Todo queda auditado en la
//  hoja AUDITORIA y es reversible con restaurarOperacion().
//
//  NO modifica: getConfig(), getConfigCached(), getCol(), getFilaVacia(),
//  genCorrelativo(), libroLog(), actualizarStock_(), procesarCompra(),
//  procesarVenta(), procesarPreventa(), entregarPreventa(),
//  procesarReparacion(), procesarGasto(), procesarMovimientoInversor().
//  Por prudencia, procesarEntregaPreventa() se trata con el mismo criterio
//  de protección (no se toca), aunque no estaba nombrada explícitamente.
//
//  LÍMITE CONOCIDO Y DOCUMENTADO: libroLog() (no se modifica) registra los
//  movimientos de Inversores con idOperacion = nombre del inversor, no con
//  un N° de movimiento único — por lo tanto, al anular/restaurar un
//  movimiento de Inversores (INV-xxx) no es posible ubicar de forma
//  automática y unívoca SU asiento puntual en Libro Diario. El sistema lo
//  marca igual en la hoja Inversores y dejaJa constancia en AUDITORIA para
//  que se revise manualmente ese asiento si corresponde.
// ============================================================

const ANUL_ACTIVO  = "ACTIVO";
const ANUL_ANULADO = "ANULADO";


// ============================================================
//  0. SETUP — correr una vez desde el menú (idempotente, se puede repetir)
// ============================================================

function configurarSistemaAnulaciones() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const resultado = [];

  const hojasSimples = [
    { nombre: cfg.HOJA_COMPRAS      || "Compras",      filaEnc: 2 },
    { nombre: cfg.HOJA_VENTAS       || "Ventas",       filaEnc: 2 },
    { nombre: "Preventas",                              filaEnc: 2 },
    { nombre: "Venta Accesorios",                      filaEnc: 2 },
    { nombre: "Compras Accesorios",                      filaEnc: 2 },
    { nombre: cfg.HOJA_REPARACIONES || "Reparaciones",  filaEnc: 2 },
    { nombre: cfg.HOJA_GASTOS       || "Gastos",        filaEnc: 2 },
    { nombre: "Libro Diario",                            filaEnc: 2 }
  ];

  hojasSimples.forEach(h => {
    const sheet = ss.getSheetByName(h.nombre);
    if (!sheet) { resultado.push(`⚠️ Hoja "${h.nombre}" no encontrada, se omite.`); return; }
    const colEst = asegurarColumnaEstadoRegistro_(sheet, h.filaEnc);
    const lastRow = sheet.getLastRow();
    let backfilled = 0;
    if (lastRow > h.filaEnc) {
      const rango = sheet.getRange(h.filaEnc + 1, colEst, lastRow - h.filaEnc, 1);
      const valores = rango.getValues().map(r => {
        if (String(r[0] || "").trim() === "") { backfilled++; return [ANUL_ACTIVO]; }
        return r;
      });
      if (backfilled > 0) rango.setValues(valores);
    }
    resultado.push(`✅ ${h.nombre}: ESTADO_REGISTRO lista (${backfilled} fila/s completada/s con ACTIVO).`);
  });

  // Inversores: estructura especial (numeración + estado por sub-tabla)
  const invSheet = ss.getSheetByName(cfg.HOJA_INVERSORES || "Inversores");
  if (invSheet) {
    const n = sincronizarNumeracionInversores();
    resultado.push(`✅ Inversores: N° Movimiento/ESTADO_REGISTRO listos (${n} movimiento/s numerado/s).`);
  } else {
    resultado.push(`⚠️ Hoja "Inversores" no encontrada, se omite.`);
  }

  asegurarHojaAuditoria_();
  resultado.push(`✅ Hoja AUDITORIA lista.`);

  SpreadsheetApp.getUi().alert(
    "🛠️ Sistema de anulaciones configurado",
    resultado.join("\n"),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}


// ============================================================
//  1. HELPERS GENÉRICOS
// ============================================================

/** Email del usuario activo, o "Sistema" si no está disponible. */
function anulUsuarioActual_() {
  try {
    const email = Session.getActiveUser().getEmail();
    return email || "Sistema";
  } catch (e) {
    return "Sistema";
  }
}

/** Crea (si no existe) la hoja AUDITORIA con sus encabezados. Nunca la borra ni la reescribe si ya existe. */
function asegurarHojaAuditoria_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName("AUDITORIA");
  if (hoja) return hoja;

  hoja = ss.insertSheet("AUDITORIA");
  hoja.getRange(1, 1).setValue("📋 AUDITORÍA DEL SISTEMA — historial de anulaciones y restauraciones");
  hoja.getRange(1, 1, 1, 6).merge().setFontWeight("bold").setBackground("#1A252F").setFontColor("#FFFFFF");
  const encabezados = ["Fecha", "Usuario", "Tipo Operación", "N° Operación", "Acción", "Observaciones"];
  hoja.getRange(2, 1, 1, encabezados.length).setValues([encabezados])
    .setFontWeight("bold").setBackground("#1A5276").setFontColor("#FFFFFF");
  hoja.setFrozenRows(2);
  hoja.setColumnWidth(1, 130);
  hoja.setColumnWidth(2, 180);
  hoja.setColumnWidth(3, 130);
  hoja.setColumnWidth(4, 110);
  hoja.setColumnWidth(5, 150);
  hoja.setColumnWidth(6, 360);
  return hoja;
}

/** Agrega una fila a AUDITORIA (nunca borra ni modifica filas existentes). */
function registrarAuditoria_(tipoOperacion, numeroOperacion, accion, observaciones) {
  const hoja = asegurarHojaAuditoria_();
  const fE = 2;
  const fila = getFilaVacia(hoja, 1, fE + 1);
  hoja.getRange(fila, 1, 1, 6).setValues([[
    new Date(), anulUsuarioActual_(), tipoOperacion, numeroOperacion, accion, observaciones || ""
  ]]);
  hoja.getRange(fila, 1).setNumberFormat("dd/mm/yyyy hh:mm");
}

// ============================================================
//  1-B. HOJA TRANSACCIONES — auditoría transaccional y recuperación
//  ante fallos parciales (Pasos 1, 2, 3, 5). Google Apps Script no tiene
//  transacciones ni rollback: si el script corta a mitad de una
//  anulación/restauración (timeout, cuota, error de red), esta hoja deja
//  constancia de que una operación arrancó y no se sabe si terminó bien.
// ============================================================

/** Crea (si no existe) la hoja TRANSACCIONES con sus encabezados. Nunca la borra ni la reescribe si ya existe. */
function asegurarHojaTransacciones_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName("TRANSACCIONES");
  if (hoja) return hoja;

  hoja = ss.insertSheet("TRANSACCIONES");
  hoja.getRange(1, 1).setValue("🔒 TRANSACCIONES — trazabilidad transaccional de anulaciones/restauraciones");
  const encabezados = ["UUID", "Fecha", "Usuario", "Operacion", "Numero", "Accion", "Estado", "Detalle", "DuracionMs"];
  hoja.getRange(1, 1, 1, encabezados.length).merge().setFontWeight("bold").setBackground("#1A252F").setFontColor("#FFFFFF");
  hoja.getRange(2, 1, 1, encabezados.length).setValues([encabezados])
    .setFontWeight("bold").setBackground("#1A5276").setFontColor("#FFFFFF");
  hoja.setFrozenRows(2);
  hoja.setColumnWidth(1, 260); // UUID
  hoja.setColumnWidth(2, 130); // Fecha
  hoja.setColumnWidth(3, 180); // Usuario
  hoja.setColumnWidth(4, 110); // Operacion
  hoja.setColumnWidth(5, 100); // Numero
  hoja.setColumnWidth(6, 110); // Accion
  hoja.setColumnWidth(7, 90);  // Estado
  hoja.setColumnWidth(8, 320); // Detalle
  hoja.setColumnWidth(9, 100); // DuracionMs
  return hoja;
}

/**
 * crearTransaccion_(operacion, numero, accion)  — PASO 2
 *
 * Genera un UUID v4 (Utilities.getUuid(), formato estándar RFC 4122, igual
 * al del ejemplo pedido) y registra una fila con Estado="INICIO" ANTES de
 * que la operación real toque ninguna hoja de negocio. Hace flush()
 * inmediatamente: si la ejecución se corta después de este punto (timeout,
 * cuota excedida, error no controlable), esta fila queda escrita en disco
 * como evidencia de una operación que arrancó y no se sabe si terminó.
 *
 * Devuelve un handle { uuid, fila, inicio, operacion, numero, accion } que
 * se le pasa a cerrarTransaccion_() al final.
 */
function crearTransaccion_(operacion, numero, accion) {
  const hoja = asegurarHojaTransacciones_();
  const fE = 2;
  const fila = getFilaVacia(hoja, 1, fE + 1);
  const uuid = Utilities.getUuid();
  const inicio = Date.now();

  hoja.getRange(fila, 1, 1, 9).setValues([[
    uuid, new Date(), anulUsuarioActual_(), operacion || "", numero || "", accion || "", "INICIO", "", ""
  ]]);
  hoja.getRange(fila, 2).setNumberFormat("dd/mm/yyyy hh:mm:ss");
  SpreadsheetApp.flush(); // durabilidad: que el INICIO quede escrito ya mismo

  return { uuid: uuid, fila: fila, inicio: inicio, operacion: operacion, numero: numero, accion: accion };
}

/**
 * cerrarTransaccion_(tx, estado, error)  — PASO 3
 *
 * Actualiza la fila creada por crearTransaccion_() con el resultado final:
 *   estado:  "OK" | "ERROR" | "ABORTADA"
 *   error:   objeto Error opcional (su .message se guarda en Detalle)
 * Calcula y registra DuracionMs. No crea ni borra filas — solo completa la
 * misma fila de INICIO.
 */
function cerrarTransaccion_(tx, estado, error) {
  if (!tx || !tx.fila) return;
  const hoja = asegurarHojaTransacciones_();
  const duracionMs = Date.now() - tx.inicio;
  const detalle = error ? (error.message || String(error)) : "";

  hoja.getRange(tx.fila, 7).setValue(estado);      // Estado
  hoja.getRange(tx.fila, 8).setValue(detalle);     // Detalle
  hoja.getRange(tx.fila, 9).setValue(duracionMs);  // DuracionMs
}

/**
 * marcarTransaccionAbortada_(uuid, observacion)
 *
 * Utilidad manual (no forma parte del flujo automático): permite a un
 * operador marcar como "ABORTADA" una transacción que quedó en INICIO o
 * ERROR y que, tras revisión manual, se decidió no reintentar. No modifica
 * ninguna otra hoja — solo dejaKa constancia en TRANSACCIONES.
 */
function marcarTransaccionAbortada_(uuid, observacion) {
  const hoja = asegurarHojaTransacciones_();
  const fE = 2;
  const lastRow = hoja.getLastRow();
  if (lastRow <= fE) return false;

  const uuids = hoja.getRange(fE + 1, 1, lastRow - fE, 1).getValues();
  for (let i = 0; i < uuids.length; i++) {
    if (String(uuids[i][0]).trim() === String(uuid).trim()) {
      const fila = fE + 1 + i;
      hoja.getRange(fila, 7).setValue("ABORTADA");
      hoja.getRange(fila, 8).setValue(observacion || "");
      return true;
    }
  }
  return false;
}

/**
 * buscarTransaccionesIncompletas_()  — PASO 5
 *
 * Devuelve todas las transacciones cuyo Estado sea INICIO, ERROR o
 * ABORTADA — es decir, que no terminaron con OK. Son las candidatas a
 * dejar el sistema en un estado parcialmente anulado/restaurado; para cada
 * una conviene correr diagnosticarOperacion_(numero) sobre su "Numero".
 */
function buscarTransaccionesIncompletas_() {
  const hoja = asegurarHojaTransacciones_();
  const fE = 2;
  const lastRow = hoja.getLastRow();
  if (lastRow <= fE) return [];

  const datos = hoja.getRange(fE + 1, 1, lastRow - fE, 9).getValues();
  const incompletas = [];
  datos.forEach(row => {
    const estado = String(row[6] || "").trim();
    if (estado === "INICIO" || estado === "ERROR" || estado === "ABORTADA") {
      incompletas.push({
        uuid: row[0], fecha: row[1], usuario: row[2], operacion: row[3],
        numero: row[4], accion: row[5], estado: estado, detalle: row[7], duracionMs: row[8]
      });
    }
  });
  return incompletas;
}

// ============================================================
//  1-C. HOJA BACKUP_OPERACIONES — snapshot completo "ANTES" de cada
//  anulación/restauración (Pasos 1, 2, 4, 5). Es una capa de recuperación
//  MANUAL adicional a las relaciones que ya se restauran automáticamente:
//  si algo sale mal, acá queda la foto exacta de cómo estaba todo antes de
//  tocar nada, para que un humano pueda reconstruirlo a mano si hiciera falta.
// ============================================================

/** Crea (si no existe) la hoja BACKUP_OPERACIONES con sus encabezados. Nunca la borra ni la reescribe si ya existe. */
function asegurarHojaBackupOperaciones_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName("BACKUP_OPERACIONES");
  if (hoja) return hoja;

  hoja = ss.insertSheet("BACKUP_OPERACIONES");
  hoja.getRange(1, 1).setValue("💾 BACKUP_OPERACIONES — snapshot \"ANTES\" de cada anulación/restauración");
  const encabezados = ["UUID_TRANSACCION", "FECHA", "USUARIO", "TIPO_OPERACION", "NUMERO_OPERACION", "ACCION", "ESTADO_BACKUP", "JSON_ESTADO"];
  hoja.getRange(1, 1, 1, encabezados.length).merge().setFontWeight("bold").setBackground("#1A252F").setFontColor("#FFFFFF");
  hoja.getRange(2, 1, 1, encabezados.length).setValues([encabezados])
    .setFontWeight("bold").setBackground("#1A5276").setFontColor("#FFFFFF");
  hoja.setFrozenRows(2);
  hoja.setColumnWidth(1, 260); // UUID_TRANSACCION
  hoja.setColumnWidth(2, 140); // FECHA
  hoja.setColumnWidth(3, 180); // USUARIO
  hoja.setColumnWidth(4, 110); // TIPO_OPERACION
  hoja.setColumnWidth(5, 110); // NUMERO_OPERACION
  hoja.setColumnWidth(6, 110); // ACCION
  hoja.setColumnWidth(7, 110); // ESTADO_BACKUP
  hoja.setColumnWidth(8, 500); // JSON_ESTADO
  return hoja;
}

/** Snapshot de una fila completa como {encabezado: valor}, o null si no existe. Fechas → texto ISO (para que JSON.stringify no las pierda). */
function _snapshotFilaCompleta_(sheet, filaEnc, fila) {
  if (!sheet || fila === -1) return null;
  const hdrs = sheet.getRange(filaEnc, 1, 1, sheet.getLastColumn()).getValues()[0];
  const valores = sheet.getRange(fila, 1, 1, sheet.getLastColumn()).getValues()[0];
  const obj = {};
  hdrs.forEach((h, i) => {
    const nombre = String(h || "").trim();
    if (!nombre) return;
    let v = valores[i];
    if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
    obj[nombre] = v;
  });
  return obj;
}

/** Busca por N° en una hoja de tabla simple (encabezados fila 2) y devuelve su snapshot completo (o null). */
function _snapshotBuscarYLeer_(nombreHoja, colId, valorId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
  if (!sheet) return null;
  const fila = _buscarFilaPorId_(sheet, 2, colId, valorId);
  return _snapshotFilaCompleta_(sheet, 2, fila);
}

/** Snapshot de TODAS las filas de una hoja cuyo `colFiltro` coincide con `valor` (p.ej. accesorios de una venta). */
function _snapshotBuscarTodasPor_(nombreHoja, colFiltro, valor) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
  if (!sheet) return [];
  const fE = 2;
  let colF = -1;
  try { colF = getCol(sheet, colFiltro, fE); } catch (e) { return []; }
  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return [];

  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  const resultado = [];
  datos.forEach(row => {
    if (String(row[colF - 1] || "").trim() === String(valor).trim()) {
      const obj = {};
      hdrs.forEach((h, i) => {
        const nombre = String(h || "").trim();
        if (!nombre) return;
        let v = row[i];
        if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
        obj[nombre] = v;
      });
      resultado.push(obj);
    }
  });
  return resultado;
}

/** Snapshot de todos los asientos de Libro Diario asociados a `numero` (ID_OPERACION o REFERENCIA). */
function _snapshotLibroDiarioPorOperacion_(numero) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const libro = ss.getSheetByName("Libro Diario");
  if (!libro) return [];

  const fE = 2;
  const colOp  = getCol(libro, "ID_OPERACION", fE);
  const colRef = getCol(libro, "REFERENCIA",   fE);
  const lastRow = libro.getLastRow();
  if (lastRow <= fE) return [];

  const hdrs = libro.getRange(fE, 1, 1, libro.getLastColumn()).getValues()[0];
  const datos = libro.getRange(fE + 1, 1, lastRow - fE, libro.getLastColumn()).getValues();
  const numeroTrim = String(numero).trim();
  const resultado = [];
  datos.forEach(row => {
    const op  = String(row[colOp  - 1] || "").trim();
    const ref = String(row[colRef - 1] || "").trim();
    if (op === numeroTrim || ref === numeroTrim) {
      const obj = {};
      hdrs.forEach((h, i) => {
        const nombre = String(h || "").trim();
        if (!nombre) return;
        let v = row[i];
        if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
        obj[nombre] = v;
      });
      resultado.push(obj);
    }
  });
  return resultado;
}

/**
 * _construirSnapshotOperacion_(numero)
 *
 * Arma { principal, libro, compras, ventas, preventas, accesorios,
 * relaciones } para `numero`, buscando el registro principal y TODO lo que
 * tiene relacionado según su tipo (compra↔preventa↔venta↔accesorios), con
 * el mismo criterio de búsqueda que ya usan diagnosticarOperacion_() y las
 * funciones _anular*_/_restaurar*_.
 */
function _construirSnapshotOperacion_(numero) {
  const info = detectarTipoOperacion_(numero);
  const cfg = getConfigCached();

  const compras = [], ventas = [], preventas = [], accesorios = [];
  const relaciones = {};
  let principal = null;

  if (info.prefijo === "INV") {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const invSheet = ss.getSheetByName(cfg.HOJA_INVERSORES || "Inversores");
    const encontrado = invSheet ? _buscarMovimientoInversor_(invSheet, numero) : null;
    if (encontrado) {
      const obj = {};
      encontrado.hdrs.forEach((h, i) => {
        const nombre = String(h || "").trim();
        if (!nombre) return;
        let v = invSheet.getRange(encontrado.fila, i + 1).getValue();
        if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
        obj[nombre] = v;
      });
      obj["_inversor"] = encontrado.tabla.inversor;
      obj["_tipoTabla"] = encontrado.tabla.tipoTabla;
      principal = obj;
      relaciones.inversor = encontrado.tabla.inversor;
    }
    return { principal: principal, libro: [], compras: compras, ventas: ventas, preventas: preventas, accesorios: accesorios, relaciones: relaciones };
  }

  // CAC (Compra de Accesorios) es multilínea: 1 número = N filas de
  // "Compras Accesorios" (una por producto). No encaja en la forma genérica
  // {principal, compras, ventas, preventas, accesorios} de abajo, que asume
  // 1 número = 1 fila — por eso tiene su propio return temprano, con el
  // mismo criterio que ya usa la rama "INV" de arriba (forma propia cuando
  // la genérica no aplica). Incluye además "stock": una foto de los SKUs de
  // Stock Accesorios afectados por esta compra, para diagnóstico — el
  // backup es una red de seguridad de solo lectura, no revierte stock por
  // sí mismo (eso lo hace actualizarStockAccesorios_() al anular/restaurar).
  if (info.prefijo === "CAC") {
    const lineasCAC = _snapshotBuscarTodasPor_("Compras Accesorios", "N° Compra Accesorio", numero);
    const libroCAC  = _snapshotLibroDiarioPorOperacion_(numero);

    const skuIds = [];
    lineasCAC.forEach(l => {
      const sku = String(l["SKU_ID"] || "").trim();
      if (sku && skuIds.indexOf(sku) === -1) skuIds.push(sku);
    });
    const stockCAC = skuIds
      .map(sku => _snapshotBuscarYLeer_("Stock Accesorios", "SKU_ID", sku))
      .filter(s => s !== null);

    return {
      tipo:       "COMPRA_ACCESORIO",
      numero:     numero,
      lineas:     lineasCAC,
      libro:      libroCAC,
      stock:      stockCAC,
      relaciones: { nCompraAcc: numero }
    };
  }

  const sheetPrincipal = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(info.hoja);
  const filaPrincipal = sheetPrincipal ? _buscarFilaPorId_(sheetPrincipal, 2, info.colId, numero) : -1;
  principal = _snapshotFilaCompleta_(sheetPrincipal, 2, filaPrincipal);
  const libro = _snapshotLibroDiarioPorOperacion_(numero);

  if (info.prefijo === "CMP" && principal) {
    relaciones.nOp = numero;
    compras.push(principal);
    const nPre = String(principal["N° Preventa Asociada"] || "").trim();
    if (nPre) {
      relaciones.nPre = nPre;
      const pre = _snapshotBuscarYLeer_("Preventas", "N° Preventa", nPre);
      if (pre) preventas.push(pre);
    }
    const ventasRelacionadas = _snapshotBuscarTodasPor_(cfg.HOJA_VENTAS || "Ventas", "N° OP Compra", numero);
    ventas.push(...ventasRelacionadas);
    if (ventasRelacionadas.length) relaciones.nVta = ventasRelacionadas.map(v => v["N° Venta"]);
  }

  if (info.prefijo === "VTA" && principal) {
    relaciones.nVta = numero;
    ventas.push(principal);
    const nOp = String(principal["N° OP Compra"] || "").trim();
    if (nOp) {
      relaciones.nOp = nOp;
      const compra = _snapshotBuscarYLeer_(cfg.HOJA_COMPRAS || "Compras", "N° OP", nOp);
      if (compra) {
        compras.push(compra);
        const nPre = String(compra["N° Preventa Asociada"] || "").trim();
        if (nPre) {
          relaciones.nPre = nPre;
          const pre = _snapshotBuscarYLeer_("Preventas", "N° Preventa", nPre);
          if (pre) preventas.push(pre);
        }
      }
    }
    const accesoriosRelacionados = _snapshotBuscarTodasPor_("Venta Accesorios", "N° Venta Celular Asociada", numero);
    accesorios.push(...accesoriosRelacionados);
    if (accesoriosRelacionados.length) relaciones.nAcc = accesoriosRelacionados.map(a => a["N° Venta Accesorio"]);
  }

  if (info.prefijo === "PRE" && principal) {
    relaciones.nPre = numero;
    preventas.push(principal);
    const nCompra = String(principal["N° Compra Asociada"] || "").trim();
    const nVenta  = String(principal["N° Venta Asociada"]   || "").trim();
    if (nCompra) {
      relaciones.nOp = nCompra;
      const compra = _snapshotBuscarYLeer_(cfg.HOJA_COMPRAS || "Compras", "N° OP", nCompra);
      if (compra) compras.push(compra);
    }
    if (nVenta) {
      relaciones.nVta = nVenta;
      const venta = _snapshotBuscarYLeer_(cfg.HOJA_VENTAS || "Ventas", "N° Venta", nVenta);
      if (venta) ventas.push(venta);
    }
  }

  if (info.prefijo === "ACC" && principal) {
    relaciones.nAcc = numero;
    accesorios.push(principal);
    const nVta = String(principal["N° Venta Celular Asociada"] || "").trim();
    if (nVta) {
      relaciones.nVta = nVta;
      const venta = _snapshotBuscarYLeer_(cfg.HOJA_VENTAS || "Ventas", "N° Venta", nVta);
      if (venta) ventas.push(venta);
    }
  }

  if (info.prefijo === "REP" && principal) relaciones.nRep = numero;
  if (info.prefijo === "GST" && principal) relaciones.nGasto = numero;
  if (info.prefijo === "CAM" && principal) relaciones.nCambio  = numero;
  if (info.prefijo === "AJC" && principal) relaciones.nAjuste  = numero;

  return { principal: principal, libro: libro, compras: compras, ventas: ventas, preventas: preventas, accesorios: accesorios, relaciones: relaciones };
}

/**
 * guardarBackupOperacion_(tipo, numero, accion)  — PASO 1 y 2
 *
 * Antes de tocar ningún dato, junta la foto completa de la operación (ver
 * _construirSnapshotOperacion_) y la guarda como una fila NUEVA en
 * BACKUP_OPERACIONES (nunca borra backups anteriores), serializada con
 * JSON.stringify(). Si algo falla al construir la foto, NO corta la
 * anulación/restauración: guarda ESTADO_BACKUP="ERROR" con el motivo y
 * deja seguir — el backup es una red de seguridad adicional, no un
 * requisito bloqueante para la operación de negocio.
 *
 * Devuelve el UUID del backup (para pedirlo después con mostrarBackupOperacion_()).
 */
function guardarBackupOperacion_(tipo, numero, accion) {
  const uuid = Utilities.getUuid();
  let snapshot;
  let estadoBackup = "OK";

  try {
    snapshot = _construirSnapshotOperacion_(numero);
  } catch (e) {
    estadoBackup = "ERROR";
    snapshot = { error: (e && e.message) ? e.message : String(e) };
  }

  let json = JSON.stringify(snapshot);
  // Límite real de Sheets: ~50.000 caracteres por celda. Si el snapshot lo
  // excede, se trunca en vez de dejar que falle la escritura más abajo.
  if (json.length > 49000) {
    estadoBackup = "ERROR";
    json = JSON.stringify({ error: "Snapshot truncado: excede el límite de celda de Sheets (50.000 caracteres)." });
  }

  // AUDITORÍA (hallazgo CRITICAL): igual que la construcción del snapshot,
  // la escritura en sí no debe poder bloquear la anulación/restauración
  // (docstring de esta función, líneas arriba). Antes esta escritura estaba
  // fuera de todo try/catch: un error acá (celda demasiado larga, cuota,
  // error transitorio de Sheets) abortaba la operación de negocio completa.
  try {
    const hoja = asegurarHojaBackupOperaciones_();
    const fE = 2;
    const fila = getFilaVacia(hoja, 1, fE + 1);
    hoja.getRange(fila, 1, 1, 8).setValues([[
      uuid, new Date(), anulUsuarioActual_(), tipo || "", numero || "", accion || "", estadoBackup, json
    ]]);
    hoja.getRange(fila, 2).setNumberFormat("dd/mm/yyyy hh:mm:ss");
  } catch (e) {
    Logger.log("⚠️ guardarBackupOperacion_: no se pudo escribir el backup de " + numero + ": " + (e && e.message));
  }

  return uuid;
}

/** listarBackupsOperacion_(numero) — PASO 4. Todos los backups de una operación (sin el JSON completo, solo metadatos). */
function listarBackupsOperacion_(numero) {
  const hoja = asegurarHojaBackupOperaciones_();
  const fE = 2;
  const lastRow = hoja.getLastRow();
  if (lastRow <= fE) return [];

  const datos = hoja.getRange(fE + 1, 1, lastRow - fE, 8).getValues();
  const resultado = [];
  datos.forEach(row => {
    if (String(row[4]).trim() === String(numero).trim()) {
      resultado.push({
        uuid: row[0], fecha: row[1], usuario: row[2], tipoOperacion: row[3],
        numeroOperacion: row[4], accion: row[5], estadoBackup: row[6]
      });
    }
  });
  return resultado;
}

/** mostrarBackupOperacion_(uuid) — PASO 5. Reconstruye y devuelve como texto legible el "ANTES" de un backup puntual. */
function mostrarBackupOperacion_(uuid) {
  const hoja = asegurarHojaBackupOperaciones_();
  const fE = 2;
  const lastRow = hoja.getLastRow();
  if (lastRow <= fE) throw new Error("❌ No hay backups registrados.");

  const uuids = hoja.getRange(fE + 1, 1, lastRow - fE, 1).getValues();
  let fila = -1;
  for (let i = 0; i < uuids.length; i++) {
    if (String(uuids[i][0]).trim() === String(uuid).trim()) { fila = fE + 1 + i; break; }
  }
  if (fila === -1) throw new Error(`❌ No encontré el backup con UUID "${uuid}".`);

  const filaCompleta = hoja.getRange(fila, 1, 1, 8).getValues()[0];
  let snapshot;
  try {
    snapshot = JSON.parse(filaCompleta[7]);
  } catch (e) {
    throw new Error("❌ El backup está corrupto o no se pudo leer (JSON inválido).");
  }
  return _formatearBackup_(filaCompleta, snapshot);
}

/** Formatea un backup (fila + snapshot ya parseado) como texto ANTES/Compra/Venta/Preventa/Libro/Relaciones. */
function _formatearBackup_(filaCompleta, snapshot) {
  const tz = Session.getScriptTimeZone();
  const lineas = [];
  lineas.push(`ANTES (${filaCompleta[3]} — ${filaCompleta[5]} de ${filaCompleta[4]})`);
  lineas.push(`Fecha: ${Utilities.formatDate(new Date(filaCompleta[1]), tz, "dd/MM/yyyy HH:mm:ss")} | Usuario: ${filaCompleta[2]}`);
  lineas.push("");

  const fmtObj = (etiqueta, obj) => {
    lineas.push(`${etiqueta}:`);
    if (!obj) { lineas.push("  (sin datos)"); return; }
    Object.keys(obj).forEach(k => lineas.push(`  ${k}: ${obj[k]}`));
  };
  const fmtLista = (etiqueta, lista) => {
    if (!lista || lista.length === 0) { lineas.push(`${etiqueta}: (ninguna)`); return; }
    lineas.push(`${etiqueta} (${lista.length}):`);
    lista.forEach(o => lineas.push(`  • ${JSON.stringify(o)}`));
  };

  // COMPRA_ACCESORIO tiene forma propia (tipo/numero/lineas/libro/stock/
  // relaciones) porque _construirSnapshotOperacion_() la arma con un return
  // temprano para CAC (multilínea) — no encaja en la forma genérica
  // {principal, compras, ventas, preventas, accesorios} de abajo, que asume
  // 1 número = 1 fila. Sin esta rama, "ANTES" mostraría "PRINCIPAL: (sin
  // datos)" y listas vacías aunque el snapshot sí tenga todas las líneas.
  if (snapshot && snapshot.tipo === "COMPRA_ACCESORIO") {
    fmtLista("LÍNEAS DE LA COMPRA", snapshot.lineas);
    lineas.push("");
    fmtLista("STOCK ACCESORIOS (al momento del backup)", snapshot.stock);
    lineas.push("");
    fmtLista("LIBRO", snapshot.libro);
    lineas.push("");
    lineas.push("RELACIONES:");
    lineas.push(JSON.stringify(snapshot.relaciones || {}));
    return lineas.join("\n");
  }

  fmtObj("PRINCIPAL", snapshot.principal);
  lineas.push("");
  fmtLista("COMPRA", snapshot.compras);
  lineas.push("");
  fmtLista("VENTA", snapshot.ventas);
  lineas.push("");
  fmtLista("PREVENTA", snapshot.preventas);
  lineas.push("");
  fmtLista("ACCESORIOS", snapshot.accesorios);
  lineas.push("");
  fmtLista("LIBRO", snapshot.libro);
  lineas.push("");
  lineas.push("RELACIONES:");
  lineas.push(JSON.stringify(snapshot.relaciones || {}));

  return lineas.join("\n");
}

/** UI del menú: pide el N° de operación, lista sus backups y ofrece ver el más reciente en detalle. */
function verBackupsOperacionUI() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    "💾 Ver Backups de Operación",
    "Ingresá el N° de operación (CMP-xxx, VTA-xxx, PRE-xxx, REP-xxx, GST-xxx, ACC-xxx, INV-xxx):",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const numero = resp.getResponseText().trim().toUpperCase();
  if (!numero) { ui.alert("❌ Ingresá un número de operación."); return; }

  const backups = listarBackupsOperacion_(numero);
  if (backups.length === 0) {
    ui.alert("💾 Backups", `No hay backups registrados para "${numero}".`, ui.ButtonSet.OK);
    return;
  }

  const tz = Session.getScriptTimeZone();
  const lista = backups.map((b, i) =>
    `${i + 1}. ${b.accion} — ${Utilities.formatDate(new Date(b.fecha), tz, "dd/MM/yyyy HH:mm:ss")} — ${b.usuario} — Estado: ${b.estadoBackup}\n   UUID: ${b.uuid}`
  ).join("\n\n");

  const respuesta = ui.alert(
    `💾 ${backups.length} backup/s de "${numero}"`,
    lista + "\n\n¿Ver el backup más reciente en detalle (el \"ANTES\" completo)?",
    ui.ButtonSet.YES_NO
  );
  if (respuesta !== ui.Button.YES) return;

  const masReciente = backups[backups.length - 1]; // se listan en orden cronológico de escritura
  try {
    const detalle = mostrarBackupOperacion_(masReciente.uuid);
    ui.alert(`💾 ANTES — ${numero}`, detalle, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("❌ " + e.message);
  }
}


/**
 * Asegura que exista la columna ESTADO_REGISTRO al final del encabezado de
 * una hoja de tabla simple; la crea si falta. Devuelve el N° de columna.
 * Las celdas en blanco de esta columna se consideran ACTIVAS en todo el
 * sistema (no hace falta que digan literalmente "ACTIVO"), porque
 * procesarCompra/procesarVenta/procesarPreventa/etc. (protegidas, no se
 * modifican) no conocen esta columna y la dejan vacía en los registros
 * nuevos — configurarSistemaAnulaciones() la completa igual para que quede
 * prolija, pero no es requisito funcional.
 */
function asegurarColumnaEstadoRegistro_(sheet, filaEnc) {
  let col = -1;
  try { col = getCol(sheet, "ESTADO_REGISTRO", filaEnc); } catch (e) { /* todavía no existe */ }
  if (col >= 0) return col;
  col = sheet.getLastColumn() + 1;
  sheet.getRange(filaEnc, col).setValue("ESTADO_REGISTRO").setFontWeight("bold");
  return col;
}

/** Busca la fila (1-based) cuya columna `nombreColId` coincide con `valorId`. -1 si no existe. */
function _buscarFilaPorId_(sheet, filaEnc, nombreColId, valorId) {
  const colId = getCol(sheet, nombreColId, filaEnc);
  const lastRow = sheet.getLastRow();
  if (lastRow <= filaEnc) return -1;
  const ids = sheet.getRange(filaEnc + 1, colId, lastRow - filaEnc, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(valorId).trim()) return filaEnc + 1 + i;
  }
  return -1;
}

/**
 * verificarIntegridadRelacionada_(hoja, filaEnc, nombreColId, numero)
 *
 * PASO 1 (auditoría de riesgos, Prioridad 1). Verifica un registro
 * relacionado ANTES de anular/restaurar sobre él: existencia + su
 * ESTADO_REGISTRO — NUNCA el campo de negocio "Estado", que puede quedar
 * desincronizado (ver hallazgos de la auditoría). Es de solo lectura, no
 * modifica nada.
 *
 *   hoja:         nombre de la hoja donde buscar (ya resuelto vía cfg, p.ej. cfg.HOJA_COMPRAS || "Compras")
 *   filaEnc:      fila de encabezados de esa hoja
 *   nombreColId:  nombre de la columna que contiene el número de operación
 *   numero:       valor a buscar (si es vacío/undefined, se considera "sin relación", ok:true)
 *
 * Devuelve { ok:true, mensaje:"" } si el registro existe y está ACTIVO
 * (ESTADO_REGISTRO !== "ANULADO", incluye celda vacía = activo por
 * convención del sistema), o { ok:false, mensaje:"..." } si no existe o
 * está ANULADO. También expone `fila` (la fila 1-based encontrada, o -1)
 * para que el llamador no tenga que volver a buscarla.
 */
function verificarIntegridadRelacionada_(hoja, filaEnc, nombreColId, numero) {
  if (!numero) return { ok: true, mensaje: "", fila: -1 };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(hoja);
  if (!sheet) return { ok: false, mensaje: `❌ Hoja "${hoja}" no encontrada.`, fila: -1 };

  const fila = _buscarFilaPorId_(sheet, filaEnc, nombreColId, numero);
  if (fila === -1) return { ok: false, mensaje: `❌ "${numero}" no encontrado en "${hoja}".`, fila: -1 };

  const colEst = asegurarColumnaEstadoRegistro_(sheet, filaEnc);
  const estado = String(sheet.getRange(fila, colEst).getValue() || "").trim();
  if (estado === ANUL_ANULADO) {
    return { ok: false, mensaje: `⚠️ "${numero}" en "${hoja}" está anulado.`, fila: fila };
  }
  return { ok: true, mensaje: "", fila: fila };
}

/**
 * Marca ESTADO_REGISTRO en TODAS las filas de Libro Diario cuyo
 * ID_OPERACION o REFERENCIA coincidan con `numero`. No borra nada y no
 * toca SALDO_ANTERIOR/SALDO_NUEVO (responsabilidad exclusiva de
 * libroLog(), que no se modifica) — los saldos se recalculan en las
 * lecturas (obtenerSaldosCaja/actualizarReportes), que ya filtran
 * ESTADO_REGISTRO=ANULADO. Devuelve la cantidad de filas marcadas.
 */
function marcarLibroDiarioPorOperacion_(numero, estado) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const libro = ss.getSheetByName("Libro Diario");
  if (!libro) return 0;

  const fE = 2;
  const colOp  = getCol(libro, "ID_OPERACION", fE);
  const colRef = getCol(libro, "REFERENCIA",   fE);
  const colEst = asegurarColumnaEstadoRegistro_(libro, fE);

  const lastRow = libro.getLastRow();
  if (lastRow <= fE) return 0;

  const datos = libro.getRange(fE + 1, 1, lastRow - fE, libro.getLastColumn()).getValues();
  const numeroTrim = String(numero).trim();
  let marcadas = 0;
  datos.forEach((row, i) => {
    const op  = String(row[colOp  - 1] || "").trim();
    const ref = String(row[colRef - 1] || "").trim();
    if (op === numeroTrim || ref === numeroTrim) {
      libro.getRange(fE + 1 + i, colEst).setValue(estado);
      marcadas++;
    }
  });
  return marcadas;
}


// ============================================================
//  2. DETECCIÓN DE TIPO DE OPERACIÓN (Paso 4)
// ============================================================

function obtenerMapaTiposAnulacion_() {
  const cfg = getConfigCached();
  return {
    CMP: { tipo: "COMPRA",           hoja: cfg.HOJA_COMPRAS      || "Compras",      colId: "N° OP" },
    VTA: { tipo: "VENTA",            hoja: cfg.HOJA_VENTAS       || "Ventas",       colId: "N° Venta" },
    PRE: { tipo: "PREVENTA",         hoja: "Preventas",                             colId: "N° Preventa" },
    REP: { tipo: "REPARACION",       hoja: cfg.HOJA_REPARACIONES || "Reparaciones", colId: "N° Rep" },
    GST: { tipo: "GASTO",            hoja: cfg.HOJA_GASTOS       || "Gastos",       colId: "N° Gasto" },
    ACC: { tipo: "VENTA_ACCESORIO",  hoja: "Venta Accesorios",                      colId: "N° Venta Accesorio" },
    CAC: { tipo: "COMPRA_ACCESORIO", hoja: "Compras Accesorios",                    colId: "N° Compra Accesorio", multilinea: true },
    CAM: { tipo: "CAMBIO_MONEDA",    hoja: "CAMBIO_MONEDA",                         colId: "N° Cambio" },
    AJC: { tipo: "AJUSTE_CAJA",      hoja: "AJUSTES_CAJA",                          colId: "N° Ajuste" },
    INV: { tipo: "INVERSOR",         hoja: cfg.HOJA_INVERSORES   || "Inversores",   colId: "N° Movimiento" },
    DEV: { tipo: "DEVOLUCION",       hoja: "Devoluciones",                          colId: "N° Devolución" }
  };
}

function detectarTipoOperacion_(numero) {
  const prefijo = String(numero || "").trim().split("-")[0].toUpperCase();
  const mapa = obtenerMapaTiposAnulacion_();
  const info = mapa[prefijo];
  if (!info) {
    throw new Error(`❌ No reconozco el prefijo "${prefijo}". Usá CMP-xxx, VTA-xxx, PRE-xxx, REP-xxx, GST-xxx, ACC-xxx, CAC-xxx, CAM-xxx, AJC-xxx, INV-xxx o DEV-xxx.`);
  }
  return Object.assign({ prefijo: prefijo }, info);
}


// ============================================================
//  3. INVERSORES — estructura especial (paneles dinámicos)
//  Mismo criterio de detección que procesarMovimientoInversor() y
//  generarRendimientoMensual() (ambas protegidas, no se tocan): buscar
//  "Panel del Inversor", "MOVIMIENTOS DE CAPITAL" y "RENDIMIENTOS
//  MENSUALES" en la columna A.
// ============================================================

/** Devuelve [{ inversor, tipoTabla, filaEncSub, filaFinDatos }] para cada sub-tabla encontrada. */
function _mapearPanelesInversores_(invSheet) {
  const lastRow = invSheet.getLastRow();
  const colA = invSheet.getRange(1, 1, lastRow, 1).getValues().map(r => String(r[0] || ""));

  const inicioSeccion = [];
  colA.forEach((texto, idx) => {
    if (texto.includes("Panel del Inversor") ||
        texto.includes("MOVIMIENTOS DE CAPITAL") ||
        texto.includes("RENDIMIENTOS MENSUALES")) {
      inicioSeccion.push(idx + 1);
    }
  });

  let inversorActual = "";
  const tablas = [];
  colA.forEach((texto, idx) => {
    const fila = idx + 1;
    if (texto.includes("Panel del Inversor")) {
      const m = texto.replace(/.*Panel del Inversor[:\s]*/i, "").trim();
      inversorActual = m || texto;
      return;
    }
    if (!texto.includes("MOVIMIENTOS DE CAPITAL") && !texto.includes("RENDIMIENTOS MENSUALES")) return;

    const filaEncSub = fila + 1;
    if (filaEncSub > lastRow) return;
    const siguienteSeccion = inicioSeccion.find(f => f > fila);
    const filaFinDatos = siguienteSeccion ? siguienteSeccion - 1 : lastRow;

    tablas.push({
      inversor: inversorActual,
      tipoTabla: texto.includes("MOVIMIENTOS DE CAPITAL") ? "MOVIMIENTOS DE CAPITAL" : "RENDIMIENTOS MENSUALES",
      filaEncSub: filaEncSub,
      filaFinDatos: filaFinDatos
    });
  });
  return tablas;
}

/**
 * sincronizarNumeracionInversores()
 *
 * Agrega (si faltan) las columnas "N° Movimiento" y "ESTADO_REGISTRO" al
 * final de cada sub-tabla de Inversores, y numera correlativamente
 * (INV-001, INV-002, ...) las filas de datos que todavía no tengan número.
 * Se puede correr varias veces sin pisar numeración ya asignada. Devuelve
 * la cantidad de movimientos recién numerados.
 */
function sincronizarNumeracionInversores() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const invSheet = ss.getSheetByName(cfg.HOJA_INVERSORES || "Inversores");
  if (!invSheet) throw new Error("❌ Hoja 'Inversores' no encontrada.");

  const tablas = _mapearPanelesInversores_(invSheet);
  let siguienteNumero = 1;

  // Próximo número libre, mirando lo ya numerado (para no duplicar).
  tablas.forEach(t => {
    const hdrs = invSheet.getRange(t.filaEncSub, 1, 1, invSheet.getLastColumn()).getValues()[0];
    const colNum = hdrs.findIndex(h => String(h).trim() === "N° Movimiento") + 1;
    if (colNum === 0) return;
    const filaDatosDesde = t.filaEncSub + 1;
    if (filaDatosDesde > t.filaFinDatos) return;
    const valores = invSheet.getRange(filaDatosDesde, colNum, t.filaFinDatos - filaDatosDesde + 1, 1).getValues();
    valores.forEach(v => {
      const m = String(v[0] || "").match(/^INV-(\d+)$/);
      if (m) siguienteNumero = Math.max(siguienteNumero, parseInt(m[1], 10) + 1);
    });
  });

  let numerados = 0;
  tablas.forEach(t => {
    let hdrs = invSheet.getRange(t.filaEncSub, 1, 1, invSheet.getLastColumn()).getValues()[0];
    let colNum = hdrs.findIndex(h => String(h).trim() === "N° Movimiento") + 1;
    let colEst = hdrs.findIndex(h => String(h).trim() === "ESTADO_REGISTRO") + 1;

    if (colNum === 0) {
      colNum = invSheet.getLastColumn() + 1;
      invSheet.getRange(t.filaEncSub, colNum).setValue("N° Movimiento").setFontWeight("bold");
    }
    if (colEst === 0) {
      colEst = invSheet.getLastColumn() + 1;
      invSheet.getRange(t.filaEncSub, colEst).setValue("ESTADO_REGISTRO").setFontWeight("bold");
    }

    const filaDatosDesde = t.filaEncSub + 1;
    if (filaDatosDesde > t.filaFinDatos) return;

    for (let f = filaDatosDesde; f <= t.filaFinDatos; f++) {
      const tieneFecha = invSheet.getRange(f, 1).getValue();
      if (!tieneFecha) continue; // fila vacía dentro del rango de la sub-tabla

      const numActual = String(invSheet.getRange(f, colNum).getValue() || "").trim();
      if (!numActual) {
        invSheet.getRange(f, colNum).setValue(`INV-${String(siguienteNumero).padStart(3, "0")}`);
        siguienteNumero++;
        numerados++;
      }
      const estActual = String(invSheet.getRange(f, colEst).getValue() || "").trim();
      if (!estActual) invSheet.getRange(f, colEst).setValue(ANUL_ACTIVO);
    }
  });

  return numerados;
}

/** Wrapper con alerta para invocar sincronizarNumeracionInversores() desde el menú. */
function sincronizarNumeracionInversoresManual() {
  const n = sincronizarNumeracionInversores();
  SpreadsheetApp.getUi().alert(`✅ Numeración sincronizada.\n${n} movimiento/s numerado/s.`);
}

/** Busca un movimiento de Inversores por su N° Movimiento (INV-xxx). */
function _buscarMovimientoInversor_(invSheet, numero) {
  const tablas = _mapearPanelesInversores_(invSheet);
  for (let t = 0; t < tablas.length; t++) {
    const tabla = tablas[t];
    const hdrs = invSheet.getRange(tabla.filaEncSub, 1, 1, invSheet.getLastColumn()).getValues()[0];
    const colNum = hdrs.findIndex(h => String(h).trim() === "N° Movimiento") + 1;
    if (colNum === 0) continue;
    const filaDatosDesde = tabla.filaEncSub + 1;
    if (filaDatosDesde > tabla.filaFinDatos) continue;
    const valores = invSheet.getRange(filaDatosDesde, colNum, tabla.filaFinDatos - filaDatosDesde + 1, 1).getValues();
    for (let i = 0; i < valores.length; i++) {
      if (String(valores[i][0]).trim() === String(numero).trim()) {
        return { fila: filaDatosDesde + i, tabla: tabla, hdrs: hdrs };
      }
    }
  }
  return null;
}


// ============================================================
//  4. RESUMEN PREVIO (Paso 5 / Paso 9)
// ============================================================

function obtenerResumenAnulacion(numero) {
  return _construirResumenAnulacion_(numero, "ANULAR");
}
function obtenerResumenRestauracion(numero) {
  return _construirResumenAnulacion_(numero, "RESTAURAR");
}

function _construirResumenAnulacion_(numero, accion) {
  const info = detectarTipoOperacion_(numero);
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();

  let cliente = "", importe = 0, detalle = "", estadoActual = "", advertencia = "";
  const impactos = [];

  if (info.prefijo === "INV") {
    const invSheet = ss.getSheetByName(cfg.HOJA_INVERSORES || "Inversores");
    if (!invSheet) throw new Error("❌ Hoja 'Inversores' no encontrada.");
    const encontrado = _buscarMovimientoInversor_(invSheet, numero);
    if (!encontrado) {
      throw new Error(`❌ No encontré el movimiento "${numero}". Si es un movimiento cargado antes de activar las anulaciones, corré primero "Sincronizar numeración de inversores".`);
    }
    const hdrs = encontrado.hdrs;
    const val = (nombre) => {
      const c = hdrs.findIndex(h => String(h).trim() === nombre);
      return c === -1 ? "" : invSheet.getRange(encontrado.fila, c + 1).getValue();
    };
    cliente = encontrado.tabla.inversor;
    importe = Number(val("Monto")) || 0;
    detalle = `${val("Tipo")} — ${val("Detalle")}`;
    const colEst = hdrs.findIndex(h => String(h).trim() === "ESTADO_REGISTRO") + 1;
    estadoActual = String(invSheet.getRange(encontrado.fila, colEst).getValue() || "").trim() || ANUL_ACTIVO;
    impactos.push("Inversores");
    advertencia = "Los movimientos de Inversores no tienen un asiento identificable de forma unívoca en Libro Diario (se registran por nombre de inversor). Revisar manualmente ese asiento si corresponde.";
  } else {
    const sheet = ss.getSheetByName(info.hoja);
    if (!sheet) throw new Error(`❌ Hoja '${info.hoja}' no encontrada.`);
    const fE = 2;
    const fila = _buscarFilaPorId_(sheet, fE, info.colId, numero);
    if (fila === -1) throw new Error(`❌ "${numero}" no encontrado en ${info.hoja}.`);

    const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
    estadoActual = String(sheet.getRange(fila, colEst).getValue() || "").trim() || ANUL_ACTIVO;

    const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
    const val = (nombre) => {
      const c = hdrs.findIndex(h => String(h).trim() === nombre);
      return c === -1 ? "" : sheet.getRange(fila, c + 1).getValue();
    };

    impactos.push(info.hoja, "Libro Diario", "Dashboard", "Reportes");

    if (info.prefijo === "CMP") {
      cliente = val("Proveedor / Origen");
      importe = Number(val("Precio Compra")) || Number(val("Precio Acordado Consignación")) || 0;
      detalle = val("Equipo / Modelo");
      impactos.push("Stock");
      const nPre = String(val("N° Preventa Asociada") || "").trim();
      if (nPre) impactos.push(`Preventa asociada (${nPre})`);
      const estadoCompra = String(val("Estado") || "");
      if (accion === "ANULAR" && estadoCompra.includes("Vendido")) {
        advertencia = "El equipo ya fue vendido. Primero hay que anular la venta correspondiente.";
      }
    }

    if (info.prefijo === "VTA") {
      cliente = val("Cliente");
      importe = Number(val("Precio Venta")) || 0;
      detalle = val("Modelo");
      impactos.push("Stock");
      const nOp = String(val("N° OP Compra") || "").trim();
      if (nOp) impactos.push(`Compra asociada (${nOp})`);

      if (nOp) {
        const comprasSheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
        const filaC = comprasSheet ? _buscarFilaPorId_(comprasSheet, 2, "N° OP", nOp) : -1;
        if (filaC !== -1) {
          let colNPC = -1;
          try { colNPC = getCol(comprasSheet, "N° Preventa Asociada", 2); } catch (e) { /* opcional */ }
          const nPre = colNPC >= 0 ? String(comprasSheet.getRange(filaC, colNPC).getValue() || "").trim() : "";
          if (nPre) {
            impactos.push(`Preventa asociada (${nPre})`);
            advertencia = "Los montos cobrados en la entrega de la preventa NO se revierten automáticamente en Preventas — revisalos manualmente después de anular.";
          }
        }
      }

      const accSheet = ss.getSheetByName("Venta Accesorios");
      if (accSheet) {
        let colNVC = -1;
        try { colNVC = getCol(accSheet, "N° Venta Celular Asociada", 2); } catch (e) { /* opcional */ }
        if (colNVC >= 0) {
          const lastA = accSheet.getLastRow();
          if (lastA > 2) {
            const idsA = accSheet.getRange(3, colNVC, lastA - 2, 1).getValues();
            if (idsA.some(r => String(r[0]).trim() === numero)) impactos.push("Ventas Accesorios asociados");
          }
        }
      }
    }

    if (info.prefijo === "PRE") {
      cliente = val("Cliente");
      importe = Number(val("Precio Venta Pactado")) || 0;
      detalle = val("Modelo Solicitado");
      const nCompra = String(val("N° Compra Asociada") || "").trim();
      const nVenta  = String(val("N° Venta Asociada")   || "").trim();
      if (nCompra) impactos.push(`Compra asociada (${nCompra})`);
      if (nVenta)  impactos.push(`Venta asociada (${nVenta})`);

      const estadoPre = String(val("Estado") || "");
      if (accion === "ANULAR") {
        if (estadoPre.includes("Entregado") && !estadoPre.includes("con saldo")) {
          advertencia = "Ya fue entregada por completo. Hay que anular primero la venta asociada.";
        } else if (nVenta && verificarIntegridadRelacionada_(cfg.HOJA_VENTAS || "Ventas", 2, "N° Venta", nVenta).ok) {
          advertencia = "La preventa posee una venta asociada activa.\nNo se puede anular: hay que anular primero la venta vinculada.";
        } else if (nCompra && verificarIntegridadRelacionada_(cfg.HOJA_COMPRAS || "Compras", 2, "N° OP", nCompra).ok) {
          advertencia = "La preventa posee una compra asociada activa.\nNo se puede anular: hay que anular o liberar primero la compra vinculada.";
        } else if (nCompra || nVenta) {
          advertencia = "La preventa posee operaciones relacionadas, pero ya están anuladas — se puede continuar.";
        }
      }
    }

    if (info.prefijo === "REP") {
      cliente = val("Cliente");
      importe = Number(val("Precio Cobrado")) || 0;
      detalle = val("Equipo");
    }

    if (info.prefijo === "GST") {
      cliente = val("Responsable");
      importe = (Number(val("Monto Efectivo")) || 0) + (Number(val("Monto Transferencia")) || 0);
      detalle = val("Descripción");
    }

    if (info.prefijo === "ACC") {
      cliente = val("Cliente");
      importe = Number(val("Total Cobrado")) || 0;
      detalle = val("Producto");
      const nVta = String(val("N° Venta Celular Asociada") || "").trim();
      if (nVta) impactos.push(`Venta asociada (${nVta})`);
    }

    // CAC es multilínea (1 compra = N filas que comparten "N° Compra
    // Accesorio") — _buscarFilaPorId_/val() de arriba solo trajeron la
    // primera línea. Acá se recalculan importe/detalle sumando TODAS las
    // líneas, para no subestimar el total mostrado antes de confirmar.
    if (info.prefijo === "CAC") {
      const hdrsCAC = hdrs;
      const idxCAC = (n) => hdrsCAC.findIndex(h => String(h).trim() === n);
      const cProv = idxCAC("Proveedor"), cProd = idxCAC("Producto"), cCT = idxCAC("Costo Total"), cNum = idxCAC("N° Compra Accesorio");
      const lastRowCAC = sheet.getLastRow();
      const productos = [];
      importe = 0;
      if (lastRowCAC > fE) {
        sheet.getRange(fE + 1, 1, lastRowCAC - fE, sheet.getLastColumn()).getValues().forEach(row => {
          if (String(row[cNum] || "").trim() !== String(numero).trim()) return;
          importe += Number(row[cCT]) || 0;
          productos.push(String(row[cProd] || ""));
        });
      }
      cliente = val("Proveedor");
      detalle = productos.join(", ");
      impactos.push("Stock Accesorios");
    }

    if (info.prefijo === "CAM") {
      cliente = val("OPERADOR");
      importe = Number(val("Monto ARS")) || 0;
      detalle = `${val("Tipo Cambio")}: ${val("Caja Origen")} → ${val("Caja Destino")}`;
      impactos.push("Caja ARS", "Caja USD");
    }

    if (info.prefijo === "AJC") {
      cliente = val("OPERADOR");
      importe = Number(val("Monto")) || 0;
      detalle = `${val("Tipo Ajuste")} en ${val("Caja")}: ${val("Motivo")}`;
      impactos.push(`Caja ${val("Caja")}`);
    }
  }

  if (accion === "ANULAR" && estadoActual === ANUL_ANULADO) {
    throw new Error(`⚠️ "${numero}" ya está anulado/a.`);
  }
  if (accion === "RESTAURAR" && estadoActual !== ANUL_ANULADO) {
    throw new Error(`⚠️ "${numero}" no está anulado/a.`);
  }

  return {
    tipo: info.tipo,
    numero: numero,
    cliente: cliente || "—",
    detalle: detalle || "",
    importe: importe,
    impactos: impactos,
    advertencia: advertencia,
    estadoActual: estadoActual
  };
}


// ============================================================
//  5. ANULAR — lógica específica por tipo (Paso 6, 7, 8)
// ============================================================

function _anularCompra_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const comprasSheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  if (!comprasSheet) throw new Error("❌ Hoja 'Compras' no encontrada.");

  const fE = 2;

  // ---------- 1) LECTURAS ----------
  const colEst = asegurarColumnaEstadoRegistro_(comprasSheet, fE);
  const filaCompra = _buscarFilaPorId_(comprasSheet, fE, "N° OP", numero);
  if (filaCompra === -1) throw new Error(`❌ Compra "${numero}" no encontrada.`);

  const colEstadoCompra = getCol(comprasSheet, "Estado", fE);
  const estadoRegistroActual = String(comprasSheet.getRange(filaCompra, colEst).getValue() || "").trim();
  const estadoCompraActual   = String(comprasSheet.getRange(filaCompra, colEstadoCompra).getValue() || "");
  let colNPC = -1;
  try { colNPC = getCol(comprasSheet, "N° Preventa Asociada", fE); } catch (e) { /* opcional */ }
  const nPre = colNPC >= 0 ? String(comprasSheet.getRange(filaCompra, colNPC).getValue() || "").trim() : "";

  // ---------- 2) VALIDACIONES ----------
  if (estadoRegistroActual === ANUL_ANULADO) {
    throw new Error(`⚠️ La compra "${numero}" ya está anulada.`);
  }
  if (estadoCompraActual.includes("Vendido")) {
    throw new Error(`❌ No se puede anular "${numero}": el equipo ya fue vendido. Anulá primero la venta correspondiente.`);
  }

  // ---------- 3) VERIFICACIONES CRUZADAS ----------
  // Paso 3 + Paso 7 (integridad bidireccional CMP ↔ PRE): solo se toca la
  // preventa si sigue ACTIVA (ESTADO_REGISTRO, no el texto "Estado") y si
  // realmente sigue apuntando a ESTA compra — evita pisar una preventa ya
  // reasignada a otra compra o ya cancelada por su cuenta.
  const preSheet = ss.getSheetByName("Preventas");
  let filaPre = -1, cES_pre = -1, cNC_pre = -1, tocarPreventa = false;
  if (nPre && preSheet) {
    const check = verificarIntegridadRelacionada_("Preventas", 2, "N° Preventa", nPre);
    if (check.ok) {
      filaPre = check.fila;
      cES_pre = getCol(preSheet, "Estado", 2);
      cNC_pre = getCol(preSheet, "N° Compra Asociada", 2);
      const ncActual = String(preSheet.getRange(filaPre, cNC_pre).getValue() || "").trim();
      tocarPreventa = (ncActual === numero);
    }
    // Si la preventa está ANULADA o ya no existe: NO se toca (Paso 3).
  }

  // ---------- 4) ESCRITURAS SECUNDARIAS ----------
  let mensajePreventa = "";
  if (tocarPreventa) {
    preSheet.getRange(filaPre, cES_pre).setValue("🟡 Esperando compra");
    preSheet.getRange(filaPre, cNC_pre).setValue("");
    mensajePreventa = `\n🟡 Preventa "${nPre}" vuelve a estado Esperando compra.`;
  }

  // ---------- 5) LIBRO DIARIO ----------
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ANULADO);

  // ---------- 6) ESTADO DE NEGOCIO + STOCK ----------
  // (van juntos: actualizarStock_() -protegida- lee la columna "Estado")
  comprasSheet.getRange(filaCompra, colEstadoCompra).setValue("❌ Anulado");
  actualizarStock_(numero); // función protegida, solo se LLAMA

  // ---------- 7) ESTADO_REGISTRO final ----------
  comprasSheet.getRange(filaCompra, colEst).setValue(ANUL_ANULADO);

  registrarAuditoria_("COMPRA", numero, "ANULACION", motivo || "");

  return `✅ Compra "${numero}" anulada.\n📦 Equipo retirado del stock.\n📒 ${asientos} asiento/s de Libro Diario anulado/s.${mensajePreventa}`;
}

function _anularVenta_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const ventasSheet  = ss.getSheetByName(cfg.HOJA_VENTAS  || "Ventas");
  const comprasSheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  if (!ventasSheet || !comprasSheet) throw new Error("❌ Hojas Ventas/Compras no encontradas.");

  const fEV = 2, fEC = 2;

  // ---------- 1) LECTURAS ----------
  const colEstV = asegurarColumnaEstadoRegistro_(ventasSheet, fEV);
  const filaVta = _buscarFilaPorId_(ventasSheet, fEV, "N° Venta", numero);
  if (filaVta === -1) throw new Error(`❌ Venta "${numero}" no encontrada.`);

  const estadoRegistroActual = String(ventasSheet.getRange(filaVta, colEstV).getValue() || "").trim();
  const colNOP = getCol(ventasSheet, "N° OP Compra", fEV);
  const nOp = String(ventasSheet.getRange(filaVta, colNOP).getValue() || "").trim();

  // ---------- 2) VALIDACIONES ----------
  if (estadoRegistroActual === ANUL_ANULADO) {
    throw new Error(`⚠️ La venta "${numero}" ya está anulada.`);
  }

  // ---------- 3) VERIFICACIONES CRUZADAS ----------
  const filaCompra = _buscarFilaPorId_(comprasSheet, fEC, "N° OP", nOp);
  let colEstadoCompra = -1, necesitaRep = false, nPreCompra = "";
  if (filaCompra !== -1) {
    colEstadoCompra = getCol(comprasSheet, "Estado", fEC);
    const colRE = getCol(comprasSheet, "¿Necesita Reparación?", fEC);
    let colNPC = -1;
    try { colNPC = getCol(comprasSheet, "N° Preventa Asociada", fEC); } catch (e) { /* opcional */ }
    necesitaRep = String(comprasSheet.getRange(filaCompra, colRE).getValue()).trim() === "Sí";
    nPreCompra = colNPC >= 0 ? String(comprasSheet.getRange(filaCompra, colNPC).getValue() || "").trim() : "";
  }

  const preSheet = ss.getSheetByName("Preventas");
  let filaPre = -1, cES_pre = -1, cNV_pre = -1, preventaVinculada = false;
  if (nPreCompra && preSheet) {
    const check = verificarIntegridadRelacionada_("Preventas", 2, "N° Preventa", nPreCompra);
    if (check.ok) {
      filaPre = check.fila;
      cES_pre = getCol(preSheet, "Estado", 2);
      cNV_pre = getCol(preSheet, "N° Venta Asociada", 2);
      const nVtaAsociada = String(preSheet.getRange(filaPre, cNV_pre).getValue() || "").trim();
      preventaVinculada = (nVtaAsociada === numero);
    }
    // Si la preventa está ANULADA o ya no existe: NO se toca.
  }

  const estadoRestaurado =
    necesitaRep && preventaVinculada ? "🟣 Preventa + Reparación" :
    preventaVinculada ? "🔵 Reservado Preventa" :
    necesitaRep ? "🔧 En Reparación" : "📦 En Stock";

  // ---------- 4) ESCRITURAS SECUNDARIAS ----------
  let mensajePreventa = "";
  if (preventaVinculada) {
    preSheet.getRange(filaPre, cES_pre).setValue("🟠 Comprado");
    preSheet.getRange(filaPre, cNV_pre).setValue("");
    mensajePreventa = `\n🟠 Preventa "${nPreCompra}" vuelve a estado Comprado (⚠️ revisá manualmente Cobrado/Saldo Pendiente: los montos cobrados en la entrega no se revierten automáticamente).`;
  }

  let mensajeAcc = "";
  const accSheet = ss.getSheetByName("Venta Accesorios");
  if (accSheet) {
    let colNVC = -1;
    try { colNVC = getCol(accSheet, "N° Venta Celular Asociada", 2); } catch (e) { /* opcional */ }
    if (colNVC >= 0) {
      const colEstA = asegurarColumnaEstadoRegistro_(accSheet, 2);
      const lastA = accSheet.getLastRow();
      let anuladosAcc = 0;
      if (lastA > 2) {
        const datos = accSheet.getRange(3, 1, lastA - 2, accSheet.getLastColumn()).getValues();
        datos.forEach((row, i) => {
          if (String(row[colNVC - 1]).trim() !== numero) return;
          if (String(row[colEstA - 1] || "").trim() === ANUL_ANULADO) return; // ya estaba anulado, no contar de nuevo
          accSheet.getRange(3 + i, colEstA).setValue(ANUL_ANULADO);
          anuladosAcc++;
        });
      }
      if (anuladosAcc > 0) {
        mensajeAcc = `\n📦 ${anuladosAcc} accesorio/s asociado/s anulado/s (incluye regalos automáticos, si los hubo).`;
        if (typeof actualizarStockAccesorios_ === "function") {
          try { actualizarStockAccesorios_(); } catch (e) { Logger.log("⚠️ actualizarStockAccesorios_ falló tras anular venta " + numero + ": " + e.message); }
        }
      }
    }
  }

  // ---------- 5) LIBRO DIARIO ----------
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ANULADO);

  // ---------- 6) ESTADO DE NEGOCIO + STOCK ----------
  let mensajeCompra = "";
  if (filaCompra !== -1) {
    comprasSheet.getRange(filaCompra, colEstadoCompra).setValue(estadoRestaurado);
    actualizarStock_(nOp);
    mensajeCompra = `\n📦 Equipo "${nOp}" vuelve a "${estadoRestaurado}".`;
  }

  // ---------- 7) ESTADO_REGISTRO final ----------
  ventasSheet.getRange(filaVta, colEstV).setValue(ANUL_ANULADO);

  registrarAuditoria_("VENTA", numero, "ANULACION", motivo || "");

  return `✅ Venta "${numero}" anulada.${mensajeCompra}${mensajePreventa}${mensajeAcc}\n📒 ${asientos} asiento/s de Libro Diario anulado/s.`;
}

function _anularPreventa_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const preSheet = ss.getSheetByName("Preventas");
  if (!preSheet) throw new Error("❌ Hoja 'Preventas' no encontrada.");

  const fEP = 2;

  // ---------- 1) LECTURAS ----------
  const colEst = asegurarColumnaEstadoRegistro_(preSheet, fEP);
  const filaPre = _buscarFilaPorId_(preSheet, fEP, "N° Preventa", numero);
  if (filaPre === -1) throw new Error(`❌ Preventa "${numero}" no encontrada.`);

  const cES = getCol(preSheet, "Estado", fEP);
  const cNC = getCol(preSheet, "N° Compra Asociada", fEP);
  const cNV = getCol(preSheet, "N° Venta Asociada", fEP);
  const estadoRegistroActual = String(preSheet.getRange(filaPre, colEst).getValue() || "").trim();
  const estadoPreventa = String(preSheet.getRange(filaPre, cES).getValue() || "");
  const nCompra = String(preSheet.getRange(filaPre, cNC).getValue() || "").trim();
  const nVenta  = String(preSheet.getRange(filaPre, cNV).getValue() || "").trim();

  // ---------- 2) VALIDACIONES ----------
  if (estadoRegistroActual === ANUL_ANULADO) {
    throw new Error(`⚠️ La preventa "${numero}" ya está anulada.`);
  }
  if (estadoPreventa.includes("Entregado") && !estadoPreventa.includes("con saldo")) {
    throw new Error(`❌ No se puede anular "${numero}": ya fue entregada por completo. Anulá primero la venta asociada.`);
  }

  // ---------- 3) VERIFICACIONES CRUZADAS ----------
  // Paso 5: bloquear si tiene una compra o venta ACTIVA vinculada (equivale
  // a "🟠 Comprado" o estados superiores) — antes solo miraba el texto
  // "Estado"; ahora exige ESTADO_REGISTRO de la relación, no el rótulo.
  if (nVenta) {
    const check = verificarIntegridadRelacionada_(cfg.HOJA_VENTAS || "Ventas", 2, "N° Venta", nVenta);
    if (check.ok) {
      throw new Error("La preventa posee una venta asociada.\nDebe anular primero la venta vinculada.");
    }
  }
  if (nCompra) {
    const check = verificarIntegridadRelacionada_(cfg.HOJA_COMPRAS || "Compras", 2, "N° OP", nCompra);
    if (check.ok) {
      throw new Error("La preventa posee una compra asociada.\nDebe anular o liberar primero la compra vinculada.");
    }
  }

  // ---------- 5) LIBRO DIARIO ----------
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ANULADO);

  // ---------- 6) ESTADO DE NEGOCIO ----------
  preSheet.getRange(filaPre, cES).setValue("❌ Cancelado");

  // ---------- 7) ESTADO_REGISTRO final ----------
  preSheet.getRange(filaPre, colEst).setValue(ANUL_ANULADO);

  registrarAuditoria_("PREVENTA", numero, "ANULACION", motivo || "");

  return `✅ Preventa "${numero}" anulada.\n📒 ${asientos} asiento/s de Libro Diario anulado/s.`;
}

function _anularReparacion_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const sheet = ss.getSheetByName(cfg.HOJA_REPARACIONES || "Reparaciones");
  if (!sheet) throw new Error("❌ Hoja 'Reparaciones' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Rep", numero);
  if (fila === -1) throw new Error(`❌ Reparación "${numero}" no encontrada.`);
  if (String(sheet.getRange(fila, colEst).getValue() || "").trim() === ANUL_ANULADO) {
    throw new Error(`⚠️ La reparación "${numero}" ya está anulada.`);
  }

  // Paso 9: Libro Diario antes del cambio de estado visible final.
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ANULADO);
  sheet.getRange(fila, colEst).setValue(ANUL_ANULADO);
  registrarAuditoria_("REPARACION", numero, "ANULACION", motivo || "");

  return `✅ Reparación "${numero}" anulada.\n📒 ${asientos} asiento/s de Libro Diario anulado/s.`;
}

function _anularGasto_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const sheet = ss.getSheetByName(cfg.HOJA_GASTOS || "Gastos");
  if (!sheet) throw new Error("❌ Hoja 'Gastos' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Gasto", numero);
  if (fila === -1) throw new Error(`❌ Gasto "${numero}" no encontrado.`);
  if (String(sheet.getRange(fila, colEst).getValue() || "").trim() === ANUL_ANULADO) {
    throw new Error(`⚠️ El gasto "${numero}" ya está anulado.`);
  }

  // Paso 9: Libro Diario antes del cambio de estado visible final.
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ANULADO);
  sheet.getRange(fila, colEst).setValue(ANUL_ANULADO);
  registrarAuditoria_("GASTO", numero, "ANULACION", motivo || "");

  return `✅ Gasto "${numero}" anulado.\n📒 ${asientos} asiento/s de Libro Diario anulado/s.`;
}

/** Sin dependencias cruzadas (igual que GASTO/REPARACION): 1 fila = 1 número, marcarLibroDiarioPorOperacion_ ya cubre los 2 asientos (EGRESO+INGRESO) de un cambio de moneda. */
function _anularCambioMoneda_(numero, motivo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CAMBIO_MONEDA");
  if (!sheet) throw new Error("❌ Hoja 'CAMBIO_MONEDA' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Cambio", numero);
  if (fila === -1) throw new Error(`❌ Cambio de moneda "${numero}" no encontrado.`);
  if (String(sheet.getRange(fila, colEst).getValue() || "").trim() === ANUL_ANULADO) {
    throw new Error(`⚠️ El cambio de moneda "${numero}" ya está anulado.`);
  }

  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ANULADO);
  sheet.getRange(fila, colEst).setValue(ANUL_ANULADO);
  registrarAuditoria_("CAMBIO_MONEDA", numero, "ANULACION", motivo || "");

  return `✅ Cambio de moneda "${numero}" anulado.\n📒 ${asientos} asiento/s de Libro Diario anulado/s.`;
}

/** Sin dependencias cruzadas: 1 fila = 1 número, 1 solo asiento de Libro Diario. */
function _anularAjusteCaja_(numero, motivo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("AJUSTES_CAJA");
  if (!sheet) throw new Error("❌ Hoja 'AJUSTES_CAJA' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Ajuste", numero);
  if (fila === -1) throw new Error(`❌ Ajuste de caja "${numero}" no encontrado.`);
  if (String(sheet.getRange(fila, colEst).getValue() || "").trim() === ANUL_ANULADO) {
    throw new Error(`⚠️ El ajuste de caja "${numero}" ya está anulado.`);
  }

  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ANULADO);
  sheet.getRange(fila, colEst).setValue(ANUL_ANULADO);
  registrarAuditoria_("AJUSTE_CAJA", numero, "ANULACION", motivo || "");

  return `✅ Ajuste de caja "${numero}" anulado.\n📒 ${asientos} asiento/s de Libro Diario anulado/s.`;
}

/** Sin dependencias cruzadas, mismo patrón simple que GASTO/AJUSTE_CAJA/CAMBIO_MONEDA — no toca stock (la Devolución nunca lo tocó). */
function _anularDevolucion_(numero, motivo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Devoluciones");
  if (!sheet) throw new Error("❌ Hoja 'Devoluciones' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Devolución", numero);
  if (fila === -1) throw new Error(`❌ Devolución "${numero}" no encontrada.`);
  if (String(sheet.getRange(fila, colEst).getValue() || "").trim() === ANUL_ANULADO) {
    throw new Error(`⚠️ La devolución "${numero}" ya está anulada.`);
  }

  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ANULADO);
  sheet.getRange(fila, colEst).setValue(ANUL_ANULADO);
  registrarAuditoria_("DEVOLUCION", numero, "ANULACION", motivo || "");

  return `✅ Devolución "${numero}" anulada.\n📒 ${asientos} asiento/s de Libro Diario anulado/s.`;
}

function _anularAccesorio_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Venta Accesorios");
  if (!sheet) throw new Error("❌ Hoja 'Venta Accesorios' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Venta Accesorio", numero);
  if (fila === -1) throw new Error(`❌ Accesorio "${numero}" no encontrado.`);
  if (String(sheet.getRange(fila, colEst).getValue() || "").trim() === ANUL_ANULADO) {
    throw new Error(`⚠️ El accesorio "${numero}" ya está anulado.`);
  }

  // Paso 9: Libro Diario antes del cambio de estado visible final.
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ANULADO);
  sheet.getRange(fila, colEst).setValue(ANUL_ANULADO);
  registrarAuditoria_("VENTA_ACCESORIO", numero, "ANULACION", motivo || "");

  // Repone stock si esta línea tenía SKU_ID (venta manual o regalo automático
  // asociado a una venta de equipo). actualizarStockAccesorios_() ya excluye
  // las filas ANULADO al sumar salidas, así que alcanza con recalcular.
  if (typeof actualizarStockAccesorios_ === "function") {
    try { actualizarStockAccesorios_(); } catch (e) { Logger.log("⚠️ actualizarStockAccesorios_ falló tras anular " + numero + ": " + e.message); }
  }

  return `✅ Accesorio "${numero}" anulado.\n📒 ${asientos} asiento/s de Libro Diario anulado/s.`;
}

/**
 * _anularCompraAccesorio_(numero, motivo)
 *
 * A diferencia de CMP/VTA/PRE/REP/GST/ACC (1 número = 1 fila), una compra de
 * accesorios son N filas que comparten el mismo "N° Compra Accesorio" (una
 * línea por producto). Por eso NO usa _buscarFilaPorId_ (trae solo la
 * primera fila) — recorre y marca TODAS las filas del número.
 */
function _anularCompraAccesorio_(numero, motivo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Compras Accesorios");
  if (!sheet) throw new Error("❌ Hoja 'Compras Accesorios' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const colNum = getCol(sheet, "N° Compra Accesorio", fE);
  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) throw new Error(`❌ Compra de accesorios "${numero}" no encontrada.`);

  const numTrim = String(numero).trim();
  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  const filasAAnular = [];
  datos.forEach((row, i) => { if (String(row[colNum - 1] || "").trim() === numTrim) filasAAnular.push(fE + 1 + i); });
  if (filasAAnular.length === 0) throw new Error(`❌ Compra de accesorios "${numero}" no encontrada.`);

  const yaAnuladas = filasAAnular.every(f => String(sheet.getRange(f, colEst).getValue() || "").trim() === ANUL_ANULADO);
  if (yaAnuladas) throw new Error(`⚠️ La compra de accesorios "${numero}" ya está anulada.`);

  // Bloquear si anular esta compra dejaría stock negativo: el stock es por
  // cantidad (no por unidad serializada como los equipos), así que no hay
  // forma de saber "esta unidad puntual ya se vendió" — se verifica a nivel
  // SKU: si lo ya vendido activo supera lo que quedaría comprado activo
  // (sin esta compra), no se permite anular.
  const colSku  = getCol(sheet, "SKU_ID", fE);
  const colCant = getCol(sheet, "Cantidad", fE);
  const cantidadPorSku = {};
  filasAAnular.forEach(f => {
    const fila = sheet.getRange(f, 1, 1, sheet.getLastColumn()).getValues()[0];
    const sku = String(fila[colSku - 1] || "").trim();
    if (sku) cantidadPorSku[sku] = (cantidadPorSku[sku] || 0) + (Number(fila[colCant - 1]) || 0);
  });
  const stockSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Stock Accesorios");
  if (stockSh) {
    const fES = 2;
    const hdrsStock = stockSh.getRange(fES, 1, 1, stockSh.getLastColumn()).getValues()[0];
    const idxStock = (n) => hdrsStock.findIndex(h => String(h).trim() === n);
    const sSKU = idxStock("SKU_ID"), sSTK = idxStock("Stock"), sPRD = idxStock("Producto");
    const lastStock = stockSh.getLastRow();
    if (sSKU >= 0 && sSTK >= 0 && lastStock > fES) {
      const datosStock = stockSh.getRange(fES + 1, 1, lastStock - fES, stockSh.getLastColumn()).getValues();
      for (let i = 0; i < datosStock.length; i++) {
        const row = datosStock[i];
        const sku = String(row[sSKU] || "").trim();
        if (!cantidadPorSku[sku]) continue;
        const stockActual     = Number(row[sSTK]) || 0;
        const stockResultante = stockActual - cantidadPorSku[sku];
        if (stockResultante < 0) {
          const producto = sPRD >= 0 ? row[sPRD] : sku;
          throw new Error(`❌ No se puede anular "${numero}": "${producto}" ya tiene unidades vendidas. Anular esta compra dejaría el stock en ${stockResultante}. Anulá primero las ventas correspondientes.`);
        }
      }
    }
  }

  // Paso 9: Libro Diario antes del cambio de estado visible final.
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ANULADO);
  filasAAnular.forEach(f => sheet.getRange(f, colEst).setValue(ANUL_ANULADO));
  registrarAuditoria_("COMPRA_ACCESORIO", numero, "ANULACION", motivo || "");

  if (typeof actualizarStockAccesorios_ === "function") {
    try { actualizarStockAccesorios_(); } catch (e) { Logger.log("⚠️ actualizarStockAccesorios_ falló tras anular " + numero + ": " + e.message); }
  }

  return `✅ Compra de accesorios "${numero}" anulada (${filasAAnular.length} línea/s).\n📒 ${asientos} asiento/s de Libro Diario anulado/s.`;
}

function _anularInversor_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const invSheet = ss.getSheetByName(cfg.HOJA_INVERSORES || "Inversores");
  if (!invSheet) throw new Error("❌ Hoja 'Inversores' no encontrada.");

  const encontrado = _buscarMovimientoInversor_(invSheet, numero);
  if (!encontrado) {
    throw new Error(`❌ No encontré el movimiento "${numero}". Si es un movimiento cargado antes de activar las anulaciones, corré primero "Sincronizar numeración de inversores".`);
  }

  const colEst = encontrado.hdrs.findIndex(h => String(h).trim() === "ESTADO_REGISTRO") + 1;
  if (String(invSheet.getRange(encontrado.fila, colEst).getValue() || "").trim() === ANUL_ANULADO) {
    throw new Error(`⚠️ El movimiento "${numero}" ya está anulado.`);
  }

  invSheet.getRange(encontrado.fila, colEst).setValue(ANUL_ANULADO);

  registrarAuditoria_("INVERSOR", numero, "ANULACION",
    (motivo || "") + " | ⚠️ Revisar manualmente el asiento correspondiente en Libro Diario (no identificable de forma única).");

  return `✅ Movimiento "${numero}" anulado.\n⚠️ Revisá manualmente el asiento asociado en Libro Diario: los movimientos de Inversores se registran allí por nombre de inversor, no por N° de movimiento, así que no se puede ubicar de forma automática y unívoca.`;
}


// ============================================================
//  6. RESTAURAR — inverso de cada función anterior (Paso 11)
// ============================================================

function _restaurarCompra_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const comprasSheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  if (!comprasSheet) throw new Error("❌ Hoja 'Compras' no encontrada.");

  const fE = 2;

  // ---------- 1) LECTURAS ----------
  const colEst = asegurarColumnaEstadoRegistro_(comprasSheet, fE);
  const filaCompra = _buscarFilaPorId_(comprasSheet, fE, "N° OP", numero);
  if (filaCompra === -1) throw new Error(`❌ Compra "${numero}" no encontrada.`);

  const colEstadoCompra = getCol(comprasSheet, "Estado", fE);
  const colRE = getCol(comprasSheet, "¿Necesita Reparación?", fE);
  let colNPC = -1;
  try { colNPC = getCol(comprasSheet, "N° Preventa Asociada", fE); } catch (e) { /* opcional */ }

  const estadoRegistroActual = String(comprasSheet.getRange(filaCompra, colEst).getValue() || "").trim();
  const necesitaRep = String(comprasSheet.getRange(filaCompra, colRE).getValue()).trim() === "Sí";
  const nPre = colNPC >= 0 ? String(comprasSheet.getRange(filaCompra, colNPC).getValue() || "").trim() : "";

  // ---------- 2) VALIDACIONES ----------
  if (estadoRegistroActual !== ANUL_ANULADO) {
    throw new Error(`⚠️ La compra "${numero}" no está anulada.`);
  }

  // ---------- 3) VERIFICACIONES CRUZADAS ----------
  // Paso 2 + Paso 7: la reserva con la preventa solo se restaura si la
  // preventa sigue ACTIVA y sigue apuntando a ESTA compra (o todavía no
  // apunta a ninguna). Si quedó reasignada a otra compra, se bloquea toda
  // la restauración — no solo la reserva.
  const preSheet = ss.getSheetByName("Preventas");
  let filaPre = -1, cES_pre = -1, cNC_pre = -1, tienePreventa = false, reestablecerLink = false;
  if (nPre) {
    if (!preSheet) throw new Error("❌ Hoja 'Preventas' no encontrada.");
    const check = verificarIntegridadRelacionada_("Preventas", 2, "N° Preventa", nPre);
    if (check.ok) {
      filaPre = check.fila;
      cES_pre = getCol(preSheet, "Estado", 2);
      cNC_pre = getCol(preSheet, "N° Compra Asociada", 2);
      const ncActual = String(preSheet.getRange(filaPre, cNC_pre).getValue() || "").trim();
      if (ncActual === numero || ncActual === "") {
        tienePreventa = true;
        reestablecerLink = (ncActual === ""); // Paso 7: re-vincular si había quedado libre
      } else {
        throw new Error("La preventa ya fue asociada a otra compra.\nNo puede restaurarse automáticamente.");
      }
    }
    // Si la preventa está ANULADA o ya no existe: se restaura como stock
    // normal, sin reservar (no bloquea).
  }

  const estadoRestaurado =
    necesitaRep && tienePreventa ? "🟣 Preventa + Reparación" :
    tienePreventa ? "🔵 Reservado Preventa" :
    necesitaRep ? "🔧 En Reparación" : "📦 En Stock";

  // ---------- 4) ESCRITURAS SECUNDARIAS ----------
  if (tienePreventa && reestablecerLink) {
    preSheet.getRange(filaPre, cNC_pre).setValue(numero);
    preSheet.getRange(filaPre, cES_pre).setValue("🟠 Comprado");
  }

  // ---------- 5) LIBRO DIARIO ----------
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ACTIVO);

  // ---------- 6) ESTADO DE NEGOCIO + STOCK ----------
  comprasSheet.getRange(filaCompra, colEstadoCompra).setValue(estadoRestaurado);
  actualizarStock_(numero);

  // ---------- 7) ESTADO_REGISTRO final ----------
  comprasSheet.getRange(filaCompra, colEst).setValue(ANUL_ACTIVO);

  registrarAuditoria_("COMPRA", numero, "RESTAURACION", motivo || "");

  return `✅ Compra "${numero}" restaurada.\n📦 Equipo vuelve al stock como "${estadoRestaurado}".\n📒 ${asientos} asiento/s de Libro Diario reactivado/s.`;
}

function _restaurarVenta_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const ventasSheet  = ss.getSheetByName(cfg.HOJA_VENTAS  || "Ventas");
  const comprasSheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  if (!ventasSheet || !comprasSheet) throw new Error("❌ Hojas Ventas/Compras no encontradas.");

  const fEV = 2, fEC = 2;

  // ---------- 1) LECTURAS ----------
  const colEstV = asegurarColumnaEstadoRegistro_(ventasSheet, fEV);
  const filaVta = _buscarFilaPorId_(ventasSheet, fEV, "N° Venta", numero);
  if (filaVta === -1) throw new Error(`❌ Venta "${numero}" no encontrada.`);

  const estadoRegistroActual = String(ventasSheet.getRange(filaVta, colEstV).getValue() || "").trim();
  const colNOP = getCol(ventasSheet, "N° OP Compra", fEV);
  const nOp = String(ventasSheet.getRange(filaVta, colNOP).getValue() || "").trim();

  const filaCompra = _buscarFilaPorId_(comprasSheet, fEC, "N° OP", nOp);
  if (filaCompra === -1) throw new Error(`❌ La compra "${nOp}" asociada a esta venta ya no existe.`);
  const colEstadoCompra = getCol(comprasSheet, "Estado", fEC);
  const colEstCompraReg = asegurarColumnaEstadoRegistro_(comprasSheet, fEC);
  const estadoCompraActual = String(comprasSheet.getRange(filaCompra, colEstadoCompra).getValue() || "");
  const estadoRegistroCompra = String(comprasSheet.getRange(filaCompra, colEstCompraReg).getValue() || "").trim();

  // ---------- 2) VALIDACIONES ----------
  if (estadoRegistroActual !== ANUL_ANULADO) {
    throw new Error(`⚠️ La venta "${numero}" no está anulada.`);
  }
  // Paso 4: la compra asociada debe estar ACTIVA — el texto "Vendido" no
  // alcanza para distinguir "disponible" de "anulada".
  if (estadoRegistroCompra === ANUL_ANULADO) {
    throw new Error("No se puede restaurar una venta cuya compra asociada está anulada.");
  }
  if (estadoCompraActual.includes("Vendido")) {
    throw new Error(`❌ No se puede restaurar "${numero}": el equipo "${nOp}" ya fue vendido nuevamente en otra operación.`);
  }

  // ---------- 3) VERIFICACIONES CRUZADAS ----------
  const preSheet = ss.getSheetByName("Preventas");
  let colNPC = -1;
  try { colNPC = getCol(comprasSheet, "N° Preventa Asociada", fEC); } catch (e) { /* opcional */ }
  const nPreCompra = colNPC >= 0 ? String(comprasSheet.getRange(filaCompra, colNPC).getValue() || "").trim() : "";

  let filaPre = -1, cES_pre = -1, cNV_pre = -1, restaurarPreventa = false;
  if (nPreCompra && preSheet) {
    const check = verificarIntegridadRelacionada_("Preventas", 2, "N° Preventa", nPreCompra);
    if (check.ok) {
      filaPre = check.fila;
      cES_pre = getCol(preSheet, "Estado", 2);
      cNV_pre = getCol(preSheet, "N° Venta Asociada", 2);
      const estadoPreActual = String(preSheet.getRange(filaPre, cES_pre).getValue() || "");
      restaurarPreventa = estadoPreActual.includes("Comprado");
    }
    // Si la preventa está ANULADA o ya no existe: no se re-vincula.
  }

  // ---------- 4) ESCRITURAS SECUNDARIAS ----------
  let mensajePreventa = "";
  if (restaurarPreventa) {
    preSheet.getRange(filaPre, cES_pre).setValue("✅ Entregado");
    preSheet.getRange(filaPre, cNV_pre).setValue(numero);
    mensajePreventa = `\n🟢 Preventa "${nPreCompra}" vuelve a estado Entregado.`;
  }

  let mensajeAcc = "";
  const accSheet = ss.getSheetByName("Venta Accesorios");
  if (accSheet) {
    let colNVC = -1;
    try { colNVC = getCol(accSheet, "N° Venta Celular Asociada", 2); } catch (e) { /* opcional */ }
    if (colNVC >= 0) {
      const colEstA = asegurarColumnaEstadoRegistro_(accSheet, 2);
      const lastA = accSheet.getLastRow();
      let restaurados = 0;
      if (lastA > 2) {
        const datos = accSheet.getRange(3, 1, lastA - 2, accSheet.getLastColumn()).getValues();
        datos.forEach((row, i) => {
          if (String(row[colNVC - 1]).trim() !== numero) return;
          if (String(row[colEstA - 1] || "").trim() !== ANUL_ANULADO) return; // ya estaba activo, no contar de nuevo
          accSheet.getRange(3 + i, colEstA).setValue(ANUL_ACTIVO);
          restaurados++;
        });
      }
      if (restaurados > 0) {
        mensajeAcc = `\n📦 ${restaurados} accesorio/s asociado/s restaurado/s (incluye regalos automáticos, si los hubo).`;
        if (typeof actualizarStockAccesorios_ === "function") {
          try { actualizarStockAccesorios_(); } catch (e) { Logger.log("⚠️ actualizarStockAccesorios_ falló tras restaurar venta " + numero + ": " + e.message); }
        }
      }
    }
  }

  // ---------- 5) LIBRO DIARIO ----------
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ACTIVO);

  // ---------- 6) ESTADO DE NEGOCIO + STOCK ----------
  comprasSheet.getRange(filaCompra, colEstadoCompra).setValue("✅ Vendido");
  actualizarStock_(nOp);

  // ---------- 7) ESTADO_REGISTRO final ----------
  ventasSheet.getRange(filaVta, colEstV).setValue(ANUL_ACTIVO);

  registrarAuditoria_("VENTA", numero, "RESTAURACION", motivo || "");

  return `✅ Venta "${numero}" restaurada.\n📦 Equipo "${nOp}" vuelve a "✅ Vendido".${mensajePreventa}${mensajeAcc}\n📒 ${asientos} asiento/s de Libro Diario reactivado/s.`;
}

function _restaurarPreventa_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const preSheet = ss.getSheetByName("Preventas");
  if (!preSheet) throw new Error("❌ Hoja 'Preventas' no encontrada.");

  const fEP = 2;

  // ---------- 1) LECTURAS ----------
  const colEst = asegurarColumnaEstadoRegistro_(preSheet, fEP);
  const filaPre = _buscarFilaPorId_(preSheet, fEP, "N° Preventa", numero);
  if (filaPre === -1) throw new Error(`❌ Preventa "${numero}" no encontrada.`);

  const cES = getCol(preSheet, "Estado", fEP);
  const cNC = getCol(preSheet, "N° Compra Asociada", fEP);
  const cNV = getCol(preSheet, "N° Venta Asociada", fEP);
  const estadoRegistroActual = String(preSheet.getRange(filaPre, colEst).getValue() || "").trim();
  const nCompra = String(preSheet.getRange(filaPre, cNC).getValue() || "").trim();
  const nVenta  = String(preSheet.getRange(filaPre, cNV).getValue() || "").trim();

  // ---------- 2) VALIDACIONES ----------
  if (estadoRegistroActual !== ANUL_ANULADO) {
    throw new Error(`⚠️ La preventa "${numero}" no está anulada.`);
  }

  // ---------- 3) VERIFICACIONES CRUZADAS ----------
  // Paso 6: no restaurar si la compra o la venta que quedaron vinculadas
  // fueron anuladas (o ya no existen) mientras la preventa estaba anulada.
  if (nCompra) {
    const check = verificarIntegridadRelacionada_(cfg.HOJA_COMPRAS || "Compras", 2, "N° OP", nCompra);
    if (!check.ok) {
      throw new Error(`No se puede restaurar la preventa "${numero}": la compra asociada "${nCompra}" está anulada o ya no existe.`);
    }
  }
  if (nVenta) {
    const check = verificarIntegridadRelacionada_(cfg.HOJA_VENTAS || "Ventas", 2, "N° Venta", nVenta);
    if (!check.ok) {
      throw new Error(`No se puede restaurar la preventa "${numero}": la venta asociada "${nVenta}" está anulada o ya no existe.`);
    }
  }

  const estadoRestaurado = nVenta ? "🟢 Entregado con saldo" : nCompra ? "🟠 Comprado" : "🟡 Esperando compra";

  // ---------- 5) LIBRO DIARIO ----------
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ACTIVO);

  // ---------- 6) ESTADO DE NEGOCIO ----------
  preSheet.getRange(filaPre, cES).setValue(estadoRestaurado);

  // ---------- 7) ESTADO_REGISTRO final ----------
  preSheet.getRange(filaPre, colEst).setValue(ANUL_ACTIVO);

  registrarAuditoria_("PREVENTA", numero, "RESTAURACION", motivo || "");

  return `✅ Preventa "${numero}" restaurada a "${estadoRestaurado}".\n📒 ${asientos} asiento/s de Libro Diario reactivado/s.`;
}

function _restaurarReparacion_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const sheet = ss.getSheetByName(cfg.HOJA_REPARACIONES || "Reparaciones");
  if (!sheet) throw new Error("❌ Hoja 'Reparaciones' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Rep", numero);
  if (fila === -1) throw new Error(`❌ Reparación "${numero}" no encontrada.`);
  if (String(sheet.getRange(fila, colEst).getValue() || "").trim() !== ANUL_ANULADO) {
    throw new Error(`⚠️ La reparación "${numero}" no está anulada.`);
  }

  // Paso 9: Libro Diario antes del cambio de estado visible final.
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ACTIVO);
  sheet.getRange(fila, colEst).setValue(ANUL_ACTIVO);
  registrarAuditoria_("REPARACION", numero, "RESTAURACION", motivo || "");

  return `✅ Reparación "${numero}" restaurada.\n📒 ${asientos} asiento/s de Libro Diario reactivado/s.`;
}

function _restaurarGasto_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const sheet = ss.getSheetByName(cfg.HOJA_GASTOS || "Gastos");
  if (!sheet) throw new Error("❌ Hoja 'Gastos' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Gasto", numero);
  if (fila === -1) throw new Error(`❌ Gasto "${numero}" no encontrado.`);
  if (String(sheet.getRange(fila, colEst).getValue() || "").trim() !== ANUL_ANULADO) {
    throw new Error(`⚠️ El gasto "${numero}" no está anulado.`);
  }

  // Paso 9: Libro Diario antes del cambio de estado visible final.
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ACTIVO);
  sheet.getRange(fila, colEst).setValue(ANUL_ACTIVO);
  registrarAuditoria_("GASTO", numero, "RESTAURACION", motivo || "");

  return `✅ Gasto "${numero}" restaurado.\n📒 ${asientos} asiento/s de Libro Diario reactivado/s.`;
}

/** Inverso de _anularCambioMoneda_() — sin dependencias cruzadas, mismo patrón simple que GASTO/REPARACION. */
function _restaurarCambioMoneda_(numero, motivo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CAMBIO_MONEDA");
  if (!sheet) throw new Error("❌ Hoja 'CAMBIO_MONEDA' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Cambio", numero);
  if (fila === -1) throw new Error(`❌ Cambio de moneda "${numero}" no encontrado.`);
  if (String(sheet.getRange(fila, colEst).getValue() || "").trim() !== ANUL_ANULADO) {
    throw new Error(`⚠️ El cambio de moneda "${numero}" no está anulado.`);
  }

  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ACTIVO);
  sheet.getRange(fila, colEst).setValue(ANUL_ACTIVO);
  registrarAuditoria_("CAMBIO_MONEDA", numero, "RESTAURACION", motivo || "");

  return `✅ Cambio de moneda "${numero}" restaurado.\n📒 ${asientos} asiento/s de Libro Diario reactivado/s.`;
}

/** Inverso de _anularAjusteCaja_() — sin dependencias cruzadas. */
function _restaurarAjusteCaja_(numero, motivo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("AJUSTES_CAJA");
  if (!sheet) throw new Error("❌ Hoja 'AJUSTES_CAJA' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Ajuste", numero);
  if (fila === -1) throw new Error(`❌ Ajuste de caja "${numero}" no encontrado.`);
  if (String(sheet.getRange(fila, colEst).getValue() || "").trim() !== ANUL_ANULADO) {
    throw new Error(`⚠️ El ajuste de caja "${numero}" no está anulado.`);
  }

  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ACTIVO);
  sheet.getRange(fila, colEst).setValue(ANUL_ACTIVO);
  registrarAuditoria_("AJUSTE_CAJA", numero, "RESTAURACION", motivo || "");

  return `✅ Ajuste de caja "${numero}" restaurado.\n📒 ${asientos} asiento/s de Libro Diario reactivado/s.`;
}

/** Inverso de _anularDevolucion_() — sin dependencias cruzadas, mismo patrón simple que GASTO/AJUSTE_CAJA. */
function _restaurarDevolucion_(numero, motivo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Devoluciones");
  if (!sheet) throw new Error("❌ Hoja 'Devoluciones' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Devolución", numero);
  if (fila === -1) throw new Error(`❌ Devolución "${numero}" no encontrada.`);
  if (String(sheet.getRange(fila, colEst).getValue() || "").trim() !== ANUL_ANULADO) {
    throw new Error(`⚠️ La devolución "${numero}" no está anulada.`);
  }

  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ACTIVO);
  sheet.getRange(fila, colEst).setValue(ANUL_ACTIVO);
  registrarAuditoria_("DEVOLUCION", numero, "RESTAURACION", motivo || "");

  return `✅ Devolución "${numero}" restaurada.\n📒 ${asientos} asiento/s de Libro Diario reactivado/s.`;
}

function _restaurarAccesorio_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Venta Accesorios");
  if (!sheet) throw new Error("❌ Hoja 'Venta Accesorios' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Venta Accesorio", numero);
  if (fila === -1) throw new Error(`❌ Accesorio "${numero}" no encontrado.`);
  if (String(sheet.getRange(fila, colEst).getValue() || "").trim() !== ANUL_ANULADO) {
    throw new Error(`⚠️ El accesorio "${numero}" no está anulado.`);
  }

  let advertencia = "";
  let colNVC = -1;
  try { colNVC = getCol(sheet, "N° Venta Celular Asociada", fE); } catch (e) { /* opcional */ }
  if (colNVC >= 0) {
    const nVta = String(sheet.getRange(fila, colNVC).getValue() || "").trim();
    if (nVta) {
      const ventasSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfigCached().HOJA_VENTAS || "Ventas");
      if (ventasSheet) {
        const filaVta = _buscarFilaPorId_(ventasSheet, 2, "N° Venta", nVta);
        if (filaVta !== -1) {
          const colEstV = asegurarColumnaEstadoRegistro_(ventasSheet, 2);
          if (String(ventasSheet.getRange(filaVta, colEstV).getValue() || "").trim() === ANUL_ANULADO) {
            advertencia = `\n⚠️ La venta "${nVta}" asociada sigue anulada.`;
          }
        }
      }
    }
  }

  // Paso 9: Libro Diario antes del cambio de estado visible final.
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ACTIVO);
  sheet.getRange(fila, colEst).setValue(ANUL_ACTIVO);
  registrarAuditoria_("VENTA_ACCESORIO", numero, "RESTAURACION", motivo || "");

  if (typeof actualizarStockAccesorios_ === "function") {
    try { actualizarStockAccesorios_(); } catch (e) { Logger.log("⚠️ actualizarStockAccesorios_ falló tras restaurar " + numero + ": " + e.message); }
  }

  return `✅ Accesorio "${numero}" restaurado.\n📒 ${asientos} asiento/s de Libro Diario reactivado/s.${advertencia}`;
}

/** Inverso de _anularCompraAccesorio_() — misma lógica multilínea (marca TODAS las filas del N° Compra Accesorio). */
function _restaurarCompraAccesorio_(numero, motivo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Compras Accesorios");
  if (!sheet) throw new Error("❌ Hoja 'Compras Accesorios' no encontrada.");

  const fE = 2;
  const colEst = asegurarColumnaEstadoRegistro_(sheet, fE);
  const colNum = getCol(sheet, "N° Compra Accesorio", fE);
  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) throw new Error(`❌ Compra de accesorios "${numero}" no encontrada.`);

  const numTrim = String(numero).trim();
  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  const filasARestaurar = [];
  datos.forEach((row, i) => { if (String(row[colNum - 1] || "").trim() === numTrim) filasARestaurar.push(fE + 1 + i); });
  if (filasARestaurar.length === 0) throw new Error(`❌ Compra de accesorios "${numero}" no encontrada.`);

  const algunaActiva = filasARestaurar.some(f => String(sheet.getRange(f, colEst).getValue() || "").trim() !== ANUL_ANULADO);
  if (algunaActiva) throw new Error(`⚠️ La compra de accesorios "${numero}" no está anulada.`);

  // Paso 9: Libro Diario antes del cambio de estado visible final.
  const asientos = marcarLibroDiarioPorOperacion_(numero, ANUL_ACTIVO);
  filasARestaurar.forEach(f => sheet.getRange(f, colEst).setValue(ANUL_ACTIVO));
  registrarAuditoria_("COMPRA_ACCESORIO", numero, "RESTAURACION", motivo || "");

  if (typeof actualizarStockAccesorios_ === "function") {
    try { actualizarStockAccesorios_(); } catch (e) { Logger.log("⚠️ actualizarStockAccesorios_ falló tras restaurar " + numero + ": " + e.message); }
  }

  return `✅ Compra de accesorios "${numero}" restaurada (${filasARestaurar.length} línea/s).\n📒 ${asientos} asiento/s de Libro Diario reactivado/s.`;
}

function _restaurarInversor_(numero, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const invSheet = ss.getSheetByName(cfg.HOJA_INVERSORES || "Inversores");
  if (!invSheet) throw new Error("❌ Hoja 'Inversores' no encontrada.");

  const encontrado = _buscarMovimientoInversor_(invSheet, numero);
  if (!encontrado) throw new Error(`❌ No encontré el movimiento "${numero}".`);

  const colEst = encontrado.hdrs.findIndex(h => String(h).trim() === "ESTADO_REGISTRO") + 1;
  if (String(invSheet.getRange(encontrado.fila, colEst).getValue() || "").trim() !== ANUL_ANULADO) {
    throw new Error(`⚠️ El movimiento "${numero}" no está anulado.`);
  }

  invSheet.getRange(encontrado.fila, colEst).setValue(ANUL_ACTIVO);
  registrarAuditoria_("INVERSOR", numero, "RESTAURACION",
    (motivo || "") + " | ⚠️ Revisar manualmente el asiento correspondiente en Libro Diario.");

  return `✅ Movimiento "${numero}" restaurado.\n⚠️ Revisá manualmente el asiento asociado en Libro Diario.`;
}


// ============================================================
//  7. DISPATCHERS
// ============================================================

/**
 * PASO 8 (auditoría de riesgos, Prioridad 1): sin LockService, dos
 * anulaciones/restauraciones concurrentes (dos usuarios, o un usuario y un
 * disparador) pueden interlear lecturas y escrituras sobre la misma
 * Compra/Preventa/Venta. Se serializa con un lock de script de hasta 30s;
 * si no se puede obtener, se informa en vez de dejar avanzar una carrera.
 */
/**
 * PASO 4 (auditoría de riesgos, Prioridad 2): además del lock, cada
 * anulación/restauración queda registrada en la hoja TRANSACCIONES con un
 * UUID propio, ANTES de tocar ningún dato (crearTransaccion_ hace flush()
 * inmediato) y se cierra con OK/ERROR al terminar. Si Apps Script corta la
 * ejecución a mitad de camino (timeout, cuota), la fila con Estado=INICIO
 * queda como evidencia — buscarTransaccionesIncompletas_() la detecta.
 */
function procesarAnularOperacion(numero, motivo) {
  // mis_operaciones.html ya exige un motivo no vacío antes de enviar —
  // revalidado acá para que el backend no dependa exclusivamente de esa
  // pantalla (_ejecutarCorreccion_(), operadores.gs, siempre manda
  // "Corrección: <motivo>", así que nunca queda vacío en ese camino).
  if (!String(motivo || "").trim()) throw new Error("❌ Ingresá un motivo para la anulación.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    throw new Error("❌ El sistema está procesando otra anulación/restauración. Probá de nuevo en unos segundos.");
  }

  let tx = null;
  try {
    const info = detectarTipoOperacion_(numero);
    tx = crearTransaccion_(info.tipo, numero, "ANULACION");
    guardarBackupOperacion_(info.tipo, numero, "ANULACION"); // PASO 3: backup ANTES de validar/mutar nada

    let resultado;
    switch (info.prefijo) {
      case "CMP": resultado = _anularCompra_(numero, motivo); break;
      case "VTA": resultado = _anularVenta_(numero, motivo); break;
      case "PRE": resultado = _anularPreventa_(numero, motivo); break;
      case "REP": resultado = _anularReparacion_(numero, motivo); break;
      case "GST": resultado = _anularGasto_(numero, motivo); break;
      case "ACC": resultado = _anularAccesorio_(numero, motivo); break;
      case "CAC": resultado = _anularCompraAccesorio_(numero, motivo); break;
      case "CAM": resultado = _anularCambioMoneda_(numero, motivo); break;
      case "AJC": resultado = _anularAjusteCaja_(numero, motivo); break;
      case "INV": resultado = _anularInversor_(numero, motivo); break;
      case "DEV": resultado = _anularDevolucion_(numero, motivo); break;
    }

    cerrarTransaccion_(tx, "OK");
    return resultado;
  } catch (e) {
    if (tx) cerrarTransaccion_(tx, "ERROR", e);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function procesarRestaurarOperacion(numero, motivo) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    throw new Error("❌ El sistema está procesando otra anulación/restauración. Probá de nuevo en unos segundos.");
  }

  let tx = null;
  try {
    const info = detectarTipoOperacion_(numero);
    tx = crearTransaccion_(info.tipo, numero, "RESTAURACION");
    guardarBackupOperacion_(info.tipo, numero, "RESTAURACION"); // PASO 3: backup ANTES de validar/mutar nada

    let resultado;
    switch (info.prefijo) {
      case "CMP": resultado = _restaurarCompra_(numero, motivo); break;
      case "VTA": resultado = _restaurarVenta_(numero, motivo); break;
      case "PRE": resultado = _restaurarPreventa_(numero, motivo); break;
      case "REP": resultado = _restaurarReparacion_(numero, motivo); break;
      case "GST": resultado = _restaurarGasto_(numero, motivo); break;
      case "ACC": resultado = _restaurarAccesorio_(numero, motivo); break;
      case "CAC": resultado = _restaurarCompraAccesorio_(numero, motivo); break;
      case "CAM": resultado = _restaurarCambioMoneda_(numero, motivo); break;
      case "AJC": resultado = _restaurarAjusteCaja_(numero, motivo); break;
      case "INV": resultado = _restaurarInversor_(numero, motivo); break;
      case "DEV": resultado = _restaurarDevolucion_(numero, motivo); break;
    }

    cerrarTransaccion_(tx, "OK");
    return resultado;
  } catch (e) {
    if (tx) cerrarTransaccion_(tx, "ERROR", e);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/** Llamadas por el diálogo HTML tras la confirmación del usuario. */
function confirmarAnulacion(numero, motivo) {
  return procesarAnularOperacion(numero, motivo);
}
function confirmarRestauracion(numero, motivo) {
  return procesarRestaurarOperacion(numero, motivo);
}


// ============================================================
//  8. UI — anularOperacion() / restaurarOperacion() (Paso 3, Paso 11)
// ============================================================

function anularOperacion() {
  _mostrarDialogoAnulacion_("ANULAR");
}

function restaurarOperacion() {
  _mostrarDialogoAnulacion_("RESTAURAR");
}

function _mostrarDialogoAnulacion_(accion) {
  const esAnular = accion === "ANULAR";
  const titulo = esAnular ? "🗑️ Anular Operación" : "♻️ Restaurar Operación";
  const color  = esAnular ? "#922B21" : "#1E8449";
  const verbo  = esAnular ? "anular" : "restaurar";
  const funcResumen = esAnular ? "obtenerResumenAnulacion" : "obtenerResumenRestauracion";
  const funcConfirmar = esAnular ? "confirmarAnulacion" : "confirmarRestauracion";

  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:18px;font-size:13px}
    label{display:block;margin-top:10px;font-weight:bold;color:${color}}
    input,textarea{width:100%;padding:8px;margin-top:4px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;font-family:inherit}
    textarea{min-height:55px;resize:vertical}
    .btn{background:${color};color:#fff;padding:10px 20px;border:none;border-radius:4px;cursor:pointer;margin-top:14px;width:100%;font-size:13px}
    .btn:hover{opacity:.9}
    .btn-secundario{background:#888}
    .resumen{background:#F8F9FA;border:1px solid #dee2e6;border-radius:6px;padding:14px;margin-top:14px;display:none}
    .resumen h4{margin:0 0 8px;color:${color}}
    .resumen .fila{margin:4px 0}
    .impactos span{display:inline-block;background:#EAFAF1;color:#196F3D;border-radius:4px;padding:2px 8px;margin:2px 4px 2px 0;font-size:11px}
    .advertencia{background:#FEF9E7;border-left:4px solid #B7950B;padding:10px;margin-top:10px;border-radius:4px;font-size:12px;white-space:pre-line}
  </style>
  <h3 style="color:${color};margin:0 0 14px">${titulo}</h3>

  <div id="paso1">
    <label>N° de operación:</label>
    <input type="text" id="numero" placeholder="Ej: VTA-034, CMP-012, PRE-005..."/>
    <div style="font-size:11px;color:#666;margin-top:4px">Prefijos válidos: CMP, VTA, PRE, REP, GST, ACC, CAC, CAM, AJC, INV</div>
    <button class="btn" onclick="buscar()">🔍 Buscar</button>
  </div>

  <div id="paso2" class="resumen">
    <h4>OPERACIÓN ENCONTRADA</h4>
    <div class="fila"><b>Tipo:</b> <span id="r_tipo"></span></div>
    <div class="fila"><b>Número:</b> <span id="r_numero"></span></div>
    <div class="fila"><b>Cliente / Referencia:</b> <span id="r_cliente"></span></div>
    <div class="fila"><b>Detalle:</b> <span id="r_detalle"></span></div>
    <div class="fila"><b>Importe:</b> <span id="r_importe"></span></div>
    <div class="fila impactos"><b>Impactos:</b><br><span id="r_impactos"></span></div>
    <div class="advertencia" id="r_advertencia" style="display:none"></div>

    <label>Motivo / Observaciones (queda en AUDITORIA):</label>
    <textarea id="motivo" placeholder="Ej: Error de carga"></textarea>

    <button class="btn" onclick="confirmarAccion()">✅ Confirmar ${esAnular ? "anulación" : "restauración"}</button>
    <button class="btn btn-secundario" onclick="volver()">← Buscar otra operación</button>
  </div>

  <script>
    function fmtP(n){ return "$" + Number(n || 0).toLocaleString("es-AR"); }

    function buscar(){
      const numero = document.getElementById("numero").value.trim().toUpperCase();
      if (!numero) { alert("❌ Ingresá un número de operación."); return; }
      google.script.run
        .withSuccessHandler(mostrarResumen)
        .withFailureHandler(e => alert("❌ " + e.message))
        .${funcResumen}(numero);
    }

    function mostrarResumen(r){
      document.getElementById("r_tipo").textContent = r.tipo;
      document.getElementById("r_numero").textContent = r.numero;
      document.getElementById("r_cliente").textContent = r.cliente;
      document.getElementById("r_detalle").textContent = r.detalle;
      document.getElementById("r_importe").textContent = fmtP(r.importe);
      document.getElementById("r_impactos").innerHTML =
        r.impactos.map(i => "<span>✓ " + i + "</span>").join("");
      const advDiv = document.getElementById("r_advertencia");
      if (r.advertencia) { advDiv.style.display = "block"; advDiv.textContent = "⚠️ " + r.advertencia; }
      else { advDiv.style.display = "none"; }
      document.getElementById("paso1").style.display = "none";
      document.getElementById("paso2").style.display = "block";
      document.getElementById("paso2").dataset.numero = r.numero;
    }

    function volver(){
      document.getElementById("paso1").style.display = "block";
      document.getElementById("paso2").style.display = "none";
    }

    function confirmarAccion(){
      const numero = document.getElementById("paso2").dataset.numero;
      const motivo = document.getElementById("motivo").value.trim();
      if (!confirm("¿Desea ${verbo} la operación " + numero + "?")) return;
      google.script.run
        .withSuccessHandler(m => { alert(m); google.script.host.close(); })
        .withFailureHandler(e => alert("❌ " + e.message))
        .${funcConfirmar}(numero, motivo);
    }
  </script>
  `).setWidth(480).setHeight(660).setTitle(titulo);
  SpreadsheetApp.getUi().showModalDialog(html, titulo);
}


// ============================================================
//  9. DIAGNÓSTICO DE OPERACIÓN (Paso 6) — solo lectura, no corrige nada
// ============================================================

/** Lee ESTADO_REGISTRO + fila + encabezados de un registro en una hoja de tabla simple. */
function _leerEstadoRegistroDe_(nombreHoja, filaEnc, colId, numero) {
  if (!numero) return { existe: false, estadoRegistro: "", fila: -1, sheet: null, hdrs: null };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
  if (!sheet) return { existe: false, estadoRegistro: "", fila: -1, sheet: null, hdrs: null };
  const fila = _buscarFilaPorId_(sheet, filaEnc, colId, numero);
  if (fila === -1) return { existe: false, estadoRegistro: "", fila: -1, sheet: sheet, hdrs: null };
  const colEst = asegurarColumnaEstadoRegistro_(sheet, filaEnc);
  const estadoRegistro = String(sheet.getRange(fila, colEst).getValue() || "").trim() || ANUL_ACTIVO;
  const hdrs = sheet.getRange(filaEnc, 1, 1, sheet.getLastColumn()).getValues()[0];
  return { existe: true, estadoRegistro: estadoRegistro, fila: fila, sheet: sheet, hdrs: hdrs };
}

function _valorDeFila_(info, nombreCol) {
  if (!info.existe) return "";
  const c = info.hdrs.findIndex(h => String(h).trim() === nombreCol);
  return c === -1 ? "" : info.sheet.getRange(info.fila, c + 1).getValue();
}

/** Cuenta asientos de Libro Diario asociados a `numero` (por ID_OPERACION o REFERENCIA), separados por ACTIVO/ANULADO. */
function _contarLibroDiarioPorOperacion_(numero) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const libro = ss.getSheetByName("Libro Diario");
  const resumen = { total: 0, activos: 0, anulados: 0 };
  if (!libro) return resumen;

  const fE = 2;
  const colOp  = getCol(libro, "ID_OPERACION", fE);
  const colRef = getCol(libro, "REFERENCIA",   fE);
  const colEst = asegurarColumnaEstadoRegistro_(libro, fE);
  const lastRow = libro.getLastRow();
  if (lastRow <= fE) return resumen;

  const datos = libro.getRange(fE + 1, 1, lastRow - fE, libro.getLastColumn()).getValues();
  const numeroTrim = String(numero).trim();
  datos.forEach(row => {
    const op  = String(row[colOp  - 1] || "").trim();
    const ref = String(row[colRef - 1] || "").trim();
    if (op === numeroTrim || ref === numeroTrim) {
      resumen.total++;
      const est = String(row[colEst - 1] || "").trim();
      if (est === ANUL_ANULADO) resumen.anulados++; else resumen.activos++;
    }
  });
  return resumen;
}

/**
 * diagnosticarOperacion_(numero)  — PASO 6
 *
 * Reconstruye el estado real de una operación y de todo lo que tiene
 * relacionado (compra/venta/preventa/accesorio según el tipo), comparando
 * SIEMPRE ESTADO_REGISTRO (nunca el texto de negocio "Estado") y detecta
 * combinaciones imposibles (p.ej. venta activa sobre compra anulada). Es
 * de SOLO LECTURA: no corrige nada, solo informa para decidir si hace
 * falta una restauración/anulación manual complementaria.
 */
function diagnosticarOperacion_(numero) {
  const info = detectarTipoOperacion_(numero);
  const cfg = getConfigCached();
  const inconsistencias = [];
  const relaciones = [];

  let principal, libro, estadoNegocioPrincipal = "";

  if (info.prefijo === "INV") {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const invSheet = ss.getSheetByName(cfg.HOJA_INVERSORES || "Inversores");
    const encontrado = invSheet ? _buscarMovimientoInversor_(invSheet, numero) : null;
    if (!encontrado) {
      principal = { existe: false, estadoRegistro: "" };
    } else {
      const colEst = encontrado.hdrs.findIndex(h => String(h).trim() === "ESTADO_REGISTRO") + 1;
      const estReg = String(invSheet.getRange(encontrado.fila, colEst).getValue() || "").trim() || ANUL_ACTIVO;
      principal = { existe: true, estadoRegistro: estReg };
      estadoNegocioPrincipal = `Inversor: ${encontrado.tabla.inversor}`;
    }
    libro = { total: 0, activos: 0, anulados: 0 };
    inconsistencias.push("Los movimientos de Inversores no se pueden conciliar automáticamente contra Libro Diario (se registran allí por nombre de inversor, no por N° de movimiento) — revisar manualmente.");
  } else {
    principal = _leerEstadoRegistroDe_(info.hoja, 2, info.colId, numero);
    estadoNegocioPrincipal = String(_valorDeFila_(principal, "Estado") || "");
    libro = _contarLibroDiarioPorOperacion_(numero);

    if (!principal.existe) {
      inconsistencias.push(`No se encontró "${numero}" en "${info.hoja}".`);
    } else {
      if (principal.estadoRegistro === ANUL_ANULADO && libro.activos > 0) {
        inconsistencias.push(`${info.tipo} anulada pero tiene ${libro.activos} asiento/s ACTIVO/s en Libro Diario (posible fallo parcial).`);
      }
      if (principal.estadoRegistro !== ANUL_ANULADO && libro.total > 0 && libro.activos === 0) {
        inconsistencias.push(`${info.tipo} activa pero TODOS sus asientos de Libro Diario están anulados (posible fallo parcial).`);
      }
    }

    if (info.prefijo === "CMP" && principal.existe) {
      const nPre = String(_valorDeFila_(principal, "N° Preventa Asociada") || "").trim();
      if (nPre) {
        const pre = _leerEstadoRegistroDe_("Preventas", 2, "N° Preventa", nPre);
        relaciones.push({ etiqueta: "PREVENTA", numero: nPre, estadoRegistro: pre.existe ? pre.estadoRegistro : "NO EXISTE" });
        if (principal.estadoRegistro !== ANUL_ANULADO && pre.existe && pre.estadoRegistro === ANUL_ANULADO && estadoNegocioPrincipal.includes("Reservado Preventa")) {
          inconsistencias.push("Compra activa y reservada para una preventa que está anulada (stock huérfano).");
        }
      }
      if (estadoNegocioPrincipal.includes("Vendido")) {
        const ventasSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg.HOJA_VENTAS || "Ventas");
        let existeVentaActiva = false;
        if (ventasSheet) {
          const fEV = 2;
          const cNOP = getCol(ventasSheet, "N° OP Compra", fEV);
          const cEstV = asegurarColumnaEstadoRegistro_(ventasSheet, fEV);
          const lastV = ventasSheet.getLastRow();
          if (lastV > fEV) {
            const datosV = ventasSheet.getRange(fEV + 1, 1, lastV - fEV, ventasSheet.getLastColumn()).getValues();
            existeVentaActiva = datosV.some(row =>
              String(row[cNOP - 1]).trim() === String(numero).trim() &&
              String(row[cEstV - 1] || "").trim() !== ANUL_ANULADO
            );
          }
        }
        if (!existeVentaActiva) {
          inconsistencias.push('Compra marcada "✅ Vendido" pero no se encontró ninguna venta activa asociada.');
        }
      }
    }

    if (info.prefijo === "VTA" && principal.existe) {
      const nOp = String(_valorDeFila_(principal, "N° OP Compra") || "").trim();
      let nPreDeLaCompra = "";
      if (nOp) {
        const compra = _leerEstadoRegistroDe_(cfg.HOJA_COMPRAS || "Compras", 2, "N° OP", nOp);
        relaciones.push({ etiqueta: "COMPRA", numero: nOp, estadoRegistro: compra.existe ? compra.estadoRegistro : "NO EXISTE" });
        if (!compra.existe) {
          inconsistencias.push(`La compra asociada "${nOp}" no existe.`);
        } else if (principal.estadoRegistro !== ANUL_ANULADO && compra.estadoRegistro === ANUL_ANULADO) {
          inconsistencias.push("Venta activa sobre compra anulada.");
        }
        nPreDeLaCompra = String(_valorDeFila_(compra, "N° Preventa Asociada") || "").trim();
      }
      if (nPreDeLaCompra) {
        const pre = _leerEstadoRegistroDe_("Preventas", 2, "N° Preventa", nPreDeLaCompra);
        relaciones.push({ etiqueta: "PREVENTA", numero: nPreDeLaCompra, estadoRegistro: pre.existe ? pre.estadoRegistro : "NO EXISTE" });
        if (principal.estadoRegistro !== ANUL_ANULADO && pre.existe && pre.estadoRegistro === ANUL_ANULADO) {
          inconsistencias.push("Venta activa asociada a una preventa anulada.");
        }
      }
    }

    if (info.prefijo === "PRE" && principal.existe) {
      const nCompra = String(_valorDeFila_(principal, "N° Compra Asociada") || "").trim();
      const nVenta  = String(_valorDeFila_(principal, "N° Venta Asociada")   || "").trim();
      if (nCompra) {
        const compra = _leerEstadoRegistroDe_(cfg.HOJA_COMPRAS || "Compras", 2, "N° OP", nCompra);
        relaciones.push({ etiqueta: "COMPRA", numero: nCompra, estadoRegistro: compra.existe ? compra.estadoRegistro : "NO EXISTE" });
        if (!compra.existe) inconsistencias.push(`La compra asociada "${nCompra}" no existe (referencia rota).`);
      }
      if (nVenta) {
        const venta = _leerEstadoRegistroDe_(cfg.HOJA_VENTAS || "Ventas", 2, "N° Venta", nVenta);
        relaciones.push({ etiqueta: "VENTA", numero: nVenta, estadoRegistro: venta.existe ? venta.estadoRegistro : "NO EXISTE" });
        if (!venta.existe) inconsistencias.push(`La venta asociada "${nVenta}" no existe (referencia rota).`);
      }
      if (estadoNegocioPrincipal.includes("Comprado") && !nCompra) {
        inconsistencias.push('Estado "🟠 Comprado" pero no tiene N° Compra Asociada.');
      }
      if (!estadoNegocioPrincipal.includes("Comprado") && !estadoNegocioPrincipal.includes("Entregado") && nCompra) {
        inconsistencias.push(`Tiene N° Compra Asociada ("${nCompra}") pero el Estado no lo refleja ("${estadoNegocioPrincipal}").`);
      }
    }

    if (info.prefijo === "ACC" && principal.existe) {
      const nVta = String(_valorDeFila_(principal, "N° Venta Celular Asociada") || "").trim();
      if (nVta) {
        const venta = _leerEstadoRegistroDe_(cfg.HOJA_VENTAS || "Ventas", 2, "N° Venta", nVta);
        relaciones.push({ etiqueta: "VENTA", numero: nVta, estadoRegistro: venta.existe ? venta.estadoRegistro : "NO EXISTE" });
        if (principal.estadoRegistro !== ANUL_ANULADO && venta.existe && venta.estadoRegistro === ANUL_ANULADO) {
          inconsistencias.push("Accesorio activo asociado a una venta anulada.");
        }
      }
    }
  }

  return {
    numero: numero,
    tipo: info.tipo,
    principal: { existe: principal.existe, estadoRegistro: principal.existe ? principal.estadoRegistro : "NO EXISTE", estadoNegocio: estadoNegocioPrincipal },
    libro: libro,
    relaciones: relaciones,
    inconsistencias: inconsistencias
  };
}

/** Formatea el resultado de diagnosticarOperacion_() como texto legible (para alert/diálogo). */
function _formatearDiagnostico_(d) {
  const lineas = [];
  lineas.push(`${d.numero} (${d.tipo})`);
  lineas.push("");
  lineas.push(`REGISTRO PRINCIPAL: ${d.principal.existe ? d.principal.estadoRegistro : "NO EXISTE"}${d.principal.estadoNegocio ? " — " + d.principal.estadoNegocio : ""}`);
  lineas.push(`LIBRO DIARIO: ${d.libro.total} asiento/s (${d.libro.activos} activo/s, ${d.libro.anulados} anulado/s)`);
  d.relaciones.forEach(r => {
    lineas.push(`${r.etiqueta}: ${r.numero} → ${r.estadoRegistro}`);
  });
  lineas.push("");
  if (d.inconsistencias.length === 0) {
    lineas.push("✅ Sin inconsistencias detectadas.");
  } else {
    lineas.push("⚠️ INCONSISTENCIAS:");
    d.inconsistencias.forEach(i => lineas.push("• " + i));
  }
  return lineas.join("\n");
}

/** UI del menú: pide el N° de operación y muestra el diagnóstico. Solo lectura. */
function diagnosticarOperacion() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    "🔍 Diagnosticar Operación",
    "Ingresá el N° de operación (CMP-xxx, VTA-xxx, PRE-xxx, REP-xxx, GST-xxx, ACC-xxx, INV-xxx):",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const numero = resp.getResponseText().trim().toUpperCase();
  if (!numero) { ui.alert("❌ Ingresá un número de operación."); return; }

  try {
    const diag = diagnosticarOperacion_(numero);
    ui.alert(`🔍 Diagnóstico — ${numero}`, _formatearDiagnostico_(diag), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("❌ " + e.message);
  }
}

/** UI del menú: lista las transacciones que no cerraron con Estado=OK. */
function buscarTransaccionesIncompletasUI() {
  const ui = SpreadsheetApp.getUi();
  const incompletas = buscarTransaccionesIncompletas_();
  if (incompletas.length === 0) {
    ui.alert("✅ Transacciones", "No hay transacciones incompletas.\nTodas las anulaciones/restauraciones registradas terminaron con Estado = OK.", ui.ButtonSet.OK);
    return;
  }
  const tz = Session.getScriptTimeZone();
  const lineas = incompletas.map(t =>
    `${t.numero} (${t.operacion}/${t.accion}) — ${t.estado}` +
    (t.detalle ? `\n  Detalle: ${t.detalle}` : "") +
    `\n  UUID: ${t.uuid}\n  Fecha: ${Utilities.formatDate(new Date(t.fecha), tz, "dd/MM/yyyy HH:mm:ss")}`
  );
  ui.alert(
    `⚠️ ${incompletas.length} transacción/es incompleta/s`,
    lineas.join("\n\n") + "\n\nRecomendación: corré \"Diagnosticar operación\" con cada N° de operación listado arriba.",
    ui.ButtonSet.OK
  );
}


// ============================================================
//  10. HEALTH CHECK ERP (Pasos 7 y 8) — solo lectura, registra en SALUD_ERP
// ============================================================

/** Crea (si no existe) la hoja SALUD_ERP con sus encabezados. Nunca la borra ni la reescribe si ya existe. */
function asegurarHojaSaludErp_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName("SALUD_ERP");
  if (hoja) return hoja;

  hoja = ss.insertSheet("SALUD_ERP");
  hoja.getRange(1, 1).setValue("🩺 SALUD_ERP — resultados de ejecutarHealthCheckERP_()");
  const encabezados = ["Fecha", "Problema", "Gravedad", "Operación", "Descripción"];
  hoja.getRange(1, 1, 1, encabezados.length).merge().setFontWeight("bold").setBackground("#1A252F").setFontColor("#FFFFFF");
  hoja.getRange(2, 1, 1, encabezados.length).setValues([encabezados])
    .setFontWeight("bold").setBackground("#1A5276").setFontColor("#FFFFFF");
  hoja.setFrozenRows(2);
  hoja.setColumnWidth(1, 130);
  hoja.setColumnWidth(2, 240);
  hoja.setColumnWidth(3, 100);
  hoja.setColumnWidth(4, 110);
  hoja.setColumnWidth(5, 440);
  return hoja;
}

const SALUD_COLORES_ = { INFO: "#EBF5FB", WARNING: "#FEF9E7", ERROR: "#FDEBD0", CRITICAL: "#FADBD8" };

/** Agrega una fila a SALUD_ERP (nunca borra corridas anteriores — permite ver evolución en el tiempo). */
function registrarProblemaSalud_(problema, gravedad, operacion, descripcion) {
  const hoja = asegurarHojaSaludErp_();
  const fE = 2;
  const fila = getFilaVacia(hoja, 1, fE + 1);
  hoja.getRange(fila, 1, 1, 5).setValues([[new Date(), problema, gravedad, operacion || "", descripcion || ""]]);
  hoja.getRange(fila, 1).setNumberFormat("dd/mm/yyyy hh:mm");
  hoja.getRange(fila, 1, 1, 5).setBackground(SALUD_COLORES_[gravedad] || "#FFFFFF");
}

/** Compras: activas con preventa anulada (stock huérfano) + vendidas sin venta activa asociada. */
function _healthCheckCompras_() {
  const problemas = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const comprasSheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  const ventasSheet  = ss.getSheetByName(cfg.HOJA_VENTAS  || "Ventas");
  if (!comprasSheet) return problemas;

  const fE = 2;
  const cOP  = getCol(comprasSheet, "N° OP", fE);
  const cEst = getCol(comprasSheet, "Estado", fE);
  const cEstReg = asegurarColumnaEstadoRegistro_(comprasSheet, fE);
  let cNPC = -1;
  try { cNPC = getCol(comprasSheet, "N° Preventa Asociada", fE); } catch (e) { /* opcional */ }

  const lastC = comprasSheet.getLastRow();
  if (lastC <= fE) return problemas;
  const datosC = comprasSheet.getRange(fE + 1, 1, lastC - fE, comprasSheet.getLastColumn()).getValues();

  const opsConVentaActiva = new Set();
  if (ventasSheet) {
    const fEV = 2;
    const cNOP = getCol(ventasSheet, "N° OP Compra", fEV);
    const cEstV = asegurarColumnaEstadoRegistro_(ventasSheet, fEV);
    const lastV = ventasSheet.getLastRow();
    if (lastV > fEV) {
      ventasSheet.getRange(fEV + 1, 1, lastV - fEV, ventasSheet.getLastColumn()).getValues().forEach(row => {
        if (String(row[cEstV - 1] || "").trim() !== ANUL_ANULADO) opsConVentaActiva.add(String(row[cNOP - 1]).trim());
      });
    }
  }

  const preSheet = ss.getSheetByName("Preventas");
  const estadoPorPreventa = {};
  if (preSheet) {
    const fEP = 2;
    const cNP = getCol(preSheet, "N° Preventa", fEP);
    const cEstRegP = asegurarColumnaEstadoRegistro_(preSheet, fEP);
    const lastP = preSheet.getLastRow();
    if (lastP > fEP) {
      preSheet.getRange(fEP + 1, 1, lastP - fEP, preSheet.getLastColumn()).getValues().forEach(row => {
        estadoPorPreventa[String(row[cNP - 1]).trim()] = String(row[cEstRegP - 1] || "").trim() || ANUL_ACTIVO;
      });
    }
  }

  datosC.forEach(row => {
    const nOp = String(row[cOP - 1]).trim();
    if (!nOp) return;
    const estadoRegistro = String(row[cEstReg - 1] || "").trim() || ANUL_ACTIVO;
    const estadoTexto = String(row[cEst - 1] || "");
    const nPre = cNPC >= 0 ? String(row[cNPC - 1] || "").trim() : "";

    if (estadoRegistro !== ANUL_ANULADO && nPre && estadoPorPreventa[nPre] === ANUL_ANULADO) {
      problemas.push({
        problema: "COMPRA_CON_PREVENTA_ANULADA", gravedad: "ERROR", operacion: nOp,
        descripcion: `Compra activa (Estado "${estadoTexto}") reservada para la preventa "${nPre}", que está ANULADA. Stock huérfano.`
      });
    }
    if (estadoRegistro !== ANUL_ANULADO && estadoTexto.includes("Vendido") && !opsConVentaActiva.has(nOp)) {
      problemas.push({
        problema: "COMPRA_VENDIDA_SIN_VENTA", gravedad: "CRITICAL", operacion: nOp,
        descripcion: `Compra marcada "${estadoTexto}" pero no existe ninguna venta activa con N° OP Compra = "${nOp}".`
      });
    }
  });

  return problemas;
}

/** Ventas: activas sobre compra anulada/inexistente, o con preventa anulada. */
function _healthCheckVentas_() {
  const problemas = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const ventasSheet  = ss.getSheetByName(cfg.HOJA_VENTAS  || "Ventas");
  const comprasSheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  if (!ventasSheet) return problemas;

  const fEV = 2;
  const cNV  = getCol(ventasSheet, "N° Venta", fEV);
  const cNOP = getCol(ventasSheet, "N° OP Compra", fEV);
  const cEstRegV = asegurarColumnaEstadoRegistro_(ventasSheet, fEV);

  const lastV = ventasSheet.getLastRow();
  if (lastV <= fEV) return problemas;
  const datosV = ventasSheet.getRange(fEV + 1, 1, lastV - fEV, ventasSheet.getLastColumn()).getValues();

  const infoPorCompra = {};
  if (comprasSheet) {
    const fEC = 2;
    const cOP = getCol(comprasSheet, "N° OP", fEC);
    const cEstRegC = asegurarColumnaEstadoRegistro_(comprasSheet, fEC);
    let cNPC = -1;
    try { cNPC = getCol(comprasSheet, "N° Preventa Asociada", fEC); } catch (e) { /* opcional */ }
    const lastC = comprasSheet.getLastRow();
    if (lastC > fEC) {
      comprasSheet.getRange(fEC + 1, 1, lastC - fEC, comprasSheet.getLastColumn()).getValues().forEach(row => {
        infoPorCompra[String(row[cOP - 1]).trim()] = {
          estadoRegistro: String(row[cEstRegC - 1] || "").trim() || ANUL_ACTIVO,
          nPreventa: cNPC >= 0 ? String(row[cNPC - 1] || "").trim() : ""
        };
      });
    }
  }
  const preSheet = ss.getSheetByName("Preventas");
  const estadoPorPreventa = {};
  if (preSheet) {
    const fEP = 2;
    const cNP = getCol(preSheet, "N° Preventa", fEP);
    const cEstRegP = asegurarColumnaEstadoRegistro_(preSheet, fEP);
    const lastP = preSheet.getLastRow();
    if (lastP > fEP) {
      preSheet.getRange(fEP + 1, 1, lastP - fEP, preSheet.getLastColumn()).getValues().forEach(row => {
        estadoPorPreventa[String(row[cNP - 1]).trim()] = String(row[cEstRegP - 1] || "").trim() || ANUL_ACTIVO;
      });
    }
  }

  datosV.forEach(row => {
    const nVta = String(row[cNV - 1]).trim();
    if (!nVta) return;
    const estadoRegistro = String(row[cEstRegV - 1] || "").trim() || ANUL_ACTIVO;
    if (estadoRegistro === ANUL_ANULADO) return; // solo interesa auditar ventas activas
    const nOp = String(row[cNOP - 1]).trim();
    const compra = infoPorCompra[nOp];

    if (!compra) {
      problemas.push({
        problema: "VENTA_SIN_COMPRA", gravedad: "CRITICAL", operacion: nVta,
        descripcion: `Venta activa cuya compra asociada "${nOp}" no existe.`
      });
      return;
    }
    if (compra.estadoRegistro === ANUL_ANULADO) {
      problemas.push({
        problema: "VENTA_SOBRE_COMPRA_ANULADA", gravedad: "CRITICAL", operacion: nVta,
        descripcion: `Venta activa sobre la compra "${nOp}", que está ANULADA.`
      });
    }
    if (compra.nPreventa && estadoPorPreventa[compra.nPreventa] === ANUL_ANULADO) {
      problemas.push({
        problema: "VENTA_CON_PREVENTA_ANULADA", gravedad: "ERROR", operacion: nVta,
        descripcion: `Venta activa asociada (vía la compra "${nOp}") a la preventa "${compra.nPreventa}", que está ANULADA.`
      });
    }
  });

  return problemas;
}

/** Preventas: compra/venta inexistente (referencia rota) + estados inconsistentes. */
function _healthCheckPreventas_() {
  const problemas = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const preSheet = ss.getSheetByName("Preventas");
  if (!preSheet) return problemas;

  const fEP = 2;
  const cNP  = getCol(preSheet, "N° Preventa", fEP);
  const cEst = getCol(preSheet, "Estado", fEP);
  const cNC  = getCol(preSheet, "N° Compra Asociada", fEP);
  const cNV  = getCol(preSheet, "N° Venta Asociada", fEP);
  const cEstRegP = asegurarColumnaEstadoRegistro_(preSheet, fEP);

  const lastP = preSheet.getLastRow();
  if (lastP <= fEP) return problemas;
  const datosP = preSheet.getRange(fEP + 1, 1, lastP - fEP, preSheet.getLastColumn()).getValues();

  const comprasSheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  const ventasSheet  = ss.getSheetByName(cfg.HOJA_VENTAS  || "Ventas");
  const opsExistentes = new Set();
  if (comprasSheet) {
    const fEC = 2;
    const cOP = getCol(comprasSheet, "N° OP", fEC);
    const lastC = comprasSheet.getLastRow();
    if (lastC > fEC) {
      comprasSheet.getRange(fEC + 1, cOP, lastC - fEC, 1).getValues().forEach(r => { if (r[0]) opsExistentes.add(String(r[0]).trim()); });
    }
  }
  const vtasExistentes = new Set();
  if (ventasSheet) {
    const fEV = 2;
    const cNV2 = getCol(ventasSheet, "N° Venta", fEV);
    const lastV = ventasSheet.getLastRow();
    if (lastV > fEV) {
      ventasSheet.getRange(fEV + 1, cNV2, lastV - fEV, 1).getValues().forEach(r => { if (r[0]) vtasExistentes.add(String(r[0]).trim()); });
    }
  }

  datosP.forEach(row => {
    const nPre = String(row[cNP - 1]).trim();
    if (!nPre) return;
    const estadoRegistro = String(row[cEstRegP - 1] || "").trim() || ANUL_ACTIVO;
    if (estadoRegistro === ANUL_ANULADO) return;
    const estadoTexto = String(row[cEst - 1] || "");
    const nCompra = String(row[cNC - 1] || "").trim();
    const nVenta  = String(row[cNV - 1] || "").trim();

    if (nCompra && !opsExistentes.has(nCompra)) {
      problemas.push({
        problema: "PREVENTA_COMPRA_INEXISTENTE", gravedad: "CRITICAL", operacion: nPre,
        descripcion: `La preventa referencia la compra "${nCompra}", que no existe en Compras.`
      });
    }
    if (nVenta && !vtasExistentes.has(nVenta)) {
      problemas.push({
        problema: "PREVENTA_VENTA_INEXISTENTE", gravedad: "CRITICAL", operacion: nPre,
        descripcion: `La preventa referencia la venta "${nVenta}", que no existe en Ventas.`
      });
    }
    if (estadoTexto.includes("Comprado") && !nCompra) {
      problemas.push({
        problema: "PREVENTA_ESTADO_INCONSISTENTE", gravedad: "WARNING", operacion: nPre,
        descripcion: `Estado "${estadoTexto}" sin N° Compra Asociada.`
      });
    }
    if (!estadoTexto.includes("Comprado") && !estadoTexto.includes("Entregado") && nCompra) {
      problemas.push({
        problema: "PREVENTA_ESTADO_INCONSISTENTE", gravedad: "WARNING", operacion: nPre,
        descripcion: `Tiene N° Compra Asociada ("${nCompra}") pero el Estado es "${estadoTexto}".`
      });
    }
    if (estadoTexto.includes("Entregado") && !nVenta) {
      problemas.push({
        problema: "PREVENTA_ESTADO_INCONSISTENTE", gravedad: "WARNING", operacion: nPre,
        descripcion: `Estado "${estadoTexto}" sin N° Venta Asociada.`
      });
    }
  });

  return problemas;
}

/** Libro Diario: referencias huérfanas + operaciones anuladas con asientos todavía activos (fallo parcial). */
function _healthCheckLibroDiario_() {
  const problemas = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const libro = ss.getSheetByName("Libro Diario");
  if (!libro) return problemas;

  const fE = 2;
  const colOrig = getCol(libro, "ORIGEN", fE);
  const colOp   = getCol(libro, "ID_OPERACION", fE);
  const colEstReg = asegurarColumnaEstadoRegistro_(libro, fE);
  const lastRow = libro.getLastRow();
  if (lastRow <= fE) return problemas;

  const datos = libro.getRange(fE + 1, 1, lastRow - fE, libro.getLastColumn()).getValues();

  const origenAPrefijo = {
    COMPRA: "CMP", VENTA: "VTA", PREVENTA: "PRE", PREVENTA_SALDO: "PRE",
    REPARACION: "REP", GASTO: "GST", VENTA_ACCESORIO: "ACC", COMPRA_ACCESORIO: "CAC",
    CAMBIO_MONEDA: "CAM", AJUSTE_CAJA: "AJC"
  };
  const mapa = obtenerMapaTiposAnulacion_();
  const cache = {};
  function estadoDe(prefijo, numero) {
    const key = prefijo + "|" + numero;
    if (key in cache) return cache[key];
    const info = mapa[prefijo];
    const res = _leerEstadoRegistroDe_(info.hoja, 2, info.colId, numero);
    cache[key] = res.existe ? res.estadoRegistro : null; // null = no existe
    return cache[key];
  }

  datos.forEach(row => {
    const origen = String(row[colOrig - 1] || "").trim();
    const idOp = String(row[colOp - 1] || "").trim();
    const prefijo = origenAPrefijo[origen];
    if (!prefijo || !idOp) return; // fuera de alcance (movimientos manuales, inversores, etc.)

    const estadoRel = estadoDe(prefijo, idOp);
    const estadoAsiento = String(row[colEstReg - 1] || "").trim() || ANUL_ACTIVO;

    if (estadoRel === null) {
      problemas.push({
        problema: "LIBRO_REFERENCIA_HUERFANA", gravedad: "ERROR", operacion: idOp,
        descripcion: `Asiento de Libro Diario (origen "${origen}") referencia "${idOp}", que no existe en su hoja de origen.`
      });
      return;
    }
    if (estadoRel === ANUL_ANULADO && estadoAsiento !== ANUL_ANULADO) {
      problemas.push({
        problema: "LIBRO_ASIENTO_ACTIVO_SOBRE_ANULADA", gravedad: "ERROR", operacion: idOp,
        descripcion: `"${idOp}" está ANULADA pero tiene un asiento de Libro Diario todavía ACTIVO (posible fallo parcial de anulación).`
      });
    }
  });

  return problemas;
}

/** Inversores: movimientos anulados que no se pueden conciliar automáticamente contra Libro Diario (limitación conocida). */
function _healthCheckInversores_() {
  const problemas = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const invSheet = ss.getSheetByName(cfg.HOJA_INVERSORES || "Inversores");
  if (!invSheet) return problemas;

  const tablas = _mapearPanelesInversores_(invSheet);
  tablas.forEach(t => {
    const hdrs = invSheet.getRange(t.filaEncSub, 1, 1, invSheet.getLastColumn()).getValues()[0];
    const colEst = hdrs.findIndex(h => String(h).trim() === "ESTADO_REGISTRO") + 1;
    const colNum = hdrs.findIndex(h => String(h).trim() === "N° Movimiento") + 1;
    if (colEst === 0) return;
    const filaDatosDesde = t.filaEncSub + 1;
    if (filaDatosDesde > t.filaFinDatos) return;

    for (let f = filaDatosDesde; f <= t.filaFinDatos; f++) {
      const tieneFecha = invSheet.getRange(f, 1).getValue();
      if (!tieneFecha) continue;
      const est = String(invSheet.getRange(f, colEst).getValue() || "").trim();
      if (est === ANUL_ANULADO) {
        const num = colNum > 0 ? String(invSheet.getRange(f, colNum).getValue() || "(sin numerar)") : "(sin numerar)";
        problemas.push({
          problema: "INVERSOR_MOVIMIENTO_SIN_CONCILIAR", gravedad: "WARNING", operacion: String(num),
          descripcion: `Movimiento de "${t.inversor}" (${t.tipoTabla}) anulado en la hoja Inversores, pero su asiento en Libro Diario no puede conciliarse automáticamente (limitación conocida) — verificar manualmente.`
        });
      }
    }
  });

  return problemas;
}

/** Cambios de moneda: detecta filas donde Monto ARS ya no coincide con Monto USD × Cotización (edición manual posterior a la celda, corrupción de datos). Tolerancia $1, mismo criterio que las validaciones de reconciliación del sistema. */
function _healthCheckCambioMoneda_() {
  const problemas = [];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CAMBIO_MONEDA");
  if (!sheet) return problemas;

  const fE = 2;
  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return problemas;

  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
  const cNum = idx("N° Cambio"), cUSD = idx("Monto USD"), cCOT = idx("Cotización"), cARS = idx("Monto ARS");
  const colEstReg = asegurarColumnaEstadoRegistro_(sheet, fE);
  if (cNum === -1 || cUSD === -1 || cCOT === -1 || cARS === -1) return problemas;

  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  datos.forEach(row => {
    if (String(row[colEstReg - 1] || "").trim() === ANUL_ANULADO) return;
    const numero = String(row[cNum] || "");
    const montoUSD = Number(row[cUSD]) || 0;
    const cotizacion = Number(row[cCOT]) || 0;
    const montoARS = Number(row[cARS]) || 0;
    const esperado = montoUSD * cotizacion;
    if (Math.abs(esperado - montoARS) > 1) {
      problemas.push({
        problema: "CAMBIO_MONEDA_DESCUADRADO", gravedad: "ERROR", operacion: numero,
        descripcion: `"${numero}": Monto USD (${montoUSD}) × Cotización (${cotizacion}) = ${esperado.toFixed(2)}, pero Monto ARS guardado es ${montoARS} — probable edición manual posterior de la celda.`
      });
    }
  });

  return problemas;
}

/**
 * ejecutarHealthCheckERP_()  — PASO 7 / PASO 8
 *
 * Recorre Compras/Ventas/Preventas/Libro Diario/Inversores buscando
 * inconsistencias (referencias rotas, estados contradictorios, fallos
 * parciales de anulación) y registra CADA hallazgo como una fila nueva en
 * SALUD_ERP (nunca borra corridas anteriores — permite ver evolución en el
 * tiempo). Es de SOLO LECTURA sobre los datos de negocio: no corrige nada.
 * Devuelve { total, porGravedad:{INFO,WARNING,ERROR,CRITICAL}, problemas:[...] }.
 */
function ejecutarHealthCheckERP_() {
  const problemas = []
    .concat(_healthCheckCompras_())
    .concat(_healthCheckVentas_())
    .concat(_healthCheckPreventas_())
    .concat(_healthCheckLibroDiario_())
    .concat(_healthCheckInversores_())
    .concat(_healthCheckCambioMoneda_());

  const porGravedad = { INFO: 0, WARNING: 0, ERROR: 0, CRITICAL: 0 };
  problemas.forEach(p => {
    registrarProblemaSalud_(p.problema, p.gravedad, p.operacion, p.descripcion);
    porGravedad[p.gravedad] = (porGravedad[p.gravedad] || 0) + 1;
  });

  registrarProblemaSalud_(
    "HEALTH_CHECK_EJECUTADO", "INFO", "",
    `Health check completo: ${problemas.length} problema/s encontrado/s ` +
    `(CRITICAL: ${porGravedad.CRITICAL}, ERROR: ${porGravedad.ERROR}, WARNING: ${porGravedad.WARNING}, INFO: ${porGravedad.INFO}).`
  );

  // Cada corrida (manual o por el trigger diario) deja actualizada la
  // única fila de ESTADO_ERP con la foto más reciente.
  actualizarEstadoErp_();

  return { total: problemas.length, porGravedad: porGravedad, problemas: problemas };
}

/** UI del menú: corre ejecutarHealthCheckERP_() y muestra un resumen. */
function ejecutarHealthCheckERPManual() {
  const ui = SpreadsheetApp.getUi();
  const resultado = ejecutarHealthCheckERP_();
  if (resultado.total === 0) {
    ui.alert("✅ Health Check ERP", "No se encontraron inconsistencias.\nSe registró la corrida en SALUD_ERP.", ui.ButtonSet.OK);
    return;
  }
  const resumen =
    `${resultado.total} problema/s encontrado/s:\n\n` +
    `CRITICAL: ${resultado.porGravedad.CRITICAL}\n` +
    `ERROR: ${resultado.porGravedad.ERROR}\n` +
    `WARNING: ${resultado.porGravedad.WARNING}\n` +
    `INFO: ${resultado.porGravedad.INFO}\n\n` +
    `Detalle completo en la hoja SALUD_ERP.`;
  ui.alert("🩺 Health Check ERP", resumen, ui.ButtonSet.OK);
}


// ============================================================
//  11. HEALTH CHECK AUTOMÁTICO DIARIO (Paso 6)
// ============================================================

/**
 * instalarTriggerHealthCheck_()
 *
 * 1) Elimina cualquier trigger anterior que ya apunte a
 *    ejecutarHealthCheckERP_() (evita duplicados si se corre más de una vez).
 * 2) Crea un trigger diario nuevo que llama a ejecutarHealthCheckERP_()
 *    ~03:00 AM (Apps Script no garantiza el minuto exacto, corre dentro de
 *    esa franja horaria — se usa nearMinute(0) para acercarlo lo más posible).
 *
 * Devuelve { eliminados, instalado }.
 */
function instalarTriggerHealthCheck_() {
  const triggers = ScriptApp.getProjectTriggers();
  let eliminados = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "ejecutarHealthCheckERP_") {
      ScriptApp.deleteTrigger(t);
      eliminados++;
    }
  });

  ScriptApp.newTrigger("ejecutarHealthCheckERP_")
    .timeBased()
    .atHour(3)
    .nearMinute(0)
    .everyDays(1)
    .create();

  return { eliminados: eliminados, instalado: true };
}

/** UI del menú: instala/reinstala el trigger diario y confirma el resultado. */
function instalarTriggerHealthCheckManual() {
  const ui = SpreadsheetApp.getUi();
  try {
    const resultado = instalarTriggerHealthCheck_();
    ui.alert(
      "⏰ Health Check automático instalado",
      `Se eliminaron ${resultado.eliminados} trigger/s anterior/es duplicado/s.\n` +
      `Trigger diario instalado: ejecutarHealthCheckERP_() ~03:00 AM.\n\n` +
      `(Apps Script no garantiza el minuto exacto; corre dentro de esa franja horaria.)`,
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert("❌ " + e.message);
  }
}


// ============================================================
//  12. ESTADO_ERP — foto de una sola fila del estado general (Pasos 7, 8)
// ============================================================

/** Crea (si no existe) la hoja ESTADO_ERP con sus encabezados. Nunca la borra ni la reescribe si ya existe. */
function asegurarHojaEstadoErp_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName("ESTADO_ERP");
  if (hoja) return hoja;

  hoja = ss.insertSheet("ESTADO_ERP");
  hoja.getRange(1, 1).setValue("🟢 ESTADO_ERP — foto del estado general (una sola fila, se sobrescribe en cada corrida)");
  const encabezados = ["Fecha", "Estado", "Errores", "Warnings", "TransaccionesPendientes"];
  hoja.getRange(1, 1, 1, encabezados.length).merge().setFontWeight("bold").setBackground("#1A252F").setFontColor("#FFFFFF");
  hoja.getRange(2, 1, 1, encabezados.length).setValues([encabezados])
    .setFontWeight("bold").setBackground("#1A5276").setFontColor("#FFFFFF");
  hoja.setFrozenRows(2);
  hoja.setColumnWidth(1, 150);
  hoja.setColumnWidth(2, 110);
  hoja.setColumnWidth(3, 90);
  hoja.setColumnWidth(4, 90);
  hoja.setColumnWidth(5, 190);
  return hoja;
}

/**
 * _obtenerProblemasUltimoHealthCheck_()
 *
 * Lee SALUD_ERP (que es append-only, acumula histórico de todas las
 * corridas) y devuelve SOLO los problemas de la corrida MÁS RECIENTE,
 * delimitada por las filas marcador "HEALTH_CHECK_EJECUTADO" que
 * ejecutarHealthCheckERP_() escribe al final de cada corrida.
 */
function _obtenerProblemasUltimoHealthCheck_() {
  const hoja = asegurarHojaSaludErp_();
  const fE = 2;
  const lastRow = hoja.getLastRow();
  if (lastRow <= fE) return [];

  const datos = hoja.getRange(fE + 1, 1, lastRow - fE, 5).getValues();
  const marcadores = [];
  datos.forEach((row, i) => { if (String(row[1]) === "HEALTH_CHECK_EJECUTADO") marcadores.push(i); });
  if (marcadores.length === 0) return [];

  const finBlock = marcadores[marcadores.length - 1];
  const inicioBlock = marcadores.length > 1 ? marcadores[marcadores.length - 2] + 1 : 0;

  return datos.slice(inicioBlock, finBlock).map(row => ({
    fecha: row[0], problema: row[1], gravedad: row[2], operacion: row[3], descripcion: row[4]
  }));
}

/**
 * verEstadoERP_()  — PASO 7
 *
 * Resumen de solo lectura del estado general del sistema, combinando:
 *   - transacciones incompletas (en vivo, desde TRANSACCIONES)
 *   - los problemas de la ÚLTIMA corrida de ejecutarHealthCheckERP_()
 *     registrada en SALUD_ERP (no vuelve a correr el health check completo
 *     cada vez que se llama — sería costoso; usá "Ejecutar health check"
 *     para forzar una corrida nueva).
 * erroresCriticos agrupa gravedad CRITICAL + ERROR (el esquema pedido no
 * distingue un cuarto balde para "ERROR no crítico").
 */
function verEstadoERP_() {
  const problemas = _obtenerProblemasUltimoHealthCheck_();
  const contarPorCodigo = (codigos) => problemas.filter(p => codigos.includes(p.problema)).length;

  return {
    transaccionesIncompletas: buscarTransaccionesIncompletas_().length,
    erroresCriticos: problemas.filter(p => p.gravedad === "CRITICAL" || p.gravedad === "ERROR").length,
    warnings: problemas.filter(p => p.gravedad === "WARNING").length,
    stockHuerfano: contarPorCodigo(["COMPRA_CON_PREVENTA_ANULADA"]),
    preventasRotas: contarPorCodigo(["PREVENTA_COMPRA_INEXISTENTE", "PREVENTA_VENTA_INEXISTENTE", "PREVENTA_ESTADO_INCONSISTENTE"]),
    ventasInvalidas: contarPorCodigo(["VENTA_SIN_COMPRA", "VENTA_SOBRE_COMPRA_ANULADA", "VENTA_CON_PREVENTA_ANULADA", "COMPRA_VENDIDA_SIN_VENTA"]),
    libroDescuadrado: contarPorCodigo(["LIBRO_REFERENCIA_HUERFANA", "LIBRO_ASIENTO_ACTIVO_SOBRE_ANULADA"]),
    inversoresPendientes: contarPorCodigo(["INVERSOR_MOVIMIENTO_SIN_CONCILIAR"])
  };
}

/**
 * actualizarEstadoErp_()
 *
 * Recalcula el estado general (a partir de la última corrida de health
 * check + transacciones incompletas EN VIVO) y sobrescribe la ÚNICA fila
 * de datos de ESTADO_ERP (fila 3) — a diferencia de AUDITORIA/
 * TRANSACCIONES/SALUD_ERP, esta hoja NO acumula histórico, siempre
 * muestra la foto más reciente. Devuelve el texto de Estado (OK/WARNING/
 * ERROR/CRITICAL).
 */
function actualizarEstadoErp_() {
  const hoja = asegurarHojaEstadoErp_();
  const problemas = _obtenerProblemasUltimoHealthCheck_();
  const transaccionesIncompletas = buscarTransaccionesIncompletas_().length;

  const nCritical = problemas.filter(p => p.gravedad === "CRITICAL").length;
  const nError    = problemas.filter(p => p.gravedad === "ERROR").length;
  const nWarning  = problemas.filter(p => p.gravedad === "WARNING").length;

  let estadoTexto;
  if (nCritical > 0) estadoTexto = "CRITICAL";
  else if (nError > 0) estadoTexto = "ERROR";
  else if (nWarning > 0 || transaccionesIncompletas > 0) estadoTexto = "WARNING";
  else estadoTexto = "OK";

  const fila = 3;
  hoja.getRange(fila, 1, 1, 5).setValues([[
    new Date(), estadoTexto, nCritical + nError, nWarning, transaccionesIncompletas
  ]]);
  hoja.getRange(fila, 1).setNumberFormat("dd/mm/yyyy hh:mm");
  const colores = { OK: "#D5F5E3", WARNING: "#FEF9E7", ERROR: "#FDEBD0", CRITICAL: "#FADBD8" };
  hoja.getRange(fila, 1, 1, 5).setBackground(colores[estadoTexto] || "#FFFFFF");

  return estadoTexto;
}

/** UI del menú: refresca ESTADO_ERP y muestra el resumen completo de verEstadoERP_(). */
function verEstadoERPManual() {
  const ui = SpreadsheetApp.getUi();
  const estadoTexto = actualizarEstadoErp_();
  const estado = verEstadoERP_();

  const resumen =
    `Estado general: ${estadoTexto}\n\n` +
    `Transacciones incompletas: ${estado.transaccionesIncompletas}\n` +
    `Errores críticos: ${estado.erroresCriticos}\n` +
    `Warnings: ${estado.warnings}\n\n` +
    `Stock huérfano: ${estado.stockHuerfano}\n` +
    `Preventas rotas: ${estado.preventasRotas}\n` +
    `Ventas inválidas: ${estado.ventasInvalidas}\n` +
    `Libro descuadrado: ${estado.libroDescuadrado}\n` +
    `Inversores pendientes: ${estado.inversoresPendientes}\n\n` +
    `(Basado en la última corrida de Health Check en SALUD_ERP. Si nunca corriste uno, va a estar todo en 0 — corré "Ejecutar health check" primero.)`;

  ui.alert(`🟢 Estado del ERP: ${estadoTexto}`, resumen, ui.ButtonSet.OK);
}
