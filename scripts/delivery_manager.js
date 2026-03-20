/**
 * DELIVERY MANAGER - Modulo 4/5 del sistema Freelancer
 *
 * Monitora il progresso dei progetti in corso, controlla scadenze e invia reminder automatici.
 */

const Anthropic = require('@anthropic-ai/sdk');

/**
 * Analizza lo stato del progetto con Claude
 */
async function analyzeProjectStatus(job, freelancer, messages, apiKey) {
    const client = new Anthropic({ apiKey });

    const messagesPreview = messages.slice(-5).map(m => {
        return `[${m.from_user === freelancer.freelancer_assigned_id ? 'FREELANCER' : 'YOU'}] ${m.message.substring(0, 150)}`;
    }).join('\n');

    const prompt = `Sei un project manager esperto che monitora progetti freelance su Freelancer.com.

## PROGETTO

**Titolo:** ${job.titolo}
**Freelancer:** @${freelancer.freelancer_assigned_username}
**Budget:** €${job.budget_max || 'N/A'}
**Stato:** ${job.stato}
**Assegnato il:** ${job.updated_at}

## ULTIMI MESSAGGI (${messages.length} totali)

${messagesPreview || 'Nessun messaggio'}

---

Analizza lo stato del progetto e determina:

1. **Stato progresso**: in tempo / possibile ritardo / ritardo critico / completato / bloccato
2. **Azioni necessarie**: cosa fare ora (reminder, escalation, niente, approvazione finale)
3. **Livello urgenza**: basso / medio / alto / critico
4. **Messaggio per freelancer** (se serve reminder): max 100 parole in INGLESE, professionale ma deciso
5. **Note per imprenditore**: cosa sta succedendo e cosa fare

## OUTPUT RICHIESTO

Genera un JSON con questa struttura:

\`\`\`json
{
  "stato_progresso": "in tempo | possibile ritardo | ritardo critico | completato | bloccato",
  "azione_necessaria": "niente | reminder | escalation | richiedi_approvazione_finale",
  "livello_urgenza": "basso | medio | alto | critico",
  "messaggio_reminder": "Testo del reminder in inglese per il freelancer (vuoto se non serve)",
  "note_imprenditore": "Spiegazione dello stato e cosa fare",
  "metriche": {
    "messaggi_freelancer_ultimi_3_giorni": 2,
    "ultimo_messaggio_freelancer_giorni_fa": 1,
    "sentiment": "positivo | neutrale | preoccupante"
  }
}
\`\`\`

Rispondi SOLO con il JSON, senza markdown fence o testo aggiuntivo.`;

    const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
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
 * Esegue il Delivery Manager
 * @param {number} jobId - ID del progetto
 * @param {object} pool - Pool di connessioni PostgreSQL
 * @param {string} apiKey - Anthropic API Key
 * @param {function} freelancerApiCall - Funzione per chiamate API Freelancer.com
 */
async function runDeliveryManager(jobId, pool, apiKey, freelancerApiCall) {
    console.log(`[DeliveryManager] 📦 Progetto ${jobId}`);

    // 1. Leggi progetto dal database
    console.log('[DeliveryManager] 1️⃣ Caricamento progetto...');
    const jobResult = await pool.query(`
        SELECT id, titolo, descrizione_testo, budget_max, stato,
               freelancer_assigned_id, freelancer_assigned_username,
               freelancer_project_id, updated_at
        FROM freelancer_jobs
        WHERE id = $1
    `, [jobId]);

    if (jobResult.rows.length === 0) {
        throw new Error(`Job ${jobId} non trovato`);
    }

    const job = jobResult.rows[0];

    if (!job.freelancer_assigned_id || !job.freelancer_project_id) {
        throw new Error('Progetto non ancora assegnato a un freelancer');
    }

    console.log(`[DeliveryManager]    ✓ Progetto: ${job.titolo.substring(0, 50)}...`);
    console.log(`[DeliveryManager]    ✓ Freelancer: @${job.freelancer_assigned_username}`);

    // 2. Scarica messaggi recenti da Freelancer.com
    console.log('[DeliveryManager] 2️⃣ Scaricamento messaggi...');
    let messages = [];

    try {
        const threadsResult = await freelancerApiCall('GET', `/messages/0.1/threads/?projects[]=${job.freelancer_project_id}`);

        if (threadsResult.threads && threadsResult.threads.length > 0) {
            const thread = threadsResult.threads[0];
            const messagesResult = await freelancerApiCall('GET', `/messages/0.1/threads/${thread.id}/messages/`);
            messages = messagesResult.messages || [];
            console.log(`[DeliveryManager]    ✓ ${messages.length} messaggi trovati`);
        } else {
            console.log(`[DeliveryManager]    ⚠️ Nessuna conversazione trovata`);
        }
    } catch (msgErr) {
        console.warn('[DeliveryManager]    ⚠️ Errore scaricamento messaggi:', msgErr.message);
        // Continua comunque
    }

    // 3. Analizza stato con Claude
    console.log('[DeliveryManager] 3️⃣ Analisi stato progetto con Claude...');
    const analysis = await analyzeProjectStatus(job, job, messages, apiKey);

    console.log(`[DeliveryManager]    ✓ Stato: ${analysis.stato_progresso}`);
    console.log(`[DeliveryManager]    ✓ Azione: ${analysis.azione_necessaria}`);
    console.log(`[DeliveryManager]    ✓ Urgenza: ${analysis.livello_urgenza}`);

    // 4. Se serve reminder, invialo
    if (analysis.azione_necessaria === 'reminder' && analysis.messaggio_reminder) {
        console.log('[DeliveryManager] 4️⃣ Invio reminder al freelancer...');
        try {
            const threadsResult = await freelancerApiCall('GET', `/messages/0.1/threads/?projects[]=${job.freelancer_project_id}`);
            const thread = threadsResult.threads[0];

            await freelancerApiCall('POST', `/messages/0.1/threads/${thread.id}/messages/`, {
                message: analysis.messaggio_reminder
            });

            console.log(`[DeliveryManager]    ✓ Reminder inviato`);
            analysis.reminder_inviato = true;
        } catch (reminderErr) {
            console.error('[DeliveryManager]    ⚠️ Errore invio reminder:', reminderErr.message);
            analysis.reminder_inviato = false;
            analysis.reminder_error = reminderErr.message;
        }
    }

    // 5. Salva approvazione se serve azione umana
    if (['escalation', 'richiedi_approvazione_finale'].includes(analysis.azione_necessaria)) {
        console.log('[DeliveryManager] 5️⃣ Creazione richiesta approvazione...');

        const azioneText = analysis.azione_necessaria === 'richiedi_approvazione_finale'
            ? 'Approva il lavoro completato dal freelancer e chiudi il progetto'
            : 'Il progetto richiede la tua attenzione - verifica lo stato e decidi le azioni';

        await pool.query(`
            INSERT INTO freelancer_approvals
            (job_id, modulo, azione, dettagli, stato)
            VALUES ($1, $2, $3, $4, $5)
        `, [
            jobId,
            'delivery_manager',
            azioneText,
            JSON.stringify(analysis),
            'pending'
        ]);

        console.log(`[DeliveryManager]    ✓ Approvazione creata`);
    }

    console.log('[DeliveryManager] ✅ DELIVERY MANAGER COMPLETATO');
    console.log(`[DeliveryManager] ${analysis.note_imprenditore}`);

    return analysis;
}

module.exports = { runDeliveryManager };
