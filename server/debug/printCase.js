// printCase.js - DEBUG TOOL, terminal only.
// Generates a case (or loads a saved one) and prints the full secret JSON so
// you can read what the model wrote. This is the only way to see a solution:
// nothing here is reachable from a browser.
//
// Usage:
//   npm run debug:case                                    (noir, easy)
//   npm run debug:case -- --theme spaceship --difficulty hard
//   npm run debug:case -- --code ABC234                   (print a saved case)
//   npm run debug:case -- --no-verify                     (skip the blind-solve check)
//   npm run debug:case -- --quiet                         (summary only, no JSON)

import { parseArgs } from 'node:util';
import { generateCase, CaseGenerationError } from '../case/generate.js';
import { saveCase, loadCase } from '../case/store.js';
import { THEME_INFO, DIFFICULTY_INFO } from '../case/themes.js';
import { providerName } from '../providers/index.js';

const { values } = parseArgs({
  options: {
    theme: { type: 'string', default: 'noir-lisbon-1920s' },
    difficulty: { type: 'string', default: 'easy' },
    code: { type: 'string' },
    'no-verify': { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
});

function printSummary(truth) {
  const culprit = truth.suspects.find((s) => s.id === truth.solution.culpritId);
  console.log(`\nTitle:    ${truth.title}`);
  console.log(`Victim:   ${truth.victim.name} - ${truth.victim.causeOfDeath} at ${truth.victim.timeOfDeath}`);
  console.log(`Culprit:  ${culprit?.name} (${truth.solution.culpritId})`);
  console.log(`Motive:   ${truth.solution.motive}`);
  console.log(`Suspects: ${truth.suspects.map((s) => `${s.id} ${s.name}`).join(', ')}`);
  console.log(`Clues:    ${truth.clues.length} (${truth.clues.filter((c) => c.isRedHerring).length} red herrings)`);
}

function printAttempts(attempts) {
  for (const a of attempts) {
    const steps = Object.entries(a.steps || {}).map(([name, ms]) => `${name} ${(ms / 1000).toFixed(0)}s`).join(', ');
    console.log(`  attempt ${a.attempt}: ${a.stage} in ${(a.ms / 1000).toFixed(1)}s (${steps})`);
    for (const p of a.problems) console.log(`     - ${p}`);
    if (a.verdict) console.log(`     blind solve named ${a.verdict.culpritId}: ${a.verdict.reasoning}`);
  }
}

if (values.code) {
  const saved = await loadCase(values.code.toUpperCase());
  if (!saved) {
    console.error(`No valid saved case with code ${values.code}`);
    process.exit(1);
  }
  if (!values.quiet) console.log(JSON.stringify(saved.truth, null, 2));
  printSummary(saved.truth);
  process.exit(0);
}

if (!THEME_INFO[values.theme] || !DIFFICULTY_INFO[values.difficulty]) {
  console.error(`Unknown theme or difficulty.\n  themes: ${Object.keys(THEME_INFO).join(', ')}\n  difficulties: ${Object.keys(DIFFICULTY_INFO).join(', ')}`);
  process.exit(1);
}

console.log(`Generating a ${values.difficulty} "${values.theme}" case with provider "${providerName}"...`);
const startedAt = Date.now();

try {
  const result = await generateCase({
    theme: values.theme,
    difficulty: values.difficulty,
    verify: !values['no-verify'],
    onProgress: ({ attempt, maxAttempts, stage }) => console.log(`  attempt ${attempt}/${maxAttempts}: ${stage}...`),
  });
  const caseCode = await saveCase(result);

  if (!values.quiet) console.log(JSON.stringify(result.truth, null, 2));
  console.log('\nATTEMPTS');
  printAttempts(result.attempts);
  printSummary(result.truth);
  console.log(`\nSaved as case code ${caseCode} (data/cases/${caseCode}.json)`);
  console.log(`Total time: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
} catch (err) {
  if (err instanceof CaseGenerationError) {
    console.error(`\nFAILED: ${err.message}`);
    printAttempts(err.attempts);
    console.error(`Total time: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    process.exit(1);
  }
  throw err;
}
