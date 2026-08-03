// ============================================================
//  recibos.gs — Recibo de Venta imprimible (comprobante + garantía)
//  Mismo patrón que etiquetas.gs (generarEtiquetaReparacion): arma un
//  documento HTML autocontenido con window.print() al cargar; el
//  frontend solo lo abre en una ventana nueva y escribe el HTML.
//  Solo lectura sobre "Ventas"/"Compras"/"Venta Accesorios" — no
//  registra ni modifica nada.
//
//  Reproduce el recibo en papel que ya usaba el local (mismos datos,
//  mismo texto de garantía), para no tener que completarlo a mano.
//  Domicilio y Email son opcionales en el formulario de Venta (ventas.html)
//  — se completan acá si el operador los cargó, si no quedan en blanco. El
//  DNI del comprador NO se carga aparte: se calcula solo a partir del CUIL
//  ya cargado (extraerDniDeCuil_()). Lo que el ERP no registra (N° de
//  referencia de transferencia, detalle de cuotas cantidad/valor) queda
//  como línea en blanco para completar a mano al momento de la firma —
//  igual que en el recibo de papel original.
// ============================================================

const RECIBO_NEGOCIO = {
  nombre:      "GreatPhones",
  direccion:   "Zelarrayan 179",
  ciudad:      "Bahía Blanca",
  telefono:    "2914727351",
  titular:     "Martín de Mendonça",
  dniTitular:  "45821618",
  garantiaMeses: 12
};

/**
 * generarReciboVenta(numeroVenta)
 *
 * Busca la venta por su N° Venta en "Ventas", completa Color desde
 * "Compras" (vía N° OP Compra) y los accesorios incluidos desde
 * "Venta Accesorios" (vía N° Venta Celular Asociada), y arma el recibo
 * imprimible (una hoja A4) con todos esos datos.
 */
function generarReciboVenta(numeroVenta) {
  const numero = String(numeroVenta || "").trim();
  if (!numero) throw new Error("❌ Falta el número de venta.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ventasSheet = ss.getSheetByName("Ventas");
  if (!ventasSheet) throw new Error("❌ Hoja 'Ventas' no encontrada.");

  const fE = 2;
  const cNV  = getCol(ventasSheet, "N° Venta",             fE);
  const cFV  = getCol(ventasSheet, "Fecha Venta",          fE);
  const cNOP = getCol(ventasSheet, "N° OP Compra",         fE);
  const cMO  = getCol(ventasSheet, "Modelo",                fE);
  const cIM  = getCol(ventasSheet, "IMEI",                  fE);
  const cCL  = getCol(ventasSheet, "Cliente",                fE);
  const cTL  = getCol(ventasSheet, "Teléfono Cliente",      fE);
  const cPV  = getCol(ventasSheet, "Precio Venta",          fE);
  const cEF  = getCol(ventasSheet, "Cobrado Efectivo",       fE);
  const cTR  = getCol(ventasSheet, "Cobrado Transferencia",  fE);
  const cCU  = getCol(ventasSheet, "Cobrado Cuotas",         fE);
  const cUS  = getCol(ventasSheet, "Cobrado USD",            fE);
  const cOB  = getCol(ventasSheet, "Observaciones",          fE);
  let cCUIL = -1, cOP = -1, cDOM = -1, cEML = -1;
  try { cCUIL = getCol(ventasSheet, "CUIL Cliente",       fE); } catch (e) { /* columna opcional */ }
  try { cOP   = getCol(ventasSheet, "OPERADOR",           fE); } catch (e) { /* columna opcional */ }
  try { cDOM  = getCol(ventasSheet, "Domicilio Cliente",  fE); } catch (e) { /* columna opcional — puede no existir aún si nunca se cargó ninguna */ }
  try { cEML  = getCol(ventasSheet, "Email Cliente",      fE); } catch (e) { /* columna opcional */ }

  const lastRow = ventasSheet.getLastRow();
  if (lastRow <= fE) throw new Error(`❌ "${numero}" no encontrado en "Ventas".`);
  const datosV = ventasSheet.getRange(fE + 1, 1, lastRow - fE, ventasSheet.getLastColumn()).getValues();
  const fila = datosV.find(r => String(r[cNV - 1]).trim() === numero);
  if (!fila) throw new Error(`❌ "${numero}" no encontrado en "Ventas".`);

  const fechaRaw = fila[cFV - 1];
  const fecha = fechaRaw instanceof Date
    ? Utilities.formatDate(fechaRaw, Session.getScriptTimeZone(), "dd/MM/yyyy")
    : String(fechaRaw || "");

  const nOpCompra = String(fila[cNOP - 1] || "").trim();

  const datos = {
    numero:      numero,
    fecha:       fecha,
    vendedor:    cOP > 0 ? String(fila[cOP - 1] || "") : "",
    cliente:     String(fila[cCL - 1] || ""),
    cuil:        cCUIL > 0 ? String(fila[cCUIL - 1] || "") : "",
    dni:         "", // se completa abajo a partir del CUIL — ver extraerDniDeCuil_()
    domicilio:   cDOM > 0 ? String(fila[cDOM - 1] || "") : "",
    email:       cEML > 0 ? String(fila[cEML - 1] || "") : "",
    tel:         String(fila[cTL - 1] || ""),
    modelo:      String(fila[cMO - 1] || ""),
    imei:        String(fila[cIM - 1] || ""),
    color:       "",
    precioVenta: Number(fila[cPV - 1]) || 0,
    cobradoEf:   Number(fila[cEF - 1]) || 0,
    cobradoTr:   Number(fila[cTR - 1]) || 0,
    cobradoCu:   Number(fila[cCU - 1]) || 0,
    cobradoUsd:  Number(fila[cUS - 1]) || 0,
    obs:         String(fila[cOB - 1] || ""),
    accesorios:  []
  };

  // Color: vive en "Compras", no en "Ventas" — se completa por N° OP Compra.
  if (nOpCompra) {
    const comprasSheet = ss.getSheetByName("Compras");
    if (comprasSheet) {
      const fEC = 2;
      let cOPc = -1, cColor = -1;
      try { cOPc   = getCol(comprasSheet, "N° OP",  fEC); } catch (e) { /* opcional */ }
      try { cColor = getCol(comprasSheet, "Color",  fEC); } catch (e) { /* opcional */ }
      const lastC = comprasSheet.getLastRow();
      if (cOPc > 0 && lastC > fEC) {
        const filaC = comprasSheet.getRange(fEC + 1, 1, lastC - fEC, comprasSheet.getLastColumn())
          .getValues()
          .find(r => String(r[cOPc - 1]).trim() === nOpCompra);
        if (filaC && cColor > 0) datos.color = String(filaC[cColor - 1] || "");
      }
    }
  }

  // Accesorios incluidos en esta venta ("Venta Accesorios", asociados por N°
  // Venta Celular Asociada) — incluye tanto los accesorios que el cliente
  // compró junto con el equipo como los regalos automáticos que se le
  // entregaron (entregarRegalosAutomaticos_(), Code.gs: mismos registros,
  // categoría "Regalo automático" y Precio Unitario 0). Se trae la
  // Categoría para poder distinguirlos en el recibo (comprado vs. regalo).
  const accSheet = ss.getSheetByName("Venta Accesorios");
  if (accSheet) {
    const fEA = 2;
    let cAsoc = -1, cProd = -1, cCat = -1, cPU = -1;
    try { cAsoc = getCol(accSheet, "N° Venta Celular Asociada", fEA); } catch (e) { /* opcional */ }
    try { cProd = getCol(accSheet, "Producto",                  fEA); } catch (e) { /* opcional */ }
    try { cCat  = getCol(accSheet, "Categoría",                 fEA); } catch (e) { /* opcional */ }
    try { cPU   = getCol(accSheet, "Precio Unitario",           fEA); } catch (e) { /* opcional */ }
    const lastA = accSheet.getLastRow();
    if (cAsoc > 0 && cProd > 0 && lastA > fEA) {
      accSheet.getRange(fEA + 1, 1, lastA - fEA, accSheet.getLastColumn()).getValues().forEach(r => {
        if (String(r[cAsoc - 1] || "").trim() !== numero) return;
        const categoria = cCat > 0 ? String(r[cCat - 1] || "") : "";
        datos.accesorios.push({
          producto:  String(r[cProd - 1] || ""),
          esRegalo:  categoria.trim() === "Regalo automático",
          precio:    cPU > 0 ? (Number(r[cPU - 1]) || 0) : 0
        });
      });
    }
  }

  datos.dni = extraerDniDeCuil_(datos.cuil);

  return _armarHtmlReciboVenta_(datos);
}

/**
 * extraerDniDeCuil_(cuil)
 *
 * El DNI del comprador no se carga aparte — se calcula solo a partir del
 * CUIL/CUIT ya cargado (formato AR: 2 dígitos de prefijo + 8 dígitos de DNI
 * + 1 dígito verificador, ej. "20-12345678-9"). Tolera guiones, puntos y
 * espacios. Si el CUIL no vino cargado o no tiene el largo esperado (11
 * dígitos), devuelve "" y el recibo deja la línea de DNI en blanco para
 * completar a mano, igual que antes.
 */
function extraerDniDeCuil_(cuil) {
  const digitos = String(cuil || "").replace(/\D/g, "");
  if (digitos.length !== 11) return "";
  return digitos.substring(2, 10);
}

/**
 * Arma el documento HTML completo a partir de los datos ya resueltos por
 * generarReciboVenta(). SOLO diseño (HTML/CSS) — ningún dato ni cálculo
 * cambia acá, es puramente la plantilla visual. Una sola hoja A4 (antes
 * se imprimían 2 copias apiladas con salto de página; el diseño de
 * referencia es de una sola hoja, así que se deja en una copia — se puede
 * volver a imprimir en cualquier momento desde Mis Operaciones).
 * Paleta: negro, blanco, gris claro y naranja corporativo — sin otros colores.
 */
function _armarHtmlReciboVenta_(d) {
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const neg = RECIBO_NEGOCIO;

  // Línea en blanco DIBUJADA (border-bottom), no guiones bajos como texto —
  // así se ve como un renglón real de formulario en papel, no "tipeado".
  const linea = (ancho) => `<span class="linea" style="width:${ancho || 140}px"></span>`;

  const filaPago = (etiqueta, marcado, valorTexto) =>
    `<div class="pago-fila"><span class="chk-box">${marcado ? "☑" : "☐"}</span> <span class="pago-etiqueta">${etiqueta}:</span> ${marcado ? `<b>${valorTexto}</b>` : linea(170)}</div>`;

  const filasPago = [
    filaPago("Efectivo", d.cobradoEf > 0, fmtPeso(d.cobradoEf)),
    filaPago("Dólares", d.cobradoUsd > 0, "USD " + Number(d.cobradoUsd).toLocaleString("en-US")),
    filaPago("Transferencia", d.cobradoTr > 0, fmtPeso(d.cobradoTr)),
    filaPago("Cuotas", d.cobradoCu > 0, "$ " + Number(d.cobradoCu).toLocaleString("es-AR"))
  ].join("");

  // Cada accesorio ya viene marcado como comprado o regalo automático
  // (esRegalo, ver generarReciboVenta()) — acá solo se decide cómo se ve:
  // el regalo se etiqueta "(Regalo)" y el comprado muestra su precio.
  const accesoriosHtml = d.accesorios.length > 0
    ? d.accesorios.map(a => {
        const detalle = a.esRegalo ? "(Regalo)" : (a.precio > 0 ? `(${fmtPeso(a.precio)})` : "");
        return `<span class="chk"><span class="chk-box">☑</span> ${esc(a.producto)}${detalle ? ` <span class="chk-detalle">${detalle}</span>` : ""}</span>`;
      }).join("")
    : ["Cable USB-C / Lightning", "Cabezal de cargador", "Funda protectora", "Vidrio templado"]
        .map(a => `<span class="chk"><span class="chk-box">☐</span> ${a}</span>`).join("");

  const campo = (etiqueta, valor) => `<div class="campo"><span class="etiqueta">${etiqueta}:</span> <span class="valor">${valor}</span></div>`;

  const html = `
  <div class="hoja">
    <div class="encabezado">
      <div class="encabezado-izq">
        <div class="logo">${esc(neg.nombre)}</div>
        <div class="direccion">${esc(neg.direccion)} · ${esc(neg.ciudad)}</div>
        <div class="direccion">Tel: ${esc(neg.telefono)}</div>
      </div>
      <div class="encabezado-der">
        <div class="titulo-recibo">RECIBO DE VENTA</div>
        <div class="dato-header">N°: <b>${esc(d.numero)}</b></div>
        <div class="dato-header">Fecha: <b>${esc(d.fecha)}</b></div>
        <div class="dato-header">Vendedor: <b>${esc(d.vendedor) || linea(110)}</b></div>
      </div>
    </div>

    <div class="seccion-titulo">DATOS DEL DISPOSITIVO</div>
    <div class="dos-columnas">
      <div class="columna">
        ${campo("Marca/Modelo", `<b>${esc(d.modelo) || "—"}</b>`)}
        ${campo("Color", `<b>${esc(d.color) || linea(140)}</b>`)}
      </div>
      <div class="columna">
        ${campo("IMEI", `<b>${esc(d.imei) || "—"}</b>`)}
        ${campo("Batería", linea(160))}
      </div>
    </div>

    <div class="seccion-titulo">ACCESORIOS INCLUIDOS</div>
    <div class="chk-fila">${accesoriosHtml}</div>

    <div class="seccion-titulo">PRECIO Y FORMA DE PAGO</div>
    <div class="pago-box">
      <div class="pago-total">
        <div class="pago-total-label">PRECIO TOTAL</div>
        <div class="pago-total-monto">${fmtPeso(d.precioVenta)}</div>
        <div class="son-pesos">Son pesos: ${linea(150)}</div>
      </div>
      <div class="pago-detalle">
        <div class="pago-detalle-label">DETALLE DEL PAGO</div>
        ${filasPago}
        <div class="pago-fila pago-comprobante">N° comprobante: ${linea(200)}</div>
      </div>
    </div>

    <div class="seccion-titulo">DATOS DEL COMPRADOR</div>
    <div class="dos-columnas comprador">
      <div class="columna">
        ${campo("Apellido y Nombre", `<b>${esc(d.cliente) || linea(160)}</b>`)}
        ${campo("DNI", `<b>${esc(d.dni) || linea(140)}</b>`)}
        ${campo("CUIL / CUIT", `<b>${esc(d.cuil) || linea(140)}</b>`)}
      </div>
      <div class="columna">
        ${campo("Teléfono", `<b>${esc(d.tel) || linea(140)}</b>`)}
        ${campo("Domicilio", `<b>${esc(d.domicilio) || linea(140)}</b>`)}
        ${campo("Email", `<b>${esc(d.email) || linea(140)}</b>`)}
      </div>
    </div>
    ${d.obs ? `<div class="obs">Observaciones: ${esc(d.obs)}</div>` : ""}

    <div class="seccion-titulo">GARANTÍA</div>
    <div class="garantia">
      <p>El equipo adquirido cuenta con una garantía de <b>${neg.garantiaMeses} (doce) meses</b> desde la fecha de compra.
      La garantía cubre únicamente fallas técnicas de origen no provocadas por el cliente, incluyendo problemas de encendido, fallas internas de pantalla,
      batería defectuosa de origen, fallas de software persistentes, problemas de carga, audio, cámara o conectividad.
      Toda garantía queda sujeta a diagnóstico y verificación técnica por parte del local.</p>
      <p>La garantía NO cubre: pantallas rotas, fisuradas o con daño físico; golpes, rayones, deformaciones o daños estéticos; daño por líquido o humedad;
      equipos abiertos, manipulados o reparados por terceros; daños ocasionados por accesorios no originales o uso incorrecto; problemas relacionados con
      cuentas, contraseñas o bloqueos del usuario; daños eléctricos externos; fallas posteriores al vencimiento del plazo de garantía.
      Si el equipo presenta evidencia física de golpe, humedad o manipulación externa, la garantía quedará automáticamente anulada.</p>
      <p>En caso de ingreso por garantía:</p>
      <ol>
        <li>El equipo será evaluado técnicamente. El local dispondrá de un plazo de <b>48 (cuarenta y ocho) horas hábiles</b> desde el ingreso del equipo
        para emitir el diagnóstico correspondiente e informar al cliente si el caso encuadra dentro de las condiciones de garantía.</li>
        <li>El local determinará si corresponde garantía según el diagnóstico realizado. Una vez comunicada la aceptación, el local dispondrá de
        <b>96 (noventa y seis) horas hábiles</b> adicionales para llevar a cabo la reparación o brindar una resolución definitiva. Este plazo podrá
        extenderse en casos de fuerza mayor, tales como fallas de placa, demoras en disponibilidad de repuestos u otras situaciones excepcionales
        debidamente justificadas, de lo cual se informará al cliente oportunamente.</li>
        <li>Si corresponde garantía, el local podrá optar por:
          <ul class="garantia-opciones">
            <li>reparación,</li>
            <li>reemplazo del equipo,</li>
            <li>o devolución del dinero abonado.</li>
          </ul>
          La devolución de dinero será siempre la última instancia luego de intentar reparación o reposición.
        </li>
      </ol>
      <p>El cliente declara haber recibido el equipo en correcto estado de funcionamiento y haber leído y aceptado las presentes condiciones de garantía.</p>
    </div>

    <div class="firmas">
      <div class="firma-col">
        <div class="firma-linea"></div>
        <div class="firma-label">${esc(neg.nombre)} / ${esc(neg.titular)} — DNI ${esc(neg.dniTitular)}</div>
      </div>
      <div class="firma-col">
        <div class="firma-linea"></div>
        <div class="firma-label">Comprador — Aclaración y DNI</div>
      </div>
    </div>

    <div class="pie-separador"></div>
    <div class="pie">Al firmar, el comprador declara recibir el equipo en conformidad con lo descripto. ${esc(neg.nombre)} · ${esc(neg.direccion)}, ${esc(neg.ciudad)} · ${esc(neg.telefono)}</div>
  </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Recibo ${esc(d.numero)}</title>
<style>
  :root { --naranja: #E07B1E; --gris: #D9D9D9; --gris-texto: #6B6B6B; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 11.5px; }

  .hoja { width: 190mm; padding: 6mm 12mm; margin: 0 auto; }

  /* ---------- Encabezado ---------- */
  .encabezado { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 8px; }
  .logo { font-size: 26px; font-weight: bold; letter-spacing: .3px; }
  .direccion { font-size: 10.5px; color: var(--gris-texto); margin-top: 3px; }
  .encabezado-der { text-align: right; }
  .titulo-recibo { font-size: 22px; font-weight: bold; color: var(--naranja); letter-spacing: .5px; margin-bottom: 6px; }
  .dato-header { font-size: 11.5px; margin-top: 2px; }

  /* ---------- Separadores naranjas entre secciones ---------- */
  .seccion-titulo {
    font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: .4px;
    margin: 14px 0 8px; padding-bottom: 5px; border-bottom: 3px solid var(--naranja);
  }

  /* ---------- Filas de 2 columnas (dispositivo / comprador) ---------- */
  .dos-columnas { display: flex; gap: 40px; }
  .dos-columnas .columna { flex: 1; display: flex; flex-direction: column; gap: 7px; }
  .dos-columnas.comprador { position: relative; }
  .dos-columnas.comprador::after {
    content: ""; position: absolute; top: 2px; bottom: 2px; left: 50%;
    width: 1px; background: var(--gris); margin-left: -20px;
  }
  .campo { font-size: 11.5px; }
  .etiqueta { font-weight: bold; }
  .valor { font-weight: normal; }

  /* ---------- Líneas en blanco dibujadas ---------- */
  .linea { display: inline-block; border-bottom: 1px solid #1a1a1a; height: 12px; vertical-align: bottom; margin: 0 2px; }

  /* ---------- Accesorios ---------- */
  .chk-fila { display: flex; flex-wrap: wrap; gap: 30px; font-size: 11.5px; }
  .chk { white-space: nowrap; }
  .chk-box { font-size: 15px; position: relative; top: 1px; }
  .chk-detalle { color: var(--gris-texto); font-size: 10px; }

  /* ---------- Caja Precio y Forma de Pago (protagonista, bordes rectos) ---------- */
  .pago-box { display: flex; border: 2px solid var(--naranja); margin-top: 4px; }
  .pago-total { flex: 0 0 34%; text-align: center; padding: 10px 14px; border-right: 1px solid var(--gris); }
  .pago-total-label { font-size: 11px; font-weight: bold; letter-spacing: .3px; }
  .pago-total-monto { font-size: 26px; font-weight: bold; margin-top: 8px; }
  .son-pesos { font-size: 10px; color: var(--gris-texto); margin-top: 8px; }
  .pago-detalle { flex: 1; padding: 10px 20px; }
  .pago-detalle-label { font-weight: bold; font-size: 11px; letter-spacing: .3px; margin-bottom: 6px; }
  .pago-fila { margin: 5px 0; font-size: 11.5px; }
  .pago-etiqueta { font-weight: bold; }
  .pago-comprobante { margin-top: 8px; }

  .obs { font-size: 11px; margin-top: 6px; color: var(--gris-texto); }

  /* ---------- Garantía ---------- */
  .garantia { font-size: 8.5px; line-height: 1.4; text-align: justify; color: #2b2b2b; }
  .garantia p { margin: 0 0 5px; }
  .garantia ol { margin: 4px 0; padding-left: 18px; }
  .garantia li { margin-bottom: 2px; }
  .garantia-opciones { list-style: none; margin: 2px 0; padding-left: 14px; }
  .garantia-opciones li { margin-bottom: 1px; }
  .garantia-opciones li::before { content: "○ "; }

  /* ---------- Firmas (al pie, líneas largas) ---------- */
  .firmas { display: flex; gap: 50px; margin-top: 42px; }
  .firma-col { flex: 1; text-align: center; }
  .firma-linea { border-top: 1px solid #1a1a1a; margin-bottom: 6px; margin-top: 55px; }
  .firma-label { font-size: 10.5px; font-weight: bold; }

  /* ---------- Pie ---------- */
  .pie-separador { border-top: 1px solid var(--gris); margin-top: 8px; }
  .pie { text-align: center; font-size: 8.5px; color: var(--gris-texto); margin-top: 4px; }

  @page { size: A4; margin: 5mm 8mm; }
  @media print { .hoja { width: 100%; } }
</style>
</head>
<body>
  ${html}
  <script>
    window.onload = function () {
      window.print();
    };
  </script>
</body>
</html>`;
}
