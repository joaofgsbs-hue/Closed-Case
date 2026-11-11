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
  // Optional: replay a saved case instead of generating a new one.
  // Same strict pattern as the case files on disk (see case/store.js).
  caseCode: z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{6}$/, 'Case codes are 6 letters or digits.').optional(),
}).strict();

export const joinRoomSchema = z.object({
  code: roomCode,
  name: playerName,
  token: z.string().regex(/^[a-f0-9]{32}$/).optional(), // only sent when reconnecting
}).strict();

export const readySchema = z.object({ ready: z.boolean() }).strict();

export const MAX_QUESTION_LENGTH = 300;

export const askSchema = z.object({
  suspectId: z.string().regex(/^s[1-9]$/),
  text: z.string().trim().min(1, 'Type a question first.').max(MAX_QUESTION_LENGTH, `Questions can have at most ${MAX_QUESTION_LENGTH} characters.`),
}).strict();

const suspectIdField = z.string().regex(/^s[1-9]$/);
const clueIdField = z.string().regex(/^c([1-9]|1[0-9])$/);
const numericId = z.number().int().positive().max(1_000_000);

export const showClueSchema = z.object({ suspectId: suspectIdField, clueId: clueIdField }).strict();
export const searchSchema = z.object({ locationId: z.string().regex(/^l[1-9]$/) }).strict();
export const pinSchema = z.object({ exchangeId: numericId }).strict();
export const unpinSchema = z.object({ statementId: numericId }).strict();

// A board item is written "clue:c3" or "statement:12".
const itemRef = z.string().regex(/^(clue:c([1-9]|1[0-9])|statement:[1-9][0-9]{0,6})$/);
export const linkSchema = z.object({ a: itemRef, b: itemRef }).strict();

// For messages that carry no data at all.
export const emptySchema = z.object({}).strict();
