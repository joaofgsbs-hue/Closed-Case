// main.js - runs in the browser and wires everything together.
// Rule for the whole project: the browser only SHOWS what the server sends.
// No game logic, no secrets, no API keys live here.

import { $, showScreen, showBanner } from './dom.js';
import { socket, request, loadSession, saveSession, clearSession } from './net.js';
import { initHome } from './screens/home.js';
import { initLobby, renderLobby } from './screens/lobby.js';
import { renderGenerating, stopGeneratingClock } from './screens/generating.js';
import { initBriefing } from './screens/briefing.js';
import { initHub, renderHub, openHubTab } from './screens/hub.js';
import { initAccuse } from './screens/accuse.js';
import { initResult, renderResult } from './screens/result.js';
import { initHistory, renderHistory } from './screens/historyBox.js';
import { initInterrogation, openInterrogation, renderInterrogation } from './screens/interrogation.js';

// Which part of the investigation THIS browser is looking at. It is only a
// local choice of view; it changes nothing on the server.
let view = 'briefing';  // 'briefing' | 'interrogation'
let lastRoom = null;

async function leaveRoom() {
  await request('room:leave');
  clearSession();
  $('vote-alert').hidden = true;
  renderHistory();
  showScreen('home');
}

initHome();
initLobby({ onLeave: leaveRoom });
initBriefing({
  onOpenSuspect: (suspectId) => {
    view = 'interrogation';
    openInterrogation(suspectId);
    drawInvestigation(lastRoom);
  },
});
initHub();
initAccuse();
initResult({ onLeave: leaveRoom });
initHistory();
renderHistory();

// The "vote now" alert: tapping it opens the Accuse tab from any screen.
$('vote-alert').addEventListener('click', () => {
  view = 'briefing';
  openHubTab('accuse');
  drawInvestigation(lastRoom);
});

function drawVoteAlert(room) {
  const p = room && room.phase === 'investigation' && room.accusation && room.accusation.proposal;
  const waitingForMe = Boolean(p) && !p.yourVote;
  $('vote-alert').hidden = !waitingForMe;
  if (waitingForMe) $('vote-alert').textContent = `${p.byName} accuses ${p.culpritName}. Tap to vote.`;
}
initInterrogation({
  onBack: () => {
    view = 'briefing';
    drawInvestigation(lastRoom);
  },
});

function drawInvestigation(room) {
  if (view === 'interrogation') {
    renderInterrogation(room);
    showScreen('interrogation');
  } else {
    renderHub(room);
    showScreen('game');
  }
}
$('game-leave').addEventListener('click', leaveRoom);

// The server sends 'room:state' every time anything in our room changes.
// This single listener decides which screen to show.
socket.on('room:state', (room) => {
  lastRoom = room;
  if (room.phase !== 'generating') stopGeneratingClock();
  if (room.phase !== 'investigation') view = 'briefing';
  drawVoteAlert(room);

  if (room.phase === 'lobby') {
    renderLobby(room);
    showScreen('lobby');
  } else if (room.phase === 'generating') {
    renderGenerating(room);
    showScreen('generating');
  } else if (room.phase === 'ended') {
    renderResult(room);
    showScreen('result');
  } else {
    drawInvestigation(room);
  }
});

// Fires on the first connection AND after every automatic reconnection.
// If this tab was in a room, ask for the same seat back using our token.
socket.on('connect', async () => {
  showBanner('');
  const session = loadSession();
  if (!session) return;

  const reply = await request('room:join', session);
  if (reply.ok) {
    saveSession({ ...session, token: reply.token });
  } else {
    // The room is gone (or our seat was given up): back to the start.
    clearSession();
    renderHistory();
    showScreen('home');
    $('home-error').textContent = `Could not return to room ${session.code}: ${reply.error}`;
  }
});

socket.on('disconnect', () => showBanner('Connection lost. Reconnecting…'));

// The same player was opened somewhere else; this tab steps aside.
socket.on('session:replaced', () => {
  clearSession();
  $('vote-alert').hidden = true;
  showScreen('home');
  showBanner('You joined this room from another tab or device.');
});
