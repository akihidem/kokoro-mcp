import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../src/frontmatter.js';
import { FIXTURE } from './helpers.js';

test('SPEC §3.1 形式の frontmatter を読める', () => {
  const { meta, body } = parseFrontmatter(FIXTURE);
  assert.equal(meta.version, '1.2.0');
  assert.equal(meta.consent_obtained, true);
  assert.equal(meta.not_a_diagnosis, true);
  assert.equal(meta.signature_hash, null);
  assert.deepEqual(meta.intended_models, ['claude', 'chatgpt']);
  assert.ok(body.startsWith('\n## AI に伝える境界線'));
});

test('行内コメントを除去する', () => {
  const { meta } = parseFrontmatter('---\npsychologist: K.M.   # イニシャルのみ\nmode: clinical\n---\nbody');
  assert.equal(meta.psychologist, 'K.M.');
  assert.equal(meta.mode, 'clinical');
});

test('frontmatter がない場合は meta: null', () => {
  const { meta, body } = parseFrontmatter('# 見出しだけ\n');
  assert.equal(meta, null);
  assert.equal(body, '# 見出しだけ\n');
});

test('UTF-8 BOM 付きでも frontmatter を読める', () => {
  const { meta, body } = parseFrontmatter('﻿---\nversion: 1.0.0\nconsent_obtained: true\n---\n\n## 本文\n');
  assert.equal(meta.version, '1.0.0');
  assert.equal(meta.consent_obtained, true);
  assert.equal(body, '\n## 本文\n');
});
