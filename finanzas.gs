// ============================================================
//  GESTIÓN FINANCIERA Y RENTABILIDAD — FASE 1
//  (Costos + Estado de Resultados automático + Dashboard resumen)
//
//  No duplica el registro de ventas: el Estado de Resultados lee en
//  vivo de las hojas "Ventas" y "Venta Accesorios" (ya existentes,
//  alimentadas por el resto del ERP) — acá solo se cargan/editan los
//  costos que esas hojas no tienen: fijos, variables no ligados a la
//  venta puntual (accesorios de regalo, logística) y mano de obra.
//
//  Reemplaza el Excel "modelo financiero" del dueño (Costos Fijos
//  Mensuales / Costo Variable del Producto / Costos de Mano de Obra /
//  Estado de Resultados), sin el balance patrimonial completo ni el
//  escenario financiado con préstamo (ninguno de los dos aplica hoy —
//  quedan para una Fase 2 si en algún momento hace falta evaluar un
//  préstamo real).
//
//  Vigencia, no borrado: cada costo (fijo, variable o de mano de obra)
//  se guarda con "Vigente Desde"/"Vigente Hasta". Editar un valor NO
//  pisa la fila vieja — la cierra (Vigente Hasta = hoy) y crea una fila
//  nueva. Así el Estado de Resultados de un mes pasado sigue viendo el
//  costo que realmente regía ese mes, no el valor actual.
// ============================================================

const FIN_HOJA_COSTOS_FIJOS     = "FINANZAS_COSTOS_FIJOS";
const FIN_HOJA_COSTO_VARIABLE   = "FINANZAS_COSTO_VARIABLE";
const FIN_HOJA_MANO_DE_OBRA     = "FINANZAS_MANO_DE_OBRA";
const FIN_HOJA_CONFIG           = "FINANZAS_CONFIG";
const FIN_HOJA_AJUSTES_MANUALES = "FINANZAS_AJUSTES_MANUALES";

// ------------------------------------------------------------
//  Configuración editable (% Impuesto a las Ganancias, etc.)
//  Reemplaza la constante fija que había antes — el negocio no
//  siempre paga el 30%, así que queda como un valor editable desde
//  la web en vez de hardcodeado en el código.
// ------------------------------------------------------------

function _finAsegurarHojaConfig_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return _finAsegurarHoja_(ss, FIN_HOJA_CONFIG, ["Clave", "Valor"]);
}

function _finLeerConfig_(clave, valorPorDefecto) {
  const sheet = _finAsegurarHojaConfig_();
  const last = sheet.getLastRow();
  if (last <= 1) return valorPorDefecto;
  const filas = sheet.getRange(2, 1, last - 1, 2).getValues();
  for (let i = 0; i < filas.length; i++) {
    if (String(filas[i][0]) === clave) return filas[i][1];
  }
  return valorPorDefecto;
}

function _finGuardarConfig_(clave, valor) {
  const sheet = _finAsegurarHojaConfig_();
  const last = sheet.getLastRow();
  if (last > 1) {
    const filas = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < filas.length; i++) {
      if (String(filas[i][0]) === clave) { sheet.getRange(i + 2, 2).setValue(valor); return; }
    }
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 2).setValues([[clave, valor]]);
}

/** % de Impuesto a las Ganancias que se aplica en el Estado de Resultados — editable, arranca en 0 porque el negocio hoy no lo paga. */
function _finImpuestoGananciasFraccion_() {
  const pct = Number(_finLeerConfig_("impuestoGananciasPct", 0)) || 0;
  return pct / 100;
}

function obtenerConfigFinanzas() {
  return { impuestoGananciasPct: Number(_finLeerConfig_("impuestoGananciasPct", 0)) || 0 };
}

function guardarConfigFinanzas(d) {
  const pct = Number(d.impuestoGananciasPct);
  if (isNaN(pct) || pct < 0 || pct > 100) throw new Error("❌ El % de impuesto tiene que estar entre 0 y 100.");
  _finGuardarConfig_("impuestoGananciasPct", pct);
  return "✅ Configuración guardada.";
}

// ------------------------------------------------------------
//  Setup de hojas (se crean solas la primera vez que hacen falta)
// ------------------------------------------------------------

function _finAsegurarHoja_(ss, nombre, headers) {
  let sheet = ss.getSheetByName(nombre);
  if (sheet) return sheet;

  // El panel de Finanzas dispara varias llamadas en paralelo al cargar
  // (google.script.run no espera a que termine una para lanzar la
  // siguiente), así que la primera vez que una hoja todavía no existe,
  // dos llamadas pueden llegar acá casi al mismo tiempo y las dos ven
  // "no existe" antes de que ninguna la haya creado — sin este lock,
  // la segunda revienta con "Ya existe una hoja con el nombre...".
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    sheet = ss.getSheetByName(nombre); // puede haberla creado la llamada que tenía el lock antes
    if (!sheet) {
      sheet = ss.insertSheet(nombre);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
  } finally {
    lock.releaseLock();
  }
  return sheet;
}

function _finAsegurarHojas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  _finAsegurarHoja_(ss, FIN_HOJA_COSTOS_FIJOS, [
    "ID", "Categoría", "Concepto", "Descripción", "Monto", "Moneda",
    "Cantidad", "Vida Útil (años)", "Vigente Desde", "Vigente Hasta"
  ]);
  _finAsegurarHoja_(ss, FIN_HOJA_COSTO_VARIABLE, [
    "ID", "Concepto", "Descripción", "Costo Unitario", "Moneda", "Vigente Desde", "Vigente Hasta"
  ]);
  _finAsegurarHoja_(ss, FIN_HOJA_MANO_DE_OBRA, [
    "ID", "Rol / Persona", "Cantidad", "Turnos", "Salario", "Moneda", "Vigente Desde", "Vigente Hasta"
  ]);
}

// ------------------------------------------------------------
//  Helpers genéricos (compartidos por las 3 hojas de costos)
// ------------------------------------------------------------

function _finProximoId_(sheet) {
  const last = sheet.getLastRow();
  if (last <= 1) return 1;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues().map(r => Number(r[0])).filter(n => !isNaN(n));
  return ids.length ? Math.max.apply(null, ids) + 1 : 1;
}

function _finFmtFecha_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function _finFilaAObjeto_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    let v = row[i];
    if (v instanceof Date) v = _finFmtFecha_(v);
    obj[h] = v;
  });
  return obj;
}

function _finLeerHoja_(sheet) {
  const last = sheet.getLastRow();
  if (last <= 1) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const datos = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  return datos.map(row => _finFilaAObjeto_(headers, row));
}

/** Cierra la vigencia de `idAnterior` en `nombreHoja` (última columna = "Vigente Hasta" en las 3 hojas) — no borra nada, solo le pone fecha de cierre. */
function _finCerrarVigenciaAnterior_(sheet, idAnterior) {
  if (!idAnterior) return;
  const last = sheet.getLastRow();
  if (last <= 1) return;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  const colVigenteHasta = sheet.getLastColumn();
  const hoy = _finFmtFecha_(new Date());
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(idAnterior)) {
      sheet.getRange(i + 2, colVigenteHasta).setValue(hoy);
      return;
    }
  }
}

/** Da de baja un ítem (le cierra la vigencia a hoy) sin borrar la fila — mismo mecanismo que editar, pero sin fila nueva. */
function _finDarDeBaja_(nombreHoja, id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
  if (!sheet) throw new Error(`❌ Hoja "${nombreHoja}" no encontrada.`);
  _finCerrarVigenciaAnterior_(sheet, id);
  return "✅ Dado de baja.";
}

/** true si una fila con esa Vigente Desde/Hasta regía en el mes (anio, mes1based) pedido. Sin Vigente Hasta = todavía vigente. */
function _finVigenteEnMes_(vigenteDesde, vigenteHasta, anio, mes1based) {
  const finMes = new Date(anio, mes1based, 0); // último día del mes pedido
  const inicioMes = new Date(anio, mes1based - 1, 1);
  const desde = vigenteDesde ? new Date(vigenteDesde) : null;
  const hasta = vigenteHasta ? new Date(vigenteHasta) : null;
  if (desde && desde > finMes) return false;
  if (hasta && hasta < inicioMes) return false;
  return true;
}

/** Convierte un monto a ARS si está cargado en USD (misma cotización/función que usa todo el ERP — Cambio 3: nunca se mezclan pesos y dólares "a mano"). */
function _finAMonedaARS_(monto, moneda, cotizacion) {
  monto = Number(monto) || 0;
  if (String(moneda || "ARS").trim().toUpperCase() === "USD") return convertirUSDaPesos_(monto, cotizacion);
  return monto;
}

// ------------------------------------------------------------
//  COSTOS FIJOS — CRUD (Servicios / Administrativos / Inversión)
// ------------------------------------------------------------

function obtenerCostosFijos() {
  _finAsegurarHojas_();
  return _finLeerHoja_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FIN_HOJA_COSTOS_FIJOS));
}

/** d = { idAnterior (opcional, si es una edición), categoria, concepto, descripcion, monto, moneda, cantidad, vidaUtil, vigenteDesde } */
function guardarCostoFijo(d) {
  _finAsegurarHojas_();
  if (!String(d.concepto || "").trim()) throw new Error("❌ Ingresá el concepto.");
  if (!["Servicios", "Administrativos", "Inversión"].includes(d.categoria)) throw new Error("❌ Categoría inválida.");
  const monto = Number(d.monto) || 0;
  if (monto <= 0) throw new Error("❌ El monto debe ser mayor a 0.");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FIN_HOJA_COSTOS_FIJOS);
  _finCerrarVigenciaAnterior_(sheet, d.idAnterior);

  const id = _finProximoId_(sheet);
  const esInversion = d.categoria === "Inversión";
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 10).setValues([[
    id, d.categoria, d.concepto.trim(), (d.descripcion || "").trim(), monto, d.moneda || "ARS",
    esInversion ? (Number(d.cantidad) || 1) : "",
    esInversion ? (Number(d.vidaUtil) || 1) : "",
    d.vigenteDesde || _finFmtFecha_(new Date()), ""
  ]]);
  return "✅ Costo fijo guardado.";
}

function darDeBajaCostoFijo(id) { return _finDarDeBaja_(FIN_HOJA_COSTOS_FIJOS, id); }

// ------------------------------------------------------------
//  COSTO VARIABLE (config) — accesorios de regalo, logística, etc.
//  El costo del equipo en sí NO se carga acá: sale solo de la
//  Ganancia Neta ya calculada por cada Venta real (ver
//  _finVentasDelMes_ más abajo).
// ------------------------------------------------------------

function obtenerCostoVariableConfig() {
  _finAsegurarHojas_();
  return _finLeerHoja_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FIN_HOJA_COSTO_VARIABLE));
}

/** d = { idAnterior (opcional), concepto, descripcion, costoUnitario, moneda, vigenteDesde } */
function guardarCostoVariable(d) {
  _finAsegurarHojas_();
  if (!String(d.concepto || "").trim()) throw new Error("❌ Ingresá el concepto.");
  const costo = Number(d.costoUnitario) || 0;
  if (costo <= 0) throw new Error("❌ El costo unitario debe ser mayor a 0.");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FIN_HOJA_COSTO_VARIABLE);
  _finCerrarVigenciaAnterior_(sheet, d.idAnterior);

  const id = _finProximoId_(sheet);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 7).setValues([[
    id, d.concepto.trim(), (d.descripcion || "").trim(), costo, d.moneda || "ARS",
    d.vigenteDesde || _finFmtFecha_(new Date()), ""
  ]]);
  return "✅ Costo variable guardado.";
}

function darDeBajaCostoVariable(id) { return _finDarDeBaja_(FIN_HOJA_COSTO_VARIABLE, id); }

// ------------------------------------------------------------
//  MANO DE OBRA
// ------------------------------------------------------------

function obtenerManoDeObra() {
  _finAsegurarHojas_();
  return _finLeerHoja_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FIN_HOJA_MANO_DE_OBRA));
}

/** d = { idAnterior (opcional), rol, cantidad, turnos, salario, moneda, vigenteDesde } */
function guardarManoDeObra(d) {
  _finAsegurarHojas_();
  if (!String(d.rol || "").trim()) throw new Error("❌ Ingresá el rol o nombre.");
  const salario = Number(d.salario) || 0;
  if (salario <= 0) throw new Error("❌ El salario debe ser mayor a 0.");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FIN_HOJA_MANO_DE_OBRA);
  _finCerrarVigenciaAnterior_(sheet, d.idAnterior);

  const id = _finProximoId_(sheet);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 8).setValues([[
    id, d.rol.trim(), Number(d.cantidad) || 1, Number(d.turnos) || 1, salario, d.moneda || "ARS",
    d.vigenteDesde || _finFmtFecha_(new Date()), ""
  ]]);
  return "✅ Mano de obra guardada.";
}

function darDeBajaManoDeObra(id) { return _finDarDeBaja_(FIN_HOJA_MANO_DE_OBRA, id); }

// ------------------------------------------------------------
//  VENTAS DEL MES — solo lectura, de las hojas reales del ERP
//  (nunca se vuelve a cargar una venta acá).
// ------------------------------------------------------------

/**
 * Ingresos, costo de lo vendido (Precio Venta − Ganancia Neta, ya
 * calculada por cada Venta) y unidades vendidas en (anio, mes1based),
 * sumando equipos ("Ventas") + accesorios ("Venta Accesorios"). Mismo
 * criterio de "mes calendario según Fecha Venta" que ya usa
 * obtenerDashboardData() (webapp.gs) — no se reinventa el cálculo, se
 * extiende a cualquier mes en vez de solo "el mes actual".
 */
function _finVentasDelMes_(anio, mes1based) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();
  let ingresos = 0, costoVendido = 0, unidadesEquipos = 0;

  const ventasSheet = ss.getSheetByName(cfg.HOJA_VENTAS || "Ventas");
  if (ventasSheet) {
    const fE = 2;
    const vFV = getCol(ventasSheet, "Fecha Venta", fE);
    const vPV = getCol(ventasSheet, "Precio Venta", fE);
    const vEst = getCol(ventasSheet, "Estado", fE);
    const vGN = getCol(ventasSheet, "Ganancia Neta", fE);
    let vGC = -1, vEstReg = -1;
    try { vGC = getCol(ventasSheet, "Ganancia Cobrada", fE); } catch (e) { /* opcional */ }
    try { vEstReg = getCol(ventasSheet, "ESTADO_REGISTRO", fE); } catch (e) { /* opcional */ }

    const lastRow = ventasSheet.getLastRow();
    if (lastRow > fE) {
      ventasSheet.getRange(fE + 1, 1, lastRow - fE, ventasSheet.getLastColumn()).getValues().forEach(row => {
        const estado = String(row[vEst - 1] || "");
        if (!estado) return;
        if (vEstReg >= 0 && String(row[vEstReg - 1] || "").trim() === "ANULADO") return;
        const fecha = row[vFV - 1];
        if (!(fecha instanceof Date)) return;
        if (fecha.getFullYear() !== anio || (fecha.getMonth() + 1) !== mes1based) return;

        const precioVenta = Number(row[vPV - 1]) || 0;
        const ganancia = vGC >= 0 ? (Number(row[vGC - 1]) || 0) : (Number(row[vGN - 1]) || 0);
        ingresos += precioVenta;
        costoVendido += (precioVenta - ganancia);
        unidadesEquipos++;
      });
    }
  }

  const accSheet = ss.getSheetByName("Venta Accesorios");
  if (accSheet) {
    const fE = 2;
    let cFV = -1, cTC = -1, cCT = -1, cES = -1, cEstReg = -1;
    try { cFV = getCol(accSheet, "Fecha Venta", fE); } catch (e) { /* opcional */ }
    try { cTC = getCol(accSheet, "Total Cobrado", fE); } catch (e) { /* opcional */ }
    try { cCT = getCol(accSheet, "Costo Total", fE); } catch (e) { /* opcional */ }
    try { cES = getCol(accSheet, "Estado", fE); } catch (e) { /* opcional */ }
    try { cEstReg = getCol(accSheet, "ESTADO_REGISTRO", fE); } catch (e) { /* opcional */ }

    const lastRow = accSheet.getLastRow();
    if (cFV > 0 && cTC > 0 && lastRow > fE) {
      accSheet.getRange(fE + 1, 1, lastRow - fE, accSheet.getLastColumn()).getValues().forEach(row => {
        if (cES > 0 && !row[cES - 1]) return;
        if (cEstReg >= 0 && String(row[cEstReg - 1] || "").trim() === "ANULADO") return;
        const fecha = row[cFV - 1];
        if (!(fecha instanceof Date)) return;
        if (fecha.getFullYear() !== anio || (fecha.getMonth() + 1) !== mes1based) return;

        ingresos += Number(row[cTC - 1]) || 0;
        costoVendido += cCT > 0 ? (Number(row[cCT - 1]) || 0) : 0;
      });
    }
  }

  return { ingresos, costoVendido, unidadesEquipos };
}

// ------------------------------------------------------------
//  ESTADO DE RESULTADOS — el cálculo central de todo el módulo
// ------------------------------------------------------------

/**
 * calcularEstadoResultados(anio, mes1based)
 *
 * Ventas (Ingresos) − Costo Variable (de lo vendido + insumos por
 * unidad, ej. funda/cable/transporte) = Utilidad Bruta; menos Costos
 * Fijos, Amortización y Gastos Financieros (0 por ahora, sin escenario
 * financiado activo) = Resultado antes de impuestos; menos Impuesto a
 * las Ganancias (solo si el resultado es positivo) = Resultado Neto.
 *
 * Todos los costos se toman con la vigencia real de ese mes (no el
 * valor actual) — así un mes de enero sigue mostrando el alquiler de
 * enero aunque hoy ya haya cambiado.
 */
// ------------------------------------------------------------
//  Ajustes manuales del Estado de Resultados por mes
//
//  Muchas veces lo que se calcula automático (a partir de Ventas /
//  Venta Accesorios / los 3 paneles de costos) no queda del todo bien
//  cargado — así que cualquier línea del Estado de Resultados de un
//  mes puntual se puede pisar a mano. Lo que no se pisa sigue
//  saliendo del cálculo automático como siempre. "Restablecer
//  automático" borra el ajuste y ese mes vuelve a calcularse solo.
// ------------------------------------------------------------

const FIN_CAMPOS_AJUSTABLES = ["ventas", "costoVariable", "costosFijos", "amortizacion", "manoDeObra", "gastosFinancieros"];

function _finAsegurarHojaAjustes_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return _finAsegurarHoja_(ss, FIN_HOJA_AJUSTES_MANUALES, [
    "Año", "Mes", "Ventas", "Costo Variable", "Costos Fijos", "Amortización", "Mano de Obra", "Gastos Financieros", "Notas"
  ]);
}

function _finBuscarFilaAjuste_(sheet, anio, mes1based) {
  const last = sheet.getLastRow();
  if (last <= 1) return -1;
  const filas = sheet.getRange(2, 1, last - 1, 2).getValues();
  for (let i = 0; i < filas.length; i++) {
    if (Number(filas[i][0]) === Number(anio) && Number(filas[i][1]) === Number(mes1based)) return i + 2;
  }
  return -1;
}

/** Devuelve { ventas, costoVariable, ... } solo con los campos que tienen ajuste cargado (los demás quedan sin la clave), o null si no hay ajuste para ese mes. */
function _finObtenerAjusteManual_(anio, mes1based) {
  const sheet = _finAsegurarHojaAjustes_();
  const fila = _finBuscarFilaAjuste_(sheet, anio, mes1based);
  if (fila === -1) return null;
  const valores = sheet.getRange(fila, 3, 1, 6).getValues()[0]; // Ventas..Gastos Financieros
  const notas = sheet.getRange(fila, 9).getValue();
  const ajuste = { notas: notas || "" };
  let hayAlgo = false;
  FIN_CAMPOS_AJUSTABLES.forEach((campo, i) => {
    if (valores[i] !== "" && valores[i] !== null && !isNaN(Number(valores[i]))) {
      ajuste[campo] = Number(valores[i]);
      hayAlgo = true;
    }
  });
  return hayAlgo || notas ? ajuste : null;
}

function obtenerAjusteManual(anio, mes1based) {
  return _finObtenerAjusteManual_(anio, mes1based) || {};
}

function guardarAjusteManual(d) {
  const anio = Number(d.anio), mes1based = Number(d.mes);
  const sheet = _finAsegurarHojaAjustes_();
  const fila = _finBuscarFilaAjuste_(sheet, anio, mes1based);
  const valores = FIN_CAMPOS_AJUSTABLES.map(campo => {
    const v = d[campo];
    return (v === "" || v === null || v === undefined) ? "" : Number(v);
  });
  const filaCompleta = [anio, mes1based].concat(valores).concat([d.notas || ""]);
  if (fila === -1) {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, filaCompleta.length).setValues([filaCompleta]);
  } else {
    sheet.getRange(fila, 1, 1, filaCompleta.length).setValues([filaCompleta]);
  }
  return "✅ Ajuste guardado para " + mes1based + "/" + anio + ".";
}

function eliminarAjusteManual(anio, mes1based) {
  const sheet = _finAsegurarHojaAjustes_();
  const fila = _finBuscarFilaAjuste_(sheet, anio, mes1based);
  if (fila === -1) return "✅ Ese mes ya estaba en automático.";
  sheet.deleteRow(fila);
  return "✅ Restablecido a cálculo automático.";
}

function calcularEstadoResultados(anio, mes1based) {
  const cotizacion = obtenerCotizacionUSD();
  const ventas = _finVentasDelMes_(anio, mes1based);

  // Costo variable adicional por unidad (funda, cable, transporte...),
  // vigente en el mes, multiplicado por los equipos vendidos ese mes.
  const costoVariableConfig = obtenerCostoVariableConfig().filter(c =>
    _finVigenteEnMes_(c["Vigente Desde"], c["Vigente Hasta"], anio, mes1based)
  );
  const costoVariableUnitarioARS = costoVariableConfig.reduce((s, c) =>
    s + _finAMonedaARS_(c["Costo Unitario"], c["Moneda"], cotizacion), 0
  );
  const costoVariableInsumos = costoVariableUnitarioARS * ventas.unidadesEquipos;

  const costoVariableTotal = ventas.costoVendido + costoVariableInsumos;
  const utilidadBruta = ventas.ingresos - costoVariableTotal;

  const costosFijosTodos = obtenerCostosFijos().filter(c =>
    _finVigenteEnMes_(c["Vigente Desde"], c["Vigente Hasta"], anio, mes1based)
  );
  const costosFijosOperativos = costosFijosTodos.filter(c => c["Categoría"] !== "Inversión");
  const costosFijos = costosFijosOperativos.reduce((s, c) => s + _finAMonedaARS_(c["Monto"], c["Moneda"], cotizacion), 0);

  const itemsInversion = costosFijosTodos.filter(c => c["Categoría"] === "Inversión");
  const amortizacion = itemsInversion.reduce((s, c) => {
    const montoARS = _finAMonedaARS_(c["Monto"], c["Moneda"], cotizacion);
    const cantidad = Number(c["Cantidad"]) || 1;
    const vidaUtilAnios = Number(c["Vida Útil (años)"]) || 1;
    return s + (montoARS * cantidad) / vidaUtilAnios / 12;
  }, 0);

  const manoDeObra = obtenerManoDeObra()
    .filter(m => _finVigenteEnMes_(m["Vigente Desde"], m["Vigente Hasta"], anio, mes1based))
    .reduce((s, m) => {
      const cantidad = Number(m["Cantidad"]) || 1;
      const turnos = Number(m["Turnos"]) || 1;
      const salarioARS = _finAMonedaARS_(m["Salario"], m["Moneda"], cotizacion);
      return s + (cantidad * turnos * salarioARS);
    }, 0);

  // Gastos Financieros: 0 mientras no haya un escenario "Financiado"
  // activo (Fase 2, préstamo real) — se deja la línea para no tener
  // que rearmar el Estado de Resultados el día que exista.
  const gastosFinancieros = 0;

  // Valores calculados automático, antes de aplicar ningún ajuste manual.
  let ventasFinal = ventas.ingresos;
  let costoVariableFinal = costoVariableTotal;
  let costosFijosFinal = costosFijos;
  let amortizacionFinal = amortizacion;
  let manoDeObraFinal = manoDeObra;
  let gastosFinancierosFinal = gastosFinancieros;

  // Ajuste manual: lo que a veces no se registra bien automático se
  // puede pisar a mano por mes — solo se pisan los campos que tienen
  // un valor cargado, el resto sigue saliendo del cálculo de arriba.
  const ajuste = _finObtenerAjusteManual_(anio, mes1based) || {};
  const camposAjustados = {};
  if (ajuste.ventas !== undefined) { ventasFinal = ajuste.ventas; camposAjustados.ventas = true; }
  if (ajuste.costoVariable !== undefined) { costoVariableFinal = ajuste.costoVariable; camposAjustados.costoVariable = true; }
  if (ajuste.costosFijos !== undefined) { costosFijosFinal = ajuste.costosFijos; camposAjustados.costosFijos = true; }
  if (ajuste.amortizacion !== undefined) { amortizacionFinal = ajuste.amortizacion; camposAjustados.amortizacion = true; }
  if (ajuste.manoDeObra !== undefined) { manoDeObraFinal = ajuste.manoDeObra; camposAjustados.manoDeObra = true; }
  if (ajuste.gastosFinancieros !== undefined) { gastosFinancierosFinal = ajuste.gastosFinancieros; camposAjustados.gastosFinancieros = true; }

  const utilidadBrutaFinal = ventasFinal - costoVariableFinal;
  const resultadoAntesImpuestos = utilidadBrutaFinal - costosFijosFinal - amortizacionFinal - manoDeObraFinal - gastosFinancierosFinal;
  const impuesto = resultadoAntesImpuestos > 0 ? resultadoAntesImpuestos * _finImpuestoGananciasFraccion_() : 0;
  const resultadoNeto = resultadoAntesImpuestos - impuesto;

  const margenPorUnidad = ventas.unidadesEquipos > 0 ? (utilidadBrutaFinal / ventas.unidadesEquipos) : 0;
  const costosFijosTotalesParaPE = costosFijosFinal + amortizacionFinal + manoDeObraFinal;
  const puntoEquilibrioUnidades = margenPorUnidad > 0 ? Math.ceil(costosFijosTotalesParaPE / margenPorUnidad) : null;

  return {
    anio, mes: mes1based,
    ventas: ventasFinal,
    unidadesVendidas: ventas.unidadesEquipos,
    costoVariable: costoVariableFinal,
    utilidadBruta: utilidadBrutaFinal,
    costosFijos: costosFijosFinal,
    amortizacion: amortizacionFinal,
    manoDeObra: manoDeObraFinal,
    gastosFinancieros: gastosFinancierosFinal,
    resultadoAntesImpuestos,
    impuesto,
    resultadoNeto,
    margenPct: ventasFinal > 0 ? (resultadoNeto / ventasFinal) : 0,
    margenPorUnidad,
    puntoEquilibrioUnidades,
    cotizacionUsada: cotizacion.venta,
    tieneAjusteManual: Object.keys(camposAjustados).length > 0 || !!ajuste.notas,
    camposAjustados: camposAjustados,
    notasAjuste: ajuste.notas || ""
  };
}

/** Igual que calcularEstadoResultados() pero sumando/promediando enero..mes1based del año pedido — vista "acumulado anual". */
function calcularEstadoResultadosAcumulado(anio, hastaMes1based) {
  const meses = [];
  for (let m = 1; m <= hastaMes1based; m++) meses.push(calcularEstadoResultados(anio, m));

  const sum = (campo) => meses.reduce((s, r) => s + (Number(r[campo]) || 0), 0);
  const ventas = sum("ventas");
  const resultadoNeto = sum("resultadoNeto");

  return {
    anio, hastaMes: hastaMes1based,
    ventas,
    unidadesVendidas: sum("unidadesVendidas"),
    costoVariable: sum("costoVariable"),
    utilidadBruta: sum("utilidadBruta"),
    costosFijos: sum("costosFijos"),
    amortizacion: sum("amortizacion"),
    manoDeObra: sum("manoDeObra"),
    gastosFinancieros: sum("gastosFinancieros"),
    resultadoAntesImpuestos: sum("resultadoAntesImpuestos"),
    impuesto: sum("impuesto"),
    resultadoNeto,
    margenPct: ventas > 0 ? (resultadoNeto / ventas) : 0
  };
}

/** Últimos `cantidadMeses` (incluyendo el actual) para el gráfico de evolución — [{anio, mes, ventas, costoTotal, resultadoNeto}, ...] en orden cronológico. */
function obtenerEvolucionMensual(cantidadMeses) {
  cantidadMeses = Number(cantidadMeses) || 12;
  const hoy = new Date();
  const resultado = [];
  for (let i = cantidadMeses - 1; i >= 0; i--) {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const r = calcularEstadoResultados(fecha.getFullYear(), fecha.getMonth() + 1);
    resultado.push({
      anio: r.anio, mes: r.mes,
      ventas: r.ventas,
      costoTotal: r.costoVariable + r.costosFijos + r.amortizacion + r.manoDeObra,
      resultadoNeto: r.resultadoNeto
    });
  }
  return resultado;
}

/** Todo lo que necesita el Dashboard resumen de Finanzas en una sola llamada (mes actual + comparación contra el mes anterior). */
function obtenerResumenFinanzasDashboard() {
  const hoy = new Date();
  const actual = calcularEstadoResultados(hoy.getFullYear(), hoy.getMonth() + 1);
  const fechaAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const anterior = calcularEstadoResultados(fechaAnterior.getFullYear(), fechaAnterior.getMonth() + 1);
  const variacion = (campo) => {
    const base = Number(anterior[campo]) || 0;
    if (base === 0) return null;
    return ((Number(actual[campo]) || 0) - base) / Math.abs(base);
  };
  return {
    actual,
    variacionVentas: variacion("ventas"),
    variacionResultadoNeto: variacion("resultadoNeto")
  };
}
