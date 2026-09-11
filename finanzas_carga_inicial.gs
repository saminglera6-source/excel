// ============================================================
//  CARGA INICIAL DE FINANZAS — a partir del Excel "modelo financiero"
//  que ya venía usando el dueño (Costos Fijos Mensuales / Costo
//  Variable del Producto / Costos de Mano de Obra).
//
//  Es un script de UNA SOLA VEZ: se corre a mano desde el editor de
//  Apps Script (▶ Ejecutar, eligiendo la función
//  cargarCostosYAgendaInicialDesdeExcel) y carga todo usando las
//  mismas funciones que usa la web (guardarCostoFijo, guardarPago,
//  etc.) — así los datos quedan exactamente igual que si se
//  hubieran cargado a mano desde la pantalla, con vigencia, IDs,
//  validaciones, todo. Después de correrlo una vez, todo se sigue
//  editando/agregando/borrando desde la web con total libertad.
//
//  Si se corre dos veces, va a duplicar todo — está pensado para
//  correrse una sola vez. Si hace falta repetirlo, primero borrar a
//  mano las filas que haya en FINANZAS_COSTOS_FIJOS,
//  FINANZAS_COSTO_VARIABLE, FINANZAS_MANO_DE_OBRA y FINANZAS_PAGOS.
// ============================================================

function cargarCostosYAgendaInicialDesdeExcel() {
  const hoy = _finFmtFecha_(new Date());

  // ------------------------------------------------------------
  //  1) COSTOS FIJOS (afectan el Estado de Resultados todos los meses)
  // ------------------------------------------------------------
  const costosFijos = [
    { concepto: "Luz",            categoria: "Servicios",       monto: 150000,  descripcion: "" },
    { concepto: "Wifi",           categoria: "Servicios",       monto: 85000,   descripcion: "" },
    { concepto: "Expensas",       categoria: "Servicios",       monto: 100000,  descripcion: "" },
    { concepto: "Alquiler",       categoria: "Servicios",       monto: 700000,  descripcion: "" },
    { concepto: "Suscripciones",  categoria: "Servicios",       monto: 66250,   descripcion: "Pago de suscripciones a diferentes apps o páginas" },
    { concepto: "Marketing",      categoria: "Servicios",       monto: 3000000, descripcion: "Pago por videos hechos para publicidad" },
    { concepto: "Publicidad",     categoria: "Servicios",       monto: 600000,  descripcion: "Estimado: $20.000/día en Instagram y Facebook × 30 días. Ajustalo si el gasto real de un mes fue distinto." },
    { concepto: "Contador",       categoria: "Administrativos", monto: 50000,   descripcion: "" },
    { concepto: "Otros costos",   categoria: "Administrativos", monto: 50000,   descripcion: "" }
  ];
  costosFijos.forEach(c => guardarCostoFijo({
    idAnterior: null, categoria: c.categoria, concepto: c.concepto, descripcion: c.descripcion,
    monto: c.monto, moneda: "ARS", cantidad: 1, vidaUtil: 5, vigenteDesde: hoy
  }));

  // ------------------------------------------------------------
  //  2) COSTO VARIABLE POR EQUIPO (funda y cable de regalo — el costo
  //     del iPhone en sí ya sale solo de las Ventas reales, no se
  //     carga acá para no duplicarlo)
  // ------------------------------------------------------------
  const costoVariable = [
    { concepto: "Funda", descripcion: "De regalo con cada equipo", costo: 3000 },
    { concepto: "Cable", descripcion: "De regalo con cada equipo", costo: 4000 }
  ];
  costoVariable.forEach(c => guardarCostoVariable({
    idAnterior: null, concepto: c.concepto, descripcion: c.descripcion,
    costoUnitario: c.costo, moneda: "ARS", vigenteDesde: hoy
  }));

  // ------------------------------------------------------------
  //  3) MANO DE OBRA
  // ------------------------------------------------------------
  const manoDeObra = [
    { rol: "Vendedor 1",          salario: 1400000 },
    { rol: "Vendedor 2",          salario: 900000 },
    { rol: "Sam (Administrador)", salario: 675000 },
    { rol: "Martin",              salario: 2000000 },
    { rol: "Técnico",             salario: 675000 },
    { rol: "Fran",                salario: 400000 }
  ];
  manoDeObra.forEach(m => guardarManoDeObra({
    idAnterior: null, rol: m.rol, cantidad: 1, turnos: 1,
    salario: m.salario, moneda: "ARS", vigenteDesde: hoy
  }));

  // ------------------------------------------------------------
  //  4) AGENDA DE PAGOS — mismos montos de arriba, organizados entre
  //     el 1 y el 15 para no juntar todo en un solo día. Fijos por
  //     vos: Sam el día 4, Alquiler + Expensas el día 10. El resto lo
  //     repartí para que no se acumule todo junto:
  //       1  Wifi
  //       2  Luz
  //       3  Suscripciones
  //       4  Sueldo Sam            ← pedido puntual
  //       5  Sueldos: Vendedor 1, Vendedor 2, Técnico, Fran
  //       6  Sueldo Martin (aparte, por ser el monto más grande)
  //       8  Contador + Otros costos
  //       10 Alquiler + Expensas   ← pedido puntual
  //       12 Publicidad
  //       15 Marketing
  // ------------------------------------------------------------
  const pagos = [
    { concepto: "Wifi",                dia: 1,  categoria: "Servicios",           monto: 85000 },
    { concepto: "Luz",                 dia: 2,  categoria: "Servicios",           monto: 150000 },
    { concepto: "Suscripciones",       dia: 3,  categoria: "Servicios",           monto: 66250 },
    { concepto: "Sueldo Sam",          dia: 4,  categoria: "Sueldos",             monto: 675000 },
    { concepto: "Sueldo Vendedor 1",   dia: 5,  categoria: "Sueldos",             monto: 1400000 },
    { concepto: "Sueldo Vendedor 2",   dia: 5,  categoria: "Sueldos",             monto: 900000 },
    { concepto: "Sueldo Técnico",      dia: 5,  categoria: "Sueldos",             monto: 675000 },
    { concepto: "Sueldo Fran",         dia: 5,  categoria: "Sueldos",             monto: 400000 },
    { concepto: "Sueldo Martin",       dia: 6,  categoria: "Sueldos",             monto: 2000000 },
    { concepto: "Contador",            dia: 8,  categoria: "Otro",                monto: 50000 },
    { concepto: "Otros costos",        dia: 8,  categoria: "Otro",                monto: 50000 },
    { concepto: "Alquiler",            dia: 10, categoria: "Alquiler",            monto: 700000 },
    { concepto: "Expensas",            dia: 10, categoria: "Alquiler",            monto: 100000 },
    { concepto: "Publicidad",          dia: 12, categoria: "Otro",                monto: 600000, notas: "Estimado: $20.000/día × 30. Ajustar según lo gastado ese mes." },
    { concepto: "Marketing",           dia: 15, categoria: "Otro",                monto: 3000000, notas: "Videos para publicidad — confirmar si es todos los meses o puntual." }
  ];
  pagos.forEach(p => guardarPago({
    id: null, concepto: p.concepto, categoria: p.categoria, monto: p.monto, moneda: "ARS",
    frecuencia: "Mensual", diaPago: p.dia, notas: p.notas || ""
  }));

  Logger.log("✅ Carga inicial de Finanzas completa: " + costosFijos.length + " costos fijos, " +
    costoVariable.length + " costos variables, " + manoDeObra.length + " roles de mano de obra, " +
    pagos.length + " pagos en la agenda.");
}
