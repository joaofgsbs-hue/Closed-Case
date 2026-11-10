// home.js - the first screen: type a name, then create a room or join one.

import { $ } from '../dom.js';
import { socket, request, saveSession } from '../net.js';

export function initHome() {
  // Opened from an invite link like /?room=ABCD ? Pre-fill the code.
  const invited = new URLSearchParams(location.search).get('room');
  if (invited) {
    $('join-code').value = invited.toUpperCase().slice(0, 4);
    selectTab('join');
  }

  $('tab-create').addEventListener('click', () => selectTab('create'));
  $('tab-join').addEventListener('click', () => selectTab('join'));

  $('form-create').addEventListener('submit', async (event) => {
    event.preventDefault(); // stop the browser from reloading the page
    const name = $('home-name').value.trim();
    await submit(event.target, 'room:create', {
      name,
      theme: $('create-theme').value,
      difficulty: $('create-difficulty').value,
      mode: $('create-mode').value,
    });
  });

  $('form-join').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('home-name').value.trim();
    await submit(event.target, 'room:join', { name, code: $('join-code').value.trim().toUpperCase() });
  });

  initDebugBox();
}

function selectTab(which) {
  $('tab-create').classList.toggle('active', which === 'create');
  $('tab-join').classList.toggle('active', which === 'join');
  $('form-create').hidden = which !== 'create';
  $('form-join').hidden = which !== 'join';
  $('home-error').textContent = '';
}

async function submit(form, event, payload) {
  const button = form.querySelector('button[type=submit]');
  $('home-error').textContent = '';
  button.disabled = true;
  const reply = await request(event, payload);
  button.disabled = false;

  if (!reply.ok) {
    $('home-error').textContent = reply.error;
    return;
  }
  // Remember who we are so a refresh puts us back in the same seat.
  // We do NOT switch screen here: the server sends 'room:state' and main.js
  // reacts to it. The browser only ever shows what the server says.
  saveSession({ code: reply.code, name: payload.name, token: reply.token });
}

// ---- development-only status box (the phase 1 check) --------------------------
function setStatus(id, text, good) {
  $(id).textContent = text;
  $(id).className = good ? 'ok' : 'bad';
}

function initDebugBox() {
  fetch('/api/health')
    .then((res) => res.json())
    .then((data) => {
      $('debug-box').hidden = !data.debug;
      setStatus('status-server', 'online', true);
      setStatus('status-provider', data.provider, true);
    })
    .catch(() => setStatus('status-server', 'offline', false));

  const sync = () => {
    setStatus('status-socket', socket.connected ? 'connected' : 'disconnected', socket.connected);
    $('test-model').disabled = !socket.connected;
  };
  socket.on('connect', sync);
  socket.on('disconnect', sync);
  sync();

  $('test-model').addEventListener('click', () => {
    const output = $('model-output');
    $('test-model').disabled = true;
    output.className = 'output';
    output.textContent = 'Thinking…';
    socket.timeout(40000).emit('debug:modelTest', (err, reply) => {
      $('test-model').disabled = !socket.connected;
      if (err) {
        output.className = 'output bad';
        output.textContent = 'No reply from the server. Try again.';
      } else if (reply.ok) {
        output.textContent = `${reply.text} (${(reply.ms / 1000).toFixed(1)}s)`;
      } else {
        output.className = 'output bad';
        output.textContent = reply.error;
      }
    });
  });
}
