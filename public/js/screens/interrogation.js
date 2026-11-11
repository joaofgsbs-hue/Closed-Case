// interrogation.js - the chat with one suspect.
// Everyone in the room sees the same conversation. This file only draws what
// the server sent; the questions are answered (and counted) on the server.

import { $, el } from '../dom.js';
import { request } from '../net.js';

let current = null;     // last room state
let suspectId = null;   // which suspect this browser is looking at
let lastDrawn = '';     // fingerprint of the last drawn chat, to know when to scroll

export function initInterrogation({ onBack }) {
  $('interro-back').addEventListener('click', onBack);

  $('interro-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('interro-input');
    const text = input.value.trim();
    if (!text) return;

    $('interro-send').disabled = true;
    const reply = await request('interrogation:ask', { suspectId, text });
    $('interro-error').textContent = reply.ok ? '' : reply.error;
    // Clear the box only if the server accepted the question.
    if (reply.ok) input.value = '';
    updateCounter();
    render(); // re-enables the button if we may ask again
  });

  $('interro-input').addEventListener('input', updateCounter);

  // Show a found clue to this suspect. It uses one of their questions.
  $('interro-clue-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const clueId = $('interro-clue').value;
    if (!clueId) return;
    $('interro-show').disabled = true;
    const reply = await request('interrogation:showClue', { suspectId, clueId });
    $('interro-error').textContent = reply.ok ? '' : reply.error;
    render();
  });
}

function updateCounter() {
  const input = $('interro-input');
  $('interro-chars').textContent = `${input.value.length}/${input.maxLength}`;
}

/** Open the chat with a suspect (called when the player taps one). */
export function openInterrogation(id) {
  suspectId = id;
  lastDrawn = ''; // force a scroll to the bottom on first draw
  $('interro-error').textContent = '';
  $('interro-input').value = '';
  updateCounter();
}

export function renderInterrogation(room) {
  current = room;
  render();
}

function render() {
  if (!current || !suspectId || !current.interrogations) return;
  const suspect = current.case.suspects.find((s) => s.id === suspectId);
  const record = current.interrogations.suspects.find((s) => s.suspectId === suspectId);
  if (!suspect || !record) return;

  const max = current.interrogations.questionsPerSuspect;
  const left = max - record.questionsUsed;

  $('interro-name').textContent = suspect.name;
  $('interro-relation').textContent = suspect.relationToVictim;
  $('interro-count').textContent = `${record.questionsUsed}/${max} questions used`;
  $('interro-count').classList.toggle('bad', left <= 0);

  const rows = [];
  if (record.exchanges.length === 0) {
    rows.push(el('li', { className: 'chat-empty' }, `${suspect.name} is waiting for your first question.`));
  }
  for (const e of record.exchanges) {
    const mine = e.playerId === current.you.id;
    const said = e.kind === 'clue' ? el('span', { className: 'shown' }, `Shows the clue: ${e.clueName}`) : e.question;
    rows.push(el('li', { className: `chat-q${mine ? ' mine' : ''}` }, el('small', {}, mine ? 'You' : e.playerName), said));

    if (e.status === 'answered') {
      // Anyone can pin an answer to the shared evidence board.
      let pin;
      if (e.pinned) {
        pin = el('span', { className: 'pinned' }, 'On the board');
      } else {
        pin = el('button', { type: 'button', className: 'link' }, 'Pin to board');
        pin.addEventListener('click', async () => {
          pin.disabled = true;
          const reply = await request('board:pin', { exchangeId: e.id });
          $('interro-error').textContent = reply.ok ? '' : reply.error;
        });
      }
      rows.push(el('li', { className: 'chat-a' }, el('small', {}, suspect.name), e.answer, ' ', pin));
    } else if (e.status === 'pending') {
      rows.push(el('li', { className: 'chat-a thinking' }, el('small', {}, suspect.name), 'thinks for a moment…'));
    } else {
      // 'failed': the model did not answer in time. The question was NOT counted.
      const row = el('li', { className: 'chat-a failed' }, el('small', {}, suspect.name), 'thinks for a moment… and says nothing. (This question was not counted.)');
      if (mine) {
        const again = el('button', { type: 'button', className: 'link' }, 'Ask again');
        again.addEventListener('click', () => {
          $('interro-input').value = e.question;
          updateCounter();
          $('interro-input').focus();
        });
        row.append(' ', again);
      }
      rows.push(row);
    }
  }
  const log = $('interro-log');
  log.replaceChildren(...rows);

  // Scroll to the newest message only when something changed, so the page
  // does not jump while someone is reading older answers.
  const fingerprint = record.exchanges.map((e) => `${e.id}:${e.status}`).join(',');
  if (fingerprint !== lastDrawn) {
    log.scrollTop = log.scrollHeight;
    lastDrawn = fingerprint;
  }

  // Can THIS player ask right now? (The server checks again anyway.)
  const iAmWaiting = current.interrogations.suspects.some((s) => s.exchanges.some((e) => e.status === 'pending' && e.playerId === current.you.id));
  const roomLeft = current.interrogations.roomQuestionsMax - current.interrogations.roomQuestionsUsed;
  $('interro-send').disabled = left <= 0 || roomLeft <= 0 || iAmWaiting;

  // The list of clues to show. Keep the player's choice if it still exists.
  const clues = current.investigation ? current.investigation.clues : [];
  const select = $('interro-clue');
  const chosen = select.value;
  select.replaceChildren(
    el('option', { value: '' }, clues.length ? 'Choose a clue…' : 'No clues found yet'),
    ...clues.map((c) => el('option', { value: c.id }, c.name)),
  );
  if (clues.some((c) => c.id === chosen)) select.value = chosen;
  select.disabled = clues.length === 0;
  $('interro-show').disabled = clues.length === 0 || left <= 0 || roomLeft <= 0 || iAmWaiting;
  $('interro-input').disabled = left <= 0 || roomLeft <= 0;
  $('interro-input').placeholder = left <= 0
    ? `${suspect.name} will not answer any more questions.`
    : roomLeft <= 0 ? 'This room has used all of its questions.' : `Ask ${suspect.name} something…`;
}
