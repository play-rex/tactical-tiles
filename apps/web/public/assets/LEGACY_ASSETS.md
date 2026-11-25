# ⚠️ Legacy artwork — fallback only, do not use

The images in `legacyunits/` (and `terrain/`, same situation) are **not the art the game renders.**
They are flat 64×64 placeholder PNGs kept only as a last-resort fallback for the asset loader.

## What actually draws the board

`apps/web/src/core/graphics/TextureManager.ts` builds every unit and terrain texture **procedurally
at runtime, onto a canvas**:

- `createReconUnitTexture(color, uType)` → HD top-down unit sprite for each of the 6 player colours
- `createReconTileTexture(key)` → terrain tiles
- `registerTex(alias, texture)` writes them into `Assets.cache` under the same aliases the manifest uses

So when the game asks for `getTexture('UNIT_P0_SOLDIER')`, it normally gets the procedural texture.
The PNG on disk is only what `Assets.init({ manifest })` in `useAssetLoader.ts` loaded *before* the
procedural pass ran, or what remains if that pass ever fails. That is the entire purpose of this
folder: **fallback, not source of truth.**

## Rules

1. **Never reference `legacyunits/*.png` from UI or gameplay code.** A raw `<img src="/assets/legacyunits/...">`
   will not match what the player sees on the board — different art, different scale, no team ring,
   no facing, no rank chevrons.
2. **To show a unit icon in the DOM, use `UnitMapIcon`** from
   `apps/web/src/components/ui/UnitDeckModal.tsx`. It snapshots the real Pixi texture to a data URL and
   renders it as an `<img>` with no extra WebGL context. This is what the hover card tooltip uses for
   `[Scout icon] 2 CP` / `[Breacher icon] 4 CP`, and what the unit deck uses for its portraits.
3. **To change how a unit looks, edit `createReconUnitTexture`** in `TextureManager.ts` — not these files.
   Any change to the PNGs here will be invisible in game.
4. **Don't delete this folder without also removing the manifest entries.** `ASSET_MANIFEST` in
   `apps/web/src/core/graphics/AssetManifest.ts` still lists the files, and `Assets.init` walks that
   manifest at boot; deleting files out from under it makes the loader log 404s during startup. Remove
   the manifest block and the folder together, or leave both alone.

## Quick check

If a new UI element shows flat, mismatched or rotated-wrong unit art, the bug is almost always a direct
`/assets/legacyunits/` reference instead of `UnitMapIcon`.
