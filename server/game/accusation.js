// accusation.js
// The end of a case: a player proposes an accusation, the room votes, and
// when MORE THAN HALF of the connected players agree, the verdict is read out
// to everyone at the same moment.
//
// An accusation has four parts:
//   - the culprit            (one of the suspects)
//   - the motive             (multiple choice, 4 options)
//   - the method             (multiple choice, 4 options)
//   - 2 or 3 found clues     (the evidence the team relies on)
//
// Why multiple choice for motive and method? Marking free text would need
// the model, which is slow and can be wrong. With fixed options, CODE decides
// the score: it is instant, fair, and the same every time.

import { THEME_INFO, MOTIVES } from '../case/themes.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

const OPTION_COUNT = 4;

// ---- points (the maximum is 100) ------------------------------------------------
export const POINTS = {
  culprit: 40,
  motive: 15,
  method: 15,
  perGoodClue: 10,
  evidenceMax: 20,  // two good clues are enough for full marks
  efficiencyMax: 10, // for leaving questions unused (only if the culprit is right)
};

// ---- options -------------------------------------------------------------------

/** Fisher-Yates shuffle on a copy (uses Math.random: fairness, not security). */
function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Cases saved before phase 6 do not store which category was used. We guess
 * it: the list entry that shares the most words with the detailed text.
 */
// Common words that say nothing about a motive or method.
const STOPWORDS = new Set(['that', 'could', 'never', 'with', 'from', 'about', 'been', 'have', 'them', 'they', 'their', 'this', 'were', 'when', 'which', 'would', 'into', 'over', 'other', 'there', 'what', 'after', 'before', 'gone', 'long']);
const wordsOf = (text) => (text.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOPWORDS.has(w));

function closestEntry(list, detail) {
  const words = new Set(wordsOf(detail));
  let best = list[0];
  let bestScore = -1;
  for (const entry of list) {
    const score = wordsOf(entry).filter((w) => words.has(w)).length;
    if (score > bestScore) { best = entry; bestScore = score; }
  }
  return best;
}

/** The right answer plus 3 wrong ones from the same list, in random order. */
function buildChoice(list, correct) {
  const wrong = shuffle(list.filter((entry) => entry !== correct)).slice(0, OPTION_COUNT - 1);
  const options = shuffle([correct, ...wrong]);
  return { options, correctIndex: options.indexOf(correct) };
}

/**
 * Called once when the investigation starts. The options themselves are
 * public (they are generic lists); only `correctIndex` is secret.
 */
export function buildAccusationOptions(truth, theme) {
  const methods = THEME_INFO[theme]?.methods || [];
  const motiveCorrect = truth.solution.motiveCategory || closestEntry(MOTIVES, truth.solution.motive);
  const methodCorrect = truth.solution.methodCategory || closestEntry(methods, truth.solution.method);
  return {
    motive: buildChoice(MOTIVES, motiveCorrect),
    method: buildChoice(methods.length ? methods : [methodCorrect], methodCorrect),
  };
}

// ---- proposing and voting ---------------------------------------------------------

/**
 * A player proposes an accusation. The proposer agrees with it automatically,
 * so in a solo game the verdict comes at once.
 */
export function proposeAccusation(room, player, { culpritId, motiveIndex, methodIndex, clueIds }) {
  if (room.phase !== 'investigation') return { ok: false, error: 'There is no investigation in progress.' };
  if (room.proposal) return { ok: false, error: 'An accusation is already being voted on.' };

  const truth = room.caseTruth;
  if (!truth.suspects.some((s) => s.id === culpritId)) return { ok: false, error: 'There is no such suspect.' };
  if (motiveIndex >= room.accusationOptions.motive.options.length) return { ok: false, error: 'Choose a motive.' };
  if (methodIndex >= room.accusationOptions.method.options.length) return { ok: false, error: 'Choose a method.' };
  if (new Set(clueIds).size !== clueIds.length) return { ok: false, error: 'Choose different clues.' };
  // Only clues the ROOM has found can be used as evidence.
  if (!clueIds.every((id) => room.foundClues.has(id))) return { ok: false, error: 'You can only use clues your team has found.' };

  room.proposal = {
    id: room.nextId++,
    byId: player.id,
    byName: player.name,
    culpritId,
    motiveIndex,
    methodIndex,
    clueIds: [...clueIds],
    votes: new Map([[player.id, true]]), // playerId -> true (agree) / false (disagree)
  };
  return { ok: true, ...settleVote(room) };
}

export function castVote(room, player, { proposalId, agree }) {
  if (room.phase !== 'investigation' || !room.proposal || room.proposal.id !== proposalId) {
    return { ok: false, error: 'That vote is already over.' };
  }
  room.proposal.votes.set(player.id, agree);
  return { ok: true, ...settleVote(room) };
}

/** The proposer may take their accusation back while it is being voted on. */
export function withdrawAccusation(room, player, { proposalId }) {
  if (!room.proposal || room.proposal.id !== proposalId) return { ok: false, error: 'That vote is already over.' };
  if (room.proposal.byId !== player.id) return { ok: false, error: 'Only the player who proposed it can withdraw it.' };
  room.lastVoteNote = `${player.name} withdrew their accusation.`;
  room.proposal = null;
  return { ok: true };
}

/**
 * Decides the vote if it can be decided. Called after every vote and also
 * when a player connects or disconnects, because the majority is counted
 * over the players who are CONNECTED right now.
 *
 *   accepted: agree * 2 > connected            (more than half)
 *   rejected: even if everyone still silent agreed, it could not pass
 */
export function settleVote(room) {
  const proposal = room.proposal;
  if (!proposal || room.phase !== 'investigation') return {};

  const voters = room.connectedPlayers();
  const n = voters.length;
  if (n === 0) return {}; // nobody here; wait for someone to come back
  const agree = voters.filter((p) => proposal.votes.get(p.id) === true).length;
  const disagree = voters.filter((p) => proposal.votes.get(p.id) === false).length;

  if (agree * 2 > n) {
    room.result = scoreAccusation(room, proposal);
    room.proposal = null;
    room.phase = 'ended';
    logger.info(`room ${room.code}: accusation accepted, solved=${room.result.solved}, score=${room.result.score}`);
    return { decided: 'accepted' };
  }
  if ((n - disagree) * 2 <= n) {
    room.lastVoteNote = `The accusation by ${proposal.byName} was voted down.`;
    room.proposal = null;
    return { decided: 'rejected' };
  }
  return {};
}

// ---- scoring ----------------------------------------------------------------------

/** Pure scoring by code. Returns everything the end screen needs. */
function scoreAccusation(room, proposal) {
  const truth = room.caseTruth;
  const options = room.accusationOptions;
  const culpritId = truth.solution.culpritId;

  const culpritRight = proposal.culpritId === culpritId;
  const motiveRight = proposal.motiveIndex === options.motive.correctIndex;
  const methodRight = proposal.methodIndex === options.method.correctIndex;

  // A clue is "good evidence" when it really points at the murderer.
  // Red herrings and clues about other people's secrets are not.
  const clues = proposal.clueIds.map((id) => {
    const clue = truth.clues.find((c) => c.id === id);
    return { id, name: clue.name, good: clue.pointsToSuspectId === culpritId && !clue.isRedHerring };
  });
  // Evidence only scores when it backs up the RIGHT accusation: a clue that
  // points at the real killer does not help a team that accused someone else.
  const goodClues = culpritRight ? clues.filter((c) => c.good).length : 0;

  // Efficiency: the fewer questions the room needed, the better. The
  // "budget" is what the room could have asked in total.
  const budget = Math.min(config.MAX_QUESTIONS_PER_ROOM, truth.suspects.length * config.QUESTIONS_PER_SUSPECT);
  const efficiency = culpritRight ? Math.round(POINTS.efficiencyMax * Math.max(0, 1 - room.totalQuestions / budget)) : 0;

  const breakdown = [
    { label: 'Culprit', points: culpritRight ? POINTS.culprit : 0, max: POINTS.culprit },
    { label: 'Motive', points: motiveRight ? POINTS.motive : 0, max: POINTS.motive },
    { label: 'Method', points: methodRight ? POINTS.method : 0, max: POINTS.method },
    { label: 'Evidence', points: Math.min(POINTS.evidenceMax, goodClues * POINTS.perGoodClue), max: POINTS.evidenceMax },
    { label: 'Efficiency', points: efficiency, max: POINTS.efficiencyMax },
  ];

  const nameOf = (id) => truth.suspects.find((s) => s.id === id).name;
  return {
    solved: culpritRight,
    score: breakdown.reduce((sum, row) => sum + row.points, 0),
    maxScore: breakdown.reduce((sum, row) => sum + row.max, 0),
    breakdown,
    accused: {
      proposedBy: proposal.byName,
      agreedBy: [...proposal.votes].filter(([, yes]) => yes).map(([id]) => room.players.get(id)?.name).filter(Boolean),
      culpritName: nameOf(proposal.culpritId),
      culpritRight,
      motive: options.motive.options[proposal.motiveIndex],
      motiveRight,
      method: options.method.options[proposal.methodIndex],
      methodRight,
      clues,
    },
    questionsUsed: room.totalQuestions,
    endedAt: new Date().toISOString(),
  };
}
