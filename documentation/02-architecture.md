# 02. アーキテクチャ

## 全体像

```
ブラウザ（GitHub Pages が配信する静的ファイル：HTML + CSS + ES modules）
   │
   ├─ IndexedDB ........ データの保存先（DB名 haiin、11テーブル）
   ├─ localStorage ..... 操作者の名前（haiin.actor）
   ├─ sessionStorage ... 表示中のシナリオと期（haiin.scenario / haiin.period）
   └─ Web Worker ....... 配員案の自動提案（solver.js を別スレッドで実行）
```

- **サーバーも外部サービスもない。** 実行中の外部への通信はない（コードに `fetch` などの通信処理はない）。
- ファイルは GitHub Pages が配信するだけ。データはブラウザの中にだけある。
- ブラウザごと・アドレス（オリジン）ごとに保存場所が別になる。別のブラウザや別の端末には、データは移らない（JSON で移す）。

## 技術スタック

| 層 | 内容 |
|---|---|
| 画面 | 素の HTML / CSS / JavaScript（ES modules）。`package.json` なし |
| 保存 | IndexedDB（薄いラッパー `db.js`） |
| 計算 | 純関数（`calc.js` `expand.js` `solver.js`） |
| ホスティング | GitHub Pages（リポジトリのルートを公開） |
| テスト | ブラウザで開く `tests.html` `tests_step4.html` |

外部ライブラリは使っていない。Node も不要。

## ファイル構成

```
haiin/
├─ index.html            画面の骨組み（ヘッダー、メニュー、シナリオ選択、操作者）
├─ css/style.css         基本のスタイル（印刷用を含む）
├─ css/step4.css         不足・空き・提案の画面向けのスタイル
├─ js/
│   ├─ app.js            起動、メニュー、シナリオ選択、画面の切り替え
│   ├─ db.js             IndexedDB（11テーブル）
│   ├─ state.js          表示中のシナリオ・期（sessionStorage）
│   ├─ changelog.js      変更履歴の記録、操作者
│   ├─ dates.js          日付の計算（'YYYY-MM-DD' 文字列）
│   ├─ calc.js           集計（負荷・不足・上限超過・空き・Gap）
│   ├─ expand.js         配員ルールの展開、重なり・上限超過のチェック、ルールの組み直し
│   ├─ scenario.js       下書きの作成・確定・破棄
│   ├─ solver.js         自動提案（貪欲法）
│   ├─ worker.js         solver を Web Worker で動かす
│   ├─ propose.js        自動提案の実行と、結果の下書きへの書き出し
│   ├─ periodctx.js      表示する期の選択
│   ├─ report.js         不足一覧の行の組み立てと CSV
│   ├─ io.js             CSV / JSON の入出力の定義
│   ├─ dummy.js          ダミーデータの生成
│   ├─ ui.js             画面部品（要素の作成、ダイアログ、ダウンロード）
│   └─ views/            各画面（data / demand / free / grid / history / io / master / report / scenario / shortage）
├─ tests.html            集計ロジックのテスト
├─ tests_step4.html      空き・Gap・組み直し・自動提案のテスト
└─ documentation/        このドキュメント
```

リポジトリ全体が公開される（`documentation/` も含む）。

## 画面の仕組み

- `app.js` が、`#/<画面名>` のハッシュで画面を切り替える。既定は `#/shortage`。
- 各画面のモジュールは `render(root)` を1つ公開する。`app.js` が `root`（`<main id="view">`）を渡して呼ぶ。
- 画面を描き直すときは、各画面が自分で `render(root)` を呼び直す。
- 要素は `ui.js` の `h()` で作る。文字列は常にテキストとして入れる（`innerHTML` は使わない）。
- 表示のたびに、IndexedDB から読み、`calc.js` で計算する。計算結果は保存しない。

## データの流れ

### 読み取り・表示（例：不足ビュー）
1. 表示中のシナリオ（`state.js`）と期（`periodctx.js`）を決める。
2. メンバー、クライアント、現在の需要、配員、チーム編成、上限の例外を IndexedDB から読む（シナリオ別のものは `scenario_id` のインデックスで絞る）。
3. `calc.js` で、負荷 → 不足 → 月の空き → チーム内の空き → Gap の順に計算する。
4. 表にする。セルを押すと、メンバー別・日別の内訳を出す。

### 書き込み
- マスタ・需要・ルールなどの書き込みは `changelog.js` の `putLogged` / `deleteLogged` を通し、`change_log` に残す。
- 配員（`allocations`）は、ルールから展開した**派生データ**なので、1行ずつは記録しない（ルール側を記録する）。
- 配員ルールの保存：
  1. 同じ `rule_id` の配員を削除する
  2. ルールを保存する（履歴つき）
  3. `expandRule` で展開した配員を保存する

### シナリオ
```
本番 ──createDraft──▶ 下書き（本番のコピー。rule_id は新しく振り直す）
                          │ 配員を動かす／自動提案
                          ▼
本番 ◀──commitDraft──── 下書き（本番の4テーブルを丸ごと置き換え、下書きは消す）
```

- シナリオごとに分かれるのは `current_demand` `team_members` `assignment_rules` `allocations` の4テーブル。
- それ以外（メンバー、クライアント、期、計画需要、上限の例外、履歴）は、全シナリオで共通。

### 自動提案
1. 表示中のシナリオを元に、ロックされたルールとその配員を「動かさない配員」、残りを「動かしてよい配員」に分ける。
2. `solver.js` の `solve` を Web Worker で実行する（Worker を作れない環境では、画面のスレッドで実行する）。
3. 結果の配員から、`rebuildRules` で配員ルールを組み直す。ロックしたルールはそのまま残す。
4. 新しい下書きとして保存する。本番は書き換えない。

### 入出力
- JSON バックアップ：全テーブルを書き出す／すべて置き換えて取り込む。
- CSV：テーブルごとに書き出す／取り込む（取り込めるのは7テーブルだけ）。

## ブラウザへの保存

| 保存先 | キー | 内容 | 消えるとき |
|---|---|---|---|
| IndexedDB | DB名 `haiin`（バージョン 1） | 11テーブル | ブラウザのサイトデータを消したとき。「全データを削除」を押したとき |
| localStorage | `haiin.actor` | 操作者の名前（既定は「自分」） | サイトデータを消したとき |
| sessionStorage | `haiin.scenario` | 表示中のシナリオID | タブを閉じたとき |
| sessionStorage | `haiin.period` | 表示中の期ID | タブを閉じたとき |

localStorage と sessionStorage に保存できない環境でも動く（保存できないだけ）。
IndexedDB はアドレスごとに別なので、`localhost` で作ったデータは、公開URLでは見えない。
