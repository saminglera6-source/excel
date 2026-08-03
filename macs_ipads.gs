// ============================================================
//  MÓDULO — MACBOOKS / IPADS: LISTA DE PRECIOS
//  Nueva línea de producto (además de celulares y accesorios).
//  Sigue el mismo patrón de solo-lectura de "Lista de Precios"
//  (webapp.gs, PRECIOS_FILA_ENCABEZADO): la hoja de Google Sheets
//  es la base de datos, acá solo se lee para alimentar la Web App.
//
//  Hoja: "Lista de Precios Mac-iPad" — mismas 8 columnas que
//  "Lista de Precios" (celulares) para reutilizar tal cual toda la
//  UI/lógica ya existente (tarjetas, tabla, calculadora de cuotas,
//  selector de modelos con búsqueda, etc.):
//    Modelo | Almacenamiento | Precio USD | Precio ARS |
//    Preventa ARS | Preventa USD | Descuento ARS | Descuento USD
//  Encabezados en la fila 1 (a diferencia de "Lista de Precios" de
//  celulares, que los tiene en la fila 3 por diseño de esa hoja
//  puntual — acá no hay ese arrastre histórico).
// ============================================================

const MACIPAD_HOJA = "Lista de Precios Mac-iPad";
const MACIPAD_FILA_ENCABEZADO = 1;

/** Lee "Lista de Precios Mac-iPad" (solo lectura) y devuelve un array plano — misma forma que obtenerListaPrecios(), para reutilizar toda la UI de precios sin duplicarla. */
function obtenerListaPreciosMacIpad() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MACIPAD_HOJA);
  if (!sh) return [];

  const fE = MACIPAD_FILA_ENCABEZADO;
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
    if (!modelo) return;
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

/**
 * Catálogo inicial de MacBooks/iPads (cargado directamente por el usuario,
 * lista de precios provista). Fuente única de verdad para poblarListaPreciosMacIpad() —
 * después de la primera carga, la hoja "Lista de Precios Mac-iPad" pasa a
 * ser la base de datos real (igual que "Lista de Precios" de celulares):
 * cualquier cambio de precio se hace ahí, no en este array.
 * Orden de columnas: [Modelo, Almacenamiento, Precio USD, Precio ARS,
 * Preventa ARS, Preventa USD, Descuento ARS, Descuento USD]
 */
const CATALOGO_INICIAL_MAC_IPAD = [
  ["MacBook Air i5 1.8GHz 13\" (2017)","8GB/128GB",295,455000,425000,275,30000,20],
  ["MacBook Air i5 1.8GHz 13\" (2017)","8GB/256GB",340,525000,480000,310,45000,30],
  ["MacBook Pro i5 2.3GHz 13\" (2017)","16GB/256GB",555,855000,795000,515,60000,40],
  ["MacBook Pro i5 2.3GHz 13\" (2017)","16GB/512GB",655,1010000,935000,605,75000,50],
  ["MacBook Pro i5 2.3GHz 13\" (2017)","8GB/128GB",425,655000,610000,395,45000,30],
  ["MacBook Pro i5 2.3GHz 13\" (2017)","8GB/256GB",490,755000,695000,450,60000,40],
  ["MacBook Pro i7 2.8GHz 15\" (2017)","16GB/256GB",620,955000,880000,570,75000,50],
  ["MacBook Pro i7 2.8GHz 15\" (2017)","16GB/512GB",720,1110000,1020000,660,90000,60],
  ["MacBook Air Retina i5 1.6GHz 13\" (2018)","16GB/256GB",590,910000,835000,540,75000,50],
  ["MacBook Air Retina i5 1.6GHz 13\" (2018)","16GB/512GB",655,1010000,935000,605,75000,50],
  ["MacBook Air Retina i5 1.6GHz 13\" (2018)","8GB/128GB",460,710000,650000,420,60000,40],
  ["MacBook Air Retina i5 1.6GHz 13\" (2018)","8GB/256GB",525,810000,750000,485,60000,40],
  ["MacBook Pro i5 2.3GHz 13\" (2018)","16GB/256GB",685,1055000,980000,635,75000,50],
  ["MacBook Pro i5 2.3GHz 13\" (2018)","16GB/512GB",785,1210000,1120000,725,90000,60],
  ["MacBook Pro i5 2.3GHz 13\" (2018)","8GB/256GB",590,910000,835000,540,75000,50],
  ["MacBook Pro i5 2.3GHz 13\" (2018)","8GB/512GB",685,1055000,980000,635,75000,50],
  ["MacBook Pro i7 2.2GHz 15\" (2018)","16GB/256GB",815,1255000,1145000,745,110000,70],
  ["MacBook Pro i7 2.2GHz 15\" (2018)","16GB/512GB",950,1465000,1340000,870,125000,80],
  ["MacBook Pro i9 2.9GHz 15\" (2018)","32GB/512GB",1110,1710000,1570000,1020,140000,90],
  ["MacBook Air Retina i5 1.6GHz 13\" (2019)","16GB/256GB",655,1010000,935000,605,75000,50],
  ["MacBook Air Retina i5 1.6GHz 13\" (2019)","16GB/512GB",750,1155000,1065000,690,90000,60],
  ["MacBook Air Retina i5 1.6GHz 13\" (2019)","8GB/128GB",525,810000,750000,485,60000,40],
  ["MacBook Air Retina i5 1.6GHz 13\" (2019)","8GB/256GB",590,910000,835000,540,75000,50],
  ["MacBook Pro i5 2.4GHz 13\" (2019)","16GB/256GB",880,1355000,1245000,810,110000,70],
  ["MacBook Pro i5 2.4GHz 13\" (2019)","16GB/512GB",980,1510000,1385000,900,125000,80],
  ["MacBook Pro i5 2.4GHz 13\" (2019)","8GB/256GB",750,1155000,1065000,690,90000,60],
  ["MacBook Pro i5 2.4GHz 13\" (2019)","8GB/512GB",850,1310000,1200000,780,110000,70],
  ["MacBook Pro i7 2.6GHz 16\" (2019)","16GB/1TB",1275,1965000,1810000,1175,155000,100],
  ["MacBook Pro i7 2.6GHz 16\" (2019)","16GB/512GB",1110,1710000,1570000,1020,140000,90],
  ["MacBook Pro i9 2.3GHz 16\" (2019)","32GB/1TB",1505,2320000,2135000,1385,185000,120],
  ["MacBook Air Intel i5 1.1GHz 13\" (2020)","16GB/256GB",815,1255000,1145000,745,110000,70],
  ["MacBook Air Intel i5 1.1GHz 13\" (2020)","16GB/512GB",915,1410000,1300000,845,110000,70],
  ["MacBook Air Intel i5 1.1GHz 13\" (2020)","8GB/256GB",685,1055000,980000,635,75000,50],
  ["MacBook Air Intel i5 1.1GHz 13\" (2020)","8GB/512GB",785,1210000,1120000,725,90000,60],
  ["MacBook Air M1 13\" (2020)","16GB/256GB",950,1465000,1340000,870,125000,80],
  ["MacBook Air M1 13\" (2020)","16GB/512GB",1080,1665000,1525000,990,140000,90],
  ["MacBook Air M1 13\" (2020)","8GB/256GB",750,1155000,1065000,690,90000,60],
  ["MacBook Air M1 13\" (2020)","8GB/512GB",880,1355000,1245000,810,110000,70],
  ["MacBook Pro M1 13\" (2020)","16GB/256GB",1080,1665000,1525000,990,140000,90],
  ["MacBook Pro M1 13\" (2020)","16GB/512GB",1240,1910000,1755000,1140,155000,100],
  ["MacBook Pro M1 13\" (2020)","8GB/256GB",880,1355000,1245000,810,110000,70],
  ["MacBook Pro M1 13\" (2020)","8GB/512GB",1045,1610000,1485000,965,125000,80],
  ["MacBook Pro M1 Pro 14\" (2021)","16GB/1TB",1795,2765000,2550000,1655,215000,140],
  ["MacBook Pro M1 Pro 16\" (2021)","16GB/1TB",2090,3220000,2960000,1920,260000,170],
  ["MacBook Pro M1 Pro 14\" (2021)","16GB/512GB",1600,2465000,2265000,1470,200000,130],
  ["MacBook Pro M1 Pro 16\" (2021)","16GB/512GB",1895,2920000,2690000,1745,230000,150],
  ["MacBook Pro M1 Pro 14\" (2021)","32GB/1TB",2125,3275000,3015000,1960,260000,170],
  ["MacBook Pro M1 Pro 16\" (2021)","32GB/1TB",2420,3725000,3430000,2225,295000,190],
  ["MacBook Pro M1 Pro 14\" (2021)","32GB/512GB",1930,2970000,2740000,1780,230000,150],
  ["MacBook Pro M1 Pro 16\" (2021)","32GB/512GB",2220,3420000,3145000,2040,275000,180],
  ["MacBook Air M2 13\" (2022)","16GB/256GB",1340,2065000,1895000,1230,170000,110],
  ["MacBook Air M2 13\" (2022)","16GB/512GB",1505,2320000,2135000,1385,185000,120],
  ["MacBook Air M2 13\" (2022)","24GB/256GB",1505,2320000,2135000,1385,185000,120],
  ["MacBook Air M2 13\" (2022)","24GB/512GB",1665,2565000,2365000,1535,200000,130],
  ["MacBook Air M2 13\" (2022)","8GB/256GB",1210,1865000,1710000,1110,155000,100],
  ["MacBook Air M2 13\" (2022)","8GB/512GB",1375,2120000,1950000,1265,170000,110],
  ["MacBook Pro M2 13\" (2022)","16GB/256GB",1440,2220000,2035000,1320,185000,120],
  ["MacBook Pro M2 13\" (2022)","16GB/512GB",1600,2465000,2265000,1470,200000,130],
  ["MacBook Pro M2 13\" (2022)","24GB/512GB",1865,2870000,2640000,1715,230000,150],
  ["MacBook Pro M2 13\" (2022)","8GB/256GB",1240,1910000,1755000,1140,155000,100],
  ["MacBook Pro M2 13\" (2022)","8GB/512GB",1405,2165000,1995000,1295,170000,110],
  ["MacBook Air M2 15\" (2023)","16GB/256GB",1535,2365000,2180000,1415,185000,120],
  ["MacBook Air M2 15\" (2023)","16GB/512GB",1700,2620000,2405000,1560,215000,140],
  ["MacBook Air M2 15\" (2023)","24GB/256GB",1700,2620000,2405000,1560,215000,140],
  ["MacBook Air M2 15\" (2023)","24GB/512GB",1865,2870000,2640000,1715,230000,150],
  ["MacBook Air M2 15\" (2023)","8GB/256GB",1375,2120000,1950000,1265,170000,110],
  ["MacBook Air M2 15\" (2023)","8GB/512GB",1535,2365000,2180000,1415,185000,120],
  ["MacBook Air M3 13\" (2024)","16GB/256GB",1665,2565000,2365000,1535,200000,130],
  ["MacBook Air M3 15\" (2024)","16GB/256GB",1865,2870000,2640000,1715,230000,150],
  ["MacBook Air M3 13\" (2024)","16GB/512GB",1830,2820000,2590000,1680,230000,150],
  ["MacBook Air M3 15\" (2024)","16GB/512GB",2025,3120000,2875000,1865,245000,160],
  ["MacBook Air M3 13\" (2024)","24GB/256GB",1830,2820000,2590000,1680,230000,150],
  ["MacBook Air M3 15\" (2024)","24GB/256GB",2025,3120000,2875000,1865,245000,160],
  ["MacBook Air M3 13\" (2024)","24GB/512GB",1995,3070000,2825000,1835,245000,160],
  ["MacBook Air M3 15\" (2024)","24GB/512GB",2190,3375000,3100000,2015,275000,180],
  ["MacBook Air M3 13\" (2024)","8GB/256GB",1505,2320000,2135000,1385,185000,120],
  ["MacBook Air M3 15\" (2024)","8GB/256GB",1700,2620000,2405000,1560,215000,140],
  ["MacBook Air M3 13\" (2024)","8GB/512GB",1665,2565000,2365000,1535,200000,130],
  ["MacBook Air M3 15\" (2024)","8GB/512GB",1865,2870000,2640000,1715,230000,150],
  ["MacBook Air M4 13\" (2025)","16GB/256GB",1865,2870000,2640000,1715,230000,150],
  ["MacBook Air M4 15\" (2025)","16GB/256GB",2125,3275000,3015000,1960,260000,170],
  ["MacBook Air M4 13\" (2025)","16GB/512GB",2025,3120000,2875000,1865,245000,160],
  ["MacBook Air M4 15\" (2025)","16GB/512GB",2290,3525000,3250000,2110,275000,180],
  ["MacBook Air M4 13\" (2025)","24GB/256GB",2025,3120000,2875000,1865,245000,160],
  ["MacBook Air M4 15\" (2025)","24GB/256GB",2290,3525000,3250000,2110,275000,180],
  ["MacBook Air M4 13\" (2025)","24GB/512GB",2190,3375000,3100000,2015,275000,180],
  ["MacBook Air M4 15\" (2025)","24GB/512GB",2450,3775000,3465000,2250,310000,200],
  ["MacBook Air M4 13\" (2025)","32GB/512GB",2420,3725000,3430000,2225,295000,190],
  ["MacBook Air M4 15\" (2025)","32GB/512GB",2680,4125000,3800000,2470,325000,210],
  ["iPad Pro 10.5\" (2017)","256GB",460,710000,650000,420,60000,40],
  ["iPad Pro 10.5\" (2017)","64GB",360,555000,510000,330,45000,30],
  ["iPad Pro 12.9\" 2ª Gen (2017)","256GB",525,810000,750000,485,60000,40],
  ["iPad Pro 12.9\" 2ª Gen (2017)","64GB",425,655000,610000,395,45000,30],
  ["iPad Pro 11\" 1ª Gen (2018)","256GB",620,955000,880000,570,75000,50],
  ["iPad Pro 11\" 1ª Gen (2018)","64GB",490,755000,695000,450,60000,40],
  ["iPad Pro 12.9\" 3ª Gen (2018)","256GB",750,1155000,1065000,690,90000,60],
  ["iPad Pro 12.9\" 3ª Gen (2018)","64GB",590,910000,835000,540,75000,50],
  ["iPad Air 3ª Gen (2019)","256GB",390,600000,555000,360,45000,30],
  ["iPad Air 3ª Gen (2019)","64GB",295,455000,425000,275,30000,20],
  ["iPad Air 4ª Gen (2020)","256GB",590,910000,835000,540,75000,50],
  ["iPad Air 4ª Gen (2020)","64GB",460,710000,650000,420,60000,40],
  ["iPad Pro 11\" 2ª Gen (2020)","128GB",655,1010000,935000,605,75000,50],
  ["iPad Pro 11\" 2ª Gen (2020)","256GB",785,1210000,1120000,725,90000,60],
  ["iPad Pro 12.9\" 4ª Gen (2020)","128GB",815,1255000,1145000,745,110000,70],
  ["iPad Pro 12.9\" 4ª Gen (2020)","256GB",950,1465000,1340000,870,125000,80],
  ["iPad Pro 11\" M1 (2021)","128GB",785,1210000,1120000,725,90000,60],
  ["iPad Pro 11\" M1 (2021)","256GB",950,1465000,1340000,870,125000,80],
  ["iPad Pro 12.9\" M1 (2021)","128GB",980,1510000,1385000,900,125000,80],
  ["iPad Pro 12.9\" M1 (2021)","256GB",1175,1810000,1670000,1085,140000,90],
  ["iPad Air M1 5ª Gen (2022)","256GB",750,1155000,1065000,690,90000,60],
  ["iPad Air M1 5ª Gen (2022)","64GB",590,910000,835000,540,75000,50],
  ["iPad Pro 11\" M2 (2022)","128GB",950,1465000,1340000,870,125000,80],
  ["iPad Pro 11\" M2 (2022)","256GB",1110,1710000,1570000,1020,140000,90],
  ["iPad Pro 12.9\" M2 (2022)","128GB",1110,1710000,1570000,1020,140000,90],
  ["iPad Pro 12.9\" M2 (2022)","256GB",1275,1965000,1810000,1175,155000,100],
  ["iPad Air 11\" M2 (2024)","128GB",815,1255000,1145000,745,110000,70],
  ["iPad Air 11\" M2 (2024)","256GB",950,1465000,1340000,870,125000,80],
  ["iPad Air 13\" M2 (2024)","128GB",1015,1565000,1440000,935,125000,80],
  ["iPad Air 13\" M2 (2024)","256GB",1145,1765000,1625000,1055,140000,90],
  ["iPad Pro 11\" M4 (2024)","256GB",1600,2465000,2265000,1470,200000,130],
  ["iPad Pro 13\" M4 (2024)","256GB",1930,2970000,2740000,1780,230000,150],
  ["iPad Air 11\" M3 (2025)","128GB",1015,1565000,1440000,935,125000,80],
  ["iPad Air 11\" M3 (2025)","256GB",1175,1810000,1670000,1085,140000,90],
  ["iPad Air 13\" M3 (2025)","128GB",1210,1865000,1710000,1110,155000,100],
  ["iPad Air 13\" M3 (2025)","256GB",1375,2120000,1950000,1265,170000,110],];

/**
 * Crea (si no existe) y (re)puebla "Lista de Precios Mac-iPad" con
 * CATALOGO_INICIAL_MAC_IPAD. Pensada para ejecutarse UNA VEZ desde el editor
 * de Apps Script (o desde el menú, ver menuAgregarAlAbrir_() en Code.gs) al
 * activar esta línea de producto — no la llama la Web App ni ningún flujo
 * automático. Volver a ejecutarla sobrescribe la hoja completa con el
 * catálogo de este archivo (por eso pide confirmación si ya hay filas).
 */
function poblarListaPreciosMacIpad() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(MACIPAD_HOJA);

  if (sh && sh.getLastRow() > MACIPAD_FILA_ENCABEZADO) {
    const ui = SpreadsheetApp.getUi();
    const resp = ui.alert(
      "Lista de Precios Mac-iPad ya tiene datos",
      `La hoja "${MACIPAD_HOJA}" ya tiene ${sh.getLastRow() - MACIPAD_FILA_ENCABEZADO} fila(s) cargada(s).\n\n¿Reemplazar todo su contenido por el catálogo inicial (${CATALOGO_INICIAL_MAC_IPAD.length} modelos)?`,
      ui.ButtonSet.YES_NO
    );
    if (resp !== ui.Button.YES) return;
    sh.clear();
  }

  if (!sh) sh = ss.insertSheet(MACIPAD_HOJA);

  const encabezados = ["Modelo", "Almacenamiento", "Precio USD", "Precio ARS", "Preventa ARS", "Preventa USD", "Descuento ARS", "Descuento USD"];
  sh.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight("bold");
  sh.getRange(2, 1, CATALOGO_INICIAL_MAC_IPAD.length, encabezados.length).setValues(CATALOGO_INICIAL_MAC_IPAD);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, encabezados.length);

  SpreadsheetApp.getUi().alert(`✅ "${MACIPAD_HOJA}" cargada con ${CATALOGO_INICIAL_MAC_IPAD.length} modelos.`);
}

/**
 * Catálogo combinado Celulares + Mac/iPad, cada fila con `categoria` agregada
 * ("Celular" / "Mac/iPad"). Fuente para el selector de modelos de Compras y
 * Preventas (ver compras.html/preventas.html, opts.obtenerDatos) — así el
 * operador puede registrar la compra/preventa de una Mac o iPad con el mismo
 * flujo de "Equipo" que ya usa para celulares, sin tocar Code.gs ni las
 * hojas de Compras/Ventas/Preventas (que no tienen columna de categoría:
 * el texto del modelo elegido ya alcanza para identificar qué es).
 */
function obtenerCatalogoCompletoEquipos() {
  const celulares = obtenerListaPrecios().map(p => Object.assign({ categoria: "Celular" }, p));
  const macIpad = obtenerListaPreciosMacIpad().map(p => Object.assign({ categoria: "Mac/iPad" }, p));
  return celulares.concat(macIpad);
}
