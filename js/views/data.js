import { clearStores, countAll } from '../db.js';
import { loadDummy } from '../dummy.js';
import { SCHEMA } from '../io.js';
import { notifyScenariosChanged } from '../state.js';
import { h, setStatus } from '../ui.js';

export async function render(root) {
  const counts = h('tbody');

  async function refresh() {
    const c = await countAll();
    counts.replaceChildren(
      ...Object.entries(c).map(([k, v]) =>
        h('tr', {}, h('th', {}, `${SCHEMA[k]?.label ?? k} (${k})`), h('td', {}, v.toLocaleString())),
      ),
    );
  }

  async function run(label, fn) {
    setStatus(`${label}中…`);
    try {
      await fn();
      setStatus(`${label}が完了しました`);
      notifyScenariosChanged();
    } catch (e) {
      setStatus(`${label}に失敗しました: ${e.message}`);
    }
    await refresh();
  }

  root.replaceChildren(
    h('h2', {}, 'データ'),
    h('p', {},
      h('button', {
        onclick: () => {
          if (confirm('既存のデータをすべて消して、ダミーデータを生成します。よろしいですか?')) run('ダミーデータ生成', () => loadDummy());
        },
      }, 'ダミーデータを生成'),
      ' ',
      h('button', {
        class: 'danger-outline',
        onclick: () => {
          if (confirm('ブラウザ内のデータをすべて削除します。よろしいですか?\n(先にJSONバックアップを書き出すことをおすすめします)')) run('全削除', () => clearStores());
        },
      }, '全データを削除'),
    ),
    h('table', { class: 'counts' }, counts),
  );
  await refresh();
}
