// history.js - a list of finished cases, kept ONLY in this browser
// (localStorage). Nothing here is sent to the server.
//
// localStorage can be missing or full (private windows, some phones), so
// every access is wrapped in try/catch: the game must work without it.

const KEY = 'closedCase.history';
const MAX_ENTRIES = 30;

export function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Adds one result. The same game is never stored twice (e.g. after a refresh). */
export function addToHistory(entry) {
  const list = loadHistory();
  if (list.some((e) => e.id === entry.id)) return;
  list.unshift(entry);
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage blocked or full: the history is a bonus, so we simply skip it.
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}
