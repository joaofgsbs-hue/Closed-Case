// providers/index.js
// The ONLY file the rest of the game imports to talk to a model.
// It picks one implementation based on LLM_PROVIDER in .env. Everything else
// just calls generate() / generateJson() and has no idea which one is behind it.

import { config } from '../config.js';
import { ProviderError } from './errors.js';

// Dynamic import: only the chosen provider's file (and its library) is loaded.
// "await" at the top level of a file is allowed in ES modules.
const provider =
  config.LLM_PROVIDER === 'anthropic'
    ? await import('./anthropic.js')
    : await import('./ollama.js');

export const providerName = provider.name;
export { ProviderError };

// ---- a waiting line in front of the model -------------------------------------
// A local model answers one request at a time. If we sent it three at once,
// Ollama would quietly queue them itself, and the time the last one spends
// waiting would count against its 30-second timeout - so it would fail even
// though the model is fine. Keeping the line HERE means each request's timer
// only starts when the model actually begins working on it.
const MAX_PARALLEL = config.LLM_MAX_PARALLEL;
let running = 0;
const waiting = []; // functions that start a job, in arrival order

function limited(job) {
  return new Promise((resolve, reject) => {
    const start = () => {
      running += 1;
      job()
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          const next = waiting.shift();
          if (next) next();
        });
    };
    if (running < MAX_PARALLEL) start();
    else waiting.push(start);
  });
}

/** How many model requests are waiting for their turn (for logs and tests). */
export function modelQueueLength() {
  return waiting.length;
}

/** Ask the model for plain text. Throws ProviderError on any failure. */
export function generate(request) {
  return limited(() => provider.generate(request));
}

/**
 * Ask the model for JSON and parse it. Throws ProviderError('bad_response')
 * if what came back is not valid JSON. (Checking the SHAPE of the JSON is the
 * caller's job, with zod.)
 */
export async function generateJson(request) {
  const text = await generate({ ...request, json: request.json ?? true });
  try {
    return JSON.parse(stripCodeFence(text));
  } catch (err) {
    throw new ProviderError('bad_response', 'The model did not return valid JSON', { cause: err });
  }
}

// Models sometimes wrap JSON in ```json ... ``` even when told not to.
function stripCodeFence(text) {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}
