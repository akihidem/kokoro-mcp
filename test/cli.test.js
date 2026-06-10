import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIN, FIXTURE, makeSigned, tmp } from './helpers.js';

function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', ...opts });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('keygen が鍵ペアを生成する', () => {
  const dir = tmp();
  const r = run(['keygen', '--out-dir', dir]);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes('key_id'));
  const files = readdirSync(dir);
  assert.ok(files.some((f) => f.endsWith('.private.pem')));
  assert.ok(files.some((f) => f.endsWith('.public.pem')));
});

test('sign → verify → render の正常系フロー', () => {
  const keyDir = tmp();
  run(['keygen', '--out-dir', keyDir]);
  const priv = join(keyDir, readdirSync(keyDir).find((f) => f.endsWith('.private.pem')));

  const dir = tmp();
  const file = join(dir, 'kokoro.md');
  writeFileSync(file, FIXTURE);

  const s = run(['sign', file, '--key', priv]);
  assert.equal(s.code, 0, s.err);
  assert.ok(existsSync(file + '.akashi.json'));

  const v = run(['verify', file]);
  assert.equal(v.code, 0, v.out + v.err);
  assert.ok(v.out.includes('流通可否  : OK'));

  const j = JSON.parse(run(['verify', file, '--json']).out);
  assert.equal(j.servable, true);
  assert.equal(j.verification.status, 'verified');

  const rend = run(['render', file]);
  assert.equal(rend.code, 0);
  assert.ok(rend.out.startsWith('<!-- kokoro-mcp'));
  assert.equal(run(['render', file, '--no-banner']).out, FIXTURE);

  const st = run(['status', file]);
  assert.equal(st.code, 0);
  assert.ok(st.out.includes('流通: OK'));
});

test('改ざんされたファイルは verify が落ちる', () => {
  const dir = tmp();
  const { file } = makeSigned(dir);
  writeFileSync(file, FIXTURE.replace('結論を先に', '結論を後に'));
  const v = run(['verify', file]);
  assert.equal(v.code, 1);
  assert.ok(v.out.includes('invalid-signature'));
});

test('レジストリ失効で配信停止（--allow-unsigned でも不可）', () => {
  const dir = tmp();
  const { file, sidecar } = makeSigned(dir);
  const reg = join(dir, 'registry.json');
  assert.equal(run(['registry', 'init', reg]).code, 0);
  assert.equal(run(['registry', 'revoke-key', reg, sidecar.key_id, '--reason', 'テスト失効']).code, 0);

  const v = run(['verify', file, '--registry', reg]);
  assert.equal(v.code, 1);
  assert.ok(v.out.includes('revoked-key'));

  const r = run(['render', file, '--registry', reg, '--allow-unsigned']);
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
});

test('revoke-doc で文書単位の撤回が執行される', () => {
  const dir = tmp();
  const { file, sidecar } = makeSigned(dir);
  const reg = join(dir, 'registry.json');
  run(['registry', 'init', reg]);
  run(['registry', 'add-key', reg, sidecar.key_id]);
  run(['registry', 'revoke-doc', reg, sidecar.canonical_sha256, '--reason', '本人撤回']);
  const j = JSON.parse(run(['verify', file, '--registry', reg, '--json']).out);
  assert.equal(j.verification.status, 'revoked-document');
  assert.equal(j.servable, false);
});

test('未署名: 既定は拒否、--allow-unsigned で配信可', () => {
  const dir = tmp();
  const file = join(dir, 'kokoro.md');
  writeFileSync(file, FIXTURE);
  assert.equal(run(['render', file]).code, 2);
  const r = run(['render', file, '--allow-unsigned', '--no-banner']);
  assert.equal(r.code, 0);
  assert.equal(r.out, FIXTURE);
});

test('§10.3: consent なしスケルトンは clinical で配信不可・self では lint 通過', () => {
  const dir = tmp();
  const file = join(dir, 'kokoro.md');
  assert.equal(run(['init', file]).code, 0);
  assert.equal(run(['lint', file]).code, 1); // consent_obtained: false
  assert.equal(run(['lint', file, '--policy', 'self']).code, 0);
  assert.equal(run(['render', file, '--allow-unsigned']).code, 2); // clinical では流通禁止
  assert.equal(run(['render', file, '--allow-unsigned', '--policy', 'self']).code, 0);
});

test('sign は未承認草案・lint エラーを拒否する（--force で誤検知回避可）', () => {
  const keyDir = tmp();
  run(['keygen', '--out-dir', keyDir]);
  const priv = join(keyDir, readdirSync(keyDir).find((f) => f.endsWith('.private.pem')));

  const dir = tmp();
  const drafted = join(dir, 'drafted.md');
  writeFileSync(drafted, FIXTURE.replace('reviewed_by: T.S.', 'reviewed_by: ai_drafted_unreviewed'));
  const s1 = run(['sign', drafted, '--key', priv]);
  assert.equal(s1.code, 1);
  assert.ok(s1.err.includes('ai_drafted_unreviewed'));

  const flagged = join(dir, 'flagged.md');
  writeFileSync(flagged, FIXTURE.replace('- 手順が', '- F84.0 の傾向があり、手順が'));
  assert.equal(run(['sign', flagged, '--key', priv]).code, 1);
  assert.equal(run(['sign', flagged, '--key', priv, '--force']).code, 0);
});

test('存在しない明示パスは exit 3', () => {
  const r = run(['verify', '/nonexistent/kokoro.md']);
  assert.equal(r.code, 3);
});
