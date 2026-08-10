// ============================================================
//  GreatPhones ERP — Web App (HtmlService)
//  Este archivo NO reemplaza Code.gs. Solamente agrega:
//   - el punto de entrada web (doGet + include),
//   - funciones de LECTURA para alimentar dropdowns y el dashboard.
//  Ninguna función de negocio existente (procesarCompra, procesarVenta,
//  procesarPreventa, procesarEntregaPreventa, procesarReparacion,
//  procesarGasto, procesarMovimientoInversor, libroLog, getConfig, getCol,
//  getFilaVacia, genCorrelativo, actualizarStock_) fue modificada.
// ============================================================

function doGet() {
  return HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle('GreatPhones ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Incluye un archivo HTML dentro de otro (usado por index.html para armar la SPA). */
function include(nombre) {
  return HtmlService
    .createHtmlOutputFromFile(nombre)
    .getContent();
}


// ============================================================
//  DATA PROVIDERS — solo lectura, para alimentar la Web App.
//  Reproducen exactamente la misma lógica que ya usaban los diálogos
//  showModalDialog() actuales (registrarVenta, entregarPreventa,
//  registrarMovimientoInversor), sin tocar esas funciones.
// ============================================================

/** Equipos en estado 📦 En Stock, para el selector de registrarVenta. */
function obtenerEquiposEnStock() {
  const cfg = getConfigCached();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const comprasSheet = ss.getSheetByName(cfg.HOJA_COMPRAS || "Compras");
  if (!comprasSheet) return [];

  const fE = 2;
  const colOPc  = getCol(comprasSheet, "N° OP",           fE);
  const colMod  = getCol(comprasSheet, "Equipo / Modelo", fE);
  const colIMEI = getCol(comprasSheet, "IMEI",            fE);
  const colEst  = getCol(comprasSheet, "Estado",          fE);
  const colTipo = getCol(comprasSheet, "Tipo Ingreso",    fE);
  let colEstReg = -1;
  try { colEstReg = getCol(comprasSheet, "ESTADO_REGISTRO", fE); } catch (e) { /* columna opcional */ }

  const lastRow = comprasSheet.getLastRow();
  const opciones = [];
  if (lastRow < fE + 1) return opciones;

  const datos = comprasSheet.getRange(fE + 1, 1, lastRow - fE, comprasSheet.getLastColumn()).getValues();
  datos.forEach(row => {
    if (colEstReg >= 0 && String(row[colEstReg - 1] || "").trim() === "ANULADO") return;
    if (String(row[colEst - 1]) === "📦 En Stock") {
      opciones.push({
        value: row[colOPc - 1],
        label: `${row[colOPc-1]} — ${row[colMod-1]}${row[colIMEI-1] ? " ("+row[colIMEI-1]+")" : ""} [${row[colTipo-1]}]`,
        // Parte 3 (rediseño UX de Ventas): modelo tal cual quedó cargado en
        // Compras — permite autocompletar el Precio Contado desde "Lista de
        // Precios" sin parsear el texto de "label". Campo aditivo: no cambia
        // "value"/"label" para quien ya los use.
        modelo: String(row[colMod - 1] || "").trim()
      });
    }
  });
  return opciones;
}

/**
 * Preventas entregables: todas menos ✅ Entregado y ❌ Cancelado
 * (🟡 Esperando compra / 🟠 Comprado / 🟢 Entregado con saldo), con los
 * datos necesarios para el formulario de entregarPreventa.
 */
function obtenerPreventasEntregables() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const preSheet = ss.getSheetByName("Preventas");
  if (!preSheet) return [];

  const fE  = 2;
  const cNP = getCol(preSheet, "N° Preventa",          fE);
  const cCL = getCol(preSheet, "Cliente",               fE);
  const cMO = getCol(preSheet, "Modelo Solicitado",     fE);
  const cPV = getCol(preSheet, "Precio Venta Pactado",  fE);
  const cTC = getCol(preSheet, "Total Cobrado",         fE);
  const cSP = getCol(preSheet, "Saldo Pendiente",       fE);
  const cES = getCol(preSheet, "Estado",                fE);
  const cNC = getCol(preSheet, "N° Compra Asociada",    fE);
  let cEstReg = -1, cTL = -1, cED = -1, cEH = -1;
  try { cEstReg = getCol(preSheet, "ESTADO_REGISTRO", fE); } catch (e) { /* columna opcional */ }
  try { cTL = getCol(preSheet, "Teléfono", fE); } catch (e) { /* opcional */ }
  // Fecha Prometida Desde/Hasta: usadas por el panel de seguimiento de
  // preventas (calendario + lista) en preventas.html, para saber para
  // cuándo se comprometió cada entrega — opcionales para no romper si la
  // hoja todavía no las tiene (asegurarColumnaGenerica_ las crea recién al
  // registrar la próxima preventa, ver procesarPreventa en Code.gs).
  try { cED = getCol(preSheet, "Fecha Prometida Desde", fE); } catch (e) { /* opcional */ }
  try { cEH = getCol(preSheet, "Fecha Prometida Hasta", fE); } catch (e) { /* opcional */ }

  const lastRow = preSheet.getLastRow();
  const opciones = [];
  if (lastRow < fE + 1) return opciones;

  const tz = Session.getScriptTimeZone();
  const fISO = (celda) => (celda instanceof Date) ? Utilities.formatDate(celda, tz, "yyyy-MM-dd") : "";

  const datos = preSheet.getRange(fE + 1, 1, lastRow - fE, preSheet.getLastColumn()).getValues();
  datos.forEach(row => {
    if (cEstReg >= 0 && String(row[cEstReg-1] || "").trim() === "ANULADO") return;
    const estado = String(row[cES-1] || "");
    if (!estado || estado === "✅ Entregado" || estado.includes("Cancelado")) return;
    opciones.push({
      nPre:    String(row[cNP-1]),
      cliente: String(row[cCL-1]),
      modelo:  String(row[cMO-1]),
      precio:  Number(row[cPV-1]) || 0,
      cobrado: Number(row[cTC-1]) || 0,
      saldo:   Number(row[cSP-1]) || 0,
      nComp:   String(row[cNC-1] || ""),
      estado:  estado,
      tel:     cTL > 0 ? String(row[cTL-1] || "") : "",
      fechaDesde: cED > 0 ? fISO(row[cED-1]) : "",
      fechaHasta: cEH > 0 ? fISO(row[cEH-1]) : ""
    });
  });
  return opciones;
}

/** Lista de inversores configurada en Config (INVERSORES_LISTA). */
function obtenerListaInversores() {
  const cfg = getConfigCached();
  return cfg.INV_ARRAY || ["Eva", "Beto", "Paz", "Sam"];
}

// ============================================================
//  PRECIOS — módulos de solo lectura sobre las hojas "Lista de Precios"
//  y "Toma de Equipos". Esas hojas siguen siendo la base de datos: acá
//  solo se leen (nunca se escriben) para alimentar la Web App. No
//  duplican datos ni crean hojas/tablas nuevas.
//  Encabezados reales (fila 3 en ambas hojas, auditados directamente en
//  el Sheet, no inventados):
//    "Lista de Precios"  → Modelo | Almacenamiento | Precio USD | Precio ARS |
//                           Preventa ARS | Preventa USD | Descuento ARS | Descuento USD
//    "Toma de Equipos"   → Modelo | Precio Impecable (ARS) | Batería | Pantalla |
//                           Cámara | Micrófono | Parlante | Tapa Trasera | Marco |
//                           Pin de Carga
//                           (esas 8 celdas de encabezado tienen en realidad dos
//                           líneas, "Resta si falta" + el nombre de la parte, ej.
//                           "Resta si falta\nBatería" — por eso obtenerPreciosToma()
//                           las busca con buscarColumnaFlexible_() y no con getCol())
// ============================================================

const PRECIOS_FILA_ENCABEZADO = 3;

/**
 * buscarColumnaFlexible_(sheet, fila, texto)
 *
 * Como getCol() (no la reemplaza, no la modifica), pero tolerante a
 * encabezados con saltos de línea/espacios repetidos — ej.: en "Toma de
 * Equipos" las celdas de encabezado son literalmente "Resta si falta\nBatería"
 * (dos líneas dentro de la misma celda), no "Batería" a secas.
 * Normaliza tanto los encabezados de la hoja como el texto buscado
 * (saltos de línea → espacio, espacios repetidos → uno solo, trim,
 * minúsculas) y permite ubicar la columna buscando:
 *   - el texto completo tal cual aparece en el Sheet ("Resta si falta Batería")
 *   - o solo la parte variable ("Batería", "PANTALLA", etc.)
 * Devuelve el número de columna (1-based). Solo lectura: no toca el Sheet.
 *
 * `hdrsPrecargados` (opcional): si ya se leyó la fila de encabezados antes
 * (ej. obtenerPreciosToma(), que la necesita para 8 columnas seguidas), se
 * puede pasar ese array para no repetir el mismo SpreadsheetApp.getRange().
 * Sin este parámetro se comporta exactamente igual que antes.
 */
function buscarColumnaFlexible_(sheet, fila, texto, hdrsPrecargados) {
  const normalizar = (s) => String(s == null ? "" : s)
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const hdrs = hdrsPrecargados || sheet.getRange(fila, 1, 1, sheet.getLastColumn()).getValues()[0];
  const hdrsNorm = hdrs.map(normalizar);
  const buscado = normalizar(texto);

  let idx = hdrsNorm.findIndex(h => h === buscado);
  if (idx === -1) idx = hdrsNorm.findIndex(h => h.indexOf(buscado) !== -1);

  if (idx === -1) {
    throw new Error(`❌ Columna (variante de) "${texto}" no encontrada en "${sheet.getName()}" (fila ${fila}).\nDisponibles: ${hdrsNorm.filter(Boolean).join(" | ")}`);
  }
  return idx + 1;
}

/** Lee "Lista de Precios" (solo lectura) y devuelve un array plano para precios.html y el drawer de Ventas. */
function obtenerListaPrecios() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("Lista de Precios");
  if (!sh) return [];

  const fE = PRECIOS_FILA_ENCABEZADO;
  const cMO = getCol(sh, "Modelo", fE);
  const cAL = getCol(sh, "Almacenamiento", fE);
  const cPU = getCol(sh, "Precio USD", fE);
  const cPA = getCol(sh, "Precio ARS", fE);
  const cVA = getCol(sh, "Preventa ARS", fE);
  const cVU = getCol(sh, "Preventa USD", fE);
  const cDA = getCol(sh, "Descuento ARS", fE);
  const cDU = getCol(sh, "Descuento USD", fE);

  const lastRow = sh.getLastRow();
  const resultado = [];
  if (lastRow <= fE) return resultado;

  sh.getRange(fE + 1, 1, lastRow - fE, sh.getLastColumn()).getValues().forEach(row => {
    const modelo = String(row[cMO - 1] || "").trim();
    if (!modelo) return; // fila sin modelo cargado en el Sheet — se omite, no se inventa dato
    resultado.push({
      modelo:         modelo,
      almacenamiento: String(row[cAL - 1] || "").trim(),
      precioUSD:      Number(row[cPU - 1]) || 0,
      precioARS:      Number(row[cPA - 1]) || 0,
      preventaARS:    Number(row[cVA - 1]) || 0,
      preventaUSD:    Number(row[cVU - 1]) || 0,
      descuentoARS:   Number(row[cDA - 1]) || 0,
      descuentoUSD:   Number(row[cDU - 1]) || 0
    });
  });
  return resultado;
}

/** Lee "Toma de Equipos" (solo lectura) y devuelve un array plano para toma_precios.html y calculadora_toma.html. */
function obtenerPreciosToma() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("Toma de Equipos");
  if (!sh) return [];

  const fE = PRECIOS_FILA_ENCABEZADO;
  const totalCols = sh.getLastColumn(); // 1 sola llamada, reutilizada abajo

  // OPTIMIZACIÓN: una sola lectura de la fila de encabezados en vez de 9
  // (getCol()/buscarColumnaFlexible_() antes hacían, cada una, su propio
  // SpreadsheetApp.getRange().getValues() sobre la MISMA fila). getCol() es
  // protegida (no se modifica) — acá se reproduce su misma búsqueda exacta
  // sobre el array ya leído. buscarColumnaFlexible_() ahora acepta ese mismo
  // array precargado (4° parámetro opcional, sin romper su comportamiento).
  const hdrs = sh.getRange(fE, 1, 1, totalCols).getValues()[0];
  const idxExacto = (nombre) => {
    const i = hdrs.findIndex(h => String(h).trim() === nombre.trim());
    if (i === -1) throw new Error(`❌ Columna "${nombre}" no encontrada en "${sh.getName()}" (fila ${fE}).\nDisponibles: ${hdrs.filter(Boolean).join(" | ")}`);
    return i + 1;
  };

  const cMO = idxExacto("Modelo");
  const cIM = idxExacto("Precio Impecable (ARS)");
  // Estas 8 columnas tienen encabezado en dos líneas dentro de la misma celda
  // ("Resta si falta\nBatería", etc.) — por eso usan buscarColumnaFlexible_()
  // en vez del match exacto de arriba.
  const cBA = buscarColumnaFlexible_(sh, fE, "Batería", hdrs);
  const cPA = buscarColumnaFlexible_(sh, fE, "Pantalla", hdrs);
  const cCA = buscarColumnaFlexible_(sh, fE, "Cámara", hdrs);
  const cMI = buscarColumnaFlexible_(sh, fE, "Micrófono", hdrs);
  const cPL = buscarColumnaFlexible_(sh, fE, "Parlante", hdrs);
  const cTA = buscarColumnaFlexible_(sh, fE, "Tapa Trasera", hdrs);
  const cMA = buscarColumnaFlexible_(sh, fE, "Marco", hdrs);
  const cPI = buscarColumnaFlexible_(sh, fE, "Pin de Carga", hdrs);

  const lastRow = sh.getLastRow();
  const resultado = [];
  if (lastRow <= fE) return resultado;

  const filas = sh.getRange(fE + 1, 1, lastRow - fE, totalCols).getValues();
  // La lista de modelos es un bloque CONTIGUO desde la fila fE+1 — se corta
  // en la primera fila sin "Modelo" (misma convención que getFilaVacia() usa
  // en todo el ERP para delimitar "hasta dónde hay datos cargados"). Esto es
  // a propósito un "break", no un "skip": más abajo en la hoja real existe
  // una sección de calculadora armada a mano (con textos tipo "Modelo a
  // tomar", "¿Falta batería?", etc. en la misma columna) que NO son equipos.
  // Cortar acá es la corrección de raíz (no un filtro en el HTML) y además
  // es robusta a futuro: cualquier fila que se agregue más abajo queda
  // automáticamente afuera, sin tener que enumerar casos.
  for (let i = 0; i < filas.length; i++) {
    const modelo = String(filas[i][cMO - 1] || "").trim();
    if (!modelo) break;
    resultado.push({
      modelo:    modelo,
      impecable: Number(filas[i][cIM - 1]) || 0,
      bateria:   Number(filas[i][cBA - 1]) || 0,
      pantalla:  Number(filas[i][cPA - 1]) || 0,
      camara:    Number(filas[i][cCA - 1]) || 0,
      microfono: Number(filas[i][cMI - 1]) || 0,
      parlante:  Number(filas[i][cPL - 1]) || 0,
      tapa:      Number(filas[i][cTA - 1]) || 0,
      marco:     Number(filas[i][cMA - 1]) || 0,
      pin:       Number(filas[i][cPI - 1]) || 0
    });
  }
  return resultado;
}

/**
 * Calcula el valor de toma de un equipo puntual a partir de "Toma de Equipos"
 * y las fallas marcadas. Solo lectura — no modifica ninguna hoja ni registra
 * ninguna operación (a diferencia de procesarCompra/procesarVenta/etc., que
 * no se tocan). d = { modelo, fallas: { bateria, pantalla, camara,
 * microfono, parlante, tapa, marco, pin } } (booleanos).
 */
function calcularValorToma(d) {
  const modelo = String((d && d.modelo) || "").trim();
  if (!modelo) throw new Error("❌ Seleccioná un modelo.");

  const equipo = obtenerPreciosToma().find(r => r.modelo === modelo);
  if (!equipo) throw new Error(`❌ "${modelo}" no encontrado en "Toma de Equipos".`);

  const fallas = (d && d.fallas) || {};
  const items = [
    { key: "bateria",   label: "Batería",      valor: equipo.bateria },
    { key: "pantalla",  label: "Pantalla",     valor: equipo.pantalla },
    { key: "camara",    label: "Cámara",       valor: equipo.camara },
    { key: "microfono", label: "Micrófono",    valor: equipo.microfono },
    { key: "parlante",  label: "Parlante",     valor: equipo.parlante },
    { key: "tapa",      label: "Tapa trasera", valor: equipo.tapa },
    { key: "marco",     label: "Marco",        valor: equipo.marco },
    { key: "pin",       label: "Pin de carga", valor: equipo.pin }
  ];

  let descuentos = 0;
  const detalle = [];
  items.forEach(it => {
    if (fallas[it.key]) {
      descuentos += it.valor;
      detalle.push({ label: it.label, valor: it.valor });
    }
  });

  return {
    modelo:     equipo.modelo,
    impecable:  equipo.impecable,
    descuentos: descuentos,
    detalle:    detalle,
    valorToma:  Math.max(0, equipo.impecable - descuentos)
  };
}

// ============================================================
//  PRESUPUESTO DE REPARACIÓN — cotización automática.
//
//  Reutiliza "Toma de Equipos" (vía obtenerPreciosToma(), ya existente) como
//  única fuente del "descuento toma" por trabajo — NO se duplica ninguna
//  tabla de precios. Los multiplicadores/horas viven en la hoja nueva
//  "CONFIG_REPARACIONES" (a crear a mano, mismo criterio que
//  CONFIG_REGALOS/CONFIG_CUOTAS: config de negocio, no se autogenera).
// ============================================================

const REPARACIONES_ITEMS_ = [
  { key: "bateria",           label: "Batería"           },
  { key: "pantalla",          label: "Pantalla"          },
  { key: "camara",            label: "Cámara"            },
  { key: "microfono",         label: "Micrófono"         },
  { key: "parlante",          label: "Parlante"          },
  { key: "tapa",              label: "Tapa trasera"      },
  { key: "marco",             label: "Marco"             },
  { key: "pin",               label: "Pin de carga"      },
  // Reparaciones nuevas, incorporadas desde el tarifario del proveedor
  // (tarifario_icare.gs) — amplían el catálogo, no reemplazan nada de arriba.
  // Keys de una sola palabra (sin espacios), mismo criterio que las 8 de
  // arriba: obtenerConfiguracionReparaciones() matchea "Tipo Reparación" de
  // CONFIG_REPARACIONES normalizando el texto tipeado (_normalizarTipoReparacion_,
  // que NO junta espacios) contra estas keys tal cual — una key con espacio
  // interno nunca podría matchear nada que un operador tipee.
  { key: "flex",     label: "Flex de carga"     },
  { key: "botones",  label: "Botones laterales" },
  { key: "chasis",   label: "Chasis"            }
];

/** Normaliza "Tipo Reparación" (quita acentos/mayúsculas/espacios) para poder matchear "Batería"/"bateria"/"BATERIA" contra la misma key. */
function _normalizarTipoReparacion_(s) {
  return String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * obtenerConfiguracionReparaciones()
 *
 * Lee CONFIG_REPARACIONES en vivo. Nunca rompe la Web App: cualquier fila
 * inválida se ignora con un warning en el Logger, nunca un throw.
 *   - hoja inexistente / faltan columnas "Tipo Reparación"/"Multiplicador" → {}.
 *   - "Tipo Reparación" no reconocido (no matchea ninguna de las 8 keys de
 *     Toma de Equipos) → fila ignorada + warning.
 *   - "Multiplicador" <= 0 → fila ignorada + warning.
 *   - "Tipo Reparación" repetido → se queda con la primera, la repetida se
 *     ignora + warning.
 *   - "Activo" inexistente → todas las filas activas. "Activo"="NO" → la
 *     cuota deja de existir para el sistema.
 * Devuelve un mapa { bateria: {multiplicador, horasEstimadas}, ... }.
 */
function obtenerConfiguracionReparaciones() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CONFIG_REPARACIONES");
  if (!sheet) {
    Logger.log("⚠️ obtenerConfiguracionReparaciones: hoja 'CONFIG_REPARACIONES' no encontrada.");
    return {};
  }

  const fE = 1;
  const totalCols = sheet.getLastColumn(); // 1 sola llamada, reutilizada abajo
  const hdrs = sheet.getRange(fE, 1, 1, totalCols).getValues()[0];
  const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
  const cTipo = idx("Tipo Reparación"), cMul = idx("Multiplicador"), cHoras = idx("Horas Estimadas"), cAct = idx("Activo");
  if (cTipo === -1 || cMul === -1) {
    Logger.log('⚠️ obtenerConfiguracionReparaciones: faltan columnas "Tipo Reparación"/"Multiplicador" en CONFIG_REPARACIONES.');
    return {};
  }

  const clavesValidas = REPARACIONES_ITEMS_.map(it => it.key);
  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return {};

  const resultado = {};
  sheet.getRange(fE + 1, 1, lastRow - fE, totalCols).getValues().forEach((row, i) => {
    const filaVisible = fE + 1 + i;
    const tipoTxt = String(row[cTipo] || "").trim();
    if (!tipoTxt) return; // fila vacía — se ignora sin warning (no hay nada cargado)

    const tipoKey = _normalizarTipoReparacion_(tipoTxt);
    if (clavesValidas.indexOf(tipoKey) === -1) {
      Logger.log(`⚠️ CONFIG_REPARACIONES fila ${filaVisible}: "Tipo Reparación"="${tipoTxt}" no reconocido — se ignora.`);
      return;
    }
    const multiplicador = Number(row[cMul]) || 0;
    if (multiplicador <= 0) {
      Logger.log(`⚠️ CONFIG_REPARACIONES fila ${filaVisible} (${tipoTxt}): "Multiplicador" inválido (<= 0) — se ignora.`);
      return;
    }
    if (cAct >= 0) {
      const activo = String(row[cAct] || "").trim().toUpperCase();
      if (activo === "NO") return; // desactivada a propósito: no es un warning
    }
    if (resultado[tipoKey]) {
      Logger.log(`⚠️ CONFIG_REPARACIONES fila ${filaVisible}: tipo "${tipoTxt}" repetido — se ignora.`);
      return;
    }

    const horas = cHoras >= 0 ? (Number(row[cHoras]) || 0) : 0;
    resultado[tipoKey] = { multiplicador: multiplicador, horasEstimadas: horas };
  });

  return resultado;
}

/**
 * calcularPresupuestoReparacion(d)
 *
 * ÚNICA función con la lógica de precio de reparaciones (Parte 9) — el
 * tarifario y el formulario de recepción llaman a esta misma función, nunca
 * reimplementan el cálculo.
 *
 * d = { modelo, bateria, pantalla, camara, microfono, parlante, tapa, marco,
 *       pin, flexCarga, botonesLaterales, chasis (booleanos),
 *       diagnostico (boolean, opcional) }
 *
 * Si d.diagnostico es true, NO calcula nada (Parte 3): devuelve precio "A
 * confirmar", 48hs y estado DIAGNOSTICO, ignorando cualquier checkbox de
 * trabajo marcado.
 *
 * precio = Precio Público del tarifario del proveedor (tarifario_icare.gs:
 * Precio Guía × 1.20, ya calculado al importar). Ya NO se usa la fórmula
 * anterior basada en "descuentoToma × multiplicador" de "Toma de Equipos".
 * precioTotal = suma de trabajos. horasEstimadas = máximo de las horas de
 * los trabajos elegidos, que sigue viniendo de CONFIG_REPARACIONES (sin
 * modificar: esa hoja sigue siendo la única fuente de horas/activo).
 * Redondeo con Math.round(), mismo criterio que el resto del ERP.
 */
/**
 * _calcularPresupuestoReparacionCore_(d, equipo, config, tarifario)
 *
 * Núcleo puro del cálculo — recibe el equipo (fila ya leída de "Toma de
 * Equipos"), la configuración (CONFIG_REPARACIONES ya leída) y el tarifario
 * del proveedor (TARIFARIO_ICARE ya leído, tarifario_icare.gs), no toca el
 * Sheet. calcularPresupuestoReparacion(d) (un modelo a la vez) y
 * obtenerTarifarioReparaciones() (todos los modelos) llaman a este mismo
 * núcleo, así el tarifario no repite una lectura completa de las hojas por
 * cada modelo (antes: N+1 lecturas de Sheet; ahora: 1 de cada hoja, sin
 * importar cuántos modelos haya — ver Problema 3 del rediseño).
 *
 * Estrategia de precio por categoría, en orden (auditoría confirmó que
 * TARIFARIO_ICARE/matching/CONFIG_REPARACIONES funcionan bien — esto SOLO
 * cambia qué se hace cuando el tarifario del proveedor no tiene precio
 * para ese modelo puntual):
 *   1. Si TARIFARIO_ICARE tiene Precio Público para ese modelo+categoría
 *      (`pt`), se usa ese precio — igual que hasta ahora.
 *   2. Si no, se reutiliza el método histórico del ERP (previo a
 *      TARIFARIO_ICARE): descuentoToma (de "Toma de Equipos") ×
 *      multiplicador (de CONFIG_REPARACIONES) — misma fórmula exacta que
 *      existía antes, no una reimplementación.
 *   3. Un trabajo solo queda "sin configurar" si falta el multiplicador en
 *      CONFIG_REPARACIONES (categoría no activa) o si NINGUNA de las dos
 *      fuentes tiene información (ni tarifario ni descuentoToma > 0).
 */
function _calcularPresupuestoReparacionCore_(d, equipo, config, tarifario) {
  const trabajos = [];
  let precioTotal = 0;
  let horasEstimadas = 0;
  const precios = obtenerPreciosTarifarioParaModelo_(equipo.modelo, tarifario || {});

  REPARACIONES_ITEMS_.forEach(it => {
    if (!(d && d[it.key])) return; // checkbox no marcado
    const cfg = config[it.key];
    const pt  = precios[it.key];

    if (!cfg) {
      trabajos.push({ nombre: it.label, precioGuia: null, precio: null, sinConfigurar: true, motivo: "Categoría sin configurar" });
      return;
    }

    if (pt) {
      trabajos.push({ nombre: it.label, precioGuia: pt.guia, precio: pt.publico });
      precioTotal += pt.publico;
      if (cfg.horasEstimadas > horasEstimadas) horasEstimadas = cfg.horasEstimadas;
      return;
    }

    // Sin precio en TARIFARIO_ICARE para este modelo+categoría: fallback al
    // método histórico del ERP — descuentoToma/multiplicador/precio con los
    // mismos nombres de campo que tenía el trabajo ANTES de incorporar el
    // tarifario del proveedor, para que el detalle ("$X x Y = $Z") se arme
    // igual que siempre (reparaciones.html), sin una segunda fórmula.
    const descuentoToma = Number(equipo[it.key]) || 0;
    if (descuentoToma > 0) {
      const precioHistorico = Math.round(descuentoToma * cfg.multiplicador);
      trabajos.push({ nombre: it.label, descuentoToma: descuentoToma, multiplicador: cfg.multiplicador, precio: precioHistorico });
      precioTotal += precioHistorico;
      if (cfg.horasEstimadas > horasEstimadas) horasEstimadas = cfg.horasEstimadas;
      return;
    }

    trabajos.push({ nombre: it.label, precio: null, sinConfigurar: true, motivo: "Sin precio de tarifario ni de Toma de Equipos para este modelo" });
  });

  return { trabajos: trabajos, precioTotal: precioTotal, horasEstimadas: horasEstimadas, estado: "COTIZADO" };
}

function calcularPresupuestoReparacion(d) {
  if (d && d.diagnostico) {
    return {
      trabajos: [],
      precioTotal: null,
      precioTexto: "A confirmar",
      horasEstimadas: 48,
      estado: "DIAGNOSTICO"
    };
  }

  const modelo = String((d && d.modelo) || "").trim();
  if (!modelo) throw new Error("❌ Seleccioná un modelo.");

  const equipo = obtenerPreciosToma().find(r => r.modelo === modelo);
  if (!equipo) throw new Error(`❌ "${modelo}" no encontrado en "Toma de Equipos".`);

  const config = obtenerConfiguracionReparaciones();
  const tarifario = obtenerTarifarioIcare_();
  return _calcularPresupuestoReparacionCore_(d, equipo, config, tarifario);
}

/**
 * obtenerTarifarioReparaciones()
 *
 * Parte 8 — NO guarda ni duplica precios: reutiliza el mismo núcleo de
 * cálculo que el formulario de recepción (_calcularPresupuestoReparacionCore_).
 * "Toma de Equipos", "CONFIG_REPARACIONES" y "TARIFARIO_ICARE" se leen UNA
 * sola vez cada una (antes se releían por cada modelo, dentro de
 * calcularPresupuestoReparacion) — ver Problema 3: esto es lo que eliminó
 * la demora real del módulo.
 */
function obtenerTarifarioReparaciones() {
  const todos = {};
  REPARACIONES_ITEMS_.forEach(it => { todos[it.key] = true; });

  const equipos   = obtenerPreciosToma();               // 1 sola lectura de "Toma de Equipos"
  const config    = obtenerConfiguracionReparaciones();  // 1 sola lectura de "CONFIG_REPARACIONES"
  const tarifario = obtenerTarifarioIcare_();             // 1 sola lectura de "TARIFARIO_ICARE"

  return equipos.map(equipo => {
    const presupuesto = _calcularPresupuestoReparacionCore_(Object.assign({ modelo: equipo.modelo }, todos), equipo, config, tarifario);
    return { modelo: equipo.modelo, trabajos: presupuesto.trabajos };
  });
}

/**
 * obtenerDashboardData()
 *
 * Alimenta las tarjetas del dashboard: stock, preventas por estado,
 * reparaciones abiertas, caja (pesos y USD reales, sin mezclar), ventas del
 * mes y ganancia del mes. Solo lectura — no modifica ninguna hoja.
 */
function obtenerDashboardData() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfigCached();

  // --- Stock: cantidad de equipos activos (hoja "Stock", encabezados fila 9) ---
  const stockSh = ss.getSheetByName(cfg.HOJA_STOCK || "Stock");
  const fES = 9;
  let stockCantidad = 0, valorStockEquipos = 0;
  if (stockSh) {
    const lastS = stockSh.getLastRow();
    if (lastS > fES) {
      stockCantidad = lastS - fES;
      const hdrsStockEq = stockSh.getRange(fES, 1, 1, 15).getValues()[0];
      const cPC = hdrsStockEq.findIndex(h => String(h).trim() === "Precio Compra / Consignación");
      if (cPC >= 0) {
        stockSh.getRange(fES + 1, cPC + 1, lastS - fES, 1).getValues().forEach(r => {
          valorStockEquipos += Number(r[0]) || 0;
        });
      }
    }
  }

  // --- Accesorios en stock (hoja "Stock Accesorios") ---
  let accesoriosStockCantidad = 0, valorStockAccesorios = 0, accesoriosBajoStock = 0;
  const stockAccSh = ss.getSheetByName("Stock Accesorios");
  if (stockAccSh) {
    const fEA = 2;
    const lastA = stockAccSh.getLastRow();
    if (lastA > fEA) {
      const hdrsA = stockAccSh.getRange(fEA, 1, 1, stockAccSh.getLastColumn()).getValues()[0];
      const idxA = (n) => hdrsA.findIndex(h => String(h).trim() === n);
      const cSTK = idxA("Stock"), cVS = idxA("Valor Stock"), cEST = idxA("Estado");
      stockAccSh.getRange(fEA + 1, 1, lastA - fEA, stockAccSh.getLastColumn()).getValues().forEach(row => {
        accesoriosStockCantidad += cSTK >= 0 ? Math.max(0, Number(row[cSTK]) || 0) : 0;
        valorStockAccesorios    += cVS  >= 0 ? (Number(row[cVS])  || 0) : 0;
        const estado = cEST >= 0 ? String(row[cEST] || "") : "";
        if (estado.indexOf("Bajo stock") >= 0 || estado.indexOf("Sin stock") >= 0) accesoriosBajoStock++;
      });
    }
  }

  // --- Preventas: pendientes (Esperando compra) / compradas ---
  let preventasPendientes = 0, preventasCompradas = 0;
  const preSheet = ss.getSheetByName("Preventas");
  if (preSheet) {
    const fE  = 2;
    const cES = getCol(preSheet, "Estado", fE);
    let cEstReg = -1;
    try { cEstReg = getCol(preSheet, "ESTADO_REGISTRO", fE); } catch (e) { /* columna opcional */ }
    const lastRow = preSheet.getLastRow();
    if (lastRow > fE) {
      const datosPre = preSheet.getRange(fE + 1, 1, lastRow - fE, preSheet.getLastColumn()).getValues();
      datosPre.forEach(row => {
        if (cEstReg >= 0 && String(row[cEstReg-1] || "").trim() === "ANULADO") return;
        const est = String(row[cES-1] || "");
        if (est.includes("Esperando compra")) preventasPendientes++;
        else if (est.includes("Comprado"))    preventasCompradas++;
      });
    }
  }

  // --- Reparaciones abiertas: todo lo que no esté ✅ Retirado ---
  let reparacionesAbiertas = 0;
  const repSheet = ss.getSheetByName(cfg.HOJA_REPARACIONES || "Reparaciones");
  if (repSheet) {
    const fE  = 2;
    const cES = getCol(repSheet, "Estado", fE);
    let cEstReg = -1;
    try { cEstReg = getCol(repSheet, "ESTADO_REGISTRO", fE); } catch (e) { /* columna opcional */ }
    const lastRow = repSheet.getLastRow();
    if (lastRow > fE) {
      const datosRep = repSheet.getRange(fE + 1, 1, lastRow - fE, repSheet.getLastColumn()).getValues();
      datosRep.forEach(row => {
        if (cEstReg >= 0 && String(row[cEstReg-1] || "").trim() === "ANULADO") return;
        if (row[cES-1] && !String(row[cES-1]).includes("Retirado")) reparacionesAbiertas++;
      });
    }
  }

  // --- Caja: pesos reales + USD reales (Cambio 3 — nunca mezclados) ---
  const saldos = obtenerSaldosCaja();
  const cajaPesos = saldos.Efectivo + saldos.Transferencia + saldos.Cuotas;
  const cajaUSD   = saldos.USD;

  // --- Ventas del mes / Ganancia del mes (hoja Ventas, mes calendario actual) ---
  let ventasMes = 0, gananciaMes = 0;
  const ventasSheet = ss.getSheetByName(cfg.HOJA_VENTAS || "Ventas");
  if (ventasSheet) {
    const fE  = 2;
    const vFV  = getCol(ventasSheet, "Fecha Venta",  fE);
    const vPV  = getCol(ventasSheet, "Precio Venta", fE);
    const vEst = getCol(ventasSheet, "Estado",       fE);
    const vGN  = getCol(ventasSheet, "Ganancia Neta", fE);
    let vGC = -1;
    try { vGC = getCol(ventasSheet, "Ganancia Cobrada", fE); } catch (e) { /* columna opcional */ }
    let vEstReg = -1;
    try { vEstReg = getCol(ventasSheet, "ESTADO_REGISTRO", fE); } catch (e) { /* columna opcional */ }

    const lastRow = ventasSheet.getLastRow();
    if (lastRow > fE) {
      const datos = ventasSheet.getRange(fE + 1, 1, lastRow - fE, ventasSheet.getLastColumn()).getValues();
      const hoy = new Date();
      datos.forEach(row => {
        const estado = String(row[vEst-1] || "");
        if (!estado) return;
        if (vEstReg >= 0 && String(row[vEstReg-1] || "").trim() === "ANULADO") return;
        const fecha = row[vFV-1];
        if (!(fecha instanceof Date)) return;
        if (fecha.getMonth() === hoy.getMonth() && fecha.getFullYear() === hoy.getFullYear()) {
          ventasMes   += Number(row[vPV-1]) || 0;
          gananciaMes += vGC >= 0 ? (Number(row[vGC-1]) || 0) : (Number(row[vGN-1]) || 0);
        }
      });
    }
  }

  return {
    stockCantidad,
    preventasPendientes,
    preventasCompradas,
    reparacionesAbiertas,
    cajaPesos,
    cajaUSD,
    ventasMes,
    gananciaMes,
    valorStockEquipos,
    accesoriosStockCantidad,
    valorStockAccesorios,
    accesoriosBajoStock
  };
}

// ============================================================
//  ACCESORIOS — data providers de solo lectura para la Web App
//  (Stock Accesorios, Stock General, Catálogo). No modifican ninguna hoja.
// ============================================================

/** Catálogo de accesorios (SKU_ID + identidad) — alimenta selects de producto en Compras/Ventas de accesorios. */
function obtenerCatalogoAccesorios() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CATALOGO_ACCESORIOS");
  if (!sheet) return [];
  const fE = 2;
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
  const cSKU = idx("SKU_ID"), cCAT = idx("Categoría"), cPRD = idx("Producto"), cMRC = idx("Marca"), cCOL = idx("Color");
  const lastRow = sheet.getLastRow();
  if (lastRow <= fE || cSKU === -1) return [];
  return sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues()
    .filter(row => String(row[cSKU] || "").trim())
    .map(row => ({
      skuId: String(row[cSKU]), categoria: String(row[cCAT] || ""), producto: String(row[cPRD] || ""),
      marca: String(row[cMRC] || ""), color: String(row[cCOL] || "")
    }));
}

/** Stock de accesorios completo — alimenta la vista "Stock Accesorios" y el selector de la venta de accesorios. */
function obtenerStockAccesorios() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Stock Accesorios");
  if (!sheet) return [];
  const fE = 2;
  const hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
  const cSKU = idx("SKU_ID"), cCAT = idx("Categoría"), cPRD = idx("Producto"), cMRC = idx("Marca"), cCOL = idx("Color"),
        cSTK = idx("Stock"), cCU = idx("Costo Unitario"), cCP = idx("COSTO_PROMEDIO"), cPV = idx("Precio Venta"),
        cSM = idx("Stock Mínimo"), cUBI = idx("UBICACION"), cVS = idx("Valor Stock"), cEST = idx("Estado");
  const lastRow = sheet.getLastRow();
  if (lastRow <= fE || cSKU === -1) return [];
  return sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues()
    .filter(row => String(row[cSKU] || "").trim())
    .map(row => ({
      skuId: String(row[cSKU]), categoria: String(row[cCAT] || ""), producto: String(row[cPRD] || ""),
      marca: String(row[cMRC] || ""), color: String(row[cCOL] || ""),
      stock: Number(row[cSTK]) || 0, costoUnitario: Number(row[cCU]) || 0, costoPromedio: Number(row[cCP]) || 0,
      precioVenta: Number(row[cPV]) || 0, stockMinimo: Number(row[cSM]) || 0, ubicacion: String(row[cUBI] || ""),
      valorStock: Number(row[cVS]) || 0, estado: String(row[cEST] || "")
    }));
}

/** Stock consolidado (equipos + accesorios) para la vista "Stock General" (pestañas Equipos/Accesorios/Todo). */
function obtenerStockGeneral() {
  const cfg = getConfigCached();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();

  const equipos = [];
  const stockSh = ss.getSheetByName(cfg.HOJA_STOCK || "Stock");
  if (stockSh) {
    const fES = 9;
    const hdrs = stockSh.getRange(fES, 1, 1, 15).getValues()[0];
    const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
    const cMo = idx("Modelo"), cIM = idx("IMEI"), cCo = idx("Color"),
          cPC = idx("Precio Compra / Consignación"), cPV = idx("Precio Est. Venta"), cEs = idx("Estado");
    const lastRow = stockSh.getLastRow();
    if (lastRow > fES) {
      stockSh.getRange(fES + 1, 1, lastRow - fES, 15).getValues().forEach(row => {
        equipos.push({
          modelo: cMo >= 0 ? String(row[cMo] || "") : "", imei: cIM >= 0 ? String(row[cIM] || "") : "",
          color:  cCo >= 0 ? String(row[cCo] || "") : "",
          costo:  cPC >= 0 ? (Number(row[cPC]) || 0) : 0, precioVenta: cPV >= 0 ? (Number(row[cPV]) || 0) : 0,
          estado: cEs >= 0 ? String(row[cEs] || "") : ""
        });
      });
    }
  }

  return { equipos: equipos, accesorios: obtenerStockAccesorios() };
}

// ============================================================
//  CALCULADORA DE CUOTAS — herramienta comercial de solo lectura.
//
//  Hoja "CONFIG_CUOTAS" (creada a mano, fila 1 = encabezados, igual
//  criterio que CONFIG_REGALOS): Cuotas | Coeficiente | Activo | Observaciones.
//
//  No guarda nada, no genera Libro Diario/Auditoría/Transacciones/Backups/
//  Health Checks — es puro cálculo en memoria a partir de la hoja, siempre
//  en vivo (un cambio de coeficiente en el Sheet se refleja sin redeploy).
// ============================================================

/** Lee CONFIG_CUOTAS en vivo. Devuelve [{cuotas, coeficiente}, ...] ordenado por cantidad de cuotas, excluyendo filas con Activo="NO" (celda vacía = activa, mismo criterio que ESTADO_REGISTRO en el resto del sistema). */
/**
 * obtenerConfiguracionCuotas()
 *
 * Robustecida: nunca rompe la Web App pase lo que pase en CONFIG_CUOTAS —
 * cualquier fila inválida se ignora y queda un warning en el Logger (Stackdriver),
 * nunca un throw. Reglas:
 *   - hoja inexistente / faltan columnas Cuotas o Coeficiente → devuelve [].
 *   - "Cuotas" vacío/0 o "Coeficiente" <= 0 → fila ignorada + warning.
 *   - "Cuotas" repetida entre filas válidas → se queda con la primera, la
 *     repetida se ignora + warning.
 *   - "Activo" inexistente → todas las filas se consideran activas.
 *   - "Mostrar" inexistente → se agrega sola (asegurarColumnaGenerica_, mismo
 *     criterio que "Monto USD" en Gastos) y se asume SI para no romper
 *     configuraciones ya cargadas antes de este cambio.
 *   - "Activo"="NO" → la cuota deja de existir para el sistema (no se calcula).
 *   - "Mostrar"="NO" → la cuota se sigue calculando (para uso interno futuro),
 *     pero viaja marcada `mostrar:false` para que el frontend la oculte.
 */
function obtenerConfiguracionCuotas() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CONFIG_CUOTAS");
  if (!sheet) {
    Logger.log("⚠️ obtenerConfiguracionCuotas: hoja 'CONFIG_CUOTAS' no encontrada.");
    return [];
  }

  const fE = 1;
  let hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);

  const cCuo = idx("Cuotas"), cCoef = idx("Coeficiente");
  if (cCuo === -1 || cCoef === -1) {
    Logger.log('⚠️ obtenerConfiguracionCuotas: faltan columnas "Cuotas"/"Coeficiente" en CONFIG_CUOTAS.');
    return [];
  }

  let cMostrar = idx("Mostrar");
  if (cMostrar === -1) {
    asegurarColumnaGenerica_(sheet, fE, "Mostrar");
    hdrs = sheet.getRange(fE, 1, 1, sheet.getLastColumn()).getValues()[0];
    cMostrar = idx("Mostrar");
  }
  const cAct = idx("Activo");

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) return [];

  const vistos = {};
  const resultado = [];
  sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues().forEach((row, i) => {
    const filaVisible = fE + 1 + i;

    const cuotas = Number(row[cCuo]) || 0;
    if (cuotas <= 0) {
      Logger.log(`⚠️ CONFIG_CUOTAS fila ${filaVisible}: "Cuotas" vacío o inválido — se ignora.`);
      return;
    }
    const coeficiente = Number(row[cCoef]) || 0;
    if (coeficiente <= 0) {
      Logger.log(`⚠️ CONFIG_CUOTAS fila ${filaVisible} (Cuotas=${cuotas}): "Coeficiente" inválido (<= 0) — se ignora.`);
      return;
    }
    if (cAct >= 0) {
      const activo = String(row[cAct] || "").trim().toUpperCase();
      if (activo === "NO") return; // desactivada a propósito: no es un warning
    }
    if (vistos[cuotas]) {
      Logger.log(`⚠️ CONFIG_CUOTAS fila ${filaVisible}: "Cuotas"=${cuotas} repetida (ya definida en otra fila) — se ignora.`);
      return;
    }
    vistos[cuotas] = true;

    const mostrarTxt = cMostrar >= 0 ? String(row[cMostrar] || "").trim().toUpperCase() : "";
    const mostrar = mostrarTxt !== "NO"; // vacío o "SI" = true (mismo criterio "blanco = activo" del resto del sistema)

    resultado.push({ cuotas: cuotas, coeficiente: coeficiente, mostrar: mostrar });
  });

  resultado.sort((a, b) => a.cuotas - b.cuotas);
  return resultado;
}

/**
 * calcularCuotas(monto)
 *
 * total = monto × coeficiente ; valorCuota = total / cuotas — redondeados
 * con Math.round(), mismo criterio de redondeo que ya usa todo el ERP
 * (costoPromedio, Valor Stock, Monto ARS de Cambio de Moneda, etc.).
 * Devuelve [] si el monto no es válido o no hay coeficientes configurados.
 */
function calcularCuotas(monto) {
  const montoNum = Number(monto) || 0;
  if (montoNum <= 0) return [];

  return obtenerConfiguracionCuotas().map(c => {
    const total = Math.round(montoNum * c.coeficiente);
    const valorCuota = Math.round(total / c.cuotas);
    return { cuotas: c.cuotas, coeficiente: c.coeficiente, total: total, valorCuota: valorCuota, mostrar: c.mostrar };
  });
}

// ============================================================
//  Wrapper público para funciones "privadas" (sufijo "_") de operadores.gs
//  que la Web App necesita invocar directamente con google.script.run.
//
//  Causa raíz del bug "Ver"/"Corregir" no hacen nada en Mis Operaciones:
//  Apps Script trata cualquier función cuyo nombre termine en "_" como
//  privada y NO genera un stub para ella en el objeto google.script.run del
//  cliente (por eso Logger.log(typeof obtenerOperacionCompleta_) funciona
//  desde el editor — ejecución server-side directa — pero
//  google.script.run....obtenerOperacionCompleta_ no existe en el navegador).
//
//  Solución: NO se modifica obtenerOperacionCompleta_() ni operadores.gs.
//  Se agrega acá un wrapper público que delega 100% en ella; el frontend
//  llama a este wrapper en vez de a la función privada.
// ============================================================
function obtenerOperacionCompletaWeb(numero) {
  return obtenerOperacionCompleta_(numero);
}

/** Misma función, pero sin traer movimientos de Libro Diario ni líneas de Compras Accesorios (incluirExtras=false) — usada por el botón "✏️ Editar" de Mis Operaciones, que no necesita ese detalle y así evita escanear Libro Diario completo solo para abrir el formulario de corrección. */
function obtenerOperacionParaCorregirWeb(numero) {
  return obtenerOperacionCompleta_(numero, false);
}
