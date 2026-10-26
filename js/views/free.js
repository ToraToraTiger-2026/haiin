import { getAll, getAllByIndex } from '../db.js';
import { buildCapMap, capacityOf, dayKey, freeOf, loadByMemberDay, overOf } from '../calc.js';
import { addDays, eachDay, isValidDate, today, weekStart } from '../dates.js';
import { getScenario } from '../state.js';
import { fmt, h, openDialog } from '../ui.js';

const WEEKS = 13;
const DAYS = 28;
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const st = { mode: 'week', start: null, client: '' };

const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

export async function render(root) {
  if (!st.start) st.start = weekStart(today());
  const sid = getScenario();
  const [members, clients, allocs, capRows, teams] = await Promise.all([
    getAll('members'), getAll('clients'), getAllByIndex('allocations', 'scenario_id', sid), getAll('capacity'),
    getAllByIndex('team_members', 'scenario_id', sid),
  ]);
  members.sort((a, b) => (a.member_id < b.member_id ? -1 : 1));
  clients.sort((a, b) => (a.client_id < b.client_id ? -1 : 1));
  const capMap = buildCapMap(capRows);
  const loads = loadByMemberDay(allocs);
  const clientName = new Map(clients.map((c) => [c.client_id, c.name]));

  const start = st.mode === 'week' ? weekStart(st.start) : st.start;
  // 列: 週表示は月曜〜日曜の7日、日表示は1日
  const cols = st.mode === 'week'
    ? Array.from({ length: WEEKS }, (_, i) => {
        const from = addDays(start, i * 7);
        return { label: `${md(from)}〜`, days: eachDay(from, addDays(from, 6)) };
      })
    : eachDay(start, addDays(start, DAYS - 1)).map((d) => ({
        label: `${md(d)}(${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]})`,
        days: [d],
      }));

  const teamIds = st.client ? new Set(teams.filter((t) => t.client_id === st.client).map((t) => t.member_id)) : null;
  const shown = teamIds ? members.filter((m) => teamIds.has(m.member_id)) : members;

  function measure(m, days) {
    let free = 0, over = 0;
    for (const d of days) {
      const L = loads.get(dayKey(m.member_id, d)) ?? 0;
      const cap = capacityOf(m, d, capMap);
      free += freeOf(L, cap);
      over += overOf(L, cap);
    }
    return { free, over };
  }

  const totals = cols.map(() => ({ free: 0, over: 0 }));
  const body = shown.map((m) =>
    h('tr', {}, h('th', { class: 'sticky' }, m.name),
      ...cols.map((c, i) => {
        const { free, over } = measure(m, c.days);
        totals[i].free += free;
        totals[i].over += over;
        return h('td', {
          class: `cell${over > 0 ? ' over' : ''}${free === 0 && over === 0 ? ' dim' : ''}`,
          title: `空き ${fmt(free)} 時間${over > 0 ? ` / 超過 ${fmt(over)} 時間` : ''}`,
          onclick: () => openDetail(m, c),
        }, free === 0 && over === 0 ? '–' : fmt(free), over > 0 ? h('div', { class: 'sub' }, `超過 ${fmt(over)}`) : null);
      })));

  const totalRow = h('tr', { class: 'total' }, h('th', { class: 'sticky' }, '合計'),
    ...totals.map((t) => h('td', { class: t.over > 0 ? 'over' : '' }, fmt(t.free), t.over > 0 ? h('div', { class: 'sub' }, `超過 ${fmt(t.over)}`) : null)));

  function openDetail(m, col) {
    const rows = col.days.map((d) => {
      const L = loads.get(dayKey(m.member_id, d)) ?? 0;
      const cap = capacityOf(m, d, capMap);
      const parts = allocs.filter((a) => a.member_id === m.member_id && a.date === d)
        .map((a) => `${clientName.get(a.client_id) ?? a.client_id} ${fmt(a.hours)}`);
      return { d, L, cap, free: freeOf(L, cap), over: overOf(L, cap), parts };
    });
    const dlg = openDialog(
      h('h3', {}, `${m.name} ${col.label}`),
      h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, ['日付', '上限', '配員', '空き', '超過', '内訳'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...rows.map((r) => h('tr', { class: r.cap === 0 && r.L === 0 ? 'dim' : '' },
          h('td', {}, `${md(r.d)}(${WD[new Date(`${r.d}T00:00:00Z`).getUTCDay()]})`),
          h('td', { class: 'num' }, fmt(r.cap)), h('td', { class: 'num' }, fmt(r.L)), h('td', { class: 'num' }, fmt(r.free)),
          h('td', { class: `num${r.over > 0 ? ' over-text' : ''}` }, r.over > 0 ? fmt(r.over) : ''),
          h('td', {}, r.parts.join(' / ')))))),
      h('p', { class: 'dialog-actions' }, h('button', { class: 'danger-outline', onclick: () => dlg.close() }, '閉じる')),
    );
  }

  const step = st.mode === 'week' ? WEEKS * 7 : DAYS;
  const reload = () => render(root);
  root.replaceChildren(
    h('h2', {}, '空きビュー'),
    h('p', { class: 'toolbar' },
      h('select', { value: st.mode, onchange: (e) => { st.mode = e.target.value; reload(); } },
        h('option', { value: 'week' }, '週ごと'), h('option', { value: 'day' }, '日ごと')),
      h('select', { value: st.client, onchange: (e) => { st.client = e.target.value; reload(); } },
        h('option', { value: '' }, 'すべてのメンバー'),
        ...clients.map((c) => h('option', { value: c.client_id }, `${c.name} のチームのみ`))),
      h('button', { class: 'danger-outline', onclick: () => { st.start = addDays(start, -step); reload(); } }, '◀ 前へ'),
      h('button', { class: 'danger-outline', onclick: () => { st.start = weekStart(today()); reload(); } }, '今週'),
      h('button', { class: 'danger-outline', onclick: () => { st.start = addDays(start, step); reload(); } }, '次へ ▶'),
      h('input', { type: 'date', value: start, onchange: (e) => { if (isValidDate(e.target.value)) { st.start = e.target.value; reload(); } } }),
    ),
    h('p', { class: 'note' }, '数字は空き時間(上限 − 配員)。赤は上限超過がある期間で、「超過」はその時間です。セルをクリックすると日ごとの内訳が見られます。'),
    h('div', { class: 'scroll' },
      h('table', { class: 'grid wide' },
        h('thead', {}, h('tr', {}, h('th', { class: 'sticky' }, 'メンバー'), ...cols.map((c) => h('th', {}, c.label)))),
        h('tbody', {}, ...body, totalRow))),
  );
}
