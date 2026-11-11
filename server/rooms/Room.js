// Room.js
// ONE Room object holds ALL the state of one game. There are no global game
// variables anywhere: if you have the room, you have everything.
// A single-player game is simply a Room with one player in it.

import crypto from 'node:crypto';
import { config } from '../config.js';

export const MAX_PLAYERS = 8;

export class Room {
  constructor(code, settings) {
    this.code = code;                 // 4 letters, e.g. "KQRT"
    this.settings = settings;         // { theme, difficulty, mode }
    this.phase = 'lobby';             // 'lobby' -> 'generating' -> 'investigation'
    this.generation = null;           // progress while the case is being written
    this.notice = null;               // a message for the lobby, e.g. "generation failed"
    this.caseCode = null;             // 6-character code to replay this case later
    this.players = new Map();         // playerId -> player object
    this.hostId = null;
    this.createdAt = Date.now();
    this.emptySince = null;           // set when nobody is connected; used for cleanup

    // SERVER-ONLY. Filled in phase 3 with the full solution of the case.
    // publicView.js never copies this object, so it can never reach a browser.
    this.caseTruth = null;

    // ---- investigation state (created by startInvestigation) ----
    this.interrogations = new Map(); // suspectId -> { questionsUsed, exchanges: [] }
    this.suspectQueues = new Map();  // suspectId -> promise chain (see interrogation/queue.js)
    this.totalQuestions = 0;         // across all suspects, for the room-wide limit
    this.nextId = 1;                 // simple counter for ids (exchanges, statements, links)

    this.actionsMax = 0;             // location searches allowed
    this.actionsLeft = 0;
    this.searched = new Map();       // locationId -> { by: playerName }
    this.foundClues = new Map();     // clueId -> { by: playerName }
    this.board = { statements: [], links: [] };
    this.linkChecksUsed = 0;
    this.cornered = false;           // true once the culprit faces proof they cannot explain
  }

  /** Called once the case is ready: opens the investigation. */
  startInvestigation(truth, caseCode) {
    this.caseTruth = truth;
    this.caseCode = caseCode;
    this.interrogations = new Map(truth.suspects.map((s) => [s.id, { questionsUsed: 0, exchanges: [] }]));
    this.suspectQueues = new Map();
    this.totalQuestions = 0;
    this.actionsMax = config.ACTIONS_PER_DAY || Math.max(1, truth.locations.length - 1);
    this.actionsLeft = this.actionsMax;
    this.searched = new Map();
    this.foundClues = new Map();
    this.board = { statements: [], links: [] };
    this.linkChecksUsed = 0;
    this.cornered = false;
    this.generation = null;
    this.phase = 'investigation';
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
