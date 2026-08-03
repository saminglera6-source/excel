// ============================================================
//  DÍAS HÁBILES — utilidades reutilizables para todo el ERP.
//
//  Única fuente de feriados: hoja "CONFIG_FERIADOS" (Fecha | Descripción,
//  encabezado en la fila 1 — a crear a mano en el Sheet, mismo criterio que
//  CONFIG_REPARACIONES/CONFIG_REGALOS/CONFIG_CUOTAS: config de negocio, no
//  se autogenera). NINGÚN feriado va hardcodeado en código.
//
//  Hoy lo usa Preventas (plazo de entrega de 7 a 10 días hábiles), pero
//  está pensado para que cualquier otro módulo del ERP que necesite
//  proyectar un plazo en días hábiles lo reutilice sin duplicar nada.
// ============================================================

/** Date → "YYYY-MM-DD" (clave estable para comparar/indexar fechas sin hora). */
function _formatoFechaISO_(fecha) {
  return Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/**
 * obtenerFeriados_()
 *
 * Lee "CONFIG_FERIADOS" y devuelve un mapa { "YYYY-MM-DD": "Descripción" }.
 * Nunca rompe: hoja inexistente o sin columna "Fecha" → mapa vacío (ningún
 * feriado conocido, solo se excluyen sábados/domingos). Filas sin fecha o
 * con fecha inválida se ignoran en silencio (no hace falta que estén en
 * orden ni contiguas — a diferencia de un catálogo de modelos, acá un
 * "hueco" en el medio es perfectamente normal).
 */
function obtenerFeriados_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("CONFIG_FERIADOS");
  const feriados = {};
  if (!sh) return feriados;

  const fE = 1;
  const hdrs = sh.getRange(fE, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = (n) => hdrs.findIndex(h => String(h).trim() === n);
  const cFecha = idx("Fecha");
  const cDesc  = idx("Descripción");
  if (cFecha === -1) {
    Logger.log('⚠️ obtenerFeriados_: falta la columna "Fecha" en CONFIG_FERIADOS.');
    return feriados;
  }

  const lastRow = sh.getLastRow();
  if (lastRow <= fE) return feriados;

  sh.getRange(fE + 1, 1, lastRow - fE, sh.getLastColumn()).getValues().forEach(row => {
    const celda = row[cFecha];
    if (!celda) return;
    const fecha = (celda instanceof Date) ? celda : parseDate(celda);
    if (!fecha || isNaN(fecha.getTime())) return;
    feriados[_formatoFechaISO_(fecha)] = cDesc >= 0 ? String(row[cDesc] || "").trim() : "";
  });
  return feriados;
}

/** true si `fecha` (Date) es sábado o domingo. */
function esFinDeSemana_(fecha) {
  const dia = fecha.getDay();
  return dia === 0 || dia === 6;
}

/** true si `fecha` (Date) está cargada en CONFIG_FERIADOS. `feriadosOpcional` evita releer la hoja si ya se tiene el mapa (ej. dentro de un loop). */
function esFeriado_(fecha, feriadosOpcional) {
  const feriados = feriadosOpcional || obtenerFeriados_();
  return !!feriados[_formatoFechaISO_(fecha)];
}

/** true si `fecha` es día hábil: ni fin de semana ni feriado. */
function esDiaHabil_(fecha, feriadosOpcional) {
  const feriados = feriadosOpcional || obtenerFeriados_();
  return !esFinDeSemana_(fecha) && !esFeriado_(fecha, feriados);
}

/**
 * sumarDiasHabiles_(fechaBase, cantidadDias, feriadosOpcional)
 *
 * Suma `cantidadDias` días HÁBILES a partir de `fechaBase` (sin contar la
 * fecha base), saltando sábados/domingos/feriados. Devuelve un Date nuevo
 * (no muta `fechaBase`). Reutilizable por cualquier módulo que necesite
 * proyectar un plazo en días hábiles.
 */
function sumarDiasHabiles_(fechaBase, cantidadDias, feriadosOpcional) {
  const feriados = feriadosOpcional || obtenerFeriados_();
  let fecha = new Date(fechaBase.getFullYear(), fechaBase.getMonth(), fechaBase.getDate());
  let contados = 0;
  while (contados < cantidadDias) {
    fecha = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + 1);
    if (esDiaHabil_(fecha, feriados)) contados++;
  }
  return fecha;
}

/**
 * calcularRangoEntregaPreventa(fecha)
 *
 * Función pública (llamada desde preventas.html vía google.script.run).
 * `fecha`: string "YYYY-MM-DD" (tal cual manda <input type="date">) o Date.
 * Devuelve { fechaMinima, fechaMaxima, feriados } — el plazo de 7 a 10 días
 * hábiles desde `fecha`, más el mapa de feriados ya cargado (así el
 * frontend no necesita otra llamada para validar el datepicker).
 */
function calcularRangoEntregaPreventa(fecha) {
  const base = (fecha instanceof Date) ? fecha : parseDate(fecha);
  if (!base || isNaN(base.getTime())) throw new Error("❌ Fecha de preventa inválida.");

  const feriados = obtenerFeriados_(); // 1 sola lectura, reutilizada para ambos cálculos
  const minima = sumarDiasHabiles_(base, 7, feriados);
  const maxima = sumarDiasHabiles_(base, 10, feriados);

  return {
    fechaMinima: _formatoFechaISO_(minima),
    fechaMaxima: _formatoFechaISO_(maxima),
    feriados: feriados
  };
}

/**
 * validarFechaEntregaPreventa_(fechaEntregaRaw, rango)
 *
 * Validación de backend (nunca confía en el frontend): rechaza
 * `fechaEntregaRaw` si cae en fin de semana, en un feriado de
 * CONFIG_FERIADOS, o fuera de [rango.fechaMinima, rango.fechaMaxima].
 * `rango` = resultado de calcularRangoEntregaPreventa() (ya trae los
 * feriados cargados, no se vuelve a leer la hoja). Mensajes de error
 * claros, indicando el motivo exacto del rechazo.
 */
function validarFechaEntregaPreventa_(fechaEntregaRaw, rango) {
  const fechaEntrega = parseDate(fechaEntregaRaw);
  if (!fechaEntrega || isNaN(fechaEntrega.getTime())) {
    throw new Error("❌ Fecha estimada de entrega inválida.");
  }
  if (esFinDeSemana_(fechaEntrega)) {
    throw new Error(`❌ La fecha estimada de entrega (${fmt(fechaEntrega)}) cae en fin de semana — elegí un día hábil.`);
  }
  const key = _formatoFechaISO_(fechaEntrega);
  if (rango.feriados[key]) {
    throw new Error(`❌ La fecha estimada de entrega (${fmt(fechaEntrega)}) es feriado (${rango.feriados[key]}) — elegí otro día hábil.`);
  }
  if (key < rango.fechaMinima || key > rango.fechaMaxima) {
    throw new Error(`❌ La fecha estimada de entrega (${fmt(fechaEntrega)}) debe estar entre ${fmt(parseDate(rango.fechaMinima))} y ${fmt(parseDate(rango.fechaMaxima))} (7 a 10 días hábiles desde la fecha de preventa).`);
  }
}
