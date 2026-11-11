// guards.js
// A second line of defence. The prompt TELLS the model to stay in character
// and not to confess, but a model can still slip. So before any answer reaches
// the players, plain code checks it. Code does not get tricked by clever
// wording in a player's question.

// The model describing ITSELF as software. Always a break, whatever was asked.
const SELF_AS_MACHINE = /\b(as an AI|I('m| am) (just |only )?(an? )?(AI|artificial intelligence|language model|chatbot|virtual assistant|computer program)|my (system )?prompt|my instructions|my programming|my training)\b/i;

// Words from outside the story. A suspect may still REPEAT one of these when a
// detective used it first ("What is this 'prompt' you speak of?") - that is a
// confused person staying in character, not a break. So these only count when
// the question did not contain them.
// (Ordinary words like "game", "player" or "instructions" are NOT listed:
// people in the story use them too - "a game of chess", "the piano player".)
const OUTSIDE_WORDS = ['AI', 'artificial intelligence', 'language model', 'system prompt', 'prompt', 'chatbot', 'role-play', 'roleplay', 'fictional character'];

// An outright confession.
// - "I never killed..." / "I did not kill..." do NOT match: the extra word
//   between "I" and the verb breaks the pattern.
// - The violent verb must be followed by a person ("I pushed HER"), so that
//   "I pushed the door open" is not mistaken for a confession.
function confessionPattern(victimName) {
  const victimWords = victimName.split(/\s+/).filter((w) => w.length > 2).map(escapeRegex).join('|');
  const person = `(her|him|them|the victim${victimWords ? `|${victimWords}` : ''})`;
  return new RegExp(
    `\\bI\\s+(killed|murdered|strangled|poisoned|stabbed|shot|pushed|drowned|suffocated|smothered)\\s+${person}\\b` +
    `|\\bI\\s+did\\s+it\\b` +
    `|\\bI(\\s+am|'m)\\s+the\\s+(murderer|killer)\\b` +
    `|\\bI\\s+confess\\b` +
    `|\\b(meant|mean|had|wanted)\\s+to\\s+(kill|murder|silence)\\s+${person}\\b`,
    'i',
  );
}

/**
 * @param {string}  answer
 * @param {object}  opts
 * @param {boolean} opts.mayConfess  true only when the server has decided the
 *                                   culprit is cornered (phase 5).
 * @returns {string|null} why the answer is unacceptable, or null if it is fine
 */
export function findProblem(answer, { mayConfess, question = '', victimName = '' }) {
  if (SELF_AS_MACHINE.test(answer)) return 'broke character';
  for (const word of OUTSIDE_WORDS) {
    const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, word === 'AI' ? '' : 'i'); // "AI" only in capitals
    if (pattern.test(answer) && !pattern.test(question)) return `broke character ("${word}")`;
  }
  if (!mayConfess && confessionPattern(victimName).test(answer)) return 'confessed without being cornered';
  return null;
}

/** Tidy up small formatting habits of the model. */
export function cleanAnswer(raw, suspectName) {
  let text = String(raw).trim();
  // Drop a leading "Name:" label, if the model added one.
  const label = new RegExp(`^${escapeRegex(suspectName)}\\s*:\\s*`, 'i');
  text = text.replace(label, '');
  // Drop stage directions like *sighs* or (looks away).
  text = text.replace(/\*[^*\n]{1,80}\*/g, '').replace(/^\([^)\n]{1,80}\)\s*/g, '');
  // Drop quotation marks wrapped around the whole answer.
  text = text.replace(/^["“](.*)["”]$/s, '$1');
  // Collapse whitespace and cap the length.
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > 600 ? `${text.slice(0, 597)}...` : text;
}

/** Make a player's question safe to put inside a prompt. */
export function cleanQuestion(raw) {
  return String(raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ') // control characters, including new lines
    .replace(/"/g, "'")                      // cannot "close" the quotes we wrap it in
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
