/**
 * JOB COMPOSER - Modulo 1/5 del sistema Freelancer
 *
 * Trasforma il brief dell'imprenditore in job posting ottimizzato per Freelancer.com
 * con skill IDs, budget e descrizione strutturata.
 */

const Anthropic = require('@anthropic-ai/sdk');

// Skill mapping Freelancer.com
const SKILL_KEYWORDS = {
    'video': [676, 390],  // Video Production, Video Editing
    'editing': [676, 390],
    'montaggio': [676, 390],
    'graphic': [12],  // Graphic Design
    'design': [12, 51],  // Graphic Design, Logo Design
    'logo': [51],
    'voice': [132],  // Voice Talent
    'voiceover': [132],
    'audio': [132, 389],  // Voice Talent, Audio Production
    'php': [3],
    'python': [7],
    'javascript': [9],
    'web': [3, 9],
    'mobile': [82],
    'copywriting': [66],
    'translation': [17],
    'animation': [145],
    '3d': [146],
    'photoshop': [13],
    'illustrator': [14]
};

/**
 * Suggerisce skill IDs basandosi su keyword nel testo
 */
function suggestSkillsFromKeywords(text) {
    const textLower = text.toLowerCase();
    const suggested = new Set();

    for (const [keyword, skillIds] of Object.entries(SKILL_KEYWORDS)) {
        if (textLower.includes(keyword)) {
            skillIds.forEach(id => suggested.add(id));
        }
    }

    // Default: Graphic Design se nessun match
    if (suggested.size === 0) {
        suggested.add(12);
    }

    return Array.from(suggested);
}

/**
 * Costruisce il prompt per Claude
 */
function buildPrompt(job) {
    const allegatiStr = job.allegati && job.allegati.length > 0 ? job.allegati.join(', ') : 'nessun allegato';
    const budgetStr = job.budget_max ? `${job.budget_max} EUR` : 'non specificato';
    const suggestedSkills = suggestSkillsFromKeywords(job.titolo + ' ' + (job.descrizione_testo || ''));

    return `Sei un esperto di recruiting su Freelancer.com, la piattaforma internazionale per freelancer.

Il tuo compito è trasformare il brief di un imprenditore italiano in un job posting professionale, chiaro e attrattivo per freelancer internazionali.

## INPUT dall'imprenditore:

**Titolo:** ${job.titolo}

**Descrizione:**
${job.descrizione_testo || ''}

**Budget massimo:** ${budgetStr}

**Allegati disponibili:** ${allegatiStr}

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

(Suggerimenti iniziali basati su keyword: ${JSON.stringify(suggestedSkills)})

## OUTPUT RICHIESTO:

Genera un JSON con questa struttura:

\`\`\`json
{
  "titolo_ottimizzato": "Massimo 80 caratteri, chiaro, keyword-rich, in INGLESE",
  "descrizione_ottimizzata": "Descrizione strutturata in INGLESE con:\\n- What we need (cosa serve)\\n- Requirements (requisiti tecnici)\\n- Deliverables (cosa deve consegnare)\\n- Timeline (tempi)",
  "skill_ids": [676, 12],
  "budget_minimo_suggerito": 100,
  "budget_massimo_suggerito": 500,
  "durata_giorni_suggerita": 7,
  "motivazione": "Breve spiegazione in italiano del perché hai scelto questi skill, budget e durata"
}
\`\`\`

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

Rispondi SOLO con il JSON, senza markdown fence o testo aggiuntivo.`;
}

/**
 * Chiama Claude API
 */
async function callClaude(prompt, apiKey) {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }]
    });

    // Estrai testo dalla risposta
    let text = response.content[0].text.trim();

    // Rimuovi markdown fence se presenti
    if (text.startsWith('```json')) text = text.substring(7);
    if (text.startsWith('```')) text = text.substring(3);
    if (text.endsWith('```')) text = text.slice(0, -3);
    text = text.trim();

    // Parse JSON
    const result = JSON.parse(text);

    // Validazione campi obbligatori
    const required = [
        'titolo_ottimizzato', 'descrizione_ottimizzata', 'skill_ids',
        'budget_minimo_suggerito', 'budget_massimo_suggerito',
        'durata_giorni_suggerita', 'motivazione'
    ];

    for (const field of required) {
        if (!(field in result)) {
            throw new Error(`Campo obbligatorio mancante: ${field}`);
        }
    }

    return result;
}

/**
 * Esegue il Job Composer
 * @param {number} jobId - ID del progetto
 * @param {object} pool - Pool di connessioni PostgreSQL
 * @param {string} apiKey - Anthropic API Key
 */
async function runJobComposer(jobId, pool, apiKey) {
    console.log(`[JobComposer] 🎯 Progetto ${jobId}`);

    // 1. Leggi progetto dal database
    console.log('[JobComposer] 1️⃣ Caricamento progetto...');
    const jobResult = await pool.query(`
        SELECT j.id, j.titolo, j.descrizione_testo, j.budget_max, j.stato,
               COALESCE(array_agg(a.nome_file) FILTER (WHERE a.nome_file IS NOT NULL), ARRAY[]::text[]) as allegati
        FROM freelancer_jobs j
        LEFT JOIN freelancer_attachments a ON a.job_id = j.id
        WHERE j.id = $1
        GROUP BY j.id
    `, [jobId]);

    if (jobResult.rows.length === 0) {
        throw new Error(`Job ${jobId} non trovato`);
    }

    const job = jobResult.rows[0];
    console.log(`[JobComposer]    ✓ Titolo: ${job.titolo.substring(0, 50)}...`);
    console.log(`[JobComposer]    ✓ Allegati: ${job.allegati.length}`);

    // 2. Chiama Claude
    console.log('[JobComposer] 2️⃣ Chiamata a Claude API...');
    const prompt = buildPrompt(job);
    const result = await callClaude(prompt, apiKey);

    console.log(`[JobComposer]    ✓ Titolo ottimizzato: ${result.titolo_ottimizzato}`);
    console.log(`[JobComposer]    ✓ Skill IDs: ${JSON.stringify(result.skill_ids)}`);
    console.log(`[JobComposer]    ✓ Budget: €${result.budget_minimo_suggerito}-${result.budget_massimo_suggerito}`);
    console.log(`[JobComposer]    ✓ Durata: ${result.durata_giorni_suggerita} giorni`);

    // 3. Salva approvazione
    console.log('[JobComposer] 3️⃣ Creazione richiesta approvazione...');
    const approvalResult = await pool.query(`
        INSERT INTO freelancer_approvals
        (job_id, modulo, azione, dettagli, stato)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
    `, [
        jobId,
        'job_composer',
        'Pubblicare progetto su Freelancer.com con job posting ottimizzato',
        JSON.stringify(result),
        'pending'
    ]);

    const approvalId = approvalResult.rows[0].id;
    console.log(`[JobComposer]    ✓ Approvazione #${approvalId} creata`);
    console.log('[JobComposer] ✅ JOB COMPOSER COMPLETATO');
    console.log(`[JobComposer] Motivazione: ${result.motivazione}`);

    return result;
}

module.exports = { runJobComposer };
