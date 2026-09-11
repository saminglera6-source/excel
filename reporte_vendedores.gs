// ============================================================
//  REPORTE VENDEDORES REAL — diagnóstico de la corrupción de OPERADOR
//  causada por procesarEntregaPreventaConOperador() (operadores.gs), que
//  pisaba la columna OPERADOR de la Preventa y de la Venta generada con
//  el nombre de quien ENTREGÓ el equipo, no de quien lo VENDIÓ.
//
//  Este archivo NO escribe nada en Preventas ni en Ventas — es de solo
//  lectura. Genera una hoja nueva "REPORTE_VENDEDORES_REAL" con el
//  conteo correcto de operaciones por vendedor, usando como fuente de
//  verdad:
//    - Preventas: columna "Vendedor" (se escribe una sola vez al crear
//      la preventa, nunca se vuelve a tocar — no se corrompe).
//    - Ventas SIN preventa de origen: columna "OPERADOR" tal cual (esas
//      nunca las toca la entrega de una preventa, están bien).
//    - Ventas CON preventa de origen (generadas al entregar una
//      preventa): se les asigna el "Vendedor" de la Preventa que las
//      originó, ignorando su propia columna "OPERADOR" (esa sí está
//      corrompida con el nombre de quien entregó, no de quien vendió).
// ============================================================

/** Punto de entrada desde el menú: 🏪 GreatPhones → 📋 Anulaciones → "📈 Reporte vendedor real". */
function generarReporteVendedoresReal() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultado = _calcularReporteVendedoresReal_(ss);
  _escribirReporteVendedoresReal_(ss, resultado);
  SpreadsheetApp.getUi().alert(
    "✅ Reporte generado",
    `Se creó/actualizó la hoja "REPORTE_VENDEDORES_REAL" con el detalle.\n\n` +
    `Operaciones revisadas: ${resultado.totalOperaciones}\n` +
    `Con OPERADOR corrompido (distinto del vendedor real): ${resultado.totalDiscrepancias}`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/** Misma lógica, pero pensada para llamarse desde la Web App si hiciera falta (google.script.run) — devuelve el objeto de resultado en vez de escribir/alertar. */
function obtenerReporteVendedoresReal() {
  return _calcularReporteVendedoresReal_(SpreadsheetApp.getActiveSpreadsheet());
}

function _calcularReporteVendedoresReal_(ss) {
  const preSheet = ss.getSheetByName("Preventas");
  const ventasSheet = ss.getSheetByName("Ventas");
  if (!preSheet || !ventasSheet) throw new Error("❌ Hojas 'Preventas' o 'Ventas' no encontradas.");

  const fEP = 2;
  const cNPre = getCol(preSheet, "N° Preventa", fEP);
  const cVendPre = getCol(preSheet, "Vendedor", fEP);
  let cNVAsoc = -1, cOPPre = -1;
  try { cNVAsoc = getCol(preSheet, "N° Venta Asociada", fEP); } catch (e) { /* columna opcional, se crea recién en la primera entrega */ }
  try { cOPPre = getCol(preSheet, "OPERADOR", fEP); } catch (e) { /* columna opcional */ }

  const lastPre = preSheet.getLastRow();
  const datosPre = lastPre > fEP
    ? preSheet.getRange(fEP + 1, 1, lastPre - fEP, preSheet.getLastColumn()).getValues()
    : [];

  // Mapa "N° Venta Asociada" -> vendedor real (el de la Preventa que la originó)
  const ventaOrigenPreventa = {}; // { nVenta: { vendedor, nPre } }
  const conteoPreventas = {}; // { vendedor: cantidad }
  let preventasSinVendedor = 0;
  const detallePreventasDiscrepancia = []; // filas donde Preventas.OPERADOR (corrompido por la entrega) != Preventas.Vendedor

  datosPre.forEach(row => {
    const vendedor = String(row[cVendPre - 1] || "").trim();
    const nPre = String(row[cNPre - 1] || "").trim();
    if (!vendedor) { preventasSinVendedor++; }
    else { conteoPreventas[vendedor] = (conteoPreventas[vendedor] || 0) + 1; }

    if (cNVAsoc > 0) {
      const nVenta = String(row[cNVAsoc - 1] || "").trim();
      if (nVenta && vendedor) ventaOrigenPreventa[nVenta] = { vendedor: vendedor, nPre: nPre };
    }

    if (cOPPre > 0 && vendedor) {
      const operadorGuardado = String(row[cOPPre - 1] || "").trim();
      if (operadorGuardado && operadorGuardado !== vendedor) {
        detallePreventasDiscrepancia.push([nPre, "PREVENTA", operadorGuardado, vendedor]);
      }
    }
  });

  const fEV = 2;
  const cNVenta = getCol(ventasSheet, "N° Venta", fEV);
  let cOPVenta = -1;
  try { cOPVenta = getCol(ventasSheet, "OPERADOR", fEV); } catch (e) { /* columna opcional */ }

  const lastV = ventasSheet.getLastRow();
  const datosV = lastV > fEV
    ? ventasSheet.getRange(fEV + 1, 1, lastV - fEV, ventasSheet.getLastColumn()).getValues()
    : [];

  const conteoVentasDirectas = {}; // { vendedor: cantidad } — ventas sin preventa de origen
  const conteoVentasDesdePreventa = {}; // { vendedor: cantidad } — ventas generadas al entregar una preventa
  const detalleDiscrepancias = []; // filas donde OPERADOR (corrompido) != vendedor real
  let ventasSinOperador = 0;

  datosV.forEach(row => {
    const nVenta = String(row[cNVenta - 1] || "").trim();
    const operadorGuardado = cOPVenta > 0 ? String(row[cOPVenta - 1] || "").trim() : "";
    const origen = ventaOrigenPreventa[nVenta];

    if (origen) {
      // Esta venta nació de entregar una preventa: el vendedor REAL es el
      // de la preventa, no el OPERADOR que quedó pisado por la entrega.
      conteoVentasDesdePreventa[origen.vendedor] = (conteoVentasDesdePreventa[origen.vendedor] || 0) + 1;
      if (operadorGuardado && operadorGuardado !== origen.vendedor) {
        detalleDiscrepancias.push([nVenta, "VENTA (desde preventa " + origen.nPre + ")", operadorGuardado, origen.vendedor]);
      }
    } else {
      // Venta directa, nunca tocada por una entrega de preventa: su
      // OPERADOR es confiable tal cual.
      if (!operadorGuardado) { ventasSinOperador++; }
      else { conteoVentasDirectas[operadorGuardado] = (conteoVentasDirectas[operadorGuardado] || 0) + 1; }
    }
  });

  // Total combinado por vendedor real (preventas + todas las ventas, ya reatribuidas)
  const totalPorVendedor = {};
  const sumar = (mapa) => Object.keys(mapa).forEach(v => { totalPorVendedor[v] = (totalPorVendedor[v] || 0) + mapa[v]; });
  sumar(conteoPreventas);
  sumar(conteoVentasDirectas);
  sumar(conteoVentasDesdePreventa);

  const todasLasDiscrepancias = detallePreventasDiscrepancia.concat(detalleDiscrepancias);

  return {
    conteoPreventas: conteoPreventas,
    conteoVentasDirectas: conteoVentasDirectas,
    conteoVentasDesdePreventa: conteoVentasDesdePreventa,
    totalPorVendedor: totalPorVendedor,
    detalleDiscrepancias: todasLasDiscrepancias,
    preventasSinVendedor: preventasSinVendedor,
    ventasSinOperador: ventasSinOperador,
    totalOperaciones: datosPre.length + datosV.length,
    totalDiscrepancias: todasLasDiscrepancias.length
  };
}

function _escribirReporteVendedoresReal_(ss, r) {
  let sheet = ss.getSheetByName("REPORTE_VENDEDORES_REAL");
  if (sheet) sheet.clear();
  else sheet = ss.insertSheet("REPORTE_VENDEDORES_REAL");

  const vendedores = Object.keys(r.totalPorVendedor).sort((a, b) => r.totalPorVendedor[b] - r.totalPorVendedor[a]);

  let fila = 1;
  sheet.getRange(fila, 1).setValue("RESUMEN — cantidad real de operaciones por vendedor").setFontWeight("bold");
  fila += 2;
  sheet.getRange(fila, 1, 1, 4).setValues([["Vendedor", "Preventas", "Ventas (todas, ya corregidas)", "TOTAL"]]).setFontWeight("bold");
  fila++;
  vendedores.forEach(v => {
    const preventas = r.conteoPreventas[v] || 0;
    const ventas = (r.conteoVentasDirectas[v] || 0) + (r.conteoVentasDesdePreventa[v] || 0);
    sheet.getRange(fila, 1, 1, 4).setValues([[v, preventas, ventas, r.totalPorVendedor[v]]]);
    fila++;
  });

  fila += 2;
  sheet.getRange(fila, 1).setValue("DETALLE — operaciones donde el OPERADOR guardado NO coincide con el vendedor real").setFontWeight("bold");
  fila += 2;
  sheet.getRange(fila, 1, 1, 4).setValues([["N° Operación", "Tipo", "OPERADOR guardado (corrompido)", "Vendedor real"]]).setFontWeight("bold");
  fila++;
  if (r.detalleDiscrepancias.length === 0) {
    sheet.getRange(fila, 1).setValue("(ninguna — no se encontraron discrepancias)");
    fila++;
  } else {
    sheet.getRange(fila, 1, r.detalleDiscrepancias.length, 4).setValues(r.detalleDiscrepancias);
    fila += r.detalleDiscrepancias.length;
  }

  fila += 2;
  sheet.getRange(fila, 1).setValue(`Preventas sin vendedor cargado: ${r.preventasSinVendedor}`);
  fila++;
  sheet.getRange(fila, 1).setValue(`Ventas directas sin OPERADOR cargado: ${r.ventasSinOperador}`);

  sheet.autoResizeColumns(1, 4);
}
