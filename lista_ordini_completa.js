const https = require('https');

const API_URL = 'https://dashboard-cs-production.up.railway.app/api/suture/ordini-clienti-completo';
const ADMIN_KEY = process.env.ADMIN_KEY || 'chiave-segreta-admin-2024';

console.log('Attendo 60 secondi per deploy Railway...\n');

setTimeout(() => {
    https.get(`${API_URL}?key=${ADMIN_KEY}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);

                console.log('========================================');
                console.log('TUTTI GLI ORDINI CLIENTI CON SUTURE');
                console.log('========================================\n');

                console.log(`Totale ordini: ${json.totale_ordini}`);
                console.log(`Totale righe suture: ${json.totale_righe}\n`);

                if (json.totale_ordini === 0) {
                    console.log('✓ Nessun ordine con suture da consegnare');
                    return;
                }

                json.ordini.forEach((ord, idx) => {
                    console.log(`\n[${ idx + 1}] ${ord.ordine} - ${ord.cliente}`);
                    console.log(`    Data ordine: ${ord.data ? new Date(ord.data).toLocaleDateString('it-IT') : 'N/A'}`);
                    console.log(`    Suture (${ord.suture.length}):`);

                    ord.suture.forEach(s => {
                        const stock = s.stock;
                        console.log(`\n      ${s.codice} - Qta da consegnare: ${s.qta_da_consegnare}`);
                        if (stock) {
                            console.log(`        Giacenza: ${stock.giacenza}`);
                            console.log(`        Impegnato: ${stock.impegnato}`);
                            console.log(`        In arrivo (PO confermati): ${stock.in_arrivo}`);
                            console.log(`        In bozza (PO draft): ${stock.in_bozza}`);
                            console.log(`        Saldo (giacenza + arrivo - impegnato): ${stock.saldo_senza_bozza}`);

                            if (stock.saldo_senza_bozza >= 0) {
                                console.log(`        ✓ COPERTO (senza bisogno della bozza)`);
                            } else {
                                console.log(`        ❌ SCOPERTO (serve PO draft o nuovo PO)`);
                            }
                        } else {
                            console.log(`        ⚠️  Dati stock non trovati`);
                        }
                    });
                });

                console.log('\n========================================');
                console.log('RIEPILOGO');
                console.log('========================================\n');

                let totaliCoperti = 0;
                let totaliScoperti = 0;

                json.ordini.forEach(ord => {
                    ord.suture.forEach(s => {
                        if (s.stock) {
                            if (s.stock.saldo_senza_bozza >= 0) {
                                totaliCoperti++;
                            } else {
                                totaliScoperti++;
                            }
                        }
                    });
                });

                console.log(`Righe suture coperte: ${totaliCoperti}/${json.totale_righe}`);
                console.log(`Righe suture scoperte: ${totaliScoperti}/${json.totale_righe}`);

                if (totaliScoperti === 0) {
                    console.log('\n✓✓✓ TUTTI GLI ORDINI SONO COPERTI');
                    console.log('    (con giacenza + PO confermati, senza bozza)');
                } else {
                    console.log(`\n⚠️  ${totaliScoperti} righe richiedono PO draft o nuovi PO`);
                }

            } catch (e) {
                console.error('Errore parsing JSON:', e.message);
                console.error('Risposta:', data.substring(0, 500));
            }
        });
    }).on('error', (e) => console.error('Errore HTTP:', e.message));
}, 60000);
