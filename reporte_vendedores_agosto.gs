// ============================================================
//  REPORTE VENDEDORES — AGOSTO, con nombres unificados
//
//  Recorte de reporte_vendedores.gs enfocado en un solo mes, con dos
//  cosas extra:
//    1. Unifica alias de la misma persona: Lautaro/Lauti -> "Buda",
//       Maccari -> "Maca" (VENDEDORES_ALIAS, más abajo — tocar solo ahí
//       si hace falta agregar otro alias).
//    2. Cualquier "Vendedor" que, después de unificar alias, no sea uno
//       de los 3 vendedores reales conocidos (VENDEDORES_REALES) queda
//       marcado como SOSPECHOSO — y para esos casos se busca en
//       BACKUP_OPERACIONES si esa operación pasó alguna vez por una
//       anulación/corrección/reprogramación que haya dejado guardado un
//       valor de "Vendedor" distinto al actual (única fuente donde
//       puede haber quedado un rastro histórico distinto).
//
//  100% de solo lectura — no escribe nada en Preventas ni Ventas.
// ============================================================

const VENDEDORES_ALIAS_ = {
  "lautaro": "Buda", "lauti": "Buda", "buda": "Buda",
  "maccari": "Maca", "maca": "Maca"
};
const VENDEDORES_REALES_ = ["Buda", "Juani", "Maca"];

function _normalizarVendedor_(nombre) {
  const limpio = String(nombre || "").trim();
  const clave = limpio.toLowerCase();
  return VENDEDORES_ALIAS_[clave] || limpio;
}

/** Punto de entrada desde el menú: 🏪 GreatPhones → 📋 Anulaciones → "📅 Reporte vendedores de agosto". */
function generarReporteVendedoresAgosto() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const anio = new Date().getFullYear();
  const resultado = _calcularReporteVendedoresMes_(ss, anio, 8); // mes 8 = agosto (1-based)
  _escribirReporteVendedoresAgosto_(ss, resultado, anio);
  SpreadsheetApp.getUi().alert(
    "✅ Reporte de agosto generado",
    `Se creó/actualizó la hoja "REPORTE_VENDEDORES_AGOSTO".\n\n` +
    `Operaciones de agosto revisadas: ${resultado.totalOperaciones}\n` +
    `Sospechosas (vendedor fuera de Buda/Juani/Maca): ${resultado.sospechosas.length}`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function _calcularReporteVendedoresMes_(ss, anio, mes1based) {
  const preSheet = ss.getSheetByName("Preventas");
  const ventasSheet = ss.getSheetByName("Ventas");
  if (!preSheet || !ventasSheet) throw new Error("❌ Hojas 'Preventas' o 'Ventas' no encontradas.");

  const enElMes = (fecha) => fecha instanceof Date && fecha.getFullYear() === anio && (fecha.getMonth() + 1) === mes1based;

  const fEP = 2;
  const cNPre = getCol(preSheet, "N° Preventa", fEP);
  const cVendPre = getCol(preSheet, "Vendedor", fEP);
  const cFechaPre = getCol(preSheet, "Fecha Preventa", fEP);
  let cNVAsoc = -1;
  try { cNVAsoc = getCol(preSheet, "N° Venta Asociada", fEP); } catch (e) { /* opcional */ }

  const lastPre = preSheet.getLastRow();
  const datosPre = lastPre > fEP
    ? preSheet.getRange(fEP + 1, 1, lastPre - fEP, preSheet.getLastColumn()).getValues()
    : [];

  const ventaOrigenPreventa = {}; // { nVenta: { vendedorReal, nPre } } — de TODAS las preventas, no solo las de agosto (una venta de agosto puede venir de una preventa de otro mes)
  const conteoPreventas = {};
  const sospechosas = []; // [numero, tipo, vendedorNormalizado, fecha]

  datosPre.forEach(row => {
    const vendedorCrudo = String(row[cVendPre - 1] || "").trim();
    const vendedor = _normalizarVendedor_(vendedorCrudo);
    const nPre = String(row[cNPre - 1] || "").trim();
    const fecha = row[cFechaPre - 1];

    if (cNVAsoc > 0 && vendedor) {
      const nVenta = String(row[cNVAsoc - 1] || "").trim();
      if (nVenta) ventaOrigenPreventa[nVenta] = { vendedorReal: vendedor, nPre: nPre };
    }

    if (!enElMes(fecha)) return; // el conteo/sospecha es SOLO para lo cargado en el mes pedido

    if (vendedor) conteoPreventas[vendedor] = (conteoPreventas[vendedor] || 0) + 1;
    if (vendedor && !VENDEDORES_REALES_.includes(vendedor)) {
      sospechosas.push([nPre, "PREVENTA", vendedor, _fmtFecha_(fecha)]);
    }
  });

  const fEV = 2;
  const cNVenta = getCol(ventasSheet, "N° Venta", fEV);
  const cFechaV = getCol(ventasSheet, "Fecha Venta", fEV);
  let cOPVenta = -1;
  try { cOPVenta = getCol(ventasSheet, "OPERADOR", fEV); } catch (e) { /* opcional */ }

  const lastV = ventasSheet.getLastRow();
  const datosV = lastV > fEV
    ? ventasSheet.getRange(fEV + 1, 1, lastV - fEV, ventasSheet.getLastColumn()).getValues()
    : [];

  const conteoVentas = {};
  let totalVentasMes = 0;

  datosV.forEach(row => {
    const fecha = row[cFechaV - 1];
    if (!enElMes(fecha)) return;
    totalVentasMes++;

    const nVenta = String(row[cNVenta - 1] || "").trim();
    const origen = ventaOrigenPreventa[nVenta];
    const vendedor = origen ? origen.vendedorReal : _normalizarVendedor_(cOPVenta > 0 ? row[cOPVenta - 1] : "");

    if (vendedor) conteoVentas[vendedor] = (conteoVentas[vendedor] || 0) + 1;
    if (vendedor && !VENDEDORES_REALES_.includes(vendedor)) {
      sospechosas.push([nVenta, origen ? "VENTA (desde preventa " + origen.nPre + ")" : "VENTA directa", vendedor, _fmtFecha_(fecha)]);
    }
  });

  const totalPreventasMes = datosPre.filter(r => enElMes(r[cFechaPre - 1])).length;
  const totalOperaciones = totalPreventasMes + totalVentasMes;

  // Para cada sospechosa, buscar si BACKUP_OPERACIONES tiene algún snapshot
  // histórico con un "Vendedor" distinto al actual (única forma de encontrar
  // un rastro distinto — ver cabecera del archivo).
  const sospechosasConHistorial = sospechosas.map(fila => {
    const [numero, tipo, vendedorActual] = fila;
    const historial = _buscarVendedorEnBackups_(numero);
    return fila.concat([historial || "(sin backups — nunca se corrigió/reprogramó, no hay otro dato guardado)"]);
  });

  const totalPorVendedor = {};
  const sumar = (mapa) => Object.keys(mapa).forEach(v => { totalPorVendedor[v] = (totalPorVendedor[v] || 0) + mapa[v]; });
  sumar(conteoPreventas);
  sumar(conteoVentas);

  return {
    conteoPreventas: conteoPreventas,
    conteoVentas: conteoVentas,
    totalPorVendedor: totalPorVendedor,
    sospechosas: sospechosasConHistorial,
    totalOperaciones: totalOperaciones
  };
}

function _fmtFecha_(fecha) {
  return fecha instanceof Date ? Utilities.formatDate(fecha, Session.getScriptTimeZone(), "dd/MM/yyyy") : String(fecha || "");
}

/** Busca en BACKUP_OPERACIONES todos los snapshots de `numero` y devuelve, si encuentra alguno con un campo "Vendedor" distinto al valor más reciente, un texto describiendo qué encontró. Null si no hay backups o todos coinciden. */
function _buscarVendedorEnBackups_(numero) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("BACKUP_OPERACIONES");
  if (!hoja) return null;
  const fE = 2;
  const lastRow = hoja.getLastRow();
  if (lastRow <= fE) return null;

  const datos = hoja.getRange(fE + 1, 1, lastRow - fE, 8).getValues();
  const valoresVistos = []; // [{fecha, vendedor, accion}]

  datos.forEach(row => {
    if (String(row[4]).trim() !== String(numero).trim()) return;
    let snapshot;
    try { snapshot = JSON.parse(row[7]); } catch (e) { return; }
    const vendedor = snapshot && (snapshot.Vendedor || (snapshot.principal && snapshot.principal.Vendedor));
    if (vendedor) valoresVistos.push({ fecha: _fmtFecha_(row[1]), vendedor: String(vendedor).trim(), accion: row[5] });
  });

  if (valoresVistos.length === 0) return null;

  const distintos = [...new Set(valoresVistos.map(v => v.vendedor))];
  if (distintos.length <= 1) return `Backups encontrados (${valoresVistos.length}), todos con "Vendedor"="${distintos[0]}" — coincide con lo actual, no hay rastro de otro valor.`;

  return `⚠️ Encontré valores DISTINTOS en el historial: ` +
    valoresVistos.map(v => `"${v.vendedor}" (backup del ${v.fecha}, por ${v.accion})`).join(" | ");
}

function _escribirReporteVendedoresAgosto_(ss, r, anio) {
  const nombreHoja = "REPORTE_VENDEDORES_AGOSTO";
  let sheet = ss.getSheetByName(nombreHoja);
  if (sheet) sheet.clear();
  else sheet = ss.insertSheet(nombreHoja);

  let fila = 1;
  sheet.getRange(fila, 1).setValue(`RESUMEN — agosto ${anio}, nombres unificados (Buda=Lautaro=Lauti, Maca=Maccari)`).setFontWeight("bold");
  fila += 2;
  sheet.getRange(fila, 1, 1, 3).setValues([["Vendedor", "Preventas", "Ventas"]]).setFontWeight("bold");
  fila++;
  const vendedores = Object.keys(r.totalPorVendedor).sort((a, b) => r.totalPorVendedor[b] - r.totalPorVendedor[a]);
  vendedores.forEach(v => {
    sheet.getRange(fila, 1, 1, 3).setValues([[v, r.conteoPreventas[v] || 0, r.conteoVentas[v] || 0]]);
    fila++;
  });

  fila += 2;
  sheet.getRange(fila, 1).setValue("SOSPECHOSAS — vendedor fuera de Buda/Juani/Maca, con lo que encontré en el historial de backups").setFontWeight("bold");
  fila += 2;
  sheet.getRange(fila, 1, 1, 5).setValues([["N° Operación", "Tipo", "Vendedor cargado", "Fecha", "Rastro en backups"]]).setFontWeight("bold");
  fila++;
  if (r.sospechosas.length === 0) {
    sheet.getRange(fila, 1).setValue("(ninguna)");
  } else {
    sheet.getRange(fila, 1, r.sospechosas.length, 5).setValues(r.sospechosas);
  }

  sheet.autoResizeColumns(1, 5);
}
