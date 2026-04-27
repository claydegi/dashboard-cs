const CONFIG = {
    ODOO_URL: process.env.ODOO_URL || 'https://osseotouch.odoo.com',
    ODOO_DB: process.env.ODOO_DB || 'ati-comunicazione-osseotouch-produzione-26370252',
    ODOO_USER: process.env.ODOO_USER || 'admin',
    ODOO_API_KEY: process.env.ODOO_API_KEY || ''
};

async function odooJsonRpc(endpoint, method, params) {
    const url = `${CONFIG.ODOO_URL}/jsonrpc`;
    const payload = {
        jsonrpc: '2.0',
        method: 'call',
        params: { service: endpoint, method, args: params },
        id: Math.random()
    };
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.error) throw new Error(JSON.stringify(data.error));
    return data.result;
}

async function main() {
    console.log('[1/4] Autenticazione Odoo...');
    const uid = await odooJsonRpc('common', 'authenticate', [
        CONFIG.ODOO_DB, CONFIG.ODOO_USER, CONFIG.ODOO_API_KEY, {}
    ]);
    if (!uid) throw new Error('Auth fallita');
    console.log('OK - UID:', uid);

    console.log('\n[2/4] Cerco fornitore VITREX...');
    const partners = await odooJsonRpc('object', 'execute_kw', [
        CONFIG.ODOO_DB, uid, CONFIG.ODOO_API_KEY, 'res.partner', 'search_read',
        [[['name', 'ilike', 'VITREX MEDICAL']]],
        { fields: ['id', 'name'], context: { allowed_company_ids: [1] } }
    ]);
    if (!partners.length) throw new Error('VITREX non trovato');
    const partnerId = partners[0].id;
    console.log(`OK - VITREX: ID ${partnerId} - ${partners[0].name}`);

    console.log('\n[3/4] Cerco PO draft VITREX...');
    const pos = await odooJsonRpc('object', 'execute_kw', [
        CONFIG.ODOO_DB, uid, CONFIG.ODOO_API_KEY, 'purchase.order', 'search_read',
        [[['partner_id', '=', partnerId], ['state', '=', 'draft'], ['company_id', '=', 1]]],
        { fields: ['id', 'name', 'state', 'date_order'], context: { allowed_company_ids: [1] } }
    ]);

    if (pos.length === 0) {
        console.log('NESSUN PO DRAFT per VITREX trovato!');
        console.log('\nPROBLEMA: Non esistono PO draft in Odoo. Devi crearne uno prima.');
        return;
    }

    console.log(`OK - Trovati ${pos.length} PO draft per VITREX`);

    console.log('\n[4/4] Dettaglio righe PO draft:');
    for (const po of pos) {
        console.log(`\n  PO: ${po.name} (ID: ${po.id})`);
        console.log(`  Stato: ${po.state}`);
        console.log(`  Data: ${po.date_order}`);

        const lines = await odooJsonRpc('object', 'execute_kw', [
            CONFIG.ODOO_DB, uid, CONFIG.ODOO_API_KEY, 'purchase.order.line', 'search_read',
            [[['order_id', '=', po.id]]],
            { fields: ['product_id', 'product_qty', 'qty_received', 'price_unit'], context: { allowed_company_ids: [1] } }
        ]);

        console.log(`  Righe: ${lines.length}`);

        if (lines.length === 0) {
            console.log('    (PO draft vuoto - nessuna riga)');
        }

        for (const line of lines) {
            const pendente = line.product_qty - line.qty_received;
            console.log(`    - Prodotto: ${line.product_id[1]}`);
            console.log(`      ID: ${line.product_id[0]}`);
            console.log(`      Quantita: ${line.product_qty}`);
            console.log(`      Ricevuto: ${line.qty_received}`);
            console.log(`      Pendente: ${pendente}`);
        }
    }

    console.log('\n========================================');
    console.log('VERIFICA COMPLETATA');
    console.log('========================================');
}

main().catch(e => {
    console.error('\nERRORE:', e.message);
    process.exit(1);
});
