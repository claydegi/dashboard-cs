const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_KEY_MIN_BYTES = 32;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/;
const DIRECT_IDEMPOTENCY_PATTERN = /^direct:(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const REFERENCE_PATTERN = /^v1\.[A-Za-z0-9_-]{43}\.[1-9][0-9]{9,10}\.(?:live|test)\.[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const INDETERMINATE_RETRY_MS = 24 * 60 * 60 * 1000;

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function requestHash(value) {
    return crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function loadCatalog(catalogPath) {
    const source = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    if (source.market !== 'US' || source.currency !== 'USD' || !Array.isArray(source.products)) {
        throw new Error('Catalogo USA non valido');
    }
    const products = new Map();
    for (const product of source.products) {
        const id = String(product.id || '').trim();
        const amount = product.price?.amount;
        if (!id || !Number.isFinite(Number(amount)) || Number(amount) < 0) continue;
        products.set(id, Object.freeze({
            id,
            code: String(product.code || id),
            name: String(product.name || id),
            type: String(product.category || 'product'),
            price: Number(amount)
        }));
    }
    if (products.size === 0) throw new Error('Catalogo USA vuoto');
    return products;
}

function normalizeDirectItems(items, catalog) {
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
        throw new RangeError('Empty cart');
    }
    return items.map(item => {
        const product = catalog.get(String(item?.id || ''));
        const qty = Number(item?.qty);
        if (!product || !Number.isSafeInteger(qty) || qty < 1 || qty > 100) {
            throw new RangeError('Invalid cart item');
        }
        return { ...product, qty };
    });
}

function roundUsd(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calculateShopTotals(items, shipState) {
    const subtotal = roundUsd(items.reduce((sum, item) => sum + item.price * item.qty, 0));
    const salesTax = String(shipState || '').trim().toUpperCase() === 'AL'
        ? roundUsd(subtotal * 0.04)
        : 0;
    return Object.freeze({ subtotal, salesTax, total: roundUsd(subtotal + salesTax) });
}

function normalizeProposal(contract) {
    const proposal = contract?.proposal;
    if (contract?.contract_version !== 'f9-resolve-v1'
        || !UUID_PATTERN.test(contract.acceptance_id || '')
        || typeof contract.proposal_id !== 'string'
        || !contract.proposal_id
        || contract.proposal_id !== proposal?.proposal_id
        || !SHA256_PATTERN.test(contract.proposal_snapshot_version || '')
        || contract.proposal_snapshot_version !== contract.snapshot_hash
        || !['live', 'test'].includes(contract.purpose)
        || proposal?.contract_version !== 'f9-proposal-v1'
        || proposal.market !== 'USA'
        || proposal.currency !== 'USD'
        || proposal.is_test !== (contract.purpose === 'test')
        || !Array.isArray(proposal.items)
        || proposal.items.length === 0) {
        throw new TypeError('Invalid proposal contract');
    }
    const items = proposal.items.map(row => {
        const qty = Number(row.quantity);
        const price = Number(row.unit_price);
        if (!String(row.product_code || '').trim()
            || !String(row.product_name || '').trim()
            || !Number.isSafeInteger(qty) || qty < 1 || qty > 100
            || !Number.isFinite(price) || price < 0) {
            throw new TypeError('Invalid proposal item');
        }
        return {
            id: String(row.product_code),
            code: String(row.product_code),
            name: String(row.product_name),
            type: 'proposal',
            price,
            qty
        };
    });
    return {
        acceptanceId: contract.acceptance_id,
        proposalId: contract.proposal_id,
        snapshotVersion: contract.proposal_snapshot_version,
        snapshotHash: contract.snapshot_hash,
        purpose: contract.purpose,
        items
    };
}

async function resolveProposalReference(reference, { resolverUrl, apiKey, fetchImpl = global.fetch }) {
    if (!REFERENCE_PATTERN.test(reference || '')) {
        return { ok: false, status: 400, error: 'invalid_reference' };
    }
    if (typeof resolverUrl !== 'string' || !resolverUrl.startsWith('https://')
        || typeof apiKey !== 'string' || Buffer.byteLength(apiKey, 'utf8') < API_KEY_MIN_BYTES
        || typeof fetchImpl !== 'function') {
        return { ok: false, status: 503, error: 'resolver_unavailable' };
    }
    let response;
    try {
        response = await fetchImpl(resolverUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-f9-api-key': apiKey
            },
            body: JSON.stringify({ reference }),
            signal: AbortSignal.timeout(5000)
        });
    } catch {
        return { ok: false, status: 503, error: 'resolver_unavailable' };
    }
    if (!response.ok) {
        return {
            ok: false,
            status: response.status >= 500 ? 503 : 409,
            error: response.status >= 500 ? 'resolver_unavailable' : 'reference_rejected'
        };
    }
    try {
        return { ok: true, proposal: normalizeProposal(await response.json()) };
    } catch {
        return { ok: false, status: 503, error: 'resolver_contract_invalid' };
    }
}

function validateCustomer(body) {
    const customer = body?.customer;
    const shipping = body?.shipping_address;
    if (!customer?.full_name || !customer?.email || !customer?.phone) {
        throw new RangeError('Missing customer information');
    }
    if (!shipping?.street || !shipping?.city || !shipping?.state || !shipping?.zip) {
        throw new RangeError('Incomplete shipping address');
    }
    return { customer, shipping };
}

function responseForExisting(order, attempt, frontendUrl, publicOrderToken) {
    const confirmed = new Set(['paid', 'confirmed']);
    const sessionUrl = confirmed.has(order.status)
        ? `${frontendUrl}/en/shop/order-confirmed/?id=${encodeURIComponent(order.order_number)}`
        : attempt?.stripe_session_url;
    return {
        success: true,
        replayed: true,
        orderNumber: order.order_number,
        publicOrderToken,
        sessionUrl: sessionUrl || null,
        isTest: order.is_test === true
    };
}

function createF9CheckoutHandler({
    pool,
    stripe,
    config,
    generateOrderNumber,
    createPublicCapability,
    publicCapabilityReady,
    fetchImpl = global.fetch,
    now = () => new Date(),
    logger = console
}) {
    const catalog = loadCatalog(config.SHOP_US_CATALOG_PATH);

    return async function f9Checkout(req, res) {
        res.set('Cache-Control', 'private, no-store, max-age=0');
        const body = req.body || {};
        const reference = typeof body.myosseotouch_ref === 'string' ? body.myosseotouch_ref : '';
        let proposal = null;
        if (reference) {
            const resolution = await resolveProposalReference(reference, {
                resolverUrl: config.MYOSSEOTOUCH_F9_RESOLVER_URL,
                apiKey: config.MYOSSEOTOUCH_F9_API_KEY,
                fetchImpl
            });
            if (!resolution.ok) return res.status(resolution.status).json({ error: resolution.error });
            proposal = resolution.proposal;
        }

        let customer;
        let shipping;
        let items;
        try {
            ({ customer, shipping } = validateCustomer(body));
            items = proposal ? proposal.items : normalizeDirectItems(body.items, catalog);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }

        const presentedKey = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'];
        if (!proposal && !DIRECT_IDEMPOTENCY_PATTERN.test(presentedKey || '')) {
            return res.status(400).json({ error: 'Idempotency-Key required' });
        }
        const idempotencyKey = proposal
            ? `f9:${proposal.acceptanceId}`
            : presentedKey;
        if (!IDEMPOTENCY_PATTERN.test(idempotencyKey || '')) {
            return res.status(400).json({ error: 'Idempotency-Key required' });
        }
        if (!publicCapabilityReady(config.SHOP_ORDER_PUBLIC_TOKEN_SECRET)) {
            return res.status(503).json({ error: 'Checkout temporarily unavailable' });
        }
        const isTest = proposal?.purpose === 'test' || process.env.NODE_ENV !== 'production';
        if (!isTest && !stripe) return res.status(503).json({ error: 'Stripe not configured on server' });

        const totals = calculateShopTotals(items, shipping.state);
        const immutableRequest = {
            customer: {
                full_name: String(customer.full_name), email: String(customer.email),
                phone: String(customer.phone), practice: String(customer.practice || '')
            },
            shipping: {
                street: String(shipping.street), city: String(shipping.city),
                state: String(shipping.state).toUpperCase(), zip: String(shipping.zip)
            },
            items,
            acceptance_id: proposal?.acceptanceId || null,
            snapshot_version: proposal?.snapshotVersion || null
        };
        const immutableHash = requestHash(immutableRequest);
        const client = await pool.connect();
        let order;
        let attempt;
        let publicOrderToken;
        try {
            await client.query('BEGIN');
            const existing = await client.query(
                `SELECT * FROM shop_orders
                  WHERE idempotency_key=$1
                     OR ($2::uuid IS NOT NULL AND f9_acceptance_id=$2::uuid)
                  ORDER BY id ASC LIMIT 1 FOR UPDATE`,
                [idempotencyKey, proposal?.acceptanceId || null]
            );
            if (existing.rows.length) {
                order = existing.rows[0];
                if (order.checkout_request_hash !== immutableHash) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({ error: 'idempotency_payload_conflict' });
                }
                const attempts = await client.query(
                    `SELECT * FROM shop_order_stripe_attempts
                      WHERE order_id=$1 ORDER BY generation DESC LIMIT 1 FOR UPDATE`,
                    [order.id]
                );
                attempt = attempts.rows[0] || null;
                if (attempt?.state === 'indeterminate'
                    && now().getTime() - new Date(attempt.created_at).getTime() >= INDETERMINATE_RETRY_MS) {
                    await client.query('COMMIT');
                    return res.status(409).json({ error: 'payment_attempt_frozen' });
                }
                if (attempt && ['expired', 'terminal'].includes(attempt.state)) {
                    const nextGeneration = Number(attempt.generation) + 1;
                    const stripeKey = `${proposal ? `f9:${proposal.acceptanceId}` : `order:${order.id}`}:g${nextGeneration}`;
                    const created = await client.query(
                        `INSERT INTO shop_order_stripe_attempts
                            (order_id, generation, stripe_idempotency_key, request_hash, state)
                         VALUES ($1,$2,$3,$4,'creating') RETURNING *`,
                        [order.id, nextGeneration, stripeKey, immutableHash]
                    );
                    attempt = created.rows[0];
                }
            } else {
                const orderNumber = await generateOrderNumber(client);
                const inserted = await client.query(
                    `INSERT INTO shop_orders (
                        order_number, status, payment_method, buyer_company,
                        buyer_contact_name, buyer_email, buyer_phone, practice_name,
                        ship_street, ship_zip, ship_city, ship_state, ship_country,
                        subtotal_net, shipping, vat_amount, sales_tax, total_gross,
                        customer_notes, market, flow, currency, is_test,
                        idempotency_key, f9_acceptance_id, f9_proposal_id,
                        f9_snapshot_version, f9_snapshot_hash, checkout_request_hash,
                        snapshot_revision
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'US',
                        $13,0,0,$14,$15,$16,'US','buy_now','USD',$17,
                        $18,$19,$20,$21,$22,$23,
                        nextval('shop_orders_snapshot_revision_seq')
                    ) RETURNING *`,
                    [
                        orderNumber, isTest ? 'confirmed' : 'pending_payment',
                        isTest ? 'test_no_payment' : 'stripe_card',
                        customer.practice || null, customer.full_name, customer.email,
                        customer.phone, customer.practice || null, shipping.street,
                        shipping.zip, shipping.city, String(shipping.state).toUpperCase(),
                        totals.subtotal, totals.salesTax, totals.total,
                        body.notes || null, isTest, idempotencyKey,
                        proposal?.acceptanceId || null, proposal?.proposalId || null,
                        proposal?.snapshotVersion || null, proposal?.snapshotHash || null,
                        immutableHash
                    ]
                );
                order = inserted.rows[0];
                for (const item of items) {
                    await client.query(
                        `INSERT INTO shop_order_items
                            (order_id, product_type, product_code, product_name, qty,
                             unit_price, vat_rate, is_free_promo)
                         VALUES ($1,$2,$3,$4,$5,$6,0,$7)`,
                        [order.id, item.type, item.code, item.name, item.qty, item.price, item.price === 0]
                    );
                }
                if (!isTest) {
                    const stripeKey = `${proposal ? `f9:${proposal.acceptanceId}` : `order:${order.id}`}:g1`;
                    const created = await client.query(
                        `INSERT INTO shop_order_stripe_attempts
                            (order_id, generation, stripe_idempotency_key, request_hash, state)
                         VALUES ($1,1,$2,$3,'creating') RETURNING *`,
                        [order.id, stripeKey, immutableHash]
                    );
                    attempt = created.rows[0];
                }
            }
            publicOrderToken = createPublicCapability(
                config.SHOP_ORDER_PUBLIC_TOKEN_SECRET, order.order_number
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('[f9-checkout] persistence failed:', error?.name || 'Error');
            return res.status(500).json({ error: 'Could not create checkout session' });
        } finally {
            client.release();
        }

        if (isTest) {
            return res.json({
                success: true, orderNumber: order.order_number, publicOrderToken,
                isTest: true,
                sessionUrl: `${config.SHOP_FRONTEND_URL}/en/shop/order-confirmed/?id=${encodeURIComponent(order.order_number)}&test=1`
            });
        }
        if (attempt?.stripe_session_url || ['paid', 'confirmed'].includes(order.status)) {
            return res.json(responseForExisting(order, attempt, config.SHOP_FRONTEND_URL, publicOrderToken));
        }

        const lineItems = items.filter(item => item.price > 0).map(item => ({
            price_data: {
                currency: 'usd',
                product_data: { name: item.name },
                unit_amount: Math.round(item.price * 100)
            },
            quantity: item.qty
        }));
        if (totals.salesTax > 0) {
            lineItems.push({
                price_data: {
                    currency: 'usd',
                    product_data: { name: 'Alabama sales tax (4%)' },
                    unit_amount: Math.round(totals.salesTax * 100)
                },
                quantity: 1
            });
        }
        try {
            const session = await stripe.checkout.sessions.create({
                mode: 'payment',
                payment_method_types: ['card'],
                line_items: lineItems,
                customer_email: customer.email,
                success_url: `${config.SHOP_FRONTEND_URL}/en/shop/order-confirmed/?id=${encodeURIComponent(order.order_number)}&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${config.SHOP_FRONTEND_URL}/en/shop/checkout/?canceled=1`,
                metadata: {
                    order_number: order.order_number,
                    order_id: String(order.id),
                    stripe_attempt_generation: String(attempt.generation),
                    market: 'US'
                },
                locale: 'en'
            }, { idempotencyKey: attempt.stripe_idempotency_key });
            await pool.query(
                `UPDATE shop_order_stripe_attempts
                    SET state='open', stripe_session_id=$1, stripe_session_url=$2, updated_at=NOW()
                  WHERE order_id=$3 AND generation=$4`,
                [session.id, session.url, order.id, attempt.generation]
            );
            await pool.query(
                `UPDATE shop_orders SET stripe_session_id=$1,
                    snapshot_revision=nextval('shop_orders_snapshot_revision_seq') WHERE id=$2`,
                [session.id, order.id]
            );
            return res.json({
                success: true,
                orderNumber: order.order_number,
                publicOrderToken,
                sessionUrl: session.url
            });
        } catch {
            await pool.query(
                `UPDATE shop_order_stripe_attempts
                    SET state='indeterminate', updated_at=NOW()
                  WHERE order_id=$1 AND generation=$2 AND state='creating'`,
                [order.id, attempt.generation]
            ).catch(() => {});
            return res.status(503).json({ error: 'payment_attempt_indeterminate', retryable: true });
        }
    };
}

async function applyF9StripeWebhook(pool, event) {
    const session = event?.data?.object;
    const orderId = Number(session?.metadata?.order_id);
    const generation = Number(session?.metadata?.stripe_attempt_generation);
    if (session?.metadata?.market !== 'US'
        || !event?.id
        || !Number.isSafeInteger(orderId) || orderId <= 0
        || !Number.isSafeInteger(generation) || generation <= 0) {
        return { handled: false };
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const inserted = await client.query(
            `INSERT INTO shop_stripe_webhook_events
                (stripe_event_id, event_type, order_id, attempt_generation)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (stripe_event_id) DO NOTHING
             RETURNING stripe_event_id`,
            [event.id, event.type, orderId, generation]
        );
        if (!inserted.rows.length) {
            await client.query('COMMIT');
            return { handled: true, replayed: true };
        }
        const attemptResult = await client.query(
            `SELECT a.*,
                    (SELECT MAX(generation) FROM shop_order_stripe_attempts WHERE order_id=a.order_id) AS latest_generation
               FROM shop_order_stripe_attempts a
              WHERE a.order_id=$1 AND a.generation=$2
              FOR UPDATE`,
            [orderId, generation]
        );
        const attempt = attemptResult.rows[0];
        if (!attempt || Number(attempt.latest_generation) !== generation
            || (attempt.stripe_session_id && attempt.stripe_session_id !== session.id)) {
            await client.query('COMMIT');
            return { handled: true, stale: true };
        }
        let state = null;
        let paid = false;
        if (event.type === 'checkout.session.completed'
            && ['paid', 'no_payment_required'].includes(session.payment_status)) {
            state = 'completed';
            paid = true;
        } else if (event.type === 'checkout.session.async_payment_succeeded') {
            state = 'completed';
            paid = true;
        } else if (event.type === 'checkout.session.expired') {
            state = 'expired';
        } else if (event.type === 'checkout.session.async_payment_failed') {
            state = 'terminal';
        }
        if (state) {
            await client.query(
                `UPDATE shop_order_stripe_attempts
                    SET state=$1, stripe_session_id=COALESCE(stripe_session_id,$2), updated_at=NOW()
                  WHERE order_id=$3 AND generation=$4`,
                [state, session.id, orderId, generation]
            );
        }
        let orderPaidNow = false;
        if (paid) {
            const paidUpd = await client.query(
                `UPDATE shop_orders
                    SET status='paid', stripe_payment_status=$1, confirmed_at=NOW(),
                        snapshot_revision=nextval('shop_orders_snapshot_revision_seq')
                  WHERE id=$2 AND stripe_session_id=$3 AND status <> 'paid'`,
                [session.payment_status || 'paid', orderId, session.id]
            );
            orderPaidNow = paidUpd.rowCount > 0;
        }
        await client.query(
            `UPDATE shop_stripe_webhook_events SET applied_at=NOW()
              WHERE stripe_event_id=$1`,
            [event.id]
        );
        await client.query('COMMIT');
        return { handled: true, applied: Boolean(state), paid, orderPaidNow, orderId };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    API_KEY_MIN_BYTES,
    DIRECT_IDEMPOTENCY_PATTERN,
    IDEMPOTENCY_PATTERN,
    INDETERMINATE_RETRY_MS,
    REFERENCE_PATTERN,
    applyF9StripeWebhook,
    calculateShopTotals,
    createF9CheckoutHandler,
    loadCatalog,
    normalizeDirectItems,
    normalizeProposal,
    requestHash,
    resolveProposalReference
};
