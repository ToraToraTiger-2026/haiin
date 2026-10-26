import { STORES, clearStores, getAll, putMany, openDb } from '../db.js';
import { recordChange } from '../changelog.js';
import { IMPORTABLE, SCHEMA, csvToRows, parseBackupJson, toBackupJson, toCsv } from '../io.js';
import { notifyScenariosChanged } from '../state.js';
import { download, h, setStatus } from '../ui.js';

const stamp = () => new Date().toISOString().slice(0, 10);
const readText = (file) => file.text();

// CSV取り込み時の参照チェック: テーブル → [列, 参照先テーブル, 参照先の列]
const REFS = {
  plan_demand: [['client_id', 'clients', 'client_id'], ['period_id', 'periods', 'period_id']],
  current_demand: [['client_id', 'clients', 'client_id']],
  team_members: [['client_id', 'clients', 'client_id'], ['member_id', 'members', 'member_id']],
  capacity: [['member_id', 'members', 'member_id']],
};

async function checkRefs(table, rows) {
  const errors = [];
  for (const [col, refTable, refCol] of REFS[table] ?? []) {
    const known = new Set((await getAll(refTable)).map((r) => r[refCol]));
    const bad = new Set(rows.map((r) => r[col]).filter((v) => !known.has(v)));
    if (bad.size) errors.push(`${col} に未登録の値があります: ${[...bad].slice(0, 5).join(', ')}${bad.size > 5 ? ' …' : ''}`);
  }
  return errors;
}

export async function render(root) {
  const out = h('div');

  // ---- JSON バックアップ ----
  const jsonPreview = h('div');
  const jsonFile = h('input', { type: 'file', accept: '.json,application/json' });
  jsonFile.addEventListener('change', async () => {
    jsonPreview.replaceChildren();
    const file = jsonFile.files[0];
    if (!file) return;
    const res = parseBackupJson(await readText(file), Object.keys(STORES));
    if (res.error) {
      jsonPreview.append(h('p', { class: 'error' }, res.error));
      return;
    }
    const cur = await Promise.all(Object.keys(STORES).map(async (k) => (await getAll(k)).length));
    jsonPreview.append(
      h('p', {}, `書き出し日時: ${res.exportedAt ?? '不明'}`),
      h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, ['テーブル', '現在', '取り込み後'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...Object.keys(STORES).map((k, i) =>
          h('tr', {}, h('td', {}, `${SCHEMA[k]?.label ?? k} (${k})`), h('td', { class: 'num' }, cur[i].toLocaleString()), h('td', { class: 'num' }, res.tables[k].length.toLocaleString())))),
      ),
      h('p', { class: 'note' }, '取り込むと、現在のデータはすべてこの内容に置き換わります。'),
      h('button', {
        onclick: async () => {
          if (!confirm('現在のデータをすべて置き換えます。よろしいですか?')) return;
          setStatus('取り込み中…');
          try {
            await clearStores();
            for (const [k, rows] of Object.entries(res.tables)) if (rows.length) await putMany(k, rows);
            await recordChange('(全体)', 'JSON取り込み', null, { file: file.name });
            setStatus('JSONの取り込みが完了しました');
            notifyScenariosChanged();
            jsonPreview.replaceChildren();
            jsonFile.value = '';
          } catch (e) {
            setStatus(`取り込みに失敗しました: ${e.message}`);
          }
        },
      }, '置き換えて取り込む'),
    );
  });

  // ---- CSV ----
  const csvPreview = h('div');
  const csvTableSel = h('select', {}, ...IMPORTABLE.map((k) => h('option', { value: k }, `${SCHEMA[k].label} (${k})`)));
  const csvFile = h('input', { type: 'file', accept: '.csv,text/csv' });
  csvFile.addEventListener('change', async () => {
    csvPreview.replaceChildren();
    const file = csvFile.files[0];
    if (!file) return;
    const table = csvTableSel.value;
    const { rows, errors } = csvToRows(table, await readText(file));
    if (!errors.length) errors.push(...(await checkRefs(table, rows)));
    const fields = SCHEMA[table].fields;
    csvPreview.append(
      h('p', {}, `${rows.length.toLocaleString()} 行を読み込みました(先頭10行をプレビュー)`),
      h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, fields.map((f) => h('th', {}, f.label)))),
        h('tbody', {}, ...rows.slice(0, 10).map((r) => h('tr', {}, fields.map((f) => h('td', {}, String(r[f.key] ?? ''))))))),
    );
    if (errors.length) {
      csvPreview.append(
        h('p', { class: 'error' }, `エラーが ${errors.length} 件あるため取り込めません:`),
        h('ul', {}, ...errors.slice(0, 20).map((e) => h('li', {}, e))),
      );
      return;
    }
    csvPreview.append(
      h('p', { class: 'note' }, '同じキーの行は上書き、ない行は追加されます(既存の他の行は消えません)。'),
      h('button', {
        onclick: async () => {
          setStatus('取り込み中…');
          try {
            await putMany(table, rows);
            await recordChange(table, 'CSV取り込み', null, { file: file.name, rows: rows.length });
            setStatus(`${SCHEMA[table].label}を ${rows.length.toLocaleString()} 行取り込みました`);
            csvPreview.replaceChildren();
            csvFile.value = '';
          } catch (e) {
            setStatus(`取り込みに失敗しました: ${e.message}`);
          }
        },
      }, '取り込む'),
    );
  });
  csvTableSel.addEventListener('change', () => { csvPreview.replaceChildren(); csvFile.value = ''; });

  const csvExportSel = h('select', {}, ...Object.keys(SCHEMA).map((k) => h('option', { value: k }, `${SCHEMA[k].label} (${k})`)));

  out.append(
    h('h3', {}, 'JSONバックアップ'),
    h('p', { class: 'note' }, 'ブラウザ内のデータの控えを兼ねます。すべてのテーブルを書き出します。'),
    h('p', {}, h('button', {
      onclick: async () => {
        await openDb();
        const tables = {};
        for (const k of Object.keys(STORES)) tables[k] = await getAll(k);
        download(`haiin-backup-${stamp()}.json`, toBackupJson(tables), 'application/json');
      },
    }, 'JSONを書き出す')),
    h('p', {}, 'JSONを取り込む: ', jsonFile),
    jsonPreview,
    h('h3', {}, 'CSV 書き出し'),
    h('p', {}, csvExportSel, ' ', h('button', {
      onclick: async () => {
        const k = csvExportSel.value;
        download(`haiin-${k}-${stamp()}.csv`, toCsv(k, await getAll(k)), 'text/csv');
      },
    }, 'CSVを書き出す')),
    h('h3', {}, 'CSV 取り込み'),
    h('p', { class: 'note' }, '1行目は見出し行です。書き出したCSVと同じ見出し(日本語または英語のキー)で作ってください。配員ルール・配員はJSONで取り込みます。'),
    h('p', {}, csvTableSel, ' ', csvFile),
    csvPreview,
  );
  root.replaceChildren(h('h2', {}, 'インポート / エクスポート'), out);
}
