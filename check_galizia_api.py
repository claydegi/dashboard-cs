#!/usr/bin/env python3
"""
Script per verificare i dati video di Galizia tramite API Dashboard CS
"""
import requests
import json

# Config
DASHBOARD_URL = "https://dashboard-cs-production.up.railway.app"
ADMIN_KEY = "chiave-segreta-admin-2024"
GALIZIA_EMAIL = "cesaregalizia@gmail.com"

def get_video_tracking(campagna=None):
    """Recupera dati video tracking"""
    url = f"{DASHBOARD_URL}/api/video-tracking"
    params = {"key": ADMIN_KEY}
    if campagna:
        params["campagna"] = campagna

    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()

def get_contatto_dettagli(contatto_id):
    """Recupera dettagli contatto"""
    url = f"{DASHBOARD_URL}/api/crm/contatti/{contatto_id}"
    params = {"key": ADMIN_KEY}

    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()

print("=== VERIFICA DATI VIDEO GALIZIA ===\n")

# 1. Video tracking per campagna PT1 Malavasi
print("1. VIDEO TRACKING PT1_SF_WEBINAR_MALAVASI_REC:")
print("-" * 60)
try:
    data = get_video_tracking("PT1_SF_WEBINAR_MALAVASI_REC")

    # L'API ritorna una lista diretta, non un oggetto
    if not isinstance(data, list):
        print(f"Formato inatteso: {type(data)}")
        print(json.dumps(data, indent=2, ensure_ascii=False, default=str))
    else:
        # Filtra per Galizia
        galizia_events = [e for e in data if e.get('email') == GALIZIA_EMAIL]

        print(f"Totale eventi Galizia: {len(galizia_events)}")
        if galizia_events:
            print(json.dumps(galizia_events, indent=2, ensure_ascii=False, default=str))
        else:
            print("Nessun evento trovato per Galizia.")
            print(f"\nTotale eventi campagna: {len(data)}")
            if data:
                print(f"Esempio primo evento: {json.dumps(data[0], indent=2, ensure_ascii=False, default=str)}")

except Exception as e:
    print(f"Errore: {e}")
    import traceback
    traceback.print_exc()

print("\n=== FINE VERIFICA ===")
