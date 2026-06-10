import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keygen, signDocument, verifyDocument, keyId } from '../src/akashi.js';
import { sha256hex, canonicalize } from '../src/canonical.js';
import { FIXTURE } from './helpers.js';

const k = keygen();
const sidecar = signDocument(FIXTURE, k.privatePem, { alias: 'T.S.', kokoroVersion: '1.2.0' });

test('署名 → 検証ラウンドトリップ', () => {
  const r = verifyDocument(FIXTURE, sidecar);
  assert.equal(r.status, 'verified');
  assert.equal(r.ok, true);
  assert.equal(r.key_id, k.keyId);
});

test('CRLF 化されたファイルでも検証が通る（正規化）', () => {
  const r = verifyDocument(FIXTURE.replace(/\n/g, '\r\n'), sidecar);
  assert.equal(r.status, 'verified');
});

test('本文改ざんで invalid-signature', () => {
  const r = verifyDocument(FIXTURE.replace('結論を先に', '結論を後に'), sidecar);
  assert.equal(r.status, 'invalid-signature');
  assert.equal(r.ok, false);
});

test('sidecar なしは unsigned', () => {
  assert.equal(verifyDocument(FIXTURE, null).status, 'unsigned');
});

test('expires_at 超過で expired', () => {
  const s = signDocument(FIXTURE, k.privatePem, { expiresAt: '2020-01-01T00:00:00Z' });
  assert.equal(verifyDocument(FIXTURE, s).status, 'expired');
});

test('レジストリで鍵失効 → revoked-key', () => {
  const registry = { spec: 'akashi-registry/0.1', keys: { [k.keyId]: { status: 'revoked' } }, documents: {} };
  assert.equal(verifyDocument(FIXTURE, sidecar, { registry }).status, 'revoked-key');
});

test('レジストリで文書失効 → revoked-document（撤回の執行）', () => {
  const hash = sha256hex(canonicalize(FIXTURE));
  const registry = { spec: 'akashi-registry/0.1', keys: { [k.keyId]: { status: 'valid' } }, documents: { [hash]: { status: 'revoked', reason: '本人撤回' } } };
  const r = verifyDocument(FIXTURE, sidecar, { registry });
  assert.equal(r.status, 'revoked-document');
  assert.equal(r.reason, '本人撤回');
});

test('レジストリ未登録鍵は verified + warning', () => {
  const registry = { spec: 'akashi-registry/0.1', keys: {}, documents: {} };
  const r = verifyDocument(FIXTURE, sidecar, { registry });
  assert.equal(r.status, 'verified');
  assert.ok(r.warnings.some((w) => w.includes('key-unknown')));
});

test('レジストリ不達は verified + warning（暗号検証は維持）', () => {
  const r = verifyDocument(FIXTURE, sidecar, { registryError: 'HTTP 503' });
  assert.equal(r.status, 'verified');
  assert.ok(r.warnings.some((w) => w.includes('503')));
});

test('key_id は public key から決定的に導出される', () => {
  assert.equal(keyId(k.publicPem), k.keyId);
  assert.equal(k.keyId.length, 16);
});
