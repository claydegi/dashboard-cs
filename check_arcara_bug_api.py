#!/usr/bin/env python3
"""
Verifica TUTTI gli iscritti Arcara con watching time (via API, senza limite)
"""
import requests
from collections import defaultdict

DASHBOARD_URL = "https://dashboard-cs-production.up.railway.app"
ADMIN_KEY = "<ADMIN_KEY_STORICA_RIMOSSA>"

print("1. Recupero tutti gli iscritti Arcara...")
resp = requests.get(
    f"{DASHBOARD_URL}/api/webinar/registrants",
    params={"key": ADMIN_KEY, "tag": "WEBINAR_ARCARA_ELEVATE"},
    timeout=60
)
resp.raise_for_status()
iscritti = resp.json().get('registrants', [])
print(f"   Trovati {len(iscritti)} iscritti\n")

print("2. Recupero TUTTI i video tracking...")
resp2 = requests.get(
    f"{DASHBOARD_URL}/api/video-tracking",
    params={"key": ADMIN_KEY},
    timeout=120
)
resp2.raise_for_status()
all_tracking = resp2.json()
print(f"   Trovati {len(all_tracking)} eventi di tracking\n")

# Aggrega per email: max secondi_visti
tracking_by_email = defaultdict(int)
for t in all_tracking:
    email = (t.get('email') or '').lower()
    sec = t.get('secondi_visti', 0)
    if sec > tracking_by_email[email]:
        tracking_by_email[email] = sec

# Arricchisci iscritti con watching time
for r in iscritti:
    email = (r.get('email') or '').lower()
    r['max_sec'] = tracking_by_email.get(email, 0)

print(f"=== WEBINAR ARCARA - ANALISI COMPLETA ===\n")
print(f"Totale iscritti: {len(iscritti)}\n")

con_video = [r for r in iscritti if r['max_sec'] > 0]
senza_video = len(iscritti) - len(con_video)

print(f"Iscritti con watching time > 0: {len(con_video)}")
print(f"Iscritti senza watching time: {senza_video}\n")

if con_video:
    print("DETTAGLIO ISCRITTI CON WATCHING TIME ERRATO:")
    print("-" * 90)
    # Ordina per secondi decrescente
    con_video_sorted = sorted(con_video, key=lambda x: x['max_sec'], reverse=True)
    for r in con_video_sorted:
        nome = f"{r.get('cognome', '')} {r.get('nome', '')}".strip()
        email = r.get('email', '')
        sec = r['max_sec']
        min_tot = sec // 60
        print(f"  {nome:30} {email:35} {min_tot:3} min ({sec}s)")
else:
    print("✅ Nessun iscritto con watching time")

print("\n" + "=" * 90)
percentuale = (len(con_video) * 100 // len(iscritti)) if iscritti else 0
print(f"\n💡 IMPATTO BUG: {len(con_video)}/{len(iscritti)} iscritti ({percentuale}%) mostrano watching time errato")
