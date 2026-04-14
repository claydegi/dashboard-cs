const https = require('https');

const API_URL = 'https://dashboard-cs-production.up.railway.app/api/suture/verifica-copertura';
const ADMIN_KEY = process.env.ADMIN_KEY || 'chiave-segreta-admin-2024';

console.log('Attendo 60 secondi per il deploy Railway...\n');

setTimeout(() => {
    https.get(`${API_URL}?key=${ADMIN_KEY}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);

                console.log('========================================');
                console.log('VERIFICA COPERTURA ORDINI CLIENTI');
                console.log('(SENZA considerare PO draft in bozza)');
                console.log('========================================\n');

                console.log(`Prodotti con ordini clienti: ${json.totale_prodotti_impegnati}`);
                console.log(`Coperti (giacenza + in arrivo): ${json.coperti_senza_bozza}`);
                console.log(`Scoperti (giacenza + in arrivo): ${json.scoperti_senza_bozza}\n`);

                if (json.scoperti_senza_bozza === 0) {
                    console.log('✓✓✓ TUTTI GLI ORDINI SONO COPERTI ✓✓✓');
                    console.log('    (con giacenza attuale + PO confermati)');
                    console.log('    NON serve il PO draft per coprire gli ordini!\n');
                } else {
                    console.log('❌ ATTENZIONE: Ci sono prodotti scoperti!\n');
                    console.log('PRODOTTI SCOPERTI (servono PO draft o nuovi PO):');
                    json.scoperti.forEach(p => {
                        console.log(`\n  ${p.codice} - ${p.descrizione}`);
                        console.log(`    Giacenza: ${p.giacenza}`);
                        console.log(`    Impegnato: ${p.impegnato}`);
                        console.log(`    In arrivo (PO confermati): ${p.in_arrivo}`);
                        console.log(`    ⚠️  Saldo SENZA bozza: ${p.saldo_senza_bozza}`);
                        console.log(`    In bozza (PO draft): ${p.in_bozza}`);
                        console.log(`    ✓ Saldo CON bozza: ${p.saldo_con_bozza}`);
                    });
                    console.log('\n→ Il PO draft in bozza serve per coprire questi prodotti');
                }

                if (json.coperti_senza_bozza > 0) {
                    console.log('\n========================================');
                    console.log('PRODOTTI GIÀ COPERTI (esempi):');
                    console.log('========================================\n');
                    json.coperti.slice(0, 5).forEach(p => {
                        console.log(`  ${p.codice}: Giacenza=${p.giacenza}, Impegnato=${p.impegnato}, InArrivo=${p.in_arrivo}, Saldo=${p.saldo_senza_bozza}`);
                    });
                    if (json.coperti.length > 5) {
                        console.log(`  ... e altri ${json.coperti.length - 5} prodotti`);
                    }
                }

            } catch (e) {
                console.error('Errore parsing JSON:', e.message);
                console.error('Risposta:', data.substring(0, 500));
            }
        });
    }).on('error', (e) => console.error('Errore HTTP:', e.message));
}, 60000);
