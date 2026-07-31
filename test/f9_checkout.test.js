const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
    DIRECT_IDEMPOTENCY_PATTERN,
    calculateShopTotals,
    loadCatalog,
    normalizeDirectItems,
    normalizeProposal,
    requestHash,
    resolveProposalReference
} = require('../scripts/f9_checkout');

const catalog = loadCatalog(path.join(__dirname, '..', 'data', 'shop-catalog-us.json'));

test('direct checkout ignores browser names, types and prices', () => {
    const [known] = [...catalog.values()];
    const [normalized] = normalizeDirectItems([
        { id: known.id, qty: 2, name: 'tampered', type: 'tampered', price: 0.01 }
    ], catalog);
    assert.equal(normalized.name, known.name);
    assert.equal(normalized.type, known.type);
    assert.equal(normalized.price, known.price);
    assert.equal(normalized.qty, 2);
});

test('direct idempotency cannot occupy the reserved F9 namespace', () => {
    assert.equal(DIRECT_IDEMPOTENCY_PATTERN.test('direct:' + 'a'.repeat(32)), true);
    assert.equal(DIRECT_IDEMPOTENCY_PATTERN.test('f9:00000000-0000-4000-8000-000000000094'), false);
});

test('checkout totals apply the canonical four-percent Alabama nexus tax', () => {
    const items = [{ price: 99.99, qty: 2 }];
    assert.deepEqual(calculateShopTotals(items, 'al'), {
        subtotal: 199.98,
        salesTax: 8,
        total: 207.98
    });
    assert.deepEqual(calculateShopTotals(items, 'NY'), {
        subtotal: 199.98,
        salesTax: 0,
        total: 199.98
    });
});

test('proposal contract supplies the frozen item snapshot', () => {
    const proposal = normalizeProposal({
        contract_version: 'f9-resolve-v1',
        acceptance_id: '00000000-0000-4000-8000-000000000094',
        proposal_id: 'P-94',
        proposal_snapshot_version: 'a'.repeat(64),
        snapshot_hash: 'a'.repeat(64),
        purpose: 'test',
        proposal: {
            contract_version: 'f9-proposal-v1',
            proposal_id: 'P-94',
            market: 'USA',
            currency: 'USD',
            is_test: true,
            items: [{
                product_code: 'SKU-94',
                product_name: 'Synthetic',
                quantity: 2,
                unit_price: '10.00'
            }]
        }
    });
    assert.equal(proposal.items[0].price, 10);
    assert.equal(proposal.items[0].qty, 2);
    assert.equal(proposal.purpose, 'test');
});

test('proposal contract rejects a mismatched immutable snapshot binding', () => {
    assert.throws(() => normalizeProposal({
        contract_version: 'f9-resolve-v1',
        acceptance_id: '00000000-0000-4000-8000-000000000094',
        proposal_id: 'P-94',
        proposal_snapshot_version: 'a'.repeat(64),
        snapshot_hash: 'b'.repeat(64),
        purpose: 'test',
        proposal: {
            contract_version: 'f9-proposal-v1', proposal_id: 'P-94',
            market: 'USA', currency: 'USD', is_test: true,
            items: [{ product_code: 'SKU-94', product_name: 'Synthetic', quantity: 1, unit_price: '10' }]
        }
    }), /Invalid proposal contract/);
});

test('invalid proposal reference fails before network and never degrades to direct', async () => {
    let calls = 0;
    const result = await resolveProposalReference('invalid', {
        resolverUrl: 'https://gold.example.invalid/api/internal/f9/resolve-reference',
        apiKey: 'x'.repeat(32),
        fetchImpl: async () => { calls += 1; }
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(calls, 0);
});

test('canonical request hash is stable across object key order', () => {
    assert.equal(requestHash({ a: 1, b: 2 }), requestHash({ b: 2, a: 1 }));
});
