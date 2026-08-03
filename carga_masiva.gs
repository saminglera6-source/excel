// ============================================================
//  CARGA MASIVA (pegar texto) — Preventas, Ventas y Compras
//  (incluye equipos tomados como parte de pago: en este ERP eso
//  es simplemente una Compra con Proveedor/Origen = el cliente)
// ============================================================
//
// Un solo cuadro de texto: se pega una tabla en formato Markdown
// (columnas separadas por "|") y cada fila se registra donde
// corresponde, reusando los mismos wrappers que usa la Web App
// (procesarPreventaConOperador / procesarVentaConOperador /
// procesarCompraConOperador — no las funciones protegidas
// directamente), para que además de la operación en sí queden
// completas las columnas OPERADOR / FECHA_CREACION (trazabilidad).
//
// Cómo se decide el tipo de cada fila:
//   - Si la tabla tiene una columna "Tipo", se usa su valor por fila
//     ("Venta" / "Compra" / "Preventa").
//   - Si la tabla NO tiene columna "Tipo" (formato viejo, solo
//     preventas), se asume que TODAS las filas son Preventas.
//
// Columnas por tipo (nombres flexibles: no importan tildes/mayúsculas,
// y varios nombres alternativos son aceptados, ver obtenerCampoFlexible_):
//
//   PREVENTA: Fecha recibo | Entrega | Vendedor | Cliente | CUIL |
//     Teléfono | Domicilio | Modelo | Color | Estado requerido |
//     Precio total | Seña abonada | Forma de pago | Observaciones
//
//   VENTA: Tipo=Venta | Fecha | Vendedor | Cliente | CUIL/CUIT | Teléfono |
//     Domicilio | Modelo | Color | Capacidad | IMEI | Estado/Batería |
//     Precio | Forma de pago | Observaciones
//     — necesita que el IMEI ya exista en "Compras" (se busca el N° OP
//     automáticamente). Si no está cargado, la fila queda como error.
//
//   COMPRA (incluye "parte de pago"/toma): Tipo=Compra | mismas columnas
//     que Venta — se crea directo como Compra nueva (Tipo Ingreso=COMPRA),
//     Proveedor/Origen = el Cliente de la fila. No depende de nada previo.
//
// Reglas de interpretación compartidas:
//   - "Precio"/"Precio total": se suman todos los montos con "$" de la
//     celda (ej: "$500.000 (+$60.000 cargador)" → 560000).
//   - "Forma de pago" con montos (Preventa/Venta): si el desglose no
//     cubre exactamente el total, la diferencia se carga en "Cuotas"
//     (o en Transferencia si dice "No especificada") y se deja una
//     advertencia — nunca se inventa una imputación silenciosa.
//   - "Forma de pago" sin montos (Compra): se mapea a Efectivo /
//     Transferencia / Mixto / Pendiente por palabras clave.
//   - Si una fila no trae fecha propia (celda vacía o "—"), hereda la
//     fecha de la fila anterior del mismo lote — pensado para el caso
//     de una Venta seguida de la Compra del equipo que el cliente
//     entregó como parte de pago.

function abrirCargaMasiva() {
  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:16px;font-size:13px}
    textarea{width:100%;font-family:Consolas,monospace;font-size:11px;padding:8px;
             border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
    .btn{background:#154360;color:#fff;padding:10px 20px;border:none;border-radius:4px;
         cursor:pointer;margin-top:10px;width:100%;font-size:13px}
    .btn:hover{background:#0E2F44}
    .btn:disabled{background:#aaa;cursor:default}
    #resultado{white-space:pre-wrap;font-family:Consolas,monospace;font-size:11px;
                margin-top:12px;max-height:340px;overflow:auto;background:#F8F9FA;
                border:1px solid #dee2e6;border-radius:4px;padding:8px}
  </style>
  <h3 style="color:#154360;margin:0 0 6px">📋 Carga masiva (pegar texto)</h3>
  <div style="font-size:11px;color:#666;margin-bottom:8px">
    Pegá la tabla tal cual la tenés. Si tiene una columna <b>"Tipo"</b> (Venta /
    Compra / Preventa), cada fila se registra donde corresponde. Si no tiene
    esa columna, se asume que toda la tabla es de <b>Preventas</b>.<br/>
    Las VENTAS necesitan que el IMEI ya esté cargado en Compras (se busca el
    N° OP solo); las COMPRAS (incluye equipos tomados como parte de pago) se
    crean directo. Al final se muestra un resumen con lo cargado y, si algún
    dato quedó ambiguo, una advertencia ⚠️ para revisarlo a mano.
  </div>
  <label style="display:block;font-weight:bold;color:#154360;margin-bottom:4px">Operador (quién está cargando este lote):</label>
  <select id="operador" style="width:100%;padding:7px;margin-bottom:10px;border:1px solid #ccc;border-radius:4px">
    <option value="Martin">Martin</option>
    <option value="Maca">Maca</option>
    <option value="Sam">Sam</option>
    <option value="Eva">Eva</option>
    <option value="Buda">Buda</option>
  </select>
  <textarea id="texto" rows="14" placeholder="Pegá acá la tabla completa..."></textarea>
  <button class="btn" id="btnEnviar" onclick="enviar()">📥 Cargar</button>
  <div id="resultado"></div>
  <script>
  function enviar(){
    const t = document.getElementById("texto").value;
    if(!t.trim()){ alert("Pegá el texto primero."); return; }
    const operador = document.getElementById("operador").value;
    const btn = document.getElementById("btnEnviar");
    btn.disabled = true; btn.textContent = "Procesando...";
    document.getElementById("resultado").textContent = "";
    google.script.run
      .withSuccessHandler(r=>{
        document.getElementById("resultado").textContent = r;
        btn.disabled = false; btn.textContent = "📥 Cargar";
      })
      .withFailureHandler(e=>{
        document.getElementById("resultado").textContent = "❌ " + e.message;
        btn.disabled = false; btn.textContent = "📥 Cargar";
      })
      .cargarOperacionesMasivo(t, operador);
  }
  </script>
  `).setWidth(720).setHeight(660).setTitle("Carga masiva (pegar texto)");
  SpreadsheetApp.getUi().showModalDialog(html, "📋 Carga masiva (pegar texto)");
}

/** Parsea una tabla Markdown (separada por "|") en un array de objetos {header: valor}. Limpia negrita/itálica markdown de cada celda. */
function parsearTablaMarkdown_(texto) {
  const lineas = String(texto || "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && l.includes("|"));
  if (lineas.length < 2) throw new Error("No se detectó una tabla válida (hace falta encabezado + al menos una fila de datos).");

  const limpiarCelda_ = (s) => s.trim().replace(/^\*+|\*+$/g, "").replace(/^_+|_+$/g, "").trim();

  const partirFila = (linea) => {
    let l = linea.trim();
    if (l.startsWith("|")) l = l.slice(1);
    if (l.endsWith("|"))   l = l.slice(0, -1);
    return l.split("|").map(c => limpiarCelda_(c));
  };

  const headers = partirFila(lineas[0]);
  let inicioDatos = 1;
  if (/^[\s|:-]+$/.test(lineas[1])) inicioDatos = 2; // fila separadora tipo |---|---|

  const filas = [];
  for (let i = inicioDatos; i < lineas.length; i++) {
    const celdas = partirFila(lineas[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = celdas[idx] !== undefined ? celdas[idx] : ""; });
    filas.push(obj);
  }
  return filas;
}

const _normalizarClave_ = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Busca una columna por nombre tolerando tildes/mayúsculas distintas a las esperadas. */
function obtenerCampo_(fila, nombre) {
  if (fila[nombre] !== undefined) return fila[nombre];
  const objetivo = _normalizarClave_(nombre);
  const clave = Object.keys(fila).find(k => _normalizarClave_(k) === objetivo);
  return clave ? fila[clave] : "";
}

/**
 * Igual que obtenerCampo_() pero probando una lista de nombres alternativos
 * (los encabezados de estas tablas pegadas no siempre se llaman igual de un
 * lote a otro: "Precio" / "Precio total", "Estado" / "Estado requerido",
 * "CUIL" / "CUIL/CUIT", etc.). Devuelve el primer valor no vacío encontrado
 * probando cada candidato por igualdad exacta y, si ninguno matchea así,
 * por coincidencia parcial (el nombre de columna real contiene o está
 * contenido en el candidato).
 */
function obtenerCampoFlexible_(fila, candidatos) {
  for (const c of candidatos) {
    const v = obtenerCampo_(fila, c);
    if (String(v || "").trim() !== "") return v;
  }
  const claves = Object.keys(fila);
  for (const c of candidatos) {
    const objetivo = _normalizarClave_(c);
    const clave = claves.find(k => {
      const nk = _normalizarClave_(k);
      return nk.includes(objetivo) || objetivo.includes(nk);
    });
    if (clave && String(fila[clave] || "").trim() !== "") return fila[clave];
  }
  return "";
}

function parsearMonto_(str) {
  const limpio = String(str || "").replace(/[^\d]/g, "");
  return limpio ? parseInt(limpio, 10) : 0;
}

/** Suma todos los importes con "$" presentes en un texto (ej: "$500.000 (+$60.000 cargador)" → 560000). */
function extraerMontosConSigno_(str) {
  const regex = /\$\s?([\d]{1,3}(?:\.\d{3})*|\d+)/g;
  const resultados = [];
  let m;
  while ((m = regex.exec(String(str || ""))) !== null) resultados.push(parsearMonto_(m[1]));
  return resultados;
}
function sumarMontos_(arr) { return arr.reduce((a, b) => a + b, 0); }

/** Suma todos los "$" de un texto de precio; si no encuentra ninguno con signo, cae al monto plano. */
function interpretarPrecio_(texto) {
  return sumarMontos_(extraerMontosConSigno_(texto)) || parsearMonto_(texto);
}

function convertirFechaDDMMYYYYaISO_(str) {
  const m = String(str || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/**
 * Interpreta el texto libre de "Forma de pago" (Preventa/Venta, con montos)
 * y lo reparte en efec/transf/cuotas/usd de forma que la suma sea siempre
 * igual a `total`. Cuando el texto no permite un desglose exacto, la
 * diferencia se deja en un balde ("Cuotas", o "Transferencia" si el texto
 * dice "No especificada") y se agrega una advertencia para revisión manual
 * — nunca se inventa una imputación silenciosa a un medio de pago concreto.
 */
function parsearFormaPago_(texto, total) {
  texto = String(texto || "");
  const notas = [];
  let efec = 0, transf = 0, usd = 0, cuotas = 0;

  const mEfec   = texto.match(/Efectivo\s*\$?\s*([\d.,]+)/i);
  if (mEfec) efec = parsearMonto_(mEfec[1]);
  const mTransf = texto.match(/Transferencia\s*\$?\s*([\d.,]+)/i);
  if (mTransf) transf = parsearMonto_(mTransf[1]);
  const mUsd    = texto.match(/USD\s*\$?\s*([\d.,]+)/i);
  if (mUsd) usd = parsearMonto_(mUsd[1]);

  const noEspecificada = /no especificad/i.test(texto);
  if (noEspecificada) {
    notas.push(`Forma de pago no especificada ("${texto}") — se cargó el total (${fmtPeso(total)}) como Transferencia por defecto. VERIFICAR medio real.`);
    return { efec: 0, transf: total, cuotas: 0, usd: 0, notas };
  }

  const asignado = efec + transf + usd;
  const resto = total - asignado;

  if (resto > 1) {
    cuotas = resto;
    notas.push(`El texto de forma de pago ("${texto}") no cubre todo el total de ${fmtPeso(total)}. Diferencia de ${fmtPeso(resto)} cargada en "Cuotas" — revisar y reasignar al medio correcto.`);
  } else if (resto < -1) {
    notas.push(`El texto de forma de pago ("${texto}") suma más que el total (${fmtPeso(total)}). Montos recortados para no superarlo — revisar manualmente.`);
    let exceso = -resto;
    if (transf >= exceso) { transf -= exceso; }
    else { exceso -= transf; transf = 0; efec = Math.max(0, efec - exceso); }
  }

  return { efec, transf, cuotas, usd, notas };
}

/** Normaliza texto libre de estado físico a una de las 4 opciones que usa Compras. */
function mapearEstadoFisico_(texto) {
  const t = String(texto || "").trim();
  const opciones = ["Excelente", "Bueno", "Regular", "Para Reparación"];
  const exacto = opciones.find(o => o.toLowerCase() === t.toLowerCase());
  if (exacto) return { valor: exacto, nota: null };
  const tl = t.toLowerCase();
  if (tl.includes("excelente")) return { valor: "Excelente", nota: null };
  if (tl.includes("bueno")) return { valor: "Bueno", nota: null };
  if (tl.includes("regular")) return { valor: "Regular", nota: null };
  if (tl.includes("repar") || tl.includes("roto") || tl.includes("rota")) return { valor: "Para Reparación", nota: null };
  return {
    valor: "Bueno",
    nota: t ? `Estado físico "${t}" no reconocido — se cargó como "Bueno" por defecto, verificar.` : null
  };
}

/** Mapea el texto libre de "Forma de pago" de una Compra (sin montos, es un solo medio) a Efectivo/Transferencia/Mixto/Pendiente. */
function mapearFormaPagoCompra_(texto) {
  const t = String(texto || "").toLowerCase();
  const tieneEf = /efectivo/.test(t);
  const tieneTr = /transfer/.test(t);
  if (tieneEf && tieneTr) return { medio: "Mixto", nota: null };
  if (tieneEf) return { medio: "Efectivo", nota: null };
  if (tieneTr) return { medio: "Transferencia", nota: null };
  return {
    medio: "Pendiente",
    nota: texto ? `Forma de pago de la compra no reconocida ("${texto}") — se cargó como "Pendiente", verificar.` : null
  };
}

/** Busca un IMEI en "Compras" y devuelve su N° OP + Estado actual, o null si no está cargado. */
function _buscarEquipoPorIMEI_(imei) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Compras");
  if (!sheet) return null;
  const fE = 2;
  let cOP, cIM, cES;
  try {
    cOP = getCol(sheet, "N° OP", fE);
    cIM = getCol(sheet, "IMEI",  fE);
    cES = getCol(sheet, "Estado", fE);
  } catch (e) { return null; }

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return null;
  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  const imeiTrim = String(imei).trim();
  const fila = datos.find(r => String(r[cIM - 1] || "").trim() === imeiTrim);
  if (!fila) return null;
  return { nOp: String(fila[cOP - 1]), estado: String(fila[cES - 1] || "") };
}

/**
 * Busca la preventa `nPre` en la hoja "Preventas" y completa sus columnas de
 * fecha de entrega prometida, tolerando que la hoja las tenga nombradas
 * "Entrega Prometida Desde/Hasta" o "Fecha Prometida Desde/Hasta" (en este
 * ERP conviven ambos nombres según el flujo que las escribió originalmente).
 * No toca procesarPreventa() ni ninguna función protegida — es un tageo
 * puntual posterior, igual en espíritu a _tagOperadorPorId_() en operadores.gs.
 */
function _tagFechasEntregaPreventa_(nPre, fechaDesdeISO, fechaHastaISO) {
  if (!nPre) return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Preventas");
  if (!sheet) return;
  const fE = 2;
  let colId;
  try { colId = getCol(sheet, "N° Preventa", fE); } catch (e) { return; }

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return;
  const ids = sheet.getRange(fE + 1, colId, lastRow - fE, 1).getValues();
  const fila = ids.findIndex(r => String(r[0] || "").trim() === String(nPre).trim());
  if (fila === -1) return;

  const headers = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const buscarCol = (nombres) => {
    for (const n of nombres) {
      const i = headers.findIndex(h => String(h).trim() === n);
      if (i >= 0) return i + 1;
    }
    return -1;
  };
  const colDesde = buscarCol(["Entrega Prometida Desde", "Fecha Prometida Desde"]);
  const colHasta = buscarCol(["Entrega Prometida Hasta", "Fecha Prometida Hasta"]);
  const filaAbs = fE + 1 + fila;

  if (colDesde > 0 && fechaDesdeISO) {
    const c = sheet.getRange(filaAbs, colDesde);
    c.setValue(parseDate(fechaDesdeISO));
    c.setNumberFormat("dd/mm/yyyy");
  }
  if (colHasta > 0 && fechaHastaISO) {
    const c = sheet.getRange(filaAbs, colHasta);
    c.setValue(parseDate(fechaHastaISO));
    c.setNumberFormat("dd/mm/yyyy");
  }
}

/** Construye el objeto `d` que espera procesarPreventaConOperador() a partir de una fila "Preventa". `fechaISO` ya viene resuelta (propia o heredada). */
function construirPreventaDesdeFila_(fila, numeroFila, fechaISO) {
  const cliente     = String(obtenerCampo_(fila, "Cliente") || "").trim();
  const modeloBase  = String(obtenerCampo_(fila, "Modelo") || "").trim();
  const color       = String(obtenerCampo_(fila, "Color") || "").trim();
  const estadoReq   = String(obtenerCampoFlexible_(fila, ["Estado requerido", "Estado"]) || "").trim();
  const domicilio   = String(obtenerCampo_(fila, "Domicilio") || "").trim();
  const vendedor    = String(obtenerCampo_(fila, "Vendedor") || "").trim();
  const tel         = String(obtenerCampoFlexible_(fila, ["Teléfono", "Telefono", "Tel"]) || "").trim();
  const cuil        = String(obtenerCampoFlexible_(fila, ["CUIL", "CUIL Cliente", "CUIL/CUIT", "CUIT/CUIL", "CUIT"]) || "").trim();
  const fechaEntrega= convertirFechaDDMMYYYYaISO_(obtenerCampo_(fila, "Entrega"));
  const precioTexto = String(obtenerCampoFlexible_(fila, ["Precio total", "Precio"]) || "");
  const señaTexto   = String(obtenerCampoFlexible_(fila, ["Seña abonada", "Seña", "Sena abonada", "Sena"]) || "");
  const formaPagoTexto = String(obtenerCampo_(fila, "Forma de pago") || "");
  const obsTexto    = String(obtenerCampo_(fila, "Observaciones") || "").trim();

  if (!cliente)    throw new Error(`Fila ${numeroFila} (Preventa): falta el Cliente.`);
  if (!modeloBase) throw new Error(`Fila ${numeroFila} (Preventa): falta el Modelo.`);
  if (!fechaISO)   throw new Error(`Fila ${numeroFila} (Preventa): no hay fecha disponible (ni propia ni heredada de la fila anterior). Formato esperado dd/mm/yyyy.`);

  const precioVenta = interpretarPrecio_(precioTexto);
  if (!precioVenta) throw new Error(`Fila ${numeroFila} (Preventa): no se pudo interpretar "Precio total" ("${precioTexto}").`);

  const señaAbonada = parsearMonto_(señaTexto);
  const pago = parsearFormaPago_(formaPagoTexto, señaAbonada);

  const modelo = color ? `${modeloBase} - ${color}` : modeloBase;

  const notasExtra = [];
  if (domicilio) notasExtra.push(`Domicilio: ${domicilio}`);
  if (estadoReq) notasExtra.push(`Estado requerido: ${estadoReq}`);
  if (obsTexto)  notasExtra.push(obsTexto);
  if (formaPagoTexto) notasExtra.push(`Forma de pago (original): ${formaPagoTexto}`);
  notasExtra.push(...pago.notas);

  const d = {
    fecha: fechaISO,
    modelo,
    cliente,
    tel,
    cuil,
    vendedor,
    precioVenta,
    efec: pago.efec,
    transf: pago.transf,
    cuotas: pago.cuotas,
    usd: pago.usd,
    fechaDesde: fechaEntrega,
    fechaHasta: fechaEntrega,
    obs: notasExtra.join(" | ")
  };
  return { d, advertencias: pago.notas };
}

/** Construye el objeto `d` que espera procesarVentaConOperador() a partir de una fila "Venta". `fechaISO` ya viene resuelta (propia o heredada). */
function construirVentaDesdeFila_(fila, numeroFila, fechaISO) {
  const cliente   = String(obtenerCampo_(fila, "Cliente") || "").trim();
  const vendedor  = String(obtenerCampo_(fila, "Vendedor") || "").trim();
  const tel       = String(obtenerCampoFlexible_(fila, ["Teléfono", "Telefono", "Tel"]) || "").trim();
  const cuil      = String(obtenerCampoFlexible_(fila, ["CUIL", "CUIL Cliente", "CUIL/CUIT", "CUIT/CUIL", "CUIT"]) || "").trim();
  const domicilio = String(obtenerCampo_(fila, "Domicilio") || "").trim();
  const imei      = String(obtenerCampo_(fila, "IMEI") || "").trim().replace(/[^\d]/g, "");
  const estadoBateria = String(obtenerCampoFlexible_(fila, ["Estado/Batería", "Estado/Bateria", "Estado"]) || "").trim();
  const precioTexto   = String(obtenerCampoFlexible_(fila, ["Precio", "Precio Venta"]) || "");
  const formaPagoTexto = String(obtenerCampo_(fila, "Forma de pago") || "");
  const obsTexto  = String(obtenerCampo_(fila, "Observaciones") || "").trim();
  const modelo    = String(obtenerCampo_(fila, "Modelo") || "").trim();
  const color     = String(obtenerCampo_(fila, "Color") || "").trim();
  const capacidad = String(obtenerCampo_(fila, "Capacidad") || "").trim();

  if (!cliente) throw new Error(`Fila ${numeroFila} (Venta): falta el Cliente.`);
  if (!fechaISO) throw new Error(`Fila ${numeroFila} (Venta): no hay fecha disponible (ni propia ni heredada de la fila anterior).`);
  if (!imei) throw new Error(`Fila ${numeroFila} (Venta): falta el IMEI del equipo a vender.`);

  const precioVenta = interpretarPrecio_(precioTexto);
  if (!precioVenta) throw new Error(`Fila ${numeroFila} (Venta): no se pudo interpretar "Precio" ("${precioTexto}").`);

  const info = _buscarEquipoPorIMEI_(imei);
  if (!info) throw new Error(`Fila ${numeroFila} (Venta): IMEI ${imei} no encontrado en "Compras" — hay que cargar la compra de este equipo antes de poder venderlo.`);
  if (info.estado === "✅ Vendido") throw new Error(`Fila ${numeroFila} (Venta): el equipo IMEI ${imei} (N° OP ${info.nOp}) ya figura como "✅ Vendido" — posible venta duplicada, revisar a mano.`);

  const advertencias = [];
  if (info.estado !== "📦 En Stock") advertencias.push(`El equipo (N° OP ${info.nOp}) tiene estado "${info.estado}" en Compras, no "📦 En Stock" — revisar antes de confiar en esta venta.`);

  // parsearFormaPago_ garantiza que efec+transf+cuotas+usd sume EXACTO
  // `precioVenta`, que es lo que procesarVenta() exige (a diferencia de
  // preventa, acá no puede ser un cobro parcial).
  const pago = parsearFormaPago_(formaPagoTexto, precioVenta);
  advertencias.push(...pago.notas);

  const notasExtra = [];
  if (domicilio) notasExtra.push(`Domicilio: ${domicilio}`);
  if (estadoBateria) notasExtra.push(`Estado/Batería: ${estadoBateria}`);
  if (vendedor) notasExtra.push(`Vendedor: ${vendedor}`);
  if (modelo || capacidad || color) notasExtra.push(`Descripción anotada: ${[modelo, capacidad, color].filter(Boolean).join(" ")}`);
  if (obsTexto) notasExtra.push(obsTexto);
  if (formaPagoTexto) notasExtra.push(`Forma de pago (original): ${formaPagoTexto}`);

  const d = {
    nOp: info.nOp,
    fecha: fechaISO,
    precioVenta,
    cliente,
    cuil,
    tel,
    efec: pago.efec,
    transf: pago.transf,
    cuotas: pago.cuotas,
    usd: pago.usd,
    obs: notasExtra.join(" | "),
    accesorios: []
  };
  return { d, advertencias };
}

/** Construye el objeto `d` que espera procesarCompraConOperador() a partir de una fila "Compra" (incluye tomas/partes de pago). `fechaISO` ya viene resuelta (propia, heredada, o "hoy" si no había ninguna). */
function construirCompraDesdeFila_(fila, numeroFila, fechaISO) {
  const clienteCedente = String(obtenerCampo_(fila, "Cliente") || "").trim();
  const cuil      = String(obtenerCampoFlexible_(fila, ["CUIL", "CUIL Cliente", "CUIL/CUIT", "CUIT/CUIL", "CUIT"]) || "").trim();
  const domicilio = String(obtenerCampo_(fila, "Domicilio") || "").trim();
  const imei      = String(obtenerCampo_(fila, "IMEI") || "").trim().replace(/[^\d]/g, "");
  const modeloBase = String(obtenerCampo_(fila, "Modelo") || "").trim();
  const color     = String(obtenerCampo_(fila, "Color") || "").trim();
  const capacidad = String(obtenerCampo_(fila, "Capacidad") || "").trim();
  const estadoTexto = String(obtenerCampoFlexible_(fila, ["Estado/Batería", "Estado/Bateria", "Estado"]) || "").trim();
  const precioTexto = String(obtenerCampoFlexible_(fila, ["Precio", "Precio Compra"]) || "");
  const formaPagoTexto = String(obtenerCampo_(fila, "Forma de pago") || "");
  const obsTexto  = String(obtenerCampo_(fila, "Observaciones") || "").trim();
  const vendedor  = String(obtenerCampo_(fila, "Vendedor") || "").trim();

  if (!clienteCedente) throw new Error(`Fila ${numeroFila} (Compra): falta el Cliente/Proveedor.`);
  if (!modeloBase) throw new Error(`Fila ${numeroFila} (Compra): falta el Modelo.`);

  const precioCompra = interpretarPrecio_(precioTexto);
  if (!precioCompra) throw new Error(`Fila ${numeroFila} (Compra): no se pudo interpretar "Precio" ("${precioTexto}").`);

  const advertencias = [];
  const estadoFisico = mapearEstadoFisico_(estadoTexto);
  if (estadoFisico.nota) advertencias.push(estadoFisico.nota);

  const pago = mapearFormaPagoCompra_(formaPagoTexto);
  if (pago.nota) advertencias.push(pago.nota);

  const modelo = [modeloBase, capacidad].filter(Boolean).join(" ");

  const notasExtra = [];
  if (domicilio) notasExtra.push(`Domicilio: ${domicilio}`);
  if (vendedor) notasExtra.push(`Recibido por: ${vendedor}`);
  if (obsTexto) notasExtra.push(obsTexto);
  if (formaPagoTexto) notasExtra.push(`Forma de pago (original): ${formaPagoTexto}`);

  const d = {
    tipo: "COMPRA",
    fecha: fechaISO,
    proveedor: clienteCedente,
    cuil,
    modelo,
    imei,
    color,
    estadoFisico: estadoFisico.valor,
    precioCompra,
    precioConsig: 0,
    formaPago: pago.medio,
    reparacion: "No",
    costoRep: 0,
    precioVenta: 0,
    obs: notasExtra.join(" | "),
    esPreventa: "No",
    nPreAsociada: ""
  };
  return { d, advertencias };
}

/**
 * Punto de entrada único: recorre la tabla pegada fila por fila. Si hay
 * columna "Tipo", cada fila se registra como Venta / Compra / Preventa
 * según su valor; si no hay columna "Tipo", TODA la tabla se trata como
 * Preventas (compatible con el formato original). Si una fila no trae
 * fecha propia, hereda la de la fila anterior del lote. Una fila con
 * error no interrumpe a las demás.
 */
function cargarOperacionesMasivo(texto, operador) {
  if (typeof OPERADORES_VALIDOS !== "undefined" && operador && OPERADORES_VALIDOS.indexOf(operador) === -1) {
    throw new Error(`❌ Operador "${operador}" no es válido. Usá uno de: ${OPERADORES_VALIDOS.join(", ")}.`);
  }

  const filas = parsearTablaMarkdown_(texto);
  if (filas.length === 0) throw new Error("No se encontraron filas de datos en el texto pegado.");

  const tieneColumnaTipo = Object.keys(filas[0]).some(k => _normalizarClave_(k) === "tipo");

  const resultados = [];
  let ultimaFechaISO = "";

  filas.forEach((fila, i) => {
    const numeroFila = i + 1;
    const tipoTexto = tieneColumnaTipo ? String(obtenerCampo_(fila, "Tipo") || "").trim() : "";
    const clienteCheck = String(obtenerCampo_(fila, "Cliente") || "").trim();
    if (!clienteCheck && !tipoTexto) return; // fila vacía / de relleno, se ignora silenciosamente

    const tipoNorm = (tipoTexto || "preventa").toLowerCase();
    const esVenta    = tipoNorm.includes("venta") && !tipoNorm.includes("preventa");
    const esCompra   = tipoNorm.includes("compra");
    // Cualquier otro valor (incluido "Preventa" explícito, o directamente
    // ausencia de columna "Tipo") se trata como Preventa.

    const fechaRaw = String(obtenerCampoFlexible_(fila, ["Fecha recibo", "Fecha"]) || "").trim();
    const esDashOVacia = !fechaRaw || fechaRaw === "—" || fechaRaw === "-";
    let fechaISO = esDashOVacia ? ultimaFechaISO : convertirFechaDDMMYYYYaISO_(fechaRaw);
    const heredoFecha = esDashOVacia && !!ultimaFechaISO;

    try {
      let numero, cliente, detalle, advertencias, tipoLabel;

      if (esVenta) {
        const r = construirVentaDesdeFila_(fila, numeroFila, fechaISO);
        if (heredoFecha) r.advertencias.push(`Sin fecha propia — se heredó la fecha de la operación anterior del lote.`);
        const mensaje = procesarVentaConOperador(Object.assign({}, r.d, { operador: operador || "" }));
        numero = (mensaje.match(/N° Venta:\s*(\S+)/) || [, "?"])[1];
        cliente = r.d.cliente; detalle = ""; advertencias = r.advertencias; tipoLabel = "Venta";

      } else if (esCompra) {
        if (!fechaISO) fechaISO = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
        const r = construirCompraDesdeFila_(fila, numeroFila, fechaISO);
        if (heredoFecha) r.advertencias.push(`Sin fecha propia — se heredó la fecha de la operación anterior del lote.`);
        const mensaje = procesarCompraConOperador(Object.assign({}, r.d, { operador: operador || "" }));
        numero = (mensaje.match(/N° OP:\s*(\S+)/) || [, "?"])[1];
        cliente = r.d.proveedor; detalle = r.d.modelo; advertencias = r.advertencias; tipoLabel = "Compra";

      } else {
        const r = construirPreventaDesdeFila_(fila, numeroFila, fechaISO);
        if (heredoFecha) r.advertencias.push(`Sin fecha propia — se heredó la fecha de la operación anterior del lote.`);
        r.d.operador = operador || "";
        const mensaje = procesarPreventaConOperador(r.d);
        numero = (mensaje.match(/N°:\s*(\S+)/) || [, "?"])[1];
        _tagFechasEntregaPreventa_(numero, r.d.fechaDesde, r.d.fechaHasta);
        cliente = r.d.cliente; detalle = r.d.modelo; advertencias = r.advertencias; tipoLabel = "Preventa";
      }

      if (fechaISO) ultimaFechaISO = fechaISO;
      resultados.push({ fila: numeroFila, ok: true, tipo: tipoLabel, numero, cliente, detalle, advertencias });
    } catch (e) {
      resultados.push({ fila: numeroFila, ok: false, cliente: clienteCheck || "?", error: e.message });
    }
  });

  const okCount  = resultados.filter(r => r.ok).length;
  const errCount = resultados.filter(r => !r.ok).length;

  let resumen = `✅ Operaciones cargadas: ${okCount}    ❌ Con error: ${errCount}\n\n`;
  resultados.forEach(r => {
    if (r.ok) {
      resumen += `✔️ Fila ${r.fila} [${r.tipo}] — ${r.numero} — ${r.cliente}${r.detalle ? " (" + r.detalle + ")" : ""}\n`;
      (r.advertencias || []).forEach(a => resumen += `      ⚠️ ${a}\n`);
    } else {
      resumen += `✖️ Fila ${r.fila} — ${r.cliente}: ${r.error}\n`;
    }
  });
  if (resultados.some(r => r.ok && r.advertencias && r.advertencias.length)) {
    resumen += `\nRevisá las filas con ⚠️ (columna Observaciones en la hoja correspondiente) y corregí a mano lo que haga falta.`;
  }
  return resumen;
}
