const assert = require('node:assert/strict');
const test = require('node:test');
const {
    createKesselShopOrdersExportHandler,
    serializeOrder
} = require('../scripts/kessel_shop_orders_export');

const API_KEY = 'synthetic-kessel-export-api-key-at-least-32-bytes';
function response() {
    return {
        statusCode: 200, body: null, headers: {},
        set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; }
    };
}
function request(query = {}, key = API_KEY) {
    return { query, headers: { 'x-api-key': key }, get(name) { return this.headers[name]; } };
}
function order(id = 1) {
    return {
        id, order_number: 'OSS-2026-0001', status: 'paid',
        created_at: new Date('2026-07-31T08:00:00Z'), confirmed_at: null, cancelled_at: null,
        ship_country: 'US', market: 'US', flow: 'buy_now', currency: 'USD',
        subtotal_net: '100.00', shipping: '0.00', vat_amount: '0.00',
        sales_tax: '0.00', total_gross: '100.00', is_test: true, is_deleted: false,
        buyer_email: 'synthetic@example.invalid', buyer_phone: '+10000000000',
        myosseotouch_ref_hash: null, myosseotouch_ref_state: 'absent',
        myosseotouch_ref_purpose: null,
        f9_acceptance_id: '00000000-0000-4000-8000-000000000094',
        f9_proposal_id: 'P-94', f9_snapshot_version: 'a'.repeat(64),
        f9_snapshot_hash: 'a'.repeat(64)
    };
}
function item(orderId = 1) {
    return {
        id: 1, order_id: orderId, product_type: 'proposal', product_code: 'SKU-94',
        product_name: 'Synthetic', qty: 1, unit_price: '100.00',
        vat_rate: '0.00', is_free_promo: false
    };
}

test('serializer exports acceptance binding and Decimal strings', () => {
    const payload = serializeOrder(order(), [item()]);
    assert.equal(payload.acceptance.acceptance_id, '00000000-0000-4000-8000-000000000094');
    assert.equal(payload.acceptance.proposal_snapshot_version, 'a'.repeat(64));
    assert.equal(payload.subtotal_net, '100.00');
    assert.equal(payload.items[0].unit_price, '100.00');
});

test('first page freezes snapshot_revision', async () => {
    let call = 0;
    const pool = {
        async query() {
            call += 1;
            if (call === 1) return { rows: [{ snapshot_revision: '94', total: 1 }] };
            if (call === 2) return { rows: [order()] };
            if (call === 3) return { rows: [item()] };
            return { rows: [{ current_revision: '94' }] };
        }
    };
    const handler = createKesselShopOrdersExportHandler({ pool, apiKey: API_KEY });
    const res = response();
    await handler(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.snapshot_revision, 94);
    assert.equal(res.body.orders.length, 1);
});

test('first page rejects a mutation that happens while rows are being serialized', async () => {
    let call = 0;
    const pool = {
        async query() {
            call += 1;
            if (call === 1) return { rows: [{ snapshot_revision: '94', total: 1 }] };
            if (call === 2) return { rows: [order()] };
            if (call === 3) return { rows: [item()] };
            return { rows: [{ current_revision: '95' }] };
        }
    };
    const handler = createKesselShopOrdersExportHandler({ pool, apiKey: API_KEY });
    const res = response();
    await handler(request(), res);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, { error: 'snapshot_drift' });
});

test('subsequent page rejects drift instead of mixing snapshots', async () => {
    const pool = {
        async query() {
            return { rows: [{ current_revision: '95', total: 1 }] };
        }
    };
    const handler = createKesselShopOrdersExportHandler({ pool, apiKey: API_KEY });
    const res = response();
    await handler(request({ after_id: '1', snapshot_revision: '94' }), res);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, { error: 'snapshot_drift' });
});

test('missing or wrong dedicated key fails before database', async () => {
    let calls = 0;
    const pool = { async query() { calls += 1; } };
    const handler = createKesselShopOrdersExportHandler({ pool, apiKey: API_KEY });
    const res = response();
    await handler(request({}, 'wrong'), res);
    assert.equal(res.statusCode, 401);
    assert.equal(calls, 0);
});
