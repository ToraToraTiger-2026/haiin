// 変更履歴。マスタ・需要・ルールなどの書き込みはここを通して change_log に残す。
// allocations はルールから展開される派生データなので、1行ずつは記録しない(ルール側を記録する)。
import { deleteKeys, get, keyOf, putMany } from './db.js';

const ACTOR_KEY = 'haiin.actor';

export function getActor() {
  try {
    return localStorage.getItem(ACTOR_KEY) || '自分';
  } catch {
    return '自分';
  }
}

export function setActor(name) {
  try {
    localStorage.setItem(ACTOR_KEY, name);
  } catch {
    // 保存できない環境では既定名のままにする
  }
}

export const idText = (key) => (Array.isArray(key) ? key.join('/') : String(key));

export function recordChange(table, targetId, before, after) {
  return putMany('change_log', [
    { at: new Date().toISOString(), actor: getActor(), table, target_id: targetId, before, after },
  ]);
}

export async function putLogged(table, row) {
  const key = keyOf(table, row);
  const before = (await get(table, key)) ?? null;
  await putMany(table, [row]);
  await recordChange(table, idText(key), before, row);
}

export async function deleteLogged(table, key) {
  const before = await get(table, key);
  if (before === undefined) return;
  await deleteKeys(table, [key]);
  await recordChange(table, idText(key), before, null);
}
