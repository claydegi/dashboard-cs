const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    SHOP_ORDER_PUBLIC_NOT_FOUND,
    appendShopOrderCapabilityFragment,
    createShopOrderPublicCapability,
    createShopPublicOrderHandler,
    isShopOrderPublicSecretConfigured,
    verifyShopOrderPublicCapability
} = require('../scripts/shop_public_order_capability');

const SECRET = 'test-secret-with-at-least-32-random-looking-characters-0001';
const ORDER_A = 'OSS-2026-0001';
const ORDER_B = 'OSS-2026-0002';

function createResponse() {
    return {
        body: undefined,
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
        json(body) {
            this.body = body;
            return this;
        }
    };
}

function request(orderNumber, token) {
    return {
        params: { orderNumber },
        headers: token === undefined ? {} : { authorization: token },
        get(name) {
            return this.headers[String(name).toLowerCase()];
        }
    };
}

test('mints a versioned 256-bit HMAC capability and binds it to one order', () => {
    const token = createShopOrderPublicCapability(SECRET, ORDER_A);
    assert.match(token, /^v1\.[A-Za-z0-9_-]{43}$/);
    assert.equal(verifyShopOrderPublicCapability(SECRET, ORDER_A, `Bearer ${token}`), true);
    assert.equal(verifyShopOrderPublicCapability(SECRET, ORDER_B, `Bearer ${token}`), false);
    assert.equal(verifyShopOrderPublicCapability(SECRET, ORDER_A, token), false);
    assert.equal(verifyShopOrderPublicCapability(SECRET, ORDER_A, 'Bearer malformed'), false);
});

test('fails closed when the secret is absent or too short', () => {
    assert.equal(isShopOrderPublicSecretConfigured(''), false);
    assert.equal(isShopOrderPublicSecretConfigured('short'), false);
    assert.equal(createShopOrderPublicCapability('', ORDER_A), null);
    assert.equal(createShopOrderPublicCapability('short', ORDER_A), null);
});

test('an absent server secret returns the same 404 without querying the database', async () => {
    let queryCount = 0;
    const pool = { async query() { queryCount += 1; } };
    const handler = createShopPublicOrderHandler({ pool, secret: undefined });
    const res = createResponse();

    await handler(request(ORDER_A, 'Bearer v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, SHOP_ORDER_PUBLIC_NOT_FOUND);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(queryCount, 0);
});

test('invalid authorization variants are indistinguishable and never query the database', async () => {
    let queryCount = 0;
    const pool = {
        async query() {
            queryCount += 1;
            throw new Error('query must not run');
        }
    };
    const handler = createShopPublicOrderHandler({ pool, secret: SECRET });
    const tokenForOtherOrder = createShopOrderPublicCapability(SECRET, ORDER_B);
    const variants = [
        undefined,
        'Bearer malformed',
        `Bearer ${tokenForOtherOrder}`,
        `Basic ${createShopOrderPublicCapability(SECRET, ORDER_A)}`
    ];

    for (const authorization of variants) {
        const res = createResponse();
        await handler(request(ORDER_A, authorization), res);
        assert.equal(res.statusCode, 404);
        assert.deepEqual(res.body, SHOP_ORDER_PUBLIC_NOT_FOUND);
        assert.equal(res.headers['cache-control'], 'no-store');
        assert.equal(res.headers.vary, 'Authorization');
    }
    assert.equal(queryCount, 0);
});

test('a valid capability returns the order payload needed by the confirmation page', async () => {
    const queries = [];
    const pool = {
        async query(sql, params) {
            queries.push({ sql, params });
            if (queries.length === 1) {
                return {
                    rows: [{
                        order_number: ORDER_A,
                        status: 'paid',
                        payment_method: 'stripe_card',
                        buyer_company: 'Synthetic Dental',
                        buyer_contact_name: 'Synthetic User',
                        buyer_email: 'synthetic@example.invalid',
                        buyer_phone: '+39000000000',
                        buyer_vat: '00000000000',
                        ship_street: 'Synthetic Street 1',
                        ship_zip: '00000',
                        ship_city: 'Synthetic City',
                        ship_prov: 'ZZ',
                        subtotal_net: '100',
                        shipping: '15',
                        vat_amount: '25.30',
                        total_gross: '140.30',
                        customer_notes: '',
                        financing_data: null
                    }]
                };
            }
            return {
                rows: [{
                    product_type: 'synthetic',
                    product_name: 'Synthetic Item',
                    qty: 1,
                    unit_price: '100',
                    is_free_promo: false
                }]
            };
        }
    };
    const handler = createShopPublicOrderHandler({ pool, secret: SECRET });
    const token = createShopOrderPublicCapability(SECRET, ORDER_A);
    const res = createResponse();

    await handler(request(ORDER_A, `Bearer ${token}`), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.orderNumber, ORDER_A);
    assert.equal(res.body.customer.email, 'synthetic@example.invalid');
    assert.equal(res.body.items.length, 1);
    assert.equal(queries.length, 2);
    assert.deepEqual(queries[0].params, [ORDER_A]);
    assert.deepEqual(queries[1].params, [ORDER_A]);
});

test('a valid capability for a nonexistent order uses the same 404 envelope', async () => {
    const pool = { async query() { return { rows: [] }; } };
    const handler = createShopPublicOrderHandler({ pool, secret: SECRET });
    const token = createShopOrderPublicCapability(SECRET, ORDER_A);
    const res = createResponse();

    await handler(request(ORDER_A, `Bearer ${token}`), res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, SHOP_ORDER_PUBLIC_NOT_FOUND);
});

test('database failures are sanitized and never log or return the capability', async () => {
    const token = createShopOrderPublicCapability(SECRET, ORDER_A);
    const logs = [];
    const pool = { async query() { throw new Error(`database failed ${token}`); } };
    const logger = { error(...args) { logs.push(args.join(' ')); } };
    const handler = createShopPublicOrderHandler({ pool, secret: SECRET, logger });
    const res = createResponse();

    await handler(request(ORDER_A, `Bearer ${token}`), res);

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Errore server' });
    assert.equal(JSON.stringify(res.body).includes(token), false);
    assert.equal(logs.join('\n').includes(token), false);
    assert.match(logs.join('\n'), /\[REDACTED\]/);
});

test('direct redirect capabilities are transported only in the URL fragment', () => {
    const token = createShopOrderPublicCapability(SECRET, ORDER_A);
    const url = appendShopOrderCapabilityFragment(`/shop/ordine-confermato/?id=${ORDER_A}`, token);
    assert.equal(url, `/shop/ordine-confermato/?id=${ORDER_A}#order_token=${token}`);
    assert.equal(url.split('#')[0].includes(token), false);
});

test('server integration keeps capability out of Stripe URLs and metadata', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const f9Checkout = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'f9_checkout.js'), 'utf8');
    assert.match(server, /SHOP_ORDER_PUBLIC_TOKEN_SECRET:\s*process\.env\.SHOP_ORDER_PUBLIC_TOKEN_SECRET/);
    assert.doesNotMatch(server, /SHOP_ORDER_PUBLIC_TOKEN_SECRET[^,\n]*\|\|[^,\n]*['"][^'"]+['"]/);
    assert.doesNotMatch(server, /success_url:[^\n]*order_token/);
    assert.doesNotMatch(server, /metadata:\s*\{[^}]*publicOrderToken/s);
    assert.match(server, /buildShopBccCustomerEmailHtml\(orderForEmail, methodLabel, publicOrderToken\)/);
    assert.match(server, /appendShopOrderCapabilityFragment\(`https:\/\/www\.osseotouch\.com\/shop\/ordine-finanziamento-inviato\/\?id=/);
    // Due flussi italiani preesistenti + conferma first-party del checkout F9 TEST.
    assert.equal((server.match(/\n\s+publicOrderToken,/g) || []).length, 3);
    assert.match(server, /app\.get\('\/api\/shop\/orders\/public\/:orderNumber', createShopPublicOrderHandler/);
    assert.match(server, /app\.post\('\/api\/shop\/checkout'[\s\S]*?res\.set\('Cache-Control', 'private, no-store, max-age=0'\)/);
    assert.match(server, /app\.post\('\/api\/shop-us\/checkout', f9CheckoutHandler\)/);
    assert.match(f9Checkout, /res\.set\('Cache-Control', 'private, no-store, max-age=0'\)/);
});
