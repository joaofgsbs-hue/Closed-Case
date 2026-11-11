// briefing.js - the opening case file: victim, suspects, locations.
// It shows only the PUBLIC part of the case. The server never sends the rest.

import { $, el } from '../dom.js';

let onOpenSuspect = () => {};

/** main.js tells us what to do when a suspect is tapped. */
export function initBriefing(options) {
  onOpenSuspect = options.onOpenSuspect;
}

export function renderBriefing(room) {
  const c = room.case;
  if (!c) return;

  $('game-code').textContent = room.code;
  $('game-casecode').textContent = c.caseCode || '';
  $('game-title').textContent = c.title;
  $('game-setting').textContent = `${c.setting.place}, ${c.setting.era}. ${c.setting.description}`;

  $('game-victim-name').textContent = c.victim.name;
  $('game-victim-desc').textContent = c.victim.description;
  const foundAt = c.locations.find((l) => l.id === c.victim.foundAtLocationId);
  $('game-victim-facts').replaceChildren(
    el('li', {}, `Cause of death: ${c.victim.causeOfDeath}`),
    el('li', {}, `Estimated time of death: ${c.victim.timeOfDeath}`),
    el('li', {}, `Body found in: ${foundAt ? foundAt.name : 'unknown'}`),
  );

  const info = room.interrogations;
  $('game-suspects').replaceChildren(
    ...c.suspects.map((s) => {
      const used = info ? info.suspects.find((r) => r.suspectId === s.id).questionsUsed : 0;
      // A real <button> so it works with the keyboard and screen readers too.
      const button = el(
        'button',
        { type: 'button', className: 'suspect-card' },
        el('strong', {}, s.name),
        el('span', {}, s.relationToVictim),
        el('span', {}, s.publicDescription),
        el('span', { className: 'suspect-count' }, info ? `${used}/${info.questionsPerSuspect} questions` : ''),
      );
      button.addEventListener('click', () => onOpenSuspect(s.id));
      return el('li', {}, button);
    }),
  );
  $('game-room-questions').textContent = info
    ? `Questions left for the whole room: ${info.roomQuestionsMax - info.roomQuestionsUsed} of ${info.roomQuestionsMax}.`
    : '';
  // (The locations now live in the Map tab, see hub.js.)
}
