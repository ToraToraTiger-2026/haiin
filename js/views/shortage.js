import { getAll, getAllByIndex } from '../db.js';
import {
  buildCapMap, capacityOf, dayKey, freeByMemberMonth, freeOf, gapByMonth, loadByMemberDay, shortageByCell, teamFreeByCell,
} from '../calc.js';
import { eachDay, monthEnd, monthStart } from '../dates.js';
import { loadPeriodContext, periodSelect } from '../periodctx.js';
import { buildShortageRows, downloadShortageCsv } from '../report.js';
import { getScenario } from '../state.js';
import { fmt, h, openDialog } from '../ui.js';

const st = { onlyShort: false };

export async function render(root) {
  const sid = getScenario();
  const pc = await loadPeriodContext();
  const reload = () => render(root);
  if (!pc.period) {
    root.replaceChildren(h('h2', {}, '不足ビュー'), h('p', {}, '期が登録されていません。「データ」でダミーデータを生成するか、「マスタ」で期を登録してください。'));
    return;
  }
  const [members, clients, demand, allocs, teams, capRows] = await Promise.all([
    getAll('members'), getAll('clients'), getAllByIndex('current_demand', 'scenario_id', sid),
    getAllByIndex('allocations', 'scenario_id', sid), getAllByIndex('team_members', 'scenario_id', sid), getAll('capacity'),
  ]);
  members.sort((a, b) => (a.member_id < b.member_id ? -1 : 1));
  clients.sort((a, b) => (a.client_id < b.client_id ? -1 : 1));
  const { months } = pc;
  const capMap = buildCapMap(capRows);
  const loads = loadByMemberDay(allocs);
  const shortMap = shortageByCell(demand, allocs);
  const freeMM = freeByMemberMonth(members, loads, capMap, months);
  const clientIds = clients.map((c) => c.client_id);
  const teamFree = teamFreeByCell(teams, freeMM, clientIds, months);
  const gap = gapByMonth(shortMap, freeMM, months);
  const memberName = new Map(members.map((m) => [m.member_id, m]));

  const hasDemand = (c) => months.some((t) => shortMap.has(`${c}|${t}`));
  const rowsOf = clients.filter((c) => hasDemand(c.client_id))
    .filter((c) => !st.onlyShort || months.some((t) => (shortMap.get(`${c.client_id}|${t}`)?.short ?? 0) > 0));

  const monthTotal = months.map(() => 0);
  const body = rowsOf.map((c) => {
    let rowShort = 0;
    const tds = months.map((t, i) => {
      const s = shortMap.get(`${c.client_id}|${t}`);
      if (!s) return h('td', { class: 'cell dim' }, '–');
      rowShort += s.short;
      monthTotal[i] += s.short;
      return h('td', {
        class: `cell${s.short > 0 ? ' over' : ''}`,
        onclick: () => openDetail(c, t, s),
      },
      h('div', {}, s.short > 0 ? `不足 ${fmt(s.short)}` : '充足'),
      h('div', { class: 'sub' }, `必要 ${fmt(s.demand)} / 配員 ${fmt(s.alloc)}`),
      h('div', { class: 'sub' }, `チーム内の空き ${fmt(teamFree.get(`${c.client_id}|${t}`) ?? 0)}`));
    });
    return h('tr', {}, h('th', { class: 'sticky' }, c.name), ...tds,
      h('td', { class: `total-col${rowShort > 0 ? ' over' : ''}` }, rowShort > 0 ? `不足 ${fmt(rowShort)}` : '–'));
  });

  const grand = monthTotal.reduce((a, b) => a + b, 0);
  const summaryRows = [
    h('tr', { class: 'total' }, h('th', { class: 'sticky' }, '不足合計'),
      ...monthTotal.map((v) => h('td', { class: v > 0 ? 'over' : '' }, fmt(v))),
      h('td', { class: grand > 0 ? 'over' : '' }, fmt(grand))),
    h('tr', { class: 'total' }, h('th', { class: 'sticky' }, '空き合計(全メンバー)'),
      ...months.map((t) => h('td', {}, fmt(gap.get(t).free))), h('td', {}, '')),
    h('tr', { class: 'total' }, h('th', { class: 'sticky', title: '不足の合計 − 空きの合計。正なら、その月は他チームへの応援が必要' }, 'Gap(不足−空き)'),
      ...months.map((t) => {
        const g = gap.get(t).gap;
        return h('td', { class: g > 0 ? 'over' : '' }, `${g > 0 ? '+' : ''}${fmt(g)}`);
      }), h('td', {}, '')),
  ];

  // ---- セルの内訳: メンバー別、さらに日単位 ----
  function openDetail(c, t, s) {
    const days = eachDay(monthStart(t), monthEnd(t));
    const forClient = allocs.filter((a) => a.client_id === c.client_id && a.date >= days[0] && a.date <= days[days.length - 1]);
    const ids = new Set([...teams.filter((x) => x.client_id === c.client_id).map((x) => x.member_id), ...forClient.map((a) => a.member_id)]);
    const teamIds = new Set(teams.filter((x) => x.client_id === c.client_id).map((x) => x.member_id));
    const roleOf = new Map(teams.filter((x) => x.client_id === c.client_id).map((x) => [x.member_id, x.role]));

    const memberBlock = (id) => {
      const m = memberName.get(id);
      if (!m) return null;
      const mine = forClient.filter((a) => a.member_id === id);
      const hours = mine.reduce((sum, a) => sum + a.hours, 0);
      const free = freeMM.get(`${id}|${t}`) ?? 0;
      const byDate = new Map(mine.map((a) => [a.date, a.hours]));
      return h('details', {},
        h('summary', {}, `${m.name}${teamIds.has(id) ? '' : '(チーム外)'}${roleOf.get(id) ? ` [${roleOf.get(id)}]` : ''} — 配員 ${fmt(hours)} / 空き ${fmt(free)}`),
        h('table', { class: 'list' },
          h('thead', {}, h('tr', {}, ['日付', 'このクライアント', '上限', '全体の配員', '空き'].map((x) => h('th', {}, x)))),
          h('tbody', {}, ...days.map((d) => {
            const L = loads.get(dayKey(id, d)) ?? 0;
            const cap = capacityOf(m, d, capMap);
            return h('tr', { class: cap === 0 && L === 0 ? 'dim' : '' },
              h('td', {}, d.slice(5)), h('td', { class: 'num' }, byDate.has(d) ? fmt(byDate.get(d)) : ''),
              h('td', { class: 'num' }, fmt(cap)), h('td', { class: 'num' }, fmt(L)), h('td', { class: 'num' }, fmt(freeOf(L, cap))));
          }))));
    };

    const order = [...ids].sort();
    const dlg = openDialog(
      h('h3', {}, `${c.name} ${t}`),
      h('p', {}, `必要 ${fmt(s.demand)} / 配員 ${fmt(s.alloc)} / `, h('span', { class: s.short > 0 ? 'over-text' : '' }, `不足 ${fmt(s.short)}`),
        ` / チーム内の空き ${fmt(teamFree.get(`${c.client_id}|${t}`) ?? 0)}`),
      h('p', { class: 'note' }, 'メンバーを開くと、日ごとの配員と空きが見られます。空きは、その人の全クライアントを合わせた上限との差です。'),
      ...order.map(memberBlock),
      h('p', { class: 'dialog-actions' }, h('button', { class: 'danger-outline', onclick: () => dlg.close() }, '閉じる')),
    );
  }

  root.replaceChildren(
    h('h2', {}, '不足ビュー'),
    h('p', { class: 'toolbar no-print' },
      periodSelect(pc, reload),
      h('label', {}, h('input', { type: 'checkbox', checked: st.onlyShort, onchange: (e) => { st.onlyShort = e.target.checked; reload(); } }), ' 不足のあるクライアントだけ'),
      h('button', { class: 'danger-outline', onclick: () => downloadShortageCsv(buildShortageRows({ clients, months, shortMap, teamFree, clientIds: rowsOf.map((c) => c.client_id) }), `不足_${pc.period.name}`) }, 'CSV出力'),
      h('button', { class: 'danger-outline', onclick: () => window.print() }, '印刷')),
    h('p', { class: 'note' }, `${pc.period.name}、${rowsOf.length} クライアント。単位は時間。赤は不足がある所です。セルをクリックするとメンバー別・日単位の内訳が見られます。`),
    h('div', { class: 'scroll' },
      h('table', { class: 'grid wide shortage' },
        h('thead', {}, h('tr', {}, h('th', { class: 'sticky' }, 'クライアント'), ...months.map((t) => h('th', {}, t)), h('th', {}, '合計'))),
        h('tbody', {}, ...body, ...summaryRows))),
  );
}
