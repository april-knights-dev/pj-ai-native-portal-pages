# セットアップガイド

## 前提条件

- Node.js インストール済み
- Google アカウント（april-knights.com）
- gh CLI インストール済み・認証済み

## 初回セットアップ（完了済み手順）

以下は2026-04-26に完了済み。新規環境で再セットアップする場合のみ実行。

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

### 5. スプレッドシート初期化

GASエディタで順番に実行:

```
1. initializeDashboardSheets()   # シート作成（gchat_weekly等）
2. setupUserMapping()            # user_mapping ヘッダー設定（データがあればスキップ）
3. setupGChatDisplayNames()      # People APIでGChat UserID自動入力
```

### 6. 動作確認

```
weeklyCollect()   # 手動実行して全データソースが収集できるか確認
```

### 7. 週次トリガー設定

GASエディタ → トリガー（時計アイコン）→ トリガーを追加:
- 関数: `weeklyCollect`
- 種類: 時間主導型 → 週タイマー → 毎週月曜 → 午前9〜10時

### 8. デプロイ

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
