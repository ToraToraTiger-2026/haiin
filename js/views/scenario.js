import { PROD, getAll, getAllByIndex } from '../db.js';
import { overByMemberDay, shortageByCell, buildCapMap } from '../calc.js';
import { commitDraft, createDraft, discardDraft, loadScenarioData } from '../scenario.js';
import { getScenario, notifyScenariosChanged, setScenario } from '../state.js';
import { isValidDate, today } from '../dates.js';
import { stringifyCsv } from '../io.js';
import { loadPeriodContext } from '../periodctx.js';
import { proposeDraft } from '../propose.js';
import { download, field, fmt, h, setStatus } from '../ui.js';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const arrow = (a, b) => (a === b ? fmt(b) : `${fmt(a)} → ${fmt(b)}`);

export async function render(root) {
  const scenarios = (await getAll('scenarios')).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const current = getScenario();
  const nameIn = h('input', { type: 'text', placeholder: '下書きの名前(例: 11月の再配員案)', size: '32' });

  async function act(label, fn) {
    setStatus(`${label}中…`);
    try {
      await fn();
      setStatus(`${label}が完了しました`);
    } catch (e) {
      setStatus(`${label}に失敗しました: ${e.message}`);
    }
    notifyScenariosChanged();
  }

  const rows = scenarios.map((s) => {
    const isProd = s.scenario_id === PROD;
    return h('tr', {},
      h('td', {}, s.name, s.scenario_id === current ? h('span', { class: 'badge' }, '表示中') : ''),
      h('td', {}, s.kind),
      h('td', {}, s.created_by ?? ''),
      h('td', {}, (s.created_at ?? '').replace('T', ' ').slice(0, 16)),
      h('td', {},
        h('button', { class: 'danger-outline', disabled: s.scenario_id === current, onclick: () => { setScenario(s.scenario_id); notifyScenariosChanged(); } }, '表示する'),
        isProd ? null : [' ',
          h('button', { onclick: () => {
            if (!confirm(`「${s.name}」の内容で本番を置き換えます。\n下書きを作ったあとに本番を変更していても、本番の内容は下書きのものに置き換わります。\nよろしいですか?`)) return;
            act('本番への反映', async () => { await commitDraft(s.scenario_id); setScenario(PROD); });
          } }, '確定(本番へ反映)'), ' ',
          h('button', { class: 'danger-outline', onclick: () => {
            if (!confirm(`下書き「${s.name}」を破棄します。よろしいですか?`)) return;
            act('破棄', async () => { await discardDraft(s.scenario_id); if (getScenario() === s.scenario_id) setScenario(PROD); });
          } }, '破棄')]),
    );
  });

  const compare = h('div');
  const proposeBox = h('div');
  root.replaceChildren(
    h('h2', {}, 'シナリオ'),
    h('p', { class: 'note' }, '下書きは本番のコピーです。下書きの上で配員を動かして、不足と上限超過がどう変わるかを確認し、よければ本番へ反映します。'),
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['名称', '種別', '作成者', '作成日時', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows)),
    h('h3', {}, '本番から下書きを作る'),
    h('p', {}, nameIn, ' ', h('button', { onclick: () => {
      const name = nameIn.value.trim();
      if (!name) { setStatus('下書きの名前を入力してください'); return; }
      act('下書きの作成', async () => { const id = await createDraft(name, PROD); setScenario(id); });
    } }, '下書きを作成')),
    proposeBox,
    compare,
  );

  await paintPropose(proposeBox, current);
  if (current !== PROD && scenarios.some((s) => s.scenario_id === current)) {
    await paintCompare(compare, current, scenarios.find((s) => s.scenario_id === current).name);
  }
}

async function paintCompare(box, draftId, draftName) {
  const [members, clients, caps, prod, draft] = await Promise.all([
    getAll('members'), getAll('clients'), getAll('capacity'), loadScenarioData(PROD), loadScenarioData(draftId),
  ]);
  const capMap = buildCapMap(caps);
  const clientName = new Map(clients.map((c) => [c.client_id, c.name]));
  const memberName = new Map(members.map((m) => [m.member_id, m.name]));

  const sP = shortageByCell(prod.current_demand, prod.allocations);
  const sD = shortageByCell(draft.current_demand, draft.allocations);
  const oP = overByMemberDay(prod.allocations, members, capMap);
  const oD = overByMemberDay(draft.allocations, members, capMap);

  const stat = (map, f) => sum([...map.values()].map(f));
  const metrics = [
    ['不足の合計(時間)', stat(sP, (x) => x.short), stat(sD, (x) => x.short)],
    ['不足のあるクライアント×月', stat(sP, (x) => (x.short > 0 ? 1 : 0)), stat(sD, (x) => (x.short > 0 ? 1 : 0))],
    ['上限超過の合計(時間)', sum([...oP.values()]), sum([...oD.values()])],
    ['上限超過のあるメンバー×日', oP.size, oD.size],
  ];

  // 不足が変わったクライアント×月
  const keys = new Set([...sP.keys(), ...sD.keys()]);
  const changedShort = [...keys]
    .map((k) => ({ p: sP.get(k), d: sD.get(k) }))
    .filter(({ p, d }) => (p?.short ?? 0) !== (d?.short ?? 0) || (p?.alloc ?? 0) !== (d?.alloc ?? 0))
    .sort((a, b) => Math.abs((b.d?.short ?? 0) - (b.p?.short ?? 0)) - Math.abs((a.d?.short ?? 0) - (a.p?.short ?? 0)));

  // 上限超過が変わったメンバー(日数と時間を集計)
  const perMember = (map) => {
    const m = new Map();
    for (const [k, v] of map) {
      const id = k.split('|')[0];
      const cur = m.get(id) ?? { days: 0, hours: 0 };
      cur.days += 1; cur.hours += v;
      m.set(id, cur);
    }
    return m;
  };
  const mP = perMember(oP);
  const mD = perMember(oD);
  const changedOver = [...new Set([...mP.keys(), ...mD.keys()])]
    .map((id) => ({ id, p: mP.get(id) ?? { days: 0, hours: 0 }, d: mD.get(id) ?? { days: 0, hours: 0 } }))
    .filter(({ p, d }) => p.days !== d.days || Math.round((p.hours - d.hours) * 1e6) !== 0);

  const LIMIT = 30;
  box.replaceChildren(
    h('h3', {}, `影響の確認: 本番 と 「${draftName}」`),
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['指標', '本番', '下書き', '差'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...metrics.map(([label, a, b]) =>
        h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, fmt(a)), h('td', { class: 'num' }, fmt(b)),
          h('td', { class: `num${a !== b ? ' diff-text' : ''}` }, a === b ? '±0' : `${b > a ? '+' : ''}${fmt(b - a)}`))))),
    h('h3', {}, `不足・配員が変わったクライアント×月(${changedShort.length} 件)`),
    changedShort.length === 0 ? h('p', { class: 'note' }, '変わっていません。') : h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['クライアント', '月', '必要工数(下書き)', '配員(本番→下書き)', '不足(本番→下書き)'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...changedShort.slice(0, LIMIT).map(({ p, d }) => {
        const x = d ?? p;
        const sp = p?.short ?? 0;
        const sd = d?.short ?? 0;
        return h('tr', {},
          h('td', {}, clientName.get(x.client_id) ?? x.client_id), h('td', {}, x.month),
          h('td', { class: 'num' }, fmt(d?.demand ?? 0)),
          h('td', { class: 'num diff-text' }, arrow(p?.alloc ?? 0, d?.alloc ?? 0)),
          h('td', { class: `num${sd > 0 ? ' over-text' : ''}` }, arrow(sp, sd)));
      }))),
    changedShort.length > LIMIT ? h('p', { class: 'note' }, `変化の大きい順に先頭 ${LIMIT} 件を表示しています。`) : null,
    h('h3', {}, `上限超過が変わったメンバー(${changedOver.length} 人)`),
    changedOver.length === 0 ? h('p', { class: 'note' }, '変わっていません。') : h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['メンバー', '超過日数(本番→下書き)', '超過時間(本番→下書き)'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...changedOver.slice(0, LIMIT).map(({ id, p, d }) =>
        h('tr', {}, h('td', {}, memberName.get(id) ?? id),
          h('td', { class: 'num diff-text' }, arrow(p.days, d.days)),
          h('td', { class: `num${d.hours > 0 ? ' over-text' : ''}` }, arrow(p.hours, d.hours)))))),
  );
}

// ---------- 配員案の自動提案 ----------
let lastProposal = null; // 直近の提案の結果(画面を描き直しても残す)
const LEVELS = [['1', '低'], ['2', '中'], ['3', '高']];

async function paintPropose(box, current) {
  const [pc, clients, rules] = await Promise.all([loadPeriodContext(), getAll('clients'), getAllByIndex('assignment_rules', 'scenario_id', current)]);
  const clientName = new Map(clients.map((c) => [c.client_id, c.name]));
  if (!pc.period) { box.replaceChildren(h('p', {}, '期が登録されていないため、自動提案は使えません。')); return; }

  const nameIn = h('input', { type: 'text', size: '28', value: `自動提案 ${new Date().toISOString().slice(5, 16).replace('T', ' ')}` });
  const modeSel = h('select', {},
    h('option', { value: 'A' }, 'A: 既存配員は動かさず、チームメンバーの空きだけで埋める'),
    h('option', { value: 'B' }, 'B: ロックしていない既存配員の再配分も許す'));
  const fromIn = h('input', { type: 'date', value: today() });
  const level = (v) => h('select', { value: v }, ...LEVELS.map(([val, label]) => h('option', { value: val }, label)));
  const w1 = level('3'); const w2 = level('2'); const w3 = level('1');
  const outsiders = h('input', { type: 'checkbox' });
  const status = h('p', { class: 'note' });
  const runBtn = h('button', {}, '配員案を自動提案');
  const lockedCount = rules.filter((r) => r.locked).length;

  runBtn.addEventListener('click', async () => {
    const name = nameIn.value.trim();
    if (!name) { status.textContent = '下書きの名前を入力してください'; return; }
    if (!isValidDate(fromIn.value)) { status.textContent = '開始日を入力してください'; return; }
    runBtn.disabled = true;
    status.textContent = '計算中…';
    try {
      const { draftId, result } = await proposeDraft(current, {
        name, mode: modeSel.value, allowOutsiders: outsiders.checked, fromDate: fromIn.value, months: pc.months,
        weights: { w1: Number(w1.value), w2: Number(w2.value), w3: Number(w3.value) },
      }, ({ done, total }) => { status.textContent = `計算中… ${done} / ${total}`; });
      lastProposal = { name, result, clientName, mode: modeSel.value };
      setScenario(draftId);
      notifyScenariosChanged();
    } catch (e) {
      status.textContent = `失敗しました: ${e.message}`;
      runBtn.disabled = false;
    }
  });

  const r = lastProposal?.result;
  box.replaceChildren(
    h('h3', {}, '配員案を自動提案'),
    h('p', { class: 'note' }, '不足を埋める配員案を、表示中のシナリオから新しい下書きとして作ります(本番は書き換えません)。貪欲法による提案で、最適解は保証しません。'),
    h('p', {}, field('下書きの名前', nameIn)),
    h('p', {}, field('モード', modeSel)),
    h('p', { class: 'toolbar' }, field('対象期', h('span', {}, `${pc.period.name}(期の切替は不足ビューで)`)), field('この日以降の配員だけ動かす', fromIn)),
    h('p', { class: 'toolbar' }, field('優先度: 不足の解消', w1), field('変更の少なさ', w2), field('負荷の公平さ', w3)),
    h('label', { class: 'field inline' }, outsiders, h('span', {}, 'チーム外のメンバーも候補にする(使った場合は下書きのチーム編成に加えます)')),
    h('p', { class: 'note' }, `ロックされた配員ルール: ${lockedCount} 件(動かしません。ロックは配員グリッドの配員ルール一覧で設定します)`),
    h('p', {}, runBtn), status,
    r ? resultView(r, lastProposal) : null,
  );
}

function resultView(r, p) {
  const s = r.stats;
  const rows = r.unresolved.slice(0, 50);
  return h('div', { class: 'result' },
    h('h3', {}, `提案の結果: 下書き「${p.name}」(モード${p.mode})`),
    h('table', { class: 'list' },
      h('tbody', {},
        h('tr', {}, h('th', {}, '不足の合計(対象月)'), h('td', { class: 'num' }, `${fmt(s.totalBefore)} → ${fmt(s.totalAfter)} 時間`)),
        h('tr', {}, h('th', {}, '配員を変えた時間'), h('td', { class: 'num' }, `${fmt(s.changed)} 時間`)),
        h('tr', {}, h('th', {}, 'チーム外から加えたメンバー'), h('td', { class: 'num' }, `${r.teamsAdded.length} 人・クライアントの組`)),
        h('tr', {}, h('th', {}, '解消できなかった不足'), h('td', { class: 'num' }, `${r.unresolved.length} 件`)))),
    r.unresolved.length === 0 ? h('p', {}, '対象の不足はすべて埋まりました。') : h('div', {},
      h('h4', {}, '解消できなかった不足(応援要請の根拠)'),
      h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, ['クライアント', '月', '必要', '配員', '不足'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...rows.map((u) => h('tr', {}, h('td', {}, p.clientName.get(u.client_id) ?? u.client_id), h('td', {}, u.month),
          h('td', { class: 'num' }, fmt(u.demand)), h('td', { class: 'num' }, fmt(u.alloc)), h('td', { class: 'num over-text' }, fmt(u.short)))))),
      r.unresolved.length > 50 ? h('p', { class: 'note' }, `大きい順に先頭 50 件を表示しています(CSVには全件が入ります)。`) : null,
      h('p', {}, h('button', { class: 'danger-outline', onclick: () => {
        const head = ['クライアントID', 'クライアント名', '月', '必要工数(時間)', '配員済み(時間)', '解消できなかった不足(時間)'];
        const body = r.unresolved.map((u) => [u.client_id, p.clientName.get(u.client_id) ?? '', u.month, u.demand, u.alloc, u.short]);
        download(`解消できなかった不足_${p.name}.csv`, `﻿${stringifyCsv([head, ...body])}`, 'text/csv');
      } }, 'CSV出力'))),
  );
}
