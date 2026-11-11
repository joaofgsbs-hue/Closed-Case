// skeleton.js
// The LOGIC of a case, built by plain code - no AI involved.
//
// Why: a small local model is good at writing atmosphere but bad at keeping
// twenty cross-referenced facts consistent. So we split the work:
//
//   code  decides who did it, where everyone really was, who saw what, and
//         which clue proves which fact. This part is correct by construction.
//   model only writes the fiction on top: names, places, secrets, and what
//         each clue looks like.
//
// A "skeleton" is that logic with ids instead of names, e.g.
//   "s3 killed the victim in l2 at 21:40, claims to have been alone in l4".

import { DIFFICULTY_INFO, THEME_INFO, MOTIVES, pick } from './themes.js';

/** Fisher-Yates shuffle: returns a new array in random order. */
function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** addMinutes("21:55", 10) -> "22:05" */
export function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function buildSkeleton({ theme, difficulty }) {
  const d = DIFFICULTY_INFO[difficulty];

  // ---- when --------------------------------------------------------------------
  // Time of death: a random 5-minute step between 21:00 and 22:55.
  const death = addMinutes('21:00', 5 * Math.floor(Math.random() * 24));
  const times = {
    gathering: addMinutes(death, -45), // everyone together, victim still alive
    victimLeaves: addMinutes(death, -35),
    culpritLeaves: addMinutes(death, -10),
    sighting: addMinutes(death, -8),   // a witness sees the culprit on the way
    death,
    culpritReturns: addMinutes(death, 12),
    after: addMinutes(death, 30),
    discovery: addMinutes(death, 40),
  };

  // ---- where: give each location a job in the story -----------------------------
  const locationIds = shuffle(Array.from({ length: d.locations }, (_, i) => `l${i + 1}`));
  const [scene, hall, fakeAlibi, ...quiet] = locationIds;
  // scene     = where the murder happens and the body is found
  // hall      = where everyone gathered earlier, and where some stay
  // fakeAlibi = where the culprit CLAIMS to have been (it was empty)
  // quiet     = one or two other places where innocent people really were

  // ---- who: give each suspect a job in the story --------------------------------
  const suspectIds = shuffle(Array.from({ length: d.suspects }, (_, i) => `s${i + 1}`));
  const culprit = suspectIds[0];
  const innocents = suspectIds.slice(1);

  // Innocent people are placed so that each one can be cleared:
  //   - a PAIR was together (they confirm each other),
  //   - one LONER was alone, but a time-stamped record (a clue) clears them.
  const loner = innocents[0];
  const groups = [];
  if (difficulty === 'easy') {
    groups.push({ members: [innocents[1], innocents[2]], locationId: hall });
  } else {
    groups.push({ members: [innocents[1], innocents[2]], locationId: hall });
    groups.push({ members: [innocents[3], innocents[4]], locationId: quiet[1] });
  }
  const lonerLocation = quiet[0];
  const hallPair = groups[0].members;

  const suspects = suspectIds.map((id) => {
    if (id === culprit) return { id, role: 'culprit', atDeath: scene, claimsAtDeath: fakeAlibi, with: [] };
    if (id === loner) return { id, role: 'loner', atDeath: lonerLocation, claimsAtDeath: lonerLocation, with: [] };
    const group = groups.find((g) => g.members.includes(id));
    return { id, role: 'paired', atDeath: group.locationId, claimsAtDeath: group.locationId, with: group.members.filter((m) => m !== id) };
  });

  // ---- clues: each one has a fixed job --------------------------------------------
  // The model will later write what each clue LOOKS like; what it PROVES is
  // already decided here.
  const clues = [
    { role: 'weapon', locationId: scene, pointsToSuspectId: null, isRedHerring: false },
    { role: 'culpritItem', locationId: scene, pointsToSuspectId: culprit, isRedHerring: false },
    { role: 'alibiBreaker', locationId: fakeAlibi, pointsToSuspectId: culprit, isRedHerring: false },
    { role: 'motive', locationId: hall, pointsToSuspectId: culprit, isRedHerring: false },
    { role: 'alibiRecord', locationId: lonerLocation, pointsToSuspectId: loner, isRedHerring: false },
    { role: 'secret', locationId: hall, pointsToSuspectId: hallPair[0], isRedHerring: false },
  ];
  if (difficulty === 'hard') {
    clues.push(
      { role: 'hiddenTrace', locationId: hall, pointsToSuspectId: culprit, isRedHerring: false },
      { role: 'redHerring', locationId: scene, pointsToSuspectId: groups[1].members[0], isRedHerring: true },
      { role: 'redHerring', locationId: quiet[1], pointsToSuspectId: loner, isRedHerring: true },
    );
  }
  // Shuffle so the clue number gives nothing away, then hand out ids c1..cN.
  const numberedClues = shuffle(clues).map((c, i) => ({ id: `c${i + 1}`, ...c }));

  return {
    theme,
    difficulty,
    method: pick(THEME_INFO[theme].methods),
    motive: pick(MOTIVES),
    times,
    locations: { all: [...locationIds].sort(), scene, hall, fakeAlibi, quiet },
    culprit,
    loner,
    witness: loner,           // saw the culprit heading to the scene
    secondWitness: hallPair[1], // saw which direction the culprit came back from
    discoverer: hallPair[0],  // finds the body
    groups,
    suspects,
    clues: numberedClues,
  };
}
