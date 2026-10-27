# セットアップガイド

## 第2期の運用

第2期用の値は GAS の「プロジェクトの設定 → スクリプト プロパティ」にだけ設定する。トークンや API キーをリポジトリ、`setup.js`、ログへ書かない。下表は第2期コードが実際に参照するキーであり、例中の秘密情報はすべてダミーである。

| キー | 必須 | 意味 | 例の値 |
|---|---|---|---|
| `SPREADSHEET_ID` | 必須 | 第2期ストア（`cohort_members`、`quests`、台帳など）を作成・更新するスプレッドシート ID | `1AbcdefGhijkLmnoPqrstUvwxYz0123456789` |
| `GITHUB_TOKEN` | 必須 | GitHub Projects の読取、クエスト Issue の担当者更新、開発リポジトリの PR 読取に使う PAT | `github_pat_REPLACE_WITH_REAL_TOKEN` |
| `ADMIN_EMAILS` | 必須 | Web アプリの運営権限と運営評価操作を許可するメールアドレス（カンマ区切り） | `admin1@april-knights.com,admin2@april-knights.com` |
| `COHORT_CONFIG` | 必須 | 第2期 ID と GitHub Projects の接続先を指定する JSON | 下記 JSON |
| `CHAT_NOTIFY_ENABLED` | 条件付き | 第2期の日次・週次の本番投稿を有効にするフラグ。通知を登録する場合は `true` | `true` |
| `CHAT_WEBHOOK_URL` | 条件付き | 第2期全体への本番通知先 Incoming Webhook URL。チーム別 URL は第2期では使わない | `https://chat.googleapis.com/v1/spaces/AAAAExample/messages?key=REPLACE&token=REPLACE` |
| `CHAT_WEBHOOK_URL_SANDBOX` | 任意 | 第2期通知の sandbox 投稿先。`SANDBOX_MODE=true` の本番入口、または `dailyAiSummaryToSandbox()` / `weeklySummaryToSandbox()` で使う | `https://chat.googleapis.com/v1/spaces/AAAASandbox/messages?key=REPLACE&token=REPLACE` |
| `SANDBOX_MODE` | 任意 | `true` の間、第2期の本番通知入口を sandbox URL へ切り替える確認用フラグ。明示的な `*SummaryToSandbox()` はこの値に依存しない | `false` |
| `CHAT_NOTIFY_PAUSED` | 任意 | `true` の間、Chat 投稿を止める安全スイッチ。第2期の `runCohort2Collect()` による同期・加点・KPI は継続する | `false` |
| `COHORT2_GCHAT_SPACE` | 任意 | 運営評価候補と承認結果を投稿する Google Chat スペース名。候補を Chat へ送る場合に設定する | `spaces/AAAAExampleSpace` |
| `COHORT2_APPROVER_GCHAT_USERS` | 任意 | ✅ で運営評価を承認できる Chat ユーザー名（カンマ区切り）。未設定時は `ADMIN_EMAILS` に一致する `cohort_members.gchat_user` を使う | `users/123456789012345678901,users/234567890123456789012` |
| `GEMINI_API_KEY` | 任意 | 運営評価候補の生成に使う Gemini API キー。未設定なら候補生成を安全にスキップする | `REPLACE_WITH_REAL_GEMINI_KEY` |
| `GEMINI_MODEL_ANALYSIS` | 任意 | 運営評価候補生成で使う Gemini モデル。未設定時は `gemini-2.0-flash` | `gemini-2.0-flash` |

`GITHUB_TOKEN` には Organization Projects の読取、`ai-native-quests` の Issue assignee 更新、`ai-native-squire` の PR 読取を許可する。`COHORT_CONFIG` の `github` は必須で、Project 側のフィールド名（`Status`、`種別`、`段階`、`重さ`、`難易度`、`記載文`、`開始日`、`期限`）と一致させる。第2期で日次または週次通知を登録する場合は `CHAT_NOTIFY_ENABLED=true` と `CHAT_WEBHOOK_URL` が必須である。現行コードは終了日を参照しないため、`endDate` は設定不要である。

```json
{
  "schemaVersion": 2,
  "id": "2026-cohort-02",
  "name": "第2期",
  "startDate": "2026-11-30",
  "status": "active",
  "github": {
    "org": "april-knights-dev",
    "projectNumber": 3,
    "questRepo": "ai-native-quests",
    "developmentRepo": "ai-native-squire",
    "claimableStatuses": ["To do", "Ready", "未着手"]
  }
}
```

初回は `initializeCohort2Sheets()` を実行し、運営画面で参加者を受け入れる。手動実行と週次トリガーは第2期専用の `runCohort2Collect()` を使う（先行版の `weeklyCollectCohort2()` は互換用）。第1期の `weeklyCollect()`、`collectAll()`、`backfillAll()`、`clearAndBackfill()` は第1期アーカイブ専用の入口として残す。運営評価のリアクション承認は `cohort2ApproveManagementCandidates()` を定期実行する。日次・週次通知を使う場合は `dailyAiSummary` と `weeklySummary` を登録する。Web アプリは access を `DOMAIN` としてデプロイする。

レビュー前に `clasp push`、`clasp deploy`、`git push` は行わない。既存の第1期トリガーを削除・変更する前に、人が対象と移行時期を確認する。

## 前提条件

- Node.js インストール済み
- Google アカウント（april-knights.com）
- gh CLI インストール済み・認証済み

## 第1期の旧運用（履歴。第2期では実行しない）

以下は 2026-04-26 時点の第1期 Backlog・チーム集計用の記録である。第2期のスプレッドシート初期化、手動収集、トリガー登録には使わない。第2期は上記の `initializeCohort2Sheets()` と `runCohort2Collect()` を使う。

### 1. clasp インストール・認証

```bash
npm install -g @google/clasp
clasp login   # ブラウザでapr-knights.comアカウントを認証（1回のみGUI）
```

### 2. GASプロジェクトとの紐付け

```bash
cd gas
# .clasp.json はすでに存在する（scriptId設定済み）
# 必要に応じてclasprc.jsonの認証情報を確認
```

### 3. GCPプロジェクト設定

GASエディタで「プロジェクトの設定」→「Google Cloud Platformプロジェクト」に
プロジェクト番号 `501854898464`（april-knights-gws）を設定する。

reaction-notify-botと同一のGCPプロジェクトを使用。Chat API・directory API有効済み。

### 4. Script Properties設定

GASエディタで `setupScriptProperties()` を実行後、実際の値を手動で上書きする。

| キー | 取得先 |
|---|---|
| `SPREADSHEET_ID` | `1TQUPh_Snrh961k7J-sZ_LAEQsQfBzP9ZzGv9CHEhJ8w` |
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → PAT（repo/read:org） |
| `BACKLOG_API_KEY` | Backlog → 個人設定 → API |
| `ADMIN_EMAILS` | 管理者のメールアドレス カンマ区切り |

### 5. 第1期スプレッドシート初期化

GASエディタで順番に実行:

```
1. initializeDashboardSheets()   # シート作成（gchat_weekly等）
2. setupUserMapping()            # user_mapping ヘッダー設定（データがあればスキップ）
3. setupGChatDisplayNames()      # People APIでGChat UserID自動入力
```

### 6. 第1期の動作確認

```
weeklyCollect()   # 手動実行して全データソースが収集できるか確認
```

### 7. 第1期の週次トリガー設定

GASエディタ → トリガー（時計アイコン）→ トリガーを追加:
- 関数: `weeklyCollect`
- 種類: 時間主導型 → 週タイマー → 毎週月曜 → 午前9〜10時

### 8. 第1期のデプロイ記録

```bash
cd gas
clasp push --force
clasp deploy --description "初回デプロイ"
```

## コード変更時の手順

```bash
cd gas
clasp push --force
clasp deploy --description "変更内容のメモ"
```

## 期（Cohort）ローテーション時

1. `COHORT_CONFIG` Script Propertyを新期のJSONに更新
2. `user_mapping` シートのメンバーを更新
3. `setupGChatDisplayNames()` を再実行してGChat UserIDを更新
4. コードの変更は不要

## 未完了タスク（次セッションで実施）

GitHub Pages化（フロントエンドの静的ホスティング移行）:

1. `gas/dashboard_webapp.js` を JSON API に変更
   - `doGet(e)` がHTMLではなくJSONを返す
   - CORS ヘッダー付与
   - エンドポイント: `?page=summary` / `?page=personal&member=畠山` など

2. Google Sign-In実装
   - `docs/app.js` でGISライブラリを使いIDトークン取得
   - GAS側でIDトークン検証 → メール取得 → 役割判定

3. フロントエンド実装
   - `docs/index.html` / `docs/app.js` / `docs/style.css`
   - 既存 `dashboard_webapp.js` のHTML/CSSを静的ファイルに移植

4. GitHub Pages有効化
   ```bash
   gh api repos/april-knights-dev/pj-ai-native-portal/pages \
     --method POST \
     -f source='{"branch":"main","path":"/docs"}'
   ```
