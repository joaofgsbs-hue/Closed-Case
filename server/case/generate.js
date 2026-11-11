// generate.js
// Creates one new murder case.
//
//   step 0  code builds the logic skeleton            (skeleton.js, no AI)
//   step 1  model writes the world and the cast       (JSON, validated by zod)
//   step 2  model writes what each clue looks like    (JSON, validated by zod)
//   step 3  code assembles the full "case truth"      (assemble.js)
//   step 4  zod validates the whole thing
//   step 5  code checks the logic                     (checkStructure)
//   step 6  model re-checks it blind                  (blindSolve)
//
// If a step fails we try again (up to MAX_ATTEMPTS in total), telling the model
// what was wrong. Work that was already good is kept: if only the clues were
// bad, the world is not written again.

import { generateJson, ProviderError } from '../providers/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { caseTruthSchema, worldSchema, worldJsonSchema, cluesSchema, cluesJsonSchema } from './schema.js';
import { buildSkeleton } from './skeleton.js';
import { assembleCase } from './assemble.js';
import { checkStructure, blindSolve } from './verify.js';
import { THEME_INFO, DIFFICULTY_INFO } from './themes.js';

export const MAX_ATTEMPTS = 3;

export class CaseGenerationError extends Error {
  constructor(message, attempts) {
    super(message);
    this.name = 'CaseGenerationError';
    this.attempts = attempts; // details of every failed attempt, for the server log
  }
}

// ---- one generation at a time ---------------------------------------------------
// A local model can only write one case at a time. If two rooms start together,
// the second waits its turn here instead of both timing out.
// `queue` is a promise chain: each new job starts when the previous one ends.
let queue = Promise.resolve();
function runExclusive(job) {
  const result = queue.then(job);
  queue = result.catch(() => {}); // a failed job must not block the next one
  return result;
}

const SYSTEM =
  'You are an expert writer of classic fair-play murder mysteries. You write vivid, specific, concrete details. ' +
  'You always answer with one JSON object and nothing else. All text is in English.';

function feedbackBlock(feedback) {
  if (!feedback?.length) return '';
  return `\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED FOR THESE REASONS. Fix every one of them:\n${feedback.map((p) => `- ${p}`).join('\n')}`;
}

// ---- step 1: the world and the cast -------------------------------------------------
function worldPrompt(skeleton, feedback) {
  const t = THEME_INFO[skeleton.theme];
  const d = DIFFICULTY_INFO[skeleton.difficulty];
  const { locations } = skeleton;

  // Tell the model what each place is FOR, so its descriptions fit the plot.
  const jobOf = (id) => {
    if (id === locations.scene) return 'a quiet place where a person could be killed without being heard. The body is found here.';
    if (id === locations.hall) return 'the main social room, where everyone gathered earlier in the evening.';
    if (id === locations.fakeAlibi) return 'a small private place where one person could plausibly spend half an hour alone.';
    return 'another distinct place where one or two people could spend half an hour.';
  };
  const locationLines = locations.all.map((id, i) => `  ${i + 1}. ${jobOf(id)}`).join('\n');
  const culpritNumber = Number(skeleton.culprit.slice(1));

  return `Invent the world and the cast of a murder mystery.

THEME: ${t.label}
${t.brief}

"locations": exactly ${d.locations} places, in this order. They are all rooms or areas of the SAME building or grounds, at most two minutes' walk from each other. Each needs a short evocative "name" and a "description" (1 or 2 short sentences, what a visitor sees):
${locationLines}

"victim": "name", "description" (who they were and why people had strong feelings about them, 1-2 sentences), and "causeOfDeath" (what a doctor would report, 1 sentence; it must fit this method: ${skeleton.method}). The victim is an adult.

"suspects": exactly ${d.suspects} adults, in order. For each:
- "name": a full name that fits the theme. All names must be clearly different from each other and from the victim's.
- "relationToVictim": 1 sentence.
- "personality": how they speak and behave under questioning, 1 sentence.
- "publicDescription": job and appearance, 1 sentence.
- "secret": something shameful or illegal they are hiding that is NOT the murder and NOT violent, 1 sentence.
- "secretLie": the false thing they say out loud to hide that secret, in the first person, 1 sentence.

Suspect number ${culpritNumber} is the murderer. Do not hint at this in their public description.
"motiveDetail": 2 sentences telling the specific story of why suspect ${culpritNumber} killed the victim. Theme of the motive: ${skeleton.motive}. Use both their names.
"methodDetail": 2 sentences describing exactly how suspect ${culpritNumber} did it. Method: ${skeleton.method}.

Also give the case a short evocative "title", and a "setting" with "place", "era" and a 2-sentence "description".
Keep every field short. Never write more than 2 sentences in any field.${feedbackBlock(feedback)}`;
}

// ---- step 2: the clues ----------------------------------------------------------------
function cluesPrompt(skeleton, world, feedback) {
  const { times, locations } = skeleton;
  const suspect = (id) => world.suspects[Number(id.slice(1)) - 1];
  const place = (id) => world.locations[Number(id.slice(1)) - 1].name;
  const culprit = suspect(skeleton.culprit);
  const victim = world.victim.name;

  // What each kind of clue has to show. The facts are fixed; only the object is invented.
  const brief = (c) => {
    const who = c.pointsToSuspectId ? suspect(c.pointsToSuspectId) : null;
    switch (c.role) {
      case 'weapon':
        return `The murder weapon or the physical trace of how ${victim} died (${world.methodDetail}). It shows HOW the murder was done. It must NOT identify any person.`;
      case 'culpritItem':
        return `A personal belonging of ${culprit.name}, dropped near the body. The description MUST make the owner unmistakable (engraved full name or initials, a monogram, or an object everyone knows is theirs). It proves ${culprit.name} was in ${place(locations.scene)}.`;
      case 'alibiBreaker':
        return `A record or physical fact showing that NOBODY was inside ${place(locations.fakeAlibi)} between ${times.culpritLeaves} and ${times.culpritReturns} (for example: it was locked from outside, a log shows no entry, something was left undisturbed). ${culprit.name} claims to have been alone there at ${times.death}; "proves" must say this shows that claim is false.`;
      case 'motive':
        return `A document (letter, ledger, will, diary page, message) that reveals this motive: ${world.motiveDetail} The description must quote or mention ${culprit.name} by name.`;
      case 'alibiRecord':
        return `A time-stamped record or object proving that ${who.name} really was in ${place(c.locationId)} at ${times.death}. Mention the time ${times.death} and the name ${who.name} in the description. "proves" must say it clears ${who.name}.`;
      case 'secret':
        return `Evidence of ${who.name}'s secret (${who.secret}). It makes ${who.name} look suspicious. "proves" must say it exposes the secret but has nothing to do with the murder.`;
      case 'hiddenTrace':
        return `Something ${culprit.name} hurriedly hid after the murder (for example a stained glove or handkerchief with their initials, or a half-burned note). The description must make clear it belongs to ${culprit.name}. It proves they tried to hide evidence.`;
      case 'redHerring':
        return `A MISLEADING clue: an object that at first seems to incriminate ${who.name}, who is innocent. "proves" must give the innocent explanation, connected to ${who.name}'s secret (${who.secret}) or daily routine, and say it is unrelated to the murder.`;
      default:
        return '';
    }
  };

  const lines = skeleton.clues
    .map((c, i) => `${i + 1}. Found in ${place(c.locationId)}. ${brief(c)}`)
    .join('\n');

  return `Write the physical clues for this murder mystery.

CASE: "${world.title}" - ${world.setting.place}, ${world.setting.era}.
VICTIM: ${victim}. ${world.victim.causeOfDeath}
PEOPLE: ${world.suspects.map((s) => s.name).join('; ')}.
PLACES: ${world.locations.map((l) => l.name).join('; ')}.

Write exactly ${skeleton.clues.length} clues, in this exact order. For each clue give:
- "name": 2 to 5 words.
- "description": only what the detectives can physically see, 1-2 concrete sentences. Include every name, initial or time the brief asks for.
- "proves": what it means for the investigation, 1 sentence.

Every clue must be a different kind of object.

${lines}${feedbackBlock(feedback)}`;
}

/**
 * @param {object}   opts
 * @param {string}   opts.theme
 * @param {string}   opts.difficulty
 * @param {boolean}  [opts.verify=true]   set false to skip the blind-solve call (debug only)
 * @param {function} [opts.onProgress]    called with { attempt, maxAttempts, stage }
 * @returns {Promise<{ truth, attempts, theme, difficulty }>}
 * @throws CaseGenerationError when every attempt failed
 */
export function generateCase(opts) {
  return runExclusive(() => generateCaseNow(opts));
}

async function generateCaseNow({ theme, difficulty, verify = true, onProgress = () => {} }) {
  const d = DIFFICULTY_INFO[difficulty];
  const skeleton = buildSkeleton({ theme, difficulty });

  const attempts = [];
  let world = null;         // kept between attempts once it is valid
  let worldFeedback = null;
  let cluesFeedback = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const record = { attempt, stage: 'world', problems: [], ms: 0, steps: {} };
    attempts.push(record);
    const startedAt = Date.now();
    const progress = (stage) => onProgress({ attempt, maxAttempts: MAX_ATTEMPTS, stage });
    // Small stopwatch so the debug command can show where the time goes.
    const timed = async (name, job) => {
      const t0 = Date.now();
      try { return await job(); } finally { record.steps[name] = Date.now() - t0; }
    };

    try {
      // ---- step 1: world (skipped if a previous attempt already wrote a good one)
      if (!world) {
        progress('writing the story');
        const raw = await timed('world', () => generateJson({
          system: SYSTEM,
          messages: [{ role: 'user', content: worldPrompt(skeleton, worldFeedback) }],
          json: worldJsonSchema,
          temperature: 0.9,
          maxTokens: 2200,
          timeoutMs: config.CASE_TIMEOUT_MS,
        }));
        const parsed = worldSchema.safeParse(raw);
        const problems = parsed.success ? checkWorld(parsed.data, d) : zodProblems(parsed.error);
        if (problems.length) {
          record.problems = problems;
          worldFeedback = problems;
          continue;
        }
        world = parsed.data;
      }

      // ---- step 2: clues ---------------------------------------------------------
      record.stage = 'clues';
      progress('planting the clues');
      const rawClues = await timed('clues', () => generateJson({
        system: SYSTEM,
        messages: [{ role: 'user', content: cluesPrompt(skeleton, world, cluesFeedback) }],
        json: cluesJsonSchema,
        temperature: 0.7,
        maxTokens: 1800,
        timeoutMs: config.CASE_TIMEOUT_MS,
      }));
      const parsedClues = cluesSchema.safeParse(rawClues);
      if (!parsedClues.success) {
        record.problems = zodProblems(parsedClues.error);
        cluesFeedback = record.problems;
        continue;
      }
      if (parsedClues.data.clues.length !== skeleton.clues.length) {
        record.problems = [`You must write exactly ${skeleton.clues.length} clues, but you wrote ${parsedClues.data.clues.length}.`];
        cluesFeedback = record.problems;
        continue;
      }

      const clueProblems = checkClueTexts(skeleton, world, parsedClues.data.clues);
      if (clueProblems.length) {
        record.problems = clueProblems;
        cluesFeedback = clueProblems;
        continue;
      }

      // ---- steps 3-5: assemble, then validate shape and logic ------------------------
      record.stage = 'structure';
      const assembled = caseTruthSchema.safeParse(assembleCase(skeleton, world, parsedClues.data.clues));
      if (!assembled.success) {
        record.problems = zodProblems(assembled.error);
        cluesFeedback = record.problems;
        continue;
      }
      const truth = assembled.data;
      const structural = checkStructure(truth, { difficulty, culpritId: skeleton.culprit });
      if (structural.length) {
        // The skeleton guarantees this cannot happen. If it does, it is OUR bug.
        record.problems = structural;
        logger.error('assembled case failed structural checks', structural);
        continue;
      }

      // ---- step 6: can a detective actually solve it? ---------------------------------
      if (verify) {
        record.stage = 'verify';
        progress('checking it can be solved');
        const check = await timed('verify', () => blindSolve(truth));
        record.verdict = check.verdict;
        if (!check.ok) {
          record.problems = check.problems;
          cluesFeedback = check.problems; // unclear clues are the usual cause
          continue;
        }
      }

      record.stage = 'accepted';
      return { truth, attempts, theme, difficulty };
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err; // a real bug: do not hide it
      // Timeout / unreachable / not JSON: count the attempt and try again.
      record.problems = [`${err.kind}: ${err.message}`];
      logger.warn(`case generation attempt ${attempt} failed at ${record.stage}`, err.message);
      // If the model cannot be reached at all, more attempts will not help.
      if (err.kind === 'unavailable') break;
    } finally {
      record.ms = Date.now() - startedAt;
    }
  }

  throw new CaseGenerationError(`No valid case after ${attempts.length} attempt(s)`, attempts);
}

function zodProblems(error) {
  return error.issues.slice(0, 8).map((i) => `Field "${i.path.join('.')}": ${i.message}`);
}

/**
 * Does each clue actually SAY what its job requires? Code cannot judge prose,
 * but it can check that the right names appear - which is what makes a clue
 * usable as evidence. Returns problems as feedback for the next attempt.
 */
function checkClueTexts(skeleton, world, clueTexts) {
  const problems = [];
  const nameOf = (id) => world.suspects[Number(id.slice(1)) - 1].name;
  // "Margarida Coelho" matches if the text has "Margarida" or "Coelho".
  const mentions = (text, fullName) => fullName.split(/\s+/).filter((part) => part.length > 2).some((part) => text.toLowerCase().includes(part.toLowerCase()));

  skeleton.clues.forEach((c, i) => {
    const text = clueTexts[i];
    const n = i + 1;
    if (c.role === 'weapon') {
      const named = world.suspects.find((s) => mentions(text.description, s.name));
      if (named) problems.push(`Clue ${n} (the murder weapon) must not mention any suspect, but its description mentions ${named.name}.`);
    } else if (c.pointsToSuspectId && !c.isRedHerring) {
      const who = nameOf(c.pointsToSuspectId);
      if (!mentions(`${text.description} ${text.proves}`, who)) {
        problems.push(`Clue ${n} must mention ${who} by name in its description.`);
      }
    }
  });
  return problems;
}

/** Things zod cannot express: exact counts and unique names. */
function checkWorld(world, d) {
  const problems = [];
  if (world.suspects.length !== d.suspects) problems.push(`"suspects" must have exactly ${d.suspects} entries, but has ${world.suspects.length}.`);
  if (world.locations.length !== d.locations) problems.push(`"locations" must have exactly ${d.locations} entries, but has ${world.locations.length}.`);

  const names = [world.victim.name, ...world.suspects.map((s) => s.name)].map((n) => n.toLowerCase());
  if (new Set(names).size !== names.length) problems.push('Every suspect and the victim must have a different name.');
  const places = world.locations.map((l) => l.name.toLowerCase());
  if (new Set(places).size !== places.length) problems.push('Every location must have a different name.');
  return problems;
}
