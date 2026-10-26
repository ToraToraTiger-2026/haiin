// CSV / JSON の入出力(Excel は使わない)。
import { PROD } from './db.js';
import { isValidDate } from './dates.js';

// 各テーブルの列定義。CSV の見出しは label(日本語)。取り込み時は label でも key でも読める。
const F = (key, label, type = 'str', req = true) => ({ key, label, type, req });

export const SCHEMA = {
  members: {
    label: 'メンバー',
    fields: [F('member_id', 'メンバーID'), F('name', '氏名'), F('std_cap', '標準上限(時間/日)', 'num')],
  },
  clients: {
    label: 'クライアント',
    fields: [F('client_id', 'クライアントID'), F('name', 'クライアント名'), F('active', '有効', 'bool', false)],
  },
  periods: {
    label: '期',
    fields: [F('period_id', '期ID'), F('name', '期名'), F('start', '開始日', 'date'), F('end', '終了日', 'date')],
  },
  plan_demand: {
    label: '計画需要',
    fields: [F('period_id', '期ID'), F('client_id', 'クライアントID'), F('month', '対象月', 'month'), F('hours', '予定工数(時間)', 'num')],
  },
  current_demand: {
    label: '現在の需要',
    fields: [F('scenario_id', 'シナリオID', 'str', false), F('client_id', 'クライアントID'), F('month', '対象月', 'month'), F('hours', '必要工数(時間)', 'num'), F('reason', '変更理由', 'str', false)],
  },
  team_members: {
    label: 'チーム編成',
    fields: [F('scenario_id', 'シナリオID', 'str', false), F('client_id', 'クライアントID'), F('member_id', 'メンバーID'), F('role', '役割', 'str', false)],
  },
  capacity: {
    label: '上限の例外',
    fields: [F('member_id', 'メンバーID'), F('date', '日付', 'date'), F('cap', '上限(時間)', 'num')],
  },
  // 以下は書き出し専用(取り込みはJSONで行う)
  scenarios: {
    label: 'シナリオ',
    fields: [F('scenario_id', 'シナリオID'), F('name', '名称'), F('kind', '種別'), F('created_by', '作成者', 'str', false), F('created_at', '作成日時', 'str', false)],
  },
  assignment_rules: {
    label: '配員ルール',
    fields: [F('rule_id', 'ルールID'), F('scenario_id', 'シナリオID'), F('member_id', 'メンバーID'), F('client_id', 'クライアントID'), F('start', '開始日', 'date'), F('end', '終了日', 'date'), F('hours_per_day', '時間/日', 'num'), F('include_weekend', '土日を含む', 'bool', false), F('locked', 'ロック', 'bool', false)],
  },
  allocations: {
    label: '配員(日単位)',
    fields: [F('scenario_id', 'シナリオID'), F('member_id', 'メンバーID'), F('client_id', 'クライアントID'), F('date', '日付', 'date'), F('hours', '時間', 'num'), F('rule_id', 'ルールID', 'str', false)],
  },
  change_log: {
    label: '変更履歴',
    fields: [F('log_id', 'ID', 'num', false), F('at', '日時'), F('actor', '操作者'), F('table', '対象テーブル'), F('target_id', '対象ID'), F('before', '変更前', 'json', false), F('after', '変更後', 'json', false)],
  },
};

export const IMPORTABLE = ['members', 'clients', 'periods', 'plan_demand', 'current_demand', 'team_members', 'capacity'];

// ---------- CSV ----------

export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let f = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { f += '"'; i++; } else quoted = false;
      } else f += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(f); f = '';
      rows.push(row); row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export function stringifyCsv(rows) {
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}

function cellOut(type, v) {
  if (v == null) return '';
  if (type === 'bool') return v ? 'true' : 'false';
  if (type === 'json') return JSON.stringify(v);
  return v;
}

/** テーブルの行 → CSV文字列(UTF-8 BOM付き) */
export function toCsv(table, rows) {
  const { fields } = SCHEMA[table];
  const body = rows.map((r) => fields.map((f) => cellOut(f.type, r[f.key])));
  return '﻿' + stringifyCsv([fields.map((f) => f.label), ...body]);
}

const TRUE_WORDS = new Set(['true', '1', 'yes', 'はい', '○', '〇', 'y']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'いいえ', '×', 'n', '']);

function convert(f, raw, errs, lineNo) {
  const s = raw.trim();
  if (s === '') {
    if (f.req) errs.push(`${lineNo}行目: 「${f.label}」が空です`);
    return f.type === 'bool' ? false : f.type === 'num' ? null : '';
  }
  switch (f.type) {
    case 'num': {
      const n = Number(s);
      if (!Number.isFinite(n)) errs.push(`${lineNo}行目: 「${f.label}」が数値ではありません(${s})`);
      return n;
    }
    case 'bool': {
      const w = s.toLowerCase();
      if (TRUE_WORDS.has(w)) return true;
      if (!FALSE_WORDS.has(w)) errs.push(`${lineNo}行目: 「${f.label}」が true/false ではありません(${s})`);
      return false;
    }
    case 'date':
      if (!isValidDate(s)) errs.push(`${lineNo}行目: 「${f.label}」は YYYY-MM-DD の形式で入力してください(${s})`);
      return s;
    case 'month':
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) errs.push(`${lineNo}行目: 「${f.label}」は YYYY-MM の形式で入力してください(${s})`);
      return s;
    default:
      return s;
  }
}

/** CSV文字列 → {rows, errors}。errors が空でなければ取り込まない想定。 */
export function csvToRows(table, text) {
  const { fields } = SCHEMA[table];
  const errors = [];
  const parsed = parseCsv(text);
  if (parsed.length === 0) return { rows: [], errors: ['ファイルが空です'] };

  const header = parsed[0].map((s) => s.trim());
  const colOf = new Map(); // field.key → 列番号
  for (const f of fields) {
    const i = header.findIndex((hd) => hd === f.label || hd === f.key);
    if (i >= 0) colOf.set(f.key, i);
    else if (f.req) errors.push(`見出し「${f.label}」の列がありません`);
  }
  if (errors.length) return { rows: [], errors };

  const rows = [];
  parsed.slice(1).forEach((cells, idx) => {
    const lineNo = idx + 2;
    const row = {};
    for (const f of fields) {
      const raw = colOf.has(f.key) ? (cells[colOf.get(f.key)] ?? '') : '';
      row[f.key] = convert(f, raw, errors, lineNo);
    }
    if ('scenario_id' in row && row.scenario_id === '') row.scenario_id = PROD;
    if (table === 'clients' && !colOf.has('active')) row.active = true;
    rows.push(row);
  });
  return { rows, errors };
}

// ---------- JSON(バックアップ) ----------

export function toBackupJson(tables) {
  return JSON.stringify({ app: 'haiin', version: 1, exported_at: new Date().toISOString(), tables });
}

/** バックアップJSONの検証。{tables} か {error} を返す。 */
export function parseBackupJson(text, knownTables) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { error: 'JSONとして読み込めませんでした' };
  }
  if (!obj || obj.app !== 'haiin' || typeof obj.tables !== 'object' || obj.tables === null) {
    return { error: 'このツールのバックアップファイルではありません' };
  }
  const tables = {};
  for (const name of knownTables) {
    const rows = obj.tables[name];
    if (rows === undefined) { tables[name] = []; continue; }
    if (!Array.isArray(rows)) return { error: `テーブル ${name} の形式が正しくありません` };
    tables[name] = rows;
  }
  return { tables, exportedAt: obj.exported_at };
}
