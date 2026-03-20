#!/usr/bin/env python3
"""
JOB COMPOSER - Modulo 1/5 del sistema Freelancer

Trasforma il brief dell'imprenditore in job posting ottimizzato per Freelancer.com
con skill IDs, budget e descrizione strutturata.

Usage: python job_composer.py <job_id>
"""

import sys
import os
import json
import psycopg2
from anthropic import Anthropic

# ==================== CONFIG ====================
DATABASE_URL = os.getenv('DATABASE_URL')
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')

if not DATABASE_URL:
    print("❌ ERRORE: DATABASE_URL non configurato")
    sys.exit(1)

if not ANTHROPIC_API_KEY:
    print("❌ ERRORE: ANTHROPIC_API_KEY non configurato")
    sys.exit(1)


# ==================== SKILL MAPPING ====================
# Categorie principali Freelancer.com (IDs verificati)
SKILL_KEYWORDS = {
    'video': [676, 390],  # Video Production, Video Editing
    'editing': [676, 390],
    'montaggio': [676, 390],
    'graphic': [12],  # Graphic Design
    'design': [12, 51],  # Graphic Design, Logo Design
    'logo': [51],
    'voice': [132],  # Voice Talent
    'voiceover': [132],
    'audio': [132, 389],  # Voice Talent, Audio Production
    'php': [3],
    'python': [7],
    'javascript': [9],
    'web': [3, 9],  # PHP, Javascript
    'mobile': [82],  # Mobile App Development
    'copywriting': [66],
    'translation': [17],
    'animation': [145],
    '3d': [146],
    'photoshop': [13],
    'illustrator': [14],
}


def get_db_connection():
    """Connessione a PostgreSQL"""
    return psycopg2.connect(DATABASE_URL)


def fetch_job(job_id):
    """Legge progetto dal database"""
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT j.id, j.titolo, j.descrizione_testo, j.budget_max, j.stato,
               COALESCE(array_agg(a.nome_file) FILTER (WHERE a.nome_file IS NOT NULL), ARRAY[]::text[]) as allegati
        FROM freelancer_jobs j
        LEFT JOIN freelancer_attachments a ON a.job_id = j.id
        WHERE j.id = %s
        GROUP BY j.id
    """, (job_id,))

    row = cur.fetchone()
    conn.close()

    if not row:
        raise Exception(f"Job {job_id} non trovato")

    return {
        'id': row[0],
        'titolo': row[1] or '',
        'descrizione_testo': row[2] or '',
        'budget_max': float(row[3]) if row[3] else None,
        'stato': row[4],
        'allegati': row[5] if row[5] else []
    }


def suggest_skills_from_keywords(text):
    """Suggerisce skill IDs basandosi su keyword nel testo"""
    text_lower = text.lower()
    suggested = set()

    for keyword, skill_ids in SKILL_KEYWORDS.items():
        if keyword in text_lower:
            suggested.update(skill_ids)

    # Default: Graphic Design se nessun match
    if not suggested:
        suggested.add(12)

    return list(suggested)


def build_prompt(job):
    """Costruisce prompt per Claude"""
    allegati_str = ', '.join(job['allegati']) if job['allegati'] else 'nessun allegato'
    budget_str = f"{job['budget_max']} EUR" if job['budget_max'] else "non specificato"

    # Suggerimenti iniziali da keyword
    suggested_skills = suggest_skills_from_keywords(job['titolo'] + ' ' + job['descrizione_testo'])

    return f"""Sei un esperto di recruiting su Freelancer.com, la piattaforma internazionale per freelancer.

Il tuo compito è trasformare il brief di un imprenditore italiano in un job posting professionale, chiaro e attrattivo per freelancer internazionali.

## INPUT dall'imprenditore:

**Titolo:** {job['titolo']}

**Descrizione:**
{job['descrizione_testo']}

**Budget massimo:** {budget_str}

**Allegati disponibili:** {allegati_str}

## CATEGORIE FREELANCER.COM PIÙ COMUNI:

- Video Production: 676
- Video Editing: 390
- Graphic Design: 12
- Logo Design: 51
- Voice Talent: 132
- Audio Production: 389
- Photoshop: 13
- Illustrator: 14
- Animation: 145
- 3D Modelling: 146
- Copywriting: 66
- PHP: 3
- Javascript: 9
- Python: 7

(Suggerimenti iniziali basati su keyword: {suggested_skills})

## OUTPUT RICHIESTO:

Genera un JSON con questa struttura:

```json
{{
  "titolo_ottimizzato": "Massimo 80 caratteri, chiaro, keyword-rich, in INGLESE",
  "descrizione_ottimizzata": "Descrizione strutturata in INGLESE con:\\n- What we need (cosa serve)\\n- Requirements (requisiti tecnici)\\n- Deliverables (cosa deve consegnare)\\n- Timeline (tempi)",
  "skill_ids": [676, 12],
  "budget_minimo_suggerito": 100,
  "budget_massimo_suggerito": 500,
  "durata_giorni_suggerita": 7,
  "motivazione": "Breve spiegazione in italiano del perché hai scelto questi skill, budget e durata"
}}
```

## REGOLE:

1. **Titolo**: massimo 80 caratteri, in INGLESE, SEO-friendly (es: "Professional Video Editing for Medical Case Study")
2. **Descrizione**: in INGLESE, professionale, strutturata in sezioni, specifica sui deliverable
3. **Skill IDs**: scegli 2-4 categorie pertinenti dalla lista sopra (usa gli ID numerici)
4. **Budget**:
   - Se l'imprenditore ha dato un budget max, usalo come riferimento
   - Altrimenti suggerisci budget realistico per mercato freelance internazionale
   - Budget minimo = 60-80% del massimo
5. **Durata**: considera complessità (video corto=3-5 giorni, logo=5-7 giorni, sito web=14-21 giorni)
6. **Motivazione**: spiega in italiano le tue scelte (per aiutare l'imprenditore a capire)

Rispondi SOLO con il JSON, senza markdown fence o testo aggiuntivo."""


def call_claude(prompt):
    """Chiama Claude API"""
    client = Anthropic(api_key=ANTHROPIC_API_KEY)

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            temperature=0.7,
            messages=[{"role": "user", "content": prompt}]
        )

        # Estrai testo dalla risposta
        text = response.content[0].text.strip()

        # Rimuovi markdown fence se presenti
        if text.startswith('```json'):
            text = text[7:]
        if text.startswith('```'):
            text = text[3:]
        if text.endswith('```'):
            text = text[:-3]

        text = text.strip()

        # Parse JSON
        result = json.loads(text)

        # Validazione campi obbligatori
        required = ['titolo_ottimizzato', 'descrizione_ottimizzata', 'skill_ids',
                    'budget_minimo_suggerito', 'budget_massimo_suggerito',
                    'durata_giorni_suggerita', 'motivazione']

        for field in required:
            if field not in result:
                raise Exception(f"Campo obbligatorio mancante: {field}")

        return result

    except json.JSONDecodeError as e:
        raise Exception(f"Errore parsing JSON da Claude: {e}\nRisposta: {text}")
    except Exception as e:
        raise Exception(f"Errore chiamata Claude: {e}")


def create_approval(job_id, composer_result):
    """Salva richiesta approvazione nel database"""
    conn = get_db_connection()
    cur = conn.cursor()

    dettagli = json.dumps(composer_result, ensure_ascii=False)

    cur.execute("""
        INSERT INTO freelancer_approvals
        (job_id, modulo, azione, dettagli, stato)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id
    """, (
        job_id,
        'job_composer',
        'Pubblicare progetto su Freelancer.com con job posting ottimizzato',
        dettagli,
        'pending'
    ))

    approval_id = cur.fetchone()[0]
    conn.commit()
    conn.close()

    return approval_id


def main():
    if len(sys.argv) < 2:
        print("Usage: python job_composer.py <job_id>")
        sys.exit(1)

    job_id = sys.argv[1]

    print(f"🎯 Job Composer - Progetto {job_id}")
    print("=" * 60)

    try:
        # 1. Leggi progetto
        print("1️⃣  Caricamento progetto dal database...")
        job = fetch_job(job_id)
        print(f"   ✓ Titolo: {job['titolo'][:50]}...")
        print(f"   ✓ Allegati: {len(job['allegati'])}")

        # 2. Chiama Claude
        print("\n2️⃣  Chiamata a Claude API...")
        prompt = build_prompt(job)
        result = call_claude(prompt)
        print(f"   ✓ Titolo ottimizzato: {result['titolo_ottimizzato']}")
        print(f"   ✓ Skill IDs: {result['skill_ids']}")
        print(f"   ✓ Budget: €{result['budget_minimo_suggerito']}-{result['budget_massimo_suggerito']}")
        print(f"   ✓ Durata: {result['durata_giorni_suggerita']} giorni")

        # 3. Salva approvazione
        print("\n3️⃣  Creazione richiesta approvazione...")
        approval_id = create_approval(job_id, result)
        print(f"   ✓ Approvazione #{approval_id} creata")

        print("\n✅ JOB COMPOSER COMPLETATO")
        print("=" * 60)
        print(f"Motivazione: {result['motivazione']}")
        print("\n👉 Vai nel tab Approvazioni della Dashboard per vedere il job posting ottimizzato.")

    except Exception as e:
        print(f"\n❌ ERRORE: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
