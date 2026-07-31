const crypto = require('crypto');

const SHOP_ORDER_PUBLIC_TOKEN_VERSION = 'v1';
const SHOP_ORDER_PUBLIC_TOKEN_DOMAIN = 'OSSEOTOUCH\0shop-order-public-capability\0v1\0';
const SHOP_ORDER_NUMBER_PATTERN = /^OSS-\d{4}-\d{4,}$/;
const SHOP_ORDER_PUBLIC_TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]{43}$/;
const SHOP_ORDER_PUBLIC_SECRET_MIN_LENGTH = 32;
const SHOP_ORDER_PUBLIC_NOT_FOUND = Object.freeze({ error: 'Risorsa non disponibile' });

function isShopOrderPublicSecretConfigured(secret) {
    return typeof secret === 'string' && secret.length >= SHOP_ORDER_PUBLIC_SECRET_MIN_LENGTH;
}

function createShopOrderPublicCapability(secret, orderNumber) {
    if (!isShopOrderPublicSecretConfigured(secret) || !SHOP_ORDER_NUMBER_PATTERN.test(String(orderNumber || ''))) {
        return null;
    }

    const digest = crypto
        .createHmac('sha256', secret)
        .update(SHOP_ORDER_PUBLIC_TOKEN_DOMAIN, 'utf8')
        .update(String(orderNumber), 'utf8')
        .digest('base64url');

    return `${SHOP_ORDER_PUBLIC_TOKEN_VERSION}.${digest}`;
}

function extractBearerToken(authorizationHeader) {
    if (typeof authorizationHeader !== 'string') return '';
    const match = authorizationHeader.match(/^Bearer (.+)$/);
    return match ? match[1] : '';
}

function verifyShopOrderPublicCapability(secret, orderNumber, authorizationHeader) {
    const expected = createShopOrderPublicCapability(secret, orderNumber);
    if (!expected) return false;

    const presented = extractBearerToken(authorizationHeader);
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const presentedRaw = Buffer.from(presented, 'utf8');
    const presentedBuffer = Buffer.alloc(expectedBuffer.length);
    presentedRaw.copy(presentedBuffer, 0, 0, expectedBuffer.length);

    const sameLength = presentedRaw.length === expectedBuffer.length;
    const validSyntax = SHOP_ORDER_PUBLIC_TOKEN_PATTERN.test(presented);
    const equal = crypto.timingSafeEqual(expectedBuffer, presentedBuffer);
    return sameLength && validSyntax && equal;
}

function appendShopOrderCapabilityFragment(url, capability) {
    if (!SHOP_ORDER_PUBLIC_TOKEN_PATTERN.test(String(capability || ''))) {
        throw new Error('Shop public order capability non disponibile');
    }
    if (String(url).includes('#')) {
        throw new Error('URL shop contiene già un fragment');
    }
    return `${url}#order_token=${encodeURIComponent(capability)}`;
}

function sanitizeShopOrderError(error) {
    return String(error && error.message ? error.message : error || 'unknown')
        .replace(/v1\.[A-Za-z0-9_-]+/g, '[REDACTED]');
}

function sendShopOrderNotFound(res) {
    return res.status(404).json(SHOP_ORDER_PUBLIC_NOT_FOUND);
}

function createShopPublicOrderHandler({ pool, secret, logger = console }) {
    return async function shopPublicOrderHandler(req, res) {
        res.set('Cache-Control', 'no-store');
        res.set('Vary', 'Authorization');

        const orderNumber = String(req.params?.orderNumber || '');
        const authorization = typeof req.get === 'function'
            ? req.get('authorization')
            : req.headers?.authorization;

        if (!verifyShopOrderPublicCapability(secret, orderNumber, authorization)) {
            return sendShopOrderNotFound(res);
        }

        try {
            const orderResult = await pool.query(
                `SELECT order_number, status, payment_method,
                        buyer_company, buyer_contact_name, buyer_email, buyer_phone, buyer_vat,
                        ship_street, ship_zip, ship_city, ship_prov,
                        subtotal_net, shipping, vat_amount, total_gross,
                        customer_notes, financing_data, created_at
                 FROM shop_orders WHERE order_number = $1`,
                [orderNumber]
            );
            if (orderResult.rows.length === 0) return sendShopOrderNotFound(res);

            const order = orderResult.rows[0];
            const itemsResult = await pool.query(
                `SELECT product_type, product_name, qty, unit_price, is_free_promo
                 FROM shop_order_items
                 WHERE order_id = (SELECT id FROM shop_orders WHERE order_number = $1)`,
                [orderNumber]
            );

            return res.json({
                orderNumber: order.order_number,
                method: order.payment_method,
                status: order.status,
                customer: {
                    company: order.buyer_company,
                    contact_name: order.buyer_contact_name,
                    email: order.buyer_email,
                    phone: order.buyer_phone,
                    vat: order.buyer_vat
                },
                shipping_address: {
                    street: order.ship_street,
                    zip: order.ship_zip,
                    city: order.ship_city,
                    prov: order.ship_prov
                },
                notes: order.customer_notes || '',
                items: itemsResult.rows.map(item => ({
                    name: item.product_name,
                    qty: item.qty,
                    price: Number(item.unit_price),
                    type: item.product_type
                })),
                totals: {
                    subtotal: Number(order.subtotal_net),
                    shipping: Number(order.shipping),
                    vat: Number(order.vat_amount),
                    total: Number(order.total_gross),
                    hasPinVat: false
                },
                financing: order.financing_data || null
            });
        } catch (error) {
            logger.error('[shop/orders public] error:', sanitizeShopOrderError(error));
            return res.status(500).json({ error: 'Errore server' });
        }
    };
}

module.exports = {
    SHOP_ORDER_NUMBER_PATTERN,
    SHOP_ORDER_PUBLIC_NOT_FOUND,
    SHOP_ORDER_PUBLIC_TOKEN_PATTERN,
    appendShopOrderCapabilityFragment,
    createShopOrderPublicCapability,
    createShopPublicOrderHandler,
    isShopOrderPublicSecretConfigured,
    sanitizeShopOrderError,
    verifyShopOrderPublicCapability
};
