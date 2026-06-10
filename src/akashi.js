import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto';
import { canonicalize, sha256hex } from './canonical.js';

export const AKASHI_SPEC = 'akashi/0.1';

export function keyId(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export function keygen() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return { publicPem, privatePem, keyId: keyId(publicPem) };
}

// 署名対象は kokoro.md 全文（frontmatter 含む）の正規形。
// sidecar（FILE.akashi.json）として分離するため自己参照問題が生じない。
export function signDocument(text, privatePem, opts = {}) {
  const canonical = canonicalize(text);
  const privateKey = createPrivateKey(privatePem);
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const signature = edSign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64');
  return {
    spec: AKASHI_SPEC,
    target: opts.target ?? 'kokoro.md',
    hash_algorithm: 'sha256',
    canonical_sha256: sha256hex(canonical),
    signature_algorithm: 'ed25519',
    signature,
    public_key_spki_pem: publicPem,
    key_id: keyId(publicPem),
    signer: { role: opts.role ?? 'certified-psychologist', alias: opts.alias ?? null },
    kokoro_version: opts.kokoroVersion ?? null,
    signed_at: opts.signedAt ?? new Date().toISOString(),
    expires_at: opts.expiresAt ?? null,
    registry: opts.registry ?? null,
  };
}

// 検証ステータス:
//   verified          署名有効・失効なし
//   unsigned          sidecar なし
//   invalid-signature ハッシュ不一致 / 署名不一致 / sidecar 破損
//   expired           expires_at 超過
//   revoked-key       レジストリで鍵が失効
//   revoked-document  レジストリで文書ハッシュが失効（= 撤回・削除権の執行）
export function verifyDocument(text, sidecar, { registry = null, registryError = null, now = new Date() } = {}) {
  const warnings = [];
  const res = (status, ok, details = {}) => ({
    status,
    ok,
    warnings,
    key_id: sidecar?.key_id ?? null,
    signed_at: sidecar?.signed_at ?? null,
    expires_at: sidecar?.expires_at ?? null,
    ...details,
  });
  if (!sidecar) return res('unsigned', false);
  if (sidecar.spec !== AKASHI_SPEC) {
    return res('invalid-signature', false, { reason: `unknown sidecar spec: ${sidecar.spec}` });
  }
  const canonical = canonicalize(text);
  if (sha256hex(canonical) !== sidecar.canonical_sha256) {
    return res('invalid-signature', false, { reason: '本文が署名時から変更されています（canonical hash mismatch）' });
  }
  let publicKey;
  try {
    publicKey = createPublicKey(sidecar.public_key_spki_pem);
  } catch {
    return res('invalid-signature', false, { reason: 'public key が読めません' });
  }
  if (keyId(sidecar.public_key_spki_pem) !== sidecar.key_id) {
    return res('invalid-signature', false, { reason: 'key_id が public key と一致しません' });
  }
  let ok = false;
  try {
    ok = edVerify(null, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(sidecar.signature, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) return res('invalid-signature', false, { reason: 'ed25519 署名が一致しません' });
  if (sidecar.expires_at && new Date(sidecar.expires_at) < now) return res('expired', false);
  if (registryError) warnings.push(`レジストリに到達できません: ${registryError}（署名自体は暗号学的に有効）`);
  if (registry) {
    const k = registry.keys?.[sidecar.key_id];
    if (k?.status === 'revoked') return res('revoked-key', false, { revoked_at: k.revokedAt ?? null });
    const d = registry.documents?.[sidecar.canonical_sha256];
    if (d?.status === 'revoked') {
      return res('revoked-document', false, { revoked_at: d.revokedAt ?? null, reason: d.reason ?? null });
    }
    if (!k) warnings.push(`key ${sidecar.key_id} はレジストリ未登録（key-unknown）`);
  }
  return res('verified', true);
}
