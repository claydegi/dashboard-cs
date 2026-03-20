/**
 * COST TRACKER - Modulo 5/5 del sistema Freelancer
 *
 * Traccia i costi effettivi vs budget, analizza lo storico e impara per migliorare stime future.
 */

const Anthropic = require('@anthropic-ai/sdk');

/**
 * Analizza i costi con Claude e genera insights
 */
async function analyzeCosts(job, actualCost, historicalData, apiKey) {
    const client = new Anthropic({ apiKey });

    const historicalAnalysis = historicalData.length > 0
        ? historicalData.map(h => {
            return `- ${h.titolo}: Budget €${h.budget_max}, Costo reale €${h.costo_finale || 'N/A'}, Variance ${h.variance || 'N/A'}%`;
        }).join('\n')
        : 'Nessun dato storico disponibile';

    const prompt = `Sei un financial analyst esperto che analizza i costi dei progetti freelance.

## PROGETTO COMPLETATO

**Titolo:** ${job.titolo}
**Budget iniziale:** €${job.budget_max || 'N/A'}
**Costo effettivo:** €${actualCost}
**Variance:** ${job.budget_max ? ((actualCost - job.budget_max) / job.budget_max * 100).toFixed(1) : 'N/A'}%
**Freelancer:** @${job.freelancer_assigned_username}

## STORICO PROGETTI SIMILI (ultimi 5)

${historicalAnalysis}

---

Analizza i costi e genera insights:

1. **Valutazione generale**: ottimo / buono / nella norma / costoso / molto_costoso
2. **Cause variance** (se budget superato o sotto-stimato): lista fattori
3. **Lezioni apprese**: cosa possiamo migliorare per prossimi progetti
4. **Raccomandazioni budget futuro**: per progetti simili, che budget suggerire
5. **Quality score freelancer**: 1-10 basato su rapporto qualità/prezzo

## OUTPUT RICHIESTO

Genera un JSON con questa struttura:

\`\`\`json
{
  "valutazione_generale": "ottimo | buono | nella_norma | costoso | molto_costoso",
  "variance_percent": 12.5,
  "cause_variance": [
    "Causa 1: descrizione",
    "Causa 2: descrizione"
  ],
  "lezioni_apprese": [
    "Lezione 1",
    "Lezione 2",
    "Lezione 3"
  ],
  "budget_raccomandato_futuro": {
    "min": 300,
    "max": 500,
    "motivazione": "Spiegazione della raccomandazione"
  },
  "quality_score_freelancer": 8,
  "note_imprenditore": "Sintesi per l'imprenditore: cosa è andato bene, cosa migliorare"
}
\`\`\`

## REGOLE

1. Sii obiettivo e data-driven
2. Se variance < 10%, valutazione = ottimo/buono
3. Se variance > 30%, valutazione = costoso/molto_costoso
4. Le lezioni apprese devono essere actionable (non generiche)
5. Il budget futuro deve basarsi su dati storici + questo progetto

Rispondi SOLO con il JSON, senza markdown fence o testo aggiuntivo.`;

    const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
    });

    let text = response.content[0].text.trim();

    // Rimuovi markdown fence
    if (text.startsWith('```json')) text = text.substring(7);
    if (text.startsWith('```')) text = text.substring(3);
    if (text.endsWith('```')) text = text.slice(0, -3);
    text = text.trim();

    const result = JSON.parse(text);

    return result;
}

/**
 * Esegue il Cost Tracker
 * @param {number} jobId - ID del progetto
 * @param {number} actualCost - Costo effettivo pagato
 * @param {object} pool - Pool di connessioni PostgreSQL
 * @param {string} apiKey - Anthropic API Key
 */
async function runCostTracker(jobId, actualCost, pool, apiKey) {
    console.log(`[CostTracker] 💰 Progetto ${jobId} - Costo: €${actualCost}`);

    if (!actualCost || actualCost <= 0) {
        throw new Error('Costo effettivo obbligatorio e deve essere > 0');
    }

    // 1. Leggi progetto dal database
    console.log('[CostTracker] 1️⃣ Caricamento progetto...');
    const jobResult = await pool.query(`
        SELECT id, titolo, descrizione_testo, budget_max, stato,
               freelancer_assigned_id, freelancer_assigned_username,
               created_at, updated_at
        FROM freelancer_jobs
        WHERE id = $1
    `, [jobId]);

    if (jobResult.rows.length === 0) {
        throw new Error(`Job ${jobId} non trovato`);
    }

    const job = jobResult.rows[0];

    if (!job.freelancer_assigned_id) {
        throw new Error('Progetto non ancora assegnato a un freelancer');
    }

    console.log(`[CostTracker]    ✓ Progetto: ${job.titolo.substring(0, 50)}...`);
    console.log(`[CostTracker]    ✓ Budget: €${job.budget_max} | Costo: €${actualCost}`);

    // 2. Carica storico progetti completati simili
    console.log('[CostTracker] 2️⃣ Caricamento storico progetti...');
    const historicalResult = await pool.query(`
        SELECT titolo, budget_max, costo_finale,
               CASE WHEN budget_max > 0 AND costo_finale > 0
                    THEN ROUND((costo_finale - budget_max)::numeric / budget_max * 100, 1)
                    ELSE NULL
               END as variance
        FROM freelancer_jobs
        WHERE stato = 'completato' AND costo_finale IS NOT NULL AND id != $1
        ORDER BY updated_at DESC
        LIMIT 5
    `, [jobId]);

    const historicalData = historicalResult.rows;
    console.log(`[CostTracker]    ✓ ${historicalData.length} progetti storici caricati`);

    // 3. Analizza con Claude
    console.log('[CostTracker] 3️⃣ Analisi costi con Claude...');
    const analysis = await analyzeCosts(job, actualCost, historicalData, apiKey);

    console.log(`[CostTracker]    ✓ Valutazione: ${analysis.valutazione_generale}`);
    console.log(`[CostTracker]    ✓ Variance: ${analysis.variance_percent}%`);
    console.log(`[CostTracker]    ✓ Quality score: ${analysis.quality_score_freelancer}/10`);

    // 4. Salva costo finale nel progetto
    console.log('[CostTracker] 4️⃣ Salvataggio costo finale...');
    await pool.query(`
        UPDATE freelancer_jobs
        SET costo_finale = $1, stato = 'completato', updated_at = NOW()
        WHERE id = $2
    `, [actualCost, jobId]);

    console.log(`[CostTracker]    ✓ Costo €${actualCost} salvato, progetto → completato`);

    // 5. Salva approvazione con insights
    console.log('[CostTracker] 5️⃣ Creazione report finale...');
    await pool.query(`
        INSERT INTO freelancer_approvals
        (job_id, modulo, azione, dettagli, stato)
        VALUES ($1, $2, $3, $4, $5)
    `, [
        jobId,
        'cost_tracker',
        `Progetto completato: €${actualCost} (${analysis.valutazione_generale})`,
        JSON.stringify(analysis),
        'approved' // Auto-approved, è solo informativo
    ]);

    console.log(`[CostTracker]    ✓ Report salvato`);
    console.log('[CostTracker] ✅ COST TRACKER COMPLETATO');
    console.log(`[CostTracker] ${analysis.note_imprenditore}`);

    return analysis;
}

module.exports = { runCostTracker };
