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

/** Ask the model for plain text. Throws ProviderError on any failure. */
export function generate(request) {
  return provider.generate(request);
}

/**
 * Ask the model for JSON and parse it. Throws ProviderError('bad_response')
 * if what came back is not valid JSON. (Checking the SHAPE of the JSON is the
 * caller's job, with zod.)
 */
export async function generateJson(request) {
  const text = await provider.generate({ ...request, json: request.json ?? true });
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
