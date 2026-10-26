import { PROD, getAll, getAllByIndex } from '../db.js';
import { buildCapMap, freeByMemberMonth, gapByMonth, loadByMemberDay, shortageByCell, teamFreeByCell } from '../calc.js';
import { loadPeriodContext, periodSelect } from '../periodctx.js';
import { buildShortageRows, downloadGapCsv, downloadShortageCsv } from '../report.js';
import { getScenario } from '../state.js';
import { fmt, h } from '../ui.js';

const st = { from: '', to: '', clients: [], onlyShort: true };

export async function render(root) {
  const sid = getScenario();
  const pc = await loadPeriodContext();
  const reload = () => render(root);
  if (!pc.period) {
    root.replaceChildren(h('h2', {}, '応援要請レポート'), h('p', {}, '期が登録されていません。'));
    return;
  }
  const [members, clients, demand, allocs, teams, capRows] = await Promise.all([
    getAll('members'), getAll('clients'), getAllByIndex('current_demand', 'scenario_id', sid),
    getAllByIndex('allocations', 'scenario_id', sid), getAllByIndex('team_members', 'scenario_id', sid), getAll('capacity'),
  ]);
  clients.sort((a, b) => (a.client_id < b.client_id ? -1 : 1));

  const all = pc.months;
  if (!all.includes(st.from)) st.from = all[0];
  if (!all.includes(st.to)) st.to = all[all.length - 1];
  const months = all.filter((t) => t >= st.from && t <= st.to);
  const chosen = st.clients.filter((id) => clients.some((c) => c.client_id === id));
  const clientIds = (chosen.length ? chosen : clients.map((c) => c.client_id));

  const shortMap = shortageByCell(demand, allocs);
  const freeMM = freeByMemberMonth(members, loadByMemberDay(allocs), buildCapMap(capRows), months);
  const teamFree = teamFreeByCell(teams, freeMM, clients.map((c) => c.client_id), months);
  // Gap は選んだクライアントの不足だけで数える(空きは全メンバーの合計)
  const scoped = new Map([...shortMap].filter(([, s]) => clientIds.includes(s.client_id)));
  const gap = gapByMonth(scoped, freeMM, months);
  const rows = buildShortageRows({ clients, months, shortMap, teamFree, clientIds, onlyShort: st.onlyShort });

  const monthSel = (key) => h('select', { value: st[key], onchange: (e) => { st[key] = e.target.value; reload(); } },
    ...all.map((t) => h('option', { value: t }, t)));
  const clientSel = h('select', {
    multiple: true, size: '8', onchange: (e) => { st.clients = [...e.target.selectedOptions].map((o) => o.value); reload(); },
  }, ...clients.map((c) => h('option', { value: c.client_id, selected: chosen.includes(c.client_id) }, c.name)));

  const name = `応援要請_${pc.period.name}_${months[0]}〜${months[months.length - 1]}`;
  const total = rows.reduce((s, r) => s + r.short, 0);
  const totalSupport = rows.reduce((s, r) => s + r.support, 0);

  root.replaceChildren(
    h('h2', {}, '応援要請レポート'),
    h('div', { class: 'toolbar no-print' },
      periodSelect(pc, reload), '期間 ', monthSel('from'), '〜', monthSel('to'),
      h('label', {}, h('input', { type: 'checkbox', checked: st.onlyShort, onchange: (e) => { st.onlyShort = e.target.checked; reload(); } }), ' 不足のある行だけ'),
      h('button', { class: 'danger-outline', onclick: () => downloadShortageCsv(rows, name) }, '不足一覧をCSV出力'),
      h('button', { class: 'danger-outline', onclick: () => downloadGapCsv(months, gap, `${name}_Gap`) }, 'GapをCSV出力'),
      h('button', { class: 'danger-outline', onclick: () => window.print() }, '印刷')),
    h('div', { class: 'no-print' }, h('p', { class: 'note' }, 'クライアントで絞る場合は、下の一覧から選んでください(Ctrl キーを押しながら複数選択。何も選ばなければ全クライアント)。'), clientSel),
    h('h3', {}, `不足一覧(${pc.period.name} ${months[0]}〜${months[months.length - 1]}、${scenarioLabel(sid)})`),
    h('p', {}, `不足の合計 ${fmt(total)} 時間 / うちチーム内の空きでは埋まらない目安 ${fmt(totalSupport)} 時間`),
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['クライアント', '月', '必要', '配員済み', '不足', 'チーム内の空き', 'チーム外の応援が必要な目安'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows.map((r) => h('tr', {},
        h('td', {}, r.client), h('td', {}, r.month),
        h('td', { class: 'num' }, fmt(r.demand)), h('td', { class: 'num' }, fmt(r.alloc)),
        h('td', { class: `num${r.short > 0 ? ' over-text' : ''}` }, fmt(r.short)),
        h('td', { class: 'num' }, fmt(r.teamFree)),
        h('td', { class: `num${r.support > 0 ? ' over-text' : ''}` }, fmt(r.support)))))),
    h('p', { class: 'note' }, 'チーム内の空きは、同じメンバーが複数のクライアントのチームに入っていると重複して数えられるため、応援が必要な時間は目安です。'),
    h('h3', {}, '月ごとの Gap(不足の合計 − 空きの合計)'),
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['月', '不足の合計', '空きの合計(全メンバー)', 'Gap'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...months.map((t) => {
        const g = gap.get(t);
        return h('tr', {}, h('td', {}, t), h('td', { class: 'num' }, fmt(g.short)), h('td', { class: 'num' }, fmt(g.free)),
          h('td', { class: `num${g.gap > 0 ? ' over-text' : ''}` }, `${g.gap > 0 ? '+' : ''}${fmt(g.gap)}`));
      }))),
    h('p', { class: 'note' }, 'Gap が正の月は、チーム全体で不足が空きを上回っており、他チームへの応援要請が必要です。'),
  );
}

const scenarioLabel = (sid) => (sid === PROD ? '本番' : '下書き');
