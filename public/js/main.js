// main.js - runs in the browser and wires everything together.
// Rule for the whole project: the browser only SHOWS what the server sends.
// No game logic, no secrets, no API keys live here.

import { $, showScreen, showBanner } from './dom.js';
import { socket, request, loadSession, saveSession, clearSession } from './net.js';
import { initHome } from './screens/home.js';
import { initLobby, renderLobby } from './screens/lobby.js';

async function leaveRoom() {
  await request('room:leave');
  clearSession();
  showScreen('home');
}

initHome();
initLobby({ onLeave: leaveRoom });
$('game-leave').addEventListener('click', leaveRoom);

// The server sends 'room:state' every time anything in our room changes.
// This single listener decides which screen to show.
socket.on('room:state', (room) => {
  if (room.phase === 'lobby') {
    renderLobby(room);
    showScreen('lobby');
  } else {
    $('game-code').textContent = room.code;
    showScreen('game');
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
    showScreen('home');
    $('home-error').textContent = `Could not return to room ${session.code}: ${reply.error}`;
  }
});

socket.on('disconnect', () => showBanner('Connection lost. Reconnecting…'));

// The same player was opened somewhere else; this tab steps aside.
socket.on('session:replaced', () => {
  clearSession();
  showScreen('home');
  showBanner('You joined this room from another tab or device.');
});
