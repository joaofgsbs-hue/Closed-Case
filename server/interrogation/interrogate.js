// interrogate.js
// One player asks one suspect one question - or shows them a clue.
//
// Vocabulary: an "exchange" is a question (or a shown clue) with its answer.
//   kind   'question' - the player typed something
//          'clue'     - the player showed a clue the room has found
//   status 'pending'  - waiting in line or being answered
//          'answered' - done; it is now part of the suspect's memory
//          'failed'   - the model did not answer; it does NOT count and is
//                       NOT remembered, so the player can simply try again

import { generate, ProviderError } from '../providers/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { enqueue } from './queue.js';
import { buildSuspectPrompt, formatQuestion, formatClueShown } from './suspectPrompt.js';
import { findProblem, cleanAnswer, cleanQuestion } from './guards.js';

/**
 * Validates the request against the room's limits and, if allowed, puts it
 * in the suspect's line. Returns immediately; the answer arrives later
 * through onUpdate().
 *
 * Pass `text` for a question, or `clueId` to show a clue.
 * @param {function} onUpdate  called whenever the room changed and should be re-broadcast
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function askSuspect({ room, player, suspectId, text, clueId, onUpdate }) {
  if (room.phase !== 'investigation') return { ok: false, error: 'There is no investigation in progress.' };

  const truth = room.caseTruth;
  const suspect = truth.suspects.find((s) => s.id === suspectId);
  const record = room.interrogations.get(suspectId);
  if (!suspect || !record) return { ok: false, error: 'There is no such suspect.' };

  let question = '';
  let clue = null;
  if (clueId) {
    // A player can only show what the ROOM has actually found.
    clue = truth.clues.find((c) => c.id === clueId);
    if (!clue || !room.foundClues.has(clueId)) return { ok: false, error: 'Your team has not found that clue.' };
  } else {
    question = cleanQuestion(text);
    if (!question) return { ok: false, error: 'Type a question first.' };
  }

  // ---- limits (they protect the fun, and the computer running the model) ------
  if (record.questionsUsed >= config.QUESTIONS_PER_SUSPECT) {
    return { ok: false, error: `${suspect.name} will not answer any more questions.` };
  }
  if (room.totalQuestions >= config.MAX_QUESTIONS_PER_ROOM) {
    return { ok: false, error: 'This room has used all of its questions.' };
  }
  // One question in flight per player: nobody can flood the line.
  const alreadyWaiting = [...room.interrogations.values()].some((r) => r.exchanges.some((e) => e.status === 'pending' && e.playerId === player.id));
  if (alreadyWaiting) return { ok: false, error: 'Wait for the answer to your last question.' };

  // ---- does this exchange corner the culprit? (decided by CODE, never by the model)
  // The culprit may only confess when a player shows them one of the key
  // clues AND the room has found every key clue - proof they cannot explain away.
  // The flag belongs to THIS exchange: a question that was already waiting in
  // line before it must still get the "deny everything" version.
  const corners = Boolean(clue) && suspect.id === truth.solution.culpritId
    && truth.confessionClueIds.includes(clue.id)
    && truth.confessionClueIds.every((id) => room.foundClues.has(id));

  // Reserve the question NOW, before the model is called. Otherwise two
  // players asking at once could both pass the limit checks above.
  const exchange = {
    id: room.nextId++,
    kind: clue ? 'clue' : 'question',
    playerId: player.id,
    playerName: player.name,
    question,                          // empty for a shown clue
    clueId: clue ? clue.id : null,
    clueName: clue ? clue.name : null,
    answer: null,
    status: 'pending',
    corners,                           // server only: never copied by publicView.js
  };
  record.exchanges.push(exchange);
  record.questionsUsed += 1;
  room.totalQuestions += 1;
  onUpdate();

  enqueue(room.suspectQueues, suspectId, async () => {
    try {
      exchange.answer = await answerAs(room, suspect, record, exchange);
      exchange.status = 'answered';
      if (exchange.corners && !room.cornered) {
        room.cornered = true; // from now on the culprit stays "broken"
        logger.info(`room ${room.code}: the culprit has been cornered`);
      }
    } catch (err) {
      // Timeout, model down, or an answer the guards rejected twice.
      // Give the question back: it was not spent.
      exchange.status = 'failed';
      record.questionsUsed -= 1;
      room.totalQuestions -= 1;
      logger.warn(`room ${room.code}: ${suspectId} failed to answer`, err instanceof ProviderError ? `${err.kind}: ${err.message}` : err);
    } finally {
      onUpdate();
    }
  });

  return { ok: true };
}

/** How one exchange is shown to the suspect in its memory. */
function asMessage(room, exchange) {
  if (exchange.kind === 'clue') {
    const clue = room.caseTruth.clues.find((c) => c.id === exchange.clueId);
    return formatClueShown(exchange.playerName, clue);
  }
  return formatQuestion(exchange.playerName, exchange.question);
}

/** Calls the model as this suspect. Throws ProviderError if no usable answer comes back. */
async function answerAs(room, suspect, record, exchange) {
  const truth = room.caseTruth;
  const isCulprit = suspect.id === truth.solution.culpritId;
  // Earlier exchanges run first (the line keeps order), so room.cornered is
  // only true here if a PREVIOUS exchange already cornered the culprit.
  const mayConfess = isCulprit && (room.cornered || exchange.corners);
  const system = buildSuspectPrompt(truth, suspect, { cornered: mayConfess });

  // The suspect's MEMORY: every exchange already answered, in order.
  // (Failed and still-pending ones are left out.) This is read here, when the
  // job actually runs, so it includes answers given while we waited in line.
  const messages = [];
  for (const past of record.exchanges) {
    if (past.status !== 'answered') continue;
    messages.push({ role: 'user', content: asMessage(room, past) });
    messages.push({ role: 'assistant', content: past.answer });
  }
  let current = asMessage(room, exchange);
  if (exchange.corners) {
    // A note only the suspect "hears". A small model follows the LAST message
    // much more closely than the instructions at the top, so the decision that
    // code already took is repeated right here.
    current += `\n\n(Inner thought of ${suspect.name}, not spoken: "They have found it all. I cannot lie my way out of this any more." You now confess, out loud, that you killed ${truth.victim.name}, how, and why.)`;
  }
  messages.push({ role: 'user', content: current });

  // Up to two tries: if the guards reject the first answer, ask once more
  // with a reminder. A second rejection counts as a failure.
  let reminder = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await generate({
      system: system + reminder,
      messages,
      // Lower temperature = fewer invented details. Some variety is still wanted.
      temperature: 0.5,
      maxTokens: 180,
      timeoutMs: config.LLM_TIMEOUT_MS,
    });
    const answer = cleanAnswer(raw, suspect.name);
    const problem = answer
      ? findProblem(answer, { mayConfess, question: exchange.question, victimName: truth.victim.name })
      : 'empty answer';
    if (!problem) return answer;

    // Server log only: the rejected text helps tune the prompt and never reaches a player.
    logger.warn(`room ${room.code}: answer from ${suspect.id} rejected (${problem}), attempt ${attempt}: ${answer.slice(0, 200)}`);
    reminder = `\n\nIMPORTANT REMINDER: Answer only as ${suspect.name}, a person inside this world.${mayConfess ? '' : ' Do not confess to anything.'} Do not mention anything outside this world.`;
  }
  throw new ProviderError('bad_response', 'the suspect gave no acceptable answer');
}
