// 配員案の自動提案(貪欲法)。最適解は保証しない。外部ソルバーは使わない。
//
// 不足の大きいクライアント×月から順に、チームメンバーの空きへ配員する。
// 目的 = w1×不足の解消量 − w2×現行配員からの変更量 − w3×メンバーの最大稼働率 を、
// 1回の配員ごとの評価で近似する:
//   採用の条件 : w1 − w2×KAPPA×(変更の大きさ) > 0(不足を埋める価値が、変更の手間を上回る)
//   候補の順位 : 上の値 − w3×MU×(配員後のそのメンバーの月の稼働率)
// 制約: 日ごとの配員は上限以内 / クライアントの月の配員は必要工数以内 / ロックした配員は動かさない。
// モードA: 既存配員は動かさず、空きだけで埋める。
// モードB: 加えて、必要工数を超えて配員されているクライアントの余剰分を、不足側へ付け替えてよい。
import { eachDay, monthEnd, monthStart } from './dates.js';
import { buildCapMap, capacityOf } from './calc.js';

const KAPPA = 0.25; // 変更量の重み付け(不足の解消より軽く扱う)
const MU = 0.5; // 稼働率の重み付け
const EPS = 1e-9;
const r6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * input:
 *   mode 'A'|'B', weights {w1,w2,w3}, allowOutsiders, fromDate(この日以降だけ動かす), months(対象月)
 *   members, capacity(上限の例外), teams, demand(現在の必要工数),
 *   lockedAllocs(ロックされた配員。動かさないが負荷には数える), allocs(動かしてよい配員)
 * 戻り値: {allocations(動かしてよい配員の最終形), teamsAdded, unresolved, stats}
 */
export function solve(input, onProgress = () => {}) {
  const { mode, weights, allowOutsiders, fromDate, months, members, capacity, teams, demand, lockedAllocs, allocs } = input;
  const { w1, w2, w3 } = weights;
  const capMap = buildCapMap(capacity);
  const memberOf = new Map(members.map((m) => [m.member_id, m]));
  const monthOf = (d) => d.slice(0, 7);

  // ---- 状態 ----
  const load = new Map(); // メンバー|日 → 配員の合計(ロック分を含む)
  const mdClients = new Map(); // メンバー|日 → Map(クライアント → 時間)  動かしてよい配員だけ
  const A = new Map(); // クライアント|月 → 配員の合計(ロック分を含む)
  const monthLoad = new Map(); // メンバー|月 → 配員の合計
  const capMemo = new Map();
  const monthCapMemo = new Map();
  const dayList = new Map(); // 月 → fromDate 以降の日

  const add = (map, k, x) => map.set(k, r6((map.get(k) ?? 0) + x));
  const capOf = (m, d) => {
    const k = `${m}|${d}`;
    if (!capMemo.has(k)) capMemo.set(k, capacityOf(memberOf.get(m), d, capMap));
    return capMemo.get(k);
  };
  const monthCap = (m, t) => {
    const k = `${m}|${t}`;
    if (!monthCapMemo.has(k)) monthCapMemo.set(k, eachDay(monthStart(t), monthEnd(t)).reduce((s, d) => s + capOf(m, d), 0));
    return monthCapMemo.get(k);
  };
  const daysOf = (t) => {
    if (!dayList.has(t)) {
      const from = monthStart(t) > fromDate ? monthStart(t) : fromDate;
      dayList.set(t, from > monthEnd(t) ? [] : eachDay(from, monthEnd(t)));
    }
    return dayList.get(t);
  };

  function put(m, c, d, x) {
    const k = `${m}|${d}`;
    if (!mdClients.has(k)) mdClients.set(k, new Map());
    const cm = mdClients.get(k);
    cm.set(c, r6((cm.get(c) ?? 0) + x));
    add(load, k, x);
    add(A, `${c}|${monthOf(d)}`, x);
    add(monthLoad, `${m}|${monthOf(d)}`, x);
  }
  function take(m, c, d, x) {
    const k = `${m}|${d}`;
    const cm = mdClients.get(k);
    const left = r6(cm.get(c) - x);
    if (left <= EPS) cm.delete(c);
    else cm.set(c, left);
    add(load, k, -x);
    add(A, `${c}|${monthOf(d)}`, -x);
    add(monthLoad, `${m}|${monthOf(d)}`, -x);
  }

  for (const a of lockedAllocs) {
    add(load, `${a.member_id}|${a.date}`, a.hours);
    add(A, `${a.client_id}|${monthOf(a.date)}`, a.hours);
    add(monthLoad, `${a.member_id}|${monthOf(a.date)}`, a.hours);
  }
  const orig = new Map();
  for (const a of allocs) {
    put(a.member_id, a.client_id, a.date, a.hours);
    orig.set(`${a.member_id}|${a.client_id}|${a.date}`, a.hours);
  }

  const D = new Map(demand.map((r) => [`${r.client_id}|${r.month}`, r.hours]));
  const shortOf = (c, t) => Math.max(0, r6((D.get(`${c}|${t}`) ?? 0) - (A.get(`${c}|${t}`) ?? 0)));
  const surplusOf = (c, t) => Math.max(0, r6((A.get(`${c}|${t}`) ?? 0) - (D.get(`${c}|${t}`) ?? 0)));

  const teamOf = new Map(); // クライアント → Set(メンバー)
  for (const t of teams) {
    if (!teamOf.has(t.client_id)) teamOf.set(t.client_id, new Set());
    teamOf.get(t.client_id).add(t.member_id);
  }
  const teamsAdded = new Map(); // クライアント|メンバー → {client_id, member_id}

  // ---- 対象の セル(クライアント×月)。不足の大きい順 ----
  const inScope = new Set(months.filter((t) => monthEnd(t) >= fromDate));
  const cells = [...D.keys()]
    .map((k) => ({ c: k.split('|')[0], t: k.split('|')[1] }))
    .filter(({ c, t }) => inScope.has(t) && shortOf(c, t) > EPS);
  const totalBefore = r6(cells.reduce((s, { c, t }) => s + shortOf(c, t), 0));
  cells.sort((a, b) => shortOf(b.c, b.t) - shortOf(a.c, a.t));

  // ---- 候補の選択 ----
  function pickBest(c, t, memberIds, need, isOutsider) {
    let best = null;
    for (const m of memberIds) {
      const mc = monthCap(m, t);
      if (mc <= 0) continue;
      const ml = monthLoad.get(`${m}|${t}`) ?? 0;
      const reuse = isOutsider && teamsAdded.has(`${c}|${m}`) ? 0 : isOutsider ? 0.3 : 0;
      for (const d of daysOf(t)) {
        const free = r6(capOf(m, d) - (load.get(`${m}|${d}`) ?? 0));
        const here = mdClients.get(`${m}|${d}`);
        if (free > EPS) {
          const amount = Math.min(free, need);
          const net = w1 - w2 * KAPPA * ((here?.get(c) ?? 0) > 0 ? 1 : 1.25);
          if (net <= 0) continue;
          const rank = net - w3 * MU * ((ml + amount) / mc) + 0.01 * amount - reuse;
          if (!best || rank > best.rank) best = { type: 'free', m, d, amount, rank };
        } else if (mode === 'B' && here) {
          // 余剰のあるクライアントの配員を、不足側へ付け替える(変更量は取り外し+追加で2倍)
          const net = w1 - w2 * KAPPA * 2;
          if (net <= 0) continue;
          for (const [c2, hours] of here) {
            if (c2 === c) continue;
            const amount = Math.min(hours, surplusOf(c2, t), need);
            if (amount <= EPS) continue;
            const rank = net - w3 * MU * (ml / mc) + 0.01 * amount - reuse;
            if (!best || rank > best.rank) best = { type: 'steal', m, d, c2, amount, rank };
          }
        }
      }
    }
    return best;
  }

  let steps = 0;
  cells.forEach(({ c, t }, i) => {
    let need = shortOf(c, t);
    const team = teamOf.get(c) ?? new Set();
    const phases = [[[...team], false]];
    if (allowOutsiders) phases.push([members.map((m) => m.member_id).filter((id) => !team.has(id)), true]);
    for (const [ids, outsider] of phases) {
      while (need > EPS) {
        const best = pickBest(c, t, ids, need, outsider);
        if (!best) break;
        if (best.type === 'steal') take(best.m, best.c2, best.d, best.amount);
        put(best.m, c, best.d, best.amount);
        if (outsider) teamsAdded.set(`${c}|${best.m}`, { client_id: c, member_id: best.m });
        need = r6(need - best.amount);
        steps += 1;
      }
      if (need <= EPS) break;
    }
    if (i % 5 === 0 || i === cells.length - 1) onProgress({ done: i + 1, total: cells.length });
  });

  // ---- 結果 ----
  const allocations = [];
  const keys = new Set(orig.keys());
  for (const [k, cm] of mdClients) {
    const [m, d] = k.split('|');
    for (const [c, hours] of cm) {
      allocations.push({ member_id: m, client_id: c, date: d, hours });
      keys.add(`${m}|${c}|${d}`);
    }
  }
  const now = new Map(allocations.map((a) => [`${a.member_id}|${a.client_id}|${a.date}`, a.hours]));
  let changed = 0;
  for (const k of keys) changed += Math.abs((now.get(k) ?? 0) - (orig.get(k) ?? 0));

  const unresolved = cells
    .map(({ c, t }) => ({ client_id: c, month: t, demand: D.get(`${c}|${t}`) ?? 0, alloc: A.get(`${c}|${t}`) ?? 0, short: shortOf(c, t) }))
    .filter((x) => x.short > EPS)
    .sort((a, b) => b.short - a.short);
  const totalAfter = r6(unresolved.reduce((s, x) => s + x.short, 0));

  return {
    allocations,
    teamsAdded: [...teamsAdded.values()],
    unresolved,
    stats: { totalBefore, totalAfter, changed: r6(changed), steps, cells: cells.length },
  };
}
