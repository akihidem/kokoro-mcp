import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { keygen, signDocument, verifyDocument } from './akashi.js';
import { assess, banner, statusJson } from './assess.js';
import { loadKokoro, resolveKokoroFile } from './kokoro.js';
import { lintKokoro } from './lint.js';
import { startMcpServer } from './mcp.js';
import { emptyRegistry, readRegistryFile, saveRegistry } from './registry.js';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const USAGE = `kokoro-mcp v${VERSION} — kokoro.md の署名・検証・配信（akashi 信頼層 + MCP サーバ）

使い方:
  kokoro-mcp init [FILE]                         kokoro.md スケルトンを生成（fail-closed: consent_obtained: false）
  kokoro-mcp keygen [--out-dir DIR] [--alias X]  Ed25519 鍵ペアを生成（心理師の署名鍵）
  kokoro-mcp sign [FILE] --key PRIVATE.pem       承認済み kokoro.md に署名 → FILE.akashi.json
  kokoro-mcp verify [FILE] [--json]              署名・失効・流通可否を検証
  kokoro-mcp lint [FILE] [--summary FILE]        SPEC §3.1 / §7 / §9 / §10.3 の機械検証
  kokoro-mcp status [FILE]                       1 行ステータス
  kokoro-mcp render [FILE]                       検証済み全文を stdout へ（SessionStart hook 用）
  kokoro-mcp serve [--file FILE]                 MCP サーバ起動（stdio）
  kokoro-mcp registry init PATH                  失効レジストリを作成
  kokoro-mcp registry add-key PATH KEY_ID [--owner X]
  kokoro-mcp registry revoke-key PATH KEY_ID [--reason X]
  kokoro-mcp registry revoke-doc PATH SHA256 [--reason X]   文書単位の失効（= 撤回・削除権の執行）

共通オプション:
  --policy clinical|self   流通ポリシー（既定 clinical = SPEC §10.3 完全適用。self = 本人専用ファイル向け）
  --registry SRC           akashi レジストリのパス / URL（$KOKORO_REGISTRY でも可）
  --allow-unsigned         未署名の配信を許可（検証失敗・失効は許可されない）

ファイル解決順: 引数 > $KOKORO_FILE > ./kokoro.md > ~/.kokoro/kokoro.md
lint・CLI は補助であり、心理師承認をバイパスしない（SPEC §13.4 HARD）。
`;

function parse(argv, extra = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      file: { type: 'string' },
      registry: { type: 'string' },
      policy: { type: 'string', default: 'clinical' },
      'allow-unsigned': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      ...extra,
    },
  });
  if (!['clinical', 'self'].includes(values.policy)) {
    throw new Error(`--policy は clinical | self（指定値: ${values.policy}）`);
  }
  return { values, positionals };
}

function assessOpts(values, positionals) {
  return {
    file: positionals[0] ?? values.file,
    registry: values.registry,
    policy: values.policy,
    allowUnsigned: values['allow-unsigned'],
  };
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'init':
      return cmdInit(rest);
    case 'keygen':
      return cmdKeygen(rest);
    case 'sign':
      return cmdSign(rest);
    case 'verify':
      return cmdVerify(rest);
    case 'lint':
      return cmdLint(rest);
    case 'status':
      return cmdStatus(rest);
    case 'render':
      return cmdRender(rest);
    case 'serve':
      return cmdServe(rest);
    case 'registry':
      return cmdRegistry(rest);
    case '--version':
    case 'version':
      console.log(VERSION);
      return 0;
    default:
      console.log(USAGE);
      return cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0;
  }
}

function cmdKeygen(argv) {
  const { values } = parse(argv, { 'out-dir': { type: 'string' }, alias: { type: 'string' } });
  const dir = values['out-dir'] ?? join(homedir(), '.kokoro', 'keys');
  mkdirSync(dir, { recursive: true });
  const k = keygen();
  const priv = join(dir, `akashi-${k.keyId}.private.pem`);
  const pub = join(dir, `akashi-${k.keyId}.public.pem`);
  writeFileSync(priv, k.privatePem);
  chmodSync(priv, 0o600);
  writeFileSync(pub, k.publicPem);
  console.log(`鍵ペアを生成しました${values.alias ? `（alias: ${values.alias}）` : ''}`);
  console.log(`  key_id : ${k.keyId}`);
  console.log(`  private: ${priv}（厳重保管・共有禁止）`);
  console.log(`  public : ${pub}`);
  return 0;
}

function cmdSign(argv) {
  const { values, positionals } = parse(argv, {
    key: { type: 'string' },
    alias: { type: 'string' },
    role: { type: 'string', default: 'certified-psychologist' },
    'expires-days': { type: 'string' },
  });
  if (!values.key) throw new Error('--key PRIVATE.pem が必要です');
  const path = resolveKokoroFile(positionals[0] ?? values.file);
  if (!path) throw new Error('署名対象の kokoro.md が見つかりません');
  const doc = loadKokoro(path);

  if (doc.meta?.reviewed_by === 'ai_drafted_unreviewed') {
    console.error('署名できません: reviewed_by: ai_drafted_unreviewed — 心理師レビュー後に reviewed_by を承認者イニシャルへ更新してください（§10.3）');
    return 1;
  }
  const lint = lintKokoro(doc, { policy: values.policy });
  if (lint.errors.length && !values.force) {
    console.error('署名できません: lint エラーがあります（誤検知の場合は --force）');
    for (const e of lint.errors) console.error(`  ✗ ${e}`);
    return 1;
  }
  for (const w of lint.warnings) console.error(`  ⚠ ${w}`);

  const privatePem = readFileSync(values.key, 'utf8');
  const expiresAt = values['expires-days']
    ? new Date(Date.now() + Number(values['expires-days']) * 86400_000).toISOString()
    : null;
  const sidecar = signDocument(doc.text, privatePem, {
    target: basename(path),
    alias: values.alias ?? doc.meta?.reviewed_by ?? doc.meta?.psychologist ?? null,
    role: values.role,
    kokoroVersion: doc.meta?.version ?? null,
    expiresAt,
    registry: values.registry ?? null,
  });
  const check = verifyDocument(doc.text, sidecar);
  if (!check.ok) throw new Error(`自己検証に失敗しました: ${check.status}`);
  const out = path + '.akashi.json';
  writeFileSync(out, JSON.stringify(sidecar, null, 2) + '\n');
  console.log('署名しました');
  console.log(`  sidecar  : ${out}`);
  console.log(`  key_id   : ${sidecar.key_id}`);
  console.log(`  sha256   : ${sidecar.canonical_sha256}`);
  console.log(`  version  : ${sidecar.kokoro_version ?? '-'}`);
  console.log(`  expires  : ${sidecar.expires_at ?? 'なし'}`);
  return 0;
}

async function cmdVerify(argv) {
  const { values, positionals } = parse(argv);
  const a = await assess(assessOpts(values, positionals));
  if (values.json) {
    console.log(JSON.stringify(statusJson(a), null, 2));
  } else {
    if (!a.exists) {
      console.error(a.refusals[0]);
      return 3;
    }
    const v = a.verification;
    console.log(`ファイル  : ${a.path}`);
    console.log(`署名      : ${v.status}${v.key_id ? ` (key ${v.key_id}, signed ${v.signed_at})` : ''}`);
    console.log(`ポリシー  : ${a.policy}`);
    console.log(`流通可否  : ${a.servable ? 'OK' : '不可'}`);
    for (const w of v.warnings ?? []) console.log(`  ⚠ ${w}`);
    for (const r of a.refusals) console.log(`  ✗ ${r}`);
  }
  if (!a.exists) return 3;
  if (a.servable) return 0;
  return a.verification.ok || a.verification.status === 'unsigned' ? 2 : 1;
}

function cmdLint(argv) {
  const { values, positionals } = parse(argv, { summary: { type: 'string' } });
  const path = resolveKokoroFile(positionals[0] ?? values.file);
  if (!path) {
    console.error('kokoro.md が見つかりません');
    return 3;
  }
  const doc = loadKokoro(path);
  let summaryText = null;
  const summaryPath = values.summary ?? join(dirname(path), 'kokoro.summary.md');
  if (existsSync(summaryPath)) summaryText = readFileSync(summaryPath, 'utf8');
  const r = lintKokoro(doc, { policy: values.policy, summaryText });
  for (const e of r.errors) console.log(`✗ ${e}`);
  for (const w of r.warnings) console.log(`⚠ ${w}`);
  console.log(r.ok ? `OK（warnings: ${r.warnings.length}）` : `NG（errors: ${r.errors.length} / warnings: ${r.warnings.length}）`);
  return r.ok ? 0 : 1;
}

async function cmdStatus(argv) {
  const { values, positionals } = parse(argv);
  const a = await assess(assessOpts(values, positionals));
  if (!a.exists) {
    console.error('kokoro.md が見つかりません');
    return 3;
  }
  const m = a.doc.meta ?? {};
  const v = a.verification;
  const parts = [
    basename(a.path),
    m.version ? `v${m.version}` : 'frontmatter なし',
    m.mode ? `mode=${m.mode}` : null,
    `署名: ${v.status}${v.key_id ? ` (key ${v.key_id})` : ''}`,
    `流通: ${a.servable ? 'OK' : '不可'}`,
    m.next_review ? `次回レビュー ${m.next_review}` : null,
  ].filter(Boolean);
  console.log(parts.join(' | '));
  return a.servable ? 0 : 2;
}

async function cmdRender(argv) {
  const { values, positionals } = parse(argv, {
    'no-banner': { type: 'boolean', default: false },
    'body-only': { type: 'boolean', default: false },
    'quiet-missing': { type: 'boolean', default: false },
  });
  const a = await assess(assessOpts(values, positionals));
  if (!a.exists) {
    if (values['quiet-missing']) return 0;
    console.error(a.refusals[0]);
    return 3;
  }
  if (!a.servable) {
    console.error(`kokoro.md は配信できません:`);
    for (const r of a.refusals) console.error(`  ✗ ${r}`);
    return 2;
  }
  const content = values['body-only'] ? a.doc.body.replace(/^\n+/, '') : a.doc.text;
  process.stdout.write(values['no-banner'] ? content : `${banner(a, VERSION)}\n${content}`);
  return 0;
}

function cmdServe(argv) {
  const { values, positionals } = parse(argv);
  startMcpServer({ ...assessOpts(values, positionals), version: VERSION });
  return new Promise(() => {}); // stdio が閉じるまで常駐
}

function cmdRegistry(argv) {
  const { values, positionals } = parse(argv, {
    owner: { type: 'string' },
    reason: { type: 'string' },
  });
  const [sub, path, target] = positionals;
  if (!sub || !path) throw new Error('使い方: kokoro-mcp registry <init|add-key|revoke-key|revoke-doc> PATH [KEY_ID|SHA256]');
  const now = () => new Date().toISOString();
  switch (sub) {
    case 'init': {
      if (existsSync(path)) throw new Error(`${path} は既に存在します`);
      saveRegistry(path, emptyRegistry());
      console.log(`レジストリを作成しました: ${path}`);
      return 0;
    }
    case 'add-key': {
      if (!target) throw new Error('KEY_ID が必要です');
      const reg = readRegistryFile(path);
      reg.keys[target] = { status: 'valid', owner: values.owner ?? null, added_at: now() };
      saveRegistry(path, reg);
      console.log(`key ${target} を valid として登録しました`);
      return 0;
    }
    case 'revoke-key': {
      if (!target) throw new Error('KEY_ID が必要です');
      const reg = readRegistryFile(path);
      reg.keys[target] = { ...(reg.keys[target] ?? {}), status: 'revoked', revokedAt: now(), reason: values.reason ?? null };
      saveRegistry(path, reg);
      console.log(`key ${target} を失効させました`);
      return 0;
    }
    case 'revoke-doc': {
      if (!target) throw new Error('SHA256 が必要です');
      const reg = readRegistryFile(path);
      reg.documents[target] = { status: 'revoked', revokedAt: now(), reason: values.reason ?? null };
      saveRegistry(path, reg);
      console.log(`document ${target.slice(0, 16)}… を失効させました（撤回・削除権の執行）`);
      return 0;
    }
    default:
      throw new Error(`不明なサブコマンド: ${sub}`);
  }
}

function cmdInit(argv) {
  const { positionals } = parse(argv);
  const target = resolve(positionals[0] ?? './kokoro.md');
  if (existsSync(target)) throw new Error(`${target} は既に存在します`);
  const today = new Date().toISOString().slice(0, 10);
  const nextReview = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, template(today, nextReview));
  console.log(`スケルトンを生成しました: ${target}`);
  console.log('');
  console.log('次の手順（SPEC §10.1 IC 取得手順）:');
  console.log('  1. 心理師がユーザと内容を作成・確認する');
  console.log('  2. 同意取得後に consent_obtained: true / consent_date を記録する');
  console.log('  3. reviewed_by を承認者イニシャルに更新する');
  console.log('  4. kokoro-mcp lint で検証し、kokoro-mcp sign --key ... で署名する');
  console.log('※ consent_obtained: false のままでは配信されません（fail-closed）');
  return 0;
}

function template(today, nextReview) {
  return `---
format_version: kokoro/0.2-draft
version: 0.1.0
mode: clinical
updated_at: ${today}
next_review: ${nextReview}
psychologist: X.X.
reviewed_by: user_self_edited
attending_physician_consulted: n_a
user_alias: user_x
language: ja
intended_models: [claude, chatgpt, gemini, copilot]
consent_obtained: false
consent_date: null
consent_revocation_contact: null
not_a_diagnosis: true
signature_hash: null
---

## AI に伝える境界線

- （緊急時の誘導をここに。例: 深刻な体調・気分の相談になったときは、AI だけで抱えず○○へ相談するよう促す）

## 私について（AI が知っておくと助かる範囲）

- （生活・仕事の文脈を、固有名詞を避けて）

## 強み・関心

- （得意なこと・好きなこと）

## 応答スタイルの希望

- （例: 結論を先に。1 回の返答は短く区切る）

## 配慮してほしいこと（DO / DON'T）

- DO: （してほしいこと）
- DON'T: （しないでほしいこと）

## 苦手なこと・反応しやすいこと

- （負荷がかかりやすい状況を、症状名ではなく機能への影響で書く — §6.6）

## 現在のフォーカス（時限的）

- （期限つきの目標・状況）

## 改訂履歴

- 0.1.0 (${today}): スケルトン生成。
`;
}
