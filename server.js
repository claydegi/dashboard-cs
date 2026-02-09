const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurazione
const CONFIG = {
    ADMIN_KEY: process.env.ADMIN_KEY || 'chiave-segreta-admin-2024',
    REPORTS_API_KEY: process.env.REPORTS_API_KEY || process.env.ADMIN_KEY || 'chiave-segreta-admin-2024',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '7975162439:AAGB95NY4fAVdhNdgBY5X5QObHDNKHNkNFw',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '-5130672016',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'LA_TUA_API_KEY_OPENAI',
    TELEGRAM_CHAT_ID_KIM: process.env.TELEGRAM_CHAT_ID_KIM || '8418876575'
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== DATABASE POSTGRESQL ====================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
        ? { rejectUnauthorized: false }
        : false
});

// Inizializza tabelle
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                titolo TEXT NOT NULL,
                descrizione TEXT DEFAULT '',
                stato TEXT DEFAULT 'da_fare',
                priorita TEXT DEFAULT 'media',
                scadenza TEXT,
                assegnato_a TEXT,
                tipo TEXT DEFAULT 'cs',
                commenti JSONB DEFAULT '[]',
                creato_il TIMESTAMPTZ DEFAULT NOW(),
                completato_il TIMESTAMPTZ,
                completato_da TEXT
            )
        `);
        // Tabella reports (OSSEOTOUCH)
        await client.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                tipo TEXT NOT NULL,
                titolo TEXT NOT NULL,
                data_report DATE NOT NULL,
                mese_report TEXT,
                contenuto_html TEXT NOT NULL,
                file_originale TEXT,
                dimensione_kb INTEGER,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_tipo ON reports(tipo)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_data ON reports(data_report DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_tipo_data ON reports(tipo, data_report DESC)`);
        // Vincolo UNIQUE per evitare duplicati: un solo report per tipo+data
        await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_tipo_data_unique ON reports(tipo, data_report)`);

        // Tabella fatture PDF
        await client.query(`
            CREATE TABLE IF NOT EXISTS fatture (
                id SERIAL PRIMARY KEY,
                agente TEXT NOT NULL,
                nome_file TEXT NOT NULL,
                data_fattura DATE NOT NULL,
                dimensione_kb INTEGER,
                pdf_base64 TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_fatture_agente ON fatture(agente)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_fatture_agente_data ON fatture(agente, data_fattura DESC)`);

        // Tabelle CRM
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_contatti (
                id INTEGER PRIMARY KEY,
                cognome TEXT,
                nome TEXT,
                email TEXT,
                telefono TEXT,
                cellulare TEXT,
                citta TEXT,
                regione TEXT,
                nome_azienda TEXT,
                fonte_sync TEXT,
                data_inserimento TEXT,
                score INTEGER DEFAULT 0
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_contatti_regione ON crm_contatti(regione)`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_prodotti (
                id SERIAL PRIMARY KEY,
                contatto_id INTEGER REFERENCES crm_contatti(id) ON DELETE CASCADE,
                prodotto TEXT NOT NULL,
                data_inserimento TEXT,
                fonte TEXT
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_prodotti_contatto ON crm_prodotti(contatto_id)`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_acquisti (
                id SERIAL PRIMARY KEY,
                contatto_id INTEGER REFERENCES crm_contatti(id) ON DELETE CASCADE,
                prodotto TEXT NOT NULL,
                numero_fattura TEXT,
                data_fattura TEXT,
                quantita INTEGER DEFAULT 1,
                descrizione TEXT,
                fonte TEXT
            )
        `);
        // Migrazione: aggiungi colonna descrizione se non esiste (tabella creata prima del 9 feb 2026)
        await client.query(`ALTER TABLE crm_acquisti ADD COLUMN IF NOT EXISTS descrizione TEXT`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_acquisti_contatto ON crm_acquisti(contatto_id)`);

        // Tabella note CRM (storico, una entry per ogni nota)
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_note (
                id SERIAL PRIMARY KEY,
                contatto_id INTEGER REFERENCES crm_contatti(id) ON DELETE CASCADE,
                testo TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_note_contatto ON crm_note(contatto_id)`);

        // Indici composti per performance CRM
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_prodotti_contatto_prodotto ON crm_prodotti(contatto_id, prodotto)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_acquisti_contatto_prodotto ON crm_acquisti(contatto_id, prodotto)`);

        console.log('[DB] Tabelle inizializzate');
    } finally {
        client.release();
    }
}

// Middleware per verificare chiave admin
function requireAdmin(req, res, next) {
    const key = req.query.key || req.headers['x-admin-key'];
    if (key !== CONFIG.ADMIN_KEY) {
        return res.status(401).json({ error: 'Accesso non autorizzato' });
    }
    next();
}

// ==================== API TASKS ====================

// Lista tutti i task (admin)
app.get('/api/tasks', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tasks ORDER BY creato_il DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Lista task per CS (solo tipo 'cs' e non completati)
app.get('/api/tasks/cs', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM tasks
            WHERE tipo = 'cs' AND stato != 'completato'
            ORDER BY
                CASE priorita
                    WHEN 'alta' THEN 1
                    WHEN 'media' THEN 2
                    WHEN 'bassa' THEN 3
                END,
                scadenza ASC NULLS LAST
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Lista task privati admin
app.get('/api/tasks/private', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM tasks WHERE tipo = 'privato' ORDER BY creato_il DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Storico task completati (admin)
app.get('/api/tasks/completed', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM tasks WHERE stato = 'completato' ORDER BY completato_il DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Crea nuovo task
app.post('/api/tasks', requireAdmin, async (req, res) => {
    const { titolo, descrizione, priorita, scadenza, assegnato_a, tipo } = req.body;

    if (!titolo) {
        return res.status(400).json({ error: 'Il titolo è obbligatorio' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO tasks (titolo, descrizione, priorita, scadenza, assegnato_a, tipo)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [titolo, descrizione || '', priorita || 'media', scadenza || null, assegnato_a || null, tipo || 'cs']);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Modifica task
app.put('/api/tasks/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { titolo, descrizione, stato, priorita, scadenza, assegnato_a, tipo } = req.body;

    try {
        const existing = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Task non trovato' });
        }

        const current = existing.rows[0];
        const result = await pool.query(`
            UPDATE tasks SET
                titolo = $1,
                descrizione = $2,
                stato = $3,
                priorita = $4,
                scadenza = $5,
                assegnato_a = $6,
                tipo = $7
            WHERE id = $8
            RETURNING *
        `, [
            titolo !== undefined ? titolo : current.titolo,
            descrizione !== undefined ? descrizione : current.descrizione,
            stato !== undefined ? stato : current.stato,
            priorita !== undefined ? priorita : current.priorita,
            scadenza !== undefined ? scadenza : current.scadenza,
            assegnato_a !== undefined ? assegnato_a : current.assegnato_a,
            tipo !== undefined ? tipo : current.tipo,
            id
        ]);

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Completa task (endpoint specifico per CS)
app.put('/api/tasks/:id/complete', async (req, res) => {
    const id = parseInt(req.params.id);
    const { completato_da } = req.body;

    try {
        const existing = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Task non trovato' });
        }

        const result = await pool.query(`
            UPDATE tasks SET
                stato = 'completato',
                completato_il = NOW(),
                completato_da = $1
            WHERE id = $2
            RETURNING *
        `, [completato_da || 'Operatore CS', id]);

        const task = result.rows[0];

        // Invia notifica Telegram
        sendTelegramNotification(task, completato_da || 'Operatore CS');

        res.json(task);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Cambia stato task (per CS - da_fare, in_corso)
app.put('/api/tasks/:id/status', async (req, res) => {
    const id = parseInt(req.params.id);
    const { stato } = req.body;

    if (!['da_fare', 'in_corso'].includes(stato)) {
        return res.status(400).json({ error: 'Stato non valido' });
    }

    try {
        const existing = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Task non trovato' });
        }

        const result = await pool.query(`
            UPDATE tasks SET stato = $1 WHERE id = $2 RETURNING *
        `, [stato, id]);

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Elimina task
app.delete('/api/tasks/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);

    try {
        const existing = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Task non trovato' });
        }

        await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
        res.json({ message: 'Task eliminato' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Aggiungi commento
app.post('/api/tasks/:id/comments', async (req, res) => {
    const id = parseInt(req.params.id);
    const { testo, autore } = req.body;

    if (!testo) {
        return res.status(400).json({ error: 'Il testo del commento è obbligatorio' });
    }

    try {
        const existing = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Task non trovato' });
        }

        const commenti = existing.rows[0].commenti || [];
        commenti.push({
            id: Date.now(),
            testo,
            autore: autore || 'Anonimo',
            data: new Date().toISOString()
        });

        const result = await pool.query(`
            UPDATE tasks SET commenti = $1 WHERE id = $2 RETURNING *
        `, [JSON.stringify(commenti), id]);

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// ==================== API REPORTS (OSSEOTOUCH) ====================

function requireReportsKey(req, res, next) {
    const key = req.headers['x-api-key'];
    if (key !== CONFIG.REPORTS_API_KEY) {
        return res.status(401).json({ error: 'API key non valida' });
    }
    next();
}

// Ultimi report (uno per tipo) - esclusi report Kim e Massimo che hanno tab dedicati
app.get('/api/reports/latest', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT ON (tipo) id, tipo, titolo, data_report, mese_report, dimensione_kb, created_at
            FROM reports
            WHERE tipo NOT IN ('crediti_kim', 'crediti_massimo', 'vendite_kim', 'vendite_massimo', 'attenzionare_kim', 'attenzionare_massimo')
            ORDER BY tipo, data_report DESC, created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[Reports]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Lista report con filtri e paginazione
app.get('/api/reports', requireAdmin, async (req, res) => {
    try {
        const tipo = req.query.tipo;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        let query, countQuery, params, countParams;

        if (tipo) {
            query = `
                SELECT id, tipo, titolo, data_report, mese_report, dimensione_kb, created_at
                FROM reports
                WHERE tipo = $1
                ORDER BY data_report DESC, created_at DESC
                LIMIT $2 OFFSET $3
            `;
            params = [tipo, limit, offset];
            countQuery = 'SELECT COUNT(*) as totale FROM reports WHERE tipo = $1';
            countParams = [tipo];
        } else {
            query = `
                SELECT id, tipo, titolo, data_report, mese_report, dimensione_kb, created_at
                FROM reports
                ORDER BY data_report DESC, created_at DESC
                LIMIT $1 OFFSET $2
            `;
            params = [limit, offset];
            countQuery = 'SELECT COUNT(*) as totale FROM reports';
            countParams = [];
        }

        const [dataResult, countResult] = await Promise.all([
            pool.query(query, params),
            pool.query(countQuery, countParams)
        ]);

        res.json({
            reports: dataResult.rows,
            totale: parseInt(countResult.rows[0].totale),
            limit,
            offset
        });
    } catch (err) {
        console.error('[Reports]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Singolo report - HTML completo
app.get('/api/reports/:id/html', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT contenuto_html FROM reports WHERE id = $1',
            [parseInt(req.params.id)]
        );
        if (result.rows.length === 0) {
            return res.status(404).send('Report non trovato');
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(result.rows[0].contenuto_html);
    } catch (err) {
        console.error('[Reports]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Crea nuovo report (da COLTRI)
app.post('/api/reports', requireReportsKey, async (req, res) => {
    const { tipo, titolo, data_report, contenuto_html, mese_report, file_originale } = req.body;

    if (!tipo || !titolo || !data_report || !contenuto_html) {
        return res.status(400).json({
            error: 'Campi obbligatori mancanti: tipo, titolo, data_report, contenuto_html'
        });
    }

    const tipiValidi = ['vendite_giornaliero', 'trend_mensile', 'finanziario', 'trend_progressivo', 'crediti_kim', 'crediti_massimo', 'vendite_kim', 'vendite_massimo', 'attenzionare_kim', 'attenzionare_massimo'];
    if (!tipiValidi.includes(tipo)) {
        return res.status(400).json({
            error: `Tipo non valido. Valori ammessi: ${tipiValidi.join(', ')}`
        });
    }

    try {
        const dimensione_kb = Math.round(Buffer.byteLength(contenuto_html, 'utf8') / 1024);

        const result = await pool.query(`
            INSERT INTO reports (tipo, titolo, data_report, mese_report, contenuto_html, file_originale, dimensione_kb)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (tipo, data_report) DO UPDATE SET
                titolo = EXCLUDED.titolo,
                mese_report = EXCLUDED.mese_report,
                contenuto_html = EXCLUDED.contenuto_html,
                file_originale = EXCLUDED.file_originale,
                dimensione_kb = EXCLUDED.dimensione_kb,
                created_at = NOW()
            RETURNING id, tipo, titolo, data_report, dimensione_kb, created_at
        `, [tipo, titolo, data_report, mese_report || null, contenuto_html, file_originale || null, dimensione_kb]);

        console.log(`[Reports] Nuovo report salvato: ${tipo} - ${titolo} (ID: ${result.rows[0].id})`);
        res.status(201).json(result.rows[0]);

        // Notifica Telegram a Kim quando viene caricato/aggiornato un suo report
        if (tipo === 'crediti_kim' || tipo === 'vendite_kim') {
            try {
                const nomeReport = tipo === 'crediti_kim' ? 'Report Crediti' : 'Vendite Progressivo 2026';
                const d = new Date(data_report);
                const giorno = String(d.getDate()).padStart(2, '0');
                const mese = String(d.getMonth() + 1).padStart(2, '0');
                const anno = d.getFullYear();
                const messaggioKim = `📋 *Nuovo ${nomeReport}*\n\n📄 ${titolo}\n📅 Data: ${giorno}/${mese}/${anno}\n\nIl report è stato aggiornato nella dashboard.`;
                sendTelegramReply(CONFIG.TELEGRAM_CHAT_ID_KIM, messaggioKim);
                console.log(`[Reports] Notifica Telegram inviata a Kim per: ${tipo}`);
            } catch (kimNotifErr) {
                console.error('[Reports] Errore notifica Kim:', kimNotifErr);
            }
        }

        // Controlla se tutti e 4 i report del giorno sono pronti
        try {
            const countResult = await pool.query(
                'SELECT COUNT(DISTINCT tipo) as tipi FROM reports WHERE data_report = $1',
                [data_report]
            );
            const tipiPresenti = parseInt(countResult.rows[0].tipi);

            if (tipiPresenti === 4) {
                // Formatta la data per il messaggio
                let messaggio;
                try {
                    const d = new Date(data_report);
                    const giorno = String(d.getDate()).padStart(2, '0');
                    const mese = String(d.getMonth() + 1).padStart(2, '0');
                    const anno = d.getFullYear();
                    messaggio = `📊 Report del giorno ${giorno}/${mese}/${anno} pronti`;
                } catch (e) {
                    messaggio = '📊 Report pronti';
                }

                sendTelegramReply(CONFIG.TELEGRAM_CHAT_ID, messaggio);
                console.log(`[Reports] Notifica Telegram: tutti e 4 i report per ${data_report} sono pronti`);
            }
        } catch (notifErr) {
            console.error('[Reports] Errore check notifica:', notifErr);
        }
    } catch (err) {
        console.error('[Reports]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Elimina report
app.delete('/api/reports/:id', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM reports WHERE id = $1 RETURNING id', [parseInt(req.params.id)]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Report non trovato' });
        }
        res.json({ message: 'Report eliminato' });
    } catch (err) {
        console.error('[Reports]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// ==================== TELEGRAM ====================

async function sendTelegramNotification(task, completatoDa) {
    if (CONFIG.TELEGRAM_BOT_TOKEN === 'IL_TUO_TOKEN_TELEGRAM') {
        console.log('[Telegram] Token non configurato, notifica saltata');
        return;
    }

    const dataCompletamento = new Date(task.completato_il).toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const messaggio = `✅ *Task Completato*

📋 *${task.titolo}*
👤 Completato da: ${completatoDa}
📅 Data: ${dataCompletamento}
${task.priorita === 'alta' ? '🔴 Priorità Alta' : task.priorita === 'media' ? '🟡 Priorità Media' : '🟢 Priorità Bassa'}`;

    const data = JSON.stringify({
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text: messaggio,
        parse_mode: 'Markdown'
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
            if (res.statusCode === 200) {
                console.log('[Telegram] Notifica inviata con successo');
            } else {
                console.log('[Telegram] Errore:', responseData);
            }
        });
    });

    req.on('error', (e) => {
        console.log('[Telegram] Errore connessione:', e.message);
    });

    req.write(data);
    req.end();
}

// ==================== TELEGRAM BOT (Polling per vocali) ====================

let lastUpdateId = 0;

async function startTelegramPolling() {
    if (CONFIG.TELEGRAM_BOT_TOKEN === 'IL_TUO_TOKEN_TELEGRAM') {
        console.log('[Telegram Bot] Token non configurato, polling disabilitato');
        return;
    }

    console.log('[Telegram Bot] Avvio polling per messaggi vocali...');

    setInterval(async () => {
        try {
            const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`;

            https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', async () => {
                    try {
                        const response = JSON.parse(data);
                        if (response.ok && response.result) {
                            for (const update of response.result) {
                                lastUpdateId = update.update_id;
                                await handleTelegramMessage(update.message);
                            }
                        }
                    } catch (e) {}
                });
            }).on('error', () => {});
        } catch (e) {}
    }, 3000);
}

async function handleTelegramMessage(message) {
    if (!message) return;

    const chatId = message.chat.id;

    if (message.voice) {
        await handleVoiceMessage(message, chatId);
        return;
    }

    if (message.text && !message.text.startsWith('/')) {
        try {
            const result = await pool.query(`
                INSERT INTO tasks (titolo, tipo, priorita)
                VALUES ($1, 'cs', 'media')
                RETURNING *
            `, [message.text]);
            await sendTelegramReply(chatId, `✅ Task creato:\n\n📋 *${result.rows[0].titolo}*`);
        } catch (e) {
            await sendTelegramReply(chatId, '❌ Errore nella creazione del task');
        }
        return;
    }

    if (message.text === '/start') {
        await sendTelegramReply(chatId, `👋 Ciao! Sono il bot della Dashboard CS.

📝 *Come usarmi:*
- Invia un messaggio vocale per creare un task
- Invia un messaggio di testo per creare un task
- Il vocale verrà trascritto automaticamente

🎤 Prova a inviarmi un vocale!`);
    }
}

async function handleVoiceMessage(message, chatId) {
    try {
        await sendTelegramReply(chatId, '🎤 Sto trascrivendo il vocale...');

        const fileId = message.voice.file_id;
        const fileInfoUrl = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;

        https.get(fileInfoUrl, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', async () => {
                try {
                    const fileInfo = JSON.parse(data);
                    if (fileInfo.ok) {
                        const filePath = fileInfo.result.file_path;
                        const fileUrl = `https://api.telegram.org/file/bot${CONFIG.TELEGRAM_BOT_TOKEN}/${filePath}`;
                        await transcribeAndCreateTask(fileUrl, chatId);
                    }
                } catch (e) {
                    await sendTelegramReply(chatId, '❌ Errore durante l\'elaborazione del vocale');
                }
            });
        });
    } catch (e) {
        await sendTelegramReply(chatId, '❌ Errore durante l\'elaborazione del vocale');
    }
}

async function transcribeAndCreateTask(audioUrl, chatId) {
    if (CONFIG.OPENAI_API_KEY === 'LA_TUA_API_KEY_OPENAI') {
        await sendTelegramReply(chatId, '❌ API OpenAI non configurata. Configura OPENAI_API_KEY.');
        return;
    }

    const tempFile = path.join(__dirname, 'temp_audio.ogg');
    const file = fs.createWriteStream(tempFile);

    https.get(audioUrl, (response) => {
        response.pipe(file);
        file.on('finish', async () => {
            file.close();

            try {
                const FormData = require('form-data');
                const form = new FormData();
                form.append('file', fs.createReadStream(tempFile), 'audio.ogg');
                form.append('model', 'whisper-1');
                form.append('language', 'it');

                const options = {
                    hostname: 'api.openai.com',
                    path: '/v1/audio/transcriptions',
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`,
                        ...form.getHeaders()
                    }
                };

                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', async () => {
                        try {
                            const result = JSON.parse(data);
                            if (result.text) {
                                const titolo = result.text.length > 100 ? result.text.substring(0, 100) + '...' : result.text;
                                const descrizione = result.text.length > 100 ? result.text : '';

                                const dbResult = await pool.query(`
                                    INSERT INTO tasks (titolo, descrizione, tipo, priorita)
                                    VALUES ($1, $2, 'cs', 'media')
                                    RETURNING *
                                `, [titolo, descrizione]);

                                await sendTelegramReply(chatId, `✅ Task creato da vocale:\n\n📋 *${dbResult.rows[0].titolo}*\n\n📝 Trascrizione: "${result.text}"`);
                            } else {
                                await sendTelegramReply(chatId, '❌ Non sono riuscito a trascrivere il vocale');
                            }
                        } catch (e) {
                            await sendTelegramReply(chatId, '❌ Errore nella trascrizione');
                        }
                        fs.unlink(tempFile, () => {});
                    });
                });

                req.on('error', async () => {
                    await sendTelegramReply(chatId, '❌ Errore di connessione a OpenAI');
                    fs.unlink(tempFile, () => {});
                });

                form.pipe(req);
            } catch (e) {
                await sendTelegramReply(chatId, '❌ Errore durante la trascrizione');
                fs.unlink(tempFile, () => {});
            }
        });
    }).on('error', async () => {
        await sendTelegramReply(chatId, '❌ Errore nel download del file audio');
    });
}

async function sendTelegramReply(chatId, text) {
    const data = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    return new Promise((resolve) => {
        const req = https.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', resolve);
        });
        req.on('error', resolve);
        req.write(data);
        req.end();
    });
}

// ==================== REPORT KIM/MASSIMO (DAL DATABASE) ====================

// Report Kim - Crediti (ultimo dal DB)
app.get('/api/reports-antonia/kim/crediti', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT contenuto_html FROM reports
            WHERE tipo = 'crediti_kim'
            ORDER BY data_report DESC, created_at DESC
            LIMIT 1
        `);
        if (result.rows.length === 0) {
            return res.status(404).send('<h1>Report non trovato</h1><p>Nessun report crediti Kim disponibile.</p>');
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(result.rows[0].contenuto_html);
    } catch (err) {
        console.error('[Reports Kim Crediti]', err);
        res.status(500).send('<h1>Errore server</h1>');
    }
});

// Report Kim - Vendite Progressivo (ultimo dal DB)
app.get('/api/reports-antonia/kim/vendite', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT contenuto_html FROM reports
            WHERE tipo = 'vendite_kim'
            ORDER BY data_report DESC, created_at DESC
            LIMIT 1
        `);
        if (result.rows.length === 0) {
            return res.status(404).send('<h1>Report non trovato</h1><p>Nessun report vendite Kim disponibile.</p>');
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(result.rows[0].contenuto_html);
    } catch (err) {
        console.error('[Reports Kim Vendite]', err);
        res.status(500).send('<h1>Errore server</h1>');
    }
});

// Report Massimo - Crediti (ultimo dal DB)
app.get('/api/reports-antonia/massimo/crediti', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT contenuto_html FROM reports
            WHERE tipo = 'crediti_massimo'
            ORDER BY data_report DESC, created_at DESC
            LIMIT 1
        `);
        if (result.rows.length === 0) {
            return res.status(404).send('<h1>Report non trovato</h1><p>Nessun report crediti Massimo disponibile.</p>');
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(result.rows[0].contenuto_html);
    } catch (err) {
        console.error('[Reports Massimo Crediti]', err);
        res.status(500).send('<h1>Errore server</h1>');
    }
});

// Report Massimo - Vendite Progressivo (ultimo dal DB)
app.get('/api/reports-antonia/massimo/vendite', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT contenuto_html FROM reports
            WHERE tipo = 'vendite_massimo'
            ORDER BY data_report DESC, created_at DESC
            LIMIT 1
        `);
        if (result.rows.length === 0) {
            return res.status(404).send('<h1>Report non trovato</h1><p>Nessun report vendite Massimo disponibile.</p>');
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(result.rows[0].contenuto_html);
    } catch (err) {
        console.error('[Reports Massimo Vendite]', err);
        res.status(500).send('<h1>Errore server</h1>');
    }
});

// Report Kim - Crediti da attenzionare (ultimo dal DB)
app.get('/api/reports-antonia/kim/attenzionare', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT contenuto_html FROM reports
            WHERE tipo = 'attenzionare_kim'
            ORDER BY data_report DESC, created_at DESC
            LIMIT 1
        `);
        if (result.rows.length === 0) {
            return res.status(404).send('<h1>Report non trovato</h1><p>Nessun report attenzionare Kim disponibile.</p>');
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(result.rows[0].contenuto_html);
    } catch (err) {
        console.error('[Reports Kim Attenzionare]', err);
        res.status(500).send('<h1>Errore server</h1>');
    }
});

// Report Massimo - Crediti da attenzionare (ultimo dal DB)
app.get('/api/reports-antonia/massimo/attenzionare', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT contenuto_html FROM reports
            WHERE tipo = 'attenzionare_massimo'
            ORDER BY data_report DESC, created_at DESC
            LIMIT 1
        `);
        if (result.rows.length === 0) {
            return res.status(404).send('<h1>Report non trovato</h1><p>Nessun report attenzionare Massimo disponibile.</p>');
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(result.rows[0].contenuto_html);
    } catch (err) {
        console.error('[Reports Massimo Attenzionare]', err);
        res.status(500).send('<h1>Errore server</h1>');
    }
});

// Info aggiornamento report Kim (dal DB)
app.get('/api/reports-antonia/kim/info', requireAdmin, async (req, res) => {
    try {
        const info = { crediti: null, vendite: null, attenzionare: null, fatture: 0 };

        const fattureCount = await pool.query(`SELECT COUNT(*) as totale FROM fatture WHERE agente = 'kim'`);
        info.fatture = parseInt(fattureCount.rows[0].totale);

        const creditiResult = await pool.query(`
            SELECT data_report FROM reports
            WHERE tipo = 'crediti_kim'
            ORDER BY data_report DESC, created_at DESC
            LIMIT 1
        `);
        if (creditiResult.rows.length > 0) {
            info.crediti = {
                aggiornato: new Date(creditiResult.rows[0].data_report).toLocaleDateString('it-IT', {
                    day: '2-digit', month: 'long', year: 'numeric'
                })
            };
        }

        const venditeResult = await pool.query(`
            SELECT data_report FROM reports
            WHERE tipo = 'vendite_kim'
            ORDER BY data_report DESC, created_at DESC
            LIMIT 1
        `);
        if (venditeResult.rows.length > 0) {
            info.vendite = {
                aggiornato: new Date(venditeResult.rows[0].data_report).toLocaleDateString('it-IT', {
                    day: '2-digit', month: 'long', year: 'numeric'
                })
            };
        }

        const attenzionareResult = await pool.query(`
            SELECT data_report FROM reports
            WHERE tipo = 'attenzionare_kim'
            ORDER BY data_report DESC, created_at DESC
            LIMIT 1
        `);
        if (attenzionareResult.rows.length > 0) {
            info.attenzionare = {
                aggiornato: new Date(attenzionareResult.rows[0].data_report).toLocaleDateString('it-IT', {
                    day: '2-digit', month: 'long', year: 'numeric'
                })
            };
        }

        res.json(info);
    } catch (err) {
        console.error('[Reports Kim Info]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Info aggiornamento report Massimo (dal DB)
app.get('/api/reports-antonia/massimo/info', requireAdmin, async (req, res) => {
    try {
        const info = { crediti: null, vendite: null, attenzionare: null, fatture: 0 };

        const fattureCount = await pool.query(`SELECT COUNT(*) as totale FROM fatture WHERE agente = 'massimo'`);
        info.fatture = parseInt(fattureCount.rows[0].totale);

        const creditiResult = await pool.query(`
            SELECT data_report FROM reports
            WHERE tipo = 'crediti_massimo'
            ORDER BY data_report DESC, created_at DESC
            LIMIT 1
        `);
        if (creditiResult.rows.length > 0) {
            info.crediti = {
                aggiornato: new Date(creditiResult.rows[0].data_report).toLocaleDateString('it-IT', {
                    day: '2-digit', month: 'long', year: 'numeric'
                })
            };
        }

        const venditeResult = await pool.query(`
            SELECT data_report FROM reports
            WHERE tipo = 'vendite_massimo'
            ORDER BY data_report DESC, created_at DESC
            LIMIT 1
        `);
        if (venditeResult.rows.length > 0) {
            info.vendite = {
                aggiornato: new Date(venditeResult.rows[0].data_report).toLocaleDateString('it-IT', {
                    day: '2-digit', month: 'long', year: 'numeric'
                })
            };
        }

        const attenzionareResult = await pool.query(`
            SELECT data_report FROM reports
            WHERE tipo = 'attenzionare_massimo'
            ORDER BY data_report DESC, created_at DESC
            LIMIT 1
        `);
        if (attenzionareResult.rows.length > 0) {
            info.attenzionare = {
                aggiornato: new Date(attenzionareResult.rows[0].data_report).toLocaleDateString('it-IT', {
                    day: '2-digit', month: 'long', year: 'numeric'
                })
            };
        }

        res.json(info);
    } catch (err) {
        console.error('[Reports Massimo Info]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// ==================== FATTURE (PDF) ====================

// Upload fattura PDF (admin)
app.post('/api/fatture', requireAdmin, async (req, res) => {
    const { agente, nome_file, data_fattura, pdf_base64 } = req.body;

    if (!agente || !nome_file || !data_fattura || !pdf_base64) {
        return res.status(400).json({ error: 'Campi obbligatori mancanti: agente, nome_file, data_fattura, pdf_base64' });
    }

    if (!['kim', 'massimo'].includes(agente)) {
        return res.status(400).json({ error: 'Agente non valido. Valori ammessi: kim, massimo' });
    }

    try {
        const base64Data = pdf_base64.includes(',') ? pdf_base64.split(',')[1] : pdf_base64;
        const dimensione_kb = Math.round(Buffer.byteLength(base64Data, 'base64') / 1024);

        const result = await pool.query(`
            INSERT INTO fatture (agente, nome_file, data_fattura, dimensione_kb, pdf_base64)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, agente, nome_file, data_fattura, dimensione_kb, created_at
        `, [agente, nome_file, data_fattura, dimensione_kb, base64Data]);

        console.log(`[Fatture] Nuova fattura caricata: ${nome_file} per ${agente} (ID: ${result.rows[0].id})`);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('[Fatture]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Lista fatture per agente
app.get('/api/fatture/:agente', requireAdmin, async (req, res) => {
    const agente = req.params.agente;

    if (!['kim', 'massimo'].includes(agente)) {
        return res.status(400).json({ error: 'Agente non valido' });
    }

    try {
        const result = await pool.query(`
            SELECT id, agente, nome_file, data_fattura, dimensione_kb, created_at
            FROM fatture
            WHERE agente = $1
            ORDER BY data_fattura DESC, created_at DESC
        `, [agente]);

        res.json(result.rows);
    } catch (err) {
        console.error('[Fatture]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Download/visualizza fattura PDF
app.get('/api/fatture/:agente/download/:id', requireAdmin, async (req, res) => {
    const agente = req.params.agente;
    const id = parseInt(req.params.id);

    try {
        const result = await pool.query(
            'SELECT nome_file, pdf_base64 FROM fatture WHERE id = $1 AND agente = $2',
            [id, agente]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Fattura non trovata' });
        }

        const { nome_file, pdf_base64 } = result.rows[0];
        const pdfBuffer = Buffer.from(pdf_base64, 'base64');

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${nome_file}"`,
            'Content-Length': pdfBuffer.length
        });
        res.send(pdfBuffer);
    } catch (err) {
        console.error('[Fatture]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Elimina fattura
app.delete('/api/fatture/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);

    try {
        const result = await pool.query(
            'DELETE FROM fatture WHERE id = $1 RETURNING id, nome_file',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Fattura non trovata' });
        }

        console.log(`[Fatture] Fattura eliminata: ${result.rows[0].nome_file} (ID: ${id})`);
        res.json({ message: 'Fattura eliminata' });
    } catch (err) {
        console.error('[Fatture]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// ==================== API CRM ====================

// Lista contatti CRM con prodotti e score
app.get('/api/crm/contatti', requireAdmin, async (req, res) => {
    const regione = (req.query.regione || 'LIGURIA').toUpperCase();
    try {
        const contatti = await pool.query(
            `SELECT * FROM crm_contatti WHERE regione = $1
             ORDER BY COALESCE(NULLIF(cognome, ''), nome_azienda) ASC, nome ASC`,
            [regione]
        );
        const ids = contatti.rows.map(c => c.id);
        let prodotti = { rows: [] };
        if (ids.length > 0) {
            prodotti = await pool.query(
                'SELECT * FROM crm_prodotti WHERE contatto_id = ANY($1::int[])',
                [ids]
            );
        }
        const prodMap = {};
        for (const p of prodotti.rows) {
            if (!prodMap[p.contatto_id]) prodMap[p.contatto_id] = [];
            prodMap[p.contatto_id].push({
                prodotto: p.prodotto,
                fonte: p.fonte,
                data_inserimento: p.data_inserimento
            });
        }

        // Carica acquisti ricorrenti per sapere chi ha storico fatture
        let acqMap = {};
        if (ids.length > 0) {
            const acquisti = await pool.query(
                'SELECT contatto_id, prodotto, COUNT(*) as cnt FROM crm_acquisti WHERE contatto_id = ANY($1::int[]) GROUP BY contatto_id, prodotto',
                [ids]
            );
            for (const a of acquisti.rows) {
                const key = `${a.contatto_id}_${a.prodotto}`;
                acqMap[key] = parseInt(a.cnt);
            }
        }

        const result = contatti.rows.map(c => ({
            ...c,
            prodotti: prodMap[c.id] || [],
            acquisti_count: acqMap
        }));
        res.json(result);
    } catch (err) {
        console.error('[CRM]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Storico acquisti ricorrenti per contatto
app.get('/api/crm/contatti/:id/acquisti', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const result = await pool.query(
            'SELECT * FROM crm_acquisti WHERE contatto_id = $1 ORDER BY data_fattura DESC',
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[CRM]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Statistiche CRM
app.get('/api/crm/stats', requireAdmin, async (req, res) => {
    const regione = (req.query.regione || 'LIGURIA').toUpperCase();
    try {
        const totContatti = await pool.query(
            'SELECT COUNT(*) as totale FROM crm_contatti WHERE regione = $1', [regione]
        );
        const conScore = await pool.query(
            'SELECT COUNT(*) as totale FROM crm_contatti WHERE regione = $1 AND score >= 40', [regione]
        );
        const nuoviOdoo = await pool.query(
            `SELECT COUNT(DISTINCT p.contatto_id) as totale FROM crm_prodotti p
             JOIN crm_contatti c ON p.contatto_id = c.id
             WHERE c.regione = $1 AND p.fonte LIKE 'odoo:%'`, [regione]
        );
        res.json({
            tot_contatti: parseInt(totContatti.rows[0].totale),
            con_score: parseInt(conScore.rows[0].totale),
            nuovi_odoo: parseInt(nuoviOdoo.rows[0].totale)
        });
    } catch (err) {
        console.error('[CRM Stats]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Sync CRM: bulk replace per regione
app.post('/api/crm/sync', requireReportsKey, async (req, res) => {
    const { contatti, prodotti, acquisti, regione } = req.body;
    if (!contatti || !regione) {
        return res.status(400).json({ error: 'contatti e regione obbligatori' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Elimina dati esistenti per questa regione (PRESERVA dati dashboard_manual)
        const existing = await client.query(
            'SELECT id FROM crm_contatti WHERE regione = $1', [regione]
        );
        const existingIds = existing.rows.map(r => r.id);
        if (existingIds.length > 0) {
            // Elimina solo acquisti e prodotti NON manuali
            await client.query(
                "DELETE FROM crm_acquisti WHERE contatto_id = ANY($1::int[]) AND (fonte IS NULL OR fonte != 'dashboard_manual')",
                [existingIds]
            );
            await client.query(
                "DELETE FROM crm_prodotti WHERE contatto_id = ANY($1::int[]) AND (fonte IS NULL OR fonte != 'dashboard_manual')",
                [existingIds]
            );
            // crm_note: mai toccata dal sync
        }

        // Upsert contatti (preserva FK per dati dashboard_manual)
        for (const c of contatti) {
            await client.query(`
                INSERT INTO crm_contatti (id, cognome, nome, email, telefono, cellulare, citta, regione, nome_azienda, fonte_sync, data_inserimento, score)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (id) DO UPDATE SET
                    cognome = EXCLUDED.cognome, nome = EXCLUDED.nome, email = EXCLUDED.email,
                    telefono = EXCLUDED.telefono, cellulare = EXCLUDED.cellulare, citta = EXCLUDED.citta,
                    regione = EXCLUDED.regione, nome_azienda = EXCLUDED.nome_azienda,
                    fonte_sync = EXCLUDED.fonte_sync, data_inserimento = EXCLUDED.data_inserimento,
                    score = EXCLUDED.score
            `, [c.id, c.cognome, c.nome, c.email, c.telefono, c.cellulare,
                c.citta, c.regione, c.nome_azienda, c.fonte_sync, c.data_inserimento, c.score || 0]);
        }

        // R2: Se un contatto ha prodotti che richiedono MM ma non ha MM, aggiungi MM
        const INDIPENDENTI_DA_MM = ['IMPIANTI', 'EASYROOT', 'SUTURE', 'CEP'];
        if (prodotti && prodotti.length > 0) {
            const prodPerContatto = {};
            for (const p of prodotti) {
                if (!prodPerContatto[p.contatto_id]) prodPerContatto[p.contatto_id] = new Set();
                prodPerContatto[p.contatto_id].add(p.prodotto);
            }
            for (const [cid, prods] of Object.entries(prodPerContatto)) {
                if (!prods.has('MM')) {
                    const richiedeMM = [...prods].some(p => !INDIPENDENTI_DA_MM.includes(p));
                    if (richiedeMM) {
                        prodotti.push({ contatto_id: parseInt(cid), prodotto: 'MM', data_inserimento: new Date().toISOString().split('T')[0], fonte: 'regola_R2' });
                    }
                }
            }
        }

        // Inserisci prodotti
        if (prodotti && prodotti.length > 0) {
            for (const p of prodotti) {
                await client.query(`
                    INSERT INTO crm_prodotti (contatto_id, prodotto, data_inserimento, fonte)
                    VALUES ($1, $2, $3, $4)
                `, [p.contatto_id, p.prodotto, p.data_inserimento, p.fonte]);
            }
        }

        // Deduplicazione: se il sync ha portato lo stesso prodotto gia' presente come dashboard_manual, rimuovi il duplicato manuale
        if (existingIds.length > 0) {
            await client.query(`
                DELETE FROM crm_prodotti WHERE id IN (
                    SELECT dm.id FROM crm_prodotti dm
                    INNER JOIN crm_prodotti sync ON dm.contatto_id = sync.contatto_id AND dm.prodotto = sync.prodotto
                    WHERE dm.fonte = 'dashboard_manual' AND sync.fonte != 'dashboard_manual'
                    AND dm.contatto_id = ANY($1::int[])
                )
            `, [existingIds]);
        }

        // Inserisci acquisti ricorrenti
        if (acquisti && acquisti.length > 0) {
            for (const a of acquisti) {
                await client.query(`
                    INSERT INTO crm_acquisti (contatto_id, prodotto, numero_fattura, data_fattura, quantita, fonte)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [a.contatto_id, a.prodotto, a.numero_fattura, a.data_fattura, a.quantita || 1, a.fonte]);
            }
        }

        await client.query('COMMIT');
        console.log(`[CRM Sync] ${regione}: ${contatti.length} contatti, ${(prodotti || []).length} prodotti, ${(acquisti || []).length} acquisti`);
        res.json({
            ok: true,
            contatti: contatti.length,
            prodotti: (prodotti || []).length,
            acquisti: (acquisti || []).length
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRM Sync]', err);
        res.status(500).json({ error: 'Errore sync: ' + err.message });
    } finally {
        client.release();
    }
});

// ==================== API CRM INTERATTIVE ====================

const CRM_PRODOTTI = ['MM','ELEVATE','BLACK RUBY','LC','FIRST','EASY IN','EASY PIN',
                      'CEP','GENOA','EASYROOT','IMPIANTI','SUTURE','BLEXO','GUIDATA','PT1'];
const CRM_PRODOTTI_RICORRENTI = ['BLEXO', 'CEP', 'SUTURE'];
const CRM_INDIPENDENTI_DA_MM = ['IMPIANTI', 'EASYROOT', 'SUTURE', 'CEP'];

// Aggiungi prodotto a un contatto
app.post('/api/crm/contatti/:id/prodotti', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    const { prodotto } = req.body;

    if (!prodotto || !CRM_PRODOTTI.includes(prodotto)) {
        return res.status(400).json({ error: `Prodotto non valido. Valori ammessi: ${CRM_PRODOTTI.join(', ')}` });
    }

    try {
        // Verifica che il contatto esista
        const contatto = await pool.query('SELECT id FROM crm_contatti WHERE id = $1', [contattoId]);
        if (contatto.rows.length === 0) {
            return res.status(404).json({ error: 'Contatto non trovato' });
        }

        // Controlla duplicati
        const existing = await pool.query(
            'SELECT id FROM crm_prodotti WHERE contatto_id = $1 AND prodotto = $2',
            [contattoId, prodotto]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: `${prodotto} gia\' presente per questo contatto` });
        }

        const prodottiAggiunti = [prodotto];
        const oggi = new Date().toISOString().split('T')[0];

        // INSERT prodotto
        await pool.query(
            'INSERT INTO crm_prodotti (contatto_id, prodotto, data_inserimento, fonte) VALUES ($1, $2, $3, $4)',
            [contattoId, prodotto, oggi, 'dashboard_manual']
        );

        // R2: se il prodotto richiede MM e il contatto non ha MM, aggiungi MM
        if (!CRM_INDIPENDENTI_DA_MM.includes(prodotto) && prodotto !== 'MM') {
            const hasMM = await pool.query(
                'SELECT id FROM crm_prodotti WHERE contatto_id = $1 AND prodotto = $2',
                [contattoId, 'MM']
            );
            if (hasMM.rows.length === 0) {
                await pool.query(
                    'INSERT INTO crm_prodotti (contatto_id, prodotto, data_inserimento, fonte) VALUES ($1, $2, $3, $4)',
                    [contattoId, 'MM', oggi, 'regola_R2_dashboard']
                );
                prodottiAggiunti.push('MM');
            }
        }

        console.log(`[CRM] Prodotti aggiunti a contatto ${contattoId}: ${prodottiAggiunti.join(', ')}`);
        res.json({
            ok: true,
            prodotti_aggiunti: prodottiAggiunti,
            messaggio: prodottiAggiunti.length > 1
                ? `${prodotto} aggiunto. MM aggiunto automaticamente (regola R2).`
                : `${prodotto} aggiunto.`
        });
    } catch (err) {
        console.error('[CRM Add Prodotto]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Rimuovi prodotto da un contatto
app.delete('/api/crm/contatti/:id/prodotti/:prodotto', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    const prodotto = decodeURIComponent(req.params.prodotto);

    if (!CRM_PRODOTTI.includes(prodotto)) {
        return res.status(400).json({ error: 'Prodotto non valido' });
    }

    try {
        // Verifica che il prodotto esista
        const existing = await pool.query(
            'SELECT id, fonte FROM crm_prodotti WHERE contatto_id = $1 AND prodotto = $2',
            [contattoId, prodotto]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: `${prodotto} non trovato per questo contatto` });
        }

        const prodottiRimossi = [prodotto];

        // Rimuovi il prodotto
        await pool.query(
            'DELETE FROM crm_prodotti WHERE contatto_id = $1 AND prodotto = $2',
            [contattoId, prodotto]
        );

        // Reverse R2: se era un prodotto che richiedeva MM, controlla se MM va rimosso
        if (!CRM_INDIPENDENTI_DA_MM.includes(prodotto) && prodotto !== 'MM') {
            // Controlla se rimangono altri prodotti che richiedono MM
            const remaining = await pool.query(
                'SELECT prodotto FROM crm_prodotti WHERE contatto_id = $1',
                [contattoId]
            );
            const remainingProds = remaining.rows.map(r => r.prodotto);
            const ancoraRichiedeMM = remainingProds.some(p => p !== 'MM' && !CRM_INDIPENDENTI_DA_MM.includes(p));

            if (!ancoraRichiedeMM && remainingProds.includes('MM')) {
                // Rimuovi MM solo se fonte dashboard_manual o regola_R2*
                const mmRecord = await pool.query(
                    "SELECT id, fonte FROM crm_prodotti WHERE contatto_id = $1 AND prodotto = 'MM'",
                    [contattoId]
                );
                if (mmRecord.rows.length > 0) {
                    const mmFonte = mmRecord.rows[0].fonte || '';
                    if (mmFonte === 'dashboard_manual' || mmFonte.startsWith('regola_R2')) {
                        await pool.query(
                            "DELETE FROM crm_prodotti WHERE contatto_id = $1 AND prodotto = 'MM'",
                            [contattoId]
                        );
                        prodottiRimossi.push('MM');
                    }
                }
            }
        }

        console.log(`[CRM] Prodotti rimossi da contatto ${contattoId}: ${prodottiRimossi.join(', ')}`);
        res.json({
            ok: true,
            prodotti_rimossi: prodottiRimossi,
            messaggio: prodottiRimossi.length > 1
                ? `${prodotto} rimosso. MM rimosso automaticamente (non piu\' necessario).`
                : `${prodotto} rimosso.`
        });
    } catch (err) {
        console.error('[CRM Remove Prodotto]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Aggiungi acquisto ricorrente
app.post('/api/crm/contatti/:id/acquisti', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    const { prodotto, numero_fattura, data_fattura, descrizione } = req.body;

    if (!prodotto || !CRM_PRODOTTI_RICORRENTI.includes(prodotto)) {
        return res.status(400).json({ error: `Prodotto non valido. Solo ricorrenti: ${CRM_PRODOTTI_RICORRENTI.join(', ')}` });
    }
    if (!numero_fattura || !numero_fattura.trim()) {
        return res.status(400).json({ error: 'Numero fattura obbligatorio' });
    }
    if (!data_fattura) {
        return res.status(400).json({ error: 'Data fattura obbligatoria' });
    }

    try {
        // Verifica contatto
        const contatto = await pool.query('SELECT id FROM crm_contatti WHERE id = $1', [contattoId]);
        if (contatto.rows.length === 0) {
            return res.status(404).json({ error: 'Contatto non trovato' });
        }

        // INSERT acquisto
        const result = await pool.query(`
            INSERT INTO crm_acquisti (contatto_id, prodotto, numero_fattura, data_fattura, descrizione, fonte)
            VALUES ($1, $2, $3, $4, $5, 'dashboard_manual')
            RETURNING *
        `, [contattoId, prodotto, numero_fattura.trim(), data_fattura, (descrizione || '').trim() || null]);

        // Se il contatto non ha il prodotto in crm_prodotti, aggiungilo
        let prodottoAggiunto = false;
        const hasProd = await pool.query(
            'SELECT id FROM crm_prodotti WHERE contatto_id = $1 AND prodotto = $2',
            [contattoId, prodotto]
        );
        if (hasProd.rows.length === 0) {
            const oggi = new Date().toISOString().split('T')[0];
            await pool.query(
                'INSERT INTO crm_prodotti (contatto_id, prodotto, data_inserimento, fonte) VALUES ($1, $2, $3, $4)',
                [contattoId, prodotto, oggi, 'dashboard_manual']
            );
            prodottoAggiunto = true;
        }

        console.log(`[CRM] Acquisto aggiunto: contatto ${contattoId}, ${prodotto}, fattura ${numero_fattura}`);
        res.json({
            ok: true,
            acquisto: result.rows[0],
            prodotto_aggiunto: prodottoAggiunto
        });
    } catch (err) {
        console.error('[CRM Add Acquisto]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Elimina acquisto ricorrente
app.delete('/api/crm/acquisti/:id', requireAdmin, async (req, res) => {
    const acquistoId = parseInt(req.params.id);
    try {
        const result = await pool.query('DELETE FROM crm_acquisti WHERE id = $1 RETURNING *', [acquistoId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Acquisto non trovato' });
        }
        console.log(`[CRM] Acquisto eliminato: id ${acquistoId}, ${result.rows[0].prodotto}, fattura ${result.rows[0].numero_fattura}`);
        res.json({ ok: true, eliminato: result.rows[0] });
    } catch (err) {
        console.error('[CRM Delete Acquisto]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Note CRM: lista note per contatto
app.get('/api/crm/contatti/:id/note', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    try {
        const result = await pool.query(
            'SELECT * FROM crm_note WHERE contatto_id = $1 ORDER BY created_at DESC',
            [contattoId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[CRM Note]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Note CRM: aggiungi nota
app.post('/api/crm/contatti/:id/note', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    const { testo } = req.body;

    if (!testo || !testo.trim()) {
        return res.status(400).json({ error: 'Testo nota obbligatorio' });
    }

    try {
        const contatto = await pool.query('SELECT id FROM crm_contatti WHERE id = $1', [contattoId]);
        if (contatto.rows.length === 0) {
            return res.status(404).json({ error: 'Contatto non trovato' });
        }

        const result = await pool.query(
            'INSERT INTO crm_note (contatto_id, testo) VALUES ($1, $2) RETURNING *',
            [contattoId, testo.trim()]
        );

        console.log(`[CRM] Nota aggiunta per contatto ${contattoId}`);
        res.json({ ok: true, nota: result.rows[0] });
    } catch (err) {
        console.error('[CRM Add Nota]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Note CRM: modifica nota
app.put('/api/crm/note/:id', requireAdmin, async (req, res) => {
    const noteId = parseInt(req.params.id);
    const { testo } = req.body;
    if (!testo || !testo.trim()) {
        return res.status(400).json({ error: 'Testo nota obbligatorio' });
    }
    try {
        const result = await pool.query(
            'UPDATE crm_note SET testo = $1 WHERE id = $2 RETURNING *',
            [testo.trim(), noteId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Nota non trovata' });
        }
        console.log(`[CRM] Nota modificata: id ${noteId}`);
        res.json({ ok: true, nota: result.rows[0] });
    } catch (err) {
        console.error('[CRM Edit Nota]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Note CRM: elimina nota
app.delete('/api/crm/note/:id', requireAdmin, async (req, res) => {
    const noteId = parseInt(req.params.id);
    try {
        const result = await pool.query('DELETE FROM crm_note WHERE id = $1 RETURNING *', [noteId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Nota non trovata' });
        }
        console.log(`[CRM] Nota eliminata: id ${noteId}`);
        res.json({ ok: true, eliminata: result.rows[0] });
    } catch (err) {
        console.error('[CRM Delete Nota]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Note CRM: conteggio bulk per regione (per caricamento iniziale)
app.get('/api/crm/note/bulk', requireAdmin, async (req, res) => {
    const regione = (req.query.regione || 'LIGURIA').toUpperCase();
    try {
        const result = await pool.query(`
            SELECT n.contatto_id, COUNT(*) as num_note
            FROM crm_note n
            JOIN crm_contatti c ON n.contatto_id = c.id
            WHERE c.regione = $1
            GROUP BY n.contatto_id
        `, [regione]);
        const noteMap = {};
        for (const r of result.rows) {
            noteMap[r.contatto_id] = parseInt(r.num_note);
        }
        res.json(noteMap);
    } catch (err) {
        console.error('[CRM Note Bulk]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// ==================== ROUTES PAGINE ====================

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/cs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cs.html'));
});

app.get('/storico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'storico.html'));
});

app.get('/report', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

app.get('/report-ordini', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'report-ordini.html'));
});

app.get('/report-trend', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'report-trend.html'));
});

app.get('/report-finanza', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'report-finanza.html'));
});

app.get('/crm-liguria', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'crm-liguria.html'));
});

app.get('/', (req, res) => {
    res.redirect('/cs');
});

// ==================== AVVIO SERVER ====================

async function start() {
    await initDB();

    app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║           Dashboard CS - Server Avviato                   ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║   Server:     http://localhost:${PORT}                       ║
║   Database:   PostgreSQL (persistente)                     ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
        `);

        startTelegramPolling();
    });
}

start().catch(err => {
    console.error('Errore avvio server:', err);
    process.exit(1);
});
