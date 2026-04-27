const https = require('https');

const API_URL = 'https://dashboard-cs-production.up.railway.app/api/suture/verifica-copertura';
const ADMIN_KEY = process.env.ADMIN_KEY || '<ADMIN_KEY_STORICA_RIMOSSA>';

// Dobbiamo fare una query al database per vedere suture_ordini_clienti
// Ma possiamo usare un workaround: creare un nuovo endpoint o usare l'API ordine

console.log('Recupero dati ordini clienti...\n');

// Prima chiamata: get ordine data (che ha ordini_clienti solo se scoperti)
https.get(`https://dashboard-cs-production.up.railway.app/api/suture/ordine?key=${ADMIN_KEY}`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const ordineJson = JSON.parse(data);

            console.log('========================================');
            console.log('ORDINI CLIENTI CON SUTURE');
            console.log('========================================\n');

            console.log('NOTA: L\'API /ordine mostra solo ordini NON coperti da giacenza+arrivo+bozza.');
            console.log('Per vedere TUTTI gli ordini serve accesso diretto al database.\n');

            const ordiniVisibili = ordineJson.ordini_clienti || [];

            if (ordiniVisibili.length > 0) {
                console.log('ORDINI VISIBILI (non completamente coperti):');
                const ordiniMap = {};
                ordiniVisibili.forEach(o => {
                    if (!ordiniMap[o.sale_order_name]) {
                        ordiniMap[o.sale_order_name] = {
                            nome: o.sale_order_name,
                            cliente: o.partner_name,
                            data: o.date_order,
                            suture: []
                        };
                    }
                    ordiniMap[o.sale_order_name].suture.push({
                        codice: o.codice,
                        qta: o.qty_to_deliver
                    });
                });

                Object.values(ordiniMap).forEach(ord => {
                    console.log(`\n  ${ord.nome} - ${ord.cliente}`);
                    console.log(`  Data: ${ord.data}`);
                    console.log(`  Suture:`);
                    ord.suture.forEach(s => console.log(`    - ${s.codice} x ${s.qta}`));
                });
            } else {
                console.log('✓ NESSUN ordine visibile in "Ordini Clienti"');
                console.log('  → Tutti gli ordini aperti sono coperti da giacenza o arrivi');
            }

            console.log('\n========================================');
            console.log('SERVE UN ENDPOINT DEDICATO');
            console.log('========================================\n');
            console.log('Per vedere TUTTI gli ordini con suture (coperti e non),');
            console.log('serve un nuovo endpoint che legga direttamente:');
            console.log('SELECT * FROM suture_ordini_clienti ORDER BY date_order DESC');

        } catch (e) {
            console.error('Errore:', e.message);
        }
    });
}).on('error', (e) => console.error('Errore HTTP:', e.message));
