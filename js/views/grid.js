import { PROD, deleteByIndex, getAll, getAllByIndex, putMany } from '../db.js';
import { deleteLogged, putLogged } from '../changelog.js';
import { buildCapMap, capacityOf, dayKey, loadByMemberDay, overOf, shortageByCell } from '../calc.js';
import { addDays, eachDay, isValidDate, today, weekStart } from '../dates.js';
import { checkOverload, expandRule, findOverlap, newRuleId } from '../expand.js';
import { getScenario } from '../state.js';
import { field, fmt, h, openDialog, setStatus } from '../ui.js';

const DAYS = 28;
const WD = ['日', '月', '火', '水', '木', '金', '土'];
let viewStart = null;
const ruleFilter = { member: '', client: '' };
const RULE_LIMIT = 200;

export async function render(root) {
  if (!viewStart) viewStart = weekStart(today());
  const sid = getScenario();
  const isDraft = sid !== PROD;
  const [members, clients, rules, allocs, capRows, teams, demand, prodAllocs] = await Promise.all([
    getAll('members'),
    getAll('clients'),
    getAllByIndex('assignment_rules', 'scenario_id', sid),
    getAllByIndex('allocations', 'scenario_id', sid),
    getAll('capacity'),
    getAllByIndex('team_members', 'scenario_id', sid),
    getAllByIndex('current_demand', 'scenario_id', sid),
    isDraft ? getAllByIndex('allocations', 'scenario_id', PROD) : Promise.resolve([]),
  ]);
  members.sort((a, b) => (a.member_id < b.member_id ? -1 : 1));
  clients.sort((a, b) => (a.client_id < b.client_id ? -1 : 1));
  const prodLoads = isDraft ? loadByMemberDay(prodAllocs) : null;
  const ctx = {
    sid, members, clients, rules, allocs, teams, demand,
    capMap: buildCapMap(capRows),
    memberOf: new Map(members.map((m) => [m.member_id, m])),
    clientOf: new Map(clients.map((c) => [c.client_id, c])),
    reload: () => render(root),
  };

  const days = eachDay(viewStart, addDays(viewStart, DAYS - 1));
  const first = days[0];
  const last = days[days.length - 1];
  const loads = loadByMemberDay(allocs);
  const cell = new Map(); // メンバー|日付 → その日の配員行(表示範囲のみ)
  for (const a of allocs) {
    if (a.date < first || a.date > last) continue;
    const k = dayKey(a.member_id, a.date);
    if (!cell.has(k)) cell.set(k, []);
    cell.get(k).push(a);
  }

  const head = h('tr', {}, h('th', { class: 'sticky' }, 'メンバー'),
    ...days.map((d) => {
      const w = new Date(`${d}T00:00:00Z`).getUTCDay();
      return h('th', { class: w === 0 || w === 6 ? 'wk' : '' }, `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`, h('br'), WD[w]);
    }));

  const bodyRows = members.map((m) =>
    h('tr', {},
      h('th', { class: 'sticky' }, m.name),
      ...days.map((d) => {
        const k = dayKey(m.member_id, d);
        const load = loads.get(k) ?? 0;
        const cap = capacityOf(m, d, ctx.capMap);
        const over = overOf(load, cap);
        const cls = over > 0 ? 'over' : cap === 0 ? 'zero' : '';
        // 下書きでは、本番と配員が違う日を青枠で示す
        const diff = prodLoads && (prodLoads.get(k) ?? 0) !== load ? ' diff' : '';
        return h('td', {
          class: `cell ${cls}${diff}`,
          title: `上限 ${fmt(cap)} / 配員 ${fmt(load)}${over > 0 ? ` / 超過 ${fmt(over)}` : ''}`,
          onclick: () => openDayDialog(ctx, m, d, cap, load),
        }, load > 0 ? fmt(load) : '');
      })));

  const dateJump = h('input', { type: 'date', value: viewStart, onchange: (e) => {
    if (isValidDate(e.target.value)) { viewStart = e.target.value; ctx.reload(); }
  } });

  const ruleSection = h('div');

  root.replaceChildren(
    h('h2', {}, '配員グリッド'),
    h('p', { class: 'toolbar' },
      h('button', { class: 'danger-outline', onclick: () => { viewStart = addDays(viewStart, -DAYS); ctx.reload(); } }, '◀ 前へ'),
      h('button', { class: 'danger-outline', onclick: () => { viewStart = weekStart(today()); ctx.reload(); } }, '今週'),
      h('button', { class: 'danger-outline', onclick: () => { viewStart = addDays(viewStart, DAYS); ctx.reload(); } }, '次へ ▶'),
      dateJump,
      h('button', { onclick: () => openRuleDialog(ctx, { start: first, end: first }) }, '配員を追加'),
    ),
    h('p', { class: 'note' }, `${first} 〜 ${last}。数字はその日の配員合計(時間)。`,
      h('span', { class: 'legend over' }, '赤: 上限超過'), h('span', { class: 'legend zero' }, '灰: 上限0(休日・休暇)'),
      isDraft ? h('span', { class: 'legend diff' }, '青枠: 本番と配員が違う日') : null,
      ' セルをクリックすると内訳が見られます。'),
    h('div', { class: 'scroll' }, h('table', { class: 'grid' }, h('thead', {}, head), h('tbody', {}, ...bodyRows))),
    h('h3', {}, '配員ルール(入力の元になる期間指定)'),
    ruleSection,
  );
  paintRules(ctx, ruleSection);
}

// ---------- 配員ルール一覧 ----------
function paintRules(ctx, section) {
  const memberSel = h('select', { value: ruleFilter.member, onchange: (e) => { ruleFilter.member = e.target.value; paintRules(ctx, section); } },
    h('option', { value: '' }, 'すべてのメンバー'),
    ...ctx.members.map((m) => h('option', { value: m.member_id }, m.name)));
  const clientSel = h('select', { value: ruleFilter.client, onchange: (e) => { ruleFilter.client = e.target.value; paintRules(ctx, section); } },
    h('option', { value: '' }, 'すべてのクライアント'),
    ...ctx.clients.map((c) => h('option', { value: c.client_id }, c.name)));

  const shown = ctx.rules
    .filter((r) => (!ruleFilter.member || r.member_id === ruleFilter.member) && (!ruleFilter.client || r.client_id === ruleFilter.client))
    .sort((a, b) => (a.client_id + a.member_id + a.start < b.client_id + b.member_id + b.start ? -1 : 1));

  section.replaceChildren(
    h('p', {}, memberSel, ' ', clientSel, ` ${shown.length.toLocaleString()} 件${shown.length > RULE_LIMIT ? `(先頭 ${RULE_LIMIT} 件を表示)` : ''}`),
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['クライアント', 'メンバー', '開始日', '終了日', '時間/日', '土日', 'ロック', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...shown.slice(0, RULE_LIMIT).map((r) =>
        h('tr', {},
          h('td', {}, ctx.clientOf.get(r.client_id)?.name ?? r.client_id),
          h('td', {}, ctx.memberOf.get(r.member_id)?.name ?? r.member_id),
          h('td', {}, r.start), h('td', {}, r.end),
          h('td', { class: 'num' }, fmt(r.hours_per_day)),
          h('td', {}, r.include_weekend ? '含む' : ''),
          h('td', {}, h('input', {
            type: 'checkbox', checked: r.locked, title: 'ロックすると、自動提案で動かしません',
            onchange: async (e) => {
              await putLogged('assignment_rules', { ...r, locked: e.target.checked });
              setStatus(e.target.checked ? 'ロックしました' : 'ロックを外しました');
              ctx.reload();
            },
          })),
          h('td', {},
            h('button', { class: 'danger-outline', onclick: () => openRuleDialog(ctx, { rule: r }) }, '編集'), ' ',
            h('button', { class: 'danger-outline', onclick: () => deleteRule(ctx, r) }, '削除')),
        )))),
  );
}

async function deleteRule(ctx, r) {
  if (!confirm('この配員ルールと、そこから展開された日ごとの配員を削除します。よろしいですか?')) return;
  await deleteByIndex('allocations', 'rule_id', r.rule_id);
  await deleteLogged('assignment_rules', r.rule_id);
  setStatus('削除しました');
  ctx.reload();
}

// ---------- セルの内訳 ----------
function openDayDialog(ctx, member, date, cap, load) {
  const rows = ctx.allocs.filter((a) => a.member_id === member.member_id && a.date === date);
  const dlg = openDialog(
    h('h3', {}, `${member.name} ${date}`),
    h('p', {}, `上限 ${fmt(cap)} 時間 / 配員 ${fmt(load)} 時間`, overOf(load, cap) > 0 ? h('span', { class: 'over-text' }, ` (超過 ${fmt(overOf(load, cap))} 時間)`) : ''),
    rows.length
      ? h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, ['クライアント', '時間', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...rows.map((a) => h('tr', {},
          h('td', {}, ctx.clientOf.get(a.client_id)?.name ?? a.client_id),
          h('td', { class: 'num' }, fmt(a.hours)),
          h('td', {}, h('button', { class: 'danger-outline', onclick: () => {
            const rule = ctx.rules.find((r) => r.rule_id === a.rule_id);
            if (!rule) { setStatus('元のルールが見つかりません'); return; }
            dlg.close();
            openRuleDialog(ctx, { rule });
          } }, 'ルールを編集'))))))
      : h('p', { class: 'note' }, 'この日の配員はありません。'),
    h('p', { class: 'dialog-actions' },
      h('button', { onclick: () => { dlg.close(); openRuleDialog(ctx, { member_id: member.member_id, start: date, end: date }); } }, 'この人に配員を追加'),
      h('button', { class: 'danger-outline', onclick: () => dlg.close() }, '閉じる')),
  );
}

// ---------- 期間指定ダイアログ ----------
function openRuleDialog(ctx, preset = {}) {
  const editing = preset.rule ?? null;
  const ruleId = editing?.rule_id ?? newRuleId();
  const init = {
    client_id: editing?.client_id ?? preset.client_id ?? ctx.clients.find((c) => c.active)?.client_id ?? '',
    member_id: editing?.member_id ?? preset.member_id ?? '',
    start: editing?.start ?? preset.start ?? '',
    end: editing?.end ?? preset.end ?? '',
    hours: editing?.hours_per_day ?? 4,
  };
  // メンバーを先に指定された場合は、そのメンバーがチームに入っている最初のクライアントを選ぶ
  if (!editing && init.member_id && !ctx.teams.some((t) => t.client_id === init.client_id && t.member_id === init.member_id)) {
    const t = ctx.teams.find((x) => x.member_id === init.member_id);
    if (t) init.client_id = t.client_id;
  }

  const clientSel = h('select', {},
    ...ctx.clients.filter((c) => c.active || c.client_id === init.client_id)
      .map((c) => h('option', { value: c.client_id }, `${c.client_id} ${c.name}`)));
  clientSel.value = init.client_id;
  const memberSel = h('select', {});
  const startIn = h('input', { type: 'date', value: init.start });
  const endIn = h('input', { type: 'date', value: init.end });
  const hoursIn = h('input', { type: 'number', step: '0.5', min: '0', value: init.hours, class: 'narrow' });
  const weekendIn = h('input', { type: 'checkbox', checked: editing?.include_weekend ?? false });
  const lockIn = h('input', { type: 'checkbox', checked: editing?.locked ?? false });
  const msgs = h('div');
  const impact = h('div');
  const saveBtn = h('button', {}, '保存');
  const shortBefore = shortageByCell(ctx.demand, ctx.allocs);

  function fillMembers(selected) {
    const ids = new Set(ctx.teams.filter((t) => t.client_id === clientSel.value).map((t) => t.member_id));
    if (selected) ids.add(selected);
    memberSel.replaceChildren(...ctx.members.filter((m) => ids.has(m.member_id)).map((m) => h('option', { value: m.member_id }, m.name)));
    if (selected) memberSel.value = selected;
  }

  function readRule() {
    return {
      rule_id: ruleId,
      scenario_id: ctx.sid,
      member_id: memberSel.value,
      client_id: clientSel.value,
      start: startIn.value,
      end: endIn.value,
      hours_per_day: Number(hoursIn.value),
      include_weekend: weekendIn.checked,
      locked: lockIn.checked,
    };
  }

  function refresh() {
    const r = readRule();
    const errors = [];
    const warns = [];
    if (!memberSel.value) errors.push('このクライアントにはチーム編成がありません。先にマスタの「チーム編成」でメンバーを選んでください。');
    if (!isValidDate(r.start) || !isValidDate(r.end)) errors.push('開始日と終了日を入力してください。');
    else if (r.start > r.end) errors.push('終了日は開始日以降にしてください。');
    if (!(r.hours_per_day > 0)) errors.push('時間/日は0より大きい値にしてください。');
    if (!errors.length) {
      const dup = findOverlap(r, ctx.rules);
      if (dup) errors.push(`同じメンバー・クライアントで期間が重なる配員ルールがあります(${dup.start}〜${dup.end})。そちらを編集してください。`);
      else {
        const over = checkOverload(r, ctx.allocs, ctx.memberOf.get(r.member_id), ctx.capMap);
        if (over.length) {
          warns.push(`上限を超える日が ${over.length} 日あります(保存はできます)`);
          warns.push(...over.slice(0, 8).map((o) => `${o.date}: 合計 ${fmt(o.load)} 時間 / 上限 ${fmt(o.cap)} 時間(超過 ${fmt(o.over)})`));
          if (over.length > 8) warns.push(`ほか ${over.length - 8} 日`);
        }
      }
    }
    msgs.replaceChildren(
      ...errors.map((e) => h('p', { class: 'error' }, e)),
      warns.length ? h('div', { class: 'warn' }, ...warns.map((w) => h('div', {}, w))) : null,
    );
    saveBtn.disabled = errors.length > 0;
    paintImpact(errors.length === 0 ? r : null);
  }

  // 保存した場合に、クライアント×月の配員と不足がどう変わるか(変わる所だけ)
  function paintImpact(r) {
    if (!r) { impact.replaceChildren(); return; }
    const after = shortageByCell(ctx.demand, ctx.allocs.filter((a) => a.rule_id !== r.rule_id).concat(expandRule(r)));
    const zero = { demand: 0, alloc: 0, short: 0 };
    const rows = [];
    for (const k of new Set([...shortBefore.keys(), ...after.keys()])) {
      const b = shortBefore.get(k) ?? zero;
      const a = after.get(k) ?? { ...b, alloc: 0, short: b.demand };
      if (a.alloc !== b.alloc || a.short !== b.short) rows.push({ a, b });
    }
    impact.replaceChildren(
      h('h4', {}, '保存した場合の影響(クライアント×月)'),
      rows.length === 0 ? h('p', { class: 'note' }, '配員・不足は変わりません。') : h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, ['クライアント', '月', '必要', '配員', '不足'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...rows.slice(0, 12).map(({ a, b }) => h('tr', { class: 'diff-row' },
          h('td', {}, ctx.clientOf.get(a.client_id)?.name ?? a.client_id), h('td', {}, a.month),
          h('td', { class: 'num' }, fmt(a.demand)),
          h('td', { class: 'num' }, `${fmt(b.alloc)} → ${fmt(a.alloc)}`),
          h('td', { class: `num${a.short > 0 ? ' over-text' : ''}` }, `${fmt(b.short)} → ${fmt(a.short)}`))))),
      rows.length > 12 ? h('p', { class: 'note' }, `ほか ${rows.length - 12} 件`) : null,
    );
  }

  clientSel.addEventListener('change', () => { fillMembers(''); refresh(); });
  for (const el of [memberSel, startIn, endIn, hoursIn, weekendIn]) el.addEventListener('input', refresh);

  saveBtn.addEventListener('click', async () => {
    const rule = readRule();
    await deleteByIndex('allocations', 'rule_id', rule.rule_id);
    await putLogged('assignment_rules', rule);
    await putMany('allocations', expandRule(rule));
    dlg.close();
    setStatus('配員を保存しました');
    ctx.reload();
  });

  fillMembers(init.member_id);
  const dlg = openDialog(
    h('h3', {}, editing ? '配員ルールを編集' : '配員を追加'),
    field('クライアント', clientSel),
    field('メンバー(このクライアントのチーム)', memberSel),
    field('開始日', startIn),
    field('終了日', endIn),
    field('時間/日', hoursIn),
    h('label', { class: 'field inline' }, weekendIn, h('span', {}, '土日も含める')),
    h('label', { class: 'field inline' }, lockIn, h('span', {}, 'ロック(自動提案で動かさない)')),
    msgs,
    impact,
    h('p', { class: 'dialog-actions' }, saveBtn, h('button', { class: 'danger-outline', onclick: () => dlg.close() }, 'キャンセル')),
  );
  refresh();
}
