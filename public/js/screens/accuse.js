// accuse.js - the "Accuse" tab: the accusation form and the room's vote.
// The browser only collects the choice. The server checks it, counts the
// votes and calculates the score; nothing here decides anything.

import { $, el } from '../dom.js';
import { request } from '../net.js';

let current = null;
const chosenClues = new Set(); // clue ids ticked in THIS browser
const MAX_CLUES = 3;

export function initAccuse() {
  $('accuse-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      culpritId: $('accuse-culprit').value,
      motiveIndex: Number($('accuse-motive').value),
      methodIndex: Number($('accuse-method').value),
      clueIds: [...chosenClues],
    };
    // Friendly checks before sending (the server checks everything again).
    if (!payload.culpritId) return showError('Choose a suspect.');
    if ($('accuse-motive').value === '') return showError('Choose a motive.');
    if ($('accuse-method').value === '') return showError('Choose a method.');
    if (payload.clueIds.length < 2) return showError('Choose at least 2 clues as evidence.');

    $('accuse-submit').disabled = true;
    const reply = await request('accusation:propose', payload);
    showError(reply.ok ? '' : reply.error);
    if (reply.ok) chosenClues.clear();
    $('accuse-submit').disabled = false;
  });

  // The vote may end (or be withdrawn) a moment before this click arrives,
  // so always check there is still an open proposal.
  const openProposal = () => current && current.accusation && current.accusation.proposal;
  const vote = async (agree) => {
    const p = openProposal();
    if (!p) return showError('That vote is already over.');
    const reply = await request('accusation:vote', { proposalId: p.id, agree });
    showError(reply.ok ? '' : reply.error);
  };
  $('vote-agree').addEventListener('click', () => vote(true));
  $('vote-disagree').addEventListener('click', () => vote(false));
  $('vote-withdraw').addEventListener('click', async () => {
    const p = openProposal();
    if (!p) return showError('That vote is already over.');
    const reply = await request('accusation:withdraw', { proposalId: p.id });
    showError(reply.ok ? '' : reply.error);
  });
}

function showError(text) {
  $('accuse-error').textContent = text;
}

/** Keeps a <select>'s choice when it is redrawn with the same options. */
function fillSelect(select, placeholder, options) {
  const before = select.value;
  select.replaceChildren(
    el('option', { value: '' }, placeholder),
    ...options.map(([value, label]) => el('option', { value }, label)),
  );
  if (options.some(([value]) => value === before)) select.value = before;
}

export function renderAccuse(room) {
  current = room;
  const acc = room.accusation;
  if (!acc) return;

  $('accuse-note').hidden = !acc.lastVoteNote;
  $('accuse-note').textContent = acc.lastVoteNote || '';

  const proposal = acc.proposal;
  $('accuse-vote').hidden = !proposal;
  $('accuse-form').hidden = Boolean(proposal);
  if (proposal) drawVote(room, proposal);
  else drawForm(room, acc);
}

function drawVote(room, p) {
  $('vote-by').textContent = p.byId === room.you.id ? 'you' : p.byName;
  $('vote-claim').replaceChildren(
    el('li', {}, el('b', {}, 'Culprit: '), p.culpritName),
    el('li', {}, el('b', {}, 'Motive: '), p.motive),
    el('li', {}, el('b', {}, 'Method: '), p.method),
    el('li', {}, el('b', {}, 'Evidence: '), p.clueNames.join('; ')),
  );
  $('vote-needed').textContent = `${p.needed} agreeing vote(s) are needed (more than half of the players connected now).`;
  const LABEL = { agree: 'agrees', disagree: 'disagrees' };
  $('vote-list').replaceChildren(
    ...p.votes.map((v) => el(
      'li',
      { className: v.connected ? '' : 'offline' },
      el('span', {}, v.name),
      el('span', { className: `vote ${v.vote || 'none'}` }, v.vote ? LABEL[v.vote] : (v.connected ? 'has not voted' : 'offline')),
    )),
  );
  $('vote-agree').disabled = p.yourVote === 'agree';
  $('vote-disagree').disabled = p.yourVote === 'disagree';
  $('vote-withdraw').hidden = p.byId !== room.you.id;
}

function drawForm(room, acc) {
  fillSelect($('accuse-culprit'), 'Choose a suspect…', room.case.suspects.map((s) => [s.id, s.name]));
  fillSelect($('accuse-motive'), 'Choose a motive…', acc.motiveOptions.map((text, i) => [String(i), text]));
  fillSelect($('accuse-method'), 'Choose a method…', acc.methodOptions.map((text, i) => [String(i), text]));

  const clues = room.investigation.clues;
  for (const id of chosenClues) if (!clues.some((c) => c.id === id)) chosenClues.delete(id);

  $('accuse-clues').replaceChildren(
    ...(clues.length
      ? clues.map((c) => {
        const box = el('input', { type: 'checkbox', checked: chosenClues.has(c.id) });
        // Once 3 are ticked, the others are greyed out.
        box.disabled = !chosenClues.has(c.id) && chosenClues.size >= MAX_CLUES;
        box.addEventListener('change', () => {
          if (box.checked) chosenClues.add(c.id);
          else chosenClues.delete(c.id);
          drawForm(current, current.accusation);
        });
        return el('li', {}, el('label', { className: 'board-item' }, box, el('span', {}, el('b', {}, c.name), ` — ${c.description}`)));
      })
      : [el('li', { className: 'hint' }, 'You have no clues yet. Search places on the map first.')]),
  );
  $('accuse-submit').disabled = clues.length < 2;
}
