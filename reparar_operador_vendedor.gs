// ============================================================
//  REPARAR OPERADOR SEGÚN VENDEDOR REAL
//
//  Corrige la corrupción documentada en reporte_vendedores.gs: escribe
//  en la columna OPERADOR de Preventas y Ventas el vendedor REAL (tomado
//  de la columna "Vendedor" de Preventas, que nunca se toca después de
//  crear la preventa), pisando el valor que había quedado mal puesto por
//  procesarEntregaPreventaConOperador() (operadores.gs) al entregar.
//
//  Antes de escribir, guarda backup (guardarBackupOperacion_) y deja
//  rastro en Auditoría — mismo criterio que cualquier otra corrección
//  del sistema. Nunca toca una fila si el "vendedor real" está vacío o
//  es literalmente "Sin identificar" (no hay nada confiable para poner
//  ahí — esas quedan listadas para completar a mano).
// ============================================================

const _VENDEDORES_NO_CONFIABLES_ = ["", "sin identificar", "s/d", "n/a"];

/** Punto de entrada desde el menú: 🏪 GreatPhones → 📋 Anulaciones → "🔧 Reparar OPERADOR según vendedor real". */
function repararOperadorSegunVendedorReal() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = _calcularReporteVendedoresReal_(ss);

  const corregibles = r.detalleDiscrepancias.filter(fila => !_VENDEDORES_NO_CONFIABLES_.includes(String(fila[3]).trim().toLowerCase()));
  const noCorregibles = r.detalleDiscrepancias.length - corregibles.length;

  if (corregibles.length === 0) {
    ui.alert("✅ Nada para reparar", "No hay discrepancias con un vendedor real confiable para corregir.", ui.ButtonSet.OK);
    return;
  }

  const resp = ui.alert(
    "⚠️ Confirmar reparación",
    `Se van a corregir ${corregibles.length} operación(es) (columna OPERADOR de Preventas y/o Ventas), ` +
    `usando "Vendedor" como fuente de verdad. Cada una queda con backup y registro en Auditoría antes de tocarla.\n\n` +
    (noCorregibles > 0 ? `${noCorregibles} operación(es) más quedan SIN tocar por no tener un vendedor real confiable (vacío o "Sin identificar") — las vas a tener que completar a mano.\n\n` : "") +
    `¿Confirmás aplicar la corrección?`,
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const preSheet = ss.getSheetByName("Preventas");
  const ventasSheet = ss.getSheetByName("Ventas");
  const fE = 2;

  let corregidas = 0;
  corregibles.forEach(fila => {
    const [numero, tipo, operadorViejo, vendedorReal] = fila;
    try {
      if (tipo === "PREVENTA") {
        _repararUnaOperador_(preSheet, fE, "N° Preventa", numero, vendedorReal, "PREVENTA", operadorViejo);
      } else {
        // tipo === "VENTA (desde preventa ...)"
        _repararUnaOperador_(ventasSheet, fE, "N° Venta", numero, vendedorReal, "VENTA", operadorViejo);
      }
      corregidas++;
    } catch (e) {
      Logger.log(`⚠️ No se pudo reparar ${numero}: ${e.message}`);
    }
  });

  // El reporte queda desactualizado después de escribir — se regenera solo.
  _escribirReporteVendedoresReal_(ss, _calcularReporteVendedoresReal_(ss));

  ui.alert(
    "✅ Reparación aplicada",
    `Se corrigieron ${corregidas} de ${corregibles.length} operación(es).\n` +
    (noCorregibles > 0 ? `${noCorregibles} quedaron sin tocar (vendedor real no confiable) — revisalas a mano.\n` : "") +
    `El reporte REPORTE_VENDEDORES_REAL se actualizó solo.`,
    ui.ButtonSet.OK
  );
}

function _repararUnaOperador_(sheet, filaEnc, nombreColId, valorId, vendedorReal, tipoAuditoria, operadorViejo) {
  const colId = getCol(sheet, nombreColId, filaEnc);
  const colOperador = getCol(sheet, "OPERADOR", filaEnc);

  const lastRow = sheet.getLastRow();
  const ids = sheet.getRange(filaEnc + 1, colId, lastRow - filaEnc, 1).getValues();
  const idx = ids.findIndex(r => String(r[0] || "").trim() === valorId);
  if (idx === -1) throw new Error(`"${valorId}" no encontrada en "${sheet.getName()}".`);
  const fila = filaEnc + 1 + idx;

  guardarBackupOperacion_(tipoAuditoria, valorId, "REPARACION_OPERADOR_VENDEDOR_REAL");
  sheet.getRange(fila, colOperador).setValue(vendedorReal);
  registrarAuditoria_(
    tipoAuditoria, valorId, "REPARACION_OPERADOR_VENDEDOR_REAL",
    `OPERADOR corregido de "${operadorViejo}" a "${vendedorReal}" — la entrega de la preventa había pisado el vendedor real con quien hizo la entrega. Corrección automática vía repararOperadorSegunVendedorReal().`
  );
}
