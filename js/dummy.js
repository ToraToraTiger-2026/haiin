// ダミーデータ生成。実在の名前・数値は使わない。シード付き乱数なので毎回同じ結果になる。
import { addDays, eachDay, isWeekend, monthEnd, monthsBetween, monthStart } from './dates.js';
import { PROD, clearStores, putMany } from './db.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const num2 = (n) => String(n).padStart(2, '0');

export function buildDummy({
  seed = 1,
  memberCount = 30,
  clientCount = 50,
  start = '2026-04-01',
  end = '2027-03-31',
} = {}) {
  const rnd = mulberry32(seed);
  const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const months = monthsBetween(start, end);

  const members = Array.from({ length: memberCount }, (_, i) => ({
    member_id: `M${num2(i + 1)}`,
    name: `メンバー${num2(i + 1)}`,
    std_cap: i % 10 === 9 ? 6 : 8, // 一部は時短
  }));
  const clients = Array.from({ length: clientCount }, (_, i) => ({
    client_id: `C${num2(i + 1)}`,
    name: `クライアント${num2(i + 1)}`,
    active: true,
  }));
  const periods = [{ period_id: 'P1', name: 'ダミー期', start, end }];
  const scenarios = [
    { scenario_id: PROD, name: '本番', kind: '本番', created_by: 'dummy', created_at: new Date().toISOString() },
  ];

  const plan_demand = [];
  const current_demand = [];
  const team_members = [];
  const assignment_rules = [];
  const allocations = [];
  let ruleSeq = 0;

  for (const c of clients) {
    // チーム編成: 30人から3〜6人
    const size = rint(3, 6);
    const pool = members.map((m) => m.member_id);
    const team = [];
    while (team.length < size) {
      const pick = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      team.push(pick);
    }
    team.forEach((mid, i) => {
      team_members.push({ scenario_id: PROD, client_id: c.client_id, member_id: mid, role: i === 0 ? 'リード' : '' });
    });

    const base = rint(4, 20) * 10; // 月の基準工数
    for (const mo of months) {
      const planned = Math.round(base * (0.7 + rnd() * 0.6) / 5) * 5;
      plan_demand.push({ period_id: 'P1', client_id: c.client_id, month: mo, hours: planned });
      // 一部は現在の需要を変更(遅延・増減)
      let hours = planned;
      let reason = '';
      if (rnd() < 0.12) {
        hours = Math.max(0, Math.round(planned * (0.6 + rnd() * 0.9) / 5) * 5);
        reason = hours > planned ? '範囲拡大' : '遅延により後ろ倒し';
      }
      current_demand.push({ scenario_id: PROD, client_id: c.client_id, month: mo, hours, reason });

      // 配員: 現在の需要の60〜105%を、チームメンバーへ月単位ルールで配る
      const target = hours * (0.6 + rnd() * 0.45);
      const days = eachDay(monthStart(mo), monthEnd(mo)).filter((d) => !isWeekend(d));
      if (target <= 0 || days.length === 0) continue;
      const k = rint(1, Math.min(3, team.length));
      const chosen = [...team].sort(() => rnd() - 0.5).slice(0, k);
      for (const mid of chosen) {
        const perDay = Math.max(0.5, Math.round((target / k / days.length) * 2) / 2);
        const rule_id = `R${++ruleSeq}`;
        assignment_rules.push({
          rule_id,
          scenario_id: PROD,
          member_id: mid,
          client_id: c.client_id,
          start: days[0],
          end: days[days.length - 1],
          hours_per_day: perDay,
          include_weekend: false,
          locked: false,
        });
        for (const d of days) {
          allocations.push({ scenario_id: PROD, member_id: mid, client_id: c.client_id, date: d, hours: perDay, rule_id });
        }
      }
    }
  }

  // capacity の例外: 祝日っぽい日(0h)と、ランダムな休暇
  const capacity = [];
  const holidays = ['2026-04-29', '2026-05-04', '2026-05-05', '2026-07-20', '2026-09-21', '2026-11-03', '2027-01-01', '2027-01-11', '2027-03-22'];
  for (const m of members) {
    for (const h of holidays) capacity.push({ member_id: m.member_id, date: h, cap: 0 });
    const vacations = rint(3, 6);
    for (let i = 0; i < vacations; i++) {
      const d = addDays(start, rint(0, 364));
      if (d > end || isWeekend(d)) continue;
      capacity.push({ member_id: m.member_id, date: d, cap: rnd() < 0.5 ? 0 : 4 });
    }
  }

  return {
    members, clients, periods, plan_demand, scenarios,
    current_demand, team_members, assignment_rules, allocations,
    capacity, change_log: [],
  };
}

/** 全テーブルを消してダミーデータを書き込む。 */
export async function loadDummy(opts) {
  const data = buildDummy(opts);
  await clearStores();
  for (const [store, rows] of Object.entries(data)) {
    if (rows.length) await putMany(store, rows);
  }
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
}
