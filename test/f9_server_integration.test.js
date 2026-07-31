const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
    buildMyOsseotouchShopBridgeTag,
    evaluateMyOsseotouchShopBridgeReference
} = require('../scripts/myosseotouch_shop_bridge');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function routeBody(startMarker, endMarker) {
    const start = server.indexOf(startMarker);
    const end = server.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0, startMarker);
    assert.ok(end > start, endMarker);
    return server.slice(start, end);
}

function executableRoute(startMarker, endMarker, globals = {}) {
    const route = routeBody(startMarker, endMarker).trim();
    const functionStart = route.indexOf('async (req, res) =>');
    assert.ok(functionStart > 0);
    const functionSource = route
        .slice(functionStart)
        .replace(/\}\);\s*$/, '}');
    return vm.runInNewContext(`(${functionSource})`, {
        Buffer,
        Date,
        Math,
        Number,
        String,
        encodeURIComponent,
        evaluateMyOsseotouchShopBridgeReference,
        ...globals
    });
}

test('schema is additive, constrained and deliberately non-unique on reference hash', () => {
    for (const column of [
        'myosseotouch_ref_hash',
        'myosseotouch_ref_state',
        'myosseotouch_origin',
        'myosseotouch_ref_validated_at',
        'myosseotouch_ref_purpose'
    ]) {
        assert.match(server, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
    }
    assert.match(server, /shop_orders_myosseotouch_ref_consistency/);
    assert.match(server, /CREATE INDEX IF NOT EXISTS idx_shop_orders_myosseotouch_ref_hash/);
    assert.doesNotMatch(server, /UNIQUE[^\n]*myosseotouch_ref_hash/i);
});

test('quote TEST gate runs before pool and accepted TEST returns before every email', () => {
    const quote = routeBody(
        "app.post('/api/shop-us/quote-request'",
        '// ==================== SHOP USA — Buy Now'
    );
    const gate = quote.indexOf('bridgeDecision.rejectRequest');
    const poolConnect = quote.indexOf('pool.connect()');
    const testReturn = quote.indexOf('if (bridgeDecision.isTest)');
    const email = quote.indexOf('sendMailgunEmail(');
    assert.ok(gate > 0 && gate < poolConnect);
    assert.ok(testReturn > poolConnect && testReturn < email);
    assert.match(quote, /myosseotouch_ref_hash[\s\S]*bridgeDecision\.hash/);
});

test('checkout TEST gate precedes pool/Stripe and accepted TEST returns before Stripe', () => {
    const checkout = routeBody(
        "app.post('/api/shop-us/checkout'",
        '// ==================== AVVIO SERVER'
    );
    const gate = checkout.indexOf('bridgeDecision.rejectRequest');
    const poolConnect = checkout.indexOf('const client = await pool.connect()');
    const testReturn = checkout.indexOf('if (bridgeDecision.isTest)');
    const stripeCall = checkout.indexOf('stripe.checkout.sessions.create');
    assert.ok(gate > 0 && gate < poolConnect);
    assert.ok(gate < stripeCall);
    assert.ok(testReturn > poolConnect && testReturn < stripeCall);
    assert.match(checkout, /bridgeDecision\.isTest \? 'confirmed' : 'pending_payment'/);
    assert.match(checkout, /bridgeDecision\.isTest \? 'test_no_payment' : 'stripe_card'/);
});

test('a signed TEST reference tampered to live exits both real handlers before all effects', async () => {
    const secret = 'f9-endpoint-test-secret-with-at-least-32-bytes';
    const random = 'A'.repeat(43);
    const expiry = String(Math.floor(Date.now() / 1000) + 3600);
    const testTag = buildMyOsseotouchShopBridgeTag(secret, random, expiry, 'test');
    const tampered = `v1.${random}.${expiry}.live.${testTag}`;
    const counters = { pool: 0, stripe: 0, email: 0, quickbooks: 0 };

    const makeContext = () => ({
            CONFIG: {
                MYOSSEOTOUCH_SHOP_BRIDGE_SECRET: secret,
                MYOSSEOTOUCH_SHOP_TEST_MODE: true
            },
            pool: {
                async connect() {
                    counters.pool += 1;
                    throw new Error('pool must not run');
                }
            },
            stripe: {
                checkout: {
                    sessions: {
                        async create() {
                            counters.stripe += 1;
                            throw new Error('Stripe must not run');
                        }
                    }
                }
            },
            sendMailgunEmail() {
                counters.email += 1;
            },
            quickbooks() {
                counters.quickbooks += 1;
            }
    });
    const routeCases = [
        executableRoute(
            "app.post('/api/shop-us/quote-request'",
            '// ==================== SHOP USA — Buy Now',
            makeContext()
        ),
        executableRoute(
            "app.post('/api/shop-us/checkout'",
            '// ==================== AVVIO SERVER',
            makeContext()
        )
    ];

    for (const handler of routeCases) {
        const res = {
            statusCode: 200,
            body: null,
            set() { return this; },
            status(code) { this.statusCode = code; return this; },
            json(body) { this.body = body; return this; }
        };
        await handler({ body: { myosseotouch_ref: tampered } }, res);
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'TEST shop reference not available');
    }
    assert.deepEqual(counters, { pool: 0, stripe: 0, email: 0, quickbooks: 0 });
});

test('a valid TEST reference persists hash-only and bypasses every commercial effect', async () => {
    const secret = 'f9-endpoint-test-secret-with-at-least-32-bytes';
    const random = 'C'.repeat(43);
    const expiry = String(Math.floor(Date.now() / 1000) + 3600);
    const tag = buildMyOsseotouchShopBridgeTag(secret, random, expiry, 'test');
    const reference = `v1.${random}.${expiry}.test.${tag}`;
    const counters = { stripe: 0, email: 0, quickbooks: 0 };
    const inserts = [];
    let nextOrder = 1;

    function makeClient() {
        return {
            async query(sql, params) {
                if (/INSERT INTO shop_orders/.test(sql)) {
                    inserts.push({ sql, params });
                    return { rows: [{ id: inserts.length }] };
                }
                return { rows: [] };
            },
            release() {}
        };
    }

    const commonContext = {
        CONFIG: {
            MYOSSEOTOUCH_SHOP_BRIDGE_SECRET: secret,
            MYOSSEOTOUCH_SHOP_TEST_MODE: true,
            SHOP_ORDER_PUBLIC_TOKEN_SECRET: 'synthetic-public-secret',
            SHOP_FRONTEND_URL: 'https://shop.example.invalid'
        },
        process: { env: { NODE_ENV: 'production' } },
        pool: { async connect() { return makeClient(); } },
        async generateShopOrderNumber() {
            const value = `OSS-US-TEST-${nextOrder}`;
            nextOrder += 1;
            return value;
        },
        sendMailgunEmail() {
            counters.email += 1;
            return Promise.resolve();
        },
        buildShopUsCustomerEmailHtml() { return '<p>synthetic</p>'; },
        buildShopUsInternalEmailHtml() { return '<p>synthetic</p>'; },
        isShopOrderPublicSecretConfigured() { return true; },
        createShopOrderPublicCapability() { return 'synthetic-public-capability'; },
        stripe: {
            checkout: {
                sessions: {
                    async create() {
                        counters.stripe += 1;
                        throw new Error('Stripe must not run');
                    }
                }
            }
        },
        quickbooks() {
            counters.quickbooks += 1;
        },
        console: { error() {} }
    };
    const handlers = [
        executableRoute(
            "app.post('/api/shop-us/quote-request'",
            '// ==================== SHOP USA — Buy Now',
            commonContext
        ),
        executableRoute(
            "app.post('/api/shop-us/checkout'",
            '// ==================== AVVIO SERVER',
            commonContext
        )
    ];
    const body = {
        myosseotouch_ref: reference,
        customer: {
            full_name: 'Synthetic Customer',
            email: 'synthetic@example.invalid',
            phone: '+10000000000'
        },
        shipping_address: {
            street: '1 Synthetic Way',
            city: 'Testville',
            state: 'AL',
            zip: '00000'
        },
        items: [{ id: 'SKU-1', name: 'Synthetic item', qty: 1, price: '1.00' }]
    };
    const responses = [];

    for (const handler of handlers) {
        const res = {
            statusCode: 200,
            body: null,
            set() { return this; },
            status(code) { this.statusCode = code; return this; },
            json(value) { this.body = value; return this; }
        };
        await handler({ body }, res);
        responses.push(res);
    }

    assert.equal(inserts.length, 2);
    for (const insert of inserts) {
        assert.equal(insert.params[22], true);
        assert.equal(insert.params.at(-4), 'accepted');
        assert.equal(insert.params.at(-3), 'myosseotouch_us');
        assert.equal(insert.params.at(-1), 'test');
        assert.match(insert.params.at(-5), /^[0-9a-f]{64}$/);
        assert.equal(JSON.stringify(insert.params).includes(reference), false);
    }
    assert.equal(inserts[1].params[1], 'confirmed');
    assert.equal(inserts[1].params[2], 'test_no_payment');
    assert.equal(responses[0].body.isTest, true);
    assert.equal(responses[1].body.isTest, true);
    assert.match(responses[1].body.sessionUrl, /^https:\/\/shop\.example\.invalid\/en\/shop\/order-confirmed\//);
    assert.deepEqual(counters, { stripe: 0, email: 0, quickbooks: 0 });
});

test('an invalid live reference keeps the quote commercial path but persists no raw or attribution', async () => {
    const invalidLive = `v1.${'A'.repeat(43)}.2000000000.live.${'B'.repeat(43)}`;
    const queries = [];
    let emails = 0;
    let released = 0;
    const client = {
        async query(sql, params) {
            queries.push({ sql, params });
            if (/INSERT INTO shop_orders/.test(sql)) return { rows: [{ id: 77 }] };
            return { rows: [] };
        },
        release() {
            released += 1;
        }
    };
    const handler = executableRoute(
        "app.post('/api/shop-us/quote-request'",
        '// ==================== SHOP USA — Buy Now',
        {
            CONFIG: {
                MYOSSEOTOUCH_SHOP_BRIDGE_SECRET:
                    'f9-endpoint-test-secret-with-at-least-32-bytes',
                MYOSSEOTOUCH_SHOP_TEST_MODE: false
            },
            process: { env: { NODE_ENV: 'production' } },
            pool: { async connect() { return client; } },
            async generateShopOrderNumber() { return 'OSS-US-SYNTHETIC'; },
            sendMailgunEmail() {
                emails += 1;
                return Promise.resolve();
            },
            buildShopUsCustomerEmailHtml() { return '<p>synthetic</p>'; },
            buildShopUsInternalEmailHtml() { return '<p>synthetic</p>'; },
            console: { error() {} }
        }
    );
    const res = {
        statusCode: 200,
        body: null,
        set() { return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };

    await handler({
        body: {
            myosseotouch_ref: invalidLive,
            customer: {
                full_name: 'Synthetic Customer',
                email: 'synthetic@example.invalid',
                phone: '+10000000000'
            },
            shipping_address: {
                street: '1 Synthetic Way',
                city: 'Testville',
                state: 'AL',
                zip: '00000'
            },
            items: [{ id: 'SKU-1', name: 'Synthetic item', qty: 1, price: '1.00' }]
        }
    }, res);

    const orderInsert = queries.find(query => /INSERT INTO shop_orders/.test(query.sql));
    assert.equal(res.statusCode, 200);
    assert.equal(emails, 2);
    assert.equal(released, 1);
    assert.equal(
        JSON.stringify(orderInsert.params.slice(-5)),
        JSON.stringify([null, 'invalid', null, null, null])
    );
    assert.equal(JSON.stringify({ queries, response: res.body }).includes(invalidLive), false);
});

test('checkout without a valid live attribution retains the legacy Stripe flow', async () => {
    const expiry = String(Math.floor(Date.now() / 1000) + 3600);
    const invalidLive = `v1.${'D'.repeat(43)}.${expiry}.live.${'E'.repeat(43)}`;
    const cases = [
        { reference: undefined, expectedState: 'absent' },
        { reference: invalidLive, expectedState: 'invalid' }
    ];

    for (const { reference, expectedState } of cases) {
        let connectCount = 0;
        let stripeCalls = 0;
        let orderInsert = null;
        let stripeUpdate = null;
        const outerClient = {
            async query(sql, params) {
                if (/INSERT INTO shop_orders/.test(sql)) {
                    orderInsert = { sql, params };
                    return { rows: [{ id: 88 }] };
                }
                return { rows: [] };
            },
            release() {}
        };
        const innerClient = {
            async query(sql, params) {
                stripeUpdate = { sql, params };
                return { rows: [] };
            },
            release() {}
        };
        const handler = executableRoute(
            "app.post('/api/shop-us/checkout'",
            '// ==================== AVVIO SERVER',
            {
                CONFIG: {
                    MYOSSEOTOUCH_SHOP_BRIDGE_SECRET:
                        'f9-endpoint-test-secret-with-at-least-32-bytes',
                    MYOSSEOTOUCH_SHOP_TEST_MODE: false,
                    SHOP_ORDER_PUBLIC_TOKEN_SECRET: 'synthetic-public-secret',
                    SHOP_FRONTEND_URL: 'https://shop.example.invalid'
                },
                process: { env: { NODE_ENV: 'production' } },
                pool: {
                    async connect() {
                        connectCount += 1;
                        return connectCount === 1 ? outerClient : innerClient;
                    }
                },
                async generateShopOrderNumber() { return 'OSS-US-LIVE-SYNTHETIC'; },
                isShopOrderPublicSecretConfigured() { return true; },
                createShopOrderPublicCapability() { return 'synthetic-public-capability'; },
                stripe: {
                    checkout: {
                        sessions: {
                            async create() {
                                stripeCalls += 1;
                                return {
                                    id: 'cs_synthetic',
                                    url: 'https://checkout.example.invalid/session'
                                };
                            }
                        }
                    }
                },
                console: { error() {} }
            }
        );
        const res = {
            statusCode: 200,
            body: null,
            set() { return this; },
            status(code) { this.statusCode = code; return this; },
            json(value) { this.body = value; return this; }
        };
        const body = {
            customer: {
                full_name: 'Synthetic Customer',
                email: 'synthetic@example.invalid',
                phone: '+10000000000'
            },
            shipping_address: {
                street: '1 Synthetic Way',
                city: 'Testville',
                state: 'AL',
                zip: '00000'
            },
            items: [{ id: 'SKU-1', name: 'Synthetic item', qty: 1, price: '1.00' }]
        };
        if (reference !== undefined) body.myosseotouch_ref = reference;

        await handler({ body }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(stripeCalls, 1);
        assert.equal(orderInsert.params[1], 'pending_payment');
        assert.equal(orderInsert.params[2], 'stripe_card');
        assert.equal(orderInsert.params[22], false);
        assert.equal(orderInsert.params.at(-4), expectedState);
        assert.equal(orderInsert.params.at(-5), null);
        assert.match(stripeUpdate.sql, /UPDATE shop_orders SET stripe_session_id/);
        assert.equal(res.body.sessionUrl, 'https://checkout.example.invalid/session');
        if (reference !== undefined) {
            assert.equal(JSON.stringify({ orderInsert, stripeUpdate, response: res.body }).includes(reference), false);
        }
    }
});

test('raw bridge reference is absent from Stripe metadata, URLs, emails and public output', () => {
    const checkout = routeBody(
        "app.post('/api/shop-us/checkout'",
        '// ==================== AVVIO SERVER'
    );
    const metadataStart = checkout.indexOf('metadata: {');
    const metadataEnd = checkout.indexOf('}', metadataStart);
    assert.ok(metadataStart > 0 && metadataEnd > metadataStart);
    assert.equal(checkout.slice(metadataStart, metadataEnd).includes('myosseotouch'), false);
    assert.doesNotMatch(server, /success_url:[^\n]*myosseotouch/i);
    assert.doesNotMatch(server, /cancel_url:[^\n]*myosseotouch/i);
    assert.doesNotMatch(server, /\[shop-us quote-request\] error:', err\)/);
    assert.doesNotMatch(server, /Could not save quote request:.*err\.message/);

    const publicRoute = routeBody(
        "app.get('/api/shop/orders/public/:orderNumber'",
        '// ----- KESSEL F9'
    );
    assert.equal(publicRoute.includes('myosseotouch_ref_hash'), false);
    assert.equal(publicRoute.includes('myosseotouch_ref_state'), false);
});

test('Kessel export is wired to the dedicated fail-closed factory', () => {
    assert.match(
        server,
        /KESSEL_SHOP_EXPORT_API_KEY:\s*process\.env\.KESSEL_SHOP_EXPORT_API_KEY/
    );
    assert.match(
        server,
        /app\.get\('\/api\/kessel\/shop-orders', createKesselShopOrdersExportHandler\(\{\s*pool,\s*apiKey: CONFIG\.KESSEL_SHOP_EXPORT_API_KEY\s*\}\)\);/s
    );
    assert.doesNotMatch(server, /KESSEL_SHOP_EXPORT_API_KEY:[^\n]*(?:REPORTS_API_KEY|ADMIN_API_KEY)/);
});
