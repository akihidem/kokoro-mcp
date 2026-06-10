# [Issue 草案] akashi 信頼層: §3.1 signature_hash 必須化と §10.2 撤回執行の実装提案

> **このファイルは akihidem/KOKORO リポジトリに起票する Issue の草案**（設計記録の外部化用）。
> 起票はレビュー後に手動で行う。

## 提案の要旨

SPEC v0.2-draft が予告している 2 点 — §3.1 `signature_hash` の必須化、§13.4 reference CLI — について、
動く実装（[kokoro-mcp](https://github.com/akihidem/kokoro-mcp)）を伴う仕様提案を行う。

1. **署名は frontmatter 埋め込みではなく detached sidecar** `<file>.akashi.json`（Ed25519）
   - 自己参照問題（署名対象に署名自身が含まれる）の回避
   - `signature_hash` フィールドは `null` のまま据え置き、sidecar を規範キャリアとする
2. **失効レジストリ** `akashi-registry/0.1`（静的 JSON 1 枚）
   - `revoke-doc` = 本人撤回（§10.2）の即時技術執行。30 日以内削除義務を「流通済み copy の配信停止」で補強
   - `revoke-key` = 鍵漏洩・資格喪失時の一括無効化
   - 公開されるのは key_id / 文書ハッシュ / ステータスのみ（原本非流通の原則を信頼層にも適用）
3. **ローダー実装要件の明文化**（新節 or §10.3 追記）
   - 「§10.3 流通禁止条件を満たさない kokoro.md を AI に注入してはならない」
   - `consent_obtained: false`・`ai_drafted_unreviewed`・失効・改ざんは fail-closed

## なぜ今か

- ベンダメモリ（ChatGPT / Claude / Gemini）は推測ベースの暗黙プロファイルを蓄積する。
  署名付き kokoro.md は「**同意され、専門職が承認した自己開示**」を暗黙プロファイルから技術的に区別可能にする唯一の手段
- §12.4 reconciliation（v0.2 詳細化予定）は「どちらが正か」の判定基盤を必要とする。署名がその基盤になる
- 規制動向（ライセンス保持者の review and approve 必須化、research/07 §4）に対し、
  「承認の存在」を検証可能な形で示せることは規格の採用要件になる

## 実装ステータス（kokoro-mcp v0.1.0）

- Ed25519 署名 / 検証 / 失効（zero-dependency, Node 20+）
- §3.1 スキーマ検証・§7 禁止情報ヒューリスティック lint・§9 整合性検査・§10.3 強制
- MCP サーバ（get_kokoro_context / get_safety_profile / check_kokoro_status）
- SessionStart hook 用 render
- テスト 47 件（署名ラウンドトリップ・改ざん・失効・MCP プロトコル e2e）

## 議論したい点

1. sidecar 方式の採否（vs frontmatter 埋め込み + 署名対象から該当行を除外する方式）
2. レジストリの運営主体とガバナンス（§13.5 open-core との関係、複数レジストリ許容の是非）
3. `expires_at` と `next_review` の連動を SPEC 推奨にするか
4. self-use（臨床交付物ではない本人作成ファイル）の扱いを SPEC スコープに含めるか
