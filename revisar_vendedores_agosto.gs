// ============================================================
//  REVISAR VENDEDORES SOSPECHOSOS — AGOSTO (ventana desde el menú)
//
//  Las 27 operaciones que reporte_vendedores_agosto.gs marca como
//  "sospechosas" (vendedor cargado fuera de Buda/Juani/Maca) no tienen
//  ningún rastro histórico distinto guardado en el sistema — son
//  errores de carga manual, y solo el dueño sabe quién vendió cada una.
//  Esta ventana se los muestra con cliente + modelo (para reconocerlas)
//  y un desplegable Buda/Juani/Maca al lado de cada una; al confirmar,
//  aplica todas las correcciones elegidas de una vez.
//
//  Reutiliza VENDEDORES_ALIAS_/VENDEDORES_REALES_/_normalizarVendedor_
//  (reporte_vendedores_agosto.gs) y guardarBackupOperacion_/
//  registrarAuditoria_ (anulaciones.gs) — mismo criterio de trazabilidad
//  que cualquier otra corrección del sistema.
// ============================================================

/** Punto de entrada desde el menú: 🏪 GreatPhones → 📋 Anulaciones → "✏️ Revisar vendedores sospechosos (agosto)". */
function abrirRevisarVendedoresAgosto() {
  const anio = new Date().getFullYear();
  const filas = _obtenerSospechosasParaRevision_(anio, 8);

  if (filas.length === 0) {
    SpreadsheetApp.getUi().alert("✅ Nada para revisar", "No hay operaciones sospechosas en agosto — corré primero \"📅 Reporte vendedores de agosto\" si acabás de cargar algo nuevo.", SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  const filasJson = JSON.stringify(filas);
  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:14px;font-size:12.5px}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
    th{background:#154360;color:#fff;position:sticky;top:0}
    select{width:100%;padding:4px;font-size:12.5px}
    .btn{background:#154360;color:#fff;padding:10px 20px;border:none;border-radius:4px;
         cursor:pointer;margin-top:14px;width:100%;font-size:13px}
    .btn:hover{background:#0E2F44}
    .btn:disabled{background:#aaa;cursor:default}
    #resultado{white-space:pre-wrap;font-family:Consolas,monospace;font-size:11px;
                margin-top:12px;max-height:200px;overflow:auto;background:#F8F9FA;
                border:1px solid #dee2e6;border-radius:4px;padding:8px}
    .wrap{max-height:420px;overflow:auto}
  </style>
  <h3 style="color:#154360;margin:0 0 6px">✏️ Revisar vendedores sospechosos — agosto</h3>
  <div style="font-size:11.5px;color:#666;margin-bottom:6px">
    Estas ${filas.length} operaciones tienen un vendedor cargado que no es Buda, Juani ni Maca,
    y no quedó ningún otro dato guardado en el sistema. Elegí el vendedor real de cada una que
    reconozcas (dejá "— No cambiar —" en las que no sepas) y confirmá.
  </div>
  <div class="wrap">
  <table>
    <thead><tr><th>N°</th><th>Tipo</th><th>Cargado</th><th>Fecha</th><th>Cliente</th><th>Modelo</th><th>Vendedor real</th></tr></thead>
    <tbody id="filas"></tbody>
  </table>
  </div>
  <button class="btn" id="btnEnviar" onclick="enviar()">✅ Aplicar correcciones</button>
  <div id="resultado"></div>
  <script>
    const FILAS = ${filasJson};
    const tbody = document.getElementById("filas");
    FILAS.forEach((f, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + f.numero + "</td><td>" + f.tipo + "</td><td>" + f.vendedorCargado + "</td>" +
        "<td>" + f.fecha + "</td><td>" + f.cliente + "</td><td>" + f.modelo + "</td>" +
        "<td><select id='sel-" + i + "'>" +
          "<option value=''>— No cambiar —</option>" +
          "<option value='Buda'>Buda</option>" +
          "<option value='Juani'>Juani</option>" +
          "<option value='Maca'>Maca</option>" +
        "</select></td>";
      tbody.appendChild(tr);
    });

    function enviar(){
      const correcciones = [];
      FILAS.forEach((f, i) => {
        const valor = document.getElementById("sel-" + i).value;
        if (valor) correcciones.push({ numero: f.numero, tipo: f.tipoInterno, nuevoVendedor: valor });
      });
      if (correcciones.length === 0) { alert("No elegiste ningún vendedor todavía."); return; }
      document.getElementById("btnEnviar").disabled = true;
      document.getElementById("resultado").textContent = "Aplicando " + correcciones.length + " corrección(es)...";
      google.script.run
        .withSuccessHandler(function(msg){
          document.getElementById("resultado").textContent = msg;
          document.getElementById("btnEnviar").disabled = false;
        })
        .withFailureHandler(function(e){
          document.getElementById("resultado").textContent = "❌ " + e.message;
          document.getElementById("btnEnviar").disabled = false;
        })
        .aplicarCorreccionesVendedorAgosto(correcciones);
    }
  </script>
  `).setWidth(820).setHeight(560);

  SpreadsheetApp.getUi().showModalDialog(html, "Revisar vendedores sospechosos — agosto");
}

/** Igual que la lista de "sospechosas" del reporte, pero agregando Cliente/Modelo para poder reconocer cada operación, y el campo `tipoInterno` ("PREVENTA"/"VENTA") que necesita aplicarCorreccionesVendedorAgosto(). */
function _obtenerSospechosasParaRevision_(anio, mes1based) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const preSheet = ss.getSheetByName("Preventas");
  const ventasSheet = ss.getSheetByName("Ventas");
  const fE = 2;
  const enElMes = (fecha) => fecha instanceof Date && fecha.getFullYear() === anio && (fecha.getMonth() + 1) === mes1based;

  const cNPre = getCol(preSheet, "N° Preventa", fE);
  const cVendPre = getCol(preSheet, "Vendedor", fE);
  const cFechaPre = getCol(preSheet, "Fecha Preventa", fE);
  const cClPre = getCol(preSheet, "Cliente", fE);
  const cModPre = getCol(preSheet, "Modelo Solicitado", fE);
  let cNVAsoc = -1;
  try { cNVAsoc = getCol(preSheet, "N° Venta Asociada", fE); } catch (e) { /* opcional */ }

  const lastPre = preSheet.getLastRow();
  const datosPre = lastPre > fE ? preSheet.getRange(fE + 1, 1, lastPre - fE, preSheet.getLastColumn()).getValues() : [];

  const ventaOrigenPreventa = {};
  const resultado = [];

  datosPre.forEach(row => {
    const vendedorCrudo = String(row[cVendPre - 1] || "").trim();
    const vendedor = _normalizarVendedor_(vendedorCrudo);
    const nPre = String(row[cNPre - 1] || "").trim();
    const fecha = row[cFechaPre - 1];

    if (cNVAsoc > 0 && vendedor) {
      const nVenta = String(row[cNVAsoc - 1] || "").trim();
      if (nVenta) ventaOrigenPreventa[nVenta] = { vendedorReal: vendedor, nPre: nPre };
    }

    if (!enElMes(fecha)) return;
    if (vendedor && !VENDEDORES_REALES_.includes(vendedor)) {
      resultado.push({
        numero: nPre, tipoInterno: "PREVENTA", tipo: "Preventa",
        vendedorCargado: vendedorCrudo, fecha: _fmtFecha_(fecha),
        cliente: String(row[cClPre - 1] || ""), modelo: String(row[cModPre - 1] || "")
      });
    }
  });

  const cNVenta = getCol(ventasSheet, "N° Venta", fE);
  const cFechaV = getCol(ventasSheet, "Fecha Venta", fE);
  const cClV = getCol(ventasSheet, "Cliente", fE);
  const cModV = getCol(ventasSheet, "Modelo", fE);
  let cOPVenta = -1;
  try { cOPVenta = getCol(ventasSheet, "OPERADOR", fE); } catch (e) { /* opcional */ }

  const lastV = ventasSheet.getLastRow();
  const datosV = lastV > fE ? ventasSheet.getRange(fE + 1, 1, lastV - fE, ventasSheet.getLastColumn()).getValues() : [];

  datosV.forEach(row => {
    const fecha = row[cFechaV - 1];
    if (!enElMes(fecha)) return;
    const nVenta = String(row[cNVenta - 1] || "").trim();
    const origen = ventaOrigenPreventa[nVenta];
    const vendedorCrudo = origen ? origen.vendedorReal : (cOPVenta > 0 ? String(row[cOPVenta - 1] || "").trim() : "");
    const vendedor = _normalizarVendedor_(vendedorCrudo);

    if (vendedor && !VENDEDORES_REALES_.includes(vendedor)) {
      resultado.push({
        numero: nVenta, tipoInterno: "VENTA", tipo: origen ? "Venta (de " + origen.nPre + ")" : "Venta directa",
        vendedorCargado: vendedorCrudo, fecha: _fmtFecha_(fecha),
        cliente: String(row[cClV - 1] || ""), modelo: String(row[cModV - 1] || "")
      });
    }
  });

  return resultado;
}

/** Llamada desde la ventana: aplica cada {numero, tipo, nuevoVendedor} — PREVENTA corrige "Vendedor" Y "OPERADOR"; VENTA corrige solo "OPERADOR" (no tiene columna "Vendedor" propia). Con backup + auditoría por fila. */
function aplicarCorreccionesVendedorAgosto(correcciones) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const fE = 2;
  let aplicadas = 0;
  const errores = [];

  correcciones.forEach(c => {
    try {
      if (c.tipo === "PREVENTA") {
        const sheet = ss.getSheetByName("Preventas");
        const colId = getCol(sheet, "N° Preventa", fE);
        const colVend = getCol(sheet, "Vendedor", fE);
        const colOp = asegurarColumnaGenerica_(sheet, fE, "OPERADOR");
        const fila = _buscarFilaPorId_(sheet, fE, "N° Preventa", c.numero);
        if (fila === -1) throw new Error(`"${c.numero}" no encontrada en Preventas.`);
        const vendedorViejo = String(sheet.getRange(fila, colVend).getValue() || "");
        guardarBackupOperacion_("PREVENTA", c.numero, "CORRECCION_MANUAL_VENDEDOR_AGOSTO");
        sheet.getRange(fila, colVend).setValue(c.nuevoVendedor);
        sheet.getRange(fila, colOp).setValue(c.nuevoVendedor);
        registrarAuditoria_("PREVENTA", c.numero, "CORRECCION_MANUAL_VENDEDOR_AGOSTO",
          `Vendedor corregido a mano de "${vendedorViejo}" a "${c.nuevoVendedor}" (revisión de agosto, sin rastro histórico disponible — decisión del dueño).`);
      } else {
        const sheet = ss.getSheetByName("Ventas");
        const colOp = asegurarColumnaGenerica_(sheet, fE, "OPERADOR");
        const fila = _buscarFilaPorId_(sheet, fE, "N° Venta", c.numero);
        if (fila === -1) throw new Error(`"${c.numero}" no encontrada en Ventas.`);
        const operadorViejo = String(sheet.getRange(fila, colOp).getValue() || "");
        guardarBackupOperacion_("VENTA", c.numero, "CORRECCION_MANUAL_VENDEDOR_AGOSTO");
        sheet.getRange(fila, colOp).setValue(c.nuevoVendedor);
        registrarAuditoria_("VENTA", c.numero, "CORRECCION_MANUAL_VENDEDOR_AGOSTO",
          `OPERADOR corregido a mano de "${operadorViejo}" a "${c.nuevoVendedor}" (revisión de agosto, sin rastro histórico disponible — decisión del dueño).`);
      }
      aplicadas++;
    } catch (e) {
      errores.push(`${c.numero}: ${e.message}`);
    }
  });

  let msg = `✅ ${aplicadas} de ${correcciones.length} corrección(es) aplicada(s).`;
  if (errores.length > 0) msg += `\n\n⚠️ Errores:\n` + errores.join("\n");
  return msg;
}
