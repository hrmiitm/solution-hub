import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GoogleTokenVerifier } from '../../worker/src/auth/google.ts';
import { base64UrlEncode } from '../../worker/src/lib/util.ts';

const AUD = 'test-client.apps.googleusercontent.com';
const enc = (o: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));

async function setup() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  let fetches = 0;
  const verifier = new GoogleTokenVerifier(async () => {
    fetches++;
    return { keys: [{ ...jwk, kid: 'k1' }], maxAgeSeconds: 3600 };
  });
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) => {
    const data = `${enc(header)}.${enc(claims)}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(data));
    return `${data}.${base64UrlEncode(new Uint8Array(sig))}`;
  };
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://accounts.google.com', aud: AUD, sub: '1234567890', email: 'ada@example.com', email_verified: true, name: 'Ada', picture: 'https://example.com/a.png', iat: now, exp: now + 3600 };
  return { verifier, sign, good, now, fetches: () => fetches };
}

test('accepts a valid Google ID token', async () => {
  const { verifier, sign, good } = await setup();
  const id = await verifier.verify(await sign(good), [AUD]);
  assert.equal(id.sub, '1234567890');
  assert.equal(id.email, 'ada@example.com');
  assert.equal(id.picture, 'https://example.com/a.png');
  assert.equal(id.hd, null, 'personal accounts have no organization');
});

test('extracts the Workspace domain from the signed hd claim', async () => {
  const { verifier, sign, good } = await setup();
  assert.equal((await verifier.verify(await sign({ ...good, hd: 'Acme.COM' }), [AUD])).hd, 'acme.com');
  assert.equal((await verifier.verify(await sign({ ...good, hd: 'bad domain!' }), [AUD])).hd, null);
});

test('rejects wrong audience, issuer, expiry, unverified email', async () => {
  const { verifier, sign, good, now } = await setup();
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...good, aud: 'someone-else' }, /audience/],
    [{ ...good, iss: 'https://evil.example' }, /issuer/],
    [{ ...good, exp: now - 3600 }, /expired/],
    [{ ...good, email_verified: false }, /email/],
    [{ ...good, sub: '' }, /subject/],
    [{ ...good, iat: now + 3600 }, /future/],
  ];
  for (const [claims, why] of cases) {
    await assert.rejects(verifier.verify(await sign(claims), [AUD]), why);
  }
});

test('rejects tampered payload, alg none and unknown keys', async () => {
  const { verifier, sign, good } = await setup();
  const token = await sign(good);
  const [h, , s] = token.split('.');
  const forged = `${h}.${enc({ ...good, sub: 'attacker' })}.${s}`;
  await assert.rejects(verifier.verify(forged, [AUD]), /signature/);
  await assert.rejects(verifier.verify(`${enc({ alg: 'none', kid: 'k1' })}.${enc(good)}.`, [AUD]), /algorithm/);
  await assert.rejects(verifier.verify(await sign(good, { alg: 'RS256', kid: 'nope' }), [AUD]), /unknown key/);
  await assert.rejects(verifier.verify('not-a-jwt', [AUD]), /format/);
});

test('caches JWKS between verifications', async () => {
  const { verifier, sign, good, fetches } = await setup();
  await verifier.verify(await sign(good), [AUD]);
  await verifier.verify(await sign(good), [AUD]);
  assert.equal(fetches(), 1);
});

test('fails closed when no client id is configured', async () => {
  const { verifier, sign, good } = await setup();
  await assert.rejects(verifier.verify(await sign(good), []), /not configured/);
});
