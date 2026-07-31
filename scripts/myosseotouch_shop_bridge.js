const crypto = require('crypto');

const MYOSSEOTOUCH_SHOP_BRIDGE_VERSION = 'v1';
const MYOSSEOTOUCH_SHOP_BRIDGE_DOMAIN = 'OSSEOTOUCH\0myosseotouch-shop-bridge\0v1\0';
const MYOSSEOTOUCH_SHOP_BRIDGE_ORIGIN = 'myosseotouch_us';
const MYOSSEOTOUCH_SHOP_BRIDGE_SECRET_MIN_BYTES = 32;
const MYOSSEOTOUCH_SHOP_BRIDGE_MAX_FUTURE_SECONDS = 120 * 60;
const MYOSSEOTOUCH_SHOP_BRIDGE_PATTERN =
    /^v1\.([A-Za-z0-9_-]{43})\.([1-9][0-9]{9,10})\.(live|test)\.([A-Za-z0-9_-]{43})$/;

function isMyOsseotouchShopBridgeSecretConfigured(secret) {
    return typeof secret === 'string'
        && Buffer.byteLength(secret, 'utf8') >= MYOSSEOTOUCH_SHOP_BRIDGE_SECRET_MIN_BYTES;
}

function buildMyOsseotouchShopBridgeTag(secret, randomPart, expiresAt, purpose) {
    if (!isMyOsseotouchShopBridgeSecretConfigured(secret)) return null;

    return crypto
        .createHmac('sha256', secret)
        .update(MYOSSEOTOUCH_SHOP_BRIDGE_DOMAIN, 'utf8')
        .update(randomPart, 'ascii')
        .update('\0', 'ascii')
        .update(String(expiresAt), 'ascii')
        .update('\0', 'ascii')
        .update(purpose, 'ascii')
        .digest('base64url');
}

function declaredPurpose(reference) {
    if (typeof reference !== 'string') return null;
    const parts = reference.split('.');
    return parts.length >= 4 && (parts[3] === 'live' || parts[3] === 'test')
        ? parts[3]
        : null;
}

function timingSafeTagEqual(expectedTag, presentedTag) {
    if (typeof expectedTag !== 'string' || typeof presentedTag !== 'string') return false;
    const expectedBuffer = Buffer.from(expectedTag, 'ascii');
    const presentedRaw = Buffer.from(presentedTag, 'ascii');
    const presentedBuffer = Buffer.alloc(expectedBuffer.length);
    presentedRaw.copy(presentedBuffer, 0, 0, expectedBuffer.length);
    return presentedRaw.length === expectedBuffer.length
        && crypto.timingSafeEqual(expectedBuffer, presentedBuffer);
}

// Se il browser altera/rimuove il segmento purpose ma lascia la firma TEST
// originaria, il percorso deve restare fail-closed. Questa verifica non rende
// valido il reference: serve esclusivamente a impedire la degradazione a live.
function hasSignedTestProvenance(reference, secret) {
    if (typeof reference !== 'string') return false;
    const parts = reference.split('.');
    // Candidati stretti nei soli casi in cui random, scadenza e firma restano
    // recuperabili: token completo, senza version, senza purpose, o senza
    // entrambi. Nessuna euristica puo' distinguere in sicurezza gli altri casi
    // da un reference live invalido.
    const candidates = parts.length === 5
        ? [[parts[1], parts[2], parts[4]]]
        : parts.length === 4
            ? [
                [parts[1], parts[2], parts[3]], // purpose rimosso
                [parts[0], parts[1], parts[3]]  // version rimossa
            ]
            : parts.length === 3
                ? [[parts[0], parts[1], parts[2]]] // version e purpose rimossi
                : [];

    return candidates.some(([randomPart, expiresAtRaw, presentedTag]) => {
        if (!/^[A-Za-z0-9_-]{43}$/.test(randomPart || '')
            || !/^[1-9][0-9]{9,10}$/.test(expiresAtRaw || '')
            || !/^[A-Za-z0-9_-]{43}$/.test(presentedTag || '')) {
            return false;
        }
        const expectedTestTag = buildMyOsseotouchShopBridgeTag(
            secret,
            randomPart,
            expiresAtRaw,
            'test'
        );
        return timingSafeTagEqual(expectedTestTag, presentedTag);
    });
}

function invalidDecision({ claimedPurpose = null, rejectRequest = false } = {}) {
    return Object.freeze({
        present: true,
        state: 'invalid',
        hash: null,
        origin: null,
        purpose: null,
        validatedAt: null,
        isTest: false,
        claimedPurpose,
        rejectRequest
    });
}

function evaluateMyOsseotouchShopBridgeReference(reference, {
    secret,
    testMode = false,
    nowEpochSeconds = Math.floor(Date.now() / 1000)
} = {}) {
    const present = reference !== undefined && reference !== null && reference !== '';
    if (!present) {
        return Object.freeze({
            present: false,
            state: 'absent',
            hash: null,
            origin: null,
            purpose: null,
            validatedAt: null,
            isTest: false,
            claimedPurpose: null,
            rejectRequest: false
        });
    }

    const claimedPurpose = declaredPurpose(reference);
    const rejectInvalidTest = claimedPurpose === 'test'
        || hasSignedTestProvenance(reference, secret);
    if (typeof reference !== 'string' || !MYOSSEOTOUCH_SHOP_BRIDGE_PATTERN.test(reference)) {
        return invalidDecision({ claimedPurpose, rejectRequest: rejectInvalidTest });
    }

    const match = reference.match(MYOSSEOTOUCH_SHOP_BRIDGE_PATTERN);
    const [, randomPart, expiresAtRaw, purpose, presentedTag] = match;
    const expiresAt = Number(expiresAtRaw);
    const now = Number(nowEpochSeconds);

    if (!Number.isSafeInteger(now)
        || !Number.isSafeInteger(expiresAt)
        || expiresAt <= now
        || expiresAt > now + MYOSSEOTOUCH_SHOP_BRIDGE_MAX_FUTURE_SECONDS) {
        return invalidDecision({ claimedPurpose: purpose, rejectRequest: purpose === 'test' });
    }

    const expectedTag = buildMyOsseotouchShopBridgeTag(secret, randomPart, expiresAtRaw, purpose);
    if (!expectedTag) {
        return invalidDecision({ claimedPurpose: purpose, rejectRequest: purpose === 'test' });
    }

    const validTag = timingSafeTagEqual(expectedTag, presentedTag);
    if (!validTag) {
        return invalidDecision({
            claimedPurpose: purpose,
            rejectRequest: purpose === 'test' || hasSignedTestProvenance(reference, secret)
        });
    }

    if (purpose === 'test' && testMode !== true) {
        return invalidDecision({ claimedPurpose: purpose, rejectRequest: true });
    }

    return Object.freeze({
        present: true,
        state: 'accepted',
        hash: crypto.createHash('sha256').update(reference, 'ascii').digest('hex'),
        origin: MYOSSEOTOUCH_SHOP_BRIDGE_ORIGIN,
        purpose,
        validatedAt: new Date(now * 1000).toISOString(),
        isTest: purpose === 'test',
        claimedPurpose: purpose,
        rejectRequest: false
    });
}

module.exports = {
    MYOSSEOTOUCH_SHOP_BRIDGE_DOMAIN,
    MYOSSEOTOUCH_SHOP_BRIDGE_MAX_FUTURE_SECONDS,
    MYOSSEOTOUCH_SHOP_BRIDGE_ORIGIN,
    MYOSSEOTOUCH_SHOP_BRIDGE_PATTERN,
    MYOSSEOTOUCH_SHOP_BRIDGE_VERSION,
    buildMyOsseotouchShopBridgeTag,
    evaluateMyOsseotouchShopBridgeReference,
    hasSignedTestProvenance,
    isMyOsseotouchShopBridgeSecretConfigured
};
