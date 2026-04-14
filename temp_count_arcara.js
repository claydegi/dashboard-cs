const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    // Conta iscritti webinar Arcara
    const result = await pool.query(`
      SELECT
        COUNT(*) as totale,
        COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as con_email
      FROM webinar_registrations
      WHERE campagna = 'WEBINAR_ARCARA_ELEVATE'
    `);

    console.log('\n=== ISCRITTI WEBINAR ARCARA ===');
    console.log('Totale iscritti:', result.rows[0].totale);
    console.log('Con email valida:', result.rows[0].con_email);

    // Dettagli per regione
    const regioni = await pool.query(`
      SELECT
        regione,
        COUNT(*) as totale
      FROM webinar_registrations
      WHERE campagna = 'WEBINAR_ARCARA_ELEVATE'
      GROUP BY regione
      ORDER BY totale DESC
    `);

    console.log('\n=== PER REGIONE ===');
    regioni.rows.forEach(r => {
      console.log(`${r.regione || 'Non specificata'}: ${r.totale}`);
    });

    await pool.end();
  } catch(e) {
    console.error('Errore:', e.message);
    process.exit(1);
  }
})();
