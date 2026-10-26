// 日付はすべて 'YYYY-MM-DD' 文字列で扱う。Date はUTC基準でこのファイルの中だけで使う。

const pad = (n) => String(n).padStart(2, '0');

function toUtc(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

const DAY_MS = 86400000;

/** 今日の日付(ローカル時間)。他の関数はUTC基準だが、「今日」だけは利用者の暦日を使う。 */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
}

export function addDays(s, n) {
  return fromUtc(toUtc(s) + n * DAY_MS);
}

export function diffDays(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** 0=日 ... 6=土 */
export function dayOfWeek(s) {
  return new Date(toUtc(s)).getUTCDay();
}

export function isWeekend(s) {
  const w = dayOfWeek(s);
  return w === 0 || w === 6;
}

export function monthKey(s) {
  return s.slice(0, 7);
}

/** その日を含む週の月曜日 */
export function weekStart(s) {
  const w = dayOfWeek(s);
  return addDays(s, -((w + 6) % 7));
}

/** start〜end(両端含む)の日付配列 */
export function eachDay(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthStart(m) {
  return `${m}-01`;
}

export function monthEnd(m) {
  const [y, mo] = m.split('-').map(Number);
  return fromUtc(Date.UTC(y, mo, 0));
}

/** start〜end にかかる月キー('YYYY-MM')の配列 */
export function monthsBetween(start, end) {
  const out = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
