// themes.js
// Flavor for each theme, plus the numbers for each difficulty.
// The lists of methods and motives exist because a model left alone tends to
// write the same murder again and again. We pick ONE at random in code and
// tell the model to use it, so every game really is different.

export const THEME_INFO = {
  'noir-lisbon-1920s': {
    label: 'Noir — Lisbon, 1920s',
    brief:
      'Film-noir Lisbon in the 1920s: fado houses, the docks of Alcântara, smoky cafés in the Chiado, trams, smugglers, ' +
      'old money and new political tension. Use Portuguese names. Technology of the era only (no phones in pockets, no cameras everywhere).',
    methods: ['poison in a glass of port wine', 'a stab wound from a letter opener', 'a blow from a heavy bronze statuette', 'strangulation with a silk scarf', 'a gunshot muffled by the noise of a passing tram', 'a push down a steep stone staircase'],
  },
  spaceship: {
    label: 'Spaceship',
    brief:
      'A long-haul civilian starship far from any port. A small crew, sealed compartments, airlocks, door logs, a hydroponics bay, ' +
      'a medical bay and an engine room. Nobody can arrive or leave. Technology is advanced but logs can be edited by those with access.',
    methods: ['a tampered oxygen supply in a sealed compartment', 'an overdose from the medical bay dispenser', 'a blow from a magnetic wrench', 'a sabotaged airlock cycle', 'an electrical surge rigged at a maintenance panel', 'a toxic coolant leak arranged on purpose'],
  },
  'elite-school': {
    label: 'Elite school',
    brief:
      'An old, wealthy boarding school during a stormy weekend when most people have gone home. Teachers, staff and a few adult ' +
      'former pupils on the board. Dormitories, a chapel, a library, a science laboratory, a boathouse. The victim and all suspects are adults.',
    methods: ['poison taken from the science laboratory', 'a blow from a rowing trophy', 'a fall from the bell tower that was not an accident', 'strangulation with a school tie', 'drowning at the boathouse', 'a tampered gas lamp in a locked study'],
  },
  'luxury-hotel': {
    label: 'Luxury hotel',
    brief:
      'A grand, isolated luxury hotel cut off by a snowstorm. Wealthy guests and long-serving staff, a ballroom, a spa, a wine cellar, ' +
      'service corridors and a master key that too many people can reach.',
    methods: ['poison in a room-service cocktail', 'a blow from a champagne bottle', 'a push from a balcony into the snow', 'suffocation with a pillow in a locked suite', 'a stab wound from a kitchen knife', 'being locked in the overheated sauna'],
  },
};

export const MOTIVES = [
  'an inheritance about to be changed',
  'blackmail that had gone on for too long',
  'jealousy over a secret love affair',
  'revenge for an old betrayal',
  'covering up a fraud the victim had discovered',
  'silencing a witness to an earlier crime',
  'a professional rivalry and a stolen achievement',
  'a debt that could never be repaid',
  'protecting a family secret the victim threatened to reveal',
  'being cut out of a business deal',
];

export const DIFFICULTY_INFO = {
  easy: {
    suspects: 4,
    locations: 4,
    clues: 6,
    redHerrings: 0,
    lieStyle: 'Lies are simple and direct. Each innocent suspect has at most one lie, about their own secret.',
  },
  hard: {
    suspects: 6,
    locations: 5,
    clues: 9,
    redHerrings: 2,
    lieStyle: 'Lies are subtle half-truths. Several innocent suspects lie to protect their own secrets, which makes them look guilty.',
  },
};

/** Pick one random element of an array. */
export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
