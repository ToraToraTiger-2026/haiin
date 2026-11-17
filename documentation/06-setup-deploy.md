# 06. 動かし方・テスト・公開

ビルドも、サーバーも、データベースの構築も要らない。ファイルを置くだけで動く。

## ローカルで動かす

`index.html` をそのまま開く（`file://`）と、ES modules や IndexedDB がブラウザによって動かないことがある。次の方法で開く。

1. VS Code に拡張機能「Live Server」を入れる。
2. リポジトリのルートで `index.html` を右クリック →「Open with Live Server」。
3. 初めて開いたら、**「データ」タブ →「ダミーデータを生成」**を押す。メンバー30人・クライアント50社のダミーデータで試せる。

- Node は要らない。
- ローカル（`localhost` / `127.0.0.1`）と公開URLは、**アドレスが違うので、データも別**になる。
- ダミーデータを生成すると、**既存のデータはすべて消える**。実データを入れた後には押さない。

## テスト

ブラウザで次のファイルを開くと、自動で実行され、結果が画面に出る（Live Server 経由で開く）。

| ファイル | 件数 | 内容 |
|---|---|---|
| `tests.html` | 32 | 日付の計算、上限・負荷・上限超過・空き・不足、ルールの展開・重なり・上限超過の警告、CSV の入出力 |
| `tests_step4.html` | 17 | 月の空き、チーム内の空き、Gap、ルールの組み直し、自動提案（モード A・B、ロック、チーム外、優先度） |

- 画面上部に、成功・失敗の件数が出る。失敗したテストは、期待値と実際の値が出る。
- `calc.js` `expand.js` `solver.js` `io.js` `dates.js` を変えたら、**両方**を開いて、すべて成功することを確認する。
- 自動実行の仕組み（CI）はない。

## 公開（GitHub Pages）

- リポジトリ：https://github.com/ToraToraTiger-2026/haiin
- 公開元：`main` ブランチの**ルート**（`/`）。ビルドは要らない。
- 公開URL：https://toratoratiger-2026.github.io/haiin/
- 設定場所：GitHub の Settings → Pages → Build and deployment（Source は Deploy from a branch、Branch は `main` / `/ (root)`）。

`main` に push すると、数分で公開に反映される。

### 公開の注意
- リポジトリ全体が公開される。`documentation/` や `tests.html` も、公開URLから見られる。
- **実データを含むファイルを、リポジトリに入れない**（[04-security.md](04-security.md)）。
- パスは相対パスで書く（`css/style.css`、`js/app.js`）。先頭が `/` のパスは、サブフォルダ（`/haiin/`）で公開したときに壊れる。

## 変更を公開するときの手順

1. Live Server で動作を確認する。
2. `tests.html` と `tests_step4.html` を開き、すべて成功することを確認する。
3. 実データを含むファイルが、変更に入っていないことを確認する（`git status`）。
4. コミットして、`main` に push する。
5. 数分後に、公開URLを開いて確認する。

> IndexedDB のテーブル構成を変える変更は、公開する前に、**今あるデータのバックアップを書き出す**。構成の変更には、`DB_VERSION` の更新と、移行の処理が必要（[03-data-model.md](03-data-model.md)）。
