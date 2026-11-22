# Tactical Tiles

A turn-based tactics game for 2–6 players on a tile map. Each squad shares one battery of Command
Points: every move, shot, heist and reload draws on it. Capture buildings, rob banks, bridge rivers,
and destroy the enemy HQ (Conquer) or wipe out their squads (Deathmatch). Weather shifts every five
turns, fog of war is optional, and the Doomsday protocol floods the map with lava.

Play on one screen (hot-seat or against the AI) or **online**: one player creates a table, shares
its four-letter code or link, and fills any empty seats with bots.

See [GAME_REVIEW.md](GAME_REVIEW.md) for the design notes and roadmap.

## Layout

```
packages/engine   rules, map generation, AI, wire types (pure TypeScript, no I/O)
apps/server       Colyseus room per online table + Express (serves the built web app)
apps/web          React + PixiJS client (local games run the engine in the browser)
deploy/           Docker compose + Cloudflare tunnel, driven by deploy.sh
```

The server holds the only real copy of an online match. Clients send actions; the server checks
each one with the engine (`prepareAction`, which also works out its cost), applies it, and sends
every player their own view: with fog of war on, enemy units out of sight are never sent.

## Development

```
pnpm install
pnpm dev          # server on :2767 (tsx watch) + web on :5373
pnpm test         # engine, server and web tests
pnpm typecheck
pnpm build        # web app → apps/web/dist
pnpm start        # server on :2767, also serving apps/web/dist
```

The ports differ from Jinx Gambit's and EmberWild's so all three can run side by side.

## Production

```
pnpm ship              # build and deploy the latest commit on main
pnpm ship <ref>        # deploy a tag, branch or commit (also how you roll back)
pnpm ship status | logs | url | stop
```

- Only committed code is deployed (the image is built from `git archive`).
- Deploys don't end matches: tables are saved on every change (the `tiles-data` volume) and
  restored when the new server starts. Players see "reconnecting…" for a few seconds.
- **Local check of the deployed build:** http://localhost:2770.
- **Live at:** https://tiles.rxnova.dev, through the Cloudflare tunnel `tactical-tiles` (its
  token is in `deploy/.env`; see `deploy/.env.example`) pointing at `http://app:2767`.

## Online play

- Tables are saved on every change and restored after a restart or deploy (for a day).
- After a restart, bots wait 30 seconds before covering a player who hasn't reconnected yet.
- A player who drops keeps their seat for 3 minutes and gets it back by reloading (or reopening
  the table link) on the same device. Meanwhile a bot plays their turns; if they don't return,
  the bot keeps the seat.
- Leaving a match on purpose hands your squad to a bot.
