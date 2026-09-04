// ============================================================
//  reset_erp.gs — Reinicio del ERP a estado "recién instalado", en bloques
//  independientes (la versión anterior de reiniciarERP() daba timeout de
//  Apps Script al vaciar todo en una sola ejecución).
//
//  NO reemplaza ni borra el archivo. Deja intactos en TODAS las hojas:
//  encabezados, formatos, validaciones, fórmulas, colores, filtros,
//  protección y scripts. Solo vacía CONTENIDO de las filas de datos con
//  clearContent() — nunca clear(), deleteRow() ni hoja nueva.
//
//  NO modifica getConfig(), getConfigCached(), getCol(), getFilaVacia(),
//  genCorrelativo(), libroLog() ni actualizarStock_() — se limita a
//  llamarlas cuando corresponde. Tampoco toca webapp.gs, operadores.gs
//  ni anulaciones.gs: reutiliza por llamada reiniciarInversoresSeguro_()
//  (Code.gs), en vez de reimplementar esa lógica acá.
//
//  DISEÑO — por qué hay funciones "_interno_" separadas de las públicas:
//  cada bloque público (reiniciarOperaciones, reiniciarContabilidad,
//  reiniciarAuditoria, reiniciarInversores) muestra SU PROPIA confirmación,
//  porque ahora son ítems de menú independientes y alguien podría
//  ejecutarlos sueltos. reiniciarERPCompleto() necesita hacer el mismo
//  trabajo pero con UNA sola confirmación general y sin frenarse si un
//  bloque falla — por eso llama directamente a las versiones "_interno_"
//  (sin UI, sin try/catch propio) en vez de a las públicas, evitando así
//  además que le aparezcan 5 popups de confirmación en cadena.
// ============================================================

/** Vacía (clearContent) las filas de datos de una lista de hojas simples {nombre, filaEnc}. Ignora las que no existan. */
function _vaciarHojasSimples_(lista) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  lista.forEach(function (h) {
    const hoja = ss.getSheetByName(h.nombre);
    if (!hoja) return; // hoja opcional que todavía no existe: se ignora, no se crea ni se inventa

    const filaDatos = h.filaEnc + 1;
    const lastRow = hoja.getLastRow();
    const lastCol = hoja.getLastColumn();
    if (lastRow >= filaDatos && lastCol > 0) {
      hoja.getRange(filaDatos, 1, lastRow - filaDatos + 1, lastCol).clearContent();
    }
  });
}

function _intentarActualizarStock_() {
  try { if (typeof actualizarStock_ === "function") actualizarStock_(); }
  catch (e) { Logger.log("⚠️ actualizarStock_ falló → " + e.message); }
}
function _intentarActualizarStockAccesorios_() {
  try { if (typeof actualizarStockAccesorios_ === "function") actualizarStockAccesorios_(); }
  catch (e) { Logger.log("⚠️ actualizarStockAccesorios_ falló → " + e.message); }
}
function _intentarActualizarReportes_() {
  try { if (typeof actualizarReportes === "function") actualizarReportes(); }
  catch (e) { Logger.log("⚠️ actualizarReportes falló → " + e.message); }
}
function _intentarActualizarEstadoErp_() {
  try { if (typeof actualizarEstadoErp_ === "function") actualizarEstadoErp_(); }
  catch (e) { Logger.log("⚠️ actualizarEstadoErp_ falló → " + e.message); }
}

// ============================================================
//  BLOQUE 1 — Operaciones
// ============================================================

function _reiniciarOperacionesInterno_() {
  const cfg = getConfigCached();
  _vaciarHojasSimples_([
    { nombre: cfg.HOJA_COMPRAS      || "Compras",      filaEnc: 2 },
    { nombre: cfg.HOJA_VENTAS       || "Ventas",       filaEnc: 2 },
    { nombre: "Preventas",                             filaEnc: 2 },
    { nombre: cfg.HOJA_REPARACIONES || "Reparaciones", filaEnc: 2 },
    { nombre: cfg.HOJA_GASTOS       || "Gastos",       filaEnc: 2 },
    { nombre: "Venta Accesorios",                     filaEnc: 2 },
    { nombre: "Compras Accesorios",                     filaEnc: 2 },
    { nombre: "CAMBIO_MONEDA",                          filaEnc: 2 },
    { nombre: "AJUSTES_CAJA",                           filaEnc: 2 },
    { nombre: "Devoluciones",                           filaEnc: 2 }
  ]);
  // CATALOGO_ACCESORIOS y CONFIG_REGALOS NO se vacían acá: son maestros de
  // datos/configuración (mismo criterio que "Lista de Precios" y "Toma de
  // Equipos", que tampoco se tocan en ningún bloque de reinicio).
}

/** Vacía Compras, Ventas, Preventas, Reparaciones, Gastos, Ventas Accesorios, Compras Accesorios, Cambio de Moneda, Ajustes de Caja y Devoluciones. */
function reiniciarOperaciones() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "⚠️ ATENCIÓN",
    "Esto vaciará Compras, Ventas, Preventas, Reparaciones, Gastos, Ventas Accesorios, Compras Accesorios, Cambio de Moneda, Ajustes de Caja y Devoluciones.\n\n¿Desea continuar?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  _reiniciarOperacionesInterno_();
  SpreadsheetApp.flush();
  ui.alert("✅ Operaciones reiniciadas correctamente");
}

// ============================================================
//  BLOQUE 2 — Contabilidad
// ============================================================

function _reiniciarContabilidadInterno_() {
  const cfg = getConfigCached();
  _vaciarHojasSimples_([
    { nombre: "Libro Diario",             filaEnc: 2 },
    { nombre: cfg.HOJA_STOCK || "Stock",  filaEnc: 9 },
    { nombre: "Stock Accesorios",         filaEnc: 2 }
  ]);
}

/** Vacía Libro Diario, Stock y Stock Accesorios, y recalcula Stock/Stock Accesorios/Reportes si esas funciones existen. */
function reiniciarContabilidad() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "⚠️ ATENCIÓN",
    "Esto vaciará Libro Diario, Stock y Stock Accesorios.\n\n¿Desea continuar?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  _reiniciarContabilidadInterno_();
  _intentarActualizarStock_();
  _intentarActualizarStockAccesorios_();
  _intentarActualizarReportes_();
  SpreadsheetApp.flush();
  ui.alert("✅ Contabilidad reiniciada correctamente");
}

// ============================================================
//  BLOQUE 3 — Auditoría
// ============================================================

function _reiniciarAuditoriaInterno_() {
  _vaciarHojasSimples_([
    { nombre: "AUDITORIA",          filaEnc: 2 },
    { nombre: "TRANSACCIONES",      filaEnc: 2 },
    { nombre: "BACKUP_OPERACIONES", filaEnc: 2 },
    { nombre: "SALUD_ERP",          filaEnc: 2 },
    { nombre: "ESTADO_ERP",         filaEnc: 2 },
    { nombre: "CORRECCIONES",       filaEnc: 1 }
  ]);
}

/** Vacía AUDITORIA, TRANSACCIONES, BACKUP_OPERACIONES, SALUD_ERP, ESTADO_ERP y CORRECCIONES. */
function reiniciarAuditoria() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "⚠️ ATENCIÓN",
    "Esto vaciará AUDITORIA, TRANSACCIONES, BACKUP_OPERACIONES, SALUD_ERP, ESTADO_ERP y CORRECCIONES.\n\n¿Desea continuar?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  _reiniciarAuditoriaInterno_();
  _intentarActualizarEstadoErp_();
  SpreadsheetApp.flush();
  ui.alert("✅ Auditoría reiniciada correctamente");
}

// ============================================================
//  BLOQUE 4 — Inversores
// ============================================================

function _reiniciarInversoresInterno_() {
  const cfg = getConfigCached();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const invSheet = ss.getSheetByName(cfg.HOJA_INVERSORES || "Inversores");
  // "Inversores" no es una tabla simple (paneles dinámicos por inversor) —
  // reiniciarInversoresSeguro_() (Code.gs) ya conserva capital
  // inicial/estructura y solo vacía movimientos. Se reutiliza tal cual.
  if (invSheet && typeof reiniciarInversoresSeguro_ === "function") {
    reiniciarInversoresSeguro_(invSheet);
  }
}

/** Elimina movimientos de Inversores, conservando capital inicial y estructura (reutiliza reiniciarInversoresSeguro_). */
function reiniciarInversores() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "⚠️ ATENCIÓN",
    "Esto eliminará los movimientos de Inversores (capital inicial y estructura se conservan).\n\n¿Desea continuar?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  _reiniciarInversoresInterno_();
  SpreadsheetApp.flush();
  ui.alert("✅ Inversores reiniciados correctamente");
}

// ============================================================
//  Reinicio completo — los 4 bloques en una sola corrida, sin frenarse
//  si alguno falla (cada uno en su propio try/catch).
// ============================================================

function reiniciarERPCompleto() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "⚠️ ATENCIÓN",
    "Esta operación eliminará todos los movimientos registrados.\n\n¿Desea continuar?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  try { _reiniciarOperacionesInterno_(); } catch (e) { Logger.log("⚠️ reiniciarERPCompleto: Operaciones falló → " + e.message); }
  try { _reiniciarContabilidadInterno_(); } catch (e) { Logger.log("⚠️ reiniciarERPCompleto: Contabilidad falló → " + e.message); }
  try { _reiniciarAuditoriaInterno_(); } catch (e) { Logger.log("⚠️ reiniciarERPCompleto: Auditoría falló → " + e.message); }
  try { _reiniciarInversoresInterno_(); } catch (e) { Logger.log("⚠️ reiniciarERPCompleto: Inversores falló → " + e.message); }

  // PASO 3 (correlativos CMP/VTA/PRE/REP/GST/ACC): no hay contador guardado
  // que resetear — genCorrelativo() calcula siempre el próximo número a
  // partir de getFilaVacia(), así que al quedar vacías las hojas arriba,
  // el próximo número de cada tipo vuelve a arrancar en 001 solo.

  _intentarActualizarStock_();
  _intentarActualizarStockAccesorios_();
  _intentarActualizarReportes_();
  _intentarActualizarEstadoErp_();

  SpreadsheetApp.flush();
  ui.alert("✅ ERP reiniciado correctamente");
}
