# 配員管理ツール

コンサルティングチームの配員を、日単位で管理する個人用のWebアプリです。
期初計画の必要工数と現在の配員を突き合わせて、

- どのクライアントに何時間足りないか(不足ビュー)
- 誰がいつ空いているか(空きビュー)

を見える化し、不足を埋める配員案を自動で提案します(貪欲法。最適解は保証しません)。

- 公開URL: https://toratoratiger-2026.github.io/haiin/
- 状態: Step 1〜4 完了・公開済み。以降は運用・改善([現状とロードマップ](documentation/08-roadmap.md))
- 技術: 素のHTML/CSS/JavaScript(ES modules)、ビルドなし、IndexedDB

## ドキュメント

| 読みたいこと | ファイル |
|---|---|
| 何のツールか、画面、基本の考え方、用語 | [01-overview.md](documentation/01-overview.md) |
| 構成、データの流れ、ブラウザへの保存 | [02-architecture.md](documentation/02-architecture.md) |
| 11テーブル、計算式、シナリオ | [03-data-model.md](documentation/03-data-model.md) |
| データの保護、公開リポジトリの注意 | [04-security.md](documentation/04-security.md) |
| モジュール、各画面、自動提案、入出力 | [05-frontend-reference.md](documentation/05-frontend-reference.md) |
| 動かし方、テスト、公開 | [06-setup-deploy.md](documentation/06-setup-deploy.md) |
| バックアップ、復旧、困ったとき | [07-operations-runbook.md](documentation/07-operations-runbook.md) |
| 現状、既知の制限、拡張の余地 | [08-roadmap.md](documentation/08-roadmap.md) |

## 使い方

ブラウザで公開ページを開くだけです。ビルドや外部サービスは使いません。

- データはすべて、使っているブラウザの中(IndexedDB)にだけ保存されます。サーバーや外部への通信はありません。
- 初めて開いたら「データ」タブで「ダミーデータを生成」を押すと、メンバー30人・クライアント50社のダミーデータで試せます。
- **実データはこのリポジトリに入れません。** ブラウザごと・アドレスごとに保存場所が別なので、「インポート/エクスポート」のJSONバックアップを定期的に書き出してください(保存先はリポジトリの外)。
- 取り込み・書き出しはCSVとJSONです(Excelは使いません)。

## ローカルで動かす

`index.html` をそのまま開くとブラウザによっては動かないため、VS Code の Live Server などで開いてください。

## テスト

`tests.html`(集計ロジック)と `tests_step4.html`(空き・Gap・自動提案)を開くと、結果が画面に出ます。

## フォルダ構成

```
index.html        画面の骨組み
css/              スタイル
js/               アプリ本体(js/views/ が各画面)
tests.html        集計ロジックのテスト
tests_step4.html  空き・Gap・組み直し・自動提案のテスト
documentation/    ドキュメント
```
