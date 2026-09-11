// ============================================================
//  AUDITORÍA DE DUPLICADOS Y OPERACIONES QUE NO CUENTAN
//
//  100% de solo lectura — no escribe nada en Preventas ni Ventas.
//  Genera la hoja "AUDITORIA_DUPLICADOS" con 6 secciones:
//
//  1. VÍNCULOS PREVENTA→VENTA (informativo): preventas ya entregadas
//     con su "N° Venta Asociada" — es la MISMA operación comercial
//     contada una sola vez en dos registros distintos (uno de stock/
//     entrega, otro de venta). No es un error, pero cualquier reporte
//     que sume "monto vendido" tiene que elegir UNO de los dos, nunca
//     los dos, para no duplicar el ingreso.
//  2. VÍNCULOS ROTOS: preventas cuyo "N° Venta Asociada" apunta a una
//     Venta que ya no existe en la hoja "Ventas" (borrada a mano,
//     nunca debería pasar con el flujo normal del sistema).
//  3. ENTREGADAS SIN VENTA: preventas en estado "✅ Entregado" pero sin
//     "N° Venta Asociada" — falta el registro de venta correspondiente.
//  4. MISMO EQUIPO VENDIDO DOS VECES: mismo IMEI aparece en más de una
//     fila de "Ventas" activa (ESTADO_REGISTRO ≠ ANULADO) — grave, un
//     equipo físico no se puede vender dos veces.
//  5. POSIBLES DUPLICADOS DE CARGA: mismo Cliente + Modelo + Precio,
//     cargados con menos de 3 días de diferencia, en Preventas o en
//     Ventas por separado — probable doble carga por error humano.
//  6. ANULADAS / CANCELADAS (para que quede a la vista qué NO hay que
//     contar en ningún total): filas con ESTADO_REGISTRO=ANULADO en
//     Preventas o Ventas, y preventas con Estado="❌ Cancelado".
// ============================================================

/** Punto de entrada desde el menú: 🏪 GreatPhones → 📋 Anulaciones → "🔎 Auditoría de duplicados/canceladas". */
function generarAuditoriaDuplicados() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = _calcularAuditoriaDuplicados_(ss);
  _escribirAuditoriaDuplicados_(ss, r);
  SpreadsheetApp.getUi().alert(
    "✅ Auditoría generada",
    `Se creó/actualizó la hoja "AUDITORIA_DUPLICADOS".\n\n` +
    `Vínculos Preventa→Venta: ${r.vinculos.length}\n` +
    `Vínculos rotos: ${r.vinculosRotos.length}\n` +
    `Entregadas sin venta: ${r.entregadasSinVenta.length}\n` +
    `IMEI vendido más de una vez: ${r.imeiDuplicado.length}\n` +
    `Posibles duplicados de carga: ${r.posiblesDuplicados.length}\n` +
    `Anuladas/Canceladas: ${r.anuladasCanceladas.length}\n` +
    `Venta compartida por más de una preventa: ${r.ventaCompartida.length}\n` +
    `Preventa activa con venta anulada: ${r.ventaAnuladaConPreventaActiva.length}`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function _leerHojaCompleta_(sheet, filaEnc) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= filaEnc) return { headers: [], datos: [] };
  const headers = sheet.getRange(filaEnc, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const datos = sheet.getRange(filaEnc + 1, 1, lastRow - filaEnc, sheet.getLastColumn()).getValues();
  return { headers, datos };
}

function _idxCol_(headers, nombre) {
  return headers.indexOf(nombre); // -1 si no existe (columna opcional)
}

function _calcularAuditoriaDuplicados_(ss) {
  const preSheet = ss.getSheetByName("Preventas");
  const ventasSheet = ss.getSheetByName("Ventas");
  if (!preSheet || !ventasSheet) throw new Error("❌ Hojas 'Preventas' o 'Ventas' no encontradas.");

  const fE = 2;
  const pre = _leerHojaCompleta_(preSheet, fE);
  const vta = _leerHojaCompleta_(ventasSheet, fE);

  const pNP = _idxCol_(pre.headers, "N° Preventa");
  const pCL = _idxCol_(pre.headers, "Cliente");
  const pMO = _idxCol_(pre.headers, "Modelo Solicitado");
  const pPV = _idxCol_(pre.headers, "Precio Venta Pactado");
  const pFE = _idxCol_(pre.headers, "Fecha Preventa");
  const pES = _idxCol_(pre.headers, "Estado");
  const pNV = _idxCol_(pre.headers, "N° Venta Asociada");
  const pER = _idxCol_(pre.headers, "ESTADO_REGISTRO");

  const vNV = _idxCol_(vta.headers, "N° Venta");
  const vCL = _idxCol_(vta.headers, "Cliente");
  const vMO = _idxCol_(vta.headers, "Modelo");
  const vPV = _idxCol_(vta.headers, "Precio Venta");
  const vFE = _idxCol_(vta.headers, "Fecha Venta");
  const vIM = _idxCol_(vta.headers, "IMEI");
  const vER = _idxCol_(vta.headers, "ESTADO_REGISTRO");

  const ventasPorNumero = {};
  vta.datos.forEach(row => { ventasPorNumero[String(row[vNV] || "").trim()] = row; });

  // ---- 1 y 2: vínculos Preventa→Venta ----
  const vinculos = [];
  const vinculosRotos = [];
  const entregadasSinVenta = [];
  const preventasPorVenta = {}; // nVenta -> [ {nPre, cliente, modelo}, ... ] — para detectar una Venta compartida por más de una Preventa
  const ventaAnuladaConPreventaActiva = []; // preventas activas cuya Venta asociada está ANULADA

  pre.datos.forEach(row => {
    const nPre = String(row[pNP] || "").trim();
    const estado = String(row[pES] || "");
    const anulada = pER >= 0 && String(row[pER] || "").trim() === "ANULADO";
    const nVentaAsoc = pNV >= 0 ? String(row[pNV] || "").trim() : "";

    if (anulada) return; // las anuladas van en la sección 6, no acá

    if (nVentaAsoc) {
      const ventaRow = ventasPorNumero[nVentaAsoc];
      if (ventaRow) {
        vinculos.push([nPre, nVentaAsoc, String(row[pCL] || ""), String(row[pMO] || "")]);
        (preventasPorVenta[nVentaAsoc] = preventasPorVenta[nVentaAsoc] || []).push({ nPre, cliente: String(row[pCL] || ""), modelo: String(row[pMO] || "") });

        const ventaAnulada = vER >= 0 && String(ventaRow[vER] || "").trim() === "ANULADO";
        if (ventaAnulada) {
          ventaAnuladaConPreventaActiva.push([nPre, nVentaAsoc, String(row[pCL] || ""), estado]);
        }
      } else {
        vinculosRotos.push([nPre, nVentaAsoc, String(row[pCL] || ""), "La venta asociada no existe en la hoja Ventas"]);
      }
    } else if (estado === "✅ Entregado") {
      entregadasSinVenta.push([nPre, String(row[pCL] || ""), String(row[pMO] || ""), "Estado Entregado pero sin N° Venta Asociada"]);
    }
  });

  // Una misma Venta no puede ser la entrega de más de una Preventa distinta.
  const ventaCompartida = Object.keys(preventasPorVenta)
    .filter(nVenta => preventasPorVenta[nVenta].length > 1)
    .map(nVenta => [
      nVenta,
      preventasPorVenta[nVenta].map(p => p.nPre).join(", "),
      preventasPorVenta[nVenta].map(p => p.cliente + " (" + p.modelo + ")").join(" / "),
      "Esta misma Venta aparece vinculada a " + preventasPorVenta[nVenta].length + " preventas distintas"
    ]);

  // ---- 4: mismo IMEI vendido más de una vez (solo Ventas activas) ----
  const porIMEI = {};
  vta.datos.forEach(row => {
    const anulada = vER >= 0 && String(row[vER] || "").trim() === "ANULADO";
    if (anulada || vIM < 0) return;
    const imei = String(row[vIM] || "").trim();
    if (!imei) return;
    (porIMEI[imei] = porIMEI[imei] || []).push(String(row[vNV] || "").trim());
  });
  const imeiDuplicado = Object.keys(porIMEI)
    .filter(imei => porIMEI[imei].length > 1)
    .map(imei => [imei, porIMEI[imei].join(", "), "Mismo IMEI vendido en " + porIMEI[imei].length + " ventas activas"]);

  // ---- 5: posibles duplicados de carga (mismo cliente+modelo+precio, <3 días) ----
  const posiblesDuplicados = [];
  const buscarDuplicadosEnGrupo_ = (datos, iCliente, iModelo, iPrecio, iFecha, iNumero, tipoLabel) => {
    const grupos = {};
    datos.forEach(row => {
      const cliente = String(row[iCliente] || "").trim().toLowerCase();
      const modelo = String(row[iModelo] || "").trim().toLowerCase();
      const precio = Number(row[iPrecio]) || 0;
      if (!cliente || !modelo) return;
      const clave = cliente + "|" + modelo + "|" + precio;
      (grupos[clave] = grupos[clave] || []).push(row);
    });
    Object.values(grupos).forEach(filas => {
      if (filas.length < 2) return;
      filas.sort((a, b) => (a[iFecha] instanceof Date ? a[iFecha].getTime() : 0) - (b[iFecha] instanceof Date ? b[iFecha].getTime() : 0));
      for (let i = 1; i < filas.length; i++) {
        const f1 = filas[i - 1][iFecha], f2 = filas[i][iFecha];
        if (!(f1 instanceof Date) || !(f2 instanceof Date)) continue;
        const diffDias = Math.abs(f2 - f1) / 86400000;
        if (diffDias <= 3) {
          posiblesDuplicados.push([
            tipoLabel, String(filas[i - 1][iNumero] || ""), String(filas[i][iNumero] || ""),
            filas[i][iCliente], filas[i][iModelo], diffDias.toFixed(1) + " día(s) de diferencia"
          ]);
        }
      }
    });
  };
  buscarDuplicadosEnGrupo_(pre.datos.filter(r => pER < 0 || String(r[pER] || "").trim() !== "ANULADO"), pCL, pMO, pPV, pFE, pNP, "PREVENTA");
  buscarDuplicadosEnGrupo_(vta.datos.filter(r => vER < 0 || String(r[vER] || "").trim() !== "ANULADO"), vCL, vMO, vPV, vFE, vNV, "VENTA");

  // ---- 6: anuladas y canceladas ----
  const anuladasCanceladas = [];
  pre.datos.forEach(row => {
    const nPre = String(row[pNP] || "").trim();
    const anulada = pER >= 0 && String(row[pER] || "").trim() === "ANULADO";
    const cancelada = String(row[pES] || "").includes("Cancelado");
    if (anulada) anuladasCanceladas.push(["PREVENTA", nPre, "ANULADA (ESTADO_REGISTRO)", String(row[pCL] || "")]);
    else if (cancelada) anuladasCanceladas.push(["PREVENTA", nPre, "Cancelada (Estado)", String(row[pCL] || "")]);
  });
  vta.datos.forEach(row => {
    const nVenta = String(row[vNV] || "").trim();
    const anulada = vER >= 0 && String(row[vER] || "").trim() === "ANULADO";
    if (anulada) anuladasCanceladas.push(["VENTA", nVenta, "ANULADA (ESTADO_REGISTRO)", String(row[vCL] || "")]);
  });

  return { vinculos, vinculosRotos, entregadasSinVenta, imeiDuplicado, posiblesDuplicados, anuladasCanceladas, ventaCompartida, ventaAnuladaConPreventaActiva };
}

function _escribirAuditoriaDuplicados_(ss, r) {
  const nombreHoja = "AUDITORIA_DUPLICADOS";
  let sheet = ss.getSheetByName(nombreHoja);
  if (sheet) sheet.clear();
  else sheet = ss.insertSheet(nombreHoja);

  let fila = 1;
  const seccion = (titulo, headers, filas, vacioMsg) => {
    sheet.getRange(fila, 1).setValue(titulo).setFontWeight("bold");
    fila += 2;
    sheet.getRange(fila, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    fila++;
    if (filas.length === 0) {
      sheet.getRange(fila, 1).setValue(vacioMsg);
      fila++;
    } else {
      sheet.getRange(fila, 1, filas.length, headers.length).setValues(filas);
      fila += filas.length;
    }
    fila += 2;
  };

  seccion(
    "1. VÍNCULOS PREVENTA→VENTA (informativo — misma operación, no sumar las dos por separado en ningún reporte)",
    ["N° Preventa", "N° Venta", "Cliente", "Modelo"], r.vinculos, "(ninguno)"
  );
  seccion(
    "2. VÍNCULOS ROTOS (la Venta asociada ya no existe)",
    ["N° Preventa", "N° Venta Asociada (no existe)", "Cliente", "Detalle"], r.vinculosRotos, "(ninguno)"
  );
  seccion(
    "3. ENTREGADAS SIN VENTA (falta el registro de venta)",
    ["N° Preventa", "Cliente", "Modelo", "Detalle"], r.entregadasSinVenta, "(ninguna)"
  );
  seccion(
    "4. MISMO EQUIPO (IMEI) VENDIDO MÁS DE UNA VEZ",
    ["IMEI", "Ventas donde aparece", "Detalle"], r.imeiDuplicado, "(ninguno)"
  );
  seccion(
    "5. POSIBLES DUPLICADOS DE CARGA (mismo cliente+modelo+precio, ≤3 días)",
    ["Tipo", "N° Operación 1", "N° Operación 2", "Cliente", "Modelo", "Detalle"], r.posiblesDuplicados, "(ninguno)"
  );
  seccion(
    "6. ANULADAS / CANCELADAS (no contar en ningún total)",
    ["Hoja", "N°", "Motivo", "Cliente"], r.anuladasCanceladas, "(ninguna)"
  );
  seccion(
    "7. UNA MISMA VENTA VINCULADA A MÁS DE UNA PREVENTA (grave — dato roto, revisar ya)",
    ["N° Venta", "Preventas vinculadas", "Clientes/Modelos", "Detalle"], r.ventaCompartida, "(ninguna)"
  );
  seccion(
    "8. PREVENTA ACTIVA CUYA VENTA ASOCIADA ESTÁ ANULADA (la preventa quedó como Entregada con un vínculo muerto)",
    ["N° Preventa", "N° Venta (anulada)", "Cliente", "Estado actual de la Preventa"], r.ventaAnuladaConPreventaActiva, "(ninguna)"
  );

  sheet.autoResizeColumns(1, 6);
}
