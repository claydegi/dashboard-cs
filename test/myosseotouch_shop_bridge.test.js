const assert = require('node:assert/strict');
const test = require('node:test');

const {
    MYOSSEOTOUCH_SHOP_BRIDGE_PATTERN,
    buildMyOsseotouchShopBridgeTag,
    evaluateMyOsseotouchShopBridgeReference,
    isMyOsseotouchShopBridgeSecretConfigured
} = require('../scripts/myosseotouch_shop_bridge');

const SECRET = 'f9-cross-runtime-test-secret-32-bytes-minimum';
const RANDOM = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const EXPIRY = '2000000000';
const EXPECTED_TAG = 'V9ZVBAyCbr3Gy_e3XkQuB1oO46QT_WF8YaYcgbjYG2Q';
const EXPECTED_REFERENCE = `v1.${RANDOM}.${EXPIRY}.test.${EXPECTED_TAG}`;
const EXPECTED_HASH = 'c64711fc62e2310bd5f6a823f2de19ac3ac4f2ae6843d47f10244d972a675894';

function reference({ random = RANDOM, expiry = EXPIRY, purpose = 'live', secret = SECRET } = {}) {
    const tag = buildMyOsseotouchShopBridgeTag(secret, random, expiry, purpose);
    return `v1.${random}.${expiry}.${purpose}.${tag}`;
}

test('Python/Node cross-runtime vector has the agreed framing, tag and digest', () => {
    assert.equal(buildMyOsseotouchShopBridgeTag(SECRET, RANDOM, EXPIRY, 'test'), EXPECTED_TAG);
    assert.match(EXPECTED_REFERENCE, MYOSSEOTOUCH_SHOP_BRIDGE_PATTERN);

    const decision = evaluateMyOsseotouchShopBridgeReference(EXPECTED_REFERENCE, {
        secret: SECRET,
        testMode: true,
        nowEpochSeconds: Number(EXPIRY) - 3600
    });
    assert.equal(decision.state, 'accepted');
    assert.equal(decision.purpose, 'test');
    assert.equal(decision.isTest, true);
    assert.equal(decision.hash, EXPECTED_HASH);
    assert.equal(JSON.stringify(decision).includes(EXPECTED_REFERENCE), false);
});

test('absence is distinct from an invalid live reference so fallback remains deterministic', () => {
    const absent = evaluateMyOsseotouchShopBridgeReference(undefined, {
        secret: SECRET,
        nowEpochSeconds: Number(EXPIRY) - 3600
    });
    assert.equal(absent.state, 'absent');
    assert.equal(absent.rejectRequest, false);

    const invalidLive = evaluateMyOsseotouchShopBridgeReference(
        `v1.${RANDOM}.${EXPIRY}.live.${'B'.repeat(43)}`,
        { secret: SECRET, nowEpochSeconds: Number(EXPIRY) - 3600 }
    );
    assert.equal(invalidLive.state, 'invalid');
    assert.equal(invalidLive.rejectRequest, false);
    assert.equal(invalidLive.hash, null);
});

test('a declared TEST reference fails closed for flag, secret, HMAC, version and expiry', () => {
    const validTest = reference({ purpose: 'test' });
    const cases = [
        evaluateMyOsseotouchShopBridgeReference(validTest, {
            secret: SECRET,
            testMode: false,
            nowEpochSeconds: Number(EXPIRY) - 3600
        }),
        evaluateMyOsseotouchShopBridgeReference(validTest, {
            secret: '',
            testMode: true,
            nowEpochSeconds: Number(EXPIRY) - 3600
        }),
        evaluateMyOsseotouchShopBridgeReference(
            `v1.${RANDOM}.${EXPIRY}.test.${'B'.repeat(43)}`,
            { secret: SECRET, testMode: true, nowEpochSeconds: Number(EXPIRY) - 3600 }
        ),
        evaluateMyOsseotouchShopBridgeReference(
            `v2.${RANDOM}.${EXPIRY}.test.${EXPECTED_TAG}`,
            { secret: SECRET, testMode: true, nowEpochSeconds: Number(EXPIRY) - 3600 }
        ),
        evaluateMyOsseotouchShopBridgeReference(validTest, {
            secret: SECRET,
            testMode: true,
            nowEpochSeconds: Number(EXPIRY)
        })
    ];

    for (const decision of cases) {
        assert.equal(decision.state, 'invalid');
        assert.equal(decision.rejectRequest, true);
        assert.equal(decision.isTest, false);
        assert.equal(decision.hash, null);
    }
});

test('purpose cannot be changed or removed from TEST to degrade into the live path', () => {
    const tampered = EXPECTED_REFERENCE.replace('.test.', '.live.');
    const purposeRemoved = `v1.${RANDOM}.${EXPIRY}.${EXPECTED_TAG}`;
    for (const candidate of [tampered, purposeRemoved]) {
        const decision = evaluateMyOsseotouchShopBridgeReference(candidate, {
            secret: SECRET,
            testMode: true,
            nowEpochSeconds: Number(EXPIRY) - 3600
        });
        assert.equal(decision.state, 'invalid');
        assert.equal(decision.rejectRequest, true);
        assert.equal(decision.purpose, null);
    }
});

test('version and purpose structural downgrades preserve signed TEST provenance', () => {
    const downgraded = [
        `v2.${RANDOM}.${EXPIRY}.live.${EXPECTED_TAG}`,
        `${RANDOM}.${EXPIRY}.test.${EXPECTED_TAG}`,
        `${RANDOM}.${EXPIRY}.${EXPECTED_TAG}`
    ];
    for (const candidate of downgraded) {
        const decision = evaluateMyOsseotouchShopBridgeReference(candidate, {
            secret: SECRET,
            testMode: true,
            nowEpochSeconds: Number(EXPIRY) - 3600
        });
        assert.equal(decision.state, 'invalid');
        assert.equal(decision.rejectRequest, true);
        assert.equal(decision.purpose, null);
    }
});

test('references beyond the 120-minute validation horizon are invalid', () => {
    const expiry = '2000007201';
    const decision = evaluateMyOsseotouchShopBridgeReference(reference({ expiry }), {
        secret: SECRET,
        nowEpochSeconds: 2000000000
    });
    assert.equal(decision.state, 'invalid');
    assert.equal(decision.rejectRequest, false);
});

test('bridge secret requires at least 32 UTF-8 bytes and has no fallback', () => {
    assert.equal(isMyOsseotouchShopBridgeSecretConfigured(undefined), false);
    assert.equal(isMyOsseotouchShopBridgeSecretConfigured('short'), false);
    assert.equal(isMyOsseotouchShopBridgeSecretConfigured('x'.repeat(32)), true);
});
