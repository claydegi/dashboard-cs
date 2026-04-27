const https = require('https');

// Endpoint per ottenere i dati raw dello stock
const CATALOGO_URL = 'https://dashboard-cs-production.up.railway.app/api/suture/catalogo';
const ORDINE_URL = 'https://dashboard-cs-production.up.railway.app/api/suture/ordine';
const ADMIN_KEY = process.env.ADMIN_KEY || '<ADMIN_KEY_STORICA_RIMOSSA>';

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

(async () => {
    try {
        console.log('========================================');
        console.log('VERIFICA COPERTURA SENZA BOZZA');
        console.log('(solo giacenza + PO confermati)');
        console.log('========================================\n');

        // Non posso accedere direttamente allo stock, ma posso dedurre dai dati dell'ordine
        const ordineData = await httpsGet(`${ORDINE_URL}?key=${ADMIN_KEY}`);

        console.log('NOTA: Per una verifica completa serve accesso diretto al database PostgreSQL.');
        console.log('Dalle API posso solo vedere gli ordini clienti "scoperti".\n');

        // La sezione ordini_clienti mostra solo ordini NON coperti da giacenza/arrivo/bozza
        // Ma vogliamo sapere quali sarebbero scoperti SENZA la bozza

        const ordiniClienti = ordineData.ordini_clienti || [];
        const inBozza = ordineData.in_bozza || [];
        const inArrivo = ordineData.in_arrivo || [];

        console.log('SITUAZIONE ATTUALE:');
        console.log(`- Ordini clienti visibili: ${ordiniClienti.length}`);
        console.log(`- Suture in bozza (PO draft): ${inBozza.length} righe`);
        console.log(`- Suture in arrivo (PO confermati): ${inArrivo.length} righe\n`);

        if (ordiniClienti.length === 0) {
            console.log('✓ Nessun ordine cliente scoperto attualmente.');
            console.log('  Ma la dashboard nasconde ordini coperti ANCHE dalla bozza.\n');

            console.log('PRODOTTI IN BOZZA (potrebbero coprire ordini):');
            if (inBozza.length > 0) {
                inBozza.forEach(b => {
                    console.log(`  - ${b.codice}: ${b.quantita} pz`);
                });
                console.log('\n⚠️  Se questi prodotti in bozza NON fossero confermati,');
                console.log('   alcuni ordini clienti potrebbero rimanere scoperti.');
                console.log('\n→ SERVE VERIFICA DATABASE per calcolo preciso giacenza+arrivo vs impegnato');
            } else {
                console.log('  (Nessuna bozza)');
                console.log('\n✓ TUTTI gli ordini sono coperti da giacenza + PO in arrivo');
            }
        } else {
            console.log('❌ Ordini clienti NON coperti (anche senza bozza):');
            ordiniClienti.forEach(o => {
                console.log(`  - ${o.sale_order_name}: ${o.codice} x ${o.qty_to_deliver}`);
            });
        }

        console.log('\n========================================');
        console.log('RACCOMANDAZIONE:');
        console.log('Per verifica precisa serve query diretta:');
        console.log('SELECT codice, giacenza, impegnato, in_arrivo,');
        console.log('       (giacenza - impegnato + in_arrivo) as saldo');
        console.log('FROM suture_stock');
        console.log('WHERE impegnato > 0;');
        console.log('========================================');

    } catch (e) {
        console.error('ERRORE:', e.message);
    }
})();
