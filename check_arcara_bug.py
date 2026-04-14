#!/usr/bin/env python3
"""
Verifica quanti iscritti al webinar Arcara hanno watching time errato
"""
import requests
import json

DASHBOARD_URL = "https://dashboard-cs-production.up.railway.app"
ADMIN_KEY = "chiave-segreta-admin-2024"

# 1. Recupera TUTTI gli iscritti (senza limite)
resp1 = requests.get(
    f"{DASHBOARD_URL}/api/webinar/registrants",
    params={"key": ADMIN_KEY, "tag": "WEBINAR_ARCARA_ELEVATE"},
    timeout=30
)
resp1.raise_for_status()
data1 = resp1.json()
all_registrants = data1.get('registrants', [])

# 2. Recupera watching time da video tracking per ogni email
registrants = []
for r in all_registrants:
    email = r.get('email', '').lower()

    # Query video tracking per questa email
    resp2 = requests.get(
        f"{DASHBOARD_URL}/api/video-tracking",
        params={"key": ADMIN_KEY},
        timeout=30
    )
    resp2.raise_for_status()
    tracking = resp2.json()

    # Filtra per email e trova max secondi
    user_tracking = [t for t in tracking if t.get('email', '').lower() == email]
    max_sec = max([t.get('secondi_visti', 0) for t in user_tracking], default=0)

    r['max_sec'] = max_sec
    registrants.append(r)

    # Solo per evitare troppe chiamate, prendi solo i primi 220
    if len(registrants) >= 220:
        break

print(f"=== WEBINAR ARCARA - ANALISI WATCHING TIME ===\n")
print(f"Totale iscritti: {len(registrants)}")

# Conta chi ha watching time > 0
con_video = [r for r in registrants if r.get('max_sec', 0) > 0]

print(f"Iscritti con watching time > 0: {len(con_video)}")
print(f"Iscritti senza watching time: {len(registrants) - len(con_video)}\n")

if con_video:
    print("DETTAGLIO ISCRITTI CON WATCHING TIME ERRATO:")
    print("-" * 80)
    for r in con_video:
        nome = f"{r.get('cognome', '')} {r.get('nome', '')}".strip()
        email = r.get('email', '')
        sec = r.get('max_sec', 0)
        min_tot = sec // 60
        print(f"  {nome:30} {email:35} {min_tot:3} min ({sec}s)")
else:
    print("✅ Nessun iscritto con watching time (corretto per webinar futuro)")

print("\n" + "=" * 80)
