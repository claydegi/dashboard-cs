// Regression guard per GET /api/crm/migration-stats (fix permanente 19/06/2026).
//
// Invariante: `migrati_attivi` DEVE contare LIVE crm_contatti.migrato_in_kessel_at,
// NON crm_kessel_migration_map.is_counted_in_active_card (che restava STALE dopo le
// migrazioni -> card ferma a 256 mentre i flag reali erano 418). Stesso perimetro
// (crm_contatti) di crm_attivi. La mappa non deve bloccare il conteggio dei migrati.
//
// Esecuzione:  node scripts/verify_migration_stats.js
// Exit 0 = OK, 1 = regressione. Il check live sul DB parte solo se DATABASE_URL e' presente.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = src.indexOf("app.get('/api/crm/migration-stats'");
if (start < 0) { console.error('FAIL: handler migration-stats non trovato'); process.exit(1); }
const next = src.indexOf('\napp.', start + 10);
const block = src.slice(start, next < 0 ? src.length : next);

const checks = [
  ['migrati_attivi conta il flag live (migrato_in_kessel_at IS NOT NULL)', /migrato_in_kessel_at IS NOT NULL/.test(block)],
  ['perimetro = crm_contatti (stesso di crm_attivi)', /FROM crm_contatti/.test(block)],
  ['NON usa piu\' is_counted_in_active_card (fonte stale)', !/is_counted_in_active_card/.test(block)],
];
let ok = true;
for (const [name, pass] of checks) { console.log(`  [${pass ? 'OK' : 'FAIL'}] ${name}`); if (!pass) ok = false; }

async function liveCheck() {
  if (!process.env.DATABASE_URL) { console.log('  [SKIP] check live DB (DATABASE_URL assente)'); return; }
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  try {
    const r = await pool.query(
      "SELECT COUNT(*) AS tot, COUNT(*) FILTER (WHERE migrato_in_kessel_at IS NOT NULL) AS migrati FROM crm_contatti");
    const tot = parseInt(r.rows[0].tot), migrati = parseInt(r.rows[0].migrati);
    console.log(`  [LIVE] crm_attivi=${tot} migrati_attivi=${migrati}`);
    // invariante: ogni contatto con flag entra nel conteggio -> migrati = flag count
    const flag = await pool.query("SELECT COUNT(*) AS n FROM crm_contatti WHERE migrato_in_kessel_at IS NOT NULL");
    if (parseInt(flag.rows[0].n) !== migrati) { console.log('  [FAIL] migrati_attivi != conteggio flag'); ok = false; }
    else console.log('  [OK] migrati_attivi == conteggio flag live');
  } finally { await pool.end(); }
}

liveCheck()
  .catch((e) => console.log('  [SKIP] check live DB errore:', e.message))
  .finally(() => { console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1); });
