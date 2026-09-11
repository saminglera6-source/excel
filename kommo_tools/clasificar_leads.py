"""
clasificar_leads.py — Limpieza asistida por IA de leads viejos en Kommo (GreatPhones).

Qué hace:
  1. Trae los leads de una etapa de un pipeline (ej: "Nuevo contacto") que
     llevan más de N días sin actividad.
  2. Para cada uno, baja su historial de conversación de Kommo.
  3. Le pasa ese texto a Claude para clasificarlo en:
       - VENTA_PERDIDA_CLARA  (cliente dijo explícitamente que no)
       - SILENCIO_TRAS_CONSULTA (preguntó y dejó de contestar)
       - AMBIGUO              (no se toca, se reporta para revisión humana)
  4. Si corresponde, mueve el lead a la etapa "Venta Perdida" con el motivo
     de pérdida que más se ajuste (o lo deja intacto si es AMBIGUO).

MUY IMPORTANTE — LEER ANTES DE USAR:
  La API pública de Kommo no siempre expone el texto completo de los chats
  de la misma forma en todas las cuentas (depende del canal — WhatsApp
  Cloud API, Instagram — y de cómo esté configurada la integración). Por
  eso este script SIEMPRE arranca en modo diagnóstico: antes de tocar nada,
  bajá el historial de 2-3 leads de prueba y mostralo crudo, para confirmar
  que el texto de los mensajes realmente viene en la respuesta antes de
  correr la clasificación sobre los 211 leads.

Modos de uso (ver también README.md):
  python clasificar_leads.py --diagnostico 3
      Baja el historial crudo de 3 leads de la etapa configurada y lo
      imprime tal cual lo devuelve Kommo. No escribe nada. Usalo primero.

  python clasificar_leads.py --dry-run
      Corre la clasificación completa (lee + le pregunta a Claude) pero
      NO mueve ningún lead en Kommo. Te muestra qué haría.

  python clasificar_leads.py --ejecutar
      Corre la clasificación y esta vez SÍ mueve los leads que clasificó
      como VENTA_PERDIDA_CLARA o SILENCIO_TRAS_CONSULTA. Va parando cada
      15 leads a pedir confirmación (Enter para seguir, "n" para cortar).
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta

import requests
from dotenv import load_dotenv

load_dotenv()

KOMMO_SUBDOMINIO = os.getenv("KOMMO_SUBDOMINIO", "").strip()
KOMMO_TOKEN = os.getenv("KOMMO_TOKEN", "").strip()
KOMMO_PIPELINE_NOMBRE = os.getenv("KOMMO_PIPELINE", "Embudo de ventas").strip()
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()

ETAPA_ORIGEN = "Nuevo contacto"
ETAPA_DESTINO_PERDIDA = "Venta Perdida"
DIAS_MIN_INACTIVIDAD = 7
TAMANO_LOTE = 15

MOTIVOS_VALIDOS = [
    "Precio muy alto",
    "Consiguió en otro lado",
    "Se arrepintió",
    "Dejó de responder",
    "No había stock del modelo",
]

BASE_URL = f"https://{KOMMO_SUBDOMINIO}.kommo.com/api/v4"


def _chequear_config():
    faltantes = [n for n, v in [
        ("KOMMO_SUBDOMINIO", KOMMO_SUBDOMINIO),
        ("KOMMO_TOKEN", KOMMO_TOKEN),
    ] if not v]
    if faltantes:
        sys.exit(f"❌ Falta configurar en .env: {', '.join(faltantes)}. Ver .env.example.")


def kommo_get(path, params=None):
    r = requests.get(f"{BASE_URL}{path}", headers={"Authorization": f"Bearer {KOMMO_TOKEN}"}, params=params or {})
    if r.status_code == 204:
        return {}
    r.raise_for_status()
    return r.json()


def kommo_patch(path, body):
    r = requests.patch(f"{BASE_URL}{path}", headers={
        "Authorization": f"Bearer {KOMMO_TOKEN}",
        "Content-Type": "application/json",
    }, json=body)
    r.raise_for_status()
    return r.json() if r.text else {}


def obtener_pipeline_y_etapas():
    """Devuelve (pipeline_id, {nombre_etapa: status_id}) del pipeline configurado."""
    data = kommo_get("/leads/pipelines")
    for p in data.get("_embedded", {}).get("pipelines", []):
        if p["name"].strip().lower() == KOMMO_PIPELINE_NOMBRE.strip().lower():
            etapas = {s["name"]: s["id"] for s in p.get("_embedded", {}).get("statuses", [])}
            return p["id"], etapas
    sys.exit(f"❌ No encontré el pipeline \"{KOMMO_PIPELINE_NOMBRE}\" en tu cuenta Kommo.")


def obtener_motivos_perdida():
    """Devuelve {nombre_motivo: id}. Si un motivo de MOTIVOS_VALIDOS no existe en Kommo, se avisa."""
    data = kommo_get("/leads/loss_reasons")
    existentes = {m["name"]: m["id"] for m in data.get("_embedded", {}).get("loss_reasons", [])}
    faltantes = [m for m in MOTIVOS_VALIDOS if m not in existentes]
    if faltantes:
        print(f"⚠️  Estos motivos de pérdida no existen en Kommo (creálos en Ajustes -> Motivos de pérdida): {faltantes}")
    return existentes


def obtener_leads_viejos(pipeline_id, status_id, dias_min):
    """Pagina /leads filtrando por etapa y última actividad más vieja que `dias_min`."""
    limite_ts = int((datetime.now() - timedelta(days=dias_min)).timestamp())
    leads = []
    page = 1
    while True:
        data = kommo_get("/leads", params={
            "filter[pipeline_id]": pipeline_id,
            "filter[statuses][0][pipeline_id]": pipeline_id,
            "filter[statuses][0][status_id]": status_id,
            "filter[updated_at][to]": limite_ts,
            "page": page,
            "limit": 250,
        })
        embebidos = data.get("_embedded", {}).get("leads", [])
        if not embebidos:
            break
        leads.extend(embebidos)
        if "next" not in data.get("_links", {}):
            break
        page += 1
        time.sleep(0.2)  # cuidar el rate limit de Kommo (~7 req/s)
    return leads


def obtener_notas_lead(lead_id):
    """Trae TODAS las notas/eventos de un lead (paginado). Acá vive (si tu cuenta lo expone)
    el texto de los mensajes — confirmalo primero con --diagnostico antes de confiar en esto."""
    notas = []
    page = 1
    while True:
        data = kommo_get(f"/leads/{lead_id}/notes", params={"page": page, "limit": 50})
        embebidas = data.get("_embedded", {}).get("notes", [])
        if not embebidas:
            break
        notas.extend(embebidas)
        if "next" not in data.get("_links", {}):
            break
        page += 1
        time.sleep(0.2)
    return notas


def extraer_texto_conversacion(notas):
    """Intenta armar un texto legible de la conversación a partir de las notas.
    Best-effort: los campos exactos dependen de tu cuenta/canal — si el modo
    --diagnostico te muestra una estructura distinta, ajustá esta función."""
    lineas = []
    for n in sorted(notas, key=lambda x: x.get("created_at", 0)):
        texto = (n.get("params", {}) or {}).get("text")
        if not texto:
            continue
        origen = "CLIENTE" if (n.get("params", {}) or {}).get("origin") == "incoming" else "NEGOCIO"
        lineas.append(f"[{origen}] {texto}")
    return "\n".join(lineas)


def modo_diagnostico(cantidad, pipeline_id, status_id):
    print(f"🔍 Modo diagnóstico — bajando {cantidad} lead(s) de \"{ETAPA_ORIGEN}\" tal cual los devuelve Kommo.\n")
    leads = obtener_leads_viejos(pipeline_id, status_id, DIAS_MIN_INACTIVIDAD)[:cantidad]
    if not leads:
        print("No encontré leads viejos en esa etapa con el corte de días configurado.")
        return
    for lead in leads:
        print("=" * 70)
        print(f"Lead #{lead['id']} — {lead.get('name')}")
        notas = obtener_notas_lead(lead["id"])
        print(f"Cantidad de notas/eventos encontrados: {len(notas)}")
        print("Primeras notas en crudo (para ver qué campos trae tu cuenta):")
        print(json.dumps(notas[:5], indent=2, ensure_ascii=False))
        print("\nTexto que extraería extraer_texto_conversacion() con la lógica actual:")
        print(extraer_texto_conversacion(notas) or "(nada — hay que ajustar extraer_texto_conversacion())")
        print()


def clasificar_con_ia(texto_conversacion, cliente_nombre):
    from anthropic import Anthropic
    if not ANTHROPIC_API_KEY:
        sys.exit("❌ Falta ANTHROPIC_API_KEY en .env")
    client = Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = f"""Sos un clasificador de leads para una casa de venta de celulares usados (GreatPhones). \
Te paso la conversación completa con un cliente ({cliente_nombre}) que lleva más de {DIAS_MIN_INACTIVIDAD} días sin ninguna actividad.

Clasificala en EXACTAMENTE una de estas 3 categorías:
- VENTA_PERDIDA_CLARA: el cliente dijo explícitamente que no le interesa, que ya compró en otro lado, que el precio le pareció muy alto, o algo equivalente.
- SILENCIO_TRAS_CONSULTA: preguntó stock, modelo o precio, se le respondió, y no volvió a escribir nada más.
- AMBIGUO: cualquier caso donde no sea claro si sigue interesado, quedó a mitad de una negociación real, prometió volver a escribir, o hay duda razonable.

Si la categoría es VENTA_PERDIDA_CLARA o SILENCIO_TRAS_CONSULTA, elegí también el motivo más ajustado de esta lista EXACTA: {MOTIVOS_VALIDOS}. Si no hay información suficiente para un motivo específico, usá "Dejó de responder".

Conversación:
---
{texto_conversacion or "(sin mensajes de texto disponibles)"}
---

Respondé SOLO con un JSON válido, sin texto alrededor, con este formato exacto:
{{"categoria": "...", "motivo": "..." o null, "resumen": "una línea explicando por qué"}}"""

    resp = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}],
    )
    texto = resp.content[0].text.strip()
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        return {"categoria": "AMBIGUO", "motivo": None, "resumen": f"No se pudo parsear la respuesta de la IA: {texto[:200]}"}


def mover_a_perdida(lead_id, status_id_perdida, motivo_id):
    body = {"status_id": status_id_perdida}
    if motivo_id:
        body["loss_reason_id"] = motivo_id
    kommo_patch(f"/leads/{lead_id}", body)


def correr_clasificacion(ejecutar, pipeline_id, etapas, motivos):
    status_origen = etapas[ETAPA_ORIGEN]
    status_perdida = etapas[ETAPA_DESTINO_PERDIDA]

    leads = obtener_leads_viejos(pipeline_id, status_origen, DIAS_MIN_INACTIVIDAD)
    print(f"📋 {len(leads)} lead(s) en \"{ETAPA_ORIGEN}\" con más de {DIAS_MIN_INACTIVIDAD} días de inactividad.\n")

    resumen_motivos = {}
    ambiguos = []

    for i, lead in enumerate(leads, start=1):
        notas = obtener_notas_lead(lead["id"])
        texto = extraer_texto_conversacion(notas)
        resultado = clasificar_con_ia(texto, lead.get("name") or f"Lead #{lead['id']}")

        categoria = resultado.get("categoria")
        motivo = resultado.get("motivo")
        resumen = resultado.get("resumen", "")

        if categoria in ("VENTA_PERDIDA_CLARA", "SILENCIO_TRAS_CONSULTA"):
            motivo_final = motivo if motivo in MOTIVOS_VALIDOS else "Dejó de responder"
            print(f"  [{i}/{len(leads)}] Lead #{lead['id']} \"{lead.get('name')}\" → VENTA PERDIDA ({motivo_final}) — {resumen}")
            resumen_motivos[motivo_final] = resumen_motivos.get(motivo_final, 0) + 1
            if ejecutar:
                mover_a_perdida(lead["id"], status_perdida, motivos.get(motivo_final))
        else:
            print(f"  [{i}/{len(leads)}] Lead #{lead['id']} \"{lead.get('name')}\" → AMBIGUO — {resumen}")
            ambiguos.append((lead["id"], lead.get("name"), resumen))

        if ejecutar and i % TAMANO_LOTE == 0 and i < len(leads):
            print(f"\n⏸  Van {i} leads procesados. Enter para seguir con el próximo lote, o 'n' + Enter para cortar acá.")
            if input().strip().lower() == "n":
                break

        time.sleep(0.3)  # cuidar rate limit + no saturar la API de Claude

    print("\n" + "=" * 70)
    print("RESUMEN FINAL")
    print("=" * 70)
    for motivo, cant in resumen_motivos.items():
        print(f"  {motivo}: {cant}")
    print(f"\n  AMBIGUOS (sin tocar, revisar a mano): {len(ambiguos)}")
    for lead_id, nombre, resumen in ambiguos:
        print(f"    - Lead #{lead_id} \"{nombre}\": {resumen}")

    if not ejecutar:
        print("\n(Este fue un --dry-run: no se movió ningún lead en Kommo todavía.)")


def main():
    _chequear_config()
    parser = argparse.ArgumentParser()
    parser.add_argument("--diagnostico", type=int, metavar="N", help="Bajar N leads en crudo y mostrar la estructura, sin clasificar ni escribir nada.")
    parser.add_argument("--dry-run", action="store_true", help="Clasificar y mostrar el resultado, sin mover nada en Kommo.")
    parser.add_argument("--ejecutar", action="store_true", help="Clasificar Y mover los leads que correspondan en Kommo.")
    args = parser.parse_args()

    if not any([args.diagnostico, args.dry_run, args.ejecutar]):
        parser.print_help()
        sys.exit(1)

    pipeline_id, etapas = obtener_pipeline_y_etapas()
    for nombre in (ETAPA_ORIGEN, ETAPA_DESTINO_PERDIDA):
        if nombre not in etapas:
            sys.exit(f"❌ No encontré la etapa \"{nombre}\" en el pipeline \"{KOMMO_PIPELINE_NOMBRE}\".")

    if args.diagnostico:
        modo_diagnostico(args.diagnostico, pipeline_id, etapas[ETAPA_ORIGEN])
        return

    motivos = obtener_motivos_perdida()
    correr_clasificacion(ejecutar=args.ejecutar, pipeline_id=pipeline_id, etapas=etapas, motivos=motivos)


if __name__ == "__main__":
    main()
