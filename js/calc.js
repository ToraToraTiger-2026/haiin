// 集計用の純関数。結果は保存せず、表示のたびに呼ぶ。
import { eachDay, isWeekend, monthEnd, monthKey, monthStart } from './dates.js';

const r6 = (x) => Math.round(x * 1e6) / 1e6;

export const dayKey = (memberId, date) => `${memberId}|${date}`;

/** capacity 行 → Map(メンバー|日付 → 上限) */
export function buildCapMap(capacityRows) {
  return new Map(capacityRows.map((r) => [dayKey(r.member_id, r.date), r.cap]));
}

/** Cap(m,d): capacity の例外があればその値、なければ標準上限(土日は0)。祝日は capacity に0を入れて表す。 */
export function capacityOf(member, date, capMap) {
  const k = dayKey(member.member_id, date);
  if (capMap.has(k)) return capMap.get(k);
  return isWeekend(date) ? 0 : member.std_cap;
}

/** L(m,d): クライアントをまたいだ配員時間の合計。Map(メンバー|日付 → 時間) */
export function loadByMemberDay(allocations) {
  const out = new Map();
  for (const a of allocations) {
    const k = dayKey(a.member_id, a.date);
    out.set(k, r6((out.get(k) ?? 0) + a.hours));
  }
  return out;
}

/** A(c,t): クライアント×月の配員時間。Map(クライアント|月 → 時間) */
export function monthlyAllocation(allocations) {
  const out = new Map();
  for (const a of allocations) {
    const k = `${a.client_id}|${monthKey(a.date)}`;
    out.set(k, r6((out.get(k) ?? 0) + a.hours));
  }
  return out;
}

/**
 * Short(c,t) = max(0, D - A)。需要も配員もあるクライアント×月をすべて返す。
 * Map(クライアント|月 → {client_id, month, demand, alloc, short})
 */
export function shortageByCell(demandRows, allocations) {
  const alloc = monthlyAllocation(allocations);
  const out = new Map();
  for (const d of demandRows) {
    const k = `${d.client_id}|${d.month}`;
    const a = alloc.get(k) ?? 0;
    out.set(k, { client_id: d.client_id, month: d.month, demand: d.hours, alloc: a, short: Math.max(0, r6(d.hours - a)) });
  }
  for (const [k, a] of alloc) {
    if (out.has(k)) continue;
    const [client_id, month] = k.split('|');
    out.set(k, { client_id, month, demand: 0, alloc: a, short: 0 });
  }
  return out;
}

/** 上限を超えているメンバー×日。Map(メンバー|日付 → 超過時間) */
export function overByMemberDay(allocations, members, capMap) {
  const memberOf = new Map(members.map((m) => [m.member_id, m]));
  const out = new Map();
  for (const [k, load] of loadByMemberDay(allocations)) {
    const [memberId, date] = k.split('|');
    const m = memberOf.get(memberId);
    if (!m) continue;
    const o = overOf(load, capacityOf(m, date, capMap));
    if (o > 0) out.set(k, o);
  }
  return out;
}

/** Over = max(0, L - Cap) */
export const overOf = (load, cap) => Math.max(0, r6(load - cap));

/** Free = max(0, Cap - L) */
export const freeOf = (load, cap) => Math.max(0, r6(cap - load));

/** 月ごとのメンバーの空き(その月の Free(m,d) の合計)。Map(メンバー|月 → 時間) */
export function freeByMemberMonth(members, loads, capMap, months) {
  const out = new Map();
  for (const t of months) {
    const days = eachDay(monthStart(t), monthEnd(t));
    for (const m of members) {
      let free = 0;
      for (const d of days) free += freeOf(loads.get(dayKey(m.member_id, d)) ?? 0, capacityOf(m, d, capMap));
      out.set(`${m.member_id}|${t}`, r6(free));
    }
  }
  return out;
}

/** クライアントごとの「チーム内の空き」= そのチームのメンバーの月の空きの合計。Map(クライアント|月 → 時間) */
export function teamFreeByCell(teams, freeMM, clientIds, months) {
  const byClient = new Map();
  for (const t of teams) {
    if (!byClient.has(t.client_id)) byClient.set(t.client_id, []);
    byClient.get(t.client_id).push(t.member_id);
  }
  const out = new Map();
  for (const c of clientIds) {
    const ids = byClient.get(c) ?? [];
    for (const t of months) out.set(`${c}|${t}`, r6(ids.reduce((s, id) => s + (freeMM.get(`${id}|${t}`) ?? 0), 0)));
  }
  return out;
}

/**
 * チーム全体の Gap(t) = 不足の合計 − 空きの合計。正なら、その月は他チームへの応援が必要。
 * Map(月 → {short, free, gap})
 */
export function gapByMonth(shortMap, freeMM, months) {
  const out = new Map(months.map((t) => [t, { short: 0, free: 0, gap: 0 }]));
  for (const s of shortMap.values()) if (out.has(s.month)) out.get(s.month).short += s.short;
  for (const [k, v] of freeMM) {
    const t = k.split('|')[1];
    if (out.has(t)) out.get(t).free += v;
  }
  for (const g of out.values()) {
    g.short = r6(g.short);
    g.free = r6(g.free);
    g.gap = r6(g.short - g.free);
  }
  return out;
}
