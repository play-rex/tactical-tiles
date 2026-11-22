import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@tactical/engine';
import express from 'express';
import { restoreTables, TableRoom } from './TableRoom';
import { fileTableStore } from './store';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 2767);
const WEB_DIST = process.env.WEB_DIST ?? resolve(here, '../../web/dist');
/** Saved tables (a Docker volume in production), so a deploy doesn't end matches. */
const TABLES_DIR = process.env.TABLES_DIR ?? resolve(here, '../data/tables');
const store = fileTableStore(TABLES_DIR);
TableRoom.store = store;

const app = express();
app.disable('x-powered-by');

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

// An unknown API path is a 404, not the app shell below.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST, { maxAge: '1h', index: false }));
  // A missing asset is a 404, not the app shell: after a deploy, a page still holding old
  // chunk names must see the failure so it can reload.
  app.use('/assets', (_req, res) => {
    res.status(404).end();
  });
  app.get('/{*splat}', (_req, res) => res.sendFile(resolve(WEB_DIST, 'index.html')));
}

const httpServer = createServer(app);
const gameServer = new Server({
  // We shut down ourselves (below), so tables are marked as kept before rooms close.
  gracefullyShutdown: false,
  transport: new WebSocketTransport({ server: httpServer, pingInterval: 5000, pingMaxRetries: 3 }),
});
gameServer.define(ROOM_NAME, TableRoom);

await gameServer.listen(PORT);
const restored = await restoreTables(store);
console.log(
  `🎯 Tactical Tiles listening on http://localhost:${PORT}` +
    (restored ? ` (restored ${restored} table${restored === 1 ? '' : 's'})` : ''),
);

const shutdown = async () => {
  // Keep every table's saved state so it comes back after the restart.
  TableRoom.shuttingDown = true;
  await gameServer.gracefullyShutdown(false);
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
