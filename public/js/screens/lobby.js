// lobby.js - the waiting room. It only DRAWS the state the server sends.

import { $, el } from '../dom.js';
import { request } from '../net.js';

const THEME_LABELS = {
  'noir-lisbon-1920s': 'Noir — Lisbon, 1920s',
  spaceship: 'Spaceship',
  'elite-school': 'Elite school',
  'luxury-hotel': 'Luxury hotel',
};
const DIFFICULTY_LABELS = { easy: 'Easy', hard: 'Hard' };
const MODE_LABELS = { coop: 'Co-op', competitive: 'Competitive' };

let current = null; // the last room state we received

export function initLobby({ onLeave }) {
  $('lobby-ready').addEventListener('click', async () => {
    const me = current.players.find((p) => p.id === current.you.id);
    showError(await request('player:ready', { ready: !me.ready }));
  });

  $('lobby-start').addEventListener('click', async () => {
    showError(await request('game:start'));
  });

  $('lobby-leave').addEventListener('click', onLeave);

  $('lobby-copy').addEventListener('click', async () => {
    const link = `${location.origin}/?room=${current.code}`;
    try {
      await navigator.clipboard.writeText(link);
      $('lobby-copy').textContent = 'Link copied!';
    } catch {
      // Clipboard can be blocked (e.g. not https). Show the link instead.
      $('lobby-copy').textContent = link;
    }
    setTimeout(() => { $('lobby-copy').textContent = 'Copy invite link'; }, 2500);
  });
}

function showError(reply) {
  $('lobby-error').textContent = reply.ok ? '' : reply.error;
}

/** Redraw the whole lobby from a room state. Called on every 'room:state'. */
export function renderLobby(room) {
  current = room;
  const me = room.players.find((p) => p.id === room.you.id);
  const iAmHost = room.hostId === room.you.id;

  $('lobby-code').textContent = room.code;
  $('lobby-settings').replaceChildren(
    el('li', {}, THEME_LABELS[room.settings.theme] || room.settings.theme),
    el('li', {}, DIFFICULTY_LABELS[room.settings.difficulty] || room.settings.difficulty),
    el('li', {}, MODE_LABELS[room.settings.mode] || room.settings.mode),
  );

  // e.g. "The case could not be written this time."
  $('lobby-notice').textContent = room.notice || '';
  $('lobby-notice').hidden = !room.notice;

  $('lobby-count').textContent = `(${room.players.length})`;
  $('lobby-players').replaceChildren(
    ...room.players.map((player) => {
      const tags = [];
      if (player.isHost) tags.push('host');
      if (player.id === room.you.id) tags.push('you');
      const status = !player.connected ? 'disconnected' : player.ready ? 'ready' : 'not ready';
      return el(
        'li',
        { className: `player ${player.connected ? '' : 'offline'}` },
        el('span', { className: 'player-name' }, player.name, tags.length ? el('small', {}, ` ${tags.join(' · ')}`) : ''),
        el('span', { className: `badge ${player.connected && player.ready ? 'ok' : ''}` }, status),
      );
    }),
  );

  $('lobby-ready').textContent = me?.ready ? "I'm not ready" : "I'm ready";
  $('lobby-ready').classList.toggle('secondary', Boolean(me?.ready));
  $('lobby-ready').classList.toggle('primary', !me?.ready);

  // Only the host sees the Start button, and the server double-checks anyway.
  $('lobby-start').hidden = !iAmHost;
  $('lobby-start').disabled = !room.canStart;
  $('lobby-hint').textContent = iAmHost
    ? room.canStart ? 'Everyone is ready. You can start.' : 'You can start when everyone is ready.'
    : 'Waiting for the host to start the case.';
}
