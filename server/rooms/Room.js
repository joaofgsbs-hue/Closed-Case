// Room.js
// ONE Room object holds ALL the state of one game. There are no global game
// variables anywhere: if you have the room, you have everything.
// A single-player game is simply a Room with one player in it.

import crypto from 'node:crypto';

export const MAX_PLAYERS = 8;

export class Room {
  constructor(code, settings) {
    this.code = code;                 // 4 letters, e.g. "KQRT"
    this.settings = settings;         // { theme, difficulty, mode }
    this.phase = 'lobby';             // 'lobby' -> 'starting' -> (later phases add more)
    this.players = new Map();         // playerId -> player object
    this.hostId = null;
    this.createdAt = Date.now();
    this.emptySince = null;           // set when nobody is connected; used for cleanup

    // SERVER-ONLY. Filled in phase 3 with the full solution of the case.
    // publicView.js never reads this field, so it can never reach a browser.
    this.caseTruth = null;
  }

  /** Names are compared without caring about upper/lower case or outer spaces. */
  findPlayerByName(name) {
    const wanted = name.trim().toLowerCase();
    for (const player of this.players.values()) {
      if (player.name.toLowerCase() === wanted) return player;
    }
    return null;
  }

  addPlayer(name) {
    const player = {
      id: crypto.randomUUID(),
      name: name.trim(),
      ready: false,
      connected: true,
      socketId: null,
      // Secret that proves "I am this player" when a browser tab reconnects.
      // Only ever sent to that player's own browser.
      token: crypto.randomBytes(16).toString('hex'),
      removalTimer: null,
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id; // first player in is the host
    return player;
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    clearTimeout(player.removalTimer);
    this.players.delete(playerId);

    // If the host left, hand the room to someone else (prefer a connected player).
    if (this.hostId === playerId) {
      const others = [...this.players.values()];
      const next = others.find((p) => p.connected) || others[0];
      this.hostId = next ? next.id : null;
    }
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  /** The host can start when every connected player has pressed "Ready". */
  canStart() {
    const connected = this.connectedPlayers();
    return this.phase === 'lobby' && connected.length > 0 && connected.every((p) => p.ready);
  }
}
