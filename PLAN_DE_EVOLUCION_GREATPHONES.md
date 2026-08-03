---
title: Plan de Evolución de GreatPhones
version: 1.0
fecha: 2026-07-17
documentos_relacionados: ESPECIFICACION_FUNCIONAL_ERP.md, MATRIZ_DE_CAPACIDADES_GREATPHONES.md (ninguno modificado)
propósito: diseñar la mejor versión posible de GreatPhones para cada capacidad de negocio pendiente, usando el ERP únicamente como referencia del problema a resolver, nunca como plantilla de solución
---

# Plan de Evolución de GreatPhones

> **A partir de este documento, el ERP deja de ser el objeto de trabajo.** Cumplió su función: los documentos anteriores de este proyecto (`ESPECIFICACION_FUNCIONAL_ERP.md`, `MATRIZ_DE_CAPACIDADES_GREATPHONES.md`) ya extrajeron de él todo lo que valía la pena extraer — el conjunto completo de problemas de negocio reales que un ERP de compraventa de celulares necesita resolver. Este documento no vuelve a mirar el ERP como sistema a migrar. Lo usa exactamente una vez por capacidad, al principio, para recordar cuál es el problema — y después lo abandona por completo para pensar exclusivamente en GreatPhones.

---

## 1. Introducción

### 1.1 El cambio de pregunta

Todo el trabajo previo respondía, en el fondo, una pregunta de comparación: *"¿GreatPhones ya hace lo que hacía el ERP?"*. Ese ejercicio fue necesario y ya está terminado — su resultado es `MATRIZ_DE_CAPACIDADES_GREATPHONES.md`, con 19 capacidades marcadas como ausentes o insuficientes.

Este documento responde una pregunta distinta: ***"Si hoy empezáramos a construir cada una de esas 19 capacidades desde cero, con toda la arquitectura que GreatPhones ya tiene, ¿cuál sería la mejor forma de resolverlas?"***

La diferencia no es cosmética. Bajo la primera pregunta, la respuesta natural es "construir un equivalente de lo que tenía el ERP". Bajo la segunda, la respuesta correcta puede ser completamente distinta — y, en varios casos de este plan, lo es: una capacidad que en el ERP eran tres hojas de cálculo separadas puede resolverse en GreatPhones con un solo formulario y un selector; una capacidad que exigía un cuestionario extenso puede resolverse extendiendo un modal que ya existe; una capacidad que en el ERP necesitaba un subsistema propio (como el registro de "Transacciones" para detectar fallos a mitad de camino) directamente **desaparece**, porque la base de datos de GreatPhones ya resuelve ese problema de fábrica.

### 1.2 Principios de diseño aplicados en todo el documento

Estos criterios, exigidos explícitamente para este plan, se aplicaron sin excepción en las 26 capacidades diseñadas:

1. **Reutilizar antes que construir.** Cada diseño empieza por inventariar, con evidencia de código fresca, qué pieza de GreatPhones ya resuelve una parte del problema — nunca se asume que hace falta algo nuevo sin haber buscado primero.
2. **Menor cantidad de pantallas y de clics.** Ninguna de las 26 capacidades de este plan requiere más de una pantalla nueva en el panel administrativo (y la gran mayoría, cero). El criterio por defecto es siempre extender un modal, una pestaña o un formulario que ya existe.
3. **Menor cantidad de tablas nuevas.** De las 26 capacidades, solo 5 requieren una tabla de base de datos genuinamente nueva (ver §5). El resto se resuelve agregando campos a modelos existentes o reutilizando patrones ya construidos (`InventoryHistory`, `Supplier`, el discriminador de tipo ya usado en Stock/Promociones, etc.).
4. **Google Sheets nunca decide, nunca calcula, nunca valida.** En ninguno de los 26 diseños de este documento Google Sheets aparece como fuente de una decisión — siempre como destino de una copia histórica, generada después de que GreatPhones ya decidió y ya calculó. Este principio, establecido en `ESPECIFICACION_FUNCIONAL_ERP.md` (Parte IV), se sostiene sin excepciones en todo este plan.
5. **El ERP es fuente de reglas de negocio, nunca de arquitectura.** Cada capacidad cita explícitamente qué debe **evitarse** de la implementación original del ERP, y por qué esa forma específica ya no aplica (casi siempre porque era una solución a una limitación técnica de Google Sheets, no a una necesidad de negocio real).

### 1.3 Cómo se organizó este documento

Las 19 capacidades marcadas como ausentes en la Matriz, más las 7 capacidades marcadas con "ajustes menores" que requieren una decisión de diseño real (no solo un parche trivial), no se diseñaron como 26 documentos aislados. El análisis reveló que la enorme mayoría son facetas de un número mucho menor de **iniciativas** genuinamente independientes entre sí — diseñarlas por separado habría significado proponer la misma tabla o la misma pantalla varias veces con nombres distintos. Este documento se organiza en **7 iniciativas**, cada una resolviendo un grupo de capacidades estrechamente relacionadas:

| Iniciativa | Capacidades que resuelve | Es prerrequisito de |
|---|---|---|
| §4.1 Núcleo Contable | Registro contable centralizado, visibilidad de saldo de caja, ganancia real por venta, vínculo contable del ingreso, distinción compra/consignación | §4.3, §4.6 (parcialmente) |
| §4.2 Accesorios de Punta a Punta | Venta de accesorios, ingreso de mercadería de accesorios, trazabilidad de proveedor de accesorios | §4.5 (Regalos Automáticos) |
| §4.3 Tesorería Derivada | Gastos, Cambio de Moneda, Ajuste de Caja, Inversores | — |
| §4.4 Integridad y Gobierno de Operaciones | Anulación/corrección uniforme, snapshot recuperable, auditoría generalizada, vista unificada de operaciones, propagación de responsable | — |
| §4.5 Reserva y Servicio | Reserva de venta futura (Preventas), reparación/diagnóstico, regalos automáticos | (Regalos depende de §4.2) |
| §4.6 Reporting e Inteligencia de Negocio | Comisión real por vendedor, reportes consolidados, dashboard financiero, autodiagnóstico de integridad | — |
| §4.7 Configuración de Negocio | Parámetros editables sin tocar código, consolidación del modelo de Garantía | — |

### 1.4 Orden recomendado (por dependencia real, no por preferencia)

1. **Núcleo Contable** (§4.1) — todo lo demás que toca dinero depende de esto.
2. **Accesorios de Punta a Punta** (§4.2) e **Integridad y Gobierno** (§4.4) — pueden avanzar en paralelo al Núcleo Contable, no dependen de él.
3. **Tesorería Derivada** (§4.3) y **Reporting** (§4.6) — dependen de que el Núcleo Contable ya exista.
4. **Reserva y Servicio** (§4.5) — Reserva de venta futura y Reparaciones son independientes; Regalos Automáticos espera a que Accesorios de Punta a Punta esté resuelto.
5. **Configuración de Negocio** (§4.7) — independiente de todo lo anterior, puede resolverse en cualquier momento.

---

## 2. Situación actual (resumen)

Todas las capacidades diseñadas en este documento parten de la situación descrita en detalle en `MATRIZ_DE_CAPACIDADES_GREATPHONES.md`. En síntesis: GreatPhones hoy no tiene ningún registro contable centralizado, la venta de accesorios está funcionalmente rota en todos los canales, el mecanismo de anulación/corrección solo cubre pedidos, no existe reserva de venta sin stock ni gestión operativa de reparaciones, y los parámetros comerciales variables están escritos directamente en el código fuente del frontend. Cada sección de este documento retoma, en una línea, la situación puntual de la capacidad que diseña — el detalle completo con evidencia de código está en la Matriz, no se repite acá para no duplicar contenido entre documentos.

---

## 4. Las siete iniciativas

### 4.1 Núcleo Contable (Libro Diario + Caja)

> **Esta es la iniciativa fundacional del plan.** Ninguna otra capacidad que mueva dinero (Gastos, Cambio de Moneda, Ajuste de Caja, Reportes financieros, Comisiones, Dashboard con margen) tiene dónde apoyarse sin esto. Hoy el dinero del negocio vive disperso en cuatro lugares que nunca se leen juntos (`Order.total/payment/cashReceived/change`, `InventoryItem.purchasePrice/salePrice`, `Wallet.balance`, y nada en absoluto para gastos) — y esa dispersión ya causó un bug real y verificado: al cancelar una venta en local pagada por transferencia, el sistema decrementa el contador de "vendido" aunque la creación de esa venta solo había incrementado el contador de "reservado", nunca el de "vendido". Un registro único de movimientos, con saldo calculado por agregación (nunca guardado como campo mutable), hace ese tipo de bug estructuralmente imposible.

#### Capacidad: Registro contable centralizado

- **Problema de negocio**: que ningún movimiento de dinero del negocio quede fuera de un único lugar consultable, con un saldo que se pueda reconstruir y auditar en cualquier momento.
- **Situación actual**: no existe ningún modelo `Ledger`/`Journal` ni equivalente en la base de datos de GreatPhones (verificado, cero resultados en todo el esquema).
- **Componentes existentes reutilizables**: las transacciones atómicas de Prisma (`$transaction`), ya usadas en el checkout y en la venta en local, como mecanismo para que cada movimiento se registre junto con el efecto que lo origina; `Order.adminId`/`Order.userId` como fuente de "quién" generó el movimiento; `Order.code` como referencia externa ya familiar.
- **Componentes que NO deben reutilizarse**: ningún campo de `Order` como fuente del saldo (son datos de la operación, no del movimiento contable en sí — mezclarlos es exactamente el problema actual). Tampoco `Wallet`: modela el saldo de crédito de un cliente, un concepto de negocio distinto de la caja del negocio; no deben compartir tabla aunque ambos sean "un saldo".
- **Diseño recomendado**: una tabla única de movimientos de valor, donde cada fila registra un hecho ya ocurrido — tipo (ingreso/egreso), medio de pago, moneda, monto, a qué entidad de origen se refiere (por tipo + identificador genérico, no una relación obligatoria a `Order`, porque otros orígenes vendrán después), quién lo generó, cuándo. El saldo **nunca se guarda como campo mutable**: se calcula agregando los movimientos por medio de pago y moneda en el momento de la consulta — una base de datos relacional resuelve esto con una sola consulta agregada, sin necesitar el "saldo anterior/saldo nuevo encadenado fila por fila" que exigía una hoja de cálculo sin capacidad de agregación real. Cada operación que mueve valor escribe su entrada dentro de la misma transacción que ya modifica el resto del estado — ni un paso más, ni un proceso aparte.
- **Qué NO copiar del ERP jamás**: el saldo corrido campo por campo (columnas "saldo anterior"/"saldo nuevo" en cada fila) — es un artificio de hoja de cálculo sin función de suma agregada nativa, y replicarlo en una base de datos relacional cargaría con una limitación ajena sin ningún beneficio; además es frágil ante cualquier inserción fuera de secuencia, algo que una agregación por rango de fechas no sufre nunca. Tampoco copiar la reconstrucción destructiva del libro completo (borrar todo y regenerar desde una lista parcial de fuentes) — con una tabla que se escribe una sola vez por hecho real, no hace falta "reconstruir" nada: el registro ya es la fuente, no una proyección a recalcular.
- **Mejoras respecto al ERP**: saldo siempre exacto por agregación real, sin riesgo de error de encadenamiento manual; ningún riesgo de una "reconstrucción" que borre movimientos de tipos no cubiertos, porque no existe tal operación — el registro es incremental y permanente desde el primer día; consulta de saldo en cualquier rango de fechas de forma nativa.
- **Impacto en el sistema**: *Usuarios*: ninguno directo. *Administradores*: nueva fuente de verdad para cualquier pantalla que muestre dinero. *Auditoría*: cada entrada es, por diseño, inmutable — nunca se edita, solo se agregan entradas de reversión si algo se anula. *Google Sheets*: cada entrada se sincroniza de forma inmediata y en segundo plano hacia la hoja histórica de Libro Diario, nunca al revés. *Reportes*: gana una fuente real desde la cual construirse. *API*: un endpoint de consulta de saldo agregado; los endpoints existentes de venta ganan un paso adicional dentro de su misma transacción, no un endpoint nuevo. *Base de datos*: una tabla nueva.
- **Eventos involucrados**: `MovimientoValorRegistrado` (evento derivado, nunca disparado directamente por una persona — siempre reacción a otro evento de negocio, como venta confirmada).
- **Cambios en el panel administrador**: ninguna pantalla nueva. Se extiende el Dashboard existente agregando el bloque de saldo (ver siguiente capacidad, que comparte la misma pantalla).
- **Complejidad**: Media. **Prioridad**: Crítica.

#### Capacidad: Visibilidad de saldo de caja por medio de pago

- **Problema de negocio**: saber cuánto dinero disponible hay ahora, por medio de pago, sin mezclar pesos y dólares.
- **Situación actual**: el único agregado monetario existente en el Dashboard es un total de facturación bruta de ventas — no un saldo de caja, no resta egresos, no discrimina por medio de pago.
- **Componentes existentes reutilizables**: la tabla de movimientos de la capacidad anterior (esto es una *consulta* sobre esa tabla, no un almacenamiento separado); el endpoint de Dashboard ya existente, que hoy hace agregaciones por rango de fecha de forma muy similar a lo que un saldo de caja necesita.
- **Componentes que NO deben reutilizarse**: el total de facturación bruta que el Dashboard ya calcula — es un total de *ventas*, no un saldo de *caja*; no restar egresos con eso ni renombrarlo, son dos números distintos que deben convivir, no fusionarse.
- **Diseño recomendado**: una consulta agregada (suma agrupada por medio de pago y por moneda) sobre la tabla de movimientos, expuesta como una sección nueva dentro del mismo endpoint de Dashboard — no un endpoint nuevo.
- **Qué NO copiar del ERP jamás**: la exclusión manual de filas anuladas en cada cálculo de saldo — con una tabla de movimientos donde una reversión es una entrada nueva de signo contrario (nunca una fila marcada para excluir), el saldo agregado ya da el resultado correcto sin ninguna condición especial que recordar en cada consulta.
- **Mejoras respecto al ERP**: el ERP tuvo, documentado, un bug histórico real de sumar el saldo encadenado global en vez de por medio de pago — una agregación filtrada por medio no puede cometer ese error por diseño, la pregunta "¿por medio o global?" ni siquiera se plantea como una decisión de código a acertar.
- **Impacto en el sistema**: mismo bloque que la capacidad anterior (comparten tabla). *Dashboard*: gana su primera dimensión financiera de caja, hoy completamente ausente.
- **Eventos involucrados**: ninguno propio — es una consulta de lectura, no un hecho de negocio.
- **Cambios en el panel administrador**: el Dashboard existente — agregar una sección de "Caja" junto a los KPIs ya existentes.
- **Complejidad**: Baja (una vez resuelta la capacidad anterior). **Prioridad**: Crítica.

#### Capacidad: Cálculo de ganancia real por venta

- **Problema de negocio**: saber cuánto ganó realmente el negocio en cada venta, no solo cuánto facturó.
- **Situación actual**: existe el costo (`InventoryItem.purchasePrice`, `Product.cost`) y existe el precio de venta, pero ninguno de los tres caminos de venta de GreatPhones los relaciona ni los guarda juntos.
- **Componentes existentes reutilizables**: `InventoryItem.purchasePrice` y `Product.cost` (costo ya cargado por unidad/producto); `OrderItem.price` (precio de venta ya registrado por línea).
- **Componentes que NO deben reutilizarse**: ningún cálculo derivado en el momento de mostrar el dato (por ejemplo, calcular la ganancia "al vuelo" restando el costo *actual* del producto) — el costo puede cambiar después de la venta (nueva compra a otro precio), y una ganancia recalculada después con el costo equivocado sería falsa.
- **Diseño recomendado**: en el mismo paso de transacción donde ya se crea la línea del pedido (checkout, venta en local, venta desde inventario), guardar el costo vigente de ese ítem en ese momento junto al precio de venta ya existente — dos campos más en la línea del pedido, no una tabla nueva. La ganancia se calcula on-the-fly a partir de esos dos campos guardados, nunca se persiste como un tercer número redundante.
- **Qué NO copiar del ERP jamás**: la distinción "ganancia teórica vs. ganancia cobrada" como dos campos siempre calculados — el ERP la necesitaba porque una venta podía cobrarse parcialmente en cuotas a lo largo del tiempo sin confirmación inmediata. En GreatPhones, un pedido pasa a firme recién cuando el pago ya se confirmó (webhook o aprobación manual) — en ese momento lo pactado y lo cobrado ya son el mismo número por diseño. Mantener dos campos resolvería un problema que la propia arquitectura de pagos ya no tiene.
- **Mejoras respecto al ERP**: el ERP calculaba esto con fórmulas distintas en cada uno de sus módulos de venta; acá es un único campo de costo capturado en un único punto, reutilizable sin importar el canal porque los tres ya convergen sobre la misma línea de pedido.
- **Impacto en el sistema**: *Reportes/Dashboard*: ganan la posibilidad real de mostrar margen, no solo ingresos brutos. *Comisiones*: tiene de dónde salir un monto real. *Base de datos*: dos campos nuevos en una tabla existente, no una tabla nueva.
- **Eventos involucrados**: ninguno propio — se integra como parte de la información que ya genera el evento de venta confirmada existente.
- **Cambios en el panel administrador**: el detalle de un pedido ya existente — agregar la columna de ganancia junto al precio de cada línea.
- **Complejidad**: Baja. **Prioridad**: Alta.

#### Capacidad: Vínculo contable del ingreso de un equipo

- **Problema de negocio**: que dar de alta un equipo comprado con dinero del negocio se refleje como una salida real de ese dinero, igual que cualquier otra operación de valor.
- **Situación actual**: ninguna alta de inventario genera hoy ningún movimiento de valor.
- **Componentes existentes reutilizables**: el endpoint de alta de inventario ya es el único punto de entrada y ya corre dentro de una lógica transaccional coherente; `InventoryItem.purchasePrice` ya existe como el monto a registrar.
- **Componentes que NO deben reutilizarse**: no hace falta ningún componente nuevo de interfaz — el formulario de alta ya captura el costo, solo falta que ese dato dispare también la escritura en el registro de movimientos.
- **Diseño recomendado**: agregar, dentro de la misma transacción que ya crea el ítem de inventario, una entrada de egreso en la tabla de movimientos por el monto del costo de compra — un paso más en un flujo que ya existe.
- **Qué NO copiar del ERP jamás**: el color de fondo de fila como codificación de estado — es una convención visual de hoja de cálculo sin ningún valor en una interfaz de aplicación real, donde el estado ya se muestra como texto/badge de forma más clara.
- **Mejoras respecto al ERP**: el alta de inventario en GreatPhones ya es más rica que la del ERP (autocompletado por IMEI); agregar el vínculo contable la completa sin restarle nada de esa ventaja ya construida.
- **Impacto en el sistema**: *Base de datos*: ninguna tabla nueva, solo una escritura adicional dentro de una transacción existente. *Auditoría/Sheets/Reportes*: heredan automáticamente esta información en cuanto exista el Núcleo Contable, sin trabajo adicional propio.
- **Eventos involucrados**: ninguno propio — el alta de inventario gana una reacción adicional (`MovimientoValorRegistrado`).
- **Cambios en el panel administrador**: ninguno — el formulario de alta ya captura el dato necesario; el cambio es enteramente de backend.
- **Complejidad**: Baja. **Prioridad**: Alta.

#### Capacidad: Distinción compra propia vs. consignación

- **Problema de negocio**: que un equipo recibido de un tercero para vender a comisión no genere el mismo egreso de caja que uno comprado con dinero propio, porque el momento real del pago es distinto.
- **Situación actual**: no existe ningún campo que distinga el origen del capital de un ítem de inventario.
- **Componentes existentes reutilizables**: `InventoryItem.investor` ya existe como campo de texto libre y ya insinúa la necesidad de distinguir el origen del capital, aunque insuficiente tal como está (sin tipo, sin relación a nada).
- **Componentes que NO deben reutilizarse**: el campo `investor` tal cual, sin cambios — como texto libre no permite ninguna regla condicional confiable.
- **Diseño recomendado**: un campo de tipo cerrado (propio / consignación) en el ítem de inventario, condicionando qué entrada genera la capacidad anterior al darse de alta: si es propio, egreso real al ingresar; si es consignación, ninguna entrada al ingresar — recién se genera una entrada de egreso (por el monto acordado con el tercero) en el momento en que ese ítem efectivamente se vende, dentro de la misma transacción de venta.
- **Qué NO copiar del ERP jamás**: el color de fila combinado con el estado como única señal de consignación — el tipo debe ser un campo explícito y consultable, no una convención visual.
- **Mejoras respecto al ERP**: en el ERP la consignación generaba un asiento "neutro" en el momento del ingreso (una fila contable sin efecto real, solo para dejar constancia); en GreatPhones directamente no hace falta escribir nada hasta que el efecto de caja es real, evitando una entrada contable sin ningún movimiento de dinero detrás.
- **Impacto en el sistema**: *Base de datos*: un campo nuevo en el modelo de inventario. *Reportes*: puede distinguir a futuro cuánto del negocio es capital propio vs. de terceros.
- **Eventos involucrados**: ninguno propio — modifica la condición bajo la cual `MovimientoValorRegistrado` se dispara.
- **Cambios en el panel administrador**: el formulario de alta de inventario existente — agregar la selección de tipo de origen como un campo más.
- **Complejidad**: Baja. **Prioridad**: Media (depende de si el negocio sigue recibiendo mercadería en consignación — decisión de negocio previa, no técnica).

---

### 4.2 Accesorios de Punta a Punta

> Estas tres capacidades comparten una misma causa raíz: el catálogo de accesorios de GreatPhones vive desconectado del flujo real de venta y de compra. La solución no es reconstruir un módulo de accesorios — es terminar de conectar patrones que GreatPhones ya usa dos veces (para productos y para equipos) a una tercera entidad que hoy quedó afuera.

#### Capacidad: Venta de Accesorios

- **Problema de negocio**: vender un producto fungible (no serializado) descontando su stock automáticamente y dejando trazabilidad de la operación — solo o junto a un equipo, en cualquier canal.
- **Situación actual**: el catálogo de accesorios existe y se navega, pero el checkout y la venta en local solo saben buscar el identificador de un ítem del carrito contra la tabla de Productos — un accesorio nunca se encuentra ahí, y la operación falla con un error genérico sin que nadie del negocio se entere.
- **Componentes existentes reutilizables**: la línea de pedido ya admite ítems sin producto de catálogo asociado (el patrón usado hoy para ítems personalizados); el motor completo de checkout con reserva atómica de stock (transacción con incrementos/decrementos y verificación de negativo) — es un mecanismo genérico, no específico de Producto; el discriminador de tipo que el propio panel admin ya usa para tratar Producto+Accesorio de forma unificada en las pantallas de Stock y Promociones — el patrón de "un mismo listado, dos orígenes de datos" ya está resuelto y probado ahí; el carrito ya mezcla productos y accesorios en la misma lista; la pestaña de alta/edición de accesorios ya existe en el panel admin.
- **Componentes que NO deben reutilizarse**: no conviene fusionar el modelo de Accesorio dentro del de Producto (agregar un indicador "es accesorio") — tienen campos genuinamente distintos (batería, RAM, procesador, IMEI no aplican a un accesorio); fusionarlos generaría un modelo ambiguo con muchos campos vacíos.
- **Diseño recomendado**: agregar a la línea de pedido una relación opcional al Accesorio (mismo patrón exacto que la relación a Producto). En el carrito y el checkout, incluir un discriminador de tipo por ítem (extendiendo la misma convención textual que el admin ya usa en Stock/Promociones, no una convención nueva). En checkout público, webhook de pago y venta en local, resolver cada ítem contra la tabla que corresponda según ese discriminador, extendiendo la categorización que la venta en local ya hace hoy con un grupo más, sin duplicar la lógica de validación de stock que ya existe. La reserva atómica y el paso de reservado a vendido se aplican con el mismo mecanismo ya construido, sobre el stock de Accesorio en vez de Producto.
- **Qué NO copiar del ERP jamás**: el prorrateo de medios de pago entre líneas — existía porque un cliente podía combinar efectivo+transferencia+cuotas dentro de una misma operación con varios ítems; en GreatPhones el pago es siempre un monto único por pedido, prorratear sería complejidad sin ningún problema real detrás. Tampoco la coexistencia de dos flujos de venta de accesorios (uno simple sin control de stock, otro completo) que el propio ERP ya señalaba como una asimetría real de trazabilidad — GreatPhones debe tener un único camino de venta de accesorios.
- **Mejoras respecto al ERP**: reserva atómica de stock de accesorios durante el checkout (el ERP nunca tuvo ningún estado intermedio de reserva, ni para equipos ni para accesorios); un único flujo de venta en vez de dos flujos simultáneos; auditoría automática incluida dentro del mismo pedido que ya trazabiliza cliente/pago/fecha, sin mecanismo aparte.
- **Impacto en el sistema**: *Usuarios*: pueden comprar accesorios online (hoy no pueden). *Administradores*: pueden vender accesorios reales en el local con stock real descontado. *Auditoría*: automática, vía el mismo pedido. *Google Sheets*: la sincronización de "Venta" ya prevista simplemente amplía su alcance, sin que Sheets decida ni calcule nada nuevo. *Reportes/Dashboard*: pueden incorporar accesorios a los indicadores existentes. *API*: los tres endpoints de venta deben reconocer el nuevo discriminador. *Base de datos*: un campo nuevo en una tabla existente.
- **Eventos involucrados**: ninguno estrictamente nuevo — el evento de venta confirmada ya existente simplemente amplía su alcance para incluir accesorios.
- **Cambios en el panel administrador**: ninguna pantalla nueva. Extender el selector de ítems ya existente en Venta en Tienda para que también busque en el catálogo de accesorios, reutilizando el mismo buscador.
- **Complejidad**: Media (cambio de esquema mínimo, pero toca tres puntos de integración con cuidado de no romper el flujo de Producto ya funcionando). **Prioridad**: Crítica.

#### Capacidad: Ingreso de mercadería de Accesorios

- **Problema de negocio**: cuando llega un pedido de accesorios, registrar cuánto costó y a quién se le compró, para poder calcular ganancia real en cada venta y saber a quién volver a comprarle.
- **Situación actual**: crear o editar un accesorio simplemente fija un número de stock arbitrario enviado desde el panel — no hay costo unitario, no hay proveedor, no hay concepto de "línea de compra".
- **Componentes existentes reutilizables**: el modelo de Proveedor, ya vinculado a Producto e Inventario con el mismo patrón de relación — directamente extensible; el stock de Accesorio ya existe (solo falta acompañarlo de costo); el patrón de historial ya probado para dejar constancia de cada evento sobre un ítem (el mismo que usa Inventario) es el molde correcto a replicar si se quiere trazabilidad de cada reposición; la pantalla de alta/edición de Accesorios ya existente es la base natural.
- **Componentes que NO deben reutilizarse**: no conviene copiar la mecánica de "compra multilínea" del ERP como pantalla separada de captura tipo cuestionario — el ERP la necesitaba porque el catálogo de accesorios no existía de antemano, se creaba recién en el momento de la primera compra. En GreatPhones el catálogo ya existe de antemano la mayoría de las veces — reponer stock es una acción sobre algo que ya está identificado, no un alta desde cero. Tampoco copiar la validación de "total pagado = suma de líneas" — esa reconciliación existía porque el ERP registraba el pago de toda la compra como un solo movimiento repartido entre líneas; si cada reposición se registra con su propio costo directamente, no hace falta cuadrar nada.
- **Diseño recomendado**: agregar al Accesorio un campo de costo (unitario, o costo promedio ponderado si se quiere fidelidad histórica) y una relación opcional a Proveedor — mismo patrón ya usado dos veces en el modelo de datos. La "reposición de stock" se modela como una acción sobre el accesorio ya existente (incrementar stock + registrar costo/proveedor de esa reposición), disparada desde la misma pantalla de edición de Accesorios — no una pantalla nueva de "Compras". Si se decide llevar costo promedio ponderado histórico, conviene reutilizar el patrón de historial de eventos ya existente, en vez de crear una tabla de "líneas de compra" nueva.
- **Qué NO copiar del ERP jamás**: el formulario multilínea con conciliación de pago total; la auto-creación de identificador de producto por combinación de texto normalizado — GreatPhones ya tiene identidad real por catálogo existente, no hace falta inferirla.
- **Mejoras respecto al ERP**: el catálogo existe de antemano (elimina el riesgo de duplicados por variación de texto que sí tenía el ERP); proveedor como entidad real y única para todo el negocio, no listas de texto libre distintas por rubro.
- **Impacto en el sistema**: *Administradores*: pueden saber cuánto cuesta reponer cada accesorio. *Reportes*: la ganancia de venta de accesorios deja de ser ficticia una vez que hay un costo real que restar. *Base de datos*: dos campos nuevos en el modelo de Accesorio, sin tabla nueva si se acepta costo simple.
- **Eventos involucrados**: si se decide llevar historial detallado, un evento equivalente a "reposición de stock registrada" — mismo patrón conceptual que el alta de inventario, aplicado a una entidad fungible.
- **Cambios en el panel administrador**: la pestaña de Accesorios existente — agregar campos de costo y proveedor al formulario ya existente, y una acción de "reponer stock" dentro de esa misma pantalla.
- **Complejidad**: Baja-Media. **Prioridad**: Crítica (sin esto, la rentabilidad de accesorios sigue siendo ficticia aunque se resuelva la venta).

#### Capacidad: Trazabilidad de proveedor de Accesorios

- **Problema de negocio**: saber a quién comprarle de nuevo cada accesorio y cuánto se le compró en total.
- **Situación actual**: resuelto para equipos, no para accesorios — en la práctica es la mitad de la capacidad anterior.
- **Componentes existentes reutilizables**: el modelo de Proveedor, ya vinculado dos veces con el mismo patrón; el campo de total acumulado de Proveedor ya existe y podría sumar automáticamente cualquier compra registrada, sea de equipos o accesorios, sin cambios adicionales.
- **Componentes que NO deben reutilizarse**: ninguno que evitar — extensión directa y sin fricción de un patrón ya validado dos veces.
- **Diseño recomendado**: relación opcional a Proveedor en el modelo de Accesorio, idéntica a la ya existente en Producto e Inventario.
- **Qué NO copiar del ERP jamás**: nada específico — el ERP nunca tuvo trazabilidad real de proveedor para ningún rubro; es una capacidad enteramente nueva sobre una base ya sólida de GreatPhones.
- **Mejoras respecto al ERP**: directorio único de proveedores para todo el negocio, algo que el ERP nunca logró ni para una sola categoría.
- **Impacto en el sistema**: mínimo — un campo de relación adicional, sin eventos nuevos.
- **Eventos involucrados**: ninguno.
- **Cambios en el panel administrador**: la misma pestaña de Accesorios de la capacidad anterior — un selector de proveedor más en el mismo formulario.
- **Complejidad**: Baja. **Prioridad**: Alta (se resuelve junto con la capacidad anterior, no tiene sentido implementarla por separado).

---

### 4.3 Tesorería Derivada

> **Premisa**: esta iniciativa asume que el Núcleo Contable (§4.1) ya existe. En el ERP, Gastos/Cambio de Moneda/Ajuste de Caja eran tres hojas separadas porque Google Sheets no tiene relaciones. En una base de datos relacional real esa separación es innecesaria: las tres son, conceptualmente, el mismo caso de uso — un movimiento manual sobre el Núcleo Contable, con un campo de tipo que distingue egreso operativo / conversión de moneda / ajuste de arqueo. Diseñarlas como tres entidades separadas copiaría la limitación técnica del ERP, no su regla de negocio.

#### Capacidad: Gastos (egresos operativos)

- **Problema de negocio**: dejar constancia de cada salida de dinero no ligada a mercadería, con categoría, responsable y comprobante, para poder calcular utilidad real.
- **Situación actual**: no existe ningún modelo ni endpoint equivalente.
- **Componentes existentes reutilizables**: el Núcleo Contable (como caso de uso, no como entidad nueva); la autenticación real como responsable; el servicio de imágenes ya integrado (usado hoy para chat/producto) para adjuntar el comprobante.
- **Componentes que NO deben reutilizarse**: el modelo de Pedido — un gasto no es una venta, forzarlo ahí arrastraría decenas de campos irrelevantes (envío, pago online, arrepentimiento). Tampoco Wallet — es saldo de cliente, no caja del negocio.
- **Diseño recomendado**: no crear una entidad "Gasto" separada. Un gasto es un movimiento del Núcleo Contable con categoría "egreso operativo", capturado en un formulario corto (categoría, monto, medio, comprobante opcional, nota) accesible desde la futura pantalla de Caja/Tesorería.
- **Qué NO copiar del ERP jamás**: el pago combinado en tres medios simultáneos con validación de tolerancia de un peso — sobre-ingeniería de un sistema sin tipos fuertes; con inputs numéricos tipados ese riesgo casi no existe (si se pagó en dos medios, se cargan dos movimientos). Tampoco la lista de categorías hardcodeada en código — mejor texto libre con autocompletado de las últimas usadas.
- **Mejoras respecto al ERP**: comprobante como foto real, no solo un número de texto; responsable identificado por sesión real, no por selector manual; aparece automáticamente en cualquier reporte que consulte el Núcleo Contable, sin desarrollo adicional.
- **Impacto en el sistema**: sin impacto en clientes. Administradores ganan una acción nueva. Auditoría/Sheets/Reportes heredan gratis del Núcleo Contable.
- **Eventos involucrados**: ninguno de primera clase — es un caso de uso del evento genérico del Núcleo Contable.
- **Cambios en el panel administrador**: extender la futura pantalla de Caja/Tesorería con una acción "Registrar gasto" — no crear pestaña nueva en la navegación principal.
- **Complejidad**: Baja. **Prioridad**: Alta.

#### Capacidad: Cambio de Moneda

- **Problema de negocio**: registrar formalmente una conversión de tesorería propia entre pesos y dólares, a una cotización que puede no ser la oficial, sin que el dinero "aparezca" o "desaparezca" de ningún lado.
- **Situación actual**: no existe ningún concepto de mover dinero entre dos cajas propias del negocio.
- **Componentes existentes reutilizables**: el Núcleo Contable, si soporta agrupar dos asientos bajo una misma referencia de operación.
- **Componentes que NO deben reutilizarse**: Pedido y Wallet, mismos motivos que en Gastos.
- **Diseño recomendado**: dos movimientos del Núcleo Contable con la misma referencia — egreso en el medio origen, ingreso en el medio destino —, generados por un único formulario con selector doble de medio, validando que exactamente uno de los dos sea dólares. El monto en pesos se calcula siempre en el servidor, nunca se acepta precalculado del cliente — esta regla del ERP es integridad real, no un vestigio, y debe preservarse.
- **Qué NO copiar del ERP jamás**: nada especialmente objetable acá — el diseño original era razonable. Simplificar solamente la interfaz.
- **Mejoras respecto al ERP**: visibilidad automática en cualquier reporte de caja en vivo, sin depender de un botón de recálculo manual (el ERP tenía un bug real ya documentado donde el consolidado de Reportes no siempre se actualizaba tras cada operación — este diseño lo evita de raíz).
- **Impacto en el sistema**: mismo patrón que Gastos, sin impacto en clientes.
- **Eventos involucrados**: ninguno obligatorio; opcionalmente un evento semántico propio si el negocio quiere reaccionar específicamente (por ejemplo, alertar si la cotización usada se aleja mucho de la oficial).
- **Cambios en el panel administrador**: la misma pantalla de Caja/Tesorería, acción "Convertir moneda".
- **Complejidad**: Baja. **Prioridad**: Media.

#### Capacidad: Ajuste de Caja

- **Problema de negocio**: cuando un arqueo físico no coincide con el saldo que el sistema calcula, dejar constancia formal y obligatoriamente justificada de la diferencia.
- **Situación actual**: no existe.
- **Componentes existentes reutilizables**: el Núcleo Contable; el patrón de "motivo obligatorio" como validación de formulario, reutilizable también en Anulaciones/Correcciones.
- **Componentes que NO deben reutilizarse**: nada particular a evitar — es el caso más simple de los tres.
- **Diseño recomendado**: tercer caso de uso del mismo movimiento manual sobre el Núcleo Contable (ingreso si sobrante, egreso si faltante), con motivo obligatorio. Es, en la práctica, el mismo formulario que Gastos y Cambio de Moneda con un selector de tipo — no una pantalla ni un flujo distinto.
- **Qué NO copiar del ERP jamás**: tratarlo como una hoja/pantalla separada, como si fuera un módulo distinto de Gastos.
- **Mejoras respecto al ERP**: unificación real — ni siquiera pestañas separadas, sino la misma acción "Registrar movimiento de caja" con un selector de tipo, reduciendo aún más la superficie de interfaz.
- **Impacto en el sistema**: mismo patrón que Gastos.
- **Eventos involucrados**: ninguno de primera clase.
- **Cambios en el panel administrador**: misma pantalla de Caja/Tesorería.
- **Complejidad**: Baja. **Prioridad**: Media.

#### Capacidad: Financiamiento externo por Inversores

- **Problema de negocio**: llevar la cuenta corriente de terceros que aportan capital (cuánto tienen invertido, cuánto se les debe, topes que no se pueden superar), y calcular periódicamente el rendimiento adeudado.
- **Situación actual**: la única pieza real es un campo de texto libre en cada equipo de inventario, sin ninguna relación a una entidad de inversor, sin cálculo de capital, sin tope de retiro, sin rendimiento.
- **Componentes existentes reutilizables**: el Núcleo Contable, para que un retiro o pago de rendimiento con impacto real de caja quede en la misma fuente de verdad que el resto del negocio (a diferencia del ERP, donde el vínculo entre un movimiento de inversor y su asiento contable era débil, identificado por nombre, no por número — riesgo ya documentado). El *patrón* del modelo de Wallet (saldo + validación de tope antes de mover) es una referencia de diseño válida, aunque no la tabla en sí.
- **Componentes que NO deben reutilizarse**: Wallet tal cual — insuficiente: un inversor necesita capital invertido (no retirable libremente) separado de rendimiento pendiente (sí retirable), con topes distintos para cada uno; Wallet solo tiene un saldo único sin esa distinción ni tabla de movimientos. Pedido no aplica. Forzar al inversor a ser un usuario con login no se justifica salvo que el negocio decida, a futuro y como decisión aparte, darle un portal de consulta.
- **Diseño recomendado**: una entidad de Inversor simple (sin login, salvo decisión futura del negocio), con sus movimientos (aporte, retiro, pago de rendimiento, ajuste) como filas relacionadas por clave real — no por nombre de texto. Cada movimiento con impacto de caja genera además un asiento en el Núcleo Contable, vinculado por identificador real.
- **Qué NO copiar del ERP jamás**: la estructura de "paneles por inversor" dentro de una misma hoja con tablas de tamaño variable — es una solución específica a que Google Sheets no tiene relaciones; en una base de datos real, cada inversor es simplemente una fila con movimientos vinculados. La identificación de movimientos por nombre en vez de por número de operación único — causa raíz de que el ERP no pudiera anular automáticamente el asiento contable de un movimiento de inversor; con clave real, este problema desaparece por diseño, no por parche. El tipo de movimiento "Ajuste" que en el ERP no modificaba ningún campo del resumen del inversor (regla ambigua ya documentada) — si GreatPhones tiene un ajuste, debe definir explícitamente qué campo toca. Que todo movimiento se contabilice siempre como el mismo medio de pago sin importar el medio real.
- **Mejoras respecto al ERP**: vínculo contable real y trazable; auditoría unificada con el resto del sistema en vez de una hoja aislada; posibilidad futura de portal de consulta para el inversor, aprovechando que ya existe autenticación real.
- **Impacto en el sistema**: sin impacto en clientes (salvo que se decida dar portal a inversores). Administradores ganan una sección de gestión nueva. Auditoría mejora respecto al ERP. Sheets recibe el movimiento como snapshot histórico, igual que el resto — nunca calcula nada. Dashboard podría, opcionalmente, mostrar "capital de terceros invertido".
- **Eventos involucrados**: `MovimientoInversorRegistrado` (aporte/retiro/pago) y `RendimientoDevengado` (generación periódica del rendimiento pendiente, sin mover caja) — a diferencia de Gastos/Cambio de Moneda/Ajuste de Caja, esta sí es una entidad de negocio con ciclo de vida propio, no un caso de uso del Núcleo Contable.
- **Tablas nuevas**: sí, las únicas de esta iniciativa — Inversor (nombre, contacto, capital invertido, pagado total, tasa de rendimiento) y Movimiento de Inversor (tipo, monto, fecha, referencia al asiento del Núcleo Contable si aplica, responsable). No hace falta una tercera tabla para "rendimientos generados" — se modela como un movimiento de tipo "rendimiento devengado" sin impacto de caja.
- **Cambios en el panel administrador**: a diferencia de las otras tres capacidades de esta iniciativa, sí justifica una pantalla propia (gestión de una relación continua con historial) — pero puede integrarse como pestaña dentro de la futura sección de Tesorería, no como un ítem de navegación principal nuevo.
- **Complejidad**: Media (única de las cuatro con tablas nuevas reales y pantalla de gestión propia).
- **Prioridad**: evaluada explícitamente, no heredada por defecto del ERP — se mantiene **Baja-Media**. El contexto del negocio cambió (ahora opera como e-commerce con checkout y pagos propios), pero eso no vuelve a Inversores más urgente; si acaso, el foco actual del negocio está claramente en ventas y checkout, no en financiamiento de mercadería. A diferencia del Núcleo Contable o de Integridad, la ausencia de esta capacidad no bloquea ninguna venta ni compromete la integridad financiera del día a día, y el negocio puede seguir llevando esa cuenta corriente por fuera de GreatPhones sin fricción, porque Inversores nunca tuvo dependencias hacia Ventas o Stock.

---

### 4.4 Integridad y Gobierno de Operaciones

> Estas cinco capacidades no son cinco problemas — son **una sola capacidad transversal** ("dejar constancia de qué pasó, revertirlo con seguridad si hace falta, y encontrarlo todo desde un solo lugar") aplicada hoy de forma desigual. El diseño las unifica alrededor de una única pieza: una tabla de auditoría genérica y polimórfica que registra qué cambió, quién lo cambió, y cuál era el valor antes — esa misma tabla sirve simultáneamente como auditoría y como snapshot recuperable, sin necesitar dos mecanismos separados como tenía el ERP.

#### Capacidad: Anulación/corrección segura y uniforme de cualquier operación

- **Problema de negocio**: cuando alguien carga o procesa mal una operación, poder revertirla o corregirla sin perder rastro y sin desincronizar lo que esa operación ya afectó.
- **Situación actual**: solo el Pedido tiene un mecanismo de reversión real (vía Arrepentimiento o cancelación manual de venta en local); Productos, ítems de inventario, reparaciones y cotizaciones no tienen ningún mecanismo de reversión con motivo obligatorio.
- **Componentes existentes reutilizables**: el patrón transaccional ya probado en la cancelación de venta en local y en el webhook de pago; el estado "cancelado" ya existente en el ciclo de vida del pedido; el modelo de Arrepentimiento como ejemplo de "motivo + resolución" para un caso puntual.
- **Componentes que NO deben reutilizarse**: el mecanismo de búsqueda "por coincidencia de texto del código de orden dentro de una descripción", hoy usado en la cancelación de venta en local — es frágil y no debe generalizarse; cualquier reversión nueva debe vincularse por relación real, no por texto. Tampoco los campos duplicados de estado de arrepentimiento que hoy coexisten de forma redundante con la entidad completa — es una duplicación a no repetir en otras entidades.
- **Diseño recomendado**: una función de servidor única y genérica de "anular operación" (entidad + identificador + motivo), reutilizable desde cualquier endpoint, que dentro de una transacción revierte los efectos específicos de esa entidad (stock si aplica, estado si aplica), marca un estado terminal ya existente en esa entidad cuando exista, y escribe un evento en la tabla de auditoría genérica con el estado completo anterior. Para "corrección" de un dato mal cargado sin efectos de negocio ya aplicados, no hace falta el patrón del ERP de "anular y crear una nueva vinculada" — alcanza con una edición normal cuyo cambio quede registrado en la misma tabla de auditoría. El patrón "anular + recrear" solo se justifica cuando los efectos de negocio ya se aplicaron (pago cobrado, stock descontado) y hay que revertirlos antes de volver a cargar bien — en ese caso es, en rigor, una anulación seguida de una operación nueva, no un tercer mecanismo aparte.
- **Qué NO copiar del ERP jamás**: el sistema de "Transacciones" del ERP (registro de inicio/fin de cada anulación) — existía únicamente porque Google Apps Script no tiene transacciones nativas ni rollback. GreatPhones corre sobre una base de datos real con transacciones atómicas: si algo falla a mitad de camino, la base de datos revierte todo sola. Construir una capa de negocio para "detectar ejecuciones cortadas" sería resolver, con código propio, un problema que la base de datos ya resuelve gratis. Tampoco copiar la restricción "una operación que ya es resultado de una corrección no puede volver a corregirse" tal cual: existía para evitar cadenas infinitas de filas vinculadas en una hoja de cálculo; con un historial de auditoría real, no hay ese riesgo.
- **Mejoras respecto al ERP**: cobertura pareja para toda entidad desde el día uno (el ERP fue agregando esto módulo por módulo, de forma desigual); reversión atómica real; ninguna duplicación de filas por corrección.
- **Impacto en el sistema**: *Usuarios*: ninguno directo. *Administradores*: nueva acción disponible en cada pantalla de detalle ya existente ("Anular", con motivo obligatorio). *Auditoría*: se vuelve completa y uniforme. *Google Sheets*: cada anulación se sincroniza como un evento histórico más. *Reportes/Dashboard*: deben excluir entidades anuladas de sus agregados, igual criterio que ya aplican con pedidos cancelados. *API*: un endpoint genérico de anulación, reutilizable por tipo de entidad. *Base de datos*: una tabla nueva (auditoría genérica); ningún modelo existente pierde campos.
- **Eventos involucrados**: `OperacionAnulada` (genérico para cualquier entidad, reemplaza la necesidad de un evento por tipo).
- **Cambios en el panel administrador**: agregar un botón "Anular" (con motivo obligatorio) al modal de detalle que ya existe en Pedidos, Cotizaciones, Arrepentimientos y (cuando exista) Reparaciones — ninguna pantalla nueva.
- **Complejidad**: Media. **Prioridad**: Crítica.

#### Capacidad: Snapshot recuperable antes de anular

- **Problema de negocio**: si una anulación fue un error de juicio, poder reconstruir manualmente el estado exacto de antes.
- **Situación actual**: no existe ninguna tabla ni mecanismo de snapshot previo a un cambio de estado.
- **Componentes existentes reutilizables**: nada existe hoy; pero el diseño de la capacidad anterior (tabla de auditoría con valor anterior) resuelve esto como efecto colateral, sin trabajo adicional.
- **Componentes que NO deben reutilizarse**: no crear una tabla de "backup" separada de la de auditoría — sería duplicar el mismo dato en dos lugares sin necesidad, contrario al criterio de simplicidad.
- **Diseño recomendado**: ninguno adicional al de la capacidad anterior — ya la resuelve.
- **Qué NO copiar del ERP jamás**: el límite de tamaño por celda que obligaba al ERP a truncar snapshots grandes — limitación de Google Sheets, no de una base de datos real; no hay que replicar esa preocupación.
- **Mejoras respecto al ERP**: recuperación siempre completa y nunca truncada.
- **Impacto en el sistema**: mismo que la capacidad anterior (es la misma tabla).
- **Eventos involucrados**: ninguno adicional — es un atributo del evento de anulación.
- **Cambios en el panel administrador**: ninguna pantalla nueva — el valor anterior se muestra dentro del mismo visor de historial de la siguiente capacidad.
- **Complejidad**: Baja (incluida en la capacidad anterior). **Prioridad**: Alta.

#### Capacidad: Auditoría permanente generalizada

- **Problema de negocio**: responder siempre "¿quién hizo qué, cuándo y por qué?" para cualquier entidad, no solo inventario.
- **Situación actual**: existe un historial de cambios bien construido, pero únicamente para ítems de inventario.
- **Componentes existentes reutilizables**: el patrón de historial de inventario (tipo de evento, valor anterior/nuevo, descripción, usuario, fecha) es la plantilla conceptual correcta a generalizar, no a descartar.
- **Componentes que NO deben reutilizarse**: no mantener el historial de inventario como una tabla aislada mientras se crea una genérica aparte para el resto — generaría dos fuentes de verdad de auditoría conviviendo. La tabla nueva genérica debe reemplazar el rol del historial de inventario hacia adelante (los datos históricos existentes se preservan, el nuevo mecanismo pasa a ser el único punto de escritura para todo, incluido inventario).
- **Diseño recomendado**: la tabla de auditoría genérica de la primera capacidad de esta iniciativa, usada por todas las entidades por igual desde el mismo punto de entrada.
- **Qué NO copiar del ERP jamás**: la distinción rígida entre "Auditoría" (solo anulaciones/restauraciones) y "Correcciones" (hoja aparte) — son dos tablas del ERP que existen separadas por limitación de Sheets (cada hoja es su propio archivo), no por necesidad de negocio. En una base de datos real, es un único registro de eventos con un campo de tipo.
- **Mejoras respecto al ERP**: cobertura total desde el primer día, en vez de ir agregándose módulo por módulo; consultable con filtros reales (por entidad, por usuario, por fecha).
- **Impacto en el sistema**: *Google Sheets*: recibe el espejo histórico completo de cada evento de auditoría. *Reportes*: pueden filtrar "operaciones corregidas/anuladas por período" directamente de esta tabla. *API*: un endpoint de consulta genérico, reutilizable desde cualquier pantalla.
- **Eventos involucrados**: `AuditoriaRegistrada` (genérico, dispara la sincronización hacia Sheets).
- **Cambios en el panel administrador**: agregar un botón "Historial" al modal de detalle ya existente de cada entidad — no una pantalla dedicada.
- **Complejidad**: Media. **Prioridad**: Alta.

#### Capacidad: Vista unificada de operaciones con capacidad de intervenir

- **Problema de negocio**: un lugar único para encontrar cualquier operación sin saber de antemano su tipo, y actuar sobre ella.
- **Situación actual**: el panel administrativo está organizado en pestañas separadas e independientes por tipo de entidad, sin ninguna pantalla que combine todo tipo de operación.
- **Componentes existentes reutilizables**: el Dashboard ya agrega "últimos pedidos" — es la base natural para extender, no reemplazar. Cada entidad ya tiene su propio listado y modal de detalle funcionando.
- **Componentes que NO deben reutilizarse**: no construir esto como una pestaña nueva del panel — contradice el criterio explícito de minimizar pantallas, y el propio ERP demuestra que una vista "todo junto" separada termina siendo una pantalla más a mantener en paralelo a las demás.
- **Diseño recomendado**: extender la sección de "últimos pedidos" del Dashboard a un widget de "actividad reciente" que combine Pedidos, Cotizaciones, Reparaciones y Arrepentimientos (reutilizando la tabla de auditoría genérica como fuente, ya que ahí quedan todos los eventos con fecha real), con un buscador simple por código; y reutilizar el mismo botón "Ver / Anular / Historial" en el modal de detalle de cada entidad, en vez de una única pantalla con botones genéricos.
- **Qué NO copiar del ERP jamás**: la política "sin restricción de permisos, cualquier operador anula cualquier cosa de cualquier otro sin límite de tiempo" no debe copiarse sin evaluarla — GreatPhones ya tiene roles reales; el negocio debe decidir explícitamente si mantiene esa apertura total o la acota (decisión de negocio, no rediseño técnico, fuera del alcance de este documento).
- **Mejoras respecto al ERP**: la búsqueda es real (consulta indexada) en vez de "buscar por texto en una hoja"; el mismo dato nunca vive en dos pantallas distintas.
- **Impacto en el sistema**: *Administradores*: ganan un punto de entrada rápido sin pantalla nueva que aprender. *API*: un endpoint de "actividad reciente" que combina varias tablas por fecha.
- **Eventos involucrados**: ninguno — consume los ya definidos en las capacidades anteriores de esta iniciativa.
- **Cambios en el panel administrador**: se modifica el Dashboard existente (agregar el widget) y los modales de detalle ya existentes (agregar los botones de Historial/Anular) — cero pantallas nuevas.
- **Complejidad**: Baja. **Prioridad**: Media.

#### Capacidad: Propagación de responsable a Cotizaciones, Reparaciones y Arrepentimientos

- **Problema de negocio**: saber qué administrador aprobó/rechazó/resolvió cada una de estas operaciones (hoy solo Pedidos y Conversaciones lo registran).
- **Situación actual**: solo Pedidos y Conversaciones tienen un campo que identifique qué administrador actuó.
- **Componentes existentes reutilizables**: el patrón exacto ya probado en Pedidos (relación al usuario administrador) — se replica igual, no se inventa nada nuevo.
- **Componentes que NO deben reutilizarse**: no depender únicamente de esto como fuente de auditoría — es un campo de acceso rápido, no reemplaza el registro completo de la capacidad de Auditoría generalizada (si dos administradores tocan la misma cotización en momentos distintos, el campo único solo mostraría al último; el historial completo sí preserva a ambos).
- **Diseño recomendado**: agregar el mismo campo de responsable que ya tiene Pedido a Cotización, Reparación y Arrepentimiento, poblado automáticamente por la función genérica de auditoría en cada acción — no requiere que el administrador lo seleccione a mano (se toma de la sesión autenticada).
- **Qué NO copiar del ERP jamás**: el selector manual de "operador" sin verificación — GreatPhones ya resolvió esto mejor con login real; no hay que introducir ningún selector manual nuevo.
- **Mejoras respecto al ERP**: identidad garantizada por sesión autenticada, nunca declarada a mano y potencialmente falsa.
- **Impacto en el sistema**: mínimo — un campo más en tres modelos existentes, poblado automáticamente por el mecanismo ya diseñado en Auditoría generalizada.
- **Eventos involucrados**: ninguno — es un atributo adicional de los eventos ya definidos.
- **Cambios en el panel administrador**: ninguna pantalla nueva; los modales de detalle ya existentes ganan un dato más para mostrar.
- **Complejidad**: Baja. **Prioridad**: Alta.

---

### 4.5 Reserva y Servicio

#### Capacidad: Reserva de venta futura con cobro anticipado (equivalente al problema de negocio de Preventas)

- **Problema de negocio**: cobrar por adelantado (total o parcial) algo que el negocio todavía no tiene físicamente, sin inventar stock inexistente, sin duplicar el cobro al entregar, permitiendo pagos parciales sucesivos.
- **Situación actual**: el checkout exige stock suficiente antes de reservar cualquier cosa — no existe ningún camino para vender algo que aún no existe como unidad física.
- **Componentes existentes reutilizables**: la línea de pedido, que ya admite ítems sin producto de catálogo asociado (el patrón usado hoy para ítems personalizados) — modela exactamente "un ítem sin unidad física todavía"; los campos de cobro presencial ya construidos para Venta en Local; el patrón "generar desde el chat" que ya usa Cotizaciones (un administrador crea un registro a partir de una conversación).
- **Componentes que NO deben reutilizarse**: el mecanismo de reserva de stock del checkout público tal cual — ese guardia (exigir stock suficiente antes de reservar) es correcto para venta online y no debe debilitarse, evitaría vender stock inexistente a cualquier visitante anónimo. Este flujo debe ser un camino aparte, iniciado siempre por un administrador (venta en local o chat), nunca desde el checkout público sin intervención humana.
- **Diseño recomendado**: no crear una entidad nueva tipo "Preventa" — extender el ciclo de vida del Pedido con un nuevo estado ("reservado"), que se usa cuando el ítem es personalizado (sin producto de catálogo todavía) y el pago recibido es parcial. Se inicia desde el panel de Venta en Local (extendiendo la pantalla existente con un indicador "sin stock — reservar", no una pantalla nueva) o desde el Chat (mismo patrón que "generar cotización desde la conversación"). El saldo pendiente se cobra después con el mismo mecanismo de cobro presencial ya existente, reutilizado, no reinventado. Cuando el equipo real ingresa al inventario, un administrador vincula ese ítem de pedido al producto/inventario real y la orden pasa a su estado firme. Para "cuánto se cobró hasta ahora" alcanza con un campo acumulador en el Pedido — no hace falta un libro de pagos por evento; eso es responsabilidad del Núcleo Contable, y construir un mini-registro aparte acá duplicaría ese trabajo.
- **Qué NO copiar del ERP jamás**: la hoja "Preventa" separada de "Venta" con campos espejados — era necesaria en Sheets porque una fila no puede cambiar de "forma" a mitad de camino; en un modelo relacional, la misma fila de Pedido puede tener estados distintos sin duplicar su esquema. Tampoco la distinción "vendedor" vs. "operador" (dos roles nombrados para la misma acción) — GreatPhones ya tiene un solo concepto limpio: el usuario autenticado. Tampoco la vinculación manual bidireccional por texto entre hojas — acá es una relación real de base de datos, nunca un identificador tipeado a mano.
- **Mejoras respecto al ERP**: el vínculo Reserva↔Equipo real es una relación de base de datos, no una edición manual cruzada en dos hojas. El cobro del saldo reutiliza infraestructura de pago ya probada en vez de una fórmula de prorrateo aparte. No hace falta un "estado combinado" tipo "Reservado + En Reparación" del ERP — los estados del pedido y del inventario son independientes y componibles.
- **Impacto en el sistema**: *Usuarios*: sin cambio en su experiencia pública (esto es iniciado por administrador/chat). *Administradores*: un indicador nuevo en Venta en Local, un estado nuevo visible en Pedidos. *Auditoría*: se beneficia directamente de que la Auditoría generalizada (§4.4) se extienda al Pedido — sin eso, cambiar el estado de una reserva no quedaría trazado a un responsable con motivo. *Google Sheets*: la reserva se sincroniza como cualquier pedido, con su estado visible en la misma hoja de Pedidos — no hace falta una hoja aparte. *Reportes/Dashboard*: deberían poder filtrar/contar pedidos reservados. *API*: un nuevo valor de estado aceptado por los endpoints ya existentes, sin endpoints nuevos si se integra dentro de Venta en Local. *Base de datos*: un valor de estado + uno o dos campos nuevos en Pedido — sin tabla nueva.
- **Eventos involucrados**: `ReservaCreada`, `ReservaAsignadaAStock` (cuando se vincula el equipo real), `SaldoReservaCobrado` (cobro parcial adicional), `ReservaCancelada` — todos como variantes/hermanos de los eventos de Ventas ya definidos, no una familia aislada.
- **Cambios en el panel administrador**: extender Venta en Local (indicador "reservar sin stock") y extender los filtros de la pantalla de Pedidos para incluir el estado reservado. No crear ninguna pantalla nueva.
- **Complejidad**: Media. **Prioridad**: Alta.

#### Capacidad: Reparación / diagnóstico técnico con presupuesto

- **Problema de negocio**: cotizar de forma objetiva el costo de reparar un equipo (con o sin diagnóstico previo), dar seguimiento a su estado, y cobrar solo cuando corresponde.
- **Situación actual**: el modelo de datos de reparación ya existe en la base de datos, con un ciclo de estados bien pensado, pero cero rutas del backend lo usan; el único punto de entrada público es un botón sin backend.
- **Componentes existentes reutilizables**: el modelo de Reparación y el catálogo de servicios de reparación ya existentes, con un ciclo de estados que refleja bien el proceso real — es un buen punto de partida, no hay que rediseñar el modelo de datos. El patrón administrativo de Cotizaciones (aprobar/rechazar con motivo, generar desde el chat) es directamente trasladable. El mecanismo de cobro presencial de Venta en Local es el camino natural para cobrar una reparación terminada, en vez de que Reparación tenga su propia lógica de pago paralela.
- **Componentes que NO deben reutilizarse**: nada del modelo de Reparación debería intentar resolver el pago por sí mismo — hoy no tiene ningún campo de medio de pago ni vínculo a Pedido, y no conviene agregárselo: el pago de una reparación terminada es, de fondo, el mismo problema de negocio que cualquier venta presencial.
- **Diseño recomendado**: el flujo público (hoy un botón sin backend) pasa a crear una Reparación real: si el cliente sabe qué falla es, se le ofrece un servicio con precio ya visible (autoservicio, sin esperar a un administrador); si no sabe, nace en diagnóstico sin precio. El administrador resuelve el diagnóstico exactamente como resuelve una Cotización hoy: le pone precio y lo envía por chat (reutilizando el botón "generar cotización desde el chat", generalizado a "generar presupuesto"), el cliente lo acepta o lo rechaza. Una vez completada, cobrar la reparación se hace agregando un ítem a una operación de Venta en Local (con un campo opcional de vínculo a la reparación en la línea de pedido — no una tabla nueva), reutilizando el 100% de la infraestructura de cobro ya construida en vez de duplicarla.
- **Qué NO copiar del ERP jamás**: la fórmula en cascada de precio (tarifario externo → descuento de tasación × multiplicador → "sin configurar") — era un parche para no tener un sistema de configuración editable; una vez que exista la capacidad de Configuraciones editables (§4.7), un precio por servicio simple y editable por un administrador es igual de objetivo y mucho más mantenible que una fórmula de tres niveles que nadie recuerda cómo se calculó. Tampoco el campo "Diferencia" (cobrado vs. calculado) — era puramente informativo, no aporta ninguna capacidad real. El PIN de desbloqueo, si se conserva, debe tratarse como dato sensible, no como una columna más entre las demás.
- **Mejoras respecto al ERP**: el cobro de una reparación deja de ser un caso especial con su propia lógica de un solo medio de pago (limitación real del ERP) — al cobrarse como una Venta en Local, hereda automáticamente todos los medios de pago que ese flujo ya soporta. El presupuesto de diagnóstico se comunica por chat en vivo, no por un ticket impreso.
- **Impacto en el sistema**: *Usuarios*: pueden iniciar un pedido de reparación real desde el sitio público (hoy no pueden). *Administradores*: nueva gestión de reparaciones, reutilizando el patrón visual de Cotizaciones. *Auditoría*: se beneficia de que la Auditoría generalizada exista. *Google Sheets*: cada reparación resuelta se sincroniza igual que cualquier operación. *Reportes/Dashboard*: puede sumarse "reparaciones abiertas" a los indicadores existentes. *API*: nuevos endpoints sobre el modelo de Reparación ya existente (hoy no existen). *Base de datos*: un campo opcional de vínculo en la línea de pedido, ningún cambio estructural al modelo de Reparación.
- **Eventos involucrados**: `ReparacionSolicitada`, `PresupuestoReparacionEnviado`, `PresupuestoReparacionAceptado`/`Rechazado`, `ReparacionEstadoActualizado`. El cobro final no genera un evento nuevo — reutiliza el de venta confirmada ya existente.
- **Cambios en el panel administrador**: no crear una pestaña nueva — extender la pestaña de Cotizaciones existente (o generalizarla) para listar y gestionar también Reparaciones con el mismo patrón de lista + detalle + aprobar/rechazar, en vez de construir una sección paralela.
- **Complejidad**: Media. **Prioridad**: Alta.

#### Capacidad: Regalos Automáticos

- **Problema de negocio**: entregar automáticamente, sin cargo, un accesorio de regalo al vender ciertos modelos, sin depender de que un vendedor se acuerde de ofrecerlo.
- **Situación actual**: no existe ninguna configuración de "familia de modelo → accesorio de regalo" ni lógica que se dispare tras una venta.
- **Componentes existentes reutilizables**: el campo de agrupación de variantes de un mismo modelo ya existente en Producto — es exactamente la clave correcta para decidir "a qué familia de equipo le corresponde qué regalo", mucho más confiable que el emparejamiento de texto libre del ERP. El sistema de notificaciones ya existente, para avisar al administrador si no hay stock del regalo, sin necesitar un sistema de auditoría nuevo. El patrón de Promociones (seleccionar productos/accesorios y aplicar una regla en lote) es el más parecido a "definir reglas comerciales condicionales".
- **Componentes que NO deben reutilizarse**: nada del emparejamiento por coincidencia de texto libre del ERP (buscar substring del nombre del modelo, priorizando el más largo) — es una heurística frágil que existía porque el ERP no tenía un campo estructurado equivalente al agrupador de modelo que GreatPhones ya tiene.
- **Diseño recomendado**: **esta capacidad depende de que la Venta de Accesorios (§4.2) funcione primero.** Una vez resuelta, un regalo automático es, estructuralmente, una venta de accesorio a precio cero: al confirmarse una venta, el sistema busca si el grupo de modelo del producto vendido tiene una regla de regalo activa, y si el accesorio vinculado tiene stock, agrega automáticamente una línea de pedido a precio cero vinculada a ese accesorio y descuenta su stock — sin bloquear la venta si no hay stock, solo notificando al administrador.
- **Qué NO copiar del ERP jamás**: el emparejamiento por texto libre. Tampoco la exclusión manual de "esto no cuenta para comisión" — Comisiones no existe todavía en GreatPhones; no tiene sentido construir hoy una excepción para un cálculo que no existe.
- **Mejoras respecto al ERP**: matching exacto y estructurado en vez de heurística de texto; la notificación de "no hay stock del regalo" usa el sistema de notificaciones ya construido en vez de un mecanismo aparte.
- **Impacto en el sistema**: *Usuarios*: ven el regalo reflejado en su pedido sin acción propia. *Administradores*: gestionan las reglas desde Promociones (extendida), reciben notificación si falta stock. *Google Sheets*: el ítem de regalo se sincroniza como cualquier línea de venta de accesorio, marcado como regalo. *Reportes*: debe poder excluirse de facturación bruta. *API*: sin endpoint nuevo si se integra como lógica server-side dentro de la confirmación de venta ya existente.
- **Eventos involucrados**: `RegaloAutomaticoEntregado` (ya previsto y nombrado en la arquitectura de eventos existente — esta capacidad lo activa).
- **Tablas nuevas**: una, chica y justificada — no hay hoy ninguna estructura para "regla comercial condicional por grupo de modelo". Es la única tabla nueva de las tres capacidades de esta iniciativa porque no hay ninguna pieza existente que la cubra ni parcialmente.
- **Cambios en el panel administrador**: extender Promociones con una sub-sección de reglas de regalo, reutilizando su interfaz de selección de productos/accesorios en lote. No crear pantalla nueva.
- **Complejidad**: Baja (una vez resuelta Venta de Accesorios; bloqueada hasta entonces). **Prioridad**: Media.

---

### 4.6 Reporting e Inteligencia de Negocio

> **Premisa**: esta iniciativa asume que el Núcleo Contable (§4.1) y el cálculo de ganancia por venta ya existen. **Hallazgo de partida que condiciona el diseño de Comisiones**: el campo que identifica qué administrador vendió algo solo se completa hoy en ventas presenciales — en el checkout de e-commerce no hay ningún vendedor humano involucrado. Un modelo de comisión que asuma "toda venta tiene un vendedor a premiar", como hacía el ERP, no encaja con la realidad de GreatPhones, donde la mayoría de las ventas son autoservicio.

#### Capacidad: Cálculo de comisión real por vendedor

- **Problema de negocio**: pagar a la persona que efectivamente concreta una venta un monto justo y verificable según su desempeño real, sin cálculos manuales fuera del sistema.
- **Situación actual**: ninguno de los dos sistemas resuelve hoy este problema — el ERP tampoco calculaba un monto, solo indicadores.
- **Componentes existentes reutilizables**: la autenticación real, que reemplaza cualquier lista fija de nombres; el campo que ya identifica qué administrador atendió una venta presencial; el margen por venta (premisa del Núcleo Contable).
- **Componentes que NO deben reutilizarse**: ningún concepto de "operador" como lista de nombres hardcodeada — la identidad siempre debe salir del usuario autenticado, nunca de un selector de texto libre.
- **Diseño recomendado**: la comisión es una vista derivada calculada al cierre de un período, no una operación cargada a mano. Se computa sobre las ventas donde existe un administrador responsable identificable (hoy, las ventas presenciales; si más adelante se atribuyen ventas online asistidas por chat, el administrador asignado a la conversación es la extensión natural, no un mecanismo nuevo). Al cerrar el período, el sistema liquida un monto por administrador y ese cierre se registra como un movimiento más dentro del Núcleo Contable (categoría "Comisión"), evitando un sistema contable paralelo.
- **Qué NO copiar del ERP jamás**: el tablero de solo-indicadores-sin-monto — ahí es donde el ERP se quedó corto; y la idea de que "toda venta genera comisión" — no aplica, la mayoría de las ventas de GreatPhones no tienen vendedor humano.
- **Mejoras respecto al ERP**: por primera vez existe un monto de comisión real, no solo indicadores; la atribución de responsable es confiable (login real) en vez de un selector manual sin verificación.
- **Impacto en el sistema**: *Administradores*: nueva vista de su comisión y, para el dueño, de todas. *Auditoría*: el cierre de período debe auditarse, reutilizando el mecanismo genérico ya diseñado, no uno paralelo. *Google Sheets*: solo el cierre final se sincroniza como fila histórica, nunca el cálculo en curso. *API*: endpoint de cierre de período + consulta de comisión propia. *Base de datos*: una tabla de liquidación.
- **Eventos involucrados**: `ComisionLiquidada` (cierre de período, efecto real y definitivo).
- **Tablas nuevas**: una — liquidación de comisión (administrador, período, base de cálculo, monto, fecha). El porcentaje/regla de cálculo debería vivir en la tabla de Configuraciones genérica (§4.7), no en una tabla dedicada solo a esto.
- **Cambios en el panel administrador**: extender la pestaña de Dashboard ya existente con una sección de comisiones, no crear una pantalla nueva.
- **Complejidad**: Media (la fórmula es simple; lo que requiere definición con el negocio es qué ventas son comisionables). **Prioridad**: Media.

#### Capacidad: Consolidado financiero/comercial (Reportes)

- **Problema de negocio**: tener, sin pasos manuales, la foto financiera consolidada del negocio — ventas, egresos, utilidad, comisiones — filtrable por período.
- **Situación actual**: el único mecanismo de exportación real de GreatPhones exporta el historial de altas/ediciones del catálogo de productos, un tema completamente distinto.
- **Componentes existentes reutilizables**: el patrón de agregación del Dashboard ya existente (consultas agregadas sobre rangos de fecha) es la arquitectura correcta a extender, solo que agregando sobre el Núcleo Contable en vez de únicamente el total de pedidos; el patrón de exportación ya existente (generación de Excel al momento, sin persistencia) es directamente reutilizable para dar un Excel descargable del mismo consolidado.
- **Componentes que NO deben reutilizarse**: nada del contenido del exportador de catálogo existente más allá del patrón técnico — su contenido es un tema distinto, no debe mezclarse con el reporte financiero.
- **Diseño recomendado**: no un módulo nuevo separado del Dashboard, sino una extensión de la misma pestaña ya existente — una vista "Financiero" con ingresos, egresos, utilidad y comisiones del período, filtrable por fecha, con exportación a Excel opcional.
- **Qué NO copiar del ERP jamás**: el patrón "bloque de celdas que se recalcula bajo demanda con un botón, y que puede quedar desactualizado si nadie lo aprieta" — era una limitación técnica de Google Sheets, no una buena práctica. GreatPhones no necesita ningún botón "Actualizar Reportes": debe calcularse en vivo en cada consulta, exactamente como ya hace hoy el Dashboard.
- **Mejoras respecto al ERP**: siempre actualizado, sin paso manual; Dashboard y Reportes leen de la misma fuente, evitando el riesgo real que tenía el ERP de que ambas vistas mostraran cifras no perfectamente coincidentes.
- **Impacto en el sistema**: *Administradores*: nueva vista. *Google Sheets*: snapshot mensual opcional para histórico comparable, nunca fuente de verdad. *API*: extensión del endpoint de dashboard o uno hermano con filtros de fecha. Sin impacto en usuarios ni en eventos — es una vista de solo lectura sobre eventos que ya ocurrieron en otras capacidades.
- **Eventos involucrados**: ninguno.
- **Tablas nuevas**: ninguna — 100% consulta agregada sobre datos que ya existirían.
- **Cambios en el panel administrador**: extender la pestaña de Dashboard existente; no crear una pestaña "Reportes" separada salvo que el volumen de contenido lo justifique más adelante.
- **Complejidad**: Baja. **Prioridad**: Alta (rápida de sumar y de alto valor una vez exista el Núcleo Contable del que depende).

#### Capacidad: Dashboard con dimensión financiera

- **Problema de negocio**: que el dueño del negocio vea, sin entrar módulo por módulo, cómo está el negocio hoy — incluyendo su dimensión financiera, hoy ausente.
- **Situación actual**: resuelto del lado comercial (ingresos, pedidos, ticket promedio, nuevos usuarios, productos más vendidos), ciego del lado financiero (sin caja, sin margen).
- **Nota de diseño**: en la práctica esta capacidad se fusiona con la anterior — son dos niveles de zoom sobre la misma fuente (resumen ejecutivo vs. consolidado detallado), no dos sistemas. Deben compartir el mismo endpoint ampliado para garantizar que nunca muestren cifras distintas entre sí — ese fue justamente un riesgo real del ERP (Dashboard y Reportes como hojas separadas con fórmulas separadas).
- **Diseño recomendado**: agregar puntualmente a los KPIs que ya calcula el Dashboard: saldo de caja por medio de pago (nunca mezclando monedas), utilidad del mes (usando el margen ya calculado por venta). Reparaciones abiertas / reservas por estado quedan condicionadas a que esas capacidades se construyan.
- **Qué NO copiar del ERP jamás**: la separación rígida en hojas distintas con cálculos distintos.
- **Impacto/eventos/tablas**: los mismos que la capacidad anterior, por compartir fuente — no se duplica nada.
- **Cambios en el panel administrador**: la pestaña de Dashboard ya existente, sin pantalla nueva; extender el mismo endpoint, no crear uno paralelo.
- **Complejidad**: Baja. **Prioridad**: Media (mejora de visibilidad; la información ya estaría disponible vía Reportes).

#### Capacidad: Autodiagnóstico periódico de inconsistencias (equivalente al problema de negocio de Salud ERP)

- **Problema de negocio**: detectar proactivamente estados imposibles del negocio antes de que un cliente o administrador los note por accidente.
- **Situación actual**: no existe ningún endpoint ni proceso de verificación de consistencia de datos. Ya hay ejemplos reales confirmados en este proyecto de lo que este chequeo habría detectado (el bug de cancelación de venta en local que descuenta el contador equivocado; la duplicación de estado de Arrepentimiento entre el modelo dedicado y el campo embebido en Pedido).
- **Componentes existentes reutilizables**: el patrón ya existe y funciona en GreatPhones — el historial de inventario demuestra que el sistema ya sabe registrar trazabilidad de inconsistencias bien. El chequeo en sí puede ejecutarse con consultas directas sobre las relaciones entre entidades, sin infraestructura nueva.
- **Componentes que NO deben reutilizarse**: nada que dependa de que el chequeo corra "dentro" de una hoja de cálculo con un disparador atado a su disponibilidad — coherente con el principio ya establecido de que Sheets nunca participa de ninguna decisión ni validación.
- **Diseño recomendado**: un proceso periódico propio de la aplicación (no de Sheets) que corre un conjunto de verificaciones de reglas de negocio conocidas, clasifica cada hallazgo por severidad, nunca corrige nada automáticamente — solo detecta y reporta —, y expone el resultado más reciente como un semáforo simple dentro del Dashboard.
- **Qué NO copiar del ERP jamás**: nada que dependa de la disponibilidad de Google Sheets ni de un disparador externo a la aplicación.
- **Mejoras respecto al ERP**: no depende de la disponibilidad de Google Sheets ni de un disparador externo a la aplicación.
- **Impacto en el sistema**: *Administradores*: ven el semáforo de salud en el Dashboard. *Auditoría*: los hallazgos se acumulan, nunca se sobreescriben, para ver evolución. *Google Sheets*: cada corrida se sincroniza como fila histórica de auditoría técnica, consulta manual, nunca fuente de verdad.
- **Eventos involucrados**: `ChequeoIntegridadCompletado` (una corrida) e `InconsistenciaDetectada` (un hallazgo).
- **Tablas nuevas**: una — no hay ninguna entidad existente que registre "un hallazgo entre dos entidades relacionadas" sin forzarla. Evitar además crear una segunda tabla de "reglas configurables": las reglas de verificación pueden vivir como lógica versionada en el propio código de la aplicación, no necesitan ser editables desde el inicio.
- **Cambios en el panel administrador**: un indicador/sección dentro de la pestaña de Dashboard ya existente (semáforo + lista breve de hallazgos activos); no una pantalla dedicada, salvo que el volumen lo justifique después.
- **Complejidad**: Media (cada regla es simple; el trabajo está en definir y mantener el conjunto). **Prioridad**: Media (crece en valor a medida que se construyan las demás capacidades de este plan, porque generan más superficie a verificar).

---

### 4.7 Configuración de Negocio

#### Capacidad: Parámetros de negocio editables sin tocar código

- **Problema de negocio**: que el dueño del negocio pueda ajustar cifras comerciales (cuánto ofrece por un equipo usado, cuánto cobra por extender la garantía, cuánto cuesta el envío) el mismo día que decide cambiarlas, sin depender de que un desarrollador edite un archivo y despliegue. Es un problema de **autonomía operativa**, no de tecnología.
- **Situación actual**: no existe ningún modelo de configuración en la base de datos. Los valores que cumplirían ese rol (precios base de tasación de equipos usados, coeficientes de cuotas, montos de garantía extendida, costo de envío por zona) están escritos como constantes directamente en el código fuente del frontend — cambiar cualquiera de ellos hoy exige editar código y redesplegar. Además, se confirmó que el checkout **acepta sin validar** un costo de garantía que el propio navegador del cliente le informa, sin cruzarlo contra ningún valor de referencia del servidor — una tabla de configuración real cerraría también esa brecha de integridad.
- **Componentes existentes reutilizables**: el patrón exacto que hace falta ya existe en el panel — la gestión en lote de precios de Promociones (que ya lee/escribe precio y descuento de Producto desde una grilla editable) es el mismo patrón de interfaz que necesita "editar un número comercial desde el panel", solo que hoy apunta a otra tabla. La autenticación real como administrador ya resuelve "quién puede tocar esto" sin construir nada nuevo.
- **Componentes que NO deben reutilizarse**: no hay ningún componente de GreatPhones a evitar acá — el problema es la ausencia total, no una mala pieza existente.
- **Diseño recomendado**: una única tabla de configuración clave-valor (no una tabla por cada tipo de parámetro), consultada por el backend en cada cálculo que hoy usa un valor hardcodeado, y editable desde una sola pantalla nueva y genérica del panel admin ("Configuración de Negocio"), en vez de una pantalla por cada tipo de parámetro. La razón de "clave-valor único" y no "una tabla por parámetro": los datos reales hoy hardcodeados no son estructuralmente uniformes (una lista de precios base por modelo, una tabla de multiplicadores de condición, un objeto de bonificaciones, montos de garantía, un monto de envío) — forzarlos a tablas separadas multiplicaría el número de pantallas de edición sin necesidad; una tabla genérica con clave, valor (en formato estructurado), descripción, quién y cuándo lo actualizó por última vez cubre todos los casos con una sola pantalla y un solo endpoint.
- **Qué NO copiar del ERP jamás**: el ERP resolvía esto con una hoja de Google Sheets editable directamente por cualquier persona con acceso al archivo, sin login, sin registro de quién cambió qué valor ni cuándo, y sin ninguna validación de formato. Eso no debe copiarse: la forma "editable sin tocar código" sigue siendo el problema a resolver, pero la forma de editar debe ser un formulario dentro del panel admin (con el tipo de dato validado en el momento de guardar) protegido por el login de administrador que ya existe, nunca un archivo externo sin control de acceso ni de auditoría.
- **Mejoras respecto al ERP**: trazabilidad real de quién cambió qué parámetro y cuándo (el ERP no la tenía en absoluto); validación de tipo/rango en el momento de guardar (el ERP podía romperse silenciosamente con un valor mal tipeado); los valores nunca viajan sin control desde el cliente al servidor (cierra la brecha ya detectada en el checkout).
- **Impacto en el sistema**: *Usuarios*: ninguno, es exclusivamente administrativo. *Administradores*: ganan una pantalla nueva de autonomía comercial. *Auditoría*: cada cambio de configuración debe quedar registrado (quién, qué clave, valor anterior, valor nuevo), reutilizando el mismo patrón de auditoría generalizado de §4.4, no un mecanismo propio. *Google Sheets*: cada cambio de configuración se sincroniza como registro histórico de solo lectura, nunca se lee de vuelta desde Sheets. *API*: un endpoint de lectura (consumido por checkout, cotizaciones de equipos usados, garantía) y uno de escritura (solo administrador). *Base de datos*: una tabla nueva, pequeña.
- **Eventos involucrados**: `ConfiguracionActualizada` (disparador: un administrador guarda un cambio; genera: nueva versión del valor + entrada de auditoría; siempre síncrono porque afecta cálculos de precio en vivo).
- **Cambios en el panel administrador**: una pantalla nueva mínima ("Configuración de Negocio"), justificada porque hoy no existe ninguna pantalla de la que esto sea una extensión natural — es un tipo de contenido genuinamente distinto a Productos/Pedidos/Cotizaciones. Se recomienda una sola grilla clave→valor editable en línea (mismo patrón visual que la edición en línea ya usada en Stock), no un formulario por parámetro.
- **Complejidad**: Media (el diseño es simple, pero exige tocar los cinco puntos del código donde hoy se lee un valor hardcodeado para que consulten la nueva fuente). **Prioridad**: Alta.

#### Capacidad: Consolidación del modelo de datos de Garantía

- **Problema de negocio**: que la vigencia de una garantía sea siempre confiable y verificable — hoy funciona para el cliente, pero descansa sobre una base frágil que puede fallar en silencio.
- **Situación actual**: coexisten dos representaciones de "garantía": una entidad formal con exactamente los campos necesarios (fecha de vencimiento, estado activo/vencida/usada/cancelada), y un cálculo derivado sobre un campo de texto libre interpretado por coincidencia de substring — que es, verificado, el que efectivamente funciona hoy. La entidad formal tiene **cero referencias en todo el backend**.
- **Componentes existentes reutilizables**: la entidad formal de Garantía ya existe con exactamente los campos necesarios — no hace falta diseñar nada nuevo, solo empezar a usarla. El endpoint público de consulta de garantía ya tiene toda la lógica de cálculo de vigencia — solo lee de la fuente equivocada.
- **Componentes que NO deben reutilizarse**: el patrón actual de campo de texto libre interpretado por coincidencia de substring no debe seguir siendo la fuente de verdad — es frágil por diseño (cualquier variación de texto rompe la detección) y ya está duplicado sin sincronizar contra el modelo formal.
- **Diseño recomendado**: que la confirmación de un pedido (evento ya existente de venta confirmada) cree siempre un registro de Garantía real vinculado a ese pedido, y que el endpoint público de consulta lea de ahí en vez de parsear texto. El campo de texto en el pedido pasa a ser solo una etiqueta descriptiva para mostrar en el detalle, nunca la fuente de cálculo.
- **Qué NO copiar del ERP jamás**: el texto fijo de 90 días impreso en un ticket, sin ningún campo de vencimiento — eso ya está superado por GreatPhones; no hay que retroceder a un texto estático bajo ninguna forma, al contrario, hay que terminar de conectar el modelo de datos real que GreatPhones ya construyó y no usa.
- **Mejoras respecto al ERP**: consolida en una única fuente de verdad consultable y con estado explícito, en vez de un cálculo derivado cada vez que se consulta — permite, a futuro, listar todas las garantías activas del negocio.
- **Impacto en el sistema**: *Usuarios*: ninguno visible (la consulta pública sigue funcionando igual). *Administradores*: ganan la posibilidad de listar/gestionar garantías como entidad propia. *Auditoría*: un cambio de estado de garantía debe quedar auditado igual que cualquier otra operación (reutilizando §4.4). *Google Sheets*: la hoja histórica de Garantías ya prevista en la arquitectura de sincronización pasa a alimentarse de datos reales y consistentes en vez de un cálculo derivado de texto. *Reportes/Dashboard*: habilita, a futuro, un indicador real de "garantías activas". *API*: el endpoint público cambia su fuente de datos, no su contrato público. *Base de datos*: ninguna tabla nueva — se usa la ya existente.
- **Eventos involucrados**: ninguno adicional a los ya previstos (`GarantiaCreada`, `GarantiaExtendida`) — esta capacidad es la que finalmente les da un lugar real donde escribir.
- **Cambios en el panel administrador**: ninguna pantalla nueva es estrictamente necesaria; opcionalmente, agregar una columna/filtro de "Garantía" dentro de la pantalla ya existente de Pedidos.
- **Complejidad**: Baja (es reconectar una entidad ya modelada, no diseñar una nueva). **Prioridad**: Media.

---

## 5. Resumen consolidado de tablas nuevas necesarias en todo el plan

De las 26 capacidades diseñadas en este documento, solo **5 requieren una tabla de base de datos genuinamente nueva** — el resto se resuelve agregando campos a modelos existentes o reutilizando patrones ya construidos:

| Tabla nueva | Iniciativa | Justificación de por qué ninguna tabla existente alcanza |
|---|---|---|
| Movimientos de valor (registro contable) | §4.1 Núcleo Contable | Ninguna entidad existente puede ser fuente única de verdad monetaria sin mezclar datos de operación con datos contables |
| Auditoría genérica polimórfica | §4.4 Integridad y Gobierno | Resuelve simultáneamente Auditoría, Snapshot recuperable y el registro de Anulaciones/Correcciones — una sola tabla, no tres |
| Inversor + Movimiento de Inversor (2 tablas relacionadas) | §4.3 Tesorería Derivada | Es una entidad de negocio con ciclo de vida propio (capital, topes, rendimiento), no un caso de uso de otra capacidad |
| Regla de regalo automático | §4.5 Reserva y Servicio | No hay hoy ninguna estructura para "regla comercial condicional por grupo de modelo" |
| Liquidación de comisión | §4.6 Reporting | Es el registro del cierre definitivo de un período, distinto de cualquier cálculo en curso |
| Configuración clave-valor | §4.7 Configuración de Negocio | Los parámetros hoy hardcodeados no son estructuralmente uniformes; una tabla genérica cubre todos los casos con una sola pantalla |
| Hallazgos de autodiagnóstico | §4.6 Reporting | No hay ninguna entidad existente que registre "una inconsistencia entre dos entidades relacionadas" sin forzarla |

Todas las demás capacidades (18 de 26) se resuelven con **campos nuevos en modelos ya existentes** (Pedido, Línea de Pedido, Accesorio, Ítem de Inventario) o con **cero cambios de esquema**, apoyándose enteramente en relaciones y patrones ya construidos.

---

## 6. Resumen consolidado de pantallas del panel administrador

Siguiendo el criterio explícito de minimizar pantallas nuevas, el resultado de las 26 capacidades diseñadas es:

**Pantallas nuevas — solo 2 en todo el plan:**
- "Configuración de Negocio" (§4.7) — no hay ninguna pantalla existente de la que sea una extensión natural.
- Gestión de Inversores (§4.3) — puede integrarse como pestaña dentro de una futura sección de Tesorería, no como ítem de navegación principal nuevo.

**Todo lo demás se resuelve extendiendo pantallas ya existentes:**
- El **Dashboard** absorbe: saldo de caja, comisiones, consolidado financiero/Reportes, semáforo de autodiagnóstico, y el widget de "actividad reciente" (Mis Operaciones).
- **Venta en Local** absorbe: venta de accesorios, reserva de venta futura sin stock, cobro de reparaciones terminadas.
- **Accesorios** absorbe: costo y proveedor de reposición de stock.
- **Cotizaciones** absorbe (generalizándose): gestión de Reparaciones.
- **Promociones** absorbe: reglas de regalo automático.
- Los **modales de detalle** ya existentes en Pedidos/Cotizaciones/Arrepentimientos absorben: botón de Anular, botón de Historial, indicador de responsable.
- Una futura pantalla de **Caja/Tesorería** (única realmente nueva de bajo nivel, aunque conceptualmente parte de extender el Dashboard) absorbe: Gastos, Cambio de Moneda, Ajuste de Caja.

---

## 7. Matriz final de complejidad y prioridad

| Capacidad | Iniciativa | Complejidad | Prioridad |
|---|---|---|---|
| Registro contable centralizado | Núcleo Contable | Media | Crítica |
| Visibilidad de saldo de caja | Núcleo Contable | Baja | Crítica |
| Venta de Accesorios | Accesorios | Media | Crítica |
| Ingreso de mercadería de Accesorios | Accesorios | Baja-Media | Crítica |
| Anulación/corrección uniforme | Integridad y Gobierno | Media | Crítica |
| Ganancia real por venta | Núcleo Contable | Baja | Alta |
| Vínculo contable del ingreso | Núcleo Contable | Baja | Alta |
| Trazabilidad de proveedor de Accesorios | Accesorios | Baja | Alta |
| Gastos | Tesorería Derivada | Baja | Alta |
| Snapshot recuperable | Integridad y Gobierno | Baja | Alta |
| Auditoría generalizada | Integridad y Gobierno | Media | Alta |
| Propagación de responsable | Integridad y Gobierno | Baja | Alta |
| Reserva de venta futura | Reserva y Servicio | Media | Alta |
| Reparación/diagnóstico | Reserva y Servicio | Media | Alta |
| Consolidado financiero (Reportes) | Reporting | Baja | Alta |
| Configuraciones editables | Configuración | Media | Alta |
| Distinción compra/consignación | Núcleo Contable | Baja | Media |
| Cambio de Moneda | Tesorería Derivada | Baja | Media |
| Ajuste de Caja | Tesorería Derivada | Baja | Media |
| Vista unificada de operaciones | Integridad y Gobierno | Baja | Media |
| Regalos Automáticos | Reserva y Servicio | Baja | Media |
| Comisión real por vendedor | Reporting | Media | Media |
| Dashboard financiero | Reporting | Baja | Media |
| Autodiagnóstico de integridad | Reporting | Media | Media |
| Consolidación del modelo de Garantía | Configuración | Baja | Media |
| Financiamiento externo por Inversores | Tesorería Derivada | Media | Baja-Media |

---

## 8. Objetivo final

Este plan no describe cómo migrar el ERP — describe cómo construir, sobre la arquitectura que GreatPhones ya tiene hoy, las 19 capacidades de negocio que todavía le faltan, de la forma que mejor le queda a GreatPhones y no a Google Sheets. El resultado, si se ejecuta en el orden sugerido en §1.4, es un producto que no reproduce al ERP: lo supera, porque cada decisión de diseño de este documento parte de una arquitectura moderna (autenticación real, transacciones atómicas, relaciones reales entre entidades, pagos automatizados) que el ERP nunca tuvo, y evita deliberadamente cada limitación técnica del ERP que alguna vez se disfrazó de regla de negocio.
