// ============================================================
// GreatPhones — Apps Script v3.1
// Sistema completo de gestión: Ventas, Compras, Reparaciones,
// Inversores, Caja, Libro Diario, Stock, PREVENTAS
//
// ARQUITECTURA:
//   - getConfig()     → lee hoja "Config" al inicio de cada macro
//   - getCol()        → busca columnas por nombre, nunca por número
//   - getFilaVacia()  → siempre inserta al final de la tabla
//   - libroLog()      → registra TODOS los movimientos en Libro Diario
//
// INSTALACIÓN:
//   Extensiones → Apps Script → pegar → Guardar → reabrir archivo
// ============================================================


// ============================================================
//  UTILIDADES BASE
// ============================================================

/** Lee toda la hoja Config (clave → valor desde fila 2). */
function getConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = ss.getSheetByName("Config");
  if (!cfg) throw new Error("❌ Hoja 'Config' no encontrada.");

  const data = cfg.getDataRange().getValues();
  const obj  = {};
  for (let i = 1; i < data.length; i++) {
    const [clave, valor] = data[i];
    if (!clave) continue;
    const num = parseFloat(valor);
    obj[String(clave).trim()] = isNaN(num) ? String(valor).trim() : num;
  }
  if (obj.INVERSORES_LISTA)
    obj.INV_ARRAY = obj.INVERSORES_LISTA.split(",").map(s => s.trim());
  return obj;
}

// ============================================================
//  OPTIMIZACIÓN — getConfig() cacheada por ejecución
// ============================================================
//
// getConfig() se deja intacta (arquitectura). getConfigCached() evita
// volver a leer y parsear la hoja "Config" cuando una misma ejecución
// del script la necesita varias veces (p.ej. procesarCompra() llama a
// getConfig() y después actualizarStock_() también la necesita).
// Usa una variable de módulo en vez de CacheService porque dura
// exactamente lo que dura la ejecución (que es lo que se pidió:
// "una sola vez por ejecución") y evita el costo de serializar a
// JSON en cada lectura, que CacheService sí tiene.
//
// Protección extra: Apps Script a veces reutiliza una instancia
// "caliente" entre ejecuciones distintas del usuario para arrancar
// más rápido. Si eso pasa y el usuario editó la hoja Config a mano
// entre medio, un caché sin vencimiento mostraría el valor viejo.
// Por eso el caché vence a los 60 segundos (suficiente para cubrir
// una sola operación del usuario, pero no tanto como para arrastrar
// Config desactualizada entre clicks de menú separados).
var _configCacheEjecucion = null;
var _configCacheTimestamp = 0;
var CONFIG_CACHE_TTL_MS = 60000;

function getConfigCached() {
  const ahora = Date.now();
  if (_configCacheEjecucion === null || (ahora - _configCacheTimestamp) > CONFIG_CACHE_TTL_MS) {
    _configCacheEjecucion = getConfig();
    _configCacheTimestamp = ahora;
  }
  return _configCacheEjecucion;
}

/** Devuelve número de columna (1-based) cuyo encabezado coincide con `nombre`. */
function getCol(sheet, nombre, filaEnc) {
  filaEnc = filaEnc || 1;
  const hdrs = sheet.getRange(filaEnc, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx  = hdrs.findIndex(h => String(h).trim() === nombre.trim());
  if (idx === -1)
    throw new Error(`❌ Columna "${nombre}" no encontrada en "${sheet.getName()}" (fila ${filaEnc}).\nDisponibles: ${hdrs.filter(Boolean).join(" | ")}`);
  return idx + 1;
}

/** Primera fila vacía en una columna de referencia, desde filaInicio. */
function getFilaVacia(sheet, colRef, filaInicio) {
  colRef     = colRef     || 1;
  filaInicio = filaInicio || 2;
  // OPTIMIZACIÓN: en la gran mayoría de los casos las tablas son contiguas
  // (no hay filas vacías en el medio), así que getLastRow()+1 es suficiente
  // y es una sola propiedad JS en vez de N roundtrips de getRange().getValue().
  // Si getLastRow() < filaInicio significa que la hoja está vacía desde esa
  // fila → devolvemos filaInicio directamente.
  const last = sheet.getLastRow();
  if (last < filaInicio) return filaInicio;
  // Verificación rápida: ¿la celda siguiente a la última fila está vacía?
  // (caso esperado: tabla contigua → siempre true → 0 roundtrips extra)
  // Si por algún motivo hay datos dispersos, hacemos la búsqueda original
  // pero leyendo toda la columna de una vez en vez de celda por celda.
  const nextRow = last + 1;
  const checkVal = sheet.getRange(last, colRef).getValue();
  if (checkVal !== "" && checkVal !== null && checkVal !== undefined) {
    // La última fila tiene datos → la siguiente está vacía (caso normal)
    return nextRow;
  }
  // Si la última fila está vacía, hay huecos → búsqueda batch hacia atrás
  // leyendo toda la columna de una vez en vez de N getRange() individuales.
  if (last >= filaInicio) {
    const colVals = sheet.getRange(filaInicio, colRef, last - filaInicio + 1, 1).getValues();
    for (let i = colVals.length - 1; i >= 0; i--) {
      if (colVals[i][0] !== "" && colVals[i][0] !== null && colVals[i][0] !== undefined) {
        return filaInicio + i + 1;
      }
    }
  }
  return filaInicio;
}

/** Genera ID único: prefijo-timestamp-random */
function genID(prefijo) {
  const ts  = Date.now();
  const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefijo}-${ts}-${rnd}`;
}

/** Genera número correlativo: prefijo + 3 dígitos (CMP-001, VTA-001, etc.) */
function genCorrelativo(sheet, colRef, prefijo, filaInicio) {
  filaInicio = filaInicio || 2;
  const fila = getFilaVacia(sheet, colRef, filaInicio);
  const nro  = fila - filaInicio + 1;
  return `${prefijo}-${String(nro).padStart(3, "0")}`;
}

/** Parsea string "YYYY-MM-DD" o Date a objeto Date. */
function parseDate(d) {
  if (d instanceof Date) return d;
  const p = String(d).split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

/** Formatea fecha a dd/mm/yyyy para mostrar al usuario. */
function fmt(fecha) {
  const d = new Date(fecha);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

/** Formatea número como $#,### — si n no es un número válido (NaN/undefined/null), muestra $0 en vez de "$NaN" (encontrado corriendo casos límite contra la lógica real). */
function fmtPeso(n) {
  const num = Number(n);
  return "$" + (isNaN(num) ? 0 : num).toLocaleString("es-AR");
}

/** Formatea cantidad de dólares como USD 1,234 */
function fmtUSD(n) {
  return "USD " + Number(n).toLocaleString("en-US");
}

/**
 * Obtiene la cotización del dólar oficial desde una API pública.
 * Devuelve { compra: number, venta: number }.
 * Usa CacheService (5 min) para no golpear la API en cada llamada,
 * y un fallback configurable en Config (USD_FALLBACK) si la API falla.
 */
function obtenerCotizacionUSD() {
  const cache    = CacheService.getScriptCache();
  const cacheKey = "COTIZACION_USD_OFICIAL";
  const cached   = cache.get(cacheKey);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      // si el cache está corrupto, seguimos a buscarla de nuevo
    }
  }

  let cotizacion = null;

  try {
    const resp = UrlFetchApp.fetch("https://dolarapi.com/v1/dolares/oficial", {
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (resp.getResponseCode() === 200) {
      const data = JSON.parse(resp.getContentText());
      const compra = Number(data.compra);
      const venta  = Number(data.venta);
      if (!isNaN(compra) && !isNaN(venta) && compra > 0 && venta > 0) {
        cotizacion = { compra: compra, venta: venta };
      }
    }
  } catch (e) {
    Logger.log("⚠️ Error consultando dolarapi.com: " + e.message);
  }

  // Fallback: hoja Config (clave USD_FALLBACK) o valor fijo de emergencia
  if (!cotizacion) {
    try {
      const cfg = getConfig();
      if (cfg.USD_FALLBACK) {
        cotizacion = { compra: cfg.USD_FALLBACK, venta: cfg.USD_FALLBACK };
        Logger.log("⚠️ Usando cotización fallback de Config: " + cfg.USD_FALLBACK);
      }
    } catch (e) {
      // getConfig también puede fallar si no hay hoja Config; seguimos al fallback duro
    }
  }

  if (!cotizacion) {
    Logger.log("⚠️ No se pudo obtener cotización de ninguna fuente. Usando fallback de emergencia.");
    cotizacion = { compra: 1000, venta: 1000 };
  }

  try {
    cache.put(cacheKey, JSON.stringify(cotizacion), 300); // 5 minutos
  } catch (e) {
    // cache no crítico, seguimos sin romper el flujo
  }

  return cotizacion;
}

/** Convierte una cantidad de USD a pesos usando la cotización de venta del oficial. */
function convertirUSDaPesos_(montoUSD, cotizacion) {
  if (!montoUSD || montoUSD <= 0) return 0;
  const cot = cotizacion || obtenerCotizacionUSD();
  return Math.round(montoUSD * cot.venta);
}


// ============================================================
//  LIBRO DIARIO — registrador central
// ============================================================

// Cache de encabezados de Libro Diario (variable de módulo, persiste dentro
// de la misma ejecución). Se invalida con el mismo TTL de 60 s que getConfigCached.
var _libroDiarioCols = null;
var _libroDiarioSheet = null;
var _libroDiarioColsTS = 0;
var _AUDIT_libroLogCallCount = 0;

function libroLog(p) {
  const t0  = Date.now();
  _AUDIT_libroLogCallCount++;
  Logger.log("[AUDIT] >>> ENTRADA libroLog() | llamada N°" + _AUDIT_libroLogCallCount + " | params=" + JSON.stringify(p));
  Logger.log("[AUDIT] STACK entrada libroLog:\n" + new Error().stack);
  Logger.log("[AUDIT_VTA_ACC] >>> ENTRADA libroLog() | llamada N°" + _AUDIT_libroLogCallCount + " | params=" + JSON.stringify(p));
  Logger.log("[AUDIT_VTA_ACC] STACK entrada libroLog:\n" + new Error().stack);
  const cfg   = getConfig();   // mantener getConfig() tal cual lo pediste
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("[AUDIT] Hojas de la spreadsheet activa (libroLog): " + JSON.stringify(ss.getSheets().map(s => s.getName())));
  const sheet = ss.getSheetByName("Libro Diario");
  Logger.log("[AUDIT] getSheetByName('Libro Diario') => " + (sheet ? "OK ('" + sheet.getName() + "')" : "NULL"));
  Logger.log("[AUDIT_VTA_ACC] Hojas de la spreadsheet activa (libroLog): " + JSON.stringify(ss.getSheets().map(s => s.getName())));
  Logger.log("[AUDIT_VTA_ACC] getSheetByName('Libro Diario') => " + (sheet ? "OK ('" + sheet.getName() + "')" : "NULL"));
  if (!sheet) {
    Logger.log("⚠️ Hoja 'Libro Diario' no encontrada. Log omitido.");
    Logger.log("[AUDIT] *** CORTE en libroLog(): return por sheet NULL — ULTIMA LINEA ANTES DEL RETURN: guarda inicial de libroLog()");
    Logger.log("[AUDIT_VTA_ACC] *** CORTE en libroLog(): return por sheet NULL — ULTIMA LINEA ANTES DEL RETURN: guarda inicial de libroLog()");
    return;
  }

  const filaEnc = 2;

  // OPTIMIZACIÓN: una sola lectura de encabezados cacheada en variable de módulo
  // en vez de 15 llamadas a getCol() (15 roundtrips → 0 roundtrips en la
  // segunda llamada de la misma ejecución).
  const ahora_ts = Date.now();
  if (_libroDiarioCols === null || _libroDiarioSheet !== sheet || (ahora_ts - _libroDiarioColsTS) > CONFIG_CACHE_TTL_MS) {
    const hdrs = sheet.getRange(filaEnc, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idx = (n) => {
      const i = hdrs.findIndex(h => String(h).trim() === n.trim());
      if (i === -1) throw new Error(`❌ Columna "${n}" no encontrada en "Libro Diario".`);
      return i; // 0-based
    };
    _libroDiarioCols = {
      total:  hdrs.length,
      ID:     idx("ID_ASIENTO"),
      TS:     idx("TIMESTAMP"),
      FEC:    idx("FECHA"),
      ORIG:   idx("ORIGEN"),
      OP:     idx("ID_OPERACION"),
      DESC:   idx("DESCRIPCION"),
      CAT:    idx("CATEGORIA"),
      TIPO:   idx("TIPO"),
      MED:    idx("MEDIO"),
      MON:    idx("MONTO"),
      SA:     idx("SALDO_ANTERIOR"),
      SN:     idx("SALDO_NUEVO"),
      REF:    idx("REFERENCIA"),
      OBS:    idx("OBSERVACIONES"),
      REG:    idx("REGISTRADO_POR"),
    };
    _libroDiarioSheet = sheet;
    _libroDiarioColsTS = ahora_ts;
  }
  const cols = _libroDiarioCols;

  // getFilaVacia para Libro Diario (ya optimizada)
  const fila = getFilaVacia(sheet, cols.ID + 1, filaEnc + 1);
  const ahora = new Date();

  // OPTIMIZACIÓN: leer el saldo anterior en una sola lectura de la última fila
  // en vez de hacer getRange().getValue() por separado.
  const ultimaFila = sheet.getLastRow();
  let saldoAnt = 0;
  if (ultimaFila >= filaEnc + 1) {
    const ultimaFilaVals = sheet.getRange(ultimaFila, 1, 1, cols.total).getValues()[0];
    saldoAnt = parseFloat(ultimaFilaVals[cols.SN]) || 0;
  }

  const monto    = parseFloat(p.monto) || 0;
  const saldoNvo = p.tipo === "INGRESO"
    ? saldoAnt + monto
    : p.tipo === "EGRESO"
      ? saldoAnt - monto
      : saldoAnt;

  // OPTIMIZACIÓN: construir la fila completa en memoria y escribirla con un
  // único setValues() en vez de 15 setValue() (15 roundtrips → 1 roundtrip).
  const filaData = new Array(cols.total).fill("");
  filaData[cols.ID]   = genID("ASI");
  filaData[cols.TS]   = ahora;
  filaData[cols.FEC]  = ahora;
  filaData[cols.ORIG] = p.origen         || "";
  filaData[cols.OP]   = p.idOperacion    || "";
  filaData[cols.DESC] = p.descripcion    || "";
  filaData[cols.CAT]  = p.categoria      || "";
  filaData[cols.TIPO] = p.tipo           || "NEUTRO";
  filaData[cols.MED]  = p.medio          || "";
  filaData[cols.MON]  = monto;
  filaData[cols.SA]   = saldoAnt;
  filaData[cols.SN]   = saldoNvo;
  filaData[cols.REF]  = p.referencia     || "";
  filaData[cols.OBS]  = p.observaciones  || "";
  filaData[cols.REG]  = p.registradoPor  || "Martin";

  const rng = sheet.getRange(fila, 1, 1, cols.total);
  rng.setValues([filaData]);
  // Formatos en batch
  sheet.getRange(fila, cols.FEC  + 1).setNumberFormat("dd/mm/yyyy");
  sheet.getRange(fila, cols.MON  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cols.SA   + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cols.SN   + 1).setNumberFormat("$#,##0");

  Logger.log(`Libro Diario fila ${fila}: ${p.origen} ${p.tipo} ${fmtPeso(monto)}`);
  Logger.log("[AUDIT] <<< SALIDA NORMAL libroLog() | fila escrita=" + fila + " | ULTIMA LINEA ANTES DE TERMINAR: cierre de función (escritura completada)");
  Logger.log("[AUDIT_VTA_ACC] <<< SALIDA NORMAL libroLog() | fila escrita=" + fila);
  Logger.log("libroLog: " + (Date.now() - t0) + " ms");
}


// ============================================================
//  MACRO 1 — REGISTRAR COMPRA
// ============================================================

function registrarCompra() {
  const cfg = getConfigCached();
  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:18px;font-size:13px}
    label{display:block;margin-top:10px;font-weight:bold;color:#1A252F}
    input,select,textarea{width:100%;padding:7px;margin-top:3px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
    textarea{height:50px;resize:vertical}
    .btn{background:#1A5276;color:#fff;padding:10px 20px;border:none;border-radius:4px;
         cursor:pointer;margin-top:14px;width:100%;font-size:13px}
    .btn:hover{background:#154360}
    .fila2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .preventa-box{background:#F5EEF8;border-left:4px solid #6C3483;padding:8px;margin-top:8px;border-radius:4px}
  </style>
  <h3 style="color:#1A5276;margin:0 0 14px">🛒 Registrar Compra / Consignación</h3>

  <label>Tipo de ingreso:</label>
  <select id="tipo">
    <option value="COMPRA">COMPRA — equipo propio</option>
    <option value="CONSIGNACION">CONSIGNACION — equipo de tercero</option>
  </select>

  <label>Fecha:</label>
  <input type="date" id="fecha" value="${Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd")}"/>

  <label>Proveedor / Origen:</label>
  <input type="text" id="proveedor" placeholder="Ej: Juan Pérez, Particular"/>

  <div class="fila2">
    <div>
      <label>Equipo / Modelo:</label>
      <input type="text" id="modelo" placeholder="Ej: iPhone 12"/>
    </div>
    <div>
      <label>IMEI:</label>
      <input type="text" id="imei" placeholder="15 dígitos"/>
    </div>
  </div>

  <div class="fila2">
    <div>
      <label>Color:</label>
      <input type="text" id="color" placeholder="Ej: Negro"/>
    </div>
    <div>
      <label>Estado físico:</label>
      <select id="estadoFisico">
        <option>Excelente</option><option selected>Bueno</option>
        <option>Regular</option><option>Para Reparación</option>
      </select>
    </div>
  </div>

  <label>Precio de compra ($) — dejar en 0 si es consignación:</label>
  <input type="number" id="precioCompra" value="0" min="0"/>

  <label>Precio acordado consignación ($) — dejar en 0 si es compra:</label>
  <input type="number" id="precioConsig" value="0" min="0"/>

  <div class="fila2">
    <div>
      <label>Forma de pago:</label>
      <select id="formaPago">
        <option>Efectivo</option><option>Transferencia</option>
        <option>Mixto</option><option>Pendiente</option>
      </select>
    </div>
    <div>
      <label>¿Necesita reparación?</label>
      <select id="reparacion"><option>No</option><option>Sí</option></select>
    </div>
  </div>

  <label>Costo reparación estimado ($):</label>
  <input type="number" id="costoRep" value="0" min="0"/>

  <label>Precio estimado de venta ($):</label>
  <input type="number" id="precioVenta" value="0" min="0"/>

  <label>Observaciones:</label>
  <textarea id="obs"></textarea>

  <label>¿Corresponde a una preventa?</label>
  <select id="esPreventa" onchange="togglePreventa()">
    <option value="No">No</option>
    <option value="Si">Sí — vincular a preventa existente</option>
  </select>

  <div id="selectorPreventa" style="display:none" class="preventa-box">
    <label style="color:#6C3483">Preventa asociada:</label>
    <select id="nPreAsociada">
      <option value="">Cargando preventas...</option>
    </select>
  </div>

  <button class="btn" onclick="enviar()">✅ Registrar compra</button>

  <script>
  function togglePreventa(){
    const val=document.getElementById("esPreventa").value;
    const div=document.getElementById("selectorPreventa");
    if(val==="Si"){
      div.style.display="block";
      google.script.run
        .withSuccessHandler(function(opts){
          const sel=document.getElementById("nPreAsociada");
          sel.innerHTML="";
          if(!opts||opts.length===0){
            sel.innerHTML="<option value=''>— Sin preventas pendientes —</option>";
          } else {
            opts.forEach(function(o){
              const op=document.createElement("option");
              op.value=o.value;
              op.text=o.label;
              sel.appendChild(op);
            });
          }
        })
        .withFailureHandler(function(e){
          document.getElementById("nPreAsociada").innerHTML="<option value=''>— Error cargando —</option>";
        })
        .getPreventasPendientes();
    } else {
      div.style.display="none";
    }
  }
  function enviar(){
    const d={
      tipo:document.getElementById("tipo").value,
      fecha:document.getElementById("fecha").value,
      proveedor:document.getElementById("proveedor").value.trim(),
      modelo:document.getElementById("modelo").value.trim(),
      imei:document.getElementById("imei").value.trim(),
      color:document.getElementById("color").value.trim(),
      estadoFisico:document.getElementById("estadoFisico").value,
      precioCompra:parseFloat(document.getElementById("precioCompra").value)||0,
      precioConsig:parseFloat(document.getElementById("precioConsig").value)||0,
      formaPago:document.getElementById("formaPago").value,
      reparacion:document.getElementById("reparacion").value,
      costoRep:parseFloat(document.getElementById("costoRep").value)||0,
      precioVenta:parseFloat(document.getElementById("precioVenta").value)||0,
      obs:document.getElementById("obs").value.trim(),
      esPreventa:document.getElementById("esPreventa").value,
      nPreAsociada:document.getElementById("esPreventa").value==="Si"
        ? document.getElementById("nPreAsociada").value
        : ""
    };
    if(!d.modelo){alert("❌ Ingresá el modelo del equipo.");return;}
    if(d.tipo==="COMPRA"&&d.precioCompra<=0){alert("❌ Para COMPRA, el precio de compra debe ser > 0.");return;}
    if(d.tipo==="CONSIGNACION"&&d.precioConsig<=0){alert("❌ Para CONSIGNACION, el precio acordado debe ser > 0.");return;}
    if(d.esPreventa==="Si"&&!d.nPreAsociada){alert("❌ Seleccioná la preventa a vincular.");return;}
    google.script.run
      .withSuccessHandler(m=>{alert(m);google.script.host.close();})
      .withFailureHandler(e=>alert("❌ "+e.message))
      .procesarCompra(d);
  }
  </script>
  `).setWidth(500).setHeight(780).setTitle("Registrar Compra");
  SpreadsheetApp.getUi().showModalDialog(html,"🛒 Registrar Compra");
}

function procesarCompra(d) {
  const t0 = Date.now();
  const cfg = getConfigCached();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  if (!sheet) throw new Error("❌ Hoja 'Compras' no encontrada.");
  // Mismos requisitos que ya exige compras.html antes de enviar — revalidados
  // acá para que el backend no dependa exclusivamente de esa pantalla.
  if (!String(d.modelo || "").trim()) throw new Error("❌ Ingresá el modelo del equipo.");
  if (d.tipo === "COMPRA" && !(Number(d.precioCompra) > 0)) throw new Error("❌ Para COMPRA, el precio de compra debe ser mayor a 0.");
  if (d.tipo === "CONSIGNACION" && !(Number(d.precioConsig) > 0)) throw new Error("❌ Para CONSIGNACIÓN, el precio acordado debe ser mayor a 0.");

  const filaEnc = 2;
  // CUIL/CUIT/Domicilio/Localidad/Email del proveedor: columnas nuevas,
  // autocreadas si la hoja todavía no las tiene (mismo mecanismo que
  // asegurarColumnaGenerica_() usa para OPERADOR en operadores.gs) para no
  // exigir que alguien edite la planilla a mano. Domicilio/Localidad/Email
  // son opcionales — solo alimentan la Cesión de Titularidad (recibos.gs).
  asegurarColumnaGenerica_(sheet, filaEnc, "CUIL/CUIT Proveedor");
  asegurarColumnaGenerica_(sheet, filaEnc, "Teléfono Proveedor");
  asegurarColumnaGenerica_(sheet, filaEnc, "Domicilio Proveedor");
  asegurarColumnaGenerica_(sheet, filaEnc, "Localidad Proveedor");
  asegurarColumnaGenerica_(sheet, filaEnc, "Email Proveedor");
  // OPTIMIZACIÓN: una sola lectura de encabezados en vez de 14 llamadas a
  // getCol() (cada una hacía su propio roundtrip getRange().getValues()).
  const headers = sheet.getRange(filaEnc, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idxDe = (nombre) => {
    const idx = headers.findIndex(h => String(h).trim() === nombre.trim());
    if (idx === -1) throw new Error(`❌ Columna "${nombre}" no encontrada en "Compras" (fila ${filaEnc}).`);
    return idx; // 0-based, para construir el array de la fila
  };
  const colOP   = idxDe("N° OP");
  const colFec  = idxDe("Fecha Ingreso");
  const colTipo = idxDe("Tipo Ingreso");
  const colProv = idxDe("Proveedor / Origen");
  const colCuil = idxDe("CUIL/CUIT Proveedor");
  const colTelP = idxDe("Teléfono Proveedor");
  const colDom  = idxDe("Domicilio Proveedor");
  const colLoc  = idxDe("Localidad Proveedor");
  const colEmlP = idxDe("Email Proveedor");
  const colMod  = idxDe("Equipo / Modelo");
  const colIMEI = idxDe("IMEI");
  const colCol  = idxDe("Color");
  const colEst  = idxDe("Estado Físico");
  const colPC   = idxDe("Precio Compra");
  const colCons = idxDe("Precio Acordado Consignación");
  const colFP   = idxDe("Forma de Pago Compra");
  const colRep  = idxDe("¿Necesita Reparación?");
  const colCR   = idxDe("Costo Reparación Estimado");
  const colPV   = idxDe("Precio Estimado Venta");
  const colEstado = idxDe("Estado");
  const colObs  = idxDe("Observaciones");

  const prefijo = cfg.PREFIJO_COMPRA || "CMP";
  // genCorrelativo/getFilaVacia siguen usando getCol (1-based) — se mantiene
  // la arquitectura intacta; solo se evita repetir el resto de columnas.
  const colOP1based = colOP + 1;
  const nOp  = genCorrelativo(sheet, colOP1based, prefijo, filaEnc + 1);
  const fila = getFilaVacia(sheet, colOP1based, filaEnc + 1);

  // Prioridad de estado (4 niveles):
  // 1. 🟣 Preventa + Reparación  (necesita reparación Y está atado a una preventa)
  // 2. 🔵 Reservado Preventa     (atado a una preventa, sin reparación)
  // 3. 🔧 En Reparación          (necesita reparación, sin preventa)
  // 4. 📦 En Stock               (caso normal)
  const esPreventaFlag  = d.esPreventa === "Si" && d.nPreAsociada;
  const necesitaRepFlag = d.reparacion === "Sí";

  let estadoInicial = "📦 En Stock";
  if (necesitaRepFlag && esPreventaFlag) {
    estadoInicial = "🟣 Preventa + Reparación";
  } else if (esPreventaFlag) {
    estadoInicial = "🔵 Reservado Preventa";
  } else if (necesitaRepFlag) {
    estadoInicial = "🔧 En Reparación";
  }

  // OPTIMIZACIÓN: construir la fila completa en memoria y escribirla con un
  // único setValues() en vez de 14 setValue() (14 roundtrips → 1 roundtrip).
  const totalCols = headers.length;
  const fila2D = new Array(totalCols).fill("");
  fila2D[colOP]     = nOp;
  fila2D[colFec]    = parseDate(d.fecha);
  fila2D[colTipo]   = d.tipo;
  fila2D[colProv]   = d.proveedor;
  fila2D[colCuil]   = d.cuil || "";
  fila2D[colTelP]   = d.telProveedor || "";
  fila2D[colDom]    = d.domicilio || "";
  fila2D[colLoc]    = d.localidad || "";
  fila2D[colEmlP]   = d.email || "";
  fila2D[colMod]    = d.modelo;
  fila2D[colIMEI]   = d.imei;
  fila2D[colCol]    = d.color;
  fila2D[colEst]    = d.estadoFisico;
  fila2D[colPC]     = d.precioCompra;
  fila2D[colCons]   = d.precioConsig;
  fila2D[colFP]     = d.formaPago;
  fila2D[colRep]    = d.reparacion;
  fila2D[colCR]     = d.costoRep;
  fila2D[colPV]     = d.precioVenta;
  fila2D[colEstado] = estadoInicial;
  fila2D[colObs]    = d.obs;

  sheet.getRange(fila, 1, 1, totalCols).setValues([fila2D]);

  // Formatos numéricos/fecha en un solo batch de setNumberFormat por rango
  // (no hay forma de mezclarlos con setValues, pero sigue siendo más rápido
  // que tenerlos pegados a cada setValue individual anterior).
  sheet.getRange(fila, colFec + 1).setNumberFormat("dd/mm/yyyy");
  sheet.getRange(fila, colPC + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, colCons + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, colCR + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, colPV + 1).setNumberFormat("$#,##0");

  sheet.getRange(fila, colOP + 1, 1, totalCols)
    .setBackground(
      estadoInicial === "🟣 Preventa + Reparación" ? "#D7BDE2" :
      estadoInicial === "🔵 Reservado Preventa"    ? "#EAD9F7" :
      estadoInicial === "🔧 En Reparación"         ? "#FDEBD0" :
      d.tipo === "COMPRA" ? "#EBF5FB" : "#EAFAF1"
    );

  // Vincular con preventa si corresponde
  if (d.esPreventa === "Si" && d.nPreAsociada) {
    vincularCompraAPreventa_(d.nPreAsociada, nOp);
  }

  // Actualizar Stock (solo el equipo recién comprado)
  actualizarStock_(nOp);

  // Log en Libro Diario
  const monto = d.tipo === "COMPRA" ? d.precioCompra : 0;
  libroLog({
    origen:       "COMPRA",
    idOperacion:  nOp,
    descripcion:  `Compra ${d.tipo}: ${d.modelo}${d.imei ? " IMEI:" + d.imei : ""}${d.esPreventa === "Si" ? " [PREVENTA "+d.nPreAsociada+"]" : ""}`,
    categoria:    "COMPRA_EQUIPO",
    tipo:         d.tipo === "COMPRA" ? "EGRESO" : "NEUTRO",
    medio:        d.formaPago,
    monto:        monto,
    referencia:   nOp,
    observaciones:d.obs,
    registradoPor:"Martin"
  });

  Logger.log("procesarCompra: " + (Date.now() - t0) + " ms");
  return `✅ Compra registrada.\nN° OP: ${nOp}\nEquipo: ${d.modelo}\nEstado: ${estadoInicial}${d.esPreventa === "Si" ? "\n🟠 Preventa "+d.nPreAsociada+" actualizada a Comprado." : ""}`;
}


// ============================================================
//  MACRO 2 — REGISTRAR VENTA
// ============================================================

function registrarVenta() {
  const cfg = getConfigCached();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const comprasSheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");

  const filaEnc = 2;
  const colOPc  = getCol(comprasSheet,"N° OP",          filaEnc);
  const colMod  = getCol(comprasSheet,"Equipo / Modelo", filaEnc);
  const colIMEI = getCol(comprasSheet,"IMEI",            filaEnc);
  const colEst  = getCol(comprasSheet,"Estado",          filaEnc);
  const colTipo = getCol(comprasSheet,"Tipo Ingreso",    filaEnc);

  const lastRow = comprasSheet.getLastRow();
  const opciones = [];

  if (lastRow >= filaEnc + 1) {
    const datos = comprasSheet.getRange(filaEnc + 1, 1, lastRow - filaEnc, comprasSheet.getLastColumn()).getValues();
    datos.forEach(row => {
      const estado = String(row[colEst - 1]);
      // MODIFICADO: comparación exacta para evitar falsos positivos con futuros estados
      if (estado === "📦 En Stock") {
        const nOp  = row[colOPc  - 1];
        const mod  = row[colMod  - 1];
        const imei = row[colIMEI - 1];
        const tipo = row[colTipo - 1];
        opciones.push({ value: nOp, label: `${nOp} — ${mod}${imei ? " ("+imei+")" : ""} [${tipo}]` });
      }
    });
  }

  const opcionesHTML = opciones.length > 0
    ? opciones.map(o => `<option value="${o.value}">${o.label}</option>`).join("")
    : `<option value="">— No hay equipos en stock —</option>`;

  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:18px;font-size:13px}
    label{display:block;margin-top:10px;font-weight:bold;color:#0B5345}
    input,select,textarea{width:100%;padding:7px;margin-top:3px;border:1px solid #ccc;
                          border-radius:4px;box-sizing:border-box}
    .fila2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .fila3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
    .fila4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px}
    .btn{background:#0B5345;color:#fff;padding:10px 20px;border:none;border-radius:4px;
         cursor:pointer;margin-top:14px;width:100%;font-size:13px}
    .total{background:#D5F5E3;padding:8px;border-radius:4px;margin-top:8px;font-weight:bold}
    .acc-box{background:#F8F9FA;border:1px solid #dee2e6;border-radius:6px;padding:12px;margin-top:10px}
    .acc-fila{display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-top:6px}
  </style>
  <h3 style="color:#0B5345;margin:0 0 14px">💰 Registrar Venta</h3>

  <label>Equipo a vender (de stock):</label>
  <select id="nOp">${opcionesHTML}</select>

  <div class="fila2">
    <div>
      <label>Fecha venta:</label>
      <input type="date" id="fecha" value="${Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd")}"/>
    </div>
    <div>
      <label>Precio del Celular ($):</label>
      <input type="number" id="precioVenta" value="0" min="0" oninput="calcTotalOperacion()"/>
    </div>
  </div>

  <div class="fila2">
    <div>
      <label>Cliente:</label>
      <input type="text" id="cliente" placeholder="Nombre y apellido"/>
    </div>
    <div>
      <label>Vendedor: *</label>
      <input type="text" id="vendedor" placeholder="Nombre del vendedor" value="Martin"/>
    </div>
  </div>

  <label>Teléfono cliente:</label>
  <input type="text" id="tel" placeholder="Ej: 2914123456"/>

  <div class="acc-box">
    <label style="color:#1A5276;margin:0">📦 Accesorios vendidos (opcional)</label>
    <div style="font-size:11px;color:#666;margin-top:2px">Completá solo los que apliquen. Se registran por separado en Ventas Accesorios, prorrateando el pago según su participación en el total.</div>
    <div class="acc-fila">
      <div><label style="font-size:11px">Accesorio 1</label><input type="text" id="acc1" placeholder="Ej: Cargador 20W"/></div>
      <div><label style="font-size:11px">Precio ($)</label><input type="number" id="acc1p" value="0" min="0" oninput="calcTotalOperacion()"/></div>
    </div>
    <div class="acc-fila">
      <div><label style="font-size:11px">Accesorio 2</label><input type="text" id="acc2" placeholder="Ej: Auriculares"/></div>
      <div><label style="font-size:11px">Precio ($)</label><input type="number" id="acc2p" value="0" min="0" oninput="calcTotalOperacion()"/></div>
    </div>
    <div class="acc-fila">
      <div><label style="font-size:11px">Accesorio 3</label><input type="text" id="acc3" placeholder="Ej: Vidrio templado"/></div>
      <div><label style="font-size:11px">Precio ($)</label><input type="number" id="acc3p" value="0" min="0" oninput="calcTotalOperacion()"/></div>
    </div>
  </div>

  <div class="total" id="totalOperacionDiv" style="background:#FEF9E7;color:#7D6608">TOTAL OPERACIÓN: $0</div>

  <label>Cobrado en (por el TOTAL de la operación: celular + accesorios) ($):</label>
  <div class="fila4">
    <div><label style="font-size:11px">Efectivo</label>
      <input type="number" id="efec" value="0" min="0" oninput="calcTotal()"/></div>
    <div><label style="font-size:11px">Transferencia</label>
      <input type="number" id="transf" value="0" min="0" oninput="calcTotal()"/></div>
    <div><label style="font-size:11px">Cuotas</label>
      <input type="number" id="cuotas" value="0" min="0" oninput="calcTotal()"/></div>
    <div><label style="font-size:11px">USD (dólares)</label>
      <input type="number" id="usd" value="0" min="0" oninput="calcTotal()"/></div>
  </div>
  <div class="total" id="totalDiv">Total cobrado: $0</div>
  <div style="font-size:11px;color:#666;margin-top:4px" id="cotizDiv"></div>

  <label>Observaciones:</label>
  <input type="text" id="obs" placeholder="Opcional"/>

  <button class="btn" onclick="enviar()">✅ Confirmar venta</button>

  <script>
  var cotizacionVenta = 0;
  google.script.run.withSuccessHandler(function(cot){
    cotizacionVenta = cot.venta;
    document.getElementById("cotizDiv").textContent =
      "Cotización USD oficial: " + fmtP(cot.venta) + " (se actualiza automáticamente)";
    calcTotalOperacion();
    calcTotal();
  }).obtenerCotizacionUSD();

  function fmtP(n){ return "$"+Number(n).toLocaleString("es-AR"); }

  function totalOperacion(){
    const pv=parseFloat(document.getElementById("precioVenta").value)||0;
    const a1=parseFloat(document.getElementById("acc1p").value)||0;
    const a2=parseFloat(document.getElementById("acc2p").value)||0;
    const a3=parseFloat(document.getElementById("acc3p").value)||0;
    return pv+a1+a2+a3;
  }
  function calcTotalOperacion(){
    document.getElementById("totalOperacionDiv").textContent =
      "TOTAL OPERACIÓN: " + fmtP(totalOperacion());
  }
  function calcTotal(){
    const ef=parseFloat(document.getElementById("efec").value)||0;
    const tr=parseFloat(document.getElementById("transf").value)||0;
    const cu=parseFloat(document.getElementById("cuotas").value)||0;
    const us=parseFloat(document.getElementById("usd").value)||0;
    const usPesos = us * cotizacionVenta;
    const t = ef + tr + cu + usPesos;
    let txt = "Total cobrado: " + fmtP(t);
    if(us > 0){
      txt += " (incluye " + us + " USD ≈ " + fmtP(usPesos) + ")";
    }
    document.getElementById("totalDiv").textContent = txt;
  }
  function enviar(){
    const pv=parseFloat(document.getElementById("precioVenta").value)||0;
    const ef=parseFloat(document.getElementById("efec").value)||0;
    const tr=parseFloat(document.getElementById("transf").value)||0;
    const cu=parseFloat(document.getElementById("cuotas").value)||0;
    const us=parseFloat(document.getElementById("usd").value)||0;
    const usPesos=us*cotizacionVenta;
    const nOp=document.getElementById("nOp").value;
    if(!nOp){alert("❌ No hay equipos en stock disponibles.");return;}
    if(pv<=0){alert("❌ El precio de venta debe ser > 0.");return;}
    if(!document.getElementById("cliente").value.trim()){alert("❌ Ingresá el nombre del cliente.");return;}
    if(!document.getElementById("vendedor").value.trim()){alert("❌ Ingresá el nombre del vendedor.");return;}
    const totOp=totalOperacion();
    const totCobrado=ef+tr+cu+usPesos;
    if(Math.abs(totCobrado-totOp) > 1){
      alert("❌ El total cobrado ("+fmtP(totCobrado)+") debe coincidir con el TOTAL OPERACIÓN ("+fmtP(totOp)+" = celular + accesorios).");
      return;
    }
    const d={
      nOp,
      fecha:document.getElementById("fecha").value,
      precioVenta:pv,
      cliente:document.getElementById("cliente").value.trim(),
      tel:document.getElementById("tel").value.trim(),
      vendedor:document.getElementById("vendedor").value.trim(),
      efec:ef,transf:tr,cuotas:cu,usd:us,
      obs:document.getElementById("obs").value.trim(),
      accesorios:[
        {nombre:document.getElementById("acc1").value.trim(),precio:parseFloat(document.getElementById("acc1p").value)||0},
        {nombre:document.getElementById("acc2").value.trim(),precio:parseFloat(document.getElementById("acc2p").value)||0},
        {nombre:document.getElementById("acc3").value.trim(),precio:parseFloat(document.getElementById("acc3p").value)||0}
      ].filter(a=>a.nombre!=="")
    };
    google.script.run
      .withSuccessHandler(m=>{alert(m);google.script.host.close();})
      .withFailureHandler(e=>alert("❌ "+e.message))
      .procesarVenta(d);
  }
  </script>
  `).setWidth(540).setHeight(860).setTitle("Registrar Venta");
  SpreadsheetApp.getUi().showModalDialog(html,"💰 Registrar Venta");
}


function procesarVenta(d) {
  const t0  = Date.now();
  const cfg = getConfigCached();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();

  const ventasSheet  = ss.getSheetByName(cfg.HOJA_VENTAS   || "Ventas");
  const comprasSheet = ss.getSheetByName(cfg.HOJA_COMPRAS  || "Compras");
  if (!ventasSheet || !comprasSheet) throw new Error("❌ Hojas Ventas/Compras no encontradas.");
  // Sin esto, un d.nOp vacío (por ejemplo al reenviar una corrección sin
  // volver a elegir el equipo) tiraba un error críptico de JS ("Cannot read
  // properties of null (reading 'trim')") en vez de un mensaje claro —
  // encontrado corriendo corregirVenta() con datos incompletos.
  if (!d.nOp) throw new Error("❌ Falta seleccionar el equipo (N° OP) de esta venta.");
  // El frontend (ventas.html) ya exige cliente y precio > 0 antes de
  // enviar, pero el backend no los revalidaba — cualquier otro camino que
  // llegue a procesarVenta() sin pasar por esa pantalla (ej. una API, un
  // bug futuro en el formulario) podía grabar una venta sin cliente.
  if (!String(d.cliente || "").trim()) throw new Error("❌ Ingresá el nombre del cliente.");
  if (!(Number(d.precioVenta) > 0)) throw new Error("❌ El precio de venta debe ser mayor a 0.");

  const filaEnc = 2;
  // Una sola lectura de encabezados de Compras
  const headersComp = comprasSheet.getRange(filaEnc, 1, 1, comprasSheet.getLastColumn()).getValues()[0];
  const idxComp = (nombre) => {
    const idx = headersComp.findIndex(h => String(h).trim() === nombre.trim());
    if (idx === -1) throw new Error(`❌ Columna "${nombre}" no encontrada en "Compras" (fila ${filaEnc}).`);
    return idx;
  };
  const cOP = idxComp("N° OP");
  const cTi = idxComp("Tipo Ingreso");
  const cMo = idxComp("Equipo / Modelo");
  const cIM = idxComp("IMEI");
  const cPC = idxComp("Precio Compra");
  const cCO = idxComp("Precio Acordado Consignación");
  const cEs = idxComp("Estado");

  const lastC   = comprasSheet.getLastRow();
  const datosC  = comprasSheet.getRange(filaEnc+1, 1, lastC-filaEnc, comprasSheet.getLastColumn()).getValues();

  let filaCompra = -1;
  let rowCIdx = -1;
  datosC.forEach((row, i) => {
    if (String(row[cOP]).trim() === d.nOp.trim()) {
      filaCompra = filaEnc + 1 + i;
      rowCIdx = i;
    }
  });

  if (filaCompra === -1) throw new Error(`❌ N° OP "${d.nOp}" no encontrado en Compras.`);

  const rowC = datosC[rowCIdx];
  const tipoOrigen  = String(rowC[cTi]);
  const modeloEquip = String(rowC[cMo]);
  const imeiEquip   = String(rowC[cIM]);
  const costoEquip  = parseFloat(rowC[cPC]) || 0;
  const consigEquip = parseFloat(rowC[cCO]) || 0;

  const vFE = 2;
  // CUIL/Domicilio/Email del cliente: columnas nuevas, autocreadas si la
  // hoja todavía no las tiene (mismo mecanismo que asegurarColumnaGenerica_()
  // usa para OPERADOR en operadores.gs) para no exigir que alguien edite la
  // planilla a mano. Domicilio y Email son 100% opcionales — solo alimentan
  // el recibo imprimible (recibos.gs), no se validan acá.
  asegurarColumnaGenerica_(ventasSheet, vFE, "CUIL Cliente");
  asegurarColumnaGenerica_(ventasSheet, vFE, "Domicilio Cliente");
  asegurarColumnaGenerica_(ventasSheet, vFE, "Email Cliente");
  // Una sola lectura de encabezados de Ventas
  const headersVentas = ventasSheet.getRange(vFE, 1, 1, ventasSheet.getLastColumn()).getValues()[0];
  const idxVta = (nombre) => {
    const idx = headersVentas.findIndex(h => String(h).trim() === nombre.trim());
    if (idx === -1) throw new Error(`❌ Columna "${nombre}" no encontrada en "Ventas" (fila ${vFE}).`);
    return idx;
  };
  const vNV  = idxVta("N° Venta");
  const vFV  = idxVta("Fecha Venta");
  const vNOP = idxVta("N° OP Compra");
  const vTO  = idxVta("Tipo Origen");
  const vMO  = idxVta("Modelo");
  const vIM  = idxVta("IMEI");
  const vCL  = idxVta("Cliente");
  const vCUIL = idxVta("CUIL Cliente");
  const vDOM = idxVta("Domicilio Cliente");
  const vEML = idxVta("Email Cliente");
  const vTL  = idxVta("Teléfono Cliente");
  const vPV  = idxVta("Precio Venta");
  const vEF  = idxVta("Cobrado Efectivo");
  const vTR  = idxVta("Cobrado Transferencia");
  const vCU  = idxVta("Cobrado Cuotas");
  const vUS  = idxVta("Cobrado USD");
  const vTG  = idxVta("Tipo Ganancia");
  const vGN  = idxVta("Ganancia Neta");
  const vEst = idxVta("Estado");
  const vObs = idxVta("Observaciones");
  // Columnas de ganancia teórica/cobrada (opcionales — si la hoja no las
  // tiene todavía, no rompe: se agregan sin tocar "Ganancia Neta").
  let vGT = -1, vGC = -1;
  try { vGT = idxVta("Ganancia Teórica"); } catch(e) { /* columna opcional */ }
  try { vGC = idxVta("Ganancia Cobrada"); } catch(e) { /* columna opcional */ }
  // Columna con el equivalente en pesos del USD cobrado (opcional — Cambio 3:
  // se guardan simultáneamente USD reales ["Cobrado USD"] y USD convertidos,
  // para poder reconstruir caja/ganancias/reportes sin perder ninguno de los dos).
  let vUSC = -1;
  try { vUSC = idxVta("Cobrado USD Convertido"); } catch(e) { /* columna opcional */ }

  const prefijo = cfg.PREFIJO_VENTA || "VTA";
  const vNV1based = vNV + 1;
  const nVta    = genCorrelativo(ventasSheet, vNV1based, prefijo, vFE + 1);
  const filaVta = getFilaVacia(ventasSheet, vNV1based, vFE + 1);

  // Conversión real de USD a pesos (cotización única para celular + accesorios)
  const cotizacion   = obtenerCotizacionUSD();

  // === PRORRATEO: el pago ingresado cubre TODA la operación (celular +
  // accesorios), no solo el celular. Se distribuye proporcionalmente según
  // el valor de cada ítem sobre el total de la operación. ===
  const accesorios = (d.accesorios || []).filter(a => a.nombre);
  const valorCelular = Number(d.precioVenta) || 0;
  const valorTotalOperacion = valorCelular + accesorios.reduce((s, a) => s + (Number(a.precio) || 0), 0);

  const efIngresado  = Number(d.efec)   || 0;
  const trIngresado  = Number(d.transf) || 0;
  const cuIngresado  = Number(d.cuotas) || 0;
  const usIngresado  = Number(d.usd)    || 0; // cantidad de dólares
  const usIngresadoPesos = convertirUSDaPesos_(usIngresado, cotizacion);
  const totalIngresadoPesos = efIngresado + trIngresado + cuIngresado + usIngresadoPesos;

  if (Math.abs(totalIngresadoPesos - valorTotalOperacion) > 1) {
    throw new Error(`❌ El total cobrado (${fmtPeso(totalIngresadoPesos)}) no coincide con el total de la operación (${fmtPeso(valorTotalOperacion)} = celular + accesorios).`);
  }

  const itemsProrrateo = [{ valor: valorCelular }, ...accesorios.map(a => ({ valor: Number(a.precio) || 0 }))];
  const distribucion = prorratearMediosPago_(
    itemsProrrateo,
    { efec: efIngresado, transf: trIngresado, cuotas: cuIngresado, usd: usIngresado },
    valorTotalOperacion
  );

  // Porción del pago que corresponde al celular
  const ef = distribucion[0].efec;
  const tr = distribucion[0].transf;
  const cu = distribucion[0].cuotas;
  const usdMontoReal = distribucion[0].usd; // cantidad de dólares del celular
  const usdEnPesos   = convertirUSDaPesos_(usdMontoReal, cotizacion);
  const totalCobradoPesos = ef + tr + cu + usdEnPesos; // solo lo cobrado del celular

  const tipoGanancia = tipoOrigen.includes("CONSIG") ? "Comisión" : "Ganancia directa";
  const costoBase = tipoOrigen.includes("CONSIG") ? consigEquip : costoEquip;
  const gananciaTeorica = d.precioVenta - costoBase; // precio pactado - costo
  const gananciaCobrada = totalCobradoPesos - costoBase; // cobrado real (a pesos) - costo
  const gananciaNeta = gananciaTeorica; // se mantiene igual que antes (no se rompe el cálculo existente)

  // Construir la fila completa en memoria → un solo setValues()
  const totalColsVta = headersVentas.length;
  const filaVta2D = new Array(totalColsVta).fill("");
  filaVta2D[vNV]  = nVta;
  filaVta2D[vFV]  = parseDate(d.fecha);
  filaVta2D[vNOP] = d.nOp;
  filaVta2D[vTO]  = tipoOrigen;
  filaVta2D[vMO]  = modeloEquip;
  filaVta2D[vIM]  = imeiEquip;
  filaVta2D[vCL]  = d.cliente;
  filaVta2D[vCUIL] = d.cuil || "";
  filaVta2D[vDOM] = d.domicilio || "";
  filaVta2D[vEML] = d.email || "";
  filaVta2D[vTL]  = d.tel;
  filaVta2D[vPV]  = d.precioVenta;
  filaVta2D[vEF]  = ef;
  filaVta2D[vTR]  = tr;
  filaVta2D[vCU]  = cu;
  filaVta2D[vUS]  = usdMontoReal; // cantidad de dólares
  filaVta2D[vTG]  = tipoGanancia;
  filaVta2D[vGN]  = gananciaNeta;
  filaVta2D[vEst] = "PROCESADA";
  filaVta2D[vObs] = d.obs;
  if (vGT   >= 0) filaVta2D[vGT]   = gananciaTeorica;
  if (vGC   >= 0) filaVta2D[vGC]   = gananciaCobrada;
  if (vUSC  >= 0) filaVta2D[vUSC]  = usdEnPesos;

  ventasSheet.getRange(filaVta, 1, 1, totalColsVta).setValues([filaVta2D]);
  ventasSheet.getRange(filaVta, vFV + 1).setNumberFormat("dd/mm/yyyy");
  ventasSheet.getRange(filaVta, vPV + 1).setNumberFormat("$#,##0");
  ventasSheet.getRange(filaVta, vEF + 1).setNumberFormat("$#,##0");
  ventasSheet.getRange(filaVta, vTR + 1).setNumberFormat("$#,##0");
  ventasSheet.getRange(filaVta, vCU + 1).setNumberFormat("$#,##0");
  ventasSheet.getRange(filaVta, vGN + 1).setNumberFormat("$#,##0");
  if (vGT >= 0) ventasSheet.getRange(filaVta, vGT + 1).setNumberFormat("$#,##0");
  if (vGC >= 0) ventasSheet.getRange(filaVta, vGC + 1).setNumberFormat("$#,##0");
  if (vUSC >= 0) ventasSheet.getRange(filaVta, vUSC + 1).setNumberFormat("$#,##0");
  ventasSheet.getRange(filaVta, vNV + 1, 1, totalColsVta).setBackground("#EAFAF1");

  comprasSheet.getRange(filaCompra, cEs + 1).setValue("✅ Vendido");

  actualizarStock_(d.nOp);

  // Registrar en Libro Diario: la caja debe conservar los DÓLARES REALES
  // (Cambio 3) — un asiento por cada medio de pago realmente utilizado, sin
  // mezclar USD (convertido a pesos) con los medios en pesos. La conversión
  // sólo se usa para el detalle informativo en observaciones.
  const mediosVentaCelular = [
    { medio:"Efectivo",      monto: ef,           esUSD:false },
    { medio:"Transferencia", monto: tr,           esUSD:false },
    { medio:"Cuotas",        monto: cu,           esUSD:false },
    { medio:"USD",           monto: usdMontoReal, esUSD:true  }
  ];
  mediosVentaCelular.forEach(m => {
    if (m.monto <= 0) return;
    libroLog({
      origen:       "VENTA",
      idOperacion:  nVta,
      descripcion:  `Venta ${modeloEquip} a ${d.cliente}`,
      categoria:    tipoOrigen.includes("CONSIG") ? "VENTA_CONSIG" : "VENTA_PROPIA",
      tipo:         "INGRESO",
      medio:        m.medio,
      monto:        m.monto,
      referencia:   nVta,
      observaciones: m.esUSD
        ? `${d.obs ? d.obs + " | " : ""}USD: ${usdMontoReal} | USD_COTIZACION: ${fmtPeso(cotizacion.venta)} | USD_CONVERTIDO: ${fmtPeso(usdEnPesos)}`
        : d.obs,
      registradoPor:d.operador || "Martin"
    });
  });

  // Registrar accesorios en Venta Accesorios, con su porción prorrateada
  // del pago (Problema 2): NO se asume que se cobraron en efectivo.
  let resumenAccesorios = "";
  let tocoStockAccesorios = false;
  if (accesorios.length > 0) {
    try {
      accesorios.forEach((acc, i) => {
        const dist = distribucion[i + 1]; // 0 es el celular
        // Si el accesorio viene vinculado a un producto real de "Stock
        // Accesorios" (acc.skuId, elegido con el selector — antes esto era
        // texto libre y no descontaba nada del stock), se usa su nombre y
        // costo reales y se taguea el SKU en la fila para que
        // actualizarStockAccesorios_() lo descuente igual que un accesorio
        // vendido suelto o entregado de regalo.
        const sku = acc.skuId ? _buscarSkuAccesorioPorId_(acc.skuId) : null;
        const nAcc = registrarAccesorioAsociado_({
          fecha:       d.fecha,
          vendedor:    d.operador || "",
          categoria:   sku ? sku.categoria : undefined,
          producto:    sku ? sku.producto : acc.nombre,
          marca:       sku ? sku.marca : "",
          modeloAcc:   sku ? sku.color : "",
          costoUnit:   sku ? sku.costoPromedio : 0,
          precio:      acc.precio || 0,
          cliente:     d.cliente,
          cuil:        d.cuil,
          tel:         d.tel,
          nVtaCelular: nVta,
          cobEfec:     dist.efec,
          cobTransf:   dist.transf,
          cobCuotas:   dist.cuotas,
          cobUSD:      dist.usd,
          cotizacion:  cotizacion,
          obs:         `Asociado a venta celular ${nVta}`
        });
        if (sku && nAcc) {
          _tagColumnaGenericaPorId_("Venta Accesorios", 2, "N° Venta Accesorio", nAcc, "SKU_ID", sku.skuId);
          tocoStockAccesorios = true;
        }
      });
      resumenAccesorios = `\n📦 ${accesorios.length} accesorio/s registrado/s en Ventas Accesorios (pago prorrateado).`;
      if (tocoStockAccesorios) actualizarStockAccesorios_();
    } catch(e) {
      resumenAccesorios = `\n⚠️ Accesorios no registrados: ${e.message}`;
    }
  }

  Logger.log("procesarVenta: " + (Date.now() - t0) + " ms");
  const hayAccesorios = valorTotalOperacion > valorCelular;
  return `✅ Venta registrada.\nN° Venta: ${nVta}\nEquipo: ${modeloEquip}\n` +
         (hayAccesorios
           ? `Total operación (celular + accesorios): ${fmtPeso(valorTotalOperacion)}\nPrecio celular: ${fmtPeso(d.precioVenta)}\n`
           : `Precio: ${fmtPeso(d.precioVenta)}\n`) +
         `Ganancia teórica: ${fmtPeso(gananciaTeorica)}\nGanancia cobrada: ${fmtPeso(gananciaCobrada)}` +
         (usdMontoReal > 0 ? `\nUSD (celular): ${usdMontoReal} → ${fmtPeso(usdEnPesos)} (cotización ${fmtPeso(cotizacion.venta)})` : ``) +
         `\nCobrado por el celular: ${fmtPeso(totalCobradoPesos)}` +
         (hayAccesorios ? `\nCobrado total (celular + accesorios): ${fmtPeso(totalIngresadoPesos)}` : ``) +
         resumenAccesorios;
}


// ============================================================
//  MACRO 3 — REGISTRAR REPARACIÓN
// ============================================================

function registrarReparacion() {
  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:18px;font-size:13px}
    label{display:block;margin-top:10px;font-weight:bold;color:#784212}
    input,select,textarea{width:100%;padding:7px;margin-top:3px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
    .fila2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .btn{background:#784212;color:#fff;padding:10px;border:none;border-radius:4px;cursor:pointer;margin-top:14px;width:100%;font-size:13px}
  </style>
  <h3 style="color:#784212;margin:0 0 14px">🔧 Registrar Reparación</h3>

  <div class="fila2">
    <div>
      <label>Tipo:</label>
      <select id="tipo">
        <option>Particular</option><option>Garantía</option>
        <option>Preventa</option><option>Interno</option>
      </select>
    </div>
    <div>
      <label>Fecha:</label>
      <input type="date" id="fecha" value="${Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd")}"/>
    </div>
  </div>

  <div class="fila2">
    <div>
      <label>Cliente:</label>
      <input type="text" id="cliente" placeholder="Nombre y apellido"/>
    </div>
    <div>
      <label>Teléfono:</label>
      <input type="text" id="tel" placeholder="Ej: 2914123456"/>
    </div>
  </div>

  <label>Equipo:</label>
  <input type="text" id="equipo" placeholder="Ej: iPhone 14 Pro Max 256 GB"/>

  <div class="fila2">
    <div>
      <label>IMEI (opcional):</label>
      <input type="text" id="imei" placeholder="15 dígitos"/>
    </div>
    <div>
      <label>PIN (opcional):</label>
      <input type="text" id="pin" placeholder="Ej: 1234"/>
    </div>
  </div>

  <label>Falla principal:</label>
  <input type="text" id="falla1" placeholder="Describe la falla reportada por el cliente"/>

  <label>Falla 2 (opcional):</label>
  <input type="text" id="falla2" placeholder="Falla adicional detectada"/>

  <div class="fila2">
    <div>
      <label>Precio cobrado ($):</label>
      <input type="number" id="precioCob" value="0" min="0"/>
    </div>
    <div>
      <label>Cobrado efectivo ($):</label>
      <input type="number" id="efec" value="0" min="0"/>
    </div>
  </div>

  <label>Cobrado transferencia ($):</label>
  <input type="number" id="transf" value="0" min="0"/>

  <label>Observaciones:</label>
  <textarea id="obs"></textarea>

  <button class="btn" onclick="enviar()">✅ Registrar</button>

  <script>
  function enviar(){
    const d={
      tipo:document.getElementById("tipo").value,
      fecha:document.getElementById("fecha").value,
      cliente:document.getElementById("cliente").value.trim(),
      tel:document.getElementById("tel").value.trim(),
      equipo:document.getElementById("equipo").value.trim(),
      imei:document.getElementById("imei").value.trim(),
      pin:document.getElementById("pin").value.trim(),
      falla1:document.getElementById("falla1").value.trim(),
      falla2:document.getElementById("falla2").value.trim(),
      precioCob:parseFloat(document.getElementById("precioCob").value)||0,
      efec:parseFloat(document.getElementById("efec").value)||0,
      transf:parseFloat(document.getElementById("transf").value)||0,
      obs:document.getElementById("obs").value.trim()
    };
    if(!d.cliente){alert("❌ Ingresá el nombre del cliente.");return;}
    if(!d.equipo){alert("❌ Ingresá el equipo.");return;}
    if(!d.falla1){alert("❌ Describí la falla principal.");return;}
    google.script.run
      .withSuccessHandler(m=>{alert(m);google.script.host.close();})
      .withFailureHandler(e=>alert("❌ "+e.message))
      .procesarReparacion(d);
  }
  </script>
  `).setWidth(480).setHeight(720).setTitle("Registrar Reparación");
  SpreadsheetApp.getUi().showModalDialog(html,"🔧 Reparación");
}

function procesarReparacion(d) {
  const t0  = Date.now();
  const cfg   = getConfigCached();
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg.HOJA_REPARACIONES || "Reparaciones");
  if (!sheet) throw new Error("❌ Hoja 'Reparaciones' no encontrada.");
  // Mismos requisitos que ya exige reparaciones.html antes de enviar —
  // revalidados acá para que el backend no dependa exclusivamente de esa
  // pantalla (encontrado corriendo procesarReparacion() directo con datos
  // incompletos: no tiraba ningún error).
  if (!String(d.cliente || "").trim()) throw new Error("❌ Ingresá el nombre del cliente.");
  if (!String(d.equipo  || "").trim()) throw new Error("❌ Ingresá el equipo.");
  if (!String(d.falla1  || "").trim()) throw new Error("❌ Describí la falla principal.");

  const fE  = 2;
  // OPTIMIZACIÓN: una sola lectura de encabezados en vez de 17 getCol()
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => {
    const i = hdrs.findIndex(h => String(h).trim() === n.trim());
    if (i === -1) throw new Error(`❌ Columna "${n}" no encontrada en "Reparaciones" (fila ${fE}).`);
    return i; // 0-based
  };
  const cNR = idx("N° Rep");
  const cFE = idx("Fecha Ingreso");
  const cTI = idx("Tipo");
  const cCL = idx("Cliente");
  const cTE = idx("Teléfono");
  const cEQ = idx("Equipo");
  const cIM = idx("IMEI");
  const cPI = idx("PIN");
  const cF1 = idx("Falla 1");
  const cF2 = idx("Falla 2");
  const cPC = idx("Precio Cobrado");
  const cEF = idx("Cobrado Efectivo");
  const cTR = idx("Cobrado Transferencia");
  const cES = idx("Estado");
  const cOB = idx("Observaciones");

  // Columnas nuevas del presupuesto automático (rediseño de Reparaciones):
  // se agregan solas si no existen (asegurarColumnaGenerica_, mismo criterio
  // que "Monto USD" en Gastos) — no rompen reparaciones cargadas antes de
  // este cambio, y el diálogo viejo de Sheets (que no manda estos campos)
  // sigue funcionando igual, solo quedan vacías/"NO".
  const cTRAB   = asegurarColumnaGenerica_(sheet, fE, "Trabajos Reparación")  - 1;
  const cDET    = asegurarColumnaGenerica_(sheet, fE, "Detalle Presupuesto") - 1;
  const cPCAL   = asegurarColumnaGenerica_(sheet, fE, "Precio Calculado")    - 1;
  const cTIEMPO = asegurarColumnaGenerica_(sheet, fE, "Tiempo Estimado (hs)") - 1;
  const cDIAG   = asegurarColumnaGenerica_(sheet, fE, "Es Diagnóstico")      - 1;
  // Evolución del flujo (auditoría comercial + presupuesto de diagnóstico):
  const cDIF    = asegurarColumnaGenerica_(sheet, fE, "Diferencia")            - 1;
  const cPRESD  = asegurarColumnaGenerica_(sheet, fE, "PRESUPUESTO_DIAGNOSTICO") - 1;
  // Datos opcionales para el ticket de ingreso imprimible (recibos.gs) —
  // no se usan en ningún cálculo, solo para completar el recibo.
  const cDNI  = asegurarColumnaGenerica_(sheet, fE, "DNI Cliente")   - 1;
  const cEML  = asegurarColumnaGenerica_(sheet, fE, "Email Cliente") - 1;
  const cCOL  = asegurarColumnaGenerica_(sheet, fE, "Color")         - 1;
  const cBAT  = asegurarColumnaGenerica_(sheet, fE, "Batería")       - 1;

  const cNR1based = cNR + 1;
  const nRep  = genCorrelativo(sheet, cNR1based, cfg.PREFIJO_REP || "REP", fE + 1);
  const fila  = getFilaVacia(sheet, cNR1based, fE + 1);

  // OPTIMIZACIÓN: un solo setValues en vez de 17+ setValue individuales.
  // totalCols se toma DESPUÉS de asegurar las columnas nuevas, por si alguna
  // se agregó recién ahora.
  const totalCols = sheet.getLastColumn();
  const filaData  = new Array(totalCols).fill("");
  filaData[cNR] = nRep;
  filaData[cFE] = parseDate(d.fecha);
  filaData[cTI] = d.tipo;
  filaData[cCL] = d.cliente;
  filaData[cTE] = d.tel;
  filaData[cDNI] = d.dni || "";
  filaData[cEML] = d.email || "";
  filaData[cEQ] = d.equipo;
  filaData[cIM] = d.imei;
  filaData[cPI] = d.pin;
  filaData[cCOL] = d.color || "";
  filaData[cBAT] = d.bateria || "";
  filaData[cF1] = d.falla1;
  filaData[cF2] = d.falla2;
  filaData[cPC] = d.precioCob;
  filaData[cEF] = d.efec;
  filaData[cTR] = d.transf;
  // Estado: únicos 2 valores posibles al ingreso (Parte 1 del rediseño) — ya
  // NO se usa el fijo "🔴 Ingresado". El tercer estado del sistema (LISTO)
  // no lo asigna esta función (se define en un paso posterior del flujo,
  // fuera de este cambio — ver informe de riesgos).
  filaData[cES] = d.esDiagnostico ? "PARA DIAGNOSTICAR" : "PARA REPARAR";
  filaData[cOB] = d.obs;
  filaData[cTRAB]   = Array.isArray(d.trabajosSeleccionados) ? d.trabajosSeleccionados.join(", ") : "";
  filaData[cDET]    = d.detallePresupuesto || "";
  filaData[cPCAL]   = Number(d.precioCalculado) || 0;
  filaData[cTIEMPO] = Number(d.tiempoEstimadoHoras) || 0;
  filaData[cDIAG]   = d.esDiagnostico ? "SI" : "NO";
  // Diferencia: solo auditoría comercial — NO se usa en libroLog ni en caja,
  // que siguen basándose exclusivamente en "Precio Cobrado" (sin tocar).
  filaData[cDIF]    = (Number(d.precioCob) || 0) - (Number(d.precioCalculado) || 0);
  filaData[cPRESD]  = d.esDiagnostico ? "PENDIENTE" : "";

  sheet.getRange(fila, 1, 1, totalCols).setValues([filaData]);
  sheet.getRange(fila, cFE + 1).setNumberFormat("dd/mm/yyyy");
  sheet.getRange(fila, cPC + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cEF + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cTR + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cPCAL + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cDIF  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cNR + 1, 1, totalCols).setBackground("#FDEBD0");

  if (d.precioCob > 0) {
    libroLog({
      origen:"REPARACION", idOperacion:nRep,
      descripcion:`Reparación ${d.equipo} — ${d.falla1}`,
      categoria:"REPARACION", tipo:"INGRESO",
      medio: d.efec > 0 ? "Efectivo" : "Transferencia",
      monto:d.precioCob, referencia:nRep,
      observaciones:d.obs, registradoPor:"Martin"
    });
  }

  Logger.log("procesarReparacion: " + (Date.now() - t0) + " ms");
  return `✅ Reparación ingresada.\nN°: ${nRep}\nCliente: ${d.cliente}\nEquipo: ${d.equipo}\nEstado: 🔴 Ingresado`;
}

function actualizarEstadoReparacion() {
  const cfg   = getConfigCached();
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg.HOJA_REPARACIONES || "Reparaciones");

  const fE   = 2;
  const cNR  = getCol(sheet,"N° Rep",  fE);
  const cCL  = getCol(sheet,"Cliente", fE);
  const cMO  = getCol(sheet,"Equipo",  fE);
  const cES  = getCol(sheet,"Estado",  fE);
  const last = sheet.getLastRow();
  const opciones = [];

  if (last >= fE + 1) {
    const datos = sheet.getRange(fE+1,1,last-fE,sheet.getLastColumn()).getValues();
    datos.forEach(row => {
      const est = String(row[cES-1]);
      if (!est.includes("Retirado")) {
        opciones.push({
          value: row[cNR-1],
          label: `${row[cNR-1]} — ${row[cMO-1]} (${row[cCL-1]}) [${est}]`
        });
      }
    });
  }

  const opHtml = opciones.length
    ? opciones.map(o => `<option value="${o.value}">${o.label}</option>`).join("")
    : `<option>— Sin reparaciones abiertas —</option>`;

  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:18px;font-size:13px}
    label{display:block;margin-top:10px;font-weight:bold;color:#784212}
    select,input{width:100%;padding:7px;margin-top:3px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
    .btn{background:#1E8449;color:#fff;padding:10px;border:none;border-radius:4px;cursor:pointer;margin-top:14px;width:100%;font-size:13px}
  </style>
  <h3 style="color:#784212;margin:0 0 14px">🔧 Actualizar Estado de Reparación</h3>
  <label>Reparación:</label>
  <select id="nRep">${opHtml}</select>
  <label>Nuevo estado:</label>
  <select id="estado">
    <option>🔴 Ingresado</option>
    <option>🟡 En Proceso</option>
    <option>🟢 Listo</option>
    <option>✅ Retirado</option>
    <option>🔄 Garantía</option>
  </select>
  <label>Observaciones adicionales (opcional):</label>
  <input type="text" id="obs" placeholder="Ej: Esperando repuesto"/>
  <button class="btn" onclick="enviar()">✅ Actualizar</button>
  <script>
  function enviar(){
    const nRep=document.getElementById("nRep").value;
    if(!nRep||nRep.includes("Sin")){alert("No hay reparaciones disponibles.");return;}
    google.script.run
      .withSuccessHandler(m=>{alert(m);google.script.host.close();})
      .withFailureHandler(e=>alert("❌ "+e.message))
      .procesarActualizacionRep({nRep,estado:document.getElementById("estado").value,obs:document.getElementById("obs").value});
  }
  </script>
  `).setWidth(420).setHeight(380).setTitle("Actualizar Reparación");
  SpreadsheetApp.getUi().showModalDialog(html,"🔧 Actualizar Estado");
}

function procesarActualizacionRep(d) {
  const cfg   = getConfigCached();
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg.HOJA_REPARACIONES || "Reparaciones");
  const fE    = 2;
  const cNR   = getCol(sheet,"N° Rep",      fE);
  const cES   = getCol(sheet,"Estado",      fE);
  const cFE2  = getCol(sheet,"Fecha Egreso",fE);
  const cOB   = getCol(sheet,"Observaciones",fE);
  const last  = sheet.getLastRow();

  if (last < fE + 1) throw new Error("❌ No hay datos en Reparaciones.");
  const datos = sheet.getRange(fE+1,1,last-fE,sheet.getLastColumn()).getValues();
  let fila = -1;
  datos.forEach((row,i) => { if (String(row[cNR-1]).trim()===d.nRep.trim()) fila=fE+1+i; });

  if (fila===-1) throw new Error(`❌ Reparación "${d.nRep}" no encontrada.`);

  sheet.getRange(fila,cES).setValue(d.estado);
  if (d.estado.includes("Retirado") || d.estado.includes("Listo")) {
    sheet.getRange(fila,cFE2).setValue(new Date()).setNumberFormat("dd/mm/yyyy");
  }
  if (d.obs) {
    const obsActual = sheet.getRange(fila,cOB).getValue();
    sheet.getRange(fila,cOB).setValue(obsActual ? obsActual + " | " + d.obs : d.obs);
  }
  return `✅ Estado actualizado.\nN°: ${d.nRep}\nNuevo estado: ${d.estado}`;
}


// ============================================================
//  MACRO 4 — REGISTRAR GASTO OPERATIVO
// ============================================================

function registrarGasto() {
  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:18px;font-size:13px}
    label{display:block;margin-top:10px;font-weight:bold;color:#7B241C}
    input,select,textarea{width:100%;padding:7px;margin-top:3px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
    .fila2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .btn{background:#7B241C;color:#fff;padding:10px;border:none;border-radius:4px;cursor:pointer;margin-top:14px;width:100%;font-size:13px}
  </style>
  <h3 style="color:#7B241C;margin:0 0 14px">💸 Registrar Gasto Operativo</h3>

  <div class="fila2">
    <div>
      <label>Fecha:</label>
      <input type="date" id="fecha" value="${Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd")}"/>
    </div>
    <div>
      <label>Categoría:</label>
      <select id="cat">
        <option>Alquiler</option><option>Sueldos</option><option>Servicios</option>
        <option>Repuestos</option><option>Publicidad</option><option>Transporte</option>
        <option>Comida</option><option>Impuestos</option><option>Mantenimiento</option>
        <option>Otros</option>
      </select>
    </div>
  </div>

  <label>Descripción:</label>
  <input type="text" id="desc" placeholder="Detalle del gasto"/>

  <div class="fila2">
    <div>
      <label>Monto efectivo ($):</label>
      <input type="number" id="efec" value="0" min="0" oninput="calcTotal()"/>
    </div>
    <div>
      <label>Monto transferencia ($):</label>
      <input type="number" id="transf" value="0" min="0" oninput="calcTotal()"/>
    </div>
  </div>

  <label>Monto USD (dólares):</label>
  <input type="number" id="usd" value="0" min="0" oninput="calcTotal()"/>
  <div style="font-size:11px;color:#666;margin-top:4px" id="cotizDiv"></div>

  <div class="fila2">
    <div>
      <label>Responsable:</label>
      <input type="text" id="resp" value="Martin"/>
    </div>
    <div>
      <label>N° Comprobante (opcional):</label>
      <input type="text" id="comp" placeholder="Ej: FC-0001"/>
    </div>
  </div>

  <label>Observaciones:</label>
  <input type="text" id="obs" placeholder="Opcional"/>

  <div class="total" id="totalDiv" style="background:#FDEDEC;color:#7B241C;padding:8px;border-radius:4px;margin-top:10px;font-weight:bold">Total: $0</div>

  <button class="btn" onclick="enviar()">✅ Registrar gasto</button>

  <script>
  var cotizacionVenta = 0;
  google.script.run.withSuccessHandler(function(cot){
    cotizacionVenta = cot.venta;
    document.getElementById("cotizDiv").textContent =
      "Cotización USD oficial: $" + Number(cot.venta).toLocaleString("es-AR");
    calcTotal();
  }).obtenerCotizacionUSD();

  function fmtP(n){ return "$"+Number(n||0).toLocaleString("es-AR"); }

  function calcTotal(){
    const ef=parseFloat(document.getElementById("efec").value)||0;
    const tr=parseFloat(document.getElementById("transf").value)||0;
    const us=parseFloat(document.getElementById("usd").value)||0;
    const usPesos=us*cotizacionVenta;
    const t=ef+tr+usPesos;
    let txt="Total: "+fmtP(t);
    if(us>0) txt+=" (incluye "+us+" USD ≈ "+fmtP(usPesos)+")";
    document.getElementById("totalDiv").textContent=txt;
  }

  function enviar(){
    const d={
      fecha:document.getElementById("fecha").value,
      cat:document.getElementById("cat").value,
      desc:document.getElementById("desc").value.trim(),
      efec:parseFloat(document.getElementById("efec").value)||0,
      transf:parseFloat(document.getElementById("transf").value)||0,
      usd:parseFloat(document.getElementById("usd").value)||0,
      resp:document.getElementById("resp").value.trim(),
      comp:document.getElementById("comp").value.trim(),
      obs:document.getElementById("obs").value.trim()
    };
    if(!d.desc){alert("❌ Ingresá una descripción.");return;}
    if(d.efec+d.transf+d.usd<=0){alert("❌ El monto total debe ser > 0.");return;}
    google.script.run
      .withSuccessHandler(m=>{alert(m);google.script.host.close();})
      .withFailureHandler(e=>alert("❌ "+e.message))
      .procesarGasto(d);
  }
  </script>
  `).setWidth(440).setHeight(640).setTitle("Registrar Gasto");
  SpreadsheetApp.getUi().showModalDialog(html,"💸 Gasto Operativo");
}

/**
 * procesarGasto(d)
 * d = { fecha, cat, desc, efec, transf, usd (cantidad de dólares), resp, comp, obs }
 *
 * Soporta 3 medios (Efectivo/Transferencia/USD), cualquiera puede ser 0 y
 * pueden coexistir. Ya NO genera un asiento "Mixto": genera UN asiento de
 * Libro Diario por cada medio con monto > 0 — mismo criterio que ya usan
 * procesarVenta()/registrarAccesorioAsociado_()/procesarCompraAccesorios().
 * La columna "Monto USD" se agrega sola en la hoja si todavía no existe
 * (asegurarColumnaGenerica_, no requiere editar la hoja a mano).
 */
function procesarGasto(d) {
  const t0  = Date.now();
  const cfg   = getConfigCached();
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg.HOJA_GASTOS || "Gastos");
  if (!sheet) throw new Error("❌ Hoja 'Gastos' no encontrada.");
  // Mismo requisito que ya exige gastos.html antes de enviar — revalidado
  // acá para que el backend no dependa exclusivamente de esa pantalla.
  if (!String(d.desc || "").trim()) throw new Error("❌ Ingresá una descripción.");

  const fE  = 2;
  // OPTIMIZACIÓN: una sola lectura de encabezados en vez de 9 getCol()
  let hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => {
    const i = hdrs.findIndex(h => String(h).trim() === n.trim());
    if (i === -1) throw new Error(`❌ Columna "${n}" no encontrada en "Gastos" (fila ${fE}).`);
    return i; // 0-based
  };
  const cNG = idx("N° Gasto");
  const cFE = idx("Fecha");
  const cCA = idx("Categoría");
  const cDE = idx("Descripción");
  const cME = idx("Monto Efectivo");
  const cMT = idx("Monto Transferencia");
  const cRE = idx("Responsable");
  const cCO = idx("Comprobante");
  const cOB = idx("Observaciones");

  // Columna nueva: se agrega sola al final si todavía no existe (no rompe
  // hojas ya creadas antes de este cambio).
  const cUSD1based = asegurarColumnaGenerica_(sheet, fE, "Monto USD");
  if (cUSD1based > hdrs.length) {
    hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  }
  const cUSD = cUSD1based - 1;

  const cNG1based = cNG + 1;
  const nGas = genCorrelativo(sheet, cNG1based, cfg.PREFIJO_GASTO || "GAS", fE + 1);
  const fila = getFilaVacia(sheet, cNG1based, fE + 1);

  const efec = Number(d.efec)  || 0;
  const transf = Number(d.transf) || 0;
  const usd  = Number(d.usd)   || 0; // cantidad de dólares

  const cotizacion = obtenerCotizacionUSD();
  const usdEnPesos = convertirUSDaPesos_(usd, cotizacion);
  const montoTotal = efec + transf + usdEnPesos;
  if (montoTotal <= 0) throw new Error("❌ El monto total debe ser > 0.");

  // Reconciliación: si el formulario declaró un monto total del gasto
  // (d.montoGasto), debe coincidir con la suma de los medios — misma
  // tolerancia ($1) que usa procesarVenta() para su TOTAL OPERACIÓN.
  if (d.montoGasto !== undefined && d.montoGasto !== null && d.montoGasto !== "") {
    const montoDeclarado = Number(d.montoGasto) || 0;
    if (montoDeclarado > 0 && Math.abs(montoTotal - montoDeclarado) > 1) {
      throw new Error(`❌ El monto pagado (${fmtPeso(montoTotal)}) no coincide con el monto del gasto (${fmtPeso(montoDeclarado)}).`);
    }
  }

  // OPTIMIZACIÓN: un solo setValues en vez de 9 setValue individuales
  const totalCols = hdrs.length;
  const filaData  = new Array(totalCols).fill("");
  filaData[cNG] = nGas;
  filaData[cFE] = parseDate(d.fecha);
  filaData[cCA] = d.cat;
  filaData[cDE] = d.desc;
  filaData[cME] = efec;
  filaData[cMT] = transf;
  filaData[cUSD] = usd;
  filaData[cRE] = d.resp;
  filaData[cCO] = d.comp;
  filaData[cOB] = d.obs;

  sheet.getRange(fila, 1, 1, totalCols).setValues([filaData]);
  sheet.getRange(fila, cFE + 1).setNumberFormat("dd/mm/yyyy");
  sheet.getRange(fila, cME + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cMT + 1).setNumberFormat("$#,##0");

  // Libro Diario: un asiento por medio realmente usado — NO más "Mixto".
  // La caja conserva los DÓLARES REALES (monto = usd), la conversión a
  // pesos solo se informa en observaciones (mismo criterio "Cambio 3" que
  // usa todo el resto del sistema).
  const obsUSD = usd > 0
    ? `${d.obs ? d.obs + " | " : ""}USD: ${usd} | USD_COTIZACION: ${fmtPeso(cotizacion.venta)} | USD_CONVERTIDO: ${fmtPeso(usdEnPesos)}`
    : d.obs;
  const medios = [
    { medio: "Efectivo",      monto: efec,   obs: d.obs },
    { medio: "Transferencia", monto: transf, obs: d.obs },
    { medio: "USD",           monto: usd,    obs: obsUSD }
  ];
  medios.forEach(m => {
    if (m.monto <= 0) return;
    libroLog({
      origen:"GASTO", idOperacion:nGas,
      descripcion:`Gasto ${d.cat}: ${d.desc}`,
      categoria:d.cat, tipo:"EGRESO",
      medio: m.medio, monto: m.monto, referencia:d.comp,
      observaciones: m.obs, registradoPor:d.resp
    });
  });

  Logger.log("procesarGasto: " + (Date.now() - t0) + " ms");
  return `✅ Gasto registrado.\nN°: ${nGas}\nCategoría: ${d.cat}\nMonto: ${fmtPeso(montoTotal)}` +
    (usd > 0 ? `\nUSD: ${usd} → ${fmtPeso(usdEnPesos)} (cotización ${fmtPeso(cotizacion.venta)})` : ``);
}


// ============================================================
//  MÓDULO — CAMBIO DE MONEDA (submódulo de 💸 Gastos)
//
//  Hoja nueva "CAMBIO_MONEDA" (fila 1 banner, fila 2 encabezados, datos
//  desde fila 3), se crea sola si no existe:
//    N° Cambio | Fecha | OPERADOR | Tipo Cambio | Caja Origen | Caja Destino |
//    Monto USD | Cotización | Monto ARS | Observaciones | Estado
//  (+ ESTADO_REGISTRO / FECHA_CREACION / OPERACION_ORIGEN, agregadas solas
//  por el sistema de anulaciones cuando corresponda).
//
//  NO llama ni copia procesarGasto()/procesarVenta() (protegidas/no
//  protegidas pero intactas). Reutiliza únicamente utilidades existentes:
//  obtenerCotizacionUSD, fmtPeso, libroLog, genCorrelativo, getFilaVacia.
// ============================================================

/** Crea (si no existe) la hoja CAMBIO_MONEDA con sus encabezados. Nunca la borra ni la reescribe si ya existe. */
function asegurarHojaCambioMoneda_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName("CAMBIO_MONEDA");
  if (hoja) return hoja;

  hoja = ss.insertSheet("CAMBIO_MONEDA");
  hoja.getRange(1, 1).setValue("💱 CAMBIO_MONEDA — conversiones USD↔ARS");
  const encabezados = ["N° Cambio", "Fecha", "OPERADOR", "Tipo Cambio", "Caja Origen", "Caja Destino",
                        "Monto USD", "Cotización", "Monto ARS", "Observaciones", "Estado"];
  hoja.getRange(1, 1, 1, encabezados.length).merge().setFontWeight("bold").setBackground("#1A252F").setFontColor("#FFFFFF");
  hoja.getRange(2, 1, 1, encabezados.length).setValues([encabezados])
    .setFontWeight("bold").setBackground("#1A5276").setFontColor("#FFFFFF");
  hoja.setFrozenRows(2);
  return hoja;
}

/**
 * procesarCambioMoneda(d)
 * d = { fecha, operador, cajaOrigen, cajaDestino, montoUSD, cotizacion, obs }
 *
 * Exactamente una de cajaOrigen/cajaDestino debe ser "USD" y la otra
 * "Efectivo" o "Transferencia" — la dirección (Tipo Cambio) se DERIVA de
 * cuál lado es USD, nunca se confía en un campo aparte que podría
 * desincronizarse. Monto ARS SIEMPRE se calcula acá (Monto USD × Cotización)
 * — única fuente de verdad, nunca se recibe ya calculado del cliente.
 * Operación atómica: 1 fila + 2 asientos de Libro Diario (EGRESO en la
 * caja origen, INGRESO en la caja destino).
 */
function procesarCambioMoneda(d) {
  const t0 = Date.now();
  const sheet = asegurarHojaCambioMoneda_();

  const cajasValidas = ["Efectivo", "Transferencia", "USD"];
  const cajaOrigen  = String(d.cajaOrigen  || "").trim();
  const cajaDestino = String(d.cajaDestino || "").trim();
  if (cajasValidas.indexOf(cajaOrigen) === -1 || cajasValidas.indexOf(cajaDestino) === -1) {
    throw new Error("❌ Caja Origen/Destino inválida.");
  }
  if (cajaOrigen === cajaDestino) {
    throw new Error("❌ Caja Origen y Caja Destino no pueden ser la misma.");
  }
  const esOrigenUSD  = cajaOrigen  === "USD";
  const esDestinoUSD = cajaDestino === "USD";
  if (esOrigenUSD === esDestinoUSD) {
    throw new Error("❌ Un Cambio de Moneda siempre tiene que tener USD en un solo lado (Origen o Destino).");
  }
  const tipoCambio = esOrigenUSD ? "USD→ARS" : "ARS→USD";

  const montoUSD    = Number(d.montoUSD) || 0;
  const cotizacion  = Number(d.cotizacion) || 0;
  if (montoUSD <= 0)   throw new Error("❌ El monto en USD debe ser > 0.");
  if (cotizacion <= 0) throw new Error("❌ La cotización debe ser > 0.");
  const montoARS = Math.round(montoUSD * cotizacion);

  const fE = 2;
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => {
    const i = hdrs.findIndex(h => String(h).trim() === n);
    if (i === -1) throw new Error(`❌ Columna "${n}" no encontrada en "CAMBIO_MONEDA" (fila ${fE}).`);
    return i;
  };
  const cNC = idx("N° Cambio"), cFE = idx("Fecha"), cOP = idx("OPERADOR"), cTC = idx("Tipo Cambio"),
        cCO = idx("Caja Origen"), cCD = idx("Caja Destino"), cMU = idx("Monto USD"),
        cCOT = idx("Cotización"), cMA = idx("Monto ARS"), cOBS = idx("Observaciones"), cEST = idx("Estado");

  const nCambio = genCorrelativo(sheet, cNC + 1, "CAM", fE + 1);
  const fila    = getFilaVacia(sheet, cNC + 1, fE + 1);

  const filaData = new Array(hdrs.length).fill("");
  filaData[cNC]  = nCambio;
  filaData[cFE]  = parseDate(d.fecha);
  filaData[cOP]  = d.operador || "";
  filaData[cTC]  = tipoCambio;
  filaData[cCO]  = cajaOrigen;
  filaData[cCD]  = cajaDestino;
  filaData[cMU]  = montoUSD;
  filaData[cCOT] = cotizacion;
  filaData[cMA]  = montoARS;
  filaData[cOBS] = d.obs || "";
  filaData[cEST] = "PROCESADA";

  sheet.getRange(fila, 1, 1, hdrs.length).setValues([filaData]);
  sheet.getRange(fila, cFE  + 1).setNumberFormat("dd/mm/yyyy");
  sheet.getRange(fila, cMA  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cCOT + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cNC  + 1, 1, hdrs.length).setBackground("#EAF2FF");

  // Libro Diario: 2 asientos como operación atómica (salida de la caja
  // origen, entrada en la caja destino). El lado "USD" siempre se loguea
  // en cantidad de dólares reales (nunca convertido) — mismo criterio
  // "Cambio 3" de todo el sistema.
  const descripcion = `Cambio de moneda ${tipoCambio}: ${cajaOrigen} → ${cajaDestino}`;
  libroLog({
    origen:"CAMBIO_MONEDA", idOperacion:nCambio,
    descripcion, categoria:"CAMBIO_MONEDA", tipo:"EGRESO",
    medio: cajaOrigen, monto: esOrigenUSD ? montoUSD : montoARS,
    referencia: nCambio, observaciones: d.obs || "", registradoPor: d.operador || "Martin"
  });
  libroLog({
    origen:"CAMBIO_MONEDA", idOperacion:nCambio,
    descripcion, categoria:"CAMBIO_MONEDA", tipo:"INGRESO",
    medio: cajaDestino, monto: esDestinoUSD ? montoUSD : montoARS,
    referencia: nCambio, observaciones: d.obs || "", registradoPor: d.operador || "Martin"
  });

  registrarAuditoria_("CAMBIO_MONEDA", nCambio, "ALTA", `${tipoCambio}: ${fmtPeso(montoARS)} / USD ${montoUSD} (cotización ${fmtPeso(cotizacion)})`);

  Logger.log("procesarCambioMoneda: " + (Date.now() - t0) + " ms");
  return `✅ Cambio de moneda registrado.\nN°: ${nCambio}\n${tipoCambio}: ${cajaOrigen} → ${cajaDestino}\nUSD ${montoUSD} — ${fmtPeso(montoARS)} (cotización ${fmtPeso(cotizacion)})`;
}


// ============================================================
//  MÓDULO — AJUSTES DE CAJA (submódulo de 💸 Gastos)
//
//  Hoja nueva "AJUSTES_CAJA" (mismo esqueleto: fila 1 banner, fila 2
//  encabezados, datos desde fila 3), se crea sola si no existe:
//    N° Ajuste | Fecha | OPERADOR | Caja | Tipo Ajuste | Monto | Motivo |
//    Observaciones | Estado
//  (+ ESTADO_REGISTRO / FECHA_CREACION / OPERACION_ORIGEN, igual criterio).
// ============================================================

/** Crea (si no existe) la hoja AJUSTES_CAJA con sus encabezados. Nunca la borra ni la reescribe si ya existe. */
function asegurarHojaAjustesCaja_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName("AJUSTES_CAJA");
  if (hoja) return hoja;

  hoja = ss.insertSheet("AJUSTES_CAJA");
  hoja.getRange(1, 1).setValue("🧾 AJUSTES_CAJA — sobrantes/faltantes de conciliación de caja");
  const encabezados = ["N° Ajuste", "Fecha", "OPERADOR", "Caja", "Tipo Ajuste", "Monto", "Motivo", "Observaciones", "Estado"];
  hoja.getRange(1, 1, 1, encabezados.length).merge().setFontWeight("bold").setBackground("#1A252F").setFontColor("#FFFFFF");
  hoja.getRange(2, 1, 1, encabezados.length).setValues([encabezados])
    .setFontWeight("bold").setBackground("#1A5276").setFontColor("#FFFFFF");
  hoja.setFrozenRows(2);
  return hoja;
}

/**
 * procesarAjusteCaja(d)
 * d = { fecha, operador, caja ("Efectivo"|"Transferencia"|"USD"),
 *       tipoAjuste ("Sobrante"|"Faltante"), monto, motivo, obs }
 *
 * Si Caja="USD", `monto` es cantidad de dólares (no pesos) — mismo criterio
 * "Cambio 3" que todo el sistema. Sobrante → INGRESO; Faltante → EGRESO.
 */
function procesarAjusteCaja(d) {
  const t0 = Date.now();
  const sheet = asegurarHojaAjustesCaja_();

  const cajasValidas = ["Efectivo", "Transferencia", "USD"];
  const caja = String(d.caja || "").trim();
  if (cajasValidas.indexOf(caja) === -1) throw new Error("❌ Caja inválida.");

  const tiposValidos = ["Sobrante", "Faltante"];
  const tipoAjuste = String(d.tipoAjuste || "").trim();
  if (tiposValidos.indexOf(tipoAjuste) === -1) throw new Error("❌ Tipo de ajuste inválido.");

  const monto = Number(d.monto) || 0;
  if (monto <= 0) throw new Error("❌ El monto del ajuste debe ser > 0.");
  if (!String(d.motivo || "").trim()) throw new Error("❌ Ingresá el motivo del ajuste.");

  const fE = 2;
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => {
    const i = hdrs.findIndex(h => String(h).trim() === n);
    if (i === -1) throw new Error(`❌ Columna "${n}" no encontrada en "AJUSTES_CAJA" (fila ${fE}).`);
    return i;
  };
  const cNA = idx("N° Ajuste"), cFE = idx("Fecha"), cOP = idx("OPERADOR"), cCA = idx("Caja"),
        cTA = idx("Tipo Ajuste"), cMO = idx("Monto"), cMT = idx("Motivo"), cOBS = idx("Observaciones"), cEST = idx("Estado");

  const nAjuste = genCorrelativo(sheet, cNA + 1, "AJC", fE + 1);
  const fila    = getFilaVacia(sheet, cNA + 1, fE + 1);

  const filaData = new Array(hdrs.length).fill("");
  filaData[cNA]  = nAjuste;
  filaData[cFE]  = parseDate(d.fecha);
  filaData[cOP]  = d.operador || "";
  filaData[cCA]  = caja;
  filaData[cTA]  = tipoAjuste;
  filaData[cMO]  = monto;
  filaData[cMT]  = d.motivo.trim();
  filaData[cOBS] = d.obs || "";
  filaData[cEST] = "PROCESADA";

  sheet.getRange(fila, 1, 1, hdrs.length).setValues([filaData]);
  sheet.getRange(fila, cFE + 1).setNumberFormat("dd/mm/yyyy");
  if (caja !== "USD") sheet.getRange(fila, cMO + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cNA + 1, 1, hdrs.length).setBackground(tipoAjuste === "Sobrante" ? "#EAFAF1" : "#FDEDEC");

  libroLog({
    origen:"AJUSTE_CAJA", idOperacion:nAjuste,
    descripcion:`Ajuste de caja (${tipoAjuste}): ${d.motivo.trim()}`,
    categoria:"AJUSTE_CAJA",
    tipo: tipoAjuste === "Sobrante" ? "INGRESO" : "EGRESO",
    medio: caja, monto: monto, referencia: nAjuste,
    observaciones: d.obs || "", registradoPor: d.operador || "Martin"
  });

  registrarAuditoria_("AJUSTE_CAJA", nAjuste, "ALTA", `${tipoAjuste} de ${fmtPeso(monto)} en ${caja}: ${d.motivo.trim()}`);

  Logger.log("procesarAjusteCaja: " + (Date.now() - t0) + " ms");
  return `✅ Ajuste de caja registrado.\nN°: ${nAjuste}\n${tipoAjuste} en ${caja}: ${fmtPeso(monto)}`;
}


// ============================================================
//  MACRO 5 — INVERSORES
// ============================================================

function registrarMovimientoInversor() {
  const cfg      = getConfigCached();
  const inversores = cfg.INV_ARRAY || ["Eva","Beto","Paz","Sam"];

  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:18px;font-size:13px}
    label{display:block;margin-top:10px;font-weight:bold;color:#1A252F}
    select,input{width:100%;padding:7px;margin-top:3px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
    .btn{background:#1A5276;color:#fff;padding:10px;border:none;border-radius:4px;cursor:pointer;margin-top:14px;width:100%;font-size:13px}
    .info{background:#EBF5FB;border-left:4px solid #2980B9;padding:8px;margin-top:10px;font-size:11px}
  </style>
  <h3 style="color:#1A252F;margin:0 0 14px">🏦 Movimiento de Inversor</h3>

  <label>Inversor:</label>
  <select id="inv">${inversores.map(n=>`<option>${n}</option>`).join("")}</select>

  <label>Tipo:</label>
  <select id="tipo">
    <option value="INGRESO_CAPITAL">INGRESO_CAPITAL — suma capital</option>
    <option value="RETIRO_CAPITAL">RETIRO_CAPITAL — retira capital</option>
    <option value="PAGO_RENDIMIENTO">PAGO_RENDIMIENTO — se paga rendimiento</option>
    <option value="AJUSTE">AJUSTE — corrección</option>
  </select>

  <label>Fecha:</label>
  <input type="date" id="fecha" value="${Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd")}"/>

  <label>Monto ($):</label>
  <input type="number" id="monto" placeholder="Ingresá el monto" min="1"/>

  <label>Detalle:</label>
  <input type="text" id="detalle" placeholder="Descripción del movimiento"/>

  <div class="info">ℹ️ El capital en la tabla resumen se actualiza automáticamente.</div>

  <button class="btn" onclick="enviar()">✅ Registrar</button>
  <script>
  function enviar(){
    const d={
      inv:document.getElementById("inv").value,
      tipo:document.getElementById("tipo").value,
      fecha:document.getElementById("fecha").value,
      monto:parseFloat(document.getElementById("monto").value)||0,
      detalle:document.getElementById("detalle").value.trim()
    };
    if(d.monto<=0){alert("❌ El monto debe ser > 0.");return;}
    if(!d.detalle){alert("❌ Ingresá un detalle.");return;}
    google.script.run
      .withSuccessHandler(m=>{alert(m);google.script.host.close();})
      .withFailureHandler(e=>alert("❌ "+e.message))
      .procesarMovimientoInversor(d);
  }
  </script>
  `).setWidth(420).setHeight(480).setTitle("Movimiento Inversor");
  SpreadsheetApp.getUi().showModalDialog(html,"🏦 Inversor");
}

function procesarMovimientoInversor(d) {
  const cfg  = getConfigCached();
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const invSheet = ss.getSheetByName(cfg.HOJA_INVERSORES || "Inversores");
  if (!invSheet) throw new Error("❌ Hoja 'Inversores' no encontrada.");

  const fE     = 8;
  const cNom   = getCol(invSheet,"Nombre",            fE);
  const cCap   = getCol(invSheet,"Capital Invertido", fE);
  const cPag   = getCol(invSheet,"Pagado Total",      fE);
  const cPend  = getCol(invSheet,"Pendiente de Pago", fE);

  const lastRow = invSheet.getLastRow();
  let filaInv = -1;
  for (let r = fE + 1; r <= lastRow; r++) {
    if (String(invSheet.getRange(r, cNom).getValue()).trim() === d.inv) {
      filaInv = r; break;
    }
  }
  if (filaInv === -1) throw new Error(`❌ Inversor "${d.inv}" no encontrado en tabla resumen.`);

  const capActual  = parseFloat(invSheet.getRange(filaInv, cCap).getValue()) || 0;
  const pagActual  = parseFloat(invSheet.getRange(filaInv, cPag).getValue()) || 0;
  const pendActual = parseFloat(invSheet.getRange(filaInv, cPend).getValue()) || 0;

  if (d.tipo === "RETIRO_CAPITAL" && d.monto > capActual) {
    throw new Error(`❌ No se puede retirar ${fmtPeso(d.monto)}. Capital disponible: ${fmtPeso(capActual)}.`);
  }
  if (d.tipo === "PAGO_RENDIMIENTO" && d.monto > pendActual) {
    throw new Error(`❌ El pago ${fmtPeso(d.monto)} supera el pendiente ${fmtPeso(pendActual)}.`);
  }

  const colA      = invSheet.getRange(1,1,lastRow,1).getValues();
  let filaEncMov  = -1;
  let enPanelInv  = false;
  for (let i = 0; i < colA.length; i++) {
    const cell = String(colA[i][0]);
    if (cell.includes(d.inv) && cell.includes("Panel del Inversor")) enPanelInv = true;
    if (enPanelInv && cell.includes("MOVIMIENTOS DE CAPITAL")) { filaEncMov = i + 2; break; }
    if (enPanelInv && i > 0 && cell.includes("Panel del Inversor") && !cell.includes(d.inv)) break;
  }
  if (filaEncMov === -1) throw new Error(`❌ No se encontró tabla de movimientos para "${d.inv}".`);

  const cFec  = getCol(invSheet,"Fecha",              filaEncMov);
  const cTip  = getCol(invSheet,"Tipo",               filaEncMov);
  const cDet  = getCol(invSheet,"Detalle",            filaEncMov);
  const cMon  = getCol(invSheet,"Monto",              filaEncMov);
  const cCapR = getCol(invSheet,"Capital Resultante", filaEncMov);
  const cReg  = getCol(invSheet,"Registrado por",     filaEncMov);
  const filaMov = getFilaVacia(invSheet, cFec, filaEncMov + 1);

  let capResultante = capActual;
  if (d.tipo === "INGRESO_CAPITAL")  capResultante = capActual + d.monto;
  if (d.tipo === "RETIRO_CAPITAL")   capResultante = capActual - d.monto;

  invSheet.getRange(filaMov,cFec).setValue(parseDate(d.fecha)).setNumberFormat("dd/mm/yyyy");
  invSheet.getRange(filaMov,cTip).setValue(d.tipo);
  invSheet.getRange(filaMov,cDet).setValue(d.detalle);
  invSheet.getRange(filaMov,cMon).setValue(d.monto).setNumberFormat("$#,##0");
  invSheet.getRange(filaMov,cCapR).setValue(
    d.tipo === "PAGO_RENDIMIENTO" ? capActual : capResultante
  ).setNumberFormat("$#,##0");
  invSheet.getRange(filaMov,cReg).setValue("Martin");

  const colores = {INGRESO_CAPITAL:"#D5F5E3",RETIRO_CAPITAL:"#FADBD8",PAGO_RENDIMIENTO:"#EBF5FB",AJUSTE:"#FEF9E7"};
  invSheet.getRange(filaMov,cFec,1,cReg-cFec+1).setBackground(colores[d.tipo]||"#FFFFFF");

  if (d.tipo === "INGRESO_CAPITAL" || d.tipo === "RETIRO_CAPITAL") {
    invSheet.getRange(filaInv,cCap).setValue(capResultante).setNumberFormat("$#,##0");
  }
  if (d.tipo === "PAGO_RENDIMIENTO") {
    invSheet.getRange(filaInv,cPag).setValue(pagActual + d.monto).setNumberFormat("$#,##0");
  }

  const tipoLD = d.tipo === "INGRESO_CAPITAL" ? "INGRESO"
    : d.tipo === "RETIRO_CAPITAL" ? "EGRESO"
    : d.tipo === "PAGO_RENDIMIENTO" ? "EGRESO" : "NEUTRO";

  libroLog({
    origen:`INVERSOR_${d.tipo}`, idOperacion:d.inv,
    descripcion:`${d.tipo} — ${d.inv}: ${d.detalle}`,
    categoria:"INVERSOR", tipo:tipoLD,
    medio:"Transferencia", monto:d.monto,
    referencia:d.inv, observaciones:"",
    registradoPor:"Martin"
  });

  return `✅ Movimiento registrado.\nInversor: ${d.inv}\nTipo: ${d.tipo}\nMonto: ${fmtPeso(d.monto)}`;
}

function generarRendimientoMensual() {
  const cfg   = getConfigCached();
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const invSh = ss.getSheetByName(cfg.HOJA_INVERSORES || "Inversores");
  const inv   = cfg.INV_ARRAY || ["Eva","Beto","Paz","Sam"];
  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const ahora = new Date();
  const periodo = `${meses[ahora.getMonth()]} ${ahora.getFullYear()}`;

  const fE    = 8;
  const cNom  = getCol(invSh,"Nombre",            fE);
  const cCap  = getCol(invSh,"Capital Invertido", fE);
  const cRend = getCol(invSh,"Rend. Mensual (20%)",fE);

  const resultados = [];
  const lastRow    = invSh.getLastRow();
  const colA       = invSh.getRange(1,1,lastRow,1).getValues();

  inv.forEach(nombre => {
    let filaInv = -1;
    for (let r = fE + 1; r <= lastRow; r++) {
      if (String(invSh.getRange(r,cNom).getValue()).trim() === nombre) { filaInv=r; break; }
    }
    if (filaInv === -1) { resultados.push(`⚠️ ${nombre}: no encontrado`); return; }

    const cap  = parseFloat(invSh.getRange(filaInv,cCap).getValue()) || 0;
    const rend = parseFloat(invSh.getRange(filaInv,cRend).getValue()) || cap * (cfg.TASA_MENSUAL || 0.2);

    let filaEncRend = -1, enPanel = false;
    for (let i = 0; i < colA.length; i++) {
      const cell = String(colA[i][0]);
      if (cell.includes(nombre) && cell.includes("Panel del Inversor")) enPanel = true;
      if (enPanel && cell.includes("RENDIMIENTOS MENSUALES")) { filaEncRend = i + 2; break; }
      if (enPanel && i > 0 && cell.includes("Panel del Inversor") && !cell.includes(nombre)) break;
    }
    if (filaEncRend === -1) { resultados.push(`⚠️ ${nombre}: tabla rendimientos no encontrada`); return; }

    const cPer = getCol(invSh,"Período",         filaEncRend);
    const cCB  = getCol(invSh,"Capital Base",    filaEncRend);
    const cR20 = getCol(invSh,"Rendimiento 20%", filaEncRend);
    const cEst = getCol(invSh,"Estado Pago",     filaEncRend);

    const ultimaFila = invSh.getLastRow();
    const inicio     = filaEncRend + 1;
    if (inicio <= ultimaFila) {
      const periodos = invSh.getRange(inicio, cPer, ultimaFila - inicio + 1, 1).getValues();
      if (periodos.some(r => String(r[0]).trim() === periodo)) {
        resultados.push(`⚠️ ${nombre}: ${periodo} ya existe`);
        return;
      }
    }

    const filaNva = getFilaVacia(invSh, cPer, filaEncRend + 1);
    invSh.getRange(filaNva,cPer).setValue(periodo);
    invSh.getRange(filaNva,cCB).setValue(cap).setNumberFormat("$#,##0");
    invSh.getRange(filaNva,cR20).setValue(rend).setNumberFormat("$#,##0");
    invSh.getRange(filaNva,cEst).setValue("PENDIENTE").setFontColor("#E74C3C").setFontWeight("bold");
    invSh.getRange(filaNva,cPer,1,7).setBackground("#EAFAF1");

    resultados.push(`✅ ${nombre}: ${fmtPeso(rend)} — ${periodo}`);
  });

  SpreadsheetApp.getUi().alert(
    `📅 Rendimiento ${periodo}`,
    resultados.join("\n"),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}


// ============================================================
//  MACRO 6 — ACTUALIZAR STOCK
// ============================================================

/**
 * actualizarStock_(nOp)
 *
 * Si se pasa `nOp` (N° OP de Compras), actualiza SOLO la fila de Stock de
 * ese equipo (compra puntual, venta puntual, o entrega de preventa) en vez
 * de reconstruir toda la hoja Stock. Delega en actualizarStockUnEquipo_().
 *
 * Si se llama sin argumentos (comportamiento original, usado por el botón
 * manual "Actualizar Stock" y por validarConsistencia), reconstruye toda la
 * hoja como siempre — se mantiene intacto para permitir un refresco total
 * cuando se sospecha de un desvío de datos.
 */
function actualizarStock_(nOp) {
  const t0       = Date.now();
  const cfg      = getConfigCached();
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const compSh   = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  const stockSh  = ss.getSheetByName(cfg.HOJA_STOCK   || "Stock");
  if (!stockSh) return;

  if (nOp) {
    actualizarStockUnEquipo_(compSh, stockSh, nOp);
    Logger.log("actualizarStock_ (puntual " + nOp + "): " + (Date.now() - t0) + " ms");
    return;
  }

  const fE  = 2;
  // OPTIMIZACIÓN: una sola lectura de encabezados de Compras en vez de 14
  // llamadas a getCol() (cada una era un roundtrip getRange().getValues()).
  const headersComp = compSh.getRange(fE, 1, 1, compSh.getLastColumn()).getValues()[0];
  const idxComp = (nombre) => {
    const idx = headersComp.findIndex(h => String(h).trim() === nombre.trim());
    if (idx === -1) throw new Error(`❌ Columna "${nombre}" no encontrada en "Compras" (fila ${fE}).`);
    return idx; // 0-based
  };
  const cOP = idxComp("N° OP");
  const cFI = idxComp("Fecha Ingreso");
  const cTI = idxComp("Tipo Ingreso");
  const cMO = idxComp("Equipo / Modelo");
  const cIM = idxComp("IMEI");
  const cCO = idxComp("Color");
  const cEF = idxComp("Estado Físico");
  const cPC = idxComp("Precio Compra");
  const cPV = idxComp("Precio Estimado Venta");
  const cRE = idxComp("¿Necesita Reparación?");
  const cCR = idxComp("Costo Reparación Estimado");
  const cPR = idxComp("Proveedor / Origen");
  const cOB = idxComp("Observaciones");
  const cES = idxComp("Estado");

  const lastC = compSh.getLastRow();
  if (lastC < fE + 1) return;

  // OPTIMIZACIÓN: una sola lectura de todas las filas de Compras (ya estaba
  // así de origen, se mantiene).
  const datos = compSh.getRange(fE+1, 1, lastC-fE, compSh.getLastColumn()).getValues();
  const hoy   = new Date();

  const fES = 9;
  const lastS = stockSh.getLastRow();
  if (lastS > fES) stockSh.getRange(fES+1, 1, lastS-fES, 15).clear();

  // OPTIMIZACIÓN: una sola lectura de encabezados de Stock en vez de 15
  // llamadas a getCol().
  const headersStock = stockSh.getRange(fES, 1, 1, 15).getValues()[0];
  const idxStock = (nombre) => {
    const idx = headersStock.findIndex(h => String(h).trim() === nombre.trim());
    if (idx === -1) throw new Error(`❌ Columna "${nombre}" no encontrada en "Stock" (fila ${fES}).`);
    return idx; // 0-based
  };
  const cSOp = idxStock("N° OP");
  const cSFI = idxStock("Fecha Ingreso");
  const cSTi = idxStock("Tipo");
  const cSMo = idxStock("Modelo");
  const cSIM = idxStock("IMEI");
  const cSCo = idxStock("Color");
  const cSEF = idxStock("Estado Físico");
  const cSPC = idxStock("Precio Compra / Consignación");
  const cSPV = idxStock("Precio Est. Venta");
  const cSRe = idxStock("¿Reparación?");
  const cSCR = idxStock("Costo Rep. Est.");
  const cSDi = idxStock("Días en Stock");
  const cSPr = idxStock("Proveedor");
  const cSOb = idxStock("Observaciones");
  const cSEs = idxStock("Estado");

  // OPTIMIZACIÓN PRINCIPAL: en vez de hacer ~14 setValue() + setBackground()
  // + setNumberFormat() POR CADA fila de equipo (lo que con 50 equipos en
  // stock eran 700+ roundtrips a Sheets), se arma todo en memoria (filas,
  // colores y fechas con formato) y se escribe con un único setValues() +
  // un único setBackgrounds() al final. Misma lógica de filtrado, mismos
  // estados soportados, mismo cálculo de días en stock.
  const filasStock  = [];
  const coloresStock = [];

  datos.forEach(row => {
    const est = String(row[cES]);
    // Soporta: 📦 En Stock | 🔧 En Reparación | 🔵 Reservado Preventa | 🟣 Preventa + Reparación
    if (!est.includes("En Stock") && !est.includes("Reparación") && !est.includes("Reservado Preventa") && !est.includes("Preventa + Reparación")) return;

    const fechaIngreso = new Date(row[cFI]);
    const diasEnStock  = isNaN(fechaIngreso) ? 0 : Math.floor((hoy - fechaIngreso) / 86400000);

    const filaS = new Array(15).fill("");
    filaS[cSOp] = row[cOP];
    filaS[cSFI] = row[cFI];
    filaS[cSTi] = row[cTI];
    filaS[cSMo] = row[cMO];
    filaS[cSIM] = row[cIM];
    filaS[cSCo] = row[cCO];
    filaS[cSEF] = row[cEF];
    filaS[cSPC] = row[cPC];
    filaS[cSPV] = row[cPV];
    filaS[cSRe] = row[cRE];
    filaS[cSCR] = row[cCR];
    filaS[cSDi] = diasEnStock;
    filaS[cSPr] = row[cPR];
    filaS[cSOb] = row[cOB];
    filaS[cSEs] = est;
    filasStock.push(filaS);

    // Color por estado, evaluando primero el estado combinado para que no
    // lo "tape" Reparación (misma lógica que antes).
    const color =
      est === "🟣 Preventa + Reparación" ? "#C39BD3" :
      est === "🔵 Reservado Preventa"    ? "#EAD9F7" :
      est.includes("Reparación")          ? "#FDEBD0" :
      "#EBF5FB";
    coloresStock.push(new Array(15).fill(color));
  });

  if (filasStock.length > 0) {
    const rango = stockSh.getRange(fES + 1, 1, filasStock.length, 15);
    rango.setValues(filasStock);
    rango.setBackgrounds(coloresStock);
    // Formato de fecha y montos en batch (una llamada por columna, no por celda)
    stockSh.getRange(fES + 1, cSFI + 1, filasStock.length, 1).setNumberFormat("dd/mm/yyyy");
    stockSh.getRange(fES + 1, cSPC + 1, filasStock.length, 1).setNumberFormat("$#,##0");
    stockSh.getRange(fES + 1, cSPV + 1, filasStock.length, 1).setNumberFormat("$#,##0");
    stockSh.getRange(fES + 1, cSCR + 1, filasStock.length, 1).setNumberFormat("$#,##0");
  }

  Logger.log(`Stock actualizado: ${filasStock.length} equipos activos.`);
  Logger.log("actualizarStock_: " + (Date.now() - t0) + " ms");
}

/**
 * actualizarStockUnEquipo_(compSh, stockSh, nOp)
 *
 * Actualiza en Stock SOLO la fila correspondiente al N° OP indicado:
 *  - Si el equipo debe figurar en Stock (📦 En Stock / 🔧 En Reparación /
 *    🔵 Reservado Preventa / 🟣 Preventa + Reparación) y ya tenía fila,
 *    la actualiza en el lugar. Si no tenía fila, la agrega al final.
 *  - Si el equipo YA NO debe figurar en Stock (p.ej. se vendió), y tenía
 *    fila, la elimina.
 * No lee ni reescribe el resto de Compras/Stock — solo la fila afectada.
 */
function actualizarStockUnEquipo_(compSh, stockSh, nOp) {
  const fE = 2;
  const headersComp = compSh.getRange(fE, 1, 1, compSh.getLastColumn()).getValues()[0];
  const idxComp = (nombre) => {
    const idx = headersComp.findIndex(h => String(h).trim() === nombre.trim());
    if (idx === -1) throw new Error(`❌ Columna "${nombre}" no encontrada en "Compras" (fila ${fE}).`);
    return idx; // 0-based
  };
  const cOP = idxComp("N° OP");
  const cFI = idxComp("Fecha Ingreso");
  const cTI = idxComp("Tipo Ingreso");
  const cMO = idxComp("Equipo / Modelo");
  const cIM = idxComp("IMEI");
  const cCO = idxComp("Color");
  const cEF = idxComp("Estado Físico");
  const cPC = idxComp("Precio Compra");
  const cPV = idxComp("Precio Estimado Venta");
  const cRE = idxComp("¿Necesita Reparación?");
  const cCR = idxComp("Costo Reparación Estimado");
  const cPR = idxComp("Proveedor / Origen");
  const cOB = idxComp("Observaciones");
  const cES = idxComp("Estado");

  const lastC = compSh.getLastRow();
  if (lastC < fE + 1) return;

  // Búsqueda puntual del N° OP: se lee solo la columna N° OP, no toda la hoja.
  const colOpVals = compSh.getRange(fE + 1, cOP + 1, lastC - fE, 1).getValues();
  let filaCompra = -1;
  for (let i = 0; i < colOpVals.length; i++) {
    if (String(colOpVals[i][0]).trim() === String(nOp).trim()) { filaCompra = fE + 1 + i; break; }
  }
  if (filaCompra === -1) return; // no encontrado: nada que actualizar

  const rowC = compSh.getRange(filaCompra, 1, 1, compSh.getLastColumn()).getValues()[0];
  const est  = String(rowC[cES]);
  // Soporta: 📦 En Stock | 🔧 En Reparación | 🔵 Reservado Preventa | 🟣 Preventa + Reparación
  const debeEstarEnStock = est.includes("En Stock") || est.includes("Reparación") || est.includes("Reservado Preventa") || est.includes("Preventa + Reparación");

  const fES = 9;
  const headersStock = stockSh.getRange(fES, 1, 1, 15).getValues()[0];
  const idxStock = (nombre) => {
    const idx = headersStock.findIndex(h => String(h).trim() === nombre.trim());
    if (idx === -1) throw new Error(`❌ Columna "${nombre}" no encontrada en "Stock" (fila ${fES}).`);
    return idx; // 0-based
  };
  const cSOp = idxStock("N° OP");
  const cSFI = idxStock("Fecha Ingreso");
  const cSTi = idxStock("Tipo");
  const cSMo = idxStock("Modelo");
  const cSIM = idxStock("IMEI");
  const cSCo = idxStock("Color");
  const cSEF = idxStock("Estado Físico");
  const cSPC = idxStock("Precio Compra / Consignación");
  const cSPV = idxStock("Precio Est. Venta");
  const cSRe = idxStock("¿Reparación?");
  const cSCR = idxStock("Costo Rep. Est.");
  const cSDi = idxStock("Días en Stock");
  const cSPr = idxStock("Proveedor");
  const cSOb = idxStock("Observaciones");
  const cSEs = idxStock("Estado");

  // Ubicar si el equipo ya tiene fila en Stock (lectura puntual de la
  // columna N° OP de Stock, no de toda la hoja).
  const lastS = stockSh.getLastRow();
  let filaStock = -1;
  if (lastS > fES) {
    const colStockOp = stockSh.getRange(fES + 1, cSOp + 1, lastS - fES, 1).getValues();
    for (let i = 0; i < colStockOp.length; i++) {
      if (String(colStockOp[i][0]).trim() === String(nOp).trim()) { filaStock = fES + 1 + i; break; }
    }
  }

  if (!debeEstarEnStock) {
    if (filaStock !== -1) stockSh.deleteRow(filaStock);
    return;
  }

  const hoy = new Date();
  const fechaIngreso = new Date(rowC[cFI]);
  const diasEnStock  = isNaN(fechaIngreso) ? 0 : Math.floor((hoy - fechaIngreso) / 86400000);

  const filaS = new Array(15).fill("");
  filaS[cSOp] = rowC[cOP];
  filaS[cSFI] = rowC[cFI];
  filaS[cSTi] = rowC[cTI];
  filaS[cSMo] = rowC[cMO];
  filaS[cSIM] = rowC[cIM];
  filaS[cSCo] = rowC[cCO];
  filaS[cSEF] = rowC[cEF];
  filaS[cSPC] = rowC[cPC];
  filaS[cSPV] = rowC[cPV];
  filaS[cSRe] = rowC[cRE];
  filaS[cSCR] = rowC[cCR];
  filaS[cSDi] = diasEnStock;
  filaS[cSPr] = rowC[cPR];
  filaS[cSOb] = rowC[cOB];
  filaS[cSEs] = est;

  const color =
    est === "🟣 Preventa + Reparación" ? "#C39BD3" :
    est === "🔵 Reservado Preventa"    ? "#EAD9F7" :
    est.includes("Reparación")          ? "#FDEBD0" :
    "#EBF5FB";

  const filaDestino = filaStock !== -1 ? filaStock : getFilaVacia(stockSh, cSOp + 1, fES + 1);
  const rango = stockSh.getRange(filaDestino, 1, 1, 15);
  rango.setValues([filaS]);
  rango.setBackground(color);
  stockSh.getRange(filaDestino, cSFI + 1).setNumberFormat("dd/mm/yyyy");
  stockSh.getRange(filaDestino, cSPC + 1).setNumberFormat("$#,##0");
  stockSh.getRange(filaDestino, cSPV + 1).setNumberFormat("$#,##0");
  stockSh.getRange(filaDestino, cSCR + 1).setNumberFormat("$#,##0");
}

function actualizarStockManual() {
  actualizarStock_();
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert("✅ Stock actualizado correctamente.");
}


// ============================================================
//  MACRO 7 — VALIDAR CONSISTENCIA
// ============================================================

function validarConsistencia() {
  const cfg = getConfigCached();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const errores = [], ok = [];

  const hojasReq = ["Compras","Ventas","Reparaciones","Inversores","Caja","Gastos","Libro Diario","Config","Stock","Preventas"];
  hojasReq.forEach(h => {
    if (ss.getSheetByName(h)) ok.push(`✅ Hoja "${h}" presente`);
    else errores.push(`❌ Hoja "${h}" NO encontrada`);
  });

  const cfg2 = getConfigCached();
  ["HOJA_COMPRAS","HOJA_VENTAS","TASA_MENSUAL","INVERSORES_LISTA"].forEach(k => {
    if (cfg2[k]) ok.push(`✅ Config: ${k} = ${cfg2[k]}`);
    else errores.push(`❌ Config: falta parámetro "${k}"`);
  });

  try {
    const compSh = ss.getSheetByName("Compras");
    const ventSh = ss.getSheetByName("Ventas");
    const fE = 2;
    const cOPc = getCol(compSh,"N° OP", fE);
    const cEsc = getCol(compSh,"Estado",fE);
    const cOPv = getCol(ventSh,"N° OP Compra",fE);
    const lastC = compSh.getLastRow();
    const lastV = ventSh.getLastRow();

    if (lastC > fE) {
      const compras  = compSh.getRange(fE+1,1,lastC-fE,compSh.getLastColumn()).getValues();
      const ventas   = lastV > fE
        ? ventSh.getRange(fE+1,1,lastV-fE,ventSh.getLastColumn()).getValues()
        : [];
      const nOpsVendidos = new Set(ventas.map(r => String(r[cOPv-1]).trim()));

      compras.forEach(row => {
        const nOp = String(row[cOPc-1]).trim();
        const est = String(row[cEsc-1]);
        if (nOpsVendidos.has(nOp) && !est.includes("Vendido")) {
          errores.push(`⚠️ ${nOp}: figura vendido en Ventas pero Estado en Compras = "${est}"`);
        }
        if (!nOp) return;
        if (!est) errores.push(`⚠️ ${nOp}: sin Estado en Compras`);
      });
      ok.push(`✅ Compras: ${compras.length} registros revisados`);
    }
  } catch(e) {
    errores.push(`❌ Error revisando Compras/Ventas: ${e.message}`);
  }

  const resumen = errores.length === 0
    ? `✅ Sin errores. ${ok.length} verificaciones OK.`
    : `❌ ${errores.length} problema/s detectado/s.`;

  SpreadsheetApp.getUi().alert(
    "🔍 Validación de Consistencia — GreatPhones",
    resumen + "\n\n" + (errores.length > 0 ? "PROBLEMAS:\n" + errores.join("\n") + "\n\n" : "") + "OK:\n" + ok.slice(0,10).join("\n"),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}


// ============================================================
//  MENÚ PRINCIPAL
// ============================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("🏪 GreatPhones")
    .addSubMenu(ui.createMenu("🛒 Compras & Ventas")
      .addItem("Nueva compra / consignación", "registrarCompra")
      .addItem("Registrar venta",             "registrarVenta")
      .addSeparator()
      .addItem("Actualizar Stock",            "actualizarStockManual")
      .addSeparator()
      .addItem("Carga masiva (pegar texto)",  "abrirCargaMasiva"))
    .addSubMenu(ui.createMenu("🟡 Preventas")
      .addItem("Registrar preventa",          "registrarPreventa")
      .addItem("Entregar preventa",           "entregarPreventa")
      .addSeparator()
      .addItem("Carga masiva (pegar texto)",  "abrirCargaMasiva")
      .addSeparator()
      .addItem("📦 Reorganizar cupos (respetar reglas)", "diagnosticarCupoPreventas"))
    .addSubMenu(ui.createMenu("🛍️ Accesorios")
      .addItem("Registrar compra de accesorios","registrarCompraAccesorios")
      .addItem("Registrar venta de accesorio","registrarVentaAccesorio")
      .addSeparator()
      .addItem("Actualizar Stock Accesorios",  "actualizarStockAccesoriosManual"))
    .addSubMenu(ui.createMenu("💻 Mac / iPad")
      .addItem("Cargar lista de precios inicial", "poblarListaPreciosMacIpad"))
    .addSubMenu(ui.createMenu("🔧 Reparaciones")
      .addItem("Ingresar reparación",         "registrarReparacion")
      .addItem("Actualizar estado",           "actualizarEstadoReparacion")
      .addSeparator()
      .addItem("Actualizar tarifario (CSV)",  "mostrarImportadorTarifarioIcare"))
    .addSubMenu(ui.createMenu("🏦 Inversores")
      .addItem("Registrar movimiento",        "registrarMovimientoInversor")
      .addItem("Generar rendimiento del mes", "generarRendimientoMensual"))
    .addSubMenu(ui.createMenu("💸 Gastos")
      .addItem("Registrar gasto operativo",   "registrarGasto"))
    .addSubMenu(ui.createMenu("📋 Anulaciones")
      .addItem("Configurar sistema",            "configurarSistemaAnulaciones")
      .addItem("Anular operación",              "anularOperacion")
      .addItem("Restaurar operación",           "restaurarOperacion")
      .addItem("Diagnosticar operación",        "diagnosticarOperacion")
      .addItem("Buscar transacciones incompletas", "buscarTransaccionesIncompletasUI")
      .addItem("Ejecutar health check",         "ejecutarHealthCheckERPManual")
      .addItem("Ver estado ERP",                "verEstadoERPManual")
      .addItem("Instalar health check automático", "instalarTriggerHealthCheckManual")
      .addItem("Ver backups de operación",      "verBackupsOperacionUI")
      .addSeparator()
      .addItem("Sincronizar numeración de inversores", "sincronizarNumeracionInversoresManual"))
    .addSeparator()
    .addItem("🔍 Validar consistencia",       "validarConsistencia")
    .addSeparator()
      .addItem("💰 Registrar Movimiento Manual", "registrarMovimientoCaja")
      .addItem("📊 Actualizar Reportes",         "actualizarReportes")
      .addItem("💵 Conciliar Saldos",            "conciliarSaldos")
    .addSeparator()
      .addItem("🗑️ Anular Movimiento",           "abrirEliminarMovimiento")
      .addItem("🔄 Reconstruir Libro Diario",    "reconstruirLibroDiario")
      .addItem("🎨 Formatear colores Libro Diario", "formatearLibroDiario")
      .addItem("🧨 Reiniciar Sistema (borra todo)", "reiniciarSistemaCompleto")
    .addSubMenu(ui.createMenu("🧹 Reiniciar ERP")
      .addItem("Reiniciar Operaciones", "reiniciarOperaciones")
      .addItem("Reiniciar Contabilidad", "reiniciarContabilidad")
      .addItem("Reiniciar Auditoría", "reiniciarAuditoria")
      .addItem("Reiniciar Inversores", "reiniciarInversores")
      .addSeparator()
      .addItem("Reinicio Completo", "reiniciarERPCompleto"))
    .addToUi();
}


// ============================================================
//  FINANZAS / CAJA / REPORTES
// ============================================================

/**
 * obtenerSaldosCaja()
 *
 * Cambio 3/4 (auditoría): la versión anterior tomaba el SALDO_NUEVO de la
 * ÚLTIMA fila que coincidía con cada medio. Eso es incorrecto porque
 * SALDO_ANTERIOR/SALDO_NUEVO en libroLog() (que no se modifica) es un único
 * acumulado GLOBAL de todo el Libro Diario, no un acumulado independiente
 * por medio — con lo cual el "saldo" de Efectivo, por ejemplo, en realidad
 * mostraba el total corrido de TODOS los medios mezclados al momento de la
 * última fila en efectivo, no el dinero real en efectivo. Con USD reales
 * (Cambio 3) ese defecto se vuelve todavía más grave, porque una fila de
 * USD (p.ej. monto=300) quedaría mezclada en la misma columna que montos en
 * pesos (p.ej. 50000).
 *
 * La corrección: sumar directamente MONTO por medio, sin pasar por
 * SALDO_NUEVO — INGRESO suma, EGRESO resta (mismo criterio que usa
 * libroLog() internamente para calcular saldoNvo, pero aplicado en forma
 * independiente por medio).
 */
function obtenerSaldosCaja() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const libro = ss.getSheetByName("Libro Diario");
  if (!libro) throw new Error("❌ Hoja 'Libro Diario' no encontrada.");

  const filaEnc = 2;
  const colMedio = getCol(libro, "MEDIO", filaEnc);
  const colTipo  = getCol(libro, "TIPO",  filaEnc);
  const colMonto = getCol(libro, "MONTO", filaEnc);
  // Columna ESTADO_REGISTRO (sistema de anulaciones) — opcional: si todavía
  // no se corrió configurarSistemaAnulaciones(), no existe y no filtra nada.
  let colEstReg = -1;
  try { colEstReg = getCol(libro, "ESTADO_REGISTRO", filaEnc); } catch (e) { /* columna opcional */ }

  const lastRow = libro.getLastRow();
  const saldos = { Efectivo: 0, Transferencia: 0, USD: 0, Cuotas: 0 };
  if (lastRow < filaEnc + 1) return saldos;

  const datos = libro.getRange(
    filaEnc + 1, 1,
    lastRow - filaEnc,
    libro.getLastColumn()
  ).getValues();

  datos.forEach(row => {
    // Los movimientos anulados no participan del saldo de caja.
    if (colEstReg >= 0 && String(row[colEstReg - 1] || "").trim() === "ANULADO") return;
    const medio = String(row[colMedio - 1] || "").trim();
    const tipo  = String(row[colTipo  - 1] || "").trim();
    const monto = Number(row[colMonto - 1]) || 0;
    if (!(medio in saldos) || monto === 0) return;
    if (tipo === "INGRESO")     saldos[medio] += monto;
    else if (tipo === "EGRESO") saldos[medio] -= monto;
  });

  return saldos;
}

/**
 * Lee "Libro Diario" (sin modificarla, solo consumirla) y devuelve los
 * movimientos de los últimos 14 días, más reciente primero. Alimenta el
 * bloque "📒 Libro Diario (Últimos 14 días)" en Caja. Mismo criterio que
 * obtenerSaldosCaja() (excluye ANULADO si la columna ESTADO_REGISTRO
 * existe) y que obtenerOperacionesRecientes() (ordena por un campo
 * numérico de fecha y lo descarta antes de devolver).
 */
function obtenerLibroDiarioReciente() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const libro = ss.getSheetByName("Libro Diario");
  if (!libro) throw new Error("❌ Hoja 'Libro Diario' no encontrada.");

  const filaEnc = 2;
  const colTS   = getCol(libro, "TIMESTAMP",      filaEnc);
  const colOri  = getCol(libro, "ORIGEN",         filaEnc);
  const colOp   = getCol(libro, "ID_OPERACION",   filaEnc);
  const colTipo = getCol(libro, "TIPO",           filaEnc);
  const colMed  = getCol(libro, "MEDIO",          filaEnc);
  const colMon  = getCol(libro, "MONTO",          filaEnc);
  const colDesc = getCol(libro, "DESCRIPCION",    filaEnc);
  const colReg  = getCol(libro, "REGISTRADO_POR", filaEnc);
  const colObs  = getCol(libro, "OBSERVACIONES",  filaEnc);
  let colEstReg = -1;
  try { colEstReg = getCol(libro, "ESTADO_REGISTRO", filaEnc); } catch (e) { /* columna opcional */ }

  const lastRow = libro.getLastRow();
  if (lastRow <= filaEnc) return [];

  const datos = libro.getRange(filaEnc + 1, 1, lastRow - filaEnc, libro.getLastColumn()).getValues();
  const limite = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const tz = Session.getScriptTimeZone();

  const salida = [];
  datos.forEach(row => {
    if (colEstReg >= 0 && String(row[colEstReg - 1] || "").trim() === "ANULADO") return;
    const fechaCelda = row[colTS - 1];
    if (!(fechaCelda instanceof Date)) return;
    const ts = fechaCelda.getTime();
    if (ts < limite) return;
    salida.push({
      fechaOrd:      ts,
      fecha:         Utilities.formatDate(fechaCelda, tz, "dd/MM/yyyy HH:mm:ss"),
      origen:        String(row[colOri  - 1] || ""),
      numero:        String(row[colOp   - 1] || ""),
      tipo:          String(row[colTipo - 1] || ""),
      medio:         String(row[colMed  - 1] || ""),
      monto:         Number(row[colMon  - 1]) || 0,
      descripcion:   String(row[colDesc - 1] || ""),
      operador:      String(row[colReg  - 1] || ""),
      observaciones: String(row[colObs  - 1] || "")
    });
  });

  salida.sort((a, b) => b.fechaOrd - a.fechaOrd);
  salida.forEach(m => delete m.fechaOrd);
  return salida;
}

function registrarMovimientoCaja() {
  const categorias = [
    "VENTA","COMPRA","SERVICIO TECNICO","RETIRO","INVERSOR",
    "REPUESTOS","PAGO A PROVEEDORES","PRESTAMO","AJUSTE_POSITIVO",
    "AJUSTE_NEGATIVO","DEVOLUCION","GASTO_EXTRA","TRANSFERENCIA_INTERNA",
    "COMPRA_USD","VENTA_USD","SUELDO","IMPUESTO","OTROS"
  ];

  const optionsCategorias = categorias.map(c => `<option value="${c}">${c}</option>`).join("");

  const html = HtmlService.createHtmlOutput(`
<!DOCTYPE html>
<html>
<head>
<base target="_top">
<style>
body{font-family:Arial,sans-serif;padding:18px;background:#f4f6f9;}
h2{color:#1A5276;margin-top:0;}
label{display:block;margin-top:12px;font-weight:bold;color:#1A5276;}
input,select,textarea{width:100%;padding:9px;border:1px solid #ccc;border-radius:5px;box-sizing:border-box;margin-top:4px;}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.btn{background:#196F3D;color:white;border:none;padding:14px;border-radius:5px;margin-top:20px;width:100%;font-size:15px;cursor:pointer;}
.btn:hover{background:#145A32;}
</style>
</head>
<body>
<h2>💰 Nuevo Movimiento</h2>
<label>Fecha</label>
<input type="date" id="fecha">
<label>Tipo Movimiento</label>
<select id="tipo">
  <option value="INGRESO">INGRESO</option>
  <option value="EGRESO">EGRESO</option>
  <option value="TRANSFERENCIA">TRANSFERENCIA</option>
</select>
<label>Categoría</label>
<select id="categoria">${optionsCategorias}</select>
<label>Descripción</label>
<input type="text" id="descripcion">
<div class="grid">
  <div><label>💵 Efectivo</label><input type="number" id="efectivo" value="0"></div>
  <div><label>🏦 Transferencia</label><input type="number" id="transferencia" value="0"></div>
  <div><label>💲 USD (cantidad de dólares)</label><input type="number" id="usd" value="0" oninput="calcTotal()"></div>
  <div><label>💳 Cuotas</label><input type="number" id="cuotas" value="0" oninput="calcTotal()"></div>
</div>
<div style="font-size:11px;color:#666;margin-top:4px" id="cotizDiv"></div>
<label>Responsable</label>
<input type="text" id="responsable">
<label>Referencia</label>
<input type="text" id="referencia">
<label>Observaciones</label>
<textarea id="obs"></textarea>
<button class="btn" onclick="guardar()">✅ REGISTRAR MOVIMIENTO</button>
<script>
document.getElementById("fecha").value = new Date().toISOString().split("T")[0];
var cotizacionVenta = 0;
google.script.run.withSuccessHandler(function(cot){
  cotizacionVenta = cot.venta;
  document.getElementById("cotizDiv").textContent =
    "Cotización USD oficial: $" + Number(cot.venta).toLocaleString("es-AR");
}).obtenerCotizacionUSD();
function calcTotal(){
  // Solo usado para validar > 0; no se muestra preview adicional acá.
}
function guardar(){
  const d={
    fecha:document.getElementById("fecha").value,
    tipo:document.getElementById("tipo").value,
    categoria:document.getElementById("categoria").value,
    descripcion:document.getElementById("descripcion").value,
    efectivo:parseFloat(document.getElementById("efectivo").value)||0,
    transferencia:parseFloat(document.getElementById("transferencia").value)||0,
    usd:parseFloat(document.getElementById("usd").value)||0,
    cuotas:parseFloat(document.getElementById("cuotas").value)||0,
    responsable:document.getElementById("responsable").value,
    referencia:document.getElementById("referencia").value,
    obs:document.getElementById("obs").value
  };
  const usdPesos = d.usd * cotizacionVenta;
  const total=d.efectivo+d.transferencia+usdPesos+d.cuotas;
  if(total<=0){alert("❌ Debe ingresar al menos un monto.");return;}
  if(!d.descripcion){alert("❌ Ingrese una descripción.");return;}
  google.script.run
    .withSuccessHandler(msg=>{alert(msg);google.script.host.close();})
    .withFailureHandler(err=>{alert("❌ "+err.message);})
    .procesarMovimientoCaja(d);
}
</script>
</body>
</html>
`).setWidth(520).setHeight(780);
  SpreadsheetApp.getUi().showModalDialog(html, "💰 Movimiento Manual");
}

function procesarMovimientoCaja(d) {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName("MOVIMIENTOS_CAJA");
  if (!hoja) throw new Error("❌ No existe MOVIMIENTOS_CAJA");

  const idMov = genID("MOV");
  // d.usd se guarda en MOVIMIENTOS_CAJA como CANTIDAD de dólares (igual que en Ventas/Preventas)
  hoja.appendRow([
    idMov, parseDate(d.fecha), d.tipo, d.categoria, d.descripcion,
    d.efectivo, d.transferencia, d.usd, d.cuotas,
    d.responsable, d.referencia, d.obs
  ]);

  // Conversión real de USD a pesos para el Libro Diario (problema 4)
  const cotizacion  = obtenerCotizacionUSD();
  const usdCantidad = Number(d.usd) || 0;
  const usdPesos    = convertirUSDaPesos_(usdCantidad, cotizacion);

  const obsUSD = usdCantidad > 0
    ? `${d.obs ? d.obs + " | " : ""}USD: ${usdCantidad} | USD_COTIZACION: ${fmtPeso(cotizacion.venta)} | USD_CONVERTIDO: ${fmtPeso(usdPesos)}`
    : d.obs;

  // Cambio 3: la caja debe conservar los DÓLARES REALES — el medio "USD" se
  // loguea con monto = usdCantidad (cantidad de dólares), nunca convertido.
  const medios = [
    { medio:"Efectivo",      monto: Number(d.efectivo)      || 0, obs: d.obs },
    { medio:"Transferencia", monto: Number(d.transferencia) || 0, obs: d.obs },
    { medio:"USD",           monto: usdCantidad,                  obs: obsUSD },
    { medio:"Cuotas",        monto: Number(d.cuotas)        || 0, obs: d.obs }
  ];

  medios.forEach(m => {
    if (m.monto <= 0) return;
    if (d.tipo === "TRANSFERENCIA") {
      libroLog({
        origen:"TRANSFERENCIA_INTERNA", idOperacion:idMov,
        descripcion:d.descripcion, categoria:d.categoria,
        tipo:"INGRESO", medio:m.medio, monto:m.monto,
        referencia:d.referencia, observaciones:m.obs, registradoPor:d.responsable
      });
      return;
    }
    libroLog({
      origen:"MOVIMIENTO_MANUAL", idOperacion:idMov,
      descripcion:d.descripcion, categoria:d.categoria,
      tipo:d.tipo, medio:m.medio, monto:m.monto,
      referencia:d.referencia, observaciones:m.obs, registradoPor:d.responsable
    });
  });

  actualizarReportes();
  return "✅ Movimiento registrado correctamente." +
    (usdCantidad > 0 ? `\nUSD: ${usdCantidad} → ${fmtPeso(usdPesos)} (cotización ${fmtPeso(cotizacion.venta)})` : ``);
}

function actualizarReportes() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const reportes = ss.getSheetByName("REPORTES");
  if (!reportes) throw new Error("❌ Hoja REPORTES no encontrada.");

  const cotizacion = obtenerCotizacionUSD();
  const saldos     = obtenerSaldosCaja();
  const libro   = ss.getSheetByName("Libro Diario");
  const filaEnc = 2;
  const colCat   = getCol(libro, "CATEGORIA", filaEnc);
  const colTipo  = getCol(libro, "TIPO",      filaEnc);
  const colMedio = getCol(libro, "MEDIO",     filaEnc);
  const colMonto = getCol(libro, "MONTO",     filaEnc);
  // Sistema de anulaciones: columna opcional, ignora movimientos anulados.
  let colEstReg = -1;
  try { colEstReg = getCol(libro, "ESTADO_REGISTRO", filaEnc); } catch (e) { /* columna opcional */ }

  // Cambio 3/4 (auditoría): desde que la caja conserva DÓLARES REALES, el
  // MONTO de una fila con medio="USD" ya no está en pesos — sumarlo junto
  // con los medios en pesos (como se hacía antes) corrompía "ventas" y el
  // total de caja. Ahora se acumula aparte y se convierte SOLO para el
  // equivalente informativo del reporte.
  let ventasPesos = 0, ventasUSD = 0, reparaciones = 0, compras = 0, gastos = 0;
  const lastRowLibro = libro.getLastRow();
  if (lastRowLibro > filaEnc) {
    const datos = libro.getRange(filaEnc + 1, 1, lastRowLibro - filaEnc, libro.getLastColumn()).getValues();
    datos.forEach(row => {
      if (colEstReg >= 0 && String(row[colEstReg - 1] || "").trim() === "ANULADO") return;
      const cat   = String(row[colCat   - 1] || "");
      const tipo  = String(row[colTipo  - 1] || "");
      const medio = String(row[colMedio - 1] || "");
      const monto = Number(row[colMonto - 1]) || 0;
      const esVenta = (cat.includes("VENTA") || cat.includes("PREVENTA")) && tipo === "INGRESO";
      if (esVenta && medio === "USD") ventasUSD   += monto;
      else if (esVenta)               ventasPesos += monto;
      if (cat.includes("REPARACION") && tipo === "INGRESO") reparaciones += monto;
      if (cat.includes("COMPRA")     && tipo === "EGRESO")  compras      += monto;
      if (tipo === "EGRESO" && !cat.includes("COMPRA"))     gastos       += monto;
    });
  }

  const ventasUSDPesos = convertirUSDaPesos_(ventasUSD, cotizacion);
  const ventasTotal     = ventasPesos + ventasUSDPesos; // equivalente combinado, solo para el reporte
  const saldoUSDPesos   = convertirUSDaPesos_(saldos.USD, cotizacion);
  const utilidad = ventasTotal + reparaciones - compras - gastos;

  reportes.getRange("B4").setValue(saldos.Efectivo);
  reportes.getRange("B5").setValue(saldos.Transferencia);
  reportes.getRange("B6").setValue(saldos.USD);
  reportes.getRange("B7").setValue(saldos.Cuotas);
  // Cambio 3/4: el total de caja también debe convertir el USD real antes
  // de sumarlo (antes se sumaban dólares y pesos directamente).
  reportes.getRange("B8").setValue(saldos.Efectivo + saldos.Transferencia + saldos.Cuotas + saldoUSDPesos);
  reportes.getRange("B11").setValue(ventasTotal);
  reportes.getRange("B12").setValue(reparaciones);
  reportes.getRange("B13").setValue(compras);
  reportes.getRange("B14").setValue(gastos);
  reportes.getRange("B15").setValue(utilidad);

  // Cambio 4: auditoría ampliada (ventas/ganancias/preventas/accesorios/vendedores)
  actualizarReportesDetallado_(reportes, cotizacion);

  reportes.getRange("H1").setValue(
    "Última actualización: " +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm")
  );
}

/**
 * actualizarReportesDetallado_(reportes, cotizacion)
 *
 * Cambio 4 — auditoría completa de REPORTES. El bloque original (B4:B15,
 * H1) sólo cubría caja + 4 totales genéricos desde Libro Diario. Esta
 * función agrega, calculado directamente desde las hojas fuente (más
 * confiable que reconstruirlo desde las descripciones del Libro Diario):
 *   - Ventas: totales pactado, cobradas, en USD (reales) y en pesos
 *   - Ganancias: teórica vs. cobrada (columnas opcionales de procesarVenta)
 *   - Preventas: pendientes / compradas / entregadas / entregadas con saldo
 *   - Accesorios: cantidad vendida, facturación, ganancia
 *   - Vendedores: ventas / preventas / accesorios por vendedor
 *
 * Se escribe en un bloque propio a partir de la fila 18 para no pisar el
 * resumen de caja/utilidad ya existente en B4:B15. Si ya tenías celdas
 * manuales ahí para alguno de estos datos, avisá para realinear en vez de
 * anexar.
 */
function actualizarReportesDetallado_(reportes, cotizacion) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const porVendedor = {}; // nombre -> { ventas, preventas, accesorios }
  const acumVendedor = (nombre, campo) => {
    const key = nombre && String(nombre).trim() ? String(nombre).trim() : "Sin asignar";
    if (!porVendedor[key]) porVendedor[key] = { ventas: 0, preventas: 0, accesorios: 0 };
    porVendedor[key][campo]++;
  };

  // ---------- VENTAS + GANANCIAS ----------
  let ventasCant = 0, ventasPactado = 0, ventasCobradasPesos = 0, ventasCobradasUSD = 0;
  let gananciaTeoricaTotal = 0, gananciaCobradaTotal = 0;
  const ventasSheet = ss.getSheetByName("Ventas");
  if (ventasSheet) {
    const fE  = 2;
    const vPV  = getCol(ventasSheet, "Precio Venta",          fE);
    const vEF  = getCol(ventasSheet, "Cobrado Efectivo",      fE);
    const vTR  = getCol(ventasSheet, "Cobrado Transferencia", fE);
    const vCU  = getCol(ventasSheet, "Cobrado Cuotas",        fE);
    const vUS  = getCol(ventasSheet, "Cobrado USD",           fE);
    const vEst = getCol(ventasSheet, "Estado",                fE);
    let vVend = -1; try { vVend = getCol(ventasSheet, "OPERADOR",         fE); } catch(e) {}
    let vGT   = -1; try { vGT   = getCol(ventasSheet, "Ganancia Teórica", fE); } catch(e) {}
    let vGC   = -1; try { vGC   = getCol(ventasSheet, "Ganancia Cobrada", fE); } catch(e) {}
    let vEstReg = -1; try { vEstReg = getCol(ventasSheet, "ESTADO_REGISTRO", fE); } catch(e) {}

    const lastRow = ventasSheet.getLastRow();
    if (lastRow > fE) {
      const datos = ventasSheet.getRange(fE + 1, 1, lastRow - fE, ventasSheet.getLastColumn()).getValues();
      datos.forEach(row => {
        const estado = String(row[vEst - 1] || "");
        if (!estado) return;
        if (vEstReg >= 0 && String(row[vEstReg-1] || "").trim() === "ANULADO") return;
        ventasCant++;
        ventasPactado        += Number(row[vPV-1]) || 0;
        ventasCobradasPesos  += (Number(row[vEF-1])||0) + (Number(row[vTR-1])||0) + (Number(row[vCU-1])||0);
        ventasCobradasUSD    += Number(row[vUS-1]) || 0;
        if (vGT >= 0) gananciaTeoricaTotal += Number(row[vGT-1]) || 0;
        if (vGC >= 0) gananciaCobradaTotal += Number(row[vGC-1]) || 0;
        acumVendedor(vVend >= 0 ? row[vVend-1] : "", "ventas");
      });
    }
  }
  const ventasCobradasUSDPesos = convertirUSDaPesos_(ventasCobradasUSD, cotizacion);
  const ventasCobradasTotal    = ventasCobradasPesos + ventasCobradasUSDPesos;

  // ---------- PREVENTAS ----------
  let preEsperando = 0, preComprado = 0, preEntregado = 0, preEntregadoConSaldo = 0;
  let preIngresosTotal = 0; // suma de "Total Cobrado" (ya en pesos-equivalente)
  const preSheet = ss.getSheetByName("Preventas");
  if (preSheet) {
    const fE  = 2;
    const cES = getCol(preSheet, "Estado",        fE);
    const cTC = getCol(preSheet, "Total Cobrado", fE);
    let cVend = -1; try { cVend = getCol(preSheet, "OPERADOR", fE); } catch(e) {}
    let cEstReg = -1; try { cEstReg = getCol(preSheet, "ESTADO_REGISTRO", fE); } catch(e) {}
    const lastRow = preSheet.getLastRow();
    if (lastRow > fE) {
      const datos = preSheet.getRange(fE + 1, 1, lastRow - fE, preSheet.getLastColumn()).getValues();
      datos.forEach(row => {
        const estado = String(row[cES-1] || "");
        if (!estado) return;
        if (cEstReg >= 0 && String(row[cEstReg-1] || "").trim() === "ANULADO") return;
        if (estado.includes("Esperando compra"))        preEsperando++;
        else if (estado.includes("Entregado con saldo")) preEntregadoConSaldo++;
        else if (estado.includes("Entregado"))            preEntregado++;
        else if (estado.includes("Comprado"))             preComprado++;
        preIngresosTotal += Number(row[cTC-1]) || 0;
        acumVendedor(cVend >= 0 ? row[cVend-1] : "", "preventas");
      });
    }
  }

  // ---------- ACCESORIOS ----------
  let accCantidad = 0, accFacturacion = 0, accGanancia = 0;
  const accSheet = ss.getSheetByName("Venta Accesorios");
  if (accSheet) {
    const fE  = 2;
    const cCNT = getCol(accSheet, "Cantidad",     fE);
    const cTC  = getCol(accSheet, "Total Cobrado", fE);
    const cGN  = getCol(accSheet, "Ganancia",      fE);
    let cVD = -1; try { cVD = getCol(accSheet, "OPERADOR", fE); } catch(e) {}
    const cES  = getCol(accSheet, "Estado",        fE);
    let cEstReg = -1; try { cEstReg = getCol(accSheet, "ESTADO_REGISTRO", fE); } catch(e) {}
    const lastRow = accSheet.getLastRow();
    if (lastRow > fE) {
      const datos = accSheet.getRange(fE + 1, 1, lastRow - fE, accSheet.getLastColumn()).getValues();
      datos.forEach(row => {
        const estado = String(row[cES-1] || "");
        if (!estado) return;
        if (cEstReg >= 0 && String(row[cEstReg-1] || "").trim() === "ANULADO") return;
        accCantidad    += Number(row[cCNT-1]) || 0;
        accFacturacion += Number(row[cTC-1])  || 0;
        accGanancia    += Number(row[cGN-1])  || 0;
        acumVendedor(cVD >= 0 ? row[cVD-1] : "", "accesorios");
      });
    }
  }

  // ---------- Escribir bloque ampliado (a partir de la fila 18) ----------
  // (La auditoría de Caja ya se cubre en B4:B8 del bloque original — no se duplica acá.)
  const filaVentas = 19, filaGan = 28, filaPre = 40, filaAcc = 47, filaVend = 52;

  reportes.getRange(18, 1).setValue("VENTAS (detalle)");
  reportes.getRange(filaVentas + 0, 1, 1, 2).setValues([["Cantidad de ventas",        ventasCant]]);
  reportes.getRange(filaVentas + 1, 1, 1, 2).setValues([["Ventas totales (pactado)",  ventasPactado]]);
  reportes.getRange(filaVentas + 2, 1, 1, 2).setValues([["Ventas cobradas (equiv. $)",ventasCobradasTotal]]);
  reportes.getRange(filaVentas + 3, 1, 1, 2).setValues([["Ventas cobradas en pesos",  ventasCobradasPesos]]);
  reportes.getRange(filaVentas + 4, 1, 1, 2).setValues([["Ventas cobradas en USD (cant. dólares)", ventasCobradasUSD]]);
  reportes.getRange(filaVentas + 5, 1, 1, 2).setValues([["Ventas cobradas en USD (equiv. $)",       ventasCobradasUSDPesos]]);
  reportes.getRange(filaVentas + 6, 1, 1, 2).setValues([["Preventas (total cobrado, equiv. $)", preIngresosTotal]]);
  reportes.getRange(filaVentas + 7, 1, 1, 2).setValues([["Accesorios (facturación $)", accFacturacion]]);

  reportes.getRange(filaGan, 1).setValue("GANANCIAS");
  reportes.getRange(filaGan + 1, 1, 1, 2).setValues([["Ganancia Teórica (total)", gananciaTeoricaTotal]]);
  reportes.getRange(filaGan + 2, 1, 1, 2).setValues([["Ganancia Cobrada (total)", gananciaCobradaTotal]]);

  reportes.getRange(filaPre - 2, 1).setValue("PREVENTAS");
  reportes.getRange(filaPre + 0, 1, 1, 2).setValues([["🟡 Pendientes (Esperando compra)", preEsperando]]);
  reportes.getRange(filaPre + 1, 1, 1, 2).setValues([["🟠 Compradas",                      preComprado]]);
  reportes.getRange(filaPre + 2, 1, 1, 2).setValues([["✅ Entregadas",                     preEntregado]]);
  reportes.getRange(filaPre + 3, 1, 1, 2).setValues([["🟢 Entregadas con saldo",           preEntregadoConSaldo]]);

  reportes.getRange(filaAcc - 2, 1).setValue("ACCESORIOS");
  reportes.getRange(filaAcc + 0, 1, 1, 2).setValues([["Cantidad vendida", accCantidad]]);
  reportes.getRange(filaAcc + 1, 1, 1, 2).setValues([["Facturación ($)",  accFacturacion]]);
  reportes.getRange(filaAcc + 2, 1, 1, 2).setValues([["Ganancia ($)",     accGanancia]]);

  reportes.getRange(filaVend - 2, 1).setValue("VENDEDORES");
  reportes.getRange(filaVend - 1, 1, 1, 4).setValues([["Operador", "Ventas", "Preventas", "Accesorios"]]);
  const vendedores = Object.keys(porVendedor).sort();
  const lastRowVend = reportes.getLastRow();
  if (lastRowVend >= filaVend) {
    reportes.getRange(filaVend, 1, Math.max(lastRowVend - filaVend + 1, 1), 4).clearContent();
  }
  if (vendedores.length > 0) {
    const filasVend = vendedores.map(v => [v, porVendedor[v].ventas, porVendedor[v].preventas, porVendedor[v].accesorios]);
    reportes.getRange(filaVend, 1, filasVend.length, 4).setValues(filasVend);
  }

  // Formato de montos en las filas de $ del bloque ampliado
  [filaVentas+1, filaVentas+2, filaVentas+3, filaVentas+5, filaVentas+7,
   filaGan+1, filaGan+2, filaAcc+1, filaAcc+2].forEach(f => {
    reportes.getRange(f, 2).setNumberFormat("$#,##0");
  });
}

function conciliarSaldos() {
  const saldos     = obtenerSaldosCaja();
  const cotizacion = obtenerCotizacionUSD();
  const usdPesos   = convertirUSDaPesos_(saldos.USD, cotizacion);
  SpreadsheetApp.getUi().alert(
    "💰 SALDOS ACTUALES\n\n" +
    "Efectivo: "      + fmtPeso(saldos.Efectivo)      + "\n" +
    "Transferencia: " + fmtPeso(saldos.Transferencia) + "\n" +
    // Cambio 3: la caja conserva dólares reales — se muestra en USD, con el
    // equivalente en pesos solo como referencia informativa.
    "USD: "           + fmtUSD(saldos.USD) + " (≈ " + fmtPeso(usdPesos) + " a " + fmtPeso(cotizacion.venta) + ")\n" +
    "Cuotas: "        + fmtPeso(saldos.Cuotas)
  );
}

function abrirEliminarMovimiento() {
  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial;padding:18px;}
    h2{color:#922B21;}
    input,select{width:100%;padding:10px;margin-top:10px;box-sizing:border-box;}
    button{width:100%;padding:12px;margin-top:15px;background:#922B21;color:white;border:none;border-radius:5px;cursor:pointer;}
  </style>
  <h2>🗑️ Anular Movimiento</h2>
  <input type="text" id="busqueda" placeholder="Buscar..." onkeyup="buscar()"/>
  <select id="movimientos" size="12"></select>
  <button onclick="anular()">❌ ANULAR MOVIMIENTO</button>
  <script>
  function buscar(){
    const txt=document.getElementById("busqueda").value;
    google.script.run.withSuccessHandler(cargar).buscarMovimientos(txt);
  }
  function cargar(data){
    const sel=document.getElementById("movimientos");
    sel.innerHTML="";
    data.forEach(m=>{
      const op=document.createElement("option");
      op.value=m.id;
      op.text=m.id+" | "+m.descripcion+" | $"+Number(m.monto).toLocaleString("es-AR");
      sel.appendChild(op);
    });
  }
  function anular(){
    const id=document.getElementById("movimientos").value;
    if(!id){alert("Seleccione un movimiento");return;}
    if(!confirm("¿Anular movimiento?")) return;
    google.script.run
      .withSuccessHandler(msg=>{alert(msg);google.script.host.close();})
      .withFailureHandler(err=>{alert(err.message);})
      .anularMovimiento(id);
  }
  buscar();
  </script>
  `).setWidth(650).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, "🗑️ Anular Movimiento");
}

function buscarMovimientos(txt) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const libro = ss.getSheetByName("Libro Diario");
  const filaEnc = 2;

  const datos = libro.getRange(
    filaEnc + 1, 1,
    libro.getLastRow() - filaEnc,
    libro.getLastColumn()
  ).getValues();

  txt = String(txt || "").toLowerCase().trim();
  const out = [];

  datos.forEach(row => {
    const id          = String(row[0] || "");
    const descripcion = String(row[5] || "");
    const monto       = Number(row[9] || 0);
    const texto       = (id + " " + descripcion + " " + monto).toLowerCase();
    if (txt && !texto.includes(txt)) return;
    out.push({ id, descripcion, monto });
  });

  return out.slice(0, 100);
}

function anularMovimiento(id) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const libro = ss.getSheetByName("Libro Diario");
  const filaEnc = 2;
  const lastRow = libro.getLastRow();

  if (lastRow <= filaEnc) throw new Error("No hay movimientos.");

  const datos = libro.getRange(filaEnc + 1, 1, lastRow - filaEnc, libro.getLastColumn()).getValues();
  let encontrado = false;

  datos.forEach((row, i) => {
    if (String(row[0] || "") !== id) return;
    libro.hideRows(i + filaEnc + 1);
    encontrado = true;
  });

  if (!encontrado) throw new Error("Movimiento no encontrado.");
  return "✅ Movimiento ocultado.";
}


// ================================================================
// GREATPHONES — Llenado del nuevo sheet desde el origen
// ================================================================

function llenarNuevoSheet() {
  const ID_ORIGEN  = "13qHMUIc1o3oFQPUrQb2_nU9lZ6dZepGJv9YMpOGzLKM";
  const ID_DESTINO = "1dPh4wdz0fhCDizSDRSMpFgNv6hb25IeZZ70dm3D1UJA";
  const TZ = "America/Argentina/Buenos_Aires";

  const ssO = SpreadsheetApp.openById(ID_ORIGEN);
  const ssD = SpreadsheetApp.openById(ID_DESTINO);
  const log = [];

  function fmtFecha(v) {
    if (!v) return "";
    if (v instanceof Date) return Utilities.formatDate(v, TZ, "dd/MM/yyyy");
    return String(v).split("T")[0];
  }
  function fmtTS(v) {
    if (!v) return "";
    if (v instanceof Date) return Utilities.formatDate(v, TZ, "dd/MM/yyyy HH:mm:ss");
    return String(v);
  }
  function num(v) {
    if (v === null || v === undefined || v === "" || v === "-") return 0;
    if (typeof v === "number") return v;
    const s = String(v).replace(/[$\s]/g, "");
    if (s.indexOf(".") !== -1 && s.indexOf(",") !== -1) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
    if (s.indexOf(".") !== -1 && s.indexOf(",") === -1) {
      const parts = s.split(".");
      if (parts[1] && parts[1].length === 3) return parseFloat(s.replace(".", "")) || 0;
      return parseFloat(s) || 0;
    }
    return parseFloat(s.replace(",", ".")) || 0;
  }
  function getHoja(ss, nombre) {
    const sh = ss.getSheetByName(nombre);
    if (!sh) log.push("⚠️  No encontré la hoja: '" + nombre + "'");
    return sh;
  }
  function limpiar(sh) {
    if (!sh) return;
    const lr = sh.getLastRow();
    if (lr > 1) sh.getRange(2, 1, lr - 1, Math.max(sh.getLastColumn(), 1)).clearContent();
  }

  const shComprasO = getHoja(ssO, "COMPRAS");
  const shStockO   = getHoja(ssO, "STOCK");
  const shComprasD = getHoja(ssD, "Compras");

  if (shComprasO && shStockO && shComprasD) {
    const stockVals = shStockO.getDataRange().getValues();
    const stockMap = {};
    for (let i = 2; i < stockVals.length; i++) {
      const r = stockVals[i];
      const op = String(r[0] || "").trim();
      if (op) stockMap[op] = { precioEst: r[4] || 0, estado: String(r[6] || "") };
    }
    const comprasVals = shComprasO.getDataRange().getValues();
    limpiar(shComprasD);
    const filas = [];
    for (let i = 2; i < comprasVals.length; i++) {
      const r = comprasVals[i];
      const nOp = String(r[4] || "").trim();
      if (!nOp || !r[0]) continue;
      const esCSG = nOp.startsWith("CSG");
      const precio = num(r[5]);
      const repStr = String(r[7] || "");
      const estadoSt = stockMap[nOp] ? stockMap[nOp].estado : "";
      let estado = estadoSt.includes("Vendido") ? "✅ Vendido" : "📦 En Stock";
      filas.push([
        nOp, fmtFecha(r[0]), esCSG ? "CONSIGNACION" : "COMPRA", r[1]||"", r[2]||"", r[3]||"", "",
        repStr === "Para Reparación" ? "Para Reparación" : "Bueno",
        esCSG ? "" : precio, esCSG ? precio : "", r[6]||"",
        repStr === "Para Reparación" ? "Sí" : "No", 0,
        stockMap[nOp] ? num(stockMap[nOp].precioEst) : "", estado, ""
      ]);
    }
    if (filas.length > 0) shComprasD.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
    log.push("✅ Compras: " + filas.length + " filas");
  }

  const shVentasO = getHoja(ssO, "VENTAS");
  const shVentasD = getHoja(ssD, "Ventas");
  if (shVentasO && shVentasD) {
    const ventasVals = shVentasO.getDataRange().getValues();
    limpiar(shVentasD);
    const filas = [];
    let vtaNum = 1;
    for (let i = 2; i < ventasVals.length; i++) {
      const r = ventasVals[i];
      if (!r[0] || !r[1]) continue;
      const nOp = String(r[5] || "").trim();
      const esCSG = nOp.startsWith("CSG");
      filas.push([
        "VTA-" + String(vtaNum).padStart(3, "0"), fmtFecha(r[0]), nOp,
        esCSG ? "CONSIGNACION" : "COMPRA PROPIA", r[3]||"", r[4]||"", r[1]||"", r[2]||"",
        num(r[6]), num(r[8]), num(r[7]), num(r[9]), num(r[10]), num(r[11]), num(r[12]), "PROCESADA", r[13]||""
      ]);
      vtaNum++;
    }
    if (filas.length > 0) shVentasD.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
    log.push("✅ Ventas: " + filas.length + " filas");
  }

  const shStockD = getHoja(ssD, "Stock");
  if (shStockO && shStockD) {
    const stockVals = shStockO.getDataRange().getValues();
    limpiar(shStockD);
    const filas = [];
    const hoy = new Date();
    for (let i = 2; i < stockVals.length; i++) {
      const r = stockVals[i];
      const nOp = String(r[0] || "").trim();
      if (!nOp) continue;
      if (!String(r[6] || "").toLowerCase().includes("stock")) continue;
      const fechaCompra = r[5];
      let dias = 0;
      if (fechaCompra instanceof Date) dias = Math.floor((hoy - fechaCompra) / (1000 * 60 * 60 * 24));
      filas.push([
        nOp, fmtFecha(fechaCompra), nOp.startsWith("CSG") ? "CONSIGNACION" : "COMPRA",
        r[1]||"", r[2]||"", "", "", num(r[3]), num(r[4]), "", 0, dias, "", r[7]||"", "📦 En Stock"
      ]);
    }
    if (filas.length > 0) shStockD.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
    log.push("✅ Stock: " + filas.length + " equipos en stock");
  }

  const shRepO = getHoja(ssO, "REPARACIONES");
  const shRepD = getHoja(ssD, "Reparaciones");
  if (shRepO && shRepD) {
    const repVals = shRepO.getDataRange().getValues();
    limpiar(shRepD);
    const filas = [];
    for (let i = 2; i < repVals.length; i++) {
      const r = repVals[i];
      const nRep = String(r[13] || "").trim();
      if (!nRep) continue;
      const estadoOld = String(r[9] || "");
      let estado = estadoOld;
      if (estadoOld === "Retirado")   estado = "✅ Retirado";
      else if (estadoOld === "Listo") estado = "🟢 Listo";
      else if (estadoOld === "Ingresado") estado = "🔴 Ingresado";
      else if (estadoOld === "En proceso") estado = "🟡 En Proceso";
      filas.push([
        nRep, fmtFecha(r[14]), r[0]||"", r[1]||"", r[2]||"", r[3]||"",
        r[4]||"", r[4]||"", "", r[5]||"", r[6]||"", r[7]||"",
        num(r[8]), num(r[10]), num(r[11]), num(r[12]), estado, fmtFecha(r[15]), r[17]||""
      ]);
    }
    if (filas.length > 0) shRepD.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
    log.push("✅ Reparaciones: " + filas.length + " filas");
  }

  const shGarO = getHoja(ssO, "GARANTÍAS");
  const shGarD = getHoja(ssD, "Garantías");
  if (shGarO && shGarD) {
    const garVals = shGarO.getDataRange().getValues();
    limpiar(shGarD);
    const filas = [];
    for (let i = 2; i < garVals.length; i++) {
      const r = garVals[i];
      if (!r[0] || String(r[0]).trim() === "") continue;
      filas.push([
        r[0], fmtFecha(r[3]), "", r[4]||"", r[7]||"", r[8]||"", r[9]||"",
        r[10]||"", r[6]||"", num(r[12]), r[2]||"Abierto", fmtFecha(r[13]), ""
      ]);
    }
    if (filas.length > 0) shGarD.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
    log.push("✅ Garantías: " + filas.length + " filas");
  }

  const shGastosO = getHoja(ssO, "GASTOS OPERATIVOS");
  const shGastosD = getHoja(ssD, "Gastos");
  if (shGastosO && shGastosD) {
    const gastosVals = shGastosO.getDataRange().getValues();
    limpiar(shGastosD);
    const filas = [];
    let gstNum = 1;
    for (let i = 2; i < gastosVals.length; i++) {
      const r = gastosVals[i];
      if (!r[0] || num(r[2]) === 0) continue;
      const monto = num(r[2]);
      const forma = String(r[3] || "").toLowerCase();
      const montoEf = forma.includes("efectivo") ? monto : 0;
      const montoTr = forma.includes("transferencia") ? monto : 0;
      const montoTrFinal = (!montoEf && !montoTr) ? monto : montoTr;
      filas.push([
        "GST-" + String(gstNum).padStart(3, "0"), fmtFecha(r[0]),
        r[1]||"", r[4]||"", montoEf, montoTrFinal, "", "", ""
      ]);
      gstNum++;
    }
    if (filas.length > 0) shGastosD.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
    log.push("✅ Gastos: " + filas.length + " registros");
  }

  const shLibroO = getHoja(ssO, "LIBRO_DIARIO");
  const shCajaD  = getHoja(ssD, "Caja");
  if (shLibroO && shCajaD) {
    const libroVals = shLibroO.getDataRange().getValues();
    limpiar(shCajaD);
    const filas = [];
    for (let i = 2; i < libroVals.length; i++) {
      const r = libroVals[i];
      if (!r[0] || String(r[0]).trim() === "") continue;
      filas.push([
        r[0], fmtTS(r[1]), fmtFecha(r[2]), r[3]||"", r[4]||"", r[5]||"",
        r[6]||"", r[7]||"", r[8]||"", num(r[9]), num(r[10]), num(r[11]),
        r[12]||"", r[13]||"", ""
      ]);
    }
    if (filas.length > 0) shCajaD.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
    log.push("✅ Caja: " + filas.length + " asientos");
  }

  const shClientesO = getHoja(ssO, "CLIENTES Y PROVEEDORES");
  const shClientesD = getHoja(ssD, "Clientes");
  if (shClientesO && shClientesD) {
    const clientesVals = shClientesO.getDataRange().getValues();
    limpiar(shClientesD);
    const filas = [];
    let cliNum = 1;
    for (let i = 2; i < clientesVals.length; i++) {
      const r = clientesVals[i];
      if (!r[0] || String(r[0]).trim() === "") continue;
      const tipo = String(r[1] || "Cliente");
      filas.push([
        "CLI-" + String(cliNum).padStart(3, "0"), tipo, r[0]||"", r[3]||"", r[2]||"", "",
        tipo === "Proveedor" ? "Sí" : "No", tipo !== "Proveedor" ? "Sí" : "No", "", "", r[7]||""
      ]);
      cliNum++;
    }
    if (filas.length > 0) shClientesD.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
    log.push("✅ Clientes: " + filas.length + " registros");
  }

  const resumen = log.join("\n");
  console.log("=== RESULTADO MIGRACIÓN ===\n" + resumen);
  SpreadsheetApp.getUi().alert(
    "✅ LLENADO COMPLETADO\n\n" + resumen + "\n\nNo se modificaron: Inversores, Config."
  );
}


// ============================================================
//  MACRO — RECONSTRUIR LIBRO DIARIO
// ============================================================

function reconstruirLibroDiario() {
  const cfg = getConfigCached();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const ui  = SpreadsheetApp.getUi();
  const libro = ss.getSheetByName("Libro Diario");
  if (!libro) throw new Error("❌ Hoja 'Libro Diario' no encontrada.");

  const resp = ui.alert(
    "⚠️ Reconstruir Libro Diario",
    "Esta operación borrará todos los asientos actuales y los " +
    "regenerará desde las hojas fuente (Compras, Ventas, Reparaciones, Gastos, " +
    "Preventas, Movimientos Manuales).\n\nSe recalcula el saldo corrido completo.\n\n¿Confirmás?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const filaEnc = 2;
  const entries = [];

  function addEntry(fecha, origen, idOp, desc, cat, tipo, medio, monto, ref, obs) {
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (isNaN(d)) return;
    entries.push({
      fecha: d, origen, idOp: String(idOp || ""),
      desc: String(desc || ""), cat: String(cat || ""),
      tipo: String(tipo || "NEUTRO"), medio: String(medio || ""),
      monto: Number(monto) || 0,
      ref: String(ref || ""), obs: String(obs || "")
    });
  }

  // 1. COMPRAS
  try {
    const sh = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
    if (sh && sh.getLastRow() > filaEnc) {
      const cOP = getCol(sh, "N° OP",               filaEnc);
      const cFI = getCol(sh, "Fecha Ingreso",        filaEnc);
      const cTI = getCol(sh, "Tipo Ingreso",         filaEnc);
      const cMO = getCol(sh, "Equipo / Modelo",      filaEnc);
      const cIM = getCol(sh, "IMEI",                 filaEnc);
      const cPC = getCol(sh, "Precio Compra",        filaEnc);
      const cFP = getCol(sh, "Forma de Pago Compra", filaEnc);
      const cOB = getCol(sh, "Observaciones",        filaEnc);
      const datos = sh.getRange(filaEnc+1, 1, sh.getLastRow()-filaEnc, sh.getLastColumn()).getValues();
      datos.forEach(r => {
        const tipo  = String(r[cTI-1]);
        const monto = Number(r[cPC-1]) || 0;
        if (!String(r[cOP-1]) || tipo !== "COMPRA" || monto <= 0) return;
        addEntry(r[cFI-1], "COMPRA", r[cOP-1],
          `Compra ${tipo}: ${r[cMO-1]}${r[cIM-1] ? " IMEI:"+r[cIM-1] : ""}`,
          "COMPRA_EQUIPO", "EGRESO", String(r[cFP-1]), monto, r[cOP-1], r[cOB-1]);
      });
    }
  } catch(e) { Logger.log("⚠️ Compras: " + e.message); }

  // 2. VENTAS (solo las que NO son preventa)
  try {
    const sh = ss.getSheetByName(cfg.HOJA_VENTAS || "Ventas");
    if (sh && sh.getLastRow() > filaEnc) {
      const vNV = getCol(sh, "N° Venta",             filaEnc);
      const vFV = getCol(sh, "Fecha Venta",           filaEnc);
      const vTO = getCol(sh, "Tipo Origen",           filaEnc);
      const vMO = getCol(sh, "Modelo",                filaEnc);
      const vCL = getCol(sh, "Cliente",               filaEnc);
      const vEF = getCol(sh, "Cobrado Efectivo",      filaEnc);
      const vTR = getCol(sh, "Cobrado Transferencia", filaEnc);
      const vCU = getCol(sh, "Cobrado Cuotas",        filaEnc);
      const vUS = getCol(sh, "Cobrado USD",           filaEnc);
      const vES = getCol(sh, "Estado",                filaEnc);
      const vOB = getCol(sh, "Observaciones",         filaEnc);
      const datos = sh.getRange(filaEnc+1, 1, sh.getLastRow()-filaEnc, sh.getLastColumn()).getValues();
      datos.forEach(r => {
        const nVta  = String(r[vNV-1]);
        const estado = String(r[vES-1]);
        // No registrar ingreso en las ventas de preventa (el ingreso ya fue en la preventa)
        if (!nVta || estado === "PREVENTA ENTREGADA") return;

        const ef = Number(r[vEF-1]) || 0;
        const tr = Number(r[vTR-1]) || 0;
        const cu = Number(r[vCU-1]) || 0;
        // vUS es CANTIDAD DE DÓLARES (no pesos) — Cambio 3: la caja conserva
        // los dólares reales, un asiento independiente por medio (sin "Mixto").
        const usdCantidad = Number(r[vUS-1]) || 0;

        const tipoOrigen = String(r[vTO-1]);
        const catVta = tipoOrigen.includes("CONSIG") ? "VENTA_CONSIG" : "VENTA_PROPIA";
        const mediosVta = [
          { medio:"Efectivo",      monto: ef },
          { medio:"Transferencia", monto: tr },
          { medio:"Cuotas",        monto: cu },
          { medio:"USD",           monto: usdCantidad }
        ];
        mediosVta.forEach(m => {
          if (m.monto <= 0) return;
          addEntry(r[vFV-1], "VENTA", nVta,
            `Venta ${r[vMO-1]} a ${r[vCL-1]}`,
            catVta, "INGRESO", m.medio, m.monto, nVta, r[vOB-1]);
        });
      });
    }
  } catch(e) { Logger.log("⚠️ Ventas: " + e.message); }

  // 3. REPARACIONES
  try {
    const sh = ss.getSheetByName(cfg.HOJA_REPARACIONES || "Reparaciones");
    if (sh && sh.getLastRow() > filaEnc) {
      const rNR = getCol(sh, "N° Rep",          filaEnc);
      const rFE = getCol(sh, "Fecha Ingreso",    filaEnc);
      const rMO = getCol(sh, "Equipo",           filaEnc);
      const rF1 = getCol(sh, "Falla 1",          filaEnc);
      const rPC = getCol(sh, "Precio Cobrado",   filaEnc);
      const rEF = getCol(sh, "Cobrado Efectivo", filaEnc);
      const rOB = getCol(sh, "Observaciones",    filaEnc);
      const datos = sh.getRange(filaEnc+1, 1, sh.getLastRow()-filaEnc, sh.getLastColumn()).getValues();
      datos.forEach(r => {
        const nRep  = String(r[rNR-1]);
        const monto = Number(r[rPC-1]) || 0;
        if (!nRep || monto <= 0) return;
        const ef = Number(r[rEF-1]) || 0;
        addEntry(r[rFE-1], "REPARACION", nRep,
          `Reparación ${r[rMO-1]} — ${r[rF1-1]}`,
          "REPARACION", "INGRESO",
          ef > 0 ? "Efectivo" : "Transferencia", monto, nRep, r[rOB-1]);
      });
    }
  } catch(e) { Logger.log("⚠️ Reparaciones: " + e.message); }

  // 4. GASTOS
  try {
    const sh = ss.getSheetByName(cfg.HOJA_GASTOS || "Gastos");
    if (sh && sh.getLastRow() > filaEnc) {
      const gNG = getCol(sh, "N° Gasto",            filaEnc);
      const gFE = getCol(sh, "Fecha",               filaEnc);
      const gCA = getCol(sh, "Categoría",           filaEnc);
      const gDE = getCol(sh, "Descripción",         filaEnc);
      const gME = getCol(sh, "Monto Efectivo",      filaEnc);
      const gMT = getCol(sh, "Monto Transferencia", filaEnc);
      const gCO = getCol(sh, "Comprobante",         filaEnc);
      const gOB = getCol(sh, "Observaciones",       filaEnc);
      const datos = sh.getRange(filaEnc+1, 1, sh.getLastRow()-filaEnc, sh.getLastColumn()).getValues();
      datos.forEach(r => {
        const nGas = String(r[gNG-1]);
        const ef   = Number(r[gME-1]) || 0;
        const tr   = Number(r[gMT-1]) || 0;
        const monto = ef + tr;
        if (!nGas || monto <= 0) return;
        const cat = String(r[gCA-1]);
        addEntry(r[gFE-1], "GASTO", nGas,
          `Gasto ${cat}: ${r[gDE-1]}`, cat, "EGRESO",
          (ef > 0 && tr > 0) ? "Mixto" : ef > 0 ? "Efectivo" : "Transferencia",
          monto, String(r[gCO-1]), r[gOB-1]);
      });
    }
  } catch(e) { Logger.log("⚠️ Gastos: " + e.message); }

  // 5. PREVENTAS (los ingresos originales)
  try {
    const sh = ss.getSheetByName("Preventas");
    if (sh && sh.getLastRow() > 1) {
      const fE  = 2;
      const cNP = getCol(sh, "N° Preventa",          fE);
      const cFP = getCol(sh, "Fecha Preventa",        fE);
      const cMO = getCol(sh, "Modelo Solicitado",     fE);
      const cCL = getCol(sh, "Cliente",               fE);
      const cEF = getCol(sh, "Cobrado Efectivo",      fE);
      const cTR = getCol(sh, "Cobrado Transferencia", fE);
      const cCU = getCol(sh, "Cobrado Cuotas",        fE);
      const cUS = getCol(sh, "Cobrado USD",           fE);
      const cOB = getCol(sh, "Observaciones",         fE);
      const datos = sh.getRange(fE+1, 1, sh.getLastRow()-fE, sh.getLastColumn()).getValues();
      datos.forEach(r => {
        const nPre = String(r[cNP-1]);
        if (!nPre) return;
        // r[cUS-1] es CANTIDAD DE DÓLARES (no pesos). Cambio 3: la caja
        // conserva los dólares reales, sin convertir a pesos.
        const usdCantidad = Number(r[cUS-1]) || 0;
        const mediosPrev = [
          { medio:"Efectivo",      monto: Number(r[cEF-1]) || 0 },
          { medio:"Transferencia", monto: Number(r[cTR-1]) || 0 },
          { medio:"Cuotas",        monto: Number(r[cCU-1]) || 0 },
          { medio:"USD",           monto: usdCantidad }
        ];
        mediosPrev.forEach(m => {
          if (m.monto <= 0) return;
          addEntry(r[cFP-1], "PREVENTA", nPre,
            `Preventa ${r[cMO-1]} — ${r[cCL-1]}`,
            "PREVENTA", "INGRESO", m.medio, m.monto, nPre, r[cOB-1]);
        });
      });
    }
  } catch(e) { Logger.log("⚠️ Preventas: " + e.message); }

  // 6. MOVIMIENTOS_CAJA
  try {
    const sh = ss.getSheetByName("MOVIMIENTOS_CAJA");
    if (sh && sh.getLastRow() > 1) {
      const datos = sh.getRange(2, 1, sh.getLastRow()-1, 12).getValues();
      datos.forEach(r => {
        const id = String(r[0]);
        if (!id) return;
        const tipoMov = String(r[2]);
        const medios  = [
          { m:"Efectivo",      v: Number(r[5]) || 0 },
          { m:"Transferencia", v: Number(r[6]) || 0 },
          { m:"USD",           v: Number(r[7]) || 0 },
          { m:"Cuotas",        v: Number(r[8]) || 0 }
        ];
        medios.forEach(med => {
          if (med.v <= 0) return;
          const tipo = tipoMov === "TRANSFERENCIA" ? "INGRESO" : tipoMov;
          addEntry(r[1], "MOVIMIENTO_MANUAL", id,
            String(r[4]), String(r[3]), tipo, med.m, med.v,
            String(r[10]), String(r[11]));
        });
      });
    }
  } catch(e) { Logger.log("⚠️ Movimientos Caja: " + e.message); }

  if (entries.length === 0) {
    ui.alert("⚠️ No se encontraron movimientos para reconstruir.");
    return;
  }

  entries.sort((a, b) => a.fecha - b.fecha);

  const colID   = getCol(libro, "ID_ASIENTO",     filaEnc);
  const colTS   = getCol(libro, "TIMESTAMP",      filaEnc);
  const colFec  = getCol(libro, "FECHA",          filaEnc);
  const colOrig = getCol(libro, "ORIGEN",         filaEnc);
  const colOp   = getCol(libro, "ID_OPERACION",   filaEnc);
  const colDesc = getCol(libro, "DESCRIPCION",    filaEnc);
  const colCat  = getCol(libro, "CATEGORIA",      filaEnc);
  const colTipo = getCol(libro, "TIPO",           filaEnc);
  const colMed  = getCol(libro, "MEDIO",          filaEnc);
  const colMon  = getCol(libro, "MONTO",          filaEnc);
  const colSA   = getCol(libro, "SALDO_ANTERIOR", filaEnc);
  const colSN   = getCol(libro, "SALDO_NUEVO",    filaEnc);
  const colRef  = getCol(libro, "REFERENCIA",     filaEnc);
  const colObs  = getCol(libro, "OBSERVACIONES",  filaEnc);
  const colReg  = getCol(libro, "REGISTRADO_POR", filaEnc);

  const totalCols = libro.getLastColumn();
  const lastRow   = libro.getLastRow();
  if (lastRow > filaEnc) {
    libro.getRange(filaEnc + 1, 1, lastRow - filaEnc, totalCols).clearContent();
  }

  const matrix = entries.map(() => new Array(totalCols).fill(""));
  let saldo = 0;

  entries.forEach((e, i) => {
    const saldoAnt = saldo;
    if      (e.tipo === "INGRESO") saldo += e.monto;
    else if (e.tipo === "EGRESO")  saldo -= e.monto;

    const row = matrix[i];
    row[colID  - 1] = genID("ASI");
    row[colTS  - 1] = e.fecha;
    row[colFec - 1] = e.fecha;
    row[colOrig- 1] = e.origen;
    row[colOp  - 1] = e.idOp;
    row[colDesc- 1] = e.desc;
    row[colCat - 1] = e.cat;
    row[colTipo- 1] = e.tipo;
    row[colMed - 1] = e.medio;
    row[colMon - 1] = e.monto;
    row[colSA  - 1] = saldoAnt;
    row[colSN  - 1] = saldo;
    row[colRef - 1] = e.ref;
    row[colObs - 1] = e.obs;
    row[colReg - 1] = "Martin";
  });

  libro.getRange(filaEnc + 1, 1, matrix.length, totalCols).setValues(matrix);
  libro.getRange(filaEnc+1, colMon, entries.length, 1).setNumberFormat("$#,##0");
  libro.getRange(filaEnc+1, colSA,  entries.length, 1).setNumberFormat("$#,##0");
  libro.getRange(filaEnc+1, colSN,  entries.length, 1).setNumberFormat("$#,##0");
  libro.getRange(filaEnc+1, colFec, entries.length, 1).setNumberFormat("dd/mm/yyyy");

  ui.alert(
    "✅ Libro Diario reconstruido",
    `${entries.length} asientos regenerados en orden cronológico.\nSaldo final: ${fmtPeso(saldo)}`,
    ui.ButtonSet.OK
  );
}


// ============================================================
//  FORMATO DE COLORES — LIBRO DIARIO (Ingresos/Egresos más claros)
// ============================================================
//
// Aplica formato condicional sobre toda la columna TIPO: cada fila se
// colorea según sea INGRESO (verde), EGRESO (rojo) o NEUTRO (gris) — no
// requiere tocar libroLog() ni ninguna función protegida, y se aplica
// tanto a los asientos ya existentes como a los que se agreguen después
// (deja margen de filas futuras para no tener que volver a correrla).
// Idempotente: se puede ejecutar de nuevo sin duplicar reglas.
// ============================================================
function formatearLibroDiario() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const ui  = SpreadsheetApp.getUi();
  const sheet = ss.getSheetByName("Libro Diario");
  if (!sheet) { ui.alert("❌ Hoja 'Libro Diario' no encontrada."); return; }

  const filaEnc = 2;
  const hdrs = sheet.getRange(filaEnc, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idxTipo = hdrs.findIndex(h => String(h).trim() === "TIPO");
  if (idxTipo === -1) { ui.alert("❌ Columna 'TIPO' no encontrada en 'Libro Diario'."); return; }
  const colTipoLetra = sheet.getRange(1, idxTipo + 1).getA1Notation().replace(/[0-9]/g, "");

  const totalCols  = Math.max(sheet.getLastColumn(), 15);
  const filaInicio = filaEnc + 1;
  // Margen de 3000 filas futuras para no tener que re-ejecutar esto cada vez que se agregan asientos.
  const filaFin    = Math.max(sheet.getLastRow(), filaEnc) + 3000;
  const rango      = sheet.getRange(filaInicio, 1, filaFin - filaInicio + 1, totalCols);
  const ref        = "$" + colTipoLetra + filaInicio;

  const reglaIngreso = SpreadsheetApp.newConditionalFormatRule()
    .setRanges([rango])
    .whenFormulaSatisfied(`=${ref}="INGRESO"`)
    .setBackground("#D5F5E3")
    .setFontColor("#1E8449")
    .build();

  const reglaEgreso = SpreadsheetApp.newConditionalFormatRule()
    .setRanges([rango])
    .whenFormulaSatisfied(`=${ref}="EGRESO"`)
    .setBackground("#FADBD8")
    .setFontColor("#922B21")
    .build();

  const reglaNeutro = SpreadsheetApp.newConditionalFormatRule()
    .setRanges([rango])
    .whenFormulaSatisfied(`=${ref}="NEUTRO"`)
    .setBackground("#F4F6F7")
    .setFontColor("#5D6D7E")
    .build();

  // Reemplaza cualquier regla de formato condicional previa de esta hoja
  // (para poder re-ejecutar la función sin ir acumulando reglas duplicadas).
  sheet.setConditionalFormatRules([reglaIngreso, reglaEgreso, reglaNeutro]);

  ui.alert(
    "✅ Formato aplicado",
    "Libro Diario coloreado: INGRESO en verde, EGRESO en rojo, NEUTRO en gris.\nSe aplica a los asientos existentes y a los nuevos automáticamente.",
    ui.ButtonSet.OK
  );
}


// ============================================================
//  MACRO DE MANTENIMIENTO — REINICIAR SISTEMA COMPLETO
// ============================================================
//
// reiniciarSistemaCompleto() borra TODOS los registros operativos (para
// volver a arrancar desde cero) pero conserva intactos: estructura de
// hojas, encabezados, formatos, colores, validaciones, fórmulas, menús y
// Config. Antes de borrar nada, duplica cada hoja operativa completa
// (con formato, validaciones y fórmulas) en una copia "BACKUP_...".
//
// No modifica ninguna de las funciones protegidas (getConfig,
// getConfigCached, getCol, getFilaVacia, genCorrelativo, libroLog,
// actualizarStock_, procesarCompra, procesarVenta, procesarPreventa,
// entregarPreventa, procesarReparacion, procesarGasto,
// procesarMovimientoInversor) ni toca Config, Reportes, Dashboard, ni
// ninguna otra hoja auxiliar u oculta — solo actúa sobre las 8 hojas
// operativas listadas explícitamente abajo.
// ============================================================

function reiniciarSistemaCompleto() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "ATENCIÓN",
    "Se eliminarán TODOS los datos operativos del sistema.\n\n" +
    "Esta acción no puede deshacerse.\n\n¿Desea continuar?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();

  // Únicas hojas que esta macro puede tocar (todo lo demás, incluida
  // Config, Reportes o cualquier hoja auxiliar/oculta, queda intacto).
  const nombresHojas = {
    compras:      cfg.HOJA_COMPRAS      || "Compras",
    ventas:       cfg.HOJA_VENTAS       || "Ventas",
    preventas:    "Preventas",
    reparaciones: cfg.HOJA_REPARACIONES || "Reparaciones",
    gastos:       cfg.HOJA_GASTOS       || "Gastos",
    inversores:   cfg.HOJA_INVERSORES   || "Inversores",
    libroDiario:  "Libro Diario",
    stock:        cfg.HOJA_STOCK        || "Stock"
  };

  // === 1) BACKUP — duplicar cada hoja operativa completa (formato,
  // validaciones y fórmulas incluidos) ANTES de borrar nada. ===
  const marcaTiempo = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmm");
  const backups = [];
  Object.keys(nombresHojas).forEach(clave => {
    const nombre = nombresHojas[clave];
    const hoja = ss.getSheetByName(nombre);
    if (!hoja) return;
    const copia = hoja.copyTo(ss);
    let nombreBackup = `BACKUP_${marcaTiempo}_${nombre}`;
    if (nombreBackup.length > 100) nombreBackup = nombreBackup.substring(0, 100);
    copia.setName(nombreBackup);
    backups.push(nombreBackup);
  });
  Logger.log("reiniciarSistemaCompleto: backups creados → " + backups.join(", "));

  // === 2) Hojas de tabla simple: borrar SOLO el contenido de las filas de
  // datos (clearContent, nunca clear) para no tocar formatos, colores,
  // validaciones ni fórmulas. ===
  const hojasSimples = [
    { nombre: nombresHojas.compras,      filaEnc: 2 },
    { nombre: nombresHojas.ventas,       filaEnc: 2 },
    { nombre: nombresHojas.preventas,    filaEnc: 2 },
    { nombre: nombresHojas.reparaciones, filaEnc: 2 },
    { nombre: nombresHojas.gastos,       filaEnc: 2 },
    { nombre: nombresHojas.libroDiario,  filaEnc: 2 },
    { nombre: nombresHojas.stock,        filaEnc: 9 }
  ];

  hojasSimples.forEach(h => {
    const hoja = ss.getSheetByName(h.nombre);
    if (!hoja) return;
    const filaDatos = h.filaEnc + 1;
    const lastRow = hoja.getLastRow();
    const lastCol = hoja.getLastColumn();
    if (lastRow >= filaDatos && lastCol > 0) {
      hoja.getRange(filaDatos, 1, lastRow - filaDatos + 1, lastCol).clearContent();
    }
  });

  // === 3) Inversores: NO es una tabla simple (paneles por inversor con
  // sub-tablas en filas dinámicas) — se resetea de forma segura respetando
  // esa estructura en vez de borrar por rango fijo. ===
  const invSheet = ss.getSheetByName(nombresHojas.inversores);
  if (invSheet) reiniciarInversoresSeguro_(invSheet);

  SpreadsheetApp.flush();

  SpreadsheetApp.getUi().alert("Sistema reiniciado correctamente.");
}

/**
 * reiniciarInversoresSeguro_(invSheet)
 *
 * La hoja "Inversores" no tiene un encabezado fijo con datos debajo (a
 * diferencia de Compras/Ventas/etc.): tiene una tabla resumen (encabezados
 * en fila 8, una fila por inversor) seguida de un panel por inversor con
 * dos sub-tablas ("MOVIMIENTOS DE CAPITAL" y "RENDIMIENTOS MENSUALES") en
 * filas que varían según cuántos inversores haya. Usa el mismo criterio de
 * detección que ya usan procesarMovimientoInversor() y
 * generarRendimientoMensual() (buscar los textos "Panel del Inversor",
 * "MOVIMIENTOS DE CAPITAL" y "RENDIMIENTOS MENSUALES" en la columna A).
 *
 * Deja intactos: títulos de panel, encabezados de cada sub-tabla y la
 * columna "Nombre" de la tabla resumen. Solo:
 *   - resetea a 0 Capital Invertido / Pagado Total / Pendiente de Pago
 *     (y Rend. Mensual (20%) si existe) en la tabla resumen,
 *   - vacía (clearContent) las filas de datos de cada sub-tabla.
 */
function reiniciarInversoresSeguro_(invSheet) {
  const fE    = 8;
  const cNom  = getCol(invSheet, "Nombre",            fE);
  const cCap  = getCol(invSheet, "Capital Invertido", fE);
  const cPag  = getCol(invSheet, "Pagado Total",       fE);
  const cPend = getCol(invSheet, "Pendiente de Pago",  fE);
  let cRend = -1;
  try { cRend = getCol(invSheet, "Rend. Mensual (20%)", fE); } catch (e) { /* columna opcional */ }

  const lastRow = invSheet.getLastRow();
  const lastCol = invSheet.getLastColumn();
  if (lastRow < fE + 1) return;

  // 1) Tabla resumen: resetear a 0 mientras la columna "Nombre" tenga valor.
  for (let r = fE + 1; r <= lastRow; r++) {
    const nombre = String(invSheet.getRange(r, cNom).getValue()).trim();
    if (!nombre) break;
    invSheet.getRange(r, cCap).setValue(0);
    invSheet.getRange(r, cPag).setValue(0);
    invSheet.getRange(r, cPend).setValue(0);
    if (cRend >= 0) invSheet.getRange(r, cRend).setValue(0);
  }

  // 2) Sub-tablas por panel de inversor: vaciar solo las filas de datos.
  const colA = invSheet.getRange(1, 1, lastRow, 1).getValues().map(r => String(r[0] || ""));

  // Filas (1-based) donde arranca cualquier sección nueva — sirven para
  // saber dónde termina cada sub-tabla de datos.
  const inicioSeccion = [];
  colA.forEach((texto, idx) => {
    if (texto.includes("Panel del Inversor") ||
        texto.includes("MOVIMIENTOS DE CAPITAL") ||
        texto.includes("RENDIMIENTOS MENSUALES")) {
      inicioSeccion.push(idx + 1);
    }
  });

  colA.forEach((texto, idx) => {
    if (!texto.includes("MOVIMIENTOS DE CAPITAL") && !texto.includes("RENDIMIENTOS MENSUALES")) return;

    const filaTitulo   = idx + 1;
    const filaEncSub    = filaTitulo + 1; // encabezados de columnas de la sub-tabla (no se tocan)
    if (filaEncSub > lastRow) return;

    const siguienteSeccion = inicioSeccion.find(f => f > filaTitulo);
    const filaFinDatos   = siguienteSeccion ? siguienteSeccion - 1 : lastRow;
    const filaDatosDesde = filaEncSub + 1;

    if (filaDatosDesde <= filaFinDatos) {
      invSheet.getRange(filaDatosDesde, 1, filaFinDatos - filaDatosDesde + 1, lastCol).clearContent();
    }
  });
}


// ============================================================
//  MÓDULO PREVENTAS
// ============================================================

/**
 * HOJA "Preventas" — crear con estos encabezados en FILA 1:
 * N° Preventa | Fecha Preventa | Cliente | Teléfono |
 * Modelo Solicitado | Precio Venta Pactado |
 * Cobrado Efectivo | Cobrado Transferencia | Cobrado Cuotas | Cobrado USD |
 * Total Cobrado | Saldo Pendiente | Estado | N° Compra Asociada | N° Venta Asociada | Observaciones
 *
 * HOJA "Compras" — agregar columna adicional en fila 2 (al final):
 * N° Preventa Asociada
 *
 * Saldo Pendiente = Precio Venta Pactado - Total Cobrado
 *
 * Estados: 🟡 Esperando compra | 🟠 Comprado | ✅ Entregado | ❌ Cancelado
 */

// ============================================================
//  REGISTRAR PREVENTA
// ============================================================

function registrarPreventa() {
  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:18px;font-size:13px}
    label{display:block;margin-top:10px;font-weight:bold;color:#6C3483}
    input,select,textarea{width:100%;padding:7px;margin-top:3px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
    .fila2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .fila4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px}
    .btn{background:#6C3483;color:#fff;padding:10px 20px;border:none;border-radius:4px;
         cursor:pointer;margin-top:14px;width:100%;font-size:13px}
    .btn:hover{background:#5B2C6F}
    .total{background:#F5EEF8;padding:8px;border-radius:4px;margin-top:8px;font-weight:bold;color:#6C3483}
    .entrega-box{background:#EBF5FB;border-left:4px solid #2980B9;padding:8px;margin-top:8px;border-radius:4px}
    .acc-box{background:#F8F9FA;border:1px solid #dee2e6;border-radius:6px;padding:12px;margin-top:10px}
    .acc-fila{display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-top:6px}
  </style>
  <h3 style="color:#6C3483;margin:0 0 14px">🟡 Registrar Preventa</h3>

  <div class="fila2">
    <div>
      <label>Fecha preventa:</label>
      <input type="date" id="fecha" value="${Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd")}"/>
    </div>
    <div>
      <label>Modelo solicitado:</label>
      <input type="text" id="modelo" placeholder="Ej: iPhone 15 Pro"/>
    </div>
  </div>

  <div class="fila2">
    <div>
      <label>Cliente:</label>
      <input type="text" id="cliente" placeholder="Nombre y apellido"/>
    </div>
    <div>
      <label>Vendedor: *</label>
      <input type="text" id="vendedor" placeholder="Nombre del vendedor" value="Martin"/>
    </div>
  </div>

  <label>Teléfono:</label>
  <input type="text" id="tel" placeholder="Ej: 2914123456"/>

  <div class="entrega-box">
    <label style="color:#1A5276;margin:0">📅 Rango de fechas de entrega prometida</label>
    <div class="fila2" style="margin-top:6px">
      <div>
        <label style="font-size:11px">Fecha Prometida Desde</label>
        <input type="date" id="fechaDesde" value=""/>
      </div>
      <div>
        <label style="font-size:11px">Fecha Prometida Hasta</label>
        <input type="date" id="fechaHasta" value=""/>
      </div>
    </div>
  </div>

  <label>Precio de venta pactado ($):</label>
  <input type="number" id="precioVenta" value="0" min="0" oninput="calcTotal()"/>

  <label>Cobrado en ($):</label>
  <div class="fila4">
    <div><label style="font-size:11px">Efectivo</label>
      <input type="number" id="efec" value="0" min="0" oninput="calcTotal()"/></div>
    <div><label style="font-size:11px">Transferencia</label>
      <input type="number" id="transf" value="0" min="0" oninput="calcTotal()"/></div>
    <div><label style="font-size:11px">Cuotas</label>
      <input type="number" id="cuotas" value="0" min="0" oninput="calcTotal()"/></div>
    <div><label style="font-size:11px">USD (dólares)</label>
      <input type="number" id="usd" value="0" min="0" oninput="calcTotal()"/></div>
  </div>
  <div class="total" id="totalDiv">Total cobrado: $0</div>
  <div style="font-size:11px;color:#666;margin-top:4px" id="cotizDiv"></div>

  <label>Observaciones:</label>
  <input type="text" id="obs" placeholder="Opcional (se agrega entrega estimada automáticamente si está vacío)"/>

  <button class="btn" onclick="enviar()">✅ Registrar preventa</button>

  <script>
  var cotizacionVenta = 0;
  google.script.run.withSuccessHandler(function(cot){
    cotizacionVenta = cot.venta;
    document.getElementById("cotizDiv").textContent =
      "Cotización USD oficial: " + fmtP(cot.venta) + " (se actualiza automáticamente)";
    calcTotal();
  }).obtenerCotizacionUSD();

  function fmtP(n){ return "$"+Number(n).toLocaleString("es-AR"); }

  function calcTotal(){
    const ef=parseFloat(document.getElementById("efec").value)||0;
    const tr=parseFloat(document.getElementById("transf").value)||0;
    const cu=parseFloat(document.getElementById("cuotas").value)||0;
    const us=parseFloat(document.getElementById("usd").value)||0;
    const usPesos = us * cotizacionVenta;
    const t = ef + tr + cu + usPesos;
    let txt = "Total cobrado: " + fmtP(t);
    if(us > 0){
      txt += " (incluye " + us + " USD ≈ " + fmtP(usPesos) + ")";
    }
    document.getElementById("totalDiv").textContent = txt;
  }
  function enviar(){
    const pv=parseFloat(document.getElementById("precioVenta").value)||0;
    const ef=parseFloat(document.getElementById("efec").value)||0;
    const tr=parseFloat(document.getElementById("transf").value)||0;
    const cu=parseFloat(document.getElementById("cuotas").value)||0;
    const us=parseFloat(document.getElementById("usd").value)||0;
    const usPesos = us * cotizacionVenta;
    const total=ef+tr+cu+usPesos;
    if(!document.getElementById("cliente").value.trim()){alert("❌ Ingresá el nombre del cliente.");return;}
    if(!document.getElementById("modelo").value.trim()){alert("❌ Ingresá el modelo solicitado.");return;}
    if(!document.getElementById("vendedor").value.trim()){alert("❌ Ingresá el nombre del vendedor.");return;}
    if(pv<=0){alert("❌ El precio pactado debe ser > 0.");return;}
    if(total<=0){alert("❌ Debe registrarse al menos un cobro.");return;}
    const fechaDesde=document.getElementById("fechaDesde").value;
    const fechaHasta=document.getElementById("fechaHasta").value;
    if(fechaDesde&&fechaHasta&&fechaDesde>fechaHasta){alert("❌ 'Fecha Prometida Desde' no puede ser posterior a 'Fecha Prometida Hasta'.");return;}
    const d={
      fecha:document.getElementById("fecha").value,
      modelo:document.getElementById("modelo").value.trim(),
      cliente:document.getElementById("cliente").value.trim(),
      tel:document.getElementById("tel").value.trim(),
      vendedor:document.getElementById("vendedor").value.trim(),
      precioVenta:pv,
      efec:ef,transf:tr,cuotas:cu,usd:us,
      fechaDesde:fechaDesde,
      fechaHasta:fechaHasta,
      obs:document.getElementById("obs").value.trim()
    };
    google.script.run
      .withSuccessHandler(m=>{alert(m);google.script.host.close();})
      .withFailureHandler(e=>alert("❌ "+e.message))
      .procesarPreventa(d);
  }
  </script>
  `).setWidth(540).setHeight(780).setTitle("Registrar Preventa");
  SpreadsheetApp.getUi().showModalDialog(html,"🟡 Registrar Preventa");
}

function procesarPreventa(d) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Preventas");
  if (!sheet) throw new Error("❌ Hoja 'Preventas' no encontrada. Creala con los encabezados indicados.");
  // Mismos requisitos que ya exige preventas.html antes de enviar —
  // revalidados acá para que el backend no dependa exclusivamente de esa
  // pantalla.
  if (!String(d.cliente || "").trim()) throw new Error("❌ Ingresá el nombre del cliente.");
  if (!String(d.modelo || "").trim()) throw new Error("❌ Ingresá el modelo solicitado.");
  if (!(Number(d.precioVenta) > 0)) throw new Error("❌ El precio pactado debe ser mayor a 0.");

  const fE   = 2;
  // CUIL/Domicilio/Email del cliente + IMEI/Color/Estado del equipo
  // solicitado: columnas nuevas, autocreadas si la hoja todavía no las
  // tiene (mismo mecanismo que asegurarColumnaGenerica_() usa para OPERADOR
  // en operadores.gs) para no exigir que alguien edite la planilla a mano.
  // Todas opcionales — solo alimentan el recibo imprimible (recibos.gs).
  asegurarColumnaGenerica_(sheet, fE, "CUIL Cliente");
  asegurarColumnaGenerica_(sheet, fE, "Domicilio Cliente");
  asegurarColumnaGenerica_(sheet, fE, "Email Cliente");
  asegurarColumnaGenerica_(sheet, fE, "IMEI Solicitado");
  asegurarColumnaGenerica_(sheet, fE, "Color Solicitado");
  asegurarColumnaGenerica_(sheet, fE, "Estado Requerido");
  // Sin esto, si la hoja "Preventas" nunca tuvo estas dos columnas creadas
  // a mano, cED/cEH quedaban en -1 para siempre (idx(...,true) las trata
  // como opcionales y no rompe nada, pero tampoco las crea) — la fecha de
  // entrega calculada en el formulario nunca se guardaba, y por eso el
  // recibo de preventa (generarReciboPreventa, recibos.gs) mostraba
  // "Fecha de entrega" vacía pese a que dias_habiles.gs ya calculaba bien
  // el rango de 7 a 10 días hábiles en pantalla.
  asegurarColumnaGenerica_(sheet, fE, "Fecha Prometida Desde");
  asegurarColumnaGenerica_(sheet, fE, "Fecha Prometida Hasta");
  // Equipo que el cliente entrega en parte de pago de esta preventa (si
  // corresponde) — opcional, solo para que el panel de seguimiento y el
  // recibo lo muestren; no genera ningún movimiento de stock por sí solo.
  asegurarColumnaGenerica_(sheet, fE, "Equipo Parte De Pago");
  asegurarColumnaGenerica_(sheet, fE, "Valor Parte De Pago");
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n, opcional) => {
    const i = hdrs.findIndex(h => String(h).trim() === n.trim());
    if (i === -1 && !opcional) throw new Error(`❌ Columna "${n}" no encontrada en "Preventas" (fila ${fE}).`);
    return i; // 0-based, -1 si es opcional y no existe
  };
  const cNP  = idx("N° Preventa");
  const cFP  = idx("Fecha Preventa");
  const cCL  = idx("Cliente");
  const cCUIL = idx("CUIL Cliente");
  const cDOM = idx("Domicilio Cliente");
  const cEML = idx("Email Cliente");
  const cIME = idx("IMEI Solicitado");
  const cCOL = idx("Color Solicitado");
  const cESR = idx("Estado Requerido");
  const cTL  = idx("Teléfono");
  const cMO  = idx("Modelo Solicitado");
  const cPV  = idx("Precio Venta Pactado");
  const cEF  = idx("Cobrado Efectivo");
  const cTR  = idx("Cobrado Transferencia");
  const cCU  = idx("Cobrado Cuotas");
  const cUS  = idx("Cobrado USD");
  const cTC  = idx("Total Cobrado");
  const cSP  = idx("Saldo Pendiente");
  const cES  = idx("Estado");
  const cNCA = idx("N° Compra Asociada");
  const cNVA = idx("N° Venta Asociada");
  const cOB  = idx("Observaciones");
  // Columnas nuevas (Parte 2 y 3) — opcionales para no romper si la hoja aún no las tiene
  const cVend = idx("Vendedor",              true);
  const cED   = idx("Fecha Prometida Desde", true);
  const cEH   = idx("Fecha Prometida Hasta", true);
  // Cambio 3: guardar simultáneamente USD reales (cUS, ya existente) y USD
  // convertidos a pesos (columna nueva, opcional) para poder reconstruir
  // caja/ganancias/reportes sin perder ninguno de los dos valores.
  const cUSC  = idx("Cobrado USD Convertido", true);
  const cPPE  = idx("Equipo Parte De Pago",   true);
  const cPPV  = idx("Valor Parte De Pago",    true);

  const nPre = genCorrelativo(sheet, cNP + 1, "PRE", fE + 1);
  const fila = getFilaVacia(sheet, cNP + 1, fE + 1);

  // Conversión real de USD a pesos
  const cotizacion   = obtenerCotizacionUSD();
  const usdMontoReal = Number(d.usd) || 0;
  const usdEnPesos   = convertirUSDaPesos_(usdMontoReal, cotizacion);

  const ef = Number(d.efec)   || 0;
  const tr = Number(d.transf) || 0;
  const cu = Number(d.cuotas) || 0;

  const totalCobrado   = ef + tr + cu + usdEnPesos;
  const saldoPendiente = d.precioVenta - totalCobrado;
  if (saldoPendiente < -0.01) {
    throw new Error(`❌ Lo cobrado (${fmtPeso(totalCobrado)}) no puede superar el precio pactado (${fmtPeso(d.precioVenta)}).`);
  }

  // Descripción automática de entrega si observaciones vacías (Parte 3).
  // Parte 6: el formulario ahora pide una sola "Fecha de entrega" (no un
  // rango) — manda el mismo valor en fechaDesde y fechaHasta, así que acá
  // se describe como fecha única en vez de "del X al Y".
  const fechaDesde = d.fechaDesde ? parseDate(d.fechaDesde) : null;
  const fechaHasta = d.fechaHasta ? parseDate(d.fechaHasta) : null;
  let entregaDesc = "";
  if (fechaDesde && fechaHasta && fechaDesde.getTime() === fechaHasta.getTime()) {
    entregaDesc = `Entrega prometida: el ${fmt(fechaHasta)}`;
  } else if (fechaDesde && fechaHasta) {
    entregaDesc = `Entrega prometida: ${fmt(fechaDesde)} a ${fmt(fechaHasta)}`;
  } else if (fechaDesde) {
    entregaDesc = `Entrega prometida: a partir del ${fmt(fechaDesde)}`;
  } else if (fechaHasta) {
    entregaDesc = `Entrega prometida: hasta el ${fmt(fechaHasta)}`;
  }
  const obsFinal = d.obs
    ? (entregaDesc ? `${d.obs} | ${entregaDesc}` : d.obs)
    : entregaDesc;

  // Construir la fila en memoria → un solo setValues()
  const totalCols = hdrs.length;
  const filaData  = new Array(totalCols).fill("");
  filaData[cNP]  = nPre;
  filaData[cFP]  = parseDate(d.fecha);
  filaData[cCL]  = d.cliente;
  filaData[cCUIL] = d.cuil || "";
  filaData[cDOM] = d.domicilio || "";
  filaData[cEML] = d.email || "";
  filaData[cIME] = d.imei || "";
  filaData[cCOL] = d.color || "";
  filaData[cESR] = d.estadoRequerido || "";
  filaData[cTL]  = d.tel;
  filaData[cMO]  = d.modelo;
  filaData[cPV]  = d.precioVenta;
  filaData[cEF]  = ef;
  filaData[cTR]  = tr;
  filaData[cCU]  = cu;
  filaData[cUS]  = usdMontoReal; // cantidad de dólares
  filaData[cTC]  = totalCobrado;
  filaData[cSP]  = saldoPendiente;
  filaData[cES]  = "🟡 Esperando compra";
  filaData[cNCA] = "";
  filaData[cNVA] = "";
  filaData[cOB]  = obsFinal;
  if (cVend >= 0) filaData[cVend] = d.vendedor || "";
  if (cED   >= 0) filaData[cED]   = fechaDesde || "";
  if (cEH   >= 0) filaData[cEH]   = fechaHasta || "";
  if (cUSC  >= 0) filaData[cUSC]  = usdEnPesos;
  if (cPPE  >= 0) filaData[cPPE]  = d.partePagoEquipo || "";
  if (cPPV  >= 0) filaData[cPPV]  = d.partePagoEquipo ? (Number(d.partePagoValor) || 0) : "";

  sheet.getRange(fila, 1, 1, totalCols).setValues([filaData]);
  sheet.getRange(fila, cFP + 1).setNumberFormat("dd/mm/yyyy");
  sheet.getRange(fila, cPV + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cEF + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cTR + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cCU + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cTC + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cSP + 1).setNumberFormat("$#,##0");
  if (cED  >= 0) sheet.getRange(fila, cED  + 1).setNumberFormat("dd/mm/yyyy");
  if (cEH  >= 0) sheet.getRange(fila, cEH  + 1).setNumberFormat("dd/mm/yyyy");
  if (cUSC >= 0) sheet.getRange(fila, cUSC + 1).setNumberFormat("$#,##0");
  if (cPPV >= 0) sheet.getRange(fila, cPPV + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cNP + 1, 1, totalCols).setBackground("#F5EEF8");

  // Registrar SOLO lo efectivamente cobrado (puede ser parcial). Cambio 3:
  // la caja debe conservar los DÓLARES REALES — el medio "USD" se loguea con
  // monto = usdMontoReal (cantidad de dólares), NUNCA convertido a pesos. La
  // conversión sólo se informa en observaciones para trazabilidad.
  const medios = [
    { medio:"Efectivo",      monto: ef,           esUSD: false },
    { medio:"Transferencia", monto: tr,           esUSD: false },
    { medio:"Cuotas",        monto: cu,           esUSD: false },
    { medio:"USD",           monto: usdMontoReal, esUSD: true  }
  ];
  medios.forEach(m => {
    if (m.monto <= 0) return;
    libroLog({
      origen:       "PREVENTA",
      idOperacion:  nPre,
      descripcion:  `Seña/Preventa ${d.modelo} — ${d.cliente}${d.vendedor ? " | Vendedor: "+d.vendedor : ""}`,
      categoria:    "PREVENTA",
      tipo:         "INGRESO",
      medio:        m.medio,
      monto:        m.monto,
      referencia:   nPre,
      observaciones: m.esUSD
        ? `${obsFinal ? obsFinal + " | " : ""}USD: ${usdMontoReal} | USD_COTIZACION: ${fmtPeso(cotizacion.venta)} | USD_CONVERTIDO: ${fmtPeso(usdEnPesos)}`
        : obsFinal,
      registradoPor:d.vendedor || "Martin"
    });
  });

  return `✅ Preventa registrada.\nN°: ${nPre}\nModelo: ${d.modelo}\nCliente: ${d.cliente}\nPactado: ${fmtPeso(d.precioVenta)}\nCobrado ahora: ${fmtPeso(totalCobrado)}` +
    (usdMontoReal > 0 ? `\nUSD: ${usdMontoReal} → ${fmtPeso(usdEnPesos)} (cotización ${fmtPeso(cotizacion.venta)})` : ``) +
    `\nSaldo pendiente: ${fmtPeso(saldoPendiente)}` +
    (entregaDesc ? `\n📅 ${entregaDesc}` : ``) +
    (d.partePagoEquipo ? `\n🔁 Entrega en parte de pago: ${d.partePagoEquipo}${Number(d.partePagoValor) > 0 ? " (" + fmtPeso(Number(d.partePagoValor)) + ")" : ""}` : ``) +
    `\n\n💰 Ingreso registrado en caja.`;
}

// ============================================================
//  ENTREGAR PREVENTA
// ============================================================

function entregarPreventa() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const preSheet = ss.getSheetByName("Preventas");
  if (!preSheet) throw new Error("❌ Hoja 'Preventas' no encontrada.");

  const fE  = 2;
  const cNP = getCol(preSheet, "N° Preventa",         fE);
  const cCL = getCol(preSheet, "Cliente",              fE);
  const cMO = getCol(preSheet, "Modelo Solicitado",    fE);
  const cPV = getCol(preSheet, "Precio Venta Pactado", fE);
  const cTC = getCol(preSheet, "Total Cobrado",        fE);
  const cSP = getCol(preSheet, "Saldo Pendiente",      fE);
  const cES = getCol(preSheet, "Estado",               fE);
  const cNC = getCol(preSheet, "N° Compra Asociada",   fE);

  const lastRow = preSheet.getLastRow();
  const opciones = [];

  // Nueva arquitectura: la preventa se cierra exclusivamente desde acá, sin
  // importar si ya se registró la compra. Se muestran todas las preventas
  // salvo las que ya están cerradas definitivamente (Entregado / Cancelado).
  if (lastRow >= fE + 1) {
    const datos = preSheet.getRange(fE + 1, 1, lastRow - fE, preSheet.getLastColumn()).getValues();
    datos.forEach(row => {
      const estado = String(row[cES - 1]);
      if (!estado) return;
      if (estado === "✅ Entregado" || estado.includes("Cancelado")) return;
      opciones.push({
        nPre:    String(row[cNP - 1]),
        cliente: String(row[cCL - 1]),
        modelo:  String(row[cMO - 1]),
        precio:  Number(row[cPV - 1]) || 0,
        cobrado: Number(row[cTC - 1]) || 0,
        saldo:   Number(row[cSP - 1]) || 0,
        nComp:   String(row[cNC - 1] || ""),
        estado:  estado
      });
    });
  }

  if (opciones.length === 0) {
    SpreadsheetApp.getUi().alert("⚠️ No hay preventas pendientes de entrega.");
    return;
  }

  const opcionesHTML = opciones.map(o =>
    `<option value="${o.nPre}" data-cliente="${o.cliente}" data-modelo="${o.modelo}" ` +
    `data-precio="${o.precio}" data-cobrado="${o.cobrado}" data-saldo="${o.saldo}" data-ncomp="${o.nComp}" ` +
    `data-estado="${o.estado}">` +
    `${o.nPre} — ${o.modelo} → ${o.cliente} [${o.estado}] (saldo: ${fmtPeso(o.saldo)})</option>`
  ).join("");

  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:18px;font-size:13px}
    label{display:block;margin-top:10px;font-weight:bold;color:#1E8449}
    input,select{width:100%;padding:7px;margin-top:3px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
    .fila4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px}
    .info{background:#EAFAF1;border-left:4px solid #1E8449;padding:10px;margin-top:12px;border-radius:4px;font-size:12px}
    .compra-box{background:#EBF5FB;border-left:4px solid #2980B9;padding:10px;margin-top:10px;border-radius:4px;display:none}
    .fila2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .saldo-box{background:#FEF9E7;border-left:4px solid #B7950B;padding:10px;margin-top:10px;border-radius:4px;display:none}
    .total{background:#D5F5E3;padding:8px;border-radius:4px;margin-top:8px;font-weight:bold}
    .btn{background:#1E8449;color:#fff;padding:10px 20px;border:none;border-radius:4px;
         cursor:pointer;margin-top:14px;width:100%;font-size:13px}
    .btn:hover{background:#196F3D}
  </style>
  <h3 style="color:#1E8449;margin:0 0 14px">📦 Entregar Preventa</h3>

  <label>Preventa a entregar:</label>
  <select id="nPre" onchange="actualizarInfo()">${opcionesHTML}</select>

  <div class="info" id="infoDiv"></div>

  <div class="compra-box" id="compraBox">
    <label style="color:#2980B9;margin:0">🛒 Esta preventa todavía no tiene compra registrada — completá los datos del equipo para crearla automáticamente:</label>
    <div class="fila2" style="margin-top:6px">
      <div>
        <label style="font-size:11px">IMEI</label>
        <input type="text" id="imeiCompra" placeholder="15 dígitos"/>
      </div>
      <div>
        <label style="font-size:11px">Costo del equipo ($)</label>
        <input type="number" id="costoCompra" value="0" min="0"/>
      </div>
    </div>
    <div class="fila2">
      <div>
        <label style="font-size:11px">Proveedor</label>
        <input type="text" id="proveedorCompra" placeholder="Ej: Juan Pérez, Particular"/>
      </div>
      <div>
        <label style="font-size:11px">Fecha de compra</label>
        <input type="date" id="fechaCompra" value="${Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd")}"/>
      </div>
    </div>
  </div>

  <div class="saldo-box" id="saldoBox" style="display:block">
    <label style="color:#B7950B;margin-top:0">⚠️ Cobrar ahora (saldo pendiente del celular + accesorios de la entrega):</label>
    <div class="fila4">
      <div><label style="font-size:11px">Efectivo</label>
        <input type="number" id="efec" value="0" min="0" oninput="calcTotal()"/></div>
      <div><label style="font-size:11px">Transferencia</label>
        <input type="number" id="transf" value="0" min="0" oninput="calcTotal()"/></div>
      <div><label style="font-size:11px">Cuotas</label>
        <input type="number" id="cuotas" value="0" min="0" oninput="calcTotal()"/></div>
      <div><label style="font-size:11px">USD (cantidad de dólares)</label>
        <input type="number" id="usd" value="0" min="0" oninput="calcTotal()"/></div>
    </div>
    <div class="total" id="totalNecesarioDiv" style="background:#FEF9E7;color:#7D6608">Total a cobrar ahora: $0</div>
    <div class="total" id="totalDiv">Total ingresado: $0</div>
    <div style="font-size:11px;color:#666;margin-top:4px" id="cotizDiv"></div>
  </div>

  <label>Fecha de entrega:</label>
  <input type="date" id="fecha" value="${Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd")}"/>

  <label>Observaciones (opcional):</label>
  <input type="text" id="obs" placeholder="Ej: entregado en local"/>

  <div style="background:#F8F9FA;border:1px solid #dee2e6;border-radius:6px;padding:12px;margin-top:10px">
    <label style="color:#1A5276;margin:0">📦 Accesorios vendidos en la entrega (opcional)</label>
    <div style="font-size:11px;color:#666;margin-top:2px">Solo completá si vendiste algo junto con el equipo. El pago se prorratea entre el saldo del celular y los accesorios.</div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-top:6px">
      <div><label style="font-size:11px">Accesorio 1</label><input type="text" id="acc1" placeholder="Ej: Cargador 20W"/></div>
      <div><label style="font-size:11px">Precio ($)</label><input type="number" id="acc1p" value="0" min="0" oninput="calcTotalNecesario()"/></div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-top:6px">
      <div><label style="font-size:11px">Accesorio 2</label><input type="text" id="acc2" placeholder="Ej: Auriculares"/></div>
      <div><label style="font-size:11px">Precio ($)</label><input type="number" id="acc2p" value="0" min="0" oninput="calcTotalNecesario()"/></div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-top:6px">
      <div><label style="font-size:11px">Accesorio 3</label><input type="text" id="acc3" placeholder="Ej: Vidrio templado"/></div>
      <div><label style="font-size:11px">Precio ($)</label><input type="number" id="acc3p" value="0" min="0" oninput="calcTotalNecesario()"/></div>
    </div>
  </div>

  <button class="btn" onclick="enviar()">✅ Confirmar entrega</button>

  <script>
  var cotizacionVenta = 0;
  google.script.run.withSuccessHandler(function(cot){
    cotizacionVenta = cot.venta;
    document.getElementById("cotizDiv").textContent =
      "Cotización USD oficial: " + fmtP(cot.venta) + " (se actualiza automáticamente)";
    calcTotal();
  }).obtenerCotizacionUSD();

  function fmtP(n){ return "$"+Number(n).toLocaleString("es-AR"); }

  function saldoActual(){
    const sel=document.getElementById("nPre");
    const opt=sel.options[sel.selectedIndex];
    return parseFloat(opt.getAttribute("data-saldo"))||0;
  }
  function sumaAccesorios(){
    const a1=parseFloat(document.getElementById("acc1p").value)||0;
    const a2=parseFloat(document.getElementById("acc2p").value)||0;
    const a3=parseFloat(document.getElementById("acc3p").value)||0;
    return a1+a2+a3;
  }
  function totalNecesario(){
    return saldoActual() + sumaAccesorios();
  }
  function calcTotalNecesario(){
    document.getElementById("totalNecesarioDiv").textContent =
      "Total a cobrar ahora: " + fmtP(totalNecesario());
  }

  function actualizarInfo(){
    const sel=document.getElementById("nPre");
    const opt=sel.options[sel.selectedIndex];
    const cliente=opt.getAttribute("data-cliente");
    const modelo=opt.getAttribute("data-modelo");
    const precio=parseFloat(opt.getAttribute("data-precio"))||0;
    const cobrado=parseFloat(opt.getAttribute("data-cobrado"))||0;
    const saldo=parseFloat(opt.getAttribute("data-saldo"))||0;
    const nComp=opt.getAttribute("data-ncomp");

    document.getElementById("infoDiv").innerHTML=
      "<b>Cliente:</b> "+cliente+"<br>"+
      "<b>Modelo:</b> "+modelo+"<br>"+
      "<b>Precio pactado:</b> $"+precio.toLocaleString("es-AR")+"<br>"+
      "<b>Ya cobrado:</b> $"+cobrado.toLocaleString("es-AR")+"<br>"+
      "<b>Saldo pendiente:</b> $"+saldo.toLocaleString("es-AR")+"<br>"+
      "<b>N° Compra asociada:</b> "+(nComp||"— sin compra registrada —");

    document.getElementById("compraBox").style.display = nComp ? "none" : "block";

    if(saldo <= 0){
      document.getElementById("efec").value=0;
      document.getElementById("transf").value=0;
      document.getElementById("cuotas").value=0;
      document.getElementById("usd").value=0;
    }
    calcTotalNecesario();
    calcTotal();
  }
  function calcTotal(){
    const ef=parseFloat(document.getElementById("efec").value)||0;
    const tr=parseFloat(document.getElementById("transf").value)||0;
    const cu=parseFloat(document.getElementById("cuotas").value)||0;
    const us=parseFloat(document.getElementById("usd").value)||0;
    const usPesos = us * cotizacionVenta;
    const t = ef + tr + cu + usPesos;
    let txt = "Total ingresado: " + fmtP(t);
    if(us > 0){
      txt += " (incluye " + us + " USD ≈ " + fmtP(usPesos) + ")";
    }
    document.getElementById("totalDiv").textContent = txt;
  }
  function enviar(){
    const sel=document.getElementById("nPre");
    const nPre=sel.value;
    if(!nPre){alert("❌ Seleccioná una preventa.");return;}

    const opt=sel.options[sel.selectedIndex];
    const nComp=opt.getAttribute("data-ncomp");
    let imeiCompra="", costoCompra=0, proveedorCompra="", fechaCompra="";
    if(!nComp){
      imeiCompra=document.getElementById("imeiCompra").value.trim();
      costoCompra=parseFloat(document.getElementById("costoCompra").value)||0;
      proveedorCompra=document.getElementById("proveedorCompra").value.trim();
      fechaCompra=document.getElementById("fechaCompra").value;
      if(costoCompra<=0){alert("❌ Esta preventa no tiene compra registrada: ingresá el costo del equipo.");return;}
      if(!proveedorCompra){alert("❌ Ingresá el proveedor del equipo.");return;}
    }

    const saldo=saldoActual();
    const necesario=totalNecesario();
    const ef=parseFloat(document.getElementById("efec").value)||0;
    const tr=parseFloat(document.getElementById("transf").value)||0;
    const cu=parseFloat(document.getElementById("cuotas").value)||0;
    const us=parseFloat(document.getElementById("usd").value)||0;
    const usPesos = us * cotizacionVenta;
    const totalCobrarAhora=ef+tr+cu+usPesos;

    if(necesario > 0 && totalCobrarAhora <= 0){
      if(!confirm("⚠️ Corresponde cobrar $"+necesario.toLocaleString("es-AR")+" (saldo + accesorios) y no ingresaste ningún cobro.\\n¿Confirmás entregar de todas formas (quedará como deuda)?")) return;
    }
    if(totalCobrarAhora > necesario + 1){
      alert("❌ Lo que estás cobrando ahora ("+fmtP(totalCobrarAhora)+") supera el total a cobrar ("+fmtP(necesario)+" = saldo "+fmtP(saldo)+" + accesorios).");
      return;
    }

    if(!confirm("¿Confirmás la entrega de la preventa "+nPre+"?")){return;}
    google.script.run
      .withSuccessHandler(m=>{alert(m);google.script.host.close();})
      .withFailureHandler(e=>alert("❌ "+e.message))
      .procesarEntregaPreventa({
        nPre,
        fecha:document.getElementById("fecha").value,
        efec:ef, transf:tr, cuotas:cu, usd:us,
        obs:document.getElementById("obs").value.trim(),
        imei:imeiCompra, costoEquipo:costoCompra, proveedor:proveedorCompra, fechaCompra:fechaCompra,
        accesorios:[
          {nombre:document.getElementById("acc1").value.trim(),precio:parseFloat(document.getElementById("acc1p").value)||0},
          {nombre:document.getElementById("acc2").value.trim(),precio:parseFloat(document.getElementById("acc2p").value)||0},
          {nombre:document.getElementById("acc3").value.trim(),precio:parseFloat(document.getElementById("acc3p").value)||0}
        ].filter(a=>a.nombre!=="")
      });
  }
  actualizarInfo();
  </script>
  `).setWidth(540).setHeight(880).setTitle("Entregar Preventa");
  SpreadsheetApp.getUi().showModalDialog(html,"📦 Entregar Preventa");
}

function procesarEntregaPreventa(d) {
  const cfg = getConfigCached();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();

  const preSheet     = ss.getSheetByName("Preventas");
  const ventasSheet  = ss.getSheetByName(cfg.HOJA_VENTAS  || "Ventas");
  const comprasSheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  if (!preSheet || !ventasSheet || !comprasSheet)
    throw new Error("❌ Hojas Preventas/Ventas/Compras no encontradas.");

  // Leer datos de la preventa
  const fEP  = 2;
  const cNP  = getCol(preSheet, "N° Preventa",          fEP);
  const cCL  = getCol(preSheet, "Cliente",               fEP);
  // Columna opcional: preventas creadas antes de este cambio pueden no tenerla.
  let cCUIL = -1;
  try { cCUIL = getCol(preSheet, "CUIL Cliente", fEP); } catch(e) { /* columna opcional */ }
  const cTL  = getCol(preSheet, "Teléfono",              fEP);
  const cMOS = getCol(preSheet, "Modelo Solicitado",     fEP);
  const cPV  = getCol(preSheet, "Precio Venta Pactado",  fEP);
  const cEF  = getCol(preSheet, "Cobrado Efectivo",      fEP);
  const cTR  = getCol(preSheet, "Cobrado Transferencia", fEP);
  const cCU  = getCol(preSheet, "Cobrado Cuotas",        fEP);
  const cUS  = getCol(preSheet, "Cobrado USD",           fEP);
  const cTC  = getCol(preSheet, "Total Cobrado",         fEP);
  const cSP  = getCol(preSheet, "Saldo Pendiente",       fEP);
  const cES  = getCol(preSheet, "Estado",                fEP);
  const cNC  = getCol(preSheet, "N° Compra Asociada",    fEP);
  const cNV  = getCol(preSheet, "N° Venta Asociada",     fEP);
  const cOB  = getCol(preSheet, "Observaciones",         fEP);

  const lastPre = preSheet.getLastRow();
  let filaPreSh = -1;
  let datoPre   = null;

  if (lastPre > fEP) {
    const datosPre = preSheet.getRange(fEP+1, 1, lastPre-fEP, preSheet.getLastColumn()).getValues();
    datosPre.forEach((row, i) => {
      if (String(row[cNP-1]).trim() === d.nPre.trim()) {
        filaPreSh = fEP + 1 + i;
        datoPre   = row;
      }
    });
  }
  if (filaPreSh === -1) throw new Error(`❌ Preventa "${d.nPre}" no encontrada.`);

  // Nueva arquitectura: la preventa se cierra exclusivamente desde acá, sin
  // importar si ya se registró la compra o no. Se admite cualquier estado
  // salvo los que ya están cerrados definitivamente.
  const estadoPreActual = String(datoPre[cES-1]);
  if (estadoPreActual.includes("Cancelado")) {
    throw new Error(`❌ La preventa "${d.nPre}" está cancelada.`);
  }
  if (estadoPreActual === "✅ Entregado") {
    throw new Error(`❌ La preventa "${d.nPre}" ya fue entregada por completo.`);
  }

  let nCompra = String(datoPre[cNC-1]).trim();
  const cliente     = String(datoPre[cCL-1]);
  const cuilCliente = cCUIL > 0 ? String(datoPre[cCUIL-1] || "") : "";
  const telefono = String(datoPre[cTL-1]);
  const modelo   = String(datoPre[cMOS-1]);
  const precio   = Number(datoPre[cPV-1]) || 0;

  // Valores "previos" de la preventa: efectivo/transferencia/cuotas YA están
  // en pesos. usPrevioUSD es CANTIDAD DE DÓLARES (no pesos) — así quedó
  // guardado por procesarPreventa(). totalPrevio y saldoActual están en pesos.
  const efPrevio    = Number(datoPre[cEF-1]) || 0;
  const trPrevio    = Number(datoPre[cTR-1]) || 0;
  const cuPrevio    = Number(datoPre[cCU-1]) || 0;
  const usPrevioUSD = Number(datoPre[cUS-1]) || 0;
  const totalPrevio = Number(datoPre[cTC-1]) || 0;
  const saldoActual = Number(datoPre[cSP-1]) || 0;

  // Cambio 2 — flujo PREVENTA → ENTREGA sin compra previa: si la preventa
  // todavía no tiene N° Compra Asociada, se crea la compra en este mismo
  // paso con los datos mínimos que trae el formulario de entrega (IMEI,
  // costo, proveedor, fecha de compra), se vincula a la preventa, se
  // registra en Libro Diario y queda lista para venderse más abajo.
  if (!nCompra) {
    nCompra = crearCompraDesdePreventa_(comprasSheet, d, modelo, d.nPre);
    preSheet.getRange(filaPreSh, cNC).setValue(nCompra);
  }

  // === Conversión real de USD a pesos (problema 4) ===
  const cotizacion = obtenerCotizacionUSD();

  // Cobro adicional en la entrega (puede ser parcial o cero). Puede cubrir
  // el saldo pendiente del celular Y accesorios vendidos en el momento de
  // la entrega — se prorratea entre ambos (Problema 2).
  // d.usd es CANTIDAD DE DÓLARES que llega del formulario.
  const efEntrega     = Number(d.efec)   || 0;
  const trEntrega     = Number(d.transf) || 0;
  const cuEntrega     = Number(d.cuotas) || 0;
  const usEntregaUSD  = Number(d.usd)    || 0;                              // cantidad de dólares
  const usEntregaPesos = convertirUSDaPesos_(usEntregaUSD, cotizacion);     // equivalente en pesos

  const totalEntrega = efEntrega + trEntrega + cuEntrega + usEntregaPesos; // todo en pesos: saldo celular + accesorios

  const accesorios = (d.accesorios || []).filter(a => a.nombre);
  const sumAccesorios = accesorios.reduce((s, a) => s + (Number(a.precio) || 0), 0);
  const valorTotalAhora = saldoActual + sumAccesorios;

  if (totalEntrega > valorTotalAhora + 1) {
    throw new Error(`❌ Estás cobrando ${fmtPeso(totalEntrega)} pero corresponde a lo sumo ${fmtPeso(valorTotalAhora)} (saldo pendiente ${fmtPeso(saldoActual)} + accesorios ${fmtPeso(sumAccesorios)}).`);
  }

  // Prorrateo del cobro de la entrega entre "saldo del celular" y cada
  // accesorio, según su participación en valorTotalAhora.
  const itemsProrrateoEntrega = [{ valor: saldoActual }, ...accesorios.map(a => ({ valor: Number(a.precio) || 0 }))];
  const distribucionEntrega = prorratearMediosPago_(
    itemsProrrateoEntrega,
    { efec: efEntrega, transf: trEntrega, cuotas: cuEntrega, usd: usEntregaUSD },
    valorTotalAhora
  );

  // Porción del cobro de la entrega que corresponde al celular (saldo)
  const efEntregaCelular = distribucionEntrega[0].efec;
  const trEntregaCelular = distribucionEntrega[0].transf;
  const cuEntregaCelular = distribucionEntrega[0].cuotas;
  const usEntregaCelularUSD = distribucionEntrega[0].usd;
  const usEntregaCelularPesos = convertirUSDaPesos_(usEntregaCelularUSD, cotizacion);
  const totalEntregaCelular = efEntregaCelular + trEntregaCelular + cuEntregaCelular + usEntregaCelularPesos;

  // Buscar la compra asociada
  const fEC  = 2;
  const cOPc = getCol(comprasSheet, "N° OP",                       fEC);
  const cTIc = getCol(comprasSheet, "Tipo Ingreso",                 fEC);
  const cMOc = getCol(comprasSheet, "Equipo / Modelo",              fEC);
  const cIMc = getCol(comprasSheet, "IMEI",                         fEC);
  const cPCc = getCol(comprasSheet, "Precio Compra",                fEC);
  const cCOc = getCol(comprasSheet, "Precio Acordado Consignación", fEC);
  const cESc = getCol(comprasSheet, "Estado",                       fEC);

  const lastC = comprasSheet.getLastRow();
  let filaCompra = -1;
  let datoComp   = null;

  if (lastC > fEC) {
    const datosC = comprasSheet.getRange(fEC+1, 1, lastC-fEC, comprasSheet.getLastColumn()).getValues();
    datosC.forEach((row, i) => {
      if (String(row[cOPc-1]).trim() === nCompra) {
        filaCompra = fEC + 1 + i;
        datoComp   = row;
      }
    });
  }
  if (filaCompra === -1) throw new Error(`❌ Compra asociada "${nCompra}" no encontrada en Compras.`);

  const tipoOrigen  = String(datoComp[cTIc-1]);
  const modeloReal  = String(datoComp[cMOc-1]);
  const imeiReal    = String(datoComp[cIMc-1]);
  const costoEquip  = Number(datoComp[cPCc-1]) || 0;
  const consigEquip = Number(datoComp[cCOc-1]) || 0;

  // Totales finales (lo cobrado en la preventa + la PORCIÓN del cobro de la
  // entrega que corresponde al celular, una vez descontados los accesorios)
  const efFinal     = efPrevio + efEntregaCelular;
  const trFinal     = trPrevio + trEntregaCelular;
  const cuFinal     = cuPrevio + cuEntregaCelular;
  const usFinalUSD  = usPrevioUSD + usEntregaCelularUSD; // cantidad de dólares total (para mostrar en Ventas/Preventas)

  // Registrar en Ventas
  const fEV  = 2;
  // CUIL del cliente: columna nueva, autocreada si la hoja todavía no la
  // tiene (mismo mecanismo que asegurarColumnaGenerica_() usa para OPERADOR
  // en operadores.gs) para no exigir que alguien edite la planilla a mano.
  asegurarColumnaGenerica_(ventasSheet, fEV, "CUIL Cliente");
  const vNV  = getCol(ventasSheet, "N° Venta",             fEV);
  const vFV  = getCol(ventasSheet, "Fecha Venta",           fEV);
  const vNOP = getCol(ventasSheet, "N° OP Compra",          fEV);
  const vTO  = getCol(ventasSheet, "Tipo Origen",           fEV);
  const vMO  = getCol(ventasSheet, "Modelo",                fEV);
  const vIM  = getCol(ventasSheet, "IMEI",                  fEV);
  const vCL  = getCol(ventasSheet, "Cliente",               fEV);
  const vCUIL = getCol(ventasSheet, "CUIL Cliente",         fEV);
  const vTL  = getCol(ventasSheet, "Teléfono Cliente",      fEV);
  const vPV  = getCol(ventasSheet, "Precio Venta",          fEV);
  const vEF  = getCol(ventasSheet, "Cobrado Efectivo",      fEV);
  const vTR  = getCol(ventasSheet, "Cobrado Transferencia", fEV);
  const vCU  = getCol(ventasSheet, "Cobrado Cuotas",        fEV);
  const vUS  = getCol(ventasSheet, "Cobrado USD",           fEV);
  const vTG  = getCol(ventasSheet, "Tipo Ganancia",         fEV);
  const vGN  = getCol(ventasSheet, "Ganancia Neta",         fEV);
  const vEst = getCol(ventasSheet, "Estado",                fEV);
  const vObs = getCol(ventasSheet, "Observaciones",         fEV);
  // Columnas de ganancia teórica/cobrada (opcionales, mismo criterio que en procesarVenta)
  let vGT = -1, vGC = -1;
  try { vGT = getCol(ventasSheet, "Ganancia Teórica", fEV); } catch(e) { /* columna opcional */ }
  try { vGC = getCol(ventasSheet, "Ganancia Cobrada", fEV); } catch(e) { /* columna opcional */ }
  // Cambio 3: USD convertido (opcional), igual criterio que en procesarVenta
  let vUSC = -1;
  try { vUSC = getCol(ventasSheet, "Cobrado USD Convertido", fEV); } catch(e) { /* columna opcional */ }
  let cUSC = -1;
  try { cUSC = getCol(preSheet, "Cobrado USD Convertido", fEP); } catch(e) { /* columna opcional */ }

  const tipoGanancia = tipoOrigen.includes("CONSIG") ? "Comisión" : "Ganancia directa";
  const costoBase = tipoOrigen.includes("CONSIG") ? consigEquip : costoEquip;
  const gananciaTeorica = precio - costoBase; // precio pactado - costo
  const gananciaCobrada = (totalPrevio + totalEntregaCelular) - costoBase; // cobrado real del celular - costo
  const gananciaNeta = gananciaTeorica; // se mantiene igual que antes
  // Cambio 3: equivalente en pesos del total de USD del celular (previo + entrega),
  // guardado aparte de la cantidad real de dólares (vUS/cUS).
  const usFinalPesos = convertirUSDaPesos_(usFinalUSD, cotizacion);

  // Si la preventa ya tenía una venta generada (estaba en 🟢 Entregado con
  // saldo y ahora se está cobrando el resto), se actualiza esa MISMA fila
  // de Ventas en vez de crear una duplicada.
  const nVtaExistente = String(datoPre[cNV-1] || "").trim();
  let nVta;

  if (nVtaExistente) {
    nVta = nVtaExistente;
    const lastVtaRow = ventasSheet.getLastRow();
    let filaVtaExistente = -1;
    if (lastVtaRow > fEV) {
      const datosVta = ventasSheet.getRange(fEV + 1, 1, lastVtaRow - fEV, ventasSheet.getLastColumn()).getValues();
      datosVta.forEach((row, i) => {
        if (String(row[vNV-1]).trim() === nVta) filaVtaExistente = fEV + 1 + i;
      });
    }
    if (filaVtaExistente === -1) throw new Error(`❌ No se encontró la venta "${nVta}" asociada a la preventa "${d.nPre}".`);

    ventasSheet.getRange(filaVtaExistente, vEF).setValue(efFinal).setNumberFormat("$#,##0");
    ventasSheet.getRange(filaVtaExistente, vTR).setValue(trFinal).setNumberFormat("$#,##0");
    ventasSheet.getRange(filaVtaExistente, vCU).setValue(cuFinal).setNumberFormat("$#,##0");
    ventasSheet.getRange(filaVtaExistente, vUS).setValue(usFinalUSD);
    ventasSheet.getRange(filaVtaExistente, vGN).setValue(gananciaNeta).setNumberFormat("$#,##0");
    if (vGC >= 0)  ventasSheet.getRange(filaVtaExistente, vGC).setValue(gananciaCobrada).setNumberFormat("$#,##0");
    if (vUSC >= 0) ventasSheet.getRange(filaVtaExistente, vUSC).setValue(usFinalPesos).setNumberFormat("$#,##0");
    const obsVtaPrevia = String(ventasSheet.getRange(filaVtaExistente, vObs).getValue() || "");
    ventasSheet.getRange(filaVtaExistente, vObs).setValue(
      `${obsVtaPrevia} | Cobro adicional de saldo el ${d.fecha}: ${fmtPeso(totalEntregaCelular)}`
    );
  } else {
    nVta = genCorrelativo(ventasSheet, vNV, cfg.PREFIJO_VENTA || "VTA", fEV + 1);
    const filaVta = getFilaVacia(ventasSheet, vNV, fEV + 1);

    ventasSheet.getRange(filaVta, vNV).setValue(nVta);
    ventasSheet.getRange(filaVta, vFV).setValue(parseDate(d.fecha)).setNumberFormat("dd/mm/yyyy");
    ventasSheet.getRange(filaVta, vNOP).setValue(nCompra);
    ventasSheet.getRange(filaVta, vTO).setValue(tipoOrigen);
    ventasSheet.getRange(filaVta, vMO).setValue(modeloReal);
    ventasSheet.getRange(filaVta, vIM).setValue(imeiReal);
    ventasSheet.getRange(filaVta, vCL).setValue(cliente);
    ventasSheet.getRange(filaVta, vCUIL).setValue(cuilCliente);
    ventasSheet.getRange(filaVta, vTL).setValue(telefono);
    ventasSheet.getRange(filaVta, vPV).setValue(precio).setNumberFormat("$#,##0");
    ventasSheet.getRange(filaVta, vEF).setValue(efFinal).setNumberFormat("$#,##0");
    ventasSheet.getRange(filaVta, vTR).setValue(trFinal).setNumberFormat("$#,##0");
    ventasSheet.getRange(filaVta, vCU).setValue(cuFinal).setNumberFormat("$#,##0");
    // vUS guarda CANTIDAD de dólares total (no pesos) — consistente con registrarVenta/procesarPreventa
    ventasSheet.getRange(filaVta, vUS).setValue(usFinalUSD);
    ventasSheet.getRange(filaVta, vTG).setValue(tipoGanancia);
    ventasSheet.getRange(filaVta, vGN).setValue(gananciaNeta).setNumberFormat("$#,##0");
    ventasSheet.getRange(filaVta, vEst).setValue("PREVENTA ENTREGADA");
    ventasSheet.getRange(filaVta, vObs).setValue(`Preventa ${d.nPre}. ${d.obs}`);
    if (vGT >= 0) ventasSheet.getRange(filaVta, vGT).setValue(gananciaTeorica).setNumberFormat("$#,##0");
    if (vGC >= 0) ventasSheet.getRange(filaVta, vGC).setValue(gananciaCobrada).setNumberFormat("$#,##0");
    if (vUSC >= 0) ventasSheet.getRange(filaVta, vUSC).setValue(usFinalPesos).setNumberFormat("$#,##0");
    ventasSheet.getRange(filaVta, vNV, 1, ventasSheet.getLastColumn()).setBackground("#D5F5E3");
  }

  // Actualizar Compras → Vendido
  comprasSheet.getRange(filaCompra, cESc).setValue("✅ Vendido");

  // Actualizar Preventas → Entregado / Entregado con saldo, recalcular Total Cobrado y Saldo Pendiente
  // (solo con la porción del cobro de la entrega que corresponde al celular)
  const totalFinal = totalPrevio + totalEntregaCelular; // ambos en pesos
  const saldoFinal = precio - totalFinal;
  const estadoFinalPreventa = saldoFinal > 0 ? "🟢 Entregado con saldo" : "✅ Entregado";

  preSheet.getRange(filaPreSh, cEF).setValue(efFinal).setNumberFormat("$#,##0");
  preSheet.getRange(filaPreSh, cTR).setValue(trFinal).setNumberFormat("$#,##0");
  preSheet.getRange(filaPreSh, cCU).setValue(cuFinal).setNumberFormat("$#,##0");
  // cUS también guarda CANTIDAD de dólares, igual que en procesarPreventa
  preSheet.getRange(filaPreSh, cUS).setValue(usFinalUSD);
  preSheet.getRange(filaPreSh, cTC).setValue(totalFinal).setNumberFormat("$#,##0");
  preSheet.getRange(filaPreSh, cSP).setValue(saldoFinal).setNumberFormat("$#,##0");
  preSheet.getRange(filaPreSh, cES).setValue(estadoFinalPreventa);
  preSheet.getRange(filaPreSh, cNV).setValue(nVta);

  // Datos exclusivos para el Comprobante de Entrega de Preventa (recibos.gs)
  // — no participan de ningún cálculo de caja/ganancia, solo alimentan ese
  // recibo. "Seña Abonada (Preventa)" se escribe UNA sola vez (la primera
  // entrega, sea total o parcial) para no perderla si después se cobra el
  // saldo restante en una segunda entrega — totalPrevio en ese segundo
  // llamado ya incluiría el cobro de la primera entrega, no la seña real.
  const cSenaOriginal = asegurarColumnaGenerica_(preSheet, fEP, "Seña Abonada (Preventa)");
  const senaYaGuardada = preSheet.getRange(filaPreSh, cSenaOriginal).getValue();
  if (senaYaGuardada === "" || senaYaGuardada === null) {
    preSheet.getRange(filaPreSh, cSenaOriginal).setValue(totalPrevio).setNumberFormat("$#,##0");
  }
  const cFechaUltimaEntrega = asegurarColumnaGenerica_(preSheet, fEP, "Fecha Última Entrega");
  preSheet.getRange(filaPreSh, cFechaUltimaEntrega).setValue(new Date()).setNumberFormat("dd/mm/yyyy");
  if (cUSC >= 0) preSheet.getRange(filaPreSh, cUSC).setValue(usFinalPesos).setNumberFormat("$#,##0");

  // Desglose de medios en observaciones (problema 5), incluyendo conversión USD del saldo cobrado ahora
  // (solo la porción atribuida al celular; los accesorios se detallan en su propio registro)
  const detalleEntrega = [];
  if (efEntregaCelular > 0) detalleEntrega.push(`EFECTIVO: ${fmtPeso(efEntregaCelular)}`);
  if (trEntregaCelular > 0) detalleEntrega.push(`TRANSFERENCIA: ${fmtPeso(trEntregaCelular)}`);
  if (cuEntregaCelular > 0) detalleEntrega.push(`CUOTAS: ${fmtPeso(cuEntregaCelular)}`);
  if (usEntregaCelularUSD > 0) {
    detalleEntrega.push(`USD: ${usEntregaCelularUSD}`);
    detalleEntrega.push(`USD_COTIZACION: ${fmtPeso(cotizacion.venta)}`);
    detalleEntrega.push(`USD_CONVERTIDO: ${fmtPeso(usEntregaCelularPesos)}`);
  }
  const obsActual = String(datoPre[cOB-1] || "");
  const obsEntregaCompleta = [obsActual, d.obs, ...detalleEntrega].filter(Boolean).join(" | ");
  preSheet.getRange(filaPreSh, cOB).setValue(obsEntregaCompleta);
  preSheet.getRange(filaPreSh, cNP, 1, preSheet.getLastColumn())
    .setBackground(saldoFinal > 0 ? "#D4EFDF" : "#D5F5E3");

  // Actualizar Stock (solo el equipo de esta preventa)
  actualizarStock_(nCompra);

  // Registrar SOLO el cobro adicional de la entrega que corresponde al
  // celular (si lo hubo) — el resto ya ingresó en procesarPreventa() y los
  // accesorios se loguean aparte en registrarAccesorioAsociado_(). Cambio 3:
  // la caja debe conservar los DÓLARES REALES — el medio "USD" se loguea con
  // monto = usEntregaCelularUSD (cantidad de dólares), nunca convertido.
  const mediosEntrega = [
    { medio:"Efectivo",      monto: efEntregaCelular,     esUSD: false },
    { medio:"Transferencia", monto: trEntregaCelular,     esUSD: false },
    { medio:"Cuotas",        monto: cuEntregaCelular,     esUSD: false },
    { medio:"USD",           monto: usEntregaCelularUSD,  esUSD: true  }
  ];
  mediosEntrega.forEach(m => {
    if (m.monto <= 0) return;
    libroLog({
      origen:       "PREVENTA_SALDO",
      idOperacion:  d.nPre,
      descripcion:  `Saldo entrega preventa ${d.nPre} — ${modeloReal} a ${cliente}`,
      categoria:    "PREVENTA",
      tipo:         "INGRESO",
      medio:        m.medio,
      monto:        m.monto,
      referencia:   nVta,
      observaciones: m.esUSD
        ? `${d.obs ? d.obs + " | " : ""}USD: ${usEntregaCelularUSD} | USD_COTIZACION: ${fmtPeso(cotizacion.venta)} | USD_CONVERTIDO: ${fmtPeso(usEntregaCelularPesos)}`
        : d.obs,
      registradoPor:"Martin"
    });
  });

  // Registrar accesorios en Ventas Accesorios, con su porción prorrateada
  // del cobro de la entrega (Problema 2) — no se asume que se cobraron 100% en efectivo.
  let resumenAccesorios = "";
  let tocoStockAccesoriosEntrega = false;
  if (accesorios.length > 0) {
    try {
      accesorios.forEach((acc, i) => {
        const dist = distribucionEntrega[i + 1]; // 0 es el saldo del celular
        // Mismo criterio que procesarVenta(): si el accesorio viene
        // vinculado a un producto real de "Stock Accesorios" (acc.skuId,
        // elegido con el selector), se usa su nombre/costo reales y se
        // taguea el SKU para que actualizarStockAccesorios_() lo descuente.
        const sku = acc.skuId ? _buscarSkuAccesorioPorId_(acc.skuId) : null;
        const nAcc = registrarAccesorioAsociado_({
          fecha:       d.fecha,
          vendedor:    "Martin",
          categoria:   sku ? sku.categoria : undefined,
          producto:    sku ? sku.producto : acc.nombre,
          marca:       sku ? sku.marca : "",
          modeloAcc:   sku ? sku.color : "",
          costoUnit:   sku ? sku.costoPromedio : 0,
          precio:      acc.precio || 0,
          cliente:     cliente,
          cuil:        cuilCliente,
          tel:         telefono,
          nVtaCelular: nVta,
          cobEfec:     dist.efec,
          cobTransf:   dist.transf,
          cobCuotas:   dist.cuotas,
          cobUSD:      dist.usd,
          cotizacion:  cotizacion,
          obs:         `Asociado a preventa ${d.nPre} / venta celular ${nVta}`
        });
        if (sku && nAcc) {
          _tagColumnaGenericaPorId_("Venta Accesorios", 2, "N° Venta Accesorio", nAcc, "SKU_ID", sku.skuId);
          tocoStockAccesoriosEntrega = true;
        }
      });
      resumenAccesorios = `\n📦 ${accesorios.length} accesorio/s registrado/s en Ventas Accesorios (pago prorrateado).`;
      if (tocoStockAccesoriosEntrega) actualizarStockAccesorios_();
    } catch(e) {
      resumenAccesorios = `\n⚠️ Accesorios no registrados: ${e.message}`;
    }
  }

  Logger.log("procesarEntregaPreventa: " + (Date.now() - (typeof _t0Entrega !== "undefined" ? _t0Entrega : Date.now())) + " ms");
  return `${estadoFinalPreventa === "🟢 Entregado con saldo" ? "🟢" : "✅"} Preventa entregada.\n` +
    (nVtaExistente ? `N° Venta actualizada: ${nVta}` : `N° Venta generada: ${nVta}`) +
    `\nEquipo: ${modeloReal}${imeiReal ? " — IMEI: "+imeiReal : ""}` +
    (nVtaExistente ? "" : `\nN° Compra: ${nCompra}`) +
    `\nGanancia teórica: ${fmtPeso(gananciaTeorica)}\nGanancia cobrada: ${fmtPeso(gananciaCobrada)}\nEstado preventa: ${estadoFinalPreventa}\n` +
    (totalEntregaCelular > 0
      ? `\n💰 Se registró el cobro del saldo (celular): ${fmtPeso(totalEntregaCelular)}` +
        (usEntregaCelularUSD > 0 ? ` (incluye ${usEntregaCelularUSD} USD → ${fmtPeso(usEntregaCelularPesos)} a ${fmtPeso(cotizacion.venta)})` : ``)
      : `\n💰 Sin cobro adicional del celular en la entrega.`) +
    (sumAccesorios > 0 ? `\n📦 Accesorios en la entrega: ${fmtPeso(sumAccesorios)}` : ``) +
    (saldoFinal > 0 ? `\n⚠️ Queda saldo pendiente: ${fmtPeso(saldoFinal)}` : ``) +
    resumenAccesorios;
}


// ============================================================
//  HELPERS DE PREVENTAS
// ============================================================

/**
 * crearCompraDesdePreventa_(comprasSheet, d, modelo, nPre)
 *
 * Cambio 2 (simplificación de arquitectura de preventas): permite el flujo
 * PREVENTA → ENTREGA sin haber registrado la compra previamente. Crea la
 * fila en Compras con los datos mínimos que trae el formulario de entrega
 * (d.imei, d.costoEquipo, d.proveedor, d.fechaCompra), la deja en estado
 * "🔵 Reservado Preventa" (procesarEntregaPreventa la pasa a "✅ Vendido"
 * inmediatamente después, en el mismo request) y registra el egreso en
 * Libro Diario. Devuelve el N° OP generado.
 */
function crearCompraDesdePreventa_(comprasSheet, d, modelo, nPre) {
  const fE   = 2;
  const hdrs = comprasSheet.getRange(fE, 1, 1, comprasSheet.getLastColumn()).getValues()[0];
  const idx = (n, opt) => {
    const i = hdrs.findIndex(h => String(h).trim() === n.trim());
    if (i === -1 && !opt) throw new Error(`❌ Columna "${n}" no encontrada en "Compras" (fila ${fE}).`);
    return i;
  };
  const cOP  = idx("N° OP");
  const cFI  = idx("Fecha Ingreso");
  const cTI  = idx("Tipo Ingreso");
  const cPR  = idx("Proveedor / Origen");
  const cMO  = idx("Equipo / Modelo");
  const cIM  = idx("IMEI");
  const cCO  = idx("Color");
  const cEF  = idx("Estado Físico");
  const cPC  = idx("Precio Compra");
  const cCN  = idx("Precio Acordado Consignación");
  const cFP  = idx("Forma de Pago Compra");
  const cRE  = idx("¿Necesita Reparación?");
  const cCR  = idx("Costo Reparación Estimado");
  const cPV  = idx("Precio Estimado Venta");
  const cES  = idx("Estado");
  const cOB  = idx("Observaciones");
  const cNPC = idx("N° Preventa Asociada", true); // opcional, para trazabilidad

  const cfg     = getConfigCached();
  const prefijo = cfg.PREFIJO_COMPRA || "CMP";
  const nOp     = genCorrelativo(comprasSheet, cOP + 1, prefijo, fE + 1);
  const fila    = getFilaVacia(comprasSheet, cOP + 1, fE + 1);

  const costo = Number(d.costoEquipo) || 0;
  const totalCols = hdrs.length;
  const filaData  = new Array(totalCols).fill("");
  filaData[cOP] = nOp;
  filaData[cFI] = d.fechaCompra ? parseDate(d.fechaCompra) : new Date();
  filaData[cTI] = "COMPRA";
  filaData[cPR] = d.proveedor || "";
  filaData[cMO] = modelo;
  filaData[cIM] = d.imei || "";
  filaData[cCO] = "";
  filaData[cEF] = "Bueno";
  filaData[cPC] = costo;
  filaData[cCN] = 0;
  filaData[cFP] = "Efectivo";
  filaData[cRE] = "No";
  filaData[cCR] = 0;
  filaData[cPV] = 0;
  filaData[cES] = "🔵 Reservado Preventa";
  filaData[cOB] = `Compra generada automáticamente al entregar la preventa ${nPre}`;
  if (cNPC >= 0) filaData[cNPC] = nPre;

  comprasSheet.getRange(fila, 1, 1, totalCols).setValues([filaData]);
  comprasSheet.getRange(fila, cFI + 1).setNumberFormat("dd/mm/yyyy");
  comprasSheet.getRange(fila, cPC + 1).setNumberFormat("$#,##0");
  comprasSheet.getRange(fila, cOP + 1, 1, totalCols).setBackground("#EAD9F7");

  if (costo > 0) {
    libroLog({
      origen:       "COMPRA",
      idOperacion:  nOp,
      descripcion:  `Compra COMPRA: ${modelo}${d.imei ? " IMEI:" + d.imei : ""} [generada al entregar preventa ${nPre}]`,
      categoria:    "COMPRA_EQUIPO",
      tipo:         "EGRESO",
      medio:        "Efectivo",
      monto:        costo,
      referencia:   nOp,
      observaciones:`Preventa ${nPre}`,
      registradoPor:"Martin"
    });
  }

  return nOp;
}

/** Vincula una compra a su preventa y actualiza el estado */
function vincularCompraAPreventa_(nPre, nOp) {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const preSheet = ss.getSheetByName("Preventas");
  if (!preSheet) return;

  const fE  = 2;
  const cNP = getCol(preSheet, "N° Preventa",       fE);
  const cES = getCol(preSheet, "Estado",             fE);
  const cNC = getCol(preSheet, "N° Compra Asociada", fE);

  const lastRow = preSheet.getLastRow();
  if (lastRow < fE + 1) return;

  const datos = preSheet.getRange(fE+1, 1, lastRow-fE, preSheet.getLastColumn()).getValues();
  datos.forEach((row, i) => {
    if (String(row[cNP-1]).trim() === nPre.trim()) {
      const fila = fE + 1 + i;
      preSheet.getRange(fila, cES).setValue("🟠 Comprado");
      preSheet.getRange(fila, cNC).setValue(nOp);
      preSheet.getRange(fila, cNP, 1, preSheet.getLastColumn()).setBackground("#FDEBD0");
    }
  });

  // Trazabilidad inversa: guardar también el N° Preventa en la fila de Compras
  const cfg       = getConfigCached();
  const compSheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  if (!compSheet) return;

  const fEC  = 2;
  const cOPc = getCol(compSheet, "N° OP", fEC);
  let cNPC;
  try {
    cNPC = getCol(compSheet, "N° Preventa Asociada", fEC);
  } catch (e) {
    Logger.log("⚠️ Falta columna 'N° Preventa Asociada' en Compras. Agregala para trazabilidad completa.");
    return;
  }

  const lastC = compSheet.getLastRow();
  if (lastC < fEC + 1) return;
  const datosC = compSheet.getRange(fEC+1, 1, lastC-fEC, compSheet.getLastColumn()).getValues();
  datosC.forEach((row, i) => {
    if (String(row[cOPc-1]).trim() === nOp.trim()) {
      compSheet.getRange(fEC + 1 + i, cNPC).setValue(nPre);
    }
  });
}

/** Devuelve preventas en estado 🟡 Esperando compra para el selector en registrarCompra */
function getPreventasPendientes() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const preSheet = ss.getSheetByName("Preventas");
  if (!preSheet) return [];

  const fE  = 2;
  const cNP = getCol(preSheet, "N° Preventa",      fE);
  const cCL = getCol(preSheet, "Cliente",           fE);
  const cMO = getCol(preSheet, "Modelo Solicitado", fE);
  const cES = getCol(preSheet, "Estado",            fE);
  let cEstReg = -1;
  try { cEstReg = getCol(preSheet, "ESTADO_REGISTRO", fE); } catch (e) { /* columna opcional */ }

  const lastRow = preSheet.getLastRow();
  const opciones = [];
  if (lastRow < fE + 1) return opciones;

  const datos = preSheet.getRange(fE+1, 1, lastRow-fE, preSheet.getLastColumn()).getValues();
  datos.forEach(row => {
    if (cEstReg >= 0 && String(row[cEstReg-1] || "").trim() === "ANULADO") return;
    if (String(row[cES-1]).includes("Esperando compra")) {
      opciones.push({
        value: String(row[cNP-1]),
        label: `${row[cNP-1]} — ${row[cMO-1]} → ${row[cCL-1]}`
      });
    }
  });
  return opciones;
}

// ============================================================
//  MÓDULO — VENTAS ACCESORIOS
//  Parte 1: hoja "Ventas Accesorios" con soporte completo
//  Parte 3 BIS: registro automático de accesorios desde Ventas
//
//  ENCABEZADOS REQUERIDOS EN LA HOJA (fila 2):
//  N° Venta Accesorio | Fecha Venta | Vendedor | Categoría |
//  Producto | Marca | Modelo | Cantidad | Precio Unitario |
//  Cobrado Efectivo | Cobrado Transferencia | Cobrado Cuotas |
//  Cobrado USD | Total Cobrado | Costo Unitario | Costo Total |
//  Ganancia | Cliente | Teléfono Cliente | Estado |
//  Observaciones | N° Venta Celular Asociada
// ============================================================

// ============================================================
//  PRORRATEO DE MEDIOS DE PAGO ENTRE CELULAR Y ACCESORIOS
// ============================================================

/**
 * prorratearMediosPago_(items, medios, valorTotal)
 *
 * Distribuye proporcionalmente los medios de pago de una operación (celular
 * + accesorios) entre varios ítems, según la participación del valor de cada
 * ítem sobre el valor total de la operación.
 *
 *   items:      [{ valor: number }, ...]  — en el mismo orden en que se
 *               quiere recibir el resultado (por convención, el ítem 0 es
 *               el celular y el resto son los accesorios).
 *   medios:     { efec, transf, cuotas, usd } — usd es CANTIDAD DE DÓLARES
 *               (no pesos), igual que en el resto del sistema.
 *   valorTotal: valor total de la operación (celular + accesorios), en $.
 *
 * Devuelve un array paralelo a items con { efec, transf, cuotas, usd } ya
 * redondeados. Para que la suma de cada medio coincida exactamente con el
 * monto ingresado (evitando que el redondeo "pierda" o "sobre" $1), la
 * diferencia de redondeo se ajusta en el último ítem con valor > 0.
 */
function prorratearMediosPago_(items, medios, valorTotal) {
  const claves    = ["efec", "transf", "cuotas", "usd"];
  const resultado = items.map(() => ({ efec: 0, transf: 0, cuotas: 0, usd: 0 }));
  if (!valorTotal || valorTotal <= 0) return resultado;

  claves.forEach(clave => {
    const montoClave = Number(medios[clave]) || 0;
    if (montoClave <= 0) return;

    let acumulado = 0;
    let ultimoIdxConValor = -1;
    items.forEach((item, i) => {
      const valorItem = Number(item.valor) || 0;
      if (valorItem <= 0) return;
      ultimoIdxConValor = i;
      const parte = Math.round(montoClave * (valorItem / valorTotal));
      resultado[i][clave] = parte;
      acumulado += parte;
    });

    // Ajuste de redondeo: la diferencia (si la hay) se suma/resta al último
    // ítem con valor, para que la suma prorrateada sea exacta.
    const diferencia = montoClave - acumulado;
    if (diferencia !== 0 && ultimoIdxConValor >= 0) {
      resultado[ultimoIdxConValor][clave] += diferencia;
    }
  });

  return resultado;
}


// ============================================================
//  HELPER INTERNO — registrar un accesorio en la hoja
// ============================================================

/**
 * registrarAccesorioAsociado_()
 *
 * Helper interno llamado desde procesarVenta() y procesarEntregaPreventa()
 * para cada accesorio informado en la sección "Accesorios vendidos".
 *
 * p.fecha, p.vendedor, p.producto, p.precio, p.cliente, p.tel,
 * p.nVtaCelular (trazabilidad), p.obs,
 * p.cobEfec / p.cobTransf / p.cobCuotas / p.cobUSD (cantidad de dólares) —
 * ya prorrateados por prorratearMediosPago_(), NO se asume que todo se
 * cobró en efectivo.
 * p.cotizacion (opcional): objeto {compra,venta} para no re-consultar la API.
 * p.cantidad / p.costoUnit (opcionales, default 1 / 0).
 */
function registrarAccesorioAsociado_(p) {
  Logger.log("[AUDIT_VTA_ACC] >>> ENTRADA registrarAccesorioAsociado_() | p=" + JSON.stringify(p));
  Logger.log("[AUDIT_VTA_ACC] STACK entrada registrarAccesorioAsociado_:\n" + new Error().stack);
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("[AUDIT_VTA_ACC] Hojas de la spreadsheet activa (registrarAccesorioAsociado_): " + JSON.stringify(ss.getSheets().map(s => s.getName())));
  const sheet = ss.getSheetByName("Venta Accesorios");
  Logger.log("[AUDIT_VTA_ACC] getSheetByName('Venta Accesorios') => " + (sheet ? "OK ('" + sheet.getName() + "')" : "NULL"));
  if (!sheet) {
    Logger.log("⚠️ Hoja 'Venta Accesorios' no encontrada — accesorio omitido: " + p.producto);
    Logger.log("[AUDIT_VTA_ACC] *** CORTE en registrarAccesorioAsociado_(): return por sheet NULL (return undefined) — ULTIMA LINEA ANTES DEL RETURN: guarda inicial de registrarAccesorioAsociado_(). A partir de acá NO se escribe fila, NO se llama libroLog() para esta línea.");
    return;
  }

  const fE  = 2;
  // CUIL del cliente: columna nueva, autocreada si la hoja todavía no la
  // tiene (mismo mecanismo que asegurarColumnaGenerica_() usa para OPERADOR
  // en operadores.gs) para no exigir que alguien edite la planilla a mano.
  asegurarColumnaGenerica_(sheet, fE, "CUIL Cliente");
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n, opt) => {
    const i = hdrs.findIndex(h => String(h).trim() === n.trim());
    if (i === -1 && !opt) throw new Error(`❌ Columna "${n}" no encontrada en "Venta Accesorios" (fila ${fE}).`);
    return i;
  };

  const cNV  = idx("N° Venta Accesorio");
  const cFV  = idx("Fecha Venta");
  const cVD  = idx("Vendedor");
  const cCAT = idx("Categoría");
  const cPRD = idx("Producto");
  const cMRC = idx("Marca");
  const cMOD = idx("Modelo");
  const cCNT = idx("Cantidad");
  const cPU  = idx("Precio Unitario");
  const cEF  = idx("Cobrado Efectivo");
  const cTR  = idx("Cobrado Transferencia");
  const cCU  = idx("Cobrado Cuotas");
  const cUS  = idx("Cobrado USD");
  const cTC  = idx("Total Cobrado");
  const cCU2 = idx("Costo Unitario");
  const cCT  = idx("Costo Total");
  const cGN  = idx("Ganancia");
  const cCL  = idx("Cliente");
  const cCUIL = idx("CUIL Cliente");
  const cTL  = idx("Teléfono Cliente");
  const cES  = idx("Estado");
  const cOB  = idx("Observaciones");
  const cNVC = idx("N° Venta Celular Asociada", true);
  // Cambio 3: USD convertido (opcional) — se guarda además del real (cUS)
  const cUSC = idx("Cobrado USD Convertido", true);

  const prefijo = "ACC";
  const nAcc  = genCorrelativo(sheet, cNV + 1, prefijo, fE + 1);
  const fila  = getFilaVacia(sheet, cNV + 1, fE + 1);

  const precio     = Number(p.precio) || 0;
  const cotizacion = p.cotizacion || obtenerCotizacionUSD();

  // Medios de pago YA prorrateados (nunca se asume "todo efectivo").
  const cobEfec      = Number(p.cobEfec)   || 0;
  const cobTransf    = Number(p.cobTransf) || 0;
  const cobCuotas    = Number(p.cobCuotas) || 0;
  const cobUSD       = Number(p.cobUSD)    || 0; // cantidad de dólares
  const cobUSDPesos  = convertirUSDaPesos_(cobUSD, cotizacion);
  const totalCobrado = cobEfec + cobTransf + cobCuotas + cobUSDPesos;

  const cantidad = Number(p.cantidad)  || 1;
  const costoU   = Number(p.costoUnit) || 0;
  const costoT   = costoU * cantidad;
  const ganancia = totalCobrado - costoT;

  const detalleMedios = [];
  if (cobEfec   > 0) detalleMedios.push(`EFECTIVO: ${fmtPeso(cobEfec)}`);
  if (cobTransf > 0) detalleMedios.push(`TRANSFERENCIA: ${fmtPeso(cobTransf)}`);
  if (cobCuotas > 0) detalleMedios.push(`CUOTAS: ${fmtPeso(cobCuotas)}`);
  if (cobUSD    > 0) detalleMedios.push(`USD: ${cobUSD} → ${fmtPeso(cobUSDPesos)}`);
  const obsFinal = detalleMedios.length > 0
    ? `${p.obs ? p.obs + " | " : ""}${detalleMedios.join(" | ")}`
    : (p.obs || "");

  const totalCols = hdrs.length;
  const filaData  = new Array(totalCols).fill("");
  filaData[cNV]  = nAcc;
  filaData[cFV]  = parseDate(p.fecha);
  filaData[cVD]  = p.vendedor  || "";
  filaData[cCAT] = p.categoria || "Venta asociada a celular";
  filaData[cPRD] = p.producto  || "";
  filaData[cMRC] = p.marca     || "";
  filaData[cMOD] = p.modeloAcc || "";
  filaData[cCNT] = cantidad;
  filaData[cPU]  = precio;
  filaData[cEF]  = cobEfec;
  filaData[cTR]  = cobTransf;
  filaData[cCU]  = cobCuotas;
  filaData[cUS]  = cobUSD;
  filaData[cTC]  = totalCobrado;
  filaData[cCU2] = costoU;
  filaData[cCT]  = costoT;
  filaData[cGN]  = ganancia;
  filaData[cCL]  = p.cliente || "";
  filaData[cCUIL] = p.cuil   || "";
  filaData[cTL]  = p.tel     || "";
  filaData[cES]  = "PROCESADA";
  filaData[cOB]  = obsFinal;
  if (cNVC >= 0) filaData[cNVC] = p.nVtaCelular || "";
  if (cUSC >= 0) filaData[cUSC] = cobUSDPesos;

  Logger.log("[AUDIT_VTA_ACC] >>> ANTES escritura Venta Accesorios | fila=" + fila + " nAcc=" + nAcc);
  sheet.getRange(fila, 1, 1, totalCols).setValues([filaData]);
  Logger.log("[AUDIT_VTA_ACC] <<< DESPUES escritura Venta Accesorios | lastRow ahora=" + sheet.getLastRow());
  sheet.getRange(fila, cFV  + 1).setNumberFormat("dd/mm/yyyy");
  sheet.getRange(fila, cPU  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cEF  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cTR  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cCU  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cTC  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cCU2 + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cCT  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cGN  + 1).setNumberFormat("$#,##0");
  if (cUSC >= 0) sheet.getRange(fila, cUSC + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cNV  + 1, 1, totalCols).setBackground("#EAF2FF");

  // Registrar en Libro Diario como ingreso independiente del celular. Cambio 3:
  // un asiento por cada medio realmente usado, y la caja conserva los
  // DÓLARES REALES (monto = cobUSD, nunca convertido a pesos).
  const mediosAcc = [
    { medio:"Efectivo",      monto: cobEfec,  esUSD: false },
    { medio:"Transferencia", monto: cobTransf, esUSD: false },
    { medio:"Cuotas",        monto: cobCuotas, esUSD: false },
    { medio:"USD",           monto: cobUSD,    esUSD: true  }
  ];
  Logger.log("[AUDIT_VTA_ACC] mediosAcc=" + JSON.stringify(mediosAcc));
  mediosAcc.forEach(m => {
    if (m.monto <= 0) {
      Logger.log("[AUDIT_VTA_ACC] medio '" + m.medio + "' con monto<=0 (" + m.monto + ") => SKIP, no se llama libroLog()");
      return;
    }
    Logger.log("[AUDIT_VTA_ACC] >>> ANTES libroLog() | medio=" + m.medio + " monto=" + m.monto + " idOperacion=" + nAcc);
    libroLog({
      origen:       "VENTA_ACCESORIO",
      idOperacion:  nAcc,
      descripcion:  `Accesorio: ${p.producto}${p.nVtaCelular ? " | Celular: "+p.nVtaCelular : ""}`,
      categoria:    "VENTA_ACCESORIO",
      tipo:         "INGRESO",
      medio:        m.medio,
      monto:        m.monto,
      referencia:   p.nVtaCelular || nAcc,
      observaciones: m.esUSD
        ? `${p.obs ? p.obs + " | " : ""}USD: ${cobUSD} | USD_COTIZACION: ${fmtPeso(cotizacion.venta)} | USD_CONVERTIDO: ${fmtPeso(cobUSDPesos)}`
        : (p.obs || ""),
      registradoPor:p.vendedor || "Martin"
    });
    Logger.log("[AUDIT_VTA_ACC] <<< DESPUES libroLog() | medio=" + m.medio);
  });

  Logger.log(`Accesorio registrado: ${nAcc} — ${p.producto} — ${fmtPeso(totalCobrado)}`);
  Logger.log("[AUDIT_VTA_ACC] <<< SALIDA NORMAL registrarAccesorioAsociado_() | return nAcc=" + nAcc);
  return nAcc;
}


// ============================================================
//  REGISTRAR VENTA DE ACCESORIO (manual, independiente)
// ============================================================

function registrarVentaAccesorio() {
  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:18px;font-size:13px}
    label{display:block;margin-top:10px;font-weight:bold;color:#1A5276}
    input,select,textarea{width:100%;padding:7px;margin-top:3px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
    .fila2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .fila3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
    .fila4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px}
    .btn{background:#1A5276;color:#fff;padding:10px 20px;border:none;border-radius:4px;
         cursor:pointer;margin-top:14px;width:100%;font-size:13px}
    .btn:hover{background:#154360}
    .total{background:#D6EAF8;padding:8px;border-radius:4px;margin-top:8px;font-weight:bold;color:#1A5276}
  </style>
  <h3 style="color:#1A5276;margin:0 0 14px">🛍️ Venta de Accesorio</h3>

  <div class="fila2">
    <div>
      <label>Fecha:</label>
      <input type="date" id="fecha" value="${Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd")}"/>
    </div>
    <div>
      <label>Vendedor: *</label>
      <input type="text" id="vendedor" value="Martin" placeholder="Nombre del vendedor"/>
    </div>
  </div>

  <label>Categoría:</label>
  <select id="cat">
    <option>Cargadores</option>
    <option>Auriculares</option>
    <option>Fundas</option>
    <option>Vidrios templados</option>
    <option>Cables</option>
    <option>Accesorios varios</option>
    <option>Otros</option>
  </select>

  <div class="fila3">
    <div>
      <label>Producto: *</label>
      <input type="text" id="producto" placeholder="Ej: Cargador 20W"/>
    </div>
    <div>
      <label>Marca:</label>
      <input type="text" id="marca" placeholder="Ej: Apple"/>
    </div>
    <div>
      <label>Modelo:</label>
      <input type="text" id="modelo" placeholder="Ej: MX0J2AM"/>
    </div>
  </div>

  <div class="fila3">
    <div>
      <label>Cantidad:</label>
      <input type="number" id="cantidad" value="1" min="1"/>
    </div>
    <div>
      <label>Precio unitario ($):</label>
      <input type="number" id="precioUnit" value="0" min="0" oninput="calcTotal()"/>
    </div>
    <div>
      <label>Costo unitario ($):</label>
      <input type="number" id="costoUnit" value="0" min="0"/>
    </div>
  </div>

  <div class="fila2">
    <div>
      <label>Cliente:</label>
      <input type="text" id="cliente" placeholder="Nombre y apellido"/>
    </div>
    <div>
      <label>Teléfono:</label>
      <input type="text" id="tel" placeholder="Ej: 2914123456"/>
    </div>
  </div>

  <label>Cobrado en ($):</label>
  <div class="fila4">
    <div><label style="font-size:11px">Efectivo</label>
      <input type="number" id="efec" value="0" min="0" oninput="calcTotal()"/></div>
    <div><label style="font-size:11px">Transferencia</label>
      <input type="number" id="transf" value="0" min="0" oninput="calcTotal()"/></div>
    <div><label style="font-size:11px">Cuotas</label>
      <input type="number" id="cuotas" value="0" min="0" oninput="calcTotal()"/></div>
    <div><label style="font-size:11px">USD (dólares)</label>
      <input type="number" id="usd" value="0" min="0" oninput="calcTotal()"/></div>
  </div>
  <div class="total" id="totalDiv">Total cobrado: $0</div>
  <div style="font-size:11px;color:#666;margin-top:4px" id="cotizDiv"></div>

  <label>Observaciones:</label>
  <input type="text" id="obs" placeholder="Opcional"/>

  <button class="btn" onclick="enviar()">✅ Registrar venta</button>

  <script>
  var cotizacionVenta = 0;
  google.script.run.withSuccessHandler(function(cot){
    cotizacionVenta = cot.venta;
    document.getElementById("cotizDiv").textContent =
      "Cotización USD oficial: $" + Number(cot.venta).toLocaleString("es-AR");
    calcTotal();
  }).obtenerCotizacionUSD();

  function fmtP(n){ return "$"+Number(n).toLocaleString("es-AR"); }

  function calcTotal(){
    const qty=parseInt(document.getElementById("cantidad").value)||1;
    const pu=parseFloat(document.getElementById("precioUnit").value)||0;
    const ef=parseFloat(document.getElementById("efec").value)||0;
    const tr=parseFloat(document.getElementById("transf").value)||0;
    const cu=parseFloat(document.getElementById("cuotas").value)||0;
    const us=parseFloat(document.getElementById("usd").value)||0;
    const usPesos=us*cotizacionVenta;
    const t=ef+tr+cu+usPesos;
    let txt="Total cobrado: "+fmtP(t);
    if(us>0) txt+=" (incluye "+us+" USD ≈ "+fmtP(usPesos)+")";
    document.getElementById("totalDiv").textContent=txt;
  }
  function enviar(){
    const ef=parseFloat(document.getElementById("efec").value)||0;
    const tr=parseFloat(document.getElementById("transf").value)||0;
    const cu=parseFloat(document.getElementById("cuotas").value)||0;
    const us=parseFloat(document.getElementById("usd").value)||0;
    const usPesos=us*cotizacionVenta;
    const total=ef+tr+cu+usPesos;
    if(!document.getElementById("producto").value.trim()){alert("❌ Ingresá el producto.");return;}
    if(!document.getElementById("vendedor").value.trim()){alert("❌ Ingresá el vendedor.");return;}
    if(total<=0){alert("❌ Debe ingresar al menos un cobro.");return;}
    const d={
      fecha:document.getElementById("fecha").value,
      vendedor:document.getElementById("vendedor").value.trim(),
      categoria:document.getElementById("cat").value,
      producto:document.getElementById("producto").value.trim(),
      marca:document.getElementById("marca").value.trim(),
      modelo:document.getElementById("modelo").value.trim(),
      cantidad:parseInt(document.getElementById("cantidad").value)||1,
      precioUnit:parseFloat(document.getElementById("precioUnit").value)||0,
      costoUnit:parseFloat(document.getElementById("costoUnit").value)||0,
      cliente:document.getElementById("cliente").value.trim(),
      tel:document.getElementById("tel").value.trim(),
      efec:ef,transf:tr,cuotas:cu,usd:us,
      obs:document.getElementById("obs").value.trim()
    };
    google.script.run
      .withSuccessHandler(m=>{alert(m);google.script.host.close();})
      .withFailureHandler(e=>alert("❌ "+e.message))
      .procesarVentaAccesorio(d);
  }
  </script>
  `).setWidth(540).setHeight(860).setTitle("Venta de Accesorio");
  SpreadsheetApp.getUi().showModalDialog(html,"🛍️ Venta de Accesorio");
}


// ============================================================
//  PROCESAR VENTA DE ACCESORIO (manual)
// ============================================================

function procesarVentaAccesorio(d) {
  const t0  = Date.now();
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Venta Accesorios");
  if (!sheet) throw new Error("❌ Hoja 'Venta Accesorios' no encontrada.");

  const fE  = 2;
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n, opt) => {
    const i = hdrs.findIndex(h => String(h).trim() === n.trim());
    if (i === -1 && !opt) throw new Error(`❌ Columna "${n}" no encontrada en "Venta Accesorios" (fila ${fE}).`);
    return i;
  };

  const cNV  = idx("N° Venta Accesorio");
  const cFV  = idx("Fecha Venta");
  const cVD  = idx("Vendedor");
  const cCAT = idx("Categoría");
  const cPRD = idx("Producto");
  const cMRC = idx("Marca");
  const cMOD = idx("Modelo");
  const cCNT = idx("Cantidad");
  const cPU  = idx("Precio Unitario");
  const cEF  = idx("Cobrado Efectivo");
  const cTR  = idx("Cobrado Transferencia");
  const cCU  = idx("Cobrado Cuotas");
  const cUS  = idx("Cobrado USD");
  const cTC  = idx("Total Cobrado");
  const cCU2 = idx("Costo Unitario");
  const cCT  = idx("Costo Total");
  const cGN  = idx("Ganancia");
  const cCL  = idx("Cliente");
  const cTL  = idx("Teléfono Cliente");
  const cES  = idx("Estado");
  const cOB  = idx("Observaciones");
  const cNVC = idx("N° Venta Celular Asociada", true);
  // Cambio 3: USD convertido (opcional) — se guarda además del real (cUS)
  const cUSC = idx("Cobrado USD Convertido", true);

  // Conversión real de USD a pesos
  const cotizacion   = obtenerCotizacionUSD();
  const usdMontoReal = Number(d.usd) || 0;
  const usdEnPesos   = convertirUSDaPesos_(usdMontoReal, cotizacion);

  const ef = Number(d.efec)   || 0;
  const tr = Number(d.transf) || 0;
  const cu = Number(d.cuotas) || 0;
  const totalCobrado = ef + tr + cu + usdEnPesos;

  const qty      = Number(d.cantidad)  || 1;
  const precioU  = Number(d.precioUnit)|| 0;
  const costoU   = Number(d.costoUnit) || 0;
  const costoT   = costoU * qty;
  const ganancia = totalCobrado - costoT;

  const prefijo = "ACC";
  const nAcc  = genCorrelativo(sheet, cNV + 1, prefijo, fE + 1);
  const fila  = getFilaVacia(sheet, cNV + 1, fE + 1);

  const totalCols = hdrs.length;
  const filaData  = new Array(totalCols).fill("");
  filaData[cNV]  = nAcc;
  filaData[cFV]  = parseDate(d.fecha);
  filaData[cVD]  = d.vendedor  || "";
  filaData[cCAT] = d.categoria || "";
  filaData[cPRD] = d.producto  || "";
  filaData[cMRC] = d.marca     || "";
  filaData[cMOD] = d.modelo    || "";
  filaData[cCNT] = qty;
  filaData[cPU]  = precioU;
  filaData[cEF]  = ef;
  filaData[cTR]  = tr;
  filaData[cCU]  = cu;
  filaData[cUS]  = usdMontoReal; // cantidad de dólares
  filaData[cTC]  = totalCobrado;
  filaData[cCU2] = costoU;
  filaData[cCT]  = costoT;
  filaData[cGN]  = ganancia;
  filaData[cCL]  = d.cliente  || "";
  filaData[cTL]  = d.tel      || "";
  filaData[cES]  = "PROCESADA";
  filaData[cOB]  = d.obs      || "";
  if (cNVC >= 0) filaData[cNVC] = "";
  if (cUSC >= 0) filaData[cUSC] = usdEnPesos;

  sheet.getRange(fila, 1, 1, totalCols).setValues([filaData]);
  sheet.getRange(fila, cFV  + 1).setNumberFormat("dd/mm/yyyy");
  sheet.getRange(fila, cPU  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cEF  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cTR  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cCU  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cTC  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cCU2 + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cCT  + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cGN  + 1).setNumberFormat("$#,##0");
  if (cUSC >= 0) sheet.getRange(fila, cUSC + 1).setNumberFormat("$#,##0");
  sheet.getRange(fila, cNV  + 1, 1, totalCols).setBackground("#EAF2FF");

  // Registrar en Libro Diario: un asiento por medio de pago realmente usado.
  // Cambio 3: la caja conserva los DÓLARES REALES (monto = usdMontoReal),
  // la conversión sólo se informa en observaciones.
  const mediosVentaAcc = [
    { medio:"Efectivo",      monto: ef,           esUSD: false },
    { medio:"Transferencia", monto: tr,           esUSD: false },
    { medio:"Cuotas",        monto: cu,           esUSD: false },
    { medio:"USD",           monto: usdMontoReal, esUSD: true  }
  ];
  mediosVentaAcc.forEach(m => {
    if (m.monto <= 0) return;
    libroLog({
      origen:       "VENTA_ACCESORIO",
      idOperacion:  nAcc,
      descripcion:  `Accesorio: ${d.producto} x${qty} — ${d.cliente || "Sin cliente"}`,
      categoria:    "VENTA_ACCESORIO",
      tipo:         "INGRESO",
      medio:        m.medio,
      monto:        m.monto,
      referencia:   nAcc,
      observaciones: m.esUSD
        ? `${d.obs ? d.obs + " | " : ""}USD: ${usdMontoReal} | USD_COTIZACION: ${fmtPeso(cotizacion.venta)} | USD_CONVERTIDO: ${fmtPeso(usdEnPesos)}`
        : (d.obs || ""),
      registradoPor:d.vendedor || "Martin"
    });
  });

  Logger.log("procesarVentaAccesorio: " + (Date.now() - t0) + " ms");
  return `✅ Venta de accesorio registrada.\nN°: ${nAcc}\nProducto: ${d.producto} x${qty}\nTotal cobrado: ${fmtPeso(totalCobrado)}\nGanancia: ${fmtPeso(ganancia)}` +
    (usdMontoReal > 0 ? `\nUSD: ${usdMontoReal} → ${fmtPeso(usdEnPesos)} (cotización ${fmtPeso(cotizacion.venta)})` : ``);
}


// ============================================================
//  MÓDULO — ACCESORIOS: CATÁLOGO, COMPRAS, STOCK Y REGALOS AUTOMÁTICOS
//
//  Hojas nuevas requeridas (creadas manualmente antes de usar este bloque
//  — ver ENTREGABLE 2 acordado con el negocio):
//
//    CATALOGO_ACCESORIOS  (fila 2 = encabezados)
//      SKU_ID | Categoría | Producto | Marca | Color
//
//    Compras Accesorios  (fila 2 = encabezados)
//      N° Compra Accesorio | Fecha Compra | Proveedor | OPERADOR | Categoría |
//      Producto | Marca | Color | SKU_ID | Cantidad | Costo Unitario |
//      Precio Venta | Stock Mínimo | Costo Total | Observaciones | Estado
//
//    Stock Accesorios  (fila 2 = encabezados)
//      SKU_ID | Categoría | Producto | Marca | Color | Stock | Costo Unitario |
//      COSTO_PROMEDIO | Precio Venta | Stock Mínimo | UBICACION | Valor Stock |
//      Estado | Última Actualización
//
//    CONFIG_REGALOS  (fila 1 = encabezados)
//      Familia | Regala Funda | Regala Cable
//
//  NO modifica getConfig/getConfigCached/getCol/getFilaVacia/genCorrelativo/
//  libroLog/actualizarStock_. Reutiliza registrarAccesorioAsociado_() y
//  prorratearMediosPago_() (ya existentes en el módulo Ventas Accesorios de
//  arriba) para no duplicar la lógica de cobro/Libro Diario de accesorios.
// ============================================================

const CATEGORIAS_ACCESORIOS = ["Cargadores", "Auriculares", "Fundas", "Vidrios templados", "Cables", "Accesorios varios", "Otros"];

/** Busca (o crea) el SKU_ID en CATALOGO_ACCESORIOS para una combinación Categoría+Producto+Marca+Color (case-insensitive/trim). */
function resolverOCrearSkuAccesorio_(categoria, producto, marca, color) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CATALOGO_ACCESORIOS");
  if (!sheet) throw new Error("❌ Hoja 'CATALOGO_ACCESORIOS' no encontrada.");

  // Lock: sin esto, dos compras casi simultáneas del mismo producto NUEVO
  // (nunca antes cargado) pueden leer el catálogo antes de que la otra
  // escriba, y cada una crea su propio SKU duplicado para el mismo
  // producto. Mismo patrón que ya usan procesarAnularOperacion/
  // procesarRestaurarOperacion (anulaciones.gs).
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    throw new Error("❌ El catálogo de accesorios está ocupado por otra operación. Probá de nuevo en unos segundos.");
  }

  try {
    const fE = 2;
    const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idx = (n) => {
      const i = hdrs.findIndex(h => String(h).trim() === n);
      if (i === -1) throw new Error(`❌ Columna "${n}" no encontrada en "CATALOGO_ACCESORIOS" (fila ${fE}).`);
      return i;
    };
    const cSKU = idx("SKU_ID"), cCAT = idx("Categoría"), cPRD = idx("Producto"), cMRC = idx("Marca"), cCOL = idx("Color");

    const norm = (s) => String(s || "").trim().toLowerCase();
    const claveBuscada = [norm(categoria), norm(producto), norm(marca), norm(color)].join("|");

    const lastRow = sheet.getLastRow();
    if (lastRow > fE) {
      const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
      for (let i = 0; i < datos.length; i++) {
        const row = datos[i];
        const clave = [norm(row[cCAT]), norm(row[cPRD]), norm(row[cMRC]), norm(row[cCOL])].join("|");
        if (clave === claveBuscada) return String(row[cSKU]);
      }
    }

    const nSku = genCorrelativo(sheet, cSKU + 1, "SKU", fE + 1);
    const fila = getFilaVacia(sheet, cSKU + 1, fE + 1);
    const filaData = new Array(hdrs.length).fill("");
    filaData[cSKU] = nSku;
    filaData[cCAT] = categoria || "";
    filaData[cPRD] = producto  || "";
    filaData[cMRC] = marca     || "";
    filaData[cCOL] = color     || "";
    sheet.getRange(fila, 1, 1, hdrs.length).setValues([filaData]);
    return nSku;
  } finally {
    lock.releaseLock();
  }
}

/** Busca en "Stock Accesorios" el primer producto de `categoria` cuyo nombre contenga `texto` (case-insensitive). Solo lectura. */
/**
 * Normaliza texto para comparaciones tolerantes: sin acentos, sin
 * espacios/guiones/guiones bajos, minúsculas. Sin esto, "USB-C" (config)
 * vs "USB C" o "Cable Usb-C a Lightning" (como haya quedado escrito el
 * producto en el stock) no matcheaban por la diferencia de guión/espacio,
 * y el regalo automático se reportaba "sin stock" aunque sí había.
 */
function _normalizarTextoAccesorio_(s) {
  return String(s || "")
    .trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[\s\-_]+/g, "");
}

function _buscarSkuPorCategoriaYTexto_(categoria, texto) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Stock Accesorios");
  if (!sheet) return null;
  const fE = 2;
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
  const cSKU = idx("SKU_ID"), cCAT = idx("Categoría"), cPRD = idx("Producto"),
        cMRC = idx("Marca"), cCOL = idx("Color"), cSTK = idx("Stock"), cCP = idx("COSTO_PROMEDIO");
  if (cSKU === -1) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return null;

  const textoNorm = _normalizarTextoAccesorio_(texto);
  const catNorm   = _normalizarTextoAccesorio_(categoria);
  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  for (let i = 0; i < datos.length; i++) {
    const row = datos[i];
    if (_normalizarTextoAccesorio_(row[cCAT]) !== catNorm) continue;
    if (_normalizarTextoAccesorio_(row[cPRD]).indexOf(textoNorm) === -1) continue;
    return {
      skuId: row[cSKU], producto: row[cPRD], marca: row[cMRC], color: row[cCOL],
      stock: Number(row[cSTK]) || 0, costoPromedio: Number(row[cCP]) || 0
    };
  }
  return null;
}

/** Busca en "Stock Accesorios" el producto con ese SKU_ID exacto. Solo lectura — usada para vincular al stock real los accesorios que se cargan junto con la venta de un celular (antes quedaban en texto libre, sin descontar stock). */
function _buscarSkuAccesorioPorId_(skuId) {
  const id = String(skuId || "").trim();
  if (!id) return null;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Stock Accesorios");
  if (!sheet) return null;
  const fE = 2;
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
  const cSKU = idx("SKU_ID"), cCAT = idx("Categoría"), cPRD = idx("Producto"),
        cMRC = idx("Marca"), cCOL = idx("Color"), cSTK = idx("Stock"), cCP = idx("COSTO_PROMEDIO");
  if (cSKU === -1) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return null;

  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  for (let i = 0; i < datos.length; i++) {
    const row = datos[i];
    if (String(row[cSKU] || "").trim() !== id) continue;
    return {
      skuId: row[cSKU], categoria: row[cCAT], producto: row[cPRD], marca: row[cMRC], color: row[cCOL],
      stock: Number(row[cSTK]) || 0, costoPromedio: Number(row[cCP]) || 0
    };
  }
  return null;
}

/** Lee "Equipo / Modelo" de Compras a partir de un N° OP. Solo lectura — usada por los regalos automáticos para saber qué equipo se vendió. */
function _obtenerModeloDeCompra_(nOp) {
  if (!nOp) return "";
  const cfg   = getConfigCached();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  if (!sheet) return "";
  const fE = 2;
  const colOP = getCol(sheet, "N° OP", fE);
  const colMo = getCol(sheet, "Equipo / Modelo", fE);
  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return "";
  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  for (let i = 0; i < datos.length; i++) {
    if (String(datos[i][colOP - 1]).trim() === String(nOp).trim()) return String(datos[i][colMo - 1] || "");
  }
  return "";
}

/** Lee "Modelo Solicitado" de Preventas a partir de un N° Preventa. Solo lectura — usada por los regalos automáticos en la entrega de preventa (que no recibe N° OP en el payload). */
function _obtenerModeloDePreventa_(nPre) {
  if (!nPre) return "";
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Preventas");
  if (!sheet) return "";
  const fE = 2;
  const colNP = getCol(sheet, "N° Preventa", fE);
  const colMo = getCol(sheet, "Modelo Solicitado", fE);
  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return "";
  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  for (let i = 0; i < datos.length; i++) {
    if (String(datos[i][colNP - 1]).trim() === String(nPre).trim()) return String(datos[i][colMo - 1] || "");
  }
  return "";
}

/**
 * Recalcula por completo "Stock Accesorios" a partir de CATALOGO_ACCESORIOS
 * (identidad) + Compras Accesorios activas (entradas) + Ventas Accesorios
 * activas (salidas). Preserva UBICACION, único campo de mantenimiento manual
 * de esta hoja (nadie más lo escribe) — se lee antes de limpiar y se vuelve
 * a aplicar después de reconstruir, igual criterio que actualizarStock_()
 * pero indexado por SKU en vez de por N° OP.
 */
function actualizarStockAccesorios_() {
  const t0 = Date.now();
  Logger.log("[AUDIT] >>> ENTRADA actualizarStockAccesorios_()");
  Logger.log("[AUDIT] STACK entrada actualizarStockAccesorios_:\n" + new Error().stack);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("[AUDIT] Hojas de la spreadsheet activa: " + JSON.stringify(ss.getSheets().map(s => s.getName())));
  const catSh   = ss.getSheetByName("CATALOGO_ACCESORIOS");
  const compSh  = ss.getSheetByName("Compras Accesorios");
  const ventSh  = ss.getSheetByName("Venta Accesorios");
  const stockSh = ss.getSheetByName("Stock Accesorios");
  Logger.log("[AUDIT] getSheetByName('CATALOGO_ACCESORIOS') => " + (catSh ? "OK" : "NULL"));
  Logger.log("[AUDIT] getSheetByName('Compras Accesorios') => " + (compSh ? "OK" : "NULL"));
  Logger.log("[AUDIT] getSheetByName('Venta Accesorios') => " + (ventSh ? "OK" : "NULL"));
  Logger.log("[AUDIT] getSheetByName('Stock Accesorios') => " + (stockSh ? "OK" : "NULL"));
  Logger.log("[AUDIT_VTA_ACC] >>> ENTRADA actualizarStockAccesorios_() (llamada desde flujo de venta)");
  Logger.log("[AUDIT_VTA_ACC] STACK entrada actualizarStockAccesorios_:\n" + new Error().stack);
  Logger.log("[AUDIT_VTA_ACC] Hojas de la spreadsheet activa: " + JSON.stringify(ss.getSheets().map(s => s.getName())));
  Logger.log("[AUDIT_VTA_ACC] getSheetByName('CATALOGO_ACCESORIOS')=" + (catSh?"OK":"NULL") + " | getSheetByName('Venta Accesorios')=" + (ventSh?"OK":"NULL") + " | getSheetByName('Stock Accesorios')=" + (stockSh?"OK":"NULL"));
  if (!catSh || !stockSh) {
    Logger.log("[AUDIT] *** CORTE: return en guarda (!catSh || !stockSh) — catSh=" + !!catSh + " stockSh=" + !!stockSh + " — ULTIMA LINEA ANTES DEL RETURN: Code.gs guarda inicial de actualizarStockAccesorios_()");
    Logger.log("[AUDIT_VTA_ACC] *** CORTE en actualizarStockAccesorios_(): return en guarda inicial (!catSh || !stockSh) — catSh=" + !!catSh + " stockSh=" + !!stockSh);
    return;
  }

  const fE = 2;
  const hdrsCat = catSh.getRange(fE, 1, 1, catSh.getLastColumn()).getValues()[0];
  const idxCat = (n) => hdrsCat.findIndex(h => String(h).trim() === n);
  const ccSKU = idxCat("SKU_ID"), ccCAT = idxCat("Categoría"), ccPRD = idxCat("Producto"),
        ccMRC = idxCat("Marca"), ccCOL = idxCat("Color");

  const catalogo = {};
  const lastCat = catSh.getLastRow();
  Logger.log("[AUDIT] CATALOGO_ACCESORIOS.getLastRow()=" + lastCat + " (fE=" + fE + ") => filas de catálogo a leer=" + Math.max(0, lastCat - fE));
  if (lastCat > fE) {
    catSh.getRange(fE + 1, 1, lastCat - fE, catSh.getLastColumn()).getValues().forEach(row => {
      const sku = String(row[ccSKU] || "").trim();
      if (!sku) return;
      catalogo[sku] = { categoria: row[ccCAT], producto: row[ccPRD], marca: row[ccMRC], color: row[ccCOL] };
    });
  }
  Logger.log("[AUDIT] catalogo generado: " + Object.keys(catalogo).length + " productos => " + JSON.stringify(Object.keys(catalogo)));
  Logger.log("[AUDIT_VTA_ACC] filas leídas de CATALOGO_ACCESORIOS=" + Math.max(0, lastCat - fE) + " | productos generados en catalogo{}=" + Object.keys(catalogo).length);

  const acumEntradas = {};
  Object.keys(catalogo).forEach(sku => acumEntradas[sku] = { cantidad: 0, costoTotal: 0, ultimoCosto: 0, ultimoPrecio: 0, ultimoMinimo: 0, ultimaFecha: 0 });

  if (compSh) {
    const hdrsC = compSh.getRange(fE, 1, 1, compSh.getLastColumn()).getValues()[0];
    const idxC = (n) => hdrsC.findIndex(h => String(h).trim() === n);
    const cSKU = idxC("SKU_ID"), cCANT = idxC("Cantidad"), cCU = idxC("Costo Unitario"),
          cPV = idxC("Precio Venta"), cSM = idxC("Stock Mínimo"), cFEC = idxC("Fecha Compra"),
          cEstReg = idxC("ESTADO_REGISTRO");
    const lastC = compSh.getLastRow();
    if (lastC > fE && cSKU >= 0) {
      compSh.getRange(fE + 1, 1, lastC - fE, compSh.getLastColumn()).getValues().forEach(row => {
        if (cEstReg >= 0 && String(row[cEstReg] || "").trim() === "ANULADO") return;
        const sku = String(row[cSKU] || "").trim();
        if (!sku) return;
        if (!acumEntradas[sku]) acumEntradas[sku] = { cantidad: 0, costoTotal: 0, ultimoCosto: 0, ultimoPrecio: 0, ultimoMinimo: 0, ultimaFecha: 0 };
        const cant  = Number(row[cCANT]) || 0;
        const cu    = Number(row[cCU])   || 0;
        const fecha = row[cFEC] instanceof Date ? row[cFEC].getTime() : 0;
        acumEntradas[sku].cantidad   += cant;
        acumEntradas[sku].costoTotal += cant * cu;
        if (fecha >= acumEntradas[sku].ultimaFecha) {
          acumEntradas[sku].ultimoCosto  = cu;
          acumEntradas[sku].ultimoPrecio = Number(row[cPV]) || 0;
          acumEntradas[sku].ultimoMinimo = Number(row[cSM]) || 0;
          acumEntradas[sku].ultimaFecha  = fecha;
        }
      });
    }
  }

  const salidas = {};
  if (ventSh) {
    const hdrsV = ventSh.getRange(fE, 1, 1, ventSh.getLastColumn()).getValues()[0];
    const idxV = (n) => hdrsV.findIndex(h => String(h).trim() === n);
    const vSKU = idxV("SKU_ID"), vCANT = idxV("Cantidad"), vEstReg = idxV("ESTADO_REGISTRO");
    if (vSKU >= 0) {
      const lastV = ventSh.getLastRow();
      if (lastV > fE) {
        ventSh.getRange(fE + 1, 1, lastV - fE, ventSh.getLastColumn()).getValues().forEach(row => {
          if (vEstReg >= 0 && String(row[vEstReg] || "").trim() === "ANULADO") return;
          const sku = String(row[vSKU] || "").trim();
          if (!sku) return;
          salidas[sku] = (salidas[sku] || 0) + (Number(row[vCANT]) || 0);
        });
      }
    }
  }

  const fES = 2;
  const hdrsStock = stockSh.getRange(fES, 1, 1, stockSh.getLastColumn()).getValues()[0];
  const idxStock = (n) => {
    const i = hdrsStock.findIndex(h => String(h).trim() === n);
    if (i === -1) throw new Error(`❌ Columna "${n}" no encontrada en "Stock Accesorios" (fila ${fES}).`);
    return i;
  };
  const sSKU = idxStock("SKU_ID"), sCAT = idxStock("Categoría"), sPRD = idxStock("Producto"),
        sMRC = idxStock("Marca"), sCOL = idxStock("Color"), sSTK = idxStock("Stock"),
        sCU  = idxStock("Costo Unitario"), sCP = idxStock("COSTO_PROMEDIO"), sPV = idxStock("Precio Venta"),
        sSM  = idxStock("Stock Mínimo"), sUBI = idxStock("UBICACION"), sVS = idxStock("Valor Stock"),
        sEST = idxStock("Estado"), sACT = idxStock("Última Actualización");

  const ubicacionesPrevias = {};
  const lastStockAnterior = stockSh.getLastRow();
  if (lastStockAnterior > fES) {
    stockSh.getRange(fES + 1, 1, lastStockAnterior - fES, stockSh.getLastColumn()).getValues().forEach(row => {
      const sku = String(row[sSKU] || "").trim();
      if (sku) ubicacionesPrevias[sku] = row[sUBI];
    });
    stockSh.getRange(fES + 1, 1, lastStockAnterior - fES, stockSh.getLastColumn()).clearContent();
  }

  const ahora = new Date();
  const filas = [];
  const colores = [];
  Object.keys(catalogo).forEach(sku => {
    const info = catalogo[sku];
    const e = acumEntradas[sku] || { cantidad: 0, costoTotal: 0, ultimoCosto: 0, ultimoPrecio: 0, ultimoMinimo: 0 };
    const vendidas = salidas[sku] || 0;
    const stockActual   = e.cantidad - vendidas;
    const costoPromedio = e.cantidad > 0 ? (e.costoTotal / e.cantidad) : 0;
    const valorStock     = Math.max(0, stockActual) * costoPromedio;
    const estado = stockActual <= 0 ? "🔴 Sin stock" : (stockActual <= e.ultimoMinimo ? "🟡 Bajo stock" : "🟢 OK");

    const fila = new Array(hdrsStock.length).fill("");
    fila[sSKU] = sku;
    fila[sCAT] = info.categoria;
    fila[sPRD] = info.producto;
    fila[sMRC] = info.marca;
    fila[sCOL] = info.color;
    fila[sSTK] = stockActual;
    fila[sCU]  = e.ultimoCosto;
    fila[sCP]  = Math.round(costoPromedio);
    fila[sPV]  = e.ultimoPrecio;
    fila[sSM]  = e.ultimoMinimo;
    fila[sUBI] = ubicacionesPrevias[sku] || "";
    fila[sVS]  = Math.round(valorStock);
    fila[sEST] = estado;
    fila[sACT] = ahora;
    filas.push(fila);
    colores.push(estado === "🔴 Sin stock" ? "#F9EBEA" : estado === "🟡 Bajo stock" ? "#FDEBD0" : "#EAFAF1");
  });

  Logger.log("[AUDIT] filas a escribir en Stock Accesorios: " + filas.length);
  Logger.log("[AUDIT] entra a if(filas.length>0)? => " + (filas.length > 0));
  Logger.log("[AUDIT_VTA_ACC] filas generadas a escribir en Stock Accesorios=" + filas.length + " | entra a if(filas.length>0)? => " + (filas.length > 0));
  if (filas.length > 0) {
    stockSh.getRange(fES + 1, 1, filas.length, hdrsStock.length).setValues(filas);
    stockSh.getRange(fES + 1, sCU  + 1, filas.length, 1).setNumberFormat("$#,##0");
    stockSh.getRange(fES + 1, sCP  + 1, filas.length, 1).setNumberFormat("$#,##0");
    stockSh.getRange(fES + 1, sPV  + 1, filas.length, 1).setNumberFormat("$#,##0");
    stockSh.getRange(fES + 1, sVS  + 1, filas.length, 1).setNumberFormat("$#,##0");
    stockSh.getRange(fES + 1, sACT + 1, filas.length, 1).setNumberFormat("dd/mm/yyyy hh:mm:ss");
    for (let i = 0; i < filas.length; i++) {
      stockSh.getRange(fES + 1 + i, 1, 1, hdrsStock.length).setBackground(colores[i]);
    }
    Logger.log("[AUDIT] escritura en Stock Accesorios COMPLETADA | filas escritas=" + filas.length);
    Logger.log("[AUDIT_VTA_ACC] escritura en Stock Accesorios COMPLETADA | filas escritas=" + filas.length);
  } else {
    Logger.log("[AUDIT] *** filas.length === 0 => NO se escribe nada en Stock Accesorios (rama else del if) ***");
    Logger.log("[AUDIT_VTA_ACC] *** filas.length === 0 => NO se escribe nada en Stock Accesorios ***");
  }

  Logger.log("[AUDIT] <<< SALIDA NORMAL actualizarStockAccesorios_() (fin de función, sin return anticipado) — ULTIMA LINEA ANTES DE TERMINAR: cierre de función");
  Logger.log("[AUDIT_VTA_ACC] <<< SALIDA NORMAL actualizarStockAccesorios_()");
  Logger.log("actualizarStockAccesorios_: " + (Date.now() - t0) + " ms");
}

/** Wrapper manual (menú) para actualizarStockAccesorios_(). */
function actualizarStockAccesoriosManual() {
  actualizarStockAccesorios_();
  SpreadsheetApp.getUi().alert("✅ Stock de accesorios recalculado.");
}

// ============================================================
//  COMPRA DE ACCESORIOS
// ============================================================

/**
 * procesarCompraAccesorios(d)
 * d = { fecha, proveedor, operador, obs,
 *       pagadoEfectivo, pagadoTransferencia, pagadoUSD (cantidad de dólares),
 *       lineas: [{ categoria, producto, marca, color, cantidad, costoUnit,
 *                  precioVenta, stockMinimo }, ...] }
 *
 * Implementación específica para Compra de Accesorios: NO llama ni copia
 * procesarCompra() (protegida). Reutiliza únicamente utilidades ya
 * existentes (obtenerCotizacionUSD, convertirUSDaPesos_, fmtPeso, libroLog,
 * getFilaVacia, genCorrelativo) — mismo criterio que ya usan
 * registrarAccesorioAsociado_()/procesarVentaAccesorio() para múltiples
 * medios de pago.
 *
 * Requiere 3 columnas nuevas en "Compras Accesorios" (agregar a mano en el
 * Sheet antes de usar esta versión): "Pagado Efectivo", "Pagado
 * Transferencia", "Pagado USD".
 */
function procesarCompraAccesorios(d) {
  const t0 = Date.now();
  Logger.log("[AUDIT] >>> ENTRADA procesarCompraAccesorios() | d=" + JSON.stringify(d));
  Logger.log("[AUDIT] STACK entrada procesarCompraAccesorios:\n" + new Error().stack);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Compras Accesorios");
  Logger.log("[AUDIT] getSheetByName('Compras Accesorios') => " + (sheet ? "OK ('" + sheet.getName() + "')" : "NULL"));
  if (!sheet) throw new Error("❌ Hoja 'Compras Accesorios' no encontrada.");

  const lineas = (d.lineas || []).filter(l => l.producto);
  if (lineas.length === 0) throw new Error("❌ Agregá al menos una línea con producto.");

  const fE = 2;
  // CUIL/CUIT del proveedor: columna nueva, autocreada si la hoja todavía no
  // la tiene (mismo mecanismo que asegurarColumnaGenerica_() usa para OPERADOR
  // en operadores.gs) para no exigir que alguien edite la planilla a mano.
  asegurarColumnaGenerica_(sheet, fE, "CUIL/CUIT Proveedor");
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => {
    const i = hdrs.findIndex(h => String(h).trim() === n);
    if (i === -1) throw new Error(`❌ Columna "${n}" no encontrada en "Compras Accesorios" (fila ${fE}).`);
    return i;
  };
  const cNC = idx("N° Compra Accesorio"), cFC = idx("Fecha Compra"), cPR = idx("Proveedor"),
        cCUIL = idx("CUIL/CUIT Proveedor"),
        cOP = idx("OPERADOR"), cCAT = idx("Categoría"), cPRD = idx("Producto"), cMRC = idx("Marca"),
        cCOL = idx("Color"), cSKU = idx("SKU_ID"), cCANT = idx("Cantidad"), cCU = idx("Costo Unitario"),
        cPV = idx("Precio Venta"), cSM = idx("Stock Mínimo"), cCT = idx("Costo Total"),
        cPE = idx("Pagado Efectivo"), cPT = idx("Pagado Transferencia"), cPU = idx("Pagado USD"),
        cOBS = idx("Observaciones"), cEST = idx("Estado");

  const nCompra    = genCorrelativo(sheet, cNC + 1, "CAC", fE + 1);
  const filaInicio = getFilaVacia(sheet, cNC + 1, fE + 1);
  const fecha      = parseDate(d.fecha);

  let costoTotalCompra = 0;
  const filasBase = lineas.map(l => {
    const cantidad = Number(l.cantidad) || 0;
    if (cantidad <= 0) throw new Error(`❌ La línea "${l.producto}" necesita una cantidad mayor a 0.`);
    const costoUnit  = Number(l.costoUnit) || 0;
    // Sin este chequeo, un costo negativo (típicamente un typo con "-") pasa
    // silencioso y contamina el COSTO_PROMEDIO de ese SKU para siempre —
    // actualizarStockAccesorios_() promedia costoTotal/cantidad acumulando
    // TODAS las compras de ese producto, así que un solo error de tipeo acá
    // rompe la "Ganancia" reportada en cada venta futura de ese producto.
    if (costoUnit < 0) throw new Error(`❌ La línea "${l.producto}" tiene un costo unitario negativo.`);
    const costoTotal = cantidad * costoUnit;
    costoTotalCompra += costoTotal;
    Logger.log("[AUDIT] >>> ANTES resolverOCrearSkuAccesorio_() | categoria=" + l.categoria + " producto=" + l.producto + " marca=" + l.marca + " color=" + l.color);
    const skuId = resolverOCrearSkuAccesorio_(l.categoria, l.producto, l.marca, l.color);
    Logger.log("[AUDIT] <<< DESPUES resolverOCrearSkuAccesorio_() => skuId=" + skuId);
    return { l, cantidad, costoUnit, costoTotal, skuId };
  });

  // ---------- Pago: mismo criterio que procesarVenta()/procesarVentaAccesorio()
  // (no se copia esa lógica, se reimplementa acá con las mismas utilidades) ----------
  const cotizacion          = obtenerCotizacionUSD();
  const pagadoEfectivo      = Number(d.pagadoEfectivo)      || 0;
  const pagadoTransferencia = Number(d.pagadoTransferencia) || 0;
  const pagadoUSD           = Number(d.pagadoUSD)           || 0; // cantidad de dólares
  const pagadoUSDPesos      = convertirUSDaPesos_(pagadoUSD, cotizacion);
  const totalPagado         = pagadoEfectivo + pagadoTransferencia + pagadoUSDPesos;

  if (Math.abs(totalPagado - costoTotalCompra) > 1) {
    throw new Error(`❌ El total pagado (${fmtPeso(totalPagado)}) no coincide con el costo total de la compra (${fmtPeso(costoTotalCompra)}).`);
  }

  const filasData = filasBase.map(({ l, cantidad, costoUnit, costoTotal, skuId }) => {
    const fila = new Array(hdrs.length).fill("");
    fila[cNC]   = nCompra;
    fila[cFC]   = fecha;
    fila[cPR]   = d.proveedor || "";
    fila[cCUIL] = d.cuil      || "";
    fila[cOP]   = d.operador  || "";
    fila[cCAT]  = l.categoria || "";
    fila[cPRD]  = l.producto  || "";
    fila[cMRC]  = l.marca     || "";
    fila[cCOL]  = l.color     || "";
    fila[cSKU]  = skuId;
    fila[cCANT] = cantidad;
    fila[cCU]   = costoUnit;
    fila[cPV]   = Number(l.precioVenta) || 0;
    fila[cSM]   = Number(l.stockMinimo) || 0;
    fila[cCT]   = costoTotal;
    fila[cPE]   = pagadoEfectivo;
    fila[cPT]   = pagadoTransferencia;
    fila[cPU]   = pagadoUSD;
    fila[cOBS]  = d.obs || "";
    fila[cEST]  = "PROCESADA";
    return fila;
  });

  Logger.log("[AUDIT] >>> ANTES escritura Compras Accesorios | filaInicio=" + filaInicio + " filas=" + filasData.length);
  sheet.getRange(filaInicio, 1, filasData.length, hdrs.length).setValues(filasData);
  sheet.getRange(filaInicio, cFC + 1, filasData.length, 1).setNumberFormat("dd/mm/yyyy");
  sheet.getRange(filaInicio, cCU + 1, filasData.length, 1).setNumberFormat("$#,##0");
  sheet.getRange(filaInicio, cPV + 1, filasData.length, 1).setNumberFormat("$#,##0");
  sheet.getRange(filaInicio, cCT + 1, filasData.length, 1).setNumberFormat("$#,##0");
  sheet.getRange(filaInicio, cPE + 1, filasData.length, 1).setNumberFormat("$#,##0");
  sheet.getRange(filaInicio, cPT + 1, filasData.length, 1).setNumberFormat("$#,##0");
  sheet.getRange(filaInicio, cNC + 1, filasData.length, hdrs.length).setBackground("#EBF5FB");
  Logger.log("[AUDIT] <<< DESPUES escritura Compras Accesorios | lastRow ahora=" + sheet.getLastRow());

  Logger.log("[AUDIT] >>> ANTES actualizarStockAccesorios_()");
  actualizarStockAccesorios_();
  Logger.log("[AUDIT] <<< DESPUES actualizarStockAccesorios_()");

  // Libro Diario: un asiento por medio de pago realmente usado (igual
  // criterio que procesarVenta()/registrarAccesorioAsociado_() — nunca se
  // asume "todo efectivo"). La caja conserva los DÓLARES REALES (monto =
  // pagadoUSD), la conversión a pesos solo se informa en observaciones.
  const descripcionBase = `Compra accesorios: ${lineas.length} línea/s — ${d.proveedor || "Sin proveedor"}`;
  const mediosCompra = [
    { medio: "Efectivo",      monto: pagadoEfectivo,      esUSD: false },
    { medio: "Transferencia", monto: pagadoTransferencia, esUSD: false },
    { medio: "USD",           monto: pagadoUSD,           esUSD: true  }
  ];
  Logger.log("[AUDIT] mediosCompra=" + JSON.stringify(mediosCompra));
  mediosCompra.forEach(m => {
    if (m.monto <= 0) {
      Logger.log("[AUDIT] medio '" + m.medio + "' con monto<=0 (" + m.monto + ") => SKIP, no se llama libroLog()");
      return;
    }
    Logger.log("[AUDIT] >>> ANTES libroLog() | medio=" + m.medio + " monto=" + m.monto + " idOperacion=" + nCompra);
    libroLog({
      origen:        "COMPRA_ACCESORIO",
      idOperacion:   nCompra,
      descripcion:   descripcionBase,
      categoria:     "COMPRA_ACCESORIO",
      tipo:          "EGRESO",
      medio:         m.medio,
      monto:         m.monto,
      referencia:    nCompra,
      observaciones: m.esUSD
        ? `${d.obs ? d.obs + " | " : ""}USD: ${pagadoUSD} | USD_COTIZACION: ${fmtPeso(cotizacion.venta)} | USD_CONVERTIDO: ${fmtPeso(pagadoUSDPesos)}`
        : (d.obs || ""),
      registradoPor: d.operador || "Martin"
    });
    Logger.log("[AUDIT] <<< DESPUES libroLog() | medio=" + m.medio);
  });

  Logger.log("[AUDIT] >>> ANTES registrarAuditoria_()");
  registrarAuditoria_("COMPRA_ACCESORIO", nCompra, "ALTA", `${lineas.length} línea/s por ${fmtPeso(costoTotalCompra)}`);
  Logger.log("[AUDIT] <<< DESPUES registrarAuditoria_()");

  Logger.log("procesarCompraAccesorios: " + (Date.now() - t0) + " ms");
  return `✅ Compra de accesorios registrada.\nN°: ${nCompra}\nLíneas: ${lineas.length}\nTotal: ${fmtPeso(costoTotalCompra)}`;
}

/** Diálogo de Sheets (menú "🛍️ Accesorios") — multilínea, agregar/quitar línea. */
function registrarCompraAccesorios() {
  const html = HtmlService.createHtmlOutput(`
  <style>
    body{font-family:Arial,sans-serif;padding:16px;font-size:12.5px}
    label{display:block;margin-top:8px;font-weight:bold;color:#1A5276}
    input,select,textarea{width:100%;padding:6px;margin-top:2px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
    textarea{height:44px;resize:vertical}
    .fila2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .btn{background:#1A5276;color:#fff;padding:9px 18px;border:none;border-radius:4px;cursor:pointer;margin-top:12px;width:100%;font-size:13px}
    .btn:hover{background:#154360}
    .btn-linea{background:#2E86C1;width:auto;padding:6px 12px;font-size:12px;margin-top:6px}
    .btn-quitar{background:#C0392B;width:auto;padding:4px 10px;font-size:11px;margin-top:6px}
    .linea{border:1px solid #dee2e6;border-radius:6px;padding:10px;margin-top:10px;background:#F8F9FA}
    .linea-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px}
    .linea-grid2{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-top:6px}
    .total{background:#D5F5E3;padding:8px;border-radius:4px;margin-top:10px;font-weight:bold}
  </style>
  <h3 style="color:#1A5276;margin:0 0 12px">📦 Registrar Compra de Accesorios</h3>

  <div class="fila2">
    <div><label>Fecha:</label><input type="date" id="fecha" value="${Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd")}"/></div>
    <div><label>Operador: *</label>
      <select id="operador">
        <option value="" disabled selected>Seleccionar...</option>
        <option>Martin</option><option>Maca</option><option>Sam</option><option>Eva</option><option>Buda</option>
      </select>
    </div>
  </div>
  <label>Proveedor:</label>
  <input type="text" id="proveedor" placeholder="Ej: Distribuidora ElectroMax"/>
  <label>Observaciones:</label>
  <textarea id="obs"></textarea>

  <div id="lineas"></div>
  <button type="button" class="btn btn-linea" onclick="agregarLinea()">➕ Agregar línea</button>

  <div class="total" id="totalDiv">Costo total: $0</div>

  <label>Pagado en ($):</label>
  <div class="linea-grid2" style="grid-template-columns:1fr 1fr 1fr">
    <div><label style="font-size:11px">Efectivo</label><input type="number" id="pagEfec" value="0" min="0" oninput="calcTotal()"/></div>
    <div><label style="font-size:11px">Transferencia</label><input type="number" id="pagTransf" value="0" min="0" oninput="calcTotal()"/></div>
    <div><label style="font-size:11px">USD (dólares)</label><input type="number" id="pagUsd" value="0" min="0" oninput="calcTotal()"/></div>
  </div>
  <div class="total" id="totalPagadoDiv" style="background:#FEF9E7;color:#7D6608">Total pagado: $0</div>

  <button class="btn" onclick="enviar()">✅ Registrar compra</button>

  <script>
    var CATS = ${JSON.stringify(CATEGORIAS_ACCESORIOS)};
    var cotizacionVenta = 0;
    google.script.run.withSuccessHandler(function(cot){ cotizacionVenta = cot.venta; calcTotal(); }).obtenerCotizacionUSD();
    var contador = 0;
    function agregarLinea(){
      contador++;
      var id = contador;
      var div = document.createElement("div");
      div.className = "linea";
      div.id = "linea-" + id;
      div.innerHTML =
        '<div class="linea-grid">' +
          '<div><label style="font-size:11px">Categoría</label><select id="cat-'+id+'">' +
            CATS.map(function(c){ return '<option>'+c+'</option>'; }).join('') +
          '</select></div>' +
          '<div><label style="font-size:11px">Producto</label><input type="text" id="prod-'+id+'"/></div>' +
          '<div><label style="font-size:11px">Marca</label><input type="text" id="marca-'+id+'"/></div>' +
          '<div><label style="font-size:11px">Color</label><input type="text" id="color-'+id+'"/></div>' +
        '</div>' +
        '<div class="linea-grid2">' +
          '<div><label style="font-size:11px">Cantidad</label><input type="number" id="cant-'+id+'" value="1" min="1" oninput="calcTotal()"/></div>' +
          '<div><label style="font-size:11px">Costo unit. ($)</label><input type="number" id="costo-'+id+'" value="0" min="0" oninput="calcTotal()"/></div>' +
          '<div><label style="font-size:11px">Precio venta ($)</label><input type="number" id="precio-'+id+'" value="0" min="0"/></div>' +
          '<div><label style="font-size:11px">Stock mínimo</label><input type="number" id="min-'+id+'" value="0" min="0"/></div>' +
        '</div>' +
        '<button type="button" class="btn btn-quitar" onclick="quitarLinea('+id+')">🗑 Quitar línea</button>';
      document.getElementById("lineas").appendChild(div);
      calcTotal();
    }
    function quitarLinea(id){
      var el = document.getElementById("linea-" + id);
      if (el) el.remove();
      calcTotal();
    }
    function fmtP(n){ return "$" + Number(n||0).toLocaleString("es-AR"); }
    function leerLineas(){
      var out = [];
      document.querySelectorAll("[id^='linea-']").forEach(function(div){
        var id = div.id.split("-")[1];
        var producto = document.getElementById("prod-"+id).value.trim();
        if (!producto) return;
        out.push({
          categoria: document.getElementById("cat-"+id).value,
          producto: producto,
          marca: document.getElementById("marca-"+id).value.trim(),
          color: document.getElementById("color-"+id).value.trim(),
          cantidad: parseInt(document.getElementById("cant-"+id).value)||0,
          costoUnit: parseFloat(document.getElementById("costo-"+id).value)||0,
          precioVenta: parseFloat(document.getElementById("precio-"+id).value)||0,
          stockMinimo: parseInt(document.getElementById("min-"+id).value)||0
        });
      });
      return out;
    }
    function calcTotal(){
      var lineas = leerLineas();
      var total = lineas.reduce(function(s,l){ return s + l.cantidad*l.costoUnit; }, 0);
      document.getElementById("totalDiv").textContent = "Costo total: " + fmtP(total);

      var ef = parseFloat(document.getElementById("pagEfec").value) || 0;
      var tr = parseFloat(document.getElementById("pagTransf").value) || 0;
      var us = parseFloat(document.getElementById("pagUsd").value) || 0;
      var usPesos = us * cotizacionVenta;
      var totalPagado = ef + tr + usPesos;
      var txt = "Total pagado: " + fmtP(totalPagado);
      if (us > 0) txt += " (incluye " + us + " USD ≈ " + fmtP(usPesos) + ")";
      document.getElementById("totalPagadoDiv").textContent = txt;
    }
    function enviar(){
      var operador = document.getElementById("operador").value;
      if (!operador){ alert("❌ Seleccioná el operador."); return; }
      var lineas = leerLineas();
      if (lineas.length === 0){ alert("❌ Agregá al menos una línea con producto."); return; }
      for (var i=0;i<lineas.length;i++){
        if (lineas[i].cantidad <= 0){ alert("❌ Revisá la cantidad de: " + lineas[i].producto); return; }
      }
      var total = lineas.reduce(function(s,l){ return s + l.cantidad*l.costoUnit; }, 0);
      var ef = parseFloat(document.getElementById("pagEfec").value) || 0;
      var tr = parseFloat(document.getElementById("pagTransf").value) || 0;
      var us = parseFloat(document.getElementById("pagUsd").value) || 0;
      var usPesos = us * cotizacionVenta;
      var totalPagado = ef + tr + usPesos;
      if (Math.abs(totalPagado - total) > 1) {
        alert("❌ El total pagado (" + fmtP(totalPagado) + ") no coincide con el costo total (" + fmtP(total) + ").");
        return;
      }
      var d = {
        fecha: document.getElementById("fecha").value,
        proveedor: document.getElementById("proveedor").value.trim(),
        operador: operador,
        obs: document.getElementById("obs").value.trim(),
        lineas: lineas,
        pagadoEfectivo: ef,
        pagadoTransferencia: tr,
        pagadoUSD: us
      };
      google.script.run
        .withSuccessHandler(function(m){ alert(m); google.script.host.close(); })
        .withFailureHandler(function(e){ alert("❌ " + e.message); })
        .procesarCompraAccesoriosConOperador(d);
    }
    agregarLinea();
  </script>
  `).setWidth(560).setHeight(700).setTitle("Registrar Compra de Accesorios");
  SpreadsheetApp.getUi().showModalDialog(html, "📦 Registrar Compra de Accesorios");
}

// ============================================================
//  VENTA DE ACCESORIOS — MULTILÍNEA (Web App)
//  Complementa (no reemplaza) registrarVentaAccesorio()/procesarVentaAccesorio()
//  de arriba, que siguen intactas para el diálogo de Sheets de 1 sola línea.
// ============================================================

/**
 * _procesarVentaAccesoriosMultiLinea_(d) — núcleo interno, devuelve
 * { mensaje, numeros } para que el wrapper con operador pueda tagear cada
 * línea. d = { fecha, cliente, tel, operador, obs,
 *              medios:{efec,transf,cuotas,usd},
 *              lineas:[{ skuId, cantidad, precioUnit }] }
 */
function _procesarVentaAccesoriosMultiLinea_(d) {
  const t0 = Date.now();
  Logger.log("[AUDIT_VTA_ACC] >>> ENTRADA _procesarVentaAccesoriosMultiLinea_() | d=" + JSON.stringify(d));
  Logger.log("[AUDIT_VTA_ACC] STACK entrada _procesarVentaAccesoriosMultiLinea_:\n" + new Error().stack);
  const lineas = (d.lineas || []).filter(l => l.skuId && Number(l.cantidad) > 0);
  if (lineas.length === 0) throw new Error("❌ Agregá al menos una línea con producto y cantidad.");

  const stockSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Stock Accesorios");
  Logger.log("[AUDIT_VTA_ACC] getSheetByName('Stock Accesorios') => " + (stockSh ? "OK ('" + stockSh.getName() + "')" : "NULL"));
  if (!stockSh) throw new Error("❌ Hoja 'Stock Accesorios' no encontrada.");
  const fE = 2;
  const hdrs = stockSh.getRange(fE, 1, 1, stockSh.getLastColumn()).getValues()[0];
  const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
  const sSKU = idx("SKU_ID"), sCAT = idx("Categoría"), sPRD = idx("Producto"),
        sMRC = idx("Marca"), sCOL = idx("Color"), sSTK = idx("Stock"), sCP = idx("COSTO_PROMEDIO");

  const lastRow = stockSh.getLastRow();
  const catalogoStock = {};
  if (lastRow > fE) {
    stockSh.getRange(fE + 1, 1, lastRow - fE, stockSh.getLastColumn()).getValues().forEach(row => {
      const sku = String(row[sSKU] || "").trim();
      if (sku) catalogoStock[sku] = {
        categoria: row[sCAT], producto: row[sPRD], marca: row[sMRC], color: row[sCOL],
        stock: Number(row[sSTK]) || 0, costoPromedio: Number(row[sCP]) || 0
      };
    });
  }

  const cotizacion = obtenerCotizacionUSD();

  // Validación de stock por SKU ANTES de registrar nada — se acumula por
  // SKU (no por línea) porque la misma venta puede traer dos líneas del
  // mismo producto, y cada una individualmente podría "parecer" disponible
  // aunque combinadas superen el stock real.
  const cantidadPedidaPorSku = {};
  lineas.forEach(l => {
    const info = catalogoStock[l.skuId];
    if (!info) throw new Error(`❌ SKU "${l.skuId}" no encontrado en Stock Accesorios.`);
    cantidadPedidaPorSku[l.skuId] = (cantidadPedidaPorSku[l.skuId] || 0) + (Number(l.cantidad) || 0);
  });
  Object.keys(cantidadPedidaPorSku).forEach(skuId => {
    const info = catalogoStock[skuId];
    if (cantidadPedidaPorSku[skuId] > info.stock) {
      throw new Error(`❌ Stock insuficiente de "${info.producto}": pedís ${cantidadPedidaPorSku[skuId]} y hay ${info.stock} disponibles.`);
    }
  });

  const itemsConValor = lineas.map(l => {
    const info = catalogoStock[l.skuId];
    const cantidad   = Number(l.cantidad)   || 0;
    const precioUnit = Number(l.precioUnit) || 0;
    return { skuId: l.skuId, info: info, cantidad: cantidad, precioUnit: precioUnit, subtotal: cantidad * precioUnit };
  });

  const valorTotal = itemsConValor.reduce((s, it) => s + it.subtotal, 0);
  const medios = d.medios || {};
  const efec = Number(medios.efec) || 0, transf = Number(medios.transf) || 0,
        cuotas = Number(medios.cuotas) || 0, usd = Number(medios.usd) || 0;
  const usdPesos = convertirUSDaPesos_(usd, cotizacion);
  const totalIngresado = efec + transf + cuotas + usdPesos;

  if (valorTotal > 0 && Math.abs(totalIngresado - valorTotal) > 1) {
    throw new Error(`❌ El total cobrado (${fmtPeso(totalIngresado)}) no coincide con el total de la venta (${fmtPeso(valorTotal)}).`);
  }

  const distribucion = prorratearMediosPago_(
    itemsConValor.map(it => ({ valor: it.subtotal })),
    { efec: efec, transf: transf, cuotas: cuotas, usd: usd },
    valorTotal
  );

  const numeros = [];
  Logger.log("[AUDIT_VTA_ACC] itemsConValor.length=" + itemsConValor.length + " => " + JSON.stringify(itemsConValor));
  itemsConValor.forEach((it, i) => {
    const reparto = distribucion[i];
    Logger.log("[AUDIT_VTA_ACC] >>> ANTES registrarAccesorioAsociado_() | linea=" + i + " skuId=" + it.skuId + " reparto=" + JSON.stringify(reparto));
    const nAcc = registrarAccesorioAsociado_({
      fecha:      d.fecha,
      vendedor:   d.operador || "",
      categoria:  it.info.categoria,
      producto:   it.info.producto,
      marca:      it.info.marca,
      modeloAcc:  it.info.color,
      cantidad:   it.cantidad,
      costoUnit:  it.info.costoPromedio,
      precio:     it.precioUnit,
      cobEfec:    reparto.efec, cobTransf: reparto.transf, cobCuotas: reparto.cuotas, cobUSD: reparto.usd,
      cliente:    d.cliente, cuil: d.cuil, tel: d.tel,
      obs:        d.obs,
      cotizacion: cotizacion
    });
    Logger.log("[AUDIT_VTA_ACC] <<< DESPUES registrarAccesorioAsociado_() | linea=" + i + " => nAcc=" + nAcc);
    if (nAcc) {
      Logger.log("[AUDIT_VTA_ACC] >>> ANTES _tagColumnaGenericaPorId_() | nAcc=" + nAcc + " skuId=" + it.skuId);
      _tagColumnaGenericaPorId_("Venta Accesorios", 2, "N° Venta Accesorio", nAcc, "SKU_ID", it.skuId);
      Logger.log("[AUDIT_VTA_ACC] <<< DESPUES _tagColumnaGenericaPorId_()");
      numeros.push(nAcc);
    } else {
      Logger.log("[AUDIT_VTA_ACC] *** nAcc es falsy (linea=" + i + ") => NO se pushea a numeros[], NO se llama _tagColumnaGenericaPorId_() para esta línea ***");
    }
  });
  Logger.log("[AUDIT_VTA_ACC] numeros[] final tras el forEach: " + JSON.stringify(numeros));

  Logger.log("[AUDIT_VTA_ACC] >>> ANTES actualizarStockAccesorios_()");
  actualizarStockAccesorios_();
  Logger.log("[AUDIT_VTA_ACC] <<< DESPUES actualizarStockAccesorios_()");

  Logger.log("[AUDIT_VTA_ACC] NOTA: a partir de acá la función termina — no hay llamada a registrarAuditoria_(), actualizarReportes(), guardarBackupOperacion_(), crearTransaccion_() ni a ninguna función de 'Caja'.");
  Logger.log("_procesarVentaAccesoriosMultiLinea_: " + (Date.now() - t0) + " ms");
  const mensajeFinal = `✅ Venta de accesorios registrada.\nLíneas: ${numeros.join(", ")}\nTotal: ${fmtPeso(valorTotal)}`;
  Logger.log("[AUDIT_VTA_ACC] <<< SALIDA _procesarVentaAccesoriosMultiLinea_() | mensaje=" + mensajeFinal);
  return {
    mensaje: mensajeFinal,
    numeros: numeros
  };
}

/** Versión pública sin tageo de operador (uso directo/pruebas). La Web App usa procesarVentaAccesoriosMultiLineaConOperador (operadores.gs). */
function procesarVentaAccesoriosMultiLinea(d) {
  return _procesarVentaAccesoriosMultiLinea_(d).mensaje;
}

// ============================================================
//  REGALOS AUTOMÁTICOS (CONFIG_REGALOS)
// ============================================================

/** Determina, a partir del texto libre de "Equipo / Modelo", qué fila de CONFIG_REGALOS aplica (substring más largo que matchee, sin columna de patrón). Solo lectura. */
function determinarFamiliaYPuerto_(modelo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CONFIG_REGALOS");
  if (!sheet) return null;

  const modeloNorm = String(modelo || "").trim().toLowerCase();
  if (!modeloNorm) return null;

  const fE = 1;
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
  const cFAM = idx("Familia"), cFUN = idx("Regala Funda"), cCAB = idx("Regala Cable");
  if (cFAM === -1) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return null;

  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  let mejorMatch = null;
  datos.forEach(row => {
    const familia = String(row[cFAM] || "").trim();
    if (!familia) return;
    if (modeloNorm.indexOf(familia.toLowerCase()) === -1) return;
    if (!mejorMatch || familia.length > mejorMatch.familia.length) {
      mejorMatch = {
        familia:     familia,
        regalaFunda: String(row[cFUN] || "").trim().toUpperCase() === "SI",
        tipoCable:   String(row[cCAB] || "").trim().toUpperCase()
      };
    }
  });
  return mejorMatch;
}

/**
 * entregarRegalosAutomaticos_(nVta, modelo, cliente, vendedor, operador, entregar)
 *
 * Llamada SOLO desde wrappers de operadores.gs (nunca desde procesarVenta()
 * ni procesarEntregaPreventa(), que son protegidas) después de que la venta
 * del equipo ya quedó registrada. Si no hay stock del regalo, NO bloquea
 * nada: deja constancia en AUDITORIA y devuelve el detalle para mostrarlo
 * como advertencia en el mensaje final.
 */
function entregarRegalosAutomaticos_(nVta, modelo, cliente, vendedor, operador, entregar) {
  const resultado = { entregados: [], omitidos: [], sinModelo: false, sinConfigurar: false };
  if (entregar === false) return resultado;

  const modeloNorm = String(modelo || "").trim();
  if (!modeloNorm) {
    // Sin esto, un modelo vacío pasaba totalmente en silencio: ni se
    // entregaba nada ni se avisaba nada, así que parecía que la casilla
    // "entregar regalo" tildada no hacía nada.
    resultado.sinModelo = true;
    registrarAuditoria_("REGALO_AUTOMATICO", nVta, "SIN_MODELO",
      "No se pudo determinar el modelo vendido (N° OP/Preventa sin modelo cargado) — no se buscó regalo.");
    return resultado;
  }

  const info = determinarFamiliaYPuerto_(modeloNorm);
  if (!info) {
    // Mismo problema: si el modelo no matchea ninguna fila de CONFIG_REGALOS
    // (familia mal escrita, o directamente no configurada para ese modelo)
    // no había ningún aviso — quedaba indistinguible de "no tiene regalo
    // configurado a propósito".
    resultado.sinConfigurar = true;
    registrarAuditoria_("REGALO_AUTOMATICO", nVta, "SIN_FAMILIA_CONFIGURADA",
      `El modelo "${modeloNorm}" no matcheó ninguna familia en CONFIG_REGALOS — no se entregó regalo.`);
    return resultado;
  }

  const items = [];
  if (info.regalaFunda) items.push({ categoria: "Fundas", buscar: info.familia });
  if (info.tipoCable && info.tipoCable !== "NINGUNO") items.push({ categoria: "Cables", buscar: info.tipoCable });

  items.forEach(item => {
    const sku = _buscarSkuPorCategoriaYTexto_(item.categoria, item.buscar);
    if (!sku) {
      resultado.omitidos.push(`${item.categoria} (${item.buscar})`);
      registrarAuditoria_("REGALO_AUTOMATICO", nVta, "STOCK_INSUFICIENTE",
        `No se encontró producto de categoría "${item.categoria}" que coincida con "${item.buscar}" en Stock Accesorios.`);
      return;
    }
    if (sku.stock <= 0) {
      resultado.omitidos.push(sku.producto);
      registrarAuditoria_("REGALO_AUTOMATICO", nVta, "STOCK_INSUFICIENTE",
        `Sin stock de "${sku.producto}" (SKU ${sku.skuId}) para regalo asociado a ${nVta}.`);
      return;
    }
    const nAcc = registrarAccesorioAsociado_({
      fecha:       new Date(),
      vendedor:    vendedor || "",
      categoria:   "Regalo automático",
      producto:    sku.producto,
      marca:       sku.marca,
      modeloAcc:   sku.color,
      cantidad:    1,
      costoUnit:   sku.costoPromedio,
      precio:      0,
      cobEfec: 0, cobTransf: 0, cobCuotas: 0, cobUSD: 0,
      cliente:     cliente || "",
      tel:         "",
      nVtaCelular: nVta,
      // El texto "Asociado a venta celular <N° Venta>" es el mismo que usa
      // registrarAccesorioAsociado_() para los accesorios comprados — el
      // recibo (generarReciboVenta/generarReciboEntregaPreventa,
      // recibos.gs) lo usa como respaldo para encontrar la fila si la
      // columna "N° Venta Celular Asociada" viene vacía. Sin este texto acá,
      // ese respaldo nunca encontraba los regalos (solo los comprados).
      obs:         `Regalo automático — ${modelo} — Asociado a venta celular ${nVta}`
    });
    if (nAcc) {
      _tagColumnaGenericaPorId_("Venta Accesorios", 2, "N° Venta Accesorio", nAcc, "SKU_ID", sku.skuId);
      // Se taguea OPERADOR acá mismo (al crear la fila) porque el tageo
      // genérico de _tagOperadorPorNumero_() ya corrió antes de que este
      // regalo existiera — si no se hace acá, el regalo queda invisible
      // en Comisiones y sin operador en Mis Operaciones para siempre.
      if (operador) _tagColumnaGenericaPorId_("Venta Accesorios", 2, "N° Venta Accesorio", nAcc, "OPERADOR", operador);
    }
    resultado.entregados.push(sku.producto);
  });

  if (resultado.entregados.length > 0) actualizarStockAccesorios_();
  return resultado;
}
