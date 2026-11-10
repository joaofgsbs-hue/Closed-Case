// logger.js
// Tiny logger for the server terminal. Two rules:
//   1. Nothing here is ever sent to a browser.
//   2. Anything that looks like a secret is masked before printing, in case an
//      error message from a library happens to include the API key.

import { config } from './config.js';

function redact(text) {
  let out = String(text);
  // Mask the real key if it ever shows up inside a message...
  if (config.ANTHROPIC_API_KEY) {
    out = out.split(config.ANTHROPIC_API_KEY).join('[REDACTED]');
  }
  // ...and anything shaped like an Anthropic key, just in case.
  return out.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]');
}

function line(level, message, extra) {
  const time = new Date().toISOString();
  const tail = extra === undefined ? '' : ' ' + redact(extra instanceof Error ? extra.stack || extra.message : JSON.stringify(extra));
  return `${time} [${level}] ${redact(message)}${tail}`;
}

export const logger = {
  info: (message, extra) => console.log(line('info', message, extra)),
  warn: (message, extra) => console.warn(line('warn', message, extra)),
  error: (message, extra) => console.error(line('error', message, extra)),
};
