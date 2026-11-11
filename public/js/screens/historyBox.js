// historyBox.js - "Your past cases" on the home screen.
// The case code lets players replay a case they liked (on the same server).

import { $, el } from '../dom.js';
import { loadHistory, clearHistory } from '../history.js';

export function initHistory() {
  $('history-clear').addEventListener('click', () => {
    clearHistory();
    renderHistory();
  });
}

export function renderHistory() {
  const list = loadHistory();
  $('history-box').hidden = list.length === 0;
  $('history-count').textContent = `(${list.length})`;
  $('history-list').replaceChildren(
    ...list.map((e) => el(
      'li',
      {},
      el('strong', {}, e.title),
      el('span', { className: e.solved ? 'ok' : 'bad' }, e.solved ? ' solved' : ' unsolved'),
      el('small', {}, ` · ${e.score}/${e.maxScore} · ${new Date(e.date).toLocaleDateString()} · case ${e.caseCode} · ${e.players.join(', ')}`),
    )),
  );
}
