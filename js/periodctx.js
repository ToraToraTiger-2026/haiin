// 「どの期を表示するか」の共通処理。需要入力・不足ビュー・レポートで使う。
import { getAll } from './db.js';
import { monthsBetween, today } from './dates.js';
import { getPeriodId, setPeriodId } from './state.js';
import { h } from './ui.js';

/** {periods, period, months}。期が1つもなければ period は null。 */
export async function loadPeriodContext() {
  const periods = (await getAll('periods')).sort((a, b) => (a.start < b.start ? -1 : 1));
  const t = today();
  const period =
    periods.find((p) => p.period_id === getPeriodId()) ??
    periods.find((p) => p.start <= t && t <= p.end) ??
    periods[periods.length - 1] ?? null;
  return { periods, period, months: period ? monthsBetween(period.start, period.end) : [] };
}

export function periodSelect(ctx, onChange) {
  return h('select', {
    value: ctx.period?.period_id ?? '',
    onchange: (e) => { setPeriodId(e.target.value); onChange(); },
  }, ...ctx.periods.map((p) => h('option', { value: p.period_id }, `${p.name}(${p.start}〜${p.end})`)));
}
