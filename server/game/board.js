// board.js
// The shared evidence board.
//
// What is on it:
//   - every clue the room has found (added automatically when a place is searched)
//   - statements: answers from interrogations that a player chose to pin
//   - links: a player says "these two items contradict each other", and the
//     server checks it against the secret truth.
//
// The check answers ONLY "real contradiction" or "not a contradiction". The
// reasoning behind it stays on the server, so a check never names the culprit.
// A real contradiction can just as well expose an innocent person hiding a
// secret, so "real" does not mean "this is the killer".

import { generateJson, ProviderError } from '../providers/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { z } from 'zod';

// "clue:c3" or "statement:12" -> { type, id }
export function parseItemRef(ref) {
  const [type, id] = ref.split(':');
  return { type, id: type === 'statement' ? Number(id) : id };
}

/** Find a board item by its reference. Returns null if it is not on the board. */
function findItem(room, ref) {
  const { type, id } = parseItemRef(ref);
  if (type === 'clue') {
    if (!room.foundClues.has(id)) return null;
    const clue = room.caseTruth.clues.find((c) => c.id === id);
    return clue ? { type, ref, clue, label: `Clue: ${clue.name}` } : null;
  }
  const statement = room.board.statements.find((s) => s.id === id);
  return statement ? { type, ref, statement, label: `${statement.suspectName}: "${shorten(statement.text, 90)}"` } : null;
}

function shorten(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---- pin / unpin a statement ------------------------------------------------------

export function pinStatement(room, player, exchangeId) {
  if (room.phase !== 'investigation') return { ok: false, error: 'There is no investigation in progress.' };
  for (const [suspectId, record] of room.interrogations) {
    const exchange = record.exchanges.find((e) => e.id === exchangeId);
    if (!exchange) continue;
    if (exchange.status !== 'answered') return { ok: false, error: 'Only answered questions can be pinned.' };
    if (room.board.statements.some((s) => s.exchangeId === exchangeId)) return { ok: false, error: 'That statement is already on the board.' };

    const suspect = room.caseTruth.suspects.find((s) => s.id === suspectId);
    room.board.statements.push({
      id: room.nextId++,
      exchangeId,
      suspectId,
      suspectName: suspect.name,
      text: exchange.answer,
      pinnedBy: player.name,
    });
    return { ok: true };
  }
  return { ok: false, error: 'There is no such statement.' };
}

export function unpinStatement(room, statementId) {
  if (room.phase !== 'investigation') return { ok: false, error: 'There is no investigation in progress.' };
  const before = room.board.statements.length;
  room.board.statements = room.board.statements.filter((s) => s.id !== statementId);
  return before === room.board.statements.length ? { ok: false, error: 'There is no such statement.' } : { ok: true };
}

// ---- link two items as a contradiction ------------------------------------------------

/**
 * Validates the link, records it as 'checking', and checks it in the
 * background. The result arrives through onUpdate().
 */
export function linkItems({ room, player, a, b, onUpdate }) {
  if (room.phase !== 'investigation') return { ok: false, error: 'There is no investigation in progress.' };
  if (a === b) return { ok: false, error: 'Choose two different items.' };

  const itemA = findItem(room, a);
  const itemB = findItem(room, b);
  if (!itemA || !itemB) return { ok: false, error: 'Both items must be on the board.' };
  if (itemA.type === 'clue' && itemB.type === 'clue') {
    return { ok: false, error: 'Clues are physical facts. Link a statement to a clue, or two statements.' };
  }

  const samePair = (l) => (l.a === a && l.b === b) || (l.a === b && l.b === a);
  if (room.board.links.some((l) => samePair(l) && l.status !== 'failed')) return { ok: false, error: 'Those two are already linked.' };
  if (room.linkChecksUsed >= config.LINK_CHECKS_PER_ROOM) return { ok: false, error: 'Your team has used all of its contradiction checks.' };
  if (room.board.links.some((l) => l.status === 'checking' && l.playerId === player.id)) {
    return { ok: false, error: 'Wait for your last check to finish.' };
  }

  // Reserve the check now (same reason as with questions: two at once).
  const link = {
    id: room.nextId++,
    a,
    b,
    // Labels are copied now, so the link still reads well if a pin is removed later.
    aLabel: itemA.label,
    bLabel: itemB.label,
    playerId: player.id,
    playerName: player.name,
    status: 'checking',
  };
  room.board.links.push(link);
  room.linkChecksUsed += 1;
  onUpdate();

  judge(room, itemA, itemB)
    .then((isReal) => { link.status = isReal ? 'real' : 'not-real'; })
    .catch((err) => {
      // The model failed: the check is given back.
      link.status = 'failed';
      room.linkChecksUsed -= 1;
      logger.warn(`room ${room.code}: contradiction check failed`, err instanceof ProviderError ? `${err.kind}: ${err.message}` : err);
    })
    .finally(onUpdate);

  return { ok: true };
}

// ---- the referee ------------------------------------------------------------------------

// Keep string limits small: Ollama turns the JSON schema into a "grammar",
// and it refuses lengths around 2000 characters ("failed to parse grammar").
const verdictSchema = z.object({
  reasoning: z.string().max(600),
  contradiction: z.boolean(),
});
const verdictJsonSchema = z.toJSONSchema(verdictSchema);

/** Describes one item for the referee, together with the secret facts it needs. */
function describe(room, item) {
  const truth = room.caseTruth;
  if (item.type === 'clue') {
    return `Physical clue "${item.clue.name}": ${item.clue.description} (What it really shows: ${item.clue.proves})`;
  }
  const suspect = truth.suspects.find((s) => s.id === item.statement.suspectId);
  const facts = [
    ...suspect.alibi.map((a) => `- At ${a.time}, ${suspect.name} claims: "${a.claim}" -> this claim is ${a.isTrue ? 'TRUE' : 'FALSE'}.`),
    ...suspect.lieRules.map((r) => `- ${suspect.name} says "${r.lie}" -> this is a LIE. The truth: ${r.truth}`),
  ];
  return `Statement by ${suspect.name}: "${item.statement.text}"
Secret facts about ${suspect.name}:
${facts.join('\n')}`;
}

/** Asks the model, with the full truth, whether two items really contradict. */
async function judge(room, itemA, itemB) {
  const truth = room.caseTruth;
  const timeline = truth.timeline.map((t) => `- ${t.time}: ${t.event}`).join('\n');

  const raw = await generateJson({
    system: 'You are a strict, impartial referee who checks detectives\' reasoning against the secret truth of a murder case. You answer with JSON only.',
    messages: [{
      role: 'user',
      content:
`THE SECRET TRUE TIMELINE:
${timeline}

ITEM A:
${describe(room, itemA)}

ITEM B:
${describe(room, itemB)}

QUESTION: Do item A and item B genuinely contradict each other? That means: according to the secret facts, they cannot both be true, because one of them is a lie or a false claim that the other one exposes.
Two items that are unrelated, merely suspicious, or about different times and places are NOT a contradiction. Two true items are never a contradiction.

Answer with JSON: {"reasoning": "<one or two sentences>", "contradiction": true or false}`,
    }],
    json: verdictJsonSchema,
    temperature: 0,
    maxTokens: 300,
    timeoutMs: config.LLM_TIMEOUT_MS,
  });

  const parsed = verdictSchema.safeParse(raw);
  if (!parsed.success) throw new ProviderError('bad_response', 'referee answer had the wrong shape');
  // Server log only. Never sent to a browser: it may name the culprit.
  logger.info(`room ${room.code}: link ${itemA.ref} x ${itemB.ref} -> ${parsed.data.contradiction} (${parsed.data.reasoning.slice(0, 160)})`);
  return parsed.data.contradiction;
}
