/**
 * One online table: a lobby where the host sets the rules and fills seats (people or bots),
 * then the match. The server holds the only real game; every player is sent their own view
 * of it after each change. Modelled on EmberWild's TableRoom.
 */
import { type AuthContext, type Client, type Deferred, matchMaker, Room } from '@colyseus/core';
import {
  applyAction,
  botAction,
  ClientMsg,
  ROOM_NAME,
  CloseCode,
  createGeneratedGame,
  DEFAULT_TABLE_SETTINGS,
  eventsFor,
  gameSettingsFor,
  MAX_PLAYERS,
  MIN_PLAYERS,
  prepareAction,
  type GameAction,
  type GameEvent,
  type GameState,
  type SeatInfo,
  ServerMsg,
  type TableSettings,
  type TableView,
  viewFor,
  visibleSet,
} from '@tactical/engine';

const EMPTY_SIGHT = new Set<string>();
import type { z } from 'zod';
import { actionMsg, joinOptions, removeSeatMsg, settingsMsg } from './messages';
import type { TableStore } from './store';

interface Seat {
  sessionId: string | null; // null for bots, and for players who haven't come back yet
  /** A player's lasting identity (kept on their device), so they can reclaim the seat. */
  playerId: string | null;
  name: string;
  isBot: boolean;
  connected: boolean;
}

const BOT_NAMES = ['Viper', 'Granite', 'Talon', 'Mirage', 'Cobalt', 'Ember', 'Onyx', 'Sable'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, to avoid confusion
const CODES_KEY = 'tactical:codes';

export const timings = {
  /** Pause between a bot's actions, so people can follow them. */
  botThinkMs: [450, 800] as [number, number],
  /** Pause before a bot steps in for a disconnected player. */
  autopilotMs: 4000,
  lobbyReconnectS: 30,
  gameReconnectS: 180,
  /** After a restart, how long bots wait before playing for players still reconnecting. */
  restoreGraceMs: 30_000,
};

/** Guards against floods. Generous for real play, including several friends behind one address. */
export const limits = {
  maxTables: 300,
  /** Joins (and table creations) per address per minute. */
  joinsPerMinute: 40,
  /** Messages per connection per second; extra ones are dropped. */
  messagesPerSecond: 40,
  /** Actions a bot may take in one turn before its turn is ended for it. */
  botActionsPerTurn: 80,
};

/** A fixed-window counter per key. */
function windowLimiter(windowMs: number) {
  const seen = new Map<string, { start: number; count: number }>();
  return (key: string, max: number) => {
    const now = Date.now();
    if (seen.size > 10_000) seen.clear();
    const entry = seen.get(key);
    if (!entry || now - entry.start >= windowMs) {
      seen.set(key, { start: now, count: 1 });
      return true;
    }
    return ++entry.count <= max;
  };
}
const joinAllowed = windowLimiter(60_000);

const between = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo);

/** What's saved of a table: enough to bring it back exactly as players last saw it. */
interface TableSnapshot {
  v: 1;
  code: string;
  seats: Pick<Seat, 'playerId' | 'name' | 'isBot'>[];
  hostPlayerId: string | null;
  settings: TableSettings;
  status: TableView['status'];
  game: GameState | null;
  seq: number;
}

/** Tables waiting to be restored at boot, keyed by code. */
const restoring = new Map<string, TableSnapshot>();

/**
 * Bring back every table that was open when the server stopped (a deploy, a crash, a
 * reboot). Players rejoin with their player id and carry on where they left off.
 */
export async function restoreTables(store: TableStore, maxAgeMs = 24 * 60 * 60 * 1000) {
  let count = 0;
  for (const row of store.all()) {
    let snap: TableSnapshot | null = null;
    try {
      snap = JSON.parse(row.data) as TableSnapshot;
    } catch {}
    if (snap?.v !== 1 || snap.code !== row.code || !snap.seats?.some(s => !s.isBot) || Date.now() - row.updatedAt > maxAgeMs) {
      store.delete(row.code);
      continue;
    }
    if (matchMaker.getLocalRoomById(snap.code)) continue; // already open
    restoring.set(snap.code, snap);
    try {
      await matchMaker.createRoom(ROOM_NAME, { restoreCode: snap.code });
      count++;
    } finally {
      restoring.delete(snap.code);
    }
  }
  return count;
}

export class TableRoom extends Room {
  // Seats are capped in onJoin. This is higher so a full table still lets a player back in:
  // Colyseus counts held seats and replaced connections against it and would lock the room.
  override maxClients = MAX_PLAYERS * 3;
  override autoDispose = true;

  private seats: Seat[] = [];
  private hostPlayerId: string | null = null;
  private settings: TableSettings = structuredClone(DEFAULT_TABLE_SETTINGS);
  private status: TableView['status'] = 'lobby';
  private game: GameState | null = null;
  /** Goes up with every change to the game; views carry it so clients play effects once. */
  private seq = 0;
  /** What each human seat can see in the current game (empty without fog or for bots), worked out once per change. */
  private sight: Set<string>[] = [];
  /** Cached per-seat GameView instances for the current `seq`. */
  private cachedViewsSeq = -1;
  private cachedGameViews: TableView['game'][] = [];
  /** True only when durable TableSnapshot fields changed and need persisting. */
  private snapshotDirty = false;
  /** Bot actions taken this turn (a runaway guard). */
  private botActions = { turn: -1, count: 0 };
  /** When a bot plays the current turn for a disconnected player, fixed once per turn. */
  private coverAt: { turn: number; at: number } | null = null;
  /** Seats being held for dropped players, by session, so a hold can be cancelled. */
  private holds = new Map<string, Deferred<Client>>();
  private messageAllowed = windowLimiter(1000);
  private pending: { clear(): void } | null = null;
  private restoreHold: { clear(): void } | null = null;
  private counted = false;
  /** After a restore: bots hold off for players finding their way back until then. */
  private graceUntil = 0;
  private static openTables = 0;
  /** Where tables are saved (none in tests that don't need it). */
  static store: TableStore | null = null;
  /** Set once the server is stopping: tables are kept as they are, to be restored. */
  static shuttingDown = false;

  static async generateCode(exists: (code: string) => Promise<boolean>): Promise<string> {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!(await exists(code))) return code;
    }
  }

  override async onCreate(options: unknown) {
    const code = (options as { restoreCode?: unknown } | undefined)?.restoreCode;
    const snap = typeof code === 'string' ? restoring.get(code) : undefined;
    if (snap) {
      restoring.delete(snap.code);
      this.roomId = snap.code;
    } else {
      if (TableRoom.openTables >= limits.maxTables) {
        throw new Error('The server is full right now. Try again in a few minutes.');
      }
      this.roomId = await TableRoom.generateCode(async c => Boolean(await this.presence.sismember(CODES_KEY, c)));
    }
    await this.presence.sadd(CODES_KEY, this.roomId);
    TableRoom.openTables++;
    this.counted = true;

    this.on(ClientMsg.sync, client => this.sendView(client));

    this.on(ClientMsg.addBot, client => {
      if (!this.requireHost(client) || !this.requireLobby(client)) return;
      if (this.seats.length >= MAX_PLAYERS) return this.err(client, 'Table is full');
      const used = new Set(this.seats.map(s => s.name));
      const name = BOT_NAMES.find(n => !used.has(n)) ?? `Bot ${this.seats.length + 1}`;
      this.seats.push({ sessionId: null, playerId: null, name, isBot: true, connected: true });
      this.snapshotDirty = true;
      this.broadcastViews();
    });

    this.on(ClientMsg.removeSeat, (client, raw) => {
      const msg = this.parse(client, removeSeatMsg, raw);
      if (!msg || !this.requireHost(client) || !this.requireLobby(client)) return;
      const seat = this.seats[msg.seat];
      if (!seat || seat.sessionId === client.sessionId) return;
      if (seat.sessionId) {
        // Also drop a seat being held for them, so they can't reconnect into nothing.
        this.evictSession(seat.sessionId, CloseCode.removed, 'Removed by host');
      }
      this.seats.splice(msg.seat, 1);
      this.snapshotDirty = true;
      this.broadcastViews();
    });

    this.on(ClientMsg.settings, (client, raw) => {
      const msg = this.parse(client, settingsMsg, raw);
      if (!msg || !this.requireHost(client) || !this.requireLobby(client)) return;
      this.settings = msg;
      this.snapshotDirty = true;
      this.broadcastViews();
    });

    this.on(ClientMsg.start, client => {
      if (!this.requireHost(client)) return;
      if (this.status === 'playing') return this.err(client, 'The match is already running');
      this.startGame(client);
    });

    this.on(ClientMsg.rematch, client => {
      if (!this.requireHost(client)) return;
      if (this.status !== 'finished') return this.err(client, "The match isn't over yet");
      this.startGame(client);
    });

    this.on(ClientMsg.action, (client, raw) => {
      const msg = this.parse(client, actionMsg, raw);
      if (!msg) return;
      const seat = this.seatOf(client);
      if (seat < 0 || !this.game || this.status !== 'playing') return this.err(client, "You're not in this match");
      this.act(seat, msg as GameAction, client);
    });

    if (snap) this.restore(snap);
  }

  /** Rebuild a table from its snapshot; every player is away until they rejoin. */
  private restore(snap: TableSnapshot) {
    this.seats = snap.seats.map(s => ({ ...s, sessionId: null, connected: s.isBot }));
    this.hostPlayerId = snap.hostPlayerId;
    this.settings = snap.settings;
    this.status = snap.status;
    this.game = snap.game;
    this.seq = snap.seq;
    this.snapshotDirty = false;
    this.refreshSight();
    this.graceUntil = Date.now() + timings.restoreGraceMs;
    // Nobody is connected yet: keep the room open while they find their way back, and hand
    // the seats of anyone who never does to bots (as if their reconnection hold ran out).
    const holdS = this.reconnectHoldS();
    this.resetAutoDisposeTimeout(holdS);
    this.restoreHold = this.clock.setTimeout(() => {
      this.restoreHold = null;
      for (const seat of [...this.seats]) if (!seat.isBot && !seat.connected && !seat.sessionId) this.retire(seat);
    }, holdS * 1000);
    this.afterChange();
  }

  /** Runs before every new join or table creation (not for reconnections). */
  override onAuth(_client: Client, _options: unknown, context: AuthContext) {
    const forwarded = context?.headers?.['cf-connecting-ip'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? context?.ip ?? 'unknown';
    if (!joinAllowed(String(ip), limits.joinsPerMinute)) {
      throw new Error('Too many attempts from your connection. Wait a minute and try again.');
    }
    return true;
  }

  /** Registers a message handler behind the per-connection rate limit. */
  private on(type: string, handler: (client: Client, raw: unknown) => void) {
    this.onMessage(type, (client, raw) => {
      if (this.messageAllowed(client.sessionId, limits.messagesPerSecond)) handler(client, raw);
    });
  }

  override onJoin(client: Client, options: unknown) {
    const parsed = joinOptions.safeParse(options);
    if (!parsed.success) throw new Error('Pick a name (1–20 characters)');
    const { playerId } = parsed.data;

    // Coming back to your own seat (from a new tab, or after the connection dropped): take it over.
    const mine = this.seats.find(s => !s.isBot && s.playerId === playerId);
    if (mine) {
      const previous = mine.sessionId;
      mine.sessionId = client.sessionId;
      mine.connected = true;
      if (!this.hostPlayerId) {
        this.hostPlayerId = playerId;
        this.snapshotDirty = true;
      }
      if (this.restoreHold && this.seats.every(s => s.isBot || s.connected)) {
        this.restoreHold.clear();
        this.restoreHold = null;
      }
      if (previous && previous !== client.sessionId) {
        this.evictSession(previous, CloseCode.openedElsewhere, 'Opened somewhere else');
      }
      this.afterChange();
      return;
    }

    if (this.status !== 'lobby') throw new Error('That match has already started');
    if (this.seats.length >= MAX_PLAYERS) throw new Error('Table is full');

    let name = parsed.data.name;
    const taken = new Set(this.seats.map(s => s.name.toLowerCase()));
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${parsed.data.name} ${i}`;

    this.seats.push({ sessionId: client.sessionId, playerId, name, isBot: false, connected: true });
    this.hostPlayerId ??= playerId;
    this.snapshotDirty = true;
    this.broadcastViews();
  }

  override async onLeave(client: Client, consented: boolean) {
    // Server stopping: leave seats as they are; the saved table brings everyone back.
    if (TableRoom.shuttingDown) return;
    const seat = this.seats[this.seatOf(client)];
    if (!seat) return;
    if (consented) {
      this.retire(seat);
      return;
    }
    seat.connected = false;
    // If it was their turn, a bot steps in after a moment.
    this.afterChange();

    try {
      const hold = this.allowReconnection(client, this.reconnectHoldS());
      this.holds.set(client.sessionId, hold);
      const back = await hold;
      // The seat went away while they were gone (removed, or reopened elsewhere).
      if (!this.seats.includes(seat) || seat.sessionId !== client.sessionId) {
        back.leave(this.seats.includes(seat) ? CloseCode.openedElsewhere : CloseCode.removed);
        return;
      }
      seat.connected = true;
      this.afterChange();
    } catch {
      this.vacate(client.sessionId);
    } finally {
      this.holds.delete(client.sessionId);
    }
  }

  override onBeforeShutdown() {
    this.disconnect(CloseCode.restarting);
  }

  override async onDispose() {
    this.pending?.clear();
    this.pending = null;
    this.restoreHold?.clear();
    this.restoreHold = null;
    if (this.counted) TableRoom.openTables--;
    // Everyone has gone for good: forget the table. (On shutdown, keep it to restore.)
    if (!TableRoom.shuttingDown) TableRoom.store?.delete(this.roomId);
    await this.presence.srem(CODES_KEY, this.roomId);
  }

  // ── match control ──────────────────────────────────────────────

  private startGame(client: Client) {
    if (this.seats.length < MIN_PLAYERS) {
      return this.err(client, `Need at least ${MIN_PLAYERS} seats — add a bot?`);
    }
    this.game = createGeneratedGame(gameSettingsFor(this.settings, this.seats.length));
    this.status = 'playing';
    this.seq++;
    this.snapshotDirty = true;
    this.refreshSight();
    this.afterChange();
  }

  /** A player's action: checked against the rules, then applied. */
  private act(seat: number, action: GameAction, client?: Client) {
    const game = this.game;
    if (!game) return;
    const prepared = prepareAction(game, seat, action);
    if (!prepared.ok) {
      if (client) this.err(client, prepared.error);
      return false;
    }
    return this.apply(prepared.action, this.seats[seat]?.isBot || !this.seats[seat]?.connected);
  }

  private apply(action: GameAction, asBot: boolean) {
    const before = this.game;
    // Once the server is stopping nothing is saved, so nothing may change either: the table
    // comes back exactly as players last saw it.
    if (!before || TableRoom.shuttingDown) return false;
    const result = applyAction(before, action, { autoBankReward: asBot });
    if (result.rejected) return false;
    const after = result.state;
    this.game = after;
    // Each human sees the effects that happened where they could see (fog of war): what they
    // saw before the action (kept from the last change) or can see now.
    const fog = after.settings.fogOfWar;
    const sightBefore = this.sight;
    this.refreshSight();
    const seatEvents = this.seats.map((s, i) =>
      s.isBot ? [] : eventsFor(result.events, fog, sightBefore[i] ?? EMPTY_SIGHT, this.sight[i] ?? EMPTY_SIGHT),
    );
    this.seq++;
    if (after.winner !== null) this.status = 'finished';
    this.snapshotDirty = true;
    this.afterChange(seatEvents);
    return true;
  }

  /** Broadcast, then schedule whatever happens next without a human. */
  private afterChange(seatEvents?: GameEvent[][]) {
    this.pending?.clear();
    this.pending = null;
    this.broadcastViews(seatEvents);
    this.scheduleAutoTurn();
  }

  private scheduleAutoTurn() {
    const game = this.game;
    if (!game || this.status !== 'playing' || game.winner !== null) return;

    const turn = game.currentPlayer;
    const seat = this.seats[turn];
    if (!seat) return;
    if (seat.isBot || seat.connected) this.coverAt = null;
    if (seat.connected && !seat.isBot) return; // a person is playing: wait for them

    // A bot's turn, or a player who's away: a bot plays it. For someone who's away (or right
    // after restore before anyone connects) it waits in case players reconnect first.
    let delay = between(timings.botThinkMs);
    const graceRemaining = this.clients.length === 0 ? Math.max(0, this.graceUntil - Date.now()) : 0;
    if (!seat.isBot) {
      if (this.coverAt?.turn !== game.turnCounter) {
        const wait = Math.max(timings.autopilotMs, graceRemaining);
        this.coverAt = { turn: game.turnCounter, at: Date.now() + wait };
      }
      delay = Math.max(delay, this.coverAt.at - Date.now());
    } else if (graceRemaining > 0) {
      delay = Math.max(delay, graceRemaining);
    }
    this.pending = this.clock.setTimeout(() => this.playBotStep(turn), Math.max(0, delay));
  }

  /** One action for the seat whose turn it is, chosen by the AI. */
  private playBotStep(seat: number) {
    const game = this.game;
    if (!game || game.currentPlayer !== seat || game.winner !== null) return;

    if (this.botActions.turn !== game.turnCounter) this.botActions = { turn: game.turnCounter, count: 0 };
    this.botActions.count++;

    let action: GameAction;
    if (game.bankRewardPending?.playerId === seat) {
      // A player who left a vault unclaimed: take the gold for them.
      action = { type: 'BANK_REWARD', choice: 'GOLD' };
    } else if (this.botActions.count > limits.botActionsPerTurn) {
      action = { type: 'END_TURN' };
    } else {
      action = botAction(game);
    }
    // Anything the rules refuse (or that changes nothing) ends the turn, so a bot can't stall.
    if (!this.act(seat, action)) this.apply({ type: 'END_TURN' }, true);
  }

  /** A connection is gone for good. */
  private vacate(sessionId: string) {
    const seat = this.seats.find(s => s.sessionId === sessionId);
    if (seat) this.retire(seat);
  }

  /** A player is gone for good: drop them in the lobby, hand their seat to a bot mid-match. */
  private retire(seat: Seat) {
    const wasHost = seat.playerId !== null && seat.playerId === this.hostPlayerId;
    if (this.status === 'lobby') {
      this.seats.splice(this.seats.indexOf(seat), 1);
    } else {
      seat.sessionId = null;
      seat.playerId = null;
      seat.isBot = true;
      seat.connected = true;
      seat.name = `${seat.name} (bot)`;
    }
    if (wasHost) {
      const humans = this.seats.filter(s => !s.isBot && s.playerId);
      this.hostPlayerId = (humans.find(s => s.connected) ?? humans[0])?.playerId ?? null;
    }
    this.snapshotDirty = true;
    this.afterChange();
  }

  // ── helpers ────────────────────────────────────────────────────

  private reconnectHoldS() {
    return this.status === 'lobby' ? timings.lobbyReconnectS : timings.gameReconnectS;
  }

  private evictSession(sessionId: string, code: number, reason: string) {
    this.holds.get(sessionId)?.reject(false);
    this.clients.getById(sessionId)?.leave(code, reason);
  }

  private refreshSight() {
    const game = this.game;
    this.sight = game
      ? this.seats.map((s, i) => (s.isBot ? EMPTY_SIGHT : visibleSet(game, i)))
      : [];
  }

  private seatOf(client: Client) {
    return this.seats.findIndex(s => s.sessionId === client.sessionId);
  }

  private parse<T>(client: Client, schema: z.ZodType<T>, raw: unknown): T | null {
    const r = schema.safeParse(raw);
    if (!r.success) {
      this.err(client, 'Malformed message');
      return null;
    }
    return r.data;
  }

  private requireHost(client: Client) {
    const seat = this.seats[this.seatOf(client)];
    if (seat?.playerId && seat.playerId === this.hostPlayerId) return true;
    this.err(client, 'Only the host can do that');
    return false;
  }

  private requireLobby(client: Client) {
    if (this.status === 'lobby') return true;
    this.err(client, 'Only before the match starts');
    return false;
  }

  private err(client: Client, message: string) {
    client.send(ServerMsg.error, { message });
  }

  /** Every change ends here: send each player their view, and save the table. */
  private broadcastViews(seatEvents?: GameEvent[][]) {
    const seats = this.seatInfo();
    for (const client of this.clients) {
      const mySeat = this.seatOf(client);
      this.sendView(client, seats, seatEvents?.[mySeat] ?? []);
    }
    this.persist();
  }

  private persist() {
    if (TableRoom.shuttingDown || !TableRoom.store || !this.snapshotDirty) return;
    const snap: TableSnapshot = {
      v: 1,
      code: this.roomId,
      seats: this.seats.map(({ playerId, name, isBot }) => ({ playerId, name, isBot })),
      hostPlayerId: this.hostPlayerId,
      settings: this.settings,
      status: this.status,
      game: this.game,
      seq: this.seq,
    };
    try {
      TableRoom.store.save(this.roomId, JSON.stringify(snap));
      this.snapshotDirty = false;
    } catch (e) {
      console.error('failed to save table', e);
    }
  }

  private seatInfo(): SeatInfo[] {
    return this.seats.map(s => ({
      name: s.name,
      isBot: s.isBot,
      connected: s.connected,
      isHost: s.playerId !== null && s.playerId === this.hostPlayerId,
      autopilot: !s.isBot && !s.connected && this.status === 'playing',
    }));
  }

  /**
   * `seats` is shared by every client in a broadcast, so it is built once by the caller.
   * Effects are only attached on the broadcast for the action that created them (never on `sync` or reconnect).
   */
  private sendView(client: Client, seats = this.seatInfo(), events: GameEvent[] = []) {
    const mySeat = this.seatOf(client);
    let gameView: TableView['game'] = null;
    if (this.game && mySeat >= 0) {
      if (this.cachedViewsSeq !== this.seq) {
        this.cachedViewsSeq = this.seq;
        this.cachedGameViews = [];
      }
      gameView = this.cachedGameViews[mySeat] ?? (this.cachedGameViews[mySeat] = viewFor(this.game, mySeat, this.sight[mySeat]));
    }
    const view: TableView = {
      code: this.roomId,
      status: this.status,
      seats,
      mySeat,
      settings: this.settings,
      game: gameView,
      events,
      seq: this.seq,
    };
    client.send(ServerMsg.view, view);
  }
}
