import { getAll } from '../db.js';
import { SCHEMA } from '../io.js';
import { h } from '../ui.js';

const LIMIT = 200;
const filter = { table: '', text: '' };

const short = (v) => {
  if (v == null) return '—';
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};

export async function render(root) {
  const logs = (await getAll('change_log')).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.log_id - a.log_id));
  const body = h('tbody');
  const info = h('p', { class: 'note' });

  function paint() {
    const t = filter.text.trim().toLowerCase();
    const rows = logs.filter(
      (l) =>
        (!filter.table || l.table === filter.table) &&
        (!t || `${l.actor} ${l.target_id}`.toLowerCase().includes(t)),
    );
    info.textContent = `${rows.length.toLocaleString()} 件${rows.length > LIMIT ? `(新しい順に先頭 ${LIMIT} 件を表示)` : ''}`;
    body.replaceChildren(
      ...rows.slice(0, LIMIT).map((l) =>
        h('tr', {},
          h('td', {}, l.at.replace('T', ' ').slice(0, 19)),
          h('td', {}, l.actor),
          h('td', {}, l.table),
          h('td', {}, l.target_id),
          h('td', { title: JSON.stringify(l.before) }, short(l.before)),
          h('td', { title: JSON.stringify(l.after) }, short(l.after)),
        ),
      ),
    );
  }

  const tableSel = h('select', {
    value: filter.table,
    onchange: (e) => { filter.table = e.target.value; paint(); },
  }, h('option', { value: '' }, 'すべてのテーブル'),
    ...Object.keys(SCHEMA).filter((k) => k !== 'change_log').map((k) => h('option', { value: k }, `${SCHEMA[k].label} (${k})`)));

  root.replaceChildren(
    h('h2', {}, '変更履歴'),
    h('p', {}, tableSel, ' ',
      h('input', {
        type: 'search',
        placeholder: '操作者・対象IDで絞り込み',
        value: filter.text,
        oninput: (e) => { filter.text = e.target.value; paint(); },
      })),
    info,
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['日時', '操作者', '対象テーブル', '対象ID', '変更前', '変更後'].map((t) => h('th', {}, t)))),
      body),
  );
  paint();
}
