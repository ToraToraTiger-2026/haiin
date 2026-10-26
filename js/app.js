import { PROD, getAll } from './db.js';
import { getActor, setActor } from './changelog.js';
import { getScenario, setScenario } from './state.js';
import { h, setStatus } from './ui.js';
import * as data from './views/data.js';
import * as free from './views/free.js';
import * as grid from './views/grid.js';
import * as history from './views/history.js';
import * as io from './views/io.js';
import * as master from './views/master.js';
import * as scenario from './views/scenario.js';
import * as shortage from './views/shortage.js';
import * as demand from './views/demand.js';
import * as report from './views/report.js';

// 画面の定義。ハッシュ(#/grid など)で切り替える。
const VIEWS = {
  shortage: { label: '不足ビュー', mod: shortage },
  free: { label: '空きビュー', mod: free },
  grid: { label: '配員グリッド', mod: grid },
  demand: { label: '需要入力', mod: demand },
  scenario: { label: 'シナリオ', mod: scenario },
  report: { label: '応援要請レポート', mod: report },
  master: { label: 'マスタ', mod: master },
  io: { label: 'インポート/エクスポート', mod: io },
  history: { label: '変更履歴', mod: history },
  data: { label: 'データ', mod: data },
};

const nav = document.getElementById('nav');
const view = document.getElementById('view');
const scenarioSel = document.getElementById('scenario-select');
const banner = document.getElementById('banner');

nav.replaceChildren(...Object.entries(VIEWS).map(([id, v]) => h('a', { href: `#/${id}`, 'data-view': id }, v.label)));

const actorInput = document.getElementById('actor');
actorInput.value = getActor();
actorInput.addEventListener('change', () => setActor(actorInput.value.trim() || '自分'));

/** シナリオの選択肢と、下書き表示中のバナーを最新にする。存在しないシナリオなら本番に戻す。 */
async function refreshScenarios() {
  const list = await getAll('scenarios');
  if (!list.some((s) => s.scenario_id === PROD)) list.unshift({ scenario_id: PROD, name: '本番', kind: '本番' });
  list.sort((a, b) => (a.scenario_id === PROD ? -1 : b.scenario_id === PROD ? 1 : (a.created_at ?? '') < (b.created_at ?? '') ? -1 : 1));
  if (!list.some((s) => s.scenario_id === getScenario())) setScenario(PROD);
  scenarioSel.replaceChildren(...list.map((s) => h('option', { value: s.scenario_id }, s.kind === '本番' ? '本番' : `下書き: ${s.name}`)));
  scenarioSel.value = getScenario();
  const cur = list.find((s) => s.scenario_id === getScenario());
  document.body.classList.toggle('draft', getScenario() !== PROD);
  banner.textContent = getScenario() === PROD ? '' : `下書き「${cur.name}」を表示しています。ここでの変更は、確定するまで本番に影響しません。`;
}

scenarioSel.addEventListener('change', () => {
  setScenario(scenarioSel.value);
  route();
});

async function route(keepStatus = false) {
  await refreshScenarios();
  const id = location.hash.replace('#/', '') || 'shortage';
  const def = VIEWS[id] ?? VIEWS.shortage;
  for (const a of nav.children) a.classList.toggle('active', a.dataset.view === (VIEWS[id] ? id : 'shortage'));
  if (!keepStatus) setStatus('');
  try {
    await def.mod.render(view);
  } catch (e) {
    console.error(e);
    view.replaceChildren(h('p', { class: 'error' }, `画面の表示に失敗しました: ${e.message}`));
  }
}

window.addEventListener('hashchange', () => route());
window.addEventListener('scenarios-changed', () => route(true));
route();
