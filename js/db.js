// IndexedDB の薄いラッパー。11テーブル(ストア)を扱う。

const DB_NAME = 'haiin';
const DB_VERSION = 1;

// keyPath と、必要なインデックス。allocations / assignment_rules の rule_id は
// 仕様の11テーブルへの最小の追加列(ルールと展開結果をひも付けるため)。
export const STORES = {
  members: { keyPath: 'member_id' },
  clients: { keyPath: 'client_id' },
  periods: { keyPath: 'period_id' },
  plan_demand: { keyPath: ['period_id', 'client_id', 'month'] },
  scenarios: { keyPath: 'scenario_id' },
  current_demand: { keyPath: ['scenario_id', 'client_id', 'month'], indexes: ['scenario_id'] },
  team_members: { keyPath: ['scenario_id', 'client_id', 'member_id'], indexes: ['scenario_id'] },
  assignment_rules: { keyPath: 'rule_id', indexes: ['scenario_id'] },
  allocations: {
    keyPath: ['scenario_id', 'member_id', 'client_id', 'date'],
    indexes: ['scenario_id', 'rule_id'],
  },
  capacity: { keyPath: ['member_id', 'date'] },
  change_log: { keyPath: 'log_id', autoIncrement: true },
};

/** 本番シナリオの scenario_id */
export const PROD = 'prod';

export function keyOf(store, row) {
  const kp = STORES[store].keyPath;
  return Array.isArray(kp) ? kp.map((k) => row[k]) : row[kp];
}

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, {
          keyPath: def.keyPath,
          autoIncrement: !!def.autoIncrement,
        });
        for (const idx of def.indexes ?? []) store.createIndex(idx, idx);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getAll(store) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

export async function getAllByIndex(store, index, value) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).index(index).getAll(value));
}

export async function get(store, key) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).get(key));
}

export async function count(store) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).count());
}

/** rows を一括で put する(1トランザクション)。 */
export async function putMany(store, rows) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const r of rows) os.put(r);
  return done(tx);
}

export async function deleteKeys(store, keys) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const k of keys) os.delete(k);
  return done(tx);
}

/** index の値が一致する行をすべて削除する。 */
export async function deleteByIndex(store, index, value) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const req = tx.objectStore(store).index(index).openKeyCursor(IDBKeyRange.only(value));
  const os = tx.objectStore(store);
  req.onsuccess = () => {
    const cur = req.result;
    if (!cur) return;
    os.delete(cur.primaryKey);
    cur.continue();
  };
  return done(tx);
}

/**
 * scenario_id が一致する行を、指定のテーブルごとに入れ替える(1トランザクション)。
 * data は {テーブル名: 行の配列}。空配列なら、そのシナリオの行を消すだけ。
 * 先にキーを取得してから消して入れるので、途中で止まっても中途半端な状態は残らない。
 */
export async function replaceScenario(scenarioId, data) {
  const db = await openDb();
  const tx = db.transaction(Object.keys(data), 'readwrite');
  for (const [name, rows] of Object.entries(data)) {
    const os = tx.objectStore(name);
    const req = os.index('scenario_id').getAllKeys(IDBKeyRange.only(scenarioId));
    req.onsuccess = () => {
      for (const k of req.result) os.delete(k);
      for (const r of rows) os.put(r);
    };
  }
  return done(tx);
}

export async function clearStores(names = Object.keys(STORES)) {
  const db = await openDb();
  const tx = db.transaction(names, 'readwrite');
  for (const n of names) tx.objectStore(n).clear();
  return done(tx);
}

export async function countAll() {
  const out = {};
  for (const name of Object.keys(STORES)) out[name] = await count(name);
  return out;
}
