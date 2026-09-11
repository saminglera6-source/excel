// ============================================================
//  REPORTE FINAL — total real de ventas (Preventas + Ventas), sin
//  duplicar la misma operación y con el vendedor ya corregido.
//
//  100% de solo lectura. Junta todo lo que se armó en esta sesión:
//  - Excluye ANULADO/Cancelado (no cuentan).
//  - Cada Preventa entregada + su Venta generada es UNA sola operación
//    real (no dos) — se cuenta una vez, con el monto de la Venta si
//    existe (más preciso: incluye ajustes de la entrega), si no con el
//    de la Preventa.
//  - Vendedor: "Vendedor" de Preventas / "OPERADOR" de Ventas directas
//    (después de la reparación de operadores.gs y de las correcciones
//    manuales ya aplicadas), con los mismos alias unificados que
//    reporte_vendedores_agosto.gs (Buda=Lautaro=Lauti, Maca=Maccari) —
//    PERO sin restringir a una lista fija de vendedores "reales": acá
//    se muestra tal cual está cargado, para que se vea cualquier
//    nombre que todavía necesite revisión.
// ============================================================

/** Punto de entrada desde el menú: 🏪 GreatPhones → 📋 Anulaciones → "🏁 Reporte final de ventas reales (todo)". */
function generarReporteFinalVentasReales() {
  _generarReporteFinalVentasInterno_(null, null, "REPORTE_FINAL_VENTAS_REALES");
}

/** Punto de entrada desde el menú: 🏪 GreatPhones → 📋 Anulaciones → "🏁 Reporte final de ventas reales — SOLO agosto". Misma lógica, pero solo cuenta operaciones cuya fecha (la de la Venta si la preventa ya se entregó, si no la de la Preventa/Venta directa) cae en agosto del año actual. */
function generarReporteFinalVentasRealesAgosto() {
  const anio = new Date().getFullYear();
  _generarReporteFinalVentasInterno_(anio, 8, "REPORTE_FINAL_VENTAS_AGOSTO");
}

function _generarReporteFinalVentasInterno_(filtroAnio, filtroMes1based, nombreHoja) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = _calcularReporteFinalVentas_(ss, filtroAnio, filtroMes1based);
  _escribirReporteFinalVentas_(ss, r, nombreHoja);
  SpreadsheetApp.getUi().alert(
    "✅ Reporte generado",
    `Se creó/actualizó la hoja "${nombreHoja}".\n\n` +
    `TOTAL de operaciones reales (sin duplicar, sin anuladas/canceladas): ${r.totalOperaciones}\n` +
    `Monto total vendido: ${_fmtPeso_(r.montoTotal)}`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function _fmtPeso_(n) {
  return "$" + Math.round(n).toLocaleString("es-AR");
}

function _calcularReporteFinalVentas_(ss, filtroAnio, filtroMes1based) {
  const filtrar = filtroAnio != null && filtroMes1based != null;
  const enElMes_ = (fecha) => !filtrar || (fecha instanceof Date && fecha.getFullYear() === filtroAnio && (fecha.getMonth() + 1) === filtroMes1based);

  const preSheet = ss.getSheetByName("Preventas");
  const ventasSheet = ss.getSheetByName("Ventas");
  if (!preSheet || !ventasSheet) throw new Error("❌ Hojas 'Preventas' o 'Ventas' no encontradas.");

  const fE = 2;
  const pre = _leerHojaCompleta_(preSheet, fE);
  const vta = _leerHojaCompleta_(ventasSheet, fE);

  const pNP = _idxCol_(pre.headers, "N° Preventa");
  const pCL = _idxCol_(pre.headers, "Cliente");
  const pMO = _idxCol_(pre.headers, "Modelo Solicitado");
  const pPV = _idxCol_(pre.headers, "Precio Venta Pactado");
  const pFE = _idxCol_(pre.headers, "Fecha Preventa");
  const pES = _idxCol_(pre.headers, "Estado");
  const pNV = _idxCol_(pre.headers, "N° Venta Asociada");
  const pER = _idxCol_(pre.headers, "ESTADO_REGISTRO");
  const pVD = _idxCol_(pre.headers, "Vendedor");

  const vNV = _idxCol_(vta.headers, "N° Venta");
  const vCL = _idxCol_(vta.headers, "Cliente");
  const vMO = _idxCol_(vta.headers, "Modelo");
  const vPV = _idxCol_(vta.headers, "Precio Venta");
  const vFE = _idxCol_(vta.headers, "Fecha Venta");
  const vER = _idxCol_(vta.headers, "ESTADO_REGISTRO");
  const vOP = _idxCol_(vta.headers, "OPERADOR");

  const ventasPorNumero = {};
  vta.datos.forEach(row => { ventasPorNumero[String(row[vNV] || "").trim()] = row; });
  const ventasUsadasPorPreventa = new Set();

  const operaciones = []; // [{numero, tipo, vendedor, cliente, modelo, fecha, monto}]

  // ---- 1) Preventas: cada una activa cuenta UNA vez ----
  pre.datos.forEach(row => {
    const anulada = pER >= 0 && String(row[pER] || "").trim() === "ANULADO";
    if (anulada) return;
    const estado = String(row[pES] || "");
    if (estado.includes("Cancelado")) return;

    const nPre = String(row[pNP] || "").trim();
    const vendedor = _normalizarVendedor_(String(row[pVD] || "").trim());
    const nVentaAsoc = pNV >= 0 ? String(row[pNV] || "").trim() : "";
    const ventaRow = nVentaAsoc ? ventasPorNumero[nVentaAsoc] : null;
    const ventaAnulada = ventaRow && vER >= 0 && String(ventaRow[vER] || "").trim() === "ANULADO";

    if (ventaRow && !ventaAnulada) {
      // Preventa entregada con venta activa: UNA sola operación, con el
      // monto/fecha de la Venta (más preciso — incluye ajustes de entrega).
      const fechaReal = vFE >= 0 ? ventaRow[vFE] : row[pFE];
      // Cuenta una sola vez, sin importar el filtro de mes, si su fecha real
      // (la de la Venta, no la de la Preventa) cae en el mes pedido — una
      // preventa de julio entregada en agosto SÍ es una venta de agosto.
      ventasUsadasPorPreventa.add(nVentaAsoc);
      if (!enElMes_(fechaReal)) return;
      operaciones.push({
        numero: nPre + " / " + nVentaAsoc, tipo: "Preventa entregada",
        vendedor: vendedor, cliente: String(row[pCL] || ""), modelo: String(row[pMO] || ""),
        fecha: _fmtFecha_(fechaReal),
        monto: vPV >= 0 ? (Number(ventaRow[vPV]) || 0) : (Number(row[pPV]) || 0)
      });
    } else {
      // Preventa activa sin venta (todavía no entregada) o con venta
      // anulada ya reparada (no debería quedar ninguna así después de la
      // limpieza) — igual cuenta como una operación real (dinero cobrado),
      // contada en el mes en que se CARGÓ la preventa (ahí se cobró).
      if (!enElMes_(row[pFE])) return;
      operaciones.push({
        numero: nPre, tipo: "Preventa (pendiente de entrega)",
        vendedor: vendedor, cliente: String(row[pCL] || ""), modelo: String(row[pMO] || ""),
        fecha: _fmtFecha_(row[pFE]), monto: Number(row[pPV]) || 0
      });
    }
  });

  // ---- 2) Ventas directas (nunca vinculadas a ninguna preventa) ----
  vta.datos.forEach(row => {
    const anulada = vER >= 0 && String(row[vER] || "").trim() === "ANULADO";
    if (anulada) return;
    const nVenta = String(row[vNV] || "").trim();
    if (ventasUsadasPorPreventa.has(nVenta)) return; // ya contada arriba, junto a su preventa
    if (!enElMes_(row[vFE])) return;

    operaciones.push({
      numero: nVenta, tipo: "Venta directa",
      vendedor: _normalizarVendedor_(vOP >= 0 ? String(row[vOP] || "").trim() : ""),
      cliente: String(row[vCL] || ""), modelo: String(row[vMO] || ""),
      fecha: _fmtFecha_(row[vFE]), monto: vPV >= 0 ? (Number(row[vPV]) || 0) : 0
    });
  });

  const porVendedor = {}; // { vendedor: {cantidad, monto} }
  operaciones.forEach(op => {
    const key = op.vendedor || "(sin vendedor cargado)";
    if (!porVendedor[key]) porVendedor[key] = { cantidad: 0, monto: 0 };
    porVendedor[key].cantidad++;
    porVendedor[key].monto += op.monto;
  });

  const montoTotal = operaciones.reduce((s, op) => s + op.monto, 0);

  return { operaciones, porVendedor, totalOperaciones: operaciones.length, montoTotal };
}

function _escribirReporteFinalVentas_(ss, r, nombreHoja) {
  let sheet = ss.getSheetByName(nombreHoja);
  if (sheet) sheet.clear();
  else sheet = ss.insertSheet(nombreHoja);

  let fila = 1;
  sheet.getRange(fila, 1).setValue("RESUMEN — total real de ventas + preventas, sin duplicar, sin anuladas/canceladas").setFontWeight("bold");
  fila += 2;
  sheet.getRange(fila, 1, 1, 3).setValues([["Vendedor", "Cantidad", "Monto total"]]).setFontWeight("bold");
  fila++;
  const vendedores = Object.keys(r.porVendedor).sort((a, b) => r.porVendedor[b].cantidad - r.porVendedor[a].cantidad);
  vendedores.forEach(v => {
    sheet.getRange(fila, 1, 1, 3).setValues([[v, r.porVendedor[v].cantidad, _fmtPeso_(r.porVendedor[v].monto)]]);
    fila++;
  });
  sheet.getRange(fila, 1, 1, 3).setValues([["TOTAL", r.totalOperaciones, _fmtPeso_(r.montoTotal)]]).setFontWeight("bold");
  fila += 3;

  sheet.getRange(fila, 1).setValue("DETALLE — cada operación real contada una sola vez").setFontWeight("bold");
  fila += 2;
  sheet.getRange(fila, 1, 1, 7).setValues([["N° Operación", "Tipo", "Vendedor", "Cliente", "Modelo", "Fecha", "Monto"]]).setFontWeight("bold");
  fila++;
  r.operaciones.forEach(op => {
    sheet.getRange(fila, 1, 1, 7).setValues([[op.numero, op.tipo, op.vendedor, op.cliente, op.modelo, op.fecha, _fmtPeso_(op.monto)]]);
    fila++;
  });

  sheet.autoResizeColumns(1, 7);
}
