// 不足一覧(応援要請レポート)の行の組み立てとCSV出力。
import { stringifyCsv } from './io.js';
import { download } from './ui.js';

/**
 * 不足のあるクライアント×月の一覧(onlyShort=false なら全セル)。
 * support = 不足 − チーム内の空き(正なら、チームの中では埋まらない分)。
 * チーム内の空きは、同じメンバーが複数のクライアントで重複して数えられるため、目安の値。
 */
export function buildShortageRows({ clients, months, shortMap, teamFree, clientIds, onlyShort = false }) {
  const allow = new Set(clientIds);
  const monthSet = new Set(months);
  const rows = [];
  for (const c of clients) {
    if (!allow.has(c.client_id)) continue;
    for (const t of months) {
      const s = shortMap.get(`${c.client_id}|${t}`);
      if (!s || !monthSet.has(t) || (onlyShort && s.short <= 0)) continue;
      const free = teamFree.get(`${c.client_id}|${t}`) ?? 0;
      rows.push({
        client_id: c.client_id, client: c.name, month: t, demand: s.demand, alloc: s.alloc, short: s.short, teamFree: free,
        support: Math.max(0, Math.round((s.short - free) * 1e6) / 1e6),
      });
    }
  }
  return rows;
}

export function downloadShortageCsv(rows, name) {
  const head = ['クライアントID', 'クライアント名', '月', '必要工数(時間)', '配員済み(時間)', '不足(時間)', 'チーム内の空き(時間)', 'チーム外の応援が必要な目安(時間)'];
  const body = rows.map((r) => [r.client_id, r.client, r.month, r.demand, r.alloc, r.short, r.teamFree, r.support]);
  download(`${name}.csv`, `﻿${stringifyCsv([head, ...body])}`, 'text/csv');
}

export function downloadGapCsv(months, gap, name) {
  const body = months.map((t) => [t, gap.get(t).short, gap.get(t).free, gap.get(t).gap]);
  download(`${name}.csv`, `﻿${stringifyCsv([['月', '不足の合計(時間)', '空きの合計(時間)', 'Gap(時間)'], ...body])}`, 'text/csv');
}
