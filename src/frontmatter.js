// KOKORO SPEC §3.1 の frontmatter はフラットな key: value（+ インラインリスト）のみなので、
// YAML 全文法ではなく必要十分なサブセットを依存ゼロで実装する。

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return { meta: null, body: text, raw: null };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    meta[kv[1]] = parseValue(stripComment(kv[2]));
  }
  return { meta, body: text.slice(m[0].length), raw: m[1] };
}

function stripComment(v) {
  if (v.startsWith('"') || v.startsWith("'")) return v.trim();
  const i = v.search(/\s#/);
  return (i >= 0 ? v.slice(0, i) : v).trim();
}

function parseValue(v) {
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map((s) => unquote(s.trim())) : [];
  }
  return unquote(v);
}

function unquote(v) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}
