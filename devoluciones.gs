// ============================================================
//  DEVOLUCIONES — registro de devoluciones de dinero al cliente.
//
//  Mismo esqueleto que AJUSTES_CAJA/CAMBIO_MONEDA (Code.gs): hoja nueva
//  que se crea sola la primera vez, sin dependencias cruzadas (1 fila =
//  1 número), egreso de Caja por cada medio realmente usado (igual
//  criterio "Cambio 3" que Gastos: la caja USD conserva dólares reales,
//  la conversión a pesos solo se informa en observaciones).
//
//  Puede ir vinculada a una operación existente (N° Operación Asociada,
//  texto libre — no se valida contra ninguna hoja, es solo referencia
//  para trazabilidad manual) o quedar como registro suelto (campo
//  vacío) — pedido explícito: "que se puedan hacer de las dos maneras".
//  No toca stock: es pura y exclusivamente el movimiento de plata,
//  el stock se maneja aparte (ej. anulando la venta original).
// ============================================================

/** Crea (si no existe) la hoja Devoluciones con sus encabezados. Nunca la borra ni la reescribe si ya existe. */
function asegurarHojaDevoluciones_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName("Devoluciones");
  if (hoja) return hoja;

  hoja = ss.insertSheet("Devoluciones");
  hoja.getRange(1, 1).setValue("💵 Devoluciones — devoluciones de dinero al cliente");
  const encabezados = [
    "N° Devolución", "Fecha", "OPERADOR", "Cliente", "N° Operación Asociada",
    "Motivo", "Monto Efectivo", "Monto Transferencia", "Monto USD", "Observaciones", "Estado"
  ];
  hoja.getRange(1, 1, 1, encabezados.length).merge().setFontWeight("bold").setBackground("#1A252F").setFontColor("#FFFFFF");
  hoja.getRange(2, 1, 1, encabezados.length).setValues([encabezados])
    .setFontWeight("bold").setBackground("#1A5276").setFontColor("#FFFFFF");
  hoja.setFrozenRows(2);
  return hoja;
}

/**
 * procesarDevolucion(d)
 * d = { fecha, operador, cliente, nOpAsociada, motivo, efec, transf, usd, obs }
 * `usd` es cantidad de dólares (no pesos) — mismo criterio "Cambio 3" que
 * todo el sistema. Requiere al menos un medio de pago > 0 y un motivo.
 */
function procesarDevolucion(d) {
  const t0 = Date.now();
  const sheet = asegurarHojaDevoluciones_();

  if (!String(d.motivo || "").trim()) throw new Error("❌ Ingresá el motivo de la devolución.");

  const efec = Number(d.efec) || 0;
  const transf = Number(d.transf) || 0;
  const usd = Number(d.usd) || 0;
  if (efec <= 0 && transf <= 0 && usd <= 0) throw new Error("❌ Ingresá al menos un medio de pago devuelto (efectivo, transferencia o USD).");

  const cotizacion = obtenerCotizacionUSD();
  const usdEnPesos = convertirUSDaPesos_(usd, cotizacion);

  const fE = 2;
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => {
    const i = hdrs.findIndex(h => String(h).trim() === n);
    if (i === -1) throw new Error(`❌ Columna "${n}" no encontrada en "Devoluciones" (fila ${fE}).`);
    return i;
  };
  const cND = idx("N° Devolución"), cFE = idx("Fecha"), cOP = idx("OPERADOR"), cCL = idx("Cliente"),
        cOA = idx("N° Operación Asociada"), cMO = idx("Motivo"), cME = idx("Monto Efectivo"),
        cMT = idx("Monto Transferencia"), cUSD = idx("Monto USD"), cOBS = idx("Observaciones"), cEST = idx("Estado");

  const nDev = genCorrelativo(sheet, cND + 1, "DEV", fE + 1);
  const fila = getFilaVacia(sheet, cND + 1, fE + 1);

  const filaData = new Array(hdrs.length).fill("");
  filaData[cND]  = nDev;
  filaData[cFE]  = parseDate(d.fecha);
  filaData[cOP]  = d.operador || "";
  filaData[cCL]  = String(d.cliente || "").trim();
  filaData[cOA]  = String(d.nOpAsociada || "").trim();
  filaData[cMO]  = d.motivo.trim();
  filaData[cME]  = efec;
  filaData[cMT]  = transf;
  filaData[cUSD] = usd;
  filaData[cOBS] = d.obs || "";
  filaData[cEST] = "PROCESADA";

  sheet.getRange(fila, 1, 1, hdrs.length).setValues([filaData]);
  sheet.getRange(fila, cFE + 1).setNumberFormat("dd/mm/yyyy");
  sheet.getRange(fila, cME + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cMT + 1).setNumberFormat("$#,##0");

  const obsUSD = usd > 0
    ? `${d.obs ? d.obs + " | " : ""}USD: ${usd} | USD_COTIZACION: ${fmtPeso(cotizacion.venta)} | USD_CONVERTIDO: ${fmtPeso(usdEnPesos)}`
    : d.obs;
  const descBase = `Devolución${d.nOpAsociada ? " (" + String(d.nOpAsociada).trim() + ")" : ""} a ${d.cliente || "cliente"}: ${d.motivo.trim()}`;
  const medios = [
    { medio: "Efectivo",      monto: efec,   obs: d.obs },
    { medio: "Transferencia", monto: transf, obs: d.obs },
    { medio: "USD",           monto: usd,    obs: obsUSD }
  ];
  medios.forEach(m => {
    if (m.monto <= 0) return;
    libroLog({
      origen: "DEVOLUCION", idOperacion: nDev,
      descripcion: descBase,
      categoria: "DEVOLUCION", tipo: "EGRESO",
      medio: m.medio, monto: m.monto, referencia: d.nOpAsociada || "",
      observaciones: m.obs, registradoPor: d.operador || ""
    });
  });

  registrarAuditoria_("DEVOLUCION", nDev, "ALTA", descBase);

  Logger.log("procesarDevolucion: " + (Date.now() - t0) + " ms");
  const montoTotal = efec + transf + usdEnPesos;
  return `✅ Devolución registrada.\nN°: ${nDev}\nCliente: ${d.cliente || "—"}\nMonto: ${fmtPeso(montoTotal)}` +
    (usd > 0 ? `\nUSD: ${usd} → ${fmtPeso(usdEnPesos)} (cotización ${fmtPeso(cotizacion.venta)})` : ``);
}
