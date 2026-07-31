const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    MAX_PAGE_SIZE,
    createKesselShopOrdersExportHandler,
    serializeOrder
} = require('../scripts/kessel_shop_orders_export');

const API_KEY = 'synthetic-kessel-export-api-key-at-least-32-bytes';
const CONTRACT = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'f9_shop_contract.json'),
    'utf8'
));

function response() {
    return {
        body: null,
        headers: {},
        statusCode: 200,
        set(name, value) {
            this.headers[name.toLowerCase()] = value;
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(value) {
            this.body = value;
            return this;
        }
    };
}

function request(query = {}, apiKey = API_KEY) {
    return {
        query,
        headers: apiKey === undefined ? {} : { 'x-api-key': apiKey },
        get(name) {
            return this.headers[String(name).toLowerCase()];
        }
    };
}

function order(id, overrides = {}) {
    return {
        id,
        order_number: `OSS-2026-${String(id).padStart(4, '0')}`,
        status: 'paid',
        created_at: new Date('2026-07-31T08:00:00.000Z'),
        confirmed_at: new Date('2026-07-31T08:05:00.000Z'),
        cancelled_at: null,
        ship_country: 'US',
        market: 'US',
        flow: 'buy_now',
        currency: 'USD',
        subtotal_net: '100.00',
        shipping: '0.00',
        vat_amount: '0.00',
        sales_tax: '0.00',
        total_gross: '100.00',
        is_test: false,
        is_deleted: false,
        buyer_email: `synthetic-${id}@example.invalid`,
        buyer_phone: '+10000000000',
        myosseotouch_ref_hash: 'a'.repeat(64),
        myosseotouch_ref_state: 'accepted',
        myosseotouch_ref_purpose: 'live',
        ...overrides
    };
}

function item(orderId) {
    return {
        id: orderId,
        order_id: orderId,
        product_type: 'kit',
        product_code: `SKU-${orderId}`,
        product_name: `Synthetic kit ${orderId}`,
        qty: 1,
        unit_price: '100.00',
        vat_rate: '0.00',
        is_free_promo: false
    };
}

test('serializer matches the shared KESSEL export_order contract literally', () => {
    const expected = CONTRACT.export_order;
    const databaseOrder = {
        id: expected.id,
        order_number: expected.order_number,
        status: expected.status,
        created_at: new Date(expected.created_at),
        confirmed_at: new Date(expected.confirmed_at),
        cancelled_at: expected.cancelled_at,
        ship_country: expected.ship_country,
        market: expected.market_hint,
        flow: expected.flow,
        currency: expected.currency,
        subtotal_net: expected.subtotal_net,
        shipping: expected.shipping,
        vat_amount: expected.vat_amount,
        sales_tax: expected.sales_tax,
        total_gross: expected.total_gross,
        is_test: expected.is_test,
        is_deleted: expected.is_deleted,
        buyer_email: expected.identity.email,
        buyer_phone: expected.identity.phone,
        myosseotouch_ref_hash: expected.reference.hash,
        myosseotouch_ref_state: expected.reference.state,
        myosseotouch_ref_purpose: expected.reference.purpose
    };
    const databaseItems = expected.items.map((row, index) => ({
        id: index + 1,
        order_id: expected.id,
        product_type: row.product_type,
        product_code: row.product_code,
        product_name: row.product_name,
        qty: row.qty,
        unit_price: row.unit_price,
        vat_rate: row.vat_rate,
        is_free_promo: row.is_free_promo
    }));

    assert.deepEqual(serializeOrder(databaseOrder, databaseItems), expected);
});

test('auth is dedicated and fails closed without touching the database', async () => {
    for (const configuredKey of [undefined, '']) {
        let queries = 0;
        const pool = { async query() { queries += 1; } };
        const handler = createKesselShopOrdersExportHandler({ pool, apiKey: configuredKey });
        const res = response();
        await handler(request({}, undefined), res);
        assert.equal(res.statusCode, 401);
        assert.equal(queries, 0);
    }

    let queries = 0;
    const pool = { async query() { queries += 1; } };
    const handler = createKesselShopOrdersExportHandler({ pool, apiKey: API_KEY });
    const res = response();
    await handler(request({}, 'wrong-key'), res);
    assert.equal(res.statusCode, 401);
    assert.equal(queries, 0);

    queries = 0;
    const shortHandler = createKesselShopOrdersExportHandler({
        pool,
        apiKey: 'same-short-key'
    });
    const shortRes = response();
    await shortHandler(request({}, 'same-short-key'), shortRes);
    assert.equal(shortRes.statusCode, 401);
    assert.equal(queries, 0);
});

test('first page freezes snapshot, caps page at 200 and keeps Decimal strings', async () => {
    const rows = Array.from({ length: MAX_PAGE_SIZE + 1 }, (_, index) => order(index + 1));
    const queries = [];
    const pool = {
        async query(sql, params) {
            queries.push({ sql, params });
            if (queries.length === 1) return { rows: [{ snapshot_max_id: 250, total: 250 }] };
            if (queries.length === 2) return { rows };
            return { rows: rows.slice(0, MAX_PAGE_SIZE).map(row => item(row.id)) };
        }
    };
    const handler = createKesselShopOrdersExportHandler({ pool, apiKey: API_KEY });
    const res = response();
    await handler(request(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.orders.length, 200);
    assert.equal(res.body.total, 250);
    assert.equal(res.body.has_more, true);
    assert.equal(res.body.snapshot_max_id, 250);
    assert.deepEqual(queries[1].params, [0, 250, 201]);
    assert.equal(res.body.orders[0].subtotal_net, '100.00');
    assert.equal(res.body.orders[0].items[0].unit_price, '100.00');
    assert.equal(res.body.orders[0].items[0].position, 1);
    assert.equal(res.body.orders[0].identity.email, 'synthetic-1@example.invalid');
    assert.equal(res.headers['cache-control'], 'private, no-store, max-age=0');
});

test('subsequent pages keep the supplied snapshot and export future/deleted states', async () => {
    const future = order(250, {
        status: 'future_status',
        is_deleted: true,
        ship_country: 'IT',
        buyer_email: 'must-not-leave@example.invalid',
        buyer_phone: '+39000000000',
        myosseotouch_ref_hash: null,
        myosseotouch_ref_state: 'absent',
        myosseotouch_ref_purpose: null
    });
    const queries = [];
    const pool = {
        async query(sql, params) {
            queries.push({ sql, params });
            if (queries.length === 1) return { rows: [{ total: 250 }] };
            if (queries.length === 2) return { rows: [future] };
            return { rows: [item(250)] };
        }
    };
    const handler = createKesselShopOrdersExportHandler({ pool, apiKey: API_KEY });
    const res = response();
    await handler(request({ after_id: '200', snapshot_max_id: '250', limit: '50' }), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(queries[0].params, [250]);
    assert.deepEqual(queries[1].params, [200, 250, 51]);
    assert.equal(res.body.orders[0].status, 'future_status');
    assert.equal(res.body.orders[0].is_deleted, true);
    assert.equal('identity' in res.body.orders[0], false);
    assert.equal(JSON.stringify(res.body).includes('must-not-leave@example.invalid'), false);
});

test('nullable historical order amounts remain null without blocking the snapshot', async () => {
    const historical = order(1, {
        subtotal_net: null,
        shipping: null,
        vat_amount: null,
        sales_tax: null,
        total_gross: null
    });
    let call = 0;
    const pool = {
        async query() {
            call += 1;
            if (call === 1) return { rows: [{ snapshot_max_id: 1, total: 1 }] };
            if (call === 2) return { rows: [historical] };
            return { rows: [item(1)] };
        }
    };
    const handler = createKesselShopOrdersExportHandler({ pool, apiKey: API_KEY });
    const res = response();
    await handler(request(), res);

    assert.equal(res.statusCode, 200);
    for (const field of [
        'subtotal_net',
        'shipping',
        'vat_amount',
        'sales_tax',
        'total_gross'
    ]) {
        assert.equal(res.body.orders[0][field], null, field);
    }
});

test('after_id cannot be used outside a declared snapshot run', async () => {
    let queries = 0;
    const pool = { async query() { queries += 1; } };
    const handler = createKesselShopOrdersExportHandler({ pool, apiKey: API_KEY });
    const res = response();
    await handler(request({ after_id: '1' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(queries, 0);
});

test('invalid Decimal fails the whole page with a generic response and no PII log', async () => {
    const logs = [];
    const bad = order(1, {
        subtotal_net: 'NaN',
        buyer_email: 'never-log@example.invalid'
    });
    let call = 0;
    const pool = {
        async query() {
            call += 1;
            if (call === 1) return { rows: [{ snapshot_max_id: 1, total: 1 }] };
            if (call === 2) return { rows: [bad] };
            return { rows: [] };
        }
    };
    const logger = { error(...args) { logs.push(args.join(' ')); } };
    const handler = createKesselShopOrdersExportHandler({ pool, apiKey: API_KEY, logger });
    const res = response();
    await handler(request(), res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Export shop non disponibile' });
    assert.equal(logs.join('\n').includes('never-log@example.invalid'), false);
    assert.equal(logs.join('\n').includes('NaN'), false);
});

test('export source has no status allowlist, OFFSET, volatile or forbidden fields', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'kessel_shop_orders_export.js'),
        'utf8'
    );
    assert.match(source, /WHERE id > \$1 AND id <= \$2/);
    assert.match(source, /ORDER BY id ASC/);
    assert.doesNotMatch(source, /\bOFFSET\b/);
    assert.doesNotMatch(source, /status\s+IN\s*\(/i);
    for (const forbidden of [
        'ship_street',
        'ship_zip',
        'ship_city',
        'buyer_contact_name',
        'practice_name',
        'customer_notes',
        'internal_notes',
        'financing_data',
        'stripe_session_id',
        'quickbooks_invoice_id',
        'quickbooks_invoice_url',
        'myosseotouch_origin'
    ]) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});
