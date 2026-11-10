// ollama.js
// Talks to a local Ollama server over plain HTTP using Node's built-in fetch.
// API reference: https://docs.ollama.com/api/chat
//
// Request:  POST {OLLAMA_BASE_URL}/api/chat
//           { model, messages, stream, format, think, options }
// Response: { message: { role, content }, done, done_reason, ... }

import { config } from '../config.js';
import { ProviderError } from './errors.js';

export const name = 'ollama';

/**
 * @param {object}  req
 * @param {string}  [req.system]      instructions for the model
 * @param {{role: 'user'|'assistant', content: string}[]} req.messages
 * @param {boolean|object} [req.json] true = "answer with any JSON";
 *                                    an object = a JSON Schema the answer must follow
 * @param {number}  [req.maxTokens]
 * @param {number}  [req.temperature]
 * @param {number}  [req.timeoutMs]
 * @returns {Promise<string>} the model's text
 */
export async function generate({ system, messages, json = false, maxTokens = 1024, temperature = 0.8, timeoutMs = config.LLM_TIMEOUT_MS }) {
  const body = {
    model: config.OLLAMA_MODEL,
    // Ollama has no separate "system" field in /api/chat: the system prompt is
    // simply the first message, with role "system".
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    stream: false, // we want one complete answer, not word-by-word chunks
    // Qwen3 is a "thinking" model: by default it writes a long hidden reasoning
    // trace before answering, which makes it several times slower. We turn it off.
    think: false,
    options: { temperature, num_predict: maxTokens },
  };
  if (json === true) body.format = 'json';
  else if (json && typeof json === 'object') body.format = json;

  let response;
  try {
    response = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // AbortSignal.timeout cancels the request by itself after timeoutMs.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new ProviderError('timeout', `Ollama did not answer within ${timeoutMs}ms`, { cause: err });
    }
    // Most common cause: the Ollama app/server is not running.
    throw new ProviderError('unavailable', `Could not reach Ollama at ${config.OLLAMA_BASE_URL}`, { cause: err });
  }

  if (!response.ok) {
    // e.g. 404 {"error":"model 'qwen3:8b' not found"} when the model was never downloaded
    const text = await response.text().catch(() => '');
    throw new ProviderError('unavailable', `Ollama returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    // The timeout can also fire while the body is still downloading.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new ProviderError('timeout', `Ollama did not answer within ${timeoutMs}ms`, { cause: err });
    }
    throw new ProviderError('bad_response', 'Ollama returned something that is not JSON', { cause: err });
  }

  const text = data?.message?.content;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new ProviderError('bad_response', 'Ollama returned an empty answer');
  }
  return text.trim();
}
