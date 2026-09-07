// ============================================================
//  FINANZAS — Costos, Deudas y Cosas a Pagar
//
//  Esta sección NO analiza ventas ni rentabilidad — es puramente
//  para que el dueño organice lo que el local tiene que pagar: los
//  costos fijos del mes (alquiler, servicios...), el costo variable
//  por equipo (funda, cable, etc.) y la mano de obra (sueldos). La
//  Agenda de Pagos (finanzas_pagos.gs) es la que organiza el día a
//  día de cuándo se paga cada cosa.
//
//  Vigencia, no borrado: cada costo (fijo, variable o de mano de obra)
//  se guarda con "Vigente Desde"/"Vigente Hasta". Editar un valor NO
//  pisa la fila vieja — la cierra (Vigente Hasta = hoy) y crea una fila
//  nueva, para tener el historial de cuánto se pagaba de cada cosa mes
//  a mes.
// ============================================================

const FIN_HOJA_COSTOS_FIJOS   = "FINANZAS_COSTOS_FIJOS";
const FIN_HOJA_COSTO_VARIABLE = "FINANZAS_COSTO_VARIABLE";
const FIN_HOJA_MANO_DE_OBRA   = "FINANZAS_MANO_DE_OBRA";

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
//  Helpers genéricos (compartidos por las 3 hojas de costos y por
//  finanzas_pagos.gs)
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
//  COSTO VARIABLE — accesorios de regalo, logística, etc. (costo por
//  equipo, más allá del sueldo/alquiler fijo del mes)
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
