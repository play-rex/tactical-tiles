import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ClientMsg, CloseCode, generateSectorSeed, moveCostsFor, ROOM_NAME, ServerMsg, type TableView } from '@tactical/engine';
import { Client, type Room } from 'colyseus.js';
import { limits, restoreTables, TableRoom, timings } from '../src/TableRoom';
import { fileTableStore } from '../src/store';

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

test('a restart (a deploy) brings the table back, and players carry on where they were', async () => {
  const dir = mkdtempSync(joinPath(tmpdir(), 'tt-tables-'));
  const store = fileTableStore(dir);
  TableRoom.store = store;
  try {
    const id = pid();
    const a = await host('Alice', id);
    const code = (await a.view(() => true)).code;
    a.room.send(ClientMsg.addBot);
    await a.view(v => v.seats.length === 2);
    a.room.send(ClientMsg.start);
    // Alice ends her turn; the bot plays its turn and hands it back
    await a.view(v => v.status === 'playing' && v.game?.game.currentPlayer === 0);
    a.room.send(ClientMsg.action, { type: 'END_TURN' });
    const before = await a.view(v => v.game?.game.currentPlayer === 0 && v.game.game.turnCounter >= 2, 'Alice again');
    const saved = () => readdirSync(dir).includes(`${code}.json`);
    assert.ok(saved(), 'saved');

    // The server stops: the table is kept, and nothing changes while it goes down
    TableRoom.shuttingDown = true;
    const closed = new Promise<number>(resolve => a.room.onLeave(resolve));
    await matchMaker.getLocalRoomById(code)!.disconnect(CloseCode.restarting);
    assert.equal(await closed, CloseCode.restarting);
    assert.ok(saved(), 'kept for the restart');

    // ...and starts again: same code, same game, and Alice gets her seat back
    TableRoom.shuttingDown = false;
    assert.equal(await restoreTables(store), 1);
    const back = await join(code, 'Alice', id);
    const v = await back.view(x => x.status === 'playing');
    assert.equal(v.mySeat, 0);
    assert.equal(v.seq, before.seq, 'nothing happened while she was away');
    assert.deepEqual(v.game?.game.units, before.game?.game.units);
    assert.equal(v.seats[1].isBot, true);

    // Leaving for good forgets the saved table
    await back.room.leave();
    await new Promise(r => setTimeout(r, 200));
    assert.ok(!saved(), 'forgotten');
  } finally {
    TableRoom.store = null;
    TableRoom.shuttingDown = false;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync and reconnect never replay stale action events, and restoreTables skips bot-only tables', async () => {
  const id = pid();
  const a = await host('Alice', id);
  const code = (await a.view(() => true)).code;
  a.room.send(ClientMsg.addBot);
  await a.view(v => v.seats.length === 2);
  a.room.send(ClientMsg.start);
  const started = await a.view(v => v.status === 'playing');
  const mover = started.game!.game.units.find(u => u.owner === 0 && moveCostsFor(started.game!.game, u).size > 0)!;
  const [targetTileId] = moveCostsFor(started.game!.game, mover).keys();

  a.room.send(ClientMsg.action, { type: 'MOVE', unitId: mover.id, targetTileId, cost: 1 });
  const moved = await a.view(v => v.seq > started.seq && v.events.length > 0, 'move with events');
  assert.ok(moved.events.length > 0);

  // Requesting sync at the same seq receives no stale events
  a.room.send(ClientMsg.sync);
  const synced = await a.view(v => v.seq === moved.seq && v.events.length === 0, 'sync without stale events');
  assert.deepEqual(synced.events, []);

  // Opening a new tab for the same player also receives no stale events
  const tab2 = await join(code, 'Alice', id);
  const resumed = await tab2.view(v => v.status === 'playing', 'resumed view');
  assert.equal(resumed.seq, moved.seq);
  assert.deepEqual(resumed.events, []);
  await tab2.room.leave();

  // Bot-only saved table is skipped and pruned during restoreTables
  const dir = mkdtempSync(joinPath(tmpdir(), 'tt-zombie-'));
  const store = fileTableStore(dir);
  try {
    store.save('ZOMB', JSON.stringify({
      v: 1,
      code: 'ZOMB',
      seats: [{ playerId: null, name: 'Rook (bot)', isBot: true }],
      hostPlayerId: null,
      settings: moved.settings,
      status: 'playing',
      game: null,
      seq: 1,
    }));
    assert.equal(await restoreTables(store), 0);
    assert.equal(store.all().length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lobby pre-rolls a map seed for previews and launches with the randomized seed', async () => {
  const a = await host();
  const initialA = await a.view(() => true);
  assert.ok(initialA.settings.mapSeed.length >= 4, 'new lobby starts with an active random preview seed');

  const b = await join(initialA.code);
  const initialB = await b.view(() => true);
  assert.equal(initialB.settings.mapSeed, initialA.settings.mapSeed, 'guests receive the exact preview seed');

  const nextSeed = generateSectorSeed() === initialA.settings.mapSeed ? 'SECTOR99' : generateSectorSeed();
  const patches = [{ x: 10, y: 10, type: 'BUILDING' as const, height: 1, subType: 'WATCHTOWER' as const }];
  a.room.send(ClientMsg.settings, { ...initialA.settings, mapSeed: nextSeed, mapEdits: patches });
  const updatedB = await b.view(
    v => v.settings.mapSeed === nextSeed && v.settings.mapEdits?.length === 1,
    'guest receives randomized seed and map edits',
  );
  assert.equal(updatedB.settings.mapSeed, nextSeed);
  assert.equal(updatedB.settings.mapEdits?.[0].subType, 'WATCHTOWER');

  a.room.send(ClientMsg.start);
  const startedA = await a.view(v => v.status === 'playing');
  const startedB = await b.view(v => v.status === 'playing');
  assert.equal(startedA.game!.game.activeSeed, nextSeed);
  assert.equal(startedB.game!.game.activeSeed, nextSeed);
  assert.equal(startedA.game!.game.mapData[10 * startedA.game!.game.gridSize + 10]?.subType, 'WATCHTOWER');

  await a.room.leave();
  await b.room.leave();
});

test('lobby live drafts, guest suggestions toggle, per-player edit grant, and lock controls', async () => {
  const a = await host('Host');
  const initial = await a.view(() => true);
  const b = await join(initial.code, 'Guest');
  await b.view(() => true);

  // 1. Host sends a transient live draft -> guest views it before Apply
  const draftPatch = [{ x: 4, y: 4, type: 'MOUNTAIN' as const, height: 2 }];
  a.room.send(ClientMsg.mapDraft, { edits: draftPatch });
  const draftView = await b.view(v => v.liveDraft?.seat === 0 && v.liveDraft.edits.length === 1, 'guest sees host live draft');
  assert.equal(draftView.settings.mapEdits, undefined, 'live draft does not mutate committed mapEdits yet');
  a.room.send(ClientMsg.mapDraft, { edits: null });
  await b.view(v => v.liveDraft === null, 'draft cleared on cancel');

  // 2. Guest cannot directly edit unless host grants permission, but can suggest when Suggestions ON
  b.room.send(ClientMsg.mapDraft, { edits: draftPatch });
  const sugPatch = [{ x: 6, y: 6, type: 'BANK' as const, height: 1, bankGoldReward: 200, bankCpReward: 10 }];
  b.room.send(ClientMsg.mapSuggest, { edits: sugPatch });
  const sugView = await a.view(v => (v.mapSuggestions?.length ?? 0) === 1, 'host sees guest suggestion');
  assert.equal(sugView.mapSuggestions![0].seat, 1);

  // Host accepts guest suggestion -> merges into settings.mapEdits and clears suggestion queue
  a.room.send(ClientMsg.resolveSuggestion, { seat: 1, accept: true });
  const mergedView = await b.view(
    v => (v.mapSuggestions?.length ?? 0) === 0 && v.settings.mapEdits?.some(e => e.x === 6 && e.y === 6 && e.type === 'BANK'),
    'accepted suggestion applied to mapEdits',
  );
  assert.ok(mergedView.settings.mapEdits?.length);

  // 3. Host turns Suggestions OFF -> guest suggestion is rejected
  a.room.send(ClientMsg.settings, { ...mergedView.settings, suggestionsEnabled: false });
  await b.view(v => v.settings.suggestionsEnabled === false, 'suggestions turned off');
  b.room.send(ClientMsg.mapSuggest, { edits: draftPatch });
  await new Promise(r => setTimeout(r, 80));
  assert.equal((a.latest()?.mapSuggestions?.length ?? 0), 0);

  // 4. Host grants direct edit access to Guest -> Host & Guest follow single-active-editor exclusivity
  a.room.send(ClientMsg.setSeatMapAccess, { seat: 1, canEditMap: true, mapLocked: false });
  const grantedB = await b.view(v => v.seats[1].canEditMap === true, 'guest granted edit access');
  assert.equal(grantedB.seats[1].mapLocked, false);

  // While Host holds active Edit lock (even before placing first tile), Guest cannot edit directly and can only suggest
  a.room.send(ClientMsg.mapDraft, { edits: [] });
  await b.view(v => v.liveDraft?.seat === 0, 'guest sees host holds edit lock');
  const errCountBefore = b.errors.length;
  b.room.send(ClientMsg.mapDraft, { edits: draftPatch });
  b.room.send(ClientMsg.mapCommitEdit, { edits: draftPatch });
  await new Promise(r => setTimeout(r, 80));
  assert.ok(b.errors.length > errCountBefore, 'second editor rejected while first editor is active');
  a.room.send(ClientMsg.settings, { ...mergedView.settings, suggestionsEnabled: true });
  await b.view(v => v.settings.suggestionsEnabled === true);
  b.room.send(ClientMsg.mapSuggest, { edits: draftPatch });
  await a.view(v => (v.mapSuggestions?.length ?? 0) === 1, 'other permitted editor can still suggest while host edits');
  a.room.send(ClientMsg.resolveSuggestion, { seat: 1, accept: false });
  a.room.send(ClientMsg.mapDraft, { edits: null });
  await b.view(v => v.liveDraft === null, 'host released edit lock');

  // Once Host finished editing, Permitted Guest can acquire Edit lock and commit directly
  b.room.send(ClientMsg.mapDraft, { edits: draftPatch });
  await a.view(v => v.liveDraft?.seat === 1, 'host sees permitted guest editing live');
  b.room.send(ClientMsg.mapCommitEdit, { edits: [...mergedView.settings.mapEdits!, ...draftPatch] });
  const committed = await a.view(
    v => v.liveDraft === null && Boolean(v.settings.mapEdits?.some(e => e.x === 4 && e.y === 4 && e.type === 'MOUNTAIN')),
    'guest committed direct edit',
  );
  assert.ok(committed.settings.mapEdits?.some(e => e.x === 4 && e.y === 4));

  // 5. Host locks Guest from editing & suggesting -> drops live draft and blocks new suggestions/edits
  a.room.send(ClientMsg.settings, { ...committed.settings, suggestionsEnabled: true });
  await b.view(v => v.settings.suggestionsEnabled === true);
  b.room.send(ClientMsg.mapDraft, { edits: draftPatch });
  await a.view(v => v.liveDraft?.seat === 1);
  a.room.send(ClientMsg.setSeatMapAccess, { seat: 1, canEditMap: false, mapLocked: true });
  const locked = await b.view(v => v.seats[1].mapLocked === true && v.seats[1].canEditMap === false && v.liveDraft === null, 'guest locked cleanly');
  assert.equal(locked.seats[1].mapLocked, true);
  b.room.send(ClientMsg.mapSuggest, { edits: draftPatch });
  await new Promise(r => setTimeout(r, 80));
  assert.equal((a.latest()?.mapSuggestions?.length ?? 0), 0);

  await a.room.leave();
  await b.room.leave();
});
