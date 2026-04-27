const https = require('https');

const API_URL = 'https://dashboard-cs-production.up.railway.app/api/suture/ordine';
const ADMIN_KEY = process.env.ADMIN_KEY || '<ADMIN_KEY_STORICA_RIMOSSA>';

https.get(`${API_URL}?key=${ADMIN_KEY}`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);

            console.log('=== ORDINI CLIENTI CON SUTURE ===\n');
            const ordiniClienti = json.ordini_clienti || [];
            const s342 = ordiniClienti.filter(o => o.sale_order_name === 'S00342');
            const s343 = ordiniClienti.filter(o => o.sale_order_name === 'S00343');

            console.log(`S00342: ${s342.length} righe`);
            s342.forEach(o => console.log(`  - ${o.codice} x ${o.qty_to_deliver} (cliente: ${o.partner_name})`));

            console.log(`\nS00343: ${s343.length} righe`);
            s343.forEach(o => console.log(`  - ${o.codice} x ${o.qty_to_deliver} (cliente: ${o.partner_name})`));

            if (s343.length === 0) {
                console.log('\n❌ PROBLEMA: S00343 NON appare nella sezione "Ordini Clienti"');
                console.log('\nPossibili cause:');
                console.log('  1. Ordine non in stato "sale" (confermato) in Odoo');
                console.log('  2. Suture già completamente consegnate (qty_delivered = qty_ordered)');
                console.log('  3. Prodotti nell\'ordine non sono categoria 38 (SUTURE)');
                console.log('  4. Ordine non sincronizzato (problema sync)');
            }

            console.log(`\n=== IN BOZZA (PO DRAFT) ===\n`);
            const inBozza = json.in_bozza || [];
            console.log(`Totale righe in bozza: ${inBozza.length}`);
            if (inBozza.length > 0) {
                console.log('\nPrime 15 righe:');
                inBozza.slice(0, 15).forEach(b => console.log(`  ${b.codice}: ${b.quantita} pz (€${b.valore})`));
            } else {
                console.log('(Nessun PO draft VITREX in Odoo)');
            }

            console.log(`\n=== IN ARRIVO (PO CONFERMATI) ===\n`);
            const inArrivo = json.in_arrivo || [];
            console.log(`Totale righe in arrivo: ${inArrivo.length}`);
            if (inArrivo.length > 0) {
                inArrivo.slice(0, 10).forEach(a => console.log(`  ${a.codice}: ${a.quantita} pz`));
            }

            console.log(`\n=== SYNC INFO ===\n`);
            console.log(`Ultimo sync: ${json.last_sync || 'Mai'}`);
            console.log(`Stato: ${json.sync_status || 'Unknown'}`);
            if (json.sync_error) console.log(`Errore: ${json.sync_error}`);

            console.log(`\n=== TOTALI ===\n`);
            console.log(`Valore in bozza: €${json.totale_bozza || 0}`);
            console.log(`Valore in arrivo: €${json.totale_arrivo || 0}`);
            console.log(`Valore da ordinare: €${json.totale_da_ordinare || 0}`);

        } catch (e) {
            console.error('Errore parsing JSON:', e.message);
            console.error('Risposta (primi 500 char):', data.substring(0, 500));
        }
    });
}).on('error', (e) => console.error('Errore HTTP:', e.message));
