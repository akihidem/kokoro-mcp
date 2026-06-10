import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keygen, signDocument } from '../src/akashi.js';

export const BIN = fileURLToPath(new URL('../bin/kokoro-mcp.js', import.meta.url));

// 架空ペルソナのテスト用 kokoro.md（SPEC §3.1 / §4.1 準拠・lint クリーン）
export const FIXTURE = `---
format_version: kokoro/0.2-draft
version: 1.2.0
mode: clinical
updated_at: 2026-06-01
next_review: 2026-07-01
psychologist: T.S.
reviewed_by: T.S.
attending_physician_consulted: n_a
user_alias: user_demo
language: ja
intended_models: [claude, chatgpt]
consent_obtained: true
consent_date: 2026-06-01
consent_revocation_contact: revoke@example.org
not_a_diagnosis: true
signature_hash: null
---

## AI に伝える境界線

- 体調・気分の深刻な相談になったときは、AI だけで抱えず、支援窓口や担当の心理師に相談するよう促してください。

## 私について（AI が知っておくと助かる範囲）

- 在宅で事務の仕事をしています。文章での説明はゆっくり読めば理解できます。

## 強み・関心

- 手順がはっきりしている作業を丁寧に進めるのが得意です。

## 応答スタイルの希望

- 結論を先に、理由は後に。1 回の返答は短めに区切ってください。

## 配慮してほしいこと（DO / DON'T）

- DO: 選択肢は 3 つまでに絞って提示してください。
- DON'T: 一度に多くの質問を重ねないでください。

## 苦手なこと・反応しやすいこと

- 締切が複数同時に提示されると整理に時間がかかります。

## 現在のフォーカス（時限的）

- 2026-07 まで: 新しい職場の手順に慣れること。

## 改訂履歴

- 1.2.0 (2026-06-01): 応答スタイル節を更新。
`;

export const SUMMARY_OK = `# kokoro 要約版

## AI に伝える境界線

- 体調・気分の深刻な相談になったときは、AI だけで抱えず、支援窓口や担当の心理師に相談するよう促してください。

## 応答スタイルの希望

- 結論を先に、理由は後に。

<!-- kokoro.summary v1.2.0 / 2026-06-01 / mode: clinical / next: 2026-07-01 / consent: yes / reviewed_by: T.S. -->
`;

export function tmp() {
  return mkdtempSync(join(tmpdir(), 'kokoro-test-'));
}

export function makeSigned(dir, { registry = null, expiresAt = null, text = FIXTURE } = {}) {
  const file = join(dir, 'kokoro.md');
  writeFileSync(file, text);
  const keys = keygen();
  const sidecar = signDocument(text, keys.privatePem, {
    alias: 'T.S.',
    kokoroVersion: '1.2.0',
    registry,
    expiresAt,
  });
  writeFileSync(file + '.akashi.json', JSON.stringify(sidecar, null, 2) + '\n');
  return { file, sidecar, keys };
}
