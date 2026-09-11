// ============================================================
//  entrega_reparaciones.gs — Módulo "Entregar Reparación"
//  Vista dedicada (entregar_reparacion.html) para ver el estado de todas
//  las reparaciones abiertas (para reparar / reparándose / listas) y
//  registrar la entrega al cliente cuando ya están "🟢 Listo" — incluye
//  cobro final si quedó saldo pendiente del ingreso, y deja la reparación
//  en "✅ Retirado" (mismo estado terminal que ya usaba el botón rápido de
//  Mis Operaciones, actualizarEstadoReparacionWeb — no se modifica esa
//  función, esta es la vía "completa" con cobro + recibo).
// ============================================================

/**
 * obtenerReparacionesParaEntrega()
 *
 * Lee "Reparaciones" (solo lectura) y devuelve las reparaciones abiertas
 * agrupadas en 3 baldes según su Estado — "Retirado" y "Garantía" quedan
 * afuera (retirado ya se entregó; garantía es un reingreso que se maneja
 * por separado, no es parte del flujo normal de entrega).
 */
function obtenerReparacionesParaEntrega() {
  const cfg = getConfigCached();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg.HOJA_REPARACIONES || "Reparaciones");
  const resultado = { paraReparar: [], enProceso: [], listas: [] };
  if (!sheet) return resultado;

  const fE = 2;
  const cNR = getCol(sheet, "N° Rep",         fE);
  const cFE = getCol(sheet, "Fecha Ingreso",  fE);
  const cCL = getCol(sheet, "Cliente",        fE);
  const cTE = getCol(sheet, "Teléfono",       fE);
  const cEQ = getCol(sheet, "Equipo",         fE);
  const cF1 = getCol(sheet, "Falla 1",        fE);
  const cF2 = getCol(sheet, "Falla 2",        fE);
  const cES = getCol(sheet, "Estado",         fE);
  const cPC = getCol(sheet, "Precio Cobrado", fE);

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return resultado;

  const tz = Session.getScriptTimeZone();
  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();

  datos.forEach(row => {
    const numero = String(row[cNR - 1] || "").trim();
    if (!numero) return;
    const estado = String(row[cES - 1] || "").trim();
    if (estado.indexOf("Retirado") !== -1 || estado.indexOf("Garantía") !== -1) return;

    const fechaRaw = row[cFE - 1];
    let falla = String(row[cF1 - 1] || "");
    if (row[cF2 - 1]) falla += (falla ? " / " : "") + row[cF2 - 1];

    const item = {
      numero:  numero,
      fecha:   fechaRaw instanceof Date ? Utilities.formatDate(fechaRaw, tz, "dd/MM/yyyy") : String(fechaRaw || ""),
      cliente: String(row[cCL - 1] || ""),
      tel:     String(row[cTE - 1] || ""),
      equipo:  String(row[cEQ - 1] || ""),
      falla:   falla,
      estado:  estado,
      precioCobrado: Number(row[cPC - 1]) || 0
    };

    if (estado === "🟡 En Proceso") resultado.enProceso.push(item);
    else if (estado === "🟢 Listo") resultado.listas.push(item);
    else resultado.paraReparar.push(item); // PARA REPARAR / PARA DIAGNOSTICAR / cualquier otro estado abierto
  });

  return resultado;
}

/**
 * entregarReparacion(d)
 *
 * d = { numero, operador, efec, transf, obs }
 * Solo se puede entregar una reparación en estado "🟢 Listo" (mismo
 * criterio que ya usaba el botón rápido de Mis Operaciones). Si queda
 * cobro pendiente (efec/transf > 0), se suma a "Precio Cobrado"/"Cobrado
 * Efectivo"/"Cobrado Transferencia" ya existentes (no los reemplaza — el
 * ingreso pudo haber cobrado una seña) y se registra en Libro Diario.
 * Deja el estado en "✅ Retirado" y completa "Fecha Egreso" si no la tenía.
 */
function entregarReparacion(d) {
  const numero = String((d && d.numero) || "").trim();
  const operador = (d && d.operador) || "";
  if (!numero) throw new Error("❌ Falta el número de reparación.");
  if (!operador) throw new Error("❌ Falta el operador que entrega.");

  const cfg = getConfigCached();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg.HOJA_REPARACIONES || "Reparaciones");
  if (!sheet) throw new Error("❌ Hoja 'Reparaciones' no encontrada.");

  const fE = 2;
  const fila = _buscarFilaPorId_(sheet, fE, "N° Rep", numero);
  if (fila === -1) throw new Error(`❌ Reparación "${numero}" no encontrada.`);

  const cES = getCol(sheet, "Estado", fE);
  const estadoActual = String(sheet.getRange(fila, cES).getValue() || "").trim();
  if (estadoActual !== "🟢 Listo") {
    throw new Error(`❌ "${numero}" está en estado "${estadoActual || "—"}" — solo se puede entregar una reparación que ya está "🟢 Listo".`);
  }

  const efec  = Number(d.efec)  || 0;
  const transf = Number(d.transf) || 0;
  if (efec < 0 || transf < 0) throw new Error("❌ Los montos no pueden ser negativos.");

  const cPC = getCol(sheet, "Precio Cobrado",        fE);
  const cEF = getCol(sheet, "Cobrado Efectivo",       fE);
  const cTR = getCol(sheet, "Cobrado Transferencia",  fE);
  const cFE2 = getCol(sheet, "Fecha Egreso",          fE);
  const cOB = getCol(sheet, "Observaciones",          fE);
  const cOpEntrega = asegurarColumnaGenerica_(sheet, fE, "Operador Entrega");

  if (efec > 0 || transf > 0) {
    const precioActual = Number(sheet.getRange(fila, cPC).getValue()) || 0;
    const efecActual   = Number(sheet.getRange(fila, cEF).getValue()) || 0;
    const transfActual = Number(sheet.getRange(fila, cTR).getValue()) || 0;
    sheet.getRange(fila, cPC).setValue(precioActual + efec + transf).setNumberFormat("$#,##0");
    sheet.getRange(fila, cEF).setValue(efecActual + efec).setNumberFormat("$#,##0");
    sheet.getRange(fila, cTR).setValue(transfActual + transf).setNumberFormat("$#,##0");
  }

  sheet.getRange(fila, cES).setValue("✅ Retirado");
  if (!sheet.getRange(fila, cFE2).getValue()) {
    sheet.getRange(fila, cFE2).setValue(new Date()).setNumberFormat("dd/mm/yyyy");
  }
  sheet.getRange(fila, cOpEntrega).setValue(operador);
  if (d.obs) {
    const obsActual = sheet.getRange(fila, cOB).getValue();
    sheet.getRange(fila, cOB).setValue(obsActual ? obsActual + " | Entrega: " + d.obs : "Entrega: " + d.obs);
  }

  const equipo = String(sheet.getRange(fila, getCol(sheet, "Equipo", fE)).getValue() || "");
  const cliente = String(sheet.getRange(fila, getCol(sheet, "Cliente", fE)).getValue() || "");

  [
    { medio: "Efectivo",      monto: efec   },
    { medio: "Transferencia", monto: transf }
  ].forEach(m => {
    if (m.monto <= 0) return;
    libroLog({
      origen: "REPARACION", idOperacion: numero,
      descripcion: `Entrega reparación ${equipo} — ${cliente}`,
      categoria: "REPARACION", tipo: "INGRESO",
      medio: m.medio, monto: m.monto, referencia: numero,
      observaciones: d.obs || "", registradoPor: operador
    });
  });

  registrarAuditoria_("REPARACION", numero, "ENTREGADA",
    `Entregada por ${operador}.${(efec + transf) > 0 ? ` Cobro final: ${fmtPeso(efec + transf)}.` : ""}`);

  return `✅ Reparación entregada.\nN°: ${numero}\nEquipo: ${equipo}\nCliente: ${cliente}` +
    ((efec + transf) > 0 ? `\nCobro final: ${fmtPeso(efec + transf)}` : `\nSin cobro adicional en la entrega.`);
}
