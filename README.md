# kokoro-mcp

> `kokoro.md` の署名・検証・配信を行う zero-dependency ローダー / MCP サーバ。
> [KOKORO SPEC](https://github.com/akihidem/KOKORO) §13.4（reference CLI）への提案実装 + **akashi 信頼層**（§3.1 `signature_hash` v0.2 必須化への具体案）。

**所見は心理師の手元に。流通するのは署名された翻訳だけ。失効した文書は AI に届かない。**

## 何をするか

KOKORO は「心理師の臨床的見立てを、所見原文を流通させずに `kokoro.md` として AI に渡す」規格である。
kokoro-mcp はその **消費側（AI に届く直前）** を担う：

```
心理師の原簿（非公開）
   │  翻訳・IC 取得（SPEC §10.1）
   ▼
kokoro.md ── sign ──▶ kokoro.md.akashi.json（Ed25519 署名 sidecar）
   │                        │
   │                akashi registry（公開されるのは key_id / 文書ハッシュの有効・失効のみ）
   ▼                        ▼
kokoro-mcp（検証: 署名・改ざん・期限・失効・§10.3 流通禁止条件）
   │
   ├─ serve   … MCP サーバとして Claude Code / MCP クライアントへ
   └─ render  … SessionStart hook などへの stdout 注入
```

- **fail-closed**: 同意なし（`consent_obtained: false`）・心理師未承認（`reviewed_by: ai_drafted_unreviewed`）・改ざん・失効は配信されない
- **失効 = 削除権の執行**: レジストリの `revoke-doc` 一発で、流通済みの `kokoro.md` が全ローダーで配信停止になる（SPEC §10.2 撤回 30 日義務の技術的補強）
- **レジストリは漏らさない**: 公開されるのはハッシュとステータスだけ。臨床情報・本人情報は構造上含まれない

## インストール

```bash
git clone https://github.com/akihidem/kokoro-mcp && cd kokoro-mcp
npm link        # または node bin/kokoro-mcp.js を直接実行
```

依存パッケージはゼロ（Node 20+ の標準ライブラリのみ）。`npm install` 不要。

## クイックスタート

```bash
# 1. 心理師: 署名鍵を生成
kokoro-mcp keygen --alias K.M.

# 2. スケルトンから kokoro.md を作成（IC 取得 → consent_obtained: true → reviewed_by 更新）
kokoro-mcp init ~/.kokoro/kokoro.md

# 3. 機械検証（SPEC §3.1 / §7 / §9 / §10.3）
kokoro-mcp lint ~/.kokoro/kokoro.md

# 4. 心理師: 承認した版に署名
kokoro-mcp sign ~/.kokoro/kokoro.md --key ~/.kokoro/keys/akashi-XXXX.private.pem

# 5. 検証・配信
kokoro-mcp verify ~/.kokoro/kokoro.md
kokoro-mcp status ~/.kokoro/kokoro.md
# → kokoro.md | v0.1.0 | mode=clinical | 署名: verified (key 3fa1…) | 流通: OK | 次回レビュー 2026-07-11
```

## MCP サーバとして使う

`.mcp.json`（または `claude mcp add`）:

```json
{
  "mcpServers": {
    "kokoro": {
      "command": "kokoro-mcp",
      "args": ["serve", "--file", "/home/you/.kokoro/kokoro.md"]
    }
  }
}
```

公開ツール:

| ツール | 返すもの |
|---|---|
| `get_kokoro_context` | 検証済み `kokoro.md` 全文（検証バナー付き） |
| `get_safety_profile` | **Safety Interop Profile** — 「AI に伝える境界線」+「配慮 DO/DON'T」のみの最小開示サブセット |
| `check_kokoro_status` | 検証状態 JSON（本文を含まない） |

リソース: `kokoro://context` / `kokoro://safety` / `kokoro://status`

## SessionStart hook として使う（Claude Code）

```bash
kokoro-mcp render ~/.kokoro/kokoro.md          # 検証バナー + 全文を stdout へ
kokoro-mcp render --policy self --allow-unsigned  # 本人専用ファイル（後述）
```

詳細: [docs/claude-code.md](./docs/claude-code.md)

## 流通ポリシー

| | `--policy clinical`（既定） | `--policy self` |
|---|---|---|
| 想定 | 心理師が交付した臨床版 | 本人が本人のために書いた self-use 版（jibun.md 等） |
| §3.1 スキーマ | 必須 | 警告のみ |
| `consent_obtained: true` | 必須（§10.3） | 不要（同意は本人に内在） |
| `ai_drafted_unreviewed` | **流通禁止** | **流通禁止**（共通） |
| 署名 | 既定で必須 | `--allow-unsigned` 併用を想定 |

`--allow-unsigned` は「署名がない」ことだけを許す。**検証失敗・期限切れ・失効は、どのポリシーでも配信されない。**

## 失効レジストリ（akashi registry）

```bash
kokoro-mcp registry init registry.json
kokoro-mcp registry add-key registry.json <KEY_ID> --owner K.M.
kokoro-mcp registry revoke-key registry.json <KEY_ID> --reason 鍵漏洩
kokoro-mcp registry revoke-doc registry.json <SHA256> --reason 本人撤回
```

`--registry` / `$KOKORO_REGISTRY` にローカルパスまたは HTTPS URL を指定。静的 JSON 1 枚なので、
GitHub Pages / Vercel にそのまま置ける（wazao-traceability の「原簿 → 公開フィルタ → 静的サイト」パターン）。

仕様: [docs/SPEC-AKASHI.md](./docs/SPEC-AKASHI.md)

## SPEC との対応

| KOKORO SPEC | kokoro-mcp |
|---|---|
| §3.1 必須メタデータ / `signature_hash` | スキーマ検証 / akashi sidecar（必須化の具体案） |
| §7.1 / §7.2 禁止情報 | `lint` の正規表現ヒューリスティック（**補助であり心理師確認を代替しない**） |
| §9 / §5 フル版↔要約版整合 | `lint --summary`（version 一致・境界線の逐語コピー検査） |
| §10.3 流通禁止条件 | `assess` が serve / render / verify の全経路で強制 |
| §10.2 撤回（30 日以内削除） | `registry revoke-doc` による即時配信停止 |
| §13.4 reference CLI HARD | 署名は心理師の行為として分離。CLI は承認をバイパスしない |

## テスト

```bash
npm test   # node --test（47 件: 正規化 / 署名 / 失効 / §10.3 / lint / CLI e2e / MCP プロトコル e2e）
```

## ロードマップ

- [x] KOKORO SPEC への upstream 提案 → [KOKORO#94](https://github.com/akihidem/KOKORO/issues/94)
- [ ] npm publish（alpha — 2FA OTP 認証待ち: `npm publish --tag alpha`）
- [ ] フル版 → 要約版の半自動生成（§13.4）
- [ ] ベンダメモリとの矛盾検知（§12.4）

## License

コード: MIT。`docs/SPEC-AKASHI.md` は KOKORO SPEC（CC BY-SA 4.0）への upstream を前提とする。
