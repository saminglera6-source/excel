// ============================================================
//  GESTIÓN FINANCIERA Y RENTABILIDAD — FASE 2
//  (Flujo de Fondos + Escenarios + VAN/TIR + Análisis de Sensibilidad)
//
//  Se apoya 100% en finanzas.gs (Fase 1): la "base" de toda proyección
//  es el promedio real de los últimos 3 meses que ya calcula
//  calcularEstadoResultados() — no se vuelve a pedir nada a mano salvo
//  los supuestos de crecimiento/escenario en sí.
//
//  Sin balance patrimonial (no aplica a este negocio). El escenario
//  "Financiado" es una SIMULACIÓN: el préstamo y su cuota solo existen
//  dentro de este cálculo de proyección, nunca tocan el Estado de
//  Resultados real de Fase 1 (Gastos Financieros ahí sigue en 0 hasta
//  que haya un préstamo real).
// ============================================================

const FIN_HOJA_ESCENARIOS = "FINANZAS_ESCENARIOS_GUARDADOS";

function _finAsegurarHojaEscenarios_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return _finAsegurarHoja_(ss, FIN_HOJA_ESCENARIOS, [
    "ID", "Nombre", "Fecha Guardado", "Parámetros (JSON)"
  ]);
}

// ------------------------------------------------------------
//  Base de proyección: promedio real de los últimos 3 meses
// ------------------------------------------------------------

function _finBaseRunRate_() {
  const hoy = new Date();
  const meses = [];
  for (let i = 0; i < 3; i++) {
    const f = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push(calcularEstadoResultados(f.getFullYear(), f.getMonth() + 1));
  }
  const prom = (campo) => meses.reduce((s, m) => s + (Number(m[campo]) || 0), 0) / meses.length;
  const unidadesProm = prom("unidadesVendidas");
  const ventasProm = prom("ventas");
  return {
    ventas: ventasProm,
    costoVariable: prom("costoVariable"),
    costosFijos: prom("costosFijos"),
    amortizacion: prom("amortizacion"),
    manoDeObra: prom("manoDeObra"),
    unidadesVendidas: unidadesProm,
    precioPromedio: unidadesProm > 0 ? (ventasProm / unidadesProm) : 0
  };
}

/** Igual que _finBaseRunRate_() pero pública, para que el frontend precargue los valores base al abrir el módulo de sensibilidad (sin tener que adivinarlos). */
function obtenerBaseProyeccion() { return _finBaseRunRate_(); }

// ------------------------------------------------------------
//  TIR por bisección (Apps Script no trae IRR() nativo) — busca la
//  tasa que hace VAN=0 entre -99% y +500% mensual. Devuelve null si
//  el flujo no cambia de signo (no hay raíz real en ese rango).
// ------------------------------------------------------------

function _finVAN_(flujos, tasa) {
  return flujos.reduce((s, f, t) => s + f / Math.pow(1 + tasa, t), 0);
}

function _finTIR_(flujos) {
  let low = -0.99, high = 5;
  let vLow = _finVAN_(flujos, low), vHigh = _finVAN_(flujos, high);
  if (isNaN(vLow) || isNaN(vHigh) || vLow * vHigh > 0) return null;
  let mid = 0;
  for (let i = 0; i < 200; i++) {
    mid = (low + high) / 2;
    const vMid = _finVAN_(flujos, mid);
    if (Math.abs(vMid) < 1) return mid; // "$1" de tolerancia alcanza sobrado para esta escala
    if (vLow * vMid < 0) { high = mid; vHigh = vMid; } else { low = mid; vLow = vMid; }
  }
  return mid;
}

/** Cuota fija (sistema francés) de un préstamo — 0 si no hay tasa (préstamo a tasa 0, cuota = capital/plazo). */
function _finCuotaPrestamo_(monto, tasaAnualPct, plazoAnios) {
  monto = Number(monto) || 0;
  if (monto <= 0) return 0;
  const nCuotas = (Number(plazoAnios) || 1) * 12;
  const tasaMensual = Math.pow(1 + (Number(tasaAnualPct) || 0) / 100, 1 / 12) - 1;
  if (tasaMensual <= 0) return monto / nCuotas;
  return monto * (tasaMensual * Math.pow(1 + tasaMensual, nCuotas)) / (Math.pow(1 + tasaMensual, nCuotas) - 1);
}

// ------------------------------------------------------------
//  FLUJO DE FONDOS — el cálculo central de la Fase 2
// ------------------------------------------------------------

/**
 * calcularFlujoDeFondos(params)
 *
 * params = {
 *   mesesProyeccion, inversionInicial, tasaDescuentoAnual (%),
 *   crecVentasMensualPct, crecCostosMensualPct,
 *   financiado: { monto, tasaAnual, plazoAnios } | null,
 *   // override opcional de la base real (lo usa calcularSensibilidad*
 *   // para variar un supuesto sin tocar los datos reales del ERP):
 *   baseOverride: { ventas, costoVariable, costosFijos, amortizacion, manoDeObra } | null
 * }
 *
 * Devuelve el detalle mes a mes, VAN (a la tasa de descuento pedida) y
 * TIR (mensual y anualizada). La amortización se sub-suma en el flujo
 * de caja (no es una salida real de plata, aunque sí resta en el
 * Resultado Neto) — mismo criterio contable que separa "ganar" de
 * "tener caja".
 */
function calcularFlujoDeFondos(params) {
  const meses = Math.max(1, Number(params.mesesProyeccion) || 12);
  const tasaDescuentoMensual = Math.pow(1 + (Number(params.tasaDescuentoAnual) || 0) / 100, 1 / 12) - 1;
  const crecV = (Number(params.crecVentasMensualPct) || 0) / 100;
  const crecC = (Number(params.crecCostosMensualPct) || 0) / 100;

  const base = params.baseOverride || _finBaseRunRate_();

  let cuotaPrestamo = 0, montoPrestamo = 0;
  if (params.financiado && Number(params.financiado.monto) > 0) {
    montoPrestamo = Number(params.financiado.monto);
    cuotaPrestamo = _finCuotaPrestamo_(montoPrestamo, params.financiado.tasaAnual, params.financiado.plazoAnios);
  }

  const inversionInicial = Number(params.inversionInicial) || 0;
  const inversionNeta = inversionInicial - montoPrestamo; // lo que hay que poner de bolsillo, neto del préstamo

  const flujos = [-inversionNeta];
  const detalle = [{
    mes: 0, ventas: 0, costos: 0, resultadoNeto: 0, cuotaPrestamo: 0,
    flujoNeto: -inversionNeta, flujoAcumulado: -inversionNeta
  }];

  let acumulado = -inversionNeta;
  for (let m = 1; m <= meses; m++) {
    const ventas = base.ventas * Math.pow(1 + crecV, m);
    const costoVariable = base.costoVariable * Math.pow(1 + crecC, m);
    const costosFijos = base.costosFijos * Math.pow(1 + crecC, m);
    const manoDeObra = base.manoDeObra * Math.pow(1 + crecC, m);
    const amortizacion = base.amortizacion; // valor contable fijo, no crece con costos operativos

    const utilidadBruta = ventas - costoVariable;
    const resultadoAntesImp = utilidadBruta - costosFijos - amortizacion - manoDeObra - cuotaPrestamo;
    const impuesto = resultadoAntesImp > 0 ? resultadoAntesImp * _finImpuestoGananciasFraccion_() : 0;
    const resultadoNeto = resultadoAntesImp - impuesto;
    const flujoNeto = resultadoNeto + amortizacion;

    acumulado += flujoNeto;
    flujos.push(flujoNeto);
    detalle.push({
      mes: m, ventas,
      costos: costoVariable + costosFijos + manoDeObra + amortizacion + cuotaPrestamo,
      resultadoNeto, cuotaPrestamo, flujoNeto, flujoAcumulado: acumulado
    });
  }

  const van = _finVAN_(flujos, tasaDescuentoMensual);
  const tirMensual = _finTIR_(flujos);
  const tirAnual = tirMensual == null ? null : Math.pow(1 + tirMensual, 12) - 1;

  return { detalle, van, tirMensual, tirAnual, cuotaPrestamo, inversionNeta, base };
}

// ------------------------------------------------------------
//  ESCENARIOS GUARDADOS — "qué pasa si..." con nombre, para comparar
// ------------------------------------------------------------

function obtenerEscenariosGuardados() {
  const sheet = _finAsegurarHojaEscenarios_();
  return _finLeerHoja_(sheet).map(e => {
    try { e["Parámetros"] = JSON.parse(e["Parámetros (JSON)"]); } catch (err) { e["Parámetros"] = {}; }
    return e;
  });
}

/** d = { nombre, parametros: {...los mismos que recibe calcularFlujoDeFondos...} } */
function guardarEscenario(d) {
  if (!String(d.nombre || "").trim()) throw new Error("❌ Ingresá un nombre para el supuesto.");
  const sheet = _finAsegurarHojaEscenarios_();
  const id = _finProximoId_(sheet);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 4).setValues([[
    id, d.nombre.trim(), _finFmtFecha_(new Date()), JSON.stringify(d.parametros || {})
  ]]);
  return "✅ Supuesto \"" + d.nombre.trim() + "\" guardado.";
}

function eliminarEscenario(id) {
  const sheet = _finAsegurarHojaEscenarios_();
  const last = sheet.getLastRow();
  if (last <= 1) throw new Error("❌ No hay supuestos guardados.");
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) { sheet.deleteRow(i + 2); return "✅ Supuesto eliminado."; }
  }
  throw new Error("❌ No se encontró el supuesto.");
}

// ------------------------------------------------------------
//  ANÁLISIS DE SENSIBILIDAD — 3 tablas de doble entrada (mismo
//  criterio que el Excel del dueño: TIR anual como resultado, en una
//  grilla de 7×7 pasos alrededor del valor base real).
// ------------------------------------------------------------

const FIN_SENS_PASOS = 7; // 7x7 — suficiente para leer la tendencia sin saturar la pantalla
const FIN_SENS_RANGO_PCT = 40; // ±40% alrededor del centro, mismo rango que usaba el Excel

/** Genera FIN_SENS_PASOS valores entre centro×(1-rango) y centro×(1+rango), centro incluido en el medio. */
function _finRangoValores_(centro, rangoPct) {
  const valores = [];
  const paso = (2 * rangoPct / 100) / (FIN_SENS_PASOS - 1);
  for (let i = 0; i < FIN_SENS_PASOS; i++) {
    const factor = 1 - (rangoPct / 100) + (i * paso);
    valores.push(centro * factor);
  }
  return valores;
}

/**
 * calcularSensibilidad(tipo, paramsBase)
 * tipo: "costos" (Costos Fijos × Costo Variable) | "precio_cantidad"
 *       (Precio × Cantidad) | "prestamo" (Monto prestado × Años)
 * paramsBase: los mismos parámetros de calcularFlujoDeFondos() —
 *   mesesProyeccion, inversionInicial, tasaDescuentoAnual, crecimientos.
 * Devuelve { filas: [...valores eje Y], columnas: [...valores eje X], tir: [[...]] } — tir[fila][columna], en fracción (0.12 = 12%).
 */
function calcularSensibilidad(tipo, paramsBase) {
  const base = _finBaseRunRate_();

  if (tipo === "costos") {
    const filasVal = _finRangoValores_(base.costosFijos, FIN_SENS_RANGO_PCT);
    const columnasVal = _finRangoValores_(base.costoVariable, FIN_SENS_RANGO_PCT);
    const tir = filasVal.map(costosFijos => columnasVal.map(costoVariable => {
      const r = calcularFlujoDeFondos(Object.assign({}, paramsBase, {
        baseOverride: Object.assign({}, base, { costosFijos, costoVariable })
      }));
      return r.tirAnual;
    }));
    return { filas: filasVal, columnas: columnasVal, tir, etiquetaFila: "Costos Fijos", etiquetaColumna: "Costo Variable" };
  }

  if (tipo === "precio_cantidad") {
    const filasVal = _finRangoValores_(base.precioPromedio, FIN_SENS_RANGO_PCT);
    const columnasVal = _finRangoValores_(base.unidadesVendidas, FIN_SENS_RANGO_PCT);
    const tir = filasVal.map(precio => columnasVal.map(cantidad => {
      const ventas = precio * cantidad;
      // El costo variable escala proporcional a la cantidad (mismo costo por unidad que hoy).
      const costoVariablePorUnidad = base.unidadesVendidas > 0 ? (base.costoVariable / base.unidadesVendidas) : 0;
      const r = calcularFlujoDeFondos(Object.assign({}, paramsBase, {
        baseOverride: Object.assign({}, base, { ventas, costoVariable: costoVariablePorUnidad * cantidad })
      }));
      return r.tirAnual;
    }));
    return { filas: filasVal, columnas: columnasVal, tir, etiquetaFila: "Precio promedio", etiquetaColumna: "Cantidad vendida (unidades/mes)" };
  }

  if (tipo === "prestamo") {
    const montoBase = Number(paramsBase.financiado && paramsBase.financiado.monto) || Math.max(1000000, base.ventas);
    const filasVal = [2, 3, 4, 5, 6, 7, 8]; // años de plazo — no tiene sentido "sensibilizar" esto en % como los otros dos
    const columnasVal = _finRangoValores_(montoBase, FIN_SENS_RANGO_PCT);
    const tir = filasVal.map(plazoAnios => columnasVal.map(monto => {
      const r = calcularFlujoDeFondos(Object.assign({}, paramsBase, {
        baseOverride: base,
        financiado: { monto, tasaAnual: (paramsBase.financiado && paramsBase.financiado.tasaAnual) || 60, plazoAnios }
      }));
      return r.tirAnual;
    }));
    return { filas: filasVal, columnas: columnasVal, tir, etiquetaFila: "Plazo (años)", etiquetaColumna: "Monto prestado" };
  }

  throw new Error("❌ Tipo de sensibilidad no reconocido: " + tipo);
}
