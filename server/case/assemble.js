// assemble.js
// Merges the three ingredients into the final "case truth":
//
//   skeleton (logic, from code) + world (fiction, from the model)
//                               + clue texts (fiction, from the model)
//
// Everything that must be logically exact - alibis, who saw what, the
// timeline, which clue contradicts which claim - is written here from
// templates, using the names the model invented. So the facts cannot drift.

export function assembleCase(skeleton, world, clueTexts) {
  const { times, locations, culprit: culpritId } = skeleton;

  // Small lookups so the templates below read like sentences.
  const suspectName = Object.fromEntries(skeleton.suspects.map((s) => [s.id, world.suspects[index(s.id)].name]));
  const placeName = Object.fromEntries(locations.all.map((id) => [id, world.locations[index(id)].name]));
  const victim = world.victim.name;
  const names = (ids) => ids.map((id) => suspectName[id]).join(' and ');

  const P = {
    scene: placeName[locations.scene],
    hall: placeName[locations.hall],
    fake: placeName[locations.fakeAlibi],
  };
  const culpritName = suspectName[culpritId];

  // ---- suspects ------------------------------------------------------------------
  // No pronouns for the victim on purpose: a small model reads "they" as
  // "several people" and starts inventing who went along.
  const everyoneFact = `At ${times.gathering} everyone, including ${victim}, was together in ${P.hall}. At about ${times.victimLeaves} ${victim} left ${P.hall} alone, heading for ${P.scene}. Nobody went with ${victim}.`;

  const suspects = skeleton.suspects.map((s) => {
    const w = world.suspects[index(s.id)];
    const here = placeName[s.atDeath];
    const base = {
      id: s.id,
      name: w.name,
      relationToVictim: w.relationToVictim,
      personality: w.personality,
      publicDescription: w.publicDescription,
      secret: w.secret,
    };
    const before = { time: times.gathering, locationId: locations.hall, claim: `I was in ${P.hall} with everyone else. ${victim} was there too, alive and well.`, isTrue: true };

    if (s.role === 'culprit') {
      return {
        ...base,
        alibi: [
          before,
          { time: times.death, locationId: locations.fakeAlibi, claim: `I was alone in ${P.fake}. I went there at about ${times.culpritLeaves} and stayed until about ${times.culpritReturns}.`, isTrue: false },
          { time: times.after, locationId: locations.hall, claim: `I was back in ${P.hall} with ${names(skeleton.groups[0].members)}.`, isTrue: true },
        ],
        lieRules: [
          {
            topic: 'where they were at the time of death',
            lie: `I was alone in ${P.fake} the whole time. I never went near ${P.scene} that evening.`,
            truth: `They left ${P.hall} at ${times.culpritLeaves}, went to ${P.scene}, killed ${victim} at ${times.death} and were back in ${P.hall} by ${times.culpritReturns}. They never set foot in ${P.fake}.`,
          },
          {
            topic: `their relationship with ${victim}`,
            lie: `${victim} and I were on good terms. I had no reason at all to wish them harm.`,
            truth: world.motiveDetail,
          },
        ],
        // Only the culprit knows what really happened.
        knowledge: [
          everyoneFact,
          `You killed ${victim} in ${P.scene} at ${times.death}. ${world.methodDetail}`,
          `Your reason: ${world.motiveDetail}`,
          `Afterwards you went straight back to ${P.hall}, arriving at about ${times.culpritReturns}, and tried to look calm.`,
        ],
      };
    }

    // ---- innocent suspects ---------------------------------------------------------
    const company = s.with.length ? `with ${names(s.with)}` : 'alone';
    const knowledge = [everyoneFact];
    if (s.with.length) {
      knowledge.push(`From about ${times.culpritLeaves} until ${times.after} you were in ${here} with ${names(s.with)}. Neither of you left during that time.`);
    } else {
      knowledge.push(`From about ${times.victimLeaves} until ${times.after} you were alone in ${here}.`);
    }
    if (s.id === skeleton.witness) {
      knowledge.push(`At about ${times.sighting}, looking out of a window, you saw ${culpritName} walking quickly in the direction of ${P.scene}, alone.`);
    }
    if (s.id === skeleton.secondWitness) {
      knowledge.push(`You noticed that ${culpritName} slipped out of ${P.hall} at about ${times.culpritLeaves}, and came back at about ${times.culpritReturns} out of breath. ${culpritName} came back from the direction of ${P.scene}, not from ${P.fake}. Nobody else left ${P.hall}.`);
    }
    if (s.id === skeleton.discoverer) {
      knowledge.push(`At ${times.discovery} you went to look for ${victim} and found the body in ${P.scene}.`);
    }

    // On "easy" only the person whose secret can be found lies about it.
    // On "hard" every innocent person lies to protect their secret.
    const hasSecretClue = skeleton.clues.some((c) => c.role === 'secret' && c.pointsToSuspectId === s.id);
    const lies = skeleton.difficulty === 'hard' || hasSecretClue;

    return {
      ...base,
      alibi: [
        before,
        { time: times.death, locationId: s.atDeath, claim: `I was in ${here}, ${company}.`, isTrue: true },
        { time: times.after, locationId: s.atDeath, claim: `I was still in ${here}, ${company}.`, isTrue: true },
      ],
      lieRules: lies ? [{ topic: 'their own secret', lie: w.secretLie, truth: w.secret }] : [],
      knowledge,
    };
  });

  // ---- clues: logic from the skeleton, wording from the model ------------------------
  const clues = skeleton.clues.map((c, i) => ({
    id: c.id,
    name: clueTexts[i].name,
    description: clueTexts[i].description,
    locationId: c.locationId,
    // The weapon clue only shows HOW. Its meaning is written by code so the
    // model cannot accidentally name the killer here.
    proves: c.role === 'weapon' ? `This is how ${victim} died. ${world.victim.causeOfDeath}` : clueTexts[i].proves,
    pointsToSuspectId: c.pointsToSuspectId,
    isRedHerring: c.isRedHerring,
  }));
  const clueWithRole = (role) => skeleton.clues.find((c) => c.role === role).id;

  // ---- timeline: what really happened, in order ---------------------------------------
  const allIds = skeleton.suspects.map((s) => s.id);
  const timeline = [
    { time: times.gathering, event: `Everyone, including ${victim}, is together in ${P.hall}.`, suspectIds: allIds, locationId: locations.hall },
    { time: times.victimLeaves, event: `${victim} leaves ${P.hall} and goes to ${P.scene}.`, suspectIds: [], locationId: locations.scene },
    { time: times.culpritLeaves, event: `${culpritName} leaves ${P.hall}, saying they are going to ${P.fake}, but heads for ${P.scene} instead.`, suspectIds: [culpritId], locationId: locations.hall },
    ...skeleton.suspects
      .filter((s) => s.role === 'loner')
      .map((s) => ({ time: times.culpritLeaves, event: `${suspectName[s.id]} is alone in ${placeName[s.atDeath]}.`, suspectIds: [s.id], locationId: s.atDeath })),
    ...skeleton.groups.map((g) => ({ time: times.culpritLeaves, event: `${names(g.members)} are together in ${placeName[g.locationId]}.`, suspectIds: g.members, locationId: g.locationId })),
    { time: times.sighting, event: `${suspectName[skeleton.witness]} catches sight of ${culpritName} hurrying toward ${P.scene}.`, suspectIds: [skeleton.witness, culpritId], locationId: locations.scene },
    { time: times.death, event: `${culpritName} kills ${victim} in ${P.scene}. ${world.methodDetail}`, suspectIds: [culpritId], locationId: locations.scene },
    { time: times.culpritReturns, event: `${culpritName} returns to ${P.hall}, out of breath, coming from the direction of ${P.scene}.`, suspectIds: [culpritId, ...skeleton.groups[0].members], locationId: locations.hall },
    { time: times.discovery, event: `${suspectName[skeleton.discoverer]} finds the body of ${victim} in ${P.scene}.`, suspectIds: [skeleton.discoverer], locationId: locations.scene },
  ].sort((a, b) => a.time.localeCompare(b.time));

  // ---- the planted contradictions that expose the culprit ------------------------------
  const contradictions = [
    {
      suspectId: culpritId,
      claim: `I was alone in ${P.fake} at ${times.death}.`,
      contradictedByClueId: clueWithRole('alibiBreaker'),
      explanation: `The evidence shows nobody was in ${P.fake} at that time, so ${culpritName}'s alibi is false.`,
    },
    {
      suspectId: culpritId,
      claim: `I never went near ${P.scene} that evening.`,
      contradictedByClueId: clueWithRole('culpritItem'),
      explanation: `Something belonging to ${culpritName} was found in ${P.scene}, where the body lay.`,
    },
    {
      suspectId: culpritId,
      claim: `I had no reason to wish ${victim} harm.`,
      contradictedByClueId: clueWithRole('motive'),
      explanation: `The document reveals a strong motive: ${world.motiveDetail}`,
    },
  ];

  return {
    title: world.title,
    setting: world.setting,
    victim: {
      name: world.victim.name,
      description: world.victim.description,
      causeOfDeath: world.victim.causeOfDeath,
      timeOfDeath: times.death,
      foundAtLocationId: locations.scene,
    },
    locations: locations.all.map((id) => ({ id, name: world.locations[index(id)].name, description: world.locations[index(id)].description })),
    suspects: suspects.sort((a, b) => a.id.localeCompare(b.id)),
    solution: {
      culpritId,
      motive: world.motiveDetail,
      method: world.methodDetail,
      opportunity: `${culpritName} slipped out of ${P.hall} at ${times.culpritLeaves} claiming to go to ${P.fake}, followed ${victim} to ${P.scene}, and was back by ${times.culpritReturns}.`,
    },
    timeline,
    clues,
    contradictions,
    // The two clues that corner the culprit: one puts them at the scene,
    // the other destroys their alibi.
    confessionClueIds: [clueWithRole('culpritItem'), clueWithRole('alibiBreaker')],
  };
}

// "s3" -> 2, "l1" -> 0 : position in the arrays the model returned.
function index(id) {
  return Number(id.slice(1)) - 1;
}
