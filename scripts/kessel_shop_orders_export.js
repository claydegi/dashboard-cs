const crypto = require('crypto');

const MAX_PAGE_SIZE = 200;
const API_KEY_MIN_BYTES = 32;
const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const USA_COUNTRY_VALUES = new Set([
    'US',
    'USA',
    'UNITED STATES',
    'UNITED STATES OF AMERICA'
]);

function secureEqualStrings(expected, presented) {
    if (typeof expected !== 'string'
        || Buffer.byteLength(expected, 'utf8') < API_KEY_MIN_BYTES
        || typeof presented !== 'string') {
        return false;
    }
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const presentedRaw = Buffer.from(presented, 'utf8');
    const presentedBuffer = Buffer.alloc(expectedBuffer.length);
    presentedRaw.copy(presentedBuffer, 0, 0, expectedBuffer.length);
    return presentedRaw.length === expectedBuffer.length
        && crypto.timingSafeEqual(expectedBuffer, presentedBuffer);
}

function parseUnsignedInteger(value, { field, defaultValue, max = Number.MAX_SAFE_INTEGER }) {
    if (value === undefined) return defaultValue;
    if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
        throw new RangeError(`${field} non valido`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
        throw new RangeError(`${field} non valido`);
    }
    return parsed;
}

function decimalString(value, field) {
    const text = typeof value === 'string' ? value : String(value);
    if (!DECIMAL_PATTERN.test(text)) {
        throw new TypeError(`Decimal non valido: ${field}`);
    }
    return text;
}

function nullableDecimalString(value, field) {
    return value === null || value === undefined
        ? null
        : decimalString(value, field);
}

function isoTimestamp(value, field) {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError(`Timestamp non valido: ${field}`);
    return date.toISOString();
}

function isUsCountry(value) {
    return typeof value === 'string' && USA_COUNTRY_VALUES.has(value.trim().toUpperCase());
}

function serializeItem(item, position) {
    const qty = Number(item.qty);
    if (!Number.isSafeInteger(qty) || qty < 0) throw new TypeError('Quantita item non valida');
    return {
        position,
        product_type: item.product_type,
        product_code: item.product_code,
        product_name: item.product_name,
        qty,
        unit_price: decimalString(item.unit_price, 'unit_price'),
        vat_rate: decimalString(item.vat_rate, 'vat_rate'),
        is_free_promo: item.is_free_promo === true
    };
}

function serializeOrder(order, items) {
    const id = Number(order.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('Dashboard order ID non valido');

    const payload = {
        id,
        order_number: order.order_number,
        status: order.status,
        created_at: isoTimestamp(order.created_at, 'created_at'),
        confirmed_at: isoTimestamp(order.confirmed_at, 'confirmed_at'),
        cancelled_at: isoTimestamp(order.cancelled_at, 'cancelled_at'),
        ship_country: order.ship_country,
        market_hint: order.market,
        flow: order.flow,
        currency: order.currency,
        subtotal_net: nullableDecimalString(order.subtotal_net, 'subtotal_net'),
        shipping: nullableDecimalString(order.shipping, 'shipping'),
        vat_amount: nullableDecimalString(order.vat_amount, 'vat_amount'),
        sales_tax: nullableDecimalString(order.sales_tax, 'sales_tax'),
        total_gross: nullableDecimalString(order.total_gross, 'total_gross'),
        is_test: order.is_test === true,
        is_deleted: order.is_deleted === true,
        items: items.map((item, index) => serializeItem(item, index + 1)),
        reference: {
            hash: order.myosseotouch_ref_hash,
            state: order.myosseotouch_ref_state,
            purpose: order.myosseotouch_ref_purpose
        },
        acceptance: {
            acceptance_id: order.f9_acceptance_id || null,
            proposal_id: order.f9_proposal_id || null,
            proposal_snapshot_version: order.f9_snapshot_version || null,
            snapshot_hash: order.f9_snapshot_hash || null
        }
    };

    if (isUsCountry(order.ship_country)) {
        payload.identity = {
            email: order.buyer_email || null,
            phone: order.buyer_phone || null
        };
    }
    return payload;
}

function createKesselShopOrdersExportHandler({ pool, apiKey, logger = console }) {
    return async function kesselShopOrdersExport(req, res) {
        res.set('Cache-Control', 'private, no-store, max-age=0');
        res.set('Vary', 'x-api-key');

        const presentedKey = typeof req.get === 'function'
            ? req.get('x-api-key')
            : req.headers?.['x-api-key'];
        if (!secureEqualStrings(apiKey, presentedKey)) {
            return res.status(401).json({ error: 'API key non valida' });
        }

        let afterId;
        let requestedSnapshot;
        let limit;
        try {
            afterId = parseUnsignedInteger(req.query?.after_id, {
                field: 'after_id',
                defaultValue: 0
            });
            requestedSnapshot = parseUnsignedInteger(req.query?.snapshot_revision, {
                field: 'snapshot_revision',
                defaultValue: null
            });
            limit = parseUnsignedInteger(req.query?.limit, {
                field: 'limit',
                defaultValue: MAX_PAGE_SIZE,
                max: MAX_PAGE_SIZE
            });
            if (limit < 1 || (afterId > 0 && requestedSnapshot === null)) {
                throw new RangeError('Paginazione non valida');
            }
        } catch {
            return res.status(400).json({ error: 'Parametri di paginazione non validi' });
        }

        try {
            let snapshotRevision = requestedSnapshot;
            let total;
            if (snapshotRevision === null) {
                const metaResult = await pool.query(
                    `SELECT COALESCE(MAX(snapshot_revision), 0)::bigint AS snapshot_revision,
                            COUNT(*)::int AS total
                     FROM shop_orders`
                );
                snapshotRevision = Number(metaResult.rows[0].snapshot_revision);
                total = Number(metaResult.rows[0].total);
            } else {
                const totalResult = await pool.query(
                    `SELECT COALESCE(MAX(snapshot_revision), 0)::bigint AS current_revision,
                            COUNT(*) FILTER (WHERE snapshot_revision <= $1)::int AS total
                       FROM shop_orders`,
                    [snapshotRevision]
                );
                if (Number(totalResult.rows[0].current_revision) !== snapshotRevision) {
                    return res.status(409).json({ error: 'snapshot_drift' });
                }
                total = Number(totalResult.rows[0].total);
            }

            if (!Number.isSafeInteger(snapshotRevision)
                || snapshotRevision < 0
                || !Number.isSafeInteger(total)
                || total < 0) {
                throw new TypeError('Metadati snapshot non validi');
            }

            const orderResult = await pool.query(
                `SELECT id, order_number, status,
                        created_at, confirmed_at, cancelled_at,
                        ship_country, market, flow, currency,
                        subtotal_net, shipping, vat_amount, sales_tax, total_gross,
                        is_test, is_deleted,
                        buyer_email, buyer_phone,
                        myosseotouch_ref_hash, myosseotouch_ref_state,
                        myosseotouch_ref_purpose,
                        f9_acceptance_id::text, f9_proposal_id,
                        f9_snapshot_version, f9_snapshot_hash
                 FROM shop_orders
                 WHERE id > $1 AND snapshot_revision <= $2
                 ORDER BY id ASC
                 LIMIT $3`,
                [afterId, snapshotRevision, limit + 1]
            );

            const hasMore = orderResult.rows.length > limit;
            const pageRows = orderResult.rows.slice(0, limit);
            for (let index = 1; index < pageRows.length; index += 1) {
                if (Number(pageRows[index].id) <= Number(pageRows[index - 1].id)) {
                    throw new TypeError('Ordini non monotoni');
                }
            }

            const ids = pageRows.map(row => Number(row.id));
            let itemsByOrder = new Map();
            if (ids.length > 0) {
                const itemResult = await pool.query(
                    `SELECT id, order_id, product_type, product_code, product_name,
                            qty, unit_price, vat_rate, is_free_promo
                     FROM shop_order_items
                     WHERE order_id = ANY($1)
                     ORDER BY order_id ASC, id ASC`,
                    [ids]
                );
                itemsByOrder = itemResult.rows.reduce((map, item) => {
                    const orderId = Number(item.order_id);
                    const list = map.get(orderId) || [];
                    list.push(item);
                    map.set(orderId, list);
                    return map;
                }, new Map());
            }

            const orders = pageRows.map(order =>
                serializeOrder(order, itemsByOrder.get(Number(order.id)) || [])
            );
            const finalRevisionResult = await pool.query(
                `SELECT COALESCE(MAX(snapshot_revision), 0)::bigint AS current_revision
                   FROM shop_orders`
            );
            if (Number(finalRevisionResult.rows[0].current_revision) !== snapshotRevision) {
                return res.status(409).json({ error: 'snapshot_drift' });
            }
            return res.json({
                orders,
                total,
                has_more: hasMore,
                snapshot_revision: snapshotRevision
            });
        } catch (error) {
            logger.error('[kessel/shop-orders] export failed:', error?.name || 'Error');
            return res.status(500).json({ error: 'Export shop non disponibile' });
        }
    };
}

module.exports = {
    API_KEY_MIN_BYTES,
    MAX_PAGE_SIZE,
    createKesselShopOrdersExportHandler,
    isUsCountry,
    secureEqualStrings,
    serializeOrder
};
