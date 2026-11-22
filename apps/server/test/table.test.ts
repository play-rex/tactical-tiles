import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ClientMsg, ROOM_NAME, ServerMsg, type TableView } from '@tactical/engine';
import { Client, type Room } from 'colyseus.js';
import { limits, TableRoom, timings } from '../src/TableRoom';

let gameServer: Server;
let endpoint: string;
let nextPlayer = 0;
/** A fresh player identity, as each device would have. */
const pid = () => `test-player-${++nextPlayer}`;

before(async () => {
  Object.assign(timings, { botThinkMs: [0, 1], autopilotMs: 20, lobbyReconnectS: 1, gameReconnectS: 1 });
  limits.joinsPerMinute = 10_000;
  limits.messagesPerSecond = 10_000;
  const http = createServer();
  gameServer = new Server({ transport: new WebSocketTransport({ server: http }) });
  gameServer.define(ROOM_NAME, TableRoom);
  await gameServer.listen(0);
  endpoint = `ws://localhost:${(http.address() as AddressInfo).port}`;
});

after(async () => {
  await gameServer.gracefullyShutdown(false);
});

interface Player {
  room: Room;
  /** Resolves with the first view (already received or still to come) that matches. */
  view: (pred: (v: TableView) => boolean, label?: string) => Promise<TableView>;
  latest: () => TableView | null;
  errors: string[];
}

function track(room: Room): Player {
  let latest: TableView | null = null;
  const errors: string[] = [];
  let waiters: { pred: (v: TableView) => boolean; resolve: (v: TableView) => void }[] = [];
  room.onMessage(ServerMsg.view, (v: TableView) => {
    latest = v;
    waiters = waiters.filter(w => {
      if (!w.pred(v)) return true;
      w.resolve(v);
      return false;
    });
  });
  room.onMessage(ServerMsg.error, ({ message }: { message: string }) => errors.push(message));
  return {
    room,
    errors,
    latest: () => latest,
    view: (pred, label = 'view') =>
      new Promise<TableView>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 5000);
        const done = (v: TableView) => {
          clearTimeout(timer);
          resolve(v);
        };
        if (latest && pred(latest)) done(latest);
        else waiters.push({ pred, resolve: done });
      }),
  };
}

async function host(name = 'Host', playerId = pid()) {
  const room = await new Client(endpoint).create(ROOM_NAME, { name, playerId });
  return track(room);
}
async function join(code: string, name = 'Guest', playerId = pid()) {
  const room = await new Client(endpoint).joinById(code, { name, playerId });
  return track(room);
}
const errorAfter = async (p: Player, count: number) => {
  for (let i = 0; i < 100 && p.errors.length <= count; i++) await new Promise(r => setTimeout(r, 10));
  return p.errors[count];
};

test('two players: lobby, start, turns pass, and only the current player may act', async () => {
  const a = await host('Alice');
  const code = (await a.view(v => v.seats.length === 1)).code;
  assert.match(code, /^[A-Z]{4}$/);
  const b = await join(code, 'Bob');
  await a.view(v => v.seats.length === 2, 'Bob seated');

  // Only the host starts
  b.room.send(ClientMsg.start);
  assert.equal(await errorAfter(b, 0), 'Only the host can do that');

  a.room.send(ClientMsg.start);
  const first = await b.view(v => v.status === 'playing', 'match start');
  assert.equal(first.mySeat, 1);
  assert.equal(first.game!.game.currentPlayer, 0);

  // Bob can't play Alice's turn
  b.room.send(ClientMsg.action, { type: 'END_TURN' });
  assert.equal(await errorAfter(b, 1), "It isn't your turn");

  a.room.send(ClientMsg.action, { type: 'END_TURN' });
  const bobsTurn = await b.view(v => v.game?.game.currentPlayer === 1, "Bob's turn");
  assert.equal(bobsTurn.seq, first.seq + 1);
  assert.ok(bobsTurn.events.some(e => e.kind === 'sound' && e.sound === 'turn'));

  // Malformed and illegal actions are refused without changing anything
  b.room.send(ClientMsg.action, { type: 'TELEPORT' });
  assert.equal(await errorAfter(b, 2), 'Malformed message');
  const enemy = bobsTurn.game!.game.units.find(u => u.owner === 0)!;
  b.room.send(ClientMsg.action, { type: 'MOVE', unitId: enemy.id, targetTileId: '0,0', cost: 0 });
  assert.equal(await errorAfter(b, 3), "That unit can't move there");
  assert.equal(b.latest()!.seq, bobsTurn.seq);

  await a.room.leave();
  await b.room.leave();
});

test('a move is charged what the rules say, whatever the client claims', async () => {
  const a = await host();
  const code = (await a.view(() => true)).code;
  const b = await join(code);
  await a.view(v => v.seats.length === 2);
  a.room.send(ClientMsg.start);
  const start = await a.view(v => v.status === 'playing');
  const game = start.game!.game;

  // Find a move one of Alice's units can make (two tiles away, so it costs > 1)
  const { getUnitOptions } = await import('@tactical/engine');
  let move: { unitId: string; tileId: string; cost: number } | null = null;
  for (const u of game.units.filter(x => x.owner === 0)) {
    for (const [tileId, cost] of getUnitOptions(game, u, null).moveCosts) {
      if (cost >= 2) move = { unitId: u.id, tileId, cost };
    }
    if (move) break;
  }
  assert.ok(move, 'some unit can move two tiles');
  a.room.send(ClientMsg.action, { type: 'MOVE', unitId: move.unitId, targetTileId: move.tileId, cost: 0 });
  const moved = await a.view(v => v.seq > start.seq, 'move applied');
  const g = moved.game!.game;
  assert.equal(g.units.find(u => u.id === move!.unitId)!.tileId, move.tileId);
  assert.equal(g.playerCp[0], game.playerCp[0] - move.cost);

  await a.room.leave();
  await b.room.leave();
});

test('against a bot: the bot plays its turn and hands it back', async () => {
  const a = await host();
  await a.view(v => v.seats.length === 1);
  a.room.send(ClientMsg.addBot);
  await a.view(v => v.seats.length === 2 && v.seats[1].isBot, 'bot seated');
  a.room.send(ClientMsg.start);
  const start = await a.view(v => v.status === 'playing');
  a.room.send(ClientMsg.action, { type: 'END_TURN' });
  // The bot takes several actions, then ends its turn
  const back = await a.view(v => v.game?.game.currentPlayer === 0 && v.seq > start.seq + 1, 'turn back from bot');
  assert.ok(back.game!.game.gameLog.some(l => l.playerId === 1));
  await a.room.leave();
});

test('fog of war: you are not sent enemy units you cannot see', async () => {
  const a = await host();
  const code = (await a.view(() => true)).code;
  a.room.send(ClientMsg.settings, { ...(await a.view(() => true)).settings, fogOfWar: true });
  await a.view(v => v.settings.fogOfWar, 'fog on');
  const b = await join(code);
  a.room.send(ClientMsg.start);
  const va = await a.view(v => v.status === 'playing');
  const vb = await b.view(v => v.status === 'playing');
  const mine = (v: TableView) => v.game!.game.units.filter(u => u.owner === v.mySeat).length;
  assert.equal(va.game!.game.units.length, mine(va), 'Alice sees only her squad at the start');
  assert.equal(vb.game!.game.units.length, mine(vb), 'Bob sees only his squad at the start');
  assert.ok(va.game!.visibleTiles.length > 0);
  await a.room.leave();
  await b.room.leave();
});

test('a player who comes back with the same id gets their seat back', async () => {
  const id = pid();
  const a = await host('Alice', id);
  const code = (await a.view(() => true)).code;
  a.room.send(ClientMsg.addBot);
  await a.view(v => v.seats.length === 2);
  a.room.send(ClientMsg.start);
  await a.view(v => v.status === 'playing');

  // Same device, new tab: the seat moves to the new connection
  const again = await join(code, 'Alice', id);
  const v = await again.view(x => x.status === 'playing');
  assert.equal(v.mySeat, 0);
  assert.equal(v.seats.length, 2);
  await again.room.leave();
});

test("a player who drops on their turn has it played for them", async () => {
  const a = await host();
  const code = (await a.view(() => true)).code;
  const b = await join(code);
  await a.view(v => v.seats.length === 2);
  a.room.send(ClientMsg.start);
  const start = await b.view(v => v.status === 'playing');
  // Alice's connection drops (not a deliberate leave): after a moment a bot covers her turn
  (a.room.connection as unknown as { close: (code?: number) => void }).close(4999);
  const covered = await b.view(v => v.game?.game.currentPlayer === 1, "Bob's turn after autopilot");
  assert.ok(covered.seq > start.seq);
  assert.ok(covered.seats[0].autopilot || !covered.seats[0].connected);
  await b.room.leave();
});
