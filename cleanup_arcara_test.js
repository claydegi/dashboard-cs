/**
 * Cleanup registrazioni test webinar Arcara (tag _REC)
 * Esegui: node cleanup_arcara_test.js
 */

const { Pool } = require('pg');

// Usa DATABASE_URL dall'env di Railway o .env locale
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function cleanup() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('\n=== CLEANUP REGISTRAZIONI TEST WEBINAR ARCARA ===\n');

        // 1. Trova contatti da cancellare
        const contattiTest = await client.query(`
            SELECT DISTINCT c.id, c.email, c.nome, c.cognome
            FROM crm_contatti c
            INNER JOIN crm_webinar_registrazioni wr ON c.id = wr.contatto_id
            WHERE wr.webinar_tag = 'WEBINAR_ARCARA_ELEVATE_REC'
        `);

        console.log(`Contatti test trovati: ${contattiTest.rows.length}`);
        contattiTest.rows.forEach(c => {
            console.log(`  - ${c.email} (${c.nome} ${c.cognome}, ID: ${c.id})`);
        });

        if (contattiTest.rows.length === 0) {
            console.log('\nNessun contatto test da cancellare. Esco.');
            await client.query('ROLLBACK');
            return;
        }

        const contattiIds = contattiTest.rows.map(c => c.id);

        // 2. Cancella score
        const delScore = await client.query(`
            DELETE FROM crm_score_manuali
            WHERE contatto_id = ANY($1)
        `, [contattiIds]);
        console.log(`\nScore cancellati: ${delScore.rowCount}`);

        // 3. Cancella prodotti
        const delProdotti = await client.query(`
            DELETE FROM crm_prodotti
            WHERE contatto_id = ANY($1)
        `, [contattiIds]);
        console.log(`Prodotti cancellati: ${delProdotti.rowCount}`);

        // 4. Cancella registrazioni
        const delRegistrazioni = await client.query(`
            DELETE FROM crm_webinar_registrazioni
            WHERE webinar_tag = 'WEBINAR_ARCARA_ELEVATE_REC'
        `);
        console.log(`Registrazioni cancellate: ${delRegistrazioni.rowCount}`);

        // 5. Cancella contatti (solo se ID negativi e nessun'altra registrazione)
        const delContatti = await client.query(`
            DELETE FROM crm_contatti
            WHERE id = ANY($1)
            AND id < 0
            AND NOT EXISTS (
                SELECT 1 FROM crm_webinar_registrazioni
                WHERE contatto_id = crm_contatti.id
            )
        `, [contattiIds]);
        console.log(`Contatti test cancellati: ${delContatti.rowCount}`);

        await client.query('COMMIT');

        console.log('\n✅ Cleanup completato con successo!\n');

        // Verifica finale
        const verifica = await client.query(`
            SELECT COUNT(*) as count
            FROM crm_webinar_registrazioni
            WHERE webinar_tag = 'WEBINAR_ARCARA_ELEVATE_REC'
        `);
        console.log(`Registrazioni _REC rimanenti: ${verifica.rows[0].count}`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('\n❌ Errore durante cleanup:', err.message);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

cleanup().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
