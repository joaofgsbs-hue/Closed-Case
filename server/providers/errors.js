// errors.js
// Both providers throw this SAME error type, so the rest of the game can react
// to "the model failed" without knowing which model it was.
//
// kind:
//   'timeout'      - the model took longer than LLM_TIMEOUT_MS
//   'unavailable'  - could not reach it (Ollama not running, model not
//                    downloaded, no internet, bad key, rate limited...)
//   'bad_response' - it answered, but with nothing usable

export class ProviderError extends Error {
  constructor(kind, message, options) {
    super(message, options); // options.cause keeps the original error for the logs
    this.name = 'ProviderError';
    this.kind = kind;
  }
}
