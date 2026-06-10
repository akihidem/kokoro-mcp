import { readFileSync, writeFileSync } from 'node:fs';

export const REGISTRY_SPEC = 'akashi-registry/0.1';

// wazao-traceability の「原簿 → 公開フィルタ」パターンの移植:
// レジストリが公開するのは key_id / 文書ハッシュの有効・失効ステータスのみ。
// 臨床情報・本人情報は一切含まない。
export function emptyRegistry() {
  return { spec: REGISTRY_SPEC, updated_at: null, keys: {}, documents: {} };
}

export async function loadRegistry(source) {
  if (!source) return { registry: null, error: null };
  try {
    if (/^https?:\/\//.test(source)) {
      const r = await fetch(source, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { registry: validate(await r.json()), error: null };
    }
    return { registry: validate(JSON.parse(readFileSync(source, 'utf8'))), error: null };
  } catch (e) {
    return { registry: null, error: e.message };
  }
}

function validate(reg) {
  if (reg?.spec !== REGISTRY_SPEC) throw new Error(`unknown registry spec: ${reg?.spec}`);
  return reg;
}

export function readRegistryFile(path) {
  return validate(JSON.parse(readFileSync(path, 'utf8')));
}

export function saveRegistry(path, reg) {
  reg.updated_at = new Date().toISOString();
  writeFileSync(path, JSON.stringify(reg, null, 2) + '\n');
}
