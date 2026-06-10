import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, sha256hex } from '../src/canonical.js';

test('CRLF と LF は同一の正規形になる', () => {
  assert.equal(canonicalize('a\r\nb\r\n'), canonicalize('a\nb\n'));
  assert.equal(sha256hex(canonicalize('a\r\nb')), sha256hex(canonicalize('a\nb')));
});

test('末尾改行は 1 つに正規化され、冪等', () => {
  assert.equal(canonicalize('a\n\n\n'), 'a\n');
  assert.equal(canonicalize('a'), 'a\n');
  const once = canonicalize('x\r\ny\n\n');
  assert.equal(canonicalize(once), once);
});

test('行内の空白は保持される（markdown hard break を壊さない）', () => {
  assert.equal(canonicalize('a  \nb\n'), 'a  \nb\n');
});
