// assignment_rules(期間+1日あたりの時間) → allocations(日単位)への展開と、入力時のチェック。
import { capacityOf, dayKey, loadByMemberDay, overOf } from './calc.js';
import { addDays, eachDay, isWeekend } from './dates.js';

export const newRuleId = () => `U${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function expandRule(rule) {
  return eachDay(rule.start, rule.end)
    .filter((d) => rule.include_weekend || !isWeekend(d))
    .map((date) => ({
      scenario_id: rule.scenario_id,
      member_id: rule.member_id,
      client_id: rule.client_id,
      date,
      hours: rule.hours_per_day,
      rule_id: rule.rule_id,
    }));
}

/**
 * 同じシナリオ・メンバー・クライアントで期間が重なる別ルールを返す(なければ undefined)。
 * allocations のキーが (シナリオ, メンバー, クライアント, 日付) なので、重なりは許さない。
 */
export function findOverlap(rule, rules) {
  return rules.find(
    (r) =>
      r.rule_id !== rule.rule_id &&
      r.scenario_id === rule.scenario_id &&
      r.member_id === rule.member_id &&
      r.client_id === rule.client_id &&
      r.start <= rule.end &&
      rule.start <= r.end,
  );
}

/**
 * このルールを加えたときに上限を超える日を返す。
 * allocations には編集中のルール自身が含まれていてもよい(rule_id が同じものは除いて数える)。
 */
export function checkOverload(rule, allocations, member, capMap) {
  const others = allocations.filter((a) => a.member_id === rule.member_id && a.rule_id !== rule.rule_id);
  const loads = loadByMemberDay(others);
  const out = [];
  for (const a of expandRule(rule)) {
    const load = (loads.get(dayKey(a.member_id, a.date)) ?? 0) + a.hours;
    const cap = capacityOf(member, a.date, capMap);
    const over = overOf(load, cap);
    if (over > 0) out.push({ date: a.date, load, cap, over });
  }
  return out;
}

function nextWeekday(d) {
  let n = addDays(d, 1);
  while (isWeekend(n)) n = addDays(n, 1);
  return n;
}

/**
 * 日単位の配員(member_id, client_id, date, hours)から、配員ルールを組み直す。
 * 同じメンバー×クライアントで、時間が同じ日が続く範囲を1つのルールにまとめる
 * (平日は金→月をまたいで続くものとみなし、土日の配員は別のルールにする)。
 * 戻り値の allocations は、ルールを expandRule で展開した結果と一致する。
 */
export function rebuildRules(allocations, scenarioId) {
  const groups = new Map();
  for (const a of allocations) {
    const k = `${a.member_id}|${a.client_id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const rules = [];
  for (const rows of groups.values()) {
    rows.sort((x, y) => (x.date < y.date ? -1 : 1));
    for (const weekend of [false, true]) {
      let run = null;
      const flush = () => {
        if (!run) return;
        rules.push({
          rule_id: newRuleId(), scenario_id: scenarioId, member_id: run.member_id, client_id: run.client_id,
          start: run.start, end: run.end, hours_per_day: run.hours, include_weekend: weekend, locked: false,
        });
        run = null;
      };
      for (const a of rows.filter((r) => isWeekend(r.date) === weekend)) {
        const next = run && (weekend ? addDays(run.end, 1) : nextWeekday(run.end));
        if (run && a.hours === run.hours && a.date === next) run.end = a.date;
        else {
          flush();
          run = { member_id: a.member_id, client_id: a.client_id, start: a.date, end: a.date, hours: a.hours };
        }
      }
      flush();
    }
  }
  return { rules, allocations: rules.flatMap(expandRule) };
}
