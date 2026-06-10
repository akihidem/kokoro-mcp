import { existsSync, readFileSync } from 'node:fs';
import { verifyDocument } from './akashi.js';
import { distributionCheck, loadKokoro, resolveKokoroFile } from './kokoro.js';
import { loadRegistry } from './registry.js';

// 配信可否の一元判定。serve / render / verify / status の全てがここを通る。
// セキュリティ既定:
//   - 未署名は拒否（--allow-unsigned で本人責任の配信のみ許可）
//   - 検証失敗・失効（invalid-signature / expired / revoked-*）は allow-unsigned でも拒否
//   - SPEC §10.3 流通禁止条件は署名の有無に関わらず常に適用
export async function assess({ file, registry, policy = 'clinical', allowUnsigned = false } = {}) {
  const path = resolveKokoroFile(file);
  if (!path) {
    return {
      exists: false,
      path: null,
      doc: null,
      sidecar: null,
      verification: { status: 'missing', ok: false, warnings: [] },
      distribution: { allowed: false, violations: [] },
      refusals: ['kokoro.md が見つかりません（引数 / $KOKORO_FILE / ./kokoro.md / ~/.kokoro/kokoro.md）'],
      servable: false,
      policy,
      allowUnsigned,
      registrySource: null,
    };
  }
  const doc = loadKokoro(path);
  const sidecarPath = path + '.akashi.json';
  let sidecar = null;
  if (existsSync(sidecarPath)) {
    try {
      sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
    } catch {
      sidecar = { spec: 'broken-sidecar' };
    }
  }
  const registrySource = registry ?? process.env.KOKORO_REGISTRY ?? sidecar?.registry ?? null;
  const { registry: reg, error: regError } = await loadRegistry(registrySource);
  const verification = verifyDocument(doc.text, sidecar, { registry: reg, registryError: regError });
  const distribution = distributionCheck(doc.meta, { policy });

  const refusals = [];
  if (!distribution.allowed) refusals.push(...distribution.violations);
  if (verification.status === 'unsigned') {
    if (!allowUnsigned) refusals.push('署名（akashi sidecar）がありません。--allow-unsigned で本人責任の配信は可能');
  } else if (!verification.ok) {
    refusals.push(`署名検証に失敗: ${verification.status}${verification.reason ? ` — ${verification.reason}` : ''}`);
  }

  return {
    exists: true,
    path,
    doc,
    sidecar,
    verification,
    distribution,
    refusals,
    servable: refusals.length === 0,
    policy,
    allowUnsigned,
    registrySource,
  };
}

export function statusJson(a) {
  return {
    path: a.path,
    policy: a.policy,
    servable: a.servable,
    refusals: a.refusals,
    verification: {
      status: a.verification.status,
      ok: a.verification.ok,
      key_id: a.verification.key_id ?? null,
      signed_at: a.verification.signed_at ?? null,
      expires_at: a.verification.expires_at ?? null,
      warnings: a.verification.warnings ?? [],
    },
    distribution: a.distribution,
    frontmatter: a.doc?.meta
      ? {
          version: a.doc.meta.version ?? null,
          mode: a.doc.meta.mode ?? null,
          reviewed_by: a.doc.meta.reviewed_by ?? null,
          updated_at: a.doc.meta.updated_at ?? null,
          next_review: a.doc.meta.next_review ?? null,
        }
      : null,
  };
}

export function banner(a, version) {
  const v = a.verification;
  const key = v.key_id ? ` key=${v.key_id}` : '';
  return `<!-- kokoro-mcp v${version} | status=${v.status}${key} | policy=${a.policy} -->`;
}
