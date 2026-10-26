import { getAll, getAllByIndex } from '../db.js';
import { putLogged } from '../changelog.js';
import { loadPeriodContext, periodSelect } from '../periodctx.js';
import { getScenario } from '../state.js';
import { fmt, h, openDialog, setStatus } from '../ui.js';

export async function render(root) {
  const sid = getScenario();
  const pc = await loadPeriodContext();
  const reload = () => render(root);
  if (!pc.period) {
    root.replaceChildren(h('h2', {}, '需要入力'), h('p', {}, '期が登録されていません。「マスタ」で期を登録してください。'));
    return;
  }
  const [clients, plan, current] = await Promise.all([
    getAll('clients'), getAll('plan_demand'), getAllByIndex('current_demand', 'scenario_id', sid),
  ]);
  clients.sort((a, b) => (a.client_id < b.client_id ? -1 : 1));
  const { months, period } = pc;
  const planOf = new Map(plan.filter((p) => p.period_id === period.period_id).map((p) => [`${p.client_id}|${p.month}`, p.hours]));
  const curOf = new Map(current.map((r) => [`${r.client_id}|${r.month}`, r]));
  const rows = clients.filter((c) => c.active || months.some((t) => planOf.has(`${c.client_id}|${t}`)));

  /** 現在の需要を変えるときは、変更理由を添えて保存する。 */
  function askReason(c, t, newHours, prev, input) {
    const planned = planOf.get(`${c.client_id}|${t}`) ?? 0;
    const reasonIn = h('textarea', { rows: '3', placeholder: '例: 先方の都合で3か月後ろ倒し' }, prev?.reason ?? '');
    reasonIn.value = prev?.reason ?? '';
    const err = h('p', { class: 'error' });
    const cancel = () => { input.value = prev?.hours ?? 0; dlg.close(); };
    const dlg = openDialog(
      h('h3', {}, `${c.name} ${t}`),
      h('p', {}, `計画 ${fmt(planned)} → 現在の需要 ${fmt(prev?.hours ?? 0)} から ${fmt(newHours)} に変更します(計画との差 ${newHours - planned >= 0 ? '+' : ''}${fmt(newHours - planned)})`),
      h('label', { class: 'field' }, h('span', {}, '変更理由'), reasonIn),
      err,
      h('p', { class: 'dialog-actions' },
        h('button', { onclick: async () => {
          const reason = reasonIn.value.trim();
          if (newHours !== planned && !reason) { err.textContent = '計画と違う値にするときは、変更理由を入力してください。'; return; }
          await putLogged('current_demand', { scenario_id: sid, client_id: c.client_id, month: t, hours: newHours, reason });
          dlg.close();
          setStatus('現在の需要を保存しました');
          reload();
        } }, '保存'),
        h('button', { class: 'danger-outline', onclick: cancel }, 'キャンセル')),
    );
    dlg.addEventListener('cancel', () => { input.value = prev?.hours ?? 0; });
  }

  const planTotal = months.map(() => 0);
  const curTotal = months.map(() => 0);
  const body = rows.map((c) =>
    h('tr', {}, h('th', { class: 'sticky' }, c.name),
      ...months.map((t, i) => {
        const k = `${c.client_id}|${t}`;
        const planned = planOf.get(k);
        const cur = curOf.get(k);
        planTotal[i] += planned ?? 0;
        curTotal[i] += cur?.hours ?? 0;
        const diff = (cur?.hours ?? 0) - (planned ?? 0);
        const input = h('input', { type: 'number', min: '0', step: '5', class: 'narrow', value: cur?.hours ?? 0 });
        input.addEventListener('change', () => {
          const n = Number(input.value);
          if (input.value === '' || !Number.isFinite(n) || n < 0) { setStatus('0以上の数値を入力してください'); input.value = cur?.hours ?? 0; return; }
          if (n === (cur?.hours ?? 0)) return;
          askReason(c, t, n, cur, input);
        });
        return h('td', { class: 'demand-cell', title: cur?.reason ? `変更理由: ${cur.reason}` : '' },
          h('div', { class: 'sub' }, `計画 ${planned === undefined ? '–' : fmt(planned)}`),
          input,
          h('div', { class: `sub${diff !== 0 ? ' diff-text' : ''}` }, diff !== 0 ? `${diff > 0 ? '+' : ''}${fmt(diff)}${cur?.reason ? ' ※' : ''}` : ''));
      })));

  root.replaceChildren(
    h('h2', {}, '需要入力'),
    h('p', { class: 'toolbar' }, periodSelect(pc, reload)),
    h('p', { class: 'note' }, '上の小さい数字は期初の計画(固定)、入力欄は現在の需要です。遅延や変更があったら入力欄を書き換えて、変更理由を残します。青い数字は計画との差、※は変更理由があることを示します(マウスを載せると表示)。単位は時間。'),
    h('div', { class: 'scroll' },
      h('table', { class: 'grid wide' },
        h('thead', {}, h('tr', {}, h('th', { class: 'sticky' }, 'クライアント'), ...months.map((t) => h('th', {}, t)))),
        h('tbody', {}, ...body,
          h('tr', { class: 'total' }, h('th', { class: 'sticky' }, '計画の合計'), ...planTotal.map((v) => h('td', {}, fmt(v)))),
          h('tr', { class: 'total' }, h('th', { class: 'sticky' }, '現在の需要の合計'), ...curTotal.map((v, i) => h('td', { class: v !== planTotal[i] ? 'diff-text' : '' }, fmt(v))))))),
  );
}
