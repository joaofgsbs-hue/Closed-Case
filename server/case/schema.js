// schema.js
// The shape of the "case truth": the full, secret solution of one murder.
// It exists ONLY on the server. The same zod schema is used twice:
//   1. converted to JSON Schema and given to the model, so it knows the shape;
//   2. to validate what the model sends back (never trust the model either).

import { z } from 'zod';

// Ids are short and predictable: s1..s6 suspects, l1..l6 locations, c1..c10 clues.
// Short ids are much easier for a small model to cross-reference correctly.
const suspectId = z.string().regex(/^s[1-9]$/);
const locationId = z.string().regex(/^l[1-9]$/);
const clueId = z.string().regex(/^c([1-9]|1[0-9])$/);

// 24-hour clock, always two digits each side: "21:05".
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

const text = (max) => z.string().trim().min(1).max(max);

const alibiEntry = z.object({
  time,
  locationId,
  claim: text(300),   // what the suspect SAYS they were doing
  isTrue: z.boolean(), // whether that claim is actually true
});

const lieRule = z.object({
  topic: text(120),   // what the lie is about
  lie: text(300),     // what they say
  truth: text(700),   // what really happened
});

const suspect = z.object({
  id: suspectId,
  name: text(60),
  relationToVictim: text(160),
  personality: text(240),       // how they talk and behave (used in interrogation)
  publicDescription: text(240), // what everyone can see about them
  alibi: z.array(alibiEntry).min(2).max(5),
  secret: text(300),            // something they hide that is NOT the murder
  lieRules: z.array(lieRule).max(4),
  knowledge: z.array(text(900)).min(1).max(5), // things they saw or heard
});

const location = z.object({
  id: locationId,
  name: text(60),
  description: text(400),
});

const clue = z.object({
  id: clueId,
  name: text(80),
  description: text(400),            // what the detectives physically find
  locationId,
  proves: text(500),                 // what it proves or suggests
  pointsToSuspectId: suspectId.nullable(),
  isRedHerring: z.boolean(),
});

const timelineEvent = z.object({
  time,
  event: text(900),
  suspectIds: z.array(suspectId).max(6),
  locationId,
});

const contradiction = z.object({
  suspectId,                 // who made the false claim
  claim: text(300),          // the false claim
  contradictedByClueId: clueId,
  explanation: text(700),
});

export const caseTruthSchema = z.object({
  title: text(80),
  setting: z.object({
    place: text(120),
    era: text(80),
    description: text(500),
  }),
  victim: z.object({
    name: text(60),
    description: text(300),
    causeOfDeath: text(200),
    timeOfDeath: time,
    foundAtLocationId: locationId,
  }),
  locations: z.array(location).min(4).max(6),
  suspects: z.array(suspect).min(4).max(6),
  solution: z.object({
    culpritId: suspectId,
    motive: text(400),
    method: text(400),
    opportunity: text(600),
    // The short category picked by code (one entry of the theme's lists in
    // themes.js). The accusation is multiple choice, and these are the right
    // answers. Optional only so cases saved before phase 6 still load.
    motiveCategory: text(200).optional(),
    methodCategory: text(200).optional(),
  }),
  timeline: z.array(timelineEvent).min(6).max(16),
  clues: z.array(clue).min(6).max(10),
  contradictions: z.array(contradiction).min(2).max(6),
  confessionClueIds: z.array(clueId).min(1).max(3),
});

// ---- what the MODEL writes -------------------------------------------------------
// The model never writes the whole case. It answers two smaller questions, and
// code merges its answers with the logic skeleton (see assemble.js).

// Call 1: the world and the cast.
export const worldSchema = z.object({
  title: text(80),
  setting: z.object({ place: text(120), era: text(80), description: text(500) }),
  victim: z.object({ name: text(60), description: text(300), causeOfDeath: text(200) }),
  locations: z.array(z.object({ name: text(60), description: text(400) })).min(4).max(6),
  suspects: z.array(z.object({
    name: text(60),
    relationToVictim: text(160),
    personality: text(240),
    publicDescription: text(240),
    secret: text(300),
    secretLie: text(300), // what they say to hide the secret
  })).min(4).max(6),
  motiveDetail: text(400),
  methodDetail: text(400),
});

// Call 2: what each clue looks like.
export const cluesSchema = z.object({
  clues: z.array(z.object({
    name: text(80),
    description: text(400),
    proves: text(400),
  })).min(6).max(10),
});

export const worldJsonSchema = z.toJSONSchema(worldSchema);
export const cluesJsonSchema = z.toJSONSchema(cluesSchema);

// What the verification call must answer. "reasoning" comes FIRST on purpose:
// the model writes its fields in order, so it has to think before it names anyone.
export const verdictSchema = z.object({
  reasoning: text(1500),
  culpritId: suspectId,
  onlyOnePossibleCulprit: z.boolean(),
  cluesAreSufficient: z.boolean(),
});

// z.toJSONSchema (zod 4) converts a zod schema to standard JSON Schema.
export const caseTruthJsonSchema = z.toJSONSchema(caseTruthSchema);
export const verdictJsonSchema = z.toJSONSchema(verdictSchema);
