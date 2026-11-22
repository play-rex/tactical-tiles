/**
 * The connection to an online table (adapted from EmberWild's client store). Lobby views stay
 * here; once a match is on, each view is handed to the game store, which shows it.
 */
import {
  ClientMsg,
  CloseCode,
  ROOM_NAME,
  ServerMsg,
  type TableSettings,
  type TableView,
} from '@tactical/engine';
import { Client, type Room } from 'colyseus.js';
import { create } from 'zustand';
import { useGameStore } from '../store/useGameStore';

const SERVER_PORT = 2767;
const endpoint = import.meta.env.DEV
  ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:${SERVER_PORT}`
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
const client = new Client(endpoint);

const TOKEN_KEY = 'tt:reconnect';
/** The table you're seated at, so you can find it again after a reload. */
const TABLE_KEY = 'tt:table';
const NAME_KEY = 'tt:name';
const PLAYER_KEY = 'tt:player';
/** You chose to leave (Colyseus's code). */
const CONSENTED = 4000;

const storage = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k) ?? localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null, store: 'session' | 'local' = 'session') => {
    try {
      const s = store === 'session' ? sessionStorage : localStorage;
      if (v === null) s.removeItem(k);
      else s.setItem(k, v);
    } catch {}
  },
};

/** Who you are to the server, kept on this device: it's how you get your seat back. */
const playerId = (() => {
  let id = storage.get(PLAYER_KEY);
  if (!id) {
    id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    storage.set(PLAYER_KEY, id, 'local');
  }
  return id;
})();

/** A table code in the address (/t/ABCD), from a shared link. */
export const codeFromUrl = () => location.pathname.match(/^\/t\/([A-Za-z]{4})$/)?.[1]?.toUpperCase() ?? null;

/** This tab was seated at a table (it survives a reload). */
export const hasSavedTable = () => Boolean(storage.get(TOKEN_KEY) || storage.get(TABLE_KEY));

interface OnlineState {
  name: string;
  view: TableView | null;
  busy: boolean;
  error: string | null;
  reconnecting: boolean;
  setName(name: string): void;
  createTable(): Promise<void>;
  joinTable(code: string): Promise<void>;
  /** Back to the table you were at (after a reload), if there is one. */
  resume(): Promise<void>;
  leave(): Promise<void>;
  addBot(): void;
  removeSeat(seat: number): void;
  updateSettings(settings: TableSettings): void;
  start(): void;
  rematch(): void;
  clearError(): void;
}

let room: Room | null = null;

/**
 * Get back to your table: the reconnect token works while the server keeps your seat open;
 * failing that, rejoin by table code and your player id reclaims the seat.
 */
async function rejoin(token: string | null, code: string | null, name: string) {
  if (token) {
    try {
      return await client.reconnect(token);
    } catch (e) {
      if (!code) throw e;
    }
  }
  if (!code) throw new Error('No table to rejoin');
  return client.joinById(code, { name: name || 'Commander', playerId });
}
/** The retry loop after a dropped connection, so Leave can call it off. */
let retrying: { cancelled: boolean } | null = null;

function describe(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not found|locked/i.test(msg)) return 'No open table with that code. Check it, or start a new table.';
  if (/full right now|Too many attempts/i.test(msg)) return msg;
  if (/ECONNREFUSED|Failed to fetch|NetworkError|offline|WebSocket/i.test(msg)) {
    return "Can't reach the game server. Check your connection and try again.";
  }
  return msg;
}

const forget = () => {
  storage.set(TOKEN_KEY, null);
  storage.set(TABLE_KEY, null);
};
const goHome = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/');
};

export const useOnline = create<OnlineState>((set, get) => {
  /** Off the table for good: forget it and go back to the online menu, showing `error`. */
  function closeTable(error: string | null) {
    forget();
    set({ view: null, reconnecting: false, error });
    useGameStore.getState().exitOnline();
    goHome();
  }

  function attach(r: Room) {
    room = r;
    storage.set(TOKEN_KEY, r.reconnectionToken);
    storage.set(TABLE_KEY, r.roomId);
    history.replaceState(null, '', `/t/${r.roomId}`);
    useGameStore.getState().enterOnline({
      send: action => r.send(ClientMsg.action, action),
      leave: () => void get().leave(),
    });
    r.onMessage(ServerMsg.view, (view: TableView) => {
      set({ view, reconnecting: false });
      useGameStore.getState().applyServerView(view);
    });
    r.onMessage(ServerMsg.error, ({ message }: { message: string }) => set({ error: message }));
    r.send(ClientMsg.sync);
    r.onLeave(async code => {
      if (room !== r) return;
      room = null;
      if (code === CONSENTED || code === CloseCode.removed || code === CloseCode.openedElsewhere) {
        closeTable(
          code === CloseCode.removed
            ? 'The host removed you from the table.'
            : code === CloseCode.openedElsewhere
              ? 'You opened this table in another tab or device.'
              : null,
        );
        return;
      }
      // Dropped connection: keep the table on screen and try to get back in.
      set({ reconnecting: true });
      const retry = { cancelled: false };
      retrying = retry;
      for (let attempt = 0; attempt < 20 && !retry.cancelled; attempt++) {
        await new Promise(res => setTimeout(res, Math.min(1000 * 2 ** attempt, 8000)));
        if (retry.cancelled) break;
        try {
          const back = await rejoin(r.reconnectionToken, r.roomId, get().name);
          if (retry.cancelled) void back.leave(true);
          else {
            retrying = null;
            attach(back);
          }
          return;
        } catch (e) {
          // The seat has been given away: retrying won't bring it back.
          if (/already started|Table is full/i.test(e instanceof Error ? e.message : '')) break;
        }
      }
      if (retry.cancelled) return;
      retrying = null;
      closeTable('Lost the connection to the table.');
    });
  }

  const send = (type: string, payload?: unknown) => room?.send(type, payload);

  async function enter(fn: () => Promise<Room>) {
    set({ busy: true, error: null });
    try {
      attach(await fn());
    } catch (e) {
      set({ error: describe(e) });
    } finally {
      set({ busy: false });
    }
  }

  return {
    name: storage.get(NAME_KEY) ?? '',
    view: null,
    busy: false,
    error: null,
    reconnecting: false,
    setName(name) {
      storage.set(NAME_KEY, name, 'local');
      set({ name });
    },
    createTable: () => enter(() => client.create(ROOM_NAME, { name: get().name.trim(), playerId })),
    joinTable: code => enter(() => client.joinById(code.trim().toUpperCase(), { name: get().name.trim(), playerId })),
    async resume() {
      if (!hasSavedTable() || room) return;
      const token = storage.get(TOKEN_KEY);
      const code = storage.get(TABLE_KEY) ?? codeFromUrl();
      set({ busy: true });
      try {
        attach(await rejoin(token, code, get().name));
      } catch {
        if (!room) forget();
      } finally {
        set({ busy: false });
      }
    },
    async leave() {
      const r = room;
      if (r) {
        await r.leave(true);
        return;
      }
      // Not connected (still trying to get back in): stop trying and go home.
      if (retrying) {
        retrying.cancelled = true;
        retrying = null;
        closeTable(null);
      }
    },
    addBot: () => send(ClientMsg.addBot),
    removeSeat: seat => send(ClientMsg.removeSeat, { seat }),
    updateSettings: settings => send(ClientMsg.settings, settings),
    start: () => send(ClientMsg.start),
    rematch: () => send(ClientMsg.rematch),
    clearError: () => set({ error: null }),
  };
});
