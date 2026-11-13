const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
    ShopItCartError,
    buildShopItCatalog,
    createShopItCatalogProvider,
    loadShopItCatalogFile,
    loadShopItProposalContext,
    priceShopItCart
} = require('../scripts/shop_it_pricing');

const CATALOG_PATH = path.join(__dirname, '..', 'data', 'shop-catalog-it.json');
const catalog = loadShopItCatalogFile(CATALOG_PATH);
const priceOf = id => catalog.products.get(id).price;
const line = (id, qty = 1, extra = {}) => ({ id, qty, price: priceOf(id), ...extra });

function expectCartError(fn, code) {
    let caught = null;
    try { fn(); } catch (err) { caught = err; }
    assert.ok(caught instanceof ShopItCartError, 'attesa ShopItCartError');
    assert.equal(caught.code, code);
    return caught;
}

test('il prezzo modificato nel browser viene rifiutato con il prezzo corretto', () => {
    const err = expectCartError(() => priceShopItCart([{ id: 'master', qty: 1, price: 1 }], catalog, null), 'price_changed');
    assert.deepEqual(err.details.map(d => [d.id, d.price]), [['master', 7490]]);
    assert.match(err.message, /Master: 7490 € \+ IVA/);
});

test('un carrello vecchio con prezzo superato viene rifiutato', () => {
    expectCartError(() => priceShopItCart([{ id: 'pin-3-1', qty: 3, price: 75 }], catalog, null), 'price_changed');
});

test('carrello corretto: nome, IVA e tipo li decide il server', () => {
    const items = priceShopItCart([
        line('master', 1, { name: '<b>finto</b>', vat: 0, type: 'suture' }),
        line('pin-3-5', 2, { vat: 0.22 }),
        line('suture-3336', 4)
    ], catalog, null);
    assert.deepEqual(items.map(i => [i.id, i.price, i.vat, i.type, i.qty, i.isGift]), [
        ['master', 7490, 0.22, 'config', 1, false],
        ['pin-3-5', 83, 0.04, 'kit', 2, false],
        ['suture-3336', 87, 0.22, 'suture', 4, false]
    ]);
    assert.equal(items[0].name, 'Master');
});

test('prodotto sconosciuto e quantita non valide vengono rifiutati', () => {
    expectCartError(() => priceShopItCart([{ id: 'inventato', qty: 1, price: 1 }], catalog, null), 'invalid_cart');
    for (const qty of [0, -1, 1.5, 'abc', 1000, null]) {
        expectCartError(() => priceShopItCart([line('first', 1, { qty })], catalog, null), 'invalid_cart');
    }
    expectCartError(() => priceShopItCart([], catalog, null), 'invalid_cart');
});

test('righe duplicate dello stesso prodotto vengono sommate', () => {
    const items = priceShopItCart([line('first', 1), line('first', 2)], catalog, null);
    assert.equal(items.length, 1);
    assert.equal(items[0].qty, 3);
});

test('configuratore: Magnetic Mallet base e strumenti singoli', () => {
    const items = priceShopItCart([
        { id: 'mm-device', qty: 1, price: 2990 },
        line('black-ruby'),
        { id: 'single-FPC100', qty: 2, price: 110 },
        { id: 'single-STELEV3', qty: 1, price: 30 }
    ], catalog, null);
    assert.deepEqual(items.map(i => [i.id, i.price]), [['mm-device', 2990], ['black-ruby', 675], ['single-FPC100', 110], ['single-STELEV3', 30]]);
    expectCartError(() => priceShopItCart([{ id: 'single-FPC100', qty: 1, price: 10 }], catalog, null), 'price_changed');
    expectCartError(() => priceShopItCart([{ id: 'single-NONESISTE', qty: 1, price: 10 }], catalog, null), 'invalid_cart');
});

test('Box All-In in offerta solo con un kit compatibile', () => {
    const ok = priceShopItCart([line('black-ruby'), { id: 'acc-box-allin-promo', qty: 1, price: 190 }], catalog, null);
    assert.equal(ok[1].price, 190);
    expectCartError(() => priceShopItCart([line('master'), { id: 'acc-box-allin-promo', qty: 1, price: 190 }], catalog, null), 'invalid_cart');
    expectCartError(() => priceShopItCart([line('first'), { id: 'acc-box-allin-promo', qty: 2, price: 190 }], catalog, null), 'invalid_cart');
});

test('box pin omaggio Easy-Pin: qty pari ai kit, solo con il kit', () => {
    const items = priceShopItCart([
        line('easy-pin', 2),
        { id: 'pin-gift-CEP3.5', type: 'pin-gift', qty: 1, price: 0 },
        line('first')
    ], catalog, null);
    assert.deepEqual(items.map(i => [i.id, i.qty, i.price, i.isGift]), [
        ['easy-pin', 2, 590, false],
        ['pin-gift-CEP3.5', 2, 0, true],
        ['first', 1, 150, false]
    ]);
    expectCartError(() => priceShopItCart([line('first'), { id: 'pin-gift-CEP3.1', qty: 1, price: 0 }], catalog, null), 'invalid_cart');
    expectCartError(() => priceShopItCart([line('easy-pin'), { id: 'pin-gift-CEP9', qty: 1, price: 0 }], catalog, null), 'invalid_cart');
    expectCartError(() => priceShopItCart([
        line('easy-pin'), { id: 'pin-gift-CEP3.1', qty: 1, price: 0 }, { id: 'pin-gift-CEP3.5', qty: 1, price: 0 }
    ], catalog, null), 'invalid_cart');
});

const proposal = Object.freeze({
    propostaId: '7',
    omaggio3plus1: true,
    lines: new Map([
        ['3336', { id: '3336', code: '3336', name: 'SILK 3336', price: 78.3, vat: 0.22, type: 'suture' }]
    ])
});

test('omaggio 3+1 solo da proposta con omaggio e almeno 3 confezioni', () => {
    const gift = { id: 'suture-gift-3plus1', type: 'suture-gift', qty: 1, price: 0 };
    const items = priceShopItCart([{ id: '3336', qty: 3, price: 78.3 }, gift], catalog, proposal);
    assert.deepEqual(items.map(i => [i.id, i.price, i.qty, i.type]), [['3336', 78.3, 3, 'suture'], ['suture-gift-3plus1', 0, 1, 'suture-gift']]);
    expectCartError(() => priceShopItCart([line('suture-3336', 3), gift], catalog, null), 'invalid_cart');
    expectCartError(() => priceShopItCart([{ id: '3336', qty: 2, price: 78.3 }, gift], catalog, proposal), 'invalid_cart');
    expectCartError(() => priceShopItCart([{ id: '3336', qty: 3, price: 78.3 }, { ...gift, qty: 2 }], catalog, proposal), 'invalid_cart');
    expectCartError(() => priceShopItCart([{ id: '3336', qty: 3, price: 78.3 }, gift], catalog, { ...proposal, omaggio3plus1: false }), 'invalid_cart');
});

test('righe della proposta: prezzo scontato della proposta, non quello del browser', () => {
    expectCartError(() => priceShopItCart([{ id: '3336', qty: 1, price: 1 }], catalog, proposal), 'price_changed');
    expectCartError(() => priceShopItCart([{ id: '3336', qty: 1, price: 78.3 }], catalog, null), 'invalid_cart');
});

test('contesto proposta: prezzi dalla proposta nel DB, token scaduto o cliente diverso ignorati', async () => {
    const token = '0b6c3a52-3a1f-4c55-9d7e-2f6d1d1b9a10';
    const future = new Date(Date.now() + 3600e3);
    const pool = draft => ({ query: async () => ({ rows: draft ? [draft] : [] }) });
    const getProposta = async () => ({
        cliente_id: 5, sconto_pct: '10.00', omaggio_3plus1: true,
        righe: [{ cod: '3336', nome: 'SILK 3336', prezzo: '87.00', qty: 3 }]
    });
    const ctx = await loadShopItProposalContext(pool({ proposta_id: '7', cliente_id: 5, expires_at: future }), getProposta, token);
    assert.equal(ctx.lines.get('3336').price, 78.3);
    assert.equal(ctx.omaggio3plus1, true);
    assert.equal(await loadShopItProposalContext(pool({ proposta_id: '7', cliente_id: 5, expires_at: new Date(Date.now() - 1000) }), getProposta, token), null);
    assert.equal(await loadShopItProposalContext(pool({ proposta_id: '7', cliente_id: 6, expires_at: future }), getProposta, token), null);
    assert.equal(await loadShopItProposalContext(pool({ proposta_id: null, cliente_id: 5, expires_at: future }), getProposta, token), null);
    assert.equal(await loadShopItProposalContext(pool(null), getProposta, 'non-un-uuid'), null);
});

test('catalogo: rifiuta sorgenti non valide', () => {
    assert.throws(() => buildShopItCatalog({ dataset: 'osseotouch_shop_catalog_us', market: 'US', currency: 'USD', products: [{}] }));
    assert.throws(() => buildShopItCatalog({ dataset: 'osseotouch_shop_catalog_it', market: 'IT', currency: 'EUR', products: [] }));
});

test('provider: legge il sito, e se il sito fallisce resta l\'ultimo catalogo buono', async () => {
    const source = require(CATALOG_PATH);
    const changed = JSON.parse(JSON.stringify(source));
    changed.products.find(p => p.id === 'first').price.net_amount = 175;
    let mode = 'ok';
    const fetchImpl = async () => {
        if (mode === 'down') throw new Error('rete giu');
        if (mode === 'bad') return { ok: true, json: async () => ({ dataset: 'altro' }) };
        return { ok: true, json: async () => changed };
    };
    const quiet = { warn() {} };
    const provider = createShopItCatalogProvider({ bundledPath: CATALOG_PATH, liveUrl: 'https://x/c.json', fetchImpl, ttlMs: 0, minRefetchMs: 0, logger: quiet });
    assert.equal((await provider.get()).products.get('first').price, 175);
    mode = 'bad';
    assert.equal((await provider.get()).products.get('first').price, 175);
    mode = 'down';
    assert.equal((await provider.get()).products.get('first').price, 175);

    const offline = createShopItCatalogProvider({ bundledPath: CATALOG_PATH, liveUrl: 'https://x/c.json', fetchImpl: async () => { throw new Error('giu'); }, logger: quiet });
    assert.equal((await offline.get()).products.get('first').price, 150);
    const disabled = createShopItCatalogProvider({ bundledPath: CATALOG_PATH, liveUrl: null });
    assert.equal((await disabled.get()).products.get('first').price, 150);
});
