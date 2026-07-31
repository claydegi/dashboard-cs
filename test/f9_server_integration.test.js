const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('F9 schema has acceptance binding, snapshot revision and Stripe generations', () => {
    for (const literal of [
        'snapshot_revision BIGINT',
        'idempotency_key TEXT',
        'f9_acceptance_id UUID',
        'f9_snapshot_version TEXT',
        'f9_snapshot_hash TEXT',
        'shop_order_stripe_attempts',
        'shop_stripe_webhook_events',
        'uq_shop_orders_f9_acceptance',
        'uq_shop_order_stripe_active_attempt',
        'shop_order_number_counters'
    ]) {
        assert.match(server, new RegExp(literal));
    }
    assert.match(server, /nextval\('shop_orders_snapshot_revision_seq'\)/);
});

test('public USA checkout is mounted only through the F9 handler', () => {
    assert.match(server, /const f9CheckoutHandler = createF9CheckoutHandler/);
    assert.match(server, /app\.post\('\/api\/shop-us\/checkout', f9CheckoutHandler\)/);
    assert.equal(
        (server.match(/app\.post\('\/api\/shop-us\/checkout'/g) || []).length,
        1
    );
});

test('legacy offline route and billing fields are absent', () => {
    assert.doesNotMatch(server, /\/api\/shop-us\/quote-request/);
    assert.doesNotMatch(server, /quickbooks_invoice_(?:id|url)/);
    assert.doesNotMatch(server, /myosseotouch_shop_bridge/);
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'archive_shop_quote_legacy_f9.sql'),
        'utf8'
    );
    assert.match(migration, /shop_quote_legacy_archive/);
    assert.match(migration, /payload_sha256/);
    assert.match(migration, /archived_count <> source_count/);
    assert.match(migration, /DROP COLUMN IF EXISTS quickbooks_invoice_id/);
});

test('USA webhook dispatches to replay and generation fencing before legacy handling', () => {
    const webhook = server.indexOf("app.post('/api/shop/stripe-webhook'");
    const f9 = server.indexOf('applyF9StripeWebhook(pool, event)', webhook);
    const legacy = server.indexOf("if (event.type === 'checkout.session.completed')", webhook);
    assert.ok(webhook > 0 && f9 > webhook && legacy > f9);
    assert.ok(server.indexOf('if (f9Result.handled)', f9) > f9);
});

test('prices are sourced from the committed server catalog', () => {
    assert.match(server, /SHOP_US_CATALOG_PATH/);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'data', 'shop-catalog-us.json')), true);
    const checkout = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'f9_checkout.js'), 'utf8');
    assert.match(checkout, /normalizeDirectItems\(body\.items, catalog\)/);
    assert.doesNotMatch(checkout, /Number\(item\.price\).*body/);
});
