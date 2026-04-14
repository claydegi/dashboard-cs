const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    console.log('\n=== AUDIT VIDEO TRACKING SYSTEM ===\n');

    // 1. Verifica tabella esiste
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'crm_video_tracking'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('❌ ERRORE: Tabella crm_video_tracking NON ESISTE!');
      process.exit(1);
    }
    console.log('✅ Tabella crm_video_tracking: ESISTE');

    // 2. Verifica struttura tabella
    const columns = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'crm_video_tracking'
      ORDER BY ordinal_position;
    `);

    console.log('\n✅ Colonne tabella:');
    columns.rows.forEach(c => {
      console.log(`   - ${c.column_name}: ${c.data_type}`);
    });

    // 3. Test inserimento simulato
    const testEmail = 'test@audit.com';
    const testCampagna = 'AUDIT_TEST';

    await pool.query(`
      INSERT INTO crm_video_tracking
      (contatto_id, email, campagna, evento, secondi_visti, durata_totale, percentuale)
      VALUES (NULL, $1, $2, 'test_audit', 0, 0, 0)
    `, [testEmail, testCampagna]);

    console.log('\n✅ Test inserimento: OK');

    // 4. Verifica record inserito
    const check = await pool.query(`
      SELECT * FROM crm_video_tracking
      WHERE email = $1 AND campagna = $2
      LIMIT 1
    `, [testEmail, testCampagna]);

    if (check.rows.length > 0) {
      console.log('✅ Test lettura: OK');
      console.log('   Record:', check.rows[0]);
    }

    // 5. Pulizia test
    await pool.query(`
      DELETE FROM crm_video_tracking
      WHERE email = $1 AND campagna = $2
    `, [testEmail, testCampagna]);

    console.log('\n✅ Pulizia test: OK');

    // 6. Conta tracking esistenti per campagna Arcara
    const arcaraCount = await pool.query(`
      SELECT
        COUNT(DISTINCT email) as utenti_unici,
        COUNT(*) as eventi_totali,
        COUNT(DISTINCT CASE WHEN evento = 'landing_open' THEN email END) as landing_opens,
        COUNT(DISTINCT CASE WHEN evento = 'play' THEN email END) as video_plays
      FROM crm_video_tracking
      WHERE campagna LIKE '%ARCARA%'
    `);

    console.log('\n=== TRACKING ESISTENTE CAMPAGNA ARCARA ===');
    const stats = arcaraCount.rows[0];
    console.log(`   Utenti unici: ${stats.utenti_unici}`);
    console.log(`   Eventi totali: ${stats.eventi_totali}`);
    console.log(`   Landing opens: ${stats.landing_opens}`);
    console.log(`   Video plays: ${stats.video_plays}`);

    console.log('\n✅ AUDIT COMPLETATO: Sistema video tracking OPERATIVO\n');

    await pool.end();
  } catch(e) {
    console.error('❌ ERRORE AUDIT:', e.message);
    process.exit(1);
  }
})();
