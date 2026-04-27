#!/usr/bin/env python3
"""
Verifica TUTTI gli iscritti al webinar Arcara con watching time errato (query diretta PostgreSQL)
"""
import os
import psycopg2

DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    print("Errore: DATABASE_URL non configurato")
    print("Eseguire con: set DATABASE_URL=... && python check_arcara_bug_full.py")
    exit(1)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

# Query: tutti gli iscritti Arcara con watching time aggregato (senza filtro campagna, come fa il backend buggato)
cur.execute("""
    SELECT r.nome, r.cognome, r.email,
           COALESCE(MAX(vt.secondi_visti), 0) AS max_sec
    FROM crm_webinar_registrazioni r
    LEFT JOIN crm_video_tracking vt ON LOWER(vt.email) = LOWER(r.email)
    WHERE r.webinar_tag = 'WEBINAR_ARCARA_ELEVATE'
    GROUP BY r.nome, r.cognome, r.email
    ORDER BY max_sec DESC, r.email
""")

rows = cur.fetchall()
conn.close()

print(f"=== WEBINAR ARCARA - ANALISI COMPLETA WATCHING TIME ===\n")
print(f"Totale iscritti: {len(rows)}\n")

con_video = [r for r in rows if r[3] > 0]
senza_video = len(rows) - len(con_video)

print(f"Iscritti con watching time > 0: {len(con_video)}")
print(f"Iscritti senza watching time: {senza_video}\n")

if con_video:
    print("DETTAGLIO ISCRITTI CON WATCHING TIME ERRATO (da webinar Malavasi):")
    print("-" * 90)
    for nome, cognome, email, sec in con_video:
        min_tot = sec // 60
        nome_completo = f"{cognome} {nome}".strip()
        print(f"  {nome_completo:30} {email:35} {min_tot:3} min ({sec}s)")
else:
    print("✅ Nessun iscritto con watching time")

print("\n" + "=" * 90)
print(f"\n💡 IMPATTO BUG: {len(con_video)}/{len(rows)} iscritti ({len(con_video)*100//len(rows)}%) mostrano watching time errato")
