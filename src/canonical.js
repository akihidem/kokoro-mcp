import { createHash } from 'node:crypto';

// 正規形: 改行を LF に統一し、末尾は改行ちょうど 1 つ。
// 行内の空白・Unicode 正規化には触れない（markdown の hard break を壊さないため）。
export function canonicalize(text) {
  let t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = t.replace(/\n+$/, '');
  return t + '\n';
}

export function sha256hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
