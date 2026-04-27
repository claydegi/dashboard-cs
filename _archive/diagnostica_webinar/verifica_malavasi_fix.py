#!/usr/bin/env python3
"""
Verifica che il webinar Malavasi mostri ancora correttamente i watching time DOPO il fix
"""
import requests
from collections import defaultdict

DASHBOARD_URL = "https://dashboard-cs-production.up.railway.app"
ADMIN_KEY = "<ADMIN_KEY_STORICA_RIMOSSA>"

print("=== VERIFICA WEBINAR MALAVASI DOPO FIX ===\n")

# Test 1: Galizia dovrebbe avere 40 min nel webinar Malavasi
print("1. Test Galizia su webinar Malavasi (dovrebbe avere ~40 min)...")
resp = requests.get(
    f"{DASHBOARD_URL}/api/webinar/registrants/latest",
    params={"key": ADMIN_KEY, "tag": "WEBINAR_MALAVASI_PT1", "limit": 50},
    timeout=60
)
resp.raise_for_status()
registrants_malavasi = resp.json().get('registrants', [])

galizia_malavasi = [r for r in registrants_malavasi if 'galizia' in r.get('email', '').lower()]
if galizia_malavasi:
    r = galizia_malavasi[0]
    sec = r.get('max_sec', 0)
    min_tot = sec // 60
    print(f"   [OK] Galizia trovato: {min_tot} min ({sec}s)")
    if sec >= 2400:  # ~40 min
        print(f"   [SUCCESS] Watching time corretto\n")
    else:
        print(f"   [ERROR] Watching time troppo basso (atteso ~2415s)\n")
else:
    print(f"   [WARNING] Galizia non trovato negli ultimi 50 iscritti Malavasi\n")

# Test 2: Confronta con webinar Arcara (Galizia dovrebbe avere 0 min)
print("2. Test Galizia su webinar Arcara (dovrebbe avere 0 min)...")
resp2 = requests.get(
    f"{DASHBOARD_URL}/api/webinar/registrants/latest",
    params={"key": ADMIN_KEY, "tag": "WEBINAR_ARCARA_ELEVATE", "limit": 50},
    timeout=60
)
resp2.raise_for_status()
registrants_arcara = resp2.json().get('registrants', [])

galizia_arcara = [r for r in registrants_arcara if 'galizia' in r.get('email', '').lower()]
if galizia_arcara:
    r = galizia_arcara[0]
    sec = r.get('max_sec', 0)
    min_tot = sec // 60
    print(f"   [OK] Galizia trovato: {min_tot} min ({sec}s)")
    if sec == 0:
        print(f"   [SUCCESS] Watching time correttamente a zero\n")
    else:
        print(f"   [ERROR] Watching time ancora presente (dovrebbe essere 0)\n")
else:
    print(f"   [WARNING] Galizia non trovato negli ultimi 50 iscritti Arcara\n")

# Test 3: Statistiche globali
print("3. Statistiche watching time Malavasi...")
con_video = [r for r in registrants_malavasi if r.get('max_sec', 0) > 0]
print(f"   Iscritti negli ultimi 50 con watching time > 0: {len(con_video)}/{len(registrants_malavasi)}")

if con_video:
    max_watching = max([r.get('max_sec', 0) for r in con_video])
    max_min = max_watching // 60
    print(f"   Max watching time: {max_min} min ({max_watching}s)\n")

print("=" * 70)
print("\n[RIEPILOGO]")
print("   - Se Galizia ha ~40 min su Malavasi -> fix OK")
print("   - Se Galizia ha 0 min su Arcara -> fix OK")
print("   - Se entrambi corretti -> fix applicato con successo")
