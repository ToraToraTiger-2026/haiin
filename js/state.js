// いま表示しているシナリオ。タブを閉じるまで覚えておく(ブラウザに保存できなければ本番に戻る)。
import { PROD } from './db.js';

const KEY = 'haiin.scenario';
let current = PROD;
try {
  current = sessionStorage.getItem(KEY) || PROD;
} catch {
  current = PROD;
}

export const getScenario = () => current;

export function setScenario(id) {
  current = id;
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    // 保存できなくても動作には影響しない
  }
}

/** シナリオの一覧が変わったことを画面全体に知らせる */
export const notifyScenariosChanged = () => window.dispatchEvent(new Event('scenarios-changed'));

// 不足ビュー・需要入力・レポートで選んでいる期
let periodId = '';
try {
  periodId = sessionStorage.getItem('haiin.period') || '';
} catch {
  periodId = '';
}
export const getPeriodId = () => periodId;
export function setPeriodId(id) {
  periodId = id;
  try {
    sessionStorage.setItem('haiin.period', id);
  } catch {
    // 保存できなくても動作には影響しない
  }
}
