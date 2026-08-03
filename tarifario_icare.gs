// ============================================================
//  TARIFARIO ICARE — actualización del tarifario de Reparaciones desde el
//  listado de precios del proveedor (CSV/TXT: Modelo | Parte | Precio |
//  Disponibilidad).
//
//  Archivo 100% NUEVO, igual criterio que operadores.gs/dias_habiles.gs:
//  no modifica Code.gs ni webapp.gs salvo por los puntos mínimos necesarios
//  para que _calcularPresupuestoReparacionCore_ lea el precio de acá en vez
//  de "descuentoToma × multiplicador" (ver webapp.gs). No toca
//  CONFIG_REPARACIONES (sigue siendo la única fuente de "Horas Estimadas"
//  y de qué categorías están "Activo"), no toca "Toma de Equipos", no crea
//  ningún módulo/vista nueva en la Web App — es un utilitario de Sheets
//  (menú "🔧 Reparaciones → Actualizar tarifario (CSV)"), mismo patrón que
//  registrarPreventa()/entregarPreventa() en Code.gs.
//
//  Hoja nueva "TARIFARIO_ICARE" (se autogenera la primera vez que se
//  importa un archivo — a diferencia de CONFIG_FERIADOS/CONFIG_REGALOS,
//  esta hoja es 100% datos derivados del archivo del proveedor, no
//  configuración de negocio a mano, así que no hace falta crearla manual):
//    Modelo | Categoría | Precio Guía | Precio Público | Actualizado
//  Cada importación reemplaza el contenido completo (no es incremental):
//  el archivo del proveedor es la fuente de verdad completa cada vez.
//
//  Precio Público = Precio Guía × 1.20, redondeado al peso. Cuando el
//  proveedor lista varias variantes para el mismo modelo+categoría (ej.
//  varios colores de "Vidrio Trasero" o varias marcas de batería), se usa
//  la MÁS CARA como Precio Guía de esa categoría — presupuesto conservador,
//  nunca por debajo del repuesto más caro disponible.
// ============================================================

const TARIFARIO_ICARE_HOJA = "TARIFARIO_ICARE";

/**
 * _categorizarParteIcare_(parteRaw)
 *
 * Mapea el texto libre de la columna "Parte" del proveedor a una de las
 * keys de REPARACIONES_ITEMS_ (webapp.gs, sin modificar). Decisiones ya
 * confirmadas:
 *   - "Vidrio Trasero" (cualquier color)      → tapa (Tapa Trasera)
 *   - "Parlante Superior"                     → parlante (Parlante)
 *   - "Cámara"/"Cámara Frontal"/"Lente"        → camara (Cámara)
 *   - "Batería" (cualquier marca)              → bateria
 *   - "Pantalla" (cualquier variante)          → pantalla
 *   - "Pin de Carga" (cualquier variante)      → pin
 *   - "Flex de Carga"                          → flex     (NUEVA)
 *   - "Botones Laterales"                      → botones  (NUEVA)
 *   - "Chasis"                                 → chasis   (NUEVA)
 * Devuelve null si no matchea nada (fila se ignora al importar, nunca
 * rompe la importación completa).
 */
function _categorizarParteIcare_(parteRaw) {
  const p = _normalizarTipoReparacion_(parteRaw); // reutiliza el normalizador de webapp.gs (sin duplicar)
  if (p.indexOf("bateria") !== -1) return "bateria";
  if (p.indexOf("pantalla") !== -1) return "pantalla";
  if (p.indexOf("camara") !== -1 || p.indexOf("lente") !== -1) return "camara";
  if (p.indexOf("microfono") !== -1) return "microfono";
  if (p.indexOf("parlante") !== -1) return "parlante";
  if (p.indexOf("vidrio trasero") !== -1) return "tapa";
  if (p.indexOf("marco") !== -1) return "marco";
  if (p.indexOf("flex de carga") !== -1) return "flex";
  if (p.indexOf("pin de carga") !== -1) return "pin";
  if (p.indexOf("boton") !== -1) return "botones";
  if (p.indexOf("chasis") !== -1) return "chasis";
  return null;
}

/**
 * importarTarifarioIcare(texto, confirmarReemplazo)
 *
 * Función pública (llamada desde el diálogo del menú vía google.script.run).
 * `texto`: contenido crudo del CSV/TXT tal cual lo sube el operador. El
 * parseo/categorización/agrupación (Utilities.parseCsv, _categorizarParteIcare_,
 * "se queda con el precio más alto") NO cambiaron — Parte 3 solo agrega una
 * validación ANTES de escribir.
 *
 * `confirmarReemplazo` (opcional, default false): si el archivo nuevo trae
 * MENOS combinaciones modelo+categoría que las que ya hay en
 * "TARIFARIO_ICARE" y todavía no se confirmó, no se escribe nada — se
 * devuelve { requiereConfirmacion: true, mensaje } para que el diálogo le
 * pregunte al operador antes de pisar un tarifario bueno con un archivo
 * incompleto. Si el operador confirma, se vuelve a llamar con
 * `confirmarReemplazo = true` y recién ahí se reemplaza.
 *
 * Agrupa por (Modelo, categoría) quedándose con el precio más alto entre
 * variantes, calcula Precio Público = Precio Guía × 1.20 (redondeado), y
 * reemplaza el contenido completo de "TARIFARIO_ICARE" (la crea si no
 * existe). Nunca toca "Toma de Equipos" ni "CONFIG_REPARACIONES".
 *
 * Devuelve { requiereConfirmacion: false, mensaje } cuando sí escribió.
 */
function importarTarifarioIcare(texto, confirmarReemplazo) {
  const contenido = String(texto || "").replace(/^﻿/, "");
  const filas = Utilities.parseCsv(contenido);
  if (!filas || filas.length < 2) throw new Error("❌ El archivo está vacío o no tiene filas de datos.");

  const hdrs = filas[0].map(h => String(h).trim());
  const cMO = hdrs.indexOf("Modelo");
  const cPA = hdrs.indexOf("Parte");
  const cPR = hdrs.indexOf("Precio");
  if (cMO === -1 || cPA === -1 || cPR === -1) {
    throw new Error('❌ El archivo debe tener las columnas "Modelo", "Parte" y "Precio". Encabezados encontrados: ' + hdrs.join(", "));
  }

  const grupos = {}; // "modelo||key" -> precio guía más alto visto
  let filasIgnoradas = 0;

  for (let i = 1; i < filas.length; i++) {
    const row = filas[i];
    const modelo = String(row[cMO] || "").trim();
    const parteTxt = String(row[cPA] || "").trim();
    const precio = Number(row[cPR]) || 0;
    if (!modelo || !parteTxt || precio <= 0) { filasIgnoradas++; continue; }

    const key = _categorizarParteIcare_(parteTxt);
    if (!key) { filasIgnoradas++; continue; }

    const claveGrupo = modelo + "||" + key;
    if (!grupos[claveGrupo] || precio > grupos[claveGrupo]) grupos[claveGrupo] = precio;
  }

  const itemsPorKey = {};
  REPARACIONES_ITEMS_.forEach(it => { itemsPorKey[it.key] = it; });
  const categoriasNuevas = { flex: true, botones: true, chasis: true };
  const categoriasNuevasVistas = {};

  const ahora = new Date();
  const filasSalida = Object.keys(grupos).map(claveGrupo => {
    const idx2 = claveGrupo.lastIndexOf("||");
    const modelo = claveGrupo.slice(0, idx2);
    const key = claveGrupo.slice(idx2 + 2);
    const precioGuia = grupos[claveGrupo];
    const precioPublico = Math.round(precioGuia * 1.20);
    const label = (itemsPorKey[key] && itemsPorKey[key].label) || key;
    if (categoriasNuevas[key]) categoriasNuevasVistas[key] = label;
    return [modelo, label, precioGuia, precioPublico, ahora];
  });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TARIFARIO_ICARE_HOJA);

  // Parte 3: si ya hay un tarifario cargado y el archivo nuevo trae MENOS
  // combinaciones modelo+categoría, no se pisa sin confirmación explícita
  // — evita reemplazar accidentalmente por un archivo incompleto.
  const cantidadActual = sh ? Math.max(sh.getLastRow() - 1, 0) : 0;
  if (cantidadActual > 0 && filasSalida.length < cantidadActual && !confirmarReemplazo) {
    return {
      requiereConfirmacion: true,
      mensaje: `⚠️ El archivo contiene menos reparaciones (${filasSalida.length}) que el tarifario actual (${cantidadActual}).\n¿Desea continuar?`,
      cantidadActual: cantidadActual,
      cantidadNueva: filasSalida.length
    };
  }

  if (!sh) {
    sh = ss.insertSheet(TARIFARIO_ICARE_HOJA);
    sh.getRange(1, 1, 1, 5).setValues([["Modelo", "Categoría", "Precio Guía", "Precio Público", "Actualizado"]]);
  }
  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, Math.max(sh.getLastColumn(), 5)).clearContent();
  if (filasSalida.length > 0) {
    sh.getRange(2, 1, filasSalida.length, 5).setValues(filasSalida);
    sh.getRange(2, 3, filasSalida.length, 2).setNumberFormat("$#,##0");
    sh.getRange(2, 5, filasSalida.length, 1).setNumberFormat("dd/mm/yyyy hh:mm");
  }

  const nombresNuevas = Object.keys(categoriasNuevasVistas).map(k => categoriasNuevasVistas[k]);
  return {
    requiereConfirmacion: false,
    mensaje: "✅ Tarifario actualizado.\n" +
      `Filas del archivo: ${filas.length - 1}\n` +
      `Filas ignoradas (sin categoría reconocida o datos incompletos): ${filasIgnoradas}\n` +
      `Combinaciones modelo + categoría guardadas: ${filasSalida.length}\n` +
      `Reparaciones nuevas detectadas en el archivo: ${nombresNuevas.length > 0 ? nombresNuevas.join(", ") : "ninguna"}`
  };
}

/** Normaliza un nombre de modelo para comparar (mayúsc/minúsc, acentos vía _normalizarTipoReparacion_, más colapso de espacios repetidos — ese normalizador no los toca). No quita capacidad; ver _quitarCapacidadModeloIcare_. */
function _normalizarModeloIcare_(s) {
  return _normalizarTipoReparacion_(s).replace(/\s+/g, " ").trim();
}

/** Quita ÚNICAMENTE tokens de capacidad ("128 GB", "256GB", "512 Gb", "1 TB", etc.) de un modelo ya normalizado — nada más. Se usa solo como fallback del match exacto (Parte 1), nunca como aproximación de texto. */
function _quitarCapacidadModeloIcare_(s) {
  return String(s || "")
    .replace(/\d+\s*(gb|tb)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * obtenerTarifarioIcare_()
 *
 * Lee "TARIFARIO_ICARE" en vivo (1 sola lectura, reutilizada por
 * _calcularPresupuestoReparacionCore_ para todos los modelos). Nunca
 * rompe la Web App: hoja inexistente o columnas faltantes → mapas vacíos
 * (todas las categorías quedan "sin configurar", igual que hoy pasa
 * cuando falta el multiplicador en CONFIG_REPARACIONES).
 *
 * Devuelve { exactos, normalizados }:
 *   - exactos: { [modeloTalCualEnLaHoja]: { [key]: {guia, publico} } } — para
 *     el paso 1 del matching (match exacto, sin tocar nada).
 *   - normalizados: { [modeloNormalizadoSinCapacidad]: { [key]: {...} } } —
 *     para el paso 2-4 (normalizar + quitar capacidad + exacto de nuevo).
 */
function obtenerTarifarioIcare_() {
  const resultado = { exactos: {}, normalizados: {} };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TARIFARIO_ICARE_HOJA);
  if (!sh) return resultado;

  const fE = 1;
  const totalCols = sh.getLastColumn();
  const hdrs = sh.getRange(fE, 1, 1, totalCols).getValues()[0].map(h => String(h).trim());
  const cMO = hdrs.indexOf("Modelo");
  const cCA = hdrs.indexOf("Categoría");
  const cPG = hdrs.indexOf("Precio Guía");
  const cPP = hdrs.indexOf("Precio Público");
  if (cMO === -1 || cCA === -1 || cPP === -1) {
    Logger.log(`⚠️ obtenerTarifarioIcare_: faltan columnas en "${TARIFARIO_ICARE_HOJA}".`);
    return resultado;
  }

  const labelAKey = {};
  REPARACIONES_ITEMS_.forEach(it => { labelAKey[_normalizarTipoReparacion_(it.label)] = it.key; });

  const lastRow = sh.getLastRow();
  if (lastRow <= fE) return resultado;

  sh.getRange(fE + 1, 1, lastRow - fE, totalCols).getValues().forEach(row => {
    const modelo = String(row[cMO] || "").trim();
    const catTxt = String(row[cCA] || "").trim();
    if (!modelo || !catTxt) return;

    const key = labelAKey[_normalizarTipoReparacion_(catTxt)];
    if (!key) return; // categoría no reconocida (ej. hoja editada a mano con un typo) — se ignora sin romper

    const publico = Number(row[cPP]) || 0;
    if (publico <= 0) return;
    const guia = cPG >= 0 ? (Number(row[cPG]) || 0) : null;
    const valor = { guia: guia, publico: publico };

    if (!resultado.exactos[modelo]) resultado.exactos[modelo] = {};
    resultado.exactos[modelo][key] = valor;

    const modeloNorm = _quitarCapacidadModeloIcare_(_normalizarModeloIcare_(modelo));
    if (!resultado.normalizados[modeloNorm]) resultado.normalizados[modeloNorm] = {};
    resultado.normalizados[modeloNorm][key] = valor;
  });

  return resultado;
}

/**
 * obtenerPreciosTarifarioParaModelo_(modeloToma, tarifario)
 *
 * Matching de modelos — Parte 1 del robustecimiento (reemplaza el
 * startsWith() anterior, que producía falsos positivos: "iPhone 15"
 * podía matchear por error "iPhone 15 Pro Max ..."). Pasos, en orden,
 * sin aproximaciones (nada de startsWith()/includes()):
 *   1. Match exacto tal cual viene de "Toma de Equipos".
 *   2-3. Si no hubo match: normalizar (mayúsc/minúsc, espacios, acentos)
 *        y quitar SOLO la capacidad (128 GB, 256 GB, 512 GB, 1 TB, etc.).
 *   4. Volver a intentar match exacto, ahora contra los modelos del
 *      tarifario normalizados de la misma manera.
 *   5. Si sigue sin haber match, devuelve {} — todas las categorías de
 *      ese modelo quedan "sin configurar" (no se inventa ningún modelo).
 */
function obtenerPreciosTarifarioParaModelo_(modeloToma, tarifario) {
  const modeloTrim = String(modeloToma || "").trim();

  if (tarifario.exactos && tarifario.exactos[modeloTrim]) return tarifario.exactos[modeloTrim];

  const modeloNorm = _quitarCapacidadModeloIcare_(_normalizarModeloIcare_(modeloTrim));
  if (tarifario.normalizados && tarifario.normalizados[modeloNorm]) return tarifario.normalizados[modeloNorm];

  return {};
}

/** Diálogo de Sheets (menú "🔧 Reparaciones → Actualizar tarifario (CSV)") — mismo patrón que registrarPreventa()/entregarPreventa() (Code.gs): HtmlService inline + showModalDialog. Sube el archivo con FileReader (sin Drive) y manda el texto crudo a importarTarifarioIcare(). */
function mostrarImportadorTarifarioIcare() {
  const html = HtmlService.createHtmlOutput(`
<div style="font-family:Arial, sans-serif;padding:16px;font-size:13px">
  <h3 style="margin:0 0 10px;color:#6C3483">🔧 Actualizar Tarifario de Reparaciones</h3>
  <p style="color:#555">Subí el archivo CSV/TXT del proveedor (columnas: Modelo, Parte, Precio, Disponibilidad). Reemplaza por completo el tarifario anterior.</p>
  <input type="file" id="archivo" accept=".csv,.txt"/>
  <div id="msg" style="margin-top:12px;white-space:pre-wrap"></div>
  <button id="btn" onclick="procesar()" style="margin-top:12px;padding:8px 16px;cursor:pointer">Actualizar tarifario</button>
</div>
<script>
  var _textoArchivoTarifario = null;

  function procesar(){
    var input = document.getElementById("archivo");
    var msg = document.getElementById("msg");
    if (!input.files || !input.files[0]) { msg.textContent = "❌ Elegí un archivo primero."; return; }
    msg.textContent = "Procesando...";
    var reader = new FileReader();
    reader.onload = function(e){
      _textoArchivoTarifario = e.target.result;
      _enviarTarifario(false);
    };
    reader.onerror = function(){ msg.textContent = "❌ No se pudo leer el archivo."; };
    reader.readAsText(input.files[0], "UTF-8");
  }

  // Parte 3: si el backend pide confirmación (archivo con menos reparaciones
  // que el tarifario actual), se le pregunta al operador acá antes de
  // reintentar con confirmarReemplazo=true. Si cancela, no se escribe nada.
  function _enviarTarifario(confirmarReemplazo){
    var msg = document.getElementById("msg");
    var btn = document.getElementById("btn");
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(function(res){
        if (res && res.requiereConfirmacion) {
          if (window.confirm(res.mensaje)) { _enviarTarifario(true); return; }
          msg.textContent = "Importación cancelada.";
          btn.disabled = false;
          return;
        }
        msg.textContent = (res && res.mensaje) || "✅ Listo.";
        btn.disabled = false;
      })
      .withFailureHandler(function(err){ msg.textContent = "❌ " + err.message; btn.disabled = false; })
      .importarTarifarioIcare(_textoArchivoTarifario, confirmarReemplazo);
  }
</script>
  `).setWidth(480).setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(html, "Actualizar Tarifario");
}

/**
 * diagnosticarTarifarioIcare(modeloDePrueba) — SOLO LECTURA, no modifica
 * nada (ni la hoja, ni CONFIG_REPARACIONES, ni Toma de Equipos). Se
 * ejecuta a mano desde el editor de Apps Script (elegir esta función →
 * ▶ Ejecutar → Ver → Registros de ejecución) para obtener, con datos
 * reales del entorno en vivo, exactamente lo que hace falta para cerrar
 * la causa raíz de "sin configurar" generalizado: si TARIFARIO_ICARE
 * existe y tiene datos, qué devuelve realmente obtenerTarifarioIcare_(),
 * y el recorrido completo de obtenerPreciosTarifarioParaModelo_() para un
 * modelo real de "Toma de Equipos" (el primero, o el que se pase como
 * parámetro).
 */
function diagnosticarTarifarioIcare(modeloDePrueba) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TARIFARIO_ICARE_HOJA);

  Logger.log("========== PASO 1: hoja \"" + TARIFARIO_ICARE_HOJA + "\" ==========");
  if (!sh) {
    Logger.log("❌ La hoja NO existe en este Spreadsheet.");
  } else {
    Logger.log("✅ Existe. Filas: " + sh.getLastRow() + " | Columnas: " + sh.getLastColumn());
    const hdrs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    Logger.log("Encabezados (fila 1): " + JSON.stringify(hdrs));
    if (sh.getLastRow() > 1) {
      const muestra = sh.getRange(2, 1, Math.min(5, sh.getLastRow() - 1), sh.getLastColumn()).getValues();
      Logger.log("Primeras filas de datos: " + JSON.stringify(muestra));
    } else {
      Logger.log("⚠️ No hay filas de datos, solo el encabezado.");
    }
  }

  Logger.log("========== PASO 3: obtenerTarifarioIcare_() ==========");
  const tarifario = obtenerTarifarioIcare_();
  const modelosExactos = Object.keys(tarifario.exactos);
  const modelosNormalizados = Object.keys(tarifario.normalizados);
  Logger.log("Cantidad de modelos en 'exactos': " + modelosExactos.length);
  Logger.log("Cantidad de modelos en 'normalizados': " + modelosNormalizados.length);
  Logger.log("Primeros 5 modelos (exactos): " + JSON.stringify(modelosExactos.slice(0, 5)));
  if (modelosExactos.length > 0) {
    Logger.log("Categorías del primer modelo (\"" + modelosExactos[0] + "\"): " + JSON.stringify(tarifario.exactos[modelosExactos[0]]));
  }

  Logger.log("========== PASO 6-7: comparación contra \"Toma de Equipos\" ==========");
  const equipos = obtenerPreciosToma();
  Logger.log("Cantidad de modelos en 'Toma de Equipos': " + equipos.length);
  Logger.log("Primeros 5 modelos (Toma de Equipos): " + JSON.stringify(equipos.slice(0, 5).map(e => e.modelo)));

  Logger.log("========== PASO 4: recorrido de obtenerPreciosTarifarioParaModelo_() ==========");
  const modelo = modeloDePrueba || (equipos[0] && equipos[0].modelo) || "";
  Logger.log("Modelo de prueba (texto recibido): \"" + modelo + "\"");
  Logger.log("1) Match exacto — ¿existe tarifario.exactos[\"" + modelo + "\"]? " + (!!tarifario.exactos[modelo]));
  const normalizado = _normalizarModeloIcare_(modelo);
  const sinCapacidad = _quitarCapacidadModeloIcare_(normalizado);
  Logger.log("2) Normalizado (mayúsc/minúsc, acentos, espacios): \"" + normalizado + "\"");
  Logger.log("3) Sin capacidad: \"" + sinCapacidad + "\"");
  Logger.log("4) Match normalizado — ¿existe tarifario.normalizados[\"" + sinCapacidad + "\"]? " + (!!tarifario.normalizados[sinCapacidad]));
  const resultado = obtenerPreciosTarifarioParaModelo_(modelo, tarifario);
  Logger.log("5) Resultado final devuelto: " + JSON.stringify(resultado));

  Logger.log("========== PASO 8 + RESUMEN ==========");
  if (modelosExactos.length === 0) {
    Logger.log("🔴 obtenerTarifarioIcare_() devuelve TODO vacío → confirma que el problema está ANTES (Paso 1: hoja inexistente, sin filas, o encabezados que no matchean \"Modelo\"/\"Categoría\"/\"Precio Público\").");
  } else if (Object.keys(resultado).length === 0) {
    Logger.log("🟡 El tarifario SÍ tiene " + modelosExactos.length + " modelos cargados, pero \"" + modelo + "\" no matcheó ni exacto ni normalizado → comparar el texto exacto contra los \"Primeros 5 modelos (exactos)\" de arriba (Paso 7): probablemente \"Toma de Equipos\" tiene algo más que capacidad en el nombre (color, guion, paréntesis, etc.).");
  } else {
    Logger.log("✅ El modelo matcheó correctamente y devolvió precios.");
  }
}

/**
 * diagnosticarTarifarioCompleto(modeloDePrueba, categoriaDePrueba)
 *
 * SOLO LECTURA — no modifica ninguna hoja, no cambia CONFIG_REPARACIONES,
 * no toca Toma de Equipos, no escribe nada. Ejecutar a mano desde el
 * editor de Apps Script (elegir esta función → ▶ Ejecutar → Ver →
 * Registros de ejecución). Sigue exactamente los pasos 1 a 7 pedidos para
 * confirmar o descartar un problema de versiones desincronizadas entre
 * archivos del proyecto desplegado.
 */
function diagnosticarTarifarioCompleto(modeloDePrueba, categoriaDePrueba) {
  Logger.log("################################################################");
  Logger.log("#  DIAGNÓSTICO COMPLETO — TARIFARIO_ICARE");
  Logger.log("################################################################");

  // ---------- PASO 2: hoja TARIFARIO_ICARE ----------
  Logger.log("\n========== PASO 2: hoja \"" + TARIFARIO_ICARE_HOJA + "\" ==========");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TARIFARIO_ICARE_HOJA);
  if (!sh) {
    Logger.log("❌ NO EXISTE ninguna hoja llamada \"" + TARIFARIO_ICARE_HOJA + "\" en este Spreadsheet.");
  } else {
    Logger.log("✅ Existe.");
    Logger.log("Cantidad de filas (getLastRow): " + sh.getLastRow());
    Logger.log("Cantidad de columnas (getLastColumn): " + sh.getLastColumn());
    const hdrs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    Logger.log("Encabezados (fila 1): " + JSON.stringify(hdrs));
    if (sh.getLastRow() > 1) {
      const n = Math.min(5, sh.getLastRow() - 1);
      const muestra = sh.getRange(2, 1, n, sh.getLastColumn()).getValues();
      Logger.log("Primeras " + n + " filas completas de datos:");
      muestra.forEach((f, i) => Logger.log("  Fila " + (i + 2) + ": " + JSON.stringify(f)));
    } else {
      Logger.log("⚠️ No hay ninguna fila de datos (solo encabezado, o ni eso).");
    }
  }

  // ---------- PASO 3: obtenerTarifarioIcare_() ----------
  Logger.log("\n========== PASO 3: obtenerTarifarioIcare_() ==========");
  const tarifario = obtenerTarifarioIcare_();
  Logger.log("typeof tarifario: " + typeof tarifario);
  Logger.log("Array.isArray(tarifario): " + Array.isArray(tarifario));
  Logger.log("Object.keys(tarifario): " + JSON.stringify(Object.keys(tarifario)));
  if (tarifario && typeof tarifario === "object" && !Array.isArray(tarifario)) {
    if ("exactos" in tarifario && "normalizados" in tarifario) {
      Logger.log("Tiene la forma { exactos, normalizados } esperada.");
      Logger.log("Cantidad de modelos en 'exactos': " + Object.keys(tarifario.exactos || {}).length);
      Logger.log("Cantidad de modelos en 'normalizados': " + Object.keys(tarifario.normalizados || {}).length);
      Logger.log("Modelos en 'exactos': " + JSON.stringify(Object.keys(tarifario.exactos || {})));
    } else {
      Logger.log("⚠️ NO tiene la forma { exactos, normalizados } — estructura real: " + JSON.stringify(tarifario));
    }
  } else {
    Logger.log("⚠️ No es un objeto plano. Valor real: " + JSON.stringify(tarifario));
  }

  // ---------- PASO 4 + 7: firma/código real de las funciones en uso ----------
  // .toString() sobre una función en Apps Script devuelve su código fuente
  // TAL CUAL está cargado en este momento en el proyecto — si hubiera un
  // archivo viejo pisando/duplicando el nombre, esto lo muestra directo,
  // sin necesidad de adivinar.
  Logger.log("\n========== PASO 4 y 7: código real cargado en el proyecto ==========");
  Logger.log("--- obtenerTarifarioIcare_ ---\n" + obtenerTarifarioIcare_.toString());
  Logger.log("--- obtenerPreciosTarifarioParaModelo_ ---\n" + obtenerPreciosTarifarioParaModelo_.toString());
  Logger.log("--- _calcularPresupuestoReparacionCore_ ---\n" + _calcularPresupuestoReparacionCore_.toString());
  Logger.log("--- obtenerTarifarioReparaciones ---\n" + obtenerTarifarioReparaciones.toString());
  Logger.log("--- importarTarifarioIcare ---\n" + importarTarifarioIcare.toString());
  Logger.log("--- REPARACIONES_ITEMS_ ---\n" + JSON.stringify(REPARACIONES_ITEMS_));

  // ---------- PASO 6: obtenerTarifarioReparaciones() — fuente real ----------
  Logger.log("\n========== PASO 6: obtenerTarifarioReparaciones() ==========");
  const todosTrabajos = {};
  REPARACIONES_ITEMS_.forEach(it => { todosTrabajos[it.key] = true; });
  const equipos = obtenerPreciosToma();
  Logger.log("Cantidad de modelos en 'Toma de Equipos': " + equipos.length);
  const tarifarioReparaciones = obtenerTarifarioReparaciones();
  const totalTrabajos = tarifarioReparaciones.reduce((acc, m) => acc + m.trabajos.length, 0);
  const totalSinConfigurar = tarifarioReparaciones.reduce((acc, m) => acc + m.trabajos.filter(t => t.sinConfigurar).length, 0);
  Logger.log("Modelos procesados por obtenerTarifarioReparaciones(): " + tarifarioReparaciones.length);
  Logger.log("Trabajos totales (todas las categorías configuradas, todos los modelos): " + totalTrabajos);
  Logger.log("De esos, marcados 'sinConfigurar': " + totalSinConfigurar + " (" + (totalTrabajos ? Math.round(100 * totalSinConfigurar / totalTrabajos) : 0) + "%)");
  if (tarifarioReparaciones.length > 0) {
    Logger.log("Ejemplo — primer modelo (\"" + tarifarioReparaciones[0].modelo + "\"): " + JSON.stringify(tarifarioReparaciones[0].trabajos));
  }

  // ---------- PASO 5: recorrido con logs dentro de _calcularPresupuestoReparacionCore_ ----------
  // (los logs temporales agregados DENTRO de esa función en webapp.gs se
  // disparan acá, al llamarla con un caso real controlado)
  Logger.log("\n========== PASO 5: recorrido real de _calcularPresupuestoReparacionCore_ ==========");
  const modelo = modeloDePrueba || (equipos[0] && equipos[0].modelo) || "";
  const categoria = categoriaDePrueba || "pantalla";
  const equipo = equipos.find(e => e.modelo === modelo);
  if (!equipo) {
    Logger.log("❌ No se encontró el modelo \"" + modelo + "\" en 'Toma de Equipos' — no se puede probar el core.");
  } else {
    const config = obtenerConfiguracionReparaciones();
    Logger.log("Config de '" + categoria + "' en CONFIG_REPARACIONES: " + JSON.stringify(config[categoria] || null));
    const dPrueba = {};
    dPrueba[categoria] = true;
    const resultadoCore = _calcularPresupuestoReparacionCore_(dPrueba, equipo, config, tarifario);
    Logger.log("Resultado de _calcularPresupuestoReparacionCore_: " + JSON.stringify(resultadoCore));
  }

  // ---------- PASO 8 y 9: duplicados ----------
  Logger.log("\n========== PASO 8 y 9: duplicados en el proyecto ==========");
  Logger.log("Esta función no tiene forma de listar TODOS los archivos .gs del proyecto ni detectar nombres duplicados por sí sola (Apps Script no expone esa lista vía código a sí mismo). Lo que SÍ es una señal indirecta: si el código impreso arriba en el PASO 4/7 (obtenerTarifarioIcare_, obtenerPreciosTarifarioParaModelo_, _calcularPresupuestoReparacionCore_) NO coincide con el contenido actual de tarifario_icare.gs/webapp.gs en el repositorio local, hay un archivo viejo pisando al nuevo (Apps Script usa la ÚLTIMA definición cargada del mismo nombre, sin avisar). Para el chequeo 100% seguro: abrí el editor de Apps Script y mirá la lista de archivos a la izquierda — buscá si aparece más de un archivo relacionado a \"tarifario\" o \"reparaciones\".");

  Logger.log("\n################################################################");
  Logger.log("#  FIN DEL DIAGNÓSTICO");
  Logger.log("################################################################");
}
