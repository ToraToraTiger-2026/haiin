import { deleteKeys, getAll, getAllByIndex, putMany } from '../db.js';
import { deleteLogged, putLogged, recordChange } from '../changelog.js';
import { isValidDate } from '../dates.js';
import { getScenario } from '../state.js';
import { field, h, setStatus } from '../ui.js';

let currentTab = 'members';
let teamClient = '';
let capMember = '';

const byId = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);

function nextId(prefix, rows, key) {
  const max = rows.reduce((m, r) => Math.max(m, Number(String(r[key]).slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

const saved = () => setStatus('保存しました');

function textInput(value, onSave, attrs = {}) {
  return h('input', { type: 'text', value, ...attrs, onchange: (e) => onSave(e.target.value.trim()) });
}

function numInput(value, onSave, attrs = {}) {
  return h('input', { type: 'number', step: '0.5', min: '0', value, class: 'narrow', ...attrs, onchange: (e) => {
    const n = Number(e.target.value);
    if (e.target.value === '' || !Number.isFinite(n) || n < 0) { setStatus('0以上の数値を入力してください'); e.target.value = value; return; }
    onSave(n);
  } });
}

// ---------- メンバー ----------
async function renderMembers(body, reload) {
  const rows = (await getAll('members')).sort(byId('member_id'));
  const nameIn = h('input', { type: 'text', placeholder: '氏名' });
  const capIn = h('input', { type: 'number', step: '0.5', min: '0', value: '8', class: 'narrow' });

  body.replaceChildren(
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['ID', '氏名', '標準上限(時間/日)', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows.map((m) =>
        h('tr', {},
          h('td', {}, m.member_id),
          h('td', {}, textInput(m.name, async (v) => { if (!v) { setStatus('氏名を入力してください'); return reload(); } await putLogged('members', { ...m, name: v }); saved(); })),
          h('td', {}, numInput(m.std_cap, async (v) => { await putLogged('members', { ...m, std_cap: v }); saved(); })),
          h('td', {}, h('button', { class: 'danger-outline', onclick: async () => {
            const [rules, teams] = await Promise.all([getAll('assignment_rules'), getAll('team_members')]);
            if (rules.some((r) => r.member_id === m.member_id) || teams.some((t) => t.member_id === m.member_id)) {
              setStatus(`${m.name} は配員ルールまたはチーム編成に使われているため削除できません`);
              return;
            }
            if (!confirm(`${m.name} を削除します(上限の例外も消えます)。よろしいですか?`)) return;
            const caps = (await getAll('capacity')).filter((c) => c.member_id === m.member_id);
            await deleteKeys('capacity', caps.map((c) => [c.member_id, c.date]));
            await deleteLogged('members', m.member_id);
            reload();
          } }, '削除')),
        ))),
    ),
    h('h3', {}, 'メンバーを追加'),
    h('p', {}, nameIn, ' 上限 ', capIn, ' ', h('button', { onclick: async () => {
      const name = nameIn.value.trim();
      const cap = Number(capIn.value);
      if (!name || !Number.isFinite(cap) || cap < 0) { setStatus('氏名と上限(0以上)を入力してください'); return; }
      await putLogged('members', { member_id: nextId('M', rows, 'member_id'), name, std_cap: cap });
      reload();
    } }, '追加')),
  );
}

// ---------- クライアント ----------
async function renderClients(body, reload) {
  const rows = (await getAll('clients')).sort(byId('client_id'));
  const nameIn = h('input', { type: 'text', placeholder: 'クライアント名' });

  body.replaceChildren(
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['ID', 'クライアント名', '有効', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows.map((c) =>
        h('tr', {},
          h('td', {}, c.client_id),
          h('td', {}, textInput(c.name, async (v) => { if (!v) { setStatus('名前を入力してください'); return reload(); } await putLogged('clients', { ...c, name: v }); saved(); })),
          h('td', {}, h('input', { type: 'checkbox', checked: c.active, onchange: async (e) => { await putLogged('clients', { ...c, active: e.target.checked }); saved(); } })),
          h('td', {}, h('button', { class: 'danger-outline', onclick: async () => {
            const [rules, teams, demand] = await Promise.all([getAll('assignment_rules'), getAll('team_members'), getAll('current_demand')]);
            if ([...rules, ...teams, ...demand].some((r) => r.client_id === c.client_id)) {
              setStatus(`${c.name} は配員・チーム編成・需要に使われているため削除できません(「有効」を外してください)`);
              return;
            }
            if (!confirm(`${c.name} を削除します。よろしいですか?`)) return;
            await deleteLogged('clients', c.client_id);
            reload();
          } }, '削除')),
        ))),
    ),
    h('h3', {}, 'クライアントを追加'),
    h('p', {}, nameIn, ' ', h('button', { onclick: async () => {
      const name = nameIn.value.trim();
      if (!name) { setStatus('名前を入力してください'); return; }
      await putLogged('clients', { client_id: nextId('C', rows, 'client_id'), name, active: true });
      reload();
    } }, '追加')),
  );
}

// ---------- 期 ----------
async function renderPeriods(body, reload) {
  const rows = (await getAll('periods')).sort(byId('period_id'));
  const dateIn = (value, onSave) => h('input', { type: 'date', value, onchange: (e) => onSave(e.target.value) });
  const nameIn = h('input', { type: 'text', placeholder: '期名' });
  const sIn = h('input', { type: 'date' });
  const eIn = h('input', { type: 'date' });

  body.replaceChildren(
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['ID', '期名', '開始日', '終了日', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows.map((p) =>
        h('tr', {},
          h('td', {}, p.period_id),
          h('td', {}, textInput(p.name, async (v) => { await putLogged('periods', { ...p, name: v }); saved(); })),
          h('td', {}, dateIn(p.start, async (v) => { if (!isValidDate(v) || v > p.end) { setStatus('開始日が正しくありません'); return reload(); } await putLogged('periods', { ...p, start: v }); saved(); })),
          h('td', {}, dateIn(p.end, async (v) => { if (!isValidDate(v) || v < p.start) { setStatus('終了日が正しくありません'); return reload(); } await putLogged('periods', { ...p, end: v }); saved(); })),
          h('td', {}, h('button', { class: 'danger-outline', onclick: async () => {
            if (!confirm(`${p.name} を削除します(この期の計画需要は残ります)。よろしいですか?`)) return;
            await deleteLogged('periods', p.period_id);
            reload();
          } }, '削除')),
        ))),
    ),
    h('h3', {}, '期を追加'),
    h('p', {}, nameIn, ' ', sIn, ' 〜 ', eIn, ' ', h('button', { onclick: async () => {
      if (!nameIn.value.trim() || !isValidDate(sIn.value) || !isValidDate(eIn.value) || sIn.value > eIn.value) {
        setStatus('期名と、正しい開始日・終了日を入力してください');
        return;
      }
      await putLogged('periods', { period_id: nextId('P', rows, 'period_id'), name: nameIn.value.trim(), start: sIn.value, end: eIn.value });
      reload();
    } }, '追加')),
  );
}

// ---------- チーム編成 ----------
async function renderTeams(body, reload) {
  const sid = getScenario();
  const [clients, members, teams, rules] = await Promise.all([
    getAll('clients'), getAll('members'), getAllByIndex('team_members', 'scenario_id', sid), getAllByIndex('assignment_rules', 'scenario_id', sid),
  ]);
  clients.sort(byId('client_id'));
  members.sort(byId('member_id'));
  if (!clients.some((c) => c.client_id === teamClient)) teamClient = clients[0]?.client_id ?? '';

  const sel = h('select', { value: teamClient, onchange: (e) => { teamClient = e.target.value; reload(); } },
    ...clients.map((c) => h('option', { value: c.client_id }, `${c.client_id} ${c.name}${c.active ? '' : '(無効)'}`)));
  const team = new Map(teams.filter((t) => t.client_id === teamClient).map((t) => [t.member_id, t]));

  body.replaceChildren(
    h('p', {}, 'クライアント: ', sel, ` チーム ${team.size} 人`),
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['チーム', 'メンバー', '役割(任意)'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...members.map((m) => {
        const t = team.get(m.member_id);
        return h('tr', {},
          h('td', {}, h('input', { type: 'checkbox', checked: !!t, onchange: async (e) => {
            if (e.target.checked) {
              await putLogged('team_members', { scenario_id: sid, client_id: teamClient, member_id: m.member_id, role: '' });
            } else {
              if (rules.some((r) => r.client_id === teamClient && r.member_id === m.member_id) &&
                  !confirm(`${m.name} はこのクライアントの配員ルールが残っています。チームから外しますか?(配員ルールは消えません)`)) {
                e.target.checked = true;
                return;
              }
              await deleteLogged('team_members', [sid, teamClient, m.member_id]);
            }
            reload();
          } })),
          h('td', {}, `${m.member_id} ${m.name}`),
          h('td', {}, t ? textInput(t.role ?? '', async (v) => { await putLogged('team_members', { ...t, role: v }); saved(); }) : ''),
        );
      })),
    ),
  );
}

// ---------- 上限の例外(capacity) ----------
async function renderCapacity(body, reload) {
  const [members, caps] = await Promise.all([getAll('members'), getAll('capacity')]);
  members.sort(byId('member_id'));
  if (!members.some((m) => m.member_id === capMember)) capMember = members[0]?.member_id ?? '';

  const sel = h('select', { value: capMember, onchange: (e) => { capMember = e.target.value; reload(); } },
    ...members.map((m) => h('option', { value: m.member_id }, `${m.member_id} ${m.name}`)));
  const mine = caps.filter((c) => c.member_id === capMember).sort(byId('date'));
  const dateIn = h('input', { type: 'date' });
  const capIn = h('input', { type: 'number', step: '0.5', min: '0', value: '0', class: 'narrow' });

  const holidayText = h('textarea', { rows: '4', placeholder: '2027-01-01\n2027-01-11' });
  const holidayCap = h('input', { type: 'number', step: '0.5', min: '0', value: '0', class: 'narrow' });

  body.replaceChildren(
    h('p', { class: 'note' }, '日ごとの上限の例外です。休暇・時短はメンバーごとに、祝日は下の一括登録で上限0を入れます。例外がない日は標準上限(土日は0)です。'),
    h('p', {}, 'メンバー: ', sel, ` 例外 ${mine.length} 件`),
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['日付', '上限(時間)', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...mine.map((c) =>
        h('tr', {},
          h('td', {}, c.date),
          h('td', {}, numInput(c.cap, async (v) => { await putLogged('capacity', { ...c, cap: v }); saved(); })),
          h('td', {}, h('button', { class: 'danger-outline', onclick: async () => { await deleteLogged('capacity', [c.member_id, c.date]); reload(); } }, '削除')),
        ))),
    ),
    h('p', {}, dateIn, ' 上限 ', capIn, ' ', h('button', { onclick: async () => {
      const cap = Number(capIn.value);
      if (!isValidDate(dateIn.value) || !Number.isFinite(cap) || cap < 0) { setStatus('日付と上限(0以上)を入力してください'); return; }
      await putLogged('capacity', { member_id: capMember, date: dateIn.value, cap });
      reload();
    } }, 'このメンバーに追加')),
    h('h3', {}, '祝日・全社休日の一括登録(全メンバー)'),
    h('p', {}, field('日付(1行に1つ、YYYY-MM-DD)', holidayText)),
    h('p', {}, '上限 ', holidayCap, ' ', h('button', { onclick: async () => {
      const dates = [...new Set(holidayText.value.split(/[\s,]+/).filter(Boolean))];
      const cap = Number(holidayCap.value);
      const bad = dates.filter((d) => !isValidDate(d));
      if (!dates.length || bad.length || !Number.isFinite(cap) || cap < 0) { setStatus(bad.length ? `日付の形式が正しくありません: ${bad[0]}` : '日付と上限を入力してください'); return; }
      await putMany('capacity', members.flatMap((m) => dates.map((date) => ({ member_id: m.member_id, date, cap }))));
      await recordChange('capacity', '一括登録', null, { dates, cap, members: members.length });
      setStatus(`${dates.length} 日を ${members.length} 人に登録しました`);
      reload();
    } }, '全メンバーに登録')),
  );
}

const TABS = [
  ['members', 'メンバー', renderMembers],
  ['clients', 'クライアント', renderClients],
  ['teams', 'チーム編成', renderTeams],
  ['capacity', '上限の例外', renderCapacity],
  ['periods', '期', renderPeriods],
];

export async function render(root) {
  const body = h('div');
  const nav = h('div', { class: 'tabs' });

  async function show() {
    nav.replaceChildren(...TABS.map(([id, label]) =>
      h('button', { class: id === currentTab ? 'tab active' : 'tab', onclick: () => { currentTab = id; show(); } }, label)));
    const tab = TABS.find(([id]) => id === currentTab);
    await tab[2](body, show);
  }

  root.replaceChildren(h('h2', {}, 'マスタ'), nav, body);
  await show();
}
