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

// Connessione DB con retry (max 5 tentativi)
async function connectWithRetry(maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const client = await pool.connect();
            if (attempt > 1) console.log(`DB connesso al tentativo ${attempt}`);
            return client;
        } catch (err) {
            console.error(`Tentativo ${attempt}/${maxRetries} - Connessione DB fallita: ${err.code || err.message}`);
            if (attempt === maxRetries) throw err;
            const delay = attempt * 3000; // 3s, 6s, 9s, 12s
            console.log(`Riprovo tra ${delay / 1000} secondi...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// Inizializza tabelle
async function initDB() {
    const client = await connectWithRetry();
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
        // Migrazione: soglia riordino personalizzabile per contatto (default 2 mesi)
        await client.query(`ALTER TABLE crm_contatti ADD COLUMN IF NOT EXISTS mesi_riordino INTEGER DEFAULT 2`);
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

        // Tabella opportunita di vendita (follow-up con data scadenza)
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_opportunita (
                id SERIAL PRIMARY KEY,
                contatto_id INTEGER REFERENCES crm_contatti(id) ON DELETE CASCADE,
                testo TEXT NOT NULL,
                data_scadenza DATE NOT NULL,
                vista BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunita_contatto ON crm_opportunita(contatto_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunita_scadenza ON crm_opportunita(data_scadenza)`);

        // Tabella log promozioni lead -> account (per sync bidirezionale con SQLite)
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_promozioni_log (
                id SERIAL PRIMARY KEY,
                contatto_id INTEGER REFERENCES crm_contatti(id) ON DELETE CASCADE,
                prodotti TEXT NOT NULL,
                sincronizzata BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Tabella log modifiche manuali (per sync bidirezionale con SQLite)
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_modifiche_log (
                id SERIAL PRIMARY KEY,
                tipo_modifica TEXT NOT NULL,
                contatto_id INTEGER NOT NULL,
                dettagli JSONB NOT NULL,
                sincronizzata BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_modifiche_sync ON crm_modifiche_log(sincronizzata) WHERE sincronizzata = false`);

        // Tabella score per linea prodotto (aggregato, aggiornato dal sync)
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_score_prodotti (
                id SERIAL PRIMARY KEY,
                contatto_id INTEGER REFERENCES crm_contatti(id) ON DELETE CASCADE,
                linea_prodotto TEXT NOT NULL,
                score INTEGER DEFAULT 0,
                UNIQUE(contatto_id, linea_prodotto)
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_score_contatto ON crm_score_prodotti(contatto_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_score_prodotto ON crm_score_prodotti(linea_prodotto)`);

        // Tabella score manuali (bridge: display immediato prima del sync)
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_score_manuali (
                id SERIAL PRIMARY KEY,
                contatto_id INTEGER REFERENCES crm_contatti(id) ON DELETE CASCADE,
                linea_prodotto TEXT NOT NULL,
                tipo_attivita TEXT NOT NULL,
                punti INTEGER NOT NULL,
                data_evento TEXT NOT NULL,
                sincronizzata BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_score_manuali_contatto ON crm_score_manuali(contatto_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_score_manuali_sync ON crm_score_manuali(sincronizzata) WHERE sincronizzata = false`);

        // Indici composti per performance CRM
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_prodotti_contatto_prodotto ON crm_prodotti(contatto_id, prodotto)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_acquisti_contatto_prodotto ON crm_acquisti(contatto_id, prodotto)`);

        // Migrazione: colonne tipo e mercato per contatti creati da dashboard
        await client.query(`ALTER TABLE crm_contatti ADD COLUMN IF NOT EXISTS tipo TEXT`);
        await client.query(`ALTER TABLE crm_contatti ADD COLUMN IF NOT EXISTS mercato TEXT`);
        await client.query(`ALTER TABLE crm_contatti ADD COLUMN IF NOT EXISTS gruppo_whatsapp BOOLEAN DEFAULT false`);
        await client.query(`ALTER TABLE crm_contatti ADD COLUMN IF NOT EXISTS email_secondaria TEXT`);

        // Migrazione: campi consenso GDPR
        await client.query(`ALTER TABLE crm_contatti ADD COLUMN IF NOT EXISTS consenso_email TEXT`);
        await client.query(`ALTER TABLE crm_contatti ADD COLUMN IF NOT EXISTS consenso_email_data TEXT`);
        await client.query(`ALTER TABLE crm_contatti ADD COLUMN IF NOT EXISTS consenso_email_fonte TEXT`);
        await client.query(`ALTER TABLE crm_contatti ADD COLUMN IF NOT EXISTS email_senza_risposta INTEGER DEFAULT 0`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_contatti_consenso ON crm_contatti(consenso_email)`);

        // Tabella audit log CRM (traccia ogni azione di cancellazione)
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_audit_log (
                id SERIAL PRIMARY KEY,
                azione TEXT NOT NULL,
                tabella TEXT NOT NULL,
                record_id INTEGER,
                contatto_id INTEGER,
                dettagli JSONB,
                utente TEXT DEFAULT 'admin',
                ip TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_azione ON crm_audit_log(azione)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_created ON crm_audit_log(created_at DESC)`);

        // Tabella cestino CRM (soft-delete: i record cancellati finiscono qui)
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_cestino (
                id SERIAL PRIMARY KEY,
                tabella_origine TEXT NOT NULL,
                record_id INTEGER NOT NULL,
                contatto_id INTEGER,
                dati JSONB NOT NULL,
                cancellato_il TIMESTAMPTZ DEFAULT NOW(),
                cancellato_da TEXT DEFAULT 'admin'
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_cestino_tabella ON crm_cestino(tabella_origine)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_cestino_data ON crm_cestino(cancellato_il DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_cestino_contatto ON crm_cestino(contatto_id)`);

        // Tabella WhatsApp clicks (storico click da landing page enrollment)
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_whatsapp_clicks (
                id SERIAL PRIMARY KEY,
                contatto_id INTEGER REFERENCES crm_contatti(id) ON DELETE CASCADE,
                email TEXT NOT NULL,
                gruppo TEXT NOT NULL,
                clicked_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_wa_clicks_email ON crm_whatsapp_clicks(email)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_wa_clicks_data ON crm_whatsapp_clicks(clicked_at DESC)`);

        // Tabella video tracking (storico eventi visualizzazione video da landing page)
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_video_tracking (
                id SERIAL PRIMARY KEY,
                contatto_id INTEGER REFERENCES crm_contatti(id) ON DELETE CASCADE,
                email TEXT NOT NULL,
                campagna TEXT NOT NULL,
                evento TEXT NOT NULL,
                secondi_visti INTEGER DEFAULT 0,
                durata_totale INTEGER DEFAULT 0,
                percentuale INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_video_track_email ON crm_video_tracking(email)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_video_track_campagna ON crm_video_tracking(campagna)`);

        // Tabella audit trail consensi GDPR (PostgreSQL only, come crm_video_tracking)
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_consensi_log (
                id SERIAL PRIMARY KEY,
                contatto_id INTEGER REFERENCES crm_contatti(id) ON DELETE CASCADE,
                email TEXT NOT NULL,
                azione TEXT NOT NULL,
                fonte TEXT NOT NULL,
                campagna TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_consensi_log_contatto ON crm_consensi_log(contatto_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_consensi_log_email ON crm_consensi_log(email)`);

        // ==================== TABELLE YOUTUBE ANALYTICS ====================

        // Anagrafica video del canale
        await client.query(`
            CREATE TABLE IF NOT EXISTS yt_videos (
                id SERIAL PRIMARY KEY,
                video_id TEXT UNIQUE NOT NULL,
                titolo TEXT,
                descrizione TEXT,
                data_pubblicazione TIMESTAMPTZ,
                durata_secondi INTEGER,
                tags TEXT,
                thumbnail_url TEXT,
                playlist_id TEXT,
                prodotto_associato TEXT,
                kol_nome TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Snapshot metriche per video (giornaliero)
        await client.query(`
            CREATE TABLE IF NOT EXISTS yt_metriche (
                id SERIAL PRIMARY KEY,
                video_id TEXT NOT NULL REFERENCES yt_videos(video_id) ON DELETE CASCADE,
                data_snapshot DATE NOT NULL,
                views INTEGER DEFAULT 0,
                likes INTEGER DEFAULT 0,
                commenti INTEGER DEFAULT 0,
                watch_time_minuti REAL DEFAULT 0,
                durata_media_view_secondi REAL,
                retention_percentuale REAL,
                iscritti_guadagnati INTEGER DEFAULT 0,
                iscritti_persi INTEGER DEFAULT 0,
                impressioni INTEGER DEFAULT 0,
                ctr_percentuale REAL,
                UNIQUE(video_id, data_snapshot)
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_yt_metriche_video ON yt_metriche(video_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_yt_metriche_data ON yt_metriche(data_snapshot)`);

        // Fonti traffico per video
        await client.query(`
            CREATE TABLE IF NOT EXISTS yt_traffico (
                id SERIAL PRIMARY KEY,
                video_id TEXT NOT NULL REFERENCES yt_videos(video_id) ON DELETE CASCADE,
                data_snapshot DATE NOT NULL,
                fonte TEXT NOT NULL,
                views INTEGER DEFAULT 0,
                watch_time_minuti REAL DEFAULT 0,
                UNIQUE(video_id, data_snapshot, fonte)
            )
        `);

        // Views per paese
        await client.query(`
            CREATE TABLE IF NOT EXISTS yt_geografia (
                id SERIAL PRIMARY KEY,
                video_id TEXT NOT NULL REFERENCES yt_videos(video_id) ON DELETE CASCADE,
                data_snapshot DATE NOT NULL,
                paese_codice TEXT NOT NULL,
                views INTEGER DEFAULT 0,
                watch_time_minuti REAL DEFAULT 0,
                UNIQUE(video_id, data_snapshot, paese_codice)
            )
        `);

        // Views per dispositivo
        await client.query(`
            CREATE TABLE IF NOT EXISTS yt_dispositivi (
                id SERIAL PRIMARY KEY,
                video_id TEXT NOT NULL REFERENCES yt_videos(video_id) ON DELETE CASCADE,
                data_snapshot DATE NOT NULL,
                dispositivo TEXT NOT NULL,
                views INTEGER DEFAULT 0,
                watch_time_minuti REAL DEFAULT 0,
                UNIQUE(video_id, data_snapshot, dispositivo)
            )
        `);

        // Curva di retention per video (segmenti 0-100%)
        await client.query(`
            CREATE TABLE IF NOT EXISTS yt_retention (
                id SERIAL PRIMARY KEY,
                video_id TEXT NOT NULL REFERENCES yt_videos(video_id) ON DELETE CASCADE,
                data_snapshot DATE NOT NULL,
                segmento_percentuale REAL NOT NULL,
                audience_watch_ratio REAL,
                relative_retention REAL,
                UNIQUE(video_id, data_snapshot, segmento_percentuale)
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_yt_retention_video ON yt_retention(video_id)`);

        // Metriche aggregate canale (storico giornaliero)
        await client.query(`
            CREATE TABLE IF NOT EXISTS yt_canale_storico (
                id SERIAL PRIMARY KEY,
                data_snapshot DATE UNIQUE NOT NULL,
                iscritti_totali INTEGER,
                views_totali BIGINT,
                video_totali INTEGER,
                watch_time_totale_ore REAL,
                iscritti_guadagnati INTEGER DEFAULT 0,
                iscritti_persi INTEGER DEFAULT 0,
                shares INTEGER DEFAULT 0,
                avg_view_duration REAL,
                avg_view_percentage REAL
            )
        `);

        // Aggiungi colonne nuove a tabelle esistenti (safe: IF NOT EXISTS via DO $$ block)
        await client.query(`
            DO $$ BEGIN
                ALTER TABLE yt_metriche ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0;
                ALTER TABLE yt_metriche ADD COLUMN IF NOT EXISTS avg_view_percentage REAL;
                ALTER TABLE yt_canale_storico ADD COLUMN IF NOT EXISTS iscritti_guadagnati INTEGER DEFAULT 0;
                ALTER TABLE yt_canale_storico ADD COLUMN IF NOT EXISTS iscritti_persi INTEGER DEFAULT 0;
                ALTER TABLE yt_canale_storico ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0;
                ALTER TABLE yt_canale_storico ADD COLUMN IF NOT EXISTS avg_view_duration REAL;
                ALTER TABLE yt_canale_storico ADD COLUMN IF NOT EXISTS avg_view_percentage REAL;
                ALTER TABLE yt_videos ADD COLUMN IF NOT EXISTS promosso BOOLEAN DEFAULT FALSE;
                ALTER TABLE yt_videos ADD COLUMN IF NOT EXISTS views_lifetime INTEGER DEFAULT 0;
                ALTER TABLE yt_videos ADD COLUMN IF NOT EXISTS likes_lifetime INTEGER DEFAULT 0;
                ALTER TABLE yt_videos ADD COLUMN IF NOT EXISTS commenti_lifetime INTEGER DEFAULT 0;
                ALTER TABLE yt_videos ADD COLUMN IF NOT EXISTS categoria TEXT;
            END $$;
        `);

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

// ==================== CRM AUDIT & SOFT-DELETE ====================

async function logAndTrash(client, { azione, tabella, recordId, contattoId, dati, ip }) {
    // 1. Salva nel cestino (soft-delete)
    await client.query(
        `INSERT INTO crm_cestino (tabella_origine, record_id, contatto_id, dati)
         VALUES ($1, $2, $3, $4)`,
        [tabella, recordId, contattoId, JSON.stringify(dati)]
    );
    // 2. Registra nell'audit log
    await client.query(
        `INSERT INTO crm_audit_log (azione, tabella, record_id, contatto_id, dettagli, ip)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [azione, tabella, recordId, contattoId, JSON.stringify(dati), ip]
    );
    // 3. Controlla soglia alert (>5 cancellazioni in 10 minuti)
    const countResult = await client.query(
        `SELECT COUNT(*) as cnt FROM crm_audit_log
         WHERE azione LIKE 'delete_%' AND created_at > NOW() - INTERVAL '10 minutes'`
    );
    const count = parseInt(countResult.rows[0].cnt);
    if (count > 0 && count % 5 === 0) {
        const msg = `⚠️ *ALERT CRM*\n\n🗑️ ${count} cancellazioni negli ultimi 10 minuti\n\n` +
                    `Ultima: ${azione}\nTabella: ${tabella}\nContatto ID: ${contattoId}\n` +
                    `IP: ${ip || 'N/A'}\n\n_Controlla la dashboard._`;
        sendTelegramReply(CONFIG.TELEGRAM_CHAT_ID, msg);
        console.log(`[CRM Audit] Alert Telegram inviato: ${count} cancellazioni in 10 min`);
    }
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

// Soglia hot score per regione (default 40, LOMBARDIA 150)
const SOGLIA_HOT_PER_REGIONE = { 'LOMBARDIA': 150 };
const SOGLIA_HOT_DEFAULT = 40;
function getSogliaHot(regione) {
    return SOGLIA_HOT_PER_REGIONE[regione] || SOGLIA_HOT_DEFAULT;
}

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

        // Carica acquisti ricorrenti per sapere chi ha storico fatture + data ultimo acquisto
        let acqMap = {};
        let acqLastDateMap = {};
        if (ids.length > 0) {
            const acquisti = await pool.query(
                'SELECT contatto_id, prodotto, COUNT(*) as cnt, MAX(data_fattura) as ultima_data FROM crm_acquisti WHERE contatto_id = ANY($1::int[]) GROUP BY contatto_id, prodotto',
                [ids]
            );
            for (const a of acquisti.rows) {
                const key = `${a.contatto_id}_${a.prodotto}`;
                acqMap[key] = parseInt(a.cnt);
                if (a.ultima_data) acqLastDateMap[key] = a.ultima_data;
            }
        }

        // Carica score per linea prodotto (per mostrare fiamma hot nel CRM)
        // Combina crm_score_prodotti + crm_score_manuali non ancora sincronizzati
        let scoreMap = {};
        if (ids.length > 0) {
            const soglia = getSogliaHot(regione);
            const scores = await pool.query(`
                SELECT contatto_id, linea_prodotto, SUM(score) as score FROM (
                    SELECT contatto_id, linea_prodotto, score FROM crm_score_prodotti
                    WHERE contatto_id = ANY($1::int[])
                    UNION ALL
                    SELECT contatto_id, linea_prodotto, punti as score FROM crm_score_manuali
                    WHERE sincronizzata = false AND contatto_id = ANY($1::int[])
                ) combined
                GROUP BY contatto_id, linea_prodotto
                HAVING SUM(score) >= $2
            `, [ids, soglia]);
            for (const s of scores.rows) {
                if (!scoreMap[s.contatto_id]) scoreMap[s.contatto_id] = {};
                scoreMap[s.contatto_id][s.linea_prodotto] = parseInt(s.score);
            }
        }

        // Icone video engagement: conta quanti video completati (>=90%) per linea prodotto
        // ▶ = 1-2 video completati, ▶▶ = 3+ video completati sulla stessa linea
        let videoIconsMap = {};
        if (ids.length > 0) {
            const videoCompletions = await pool.query(`
                SELECT contatto_id,
                       SPLIT_PART(REGEXP_REPLACE(campagna, '_TEST$', ''), '_SF_', 1) as linea,
                       COUNT(DISTINCT campagna) as num_video
                FROM crm_video_tracking
                WHERE contatto_id = ANY($1::int[])
                  AND evento = 'score_90'
                GROUP BY contatto_id, SPLIT_PART(REGEXP_REPLACE(campagna, '_TEST$', ''), '_SF_', 1)
            `, [ids]);
            for (const v of videoCompletions.rows) {
                if (!videoIconsMap[v.contatto_id]) videoIconsMap[v.contatto_id] = {};
                videoIconsMap[v.contatto_id][v.linea] = parseInt(v.num_video);
            }
        }

        const result = contatti.rows.map(c => ({
            ...c,
            prodotti: prodMap[c.id] || [],
            acquisti_count: acqMap,
            acquisti_last_date: acqLastDateMap,
            score_hot: scoreMap[c.id] || {},
            video_icons: videoIconsMap[c.id] || {}
        }));
        res.json(result);
    } catch (err) {
        console.error('[CRM]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Contatti creati manualmente dalla dashboard (per pull verso SQLite)
// IMPORTANTE: deve stare PRIMA di /api/crm/contatti/:id/* per evitare che Express interpreti "dashboard-manual" come :id
app.get('/api/crm/contatti/dashboard-manual', requireAdmin, async (req, res) => {
    try {
        const contatti = await pool.query(
            "SELECT * FROM crm_contatti WHERE fonte_sync = 'dashboard_manual' AND id < 0"
        );
        if (contatti.rows.length === 0) return res.json([]);

        const ids = contatti.rows.map(c => c.id);
        const prodotti = await pool.query(
            'SELECT * FROM crm_prodotti WHERE contatto_id = ANY($1::int[])', [ids]
        );
        const prodMap = {};
        for (const p of prodotti.rows) {
            if (!prodMap[p.contatto_id]) prodMap[p.contatto_id] = [];
            prodMap[p.contatto_id].push(p);
        }

        res.json(contatti.rows.map(c => ({ ...c, prodotti: prodMap[c.id] || [] })));
    } catch (err) {
        console.error('[CRM Dashboard Manual]', err);
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
        const totAccount = await pool.query(
            "SELECT COUNT(*) as totale FROM crm_contatti WHERE regione = $1 AND (tipo = 'account' OR tipo IS NULL)", [regione]
        );
        const totLead = await pool.query(
            "SELECT COUNT(*) as totale FROM crm_contatti WHERE regione = $1 AND tipo = 'lead'", [regione]
        );
        const sogliaStats = getSogliaHot(regione);
        const conScore = await pool.query(`
            SELECT COUNT(DISTINCT contatto_id) as totale FROM (
                SELECT contatto_id, linea_prodotto, SUM(score) as total FROM (
                    SELECT contatto_id, linea_prodotto, score FROM crm_score_prodotti
                    UNION ALL
                    SELECT contatto_id, linea_prodotto, punti FROM crm_score_manuali WHERE sincronizzata = false
                ) combined
                WHERE contatto_id IN (SELECT id FROM crm_contatti WHERE regione = $1)
                GROUP BY contatto_id, linea_prodotto
                HAVING SUM(score) >= $2
            ) hot
        `, [regione, sogliaStats]);
        const clientiFattura2026 = await pool.query(
            `SELECT COUNT(DISTINCT a.contatto_id) as totale
             FROM crm_acquisti a
             JOIN crm_contatti c ON a.contatto_id = c.id
             WHERE c.regione = $1
               AND (c.tipo = 'account' OR c.tipo IS NULL)
               AND a.fonte LIKE 'odoo:INV/2026/%'`, [regione]
        );
        res.json({
            tot_contatti: parseInt(totAccount.rows[0].totale),
            tot_lead: parseInt(totLead.rows[0].totale),
            con_score: parseInt(conScore.rows[0].totale),
            nuovi_odoo: parseInt(clientiFattura2026.rows[0].totale),
            soglia_hot: sogliaStats
        });
    } catch (err) {
        console.error('[CRM Stats]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Crea nuovo contatto (da dashboard)
app.post('/api/crm/contatti', requireAdmin, async (req, res) => {
    const { cognome, nome, email, telefono, cellulare, citta, regione, tipo, prodotti } = req.body;

    // Validazione email
    if (!email || !email.trim()) {
        return res.status(400).json({ error: 'Email obbligatoria' });
    }
    const emailClean = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailClean)) {
        return res.status(400).json({ error: 'Formato email non valido' });
    }

    // Almeno cognome o nome
    if (!cognome?.trim() && !nome?.trim()) {
        return res.status(400).json({ error: 'Inserire almeno Nome o Cognome' });
    }

    // Citta obbligatoria (R3: uppercase)
    if (!citta?.trim()) {
        return res.status(400).json({ error: 'Citta obbligatoria' });
    }
    const cittaClean = citta.trim().toUpperCase();

    // R1: normalizza telefoni (rimuovi +39, classifica per prima cifra)
    let telClean = (telefono || '').trim().replace(/^\+39\s*/, '').replace(/[\s\-\.]/g, '');
    let celClean = (cellulare || '').trim().replace(/^\+39\s*/, '').replace(/[\s\-\.]/g, '');

    if (telClean && telClean.startsWith('3') && !celClean) {
        celClean = telClean; telClean = '';
    }
    if (celClean && celClean.startsWith('0') && !telClean) {
        telClean = celClean; celClean = '';
    }

    if (!telClean && !celClean) {
        return res.status(400).json({ error: 'Inserire almeno un numero di telefono o cellulare' });
    }

    // Tipo validazione
    const tipoClean = (tipo || 'lead').toLowerCase();
    if (!['lead', 'account'].includes(tipoClean)) {
        return res.status(400).json({ error: 'Tipo deve essere lead o account' });
    }

    const regioneClean = (regione || 'LIGURIA').toUpperCase();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verifica unicita email
        const existing = await client.query(
            'SELECT id, cognome, nome FROM crm_contatti WHERE LOWER(email) = $1',
            [emailClean]
        );
        if (existing.rows.length > 0) {
            const ex = existing.rows[0];
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: `Email gia presente: ${ex.cognome || ''} ${ex.nome || ''} (ID: ${ex.id})`
            });
        }

        // Genera prossimo ID negativo (evita collisione con SQLite AUTOINCREMENT positivi)
        const minId = await client.query('SELECT COALESCE(MIN(id), 0) as min_id FROM crm_contatti WHERE id < 0');
        const newId = Math.min(minId.rows[0].min_id, 0) - 1;

        const oggi = new Date().toISOString().split('T')[0];

        // Inserisci contatto
        await client.query(`
            INSERT INTO crm_contatti (id, cognome, nome, email, telefono, cellulare, citta, regione, nome_azienda, fonte_sync, data_inserimento, score, tipo, mercato)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12, $13)
        `, [newId, (cognome || '').trim(), (nome || '').trim(), emailClean,
            telClean || null, celClean || null, cittaClean, regioneClean, null, 'dashboard_manual', oggi,
            tipoClean, 'ITALY']);

        // Inserisci prodotti se account con prodotti selezionati
        const prodottiAggiunti = [];
        if (prodotti && Array.isArray(prodotti) && prodotti.length > 0) {
            const prodottiValidi = prodotti.filter(p => CRM_PRODOTTI.includes(p));
            const prodSet = new Set(prodottiValidi);
            const prodottiScelti = new Set(prodottiValidi); // per distinguere fonte

            // R2: se un prodotto richiede MM e MM non presente, aggiungi MM
            if (!prodSet.has('MM')) {
                const richiedeMM = [...prodSet].some(p => !CRM_INDIPENDENTI_DA_MM.includes(p));
                if (richiedeMM) prodSet.add('MM');
            }

            for (const p of prodSet) {
                const fonte = prodottiScelti.has(p) ? 'dashboard_manual' : 'regola_R2_dashboard';
                await client.query(
                    'INSERT INTO crm_prodotti (contatto_id, prodotto, data_inserimento, fonte) VALUES ($1, $2, $3, $4)',
                    [newId, p, oggi, fonte]
                );
                prodottiAggiunti.push(p);
            }
        }

        // Logga in crm_modifiche_log per sync bidirezionale (new_contatto)
        await client.query(
            `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
             VALUES ('new_contatto', $1, $2)`,
            [newId, JSON.stringify({
                cognome: (cognome || '').trim(),
                nome: (nome || '').trim(),
                email: emailClean,
                telefono: telClean || null,
                cellulare: celClean || null,
                citta: cittaClean,
                regione: regioneClean,
                tipo: tipoClean,
                mercato: 'ITALY',
                prodotti: prodottiAggiunti
            })]
        );

        await client.query('COMMIT');

        console.log(`[CRM] Nuovo contatto creato: ${cognome || nome} <${emailClean}> ID=${newId} tipo=${tipoClean} regione=${regioneClean}`);

        res.status(201).json({
            ok: true,
            id: newId,
            email: emailClean,
            tipo: tipoClean,
            prodotti_aggiunti: prodottiAggiunti,
            messaggio: `Contatto creato con successo`
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRM Nuovo Contatto]', err);
        res.status(500).json({ error: 'Errore server: ' + err.message });
    } finally {
        client.release();
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
        const FONTI_PROTETTE = ['dashboard_manual', 'dashboard_promozione', 'regola_R2_dashboard', 'finder_email_whatsapp', 'migrazione_fatture_preodoo'];
        if (existingIds.length > 0) {
            // Elimina solo acquisti e prodotti NON protetti (protegge fonti che non devono essere sovrascritte dal sync)
            await client.query(
                "DELETE FROM crm_acquisti WHERE contatto_id = ANY($1::int[]) AND (fonte IS NULL OR fonte != ALL($2::text[]))",
                [existingIds, FONTI_PROTETTE]
            );
            await client.query(
                "DELETE FROM crm_prodotti WHERE contatto_id = ANY($1::int[]) AND (fonte IS NULL OR fonte != ALL($2::text[]))",
                [existingIds, FONTI_PROTETTE]
            );
            // crm_note: mai toccata dal sync
        }

        // Upsert contatti (preserva FK per dati dashboard_manual)
        for (const c of contatti) {
            await client.query(`
                INSERT INTO crm_contatti (id, cognome, nome, email, telefono, cellulare, citta, regione, nome_azienda, fonte_sync, data_inserimento, score, tipo, mercato, gruppo_whatsapp, email_secondaria, consenso_email, consenso_email_data, consenso_email_fonte, email_senza_risposta)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                ON CONFLICT (id) DO UPDATE SET
                    cognome = EXCLUDED.cognome, nome = EXCLUDED.nome, email = EXCLUDED.email,
                    telefono = EXCLUDED.telefono, cellulare = EXCLUDED.cellulare, citta = EXCLUDED.citta,
                    regione = EXCLUDED.regione, nome_azienda = EXCLUDED.nome_azienda,
                    fonte_sync = EXCLUDED.fonte_sync, data_inserimento = EXCLUDED.data_inserimento,
                    score = EXCLUDED.score, tipo = EXCLUDED.tipo, mercato = EXCLUDED.mercato,
                    gruppo_whatsapp = CASE WHEN EXCLUDED.gruppo_whatsapp = true THEN true ELSE crm_contatti.gruppo_whatsapp END,
                    email_secondaria = COALESCE(EXCLUDED.email_secondaria, crm_contatti.email_secondaria),
                    consenso_email = COALESCE(EXCLUDED.consenso_email, crm_contatti.consenso_email),
                    consenso_email_data = COALESCE(EXCLUDED.consenso_email_data, crm_contatti.consenso_email_data),
                    consenso_email_fonte = COALESCE(EXCLUDED.consenso_email_fonte, crm_contatti.consenso_email_fonte),
                    email_senza_risposta = CASE
                        WHEN EXCLUDED.email_senza_risposta > COALESCE(crm_contatti.email_senza_risposta, 0)
                        THEN EXCLUDED.email_senza_risposta
                        ELSE COALESCE(crm_contatti.email_senza_risposta, EXCLUDED.email_senza_risposta)
                    END
            `, [c.id, c.cognome, c.nome, c.email, c.telefono, c.cellulare,
                c.citta, c.regione, c.nome_azienda, c.fonte_sync, c.data_inserimento, c.score || 0,
                c.tipo || null, c.mercato || null, c.gruppo_whatsapp || false, c.email_secondaria || null,
                c.consenso_email || null, c.consenso_email_data || null, c.consenso_email_fonte || null, c.email_senza_risposta || 0]);
        }

        // Rimuovi contatti della regione che non sono piu' nel payload SQLite
        // (es. contatti cancellati localmente). Protegge contatti creati dalla dashboard (fonte_sync NULL o dashboard_manual)
        const syncIds = contatti.map(c => c.id);
        const orfani = existingIds.filter(eid => !syncIds.includes(eid));
        if (orfani.length > 0) {
            // Elimina solo se NON creati manualmente dalla dashboard
            const orfResult = await client.query(
                "SELECT id FROM crm_contatti WHERE id = ANY($1::int[]) AND (fonte_sync IS NULL OR fonte_sync NOT IN ('dashboard_manual'))",
                [orfani]
            );
            const idsToDelete = orfResult.rows.map(r => r.id);
            if (idsToDelete.length > 0) {
                // CASCADE sulle FK elimina prodotti, acquisti, score, note collegati
                await client.query('DELETE FROM crm_contatti WHERE id = ANY($1::int[])', [idsToDelete]);
                console.log(`[CRM Sync] ${regione}: rimossi ${idsToDelete.length} contatti orfani: ${idsToDelete.join(', ')}`);
            }
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
                        prodotti.push({ contatto_id: parseInt(cid), prodotto: 'MM', data_inserimento: new Date().toISOString().split('T')[0], fonte: 'regola_R2_dashboard' });
                    }
                }
            }
        }

        // Inserisci prodotti (skip se esiste gia' stesso contatto+prodotto con fonte protetta)
        if (prodotti && prodotti.length > 0) {
            // Riusa FONTI_PROTETTE definita sopra (include migrazione_fatture_preodoo)
            let existingProtected = new Set();
            if (existingIds.length > 0) {
                const epResult = await client.query(
                    `SELECT contatto_id, prodotto FROM crm_prodotti
                     WHERE contatto_id = ANY($1::int[]) AND fonte = ANY($2::text[])`,
                    [existingIds, FONTI_PROTETTE]
                );
                for (const row of epResult.rows) {
                    existingProtected.add(`${row.contatto_id}_${row.prodotto}`);
                }
            }
            for (const p of prodotti) {
                const key = `${p.contatto_id}_${p.prodotto}`;
                if (existingProtected.has(key)) continue; // gia' presente con fonte protetta, skip
                await client.query(`
                    INSERT INTO crm_prodotti (contatto_id, prodotto, data_inserimento, fonte)
                    VALUES ($1, $2, $3, $4)
                `, [p.contatto_id, p.prodotto, p.data_inserimento, p.fonte]);
            }
        }

        // Deduplicazione: se il sync ha portato lo stesso prodotto gia' presente come protetto, rimuovi il protetto.
        // Nota: se il prodotto nel SQLite ha la stessa fonte protetta (es. dashboard_manual), la DELETE non lo tocca,
        // il check anti-duplicato lo salta, e questa dedup non lo matcha (entrambi protetti). Risultato corretto: nessun accumulo.
        if (existingIds.length > 0) {
            await client.query(`
                DELETE FROM crm_prodotti WHERE id IN (
                    SELECT dm.id FROM crm_prodotti dm
                    INNER JOIN crm_prodotti sync ON dm.contatto_id = sync.contatto_id AND dm.prodotto = sync.prodotto
                    WHERE dm.fonte = ANY($2::text[])
                    AND NOT (sync.fonte = ANY($2::text[]))
                    AND dm.contatto_id = ANY($1::int[])
                )
            `, [existingIds, FONTI_PROTETTE]);
        }

        // Inserisci acquisti ricorrenti (skip se esiste gia' stesso contatto+prodotto+fattura con fonte protetta)
        if (acquisti && acquisti.length > 0) {
            let existingProtectedAcq = new Set();
            if (existingIds.length > 0) {
                const epAcqResult = await client.query(
                    `SELECT contatto_id, prodotto, COALESCE(numero_fattura, '') as numero_fattura FROM crm_acquisti
                     WHERE contatto_id = ANY($1::int[]) AND fonte = ANY($2::text[])`,
                    [existingIds, FONTI_PROTETTE]
                );
                for (const row of epAcqResult.rows) {
                    existingProtectedAcq.add(`${row.contatto_id}_${row.prodotto}_${row.numero_fattura}`);
                }
            }
            for (const a of acquisti) {
                const key = `${a.contatto_id}_${a.prodotto}_${a.numero_fattura || ''}`;
                if (existingProtectedAcq.has(key)) continue; // gia' presente con fonte protetta, skip
                await client.query(`
                    INSERT INTO crm_acquisti (contatto_id, prodotto, numero_fattura, data_fattura, quantita, fonte)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [a.contatto_id, a.prodotto, a.numero_fattura, a.data_fattura, a.quantita || 1, a.fonte]);
            }
        }

        // Score per linea prodotto (da score_eventi aggregati)
        // Elimina score esistenti per questa regione, poi inserisci
        if (existingIds.length > 0) {
            await client.query(
                'DELETE FROM crm_score_prodotti WHERE contatto_id = ANY($1::int[])',
                [existingIds]
            );
        }
        for (const c of contatti) {
            if (c.score_prodotti && typeof c.score_prodotti === 'object') {
                for (const [linea, punteggio] of Object.entries(c.score_prodotti)) {
                    if (punteggio > 0) {
                        await client.query(`
                            INSERT INTO crm_score_prodotti (contatto_id, linea_prodotto, score)
                            VALUES ($1, $2, $3)
                            ON CONFLICT (contatto_id, linea_prodotto) DO UPDATE SET score = EXCLUDED.score
                        `, [c.id, linea, punteggio]);
                    }
                }
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

// Pulizia duplicati prodotti (one-shot): rimuove righe duplicate in crm_prodotti (stesso contatto_id + prodotto)
// Mantiene la riga con id piu' basso (la prima inserita)
app.post('/api/crm/cleanup-duplicati-prodotti', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            DELETE FROM crm_prodotti WHERE id IN (
                SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER (PARTITION BY contatto_id, prodotto ORDER BY id) as rn
                    FROM crm_prodotti
                ) ranked WHERE rn > 1
            )
        `);
        console.log(`[CRM Cleanup] Rimossi ${result.rowCount} prodotti duplicati`);
        res.json({ ok: true, rimossi: result.rowCount });
    } catch (err) {
        console.error('[CRM Cleanup]', err);
        res.status(500).json({ error: err.message });
    }
});

// Pulizia duplicati acquisti (one-shot): rimuove righe duplicate in crm_acquisti (stesso contatto_id + prodotto + numero_fattura)
app.post('/api/crm/cleanup-duplicati-acquisti', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            DELETE FROM crm_acquisti WHERE id IN (
                SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER (PARTITION BY contatto_id, prodotto, numero_fattura ORDER BY id) as rn
                    FROM crm_acquisti
                ) ranked WHERE rn > 1
            )
        `);
        console.log(`[CRM Cleanup] Rimossi ${result.rowCount} acquisti duplicati`);
        res.json({ ok: true, rimossi: result.rowCount });
    } catch (err) {
        console.error('[CRM Cleanup]', err);
        res.status(500).json({ error: err.message });
    }
});

// Riassegna ID contatti dopo import in SQLite (da ID negativi temporanei a ID reali positivi)
app.post('/api/crm/contatti/reassign-ids', requireReportsKey, async (req, res) => {
    const { mapping } = req.body;
    if (!mapping || typeof mapping !== 'object') {
        return res.status(400).json({ error: 'mapping obbligatorio (oggetto {oldId: newId})' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let updated = 0;

        for (const [oldIdStr, newId] of Object.entries(mapping)) {
            const oldId = parseInt(oldIdStr);
            const nw = parseInt(newId);
            if (isNaN(oldId) || isNaN(nw)) continue;

            // Verifica che il contatto con oldId esista
            const contact = await client.query('SELECT * FROM crm_contatti WHERE id = $1', [oldId]);
            if (contact.rows.length === 0) continue;
            const c = contact.rows[0];

            // Aggiorna FK in tutte le tabelle correlate
            await client.query('UPDATE crm_prodotti SET contatto_id = $1 WHERE contatto_id = $2', [nw, oldId]);
            await client.query('UPDATE crm_acquisti SET contatto_id = $1 WHERE contatto_id = $2', [nw, oldId]);
            await client.query('UPDATE crm_note SET contatto_id = $1 WHERE contatto_id = $2', [nw, oldId]);
            await client.query('UPDATE crm_opportunita SET contatto_id = $1 WHERE contatto_id = $2', [nw, oldId]);
            await client.query('UPDATE crm_score_prodotti SET contatto_id = $1 WHERE contatto_id = $2', [nw, oldId]);

            // Sostituisci il contatto (DELETE vecchio + INSERT con nuovo ID)
            await client.query('DELETE FROM crm_contatti WHERE id = $1', [oldId]);
            await client.query(`
                INSERT INTO crm_contatti (id, cognome, nome, email, telefono, cellulare, citta, regione, nome_azienda, fonte_sync, data_inserimento, score, mesi_riordino, tipo, mercato)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            `, [nw, c.cognome, c.nome, c.email, c.telefono, c.cellulare, c.citta, c.regione, c.nome_azienda, c.fonte_sync, c.data_inserimento, c.score, c.mesi_riordino, c.tipo, c.mercato]);
            updated++;
        }

        await client.query('COMMIT');
        console.log(`[CRM Reassign] ${updated} contatti aggiornati con ID reali`);
        res.json({ ok: true, updated });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRM Reassign]', err);
        res.status(500).json({ error: 'Errore: ' + err.message });
    } finally {
        client.release();
    }
});

// ==================== API CRM INTERATTIVE ====================

const CRM_PRODOTTI = ['MM','ELEVATE','BLACK RUBY','LC','FIRST','EASY IN','EASY PIN',
                      'CEP','GENOA','EASYROOT','IMPIANTI','SUTURE','BLEXO','GUIDATA','PT1'];
const CRM_PRODOTTI_RICORRENTI = ['BLEXO', 'CEP', 'SUTURE'];
const CRM_INDIPENDENTI_DA_MM = ['IMPIANTI', 'EASYROOT', 'SUTURE', 'CEP'];

// Attivita' offline con punteggio fisso (score manuale)
const ATTIVITA_OFFLINE = {
    'richiesta_prodotto_stand': { label: 'Richiesta prodotto allo stand', punti: 30 },
    'richiesta_trial_surgery':  { label: 'Richiesta trial surgery', punti: 50 },
    'richiesta_info_corsi':     { label: 'Richieste informazioni: corsi', punti: 25 },
    'partecipazione_corso':     { label: 'Partecipazione a corso', punti: 100 },
    'richiesta_offerta':        { label: 'Richiesta di offerta', punti: 50 }
};

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

        // Logga in crm_modifiche_log per sync bidirezionale con SQLite
        const dettagliProdotti = prodottiAggiunti.map(p => ({
            prodotto: p,
            fonte: p === prodotto ? 'dashboard_manual' : 'regola_R2_dashboard'
        }));
        await pool.query(
            `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli) VALUES ('add_prodotto', $1, $2)`,
            [contattoId, JSON.stringify({ prodotti_aggiunti: dettagliProdotti })]
        );

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

// Rimuovi prodotto da un contatto (con soft-delete + audit)
app.delete('/api/crm/contatti/:id/prodotti/:prodotto', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    const prodotto = decodeURIComponent(req.params.prodotto);

    if (!CRM_PRODOTTI.includes(prodotto)) {
        return res.status(400).json({ error: 'Prodotto non valido' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verifica che il prodotto esista
        const existing = await client.query(
            'SELECT * FROM crm_prodotti WHERE contatto_id = $1 AND prodotto = $2',
            [contattoId, prodotto]
        );
        if (existing.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: `${prodotto} non trovato per questo contatto` });
        }

        const prodottiRimossi = [prodotto];

        // Audit + cestino per il prodotto principale
        await logAndTrash(client, {
            azione: 'delete_prodotto',
            tabella: 'crm_prodotti',
            recordId: existing.rows[0].id,
            contattoId: contattoId,
            dati: existing.rows[0],
            ip: req.ip
        });

        // Rimuovi il prodotto
        await client.query(
            'DELETE FROM crm_prodotti WHERE contatto_id = $1 AND prodotto = $2',
            [contattoId, prodotto]
        );

        // Reverse R2: se era un prodotto che richiedeva MM, controlla se MM va rimosso
        if (!CRM_INDIPENDENTI_DA_MM.includes(prodotto) && prodotto !== 'MM') {
            const remaining = await client.query(
                'SELECT prodotto FROM crm_prodotti WHERE contatto_id = $1',
                [contattoId]
            );
            const remainingProds = remaining.rows.map(r => r.prodotto);
            const ancoraRichiedeMM = remainingProds.some(p => p !== 'MM' && !CRM_INDIPENDENTI_DA_MM.includes(p));

            if (!ancoraRichiedeMM && remainingProds.includes('MM')) {
                const mmRecord = await client.query(
                    "SELECT * FROM crm_prodotti WHERE contatto_id = $1 AND prodotto = 'MM'",
                    [contattoId]
                );
                if (mmRecord.rows.length > 0) {
                    const mmFonte = mmRecord.rows[0].fonte || '';
                    if (mmFonte === 'dashboard_manual' || mmFonte.startsWith('regola_R2')) {
                        // Audit + cestino anche per MM
                        await logAndTrash(client, {
                            azione: 'delete_prodotto',
                            tabella: 'crm_prodotti',
                            recordId: mmRecord.rows[0].id,
                            contattoId: contattoId,
                            dati: mmRecord.rows[0],
                            ip: req.ip
                        });
                        await client.query(
                            "DELETE FROM crm_prodotti WHERE contatto_id = $1 AND prodotto = 'MM'",
                            [contattoId]
                        );
                        prodottiRimossi.push('MM');
                    }
                }
            }
        }

        // Log per sync bidirezionale con SQLite
        await client.query(
            `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
             VALUES ('delete_prodotto', $1, $2)`,
            [contattoId, JSON.stringify({ prodotti_rimossi: prodottiRimossi })]
        );

        // Conta prodotti rimanenti (per trigger retrocessione automatica nel frontend)
        const countRes = await client.query(
            'SELECT COUNT(*) FROM crm_prodotti WHERE contatto_id = $1', [contattoId]
        );
        const prodottiRimanenti = parseInt(countRes.rows[0].count);

        await client.query('COMMIT');
        console.log(`[CRM] Prodotti rimossi da contatto ${contattoId}: ${prodottiRimossi.join(', ')} (rimanenti: ${prodottiRimanenti})`);
        res.json({
            ok: true,
            prodotti_rimossi: prodottiRimossi,
            prodotti_rimanenti: prodottiRimanenti,
            messaggio: prodottiRimossi.length > 1
                ? `${prodotto} rimosso. MM rimosso automaticamente (non piu\' necessario).`
                : `${prodotto} rimosso.`
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRM Remove Prodotto]', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
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
        let mmAggiuntoDaR2 = false;
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

            // R2: se il prodotto richiede MM e il contatto non ha MM, aggiungilo
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
                    mmAggiuntoDaR2 = true;
                }
            }
        }

        // Logga in crm_modifiche_log per sync bidirezionale con SQLite
        await pool.query(
            `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli) VALUES ('add_acquisto', $1, $2)`,
            [contattoId, JSON.stringify({
                prodotto,
                numero_fattura: numero_fattura.trim(),
                data_fattura,
                descrizione: (descrizione || '').trim() || null
            })]
        );
        // Se il prodotto e' stato anche aggiunto, logga separatamente
        if (prodottoAggiunto) {
            const prodottiLog = [{ prodotto, fonte: 'dashboard_manual' }];
            if (mmAggiuntoDaR2) {
                prodottiLog.push({ prodotto: 'MM', fonte: 'regola_R2_dashboard' });
            }
            await pool.query(
                `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli) VALUES ('add_prodotto', $1, $2)`,
                [contattoId, JSON.stringify({
                    prodotti_aggiunti: prodottiLog
                })]
            );
        }

        console.log(`[CRM] Acquisto aggiunto: contatto ${contattoId}, ${prodotto}, fattura ${numero_fattura}${mmAggiuntoDaR2 ? ' (+MM R2)' : ''}`);
        res.json({
            ok: true,
            acquisto: result.rows[0],
            prodotto_aggiunto: prodottoAggiunto,
            mm_aggiunto_r2: mmAggiuntoDaR2
        });
    } catch (err) {
        console.error('[CRM Add Acquisto]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Aggiorna soglia riordino per contatto (in mesi)
app.put('/api/crm/contatti/:id/mesi-riordino', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    const { mesi } = req.body;
    if (!mesi || mesi < 1 || mesi > 12) {
        return res.status(400).json({ error: 'Mesi deve essere tra 1 e 12' });
    }
    try {
        const result = await pool.query(
            'UPDATE crm_contatti SET mesi_riordino = $1 WHERE id = $2 RETURNING id, mesi_riordino',
            [parseInt(mesi), contattoId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Contatto non trovato' });
        }
        console.log(`[CRM] Soglia riordino aggiornata per contatto ${contattoId}: ${mesi} mesi`);
        res.json({ ok: true, mesi_riordino: result.rows[0].mesi_riordino });
    } catch (err) {
        console.error('[CRM Mesi Riordino]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Rimappa ID negativo (dashboard) con ID positivo (SQLite) — DEVE essere PRIMA di PUT /api/crm/contatti/:id
app.put('/api/crm/contatti/remap-id', requireReportsKey, async (req, res) => {
    const { old_id, new_id } = req.body;
    if (!old_id || !new_id || old_id >= 0 || new_id <= 0) {
        return res.status(400).json({ error: 'old_id deve essere negativo, new_id deve essere positivo' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verifica che old_id esista
        const oldExists = await client.query('SELECT id FROM crm_contatti WHERE id = $1', [old_id]);
        if (oldExists.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: `Contatto con ID ${old_id} non trovato` });
        }

        // Verifica se new_id esiste gia' (caso push avvenuto prima del remap)
        const newExists = await client.query('SELECT id FROM crm_contatti WHERE id = $1', [new_id]);

        if (newExists.rows.length === 0) {
            // Caso semplice: new_id non esiste, rinomina tutto
            const fkTables = [
                'crm_prodotti', 'crm_acquisti', 'crm_note', 'crm_opportunita',
                'crm_score_prodotti', 'crm_audit_log', 'crm_cestino',
                'crm_modifiche_log', 'crm_promozioni_log'
            ];
            for (const table of fkTables) {
                await client.query(`UPDATE ${table} SET contatto_id = $1 WHERE contatto_id = $2`, [new_id, old_id]);
            }
            await client.query('UPDATE crm_contatti SET id = $1 WHERE id = $2', [new_id, old_id]);
            console.log(`[CRM Remap] ID ${old_id} -> ${new_id} (rinominato)`);
        } else {
            // Caso complesso: new_id esiste gia', migra dati orfani e cancella old_id
            // Prodotti: rimuovi duplicati prima di migrare
            await client.query(`
                DELETE FROM crm_prodotti WHERE contatto_id = $1
                AND prodotto IN (SELECT prodotto FROM crm_prodotti WHERE contatto_id = $2)
            `, [old_id, new_id]);
            await client.query('UPDATE crm_prodotti SET contatto_id = $1 WHERE contatto_id = $2', [new_id, old_id]);

            // Acquisti: migra tutti (possono avere duplicati legittimi)
            await client.query('UPDATE crm_acquisti SET contatto_id = $1 WHERE contatto_id = $2', [new_id, old_id]);

            // Note, opportunita': migra
            await client.query('UPDATE crm_note SET contatto_id = $1 WHERE contatto_id = $2', [new_id, old_id]);
            await client.query('UPDATE crm_opportunita SET contatto_id = $1 WHERE contatto_id = $2', [new_id, old_id]);

            // Score: rimuovi duplicati per UNIQUE(contatto_id, linea_prodotto)
            await client.query(`
                DELETE FROM crm_score_prodotti WHERE contatto_id = $1
                AND linea_prodotto IN (SELECT linea_prodotto FROM crm_score_prodotti WHERE contatto_id = $2)
            `, [old_id, new_id]);
            await client.query('UPDATE crm_score_prodotti SET contatto_id = $1 WHERE contatto_id = $2', [new_id, old_id]);

            // Log tables: migra
            await client.query('UPDATE crm_audit_log SET contatto_id = $1 WHERE contatto_id = $2', [new_id, old_id]);
            await client.query('UPDATE crm_cestino SET contatto_id = $1 WHERE contatto_id = $2', [new_id, old_id]);
            await client.query('UPDATE crm_modifiche_log SET contatto_id = $1 WHERE contatto_id = $2', [new_id, old_id]);
            await client.query('UPDATE crm_promozioni_log SET contatto_id = $1 WHERE contatto_id = $2', [new_id, old_id]);

            // Cancella il vecchio contatto orfano
            await client.query('DELETE FROM crm_contatti WHERE id = $1', [old_id]);
            console.log(`[CRM Remap] ID ${old_id} -> ${new_id} (migrato e cancellato orfano)`);
        }

        await client.query('COMMIT');
        res.json({ ok: true, old_id, new_id });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRM Remap] Errore:', err);
        res.status(500).json({ error: 'Errore remap ID' });
    } finally {
        client.release();
    }
});

// Toggle gruppo_whatsapp per un contatto (on/off)
app.put('/api/crm/contatti/:id/whatsapp', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    // Se il body contiene gruppo_whatsapp, usa quello; altrimenti default true (retrocompatibilita')
    const nuovoValore = req.body && req.body.gruppo_whatsapp !== undefined ? !!req.body.gruppo_whatsapp : true;
    try {
        const result = await pool.query(
            `UPDATE crm_contatti SET gruppo_whatsapp = $1 WHERE id = $2 RETURNING id, gruppo_whatsapp`,
            [nuovoValore, contattoId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Contatto non trovato' });
        }

        // Log per sync bidirezionale con SQLite
        await pool.query(
            `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
             VALUES ('whatsapp_toggle', $1, $2)`,
            [contattoId, JSON.stringify({ gruppo_whatsapp: nuovoValore })]
        );

        console.log(`[CRM] WhatsApp ${nuovoValore ? 'attivato' : 'disattivato'} per contatto ${contattoId}`);
        res.json({ ok: true, gruppo_whatsapp: nuovoValore });
    } catch (err) {
        console.error('[CRM WhatsApp Toggle]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Aggiorna campi contatto (email, telefono, cellulare, citta, regione)
app.put('/api/crm/contatti/:id', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    const CAMPI_EDITABILI = ['email', 'telefono', 'cellulare', 'citta', 'regione'];
    const { campo, valore } = req.body;

    if (!campo || !CAMPI_EDITABILI.includes(campo)) {
        return res.status(400).json({ error: `Campo non valido. Ammessi: ${CAMPI_EDITABILI.join(', ')}` });
    }

    // Validazione regione
    if (campo === 'regione') {
        const REGIONI_VALIDE = [
            'PIEMONTE', 'LIGURIA', "VALLE D'AOSTA", 'LOMBARDIA', 'VENETO',
            'TRENTINO-ALTO ADIGE', 'FRIULI VENEZIA GIULIA', 'EMILIA-ROMAGNA',
            'TOSCANA', 'UMBRIA', 'MARCHE', 'LAZIO', 'ABRUZZO', 'MOLISE',
            'CAMPANIA', 'PUGLIA', 'BASILICATA', 'CALABRIA', 'SICILIA', 'SARDEGNA'
        ];
        const valoreUpper = (valore || '').toUpperCase().trim();
        if (!REGIONI_VALIDE.includes(valoreUpper)) {
            return res.status(400).json({ error: 'Regione non valida' });
        }
    }

    try {
        // R3: citta e regione sempre in maiuscolo
        let valoreFinale;
        if (campo === 'citta' || campo === 'regione') {
            valoreFinale = (valore || '').toUpperCase().trim();
        } else {
            valoreFinale = (valore || '').trim();
        }

        // Per cambio regione: cattura valore vecchio prima dell'UPDATE (serve per sync Excel)
        let vecchioValore = null;
        if (campo === 'regione') {
            const oldResult = await pool.query('SELECT regione FROM crm_contatti WHERE id = $1', [contattoId]);
            if (oldResult.rows.length > 0) {
                vecchioValore = oldResult.rows[0].regione;
            }
        }

        const result = await pool.query(
            `UPDATE crm_contatti SET ${campo} = $1 WHERE id = $2 RETURNING id, ${campo}`,
            [valoreFinale || null, contattoId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Contatto non trovato' });
        }

        // Log per sync bidirezionale con SQLite
        const logDettagli = { campo, valore_nuovo: valoreFinale || null };
        if (campo === 'regione' && vecchioValore) {
            logDettagli.valore_vecchio = vecchioValore;
        }
        await pool.query(
            `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
             VALUES ('edit_contatto', $1, $2)`,
            [contattoId, JSON.stringify(logDettagli)]
        );

        console.log(`[CRM] Campo ${campo} aggiornato per contatto ${contattoId}: "${valoreFinale}"`);
        res.json({ ok: true, campo, valore: result.rows[0][campo] });
    } catch (err) {
        console.error('[CRM Aggiorna Contatto]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Elimina acquisto ricorrente
app.delete('/api/crm/acquisti/:id', requireAdmin, async (req, res) => {
    const acquistoId = parseInt(req.params.id);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query('SELECT * FROM crm_acquisti WHERE id = $1', [acquistoId]);
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Acquisto non trovato' });
        }
        const record = result.rows[0];

        await logAndTrash(client, {
            azione: 'delete_acquisto',
            tabella: 'crm_acquisti',
            recordId: acquistoId,
            contattoId: record.contatto_id,
            dati: record,
            ip: req.ip
        });

        await client.query('DELETE FROM crm_acquisti WHERE id = $1', [acquistoId]);

        // Log per sync bidirezionale con SQLite
        await client.query(
            `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
             VALUES ('delete_acquisto', $1, $2)`,
            [record.contatto_id, JSON.stringify({
                prodotto: record.prodotto,
                numero_fattura: record.numero_fattura,
                data_fattura: record.data_fattura
            })]
        );

        await client.query('COMMIT');
        console.log(`[CRM] Acquisto eliminato: id ${acquistoId}, ${record.prodotto}, fattura ${record.numero_fattura}`);
        res.json({ ok: true, eliminato: record });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRM Delete Acquisto]', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
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

// Note CRM: elimina nota (con soft-delete + audit)
app.delete('/api/crm/note/:id', requireAdmin, async (req, res) => {
    const noteId = parseInt(req.params.id);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query('SELECT * FROM crm_note WHERE id = $1', [noteId]);
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Nota non trovata' });
        }
        const record = result.rows[0];

        await logAndTrash(client, {
            azione: 'delete_nota',
            tabella: 'crm_note',
            recordId: noteId,
            contattoId: record.contatto_id,
            dati: record,
            ip: req.ip
        });

        await client.query('DELETE FROM crm_note WHERE id = $1', [noteId]);

        await client.query('COMMIT');
        console.log(`[CRM] Nota eliminata: id ${noteId}`);
        res.json({ ok: true, eliminata: record });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRM Delete Nota]', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

// Note + Opportunita CRM: conteggio bulk per regione (per caricamento iniziale)
app.get('/api/crm/note/bulk', requireAdmin, async (req, res) => {
    const regione = (req.query.regione || 'LIGURIA').toUpperCase();
    try {
        // Note count
        const noteResult = await pool.query(`
            SELECT n.contatto_id, COUNT(*) as num_note
            FROM crm_note n
            JOIN crm_contatti c ON n.contatto_id = c.id
            WHERE c.regione = $1
            GROUP BY n.contatto_id
        `, [regione]);
        const noteMap = {};
        for (const r of noteResult.rows) {
            noteMap[r.contatto_id] = parseInt(r.num_note);
        }

        // Opportunity counts + due status
        const oppResult = await pool.query(`
            SELECT o.contatto_id,
                   COUNT(*) as num_opp,
                   COUNT(*) FILTER (WHERE o.data_scadenza <= CURRENT_DATE AND o.vista = false) as num_scadute_non_viste
            FROM crm_opportunita o
            JOIN crm_contatti c ON o.contatto_id = c.id
            WHERE c.regione = $1
            GROUP BY o.contatto_id
        `, [regione]);
        const oppMap = {};
        const oppScaduteMap = {};
        for (const r of oppResult.rows) {
            oppMap[r.contatto_id] = parseInt(r.num_opp);
            if (parseInt(r.num_scadute_non_viste) > 0) {
                oppScaduteMap[r.contatto_id] = parseInt(r.num_scadute_non_viste);
            }
        }

        res.json({ note: noteMap, opportunita: oppMap, opportunita_scadute: oppScaduteMap });
    } catch (err) {
        console.error('[CRM Note/Opp Bulk]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// ==================== API CRM OPPORTUNITA ====================

// Lista opportunita per contatto
app.get('/api/crm/contatti/:id/opportunita', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    try {
        const result = await pool.query(
            'SELECT * FROM crm_opportunita WHERE contatto_id = $1 ORDER BY data_scadenza ASC, created_at DESC',
            [contattoId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[CRM Opportunita]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Crea opportunita
app.post('/api/crm/contatti/:id/opportunita', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    const { testo, data_scadenza } = req.body;

    if (!testo || !testo.trim()) {
        return res.status(400).json({ error: 'Testo obbligatorio' });
    }
    if (!data_scadenza) {
        return res.status(400).json({ error: 'Data scadenza obbligatoria' });
    }

    try {
        const contatto = await pool.query('SELECT id FROM crm_contatti WHERE id = $1', [contattoId]);
        if (contatto.rows.length === 0) {
            return res.status(404).json({ error: 'Contatto non trovato' });
        }

        const result = await pool.query(
            'INSERT INTO crm_opportunita (contatto_id, testo, data_scadenza) VALUES ($1, $2, $3) RETURNING *',
            [contattoId, testo.trim(), data_scadenza]
        );

        console.log(`[CRM] Opportunita aggiunta per contatto ${contattoId}, scadenza ${data_scadenza}`);
        res.json({ ok: true, opportunita: result.rows[0] });
    } catch (err) {
        console.error('[CRM Add Opportunita]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Modifica opportunita
app.put('/api/crm/opportunita/:id', requireAdmin, async (req, res) => {
    const oppId = parseInt(req.params.id);
    const { testo, data_scadenza } = req.body;
    if (!testo || !testo.trim()) {
        return res.status(400).json({ error: 'Testo obbligatorio' });
    }
    try {
        const result = await pool.query(
            'UPDATE crm_opportunita SET testo = $1, data_scadenza = COALESCE($2, data_scadenza) WHERE id = $3 RETURNING *',
            [testo.trim(), data_scadenza || null, oppId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Opportunita non trovata' });
        }
        console.log(`[CRM] Opportunita modificata: id ${oppId}`);
        res.json({ ok: true, opportunita: result.rows[0] });
    } catch (err) {
        console.error('[CRM Edit Opportunita]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Reset flag vista su opportunita (ripristina alert dashboard)
app.put('/api/crm/opportunita/:id/reset-vista', requireAdmin, async (req, res) => {
    const oppId = parseInt(req.params.id);
    try {
        const result = await pool.query(
            'UPDATE crm_opportunita SET vista = false WHERE id = $1 RETURNING *',
            [oppId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Opportunita non trovata' });
        }
        console.log(`[CRM] Opportunita ${oppId}: vista resettata a false`);
        res.json({ ok: true, opportunita: result.rows[0] });
    } catch (err) {
        console.error('[CRM Reset Vista]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Elimina opportunita (con soft-delete + audit)
app.delete('/api/crm/opportunita/:id', requireAdmin, async (req, res) => {
    const oppId = parseInt(req.params.id);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query('SELECT * FROM crm_opportunita WHERE id = $1', [oppId]);
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Opportunita non trovata' });
        }
        const record = result.rows[0];

        await logAndTrash(client, {
            azione: 'delete_opportunita',
            tabella: 'crm_opportunita',
            recordId: oppId,
            contattoId: record.contatto_id,
            dati: record,
            ip: req.ip
        });

        await client.query('DELETE FROM crm_opportunita WHERE id = $1', [oppId]);

        await client.query('COMMIT');
        console.log(`[CRM] Opportunita eliminata: id ${oppId}`);
        res.json({ ok: true, eliminata: record });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRM Delete Opportunita]', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

// Segna come viste le opportunita scadute di un contatto (quando si apre il pannello)
app.put('/api/crm/contatti/:id/opportunita/vista-bulk', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    try {
        await pool.query(
            'UPDATE crm_opportunita SET vista = true WHERE contatto_id = $1 AND data_scadenza <= CURRENT_DATE AND vista = false',
            [contattoId]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error('[CRM Bulk Vista Opportunita]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// ==================== CESTINO CRM (consulta e ripristina) ====================

// Lista elementi nel cestino (filtrabili per tabella e contatto)
app.get('/api/crm/cestino', requireAdmin, async (req, res) => {
    const { tabella, contatto_id, limit: lim } = req.query;
    try {
        let query = 'SELECT * FROM crm_cestino WHERE 1=1';
        const params = [];

        if (tabella) {
            params.push(tabella);
            query += ` AND tabella_origine = $${params.length}`;
        }
        if (contatto_id) {
            params.push(parseInt(contatto_id));
            query += ` AND contatto_id = $${params.length}`;
        }
        query += ' ORDER BY cancellato_il DESC';
        if (lim) {
            params.push(parseInt(lim));
            query += ` LIMIT $${params.length}`;
        } else {
            query += ' LIMIT 100';
        }

        const result = await pool.query(query, params);
        res.json({ ok: true, totale: result.rows.length, cestino: result.rows });
    } catch (err) {
        console.error('[CRM Cestino]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Ripristina un elemento dal cestino
app.post('/api/crm/cestino/:id/ripristina', requireAdmin, async (req, res) => {
    const cestinoId = parseInt(req.params.id);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Leggi il record dal cestino
        const cestinoResult = await client.query('SELECT * FROM crm_cestino WHERE id = $1', [cestinoId]);
        if (cestinoResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Elemento non trovato nel cestino' });
        }

        const item = cestinoResult.rows[0];
        const dati = item.dati;
        const tabella = item.tabella_origine;

        // Ri-inserisci nella tabella originale
        if (tabella === 'crm_prodotti') {
            await client.query(
                'INSERT INTO crm_prodotti (contatto_id, prodotto, data_inserimento, fonte) VALUES ($1, $2, $3, $4)',
                [dati.contatto_id, dati.prodotto, dati.data_inserimento, dati.fonte]
            );
        } else if (tabella === 'crm_acquisti') {
            await client.query(
                'INSERT INTO crm_acquisti (contatto_id, prodotto, numero_fattura, data_fattura, quantita, descrizione, fonte) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [dati.contatto_id, dati.prodotto, dati.numero_fattura, dati.data_fattura, dati.quantita || 1, dati.descrizione, dati.fonte]
            );
        } else if (tabella === 'crm_note') {
            await client.query(
                'INSERT INTO crm_note (contatto_id, testo, created_at) VALUES ($1, $2, $3)',
                [dati.contatto_id, dati.testo, dati.created_at]
            );
        } else if (tabella === 'crm_opportunita') {
            await client.query(
                'INSERT INTO crm_opportunita (contatto_id, testo, data_scadenza, vista, created_at) VALUES ($1, $2, $3, $4, $5)',
                [dati.contatto_id, dati.testo, dati.data_scadenza, dati.vista || false, dati.created_at]
            );
        } else {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Tabella non supportata: ${tabella}` });
        }

        // Rimuovi dal cestino
        await client.query('DELETE FROM crm_cestino WHERE id = $1', [cestinoId]);

        // Log nell'audit
        await client.query(
            `INSERT INTO crm_audit_log (azione, tabella, record_id, contatto_id, dettagli, ip)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            ['ripristino', tabella, dati.id || item.record_id, item.contatto_id, JSON.stringify(dati), req.ip]
        );

        await client.query('COMMIT');
        console.log(`[CRM Cestino] Ripristinato: ${tabella}, record_id ${item.record_id}, contatto ${item.contatto_id}`);
        res.json({ ok: true, tabella, contatto_id: item.contatto_id, messaggio: 'Record ripristinato con successo' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRM Cestino Ripristina]', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

// Audit log CRM (consultazione)
app.get('/api/crm/audit', requireAdmin, async (req, res) => {
    const { azione, contatto_id, limit: lim } = req.query;
    try {
        let query = 'SELECT * FROM crm_audit_log WHERE 1=1';
        const params = [];

        if (azione) {
            params.push(azione);
            query += ` AND azione = $${params.length}`;
        }
        if (contatto_id) {
            params.push(parseInt(contatto_id));
            query += ` AND contatto_id = $${params.length}`;
        }
        query += ' ORDER BY created_at DESC';
        if (lim) {
            params.push(parseInt(lim));
            query += ` LIMIT $${params.length}`;
        } else {
            query += ' LIMIT 100';
        }

        const result = await pool.query(query, params);
        res.json({ ok: true, totale: result.rows.length, audit: result.rows });
    } catch (err) {
        console.error('[CRM Audit]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Conteggio opportunita scadute per dashboard (notifica esterna) - con nomi clienti
app.get('/api/crm/opportunita/scadute', requireAdmin, async (req, res) => {
    const regione = (req.query.regione || '').toUpperCase();
    try {
        let query = `
            SELECT c.regione,
                   COUNT(*) as totale,
                   array_agg(DISTINCT TRIM(COALESCE(c.cognome, '') || ' ' || COALESCE(c.nome, ''))) as clienti
            FROM crm_opportunita o
            JOIN crm_contatti c ON o.contatto_id = c.id
            WHERE o.data_scadenza <= CURRENT_DATE AND o.vista = false
        `;
        const params = [];
        if (regione) {
            query += ' AND c.regione = $1';
            params.push(regione);
        }
        query += ' GROUP BY c.regione';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('[CRM Opp Scadute]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// ==================== API CRM SCORE ====================

// Score per linea prodotto per tutti i contatti di una regione
// Combina crm_score_prodotti + crm_score_manuali non sincronizzati
app.get('/api/crm/score', requireAdmin, async (req, res) => {
    const regione = (req.query.regione || 'LIGURIA').toUpperCase();
    try {
        // Score da sync (aggregati da score_eventi)
        const syncScores = await pool.query(`
            SELECT c.id, c.cognome, c.nome, c.nome_azienda, c.tipo,
                   sp.linea_prodotto, sp.score
            FROM crm_contatti c
            INNER JOIN crm_score_prodotti sp ON sp.contatto_id = c.id
            WHERE c.regione = $1 AND sp.score > 0
        `, [regione]);

        // Score manuali non ancora sincronizzati
        const manualScores = await pool.query(`
            SELECT c.id, c.cognome, c.nome, c.nome_azienda, c.tipo,
                   sm.linea_prodotto, sm.punti as score
            FROM crm_contatti c
            INNER JOIN crm_score_manuali sm ON sm.contatto_id = c.id
            WHERE c.regione = $1 AND sm.sincronizzata = false
        `, [regione]);

        // Combina e aggrega
        const allRows = [...syncScores.rows, ...manualScores.rows];
        const contattiMap = {};
        const allLinee = new Set();
        for (const r of allRows) {
            if (!contattiMap[r.id]) {
                contattiMap[r.id] = {
                    id: r.id,
                    cognome: r.cognome || '',
                    nome: r.nome || '',
                    nome_azienda: r.nome_azienda || '',
                    tipo: r.tipo || 'account',
                    score_prodotti: {}
                };
            }
            const current = contattiMap[r.id].score_prodotti[r.linea_prodotto] || 0;
            contattiMap[r.id].score_prodotti[r.linea_prodotto] = current + parseInt(r.score);
            allLinee.add(r.linea_prodotto);
        }

        // Video engagement icons per la pagina score
        const contattiIds = Object.keys(contattiMap).map(Number);
        let videoIconsMap = {};
        if (contattiIds.length > 0) {
            const videoCompletions = await pool.query(`
                SELECT contatto_id,
                       SPLIT_PART(REGEXP_REPLACE(campagna, '_TEST$', ''), '_SF_', 1) as linea,
                       COUNT(DISTINCT campagna) as num_video
                FROM crm_video_tracking
                WHERE contatto_id = ANY($1::int[])
                  AND evento = 'score_90'
                GROUP BY contatto_id, SPLIT_PART(REGEXP_REPLACE(campagna, '_TEST$', ''), '_SF_', 1)
            `, [contattiIds]);
            for (const v of videoCompletions.rows) {
                if (!videoIconsMap[v.contatto_id]) videoIconsMap[v.contatto_id] = {};
                videoIconsMap[v.contatto_id][v.linea] = parseInt(v.num_video);
            }
        }

        // Calcola score totale e converti in array
        const contatti = Object.values(contattiMap).map(c => {
            c.score_totale = Object.values(c.score_prodotti).reduce((a, b) => a + b, 0);
            c.video_icons = videoIconsMap[c.id] || {};
            return c;
        });

        // Estrai tutte le linee prodotto presenti
        const lineeProdotto = [...allLinee].sort();

        const sogliaScore = getSogliaHot(regione);
        res.json({ contatti, linee_prodotto: lineeProdotto, soglia_hot: sogliaScore });
    } catch (err) {
        console.error('[CRM Score]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Promuovi lead a account (con selezione prodotti)
app.put('/api/crm/contatti/:id/promuovi', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    const { prodotti } = req.body; // array di prodotti selezionati

    if (!prodotti || !Array.isArray(prodotti) || prodotti.length === 0) {
        return res.status(400).json({ error: 'Seleziona almeno un prodotto' });
    }

    const prodottiValidi = prodotti.filter(p => CRM_PRODOTTI.includes(p));
    if (prodottiValidi.length === 0) {
        return res.status(400).json({ error: 'Nessun prodotto valido selezionato' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verifica che il contatto esista e sia una lead
        const contatto = await client.query('SELECT id, tipo, cognome, nome FROM crm_contatti WHERE id = $1', [contattoId]);
        if (contatto.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Contatto non trovato' });
        }
        if (contatto.rows[0].tipo === 'account') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Il contatto e\' gia\' un account' });
        }

        // 1. Aggiorna tipo a 'account'
        await client.query('UPDATE crm_contatti SET tipo = $1 WHERE id = $2', ['account', contattoId]);

        // 2. Inserisci prodotti (con regola R2 per MM)
        const prodSet = new Set(prodottiValidi);
        if (!prodSet.has('MM')) {
            const richiedeMM = [...prodSet].some(p => !CRM_INDIPENDENTI_DA_MM.includes(p));
            if (richiedeMM) prodSet.add('MM');
        }

        const oggi = new Date().toISOString().split('T')[0];
        const prodottiInseriti = [];
        for (const p of prodSet) {
            // Evita duplicati
            const existing = await client.query(
                'SELECT id FROM crm_prodotti WHERE contatto_id = $1 AND prodotto = $2',
                [contattoId, p]
            );
            if (existing.rows.length === 0) {
                await client.query(
                    'INSERT INTO crm_prodotti (contatto_id, prodotto, data_inserimento, fonte) VALUES ($1, $2, $3, $4)',
                    [contattoId, p, oggi, 'dashboard_promozione']
                );
                prodottiInseriti.push(p);
            }
        }

        // 3. Log promozione per sync bidirezionale
        await client.query(
            'INSERT INTO crm_promozioni_log (contatto_id, prodotti) VALUES ($1, $2)',
            [contattoId, prodottiInseriti.join(',')]
        );

        // 4. Cancella score GENERICO (non piu' rilevante dopo promozione)
        const delManuali = await client.query(
            "DELETE FROM crm_score_manuali WHERE contatto_id = $1 AND linea_prodotto = 'GENERICO'",
            [contattoId]
        );
        const delProdotti = await client.query(
            "DELETE FROM crm_score_prodotti WHERE contatto_id = $1 AND linea_prodotto = 'GENERICO'",
            [contattoId]
        );
        const genericoEliminati = (delManuali.rowCount || 0) + (delProdotti.rowCount || 0);
        if (genericoEliminati > 0) {
            // Logga per sync: cancellare GENERICO anche da score_eventi nel SQLite
            await client.query(
                `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli) VALUES ('delete_score_generico', $1, $2)`,
                [contattoId, JSON.stringify({ motivo: 'promozione_lead_account' })]
            );
        }

        await client.query('COMMIT');

        const c = contatto.rows[0];
        console.log(`[CRM Promozione] Lead ${c.cognome} ${c.nome} (ID ${contattoId}) promosso ad account con prodotti: ${prodottiInseriti.join(', ')}${genericoEliminati > 0 ? ' (GENERICO rimosso)' : ''}`);
        res.json({
            ok: true,
            prodotti_inseriti: prodottiInseriti,
            messaggio: `Lead promossa ad account con ${prodottiInseriti.length} prodotti`
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRM Promozione]', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

// Retrocedi account a lead (rimuove tutti i prodotti)
app.put('/api/crm/contatti/:id/retrocedi', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verifica che il contatto esista e sia un account
        const contatto = await client.query('SELECT id, tipo, cognome, nome FROM crm_contatti WHERE id = $1', [contattoId]);
        if (contatto.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Contatto non trovato' });
        }
        if (contatto.rows[0].tipo === 'lead') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Il contatto e\' gia\' una lead' });
        }

        // 1. Recupera prodotti correnti (per il log)
        const prodottiRes = await client.query(
            'SELECT prodotto FROM crm_prodotti WHERE contatto_id = $1',
            [contattoId]
        );
        const prodottiRimossi = prodottiRes.rows.map(r => r.prodotto);

        // 2. Cancella tutti i prodotti
        await client.query('DELETE FROM crm_prodotti WHERE contatto_id = $1', [contattoId]);

        // 3. Aggiorna tipo a 'lead'
        await client.query('UPDATE crm_contatti SET tipo = $1 WHERE id = $2', ['lead', contattoId]);

        // 4. Log per sync bidirezionale con SQLite
        await client.query(
            `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
             VALUES ('retrocedi', $1, $2)`,
            [contattoId, JSON.stringify({ prodotti_rimossi: prodottiRimossi })]
        );

        await client.query('COMMIT');

        const c = contatto.rows[0];
        console.log(`[CRM Retrocessione] Account ${c.cognome} ${c.nome} (ID ${contattoId}) retrocesso a lead. Prodotti rimossi: ${prodottiRimossi.join(', ')}`);
        res.json({
            ok: true,
            prodotti_rimossi: prodottiRimossi,
            messaggio: `Account retrocesso a lead (${prodottiRimossi.length} prodotti rimossi)`
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRM Retrocessione]', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

// ==================== ELIMINAZIONE CONTATTO ====================

app.delete('/api/crm/contatti/:id', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Verifica che il contatto esista
        const contatto = await client.query('SELECT * FROM crm_contatti WHERE id = $1', [contattoId]);
        if (contatto.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Contatto non trovato' });
        }
        const c = contatto.rows[0];

        // 2. Fetch tutti i dati collegati PRIMA della delete (CASCADE li cancellera')
        const [prodotti, acquisti, note, opportunita, scoreProdotti, scoreManuali, videoTracking] = await Promise.all([
            client.query('SELECT * FROM crm_prodotti WHERE contatto_id = $1', [contattoId]),
            client.query('SELECT * FROM crm_acquisti WHERE contatto_id = $1', [contattoId]),
            client.query('SELECT * FROM crm_note WHERE contatto_id = $1', [contattoId]),
            client.query('SELECT * FROM crm_opportunita WHERE contatto_id = $1', [contattoId]),
            client.query('SELECT * FROM crm_score_prodotti WHERE contatto_id = $1', [contattoId]),
            client.query('SELECT * FROM crm_score_manuali WHERE contatto_id = $1', [contattoId]),
            client.query('SELECT * FROM crm_video_tracking WHERE contatto_id = $1', [contattoId])
        ]);

        // 3. Snapshot completo nel cestino (recuperabile)
        const snapshot = {
            contatto: c,
            prodotti: prodotti.rows,
            acquisti: acquisti.rows,
            note: note.rows,
            opportunita: opportunita.rows,
            score_prodotti: scoreProdotti.rows,
            score_manuali: scoreManuali.rows,
            video_tracking: videoTracking.rows
        };

        await logAndTrash(client, {
            azione: 'delete_contatto',
            tabella: 'crm_contatti',
            recordId: contattoId,
            contattoId: contattoId,
            dati: snapshot,
            ip: req.ip
        });

        // 4. Log per sync bidirezionale (solo se ID positivo = esiste in SQLite)
        if (contattoId > 0) {
            await client.query(
                `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
                 VALUES ('delete_contatto', $1, $2)`,
                [contattoId, JSON.stringify({
                    email: c.email,
                    tipo: c.tipo || 'account',
                    regione: c.regione,
                    cognome: c.cognome,
                    nome: c.nome
                })]
            );
        }

        // 5. DELETE — ON DELETE CASCADE rimuove automaticamente:
        // crm_prodotti, crm_acquisti, crm_note, crm_opportunita,
        // crm_score_prodotti, crm_score_manuali, crm_promozioni_log,
        // crm_video_tracking, crm_whatsapp_clicks
        await client.query('DELETE FROM crm_contatti WHERE id = $1', [contattoId]);

        await client.query('COMMIT');

        const displayName = `${c.cognome || ''} ${c.nome || ''}`.trim() || c.email || `ID ${contattoId}`;
        console.log(`[CRM Eliminazione] Contatto eliminato: ${displayName} (ID ${contattoId}, ${c.tipo})`);
        res.json({
            ok: true,
            messaggio: `Contatto ${displayName} eliminato definitivamente.`
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRM Eliminazione]', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

// Promozioni pendenti (per push_crm_dashboard.py sync bidirezionale)
app.get('/api/crm/promozioni/pendenti', requireReportsKey, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pl.id, pl.contatto_id, pl.prodotti, pl.created_at,
                   c.cognome, c.nome
            FROM crm_promozioni_log pl
            JOIN crm_contatti c ON c.id = pl.contatto_id
            WHERE pl.sincronizzata = false
            ORDER BY pl.created_at
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[CRM Promozioni Pendenti]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Segna promozioni come sincronizzate
app.put('/api/crm/promozioni/sincronizzate', requireReportsKey, async (req, res) => {
    const { ids } = req.body; // array di ID promozioni
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Nessun ID fornito' });
    }
    try {
        await pool.query(
            'UPDATE crm_promozioni_log SET sincronizzata = true WHERE id = ANY($1)',
            [ids]
        );
        console.log(`[CRM Sync] ${ids.length} promozioni segnate come sincronizzate`);
        res.json({ ok: true, aggiornate: ids.length });
    } catch (err) {
        console.error('[CRM Sync Promozioni]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Modifiche manuali pendenti (per push_crm_dashboard.py sync bidirezionale)
app.get('/api/crm/modifiche/pendenti', requireReportsKey, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ml.id, ml.tipo_modifica, ml.contatto_id, ml.dettagli, ml.created_at,
                   c.cognome, c.nome, c.email
            FROM crm_modifiche_log ml
            LEFT JOIN crm_contatti c ON c.id = ml.contatto_id
            WHERE ml.sincronizzata = false
            ORDER BY ml.created_at
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[CRM Modifiche Pendenti]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Segna modifiche come sincronizzate
app.put('/api/crm/modifiche/sincronizzate', requireReportsKey, async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Nessun ID fornito' });
    }
    try {
        await pool.query(
            'UPDATE crm_modifiche_log SET sincronizzata = true WHERE id = ANY($1)',
            [ids]
        );
        console.log(`[CRM Sync] ${ids.length} modifiche segnate come sincronizzate`);
        res.json({ ok: true, aggiornate: ids.length });
    } catch (err) {
        console.error('[CRM Sync Modifiche]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// ==================== SCORE MANUALE ====================

// Assegna score manuale a un contatto (attivita' offline)
app.post('/api/crm/contatti/:id/score', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    const { tipo_attivita, linea_prodotto } = req.body;

    // Validazione tipo attivita
    if (!tipo_attivita || !ATTIVITA_OFFLINE[tipo_attivita]) {
        return res.status(400).json({ error: 'Tipo attivita non valido' });
    }

    // Validazione linea prodotto
    if (!linea_prodotto || (!CRM_PRODOTTI.includes(linea_prodotto) && linea_prodotto !== 'GENERICO')) {
        return res.status(400).json({ error: 'Linea prodotto non valida' });
    }

    try {
        // Verifica contatto e tipo
        const contatto = await pool.query('SELECT id, tipo, cognome, nome FROM crm_contatti WHERE id = $1', [contattoId]);
        if (contatto.rows.length === 0) {
            return res.status(404).json({ error: 'Contatto non trovato' });
        }

        const tipoContatto = contatto.rows[0].tipo || 'account';
        if (linea_prodotto === 'GENERICO' && tipoContatto !== 'lead') {
            return res.status(400).json({ error: 'GENERICO e\' disponibile solo per le lead' });
        }

        const attivita = ATTIVITA_OFFLINE[tipo_attivita];
        const oggi = new Date().toISOString().split('T')[0];

        // 1. Inserisci in bridge table (display immediato)
        const insertResult = await pool.query(
            `INSERT INTO crm_score_manuali (contatto_id, linea_prodotto, tipo_attivita, punti, data_evento)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [contattoId, linea_prodotto, tipo_attivita, attivita.punti, oggi]
        );
        const scoreManualId = insertResult.rows[0].id;

        // 2. Logga per sync bidirezionale
        await pool.query(
            `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
             VALUES ('add_score', $1, $2)`,
            [contattoId, JSON.stringify({
                linea_prodotto,
                tipo_attivita,
                punti: attivita.punti,
                data_evento: oggi,
                label: attivita.label,
                score_manuale_id: scoreManualId
            })]
        );

        const c = contatto.rows[0];
        console.log(`[CRM Score Manuale] ${c.cognome} ${c.nome} (ID ${contattoId}): +${attivita.punti} per ${linea_prodotto} (${attivita.label})`);
        res.json({
            ok: true,
            punti: attivita.punti,
            linea_prodotto,
            tipo_attivita,
            messaggio: `Score +${attivita.punti} assegnato a ${linea_prodotto} per ${attivita.label}`
        });
    } catch (err) {
        console.error('[CRM Score Manuale]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Storico score manuali per un contatto
app.get('/api/crm/contatti/:id/score-manuali', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    try {
        const result = await pool.query(
            `SELECT id, linea_prodotto, tipo_attivita, punti, data_evento, sincronizzata, created_at
             FROM crm_score_manuali
             WHERE contatto_id = $1
             ORDER BY created_at DESC`,
            [contattoId]
        );
        // Mappa tipo_attivita alla label leggibile
        const rows = result.rows.map(r => ({
            ...r,
            label: ATTIVITA_OFFLINE[r.tipo_attivita] ? ATTIVITA_OFFLINE[r.tipo_attivita].label : r.tipo_attivita
        }));
        res.json(rows);
    } catch (err) {
        console.error('[CRM Score Manuali GET]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Elimina uno score manuale
app.delete('/api/crm/contatti/:id/score-manuali/:scoreId', requireAdmin, async (req, res) => {
    const contattoId = parseInt(req.params.id);
    const scoreId = parseInt(req.params.scoreId);

    try {
        // 1. Leggi il record PRIMA di eliminarlo
        const existing = await pool.query(
            'SELECT * FROM crm_score_manuali WHERE id = $1 AND contatto_id = $2',
            [scoreId, contattoId]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Score non trovato' });
        }

        const record = existing.rows[0];
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 2. Soft-delete in cestino
            await client.query(
                `INSERT INTO crm_cestino (tabella_origine, record_id, contatto_id, dati) VALUES ($1, $2, $3, $4)`,
                ['crm_score_manuali', scoreId, contattoId, JSON.stringify(record)]
            );

            // 3. Audit log
            await client.query(
                `INSERT INTO crm_audit_log (azione, tabella, record_id, contatto_id, dettagli)
                 VALUES ($1, $2, $3, $4, $5)`,
                ['delete', 'crm_score_manuali', scoreId, contattoId,
                 JSON.stringify({ linea_prodotto: record.linea_prodotto, tipo_attivita: record.tipo_attivita, punti: record.punti })]
            );

            // 4. Se gia' sincronizzato, propagare la cancellazione al SQLite
            if (record.sincronizzata) {
                await client.query(
                    `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
                     VALUES ('delete_score_manuale', $1, $2)`,
                    [contattoId, JSON.stringify({
                        linea_prodotto: record.linea_prodotto,
                        tipo_attivita: record.tipo_attivita,
                        punti: record.punti,
                        data_evento: record.data_evento,
                        score_manuale_id: scoreId
                    })]
                );
            }

            // 5. Elimina da crm_score_manuali
            await client.query('DELETE FROM crm_score_manuali WHERE id = $1', [scoreId]);

            // 6. Aggiorna crm_score_prodotti per la linea del record eliminato
            //    Sottrai i punti. Se lo score scende a 0, rimuovi la riga.
            const existingScore = await client.query(
                'SELECT score FROM crm_score_prodotti WHERE contatto_id = $1 AND linea_prodotto = $2',
                [contattoId, record.linea_prodotto]
            );
            if (existingScore.rows.length > 0) {
                const newScore = existingScore.rows[0].score - record.punti;
                if (newScore <= 0) {
                    await client.query(
                        'DELETE FROM crm_score_prodotti WHERE contatto_id = $1 AND linea_prodotto = $2',
                        [contattoId, record.linea_prodotto]
                    );
                } else {
                    await client.query(
                        'UPDATE crm_score_prodotti SET score = $1 WHERE contatto_id = $2 AND linea_prodotto = $3',
                        [newScore, contattoId, record.linea_prodotto]
                    );
                }
            }

            await client.query('COMMIT');

            const c = (await pool.query('SELECT cognome, nome FROM crm_contatti WHERE id = $1', [contattoId])).rows[0] || {};
            console.log(`[CRM Score Delete] ${c.cognome} ${c.nome} (ID ${contattoId}): -${record.punti} per ${record.linea_prodotto} (${record.tipo_attivita})`);

            res.json({ ok: true, messaggio: `Score -${record.punti} rimosso da ${record.linea_prodotto}` });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('[CRM Score Delete]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Segna score manuali come sincronizzati (per push_crm_dashboard.py)
app.put('/api/crm/score/manuali/sincronizzate', requireReportsKey, async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Nessun ID fornito' });
    }
    try {
        await pool.query(
            'UPDATE crm_score_manuali SET sincronizzata = true WHERE id = ANY($1)',
            [ids]
        );
        console.log(`[CRM Sync] ${ids.length} score manuali segnati come sincronizzati`);
        res.json({ ok: true, aggiornate: ids.length });
    } catch (err) {
        console.error('[CRM Sync Score Manuali]', err);
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

app.get('/crm', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'crm.html'));
});

// Redirect vecchi URL per retrocompatibilita
app.get('/crm-liguria', (req, res) => {
    const qs = new URLSearchParams(req.query);
    if (!qs.has('regione')) qs.set('regione', 'LIGURIA');
    res.redirect('/crm?' + qs.toString());
});
app.get('/crm-piemonte', (req, res) => {
    const qs = new URLSearchParams(req.query);
    if (!qs.has('regione')) qs.set('regione', 'PIEMONTE');
    res.redirect('/crm?' + qs.toString());
});

app.get('/crm-score', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'crm-score.html'));
});

app.get('/', (req, res) => {
    res.redirect('/cs');
});

// ==================== WHATSAPP ENROLLMENT LANDING ====================

// Configurazione gruppi WhatsApp (hardcoded per indipendenza da file config)
const WHATSAPP_GRUPPI = [
    { id: 'GRUPPO_1', link: 'https://chat.whatsapp.com/JECJ245aZj74c5zSrMm5PF' },
    { id: 'GRUPPO_2', link: 'https://chat.whatsapp.com/JbuTQK5SscO1qJ6EQNi5Ry' },
    { id: 'GRUPPO_3', link: 'https://chat.whatsapp.com/HsUqNTRb2l1FZptxWjKkBh' }
];

// Landing page WhatsApp enrollment (PUBBLICA — no auth, il contatto clicca dall'email)
app.get('/whatsapp-invite', async (req, res) => {
    const { email, gruppo } = req.query;

    if (!email || !gruppo) {
        return res.status(400).send('<h1>Link non valido</h1><p>Parametri mancanti.</p>');
    }

    // Trova il link WhatsApp dal gruppo
    const gruppoConfig = WHATSAPP_GRUPPI.find(g => g.id === gruppo);
    if (!gruppoConfig) {
        return res.status(400).send('<h1>Gruppo non trovato</h1>');
    }

    const whatsappLink = gruppoConfig.link;

    try {
        // Cerca contatto per email (incluso tipo per score differenziato)
        const result = await pool.query(
            `SELECT id, cognome, nome, tipo FROM crm_contatti WHERE LOWER(email) = LOWER($1) LIMIT 1`,
            [email]
        );

        const contatto = result.rows[0] || null;
        const contattoId = contatto ? contatto.id : null;

        if (contatto) {
            // Aggiorna gruppo_whatsapp = true
            await pool.query(
                `UPDATE crm_contatti SET gruppo_whatsapp = true WHERE id = $1`,
                [contattoId]
            );

            // Logga in crm_modifiche_log per sync bidirezionale
            await pool.query(
                `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
                 VALUES ('whatsapp_click', $1, $2)`,
                [contattoId, JSON.stringify({ email, gruppo })]
            );

            // Score GENERICO: 10 punti account, 30 punti lead
            const puntiScore = contatto.tipo === 'lead' ? 30 : 10;
            await pool.query(
                `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
                 VALUES ('add_score', $1, $2)`,
                [contattoId, JSON.stringify({
                    linea_prodotto: 'GENERICO',
                    tipo_attivita: 'whatsapp_landing_click',
                    punti: puntiScore,
                    label: 'Click landing WhatsApp',
                    data_evento: new Date().toISOString().split('T')[0]
                })]
            );

            // Inserisce anche in crm_score_manuali per display immediato
            await pool.query(
                `INSERT INTO crm_score_manuali (contatto_id, linea_prodotto, tipo_attivita, punti)
                 VALUES ($1, 'GENERICO', 'whatsapp_landing_click', $2)`,
                [contattoId, puntiScore]
            );
        }

        // Registra click (anche se contatto non trovato — per analytics)
        await pool.query(
            `INSERT INTO crm_whatsapp_clicks (contatto_id, email, gruppo)
             VALUES ($1, $2, $3)`,
            [contattoId, email, gruppo]
        );

        const cognome = contatto ? contatto.cognome : '';
        console.log(`[WhatsApp Invite] Click: ${email} (${cognome}) -> ${gruppo}`);

    } catch (err) {
        console.error('[WhatsApp Invite] Errore DB:', err);
        // Non blocchiamo l'utente — mostriamo comunque la landing
    }

    // Genera landing page HTML
    res.send(`<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OSSEOTOUCH – Community WhatsApp</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            max-width: 560px;
            width: 100%;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        .header {
            background-color: #00796b;
            padding: 20px 25px;
            text-align: center;
        }
        .header h1 {
            color: #ffffff;
            font-size: 20px;
            font-weight: bold;
            line-height: 1.3;
        }
        .content {
            padding: 25px;
        }
        .video-wrapper {
            position: relative;
            width: 100%;
            max-width: 320px;
            margin: 0 auto 25px auto;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 12px rgba(0,0,0,0.15);
        }
        .video-wrapper iframe {
            width: 100%;
            aspect-ratio: 9/16;
            display: block;
            border: none;
        }
        .subtitle {
            text-align: center;
            font-size: 16px;
            color: #333333;
            line-height: 1.5;
            margin-bottom: 25px;
        }
        .subtitle strong {
            color: #00796b;
        }
        .wa-button {
            display: block;
            width: 100%;
            max-width: 350px;
            margin: 0 auto;
            padding: 16px 30px;
            background-color: #25D366;
            color: #ffffff;
            text-align: center;
            text-decoration: none;
            font-size: 18px;
            font-weight: bold;
            border-radius: 10px;
            border: none;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        .wa-button:hover {
            background-color: #1da851;
        }
        .wa-button svg {
            width: 22px;
            height: 22px;
            vertical-align: middle;
            margin-right: 8px;
            fill: #ffffff;
        }
        .footer {
            text-align: center;
            padding: 20px 25px;
            background-color: #f5f5f5;
            border-top: 1px solid #e0e0e0;
        }
        .footer p {
            font-size: 12px;
            color: #999999;
        }
        @media (max-width: 480px) {
            body { padding: 10px; }
            .header h1 { font-size: 18px; }
            .content { padding: 20px 15px; }
            .video-wrapper { max-width: 280px; }
            .wa-button { font-size: 16px; padding: 14px 20px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Community WhatsApp<br>Implantologia Magnetodinamica</h1>
        </div>
        <div class="content">
            <a href="${whatsappLink}" class="wa-button" style="margin-bottom: 25px;">
                <svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                UNISCITI AL GRUPPO
            </a>
            <div class="video-wrapper">
                <iframe
                    src="https://www.youtube.com/embed/u_mqrOkNqSg?autoplay=1&mute=1&loop=1&playlist=u_mqrOkNqSg&controls=1&rel=0"
                    allow="autoplay; encrypted-media"
                    allowfullscreen>
                </iframe>
            </div>
            <p class="subtitle">
                Unisciti a <strong>migliaia di colleghi</strong> che ogni giorno si confrontano su casi clinici di implantologia mini-invasiva con il Magnetic Mallet.
            </p>
        </div>
        <div class="footer">
            <p>Osseotouch – Total Control</p>
        </div>
    </div>
</body>
</html>`);
});

// ==================== VIDEO TRACKING LANDING ====================

// Landing page video con YouTube IFrame API per tracking visualizzazione
app.get('/video-landing', async (req, res) => {
    const { email, campagna, v } = req.query;

    if (!email || !campagna) {
        return res.status(400).send('<h1>Link non valido</h1><p>Parametri mancanti.</p>');
    }

    const videoId = v || 'R2Yms8zofxU';

    try {
        const result = await pool.query(
            `SELECT id, cognome, nome, tipo FROM crm_contatti WHERE LOWER(email) = LOWER($1) LIMIT 1`,
            [email]
        );
        const contatto = result.rows[0] || null;
        const contattoId = contatto ? contatto.id : null;

        await pool.query(
            `INSERT INTO crm_video_tracking (contatto_id, email, campagna, evento)
             VALUES ($1, $2, $3, 'landing_open')`,
            [contattoId, email, campagna]
        );

        const cognome = contatto ? contatto.cognome : '';
        console.log(`[Video Landing] Open: ${email} (${cognome}) -> ${campagna}`);
    } catch (err) {
        console.error('[Video Landing] Errore DB:', err);
    }

    res.send(`<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ELEVATE by OsseoTouch – Caso Clinico</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            max-width: 700px;
            width: 100%;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        .header {
            background-color: #1B5E20;
            padding: 20px 25px;
            text-align: center;
        }
        .header h1 {
            color: #ffffff;
            font-size: 20px;
            font-weight: bold;
            line-height: 1.3;
        }
        .content { padding: 25px; }
        .video-wrapper {
            position: relative;
            width: 100%;
            padding-bottom: 56.25%;
            margin: 0 auto 20px auto;
            border-radius: 8px;
            overflow: hidden;
            background: #000;
        }
        .video-wrapper #player {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
        }
        .subtitle {
            text-align: center;
            font-size: 15px;
            color: #666666;
            line-height: 1.5;
            margin-bottom: 15px;
        }
        .wa-button {
            display: block;
            width: 100%;
            max-width: 320px;
            margin: 0 auto;
            padding: 14px 25px;
            background-color: #25D366;
            color: #ffffff;
            text-align: center;
            text-decoration: none;
            font-size: 16px;
            font-weight: bold;
            border-radius: 10px;
            transition: background-color 0.2s;
        }
        .wa-button:hover { background-color: #1da851; }
        .footer {
            text-align: center;
            padding: 15px 25px;
            background-color: #f5f5f5;
            border-top: 1px solid #e0e0e0;
        }
        .footer p { font-size: 11px; color: #999999; }
        @media (max-width: 480px) {
            body { padding: 10px; }
            .header h1 { font-size: 18px; }
            .content { padding: 20px 15px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>ELEVATE by OSSEOTOUCH<br>Mini Rialzi Crestali con Tecnologia Magnetodinamica</h1>
        </div>
        <div class="content">
            <div class="video-wrapper">
                <div id="player"></div>
            </div>
            <p class="subtitle">
                Il Dr. Mema illustra la procedura di mini rialzo crestale<br>con il kit Elevate e la tecnologia magnetodinamica OSSEOTOUCH
            </p>
            <a href="https://wa.me/393387351260?text=Salve%2C%20vorrei%20informazioni%20sul%20kit%20Elevate" class="wa-button">
                &#128172; Richiedi informazioni sul Kit Elevate
            </a>
        </div>

        <!-- Consenso GDPR — 3 opzioni (identico alla email) -->
        <div style="border-top: 1px solid #e0e0e0; padding: 20px 25px; text-align: center;">
            <p style="color: #666666; font-size: 13px; line-height: 1.6; margin: 0 0 14px 0;">
                Per inviarle contenuti sempre pi&ugrave; utili &mdash; casi clinici mirati, tutorial su misura, offerte dedicate &mdash; ci serve capire cosa le interessa davvero. Ci dia il suo ok e personalizzeremo tutto per lei.
            </p>
            <div style="margin: 0 auto; max-width: 340px;">
                <a href="/consent?email=${encodeURIComponent(email)}&campagna=${encodeURIComponent(campagna)}&risposta=si"
                   style="display: block; background-color: #2E7D32; color: #ffffff; text-decoration: none; padding: 11px 20px; border-radius: 6px; font-size: 13px; font-weight: bold; text-align: center; margin-bottom: 8px;">
                    &#10003; S&igrave;, voglio contenuti personalizzati
                </a>
                <a href="/consent?email=${encodeURIComponent(email)}&campagna=${encodeURIComponent(campagna)}&risposta=solo_email"
                   style="display: block; background-color: #e0e0e0; color: #555555; text-decoration: none; padding: 9px 20px; border-radius: 6px; font-size: 12px; text-align: center; margin-bottom: 8px;">
                    Preferisco solo le email, senza personalizzazione
                </a>
                <a href="/consent?email=${encodeURIComponent(email)}&campagna=${encodeURIComponent(campagna)}&risposta=no"
                   style="display: block; background-color: transparent; color: #999999; text-decoration: underline; padding: 8px 20px; font-size: 11px; text-align: center;">
                    Non mi interessa pi&ugrave;
                </a>
            </div>
            <p style="color: #999999; font-size: 11px; margin: 12px 0 0 0;">
                Preferisce guardare il video senza personalizzazione? Lo trovi su
                <a href="https://youtu.be/${videoId}" style="color: #CC0000; text-decoration: underline;">YouTube</a>.
            </p>
        </div>

        <div class="footer">
            <p>Osseotouch &ndash; Questa pagina utilizza sistemi di monitoraggio delle interazioni per migliorare il nostro servizio.</p>
        </div>
    </div>

    <script>
        var EMAIL = ${JSON.stringify(email)};
        var CAMPAGNA = ${JSON.stringify(campagna)};
        var player;
        var trackingInterval;

        var tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        var firstScript = document.getElementsByTagName('script')[0];
        firstScript.parentNode.insertBefore(tag, firstScript);

        function onYouTubeIframeAPIReady() {
            player = new YT.Player('player', {
                videoId: '${videoId}',
                playerVars: { rel: 0, modestbranding: 1 },
                events: { 'onStateChange': onPlayerStateChange }
            });
        }

        function inviaEvento(evento, secondi, durata, pct) {
            try {
                fetch('/api/video-tracking', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: EMAIL, campagna: CAMPAGNA, evento: evento,
                        secondi_visti: secondi || 0, durata_totale: durata || 0, percentuale: pct || 0
                    })
                });
            } catch(e) {}
        }

        function onPlayerStateChange(event) {
            var secondi = Math.floor(player.getCurrentTime());
            var durata = Math.floor(player.getDuration());
            var pct = durata > 0 ? Math.round((secondi / durata) * 100) : 0;

            if (event.data === YT.PlayerState.PLAYING) {
                inviaEvento('play', secondi, durata, pct);
                if (!trackingInterval) {
                    trackingInterval = setInterval(function() {
                        if (player && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) {
                            var s = Math.floor(player.getCurrentTime());
                            var d = Math.floor(player.getDuration());
                            var p = d > 0 ? Math.round((s / d) * 100) : 0;
                            inviaEvento('progress', s, d, p);
                        }
                    }, 5000);
                }
            } else if (event.data === YT.PlayerState.PAUSED) {
                inviaEvento('pause', secondi, durata, pct);
            } else if (event.data === YT.PlayerState.ENDED) {
                inviaEvento('ended', durata, durata, 100);
                if (trackingInterval) { clearInterval(trackingInterval); trackingInterval = null; }
            }
        }

        window.addEventListener('beforeunload', function() {
            if (player && player.getCurrentTime) {
                var s = Math.floor(player.getCurrentTime());
                var d = Math.floor(player.getDuration());
                var p = d > 0 ? Math.round((s / d) * 100) : 0;
                navigator.sendBeacon('/api/video-tracking', JSON.stringify({
                    email: EMAIL, campagna: CAMPAGNA, evento: 'leave',
                    secondi_visti: s, durata_totale: d, percentuale: p
                }));
            }
        });
    </script>
</body>
</html>`);
});

// Endpoint tracking video (PUBBLICO — riceve beacon dal JS della landing)
app.post('/api/video-tracking', express.json(), async (req, res) => {
    const { email, campagna, evento, secondi_visti, durata_totale, percentuale } = req.body;

    if (!email || !campagna || !evento) {
        return res.status(400).json({ error: 'Parametri mancanti' });
    }

    try {
        const result = await pool.query(
            'SELECT id, tipo FROM crm_contatti WHERE LOWER(email) = LOWER($1) LIMIT 1',
            [email]
        );
        const contatto = result.rows[0] || null;
        const contattoId = contatto ? contatto.id : null;

        await pool.query(
            `INSERT INTO crm_video_tracking
             (contatto_id, email, campagna, evento, secondi_visti, durata_totale, percentuale)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [contattoId, email, campagna, evento,
             secondi_visti || 0, durata_totale || 0, percentuale || 0]
        );

        // Score video: soglie cumulative
        // Linea prodotto estratta dal tag campagna (es. ELEVATE_SF_ITA1 -> ELEVATE)
        if (contatto && (secondi_visti || 0) >= 10) {
            const pct = percentuale || 0;
            const lineaProdotto = campagna.replace(/_TEST$/, '').split('_SF_')[0] || 'ELEVATE';
            const oggi = new Date().toISOString().split('T')[0];

            // Soglie: 10s-30% = 15pt, 31-60% = 15pt, >=90% = 30pt (cumulative)
            const soglie = [
                { nome: 'score_30', minPct: 1,  maxPct: 100, minSec: 10, punti: 15, label: 'Video watch 10s-30%' },
                { nome: 'score_60', minPct: 31, maxPct: 100, minSec: 0,  punti: 15, label: 'Video watch 31-60%' },
                { nome: 'score_90', minPct: 90, maxPct: 100, minSec: 0,  punti: 30, label: 'Video watch >=90%' }
            ];

            for (const soglia of soglie) {
                const raggiunta = (pct >= soglia.minPct && (secondi_visti || 0) >= soglia.minSec);
                if (!raggiunta) continue;

                // Controlla se questa soglia e' gia' stata assegnata per questa campagna
                const giaAssegnato = await pool.query(
                    `SELECT 1 FROM crm_video_tracking
                     WHERE contatto_id = $1 AND campagna = $2 AND evento = $3 LIMIT 1`,
                    [contattoId, campagna, soglia.nome]
                );

                if (giaAssegnato.rows.length === 0) {
                    // Assegna score
                    await pool.query(
                        `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
                         VALUES ('add_score', $1, $2)`,
                        [contattoId, JSON.stringify({
                            linea_prodotto: lineaProdotto,
                            tipo_attivita: 'video_watch',
                            punti: soglia.punti,
                            label: soglia.label,
                            data_evento: oggi
                        })]
                    );

                    await pool.query(
                        `INSERT INTO crm_score_manuali (contatto_id, linea_prodotto, tipo_attivita, punti, data_evento)
                         VALUES ($1, $2, 'video_watch', $3, $4)`,
                        [contattoId, lineaProdotto, soglia.punti, oggi]
                    );

                    // Marca soglia come assegnata
                    await pool.query(
                        `INSERT INTO crm_video_tracking
                         (contatto_id, email, campagna, evento, secondi_visti, durata_totale, percentuale)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                        [contattoId, email, campagna, soglia.nome, secondi_visti || 0, durata_totale || 0, pct]
                    );

                    console.log(`[Video Tracking] ${lineaProdotto} +${soglia.punti}pt (${soglia.label}) a ${email} (${campagna})`);
                }
            }
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[Video Tracking]', err);
        res.status(500).json({ error: 'Errore server' });
    }
});

// ==================== LANDING PAGE CONSENSO GDPR ====================

// GET /consent — Landing page pubblica per raccolta consenso email (PUBBLICA, no auth)
app.get('/consent', async (req, res) => {
    const { email, campagna, risposta } = req.query;

    if (!email || !risposta || !['si', 'no', 'solo_email'].includes(risposta)) {
        return res.status(400).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Link non valido</title></head><body style="font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f4f4f4;margin:0;"><div style="background:#fff;border-radius:12px;padding:30px;max-width:500px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.1);"><h2 style="color:#c00;">Link non valido</h2><p style="color:#666;">Parametri mancanti o non validi.</p></div></body></html>`);
    }

    // 3 opzioni: si = granted (email + tracking), solo_email = granted (solo email, no tracking), no = revoked
    const consensoStato = risposta === 'no' ? 'revoked' : 'granted';
    const oggi = new Date().toISOString().split('T')[0];

    try {
        // Cerca contatto per email
        const result = await pool.query(
            'SELECT id, cognome, nome, tipo FROM crm_contatti WHERE LOWER(email) = LOWER($1) LIMIT 1',
            [email]
        );
        const contatto = result.rows[0] || null;
        const contattoId = contatto ? contatto.id : null;

        // Fonte distingue le 3 opzioni: email_link (si = email+tracking), email_link_no_tracking (solo email), email_link (no = revoked)
        const consensoFonte = risposta === 'solo_email' ? 'email_link_no_tracking' : 'email_link';

        if (contatto) {
            // Aggiorna consenso su crm_contatti
            await pool.query(
                `UPDATE crm_contatti SET
                    consenso_email = $1,
                    consenso_email_data = $2,
                    consenso_email_fonte = $3,
                    email_senza_risposta = CASE WHEN $1 = 'granted' THEN 0 ELSE email_senza_risposta END
                 WHERE id = $4`,
                [consensoStato, oggi, consensoFonte, contattoId]
            );

            // Logga in crm_modifiche_log per sync bidirezionale con SQLite
            await pool.query(
                `INSERT INTO crm_modifiche_log (tipo_modifica, contatto_id, dettagli)
                 VALUES ('consenso_email', $1, $2)`,
                [contattoId, JSON.stringify({
                    consenso_email: consensoStato,
                    consenso_email_data: oggi,
                    consenso_email_fonte: consensoFonte,
                    campagna: campagna || null
                })]
            );
        }

        // Audit trail (anche se contatto non trovato — per analytics)
        await pool.query(
            `INSERT INTO crm_consensi_log (contatto_id, email, azione, fonte, campagna, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [contattoId, email, consensoStato, consensoFonte, campagna || null,
             req.headers['x-forwarded-for'] || req.ip,
             req.headers['user-agent'] || '']
        );

        const cognome = contatto ? contatto.cognome : '';
        console.log(`[Consenso] ${consensoStato}: ${email} (${cognome}) campagna=${campagna || 'N/A'}`);

    } catch (err) {
        console.error('[Consenso] Errore DB:', err);
    }

    // Pagina HTML di conferma — 3 varianti
    let titolo, messaggio, coloreHeader;
    if (risposta === 'si') {
        titolo = 'Grazie! Esperienza personalizzata attivata.';
        messaggio = 'Ricever&agrave; contenuti selezionati in base ai suoi interessi: casi clinici, tutorial e offerte pensate per la sua pratica. Analizzeremo come interagisce con i nostri contenuti per renderli sempre pi&ugrave; utili.';
        coloreHeader = '#1B5E20';
    } else if (risposta === 'solo_email') {
        titolo = 'Preferenza registrata.';
        messaggio = 'Continuer&agrave; a ricevere i nostri aggiornamenti via email. Se in futuro desidera anche contenuti personalizzati, potr&agrave; aggiornare la preferenza in qualsiasi momento.';
        coloreHeader = '#2E7D32';
    } else {
        titolo = 'Preferenza registrata.';
        messaggio = 'Non ricever&agrave; pi&ugrave; le nostre comunicazioni email. Se cambia idea, potr&agrave; sempre reiscriversi.';
        coloreHeader = '#555555';
    }

    res.send(`<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OSSEOTOUCH - Preferenze Email</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f4f4f4;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;">
    <div style="background-color:#ffffff;border-radius:12px;overflow:hidden;max-width:500px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
        <div style="background-color:${coloreHeader};padding:25px;text-align:center;">
            <h1 style="color:#ffffff;font-size:20px;font-weight:bold;margin:0;">${titolo}</h1>
        </div>
        <div style="padding:30px 25px;text-align:center;">
            <p style="font-size:16px;color:#333333;line-height:1.6;margin:0;">${messaggio}</p>
        </div>
        <div style="text-align:center;padding:15px 25px;background-color:#f5f5f5;border-top:1px solid #e0e0e0;">
            <p style="font-size:11px;color:#999999;margin:0;">Osseotouch &ndash; La sua preferenza &egrave; stata salvata.</p>
        </div>
    </div>
</body>
</html>`);
});

// ==================== YOUTUBE ANALYTICS API ====================

// POST /api/youtube/sync — riceve payload metriche da youtube_sync.py
app.post('/api/youtube/sync', requireReportsKey, async (req, res) => {
    const client = await pool.connect();
    try {
        const { videos, metriche, traffico, geografia, dispositivi, retention, canale, canale_giornaliero } = req.body;
        await client.query('BEGIN');

        // 1. UPSERT video
        if (videos && videos.length > 0) {
            for (const v of videos) {
                await client.query(`
                    INSERT INTO yt_videos (video_id, titolo, descrizione, data_pubblicazione, durata_secondi, tags, thumbnail_url, playlist_id, prodotto_associato, kol_nome, views_lifetime, likes_lifetime, commenti_lifetime)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    ON CONFLICT (video_id) DO UPDATE SET
                        titolo = EXCLUDED.titolo,
                        descrizione = EXCLUDED.descrizione,
                        data_pubblicazione = EXCLUDED.data_pubblicazione,
                        durata_secondi = EXCLUDED.durata_secondi,
                        tags = EXCLUDED.tags,
                        thumbnail_url = EXCLUDED.thumbnail_url,
                        playlist_id = EXCLUDED.playlist_id,
                        prodotto_associato = COALESCE(EXCLUDED.prodotto_associato, yt_videos.prodotto_associato),
                        kol_nome = COALESCE(EXCLUDED.kol_nome, yt_videos.kol_nome),
                        views_lifetime = COALESCE(EXCLUDED.views_lifetime, yt_videos.views_lifetime),
                        likes_lifetime = COALESCE(EXCLUDED.likes_lifetime, yt_videos.likes_lifetime),
                        commenti_lifetime = COALESCE(EXCLUDED.commenti_lifetime, yt_videos.commenti_lifetime),
                        updated_at = NOW()
                `, [v.video_id, v.titolo, v.descrizione, v.data_pubblicazione, v.durata_secondi,
                    v.tags ? JSON.stringify(v.tags) : null, v.thumbnail_url, v.playlist_id,
                    v.prodotto_associato || null, v.kol_nome || null,
                    v.views_lifetime || 0, v.likes_lifetime || 0, v.commenti_lifetime || 0]);
            }
        }

        // 2. UPSERT metriche (con shares e avg_view_percentage)
        if (metriche && metriche.length > 0) {
            for (const m of metriche) {
                await client.query(`
                    INSERT INTO yt_metriche (video_id, data_snapshot, views, likes, commenti, watch_time_minuti, durata_media_view_secondi, iscritti_guadagnati, iscritti_persi, shares, avg_view_percentage)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT (video_id, data_snapshot) DO UPDATE SET
                        views = EXCLUDED.views,
                        likes = EXCLUDED.likes,
                        commenti = EXCLUDED.commenti,
                        watch_time_minuti = EXCLUDED.watch_time_minuti,
                        durata_media_view_secondi = EXCLUDED.durata_media_view_secondi,
                        iscritti_guadagnati = EXCLUDED.iscritti_guadagnati,
                        iscritti_persi = EXCLUDED.iscritti_persi,
                        shares = EXCLUDED.shares,
                        avg_view_percentage = EXCLUDED.avg_view_percentage
                `, [m.video_id, m.data_snapshot, m.views || 0, m.likes || 0, m.commenti || 0,
                    m.watch_time_minuti || 0, m.durata_media_view_secondi || null,
                    m.iscritti_guadagnati || 0, m.iscritti_persi || 0,
                    m.shares || 0, m.avg_view_percentage || null]);
            }
        }

        // 3. UPSERT traffico
        if (traffico && traffico.length > 0) {
            for (const t of traffico) {
                await client.query(`
                    INSERT INTO yt_traffico (video_id, data_snapshot, fonte, views, watch_time_minuti)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (video_id, data_snapshot, fonte) DO UPDATE SET
                        views = EXCLUDED.views,
                        watch_time_minuti = EXCLUDED.watch_time_minuti
                `, [t.video_id, t.data_snapshot, t.fonte, t.views || 0, t.watch_time_minuti || 0]);
            }
        }

        // 4. UPSERT geografia
        if (geografia && geografia.length > 0) {
            for (const g of geografia) {
                await client.query(`
                    INSERT INTO yt_geografia (video_id, data_snapshot, paese_codice, views, watch_time_minuti)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (video_id, data_snapshot, paese_codice) DO UPDATE SET
                        views = EXCLUDED.views,
                        watch_time_minuti = EXCLUDED.watch_time_minuti
                `, [g.video_id, g.data_snapshot, g.paese_codice, g.views || 0, g.watch_time_minuti || 0]);
            }
        }

        // 5. UPSERT dispositivi
        if (dispositivi && dispositivi.length > 0) {
            for (const d of dispositivi) {
                await client.query(`
                    INSERT INTO yt_dispositivi (video_id, data_snapshot, dispositivo, views, watch_time_minuti)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (video_id, data_snapshot, dispositivo) DO UPDATE SET
                        views = EXCLUDED.views,
                        watch_time_minuti = EXCLUDED.watch_time_minuti
                `, [d.video_id, d.data_snapshot, d.dispositivo, d.views || 0, d.watch_time_minuti || 0]);
            }
        }

        // 6. UPSERT retention (curva segmenti)
        if (retention && retention.length > 0) {
            for (const r of retention) {
                await client.query(`
                    INSERT INTO yt_retention (video_id, data_snapshot, segmento_percentuale, audience_watch_ratio, relative_retention)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (video_id, data_snapshot, segmento_percentuale) DO UPDATE SET
                        audience_watch_ratio = EXCLUDED.audience_watch_ratio,
                        relative_retention = EXCLUDED.relative_retention
                `, [r.video_id, r.data_snapshot, r.segmento_percentuale,
                    r.audience_watch_ratio || null, r.relative_retention || null]);
            }
        }

        // 7. UPSERT canale storico (snapshot singolo)
        if (canale && canale.length > 0) {
            for (const c of canale) {
                await client.query(`
                    INSERT INTO yt_canale_storico (data_snapshot, iscritti_totali, views_totali, video_totali, watch_time_totale_ore)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (data_snapshot) DO UPDATE SET
                        iscritti_totali = EXCLUDED.iscritti_totali,
                        views_totali = EXCLUDED.views_totali,
                        video_totali = EXCLUDED.video_totali,
                        watch_time_totale_ore = EXCLUDED.watch_time_totale_ore
                `, [c.data_snapshot, c.iscritti_totali || null, c.views_totali || null,
                    c.video_totali || null, c.watch_time_totale_ore || null]);
            }
        }

        // 8. UPSERT canale giornaliero (metriche aggregate per giorno dal Analytics API)
        if (canale_giornaliero && canale_giornaliero.length > 0) {
            for (const c of canale_giornaliero) {
                await client.query(`
                    INSERT INTO yt_canale_storico (data_snapshot, views_totali, watch_time_totale_ore, iscritti_guadagnati, iscritti_persi, shares, avg_view_duration, avg_view_percentage)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (data_snapshot) DO UPDATE SET
                        views_totali = COALESCE(EXCLUDED.views_totali, yt_canale_storico.views_totali),
                        watch_time_totale_ore = COALESCE(EXCLUDED.watch_time_totale_ore, yt_canale_storico.watch_time_totale_ore),
                        iscritti_guadagnati = EXCLUDED.iscritti_guadagnati,
                        iscritti_persi = EXCLUDED.iscritti_persi,
                        shares = EXCLUDED.shares,
                        avg_view_duration = EXCLUDED.avg_view_duration,
                        avg_view_percentage = EXCLUDED.avg_view_percentage
                `, [c.data_snapshot, c.views_totali || null, c.watch_time_totale_ore || null,
                    c.iscritti_guadagnati || 0, c.iscritti_persi || 0, c.shares || 0,
                    c.avg_view_duration || null, c.avg_view_percentage || null]);
            }
        }

        await client.query('COMMIT');

        const counts = {
            videos: videos ? videos.length : 0,
            metriche: metriche ? metriche.length : 0,
            traffico: traffico ? traffico.length : 0,
            geografia: geografia ? geografia.length : 0,
            dispositivi: dispositivi ? dispositivi.length : 0,
            retention: retention ? retention.length : 0,
            canale: canale ? canale.length : 0,
            canale_giornaliero: canale_giornaliero ? canale_giornaliero.length : 0
        };
        console.log(`[YouTube Sync] Ricevuti: ${counts.videos} video, ${counts.metriche} metriche, ${counts.traffico} traffico, ${counts.geografia} geo, ${counts.dispositivi} disp, ${counts.retention} retention, ${counts.canale} canale, ${counts.canale_giornaliero} canale_g`);
        res.json({ ok: true, counts });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[YouTube Sync] Errore:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// GET /api/youtube/videos — lista video con metriche lifetime + avg da Analytics
app.get('/api/youtube/videos', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT v.*,
                   COALESCE(v.views_lifetime, 0) as views,
                   COALESCE(v.likes_lifetime, 0) as likes,
                   COALESCE(v.commenti_lifetime, 0) as commenti,
                   COALESCE(m.watch_time_minuti, 0) as watch_time_minuti,
                   COALESCE(m.shares, 0) as shares,
                   COALESCE(m.iscritti_guadagnati, 0) as iscritti_guadagnati,
                   COALESCE(m.iscritti_persi, 0) as iscritti_persi,
                   COALESCE(m.avg_view_percentage, 0) as avg_view_percentage,
                   COALESCE(m.durata_media_view_secondi, 0) as durata_media_view_secondi,
                   m.data_snapshot
            FROM yt_videos v
            LEFT JOIN (
                SELECT video_id,
                       SUM(watch_time_minuti) as watch_time_minuti,
                       SUM(shares) as shares,
                       SUM(iscritti_guadagnati) as iscritti_guadagnati,
                       SUM(iscritti_persi) as iscritti_persi,
                       CASE WHEN SUM(views) > 0
                            THEN SUM(avg_view_percentage * views) / SUM(views)
                            ELSE 0 END as avg_view_percentage,
                       CASE WHEN SUM(views) > 0
                            THEN SUM(durata_media_view_secondi * views) / SUM(views)
                            ELSE 0 END as durata_media_view_secondi,
                       MAX(data_snapshot) as data_snapshot
                FROM yt_metriche
                GROUP BY video_id
            ) m ON m.video_id = v.video_id
            ORDER BY v.data_pubblicazione DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[YouTube Videos]', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/youtube/stats — statistiche riepilogative canale
app.get('/api/youtube/stats', requireAdmin, async (req, res) => {
    try {
        const videoCount = await pool.query(`SELECT COUNT(*) as totale FROM yt_videos`);
        const lastSync = await pool.query(`SELECT MAX(data_snapshot) as ultimo_sync FROM yt_metriche`);
        const canale = await pool.query(`SELECT * FROM yt_canale_storico ORDER BY data_snapshot DESC LIMIT 1`);
        const topPaesi = await pool.query(`
            SELECT paese_codice, SUM(views) as views_totali, SUM(watch_time_minuti) as watch_time_totale
            FROM yt_geografia
            WHERE data_snapshot = (SELECT MAX(data_snapshot) FROM yt_geografia)
            GROUP BY paese_codice
            ORDER BY views_totali DESC
            LIMIT 10
        `);
        const topDispositivi = await pool.query(`
            SELECT dispositivo, SUM(views) as views_totali, SUM(watch_time_minuti) as watch_time_totale
            FROM yt_dispositivi
            WHERE data_snapshot = (SELECT MAX(data_snapshot) FROM yt_dispositivi)
            GROUP BY dispositivo
            ORDER BY views_totali DESC
        `);
        res.json({
            video_totali: parseInt(videoCount.rows[0].totale),
            ultimo_sync: lastSync.rows[0]?.ultimo_sync,
            canale: canale.rows[0] || null,
            top_paesi: topPaesi.rows,
            top_dispositivi: topDispositivi.rows
        });
    } catch (err) {
        console.error('[YouTube Stats]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/youtube/promosso — flagga video come promossi o rimuovi flag
// Body: { video_ids: ["abc123", "def456"], promosso: true/false }
app.post('/api/youtube/promosso', requireAdmin, async (req, res) => {
    try {
        const { video_ids, promosso } = req.body;
        if (!video_ids || !Array.isArray(video_ids)) {
            return res.status(400).json({ error: 'video_ids deve essere un array' });
        }
        const flag = promosso !== false; // default true
        const result = await pool.query(
            `UPDATE yt_videos SET promosso = $1, updated_at = NOW() WHERE video_id = ANY($2)`,
            [flag, video_ids]
        );
        res.json({ aggiornati: result.rowCount, promosso: flag });
    } catch (err) {
        console.error('[YouTube Promosso]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/youtube/views-lifetime — aggiorna views/likes/commenti lifetime in batch
// Body: { videos: [{ video_id, views, likes, commenti }, ...] }
app.post('/api/youtube/views-lifetime', requireAdmin, async (req, res) => {
    try {
        const { videos } = req.body;
        if (!videos || !Array.isArray(videos)) {
            return res.status(400).json({ error: 'videos deve essere un array' });
        }
        let aggiornati = 0;
        for (const v of videos) {
            const result = await pool.query(
                `UPDATE yt_videos SET views_lifetime = $1, likes_lifetime = $2, commenti_lifetime = $3, updated_at = NOW() WHERE video_id = $4`,
                [v.views || 0, v.likes || 0, v.commenti || 0, v.video_id]
            );
            aggiornati += result.rowCount;
        }
        res.json({ aggiornati });
    } catch (err) {
        console.error('[YouTube Views Lifetime]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/youtube/categorie — aggiorna categorie video in batch
// Body: { categorie: { "video_id": "categoria", ... } }
app.post('/api/youtube/categorie', requireAdmin, async (req, res) => {
    try {
        const { categorie } = req.body;
        if (!categorie || typeof categorie !== 'object') {
            return res.status(400).json({ error: 'categorie deve essere un oggetto {video_id: categoria}' });
        }
        let aggiornati = 0;
        for (const [video_id, categoria] of Object.entries(categorie)) {
            const result = await pool.query(
                `UPDATE yt_videos SET categoria = $1, updated_at = NOW() WHERE video_id = $2`,
                [categoria, video_id]
            );
            aggiornati += result.rowCount;
        }
        res.json({ aggiornati, totale: Object.keys(categorie).length });
    } catch (err) {
        console.error('[YouTube Categorie]', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/youtube/promossi — lista video promossi
app.get('/api/youtube/promossi', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT video_id, titolo, data_pubblicazione FROM yt_videos WHERE promosso = TRUE ORDER BY data_pubblicazione DESC`
        );
        res.json({ promossi: result.rows });
    } catch (err) {
        console.error('[YouTube Promossi]', err);
        res.status(500).json({ error: err.message });
    }
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
