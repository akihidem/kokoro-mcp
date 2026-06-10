import { distributionCheck } from './kokoro.js';

// SPEC §7.1 コア HARD（検出時 error）。正規表現は補助であり、心理師確認を代替しない（§13.4）。
const CORE_HARD = [
  [/\bF\d{2}(\.\d{1,2})?\b(?!\s*キー)/, 'ICD コード様の文字列 — 診断名・コードはコア HARD 禁止（§7.1）'],
  [/\b(29\d|3[01]\d)\.\d{1,2}\b/, 'DSM コード様の数値（§7.1）'],
  [/\b(FSIQ|VIQ|PIQ|VCI|PRI|WMI|PSI|FRI|VSI|IQ)\b\s*[:=：]?\s*\d{2,3}/, '検査素点・指数様の数値（§7.1）'],
  [/(セーフティ|safety|ガードレール|guardrail|安全(機構|装置)).{0,24}(無効|無視|解除|上書き|オフ|バイパス)/i, 'AI セーフティ機構の上書き・無効化指示（§7.1）'],
  [/ignore\s+(all\s+|previous\s+|prior\s+)?(instructions|rules|guidelines|safety)/i, 'セーフティ上書き指示（§7.1）'],
];

// SPEC §7.2 拡張 HARD（検出時 warning — 心理師判断で適用）
const EXTENDED_HARD = [
  [
    /(ADHD|ASD|自閉症|アスペルガー|うつ病|双極性障害|統合失調症|発達障害|パーソナリティ障害|PTSD|強迫性障害|パニック障害|不安障害)/,
    '病理的生ラベルの可能性（§7.2）— §6.6「症状→機能影響→行動指示」への翻訳を検討',
  ],
  [/あなたは.{0,12}(医師|医者|セラピスト|カウンセラー|心理師|心理士|主治医)(として|です)/, '役割演技指示の可能性（§7.2 role-play jailbreak 回避）'],
  [/you are (a |an )?(doctor|physician|therapist|counselor|psychiatrist)/i, '役割演技指示の可能性（§7.2）'],
];

export function lintKokoro(doc, { policy = 'clinical', summaryText = null } = {}) {
  const errors = [];
  const warnings = [];

  const dist = distributionCheck(doc.meta, { policy });
  (dist.allowed ? warnings : errors).push(...dist.violations);

  const lines = doc.body.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*<!--/.test(line)) return; // 心理師メモ（§7.2 推奨の HTML コメント）は対象外
    for (const [re, msg] of CORE_HARD) if (re.test(line)) errors.push(`L${i + 1}: ${msg}`);
    for (const [re, msg] of EXTENDED_HARD) if (re.test(line)) warnings.push(`L${i + 1}: ${msg}`);
  });

  const chars = doc.body.replace(/\s/g, '').length;
  if (chars > 4000) warnings.push(`フル版 ${chars} 字 — 4000 字目安超過（§2 context rot 対策）`);
  if (lines.length > 120) warnings.push(`フル版 ${lines.length} 行 — 120 行目安超過（§2）`);

  if (!doc.sections.some((s) => /境界線/.test(s.title))) {
    (policy === 'clinical' ? errors : warnings).push('「AI に伝える境界線」セクションがありません（§4.1 必須・冒頭配置推奨）');
  }

  if (summaryText != null) checkSummary(doc, summaryText, errors);

  return { errors, warnings, ok: errors.length === 0 };
}

// SPEC §9 整合性ルール: version 一致・境界線の逐語コピー（§5 HARD）
function checkSummary(doc, summaryText, errors) {
  const footer = /<!--\s*kokoro\.summary\s+v([^\s/]+)\s*\/.*-->/.exec(summaryText);
  if (!footer) {
    errors.push('要約版: footer 行（<!-- kokoro.summary vX.Y.Z / ... -->）がありません（§3.2）');
  } else if (doc.meta?.version && footer[1] !== String(doc.meta.version)) {
    errors.push(`要約版: version 不一致 full=${doc.meta.version} summary=${footer[1]}（§9）`);
  }
  const boundary = doc.sections.find((s) => /境界線/.test(s.title));
  if (boundary) {
    const norm = (t) => t.replace(/\s+/g, ' ').trim();
    if (!norm(summaryText).includes(norm(boundary.body))) {
      errors.push('要約版: 「AI に伝える境界線」が逐語コピーされていません（§5 HARD / §9）');
    }
  }
}
