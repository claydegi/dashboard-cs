/**
 * TALENT SCOUT - Modulo 2/5 del sistema Freelancer
 *
 * Analizza le proposte (bids) ricevute su un progetto e suggerisce i migliori 3 candidati
 * basandosi su: reputazione, esperienza, portfolio, prezzo, tempi di consegna.
 */

const Anthropic = require('@anthropic-ai/sdk');

/**
 * Costruisce il prompt per Claude
 */
function buildPrompt(job, bids) {
    const bidsAnalysis = bids.map((bid, idx) => {
        return `
## PROPOSTA ${idx + 1}

**Freelancer:** ${bid.bidder_id} - ${bid.username || 'N/A'}
**Bid ID:** ${bid.bid_id}
**Rating:** ${bid.reputation?.entire_history?.overall || 0}/10 (${bid.reputation?.entire_history?.reviews || 0} recensioni)
**Completamenti:** ${bid.reputation?.entire_history?.complete || 0} progetti completati
**On Budget:** ${bid.reputation?.entire_history?.on_budget || 0}%
**On Time:** ${bid.reputation?.entire_history?.on_time || 0}%
**Paese:** ${bid.country || 'N/A'}

**Offerta:**
- Bid ID: ${bid.bid_id}
- Prezzo: ${bid.amount} EUR
- Tempi: ${bid.period} giorni
- Milestone: ${bid.milestone_percentage || 0}%

**Descrizione proposta:**
${bid.description || 'Nessuna descrizione fornita'}

---
`;
    }).join('\n');

    return `Sei un esperto recruiter specializzato nella selezione di freelancer su Freelancer.com.

Il tuo compito è analizzare le proposte ricevute per un progetto e identificare i **migliori 3 candidati** in ordine di preferenza.

## PROGETTO

**Titolo:** ${job.titolo}

**Descrizione:**
${job.descrizione_testo || 'N/A'}

**Budget:** €${job.budget_max || 'Non specificato'}

---

## PROPOSTE RICEVUTE (${bids.length} totali)

${bidsAnalysis}

---

## CRITERI DI VALUTAZIONE

1. **Reputazione** (40%): Rating complessivo, numero recensioni, percentuale completamenti on-time e on-budget
2. **Prezzo** (25%): Rapporto qualità/prezzo (NON necessariamente il più economico, ma il miglior valore)
3. **Tempi** (15%): Tempi di consegna realistici (né troppo veloci né troppo lenti)
4. **Esperienza** (10%): Numero progetti completati, specializzazione
5. **Proposta** (10%): Qualità della descrizione, comprensione del progetto, professionalità

---

## OUTPUT RICHIESTO

Genera un JSON con questa struttura:

\`\`\`json
{
  "top_3": [
    {
      "bidder_id": 12345,
      "username": "nome_freelancer",
      "bid_id": 98765,
      "amount": 350,
      "period": 7,
      "ranking": 1,
      "punteggio_totale": 85,
      "motivazione": "Breve spiegazione (2-3 frasi) del perché è il candidato migliore. Evidenzia punti di forza specifici.",
      "pro": ["Punto di forza 1", "Punto di forza 2", "Punto di forza 3"],
      "contro": ["Punto di attenzione 1", "Punto di attenzione 2"],
      "raccomandazione": "Fortemente raccomandato | Raccomandato | Raccomandato con riserva"
    },
    {
      "bidder_id": 67890,
      "username": "altro_freelancer",
      "bid_id": 98766,
      "amount": 420,
      "period": 10,
      "ranking": 2,
      "punteggio_totale": 78,
      "motivazione": "...",
      "pro": ["..."],
      "contro": ["..."],
      "raccomandazione": "..."
    },
    {
      "bidder_id": 11111,
      "username": "terzo_freelancer",
      "bid_id": 98767,
      "amount": 280,
      "period": 5,
      "ranking": 3,
      "punteggio_totale": 72,
      "motivazione": "...",
      "pro": ["..."],
      "contro": ["..."],
      "raccomandazione": "..."
    }
  ],
  "riepilogo_generale": "Breve analisi generale delle proposte ricevute (2-3 frasi). Indica se ci sono candidati validi o se conviene riaprire il progetto."
}
\`\`\`

## REGOLE

1. Seleziona ESATTAMENTE 3 candidati (anche se ce ne sono di più o di meno)
2. Ordina per ranking (1 = migliore, 3 = terzo)
3. Il punteggio totale deve essere 0-100
4. Sii obiettivo e basati sui dati concreti
5. Se tutti i candidati sono scadenti, dillo nel riepilogo generale
6. Valuta il rapporto qualità/prezzo, NON solo il prezzo minimo
7. Diffida di offerte troppo economiche o con tempi irrealistici
8. **IMPORTANTE:** Includi bid_id, amount e period per ogni candidato (li trovi nelle proposte ricevute sopra)

Rispondi SOLO con il JSON, senza markdown fence o testo aggiuntivo.`;
}

/**
 * Chiama Claude API
 */
async function callClaude(prompt, apiKey) {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        temperature: 0.5,
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

    // Validazione
    if (!result.top_3 || !Array.isArray(result.top_3) || result.top_3.length !== 3) {
        throw new Error('La risposta deve contenere esattamente 3 candidati');
    }

    return result;
}

/**
 * Esegue il Talent Scout
 * @param {number} jobId - ID del progetto
 * @param {array} bids - Array di bid da Freelancer.com API
 * @param {object} pool - Pool di connessioni PostgreSQL
 * @param {string} apiKey - Anthropic API Key
 */
async function runTalentScout(jobId, bids, pool, apiKey) {
    console.log(`[TalentScout] 🔍 Progetto ${jobId} - ${bids.length} proposte`);

    if (bids.length === 0) {
        throw new Error('Nessuna proposta da analizzare');
    }

    // 1. Leggi progetto dal database
    console.log('[TalentScout] 1️⃣ Caricamento progetto...');
    const jobResult = await pool.query(`
        SELECT id, titolo, descrizione_testo, budget_max
        FROM freelancer_jobs
        WHERE id = $1
    `, [jobId]);

    if (jobResult.rows.length === 0) {
        throw new Error(`Job ${jobId} non trovato`);
    }

    const job = jobResult.rows[0];
    console.log(`[TalentScout]    ✓ Titolo: ${job.titolo.substring(0, 50)}...`);

    // 2. Chiama Claude
    console.log('[TalentScout] 2️⃣ Analisi proposte con Claude...');
    const prompt = buildPrompt(job, bids);
    const result = await callClaude(prompt, apiKey);

    console.log(`[TalentScout]    ✓ Top 3 candidati:`);
    result.top_3.forEach((c, idx) => {
        console.log(`[TalentScout]       ${idx + 1}. ${c.username} (score: ${c.punteggio_totale}/100)`);
    });

    // 3. Salva approvazione
    console.log('[TalentScout] 3️⃣ Creazione richiesta approvazione...');
    const approvalResult = await pool.query(`
        INSERT INTO freelancer_approvals
        (job_id, modulo, azione, dettagli, stato)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
    `, [
        jobId,
        'talent_scout',
        'Selezionare freelancer da assumere tra i top 3 candidati',
        JSON.stringify(result),
        'pending'
    ]);

    const approvalId = approvalResult.rows[0].id;
    console.log(`[TalentScout]    ✓ Approvazione #${approvalId} creata`);
    console.log('[TalentScout] ✅ TALENT SCOUT COMPLETATO');

    return result;
}

module.exports = { runTalentScout };
