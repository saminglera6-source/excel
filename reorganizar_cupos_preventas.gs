/**
 * ============================================================
 *  REORGANIZAR CUPOS DE PREVENTAS
 * ============================================================
 * Algunas preventas se cargaron desde una versión vieja del sistema, antes
 * de que existiera el cupo diario de entregas (_capacidadEntregaPreventa_,
 * operadores.gs: 3 equipos / $2.500.000 por día normal, 5 equipos /
 * $5.000.000 para el bloque de los últimos 5 días del mes) — por eso hay
 * fechas de entrega ("Fecha Prometida Hasta") que hoy violan esas reglas.
 *
 * Esto NO toca procesarPreventaConOperador() ni la lógica de cupo que ya
 * usan las preventas nuevas (_resolverFechaEntregaDisponible_) — es una
 * herramienta aparte para reordenar las que ya están cargadas mal.
 *
 * Reutiliza las mismas reglas (_capacidadEntregaPreventa_,
 * _esFinDeMesCandidata_, _usadosParaFecha_, esDiaHabil_) para que el
 * resultado sea 100% consistente con lo que el sistema ya exige a una
 * preventa nueva.
 */

/**
 * Arma el plan de reorganización SIN escribir nada (dry run). Recorre las
 * preventas activas (ni ANULADO ni Entregada/Cancelada — mismo criterio que
 * obtenerPreventasEntregables(), webapp.gs) ordenadas por su "Fecha
 * Prometida Hasta" actual (y, en caso de empate, por fila = orden de
 * carga), y les va asignando cupo en ese mismo orden: la preventa que ya
 * tenía la fecha más temprana (o que se cargó antes) conserva prioridad: si
 * dos exceden el cupo de un mismo día/bloque, la que estaba pactada para
 * más adelante es la que se corre.
 */
function _planReorganizacionCuposPreventas_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Preventas");
  if (!sheet) return { cambios: [], total: 0 };

  const fE = 2;
  const cNP  = getCol(sheet, "N° Preventa", fE);
  const cCL  = getCol(sheet, "Cliente", fE);
  const cMO  = getCol(sheet, "Modelo Solicitado", fE);
  const cPV  = getCol(sheet, "Precio Venta Pactado", fE);
  const cEH  = getCol(sheet, "Fecha Prometida Hasta", fE);
  const cES  = getCol(sheet, "Estado", fE);
  let cEstReg = -1;
  try { cEstReg = getCol(sheet, "ESTADO_REGISTRO", fE); } catch (e) { /* columna opcional */ }

  const lastRow = sheet.getLastRow();
  if (lastRow < fE + 1) return { cambios: [], total: 0 };

  const datos = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  const activas = [];
  datos.forEach((row, i) => {
    if (cEstReg >= 0 && String(row[cEstReg - 1] || "").trim() === "ANULADO") return;
    const estado = String(row[cES - 1] || "");
    if (estado.includes("Entregado") || estado.includes("Cancelado")) return;
    const fHasta = row[cEH - 1];
    if (!(fHasta instanceof Date)) return; // sin fecha cargada: nada que reorganizar
    activas.push({
      fila: fE + 1 + i,
      nPre: String(row[cNP - 1]),
      cliente: String(row[cCL - 1] || ""),
      modelo: String(row[cMO - 1] || ""),
      monto: Number(row[cPV - 1]) || 0,
      fechaOriginal: new Date(fHasta.getFullYear(), fHasta.getMonth(), fHasta.getDate())
    });
  });

  // Prioridad: fecha pactada más temprana primero; a igual fecha, la que ya
  // estaba cargada antes en la hoja (orden de carga real).
  activas.sort((a, b) => a.fechaOriginal.getTime() - b.fechaOriginal.getTime() || a.fila - b.fila);

  const feriados = obtenerFeriados_();
  const porDia = {}; // "yyyy-MM-dd" -> { cant, monto } — el NUEVO cronograma, se va llenando acá
  const tz = Session.getScriptTimeZone();
  const cambios = [];

  activas.forEach(p => {
    const candidata = new Date(p.fechaOriginal.getTime());
    let asignada = null;
    for (let i = 0; i < 180; i++) { // ~6 meses de margen
      if (!esDiaHabil_(candidata, feriados)) { candidata.setDate(candidata.getDate() + 1); continue; }
      const limites = _capacidadEntregaPreventa_(candidata);
      const usados = _usadosParaFecha_(candidata, porDia);
      if (usados.cant < limites.maxEquipos && (usados.monto + p.monto) <= limites.maxMonto) {
        asignada = new Date(candidata.getTime());
        break;
      }
      candidata.setDate(candidata.getDate() + 1);
    }
    if (!asignada) asignada = candidata; // no debería pasar, margen de sobra

    const key = Utilities.formatDate(asignada, tz, "yyyy-MM-dd");
    if (!porDia[key]) porDia[key] = { cant: 0, monto: 0 };
    porDia[key].cant++;
    porDia[key].monto += p.monto;

    if (asignada.getTime() !== p.fechaOriginal.getTime()) {
      cambios.push({
        fila: p.fila,
        nPre: p.nPre,
        cliente: p.cliente,
        modelo: p.modelo,
        monto: p.monto,
        fechaVieja: p.fechaOriginal,
        fechaNueva: asignada
      });
    }
  });

  return { cambios: cambios, total: activas.length };
}

/** Aplica el plan: backup de cada fila tocada (guardarBackupOperacion_, anulaciones.gs) + escribe la nueva fecha + deja rastro en Auditoría. */
function _aplicarReorganizacionCuposPreventas_(cambios) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Preventas");
  const fE = 2;
  const cEH = getCol(sheet, "Fecha Prometida Hasta", fE);
  const tz = Session.getScriptTimeZone();

  cambios.forEach(c => {
    guardarBackupOperacion_("PREVENTA", c.nPre, "REORGANIZACION_CUPO");
    sheet.getRange(c.fila, cEH).setValue(c.fechaNueva);
    registrarAuditoria_(
      "PREVENTA", c.nPre, "REORGANIZACION_CUPO",
      `Fecha Prometida Hasta movida de ${Utilities.formatDate(c.fechaVieja, tz, "dd/MM/yyyy")} a ${Utilities.formatDate(c.fechaNueva, tz, "dd/MM/yyyy")} por reorganización de cupos (preventa cargada con una versión vieja del sistema, sin control de cupo).`
    );
  });
}

/**
 * Punto de entrada desde el menú (🏪 GreatPhones → 🟡 Preventas → Reorganizar
 * cupos). Primero muestra el diagnóstico (dry run, no escribe nada); si hay
 * cambios, pide confirmación explícita antes de aplicarlos.
 */
function diagnosticarCupoPreventas() {
  const ui = SpreadsheetApp.getUi();
  const plan = _planReorganizacionCuposPreventas_();

  if (plan.cambios.length === 0) {
    ui.alert("✅ Cupos OK", `Revisé las ${plan.total} preventas activas: ninguna viola el cupo diario/de fin de mes. No hace falta reorganizar nada.`, ui.ButtonSet.OK);
    return;
  }

  const tz = Session.getScriptTimeZone();
  const detalle = plan.cambios.map(c =>
    `• ${c.nPre} — ${c.cliente} (${c.modelo}): ` +
    `${Utilities.formatDate(c.fechaVieja, tz, "dd/MM/yyyy")} → ${Utilities.formatDate(c.fechaNueva, tz, "dd/MM/yyyy")}`
  ).join("\n");

  const resp = ui.alert(
    "📦 Reorganizar cupos de Preventas",
    `Encontré ${plan.cambios.length} preventa(s) que violan el cupo pactado (3 equipos / $2.500.000 por día, 5 equipos / $5.000.000 en el bloque de los últimos 5 días del mes) — probablemente cargadas desde una versión vieja.\n\n` +
    `Se van a reprogramar respetando la prioridad de quien ya tenía la fecha más temprana:\n\n${detalle}\n\n` +
    `Cada una queda con un backup (Ver backups de operación) y un registro en Auditoría antes de tocarla. ¿Confirmás aplicar estos cambios?`,
    ui.ButtonSet.YES_NO
  );

  if (resp !== ui.Button.YES) return;

  _aplicarReorganizacionCuposPreventas_(plan.cambios);
  ui.alert("✅ Listo", `Se reprogramaron ${plan.cambios.length} preventa(s). Podés revisar el detalle en la hoja Auditoría o en los backups de cada operación.`, ui.ButtonSet.OK);
}
