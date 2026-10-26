// シナリオ(本番と下書き)の作成・確定・破棄。
import { PROD, getAllByIndex, putMany, replaceScenario } from './db.js';
import { deleteLogged, getActor, putLogged, recordChange } from './changelog.js';
import { newRuleId } from './expand.js';

// scenario_id で本番と下書きに分かれるテーブル
export const SCOPED = ['current_demand', 'team_members', 'assignment_rules', 'allocations'];
const EMPTY = Object.fromEntries(SCOPED.map((s) => [s, []]));

export async function loadScenarioData(scenarioId) {
  const out = {};
  for (const s of SCOPED) out[s] = await getAllByIndex(s, 'scenario_id', scenarioId);
  return out;
}

/** 別のシナリオへコピーするため、scenario_id を付け替え、ルールには新しい rule_id を振る。 */
function retarget(data, toId) {
  const idMap = new Map(data.assignment_rules.map((r) => [r.rule_id, newRuleId()]));
  const to = (r) => ({ ...r, scenario_id: toId });
  return {
    current_demand: data.current_demand.map(to),
    team_members: data.team_members.map(to),
    assignment_rules: data.assignment_rules.map((r) => ({ ...to(r), rule_id: idMap.get(r.rule_id) })),
    allocations: data.allocations.map((a) => ({ ...to(a), rule_id: idMap.get(a.rule_id) ?? a.rule_id })),
  };
}

/** 本番(または別の下書き)から下書きを作る。作った scenario_id を返す。 */
export async function createDraft(name, fromId = PROD) {
  const id = `D${Date.now().toString(36)}`;
  const data = retarget(await loadScenarioData(fromId), id);
  for (const s of SCOPED) if (data[s].length) await putMany(s, data[s]);
  await putLogged('scenarios', {
    scenario_id: id, name, kind: '下書き', created_by: getActor(), created_at: new Date().toISOString(),
  });
  return id;
}

export async function discardDraft(id) {
  if (id === PROD) throw new Error('本番は破棄できません');
  await replaceScenario(id, EMPTY);
  await deleteLogged('scenarios', id);
}

/** 下書きの内容で本番を置き換え(1トランザクション)、下書きを消す。 */
export async function commitDraft(id) {
  if (id === PROD) throw new Error('本番は確定の対象ではありません');
  const data = retarget(await loadScenarioData(id), PROD);
  await replaceScenario(PROD, data);
  await recordChange('scenarios', id, null, {
    action: '下書きを本番へ反映',
    rules: data.assignment_rules.length,
    allocations: data.allocations.length,
  });
  await discardDraft(id);
}

/** 作った内容(scenario_id は何でもよい)から、新しい下書きを作る。 */
export async function createDraftWithData(name, data) {
  const id = `D${Date.now().toString(36)}`;
  const d = retarget(data, id);
  for (const s of SCOPED) if (d[s].length) await putMany(s, d[s]);
  await putLogged('scenarios', {
    scenario_id: id, name, kind: '下書き', created_by: getActor(), created_at: new Date().toISOString(),
  });
  return id;
}
