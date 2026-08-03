// ============================================================
//  etiquetas.gs — Etiqueta imprimible de Reparación
//  Solo lectura sobre la hoja "Reparaciones" (usa getConfigCached()/getCol()
//  ya existentes, sin modificarlas). No registra nada, no usa Drive ni
//  DocumentApp, no genera QR: devuelve un documento HTML autocontenido que
//  el frontend abre en una ventana nueva e imprime.
// ============================================================

/**
 * generarEtiquetaReparacion(numeroReparacion)
 *
 * Busca la reparación por su N° Rep en "Reparaciones" y arma una etiqueta
 * imprimible de ~10cm x 5cm con: N° reparación, Fecha, Cliente, Teléfono,
 * Equipo, Falla y Observaciones.
 */
function generarEtiquetaReparacion(numeroReparacion) {
  const numero = String(numeroReparacion || "").trim();
  if (!numero) throw new Error("❌ Falta el número de reparación.");

  const cfg   = getConfigCached();
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg.HOJA_REPARACIONES || "Reparaciones");
  if (!sheet) throw new Error("❌ Hoja 'Reparaciones' no encontrada.");

  const fE  = 2;
  const cNR = getCol(sheet, "N° Rep",         fE);
  const cFE = getCol(sheet, "Fecha Ingreso",  fE);
  const cCL = getCol(sheet, "Cliente",        fE);
  const cTE = getCol(sheet, "Teléfono",       fE);
  const cEQ = getCol(sheet, "Equipo",         fE);
  const cF1 = getCol(sheet, "Falla 1",        fE);
  const cF2 = getCol(sheet, "Falla 2",        fE);
  const cOB = getCol(sheet, "Observaciones",  fE);

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) throw new Error(`❌ "${numero}" no encontrado en "Reparaciones".`);

  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  const fila = datos.find(r => String(r[cNR - 1]).trim() === numero);
  if (!fila) throw new Error(`❌ "${numero}" no encontrado en "Reparaciones".`);

  const fechaRaw = fila[cFE - 1];
  const fecha = fechaRaw instanceof Date
    ? Utilities.formatDate(fechaRaw, Session.getScriptTimeZone(), "dd/MM/yyyy")
    : String(fechaRaw || "");

  let falla = String(fila[cF1 - 1] || "");
  if (fila[cF2 - 1]) falla += (falla ? " / " : "") + fila[cF2 - 1];

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const cliente = esc(fila[cCL - 1]) || "—";
  const tel     = esc(fila[cTE - 1]) || "—";
  const equipo  = esc(fila[cEQ - 1]) || "—";
  const obs     = esc(fila[cOB - 1]) || "—";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Etiqueta ${esc(numero)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; width: 100mm; }
  .etiqueta { width: 100mm; height: 50mm; padding: 4mm 6mm; overflow: hidden; border: 1px dashed #999; }
  .titulo { text-align: center; font-weight: bold; font-size: 15px; letter-spacing: 0.5px; }
  .subtitulo { text-align: center; font-weight: bold; font-size: 11px; margin-bottom: 1mm; color: #555; }
  hr { border: none; border-top: 0.3mm solid #000; margin: 2mm 0; }
  .fila { font-size: 10.5px; line-height: 1.4; margin-bottom: 1.5mm; }
  .lbl { font-weight: bold; }

  @page { size: 100mm 50mm; margin: 0; }
  @media print {
    body { width: 100mm; height: 50mm; }
    .etiqueta { border: none; }
  }
</style>
</head>
<body>
  <div class="etiqueta">
    <div class="titulo">GREATPHONES</div>
    <div class="subtitulo">REPARACIÓN</div>
    <hr>
    <div class="fila"><span class="lbl">N°:</span> ${esc(numero)}</div>
    <div class="fila"><span class="lbl">Fecha:</span> ${esc(fecha) || "—"}</div>
    <div class="fila"><span class="lbl">Cliente:</span> ${cliente}</div>
    <div class="fila"><span class="lbl">Tel:</span> ${tel}</div>
    <div class="fila"><span class="lbl">Equipo:</span> ${equipo}</div>
    <div class="fila"><span class="lbl">Falla:</span> ${esc(falla) || "—"}</div>
    <div class="fila"><span class="lbl">Obs:</span> ${obs}</div>
  </div>
  <script>
    window.onload = function () {
      window.print();
    };
  </script>
</body>
</html>`;
}

/**
 * generarPresupuestoReparacionImprimible(datos)
 *
 * Mismo sistema que generarEtiquetaReparacion() (documento HTML
 * autocontenido con window.print() al cargar, mismo esc()) — no crea un
 * mecanismo de impresión nuevo. A diferencia de la etiqueta, NO busca en la
 * hoja "Reparaciones" por N° Rep: recibe los datos ya calculados en vivo,
 * porque el presupuesto puede imprimirse antes de guardar la reparación.
 *
 * datos = { equipo, trabajos:[{nombre,precio}], precioTotal, precioTexto,
 *           horasEstimadas, esDiagnostico }
 */
function generarPresupuestoReparacionImprimible(datos) {
  datos = datos || {};
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const equipo = esc(datos.equipo) || "—";
  const trabajos = Array.isArray(datos.trabajos) ? datos.trabajos : [];

  const filasTrabajos = datos.esDiagnostico
    ? `<div class="fila">Diagnóstico técnico (a confirmar tras revisión)</div>`
    : trabajos.map(t => `<div class="fila">✓ ${esc(t.nombre)}</div>`).join("");

  const precioTexto = datos.esDiagnostico
    ? "A confirmar"
    : fmtPeso(Number(datos.precioTotal) || 0);

  // Parte 4: se sigue calculando/guardando en horas — solo se muestra en días hábiles.
  const dias = Math.round((Number(datos.horasEstimadas) || 0) / 24) || 1;
  const tiempoTexto = dias + (dias === 1 ? " día hábil" : " días hábiles");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Presupuesto Reparación</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; width: 80mm; }
  .hoja { width: 80mm; padding: 5mm 6mm; }
  .titulo { text-align: center; font-weight: bold; font-size: 15px; }
  .subtitulo { text-align: center; font-size: 11px; color: #555; margin-bottom: 2mm; }
  hr { border: none; border-top: 0.3mm solid #000; margin: 2mm 0; }
  .seccion { font-weight: bold; font-size: 11px; margin-top: 2mm; }
  .fila { font-size: 11px; line-height: 1.5; }
  .total { font-weight: bold; font-size: 13px; margin-top: 2mm; }
  .footer { font-size: 9.5px; color: #555; margin-top: 3mm; text-align: center; }

  @media print { .hoja { width: 80mm; } }
</style>
</head>
<body>
  <div class="hoja">
    <div class="titulo">GREATPHONES</div>
    <div class="subtitulo">Presupuesto de Reparación</div>
    <hr>
    <div class="fila"><b>Equipo:</b> ${equipo}</div>
    <div class="seccion">Trabajos:</div>
    ${filasTrabajos || "<div class='fila'>—</div>"}
    <hr>
    <div class="total">Precio estimado: ${precioTexto}</div>
    <div class="fila">Tiempo estimado: ${tiempoTexto}</div>
    <div class="fila">Garantía: 90 días</div>
    <div class="footer">Presupuesto sujeto a confirmación al momento del diagnóstico final.</div>
  </div>
  <script>
    window.onload = function () {
      window.print();
    };
  </script>
</body>
</html>`;
}
