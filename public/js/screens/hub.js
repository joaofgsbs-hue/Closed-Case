// hub.js - the investigation hub: three tabs (case file, map, evidence board).
// Like every screen, it only draws what the server sent and asks the server
// to act. Which tab is open and which board items are ticked are local
// choices of this browser; the server does not need to know them.

import { $, el } from '../dom.js';
import { request } from '../net.js';
import { renderBriefing } from './briefing.js';

const TABS = ['case', 'map', 'board'];
let tab = 'case';
let current = null;
const selected = new Set(); // board items ticked in THIS browser, e.g. "clue:c3"

export function initHub() {
  for (const name of TABS) {
    $(`hub-tab-${name}`).addEventListener('click', () => {
      tab = name;
      draw();
    });
  }

  $('board-link').addEventListener('click', async () => {
    const [a, b] = [...selected];
    $('board-link').disabled = true;
    const reply = await request('board:link', { a, b });
    $('board-error').textContent = reply.ok ? '' : reply.error;
    if (reply.ok) selected.clear();
    draw();
  });
}

export function renderHub(room) {
  current = room;
  draw();
}

function draw() {
  if (!current || !current.investigation) return;
  for (const name of TABS) {
    $(`hub-tab-${name}`).classList.toggle('active', name === tab);
    $(`hub-panel-${name}`).hidden = name !== tab;
  }
  const inv = current.investigation;
  $('hub-actions').textContent = `(${inv.actionsLeft})`;
  $('hub-board-count').textContent = `(${inv.clues.length + inv.board.statements.length})`;

  renderBriefing(current);
  drawMap(inv);
  drawBoard(inv);
}

// ---- map ---------------------------------------------------------------------------
function drawMap(inv) {
  const victimPlace = current.case.victim.foundAtLocationId;
  $('map-actions').textContent = `Searches left today: ${inv.actionsLeft} of ${inv.actionsMax}. Each search reveals everything hidden in that place, to the whole team.`;

  $('map-locations').replaceChildren(
    ...inv.locations.map((place) => {
      const clues = inv.clues.filter((c) => c.locationId === place.id);
      const items = [el('strong', {}, place.name, place.id === victimPlace ? el('small', {}, ' · the body was found here') : '')];

      if (place.searched) {
        items.push(el('p', {}, place.description));
        items.push(el('p', { className: 'hint' }, `Searched by ${place.searchedBy}.`));
        items.push(clues.length
          ? el('ul', { className: 'facts' }, ...clues.map((c) => el('li', {}, el('b', {}, c.name), ` — ${c.description}`)))
          : el('p', { className: 'hint' }, 'Nothing useful was found here.'));
      } else {
        const button = el('button', { type: 'button', className: 'secondary' }, 'Search this place (1 action)');
        button.disabled = inv.actionsLeft <= 0;
        button.addEventListener('click', async () => {
          button.disabled = true;
          const reply = await request('location:search', { locationId: place.id });
          $('map-error').textContent = reply.ok ? '' : reply.error;
        });
        items.push(button);
      }
      return el('li', { className: place.searched ? 'searched' : '' }, ...items);
    }),
  );
}

// ---- evidence board -------------------------------------------------------------------
function drawBoard(inv) {
  const board = inv.board;

  // Forget ticks on items that are no longer on the board (e.g. unpinned).
  const present = new Set([...inv.clues.map((c) => `clue:${c.id}`), ...board.statements.map((s) => `statement:${s.id}`)]);
  for (const ref of selected) if (!present.has(ref)) selected.delete(ref);

  const tickbox = (ref, ...content) => {
    const box = el('input', { type: 'checkbox', checked: selected.has(ref) });
    box.addEventListener('change', () => {
      if (box.checked) selected.add(ref);
      else selected.delete(ref);
      if (selected.size > 2) { // keep at most two: drop the oldest tick
        selected.delete(selected.values().next().value);
      }
      draw();
    });
    return el('label', { className: 'board-item' }, box, el('span', {}, ...content));
  };

  $('board-clues').replaceChildren(
    ...(inv.clues.length
      ? inv.clues.map((c) => el('li', {}, tickbox(`clue:${c.id}`, el('b', {}, c.name), ` — ${c.description}`)))
      : [el('li', { className: 'hint' }, 'No clues yet. Search places on the map.')]),
  );

  $('board-statements').replaceChildren(
    ...(board.statements.length
      ? board.statements.map((s) => {
        const remove = el('button', { type: 'button', className: 'link' }, 'Remove');
        remove.addEventListener('click', async () => {
          const reply = await request('board:unpin', { statementId: s.id });
          $('board-error').textContent = reply.ok ? '' : reply.error;
        });
        return el('li', {}, tickbox(`statement:${s.id}`, el('b', {}, s.suspectName), `: "${s.text}" `, el('small', {}, `pinned by ${s.pinnedBy}`)), remove);
      })
      : [el('li', { className: 'hint' }, 'No statements yet. Pin answers from an interrogation.')]),
  );

  const checksLeft = board.checksMax - board.checksUsed;
  $('board-checks').textContent = `Contradiction checks left: ${checksLeft} of ${board.checksMax}. Selected: ${selected.size} of 2.`;
  $('board-link').disabled = selected.size !== 2 || checksLeft <= 0;

  const STATUS = {
    checking: ['checking', 'Checking…'],
    real: ['real', 'Real contradiction'],
    'not-real': ['not-real', 'Not a contradiction'],
    failed: ['failed', 'Could not be checked (not counted). Try again.'],
  };
  $('board-links').replaceChildren(
    ...(board.links.length
      ? [...board.links].reverse().map((l) => {
        const [cls, label] = STATUS[l.status];
        return el('li', { className: `link-row ${cls}` }, el('span', {}, l.aLabel), el('span', { className: 'link-x' }, '⟷'), el('span', {}, l.bLabel), el('strong', {}, label), el('small', {}, `linked by ${l.playerName}`));
      })
      : [el('li', { className: 'hint' }, 'No links yet.')]),
  );
}
