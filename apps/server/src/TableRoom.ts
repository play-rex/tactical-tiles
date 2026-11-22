/**
 * One online table: a lobby where the host sets the rules and fills seats (people or bots),
 * then the match. The server holds the only real game; every player is sent their own view
 * of it after each change. Modelled on EmberWild's TableRoom.
 */
import { type AuthContext, type Client, type Deferred, Room } from '@colyseus/core';
import {
  applyAction,
  botAction,
  ClientMsg,
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
import type { z } from 'zod';
import { actionMsg, joinOptions, removeSeatMsg, settingsMsg } from './messages';

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
  /** The latest change's effects, as each seat may see them. */
  private seatEvents: GameEvent[][] = [];
  /** What each seat can see in the current game (empty without fog), worked out once per change. */
  private sight: Set<string>[] = [];
  /** Bot actions taken this turn (a runaway guard). */
  private botActions = { turn: -1, count: 0 };
  /** When a bot plays the current turn for a disconnected player, fixed once per turn. */
  private coverAt: { turn: number; at: number } | null = null;
  /** Seats being held for dropped players, by session, so a hold can be cancelled. */
  private holds = new Map<string, Deferred<Client>>();
  private messageAllowed = windowLimiter(1000);
  private pending: { clear(): void } | null = null;
  private counted = false;
  private static openTables = 0;

  static async generateCode(exists: (code: string) => Promise<boolean>): Promise<string> {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!(await exists(code))) return code;
    }
  }

  override async onCreate() {
    if (TableRoom.openTables >= limits.maxTables) {
      throw new Error('The server is full right now. Try again in a few minutes.');
    }
    this.roomId = await TableRoom.generateCode(async c => Boolean(await this.presence.sismember(CODES_KEY, c)));
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
      this.broadcastViews();
    });

    this.on(ClientMsg.removeSeat, (client, raw) => {
      const msg = this.parse(client, removeSeatMsg, raw);
      if (!msg || !this.requireHost(client) || !this.requireLobby(client)) return;
      const seat = this.seats[msg.seat];
      if (!seat || seat.sessionId === client.sessionId) return;
      if (seat.sessionId) {
        // Also drop a seat being held for them, so they can't reconnect into nothing.
        this.holds.get(seat.sessionId)?.reject(false);
        this.clients.getById(seat.sessionId)?.leave(CloseCode.removed, 'Removed by host');
      }
      this.seats.splice(msg.seat, 1);
      this.broadcastViews();
    });

    this.on(ClientMsg.settings, (client, raw) => {
      const msg = this.parse(client, settingsMsg, raw);
      if (!msg || !this.requireHost(client) || !this.requireLobby(client)) return;
      this.settings = msg;
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
      this.hostPlayerId ??= playerId;
      if (previous && previous !== client.sessionId) {
        this.holds.get(previous)?.reject(false);
        this.clients.getById(previous)?.leave(CloseCode.openedElsewhere, 'Opened somewhere else');
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
    this.broadcastViews();
  }

  override async onLeave(client: Client, consented: boolean) {
    const seat = this.seats[this.seatOf(client)];
    if (!seat) return;
    seat.connected = false;
    // If it was their turn, a bot steps in after a moment.
    this.afterChange();

    try {
      if (consented) throw new Error('left');
      const hold = this.allowReconnection(client, this.status === 'lobby' ? timings.lobbyReconnectS : timings.gameReconnectS);
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
    if (this.counted) TableRoom.openTables--;
    await this.presence.srem(CODES_KEY, this.roomId);
  }

  // ── match control ──────────────────────────────────────────────

  private startGame(client: Client) {
    if (this.seats.length < MIN_PLAYERS) {
      return this.err(client, `Need at least ${MIN_PLAYERS} seats — add a bot?`);
    }
    this.game = createGeneratedGame(gameSettingsFor(this.settings, this.seats.length));
    this.sight = this.seats.map((_, i) => visibleSet(this.game!, i));
    this.status = 'playing';
    this.seatEvents = [];
    this.seq++;
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
    if (!before) return false;
    const result = applyAction(before, action, { autoBankReward: asBot });
    if (result.rejected) return false;
    const after = result.state;
    this.game = after;
    // Each player sees the effects that happened where they could see (fog of war): what they
    // saw before the action (kept from the last change) or can see now.
    const fog = after.settings.fogOfWar;
    const sightBefore = this.sight;
    this.sight = this.seats.map((_, i) => visibleSet(after, i));
    this.seatEvents = this.seats.map((_, i) => eventsFor(result.events, fog, sightBefore[i] ?? new Set(), this.sight[i]));
    this.seq++;
    if (after.winner !== null) this.status = 'finished';
    this.afterChange();
    return true;
  }

  /** Broadcast, then schedule whatever happens next without a human. */
  private afterChange() {
    this.pending?.clear();
    this.pending = null;
    this.broadcastViews();
    const game = this.game;
    if (!game || this.status !== 'playing' || game.winner !== null) return;

    const turn = game.currentPlayer;
    const seat = this.seats[turn];
    if (!seat) return;
    if (seat.isBot || seat.connected) this.coverAt = null;
    if (seat.connected && !seat.isBot) return; // a person is playing: wait for them

    // A bot's turn, or a player who's away: a bot plays it. For someone who's away it waits a
    // little first (fixed once per turn) in case they come straight back.
    let delay = between(timings.botThinkMs);
    if (!seat.isBot) {
      if (this.coverAt?.turn !== game.turnCounter) {
        this.coverAt = { turn: game.turnCounter, at: Date.now() + timings.autopilotMs };
      }
      delay = Math.max(delay, this.coverAt.at - Date.now());
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
    this.afterChange();
  }

  // ── helpers ────────────────────────────────────────────────────

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

  /** Every change ends here: send each player their view. */
  private broadcastViews() {
    const seats = this.seatInfo();
    for (const client of this.clients) this.sendView(client, seats);
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
   * The latest change's effects always go along; clients play them once per `seq`.
   */
  private sendView(client: Client, seats = this.seatInfo()) {
    const mySeat = this.seatOf(client);
    const view: TableView = {
      code: this.roomId,
      status: this.status,
      seats,
      mySeat,
      settings: this.settings,
      game: this.game && mySeat >= 0 ? viewFor(this.game, mySeat, this.sight[mySeat]) : null,
      events: this.seatEvents[mySeat] ?? [],
      seq: this.seq,
    };
    client.send(ServerMsg.view, view);
  }
}
