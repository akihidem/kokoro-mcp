import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../src/frontmatter.js';
import { distributionCheck, parseSections, safetyProfile } from '../src/kokoro.js';
import { FIXTURE } from './helpers.js';

const { meta, body } = parseFrontmatter(FIXTURE);
const doc = { meta, body, sections: parseSections(body) };

test('§4.1 の必須 8 セクション（任意節を除く）を読める', () => {
  assert.equal(doc.sections.length, 8);
  assert.equal(doc.sections[0].title, 'AI に伝える境界線');
});

test('safety profile は境界線と配慮 DO/DON\'T のみ', () => {
  const sp = safetyProfile(doc);
  assert.ok(sp.includes('境界線'));
  assert.ok(sp.includes("DON'T"));
  assert.ok(!sp.includes('強み・関心'));
});

test('§10.3: 準拠ファイルは clinical で流通可', () => {
  const r = distributionCheck(meta, { policy: 'clinical' });
  assert.equal(r.allowed, true);
  assert.deepEqual(r.violations, []);
});

test('§10.3: consent_obtained が true でなければ流通禁止', () => {
  const r = distributionCheck({ ...meta, consent_obtained: false }, { policy: 'clinical' });
  assert.equal(r.allowed, false);
  assert.ok(r.violations.some((v) => v.includes('consent_obtained')));
});

test('§10.3: ai_drafted_unreviewed は self ポリシーでも流通禁止', () => {
  for (const policy of ['clinical', 'self']) {
    const r = distributionCheck({ ...meta, reviewed_by: 'ai_drafted_unreviewed' }, { policy });
    assert.equal(r.allowed, false, policy);
  }
});

test('§3.1: 必須キー欠落を検出（clinical）', () => {
  const m = { ...meta };
  delete m.consent_revocation_contact;
  const r = distributionCheck(m, { policy: 'clinical' });
  assert.equal(r.allowed, false);
  assert.ok(r.violations.some((v) => v.includes('consent_revocation_contact')));
});

test('§3.1: continuous_support は next_clinical_review 必須', () => {
  const r = distributionCheck({ ...meta, mode: 'continuous_support' }, { policy: 'clinical' });
  assert.equal(r.allowed, false);
  assert.ok(r.violations.some((v) => v.includes('next_clinical_review')));
});

test('self ポリシーは本人専用ファイル（最小メタデータ）を許可', () => {
  const r = distributionCheck({ version: '0.3.0' }, { policy: 'self' });
  assert.equal(r.allowed, true);
});
