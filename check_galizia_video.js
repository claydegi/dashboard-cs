// Script temporaneo per verificare i dati video di Galizia nel database PostgreSQL
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
        ? { rejectUnauthorized: false }
        : false
});

(async () => {
    try {
        console.log('=== VERIFICA DATI VIDEO GALIZIA (ID 220) ===\n');

        // 1. Verifica contatto
        const contatto = await pool.query(
            'SELECT id, email, nome, cognome FROM crm_contatti WHERE id = 220'
        );
        console.log('1. CONTATTO:');
        console.log(JSON.stringify(contatto.rows[0], null, 2));

        // 2. Video tracking - tutti i beacon
        console.log('\n2. VIDEO TRACKING (crm_video_tracking):');
        const videoTracking = await pool.query(
            `SELECT * FROM crm_video_tracking
             WHERE contatto_id = 220
             ORDER BY timestamp DESC`
        );
        console.log(`Totale eventi: ${videoTracking.rows.length}`);
        if (videoTracking.rows.length > 0) {
            console.log(JSON.stringify(videoTracking.rows, null, 2));
        } else {
            console.log('Nessun evento di tracking video trovato.');
        }

        // 3. Score manuali video_watch
        console.log('\n3. SCORE MANUALI video_watch (crm_score_manuali):');
        const scoreManuali = await pool.query(
            `SELECT * FROM crm_score_manuali
             WHERE contatto_id = 220 AND tipo_attivita = 'video_watch'
             ORDER BY data_evento DESC, id DESC`
        );
        console.log(`Totale score video: ${scoreManuali.rows.length}`);
        if (scoreManuali.rows.length > 0) {
            console.log(JSON.stringify(scoreManuali.rows, null, 2));
        } else {
            console.log('Nessuno score video_watch trovato.');
        }

        // 4. Log modifiche per video_watch
        console.log('\n4. LOG MODIFICHE video_watch (crm_modifiche_log):');
        const logModifiche = await pool.query(
            `SELECT * FROM crm_modifiche_log
             WHERE contatto_id = 220
               AND tipo_modifica = 'add_score'
               AND dettagli->>'tipo_attivita' = 'video_watch'
             ORDER BY timestamp DESC`
        );
        console.log(`Totale log: ${logModifiche.rows.length}`);
        if (logModifiche.rows.length > 0) {
            console.log(JSON.stringify(logModifiche.rows, null, 2));
        } else {
            console.log('Nessun log modifiche per video_watch trovato.');
        }

        // 5. Score prodotti PT1
        console.log('\n5. SCORE TOTALE PT1 (crm_score_prodotti):');
        const scoreProdotti = await pool.query(
            `SELECT * FROM crm_score_prodotti
             WHERE contatto_id = 220 AND linea_prodotto = 'PT1'`
        );
        if (scoreProdotti.rows.length > 0) {
            console.log(JSON.stringify(scoreProdotti.rows[0], null, 2));
        } else {
            console.log('Nessuno score PT1 trovato.');
        }

        await pool.end();
        console.log('\n=== FINE VERIFICA ===');
    } catch (err) {
        console.error('ERRORE:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
})();
