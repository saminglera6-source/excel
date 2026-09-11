// ============================================================
//  GESTIÓN FINANCIERA — AGENDA DE PAGOS
//
//  Pensado para que el jefe sepa día a día qué tiene que pagar,
//  y pueda agregar / editar / pausar / eliminar cualquier pago con
//  total libertad, como en un Excel. A diferencia de los costos de
//  Fase 1 (que llevan historial por vigencia para no romper el
//  Estado de Resultados), acá los pagos se editan y borran directo
//  — es una agenda, no un libro contable.
//
//  Un "pago" puede ser:
//    - Mensual: se repite todos los meses en un día fijo (ej: alquiler
//      el día 5). Si el mes no tiene ese día (ej: día 31 en febrero),
//      cae en el último día del mes.
//    - Único: una sola vez, en una fecha puntual (ej: una compra en
//      cuotas que termina en marzo).
//
//  Cada vez que se paga una cuota se registra en un log aparte
//  (FINANZAS_PAGOS_REALIZADOS) para poder tildarlo como pagado ese
//  mes puntual, sin perder el pago recurrente para el mes que viene.
// ============================================================

const FIN_HOJA_PAGOS = "FINANZAS_PAGOS";
const FIN_HOJA_PAGOS_REALIZADOS = "FINANZAS_PAGOS_REALIZADOS";

function _finAsegurarHojaPagos_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return _finAsegurarHoja_(ss, FIN_HOJA_PAGOS, [
    "ID", "Concepto", "Categoría", "Monto", "Moneda",
    "Frecuencia", "Día de Pago", "Fecha Único", "Activo", "Notas", "Fecha Creación"
  ]);
}

function _finAsegurarHojaPagosRealizados_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return _finAsegurarHoja_(ss, FIN_HOJA_PAGOS_REALIZADOS, [
    "ID", "ID Pago", "Concepto", "Monto Pagado", "Moneda", "Fecha Pago", "Mes Correspondiente"
  ]);
}

function _finDiasEnMes_(anio, mes1based) {
  return new Date(anio, mes1based, 0).getDate();
}

// ------------------------------------------------------------
//  CRUD de pagos
// ------------------------------------------------------------

function obtenerPagos() {
  const sheet = _finAsegurarHojaPagos_();
  return _finLeerHoja_(sheet);
}

function guardarPago(d) {
  const concepto = String(d.concepto || "").trim();
  if (!concepto) throw new Error("❌ Ingresá un concepto para el pago.");
  const monto = Number(d.monto) || 0;
  if (monto <= 0) throw new Error("❌ El monto tiene que ser mayor a 0.");
  if (d.frecuencia === "Mensual") {
    const dia = Number(d.diaPago);
    if (!dia || dia < 1 || dia > 31) throw new Error("❌ Elegí un día de pago válido (1 a 31).");
  } else if (d.frecuencia === "Único") {
    if (!d.fechaUnico) throw new Error("❌ Elegí la fecha del pago único.");
  } else {
    throw new Error("❌ Frecuencia no válida.");
  }

  const sheet = _finAsegurarHojaPagos_();

  if (d.id) {
    // Edición directa in-place: es una agenda, no un histórico contable.
    const last = sheet.getLastRow();
    const ids = last > 1 ? sheet.getRange(2, 1, last - 1, 1).getValues() : [];
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(d.id)) {
        const fila = i + 2;
        sheet.getRange(fila, 2, 1, 8).setValues([[
          concepto, d.categoria || "Otro", monto, d.moneda || "ARS",
          d.frecuencia, d.frecuencia === "Mensual" ? Number(d.diaPago) : "",
          d.frecuencia === "Único" ? d.fechaUnico : "",
          sheet.getRange(fila, 9).getValue() === false ? false : true
        ]]);
        sheet.getRange(fila, 10).setValue(d.notas || "");
        return "✅ Pago \"" + concepto + "\" actualizado.";
      }
    }
    throw new Error("❌ No se encontró el pago a editar.");
  }

  const id = _finProximoId_(sheet);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 11).setValues([[
    id, concepto, d.categoria || "Otro", monto, d.moneda || "ARS",
    d.frecuencia, d.frecuencia === "Mensual" ? Number(d.diaPago) : "",
    d.frecuencia === "Único" ? d.fechaUnico : "",
    true, d.notas || "", _finFmtFecha_(new Date())
  ]]);
  return "✅ Pago \"" + concepto + "\" agregado a la agenda.";
}

function _finBuscarFilaPago_(sheet, id) {
  const last = sheet.getLastRow();
  if (last <= 1) return -1;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function eliminarPago(id) {
  const sheet = _finAsegurarHojaPagos_();
  const fila = _finBuscarFilaPago_(sheet, id);
  if (fila === -1) throw new Error("❌ No se encontró el pago.");
  sheet.deleteRow(fila);
  return "✅ Pago eliminado de la agenda.";
}

function pausarPago(id) {
  const sheet = _finAsegurarHojaPagos_();
  const fila = _finBuscarFilaPago_(sheet, id);
  if (fila === -1) throw new Error("❌ No se encontró el pago.");
  sheet.getRange(fila, 9).setValue(false);
  return "✅ Pago pausado (no va a aparecer más en la agenda hasta que lo reactives).";
}

function reanudarPago(id) {
  const sheet = _finAsegurarHojaPagos_();
  const fila = _finBuscarFilaPago_(sheet, id);
  if (fila === -1) throw new Error("❌ No se encontró el pago.");
  sheet.getRange(fila, 9).setValue(true);
  return "✅ Pago reactivado.";
}

// ------------------------------------------------------------
//  Agenda mensual: qué pagos caen en un mes puntual, y cuáles
//  de ellos ya se marcaron como pagados
// ------------------------------------------------------------

function obtenerAgendaMes(anio, mes1based) {
  const pagos = obtenerPagos().filter(function (p) { return p["Activo"] !== false; });
  const diasDelMes = _finDiasEnMes_(anio, mes1based);
  const claveMes = anio + "-" + String(mes1based).padStart(2, "0");

  const realizadosSheet = _finAsegurarHojaPagosRealizados_();
  const realizados = _finLeerHoja_(realizadosSheet).filter(function (r) {
    return String(r["Mes Correspondiente"]) === claveMes;
  });
  const realizadosPorPago = {};
  realizados.forEach(function (r) { realizadosPorPago[String(r["ID Pago"])] = r; });

  const items = [];
  pagos.forEach(function (p) {
    let dia = null;
    if (p["Frecuencia"] === "Mensual") {
      dia = Math.min(Number(p["Día de Pago"]), diasDelMes);
    } else if (p["Frecuencia"] === "Único") {
      const f = new Date(p["Fecha Único"]);
      if (f.getFullYear() === anio && (f.getMonth() + 1) === mes1based) dia = f.getDate();
    }
    if (dia == null) return;
    const realizado = realizadosPorPago[String(p["ID"])];
    items.push({
      idPago: p["ID"], concepto: p["Concepto"], categoria: p["Categoría"],
      monto: p["Monto"], moneda: p["Moneda"], frecuencia: p["Frecuencia"],
      notas: p["Notas"], dia: dia,
      pagado: !!realizado,
      idRealizado: realizado ? realizado["ID"] : null,
      montoPagado: realizado ? realizado["Monto Pagado"] : null
    });
  });

  items.sort(function (a, b) { return a.dia - b.dia; });

  const cotizacion = obtenerCotizacionUSD();
  let totalMes = 0, totalPagado = 0, totalPendiente = 0;
  items.forEach(function (it) {
    const enArs = _finAMonedaARS_(it.monto, it.moneda, cotizacion);
    totalMes += enArs;
    if (it.pagado) totalPagado += enArs; else totalPendiente += enArs;
  });

  const hoy = new Date();
  const esMesActual = (hoy.getFullYear() === anio && (hoy.getMonth() + 1) === mes1based);

  return {
    items: items, totalMes: totalMes, totalPagado: totalPagado, totalPendiente: totalPendiente,
    diaHoy: esMesActual ? hoy.getDate() : null
  };
}

function marcarPagoRealizado(d) {
  const idPago = d.idPago, anio = d.anio, mes1based = d.mes, montoPagado = d.montoPagado, moneda = d.moneda;
  const sheet = _finAsegurarHojaPagosRealizados_();
  const claveMes = anio + "-" + String(mes1based).padStart(2, "0");
  const existentes = _finLeerHoja_(sheet);
  const yaExiste = existentes.some(function (r) {
    return String(r["ID Pago"]) === String(idPago) && String(r["Mes Correspondiente"]) === claveMes;
  });
  if (yaExiste) throw new Error("❌ Este pago ya estaba marcado como pagado este mes.");

  const pagos = obtenerPagos();
  const pago = pagos.filter(function (p) { return String(p["ID"]) === String(idPago); })[0];
  if (!pago) throw new Error("❌ No se encontró el pago.");

  const id = _finProximoId_(sheet);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 7).setValues([[
    id, idPago, pago["Concepto"], Number(montoPagado) || pago["Monto"],
    moneda || pago["Moneda"], _finFmtFecha_(new Date()), claveMes
  ]]);
  return "✅ Marcado como pagado.";
}

function desmarcarPagoRealizado(idRealizado) {
  const sheet = _finAsegurarHojaPagosRealizados_();
  const last = sheet.getLastRow();
  if (last <= 1) throw new Error("❌ No hay pagos registrados.");
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(idRealizado)) { sheet.deleteRow(i + 2); return "✅ Desmarcado."; }
  }
  throw new Error("❌ No se encontró el registro de pago.");
}
