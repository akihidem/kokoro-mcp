# akashi — kokoro.md 信頼層仕様 v0.1-draft

> 心理師承認済み `kokoro.md` の **真正性（誰が承認したか）・完全性（改ざんされていないか）・現在性（撤回されていないか）** を、
> 臨床情報を一切公開せずに第三者が検証できるようにする最小の信頼層。
> KOKORO SPEC §3.1 `signature_hash`（v0.2 必須化予定）および §10.2 撤回フローへの実装提案。

## 0. 設計原則

1. **原本非流通の維持** — 署名・レジストリのどこにも所見・本文・本人情報を置かない。流通するのはハッシュと署名だけ
2. **検証はオフラインで完結** — sidecar 単体で暗号学的検証が可能。レジストリは失効確認の追加層
3. **失効 = 削除権の執行** — 本人撤回（SPEC §10.2）を、配信側の技術的停止として即時実装する
4. **道具は承認を代替しない** — 署名は心理師の行為。CLI が承認をバイパスしない（SPEC §13.4 HARD）

## 1. 正規形（canonical form）

署名・ハッシュは `kokoro.md` **全文（frontmatter 含む）** の正規形に対して行う：

1. 改行を LF（`\n`）に統一（CRLF / CR → LF）
2. 末尾を改行ちょうど 1 つに正規化
3. それ以外のバイト列（行内空白・Unicode 正規化を含む）には触れない
   — markdown の hard break（行末 2 スペース）を保護するため。エディタ間の Unicode 正規化差は本仕様の対象外とし、運用（同一ファイルの受け渡し）で担保する

`canonical_sha256` = 正規形 UTF-8 バイト列の SHA-256（hex 小文字）。

## 2. 署名 sidecar（`<file>.akashi.json`）

署名は **detached sidecar** とする。frontmatter 内に署名を埋め込むと自己参照（署名対象に署名自身が含まれる）が生じるため、
SPEC §3.1 の `signature_hash` フィールドは `null` のままでよく、本 sidecar が規範的な署名キャリアとなる。

```json
{
  "spec": "akashi/0.1",
  "target": "kokoro.md",
  "hash_algorithm": "sha256",
  "canonical_sha256": "<hex64>",
  "signature_algorithm": "ed25519",
  "signature": "<base64>",
  "public_key_spki_pem": "-----BEGIN PUBLIC KEY-----\n...",
  "key_id": "<SPKI DER の SHA-256 先頭 16 hex>",
  "signer": { "role": "certified-psychologist", "alias": "K.M." },
  "kokoro_version": "1.2.0",
  "signed_at": "2026-06-11T00:00:00.000Z",
  "expires_at": null,
  "registry": "https://example.org/akashi/registry.json"
}
```

制約:

- `signer.alias` はイニシャル / 仮名のみ（SPEC §7.1「心理師のフルネーム禁止」を署名層にも適用）
- `expires_at` は任意。`next_review` 運用と連動させ、署名の鮮度を強制したい場合に使う
- 公開鍵は sidecar に内蔵（検証のオフライン完結）。鍵の信頼アンカリングはレジストリが担う

## 3. 失効レジストリ（`akashi-registry/0.1`）

```json
{
  "spec": "akashi-registry/0.1",
  "updated_at": "2026-06-11T00:00:00.000Z",
  "keys": {
    "<key_id>": { "status": "valid | revoked", "owner": "K.M.", "revokedAt": null, "reason": null }
  },
  "documents": {
    "<canonical_sha256>": { "status": "revoked", "revokedAt": "...", "reason": "本人撤回" }
  }
}
```

- **公開してよい情報のみで構成される**（key_id・文書ハッシュ・ステータス・日時）。臨床情報・本人識別子は構造上入らない
- `keys` の失効 = その心理師鍵による全署名の無効化（鍵漏洩・資格喪失時）
- `documents` の失効 = **特定の版の `kokoro.md` の配信停止**。本人撤回（§10.2）・重大な誤記の回収に使う
- 静的 JSON 1 枚。GitHub Pages / 任意の静的ホスティングで配信可能
- レジストリ不達時は**暗号検証結果を維持したまま warning**（可用性とのバランス。HARD にしたい運用は将来の `registry_required` フラグで対応）

## 4. 検証アルゴリズム

```
1. sidecar が無い                          → unsigned
2. canonical_sha256 不一致                 → invalid-signature（改ざん）
3. key_id ≠ hash(public_key)              → invalid-signature
4. Ed25519 検証失敗                        → invalid-signature
5. expires_at < now                       → expired
6. registry.keys[key_id].status=revoked   → revoked-key
7. registry.documents[hash].status=revoked → revoked-document
8. それ以外                                → verified
   （registry 不達: warning / key 未登録: warning）
```

## 5. 配信ポリシーとの結合

検証結果は KOKORO SPEC §10.3 の流通禁止条件と **AND** で結合される。配信されるのは：

```
servable =
      §10.3 違反なし（consent_obtained / reviewed_by ≠ ai_drafted_unreviewed / §3.1 スキーマ）
  AND（verified ∨（unsigned ∧ 明示的 allow-unsigned））
```

`invalid-signature / expired / revoked-*` は **いかなるフラグでも配信されない**。

## 6. 脅威モデル（v0.1 の射程）

| 脅威 | 防御 |
|---|---|
| 本文改ざん（配慮指示の書き換え・禁止情報の混入） | canonical hash + Ed25519 |
| 承認なりすまし（心理師承認を偽装した流通） | 署名鍵 + レジストリの鍵ステータス |
| 撤回後の流通継続 | `revoke-doc` による即時配信停止 |
| 鍵漏洩 | `revoke-key`（過去署名も一括無効化） |
| **射程外**: 推測ベースのシャドープロファイル生成 | 防げない。ただし本仕様により「同意され署名された自己開示」と「推測されたプロファイル」が**技術的に区別可能**になる — これが規格の対抗価値 |
| **射程外**: レジストリ運営者の信頼 | v0.1 は単一レジストリ前提。複数レジストリ / 透明性ログは v0.2 で検討 |

## 7. KOKORO SPEC への upstream 提案対応表

| SPEC 箇所 | 提案 |
|---|---|
| §3.1 `signature_hash`（v0.2 で必須化予定） | フィールドは `null` 維持のまま、detached sidecar `<file>.akashi.json` を規範キャリアとして §3.1 に追記 |
| §10.2 撤回フロー（30 日以内削除） | 「撤回受領 → registry `revoke-doc` を即時実行」を手順 0 として追加（削除義務の技術的補強） |
| §10.3 流通禁止条件 | ローダー実装要件として「§10.3 を満たさないファイルを AI に注入してはならない」を明文化 |
| §13.4 reference CLI | lint / verify / serve の参照実装として本リポジトリを記載 |
| §12.1 配布 | 「sidecar は kokoro.md と同一経路で配布する」を追記 |
