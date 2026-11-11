// generating.js - the waiting screen while the server writes the case.

import { $ } from '../dom.js';

let clock = null;     // the setInterval handle
let startedAt = null; // when THIS browser first saw the 'generating' phase

export function renderGenerating(room) {
  const g = room.generation;
  // The server only tells us the stage name and the attempt number - nothing
  // about the case itself.
  $('generating-stage').textContent = g
    ? `${capitalize(g.stage)}… (attempt ${g.attempt} of ${g.maxAttempts})`
    : 'Preparing…';

  // Start the "time waiting" clock once; later updates just change the text above.
  if (!clock) {
    startedAt = Date.now();
    const tick = () => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      $('generating-elapsed').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };
    tick();
    clock = setInterval(tick, 1000);
  }
}

export function stopGeneratingClock() {
  clearInterval(clock);
  clock = null;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
