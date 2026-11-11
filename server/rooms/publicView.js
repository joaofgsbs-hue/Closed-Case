// publicView.js
// THE ONLY PLACE that turns a Room into data for a browser.
//
// Security rule of the whole project: handlers never send a Room object (or a
// piece of one) directly. They call toPublicRoom(), which builds a NEW object
// field by field. Anything not copied here - room.caseTruth, player tokens,
// socket ids - simply cannot leak, even by accident.
//
// `viewerId` is the player this view is for. Today every player sees the same
// thing plus "you"; in competitive / traitor modes the views will differ.

import { config } from '../config.js';

/**
 * The part of a case every detective knows from the start: who died, where,
 * and who the suspects are. Copied field by field from the secret truth.
 *
 * NOT copied (and so never sent): solution, timeline, contradictions,
 * confessionClueIds, clues, and each suspect's personality, alibi, secret,
 * lieRules and knowledge. Location descriptions are revealed later, on a visit.
 */
function toPublicCase(room) {
  const truth = room.caseTruth;
  if (!truth) return null;
  return {
    caseCode: room.caseCode,
    title: truth.title,
    setting: {
      place: truth.setting.place,
      era: truth.setting.era,
      description: truth.setting.description,
    },
    victim: {
      name: truth.victim.name,
      description: truth.victim.description,
      causeOfDeath: truth.victim.causeOfDeath,
      timeOfDeath: truth.victim.timeOfDeath,
      foundAtLocationId: truth.victim.foundAtLocationId,
    },
    suspects: truth.suspects.map((s) => ({
      id: s.id,
      name: s.name,
      relationToVictim: s.relationToVictim,
      publicDescription: s.publicDescription,
    })),
    locations: truth.locations.map((l) => ({ id: l.id, name: l.name })),
  };
}

/**
 * The interrogation transcripts. Everything here was already said out loud in
 * the room, so it is safe to show: questions, answers, and the counters.
 * The suspects' prompts and private facts are never part of this.
 */
function toPublicInterrogations(room) {
  if (!room.caseTruth) return null;
  return {
    questionsPerSuspect: config.QUESTIONS_PER_SUSPECT,
    roomQuestionsUsed: room.totalQuestions,
    roomQuestionsMax: config.MAX_QUESTIONS_PER_ROOM,
    suspects: [...room.interrogations.entries()].map(([suspectId, record]) => ({
      suspectId,
      questionsUsed: record.questionsUsed,
      exchanges: record.exchanges.map((e) => ({
        id: e.id,
        kind: e.kind,
        playerId: e.playerId,
        playerName: e.playerName,
        question: e.question,
        clueId: e.clueId,
        clueName: e.clueName,
        answer: e.answer,
        status: e.status,
        pinned: room.board.statements.some((s) => s.exchangeId === e.id),
      })),
    })),
  };
}

/**
 * Map, found clues and the evidence board.
 * A place's description is only sent once someone has searched it. For a
 * clue, only what the detectives can SEE is sent: never `proves`,
 * `pointsToSuspectId` or `isRedHerring`.
 */
function toPublicInvestigation(room) {
  const truth = room.caseTruth;
  if (!truth) return null;
  return {
    actionsLeft: room.actionsLeft,
    actionsMax: room.actionsMax,
    locations: truth.locations.map((l) => {
      const searched = room.searched.get(l.id);
      return {
        id: l.id,
        name: l.name,
        searched: Boolean(searched),
        searchedBy: searched ? searched.by : null,
        description: searched ? l.description : null,
      };
    }),
    clues: truth.clues
      .filter((c) => room.foundClues.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        locationId: c.locationId,
        foundBy: room.foundClues.get(c.id).by,
      })),
    board: {
      statements: room.board.statements.map((s) => ({
        id: s.id,
        exchangeId: s.exchangeId,
        suspectId: s.suspectId,
        suspectName: s.suspectName,
        text: s.text,
        pinnedBy: s.pinnedBy,
      })),
      links: room.board.links.map((l) => ({
        id: l.id,
        a: l.a,
        b: l.b,
        aLabel: l.aLabel,
        bLabel: l.bLabel,
        playerName: l.playerName,
        status: l.status, // 'checking' | 'real' | 'not-real' | 'failed'
      })),
      checksUsed: room.linkChecksUsed,
      checksMax: config.LINK_CHECKS_PER_ROOM,
    },
  };
}

export function toPublicRoom(room, viewerId) {
  return {
    code: room.code,
    phase: room.phase,
    generation: room.generation
      ? { attempt: room.generation.attempt, maxAttempts: room.generation.maxAttempts, stage: room.generation.stage }
      : null,
    notice: room.notice,
    case: toPublicCase(room),
    interrogations: toPublicInterrogations(room),
    investigation: toPublicInvestigation(room),
    settings: {
      theme: room.settings.theme,
      difficulty: room.settings.difficulty,
      mode: room.settings.mode,
    },
    hostId: room.hostId,
    canStart: room.canStart(),
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      ready: player.ready,
      connected: player.connected,
      isHost: player.id === room.hostId,
      // deliberately NOT copied: token, socketId, removalTimer
    })),
    you: { id: viewerId },
  };
}
