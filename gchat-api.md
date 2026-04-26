# Google Chat API メモ

## 確認済み事項

- サービスアカウント（ドメイン委任 / DWD）を使用してGoogle Chat APIへのアクセスが可能
- リアクション（emoji reactions）の監視も対応可能なことを確認済み
- 管理者権限は不要（DWD設定のみ管理者GUI操作が1回必要）

## 必要なAPIスコープ

```json
// appsscript.json の oauthScopes に追加（実装済み）
"https://www.googleapis.com/auth/chat.messages.readonly",
"https://www.googleapis.com/auth/chat.messages.reactions.readonly"
```

> ⚠️ `chat.spaces.messages.readonly` は古い / 誤ったスコープ名。上記が正しい。

## 使用するAPI エンドポイント

| 目的 | エンドポイント |
|---|---|
| メッセージ一覧取得 | `GET spaces/{space}/messages?filter=...` |
| リアクション一覧取得 | `GET spaces/{space}/messages/{message}/reactions` |

フィルター例:
```
createTime >= "2026-04-14T00:00:00Z" AND createTime < "2026-04-21T00:00:00Z"
```

## 監視対象スペース

スペースIDはGoogle ChatスペースのURLから確認して config.js の `GCHAT_SPACES` に記入:

| スペース名 | スペースID |
|---|---|
| pj_ai_native_all | `spaces/XXXXXXXX` |
| pj_ai_native_team_a | `spaces/XXXXXXXX` |
| pj_ai_native_team_b | `spaces/XXXXXXXX` |
| pj_ai_native_team_c | `spaces/XXXXXXXX` |

> Google Chat のスペースURLが `https://chat.google.com/room/AAAXXXXXX/...` であれば
> スペースIDは `spaces/AAAXXXXXX`。

## 認証実装

`gas/auth.js` の `getGChatReadToken_()` / `getGChatReactionsToken_()` を使用。
reaction-notify-bot の `ServiceAccount.gs` と同一パターン（`SERVICE_ACCOUNT_KEY` プロパティ）。

```javascript
// gchat_collector.js での使用例
const readToken = getGChatReadToken_();
const resp = UrlFetchApp.fetch(url, {
  headers: { Authorization: `Bearer ${readToken}` },
  muteHttpExceptions: true,
});
```

## メンバーマッピング

Google Chat の `sender.displayName` を `user_mapping` シートの `Google Chat表示名` 列と照合。
フォールバック: 表示名の姓（スペース前の文字列）で `TEAM_MAP` を検索。

`config.js` の `gchatDisplayNameToMember_(displayName, userMap)` を使用。

## セットアップ手順（初回のみ）

1. Google Workspace 管理コンソールで SA に DWD を付与（管理者GUI操作）
   - スコープ: `chat.messages.readonly` / `chat.messages.reactions.readonly`
2. `setup.js` の `setupScriptProperties()` で `SERVICE_ACCOUNT_KEY` と `BOT_OPERATOR_EMAIL` を設定
3. `GCHAT_SPACES` の各スペースIDを実際の値に更新
4. `user_mapping` シートに各メンバーの `Google Chat表示名` を記入
