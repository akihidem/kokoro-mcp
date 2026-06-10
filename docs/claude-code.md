# Claude Code 統合ガイド

`kokoro.md` を Claude Code に読ませる 2 経路。どちらも配信前に署名・同意・失効の検証が走る。

## 経路 1: MCP サーバ（推奨）

```bash
claude mcp add kokoro -- kokoro-mcp serve --file /home/you/.kokoro/kokoro.md
```

またはプロジェクトの `.mcp.json`:

```json
{
  "mcpServers": {
    "kokoro": {
      "command": "kokoro-mcp",
      "args": ["serve", "--file", "/home/you/.kokoro/kokoro.md", "--registry", "https://example.org/akashi/registry.json"]
    }
  }
}
```

- パスは `~` 展開に頼らず絶対パスで書く（クライアントによって展開されない）
- `KOKORO_FILE` / `KOKORO_REGISTRY` 環境変数でも指定可能
- Claude は `get_kokoro_context` をセッション冒頭で呼び、`get_safety_profile` で境界線のみの最小開示もできる

## 経路 2: SessionStart hook（常時注入）

settings.json の hooks に登録する（**設定変更は各自の運用ルールに従うこと**。このリポジトリの所有者は `/update-config` スキル経由で行う）:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "kokoro-mcp render --quiet-missing /home/you/.kokoro/kokoro.md"
          }
        ]
      }
    ]
  }
}
```

- `render` は検証に通った場合のみ本文を stdout に出す（hook 経由でコンテキストに注入される）
- 検証に落ちると **exit 2 + stderr** で、本文は注入されない（fail-closed）
- `--quiet-missing` はファイルがないマシンで静かに何もしない（dotclaude 同期先などでの安全弁）

## self-use ファイル（jibun.md 型）の運用

本人が本人のために書いたファイルは臨床交付物ではないので、`--policy self` を使う：

```bash
kokoro-mcp render --policy self --allow-unsigned /home/you/jibun/kokoro.md
```

- §3.1 スキーマと consent ゲートが外れる（同意は本人に内在するため）
- `reviewed_by: ai_drafted_unreviewed` の流通禁止だけは self でも維持される
- 自分の鍵で署名しておけば（`keygen` → `sign --role self`）、`--allow-unsigned` を外して改ざん検知だけ効かせる運用もできる。
  hook 注入スクリプトの差し替え・改ざんに気づける分、素の `cat` 注入より強い

## バナー

注入される本文の先頭に 1 行付く：

```
<!-- kokoro-mcp v0.1.0 | status=verified key=3fa1b2c4d5e6f7a8 | policy=clinical -->
```

AI 側はこのバナーで「検証済みの取扱説明書である」ことを区別できる（ベンダメモリ由来の推測プロファイルとの reconciliation の足がかり、SPEC §12.4）。
