/**
 * NEGOTIATOR - Modulo 3/5 del sistema Freelancer
 *
 * Assegna il progetto al freelancer selezionato e gestisce la comunicazione iniziale.
 */

const Anthropic = require('@anthropic-ai/sdk');

/**
 * Genera messaggio di benvenuto personalizzato con Claude
 */
async function generateWelcomeMessage(job, freelancer, apiKey) {
    const client = new Anthropic({ apiKey });

    const prompt = `Sei un project manager professionale che ha appena assegnato un progetto a un freelancer su Freelancer.com.

Scrivi un messaggio di benvenuto breve e professionale (max 150 parole) in INGLESE per il freelancer.

## CONTESTO PROGETTO

**Titolo:** ${job.titolo}
**Descrizione:** ${job.descrizione_testo || 'N/A'}

## FREELANCER SELEZIONATO

**Username:** ${freelancer.username || 'N/A'}
**Proposta:** €${freelancer.amount || 'N/A'} in ${freelancer.period || 'N/A'} giorni

---

Il messaggio deve:
1. Dare il benvenuto al freelancer
2. Confermare che è stato selezionato
3. Essere positivo e incoraggiante
4. Menzionare brevemente le aspettative (qualità, tempi, comunicazione)
5. Invitare a fare domande se necessario

Rispondi SOLO con il testo del messaggio, senza markdown o intestazioni.`;

    const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].text.trim();
}

/**
 * Esegue il Negotiator
 * @param {number} approvalId - ID dell'approvazione Talent Scout
 * @param {object} selectedCandidate - Candidato selezionato dall'imprenditore
 * @param {object} pool - Pool di connessioni PostgreSQL
 * @param {string} apiKey - Anthropic API Key
 * @param {function} freelancerApiCall - Funzione per chiamate API Freelancer.com
 */
async function runNegotiator(approvalId, selectedCandidate, pool, apiKey, freelancerApiCall) {
    console.log(`[Negotiator] 🤝 Approvazione ${approvalId} - Candidato ${selectedCandidate.username}`);

    // 1. Leggi approvazione e progetto
    console.log('[Negotiator] 1️⃣ Caricamento dati...');
    const approvalResult = await pool.query(`
        SELECT a.job_id, a.dettagli, j.titolo, j.descrizione_testo, j.freelancer_project_id
        FROM freelancer_approvals a
        JOIN freelancer_jobs j ON j.id = a.job_id
        WHERE a.id = $1
    `, [approvalId]);

    if (approvalResult.rows.length === 0) {
        throw new Error(`Approvazione ${approvalId} non trovata`);
    }

    const approval = approvalResult.rows[0];
    const job = {
        id: approval.job_id,
        titolo: approval.titolo,
        descrizione_testo: approval.descrizione_testo,
        freelancer_project_id: approval.freelancer_project_id
    };

    console.log(`[Negotiator]    ✓ Progetto: ${job.titolo.substring(0, 50)}...`);
    console.log(`[Negotiator]    ✓ Freelancer: @${selectedCandidate.username}`);

    // 2. Genera messaggio di benvenuto con Claude
    console.log('[Negotiator] 2️⃣ Generazione messaggio di benvenuto...');
    const welcomeMessage = await generateWelcomeMessage(job, selectedCandidate, apiKey);
    console.log(`[Negotiator]    ✓ Messaggio generato (${welcomeMessage.length} caratteri)`);

    // 3. Assegna progetto su Freelancer.com
    console.log('[Negotiator] 3️⃣ Assegnazione progetto su Freelancer.com...');

    try {
        // Award bid (assegna il progetto al freelancer)
        const awardResult = await freelancerApiCall('POST', `/projects/0.1/projects/${job.freelancer_project_id}/`, {
            action: 'award',
            bid_id: selectedCandidate.bid_id
        });

        console.log(`[Negotiator]    ✓ Progetto assegnato (award ID: ${awardResult.id || 'N/A'})`);

        // Invia messaggio di benvenuto
        await freelancerApiCall('POST', `/messages/0.1/threads/`, {
            members: [selectedCandidate.bidder_id],
            context_type: 'project',
            context: job.freelancer_project_id,
            message: welcomeMessage
        });

        console.log(`[Negotiator]    ✓ Messaggio di benvenuto inviato`);

    } catch (apiErr) {
        console.error('[Negotiator] ⚠️ Errore API Freelancer.com:', apiErr.message);
        // Continua comunque per salvare i dati
    }

    // 4. Aggiorna stato progetto → in_corso
    console.log('[Negotiator] 4️⃣ Aggiornamento stato progetto...');
    await pool.query(`
        UPDATE freelancer_jobs
        SET stato = 'in_corso',
            freelancer_assigned_id = $1,
            freelancer_assigned_username = $2,
            updated_at = NOW()
        WHERE id = $3
    `, [selectedCandidate.bidder_id, selectedCandidate.username, job.id]);

    console.log(`[Negotiator]    ✓ Progetto ${job.id} → stato: in_corso`);

    // 5. Salva dettagli assegnazione
    const negotiatorDetails = {
        freelancer: {
            bidder_id: selectedCandidate.bidder_id,
            username: selectedCandidate.username,
            amount: selectedCandidate.amount,
            period: selectedCandidate.period,
            score: selectedCandidate.punteggio_totale
        },
        messaggio_benvenuto: welcomeMessage,
        data_assegnazione: new Date().toISOString()
    };

    console.log('[Negotiator] ✅ NEGOTIATOR COMPLETATO');
    console.log(`[Negotiator] Progetto assegnato a @${selectedCandidate.username} - €${selectedCandidate.amount} in ${selectedCandidate.period} giorni`);

    return negotiatorDetails;
}

module.exports = { runNegotiator };
