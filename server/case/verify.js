// verify.js
// Two independent checks that a generated case is playable.
//
//   checkStructure()  - plain code, instant and 100% reliable. Catches broken
//                       references and missing pieces ("clue c7 is in a
//                       location that does not exist").
//   blindSolve()      - a second model call. The model plays detective: it
//                       gets the evidence WITHOUT the solution and must name
//                       the culprit. If it names the right person, the clues
//                       really are enough.

import { generateJson } from '../providers/index.js';
import { config } from '../config.js';
import { verdictSchema, verdictJsonSchema } from './schema.js';
import { DIFFICULTY_INFO } from './themes.js';

/**
 * @returns {string[]} a list of problems in plain English. Empty = all good.
 * The same sentences are sent back to the model when we ask it to try again.
 */
export function checkStructure(truth, { difficulty, culpritId }) {
  const problems = [];
  const rules = DIFFICULTY_INFO[difficulty];

  const suspectIds = truth.suspects.map((s) => s.id);
  const locationIds = truth.locations.map((l) => l.id);
  const clueIds = truth.clues.map((c) => c.id);
  const clueById = new Map(truth.clues.map((c) => [c.id, c]));

  const hasDuplicates = (list) => new Set(list).size !== list.length;
  if (hasDuplicates(suspectIds)) problems.push('Two suspects share the same id.');
  if (hasDuplicates(locationIds)) problems.push('Two locations share the same id.');
  if (hasDuplicates(clueIds)) problems.push('Two clues share the same id.');
  if (hasDuplicates(truth.suspects.map((s) => s.name.toLowerCase()))) problems.push('Two suspects share the same name.');

  // ---- counts for this difficulty --------------------------------------------
  if (truth.suspects.length !== rules.suspects) {
    problems.push(`There must be exactly ${rules.suspects} suspects, but there are ${truth.suspects.length}.`);
  }
  if (truth.clues.length < rules.clues) {
    problems.push(`There must be at least ${rules.clues} clues, but there are ${truth.clues.length}.`);
  }
  const redHerrings = truth.clues.filter((c) => c.isRedHerring);
  if (redHerrings.length < rules.redHerrings) {
    problems.push(`There must be at least ${rules.redHerrings} red-herring clues (isRedHerring true), but there are ${redHerrings.length}.`);
  }
  if (redHerrings.length > Math.max(1, rules.redHerrings + 1)) {
    problems.push('There are too many red-herring clues.');
  }

  // ---- the culprit -------------------------------------------------------------
  const culprit = truth.suspects.find((s) => s.id === truth.solution.culpritId);
  if (!culprit) problems.push(`solution.culpritId "${truth.solution.culpritId}" is not one of the suspects.`);
  if (culpritId && truth.solution.culpritId !== culpritId) {
    problems.push(`solution.culpritId must be "${culpritId}".`);
  }
  if (truth.suspects.some((s) => s.name.toLowerCase() === truth.victim.name.toLowerCase())) {
    problems.push('The victim cannot also be a suspect.');
  }

  // ---- every reference must point at something that exists --------------------
  if (!locationIds.includes(truth.victim.foundAtLocationId)) problems.push('victim.foundAtLocationId is not a real location.');

  for (const s of truth.suspects) {
    for (const a of s.alibi) {
      if (!locationIds.includes(a.locationId)) problems.push(`Suspect ${s.id} has an alibi in "${a.locationId}", which is not a real location.`);
    }
  }
  for (const c of truth.clues) {
    if (!locationIds.includes(c.locationId)) problems.push(`Clue ${c.id} is in "${c.locationId}", which is not a real location.`);
    if (c.pointsToSuspectId !== null && !suspectIds.includes(c.pointsToSuspectId)) {
      problems.push(`Clue ${c.id} points to "${c.pointsToSuspectId}", who is not a suspect.`);
    }
  }
  for (const t of truth.timeline) {
    if (!locationIds.includes(t.locationId)) problems.push(`A timeline event at ${t.time} is in "${t.locationId}", which is not a real location.`);
    for (const id of t.suspectIds) {
      if (!suspectIds.includes(id)) problems.push(`A timeline event at ${t.time} mentions "${id}", who is not a suspect.`);
    }
  }

  // ---- the evidence must actually expose the culprit ---------------------------
  if (culprit) {
    const realCluesAgainstCulprit = truth.clues.filter((c) => !c.isRedHerring && c.pointsToSuspectId === culprit.id);
    if (realCluesAgainstCulprit.length < 2) {
      problems.push(`At least 2 real clues (isRedHerring false) must have pointsToSuspectId "${culprit.id}".`);
    }

    if (!culprit.alibi.some((a) => a.isTrue === false)) {
      problems.push(`The culprit ${culprit.id} must have at least one alibi entry with isTrue false (the lie about where they were).`);
    }
    if (culprit.lieRules.length === 0) {
      problems.push(`The culprit ${culprit.id} must have at least one lieRule.`);
    }

    const againstCulprit = truth.contradictions.filter((x) => x.suspectId === culprit.id);
    if (againstCulprit.length < 2) {
      problems.push(`At least 2 contradictions must have suspectId "${culprit.id}".`);
    }

    // The murder itself must be on the timeline, with the culprit present.
    const murderMoment = truth.timeline.find((t) => t.time === truth.victim.timeOfDeath && t.suspectIds.includes(culprit.id));
    if (!murderMoment) {
      problems.push(`The timeline must contain an event at exactly ${truth.victim.timeOfDeath} (victim.timeOfDeath) whose suspectIds include "${culprit.id}".`);
    }
  }

  for (const x of truth.contradictions) {
    if (!suspectIds.includes(x.suspectId)) problems.push(`A contradiction names "${x.suspectId}", who is not a suspect.`);
    const usedClue = clueById.get(x.contradictedByClueId);
    if (!usedClue) problems.push(`A contradiction uses clue "${x.contradictedByClueId}", which does not exist.`);
    else if (usedClue.isRedHerring) problems.push(`A contradiction uses clue ${usedClue.id}, but that clue is a red herring.`);
  }

  for (const id of truth.confessionClueIds) {
    const c = clueById.get(id);
    if (!c) problems.push(`confessionClueIds contains "${id}", which is not a real clue.`);
    else if (c.isRedHerring) problems.push(`confessionClueIds contains ${id}, but that clue is a red herring.`);
    else if (culprit && c.pointsToSuspectId !== culprit.id) problems.push(`confessionClueIds contains ${id}, but that clue does not point to the culprit.`);
  }

  // The time of death must sit inside the timeline, not before or after it.
  const times = truth.timeline.map((t) => t.time).sort();
  if (times.length && (truth.victim.timeOfDeath < times[0] || truth.victim.timeOfDeath > times[times.length - 1])) {
    problems.push('victim.timeOfDeath is outside the range of the timeline.');
  }

  return problems;
}

/**
 * Build what a perfect detective could learn by the end of the game:
 * every clue, every statement, every witness account - but NOT the solution,
 * NOT the true timeline, and NOT which statements are lies.
 */
export function buildDossier(truth) {
  return {
    setting: truth.setting,
    victim: truth.victim,
    locations: truth.locations.map((l) => ({ id: l.id, name: l.name })),
    suspects: truth.suspects.map((s) => ({
      id: s.id,
      name: s.name,
      relationToVictim: s.relationToVictim,
      whatTheyClaim: s.alibi.map((a) => `At ${a.time} (${a.locationId}): ${a.claim}`),
      otherStatements: s.lieRules.map((r) => `About ${r.topic}: ${r.lie}`),
      // The culprit's private knowledge includes the murder itself, which they
      // would never tell a detective. They only share the fact everyone shares.
      whatTheySawOrHeard: s.id === truth.solution.culpritId ? s.knowledge.slice(0, 1) : s.knowledge,
    })),
    clues: truth.clues.map((c) => ({
      id: c.id,
      name: c.name,
      foundIn: c.locationId,
      description: c.description,
      suggests: c.proves,
    })),
  };
}

/**
 * Second model call. Returns { ok, problems, verdict }.
 * Throws ProviderError if the model itself is unreachable or times out.
 */
export async function blindSolve(truth) {
  const dossier = buildDossier(truth);

  const raw = await generateJson({
    system:
      'You are a careful detective reviewing a finished murder investigation. ' +
      'You are given the evidence but not the solution. Exactly one of the suspects is the murderer. ' +
      'Some suspects lie about small things to hide personal secrets that are not the murder, and some clues may be misleading. ' +
      'Reason step by step from the evidence, then name the murderer. Answer in English, as JSON.',
    messages: [{
      role: 'user',
      content:
        `EVIDENCE:\n${JSON.stringify(dossier, null, 1)}\n\n` +
        'Answer with a JSON object with these fields, in this order:\n' +
        '- "reasoning": your step-by-step reasoning (under 150 words)\n' +
        '- "culpritId": the id of the murderer, e.g. "s2"\n' +
        '- "onlyOnePossibleCulprit": true if the evidence excludes every other suspect, false if someone else could equally have done it\n' +
        '- "cluesAreSufficient": true if the evidence is enough to be confident, false if you had to guess',
    }],
    json: verdictJsonSchema,
    temperature: 0.1, // we want careful, repeatable reasoning here, not creativity
    maxTokens: 700,
    timeoutMs: config.CASE_VERIFY_TIMEOUT_MS,
  });

  const parsed = verdictSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, problems: ['The verification answer was not in the expected format.'], verdict: null };
  }

  const verdict = parsed.data;
  const problems = [];
  if (verdict.culpritId !== truth.solution.culpritId) {
    problems.push(
      `A detective who studied all the evidence concluded the murderer was ${verdict.culpritId}, not ${truth.solution.culpritId}. ` +
      'The real clues must point more clearly at the true culprit, and the innocent suspects need alibis that hold.',
    );
  }
  if (!verdict.onlyOnePossibleCulprit) problems.push('The evidence does not exclude the other suspects. Give every innocent suspect a true alibi for the time of death that someone or something confirms.');
  if (!verdict.cluesAreSufficient) problems.push('The clues are not enough to be confident who did it. Make the real clues more specific.');

  return { ok: problems.length === 0, problems, verdict };
}
