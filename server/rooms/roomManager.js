// roomManager.js
// Keeps the list of rooms that currently exist: code -> Room.
// This Map is the only "global" in the server, and it holds rooms, not game
// state. All game state lives inside each Room.

import crypto from 'node:crypto';
import { Room } from './Room.js';
import { logger } from '../logger.js';

const rooms = new Map();

// No I or O: they look like 1 and 0 when a friend reads the code out loud.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const EMPTY_ROOM_LIFETIME_MS = 10 * 60 * 1000; // keep an abandoned room for 10 minutes
const MAX_ROOMS = 200;                          // simple protection against room spam

function randomCode() {
  let code = '';
  // crypto.randomInt is unpredictable, so codes cannot be guessed in sequence.
  for (let i = 0; i < 4; i++) code += LETTERS[crypto.randomInt(LETTERS.length)];
  return code;
}

export function createRoom(settings) {
  if (rooms.size >= MAX_ROOMS) return null;
  let code;
  do { code = randomCode(); } while (rooms.has(code)); // retry on the rare collision
  const room = new Room(code, settings);
  rooms.set(code, room);
  logger.info(`room ${code} created (${rooms.size} open)`);
  return room;
}

export function getRoom(code) {
  return rooms.get(String(code).toUpperCase()) || null;
}

export function deleteRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  for (const player of room.players.values()) clearTimeout(player.removalTimer);
  rooms.delete(code);
  logger.info(`room ${code} deleted (${rooms.size} open)`);
}

// Once a minute, delete rooms where nobody has been connected for a while.
// .unref() means this timer alone will not keep the Node process alive.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.emptySince && now - room.emptySince > EMPTY_ROOM_LIFETIME_MS) deleteRoom(room.code);
  }
}, 60 * 1000).unref();
