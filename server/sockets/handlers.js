// handlers.js
// Every message a browser can send arrives here.
//
// Each handler follows the same four steps:
//   1. validate the payload with zod            (is the message well-formed?)
//   2. find the room and player of this socket  (is the sender who they claim?)
//   3. change the Room                          (the server is the only one who can)
//   4. broadcast the new public view            (browsers only display it)

import { config } from '../config.js';
import { logger } from '../logger.js';
import { generate, ProviderError } from '../providers/index.js';
import { createRoom, getRoom, deleteRoom } from '../rooms/roomManager.js';
import { generateCase, CaseGenerationError, MAX_ATTEMPTS } from '../case/generate.js';
import { saveCase, loadCase, caseExists } from '../case/store.js';
import { MAX_PLAYERS } from '../rooms/Room.js';
import { toPublicRoom } from '../rooms/publicView.js';
import { attachRateLimit } from './rateLimit.js';
import {
  createRoomSchema, joinRoomSchema, readySchema, emptySchema, askSchema,
  showClueSchema, searchSchema, pinSchema, unpinSchema, linkSchema,
} from './schemas.js';
import { askSuspect } from '../interrogation/interrogate.js';
import { searchLocation } from '../game/locations.js';
import { pinStatement, unpinStatement, linkItems } from '../game/board.js';

// In the lobby, a player who disconnects is removed after this grace period
// (long enough to survive a page refresh or a phone switching networks).
const LOBBY_GRACE_MS = 30 * 1000;

export function registerSocketHandlers(io) {
  // ---- helpers that need `io` ------------------------------------------------

  /** Send every connected player THEIR OWN view of the room. */
  function broadcastRoom(room) {
    for (const player of room.players.values()) {
      if (player.connected && player.socketId) {
        io.to(player.socketId).emit('room:state', toPublicRoom(room, player.id));
      }
    }
  }

  /** Link a socket to a player (used on create, join and reconnect). */
  function attach(socket, room, player) {
    // Same player already open in another tab/socket? The newest one wins.
    if (player.socketId && player.socketId !== socket.id) {
      const old = io.sockets.sockets.get(player.socketId);
      if (old) {
        old.data.roomCode = null;
        old.data.playerId = null;
        old.emit('session:replaced');
      }
    }
    clearTimeout(player.removalTimer);
    player.removalTimer = null;
    player.connected = true;
    player.socketId = socket.id;
    // socket.data is per-connection storage kept on the SERVER. The browser
    // cannot edit it, which is why we trust it to say who this socket is.
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    room.emptySince = null;
  }

  /** Remove this socket's player from its room completely (they chose to leave). */
  function leaveCurrentRoom(socket) {
    const room = getRoom(socket.data.roomCode || '');
    const playerId = socket.data.playerId;
    socket.data.roomCode = null;
    socket.data.playerId = null;
    if (!room || !room.players.has(playerId)) return;

    room.removePlayer(playerId);
    if (room.players.size === 0) deleteRoom(room.code);
    else broadcastRoom(room);
  }

  /**
   * Gets a case for the room: loads a saved one (replay) or generates a new
   * one. Runs in the background after game:start. It never throws: on any
   * failure the room goes back to the lobby with a message, so the game
   * cannot get stuck.
   */
  async function prepareCase(room) {
    // The room may be deleted while we wait (everyone left). Always re-check.
    const stillOpen = () => getRoom(room.code) === room;
    try {
      let truth;
      let caseCode;

      if (room.settings.caseCode) {
        const saved = await loadCase(room.settings.caseCode);
        if (!saved) throw new CaseGenerationError('saved case is missing or invalid', []);
        truth = saved.truth;
        caseCode = saved.caseCode;
        room.settings.theme = saved.theme;         // show the real theme of the replayed case
        room.settings.difficulty = saved.difficulty;
      } else {
        const result = await generateCase({
          theme: room.settings.theme,
          difficulty: room.settings.difficulty,
          onProgress: (progress) => {
            if (!stillOpen()) return;
            room.generation = progress;
            broadcastRoom(room);
          },
        });
        truth = result.truth;
        caseCode = await saveCase(result);
      }

      if (!stillOpen()) return;
      room.startInvestigation(truth, caseCode); // the truth stays on the server; see publicView.js
      logger.info(`room ${room.code} is investigating case ${caseCode}`);
      broadcastRoom(room);
    } catch (err) {
      // The details (which may quote the solution) go to the server log only.
      logger.error(`room ${room.code} could not get a case`, err instanceof CaseGenerationError ? { message: err.message, attempts: err.attempts.map((a) => ({ stage: a.stage, problems: a.problems })) } : err);
      if (!stillOpen()) return;
      room.phase = 'lobby';
      room.generation = null;
      room.notice = 'The case could not be written this time. Please try again.';
      for (const player of room.players.values()) player.ready = false;
      broadcastRoom(room);
    }
  }

  io.on('connection', (socket) => {
    attachRateLimit(socket);

    /**
     * Registers an event with validation built in, so no handler can forget it.
     *   needsRoom: true  -> the sender must already be a player in a room;
     *                       the handler receives { room, player }.
     */
    function on(event, schema, { needsRoom }, handler) {
      socket.on(event, async (payload, ack) => {
        // Messages with no data may arrive as (ack) instead of (payload, ack).
        if (typeof payload === 'function') { ack = payload; payload = {}; }
        const reply = typeof ack === 'function' ? ack : () => {};

        const parsed = schema.safeParse(payload ?? {});
        if (!parsed.success) {
          return reply({ ok: false, error: friendlyValidationError(parsed.error) });
        }

        let context = {};
        if (needsRoom) {
          const room = getRoom(socket.data.roomCode || '');
          const player = room?.players.get(socket.data.playerId);
          if (!room || !player) return reply({ ok: false, error: 'You are not in a room.' });
          context = { room, player };
        }

        try {
          const result = await handler(parsed.data, context);
          reply(result ?? { ok: true });
        } catch (err) {
          // A bug in one handler must never crash the server or leak details.
          logger.error(`handler ${event} failed`, err);
          reply({ ok: false, error: 'Something went wrong on the server.' });
        }
      });
    }

    // ---- room:create ---------------------------------------------------------
    on('room:create', createRoomSchema, { needsRoom: false }, async (data) => {
      // Replaying a saved case? Check it exists BEFORE creating the room.
      if (data.caseCode && !(await caseExists(data.caseCode))) {
        return { ok: false, error: 'No saved case with that code.' };
      }

      leaveCurrentRoom(socket); // a socket is only ever in one room

      const room = createRoom({ theme: data.theme, difficulty: data.difficulty, mode: data.mode, caseCode: data.caseCode || null });
      if (!room) return { ok: false, error: 'The server is full right now. Try again later.' };

      const player = room.addPlayer(data.name); // first player becomes host
      attach(socket, room, player);
      broadcastRoom(room);
      return { ok: true, code: room.code, token: player.token };
    });

    // ---- room:join (also used to come back after a disconnect) ---------------
    on('room:join', joinRoomSchema, { needsRoom: false }, (data) => {
      const room = getRoom(data.code);
      if (!room) return { ok: false, error: 'No room with that code.' };

      // Already in a different room with this socket? Leave it first.
      if (socket.data.roomCode && socket.data.roomCode !== room.code) leaveCurrentRoom(socket);

      let player = room.findPlayerByName(data.name);
      if (player) {
        // Someone with this name exists. You may take the seat back if:
        //   - you hold that player's secret token (same browser tab), or
        //   - that player is currently disconnected (same name + code rule).
        const hasToken = data.token && data.token === player.token;
        if (!hasToken && player.connected) {
          return { ok: false, error: 'That name is already taken in this room.' };
        }
      } else {
        if (room.phase !== 'lobby') return { ok: false, error: 'That game has already started.' };
        if (room.players.size >= MAX_PLAYERS) return { ok: false, error: 'That room is full.' };
        player = room.addPlayer(data.name);
      }

      attach(socket, room, player);
      broadcastRoom(room);
      return { ok: true, code: room.code, token: player.token };
    });

    // ---- room:leave ----------------------------------------------------------
    on('room:leave', emptySchema, { needsRoom: true }, () => {
      leaveCurrentRoom(socket);
    });

    // ---- player:ready --------------------------------------------------------
    on('player:ready', readySchema, { needsRoom: true }, (data, { room, player }) => {
      if (room.phase !== 'lobby') return { ok: false, error: 'The game has already started.' };
      player.ready = data.ready;
      broadcastRoom(room);
    });

    // ---- game:start (host only) ----------------------------------------------
    on('game:start', emptySchema, { needsRoom: true }, (data, { room, player }) => {
      if (player.id !== room.hostId) return { ok: false, error: 'Only the host can start the game.' };
      if (room.phase !== 'lobby') return { ok: false, error: 'The game has already started.' };
      if (!room.canStart()) return { ok: false, error: 'Everyone must be ready first.' };

      room.phase = 'generating';
      room.notice = null;
      room.generation = { attempt: 1, maxAttempts: MAX_ATTEMPTS, stage: 'writing the story' };
      logger.info(`room ${room.code} starting with ${room.connectedPlayers().length} player(s)`);
      broadcastRoom(room);

      // Writing a case takes a minute or more. We do NOT wait for it here:
      // the host gets an immediate "ok", and everyone is updated through
      // 'room:state' as the work progresses. (No "await" on purpose.)
      prepareCase(room);
    });

    // ---- interrogation:ask ---------------------------------------------------
    // Replies at once ("your question is in line"). The answer itself arrives
    // later, to everyone in the room, through 'room:state'.
    on('interrogation:ask', askSchema, { needsRoom: true }, (data, { room, player }) => {
      return askSuspect({
        room,
        player,
        suspectId: data.suspectId,
        text: data.text,
        onUpdate: () => { if (getRoom(room.code) === room) broadcastRoom(room); },
      });
    });

    // ---- interrogation:showClue ----------------------------------------------
    // Same line and same limit as a question; the "question" is a found clue.
    on('interrogation:showClue', showClueSchema, { needsRoom: true }, (data, { room, player }) => {
      return askSuspect({
        room,
        player,
        suspectId: data.suspectId,
        clueId: data.clueId,
        onUpdate: () => { if (getRoom(room.code) === room) broadcastRoom(room); },
      });
    });

    // ---- location:search -----------------------------------------------------
    on('location:search', searchSchema, { needsRoom: true }, (data, { room, player }) => {
      const result = searchLocation(room, player, data.locationId);
      if (result.ok && !result.alreadySearched) broadcastRoom(room);
      return result;
    });

    // ---- evidence board ------------------------------------------------------
    on('board:pin', pinSchema, { needsRoom: true }, (data, { room, player }) => {
      const result = pinStatement(room, player, data.exchangeId);
      if (result.ok) broadcastRoom(room);
      return result;
    });

    on('board:unpin', unpinSchema, { needsRoom: true }, (data, { room }) => {
      const result = unpinStatement(room, data.statementId);
      if (result.ok) broadcastRoom(room);
      return result;
    });

    on('board:link', linkSchema, { needsRoom: true }, (data, { room, player }) => {
      return linkItems({
        room,
        player,
        a: data.a,
        b: data.b,
        onUpdate: () => { if (getRoom(room.code) === room) broadcastRoom(room); },
      });
    });

    // ---- disconnect (tab closed, wifi lost, page refreshed...) ---------------
    socket.on('disconnect', () => {
      const room = getRoom(socket.data.roomCode || '');
      const player = room?.players.get(socket.data.playerId);
      // Ignore if this socket was already replaced by a newer one for the player.
      if (!room || !player || player.socketId !== socket.id) return;

      player.connected = false;
      player.socketId = null;
      player.ready = false;

      if (room.phase === 'lobby') {
        // Still in the lobby: free the seat if they do not come back soon.
        player.removalTimer = setTimeout(() => {
          if (player.connected) return;
          room.removePlayer(player.id);
          if (room.players.size === 0) deleteRoom(room.code);
          else broadcastRoom(room);
        }, LOBBY_GRACE_MS);
      }
      // (Once a game is running the player is kept, so they can return.)

      if (room.connectedPlayers().length === 0) room.emptySince = Date.now();
      broadcastRoom(room);
    });

    // ---- debug:modelTest (phase 1 check, development only) -------------------
    // The prompt is FIXED on the server: the browser cannot send its own text,
    // so this cannot be abused as a free chatbot.
    let lastTestAt = 0;
    socket.on('debug:modelTest', async (ack) => {
      if (typeof ack !== 'function') return;
      if (config.NODE_ENV === 'production') return ack({ ok: false, error: 'Not available.' });
      if (Date.now() - lastTestAt < 3000) return ack({ ok: false, error: 'Slow down a little.' });
      lastTestAt = Date.now();

      const startedAt = Date.now();
      try {
        const text = await generate({
          system: 'You are the narrator of a 1920s noir detective story. Answer in English.',
          messages: [{ role: 'user', content: 'Write one short, moody opening sentence for a murder mystery.' }],
          maxTokens: 80,
        });
        ack({ ok: true, text, ms: Date.now() - startedAt });
      } catch (err) {
        // Full details go to the SERVER log; the browser gets a short safe message.
        logger.error('model test failed', err);
        const kind = err instanceof ProviderError ? err.kind : 'unknown';
        ack({ ok: false, kind, error: friendlyModelError(kind) });
      }
    });
  });
}

// Problems a normal player can cause (name too long, bad code...) have friendly
// messages written in schemas.js, and we show those. Problems only a tampered
// client can cause (wrong types, extra fields, unknown options) get a generic
// reply, so we do not describe our message format to someone poking at it.
function friendlyValidationError(zodError) {
  const issue = zodError.issues[0];
  const tamperCodes = ['invalid_type', 'unrecognized_keys', 'invalid_value', 'invalid_union'];
  if (!issue || tamperCodes.includes(issue.code)) return 'Invalid message.';
  return issue.message;
}

function friendlyModelError(kind) {
  if (kind === 'timeout') return 'The model took too long to answer. Try again.';
  if (kind === 'unavailable') return 'The model is not reachable right now. Check the server log.';
  return 'The model gave an unusable answer. Try again.';
}
