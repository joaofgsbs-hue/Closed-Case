// store.js
// Saves each accepted case to data/cases/<CODE>.json so it can be replayed
// later with its 6-character case code.
//
// These files contain the full solution. They live OUTSIDE /public, so the web
// server never serves them, and data/ is in .gitignore.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { caseTruthSchema } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, '..', '..', 'data', 'cases');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
export const CASE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

function fileFor(caseCode) {
  // SECURITY: the code comes from a player. Checking it against a strict
  // pattern BEFORE building a path makes tricks like "../../.env" impossible.
  if (!CASE_CODE_PATTERN.test(caseCode)) return null;
  return path.join(CASES_DIR, `${caseCode}.json`);
}

function newCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return code;
}

/** Save a case and return its new code. */
export async function saveCase({ truth, theme, difficulty }) {
  await fs.mkdir(CASES_DIR, { recursive: true });
  let caseCode = newCode();
  while (await caseExists(caseCode)) caseCode = newCode();

  const record = { caseCode, theme, difficulty, createdAt: new Date().toISOString(), truth };
  await fs.writeFile(fileFor(caseCode), JSON.stringify(record, null, 2), 'utf8');
  return caseCode;
}

export async function caseExists(caseCode) {
  const file = fileFor(caseCode);
  if (!file) return false;
  try { await fs.access(file); return true; } catch { return false; }
}

/** Load a saved case, or null if it is missing or no longer valid. */
export async function loadCase(caseCode) {
  const file = fileFor(caseCode);
  if (!file) return null;
  try {
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    // Validate again: the file could be old or hand-edited.
    const parsed = caseTruthSchema.safeParse(record.truth);
    if (!parsed.success) return null;
    return { caseCode, theme: record.theme, difficulty: record.difficulty, truth: parsed.data };
  } catch {
    return null;
  }
}
