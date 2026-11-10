// schemas.js
// One zod schema per message the browser is allowed to send.
// Never trust the client: anyone can open the browser console and send
// anything. If a message does not match its schema, it is rejected before it
// touches any room.

import { z } from 'zod';

export const THEMES = ['noir-lisbon-1920s', 'spaceship', 'elite-school', 'luxury-hotel'];
export const DIFFICULTIES = ['easy', 'hard'];
export const MODES = ['coop', 'competitive']; // 'traitor' is added in phase 9

// 1-20 characters: letters (any alphabet), digits, spaces and a few symbols.
// \p{L} = any letter, \p{N} = any digit; the "u" flag turns that syntax on.
const playerName = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(20, 'Name is too long (max 20).')
  .regex(/^[\p{L}\p{N} _.'-]+$/u, 'Name has characters that are not allowed.');

const roomCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}$/, 'Room codes are 4 letters.');

// .strict() rejects objects that carry extra, unexpected fields.
export const createRoomSchema = z.object({
  name: playerName,
  theme: z.enum(THEMES),
  difficulty: z.enum(DIFFICULTIES),
  mode: z.enum(MODES),
}).strict();

export const joinRoomSchema = z.object({
  code: roomCode,
  name: playerName,
  token: z.string().regex(/^[a-f0-9]{32}$/).optional(), // only sent when reconnecting
}).strict();

export const readySchema = z.object({ ready: z.boolean() }).strict();

// For messages that carry no data at all.
export const emptySchema = z.object({}).strict();
