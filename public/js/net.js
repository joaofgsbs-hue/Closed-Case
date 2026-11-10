// net.js - the one place that talks to the server.

// io() comes from /socket.io/socket.io.js. It connects to the same address
// the page was loaded from, and reconnects by itself if the connection drops.
export const socket = io();

/**
 * Send a message and wait for the server's reply.
 * Always resolves (never throws) with { ok: true, ... } or { ok: false, error }.
 */
export function request(event, payload = {}) {
  return new Promise((resolve) => {
    // .timeout(): if the server does not reply in time, `err` is set.
    socket.timeout(8000).emit(event, payload, (err, reply) => {
      if (err) resolve({ ok: false, error: 'No reply from the server. Check your connection.' });
      else resolve(reply);
    });
  });
}

// ---- remembering who we are -------------------------------------------------
// sessionStorage is per browser TAB and survives a refresh. That is exactly
// what we want: refresh = same player; a new tab = a new player (handy for
// testing with several tabs). The token is this player's own secret.
const KEY = 'closed-case-session';

export function saveSession(session) {
  try { sessionStorage.setItem(KEY, JSON.stringify(session)); } catch { /* storage blocked: fine */ }
}

export function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; }
}

export function clearSession() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
