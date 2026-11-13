'use strict';

/*
 * Shop Italia: prezzi ricalcolati lato server (fix sicurezza 13/11/2026).
 *
 * Il carrello IT vive nel localStorage del browser (osseotouch_shop_cart_v1) e
 * conserva il prezzo del momento in cui il prodotto e' stato aggiunto. Prima di
 * questo modulo /api/shop/checkout salvava e addebitava item.price cosi' come
 * arrivava dal browser. Ora ogni riga viene ricostruita dal catalogo canonico
 * pubblicato dal sito (https://www.osseotouch.com/data/shop-catalog-it.json,
 * generato da JAN34/templates/pages/shop.astro): nome, prezzo, IVA e tipo li
 * decide il server; dal browser si accettano solo id e quantita'.
 *
 * Righe speciali gestite qui:
 *  - configuratore: 'mm-device' (prezzo base, non pubblicato nel catalogo) e
 *    'single-<CODICE>' (strumenti singoli da component_price_list);
 *  - 'acc-box-allin-promo': Box All-In a prezzo promo, solo con un kit qualificante;
 *  - 'pin-gift-CEP3.1' / 'pin-gift-CEP3.5': box pin omaggio, qty = kit Easy-Pin;
 *  - proposte SUTURE (checkout ?cart=<token>): prezzi e omaggio 3+1 letti dalla
 *    proposta salvata nel DB, mai dal carrello draft ne' dal browser.
 */

const fs = require('fs');

const MAX_LINES = 100;
const MAX_QTY = 999;

// Configuratore personalizzato: il Magnetic Mallet base non e' un prodotto del
// catalogo pubblico (si vende solo dentro una configurazione). Fonte:
// JAN34/templates/pages/shop/configuratore.astro (mmDevice.price).
const SHOP_IT_EXTRA_PRODUCTS = Object.freeze([
    Object.freeze({ id: 'mm-device', code: 'MMPLUS-NEW', name: 'Magnetic Mallet', price: 2990, vat: 0.22, type: 'device' })
]);

// Kit che rendono disponibile il Box All-In a prezzo promo.
// Fonte: UPSELL_BOX_QUALIFIERS in JAN34/templates/pages/shop.astro.
const BOX_PROMO_ID = 'acc-box-allin-promo';
const BOX_PROMO_QUALIFIERS = Object.freeze([
    'kit-essential', 'blexo-pathfinder', 'blexo-anglefit',
    'black-ruby', 'osteotomi-silver', 'first', 'easy-in',
    'expander-5', 'expander-plus-8', 'genoa'
]);

// Box pin omaggio con il kit Easy-Pin (JAN34/templates/scripts/easy-pin-gift.js).
const EASY_PIN_KIT_ID = 'easy-pin';
const PIN_GIFT_PREFIX = 'pin-gift-';
const PIN_GIFT_SIZES = Object.freeze({
    'CEP3.1': 'XL Ø 3.1 mm',
    'CEP3.5': 'XXL Ø 3.5 mm'
});

const SUTURE_GIFT_ID = 'suture-gift-3plus1';

class ShopItCartError extends Error {
    constructor(message, code, details) {
        super(message);
        this.name = 'ShopItCartError';
        this.code = code;
        this.details = details || null;
    }
}

function round2(n) {
    return Math.round(Number(n) * 100) / 100;
}

function sameAmount(a, b) {
    return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

function storageType(catalogType) {
    switch (catalogType) {
        case 'suture_box': return 'suture';
        case 'magnetic_mallet_configuration': return 'config';
        case 'standalone_device': return 'device';
        case 'accessory': return 'accessorio';
        case 'consumable': return 'kit';
        default: return catalogType || 'other';
    }
}

function validateCatalogSource(source) {
    if (!source || source.dataset !== 'osseotouch_shop_catalog_it' || source.market !== 'IT'
        || source.currency !== 'EUR' || !Array.isArray(source.products) || source.products.length === 0) {
        throw new Error('Catalogo shop IT non valido');
    }
}

function buildShopItCatalog(source) {
    validateCatalogSource(source);
    const products = new Map();
    const add = (entry) => {
        if (!entry.id || !Number.isFinite(entry.price) || entry.price < 0 || !Number.isFinite(entry.vat)) return;
        products.set(entry.id, Object.freeze(entry));
    };
    for (const p of source.products) {
        add({
            id: String(p.id || '').trim(),
            code: String(p.code || p.id || ''),
            name: String(p.name || p.id || ''),
            price: Number(p.price?.net_amount),
            vat: Number(p.price?.vat_rate ?? 0.22),
            type: storageType(p.type)
        });
    }
    for (const c of source.component_price_list || []) {
        const code = String(c.code || '').trim();
        if (!code) continue;
        add({
            id: 'single-' + code,
            code,
            name: `${c.name} (${code})`,
            price: Number(c.price?.net_amount),
            vat: Number(c.price?.vat_rate ?? 0.22),
            type: 'single'
        });
    }
    const promo = (source.special_offers || []).find(o => o.id === BOX_PROMO_ID);
    if (promo) {
        add({
            id: BOX_PROMO_ID,
            code: String(promo.code || 'BOX.ALLIN'),
            name: String(promo.name || 'Box All-In (offerta)'),
            price: Number(promo.price?.net_amount),
            vat: Number(promo.price?.vat_rate ?? 0.22),
            type: 'accessorio'
        });
    }
    for (const extra of SHOP_IT_EXTRA_PRODUCTS) {
        if (!products.has(extra.id)) add({ ...extra });
    }
    const pinVat = Number(source.products.find(p => p.id === 'pin-3-1')?.price?.vat_rate ?? 0.04);
    return Object.freeze({
        lastUpdated: String(source.last_updated || ''),
        products,
        pinGiftVat: pinVat
    });
}

function loadShopItCatalogFile(catalogPath) {
    return buildShopItCatalog(JSON.parse(fs.readFileSync(catalogPath, 'utf8')));
}

/*
 * Catalogo con aggiornamento dal sito: parte dalla copia nel repo, poi legge il
 * JSON pubblicato (cache ttlMs). Se il sito non risponde o il JSON non e' valido
 * resta l'ultimo catalogo buono. forceRefresh rilegge subito (al massimo una
 * volta ogni minRefetchMs) ed e' usato quando un prezzo non torna.
 */
function createShopItCatalogProvider({ bundledPath, liveUrl, fetchImpl, ttlMs = 10 * 60 * 1000, minRefetchMs = 60 * 1000, logger = console } = {}) {
    let current = loadShopItCatalogFile(bundledPath);
    let source = 'bundled';
    let fetchedAt = 0;
    let attemptedAt = 0;
    let inflight = null;
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);

    async function refresh() {
        attemptedAt = Date.now();
        try {
            const res = await doFetch(liveUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            current = buildShopItCatalog(await res.json());
            source = 'live';
            fetchedAt = Date.now();
        } catch (err) {
            logger.warn('[shop-it-catalog] aggiornamento dal sito fallito, resta il catalogo ' + source + ':', err.message);
        }
    }

    async function get({ forceRefresh = false } = {}) {
        if (!liveUrl || !doFetch) return current;
        const now = Date.now();
        const stale = now - fetchedAt > ttlMs && now - attemptedAt > minRefetchMs;
        const forced = forceRefresh && now - attemptedAt > minRefetchMs;
        if (stale || forced) {
            if (!inflight) inflight = refresh().finally(() => { inflight = null; });
            await inflight;
        }
        return current;
    }

    return { get, info: () => ({ source, lastUpdated: current.lastUpdated, fetchedAt }) };
}

/*
 * Contesto proposta SUTURE: il token del carrello draft identifica la proposta,
 * ma prezzi, sconto e omaggio si leggono dalla proposta (le righe del draft non
 * sono affidabili: POST /api/carrelli e' pubblico).
 */
async function loadShopItProposalContext(pool, getProposta, token) {
    if (typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return null;
    const { rows } = await pool.query(
        `SELECT proposta_id, cliente_id, expires_at FROM carrelli_draft WHERE token = $1`,
        [token]
    );
    const draft = rows[0];
    if (!draft || !draft.proposta_id || new Date(draft.expires_at) < new Date()) return null;
    const proposta = await getProposta(draft.proposta_id, pool);
    if (!proposta || String(proposta.cliente_id) !== String(draft.cliente_id)) return null;
    const scontoPct = Math.max(0, Math.min(20, parseFloat(proposta.sconto_pct) || 0));
    const lines = new Map();
    for (const r of Array.isArray(proposta.righe) ? proposta.righe : []) {
        const cod = String(r.cod || '').trim();
        const prezzo = parseFloat(r.prezzo);
        if (!cod || !Number.isFinite(prezzo) || prezzo < 0) continue;
        lines.set(cod, Object.freeze({
            id: cod,
            code: cod,
            name: String(r.nome || 'Sutura'),
            price: round2(prezzo * (1 - scontoPct / 100)),
            vat: 0.22,
            type: 'suture'
        }));
    }
    return Object.freeze({ propostaId: draft.proposta_id, lines, omaggio3plus1: !!proposta.omaggio_3plus1 });
}

function parseQty(raw) {
    const qty = Number(raw);
    return Number.isSafeInteger(qty) && qty >= 1 && qty <= MAX_QTY ? qty : null;
}

/*
 * Ritorna le righe ricostruite dal server. Lancia ShopItCartError con code:
 *  - 'invalid_cart'  -> 400 (prodotto sconosciuto, quantita' non valida, omaggio non spettante)
 *  - 'price_changed' -> 409 (il prezzo del carrello non e' quello attuale; details = righe corrette)
 */
function priceShopItCart(items, catalog, proposal) {
    if (!Array.isArray(items) || items.length === 0) throw new ShopItCartError('Carrello vuoto', 'invalid_cart');
    if (items.length > MAX_LINES) throw new ShopItCartError('Carrello troppo grande', 'invalid_cart');

    const paid = new Map();
    const order = [];
    const gifts = [];
    for (const raw of items) {
        const id = String(raw?.id || '').trim();
        if (!id) throw new ShopItCartError('Prodotto non valido nel carrello', 'invalid_cart');
        if (id.startsWith(PIN_GIFT_PREFIX) || id === SUTURE_GIFT_ID) {
            gifts.push({ id, raw });
            continue;
        }
        const qty = parseQty(raw?.qty);
        if (qty === null) throw new ShopItCartError(`Quantità non valida per ${raw?.name || id}`, 'invalid_cart');
        const product = (proposal && proposal.lines.get(id)) || catalog.products.get(id);
        if (!product) {
            throw new ShopItCartError(
                `Il prodotto ${raw?.name || id} non è più disponibile (o la proposta è scaduta): aggiorna il carrello.`,
                'invalid_cart'
            );
        }
        const existing = paid.get(id);
        if (existing) {
            existing.qty += qty;
            if (existing.qty > MAX_QTY) throw new ShopItCartError(`Quantità non valida per ${product.name}`, 'invalid_cart');
        } else {
            const line = { product, qty, clientPrice: raw?.price };
            paid.set(id, line);
            order.push(line);
        }
    }

    const mismatches = [];
    for (const line of order) {
        if (!sameAmount(line.clientPrice, line.product.price) || !Number.isFinite(Number(line.clientPrice))) {
            mismatches.push({ id: line.product.id, name: line.product.name, price: line.product.price, client_price: Number(line.clientPrice) });
        }
    }

    const qtyOf = (ids) => ids.reduce((s, id) => s + (paid.get(id)?.qty || 0), 0);

    const promo = paid.get(BOX_PROMO_ID);
    if (promo && promo.qty > qtyOf(BOX_PROMO_QUALIFIERS)) {
        throw new ShopItCartError('Il Box All-In in offerta richiede un kit compatibile nel carrello: aggiorna il carrello.', 'invalid_cart');
    }

    const result = order.map(line => ({
        id: line.product.id,
        code: line.product.code,
        name: line.product.name,
        type: line.product.type,
        price: line.product.price,
        vat: line.product.vat,
        qty: line.qty,
        isGift: false
    }));

    const easyPinQty = paid.get(EASY_PIN_KIT_ID)?.qty || 0;
    let pinGiftDone = false;
    let sutureGiftDone = false;
    for (const { id, raw } of gifts) {
        if (id.startsWith(PIN_GIFT_PREFIX)) {
            const code = id.slice(PIN_GIFT_PREFIX.length);
            if (!PIN_GIFT_SIZES[code] || pinGiftDone || easyPinQty === 0) {
                throw new ShopItCartError('Box pin omaggio non valido: aggiorna il carrello.', 'invalid_cart');
            }
            pinGiftDone = true;
            // qty dell'omaggio = qty dei kit Easy-Pin, come in easy-pin-gift.js reconcile()
            result.splice(result.findIndex(r => r.id === EASY_PIN_KIT_ID) + 1, 0, {
                id, code, type: 'pin-gift',
                name: `Omaggio Easy-Pin · Box pin ${PIN_GIFT_SIZES[code]} (5 pin) · ${code}`,
                price: 0, vat: catalog.pinGiftVat, qty: easyPinQty, isGift: true
            });
        } else {
            const proposalQty = proposal
                ? [...paid.values()].filter(l => proposal.lines.has(l.product.id)).reduce((s, l) => s + l.qty, 0)
                : 0;
            if (!proposal || !proposal.omaggio3plus1 || proposalQty < 3 || sutureGiftDone || Number(raw?.qty) !== 1) {
                throw new ShopItCartError('Omaggio 3+1 non valido: torna al portale e conferma di nuovo la proposta.', 'invalid_cart');
            }
            sutureGiftDone = true;
            result.push({
                id, code: SUTURE_GIFT_ID, type: 'suture-gift',
                name: 'Omaggio 3+1 · 1 confezione gratuita',
                price: 0, vat: 0.22, qty: 1, isGift: true
            });
        }
    }

    if (mismatches.length > 0) {
        const list = mismatches.map(m => `${m.name}: ${String(m.price).replace('.', ',')} € + IVA`).join('; ');
        throw new ShopItCartError(
            `Alcuni prezzi del carrello non sono aggiornati (${list}). Aggiorna il carrello e conferma di nuovo.`,
            'price_changed',
            mismatches
        );
    }
    return result;
}

module.exports = {
    BOX_PROMO_QUALIFIERS,
    SHOP_IT_EXTRA_PRODUCTS,
    ShopItCartError,
    buildShopItCatalog,
    createShopItCatalogProvider,
    loadShopItCatalogFile,
    loadShopItProposalContext,
    priceShopItCart
};
