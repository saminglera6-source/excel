---
title: Matriz de Capacidades de Negocio — GreatPhones
version: 1.0
fecha: 2026-07-17
documento_relacionado: ESPECIFICACION_FUNCIONAL_ERP.md (no modificado)
propósito: determinar qué capacidades de negocio del ERP faltan incorporar a GreatPhones, independientemente de módulos, pantallas o implementación
---

# Matriz de Capacidades de Negocio — GreatPhones

> **Este documento es nuevo y autónomo.** No modifica, resume ni reemplaza `ESPECIFICACION_FUNCIONAL_ERP.md` (que sigue siendo la referencia de comportamiento detallado de ambos sistemas). Tampoco modifica ningún roadmap ni arquitectura ya definida. Su único objetivo es responder, capacidad por capacidad, una pregunta distinta a la que respondían los documentos anteriores.

---

## 1. Introducción — el nuevo enfoque

Todo el trabajo previo de este proyecto (la Especificación Funcional, la auditoría, sus correcciones) comparó el ERP y GreatPhones **módulo por módulo**: Compras contra Inventario, Ventas contra Checkout, Preventas contra... nada, etc. Esa comparación fue necesaria para entender ambos sistemas en profundidad, pero llevaba implícita una premisa que este documento abandona deliberadamente: que el objetivo final es que GreatPhones termine teniendo "un equivalente" de cada módulo del ERP.

**No es así.** El objetivo real, tal como lo definió el negocio, es otro:

> **GreatPhones debe terminar resolviendo todos los problemas de negocio que hoy todavía resuelve el ERP — con la implementación que mejor le quede a GreatPhones, no con una copia del ERP.**

Esto cambia radicalmente qué se compara y cómo se lee cada hallazgo:

- **No importa si un módulo del ERP "tiene equivalente" en GreatPhones.** Importa si el *problema de negocio* que ese módulo resolvía sigue resuelto, sea como sea.
- **Un módulo entero puede desaparecer sin que eso sea un problema**, si GreatPhones ya resuelve esa necesidad de otra forma, mejor, o si la propia arquitectura de GreatPhones la vuelve innecesaria de raíz.
- **Una capacidad puede sobrevivir con una forma completamente distinta** a la que tenía en el ERP, y eso es exactamente lo esperable, no una desviación a corregir.
- **La pregunta correcta nunca es "¿cómo era el formulario?"** — es "¿qué capacidad le daba esto al negocio, y esa capacidad sigue existiendo?".

Tres ejemplos, ya validados en este análisis, ilustran el criterio aplicado en todo el documento:

1. **Venta.** El ERP resolvía una venta con un formulario que un operador completaba, y esa confirmación disparaba en cadena: actualización de stock, caja, libro diario, auditoría, comisiones y dashboard. En GreatPhones no existe ningún formulario de "Registrar Venta" — el cliente compra solo por checkout. Eso está perfecto y no hay que "salvar" el formulario. Lo que sí hay que verificar, y es lo que hace este documento, es si **cada una** de esas consecuencias automáticas sigue ocurriendo hoy en GreatPhones. La respuesta, capacidad por capacidad, está en las secciones siguientes — y no es uniforme: algunas sí, varias no.

2. **Compras.** El ERP resolvía el ingreso de un equipo con un cuestionario extenso completado a mano. GreatPhones lo resuelve, para equipos, con un flujo mejor (escaneo de IMEI con autocompletado automático contra una base pública de dispositivos). No hay que copiar el cuestionario — el resultado final (equipo identificado, valorizado, disponible) es, para equipos, incluso superior al del ERP. Para accesorios, en cambio, el análisis encontró que **ese mismo resultado final no se logra de ninguna forma** hoy en GreatPhones — es un hallazgo real de este documento, no una copia del formulario que falta.

3. **Preventa.** El ERP resolvía "vender antes de tener el stock, cobrando por adelantado" con Formulario → Reserva → Compra → Entrega. GreatPhones podría resolver el mismo problema de negocio de una forma completamente distinta (por ejemplo: Reserva → Pago parcial → Pedido pendiente → Asignación automática → Entrega). No importa que sea diferente — lo que importa es si el problema de fondo (vender sin stock, cobrar por adelantado, no cobrar dos veces al entregar) está resuelto de *alguna* forma. El análisis confirma que hoy no lo está de ninguna forma — es una capacidad ausente, no una capacidad "con formulario distinto".

### Cómo leer este documento

Cada capacidad se clasifica en exactamente una de cinco categorías:

- **A) Ya resuelta por GreatPhones** — no hace falta ninguna acción.
- **B) Ya resuelta, pero requiere ajustes menores** — la capacidad existe y funciona; falta un detalle puntual.
- **C) Debe adaptarse** — el problema de negocio sigue vigente, y GreatPhones ya tiene piezas reales sobre las cuales construir la solución, pero la solución en sí no está completa; no se copia nada del ERP.
- **D) No existe** — no hay ninguna pieza real de la capacidad en GreatPhones; debe construirse desde cero.
- **E) Ya no tiene sentido** — la propia arquitectura de GreatPhones (o una decisión tecnológica ya tomada, como usar una base de datos relacional real) vuelve innecesaria esa capacidad tal como existía en el ERP.

Este documento **no diseña ninguna solución**. No propone pantallas, no propone modelos de datos nuevos, no propone arquitectura. Se detiene exactamente en el límite de "esto es lo que falta que el sistema pueda hacer" — el cómo es una etapa posterior, deliberadamente fuera de este documento.

### Metodología

Se releyó el código real de ambos proyectos —no solo la documentación ya existente de esta conversación— en seis frentes paralelos, cada uno con la consigna explícita de razonar en términos de capacidad de negocio y no de pantalla:

1. Venta de equipos, venta de accesorios, stock/disponibilidad en tiempo real, regalos automáticos.
2. Ingreso de mercadería (equipos y accesorios), trazabilidad de proveedor.
3. Reserva de venta futura (Preventas), reparaciones/diagnóstico, garantías.
4. Caja, Libro Diario, Gastos, Cambio de Moneda, Ajuste de Caja, Inversores.
5. Comisiones, Anulaciones/Correcciones, Auditoría, recuperación ante fallos, Salud ERP, Reportes, Dashboard.
6. Identificación de cliente, identificación de responsable (Operadores), configuración de negocio editable, vista unificada de operaciones (Mis Operaciones).

En total se identificaron **30 capacidades de negocio** distintas (algunas corresponden 1 a 1 con un módulo del ERP; otras son sub-facetas de un mismo módulo que resultaron tener estados de cobertura muy distintos entre sí, por lo que se documentan por separado). El código fuente consultado fue siempre el proyecto vigente de GreatPhones (`C:\Users\samin\greatphones\greatphones-next`), nunca el scaffold abandonado (`C:\Users\samin\greatphones` sin `-next`, ya identificado como código muerto en trabajo previo).

---

## 2. Listado completo de capacidades del ERP (por área de negocio)

### 2.1 Venta y sus consecuencias automáticas

#### Capacidad: Venta de un equipo

**Problema de negocio**: permitir vender un equipo garantizando que nunca se venda dos veces lo mismo, calculando la ganancia real de la operación, y dejando registro de quién y cómo se cobró.

**Estado actual en GreatPhones**: resuelto por tres caminos convergentes, todos verificados con evidencia de código:
- **Checkout online** (`src/app/api/checkout/route.ts:157-202`): reserva stock atómicamente (`stock--`, `reserved++`) dentro de una transacción antes de crear el pedido.
- **Webhook de Mercado Pago** (`src/app/api/webhooks/mercadopago/route.ts:132-159`): al aprobarse el pago, la reserva se convierte en venta firme (`reserved--`/`sold++`); al rechazarse, se libera automáticamente (`stock++`/`reserved--`).
- **Venta en local e inventario** (`src/app/api/admin/instore-sale/route.ts`, `src/app/api/inventory/[id]/sell/route.ts:41-108`): marcan el equipo vendido y descuentan stock en la misma transacción que crean el pedido.

Este mecanismo de **reserva atómica** (un estado intermedio entre "disponible" y "vendido" mientras se espera el pago) es una capacidad que el ERP nunca tuvo — ahí un equipo pasaba directo de "En Stock" a "Vendido" sin ningún resguardo contra que dos compradores compitieran por el mismo último equipo.

**Qué falta**: el ERP calculaba y guardaba, en cada venta, dos magnitudes de ganancia ("Ganancia Teórica" y "Ganancia Cobrada"), distinguiendo además "Ganancia directa" de "Comisión" según si el equipo era propio o en consignación. Verificado en los tres caminos de venta de GreatPhones: **ninguno calcula ni persiste un campo de ganancia o margen por operación** — existe el costo (`InventoryItem.purchasePrice`) y existe el precio de venta, pero nada los relaciona ni los guarda juntos. Tampoco existe el concepto de "consignación" (equipo de un tercero, sin egreso de caja al ingresar).

**Clasificación**: **B) Ya resuelta, requiere ajustes menores.**
**Cobertura**: 75%. **Prioridad**: ALTA (sin esto, no hay forma de saber cuánto ganó el negocio en cada venta individual, solo el total facturado).

#### Capacidad: Venta de accesorios

**Problema de negocio**: vender productos fungibles (no serializados) descontando su stock automáticamente y dejando trazabilidad de la operación.

**Estado actual en GreatPhones — hallazgo crítico verificado con evidencia de código, no una carencia menor**: el catálogo de accesorios (`Accessory`) no tiene ninguna relación con `OrderItem` en el modelo de datos. El carrito del sitio (`public/lib/cart.js:70-110`) agrega accesorios usando el mismo esquema de identificador que los productos, sin distinguirlos. Al confirmar el checkout (`public/lib/checkout.js:340-343`), el accesorio se envía al backend igual que un producto — pero el backend de checkout (`src/app/api/checkout/route.ts:68-79`) busca ese identificador **exclusivamente** en la tabla de Productos. Como el identificador real de un accesorio nunca existe ahí, la respuesta es un error genérico ("Producto no encontrado"). En Venta en Local ocurre lo mismo: solo puede cargarse un accesorio como ítem de texto libre, sin descontar el stock del catálogo real ni dejar ningún vínculo trazable.

**Conclusión verificada**: hoy no existe ningún camino (online ni presencial) que conecte "vender un accesorio del catálogo" con "descontar su stock automáticamente y dejar registro trazable". El catálogo de accesorios es, en la práctica, un catálogo de exhibición sin ningún flujo de venta funcional conectado — un cliente que intenta comprar un accesorio online recibe un error, sin que nadie del negocio se entere.

**Clasificación**: **D) No existe** (pese a que hay navegación de accesorios y un modelo de datos con stock, el flujo de venta en sí no está resuelto en ningún canal).
**Cobertura**: 15%. **Prioridad**: **CRÍTICA** (es una capacidad de venta activa del negocio, rota de forma silenciosa hoy).

#### Capacidad: Stock / disponibilidad en tiempo real

**Problema de negocio**: que nadie pueda vender ni ofrecer algo que ya no está disponible, y que el negocio sepa en todo momento qué tiene.

**Estado actual en GreatPhones**: resuelto, y de forma estructuralmente superior al ERP para equipos. El ERP recalculaba el Stock como una proyección completa de Compras (borrando y regenerando toda la vista en cada actualización total). GreatPhones no proyecta nada: el estado de cada equipo (`InventoryItem.status`) **es la fuente de verdad en sí misma**, mantenida con incrementos/decrementos atómicos en cada operación, nunca con un recálculo masivo. La reserva de stock durante el checkout (que el ERP nunca tuvo) es una mejora estructural real.

**Qué falta**: la dualidad ya señalada en análisis previos de esta conversación sigue siendo real: `Product.stock` (contador agregado) e `InventoryItem` (unidad serializada) son dos fuentes de disponibilidad que conviven sin una única función central que garantice que siempre están sincronizadas entre sí. Es una observación de robustez interna, no una capacidad de negocio ausente.

**Clasificación**: **A) Ya resuelta por GreatPhones.**
**Cobertura**: 95%. **Prioridad**: BAJA.

#### Capacidad: Regalos automáticos

**Problema de negocio**: entregar automáticamente, sin cargo, un accesorio de regalo (funda/cable) al vender ciertos modelos, sin depender de que un vendedor se acuerde de ofrecerlo.

**Estado actual en GreatPhones**: no existe en absoluto. Una búsqueda exhaustiva ("regalo", "gift", "freebie") en todo el backend y frontend solo encontró dos funciones vacías (`showGiftCard`/`buyGiftCard`) que ni siquiera son el mismo concepto de negocio (esas son para una tarjeta de regalo de saldo, no para un accesorio de cortesía al vender un modelo). No hay ninguna configuración de "familia de modelo → accesorio de regalo" en el modelo de datos, ni ninguna lógica que se dispare tras una venta para evaluarlo.

**Clasificación**: **D) No existe.**
**Cobertura**: 0%. **Prioridad**: MEDIA (no bloquea la operación ni la integridad financiera; es una pérdida de una ventaja comercial frente al cliente, no un riesgo operativo).

---

### 2.2 Ingreso de mercadería

#### Capacidad: Ingreso de equipos al inventario vendible (propio o en consignación)

**Problema de negocio**: convertir un equipo físico recién adquirido en un activo identificado, valorizado y disponible para la venta.

**Estado actual en GreatPhones**: resuelto, y en el mecanismo de carga concreto es superior al ERP. El alta (`POST /api/inventory`) crea una unidad única por IMEI, detecta duplicados, recicla ítems huérfanos, genera código QR y correlativo, y **resuelve o crea automáticamente el producto de catálogo vinculado** — algo que el ERP no hacía (ahí el catálogo de precios era una hoja separada, cargada a mano, sin vínculo automático a la compra). El autocompletado de marca/modelo/color a partir del IMEI contra una base pública de 22.527 dispositivos reales reemplaza con ventaja la carga 100% manual del ERP.

**Qué falta**: dos matices del ERP no tienen equivalente hoy — (1) ninguna alta de inventario genera un movimiento de caja (consistente con la ausencia general de Libro Diario, ver §2.4); (2) no existe un campo de costo de reparación estimado capturado al momento del ingreso, para equipos que llegan necesitando arreglo.

**Clasificación**: **B) Ya resuelta, requiere ajustes menores.**
**Cobertura**: 75%. **Prioridad**: ALTA (el vínculo contable es lo único que falta, y es de alto impacto financiero).

#### Capacidad: Vinculación de una compra a una preventa existente en el momento de la carga

**Problema de negocio**: cuando un cliente ya reservó y pagó una seña por un modelo que el negocio no tiene todavía, evitar que el equipo recién ingresado se ofrezca a otra persona.

**Estado actual en GreatPhones**: no existe ningún concepto de preventa ni de reserva pre-stock en el modelo de datos ni en el alta de inventario — consistente con que la capacidad de Preventas en sí no existe (ver §2.3).

**Clasificación**: **D) No existe.**
**Cobertura**: 0%. **Prioridad**: MEDIA (depende enteramente de si el negocio decide seguir vendiendo "a pedido" — es una decisión comercial previa a cualquier desarrollo).

#### Capacidad: Ingreso de mercadería de accesorios (reposición de stock con costo y proveedor)

**Problema de negocio**: cuando llega un pedido de accesorios, registrar cuánto costó y a quién se le compró, sin perder el margen real de cada venta posterior.

**Estado actual en GreatPhones**: prácticamente no existe. Crear o editar un accesorio simplemente fija un número de stock arbitrario enviado desde el panel — no hay costo unitario, no hay proveedor, no hay concepto de "línea de compra", no hay conciliación de pago. El modelo de datos del accesorio no tiene ningún campo de costo (solo precio de venta). Comparado con el ERP, donde el ingreso de accesorios era multilínea, con costo unitario, proveedor, forma de pago validada, auto-creación de catálogo y asiento contable — GreatPhones perdió esta capacidad por completo, no la resolvió de otra forma.

**Qué falta**: la capacidad de "reponer stock de accesorios dejando registro de costo real y proveedor" no existe en absoluto — el stock de accesorios hoy es un número editado a mano sin respaldo de costo, lo cual además invalida silenciosamente cualquier cálculo de ganancia real en la venta de accesorios (una vez que esa venta vuelva a funcionar, ver §2.1).

**Clasificación**: **D) No existe.**
**Cobertura**: 10% (existe el catálogo y el contador de stock, pero no el registro de la operación de ingreso que lo sustenta). **Prioridad**: **CRÍTICA** — sin esto, cualquier cálculo de rentabilidad de accesorios en GreatPhones es ficticio.

#### Capacidad: Distinción compra propia vs. consignación (impacto en caja)

**Problema de negocio**: un equipo comprado con dinero propio no es lo mismo, financieramente, que uno que un tercero deja para vender a comisión — el egreso de caja ocurre en momentos distintos.

**Estado actual en GreatPhones**: no existe. El costo de compra es un campo obligatorio sin ningún indicador de tipo/origen que distinga compra de consignación, ni lógica que trate el ingreso como "neutro" en caja.

**Clasificación**: **D) No existe** (depende de que primero exista el Libro Diario — sin caja, esta distinción no tiene dónde manifestarse).
**Cobertura**: 0%. **Prioridad**: MEDIA (solo relevante si el negocio sigue recibiendo mercadería en consignación — decisión de negocio a confirmar).

#### Capacidad: Trazabilidad de proveedor

**Problema de negocio**: saber a quién comprarle de nuevo y cuánto se le compró en total.

**Estado actual en GreatPhones**: resuelto, y mejor que el ERP, **solo para equipos**. Existe una entidad real de Proveedor (nombre, tipo, contacto, total acumulado), vinculable a productos e ítems de inventario — el ERP nunca tuvo esto, ahí el proveedor era siempre texto libre no reutilizable. Pero no cubre Accesorios: el modelo de Accesorio no tiene relación a Proveedor, consistente con la ausencia total de "ingreso de accesorios" como operación real.

**Clasificación**: **B) Ya resuelta, requiere ajustes menores** (falta extenderla a Accesorios).
**Cobertura**: 70% (100% para equipos, 0% para accesorios). **Prioridad**: ALTA (ligada a la capacidad crítica de ingreso de accesorios).

---

### 2.3 Reserva de venta futura y servicio técnico

#### Capacidad: Reserva de venta futura con cobro anticipado (Preventas + Entrega)

**Problema de negocio**: permitir cobrar por adelantado, total o parcialmente, un equipo que el negocio todavía no tiene físicamente, sin inventar stock inexistente ni volver a cobrar lo ya percibido al momento de la entrega.

**Estado actual en GreatPhones**: no existe. Verificado con evidencia directa: el checkout rechaza la operación si el stock es insuficiente **antes** de reservar nada — es decir, la reserva de GreatPhones solo existe para stock que ya está físicamente cargado, nunca para vender algo inexistente. El modelo de Cotización (compra de un equipo usado *al* cliente) es el flujo inverso, no resuelve este problema. No existe ningún endpoint, campo de datos ni estado de pedido que modele "vendido pero aún sin stock, cobrado parcialmente".

**Qué habría que lograr**: una capacidad de reserva-con-cobro-anticipado sobre algo que todavía no está en el inventario, que permita cobros parciales sucesivos sin duplicar el pedido, y que al completarse el ingreso real del equipo cierre el ciclo cobrando solo el saldo pendiente.

**Clasificación**: **D) No existe.**
**Cobertura**: 0%. **Prioridad**: ALTA (es una capacidad comercial activa hoy en el negocio físico, no un caso de borde).

#### Capacidad: Reparación / diagnóstico técnico con presupuesto

**Problema de negocio**: cotizar de forma objetiva el costo de reparar un equipo, dar seguimiento a su estado, y solo cobrar cuando corresponde.

**Estado actual en GreatPhones**: no existe operativamente, aunque el modelo de datos está esbozado. Existen entidades de Reparación y de Catálogo de Servicios de reparación en la base de datos, con estados que incluso reflejan bien el ciclo de diagnóstico/aprobación del ERP — pero **cero rutas del backend las usan**. El único punto de entrada público (la página de "Servicio Técnico") tiene un botón que no está conectado a ningún backend real. El modelo de servicio de reparación tampoco contempla la fórmula de cálculo en cascada del ERP (tarifario externo → fórmula propia → sin configurar).

**Clasificación**: **D) No existe** (el modelo de datos esbozado sin lógica operativa conectada no cuenta como cobertura funcional).
**Cobertura**: 0%. **Prioridad**: ALTA.

#### Capacidad: Garantía post-venta con control de vigencia

**Problema de negocio**: que el cliente y el negocio puedan verificar objetivamente si una compra sigue en garantía.

**Estado actual en GreatPhones**: resuelto, y mejor que el ERP (que solo tenía un texto fijo de 90 días sin ningún control digital). GreatPhones calcula digitalmente días restantes y fecha de vencimiento real, consultable por el cliente con solo el código de compra, sin login.

**Qué falta**: existe cierta fragilidad de arquitectura interna (coexisten dos representaciones de "garantía" en el modelo de datos, una formal sin uso real y otra ad-hoc que es la que efectivamente funciona) que no afecta hoy al usuario pero es un riesgo de mantenimiento. Además, la extensión de garantía se puede comprar en el checkout, pero no hay forma de contratarla **después** de la compra sin pasar por una conversación de chat manual.

**Clasificación**: **B) Ya resuelta, requiere ajustes menores.**
**Cobertura**: 85%. **Prioridad**: MEDIA (funciona hoy; el ajuste es de consolidación y de automatizar la contratación posterior).

---

### 2.4 Tesorería y contabilidad

> Este es, con diferencia, el bloque con menor cobertura de todo el análisis. Las seis capacidades siguientes fueron reconfirmadas con lectura fresca del código (no se asumió el hallazgo de trabajo previo): **ninguna tiene un modelo de datos ni un endpoint dedicado en GreatPhones.**

#### Capacidad: Visibilidad de saldo de caja por medio de pago

**Problema de negocio**: saber en todo momento cuánto dinero disponible hay, discriminado por medio de pago, sin mezclar monedas.

**Estado actual en GreatPhones**: no existe. No hay ningún modelo de saldo/caja en la base de datos, ni ningún endpoint que calcule esto. El único agregado monetario existente (en el Dashboard administrativo) es un total de facturación bruta de ventas — no un saldo de caja, no resta egresos, no discrimina por medio de pago.

**Clasificación**: **D) No existe.**
**Cobertura**: 0%. **Prioridad**: **CRÍTICA** (sin esto, el negocio no puede operar su caja diaria desde GreatPhones; depende por completo del ERP para esta pregunta básica).

#### Capacidad: Registro contable centralizado de todo movimiento de valor (equivalente a Libro Diario)

**Problema de negocio**: que ningún movimiento de dinero del negocio quede sin registrar en un único lugar confiable, con saldo corrido verificable.

**Estado actual en GreatPhones**: no existe. Cada entidad (pedido, cotización, reparación) guarda su propio monto de forma aislada, sin ningún asiento que las una en una sola fuente de verdad contable.

**Clasificación**: **D) No existe.**
**Cobertura**: 0%. **Prioridad**: **CRÍTICA** — es la capacidad fundacional de la que dependen directamente Caja, Gastos, Cambio de Moneda, Ajuste de Caja y buena parte de Reportes; sin esta, ninguna de las demás puede resolverse de forma centralizada.

#### Capacidad: Registro de egresos operativos (Gastos)

**Problema de negocio**: dejar constancia de cada salida de dinero no vinculada a mercadería (alquiler, sueldos, servicios), con responsable y comprobante.

**Estado actual en GreatPhones**: no existe. Búsqueda exhaustiva sin resultados de ningún modelo o endpoint equivalente.

**Clasificación**: **D) No existe.**
**Cobertura**: 0%. **Prioridad**: ALTA (el negocio sigue teniendo gastos operativos reales todos los meses; sin esto no hay forma de calcular utilidad real desde GreatPhones — aunque hoy puede seguir anotándose en el ERP sin bloquear la venta online, por eso no es CRÍTICA).

#### Capacidad: Conversión entre monedas/cajas (Cambio de Moneda)

**Problema de negocio**: registrar formalmente cuando el negocio convierte dinero entre su caja en pesos y su caja en dólares, a una cotización que puede no ser la oficial, sin perder trazabilidad de ambos lados.

**Estado actual en GreatPhones**: no existe. El único rastro de "moneda" es un campo de moneda por pedido individual — no hay ningún concepto de mover dinero entre dos cajas propias del negocio.

**Clasificación**: **D) No existe.**
**Cobertura**: 0%. **Prioridad**: MEDIA (operación de bajo volumen pero alto valor de trazabilidad cuando ocurre — depende de si el negocio sigue operando activamente en dos monedas fuera del checkout).

#### Capacidad: Corrección de diferencias de caja física (Ajuste de Caja)

**Problema de negocio**: cuando un arqueo físico no coincide con lo que el sistema dice que debería haber, dejar un registro formal y justificado de esa diferencia.

**Estado actual en GreatPhones**: no existe.

**Clasificación**: **D) No existe** (depende directamente de que exista primero la capacidad de visibilidad de saldo de caja — no tiene sentido ajustar un saldo que no se calcula en ningún lado).
**Cobertura**: 0%. **Prioridad**: MEDIA.

#### Capacidad: Financiamiento externo del negocio por inversores

**Problema de negocio**: llevar la cuenta corriente de terceros que aportan capital (cuánto tienen invertido, cuánto se les debe, topes de retiro), y calcular periódicamente el rendimiento.

**Estado actual en GreatPhones**: prácticamente no existe. La única pieza real es un campo de texto libre en cada equipo de inventario que permite anotar qué financista está detrás de esa unidad puntual — sin ninguna relación a una entidad de inversor, sin cálculo de capital, sin tope de retiro, sin rendimiento.

**Clasificación**: **D) No existe** (el campo de texto es una referencia descriptiva, no una capacidad funcional).
**Cobertura**: ~2%. **Prioridad**: BAJA-MEDIA (depende enteramente de si el negocio sigue teniendo financistas externos activos; si los tiene, la ausencia de topes de retiro es un riesgo real de sobregiro).

---

### 2.5 Comisiones, integridad de datos y reportes

#### Capacidad: Cálculo de comisión real por vendedor

**Problema de negocio**: saber cuánto pagarle a cada vendedor/administrador según su desempeño real, en dinero, no solo en indicadores.

**Estado actual en GreatPhones**: no existe — pero es importante notar que el ERP **tampoco** lo resolvía (solo acumulaba indicadores, nunca un monto). Ninguno de los dos sistemas resuelve hoy este problema de negocio, pero GreatPhones tiene una base estructural mejor para resolverlo (cada pedido ya identifica de forma confiable al administrador responsable, gracias al login real).

**Clasificación**: **D) No existe.**
**Cobertura**: 0%. **Prioridad**: MEDIA (necesidad real del negocio, pero no bloquea la operación diaria — el ERP tampoco la resolvía y el negocio funcionó igual).

#### Capacidad: Reversión/corrección segura de operaciones cargadas por error (Anulaciones y Correcciones)

**Problema de negocio**: cuando alguien carga mal una operación, poder deshacerla o reemplazarla sin perder rastro de qué pasó ni desincronizar stock/caja/comisiones.

**Estado actual en GreatPhones**: parcial y muy acotado. Solo el Pedido tiene un mecanismo de reversión real (vía Arrepentimiento o cancelación manual de venta en local). Productos, ítems de inventario, reparaciones y cotizaciones **no tienen ningún mecanismo de reversión con motivo obligatorio** — ni siquiera un campo que registre por qué cambió un estado. El borrado de productos e ítems de inventario es físico y directo.

**Qué falta**: la garantía de "cualquier operación, de cualquier tipo, puede revertirse o corregirse con motivo obligatorio y sin perder trazabilidad" — hoy eso solo existe, parcialmente, para el ciclo de vida de un pedido.

**Clasificación**: **D) No existe** como capacidad uniforme del sistema (existe solo un fragmento acotado a pedidos).
**Cobertura**: ~15%. **Prioridad**: **CRÍTICA** — es la capacidad de integridad más importante del ERP y la que GreatPhones tiene más incompleta.

#### Capacidad: Registro permanente e inmutable de quién anuló/corrigió qué (Auditoría)

**Problema de negocio**: poder responder siempre "¿quién anuló esto, cuándo y por qué?", sin que ese registro se pueda editar ni borrar.

**Estado actual en GreatPhones**: parcial. Existe un historial de cambios bien construido, pero **únicamente para ítems de inventario**. No existe un equivalente para Pedidos, Reparaciones, Cotizaciones ni Productos.

**Clasificación**: **C) Debe adaptarse** — ya existe el patrón correcto (el historial de inventario), solo falta generalizarlo al resto de las entidades; no hace falta inventar un mecanismo nuevo.
**Cobertura**: ~25% (1 de ~5 entidades relevantes cubiertas). **Prioridad**: ALTA.

#### Capacidad: Atomicidad técnica ante fallos a mitad de una operación

**Problema de negocio**: que un corte a mitad de camino (timeout, error de red) nunca deje el sistema en un estado inconsistente.

**Estado actual en GreatPhones**: resuelto, y mejor que el ERP. El sistema de Transacciones del ERP existía específicamente para compensar que Google Apps Script no tiene transacciones nativas (el propio código del ERP lo dice explícitamente). GreatPhones usa transacciones de base de datos reales en sus operaciones críticas (checkout, venta en local) — esa necesidad técnica ya no existe.

**Clasificación**: **E) Ya no tiene sentido** como capacidad de negocio propia — la resuelve la base de datos, no requiere una capa dedicada a "detectar transacciones incompletas".
**Cobertura**: 100% (resuelto por otro medio, tecnológicamente superior). **Prioridad**: N/A.

#### Capacidad: Snapshot recuperable antes de anular una operación

**Problema de negocio**: si alguien anula algo por error, o una corrección sale mal, poder reconstruir manualmente el estado exacto de antes — no solo saber que "algo cambió", sino tener la foto completa.

**Nota importante**: esta capacidad es **distinta** de la atomicidad anterior, aunque el ERP las resolvía con mecanismos vecinos. Una transacción atómica garantiza que una anulación se aplica completa o no se aplica; **no guarda una copia de cómo estaba todo antes** de que esa anulación (ya completa y exitosa, pero tal vez equivocada) ocurriera.

**Estado actual en GreatPhones**: no existe. No hay ninguna tabla ni mecanismo de snapshot previo a un cambio de estado en ningún modelo de datos.

**Clasificación**: **D) No existe.**
**Cobertura**: 0%. **Prioridad**: ALTA (es el complemento natural de la capacidad de Anulaciones/Correcciones, con la que debería resolverse en conjunto).

#### Capacidad: Autodiagnóstico periódico de inconsistencias del sistema (Salud ERP)

**Problema de negocio**: detectar activamente, sin depender de que alguien note un error a simple vista, situaciones imposibles del negocio (un equipo marcado vendido sin venta activa, una referencia rota, un asiento sobre una operación anulada).

**Estado actual en GreatPhones**: no existe. No se encontró ningún endpoint ni proceso de verificación de consistencia de datos en todo el backend.

**Clasificación**: **D) No existe.**
**Cobertura**: 0%. **Prioridad**: MEDIA (valiosa pero no bloqueante para lanzar; se vuelve más urgente cuantas más de las capacidades de integridad de arriba se implementen, porque generan más superficie a verificar — y GreatPhones ya demostró en auditorías previas de esta conversación que tiene sus propias inconsistencias reales que un chequeo así habría detectado, por ejemplo el bug de cancelación de venta en local).

#### Capacidad: Consolidado financiero/comercial (Reportes)

**Problema de negocio**: tener, en un solo lugar, el consolidado de ventas, compras, gastos, utilidad, preventas por estado, accesorios vendidos y resumen por vendedor.

**Estado actual en GreatPhones**: no existe, con un hueco real de **contenido**, no solo de formato. El único mecanismo de exportación real del sistema exporta exclusivamente el historial de altas/ediciones del catálogo de productos — nombre, marca, precio, costo, stock. No hay ninguna columna de ventas, compras, gastos, utilidad ni comisión. No es una versión distinta del mismo reporte: es un reporte de un tema completamente distinto (auditoría de catálogo, no consolidado financiero).

**Clasificación**: **D) No existe** (lo que existe hoy resuelve un problema distinto).
**Cobertura**: ~5%. **Prioridad**: ALTA (depende de que exista antes una fuente de verdad contable — ver Libro Diario más arriba).

#### Capacidad: Vista ejecutiva instantánea del estado del negocio (Dashboard)

**Problema de negocio**: que el dueño del negocio vea, sin entrar módulo por módulo, cómo está el negocio hoy.

**Estado actual en GreatPhones**: resuelto parcialmente, y confirmado sin ambigüedad en esta relectura (se verificó cuál de dos implementaciones que convivían en el código es la que efectivamente se ejecuta: la más completa, con ingresos, pedidos, ticket promedio, nuevos usuarios —los cuatro con comparación contra el mes anterior—, serie mensual/anual, últimos pedidos, productos más vendidos, alertas de stock bajo y ventas por marca).

**Qué falta**: comparado con el Dashboard del ERP (que incluía caja separada en pesos y dólares, ganancia del mes, preventas por estado, reparaciones abiertas), el Dashboard de GreatPhones **no tiene ninguna dimensión financiera de caja ni de margen/ganancia**, y no muestra preventas ni reparaciones abiertas. Es una vista ejecutiva sólida del lado comercial, pero ciega del lado financiero — un hueco que depende de que exista antes una fuente de verdad de caja, no un problema del Dashboard en sí.

**Clasificación**: **B) Ya resuelta, requiere ajustes** (la base es sólida y superior en analítica comercial a la que tenía el ERP).
**Cobertura**: ~55%. **Prioridad**: MEDIA.

---

### 2.6 Identidad, responsabilidad y gobierno de operaciones

#### Capacidad: Identificación y trazabilidad del cliente (historial completo)

**Problema de negocio**: poder responder "¿qué compró, reparó, cotizó o consultó tal persona?" sin buscar manualmente por texto en cada módulo.

**Estado actual en GreatPhones**: resuelto, y de forma muy superior al ERP (que no tenía ninguna entidad Cliente — era texto libre repetido sin deduplicar). GreatPhones tiene una identidad de usuario real, con relaciones directas a pedidos, cotizaciones, reparaciones, garantías, conversaciones y favoritos.

**Qué falta**: la centralización de datos es real, pero no hay una vista propia en el panel administrativo que consolide todo eso como un único historial de un cliente — hoy se accedería entidad por entidad.

**Clasificación**: **A) Ya resuelta.**
**Cobertura**: 90%. **Prioridad**: BAJA (falta es de agregación/presentación, no de datos).

#### Capacidad: Identificación de quién ejecutó cada acción del sistema (Operadores)

**Problema de negocio**: responsabilidad y trazabilidad — poder atribuir cada operación a una persona concreta, en un negocio sin sistema de permisos formal.

**Estado actual en GreatPhones**: resuelto de raíz, y mejor. La autenticación real con roles reemplaza al selector manual sin sesión del ERP, resolviendo el problema de fondo (saber quién es quién) de forma más confiable.

**Qué falta**: la propagación de "quién hizo esto" a nivel de **registro de datos** (no solo de sesión) es inconsistente — solo pedidos y conversaciones guardan explícitamente qué administrador actuó; cotizaciones, reparaciones y arrepentimientos no tienen ningún campo que registre qué administrador aprobó, rechazó o resolvió cada uno.

**Clasificación**: **B) Ya resuelta, requiere ajustes menores** (cerrar el hueco en las tres entidades faltantes es de bajo esfuerzo y alto valor de auditoría).
**Cobertura**: 70%. **Prioridad**: ALTA.

#### Capacidad: Parámetros de negocio editables sin tocar código (Configuraciones)

**Problema de negocio**: que el dueño del negocio pueda ajustar precios, coeficientes y reglas comerciales sin depender de un desarrollador ni de un despliegue.

**Estado actual en GreatPhones**: no existe. No hay ningún modelo de configuración en la base de datos. Los valores que cumplirían ese rol (precios base de tasación de equipos usados, coeficientes de cuotas, montos de garantía extendida, costos de envío) están escritos como constantes directamente en el código fuente del frontend — cambiar cualquiera de ellos hoy exige editar código y redesplegar.

**Clasificación**: **D) No existe.**
**Cobertura**: 0%. **Prioridad**: ALTA (es la única de las capacidades de este bloque con cobertura real nula, y afecta directamente la autonomía operativa diaria del negocio).

#### Capacidad: Vista unificada de toda operación + poder intervenir sobre ella (Mis Operaciones)

**Problema de negocio**: un lugar único donde cualquier persona pueda encontrar cualquier operación, ver su detalle completo, y —si se equivocó al cargarla— corregirla o anularla dejando rastro.

**Estado actual en GreatPhones**: no existe como capacidad unificada. El panel administrativo está organizado en pestañas separadas e independientes por tipo de entidad (productos, pedidos, arrepentimientos, cotizaciones, chat, etc.) — no hay ninguna pantalla que combine todo tipo de operación en un único listado cronológico con acciones uniformes.

**Qué falta**: el punto de entrada único ("¿dónde busco tal operación sin saber de antemano si es un pedido, una cotización o un reclamo?") y la capacidad de corrección con reemplazo trazable (crear una versión corregida vinculada a la original, distinta de simplemente editar el registro).

**Clasificación**: **C) Debe adaptarse** (aprovechando que GreatPhones ya tiene, entidad por entidad, buena parte de la gestión resuelta — no hace falta un formulario nuevo, sino unificar el punto de acceso).
**Cobertura**: 40%. **Prioridad**: MEDIA (valiosa para la operación diaria y la auditoría, pero cada entidad ya es gestionable por separado hoy — no es una capacidad completamente ausente, es una capacidad fragmentada).

---

## 3. Dónde vive hoy cada capacidad en GreatPhones — síntesis

| Capacidad ya resuelta | Dónde vive en GreatPhones |
|---|---|
| Stock/disponibilidad en tiempo real | `InventoryItem.status` + `Product.stock`/`reserved`, con reserva atómica en checkout y webhook de Mercado Pago |
| Identificación y trazabilidad del cliente | Entidad `User` con relaciones directas a Orders, Quotes, Repairs, Guarantees, Conversations |
| Venta de un equipo (consecuencias de stock) | Checkout online + webhook de pago + venta en local, todos convergiendo sobre `Order`/`InventoryItem` |
| Ingreso de equipos al inventario | `POST /api/inventory` con autocompletado por IMEI contra base TAC pública |
| Trazabilidad de proveedor (solo equipos) | Entidad `Supplier` vinculada a `Product`/`InventoryItem` |
| Garantía post-venta | `GET /api/warranty`, cálculo digital de vigencia sobre `Order.createdAt` |
| Identificación de responsable (parcial) | `User.role` (autenticación real) + `Order.adminId`/`Conversation.adminId` |
| Vista ejecutiva del negocio (parcial) | `render.js` + `GET /api/admin/dashboard` (confirmado como la implementación activa) |
| Auditoría (solo inventario) | `InventoryHistory` + `GET /api/inventory/[id]/history` |
| Atomicidad técnica | Transacciones nativas de la base de datos relacional en checkout y venta en local |

---

## 4. Capacidades que faltan (D — no existen, deben construirse desde cero)

Ordenadas por prioridad:

**CRÍTICA**
1. Venta de accesorios (el flujo está roto en todos los canales)
2. Ingreso de mercadería de accesorios (con costo y proveedor)
3. Visibilidad de saldo de caja por medio de pago
4. Registro contable centralizado (Libro Diario)
5. Reversión/corrección segura y uniforme de operaciones

**ALTA**
6. Reserva de venta futura con cobro anticipado (Preventas + Entrega)
7. Reparación/diagnóstico técnico con presupuesto
8. Registro de egresos operativos (Gastos)
9. Snapshot recuperable antes de anular
10. Consolidado financiero/comercial (Reportes)
11. Parámetros de negocio editables sin tocar código (Configuraciones)

**MEDIA**
12. Regalos automáticos
13. Vinculación de una compra a una preventa existente
14. Distinción compra propia vs. consignación
15. Conversión entre monedas/cajas (Cambio de Moneda)
16. Corrección de diferencias de caja física (Ajuste de Caja)
17. Cálculo de comisión real por vendedor
18. Autodiagnóstico periódico de inconsistencias (Salud ERP)

**BAJA-MEDIA**
19. Financiamiento externo del negocio por inversores

---

## 5. Capacidades que desaparecen (E — ya no tienen sentido)

Solo una, y con justificación estructural sólida:

- **Atomicidad técnica ante fallos a mitad de una operación**: el ERP la resolvía con un sistema propio de "Transacciones" porque Google Apps Script no tiene transacciones nativas. GreatPhones, al estar construido sobre una base de datos relacional real, ya tiene esta garantía de fábrica en sus operaciones críticas. No hace falta construir nada — y no hay que confundir esto con el "Snapshot recuperable antes de anular" (capacidad #9 de la lista anterior), que es un problema de negocio distinto y sí sigue faltando.

---

## 6. Capacidades que deben adaptarse (C — GreatPhones ya tiene piezas reales, pero la solución no está completa)

- **Auditoría permanente**: el patrón correcto ya existe (el historial de cambios de inventario) — falta generalizarlo al resto de las entidades de negocio, no inventar un mecanismo nuevo.
- **Vista unificada de operaciones (Mis Operaciones)**: cada tipo de operación ya es gestionable por separado en el panel administrativo — falta el punto de entrada único y la capacidad de corrección con reemplazo trazable.

---

## 7. Capacidades ya completamente resueltas (A — no hacer nada)

- **Stock/disponibilidad en tiempo real** (95% — con una observación menor de robustez interna, no de capacidad de negocio).
- **Identificación y trazabilidad del cliente** (90% — con una vista de agregación pendiente, no un problema de datos).

## Capacidades resueltas con ajustes menores (B)

- Venta de un equipo (75% — falta el cálculo de ganancia por operación).
- Ingreso de equipos al inventario (75% — falta el vínculo contable y el costo de reparación estimado).
- Trazabilidad de proveedor (70% — falta extenderla a accesorios).
- Garantía post-venta (85% — falta consolidar el modelo de datos y automatizar la extensión posterior a la compra).
- Identificación de responsable (70% — falta propagarla a Cotizaciones, Reparaciones y Arrepentimientos).
- Vista ejecutiva del negocio (55% — falta la dimensión financiera de caja y margen).

---

## 8. Matriz final consolidada

| Capacidad | Problema de negocio | Estado actual en GreatPhones | Cobertura | Acción necesaria | Prioridad | Observaciones |
|---|---|---|---|---|---|---|
| Venta de un equipo | Vender sin duplicar, con ganancia real calculada | Checkout + webhook + venta en local, con reserva atómica | 75% | B — agregar cálculo de ganancia por operación y concepto de consignación | ALTA | Estructuralmente superior al ERP salvo por esto |
| Venta de accesorios | Vender productos fungibles descontando stock | Catálogo navegable, pero el flujo de venta no conecta con él en ningún canal | 15% | D — construir el flujo de venta de accesorios desde cero | CRÍTICA | Roto de forma silenciosa hoy en checkout y en local |
| Stock/disponibilidad en tiempo real | Nunca vender algo no disponible | `InventoryItem.status` + reserva atómica | 95% | A — ninguna | BAJA | Dualidad de modelos de stock a observar, no a resolver como capacidad |
| Regalos automáticos | Incentivo comercial sin depender del vendedor | No existe | 0% | D — construir desde cero | MEDIA | Pérdida comercial, no riesgo operativo |
| Ingreso de equipos al inventario | Convertir un equipo físico en activo vendible identificado | Alta por IMEI con autocompletado, superior al ERP | 75% | B — agregar vínculo contable y costo de reparación estimado | ALTA | El alta en sí es mejor que el ERP |
| Vinculación compra↔preventa | No ofrecer a otro cliente un equipo ya reservado | No existe | 0% | D — depende de que se resuelva Preventas primero | MEDIA | Decisión de negocio previa |
| Ingreso de mercadería de accesorios | Reponer stock con costo y proveedor reales | Solo un número de stock editable a mano | 10% | D — construir desde cero | CRÍTICA | Sin esto, la rentabilidad de accesorios es ficticia |
| Distinción compra propia vs. consignación | Reflejar correctamente el momento del egreso de caja | No existe | 0% | D — depende de que exista Caja/Libro Diario | MEDIA | Decisión de negocio previa |
| Trazabilidad de proveedor | Saber a quién comprarle y cuánto | Resuelto para equipos, no para accesorios | 70% | B — extender a accesorios | ALTA | Ligada al ingreso de accesorios |
| Reserva de venta futura con cobro anticipado (Preventas+Entrega) | Vender antes de tener stock, cobrando por adelantado, sin duplicar el cobro al entregar | No existe | 0% | D — construir desde cero | ALTA | Capacidad comercial activa hoy en el negocio físico |
| Reparación/diagnóstico con presupuesto | Cotizar objetivamente y dar seguimiento a una reparación | Modelo de datos esbozado, cero lógica conectada | 0% | D — construir el flujo completo | ALTA | El flujo público es un botón sin backend |
| Garantía post-venta | Verificar objetivamente si una compra sigue en garantía | Cálculo digital real, consultable sin login | 85% | B — consolidar modelo de datos, automatizar extensión posterior | MEDIA | Ya mejor que el ERP |
| Visibilidad de saldo de caja | Saber cuánto dinero disponible hay por medio de pago | No existe | 0% | D — construir desde cero | CRÍTICA | Base de la que dependen Gastos, Cambio de Moneda, Ajuste de Caja |
| Registro contable centralizado (Libro Diario) | Que ningún movimiento de valor quede sin registrar | No existe | 0% | D — construir desde cero | CRÍTICA | Capacidad fundacional de todo el bloque de Tesorería |
| Registro de egresos operativos (Gastos) | Dejar constancia de cada salida de dinero operativa | No existe | 0% | D — construir desde cero | ALTA | Puede seguir anotándose en el ERP mientras tanto |
| Conversión entre monedas/cajas (Cambio de Moneda) | Registrar formalmente el movimiento entre caja en pesos y en dólares | No existe | 0% | D — construir desde cero | MEDIA | Bajo volumen, alto valor de trazabilidad |
| Ajuste de caja física | Registrar formalmente un sobrante/faltante de arqueo | No existe | 0% | D — depende de que exista Caja primero | MEDIA | — |
| Financiamiento externo por inversores | Cuenta corriente de capital de terceros | Solo un campo de texto libre sin lógica | 2% | D — construir desde cero | BAJA-MEDIA | Depende de si el negocio sigue teniendo financistas activos |
| Cálculo de comisión real por vendedor | Pagar comisión en dinero según desempeño real | No existe (tampoco existía en el ERP) | 0% | D — construir desde cero | MEDIA | GreatPhones tiene mejor base de partida (adminId real) que el ERP |
| Anulación/corrección segura y uniforme | Deshacer o reemplazar un error sin perder trazabilidad ni desincronizar el resto | Solo existe, parcialmente, para Pedidos | 15% | D — generalizar a todas las entidades | CRÍTICA | La capacidad de integridad más importante del ERP, la más incompleta en GreatPhones |
| Auditoría permanente | Saber siempre quién anuló/corrigió qué y por qué | Solo existe para inventario | 25% | C — generalizar el patrón ya existente | ALTA | No hace falta inventar nada nuevo, solo extender |
| Atomicidad técnica ante fallos | Que un corte a mitad de camino no deje el sistema inconsistente | Resuelto nativamente por la base de datos | 100% | E — ninguna acción | N/A | No confundir con el snapshot recuperable (sí falta) |
| Snapshot recuperable antes de anular | Poder reconstruir el estado exacto de antes de una anulación deliberada | No existe | 0% | D — construir desde cero | ALTA | Complemento natural de Anulaciones/Correcciones |
| Autodiagnóstico periódico de inconsistencias (Salud ERP) | Detectar activamente situaciones imposibles del negocio | No existe | 0% | D — construir desde cero | MEDIA | Más urgente cuanto más se implemente el resto de Integridad |
| Consolidado financiero/comercial (Reportes) | Foto consolidada de ventas, compras, gastos, utilidad | Solo existe exportación de catálogo, tema distinto | 5% | D — construir desde cero | ALTA | Depende de que exista Libro Diario primero |
| Vista ejecutiva instantánea (Dashboard) | Ver el estado del negocio sin entrar módulo por módulo | Resuelto del lado comercial, ciego del lado financiero | 55% | B — agregar dimensión de caja y margen | MEDIA | Ya superior al ERP en analítica comercial |
| Identificación y trazabilidad del cliente | Saber todo lo que hizo un cliente sin buscar módulo por módulo | Entidad Cliente real con historial | 90% | A — ninguna (opcional: vista de agregación) | BAJA | Brecha histórica del ERP ya resuelta y superada |
| Identificación de responsable de cada acción (Operadores) | Saber quién hizo cada cosa sin depender de la memoria | Autenticación real, propagación inconsistente a algunos registros | 70% | B — propagar a Cotizaciones, Reparaciones, Arrepentimientos | ALTA | Barato de cerrar, alto valor de auditoría |
| Configuraciones editables sin tocar código | Que el negocio ajuste precios/reglas sin depender de un desarrollador | No existe (todo hardcodeado en el frontend) | 0% | D — construir desde cero | ALTA | Afecta la autonomía operativa diaria |
| Vista unificada de operaciones (Mis Operaciones) | Un solo lugar para encontrar e intervenir sobre cualquier operación | Fragmentada en pestañas independientes por tipo | 40% | C — unificar el punto de acceso, agregar corrección trazable | MEDIA | Cada entidad ya es gestionable por separado hoy |

---

## 9. Síntesis ejecutiva

De las **30 capacidades de negocio** que hoy resuelve el ERP:

- **2 (7%)** ya están completamente resueltas por GreatPhones — no requieren ninguna acción.
- **6 (20%)** ya están resueltas y solo requieren ajustes puntuales y acotados.
- **2 (7%)** tienen piezas reales sobre las cuales construir, pero requieren una solución nueva de adaptación.
- **19 (63%)** no existen en absoluto y deben construirse desde cero.
- **1 (3%)** ya no tiene sentido tal como existía en el ERP, porque la propia arquitectura de GreatPhones la resuelve de raíz por otro camino.

El bloque de mayor riesgo es, sin ambigüedad, **Tesorería y Contabilidad** (Caja, Libro Diario, Gastos, Cambio de Moneda, Ajuste de Caja) junto con **Integridad de datos** (Anulaciones/Correcciones, Auditoría generalizada, Snapshot recuperable): son 11 de las 19 capacidades ausentes, y varias de ellas son fundacionales — otras capacidades (Reportes, Ajuste de Caja, Dashboard financiero) dependen directamente de que estas existan primero.

Dos hallazgos de esta relectura no estaban tan precisados en el trabajo previo de esta conversación y merecen atención inmediata pese a no pertenecer al bloque financiero: **la venta de accesorios está funcionalmente rota hoy** (no un vacío a completar, sino un flujo que falla en producción sin que nadie lo note), y **el ingreso de mercadería de accesorios no deja ningún rastro de costo real**, lo cual invalida silenciosamente cualquier cálculo de rentabilidad de ese rubro.

Con esto, la respuesta a la pregunta que motivó este documento queda explícita: **estas son exactamente las 19 capacidades del ERP que todavía faltan incorporar a GreatPhones** (sección 4), ordenadas por prioridad, listas para que el negocio decida en qué orden desarrollarlas — sin necesidad de copiar un solo formulario, pantalla u hoja de cálculo del ERP para lograrlo.
