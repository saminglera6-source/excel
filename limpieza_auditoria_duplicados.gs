// ============================================================
//  LIMPIEZA — resultados puntuales de AUDITORIA_DUPLICADOS (agosto 2026)
//
//  Acciones decididas por el dueño para los hallazgos concretos de esa
//  auditoría (no es un mecanismo genérico reutilizable — son números de
//  operación fijos, a propósito, para no tocar nada que no se haya
//  revisado explícitamente):
//
//  1. VTA-025 es la entrega real de PRE-058 (jenifer gallardo), NO de
//     PRE-002 (Lucrecia Berardo). A PRE-002 se le saca el vínculo
//     equivocado y vuelve a un estado pendiente de entrega (no se
//     anula: la operación de Lucrecia sigue siendo válida, solo estaba
//     mal vinculada).
//  2. PRE-017, PRE-041 y PRE-052 quedaron "Entregado" con la venta que
//     las respaldaba ya anulada — se cancelan también (vía
//     procesarAnularOperacion, el mismo mecanismo de todo el sistema).
//  3. Duplicados de carga confirmados por el dueño: se anula la copia
//     repetida y se deja la primera carga de cada grupo intacta —
//     PRE-044 (duplicado de PRE-043), PRE-051 (duplicado de PRE-050),
//     VTA-026 (duplicado de VTA-027, que ya tiene su preventa de
//     origen legítima).
// ============================================================

/** Punto de entrada desde el menú: 🏪 GreatPhones → 📋 Anulaciones → "🧹 Aplicar limpieza (auditoría agosto)". */
function aplicarLimpiezaAuditoriaDuplicados() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "⚠️ Confirmar limpieza",
    "Se van a aplicar estas correcciones puntuales:\n\n" +
    "• PRE-002: se le saca el vínculo a VTA-025 (le corresponde a PRE-058) y vuelve a pendiente de entrega.\n" +
    "• PRE-017, PRE-041, PRE-052: se cancelan (su venta ya estaba anulada).\n" +
    "• PRE-044, PRE-051, VTA-026: se anulan por ser cargas duplicadas.\n\n" +
    "Cada operación queda con su backup y su registro en Auditoría, como cualquier anulación del sistema. ¿Confirmás?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const log = [];

  try {
    log.push(_corregirVinculoEquivocado_("PRE-002", "VTA-025 corresponde en realidad a PRE-058, no a PRE-002 (auditoría de duplicados, agosto)."));
  } catch (e) { log.push(`❌ PRE-002: ${e.message}`); }

  ["PRE-017", "PRE-041", "PRE-052"].forEach(numero => {
    try {
      log.push(_cancelarPreventaConVentaAnulada_(numero));
    } catch (e) { log.push(`❌ ${numero}: ${e.message}`); }
  });

  [
    ["PRE-044", "Carga duplicada de PRE-043 (mismo cliente/modelo/precio, mismo día — auditoría de duplicados, agosto)."],
    ["PRE-051", "Carga duplicada de PRE-050 (mismo cliente/modelo/precio, mismo día — auditoría de duplicados, agosto)."],
    ["VTA-026", "Carga duplicada de VTA-027, que ya tiene su preventa de origen legítima (PRE-075) — auditoría de duplicados, agosto."]
  ].forEach(([numero, motivo]) => {
    try {
      const msg = procesarAnularOperacion(numero, motivo);
      log.push(`✅ ${numero} anulada.`);
    } catch (e) { log.push(`❌ ${numero}: ${e.message}`); }
  });

  ui.alert("Resultado de la limpieza", log.join("\n"), ui.ButtonSet.OK);
}

/**
 * Punto de entrada desde el menú: 🏪 GreatPhones → 📋 Anulaciones →
 * "🧹 Reintentar cancelación (PRE-017/041/052)". Reintenta SOLO estas 3 —
 * las otras 4 acciones de aplicarLimpiezaAuditoriaDuplicados() ya se
 * aplicaron bien la primera vez, no hace falta repetirlas.
 */
function reintentarCancelacionPreventasBloqueadas() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "⚠️ Confirmar",
    "Se van a cancelar PRE-017, PRE-041 y PRE-052, desvinculando el equipo comprado de cada una (el equipo queda libre en stock, no se anula). ¿Confirmás?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const log = [];
  ["PRE-017", "PRE-041", "PRE-052"].forEach(numero => {
    try {
      log.push(_cancelarPreventaConVentaAnulada_(numero));
    } catch (e) { log.push(`❌ ${numero}: ${e.message}`); }
  });
  ui.alert("Resultado", log.join("\n"), ui.ButtonSet.OK);
}

/** Saca un vínculo Preventa→Venta que resultó estar mal asignado (la venta es de otra preventa). No anula nada — la preventa sigue activa, solo se limpia el dato y vuelve a un estado pendiente de entrega real. */
function _corregirVinculoEquivocado_(numeroPreventa, motivo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Preventas");
  if (!sheet) throw new Error("Hoja 'Preventas' no encontrada.");
  const fE = 2;
  const cES = getCol(sheet, "Estado", fE);
  const cNC = getCol(sheet, "N° Compra Asociada", fE);
  const cNV = getCol(sheet, "N° Venta Asociada", fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Preventa", numeroPreventa);
  if (fila === -1) throw new Error(`"${numeroPreventa}" no encontrada en Preventas.`);

  const nCompra = String(sheet.getRange(fila, cNC).getValue() || "").trim();
  const estadoNuevo = nCompra ? "🟠 Comprado" : "🟡 Esperando compra";

  guardarBackupOperacion_("PREVENTA", numeroPreventa, "CORRECCION_VINCULO_VENTA_EQUIVOCADO");
  sheet.getRange(fila, cNV).setValue("");
  sheet.getRange(fila, cES).setValue(estadoNuevo);
  registrarAuditoria_("PREVENTA", numeroPreventa, "CORRECCION_VINCULO_VENTA_EQUIVOCADO",
    `${motivo} Estado vuelve a "${estadoNuevo}", vínculo de venta eliminado.`);

  return `✅ ${numeroPreventa}: vínculo corregido, vuelve a "${estadoNuevo}".`;
}

/**
 * Prepara una preventa "Entregado" con venta anulada para poder cancelarla
 * y después la cancela por el camino estándar. Dos guards de
 * _anularPreventa_ hay que destrabar ANTES de llamarla:
 *   1. Bloquea cualquier preventa en estado "Entregado" → se resetea el
 *      Estado.
 *   2. Bloquea si tiene una COMPRA activa vinculada (correcto en general:
 *      protege de perder trazabilidad de un equipo) → acá se desvincula
 *      "N° Compra Asociada" nada más, SIN anular la compra: el equipo
 *      existe de verdad y sigue disponible en stock, solo deja de estar
 *      atado a esta preventa cancelada. Si la Compra tiene la columna
 *      opcional "N° Preventa Asociada" (trazabilidad inversa), también se
 *      limpia ahí para no dejar un vínculo colgando de los dos lados.
 */
function _cancelarPreventaConVentaAnulada_(numeroPreventa) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Preventas");
  if (!sheet) throw new Error("Hoja 'Preventas' no encontrada.");
  const fE = 2;
  const cES = getCol(sheet, "Estado", fE);
  const cNC = getCol(sheet, "N° Compra Asociada", fE);
  const cNV = getCol(sheet, "N° Venta Asociada", fE);
  const fila = _buscarFilaPorId_(sheet, fE, "N° Preventa", numeroPreventa);
  if (fila === -1) throw new Error(`"${numeroPreventa}" no encontrada en Preventas.`);

  const nCompra = String(sheet.getRange(fila, cNC).getValue() || "").trim();

  guardarBackupOperacion_("PREVENTA", numeroPreventa, "PRE_CANCELACION_VENTA_ANULADA");
  sheet.getRange(fila, cNV).setValue("");
  sheet.getRange(fila, cNC).setValue("");
  sheet.getRange(fila, cES).setValue("🟡 Esperando compra"); // desbloquea el guard "Entregado" de _anularPreventa_

  if (nCompra) {
    const comprasSheet = ss.getSheetByName("Compras");
    if (comprasSheet) {
      try {
        const cNPC = getCol(comprasSheet, "N° Preventa Asociada", fE);
        const filaCompra = _buscarFilaPorId_(comprasSheet, fE, "N° OP", nCompra);
        if (filaCompra !== -1) comprasSheet.getRange(filaCompra, cNPC).setValue("");
      } catch (e) { /* columna opcional, no siempre existe */ }
    }
  }

  const msg = procesarAnularOperacion(numeroPreventa,
    "Su venta asociada ya estaba anulada — la preventa se cancela también (auditoría de duplicados, agosto). Equipo (" + (nCompra || "sin compra vinculada") + ") queda libre en stock, no se anula.");

  return `✅ ${numeroPreventa}: ${msg.split("\n")[0]} (equipo ${nCompra || "—"} liberado en stock, no anulado)`;
}
