// 配員案の自動提案を実行し、結果を下書きシナリオに書き出す。
import { PROD, getAll } from './db.js';
import { rebuildRules } from './expand.js';
import { createDraftWithData, loadScenarioData } from './scenario.js';
import { solve } from './solver.js';

/** Web Worker で solve を動かす。Worker が使えない環境(file:// など)では画面のスレッドで動かす。 */
export function runSolver(input, onProgress) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    } catch {
      try {
        resolve(solve(input, onProgress));
      } catch (e) {
        reject(e);
      }
      return;
    }
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress(e.data);
      else if (e.data.type === 'done') { worker.terminate(); resolve(e.data.result); }
      else { worker.terminate(); reject(new Error(e.data.message)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Worker でエラーが発生しました')); };
    worker.postMessage(input);
  });
}

/**
 * sourceId のシナリオを元に配員案を作り、新しい下書きとして保存する。
 * opts: {name, mode, weights, allowOutsiders, fromDate, months}
 * 戻り値: {draftId, result}
 */
export async function proposeDraft(sourceId, opts, onProgress = () => {}) {
  const [src, members, capacity] = await Promise.all([loadScenarioData(sourceId), getAll('members'), getAll('capacity')]);
  const lockedIds = new Set(src.assignment_rules.filter((r) => r.locked).map((r) => r.rule_id));
  const lockedAllocs = src.allocations.filter((a) => lockedIds.has(a.rule_id));
  const movable = src.allocations.filter((a) => !lockedIds.has(a.rule_id));

  const result = await runSolver({
    mode: opts.mode, weights: opts.weights, allowOutsiders: opts.allowOutsiders,
    fromDate: opts.fromDate, months: opts.months,
    members, capacity, teams: src.team_members, demand: src.current_demand,
    lockedAllocs, allocs: movable,
  }, onProgress);

  // 動かしてよい配員は、結果から配員ルールを組み直す。ロックしたルールはそのまま残す。
  const rebuilt = rebuildRules(result.allocations, sourceId);
  const keepRules = src.assignment_rules.filter((r) => r.locked);
  const teamKeys = new Set(src.team_members.map((t) => `${t.client_id}|${t.member_id}`));
  const added = result.teamsAdded
    .filter((t) => !teamKeys.has(`${t.client_id}|${t.member_id}`))
    .map((t) => ({ scenario_id: sourceId, client_id: t.client_id, member_id: t.member_id, role: '応援(自動提案)' }));

  const draftId = await createDraftWithData(opts.name, {
    current_demand: src.current_demand,
    team_members: [...src.team_members, ...added],
    assignment_rules: [...keepRules, ...rebuilt.rules],
    allocations: [...lockedAllocs, ...rebuilt.allocations],
  });
  return { draftId, result, isFromProd: sourceId === PROD };
}
