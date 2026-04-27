const https = require('https');

const API_URL = 'https://dashboard-cs-production.up.railway.app/api/suture/ordine';
const ADMIN_KEY = process.env.ADMIN_KEY || '<ADMIN_KEY_STORICA_RIMOSSA>';

https.get(`${API_URL}?key=${ADMIN_KEY}`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);

            console.log('========================================');
            console.log('VERIFICA COPERTURA ORDINI CLIENTI');
            console.log('========================================\n');

            // Per fare questa verifica devo interrogare direttamente i dati di stock
            // perché l'API /ordine non mi dà tutte le info necessarie

            console.log('Per verificare la copertura completa devo accedere al database.');
            console.log('Dalle info API posso vedere:');
            console.log(`\n- Ordini clienti in attesa: ${json.ordini_clienti?.length || 0}`);
            console.log(`- Suture in arrivo (PO confermati): ${json.in_arrivo?.length || 0}`);
            console.log(`- Suture in bozza (PO draft): ${json.in_bozza?.length || 0}`);

            const ordiniClienti = json.ordini_clienti || [];

            if (ordiniClienti.length === 0) {
                console.log('\n✓ NESSUN ordine cliente in attesa');
                console.log('  → Tutti gli ordini aperti sono coperti da giacenza o PO in arrivo');
            } else {
                console.log('\n❌ CI SONO ordini clienti NON coperti:');
                ordiniClienti.forEach(o => {
                    console.log(`  - ${o.sale_order_name}: ${o.codice} x ${o.qty_to_deliver} (${o.partner_name})`);
                });
                console.log('\n  → Questi ordini NON sono coperti né da giacenza né da PO in arrivo');
            }

            console.log('\n========================================');
            console.log('INFO DETTAGLIATE:');
            console.log('========================================\n');
            console.log(`Ultimo sync: ${json.last_sync}`);
            console.log(`Valore in arrivo: €${json.totale_arrivo || 0}`);
            console.log(`Valore in bozza: €${json.totale_bozza || 0}`);

        } catch (e) {
            console.error('Errore parsing JSON:', e.message);
        }
    });
}).on('error', (e) => console.error('Errore HTTP:', e.message));
