// ============================================================
//  OPERADORES — trazabilidad de qué operador (Martin/Maca/Sam/Eva)
//  cargó cada operación en la Web App.
//
//  Este archivo es 100% NUEVO y NO modifica Code.gs, webapp.gs ni
//  anulaciones.gs. No hay login/usuarios/contraseñas ni operador
//  "actual" global: cada formulario (y cada acción de Mis Operaciones —
//  Anular/Corregir) trae su propio selector obligatorio y manda ese
//  valor puntual como d.operador en cada envío. No se persiste en
//  localStorage: varias personas comparten el mismo navegador/local.
//
//  Estrategia (elegida explícitamente para no tocar funciones
//  protegidas): las funciones "...ConOperador" de abajo LLAMAN a la
//  función protegida existente tal cual (procesarCompra, procesarVenta,
//  procesarPreventa, procesarEntregaPreventa, procesarReparacion,
//  procesarGasto) sin modificarla, y después hacen una escritura
//  puntual — solo en la columna OPERADOR — sobre la fila que esa
//  función ya creó. La Web App llama a estos wrappers en vez de a las
//  funciones protegidas directamente.
// ============================================================

const OPERADORES_VALIDOS = ["Martin", "Maca", "Sam", "Eva", "Buda"];

// ------------------------------------------------------------
//  Helpers de columna OPERADOR (agregado automático si falta)
// ------------------------------------------------------------

/** Devuelve el índice 1-based de `nombreCol` en la fila `filaEnc` de `hoja`; la crea al final de los encabezados si no existe. */
function asegurarColumnaGenerica_(hoja, filaEnc, nombreCol) {
  const anchoActual = Math.max(hoja.getLastColumn(), 1);
  const headers = hoja.getRange(filaEnc, 1, 1, anchoActual).getValues()[0];
  const idx = headers.findIndex(h => String(h).trim() === nombreCol);
  if (idx >= 0) return idx + 1;
  const nuevaCol = anchoActual + 1;
  hoja.getRange(filaEnc, nuevaCol).setValue(nombreCol).setFontWeight("bold");
  return nuevaCol;
}

/** Busca `valorId` en la columna `nombreColId` de la hoja `nombreHoja` y escribe `operador` en su columna OPERADOR (la crea si falta). */
function _tagOperadorPorId_(nombreHoja, filaEnc, nombreColId, valorId, operador) {
  if (!operador || !valorId) return false;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
  if (!sheet) return false;

  let colId;
  try { colId = getCol(sheet, nombreColId, filaEnc); } catch (e) { return false; }

  const lastRow = sheet.getLastRow();
  if (lastRow <= filaEnc) return false;

  const ids = sheet.getRange(filaEnc + 1, colId, lastRow - filaEnc, 1).getValues();
  const valorTrim = String(valorId).trim();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || "").trim() === valorTrim) {
      const colOperador = asegurarColumnaGenerica_(sheet, filaEnc, "OPERADOR");
      sheet.getRange(filaEnc + 1 + i, colOperador).setValue(operador);
      // FECHA_CREACION: se completa una sola vez (guardia de valor vacío) para
      // no pisar el momento real de creación en re-etiquetados posteriores
      // (p.ej. procesarEntregaPreventaConOperador re-tagueando la Preventa).
      const colFechaCreacion = asegurarColumnaGenerica_(sheet, filaEnc, "FECHA_CREACION");
      const celdaFecha = sheet.getRange(filaEnc + 1 + i, colFechaCreacion);
      if (!celdaFecha.getValue()) {
        celdaFecha.setValue(new Date());
        celdaFecha.setNumberFormat("dd/mm/yyyy hh:mm:ss");
      }
      return true;
    }
  }
  return false;
}

/** Corrige REGISTRADO_POR con el operador real (validado por dropdown) en las filas de Libro Diario asociadas a `numero`. libroLog() escribe REGISTRADO_POR al crear el asiento con el dato que le pase cada módulo (a veces "Vendedor" en texto libre, a veces fallback "Martin"); este re-etiquetado corre siempre después, dentro de la misma ejecución, y deja el valor definitivo antes de que la operación termine. */
function _tagOperadorLibroDiario_(numero, operador) {
  if (!operador || !numero) return 0;
  const libro = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Libro Diario");
  if (!libro) return 0;

  const fE = 2;
  let colOp, colRef, colReg;
  try {
    colOp  = getCol(libro, "ID_OPERACION",   fE);
    colRef = getCol(libro, "REFERENCIA",     fE);
    colReg = getCol(libro, "REGISTRADO_POR", fE);
  } catch (e) { return 0; }

  const lastRow = libro.getLastRow();
  if (lastRow <= fE) return 0;

  const datos = libro.getRange(fE + 1, 1, lastRow - fE, libro.getLastColumn()).getValues();
  const numTrim = String(numero).trim();
  let marcadas = 0;
  datos.forEach((row, i) => {
    const op  = String(row[colOp  - 1] || "").trim();
    const ref = String(row[colRef - 1] || "").trim();
    if (op === numTrim || ref === numTrim) {
      libro.getRange(fE + 1 + i, colReg).setValue(operador);
      marcadas++;
    }
  });
  return marcadas;
}

/** Marca OPERADOR en las filas de "Venta Accesorios" asociadas a la venta de celular `nVta` (columna "N° Venta Celular Asociada") y corrige, reutilizando _tagOperadorLibroDiario_(), el asiento de Libro Diario propio de cada uno de esos accesorios (registrarAccesorioAsociado_() lo crea con el "Vendedor" de texto libre, igual que la venta principal). */
function _tagOperadorAccesoriosPorVenta_(nVta, operador) {
  if (!operador || !nVta) return 0;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Venta Accesorios");
  if (!sheet) return 0;

  const fE = 2;
  let colAsoc, colNV;
  try {
    colAsoc = getCol(sheet, "N° Venta Celular Asociada", fE);
    colNV   = getCol(sheet, "N° Venta Accesorio",         fE);
  } catch (e) { return 0; }

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return 0;

  const datosAsoc = sheet.getRange(fE + 1, colAsoc, lastRow - fE, 1).getValues();
  const datosNV   = sheet.getRange(fE + 1, colNV,   lastRow - fE, 1).getValues();
  const nVtaTrim = String(nVta).trim();
  let colOperador = -1, marcadas = 0;
  datosAsoc.forEach((row, i) => {
    if (String(row[0] || "").trim() === nVtaTrim) {
      if (colOperador === -1) colOperador = asegurarColumnaGenerica_(sheet, fE, "OPERADOR");
      sheet.getRange(fE + 1 + i, colOperador).setValue(operador);
      const nAcc = String(datosNV[i][0] || "").trim();
      if (nAcc) _tagOperadorLibroDiario_(nAcc, operador);
      marcadas++;
    }
  });
  return marcadas;
}

function _extraerNumero_(mensaje, patron) {
  const m = String(mensaje || "").match(patron);
  return m ? m[1].trim() : "";
}

/** A partir de un número con prefijo conocido (CMP/VTA/PRE/REP/GST/ACC), etiqueta OPERADOR en su hoja de negocio + Libro Diario (+ Ventas Accesorios si es una venta). Reutiliza obtenerMapaTiposAnulacion_() de anulaciones.gs (solo lectura, no se modifica). */
function _tagOperadorPorNumero_(numero, operador) {
  if (!operador || !numero) return;
  const prefijo = String(numero).trim().split("-")[0].toUpperCase();
  const mapa = obtenerMapaTiposAnulacion_();
  const info = mapa[prefijo];
  if (!info) return;
  _tagOperadorPorId_(info.hoja, 2, info.colId, numero, operador);
  _tagOperadorLibroDiario_(numero, operador);
  if (prefijo === "VTA") _tagOperadorAccesoriosPorVenta_(numero, operador);
}

// ------------------------------------------------------------
//  Wrappers — la Web App llama a estas funciones, no a las protegidas.
// ------------------------------------------------------------

function procesarCompraConOperador(d) {
  const msg = procesarCompra(d);
  const nOp = _extraerNumero_(msg, /N° OP:\s*(\S+)/);
  if (nOp) _tagOperadorPorNumero_(nOp, d.operador);
  return msg;
}

// ------------------------------------------------------------
//  COMPRAS — reparación interna del equipo (antes de ponerlo a la venta).
//  "¿Necesita Reparación?" = Sí (compras.html) deja el equipo en
//  🔧 En Reparación / 🟣 Preventa + Reparación (procesarCompra, Code.gs),
//  pero hasta ahora no existía forma de volverlo a 📦 En Stock /
//  🔵 Reservado Preventa una vez terminada esa reparación — ni desde
//  Sheets ni desde la Web App, así que el equipo quedaba invisible para
//  la venta para siempre. Misma prioridad de estados que ya usa
//  procesarCompra()/_anularVenta_ (Code.gs, anulaciones.gs): "Preventa +
//  Reparación" pasa a "Reservado Preventa"; "En Reparación" pasa a
//  "En Stock".
// ------------------------------------------------------------

/** d = { nOp, operador, obs (opcional) } */
function marcarEquipoReparado(d) {
  const nOp      = String((d && d.nOp)      || "").trim();
  const operador = (d && d.operador) || "";
  if (!nOp) throw new Error("❌ Falta el N° de compra/equipo.");

  const cfg = getConfigCached();
  const hojaCompras = cfg.HOJA_COMPRAS || "Compras";
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(hojaCompras);
  if (!sheet) throw new Error(`❌ Hoja '${hojaCompras}' no encontrada.`);

  const fE = 2;
  const fila = _buscarFilaPorId_(sheet, fE, "N° OP", nOp);
  if (fila === -1) throw new Error(`❌ Equipo "${nOp}" no encontrado.`);

  const cES = getCol(sheet, "Estado", fE);
  const estadoAnterior = String(sheet.getRange(fila, cES).getValue() || "").trim();
  if (estadoAnterior !== "🔧 En Reparación" && estadoAnterior !== "🟣 Preventa + Reparación") {
    throw new Error(`❌ "${nOp}" no está en reparación (estado actual: "${estadoAnterior}").`);
  }

  const nuevoEstado = (estadoAnterior === "🟣 Preventa + Reparación") ? "🔵 Reservado Preventa" : "📦 En Stock";
  sheet.getRange(fila, cES).setValue(nuevoEstado);

  const cRep = getCol(sheet, "¿Necesita Reparación?", fE);
  sheet.getRange(fila, cRep).setValue("No");

  if (d && d.obs) {
    const cOB = getCol(sheet, "Observaciones", fE);
    const obsActual = sheet.getRange(fila, cOB).getValue();
    sheet.getRange(fila, cOB).setValue(obsActual ? obsActual + " | " + d.obs : d.obs);
  }

  actualizarStock_(nOp); // función protegida, solo se LLAMA (no se modifica)

  registrarAuditoria_("COMPRA", nOp, "REPARACION_INTERNA_FINALIZADA",
    `${estadoAnterior} → ${nuevoEstado} (registrado por: ${operador || "—"}).`);

  return `✅ Equipo listo para la venta.\nN° OP: ${nOp}\nNuevo estado: ${nuevoEstado}`;
}

function procesarVentaConOperador(d) {
  const msg = procesarVenta(d);
  const nVta = _extraerNumero_(msg, /N° Venta:\s*(\S+)/);
  if (nVta) _tagOperadorPorNumero_(nVta, d.operador);
  const modelo = _obtenerModeloDeCompra_(d.nOp);
  return msg + _entregarRegalosSiCorresponde_(nVta, modelo, d.cliente, d.operador, d.operador, d.entregarRegalos);
}

/** Regalos automáticos (CONFIG_REGALOS): se llama SOLO desde estos wrappers, nunca desde procesarVenta()/procesarEntregaPreventa() (protegidas). Si algo falla acá, no debe tumbar la venta ya registrada — por eso el try/catch. */
function _entregarRegalosSiCorresponde_(nVta, modelo, cliente, vendedor, operador, entregarRegalos) {
  if (!nVta || !modelo) return "";
  try {
    const resultado = entregarRegalosAutomaticos_(nVta, modelo, cliente, vendedor, operador, entregarRegalos !== false);
    let extra = "";
    if (resultado.entregados.length > 0) extra += `\n🎁 Regalo/s entregado/s: ${resultado.entregados.join(", ")}`;
    if (resultado.omitidos.length   > 0) extra += `\n⚠ No hay stock del regalo: ${resultado.omitidos.join(", ")}`;
    return extra;
  } catch (e) {
    return `\n⚠️ Regalos automáticos no procesados: ${e.message}`;
  }
}

/**
 * Plazo de entrega (7 a 10 días hábiles): calcularRangoEntregaPreventa()
 * (dias_habiles.gs, sin modificar) sigue siendo la fuente del plazo
 * sugerido — se usa como default cuando el operador no cargó fechaDesde/
 * fechaHasta. Pero el operador puede modificarlas a mano (Parte 1): si
 * `d` ya trae ambas, se respetan tal cual, solo se valida que sean fechas
 * válidas y que Desde no sea posterior a Hasta. procesarPreventa()
 * (protegida, sin modificar) recibe siempre las fechas ya resueltas.
 */
function procesarPreventaConOperador(d) {
  const rango = calcularRangoEntregaPreventa(d.fecha);
  if (!d.fechaDesde) d.fechaDesde = rango.fechaMinima;
  if (!d.fechaHasta) d.fechaHasta = rango.fechaMaxima;

  const fDesde = parseDate(d.fechaDesde);
  const fHasta = parseDate(d.fechaHasta);
  if (!fDesde || isNaN(fDesde.getTime()) || !fHasta || isNaN(fHasta.getTime())) {
    throw new Error("❌ Fecha Prometida Desde/Hasta inválida.");
  }
  if (fHasta < fDesde) {
    throw new Error("❌ La Fecha Prometida Hasta no puede ser anterior a la Fecha Prometida Desde.");
  }

  const msg = procesarPreventa(d);
  const nPre = _extraerNumero_(msg, /N°:\s*(\S+)/);
  if (nPre) _tagOperadorPorNumero_(nPre, d.operador);
  return msg;
}

function procesarEntregaPreventaConOperador(d) {
  const msg = procesarEntregaPreventa(d);
  let nVta = "";
  if (d.operador) {
    if (d.nPre) _tagOperadorPorId_("Preventas", 2, "N° Preventa", d.nPre, d.operador);
    nVta = _extraerNumero_(msg, /N° Venta (?:generada|actualizada):\s*(\S+)/);
    if (nVta) _tagOperadorPorNumero_(nVta, d.operador);
    const nCompra = _extraerNumero_(msg, /N° Compra:\s*(\S+)/);
    if (nCompra) _tagOperadorPorNumero_(nCompra, d.operador);
  }
  const modelo = _obtenerModeloDePreventa_(d.nPre);
  return msg + _entregarRegalosSiCorresponde_(nVta, modelo, "", d.operador, d.operador, d.entregarRegalos);
}

function procesarReparacionConOperador(d) {
  const msg = procesarReparacion(d);
  const nRep = _extraerNumero_(msg, /N°:\s*(\S+)/);
  if (nRep) _tagOperadorPorNumero_(nRep, d.operador);
  return msg;
}

function procesarGastoConOperador(d) {
  const msg = procesarGasto(d);
  const nGas = _extraerNumero_(msg, /N°:\s*(\S+)/);
  if (nGas) _tagOperadorPorNumero_(nGas, d.operador);
  return msg;
}

// ------------------------------------------------------------
//  ACCESORIOS — wrappers con operador (misma estrategia: llaman a la
//  función de Code.gs tal cual y taguean después, sin modificarla).
// ------------------------------------------------------------

/** Compra de accesorios: procesarCompraAccesorios() ya escribe OPERADOR directo en cada línea (columna explícita, no la genérica). Acá solo se etiqueta Libro Diario, igual que el resto de los wrappers. */
function procesarCompraAccesoriosConOperador(d) {
  const msg = procesarCompraAccesorios(d);
  const nCompra = _extraerNumero_(msg, /N°:\s*(\S+)/);
  if (nCompra) _tagOperadorLibroDiario_(nCompra, d.operador);
  return msg;
}

/** Venta de accesorios multilínea (Web App, independiente de una venta de equipo). */
function procesarVentaAccesoriosMultiLineaConOperador(d) {
  Logger.log("[AUDIT_VTA_ACC] >>> ENTRADA procesarVentaAccesoriosMultiLineaConOperador() | d=" + JSON.stringify(d));
  Logger.log("[AUDIT_VTA_ACC] STACK entrada procesarVentaAccesoriosMultiLineaConOperador:\n" + new Error().stack);
  Logger.log("[AUDIT_VTA_ACC] >>> ANTES _procesarVentaAccesoriosMultiLinea_()");
  const resultado = _procesarVentaAccesoriosMultiLinea_(d);
  Logger.log("[AUDIT_VTA_ACC] <<< DESPUES _procesarVentaAccesoriosMultiLinea_() | resultado=" + JSON.stringify(resultado));
  Logger.log("[AUDIT_VTA_ACC] resultado.numeros.length=" + (resultado.numeros ? resultado.numeros.length : "undefined") + " => " + JSON.stringify(resultado.numeros));
  resultado.numeros.forEach(nAcc => {
    Logger.log("[AUDIT_VTA_ACC] >>> ANTES _tagOperadorPorNumero_() | nAcc=" + nAcc + " operador=" + d.operador);
    _tagOperadorPorNumero_(nAcc, d.operador);
    Logger.log("[AUDIT_VTA_ACC] <<< DESPUES _tagOperadorPorNumero_() | nAcc=" + nAcc);
  });
  Logger.log("[AUDIT_VTA_ACC] NOTA: en ningún punto de este flujo se llama registrarAuditoria_(), actualizarReportes(), guardarBackupOperacion_(), crearTransaccion_(), ni ninguna función de 'Caja'.");
  Logger.log("[AUDIT_VTA_ACC] <<< SALIDA procesarVentaAccesoriosMultiLineaConOperador() | mensaje=" + resultado.mensaje);
  return resultado.mensaje;
}

// ------------------------------------------------------------
//  GASTOS — submódulos nuevos (Cambio de Moneda / Ajuste de Caja).
//  Mismo patrón que procesarCompraAccesoriosConOperador: procesarCambioMoneda()/
//  procesarAjusteCaja() ya escriben OPERADOR directo (columna explícita),
//  acá solo se etiqueta Libro Diario.
// ------------------------------------------------------------

function procesarCambioMonedaConOperador(d) {
  const msg = procesarCambioMoneda(d);
  const nCambio = _extraerNumero_(msg, /N°:\s*(\S+)/);
  if (nCambio) _tagOperadorLibroDiario_(nCambio, d.operador);
  return msg;
}

function procesarAjusteCajaConOperador(d) {
  const msg = procesarAjusteCaja(d);
  const nAjuste = _extraerNumero_(msg, /N°:\s*(\S+)/);
  if (nAjuste) _tagOperadorLibroDiario_(nAjuste, d.operador);
  return msg;
}

// ------------------------------------------------------------
//  "Mis Operaciones" — VER / ANULAR / CORREGIR (cualquier operador sobre
//  cualquier operación, sin límite temporal, sin login/usuarios/roles —
//  la política de permisos fue eliminada de raíz). Reutiliza
//  procesarAnularOperacion() de anulaciones.gs sin modificarla — el
//  backup y la auditoría de la anulación quedan exactamente igual que
//  cuando se anula desde el menú de Sheets.
// ------------------------------------------------------------

/** Lee una fila completa como { NombreColumna: valor, ... } buscando `valorId` en `nombreColId`. Devuelve null si no la encuentra. Solo lectura. */
function _obtenerFilaCompleta_(nombreHoja, filaEnc, nombreColId, valorId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
  if (!sheet) return null;

  let colId;
  try { colId = getCol(sheet, nombreColId, filaEnc); } catch (e) { return null; }

  const lastRow = sheet.getLastRow();
  if (lastRow <= filaEnc) return null;

  const hdrs  = sheet.getRange(filaEnc, 1, 1, sheet.getLastColumn()).getValues()[0];
  const datos = sheet.getRange(filaEnc + 1, 1, lastRow - filaEnc, sheet.getLastColumn()).getValues();
  const valorTrim = String(valorId).trim();

  for (let i = 0; i < datos.length; i++) {
    if (String(datos[i][colId - 1] || "").trim() === valorTrim) {
      const obj = {};
      hdrs.forEach((h, j) => { if (h) obj[String(h).trim()] = datos[i][j]; });
      return obj;
    }
  }
  return null;
}

/** Igual que asegurarColumnaGenerica_ + búsqueda de fila, pero para escribir cualquier columna (no solo OPERADOR). Usado por PASO 7 (OPERACION_ORIGEN). */
function _tagColumnaGenericaPorId_(nombreHoja, filaEnc, nombreColId, valorId, nombreCol, valor) {
  if (!valor || !valorId) return false;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
  if (!sheet) return false;

  let colId;
  try { colId = getCol(sheet, nombreColId, filaEnc); } catch (e) { return false; }

  const lastRow = sheet.getLastRow();
  if (lastRow <= filaEnc) return false;

  const ids = sheet.getRange(filaEnc + 1, colId, lastRow - filaEnc, 1).getValues();
  const valorTrim = String(valorId).trim();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || "").trim() === valorTrim) {
      const col = asegurarColumnaGenerica_(sheet, filaEnc, nombreCol);
      sheet.getRange(filaEnc + 1 + i, col).setValue(valor);
      return true;
    }
  }
  return false;
}

/** PASO 4: anulación de cualquier operación, por cualquier operador, sin límite temporal (política de permisos eliminada de raíz). Reutiliza procesarAnularOperacion() sin modificarla — mismo backup/auditoría/lock que la anulación desde el menú de Sheets. */
function anularOperacionPropia(d) {
  return procesarAnularOperacion(d.numero, d.motivo);
}

/** PASO 8: si la operación ya tiene OPERACION_ORIGEN cargado, ya es el resultado de una corrección — no se permite encadenar otra. */
function _verificarNoEnCadena_(numero) {
  const prefijo = String(numero || "").trim().split("-")[0].toUpperCase();
  const mapa = obtenerMapaTiposAnulacion_();
  const info = mapa[prefijo];
  if (!info) return;
  const fila = _obtenerFilaCompleta_(info.hoja, 2, info.colId, numero);
  if (fila && fila["OPERACION_ORIGEN"]) {
    throw new Error("La operación ya pertenece a una cadena de correcciones.");
  }
}

/** PASO 7: etiqueta OPERACION_ORIGEN en la operación NUEVA con el número de la operación que reemplaza. */
function _tagOperacionOrigen_(numero, origen) {
  const prefijo = String(numero || "").trim().split("-")[0].toUpperCase();
  const mapa = obtenerMapaTiposAnulacion_();
  const info = mapa[prefijo];
  if (!info) return;
  _tagColumnaGenericaPorId_(info.hoja, 2, info.colId, numero, "OPERACION_ORIGEN", origen);
}

/** PASO 6: hoja CORRECCIONES — se crea sola si no existe. */
function asegurarHojaCorrecciones_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName("CORRECCIONES");
  if (hoja) return hoja;

  hoja = ss.insertSheet("CORRECCIONES");
  const encabezados = ["Fecha", "Operador", "Tipo", "Operacion Original", "Operacion Nueva", "Motivo"];
  hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados])
    .setFontWeight("bold").setBackground("#1A5276").setFontColor("#FFFFFF");
  hoja.setFrozenRows(1);
  return hoja;
}

function _registrarCorreccion_(operador, tipo, numeroOriginal, numeroNuevo, motivo) {
  const hoja = asegurarHojaCorrecciones_();
  const fila = getFilaVacia(hoja, 1, 2);
  hoja.getRange(fila, 1, 1, 6).setValues([[new Date(), operador, tipo, numeroOriginal, numeroNuevo, motivo || ""]]);
  hoja.getRange(fila, 1).setNumberFormat("dd/mm/yyyy hh:mm");
}

/** Busca en CORRECCIONES si `numero` ya fue reemplazado por otra operación. Devuelve el número nuevo o "". */
function _buscarCorreccionPorOriginal_(numero) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CORRECCIONES");
  if (!hoja) return "";
  const lastRow = hoja.getLastRow();
  if (lastRow <= 1) return "";
  const datos = hoja.getRange(2, 1, lastRow - 1, 6).getValues();
  const numTrim = String(numero).trim();
  for (let i = 0; i < datos.length; i++) {
    if (String(datos[i][3] || "").trim() === numTrim) return String(datos[i][4] || "");
  }
  return "";
}

/** PASO 1: { numeroOperacion: {fecha, usuario, motivo} } a partir de la última fila "ANULACION" de AUDITORIA para cada número (append-only: la última en aparecer es la más reciente). Solo lectura. */
function _mapaAuditoriaAnulaciones_() {
  const mapa = {};
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("AUDITORIA");
  if (!hoja) return mapa;
  const fE = 2;
  const lastRow = hoja.getLastRow();
  if (lastRow <= fE) return mapa;
  hoja.getRange(fE + 1, 1, lastRow - fE, 6).getValues().forEach(row => {
    const fecha = row[0], usuario = row[1], numero = String(row[3] || "").trim(), accion = String(row[4] || "").trim(), obs = row[5];
    if (accion === "ANULACION" && numero) {
      mapa[numero] = {
        fecha:   (fecha instanceof Date) ? Utilities.formatDate(fecha, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : String(fecha || ""),
        usuario: String(usuario || ""),
        motivo:  String(obs || "")
      };
    }
  });
  return mapa;
}

/** PASO 1: "🗑 Operaciones Anuladas" — combina ESTADO_REGISTRO (cuáles están anuladas), AUDITORIA (fecha/motivo) y CORRECCIONES (operación nueva, si la anulación fue parte de una corrección). Solo lectura. */
function obtenerOperacionesAnuladas() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const mapaCorrecciones = _mapaCorrecciones_();
  const mapaAuditoria    = _mapaAuditoriaAnulaciones_();

  function leer(nombreHoja, tipo, colId, colFechaFallback) {
    const sheet = ss.getSheetByName(nombreHoja);
    if (!sheet) return [];
    const fE = 2;
    const lastRow = sheet.getLastRow();
    if (lastRow <= fE) return [];
    const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
    const cId = idx(colId), cOp = idx("OPERADOR"), cEstReg = idx("ESTADO_REGISTRO"), cFec = idx(colFechaFallback);
    if (cEstReg === -1) return [];

    const salida = [];
    sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues().forEach(row => {
      if (String(row[cEstReg] || "").trim() !== "ANULADO") return;
      const numero = cId >= 0 ? String(row[cId] || "") : "";
      const auditoria = mapaAuditoria[numero];
      let fecha = auditoria ? auditoria.fecha : "";
      if (!fecha && cFec >= 0 && row[cFec] instanceof Date) {
        fecha = Utilities.formatDate(row[cFec], Session.getScriptTimeZone(), "dd/MM/yyyy");
      }
      salida.push({
        fecha:              fecha,
        tipo:               tipo,
        operacionOriginal:  numero,
        operacionNueva:     mapaCorrecciones[numero] || "",
        operador:           cOp >= 0 ? String(row[cOp] || "") : "",
        motivo:             auditoria ? auditoria.motivo : ""
      });
    });
    return salida;
  }

  let resultado = [];
  resultado = resultado.concat(leer(cfg.HOJA_COMPRAS      || "Compras",      "Compra",     "N° OP",        "Fecha Ingreso"));
  resultado = resultado.concat(leer(cfg.HOJA_VENTAS       || "Ventas",       "Venta",      "N° Venta",     "Fecha Venta"));
  resultado = resultado.concat(leer("Preventas",                            "Preventa",   "N° Preventa",  "Fecha Preventa"));
  resultado = resultado.concat(leer(cfg.HOJA_REPARACIONES || "Reparaciones","Reparación", "N° Rep",       "Fecha Ingreso"));
  resultado = resultado.concat(leer(cfg.HOJA_GASTOS       || "Gastos",      "Gasto",      "N° Gasto",     "Fecha"));
  resultado = resultado.concat(leer("Venta Accesorios",                    "Venta Accesorio", "N° Venta Accesorio", "Fecha Venta"));

  return resultado;
}

/** PASO 2: reconstruye la cadena completa de correcciones a partir de cualquier eslabón, caminando hacia atrás por OPERACION_ORIGEN y hacia adelante por CORRECCIONES. Devuelve ["VTA-021","VTA-022","VTA-023"]. */
function obtenerCadenaCorreccion_(numero) {
  const mapaCorrecciones = _mapaCorrecciones_(); // original -> nueva

  function origenDe(num) {
    const prefijo = String(num).trim().split("-")[0].toUpperCase();
    const info = obtenerMapaTiposAnulacion_()[prefijo];
    if (!info) return "";
    const fila = _obtenerFilaCompleta_(info.hoja, 2, info.colId, num);
    return fila ? String(fila["OPERACION_ORIGEN"] || "") : "";
  }

  let inicio = String(numero).trim();
  for (let guard = 0; guard < 50; guard++) {
    const anterior = origenDe(inicio);
    if (!anterior) break;
    inicio = anterior;
  }

  const cadena = [inicio];
  let actual = inicio;
  for (let guard = 0; guard < 50 && mapaCorrecciones[actual]; guard++) {
    actual = mapaCorrecciones[actual];
    cadena.push(actual);
  }
  return cadena;
}

/** Última fila de CORRECCIONES cuya "Operacion Nueva" sea `numeroNueva` (recorre de abajo hacia arriba: la más reciente primero). */
function _buscarFilaCorreccionPorNueva_(numeroNueva) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CORRECCIONES");
  if (!hoja) return null;
  const lastRow = hoja.getLastRow();
  if (lastRow <= 1) return null;
  const datos = hoja.getRange(2, 1, lastRow - 1, 6).getValues();
  const numTrim = String(numeroNueva).trim();
  for (let i = datos.length - 1; i >= 0; i--) {
    if (String(datos[i][4] || "").trim() === numTrim) {
      return {
        fecha:    (datos[i][0] instanceof Date) ? Utilities.formatDate(datos[i][0], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : String(datos[i][0] || ""),
        operador: String(datos[i][1] || ""),
        tipo:     String(datos[i][2] || ""),
        motivo:   String(datos[i][5] || "")
      };
    }
  }
  return null;
}

/** PASO 2/3: historial completo para el botón "Historial" de Mis Operaciones. */
function obtenerHistorialCorreccion(numero) {
  const cadena = obtenerCadenaCorreccion_(numero);
  const original = cadena[0];
  const actual = cadena[cadena.length - 1];
  const cantidadCorrecciones = cadena.length - 1;
  const ultimaCorreccion = cantidadCorrecciones > 0 ? _buscarFilaCorreccionPorNueva_(actual) : null;

  return {
    cadena: cadena,
    original: original,
    actual: actual,
    cantidadCorrecciones: cantidadCorrecciones,
    ultimaCorreccion: ultimaCorreccion
  };
}

const PATRON_NUMERO_POR_PREFIJO = {
  CMP: /N° OP:\s*(\S+)/, VTA: /N° Venta:\s*(\S+)/, PRE: /N°:\s*(\S+)/,
  REP: /N°:\s*(\S+)/,    GST: /N°:\s*(\S+)/
};

/** PASO 5: secuencia completa de una corrección — backup (ya lo hace procesarAnularOperacion internamente) → anular original → crear la nueva operación (vía el wrapper "ConOperador" existente, que ya etiqueta OPERADOR) → vincular (OPERACION_ORIGEN + fila en CORRECCIONES). Cualquier operación es corregible por cualquier operador, sin límite temporal (política de permisos eliminada de raíz) — se conserva únicamente _verificarNoEnCadena_ (no es una restricción de permiso/tiempo, es la regla estructural de no encadenar correcciones). */
function _ejecutarCorreccion_(prefijo, numeroOriginal, motivo, operadorSolicitante, funcionCrear, dNuevo) {
  _verificarNoEnCadena_(numeroOriginal);

  procesarAnularOperacion(numeroOriginal, "Corrección: " + (motivo || "")); // existente, no se modifica

  dNuevo.operador = operadorSolicitante;
  let msg;
  try {
    msg = funcionCrear(dNuevo);
  } catch (e) {
    // Si la creación de la nueva operación falla, el original ya quedó
    // anulado: se restaura automáticamente (procesarRestaurarOperacion,
    // existente, no se modifica) para no perder la operación sin reemplazo.
    try {
      procesarRestaurarOperacion(numeroOriginal, "Reversión automática: falló la corrección (" + e.message + ")");
    } catch (e2) {
      throw new Error("❌ Falló la corrección y también la reversión automática de " + numeroOriginal + ". Revisar manualmente. Error original: " + e.message + " | Error de reversión: " + e2.message);
    }
    throw new Error("❌ No se pudo crear la operación corregida (se restauró " + numeroOriginal + " automáticamente): " + e.message);
  }

  const info = obtenerMapaTiposAnulacion_()[prefijo];
  const numeroNuevo = _extraerNumero_(msg, PATRON_NUMERO_POR_PREFIJO[prefijo]);

  if (numeroNuevo) {
    _tagOperacionOrigen_(numeroNuevo, numeroOriginal);
    _registrarCorreccion_(operadorSolicitante, info.tipo, numeroOriginal, numeroNuevo, motivo);
  }

  return msg + "\n\n🔁 Corrección registrada: " + numeroOriginal + " → " + (numeroNuevo || "?");
}

function corregirCompra(d) {
  return _ejecutarCorreccion_("CMP", d.numeroOriginal, d.motivo, d.operador, procesarCompraConOperador, d.datosNuevos);
}
function corregirVenta(d) {
  return _ejecutarCorreccion_("VTA", d.numeroOriginal, d.motivo, d.operador, procesarVentaConOperador, d.datosNuevos);
}
function corregirPreventa(d) {
  return _ejecutarCorreccion_("PRE", d.numeroOriginal, d.motivo, d.operador, procesarPreventaConOperador, d.datosNuevos);
}
function corregirReparacion(d) {
  return _ejecutarCorreccion_("REP", d.numeroOriginal, d.motivo, d.operador, procesarReparacionConOperador, d.datosNuevos);
}

// ------------------------------------------------------------
//  REPARACIONES — avance de estado (En Proceso / Listo / Retirado) desde
//  la Web App. Hasta ahora esto solo existía como macro de Sheets
//  (actualizarEstadoReparacion + procesarActualizacionRep, Code.gs) —
//  desde "Mis Operaciones" no había forma de registrar que un equipo
//  estaba reparado y listo para retirar. Mismo criterio que esa macro:
//  "Listo" y "Retirado" registran fecha de egreso automática, las
//  observaciones se concatenan (nunca se pisan), y "Retirado" es terminal.
// ------------------------------------------------------------

const ESTADOS_REPARACION_WEB_VALIDOS = ["🟡 En Proceso", "🟢 Listo", "✅ Retirado", "🔄 Garantía"];

/** d = { numero, estado, operador, obs (opcional) } */
function actualizarEstadoReparacionWeb(d) {
  const numero   = String((d && d.numero)   || "").trim();
  const estado   = String((d && d.estado)   || "").trim();
  const operador = (d && d.operador) || "";
  if (!numero) throw new Error("❌ Falta el número de reparación.");
  if (!ESTADOS_REPARACION_WEB_VALIDOS.includes(estado)) throw new Error(`❌ Estado "${estado}" no reconocido.`);

  const cfg = getConfigCached();
  const hojaRep = cfg.HOJA_REPARACIONES || "Reparaciones";
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(hojaRep);
  if (!sheet) throw new Error(`❌ Hoja '${hojaRep}' no encontrada.`);

  const fE = 2;
  const fila = _buscarFilaPorId_(sheet, fE, "N° Rep", numero);
  if (fila === -1) throw new Error(`❌ Reparación "${numero}" no encontrada.`);

  const cES = getCol(sheet, "Estado", fE);
  const estadoAnterior = String(sheet.getRange(fila, cES).getValue() || "").trim();
  if (estadoAnterior.includes("Retirado")) throw new Error(`❌ "${numero}" ya está Retirado (estado terminal) — no se puede modificar.`);

  sheet.getRange(fila, cES).setValue(estado);

  if (estado.includes("Listo") || estado.includes("Retirado")) {
    const cFE2 = getCol(sheet, "Fecha Egreso", fE);
    sheet.getRange(fila, cFE2).setValue(new Date()).setNumberFormat("dd/mm/yyyy");
  }

  if (d && d.obs) {
    const cOB = getCol(sheet, "Observaciones", fE);
    const obsActual = sheet.getRange(fila, cOB).getValue();
    sheet.getRange(fila, cOB).setValue(obsActual ? obsActual + " | " + d.obs : d.obs);
  }

  registrarAuditoria_("REPARACION", numero, "ESTADO_ACTUALIZADO",
    `${estadoAnterior || "—"} → ${estado} (registrado por: ${operador || "—"}).`);

  return `✅ Estado actualizado.\nN°: ${numero}\nNuevo estado: ${estado}`;
}

// ------------------------------------------------------------
//  REPARACIONES — presupuesto de diagnóstico (Partes 6-8 del rediseño).
//  "Cliente aceptó" se comporta como una corrección automática del
//  diagnóstico hacia una reparación real: reutiliza _ejecutarCorreccion_()
//  tal cual (mismo camino que corregirReparacion), NO es un sistema
//  paralelo. Ya no hereda ninguna restricción de operador/tiempo: se puede
//  aceptar cualquier diagnóstico, en cualquier momento, por cualquier
//  operador (política de permisos eliminada de raíz del sistema).
// ------------------------------------------------------------

/** Parte 7: solo cambia el estado del presupuesto — no crea operación, no toca stock ni Libro Diario. */
function rechazarPresupuestoDiagnostico(d) {
  const numero   = String((d && d.numero)   || "").trim();
  const operador = (d && d.operador) || "";
  if (!numero) throw new Error("❌ Falta el número de reparación.");

  const cfg = getConfigCached();
  const hojaRep = cfg.HOJA_REPARACIONES || "Reparaciones";
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(hojaRep);
  if (!sheet) throw new Error(`❌ Hoja '${hojaRep}' no encontrada.`);

  const datos = _obtenerFilaCompleta_(hojaRep, 2, "N° Rep", numero);
  if (!datos) throw new Error(`❌ "${numero}" no encontrado en "${hojaRep}".`);

  const estado = String(datos["Estado"] || "").trim();
  const presupuesto = String(datos["PRESUPUESTO_DIAGNOSTICO"] || "").trim();
  if (estado !== "PARA DIAGNOSTICAR" || presupuesto !== "PENDIENTE") {
    throw new Error(`❌ "${numero}" no está pendiente de respuesta del cliente.`);
  }

  const fila  = _buscarFilaPorId_(sheet, 2, "N° Rep", numero);
  const colPD = getCol(sheet, "PRESUPUESTO_DIAGNOSTICO", 2);
  sheet.getRange(fila, colPD).setValue("RECHAZADO");

  registrarAuditoria_("REPARACION", numero, "DIAGNOSTICO_RECHAZADO", `Cliente rechazó el presupuesto de diagnóstico (registrado por: ${operador || "—"}).`);

  return `✅ "${numero}" marcado como rechazado por el cliente.`;
}

/**
 * aceptarPresupuestoDiagnostico(d) — d = { numero, operador }
 *
 * Parte 8/10: reutiliza _ejecutarCorreccion_() con el mismo mecanismo que
 * corregirReparacion() — anula el diagnóstico original (procesarAnularOperacion,
 * sin tocar), crea una reparación nueva (procesarReparacionConOperador, sin
 * tocar) con Estado=PARA REPARAR, taguea OPERACION_ORIGEN y registra en
 * CORRECCIONES — todo ya existente, nada paralelo.
 *
 * Precio Cobrado de la reparación nueva queda en 0 a propósito: el
 * presupuesto es una cotización aceptada, no un cobro — Libro Diario/Caja
 * no deben verse afectados hasta que se cobre de verdad.
 */
function aceptarPresupuestoDiagnostico(d) {
  const numeroDiagnostico = String((d && d.numero) || "").trim();
  const operador = (d && d.operador) || "";
  if (!numeroDiagnostico) throw new Error("❌ Falta el número de reparación.");

  const cfg = getConfigCached();
  const hojaRep = cfg.HOJA_REPARACIONES || "Reparaciones";
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(hojaRep);
  if (!sheet) throw new Error(`❌ Hoja '${hojaRep}' no encontrada.`);

  const datos = _obtenerFilaCompleta_(hojaRep, 2, "N° Rep", numeroDiagnostico);
  if (!datos) throw new Error(`❌ "${numeroDiagnostico}" no encontrado en "${hojaRep}".`);

  const estado = String(datos["Estado"] || "").trim();
  const presupuesto = String(datos["PRESUPUESTO_DIAGNOSTICO"] || "").trim();
  if (estado !== "PARA DIAGNOSTICAR" || presupuesto !== "PENDIENTE") {
    throw new Error(`❌ "${numeroDiagnostico}" no está pendiente de aceptación de diagnóstico.`);
  }

  // Deja constancia de que el diagnóstico terminó en aceptación (no solo
  // "anulado") ANTES de que _ejecutarCorreccion_() lo anule.
  const filaOriginal = _buscarFilaPorId_(sheet, 2, "N° Rep", numeroDiagnostico);
  const colPD = getCol(sheet, "PRESUPUESTO_DIAGNOSTICO", 2);
  if (filaOriginal !== -1) sheet.getRange(filaOriginal, colPD).setValue("ACEPTADO");

  const dNueva = {
    tipo:     datos["Tipo"] || "Particular",
    fecha:    new Date(),
    cliente:  datos["Cliente"]   || "",
    tel:      datos["Teléfono"]  || "",
    equipo:   datos["Equipo"]    || "",
    imei:     datos["IMEI"]      || "",
    pin:      datos["PIN"]       || "",
    falla1:   datos["Falla 1"]   || "",
    falla2:   datos["Falla 2"]   || "",
    precioCob: 0,
    efec: 0,
    transf: 0,
    obs: datos["Observaciones"] || "",
    esDiagnostico: false,
    trabajosSeleccionados: datos["Trabajos Reparación"]
      ? String(datos["Trabajos Reparación"]).split(",").map(s => s.trim()).filter(Boolean)
      : [],
    detallePresupuesto:  datos["Detalle Presupuesto"] || "",
    precioCalculado:      Number(datos["Precio Calculado"])      || 0,
    tiempoEstimadoHoras:  Number(datos["Tiempo Estimado (hs)"])  || 0
  };

  return _ejecutarCorreccion_("REP", numeroDiagnostico, "Cliente aceptó el presupuesto de diagnóstico", operador, procesarReparacionConOperador, dNueva);
}
function corregirGasto(d) {
  return _ejecutarCorreccion_("GST", d.numeroOriginal, d.motivo, d.operador, procesarGastoConOperador, d.datosNuevos);
}

/** PASO 2/3: toda la información de una operación para el modal "Ver" y para precargar el formulario de "Corregir". */
/**
 * @param {boolean} incluirExtras Por default (true) trae también los
 * movimientos de Libro Diario y las líneas de Compras Accesorios — lo que
 * necesita el modal "Ver" y "Historial". El flujo de Editar/Corregir NO usa
 * ninguna de esas dos cosas (solo lee `datos` y, si es una Venta,
 * `accesorios`) así que misOperacionesCorregir() pide incluirExtras=false
 * para no pagar el escaneo completo de Libro Diario (que puede ser una
 * hoja grande) en el camino que el usuario siente más lento al abrir.
 */
function obtenerOperacionCompleta_(numero, incluirExtras) {
  if (incluirExtras === undefined) incluirExtras = true;
  const prefijo = String(numero || "").trim().split("-")[0].toUpperCase();
  const mapa = obtenerMapaTiposAnulacion_();
  const info = mapa[prefijo];
  if (!info) throw new Error(`❌ No reconozco el prefijo de "${numero}".`);

  const datos = _obtenerFilaCompleta_(info.hoja, 2, info.colId, numero);
  if (!datos) throw new Error(`❌ "${numero}" no encontrado en "${info.hoja}".`);

  // Sanitizar fechas para que viajen como texto por google.script.run
  Object.keys(datos).forEach(k => {
    if (datos[k] instanceof Date) datos[k] = Utilities.formatDate(datos[k], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
  });

  // Movimientos asociados en Libro Diario
  const movimientos = [];
  if (incluirExtras) {
    const libro = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Libro Diario");
    if (libro) {
      const fE = 2;
      let colOp = -1, colRef = -1;
      try { colOp  = getCol(libro, "ID_OPERACION", fE); } catch (e) { /* opcional */ }
      try { colRef = getCol(libro, "REFERENCIA",   fE); } catch (e) { /* opcional */ }
      const lastRow = libro.getLastRow();
      if (lastRow > fE && (colOp > 0 || colRef > 0)) {
        const hdrsLibro = libro.getRange(fE, 1, 1, libro.getLastColumn()).getValues()[0];
        const idxL = (n) => hdrsLibro.findIndex(h => String(h).trim() === n);
        const cFec = idxL("FECHA"), cDesc = idxL("DESCRIPCION"), cMonto = idxL("MONTO"), cMedio = idxL("MEDIO_PAGO");
        const datosLibro = libro.getRange(fE + 1, 1, lastRow - fE, libro.getLastColumn()).getValues();
        const numTrim = String(numero).trim();
        datosLibro.forEach(row => {
          const op  = colOp  > 0 ? String(row[colOp  - 1] || "").trim() : "";
          const ref = colRef > 0 ? String(row[colRef - 1] || "").trim() : "";
          if (op === numTrim || ref === numTrim) {
            movimientos.push({
              fecha:       (row[cFec] instanceof Date) ? Utilities.formatDate(row[cFec], Session.getScriptTimeZone(), "dd/MM/yyyy") : String(row[cFec] || ""),
              descripcion: cDesc  >= 0 ? String(row[cDesc]  || "") : "",
              monto:       cMonto >= 0 ? (Number(row[cMonto]) || 0) : 0,
              medio:       cMedio >= 0 ? String(row[cMedio]  || "") : ""
            });
          }
        });
      }
    }
  }

  // Relaciones conocidas (campos ya presentes en la fila que apuntan a otra operación)
  const relacionesPorTipo = {
    CMP: [], VTA: ["N° OP Compra"], PRE: ["N° Compra Asociada", "N° Venta Asociada"],
    REP: [], GST: [], ACC: ["N° Venta Celular Asociada"], CAC: [], CAM: [], AJC: []
  };
  const relaciones = {};
  (relacionesPorTipo[prefijo] || []).forEach(campo => {
    if (datos[campo]) relaciones[campo] = datos[campo];
  });

  // Accesorios asociados (solo VTA): "Ventas Accesorios" vive en una hoja
  // aparte y no en la fila de Ventas — sin esto, corregir una venta con
  // accesorios los perdería silenciosamente al recrearla.
  let accesorios = [];
  if (prefijo === "VTA") {
    const accSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Venta Accesorios");
    if (accSheet) {
      const fEA = 2;
      let colAsoc = -1;
      try { colAsoc = getCol(accSheet, "N° Venta Celular Asociada", fEA); } catch (e) { /* opcional */ }
      const lastRowA = accSheet.getLastRow();
      if (colAsoc > 0 && lastRowA > fEA) {
        const hdrsA = accSheet.getRange(fEA, 1, 1, accSheet.getLastColumn()).getValues()[0];
        const idxA = (n) => hdrsA.findIndex(h => String(h).trim() === n);
        const cProd = idxA("Producto"), cPU = idxA("Precio Unitario"), cEstRegA = idxA("ESTADO_REGISTRO");
        const numTrim = String(numero).trim();
        accSheet.getRange(fEA + 1, 1, lastRowA - fEA, accSheet.getLastColumn()).getValues().forEach(row => {
          if (cEstRegA >= 0 && String(row[cEstRegA] || "").trim() === "ANULADO") return;
          if (String(row[colAsoc - 1] || "").trim() === numTrim) {
            accesorios.push({
              producto: cProd >= 0 ? String(row[cProd] || "") : "",
              precio:   cPU   >= 0 ? (Number(row[cPU]) || 0) : 0
            });
          }
        });
      }
    }
  }

  // Líneas completas (solo CAC): "N° Compra Accesorio" se repite en varias
  // filas de "Compras Accesorios" (1 compra = N líneas) — _obtenerFilaCompleta_
  // de arriba solo trae la primera. Sin esto, "Ver" perdería silenciosamente
  // todas las líneas menos la primera. CAC no es un tipo corregible (no está
  // en VISTA_POR_TIPO_CORRECCION), así que esto nunca hace falta en el
  // camino de Editar/Corregir.
  let lineasCompraAccesorio = [];
  if (incluirExtras && prefijo === "CAC") {
    const compAccSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Compras Accesorios");
    if (compAccSheet) {
      const fEC = 2;
      const hdrsCA = compAccSheet.getRange(fEC, 1, 1, compAccSheet.getLastColumn()).getValues()[0];
      const idxCA = (n) => hdrsCA.findIndex(h => String(h).trim() === n);
      const cNum = idxCA("N° Compra Accesorio"), cEstRegCA = idxCA("ESTADO_REGISTRO");
      const lastRowCA = compAccSheet.getLastRow();
      if (cNum >= 0 && lastRowCA > fEC) {
        const numTrim = String(numero).trim();
        compAccSheet.getRange(fEC + 1, 1, lastRowCA - fEC, compAccSheet.getLastColumn()).getValues().forEach(row => {
          if (cEstRegCA >= 0 && String(row[cEstRegCA] || "").trim() === "ANULADO") return;
          if (String(row[cNum] || "").trim() !== numTrim) return;
          const obj = {};
          hdrsCA.forEach((h, j) => {
            if (!h) return;
            obj[String(h).trim()] = (row[j] instanceof Date)
              ? Utilities.formatDate(row[j], Session.getScriptTimeZone(), "dd/MM/yyyy") : row[j];
          });
          lineasCompraAccesorio.push(obj);
        });
      }
    }
  }

  return {
    tipo:            info.tipo,
    prefijo:         prefijo,
    hoja:            info.hoja,
    numero:          numero,
    datos:           datos,
    operador:        String(datos["OPERADOR"] || ""),
    estado:          String(datos["Estado"] || ""),
    estadoRegistro:  String(datos["ESTADO_REGISTRO"] || "ACTIVO"),
    operacionOrigen: String(datos["OPERACION_ORIGEN"] || ""),
    operacionCorregida: _buscarCorreccionPorOriginal_(numero),
    relaciones:      relaciones,
    movimientos:     movimientos,
    accesorios:      accesorios,
    lineasCompraAccesorio: lineasCompraAccesorio
  };
}

// generarEtiquetaReparacion(numero) — implementación en etiquetas.gs (no acá,
// para no declarar la misma función en dos archivos). Sigue siendo llamable
// desde Reparaciones, Mis Operaciones y el modal Ver Reparación por igual.

// ------------------------------------------------------------
//  Setup manual — correr UNA VEZ desde el editor de Apps Script.
//  Agrega la columna OPERADOR en AUDITORIA y TRANSACCIONES para que la
//  estructura quede lista (PASO 2). No la completa automáticamente:
//  esas 2 hojas las escriben en exclusiva registrarAuditoria_()/
//  crearTransaccion_() (anulaciones.gs, no se tocan en este turno), y la
//  Web App no expone anulaciones/restauraciones — ver limitación
//  documentada al final de este archivo (PASO 8).
// ------------------------------------------------------------
function configurarColumnaOperadorAuditoriaYTransacciones() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const auditoria = ss.getSheetByName("AUDITORIA");
  if (auditoria) asegurarColumnaGenerica_(auditoria, 2, "OPERADOR");
  const transacciones = ss.getSheetByName("TRANSACCIONES");
  if (transacciones) asegurarColumnaGenerica_(transacciones, 2, "OPERADOR");
  SpreadsheetApp.getUi().alert("✅ Columna OPERADOR verificada en AUDITORIA y TRANSACCIONES.");
}

// ------------------------------------------------------------
//  PASO 5 — "Mis Operaciones": listado de solo lectura para la Web App.
// ------------------------------------------------------------

function _sumaColumnas_(row, hdrs, nombres) {
  return nombres.reduce((acc, n) => {
    const i = hdrs.findIndex(h => String(h).trim() === n);
    return acc + (i >= 0 ? (Number(row[i]) || 0) : 0);
  }, 0);
}

/** Construye { OperacionOriginal: OperacionNueva } leyendo CORRECCIONES una sola vez. */
function _mapaCorrecciones_() {
  const mapa = {};
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CORRECCIONES");
  if (!hoja) return mapa;
  const lastRow = hoja.getLastRow();
  if (lastRow <= 1) return mapa;
  hoja.getRange(2, 1, lastRow - 1, 6).getValues().forEach(row => {
    const original = String(row[3] || "").trim();
    if (original) mapa[original] = String(row[4] || "");
  });
  return mapa;
}

function _leerOperacionesDeHoja_(ss, nombreHoja, tipo, colFecha, colId, colCliente, colesImporte, colEstado, mapaCorrecciones, colEquipo) {
  const sheet = ss.getSheetByName(nombreHoja);
  if (!sheet) return [];
  const fE = 2;
  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return [];

  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
  const cFec    = idx(colFecha);
  const cId     = idx(colId);
  const cCli    = colCliente ? idx(colCliente) : -1;
  const cEst    = colEstado ? idx(colEstado) : -1;
  const cEq     = colEquipo ? idx(colEquipo) : -1;
  const cOp     = idx("OPERADOR");
  const cEstReg = idx("ESTADO_REGISTRO");
  const cOrigen = idx("OPERACION_ORIGEN");
  // FECHA_CREACION: timestamp real (hora exacta) que ya completa _tagOperadorPorId_()
  // al taguear el operador — más preciso que la fecha de negocio (colFecha) para
  // ordenar "más reciente primero", porque varias operaciones del mismo día
  // comparten la misma fecha de negocio pero no el mismo instante de creación.
  // Se usa SOLO para ordenar; lo que se muestra en pantalla sigue siendo colFecha.
  const cFecCreacion = idx("FECHA_CREACION");

  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  const salida = [];
  datos.forEach(row => {
    if (cEstReg >= 0 && String(row[cEstReg] || "").trim() === "ANULADO") return;
    const fecha  = cFec >= 0 ? row[cFec] : null;
    const numero = cId >= 0 ? String(row[cId] || "") : "";
    const fechaCreacion = cFecCreacion >= 0 ? row[cFecCreacion] : null;
    salida.push({
      fecha:    (fecha instanceof Date) ? Utilities.formatDate(fecha, Session.getScriptTimeZone(), "dd/MM/yyyy") : String(fecha || ""),
      fechaISO: (fecha instanceof Date) ? Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyy-MM-dd") : "",
      fechaOrd: (fechaCreacion instanceof Date) ? fechaCreacion.getTime() : ((fecha instanceof Date) ? fecha.getTime() : 0),
      tipo:     tipo,
      numero:   numero,
      cliente:  cCli >= 0 ? String(row[cCli] || "") : "",
      equipo:   cEq  >= 0 ? String(row[cEq]  || "") : "",
      importe:  _sumaColumnas_(row, hdrs, colesImporte),
      operador: cOp >= 0 ? String(row[cOp] || "") : "",
      estado:   cEst >= 0 ? String(row[cEst] || "") : "",
      operacionOrigen:    cOrigen >= 0 ? String(row[cOrigen] || "") : "",
      operacionCorregida: mapaCorrecciones[numero] || ""
    });
  });
  return salida;
}

/** Devuelve todas las operaciones (Compras/Ventas/Preventas/Reparaciones/Gastos) para la vista "Mis Operaciones". Filtrado (operador/tipo/fecha/número) se hace en el frontend. */
function obtenerOperacionesRecientes() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const mapaCorrecciones = _mapaCorrecciones_();

  let resultado = [];
  resultado = resultado.concat(_leerOperacionesDeHoja_(ss, cfg.HOJA_COMPRAS || "Compras", "Compra",
    "Fecha Ingreso", "N° OP", "Proveedor / Origen", ["Precio Compra"], "Estado", mapaCorrecciones, "Equipo / Modelo"));
  resultado = resultado.concat(_leerOperacionesDeHoja_(ss, cfg.HOJA_VENTAS || "Ventas", "Venta",
    "Fecha Venta", "N° Venta", "Cliente", ["Precio Venta"], "Estado", mapaCorrecciones, "Modelo"));
  resultado = resultado.concat(_leerOperacionesDeHoja_(ss, "Preventas", "Preventa",
    "Fecha Preventa", "N° Preventa", "Cliente", ["Precio Venta Pactado"], "Estado", mapaCorrecciones, "Modelo Solicitado"));
  resultado = resultado.concat(_leerOperacionesDeHoja_(ss, cfg.HOJA_REPARACIONES || "Reparaciones", "Reparación",
    "Fecha Ingreso", "N° Rep", "Cliente", ["Precio Cobrado"], "Estado", mapaCorrecciones, "Equipo"));
  resultado = resultado.concat(_leerOperacionesDeHoja_(ss, cfg.HOJA_GASTOS || "Gastos", "Gasto",
    "Fecha", "N° Gasto", "Descripción", ["Monto Efectivo", "Monto Transferencia"], null, mapaCorrecciones));
  resultado = resultado.concat(_leerOperacionesDeHoja_(ss, "Compras Accesorios", "Compra Accesorio",
    "Fecha Compra", "N° Compra Accesorio", "Proveedor", ["Costo Total"], "Estado", mapaCorrecciones, "Producto"));
  resultado = resultado.concat(_leerOperacionesDeHoja_(ss, "Venta Accesorios", "Venta Accesorio",
    "Fecha Venta", "N° Venta Accesorio", "Cliente", ["Total Cobrado"], "Estado", mapaCorrecciones, "Producto"));
  resultado = resultado.concat(_leerOperacionesDeHoja_(ss, "CAMBIO_MONEDA", "Cambio Moneda",
    "Fecha", "N° Cambio", "Tipo Cambio", ["Monto ARS"], "Estado", mapaCorrecciones));
  resultado = resultado.concat(_leerOperacionesDeHoja_(ss, "AJUSTES_CAJA", "Ajuste Caja",
    "Fecha", "N° Ajuste", "Motivo", ["Monto"], "Estado", mapaCorrecciones));

  resultado.sort((a, b) => b.fechaOrd - a.fechaOrd);
  resultado.forEach(r => delete r.fechaOrd);
  return resultado;
}

// ------------------------------------------------------------
//  PASO 6 — indicadores del día filtrados por operador.
// ------------------------------------------------------------

function _esHoy_(fecha) {
  if (!(fecha instanceof Date)) return false;
  const hoy = new Date();
  return fecha.getDate() === hoy.getDate() && fecha.getMonth() === hoy.getMonth() && fecha.getFullYear() === hoy.getFullYear();
}

function _contarHojaDelDia_(ss, nombreHoja, colFecha, operador, colGanancia) {
  const sheet = ss.getSheetByName(nombreHoja);
  if (!sheet) return { cant: 0, ganancia: 0 };
  const fE = 2;
  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return { cant: 0, ganancia: 0 };

  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
  const cFec    = idx(colFecha);
  const cOp     = idx("OPERADOR");
  const cEstReg = idx("ESTADO_REGISTRO");
  let cGan = -1;
  if (colGanancia) {
    cGan = idx(colGanancia[0]);
    if (cGan === -1 && colGanancia[1]) cGan = idx(colGanancia[1]);
  }

  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  let cant = 0, ganancia = 0;
  datos.forEach(row => {
    if (cEstReg >= 0 && String(row[cEstReg] || "").trim() === "ANULADO") return;
    if (operador && cOp >= 0 && String(row[cOp] || "").trim() !== operador) return;
    if (!_esHoy_(row[cFec])) return;
    cant++;
    if (cGan >= 0) ganancia += Number(row[cGan]) || 0;
  });
  return { cant, ganancia };
}

/** Indicadores "del día" filtrados por operador (o globales si operador es ""/null). */
function obtenerIndicadoresOperadorDelDia(operador) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();

  const ventas       = _contarHojaDelDia_(ss, cfg.HOJA_VENTAS       || "Ventas",       "Fecha Venta",   operador, ["Ganancia Cobrada", "Ganancia Neta"]);
  const preventas     = _contarHojaDelDia_(ss, "Preventas",                             "Fecha Preventa", operador, null);
  const reparaciones = _contarHojaDelDia_(ss, cfg.HOJA_REPARACIONES || "Reparaciones", "Fecha Ingreso", operador, null);
  const compras      = _contarHojaDelDia_(ss, cfg.HOJA_COMPRAS      || "Compras",      "Fecha Ingreso", operador, null);
  const gastos       = _contarHojaDelDia_(ss, cfg.HOJA_GASTOS       || "Gastos",       "Fecha",         operador, null);

  return {
    operacionesDia:   ventas.cant + preventas.cant + reparaciones.cant + compras.cant + gastos.cant,
    ventasDia:        ventas.cant,
    gananciaDia:      ventas.ganancia,
    preventasDia:     preventas.cant,
    reparacionesDia:  reparaciones.cant
  };
}

// ------------------------------------------------------------
//  PASO 7 — resumen de comisiones (solo indicadores, sin cálculo
//  monetario de comisión).
// ------------------------------------------------------------

function obtenerResumenComisiones() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();

  const resumen = {};
  OPERADORES_VALIDOS.forEach(op => {
    resumen[op] = { operador: op, cantidadVentas: 0, facturacion: 0, ganancia: 0, preventas: 0, reparaciones: 0,
                     cantidadAccesorios: 0, importeAccesorios: 0, regalosEntregados: 0 };
  });

  function acumular(nombreHoja, colFiltroFecha, campos) {
    const sheet = ss.getSheetByName(nombreHoja);
    if (!sheet) return;
    const fE = 2;
    const lastRow = sheet.getLastRow();
    if (lastRow <= fE) return;
    const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
    const cOp     = idx("OPERADOR");
    const cEstReg = idx("ESTADO_REGISTRO");
    if (cOp === -1) return;

    const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
    datos.forEach(row => {
      if (cEstReg >= 0 && String(row[cEstReg] || "").trim() === "ANULADO") return;
      const operador = String(row[cOp] || "").trim();
      if (!resumen[operador]) return; // operador vacío o de datos previos a esta funcionalidad
      campos(resumen[operador], row, hdrs);
    });
  }

  acumular(cfg.HOJA_VENTAS || "Ventas", null, (bucket, row, hdrs) => {
    bucket.cantidadVentas++;
    bucket.facturacion += _sumaColumnas_(row, hdrs, ["Precio Venta"]);
    const iGC = hdrs.findIndex(h => String(h).trim() === "Ganancia Cobrada");
    const iGN = hdrs.findIndex(h => String(h).trim() === "Ganancia Neta");
    bucket.ganancia += Number(row[iGC >= 0 ? iGC : iGN]) || 0;
  });
  acumular("Preventas", null, (bucket) => { bucket.preventas++; });
  acumular(cfg.HOJA_REPARACIONES || "Reparaciones", null, (bucket) => { bucket.reparaciones++; });
  acumular("Venta Accesorios", null, (bucket, row, hdrs) => {
    const iCant = hdrs.findIndex(h => String(h).trim() === "Cantidad");
    const iCat  = hdrs.findIndex(h => String(h).trim() === "Categoría");
    const esRegalo = iCat >= 0 && String(row[iCat] || "").trim() === "Regalo automático";
    if (esRegalo) {
      // Regalo automático: no es una venta (importe siempre $0) — se cuenta
      // aparte para no inflar "Cantidad accesorios vendidos" sin la
      // facturación correspondiente. NO se toca importeAccesorios acá.
      bucket.regalosEntregados += iCant >= 0 ? (Number(row[iCant]) || 0) : 0;
      return;
    }
    bucket.cantidadAccesorios += iCant >= 0 ? (Number(row[iCant]) || 0) : 0;
    bucket.importeAccesorios  += _sumaColumnas_(row, hdrs, ["Total Cobrado"]);
  });

  const extra = _contarAnuladasYCorregidasPorOperador_();
  OPERADORES_VALIDOS.forEach(op => {
    resumen[op].correccionesRealizadas = extra.correcciones[op] || 0;
    resumen[op].anulacionesRealizadas  = extra.anulaciones[op] || 0;
  });

  return OPERADORES_VALIDOS.map(op => resumen[op]);
}

/** PASO 4: cuenta, por operador, correcciones realizadas (filas propias en CORRECCIONES) y anulaciones "puras" (ESTADO_REGISTRO=ANULADO cuyo número NO es el origen de ninguna corrección — para no contar dos veces lo mismo). */
function _contarAnuladasYCorregidasPorOperador_() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  const mapaCorrecciones = _mapaCorrecciones_();

  const anulaciones = {};
  OPERADORES_VALIDOS.forEach(op => anulaciones[op] = 0);

  function contarAnuladas(nombreHoja, colId) {
    const sheet = ss.getSheetByName(nombreHoja);
    if (!sheet) return;
    const fE = 2;
    const lastRow = sheet.getLastRow();
    if (lastRow <= fE) return;
    const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
    const cOp = idx("OPERADOR"), cEstReg = idx("ESTADO_REGISTRO"), cId = idx(colId);
    if (cOp === -1 || cEstReg === -1 || cId === -1) return;
    sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues().forEach(row => {
      if (String(row[cEstReg] || "").trim() !== "ANULADO") return;
      const operador = String(row[cOp] || "").trim();
      if (!anulaciones.hasOwnProperty(operador)) return;
      const numero = String(row[cId] || "").trim();
      if (mapaCorrecciones[numero]) return; // ya se cuenta como corrección
      anulaciones[operador]++;
    });
  }
  contarAnuladas(cfg.HOJA_COMPRAS      || "Compras",      "N° OP");
  contarAnuladas(cfg.HOJA_VENTAS       || "Ventas",       "N° Venta");
  contarAnuladas("Preventas",                             "N° Preventa");
  contarAnuladas(cfg.HOJA_REPARACIONES || "Reparaciones", "N° Rep");
  contarAnuladas(cfg.HOJA_GASTOS       || "Gastos",       "N° Gasto");
  contarAnuladas("Compras Accesorios",                    "N° Compra Accesorio");
  contarAnuladas("Venta Accesorios",                      "N° Venta Accesorio");

  const correcciones = {};
  OPERADORES_VALIDOS.forEach(op => correcciones[op] = 0);
  const hojaCorr = ss.getSheetByName("CORRECCIONES");
  if (hojaCorr) {
    const lastRow = hojaCorr.getLastRow();
    if (lastRow > 1) {
      hojaCorr.getRange(2, 1, lastRow - 1, 6).getValues().forEach(row => {
        const operador = String(row[1] || "").trim();
        if (correcciones.hasOwnProperty(operador)) correcciones[operador]++;
      });
    }
  }

  return { anulaciones, correcciones };
}
