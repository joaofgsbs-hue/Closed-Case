// index.js - entry point. Starts Express (web pages) and Socket.IO (real time).
//
// How the pieces fit:
//   Express    serves the files in /public (HTML, CSS, JS) over normal HTTP.
//   Socket.IO  keeps one open connection per browser tab, so the server can
//              push updates to everyone instantly. It shares the same HTTP server.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';

import { config } from './config.js';
import { logger } from './logger.js';
import { providerName } from './providers/index.js';
import { registerSocketHandlers } from './sockets/handlers.js';

// ES modules have no __dirname, so we rebuild it from this file's URL.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Reject any single socket message bigger than 10 KB (default is 1 MB).
  maxHttpBufferSize: 10_000,
});

app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR));

// Simple "is the server alive?" check. Note what is NOT here: no key, no model
// name, nothing about any room or case.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, provider: providerName, debug: config.NODE_ENV !== 'production' });
});

registerSocketHandlers(io);

server.listen(config.PORT, () => {
  logger.info(`Closed Case running at http://localhost:${config.PORT} (provider: ${providerName})`);
});

// Last-resort safety nets: log the problem instead of letting the server die silently.
process.on('unhandledRejection', (err) => logger.error('unhandled promise rejection', err));
process.on('uncaughtException', (err) => logger.error('uncaught exception', err));
