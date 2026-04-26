# ポータル公開方針

## 決定事項（2026-04-26）

Google Sitesへの埋め込みは**廃止**。
GitHub Pages（`april-knights-dev.github.io/pj-ai-native-portal`）でホスティングする。

## 実装計画

`docs/setup.md` の「未完了タスク」セクションを参照。

## 暫定運用

GitHub Pages移行完了まで、以下のGAS WebApp URLを直接使用:

```
https://script.google.com/a/macros/april-knights.com/s/AKfycbyK8YnqmzFnWUjicK1v-pJ4bUcr38tHmLUWWDsx49Qfk0DJycYGQFxp4fKconcvojtZew/exec
```

デプロイ設定: `executeAs: USER_DEPLOYING` / `access: DOMAIN`（april-knights.com内全員がアクセス可）
