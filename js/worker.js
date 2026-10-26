// 重い計算(配員案の自動提案)を画面とは別のスレッドで行う。
import { solve } from './solver.js';

self.onmessage = (e) => {
  try {
    const result = solve(e.data, (p) => self.postMessage({ type: 'progress', ...p }));
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
