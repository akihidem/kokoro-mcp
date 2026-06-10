import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';

// KOKORO SPEC §3.1 必須メタデータ
export const REQUIRED_KEYS = [
  'format_version',
  'version',
  'mode',
  'updated_at',
  'next_review',
  'psychologist',
  'reviewed_by',
  'attending_physician_consulted',
  'user_alias',
  'language',
  'consent_obtained',
  'consent_date',
  'consent_revocation_contact',
  'not_a_diagnosis',
];

export function resolveKokoroFile(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null; // 明示指定はフォールバックしない
  const candidates = [
    process.env.KOKORO_FILE,
    join(process.cwd(), 'kokoro.md'),
    join(homedir(), '.kokoro', 'kokoro.md'),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export function loadKokoro(path) {
  const text = readFileSync(path, 'utf8');
  const { meta, body } = parseFrontmatter(text);
  return { path, text, meta, body, sections: parseSections(body) };
}

export function parseSections(body) {
  const sections = [];
  let current = null;
  for (const line of body.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = { title: h[1], lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map((s) => ({ title: s.title, body: s.lines.join('\n').trim() }));
}

const BOUNDARY_RE = /境界線|boundar/i;
const CARE_RE = /配慮|DO\s*\/\s*DON/i;

// Safety Interop Profile: 境界線（§4.1 #1）と配慮 DO/DON'T（§4.1 #5）のみの最小サブセット。
// ベンダが安全ルーティングに使える、本文全文より狭い開示単位。
export function safetyProfile(doc) {
  const picked = doc.sections.filter((s) => BOUNDARY_RE.test(s.title) || CARE_RE.test(s.title));
  if (!picked.length) return null;
  return picked.map((s) => `## ${s.title}\n\n${s.body}`).join('\n\n');
}

// SPEC §10.3 流通禁止条件 + §3.1 スキーマの機械的強制。
// policy:
//   clinical … SPEC 完全適用（既定・fail-closed）。臨床交付物に使う。
//   self     … 本人が本人のために書いた self-use ファイル向け。同意は本人に内在するため
//              consent ゲートとスキーマ必須化を外す。ai_drafted_unreviewed の流通禁止だけは維持。
export function distributionCheck(meta, { policy = 'clinical' } = {}) {
  const violations = [];
  if (!meta) {
    violations.push('YAML frontmatter がありません（§3.1 必須）');
    return { allowed: policy === 'self', violations };
  }
  if (meta.reviewed_by === 'ai_drafted_unreviewed') {
    violations.push('reviewed_by: ai_drafted_unreviewed — 心理師未承認の AI 草案は流通禁止（§10.3 / §7.1）');
    return { allowed: false, violations };
  }
  if (policy === 'clinical') {
    for (const k of REQUIRED_KEYS) {
      if (meta[k] === undefined) violations.push(`必須メタデータ欠落: ${k}（§3.1）`);
    }
    if (meta.consent_obtained !== undefined && meta.consent_obtained !== true) {
      violations.push('consent_obtained が true ではありません — 同意なき kokoro.md は流通禁止（§10.3）');
    }
    if (meta.not_a_diagnosis !== undefined && meta.not_a_diagnosis !== true) {
      violations.push('not_a_diagnosis: true がありません（§1.2 HARD）');
    }
    if (meta.mode === 'continuous_support' && meta.next_clinical_review === undefined) {
      violations.push('mode=continuous_support では next_clinical_review が必須（§3.1）');
    }
  }
  return { allowed: violations.length === 0, violations };
}
