// result.js - the verdict screen. Every player receives the result in the
// same server broadcast, so it appears on all screens at the same moment.
// This is the only screen that shows the truth, and the server only sends it
// once the case is over.

import { $, el } from '../dom.js';
import { request } from '../net.js';
import { addToHistory } from '../history.js';

export function initResult({ onLeave }) {
  $('result-lobby').addEventListener('click', async () => {
    $('result-lobby').disabled = true;
    const reply = await request('game:backToLobby');
    $('result-error').textContent = reply.ok ? '' : reply.error;
    $('result-lobby').disabled = false;
  });
  $('result-leave').addEventListener('click', onLeave);
}

const mark = (right) => el('span', { className: right ? 'ok' : 'bad' }, right ? ' ✓' : ' ✗');

export function renderResult(room) {
  const r = room.result;
  if (!r) return;

  $('result-casecode').textContent = room.case.caseCode || '';
  $('result-title').textContent = room.case.title;
  $('result-verdict').textContent = r.solved ? 'Case closed. You found the killer.' : 'The killer walks free.';
  $('result-verdict').className = `verdict ${r.solved ? 'ok' : 'bad'}`;
  $('result-score').textContent = `${r.score} / ${r.maxScore} points`;
  $('result-breakdown').replaceChildren(
    ...r.breakdown.map((row) => el('li', {}, el('span', {}, row.label), el('strong', {}, `${row.points} / ${row.max}`))),
  );

  const a = r.accused;
  $('result-who').textContent = `Proposed by ${a.proposedBy}; agreed by ${a.agreedBy.join(', ')}. ${r.questionsUsed} question(s) asked.`;
  $('result-accused').replaceChildren(
    el('li', {}, el('b', {}, 'Culprit: '), a.culpritName, mark(a.culpritRight)),
    el('li', {}, el('b', {}, 'Motive: '), a.motive, mark(a.motiveRight)),
    el('li', {}, el('b', {}, 'Method: '), a.method, mark(a.methodRight)),
    ...a.clues.map((c) => el('li', {}, el('b', {}, 'Evidence: '), c.name, mark(c.good))),
  );

  const t = r.truth;
  $('result-truth').replaceChildren(
    el('li', {}, el('b', {}, 'The killer: '), t.culpritName),
    el('li', {}, el('b', {}, 'Why: '), `${t.motive}. ${t.motiveStory}`),
    el('li', {}, el('b', {}, 'How: '), `${t.method}. ${t.methodStory}`),
    el('li', {}, el('b', {}, 'When: '), t.opportunity),
  );
  $('result-keyclues').replaceChildren(
    ...t.keyClues.map((c) => el('li', {}, c.name, el('small', {}, c.found ? ' · found' : ' · never found'))),
  );
  $('result-timeline').replaceChildren(
    ...t.timeline.map((e) => el('li', {}, el('b', {}, e.time), ' ', e.event)),
  );

  const isHost = room.hostId === room.you.id;
  $('result-lobby').hidden = !isHost;
  $('result-wait').hidden = isHost;

  // Save to this browser's history. The id is unique per game, so a page
  // refresh on this screen does not store the same game twice.
  addToHistory({
    id: `${room.code}-${r.endedAt}`,
    date: r.endedAt,
    title: room.case.title,
    caseCode: room.case.caseCode,
    theme: room.settings.theme,
    difficulty: room.settings.difficulty,
    solved: r.solved,
    score: r.score,
    maxScore: r.maxScore,
    players: room.players.map((p) => p.name),
  });
}
