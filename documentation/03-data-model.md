# 03. データモデル

データは IndexedDB（DB名 `haiin`、バージョン 1）に、11のテーブル（オブジェクトストア）として入る。定義は `js/db.js`（キー）と `js/io.js`（列）が正で、このファイルはその要約。

## テーブル

| テーブル | 役割 | キー | インデックス | シナリオ別 |
|---|---|---|---|---|
| `members` | メンバー | `member_id` | | |
| `clients` | クライアント | `client_id` | | |
| `periods` | 期 | `period_id` | | |
| `plan_demand` | 計画需要（期初・固定） | `period_id` + `client_id` + `month` | | |
| `scenarios` | シナリオ（本番・下書き） | `scenario_id` | | |
| `current_demand` | 現在の需要 | `scenario_id` + `client_id` + `month` | `scenario_id` | ○ |
| `team_members` | チーム編成 | `scenario_id` + `client_id` + `member_id` | `scenario_id` | ○ |
| `assignment_rules` | 配員ルール | `rule_id` | `scenario_id` | ○ |
| `allocations` | 日単位の配員（ルールの展開結果） | `scenario_id` + `member_id` + `client_id` + `date` | `scenario_id`、`rule_id` | ○ |
| `capacity` | 上限の例外 | `member_id` + `date` | | |
| `change_log` | 変更履歴 | `log_id`（自動採番） | | |

> `assignment_rules` と `allocations` の `rule_id` は、ルールと展開結果をひも付けるための、仕様の11テーブルへの最小の追加列。

### 列

| テーブル | 列 |
|---|---|
| `members` | `member_id`、`name`、`std_cap`（標準上限・時間/日） |
| `clients` | `client_id`、`name`、`active`（有効） |
| `periods` | `period_id`、`name`、`start`、`end` |
| `plan_demand` | `period_id`、`client_id`、`month`（`YYYY-MM`）、`hours` |
| `scenarios` | `scenario_id`、`name`、`kind`（`本番` / `下書き`）、`created_by`、`created_at` |
| `current_demand` | `scenario_id`、`client_id`、`month`、`hours`、`reason`（変更理由） |
| `team_members` | `scenario_id`、`client_id`、`member_id`、`role`（役割） |
| `assignment_rules` | `rule_id`、`scenario_id`、`member_id`、`client_id`、`start`、`end`、`hours_per_day`、`include_weekend`、`locked` |
| `allocations` | `scenario_id`、`member_id`、`client_id`、`date`、`hours`、`rule_id` |
| `capacity` | `member_id`、`date`、`cap` |
| `change_log` | `log_id`、`at`、`actor`、`table`、`target_id`、`before`、`after` |

- 日付は `YYYY-MM-DD` の文字列、月は `YYYY-MM` の文字列。
- `periods` の月の一覧は、`start` から `end` にかかる月から決まる。

### IDの付け方

| 対象 | 形式 | 付け方 |
|---|---|---|
| メンバー | `M01`、`M02` … | マスタで追加するとき、最大の番号 + 1 |
| クライアント | `C01`、`C02` … | 同上 |
| 期 | `P01`、`P02` … | 同上。ダミーデータの期だけは `P1` |
| 本番シナリオ | `prod` | 固定（`PROD`） |
| 下書き | `D` + 時刻（36進数） | 作成時 |
| 配員ルール | `U` + 時刻 + 乱数 | 画面から作ったとき。ダミーデータは `R1`、`R2` … |

## シナリオ

- `scenario_id` を持つ4テーブル（`current_demand` `team_members` `assignment_rules` `allocations`）が、本番と下書きに分かれる。
- 下書きを作るとき、この4テーブルを本番からコピーする。`rule_id` は新しく振り直す。
- 確定すると、本番の4テーブルを下書きの内容で丸ごと置き換え、下書きを消す。下書きを作った後に本番を変えていても、本番は下書きの内容になる（確認の表示が出る）。
- 本番は破棄も確定もできない。
- メンバー、クライアント、期、計画需要、上限の例外は、全シナリオ共通。これらを変えると、本番にも下書きにも影響する。

## 配員ルールと配員

- 入力の単位は**配員ルール**（メンバー × クライアント × 期間 × 1日あたりの時間）。
- 保存すると、期間の各日に展開されて `allocations` に入る。`include_weekend` が false なら、土日は展開しない。
- **同じシナリオ・メンバー・クライアントで、期間が重なるルールは作れない**（`allocations` のキーが重複するため）。
- 上限を超える日があっても、**警告だけで保存はできる**。
- `locked` のルールは、自動提案で動かさない。

## 計算式（`js/calc.js`）

表示のたびに計算する。結果は保存しない。小数の誤差は、小数第6位で丸めて抑えている。

| 記号 | 名前 | 式 |
|---|---|---|
| Cap(m,d) | 上限 | `capacity` に例外があればその値。なければ、土日は 0、平日はメンバーの `std_cap` |
| L(m,d) | 負荷 | メンバー m の日 d の、全クライアントの配員時間の合計 |
| A(c,t) | 月の配員 | クライアント c の月 t の配員時間の合計 |
| Short(c,t) | 不足 | `max(0, D − A)`。D は現在の需要 |
| Over(m,d) | 上限超過 | `max(0, L − Cap)` |
| Free(m,d) | 空き | `max(0, Cap − L)` |
| 月の空き(m,t) | 月の空き | 月 t の各日の Free(m,d) の合計 |
| チーム内の空き(c,t) | チーム内の空き | クライアント c のチームのメンバーの、月の空きの合計 |
| Gap(t) | Gap | その月の「不足の合計 − 空きの合計（全メンバー）」。正なら他チームへの応援が必要 |

補足。

- 祝日は、`capacity` に上限 0 を入れて表す（自動では判定しない）。
- 超過している日の空きは 0 になる。他の日の空きと相殺しない。
- 不足は、需要も配員もあるクライアント × 月をすべて返す。需要がない月に配員があっても、不足は 0（行は残る）。
- **チーム内の空き**は、同じメンバーが複数のクライアントのチームに入っていると、重複して数える。そのため、「応援が必要な目安」は目安の値。
- 応援が必要な目安 ＝ `max(0, 不足 − チーム内の空き)`（`js/report.js`）。

## 変更履歴（`change_log`）

- マスタ・需要・ルール・チーム編成・上限の例外・シナリオの書き込みを、`changelog.js` が記録する。
- 記録する内容：日時、操作者、対象テーブル、対象ID、変更前、変更後。
- `allocations` は派生データなので、1行ずつは記録しない（ルールを記録する）。
- 次の操作は、まとめて1件で記録する：CSV の取り込み、JSON の取り込み、上限の例外の一括登録、下書きの本番への反映。
- 「操作者」は、画面上部の入力欄の名前（localStorage に保存。既定は「自分」）。認証ではないので、本人確認にはならない。
- 履歴は、画面では新しい順に先頭 200 件まで表示する。

## バックアップ JSON の形式

```json
{ "app": "haiin", "version": 1, "exported_at": "<ISO日時>", "tables": { "members": [...], "clients": [...], ... } }
```

- `app` が `haiin` でないファイルは、取り込めない。
- 11テーブルすべてを書き出す。読み込み時に、ないテーブルは空として扱う。

## DB のバージョン

`db.js` の `DB_VERSION` は 1。`onupgradeneeded` は、**ない**テーブルを作るだけで、既存のテーブルの変更や移行はしない。
テーブルの構成やインデックスを変えるときは、`DB_VERSION` を上げ、移行の処理を書く必要がある（[08-roadmap.md](08-roadmap.md)）。
