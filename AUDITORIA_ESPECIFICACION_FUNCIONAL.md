---
title: Auditoría de Calidad — Especificación Funcional GreatPhones (v1.0 candidata)
documento_auditado: ESPECIFICACION_FUNCIONAL_ERP.md
fecha_auditoria: 2026-07-17
alcance: Partes I a V completas (capítulos 1 a 29, ~3885 líneas)
---

# Auditoría de Calidad — Especificación Funcional GreatPhones

> **Rol asumido para esta auditoría**: CTO recién incorporado a la empresa, sin conocimiento previo del proyecto. Objetivo: determinar si `ESPECIFICACION_FUNCIONAL_ERP.md` es suficiente, tal como está, para que un equipo de desarrollo nuevo reconstruya GreatPhones sin necesidad de hacer preguntas adicionales al negocio.
>
> **Este informe NO modifica el documento auditado.** Es un artefacto separado. Ninguna recomendación de este informe fue aplicada — quedan a decisión del negocio.
>
> **Metodología**: el documento se leyó completo, capítulo por capítulo, y se dividió en cuatro auditorías paralelas e independientes: (1) Parte I (ERP, capítulos 1-11) contra el código real en `C:\Users\samin\Excel`; (2) Partes II y III (GreatPhones y comparación, capítulos 12-24) contra el código real en `C:\Users\samin\greatphones\greatphones-next`; (3) Partes IV y V (arquitectura Google Sheets y catálogo de eventos, capítulos 25-29), con foco en consistencia interna y en el principio "la base de datos es la única fuente de verdad"; (4) una lectura completa de punta a punta dedicada exclusivamente a cazar contradicciones **entre** partes distintas. Los cuatro resultados se consolidaron acá, eliminando duplicados y fusionando hallazgos que distintas auditorías detectaron de forma independiente (una señal de que el hallazgo es real, no ruido).
>
> Cada hallazgo se reporta con: **Ubicación**, **Descripción**, **Por qué es un problema**, **Evidencia**, **Gravedad**, **Recomendación**. La recomendación nunca prescribe una solución de código ni una decisión de negocio — señala qué debe decidirse o aclararse.

---

## Resumen ejecutivo

Sobre casi 3.900 líneas y 29 capítulos, la auditoría encontró **2 hallazgos CRÍTICOS, 10 ALTOS, 10 MEDIOS y 3 BAJOS** — un total de 25 hallazgos concretos, todos respaldados por evidencia textual y, donde correspondía, por líneas de código reales. Ninguno de los cuatro auditores independientes encontró evidencia de comportamiento inventado: cada vez que el documento no tenía certeza sobre algo, lo señaló explícitamente como pregunta abierta en vez de rellenar el vacío — este patrón se mantuvo consistente en las cinco partes, incluida la más nueva (catálogo de eventos).

Los dos hallazgos críticos no invalidan el documento; señalan una contradicción real entre lo que el documento **afirma como principio general** y lo que **describe como mecanismo concreto**, ambas dentro de la Parte I. Los diez hallazgos altos son, en su mayoría, de dos tipos: (a) afirmaciones del propio documento que quedaban como "pregunta abierta" pero que, verificadas contra el código, ya tienen respuesta definitiva y deberían cerrarse; y (b) piezas del catálogo de eventos (Parte V) que no llegan al mismo nivel de rigor que el resto del documento.

La respuesta a la pregunta final del encargo está en la última sección de este informe.

---

## Hallazgos CRÍTICOS

### C1 — La reconstrucción del Libro Diario no es íntegra, pese a que el documento lo presenta como una garantía del sistema

- **Ubicación**: Parte I, §1.4 ("Todo debe ser reconstruible y verificable"), §9.5 ("el sistema puede reconstruirse íntegramente (Libro Diario) a partir de sus fuentes"), §4.13 (Libro Diario), §10.1 (riesgo "Reconstrucción del Libro Diario puede reincorporar montos anulados").
- **Descripción**: el documento afirma dos veces, como principio de diseño (§1.4 y §9.5), que el Libro Diario "puede reconstruirse íntegramente... a partir de sus fuentes". Pero la propia §4.13 ya listaba correctamente que la reconstrucción solo recorre **6 fuentes**: Compras, Ventas, Reparaciones, Gastos, Preventas y Movimientos de Caja manuales. Verificado contra el código real: la operación **borra el 100% de los asientos existentes** (`clearContent()`) antes de regenerarlos, y **nunca** recorre Cambio de Moneda, Ajuste de Caja, Compras de Accesorios, Ventas de Accesorios ni Movimientos de Inversor. El riesgo documentado en §10.1 lo describe como "podría reincorporar montos anulados" — una descripción más suave de lo que realmente ocurre: ejecutar esta operación **destruye permanentemente** el historial contable de 5 de los ~10 tipos de movimiento del sistema, sin ninguna posibilidad de recuperación posterior.
- **Por qué es un problema**: es una contradicción directa entre un principio general que el documento presenta como garantía ("todo es reconstruible") y el mecanismo real, que es parcial y destructivo para lo que no cubre. Un equipo de desarrollo que tome §1.4/§9.5 al pie de la letra podría implementar en GreatPhones una función equivalente de "reconstruir el libro contable" asumiendo que es segura, sin saber que en el sistema real esa operación borra permanentemente el historial de gastos de tesorería e inversores si se ejecuta.
- **Evidencia**: Code.gs (función `reconstruirLibroDiario`) — el diálogo de confirmación lista textualmente solo "Compras, Ventas, Reparaciones, Gastos, Preventas, Movimientos Manuales"; la operación llama a `.clearContent()` sobre el rango completo de asientos antes de reescribir solo con esas 6 fuentes.
- **Gravedad**: **CRÍTICO** — es una contradicción entre una garantía explícita del sistema y su implementación real, con consecuencia destructiva e irreversible.
- **Recomendación**: el negocio debe decidir, para el nuevo Libro Diario de GreatPhones (Etapa 1 del roadmap, Parte III §24), si una eventual función de "reconstrucción completa" debe cubrir sin excepción todos los tipos de movimiento contable. Independientemente de esa decisión, el documento debería corregir §1.4/§9.5 para que no prometan una integridad que el sistema descrito en §4.13 no garantiza.

### C2 — Contradicción real, repetida en cuatro capítulos distintos, sobre si "Reportes" se actualiza automáticamente

- **Ubicación**: Parte I, §2.4 ("con una excepción: la actualización manual de reportes"), §2.6 punto 4 ("no se duplica información hacia estas vistas, se recalcula en cada consulta" — aplicado sin distinción a Dashboard, Reportes y Mis Operaciones), §4.17 ("Duda documentada: no queda cerrado si todas las operaciones... disparan este recálculo automáticamente"), §8 (paso 5, "Reportes y Dashboard reflejan la operación", sin matices, como parte del flujo de cualquier venta).
- **Descripción**: cuatro secciones del mismo documento dan versiones distintas del mismo hecho. Verificado contra el código real: la función que recalcula Reportes **solo se invoca desde el registro de un movimiento manual de caja** — no existe ninguna llamada a esa función dentro de los procesos de Compra, Venta, Preventa, Entrega de Preventa, Reparación, Gasto, Compra de Accesorios ni Venta de Accesorios. Es decir: **Reportes NO se actualiza automáticamente tras una venta** (ni tras casi ninguna otra operación de negocio), contrariamente a lo que dice §8, y la "duda documentada" de §4.17 ya tiene respuesta definitiva y verificable.
- **Por qué es un problema**: es exactamente el tipo de contradicción entre capítulos que el encargo pidió priorizar (punto 1 del pedido). Un desarrollador que lea §8 como el resumen canónico del flujo de negocio (que es justamente su función declarada) se llevaría una idea incorrecta y contradictoria con lo que dicen §2.4 y §4.17 sobre el mismo tema.
- **Evidencia**: Code.gs — única invocación real de la función de recálculo de Reportes está dentro del procesador de movimiento manual de caja; no aparece en ningún otro procesador de operación de negocio.
- **Gravedad**: **CRÍTICO** — contradicción confirmada entre cuatro capítulos sobre un comportamiento central del sistema contable, con evidencia de código que resuelve la duda en un sentido distinto al que el texto más visible (§8) sugiere.
- **Recomendación**: unificar las cuatro menciones con el hecho ya verificado (Reportes se recalcula bajo demanda: botón manual o movimiento de caja manual, no automáticamente tras cada venta/compra/etc.), y decidir — como cuestión de negocio para GreatPhones — si el nuevo Dashboard/Reportes debe recalcularse siempre en vivo (recomendado, dado que GreatPhones ya lo hace así para su propio Dashboard, Parte II §14.11) o si se conserva el patrón de "bloque bajo demanda" del ERP.

---

## Hallazgos ALTOS

### A1 — La numeración correlativa de operaciones no tiene ninguna protección de concurrencia, y esto no está documentado como riesgo

- **Ubicación**: Parte I, §1.2 (declara el sistema pensado para "múltiples personas operando simultáneamente sobre los mismos datos"), §6.1 regla 9, §4.5 (bloqueo de 15s para SKU de accesorios), §4.25 (bloqueo de 30s para anulaciones) — ausencia de mención equivalente para la numeración correlativa.
- **Descripción**: el mecanismo que genera el número de operación de Compras, Ventas, Preventas, Reparaciones, Gastos, Cambio de Moneda y Ajuste de Caja calcula el número como "primera fila libre", sin ningún bloqueo de concurrencia. El documento sí documenta protecciones equivalentes para casos de menor criticidad (creación de SKU de accesorios, anulaciones), pero no advierte que el mecanismo más transversal de todos —usado por prácticamente toda operación— carece de esa misma protección, pese a que §1.2 declara explícitamente que el sistema está pensado para uso simultáneo por varias personas.
- **Por qué es un problema**: es un caso límite de "usuarios simultáneos" (explícitamente pedido en el punto 5 del encargo) que el documento no cubre pese a documentar casos de menor impacto con el mismo patrón de riesgo.
- **Evidencia**: Code.gs (`getFilaVacia`, `genCorrelativo`) — ninguna de las dos funciones usa `LockService` ni mecanismo equivalente, a diferencia de la resolución de SKU de accesorios y del sistema de anulaciones, que sí lo usan.
- **Gravedad**: **ALTO**.
- **Recomendación**: documentar este caso límite en el capítulo de riesgos del ERP, y decidir si el nuevo GreatPhones (que ya cuenta con una base de datos relacional real) debe generar sus identificadores de forma atómica por diseño — algo que el propio documento ya recomienda implícitamente al preferir bases de datos reales sobre hojas de cálculo.

### A2 — Cotizaciones (Quotes) acepta el precio final directamente del cliente sin recálculo del lado del servidor, rompiendo un principio de integridad que sí se aplica en otro módulo equivalente

- **Ubicación**: Parte II, §13.9 y §14.7 (Cotizaciones); Parte I, §6.6 regla 66 (Cambio de Moneda: "el monto en pesos siempre se calcula en el servidor, nunca se acepta precalculado del cliente, para evitar manipulación").
- **Descripción**: verificado contra el código real, el endpoint de Cotizaciones de GreatPhones acepta el precio final ya calculado por el propio navegador del cliente, sin ningún recálculo ni validación server-side de esa cifra — a diferencia de Cambio de Moneda en el ERP, donde ese mismo principio de integridad (nunca confiar en un monto que el cliente pudo manipular) sí se aplica y está documentado como regla explícita. El documento no señala esta asimetría en ningún lugar de las Partes II o III.
- **Por qué es un problema**: es una inconsistencia real de principio de integridad entre dos módulos que deberían tratarse con el mismo criterio (ambos calculan un valor monetario a partir de datos que el usuario puede influir). La mitigación real (que un administrador revisa manualmente antes de aprobar la cotización) existe, pero el documento no la señala como la salvaguarda que compensa la ausencia de validación server-side — deja la impresión de que el criterio de integridad es parejo en todo el sistema cuando no lo es.
- **Evidencia**: endpoint `/api/quotes` en `greatphones-next/src/app/api/quotes/route.ts` — el campo de precio final se persiste tal como llega en el cuerpo de la solicitud, sin recalcularlo a partir de las reglas de negocio del lado del servidor.
- **Gravedad**: **ALTO**.
- **Recomendación**: el negocio debe decidir explícitamente si Cotizaciones debe recalcular el precio final server-side (como Cambio de Moneda) o si la revisión manual de un administrador es la salvaguarda deliberada y suficiente — y dejarlo documentado como decisión tomada, no como omisión.

### A3 — Ocho eventos derivados transversales del catálogo (§29.1) no cumplen la plantilla de 9 dimensiones que el propio documento exige

- **Ubicación**: Parte V, §28.7 (promete que "cada evento del capítulo 29 se documenta con la siguiente estructura fija" de 9 campos) vs. §29.1 (`AsientoContableRegistrado`, `StockActualizado`, `ClienteHistorialActualizado`, `ComisionesActualizadas`, `DashboardRecalculado`, `AuditoriaRegistrada`, `SincronizacionSheetsCompletada/Fallida`, `NotificacionEnviada`).
- **Descripción**: los 35 eventos primarios sí cumplen las 9 dimensiones. Los 8 eventos transversales del §29.1 —que son, además, los más citados desde el resto del catálogo— están escritos como párrafos libres que omiten sistemáticamente varios campos: ninguno especifica "información que jamás sale de la base de datos"; la mayoría no declara "eventos secundarios que genera"; `StockActualizado` no aclara su propia sincronización hacia Sheets pese a ser el evento derivado más frecuentemente referenciado de todo el catálogo.
- **Por qué es un problema**: estos 8 eventos son reactores que un equipo de desarrollo implementaría como piezas centrales y reutilizables del sistema; hoy debe inferir varias de sus 9 respuestas obligatorias, exactamente lo que el objetivo del documento (que un desarrollador no necesite preguntar nada) busca evitar.
- **Evidencia**: comparar la extensión y campos de cualquier evento primario (por ejemplo `ClienteRegistrado`, 9 bullets completos + diagrama) contra `StockActualizado` (dos oraciones, sin campos nombrados).
- **Gravedad**: **ALTO**.
- **Recomendación**: decidir si estos 8 eventos se completan con el mismo formato que los 35 primarios, o si el documento declara explícitamente que los eventos transversales tienen, a propósito, un formato reducido — hoy esa distinción no está declarada.

### A4 — Ambigüedad de nombres entre hojas del ERP marcadas "para eliminar" y nuevos destinos de sincronización con el mismo nombre

- **Ubicación**: Parte IV, §27 (clasifica "Clientes" y "Garantías" —artefactos de la migración histórica `llenarNuevoSheet`— en categoría 4, "puede eliminarse completamente") vs. §26.11 y §26.13 (describen sincronización activa de `GarantiaCreada` y `ClienteRegistrado` hacia hojas llamadas, respectivamente, "Garantías" y "Clientes / Usuarios").
- **Descripción**: el mismo nombre de hoja aparece simultáneamente como "a eliminar" (artefacto viejo sin datos reales) y como "destino activo de sincronización nueva" (repositorio histórico de la nueva plataforma). El documento nunca aclara explícitamente que son conceptos distintos que casualmente comparten nombre.
- **Por qué es un problema**: es precisamente el tipo de contradicción aparente que el encargo pidió cazar en la Parte IV. Un desarrollador (o quien administre las hojas de cálculo durante la migración) podría eliminar la hoja equivocada, o asumir que la hoja "Clientes" ya fue descartada y no crear el nuevo destino de sincronización.
- **Evidencia**: §27, fila "Clientes (artefacto de la migración histórica llenarNuevoSheet)" → "4. Puede eliminarse completamente"; §26.13, título "Clientes / Usuarios" → "También se copia a Google Sheets: datos de perfil no sensibles...".
- **Gravedad**: **ALTO**.
- **Recomendación**: diferenciar explícitamente (por ejemplo con nombres de hoja distintos, o con una nota aclaratoria en ambas secciones) la hoja heredada del ERP (a eliminar) de la nueva hoja histórica que GreatPhones debe alimentar.

### A5 — La frase "resuelto de forma nativa por el versionado transaccional de la base de datos" puede llevar a no construir el Backup de Operación que el propio roadmap exige

- **Ubicación**: Parte V, §29.12 (`OperacionAnulada`) vs. Parte III, §24 (Etapa 2 del roadmap: "implementar un mecanismo de snapshot/backup antes de cualquier borrado...") vs. Parte IV, §27 (fila "Backup de Operaciones": "queda cubierta... por el propio sistema transaccional y de versionado **que debe implementarse** dentro de GreatPhones").
- **Descripción**: una base de datos relacional (Postgres, la que usa GreatPhones) da atomicidad de transacciones, pero **no** da versionado histórico de filas de fábrica — eso requiere una tabla de historial explícita a construir (como ya hace `InventoryHistory` para inventario), tal como el propio §27 reconoce ("que debe implementarse"). El evento `OperacionAnulada` de la Parte V, en cambio, da a entender que este mecanismo ya está "resuelto de forma nativa".
- **Por qué es un problema**: es una contradicción entre dos partes del mismo documento sobre si el equivalente al Backup de Operación del ERP ya existe (gratis, por usar Postgres) o si es trabajo pendiente (Etapa 2). Podría llevar a que un equipo de desarrollo no construya esta capa, asumiendo que la base de datos ya la resuelve.
- **Evidencia**: cita textual de §29.12 ("ahora resuelto de forma nativa por el versionado transaccional de la base de datos") vs. cita textual de §27 ("que debe implementarse dentro de GreatPhones, Etapa 2").
- **Gravedad**: **ALTO**.
- **Recomendación**: unificar la redacción — el snapshot de "antes" de cualquier anulación es trabajo pendiente de la Etapa 2 del roadmap, no una propiedad gratuita de la base de datos elegida.

### A6 — La idempotencia del webhook de pago, ya documentada en la Parte II, no se repite como proceso inmediato del evento `VentaConfirmada`

- **Ubicación**: Parte II, §14.4 (Checkout: "el webhook de pago es idempotente: un mismo paymentId nunca se reprocesa") vs. Parte V, §29.4 (`VentaConfirmada`, campo "Procesos inmediatos").
- **Descripción**: el evento que, según el propio objetivo del documento, un desarrollador implementaría leyendo *solo* la Parte V no incluye la validación de duplicado entre sus procesos inmediatos, pese a que la Parte II ya advirtió que esa validación es necesaria.
- **Por qué es un problema**: riesgo real de duplicar asientos contables, garantías o comisiones si el mismo webhook de pago llega dos veces y el desarrollador solo tiene el catálogo de eventos delante (que es, explícitamente, el objetivo declarado de la Parte V — "que un desarrollador pueda implementar GreatPhones únicamente leyendo estos eventos").
- **Evidencia**: §29.4, lista de "Procesos inmediatos" no menciona verificación de pago duplicado.
- **Gravedad**: **ALTO**.
- **Recomendación**: agregar la validación de idempotencia como proceso inmediato explícito de `VentaConfirmada`.

### A7 — No existe un evento propio para el borrado físico de Pedidos ni de Conversaciones, pese a que ambos casos ya están señalados como riesgo

- **Ubicación**: Parte II, §17.6 ("GreatPhones permite borrado físico real de: pedidos... y conversaciones de chat completas") vs. Parte V, §29 (catálogo de eventos, que solo modela `ProductoEliminado`).
- **Descripción**: el riesgo de borrado físico sin red de seguridad de Pedidos y Conversaciones está correctamente señalado en la Parte II, pero el catálogo de eventos —que es donde un desarrollador buscaría el contrato de qué debe pasar exactamente ante cada hecho de negocio— no tiene ningún evento equivalente para estos dos casos.
- **Por qué es un problema**: sin un evento propio, no queda definido si estas operaciones deben auditarse, bloquearse cuando hay historial asociado, o permitirse libremente — exactamente el tipo de caso límite de producción que el encargo pidió señalar.
- **Evidencia**: ausencia de `PedidoEliminado`/`ConversacionEliminada` en el índice de §29.14.
- **Gravedad**: **ALTO**.
- **Recomendación**: agregar estos eventos al catálogo, o decidir explícitamente que el borrado físico de estas entidades queda prohibido en la nueva arquitectura (reemplazado por una anulación con motivo, siguiendo el mismo principio que ya rige para el resto del sistema).

### A8 — El capítulo 19 promete cubrir "TODOS los módulos de ambos sistemas" pero su tabla omite Garantías y Clientes del lado del ERP

- **Ubicación**: Parte III, §19 (encabezado: "Formato estandarizado para TODOS los módulos de ambos sistemas") vs. §19.1 (tabla de 24 filas que no incluye Garantías ni Clientes, pese a que ambos son secciones completas de la Parte I, §4.9 y §4.10).
- **Descripción**: la información sobre Garantías y Clientes del ERP no se perdió (está en Parte I §4.9/§4.10, y reaparece en §21 y §27), pero el capítulo que se presenta explícitamente como la referencia rápida de contrato por módulo no es autocontenido para estos dos casos.
- **Por qué es un problema**: si un desarrollador usa §19 como checklist de módulos a implementar (su propósito declarado), podría asumir erróneamente que Garantías y Clientes no requieren contrato propio del lado del ERP.
- **Evidencia**: conteo de filas de §19.1 vs. índice de subsecciones del capítulo 4 (26 módulos, de 4.1 a 4.26).
- **Gravedad**: **ALTO**.
- **Recomendación**: agregar las dos filas faltantes a §19.1, aun si su contenido es "N/A — brecha del ERP, ver §4.9/§4.10".

### A9 — Tres citas de regla de negocio no respaldan literalmente lo que el texto afirma que dicen

- **Ubicación**: Parte V, §28.4 (cita "Parte I §6.1 regla 8" para el principio "si la hoja del Libro Diario no existe, el sistema omite el registro contable pero no bloquea la operación"); Parte V, §29.5 `PreventaEntregada` (cita "regla 46" para "nunca cobra lo ya percibido en la preventa original"); Parte V, §29.7 `GastoRegistrado` (cita "regla 62" para "un asiento por cada medio de pago").
- **Descripción**: verificado contra el texto real de cada regla numerada: la regla 8 (§6.1) en realidad dice "todo movimiento de valor con múltiples medios de pago genera un asiento contable independiente por cada medio" — un tema distinto; el hecho citado en §28.4 en realidad vive en §10.1 (riesgo "Pérdida silenciosa de trazabilidad contable"). La regla 46 (§6.4) en realidad dice "si una preventa ya generó una venta previa... actualiza esa misma venta, nunca crea un duplicado" — no es sobre el tope de cobro (eso es la regla 44, correctamente citada en la misma sección). La regla 62 (§6.6) dice "el monto total de un gasto debe ser mayor a cero" — la regla real de "un asiento por medio" es la transversal §6.1 regla 8.
- **Por qué es un problema**: el comportamiento descrito en cada caso sigue siendo correcto en prosa — el problema es que la cita puntual no respalda literalmente la frase, y un desarrollador que vaya a verificar la referencia encontrará una regla que dice otra cosa, generando duda sobre si el comportamiento es real o mal recordado.
- **Evidencia**: comparación directa entre el texto citado y el texto real de cada regla numerada (detallada arriba).
- **Gravedad**: **ALTO** (por ser tres instancias concretas del mismo patrón, en una parte del documento pensada para lectura aislada por desarrolladores).
- **Recomendación**: revisar todas las citas de regla del catálogo de eventos contra el número real de cada regla antes de publicar la v1.0.

### A10 — Tratamiento desigual entre módulos "condicionados a decisión de negocio": Regalos Automáticos no tiene sección propia en el catálogo de eventos, a diferencia de Preventas e Inversores (misma clasificación de reutilización)

- **Ubicación**: Parte III, §22 (Preventas, Inversores y Regalos Automáticos reciben la misma clasificación, "REDISEÑAR", condicionados a etapas futuras del roadmap) vs. Parte V (Preventas e Inversores tienen secciones completas con diagrama en §29.5 y §29.8; Regalos Automáticos solo aparece como mención lateral dentro de `VentaConfirmada`, sin sección ni evento propio).
- **Descripción**: Regalos Automáticos tiene, en Parte I, un módulo completo con 5 reglas numeradas propias (§6.9, reglas 87-91) — pero ese detalle no se trasladó a un evento propio en la Parte V, a diferencia de sus dos pares con la misma clasificación de reutilización.
- **Por qué es un problema**: un desarrollador que llegue a la Etapa 8 del roadmap buscando el contrato completo de Regalos Automáticos en el catálogo de eventos (como encontró para Preventas e Inversores) no lo encontrará ahí.
- **Evidencia**: comparar la extensión de §29.5/§29.8 contra la ausencia de una sección equivalente para Regalos Automáticos en §29.
- **Gravedad**: **ALTO**.
- **Recomendación**: agregar una sección `RegaloAutomaticoEntregado` en el catálogo de eventos con el mismo nivel de detalle que Preventas/Inversores, o referenciar explícitamente que ese detalle vive solo en Parte I.

---

## Hallazgos MEDIOS

### M1 — La "pregunta abierta" sobre si el Dashboard administrativo de GreatPhones funciona ya tenía respuesta verificable en el código, y debería cerrarse

- **Ubicación**: Parte II, §14.11 y §17.9 (presentadas como evidencia contradictoria entre `render.js` y `admin.js`, recomendando "verificación operativa directa").
- **Descripción**: verificado contra el código: `index.html` carga primero `admin.js` y después `render.js`; ambos archivos declaran una función global del mismo nombre (`renderAdminContent`), y en JavaScript clásico la última declaración sobrescribe a la anterior en el ámbito global. La versión de `render.js` es la que efectivamente se ejecuta, y sí implementa Dashboard, Stock, Promociones y Cotizaciones completos; la versión de `admin.js` para esos mismos casos cae a un mensaje de "sección en desarrollo" y es, en la práctica, código muerto por sobrescritura.
- **Por qué es un problema**: el documento dejó como incierto algo que era resoluble con el mismo método de verificación (lectura de código) usado en el resto del documento, sin necesidad de abrir un navegador como la propia nota sugería.
- **Evidencia**: orden de las etiquetas `<script defer>` en `index.html`; declaración de `renderAdminContent` en ambos archivos.
- **Gravedad**: **MEDIO** (no bloquea la implementación, pero dejó una incertidumbre resoluble sin resolver).
- **Recomendación**: actualizar §14.11/§17.9 con la conclusión ya verificada: Dashboard, Stock, Promociones y Cotizaciones están funcionalmente activos en GreatPhones.

### M2 — El mensaje de confirmación que el ERP le muestra al operador al registrar una reparación sigue diciendo "Estado: 🔴 Ingresado", aunque el campo realmente guardado es otro

- **Ubicación**: Parte I, §3.4 y §10.1 (presentan el legado "Ingresado" como limitado a una opción seleccionable manualmente en el diálogo de actualización de estado).
- **Descripción**: verificado contra el código: el campo que efectivamente se guarda al registrar una reparación es "PARA DIAGNOSTICAR" o "PARA REPARAR", nunca "Ingresado" — consistente con lo que dice el documento. Pero el mensaje de confirmación visible para el operador inmediatamente después de registrar la reparación sigue mostrando textualmente "Estado: 🔴 Ingresado", un dato que no coincide con lo que el sistema efectivamente guardó.
- **Por qué es un problema**: el documento da a entender que el legado se limita al selector manual de actualización posterior; en realidad también persiste en el texto de confirmación de alta, lo cual es evidencia de un legado más profundo que lo documentado.
- **Evidencia**: Code.gs — el campo de estado se asigna como "PARA DIAGNOSTICAR"/"PARA REPARAR", pero el mensaje de retorno de la misma función sigue el texto fijo "Estado: 🔴 Ingresado".
- **Gravedad**: **MEDIO**.
- **Recomendación**: ampliar §3.4/§10.1 para reflejar que el remanente de "Ingresado" también aparece en el texto de confirmación de alta, no solo en el selector manual.

### M3 — El tipo de movimiento "AJUSTE" de Inversores no modifica ningún saldo, y el documento no aclara qué propósito de negocio cumple entonces

- **Ubicación**: Parte I, §3.8, §4.21, §5.8, §6.7 (reglas 71-76).
- **Descripción**: el diagrama de §5.8 indica correctamente que "AJUSTE" genera un asiento "NEUTRO" sin validación de tope, pero ni el diagrama ni el texto aclaran que, a diferencia de los otros tres tipos de movimiento, "AJUSTE" no actualiza ni el Capital Invertido ni el Pagado Total del inversor — verificado contra el código, ninguna de esas dos actualizaciones ocurre para este tipo.
- **Por qué es un problema**: queda ambiguo qué propósito de negocio cumple un movimiento que no cambia ningún saldo — es exactamente una "regla incompleta" del tipo que el encargo pidió señalar (punto 4).
- **Evidencia**: Code.gs — solo `INGRESO_CAPITAL`/`RETIRO_CAPITAL` actualizan el campo de capital; solo `PAGO_RENDIMIENTO` actualiza el campo de pagado; no hay rama de actualización para `AJUSTE`.
- **Gravedad**: **MEDIO**.
- **Recomendación**: el negocio debe aclarar el propósito real de un movimiento "AJUSTE" (¿corrección de un error de carga que sí debería tocar capital/pagado? ¿nota administrativa sin efecto en saldos, por diseño?) antes de que se decida cómo implementarlo en GreatPhones.

### M4 — El diagrama del evento `VentaConfirmada` incluye un paso ("Recalcular Reportes") que no aparece en los campos estructurados del mismo evento y que reintroduce ambigüedad sobre el estado real de "Reportes" en GreatPhones

- **Ubicación**: Parte V, §29.4 (diagrama Mermaid, nodo "Recalcular Reportes") vs. el propio texto de "Procesos en segundo plano" del mismo evento (que solo menciona Dashboard) vs. Parte II §13.3/§21 ("Reportes" en GreatPhones tiene cobertura mucho menor que en el ERP — solo `ProductLog` + exportación a Excel).
- **Descripción**: el diagrama parece un remanente copiado del diagrama equivalente del ERP (Parte I, §8) sin ajustar a lo que realmente existe hoy en GreatPhones.
- **Por qué es un problema**: es una inconsistencia dentro del propio evento (diagrama vs. texto) y, además, entra en tensión con lo ya documentado sobre las limitaciones reales de "Reportes" en la nueva plataforma.
- **Evidencia**: nodos del diagrama de §29.4 vs. lista de "Procesos en segundo plano" del mismo evento.
- **Gravedad**: **MEDIO**.
- **Recomendación**: quitar ese nodo del diagrama o aclarar que se refiere a la futura exportación periódica (§26.15), no a un recálculo en vivo que hoy no existe.

### M5 — No existe un evento propio para "Reportes" en el catálogo, pese a que la Parte I trata Dashboard y Reportes como módulos claramente separados

- **Ubicación**: Parte I, §4.16 vs §4.17 (Dashboard y Reportes como módulos distintos) vs. Parte V, §29.1 (solo existe `DashboardRecalculado` como evento derivado transversal).
- **Descripción**: "Reportes" aparece mencionado en diagramas y en la matriz de sincronización (§26.15, fusionado con Dashboard), pero nunca como evento propio.
- **Por qué es un problema**: relacionado con M4 — refuerza la ambigüedad sobre si Reportes, como concepto separado de Dashboard, sigue existiendo como tal en la arquitectura de eventos de GreatPhones.
- **Gravedad**: **MEDIO**.
- **Recomendación**: decidir si Reportes se funde conceptualmente en `DashboardRecalculado` (y decirlo explícitamente) o si merece su propio evento derivado.

### M6 — Los snapshots/cierres periódicos (Stock, Dashboard/Reportes, Comisiones) no tienen un evento correspondiente en el catálogo, pese a estar descritos en la matriz de sincronización

- **Ubicación**: Parte IV, §26.5 (Stock: snapshot diario/semanal), §26.15 (Dashboard/Reportes: snapshot mensual/semanal), §26.16 (Comisiones: al cierre de período) vs. Parte V, §29 (sin ningún evento tipo "cierre de período" o "snapshot periódico generado").
- **Descripción**: es un patrón que se repite tres veces en la matriz de sincronización sin que el catálogo de eventos lo modele como un hecho de negocio con contrato propio.
- **Por qué es un problema**: sin un evento nombrado, queda sin definir qué dispara exactamente cada snapshot (¿un proceso programado? ¿puede ejecutarse manualmente?) — un vacío de contrato para tres procesos distintos.
- **Gravedad**: **MEDIO**.
- **Recomendación**: agregar un evento transversal tipo `SnapshotPeriodicoGenerado` (para Stock y Dashboard/Reportes) y `PeriodoComisionesCerrado`.

### M7 — La distinción "evento primario vs. evento derivado" que el propio documento declara como regla de organización no se aplica de forma consistente en dos casos concretos

- **Ubicación**: Parte V, §28.2 (define que un evento derivado "nunca se dispara directamente por una acción humana") vs. §29.6 `PresupuestoDiagnosticoGenerado` y §29.9 `GarantiaCreada` (ambos descritos, en su propio texto, como "consecuencia directa" de otro evento — es decir, derivados por definición — pero documentados con el formato completo de evento primario de primer nivel, en vez de en §29.1 o simplemente referenciados).
- **Por qué es un problema**: rompe la distinción binaria que el propio documento estableció como principio de organización (§28.2), generando dudas sobre qué eventos tienen "entidad propia" de negocio y cuáles son efectos colaterales de otro evento.
- **Gravedad**: **MEDIO**.
- **Recomendación**: aclarar si existe una tercera categoría intermedia ("derivado pero con complejidad propia suficiente para documentarse aparte") o reubicar estos dos casos de forma coherente con la regla ya declarada.

### M8 — La tabla de contrato compacto de GreatPhones (§19.2) no tiene una fila separada para "Pedidos", perdiendo un detalle propio de la Parte II

- **Ubicación**: Parte III, §19.2 (Checkout/Orders fusiona el ciclo de vida de Pedidos) vs. Parte II, §14.5 ("el borrado físico de una orden no revierte stock ni genera auditoría" — dato que no se refleja en la columna "Errores esperables" de la fila fusionada).
- **Por qué es un problema**: mismo patrón que A8, con menor impacto porque Checkout y Pedidos son procesos muy relacionados y la fusión es defendible, pero se pierde un detalle de riesgo real.
- **Gravedad**: **MEDIO**.
- **Recomendación**: agregar una fila separada para Pedidos, o al menos incorporar la nota de riesgo del borrado físico a la fila fusionada existente.

### M9 — Modo de falla exacto de una de las dos rutas de borrado de Producto no verificado (depende de migraciones SQL no revisadas)

- **Ubicación**: Parte II, §14.2 y §17.6 (doble ruta de borrado de Producto con comportamiento distinto).
- **Descripción**: no se pudo confirmar, dentro del tiempo de esta auditoría, si el borrado de un producto con inventario vinculado falla con un error de base de datos o deja una referencia huérfana silenciosa, porque el comportamiento real depende de las migraciones SQL aplicadas, no solo del esquema declarado en `schema.prisma`.
- **Gravedad**: **MEDIO** (impacto potencial alto si el negocio decide unificar esta doble ruta sin antes conocer el comportamiento real de ambas).
- **Recomendación**: confirmar contra las migraciones reales de la base de datos antes de decidir cuál de las dos rutas de borrado se conserva.

### M10 — El diagrama de "Movimiento de Caja tipo Transferencia" del ERP (regla ya señalada como riesgo) no está reforzado con un ejemplo numérico, lo que puede generar dudas de implementación

- **Ubicación**: Parte I, §4.12 (riesgo documentado: "un movimiento manual de tipo TRANSFERENCIA se registra como INGRESO... sin egreso automático en el medio de origen").
- **Descripción**: el documento ya señala este comportamiento correctamente como una posible inconsistencia del ERP, pero no aclara si es (a) un defecto a no replicar en GreatPhones, o (b) una convención donde el operador debe cargar manualmente el lado negativo (mencionado como posibilidad en el propio texto, sin resolverla).
- **Gravedad**: **MEDIO** — no es una contradicción, es una ambigüedad ya parcialmente señalada que convendría cerrar con una decisión explícita antes de diseñar el Libro Diario de GreatPhones (Etapa 1 del roadmap).
- **Recomendación**: el negocio debe aclarar si este comportamiento del ERP es un defecto a corregir o una convención operativa a preservar en el nuevo Libro Diario.

---

## Hallazgos BAJOS

### B1 — Backtick de markdown sin cerrar en la fila "Comisiones" de la matriz de reutilización

- **Ubicación**: Parte III, §22, fila "Comisiones": *"que ya tiene `adminId` en cada `Order, lo cual facilita..."* — el segundo backtick que debería cerrar `Order` falta.
- **Por qué es un problema**: no es una cuestión de estilo sino un defecto de formato real: un backtick sin cerrar puede alterar el renderizado de las celdas de tabla siguientes en algunos visores de Markdown.
- **Gravedad**: **BAJO**.
- **Recomendación**: cerrar el backtick faltante.

### B2 — Los eventos `SincronizacionSheetsCompletada` y `SincronizacionSheetsFallida` se documentan fusionados en una sola entrada del catálogo

- **Ubicación**: Parte V, §29.1.
- **Descripción**: son dos eventos con nombres y semántica distintos (éxito vs. fallo) pero comparten un único bullet de definición, sin diferenciar qué información genera cada uno por separado.
- **Gravedad**: **BAJO** (no genera ambigüedad de comportamiento, solo de presentación).
- **Recomendación**: separarlos en dos entradas si se decide llevar el §29.1 al mismo nivel de detalle que los eventos primarios (ver hallazgo A3).

### B3 — Mecanismo de alerta ante fallo de sincronización mencionado en dos lugares sin definir a quién ni por qué canal

- **Ubicación**: Parte IV, §25.10 y Parte V, §29.1 (`SincronizacionSheetsFallida`).
- **Descripción**: ambos lugares coinciden en que debe generarse "una alerta operativa" ante un fallo de sincronización, sin definir destinatario, canal ni si hay reintento automático.
- **Por qué se clasifica como BAJO y no como pregunta pendiente de mayor gravedad**: el documento ya señala correctamente esto como algo a definir (no lo presenta como resuelto ni lo contradice en ningún lugar) — se incluye acá solo para que quede consolidado junto con el resto de decisiones pendientes de la siguiente sección.
- **Recomendación**: ver lista consolidada de decisiones de negocio pendientes, más abajo.

---

## Decisiones de negocio pendientes (consolidado, no son errores del documento)

El documento ya señala correctamente, en distintos capítulos, las siguientes preguntas como pendientes de decisión del negocio — no requieren corrección, solo se consolidan acá en un solo lugar para facilitar que el negocio las resuelva juntas antes de iniciar el desarrollo:

1. ¿Se sincroniza hacia Google Sheets el contenido completo de las conversaciones de chat, o solo sus metadatos? (Parte IV, §25.7)
2. ¿Las cotizaciones y arrepentimientos en estado "pendiente" (antes de resolverse) se sincronizan hacia Sheets, o solo una vez resueltos? (Parte IV, §26.10)
3. ¿Cuál es la frecuencia exacta de sincronización de Clientes, Stock y Dashboard/Reportes? (Parte IV, §26.5, §26.13, §26.15 — hoy dicen "a definir por el negocio")
4. ¿Qué efecto operativo tiene aprobar una Cotización de trade-in (pago inmediato al cliente, alta automática del equipo en inventario, ambos, o un proceso manual posterior)? (Parte II §14.7, Parte V §29.11)
5. ¿Se automatiza la extensión de garantía (hoy resuelta manualmente por chat) y el reembolso por arrepentimiento aprobado (hoy sin integración con la API de reembolsos de Mercado Pago)? (Parte II §17, Parte V §29.9/§29.10)
6. ¿A quién y por qué canal se alerta ante un fallo de sincronización hacia Google Sheets, y hay reintento automático? (Parte IV §25.10, Parte V §29.1)
7. ¿El comportamiento del ERP de registrar un movimiento de caja tipo "Transferencia" sin generar automáticamente el egreso del lado origen es un defecto a corregir o una convención a preservar? (Parte I §4.12 — ver hallazgo M10)
8. ¿Qué propósito de negocio real cumple un movimiento de inversor tipo "AJUSTE" que no modifica ningún saldo? (Parte I §4.21 — ver hallazgo M3)
9. ¿Debe Cotizaciones recalcular su precio final del lado del servidor (como Cambio de Moneda), o la revisión manual del administrador es la salvaguarda deliberada? (Parte II — ver hallazgo A2)

---

## Verificaciones que dieron resultado positivo (para que conste que se comprobaron, no se asumieron)

- Las cinco partes tratan la condicionalidad de Preventas, Inversores y Regalos Automáticos (todos "REDISEÑAR", condicionados a decisión de negocio) de forma consistente entre sí — ningún capítulo asume, en ningún punto, que ya existen en GreatPhones sin esa salvedad (salvo la asimetría de cobertura ya señalada en A10, que es de completitud, no de contradicción).
- El tratamiento de las tres duraciones de garantía (90 días / 12 meses / 6 meses) es consistente en las cinco partes: todas coinciden en que 90 días es el valor por defecto de GreatPhones, y la inconsistencia real entre las tres fuentes está señalada explícitamente una sola vez (Parte II, §17.2) y referenciada correctamente desde el roadmap, sin contradecirse en ningún otro lugar.
- El modelo `Sale` de GreatPhones se trata con la misma cautela ("posiblemente sin uso", "a confirmar") en las cuatro secciones donde se lo menciona — nunca se afirma categóricamente que esté en desuso ni que esté activo.
- El índice general del documento coincide exactamente, capítulo por capítulo, con los títulos reales del cuerpo — no se encontraron anclas rotas ni desajustes de orden.
- Ninguna hoja clasificada en categoría 3 o 4 en el capítulo 27 (Transacciones, Backup de Operaciones, Config, las cinco hojas CONFIG_*, TARIFARIO_ICARE, Lista de Precios, Toma de Equipos) aparece como destino operativo activo de sincronización en ningún evento del catálogo — la clasificación es internamente consistente con el resto del documento en este punto.
- No se encontró ninguna instancia, en la Parte IV ni en el catálogo completo de 43 eventos de la Parte V, donde la aplicación GreatPhones lea o dependa de información proveniente de Google Sheets — el principio "la base de datos es la única fuente de verdad" se sostiene sin excepciones detectadas en las ~35 entradas del catálogo primario ni en las 8 transversales.
- Se verificaron contra el texto real de la regla citada más de 20 referencias cruzadas del tipo "ver §X.Y" repartidas en las cinco partes, además de las tres reportadas como incorrectas en A9 — todas las demás citas de sección y de regla resultaron exactas.

---

## Veredicto final

> **Pregunta del encargo**: "¿Un equipo completamente nuevo podría implementar GreatPhones únicamente leyendo este documento?"

**Respuesta: SÍ, con un margen de calidad alto, condicionado a resolver primero los 2 hallazgos críticos y los 10 hallazgos altos de este informe — ninguno de los cuales es lo bastante grave como para invalidar el documento como base de una v1.0, pero todos son reales y accionables.**

Por qué la respuesta es afirmativa:

- El documento demuestra, de forma sostenida a lo largo de sus 3.885 líneas y sus cinco partes (escritas en momentos distintos de la conversación, lo cual hacía plausible encontrar mucha más deriva de la que efectivamente se encontró), una disciplina real de no inventar comportamiento: cada vez que algo no estaba confirmado, se lo señaló explícitamente como pregunta abierta, riesgo o duda documentada, en vez de rellenar el vacío con una suposición razonable pero no verificada. Los cuatro auditores independientes de este informe confirmaron este patrón sin excepción.
- La inmensa mayoría de las afirmaciones fuertes y verificables del documento (el bug de cancelación de Venta en Local, la ausencia total de Libro Diario/Caja en GreatPhones, las tres secciones de negocio desactivadas en el router, el modelo `Sale` sin referencias, la falta de vínculo estructural Accesorio↔Pedido, el campo `investor` sin lógica, y decenas más) se verificaron **exactas** contra el código real de ambos proyectos.
- Ninguna de las 25 observaciones de este informe representa información faltante que bloquee por completo la implementación de un módulo — son, en su gran mayoría, ambigüedades puntuales, citas de referencia desalineadas, o piezas del catálogo de eventos que no llegan al mismo nivel de detalle que el resto (particularmente los 8 eventos transversales del §29.1), todas resolubles con ediciones acotadas y sin necesidad de volver a analizar ningún código.

Por qué la respuesta no es un "sí" sin condiciones:

- Los dos hallazgos críticos (C1, C2) son contradicciones reales entre lo que el documento afirma como principio general del ERP y lo que describe como su mecanismo concreto — si un desarrollador implementa el nuevo Libro Diario de GreatPhones tomando literalmente la promesa de "reconstrucción íntegra" o la afirmación de "Reportes siempre se actualiza tras cada venta", replicaría un comportamiento que el propio ERP real no tiene.
- Varios hallazgos altos (A3, A6, A7, A9, A10) están concentrados específicamente en la Parte V (el catálogo de eventos), que es, por diseño, la parte que el documento presenta como la más autosuficiente ("que un desarrollador pueda implementar GreatPhones únicamente leyendo estos eventos, sin necesidad de estudiar el ERP original"). Es razonable que esa sea la vara más alta de exigencia, y hoy no la alcanza en el 100% de sus 43 entradas.

En síntesis: el documento **no necesita reescribirse ni resumirse** — necesita una pasada de corrección acotada sobre 12 puntos concretos (2 críticos + 10 altos) antes de fijarse como v1.0 oficial. El resto (10 medios y 3 bajos) puede resolverse en una revisión posterior sin que eso demore el inicio del desarrollo.
