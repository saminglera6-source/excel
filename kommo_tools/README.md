# Clasificador de leads viejos (Kommo + IA)

Script para revisar los leads viejos de "Nuevo contacto" (más de 7 días sin
actividad) y clasificarlos automáticamente con IA en:

- **Venta perdida clara** → se mueve a "Venta Perdida" con el motivo que corresponda.
- **Silencio tras consulta** → se mueve a "Venta Perdida" (motivo "Dejó de responder" salvo que la IA identifique otro más específico).
- **Ambiguo** → NO se toca, queda listado para que lo revises vos a mano.

No corre solo ni queda programado — lo ejecutás vos cuando quieras desde tu computadora.

## 1. Instalación (una sola vez)

Necesitás Python 3.9 o más nuevo instalado. Después, desde esta carpeta (`kommo_tools`):

```bash
python -m venv venv
source venv/bin/activate        # en Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Conseguir el token de Kommo

1. Entrá a tu cuenta Kommo → **Ajustes** (ícono de engranaje) → **Integraciones**.
2. Hacé clic en **Crear integración** → elegí **Privada**.
3. Poné cualquier nombre (ej: "Script clasificador").
4. Andá a la pestaña **Claves y accesos** de esa integración recién creada.
5. Generá el **token de acceso de larga duración** (long-lived token, dura ~1 año) — NO el flujo de OAuth con "código de autorización", ese es para apps públicas y expira en minutos. Buscá específicamente la opción de token de larga duración.
6. Copiá ese token — es un texto largo.

## 3. Conseguir la clave de Claude (Anthropic)

1. Entrá a [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys).
2. Creá una API key nueva y copiala (esto tiene un costo por uso, muy bajo para clasificar texto — cada lead cuesta centavos de dólar).

## 4. Configurar

Copiá `.env.example` a `.env` (mismo lugar, sacando el ".example") y completá:

```
KOMMO_SUBDOMINIO=lolaso
KOMMO_TOKEN=el-token-larguisimo-que-copiaste
KOMMO_PIPELINE=Embudo de ventas
ANTHROPIC_API_KEY=tu-clave-de-anthropic
```

**El archivo `.env` nunca se sube a git** (ya está en `.gitignore`) — ahí quedan tus claves, solo en tu computadora.

## 5. Uso — SIEMPRE en este orden

### Paso 1 — Diagnóstico (obligatorio la primera vez)

```bash
python clasificar_leads.py --diagnostico 3
```

Esto baja 3 leads de prueba y te muestra EXACTAMENTE qué información devuelve
tu cuenta de Kommo sobre sus conversaciones. Kommo no expone el texto de los
chats de la misma forma en todas las cuentas — puede que la API devuelva el
texto de los mensajes directo, o puede que solo devuelva metadata sin el
contenido (depende de cómo esté conectado WhatsApp/Instagram).

**Revisá el resultado**: si al final de cada lead ves texto real de la
conversación, seguís al Paso 2 tal cual. Si ves "(nada — hay que ajustar
extraer_texto_conversacion())", mandame ese JSON crudo que te imprimió y
ajusto la función `extraer_texto_conversacion()` del script para que lea la
estructura real de tu cuenta.

### Paso 2 — Prueba en seco (dry-run)

```bash
python clasificar_leads.py --dry-run
```

Corre la clasificación completa con IA y te muestra qué haría con cada lead
(a qué categoría lo mandó y por qué), pero **no mueve nada en Kommo todavía**.
Revisá el resumen final, en particular la lista de "AMBIGUOS".

### Paso 3 — Ejecutar de verdad

```bash
python clasificar_leads.py --ejecutar
```

Igual que el dry-run, pero esta vez SÍ mueve los leads a "Venta Perdida" con
su motivo. Se detiene cada 15 leads y te pregunta si seguís (Enter) o cortás
("n" + Enter) — así podés parar en cualquier momento si algo no te convence.

## Qué NO hace este script

- No toca leads con actividad de menos de 7 días.
- No mueve nada a "Venta cerrada" ni "A pedido - esperando llegada" — esas
  etapas siempre las movés vos a mano, cuando la venta ya está confirmada.
- No borra ningún lead, solo los mueve de etapa.
- No corre solo ni queda programado en ningún servidor — es 100% manual,
  vos decidís cuándo ejecutarlo.

## Si querés cambiar algo

Al principio de `clasificar_leads.py` están estas constantes, todas juntas:

```python
ETAPA_ORIGEN = "Nuevo contacto"
ETAPA_DESTINO_PERDIDA = "Venta Perdida"
DIAS_MIN_INACTIVIDAD = 7
TAMANO_LOTE = 15
MOTIVOS_VALIDOS = [...]
```

Cambiá cualquiera de esos valores (por ejemplo `DIAS_MIN_INACTIVIDAD = 10`) sin
tocar el resto del código.
