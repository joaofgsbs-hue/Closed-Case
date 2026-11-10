// anthropic.js
// Talks to the Anthropic API using the official SDK (@anthropic-ai/sdk).
// This provider costs money, so it is OFF unless LLM_PROVIDER=anthropic.
// The key is read from .env on the server and never leaves the server.

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { ProviderError } from './errors.js';

export const name = 'anthropic';

// Created lazily (on first use) so that running with Ollama never needs a key.
let client = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 0 });
  return client;
}

// Same signature as ollama.js - that is the whole point of the provider layer.
export async function generate({ system, messages, json = false, maxTokens = 1024, temperature = 0.8, timeoutMs = config.LLM_TIMEOUT_MS }) {
  // This API has no "JSON mode" switch like Ollama's `format`, so when the
  // caller wants JSON we say so in the system prompt. The caller validates the
  // result with zod anyway, so a bad answer is caught and retried.
  let fullSystem = system || '';
  if (json) {
    fullSystem += '\n\nRespond with a single valid JSON object and nothing else. No markdown, no code fences, no commentary.';
    if (typeof json === 'object') fullSystem += `\nThe JSON must follow this JSON Schema:\n${JSON.stringify(json)}`;
  }

  let response;
  try {
    response = await getClient().messages.create(
      {
        model: config.ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        temperature,
        ...(fullSystem ? { system: fullSystem } : {}),
        messages,
      },
      { timeout: timeoutMs }, // per-request option of the SDK
    );
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      throw new ProviderError('timeout', `Anthropic did not answer within ${timeoutMs}ms`, { cause: err });
    }
    // Only the status code goes in the message. The key is never included.
    const status = err?.status ? ` (HTTP ${err.status})` : '';
    throw new ProviderError('unavailable', `Anthropic request failed${status}`, { cause: err });
  }

  // The answer is a list of blocks; we join the text ones.
  const text = (response.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) throw new ProviderError('bad_response', 'Anthropic returned an empty answer');
  return text;
}
