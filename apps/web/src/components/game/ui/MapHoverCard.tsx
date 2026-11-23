import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isUnitVisible } from '@tactical/engine';
import {
  BANK_STATS,
  BARRIER_STATS,
  BASE_STATS,
  BUILDING_STATS,
  LAND_MINE_STATS,
  TERRAIN_COSTS,
  TERRAIN_DEFENSE,
  TILE_SIZE,
  UNIT_STATS,
} from '@tactical/engine/constants/Config';
import { getManhattanDistance, getStepCost, getTileByIdFast, getTileWeather } from '@tactical/engine/grid/Pathfinding';
import {
  calculateDemolishDamage,
  calculateSiegeDamage,
  getUnitAttackCost,
  getUnitBaseDamage,
  getUnitMaxHp,
  getUnitRange,
  isWithinEnemyHqExclusion,
} from '@tactical/engine/rules/CombatRules';
import { useViewportContext } from '../../../context/ViewportContext';
import { rotateBoardPoint } from '../../../core/boardRotation';
import {
  computeUnitAttackPreview,
  getHoveredEnemyBlocker,
  getHoverMoveResolution,
  getPostMoveTargetTiles,
} from '../../../core/hoverMovePreview';
import { useGameStore, viewerSeat } from '../../../store/useGameStore';

interface ScreenPt {
  left: number;
  top: number;
  placeBelow: boolean;
}

/**
 * Lightweight floating tactical preview projected over the hovered tile or blocker feedback tile.
 * Shows attack damage, move CP cost, terrain defense, Crossfire, Overwatch/turret hazards, and
 * unit/tile quick stats directly on the battlefield instead of forcing eyes to the right panel.
 */
export const MapHoverCard: React.FC = () => {
  const hostRef = useRef<HTMLDivElement>(null);
  const { viewport } = useViewportContext();
  const [camRev, setCamRev] = useState(0);

  const hoveredTileId = useGameStore(s => s.hoveredTileId);
  const mapFeedback = useGameStore(s => s.mapFeedback);
  const mapData = useGameStore(s => s.mapData);
  const gridSize = useGameStore(s => s.gridSize);
  const units = useGameStore(s => s.units);
  const selectedUnitId = useGameStore(s => s.selectedUnitId);
  const validMoveCosts = useGameStore(s => s.validMoveCosts);
  const validMoveParents = useGameStore(s => s.validMoveParents);
  const validAttackTargets = useGameStore(s => s.validAttackTargets);
  const validSiegeTile = useGameStore(s => s.validSiegeTile);
  const validDemolishTile = useGameStore(s => s.validDemolishTile);
  const placementMode = useGameStore(s => s.placementMode);
  const pendingDrops = useGameStore(s => s.pendingDrops);
  const mines = useGameStore(s => s.mines);
  const mapRotation = useGameStore(s => s.mapRotation);
  const currentPlayer = useGameStore(s => s.currentPlayer);
  const playerCp = useGameStore(s => s.playerCp);
  const weather = useGameStore(s => s.weather);
  const settings = useGameStore(s => s.settings);
  const visibleTiles = useGameStore(s => s.visibleTiles);
  const viewer = useGameStore(viewerSeat);
  const isAiTurn = useGameStore(s => s.isAiTurn);
  const winner = useGameStore(s => s.winner);

  useEffect(() => {
    if (!viewport) return;
    const bump = () => setCamRev(r => r + 1);
    viewport.on('moved', bump);
    viewport.on('zoomed', bump);
    return () => {
      if (!viewport.destroyed) {
        viewport.off('moved', bump);
        viewport.off('zoomed', bump);
      }
    };
  }, [viewport]);

  const activeBanks = useMemo(
    () => mapData.filter(t => t.type === 'BANK' && (t.hackProgress || 0) < 100),
    [mapData],
  );
  const enemyBases = useMemo(
    () =>
      settings.victoryMode === 'CONQUER'
        ? mapData.filter(t => t.type === 'BASE' && t.owner !== currentPlayer && (t.hp || 0) > 0)
        : [],
    [mapData, settings.victoryMode, currentPlayer],
  );

  const anchorTileId = mapFeedback?.tileId ?? hoveredTileId;
  const anchorTile = useMemo(
    () => (anchorTileId ? getTileByIdFast(mapData, anchorTileId, gridSize) : undefined),
    [anchorTileId, mapData, gridSize],
  );

  const computeScreenPos = useCallback((): ScreenPt | null => {
    if (!viewport || !anchorTile || !hostRef.current) return null;
    const w = hostRef.current.clientWidth;
    const h = hostRef.current.clientHeight;
    if (w <= 0 || h <= 0) return null;
    const tilePx = TILE_SIZE * viewport.scale.x;
    const worldPt = rotateBoardPoint(
      (anchorTile.x + 0.5) * TILE_SIZE,
      (anchorTile.y + 0.5) * TILE_SIZE,
      mapRotation,
      gridSize * TILE_SIZE,
    );
    const center = viewport.toScreen(worldPt.x, worldPt.y);
    const left = Math.max(8, Math.min(w - 220, center.x));
    const placeBelow = center.y - tilePx * 0.55 < 78;
    const top = placeBelow
      ? Math.min(h - 12, center.y + tilePx * 0.55 + 6)
      : Math.max(8, center.y - tilePx * 0.55 - 6);
    return { left, top, placeBelow };
  }, [viewport, anchorTile, mapRotation, gridSize, camRev]);

  const pos = computeScreenPos();

  const cardContent = useMemo(() => {
    if (mapFeedback) {
      return {
        tone: mapFeedback.tone === 'warn' ? 'amber' : 'blue',
        headerLeft: mapFeedback.tone === 'warn' ? 'BLOCKED' : 'NOTICE',
        headerRight: '',
        body: mapFeedback.text,
        tags: [] as string[],
      };
    }

    if (!hoveredTileId || !anchorTile || anchorTile.id !== hoveredTileId) return null;

    const myActive = !isAiTurn && winner === null;
    const selectedUnit = selectedUnitId ? units.find(u => u.id === selectedUnitId) : undefined;
    const selectedTile = selectedUnit ? getTileByIdFast(mapData, selectedUnit.tileId, gridSize) : undefined;
    const isSelectedMine = Boolean(myActive && selectedUnit && selectedUnit.owner === currentPlayer);
    const isCommanding = Boolean(isSelectedMine && !selectedUnit?.completed);

    const visibleUnit = units.find(
      u => u.tileId === anchorTile.id && isUnitVisible(u, viewer, settings.fogOfWar, visibleTiles),
    );

    if (isSelectedMine && selectedUnit) {
      // 1. Any visible enemy tile reports explicit Attack status (In Range / Out of Range / Blocked / Already Acted)
      if (visibleUnit && visibleUnit.owner !== currentPlayer) {
        if (!selectedUnit.completed && validAttackTargets.includes(visibleUnit.id)) {
          const atkCost = getUnitAttackCost(selectedUnit);
          const preview = computeUnitAttackPreview({
            attacker: selectedUnit,
            attTile: selectedTile,
            target: visibleUnit,
            tarTile: anchorTile,
            units,
            mapData,
            weather,
            gridSize,
          });
          const hpAfter = Math.max(0, visibleUnit.hp - preview.damage);
          const tags: string[] = [];
          if (preview.crossfireBonus > 0) tags.push(`CROSSFIRE +${preview.crossfireBonus}`);
          if (preview.watchtowerBoosted) tags.push('WATCHTOWER x1.2');
          if (preview.defense > 0) tags.push(`COVER -${Math.round(preview.defense * 100)}%`);
          else if (preview.defense < 0) tags.push(`EXPOSED +${Math.round(Math.abs(preview.defense) * 100)}%`);
          if (preview.coverArmorApplied) tags.push('ELITE ARMOR');
          if (visibleUnit.isOverwatching) tags.push('SUPPRESS OW');
          return {
            tone: 'red',
            headerLeft: `IN RANGE • P${visibleUnit.owner + 1} ${UNIT_STATS[visibleUnit.type].name.toUpperCase()}`,
            headerRight: `${atkCost} CP`,
            body: `${hpAfter === 0 ? 'LETHAL' : 'HIT'} -${preview.damage} DMG (${visibleUnit.hp} → ${hpAfter} HP)`,
            tags,
          };
        }

        const reason = selectedUnit.completed
          ? 'Already acted this turn — cannot attack anymore'
          : getHoveredEnemyBlocker(
              { mapData, units, weather, gridSize, settings, playerCp, currentPlayer },
              selectedUnit,
              anchorTile,
              visibleTiles,
            ) || 'Target cannot be attacked right now';
        const isOutOfRange = !selectedUnit.completed && reason.startsWith('Out of range');
        const enemyRng = getUnitRange(visibleUnit, mapData, weather, anchorTile);
        return {
          tone: 'amber',
          headerLeft: selectedUnit.completed
            ? 'CANT ATTACK • DONE'
            : isOutOfRange
            ? `OUT OF RANGE • P${visibleUnit.owner + 1} ${UNIT_STATS[visibleUnit.type].name.toUpperCase()}`
            : `BLOCKED • P${visibleUnit.owner + 1} ${UNIT_STATS[visibleUnit.type].name.toUpperCase()}`,
          headerRight: `${visibleUnit.hp}/${getUnitMaxHp(visibleUnit)} HP`,
          body: reason,
          tags: [
            `ENEMY RNG ${enemyRng}`,
            ...(visibleUnit.isOverwatching ? [`OW ${visibleUnit.ammo} AMMO`] : []),
          ],
        };
      }

      // 2. Hovering own selected unit explains Done / Already Moved / Rooted status
      if (anchorTile.id === selectedUnit.tileId) {
        if (selectedUnit.completed) {
          return {
            tone: 'amber',
            headerLeft: `DONE THIS TURN • ${UNIT_STATS[selectedUnit.type].name.toUpperCase()}`,
            headerRight: `${selectedUnit.hp}/${getUnitMaxHp(selectedUnit)} HP`,
            body: 'Already attacked or acted — cannot move or attack anymore',
            tags: [`AMMO ${selectedUnit.ammo}/${selectedUnit.maxAmmo}`],
          };
        }
        if (selectedUnit.isRooted) {
          return {
            tone: 'amber',
            headerLeft: `ROOTED • ${UNIT_STATS[selectedUnit.type].name.toUpperCase()}`,
            headerRight: `${selectedUnit.hp}/${getUnitMaxHp(selectedUnit)} HP`,
            body: 'Trapped in Quicksand — cannot move this turn',
            tags: ['CAN STILL FIRE'],
          };
        }
        if (selectedUnit.hasMoved) {
          return {
            tone: 'amber',
            headerLeft: `ALREADY MOVED • ${UNIT_STATS[selectedUnit.type].name.toUpperCase()}`,
            headerRight: `${selectedUnit.hp}/${getUnitMaxHp(selectedUnit)} HP`,
            body: "Can't move again — Attack, Action, or Overwatch (O)",
            tags: [`AMMO ${selectedUnit.ammo}/${selectedUnit.maxAmmo}`],
          };
        }
      }
    }

    if (isCommanding && selectedUnit) {
      // 3. Valid Siege / Demolish Target
      if (validSiegeTile === anchorTile.id && anchorTile.hp !== undefined) {
        const atkCost = getUnitAttackCost(selectedUnit);
        const dmg = calculateSiegeDamage(selectedUnit, selectedTile);
        const hpAfter = Math.max(0, anchorTile.hp - dmg);
        return {
          tone: 'red',
          headerLeft: `SIEGE P${(anchorTile.owner ?? 0) + 1} HQ`,
          headerRight: `${atkCost} CP`,
          body: `${hpAfter === 0 ? 'DESTROYS HQ!' : 'SIEGE'} -${dmg} DMG (${anchorTile.hp} → ${hpAfter} HP)`,
          tags: selectedUnit.type === 'ASSAULTER' && (selectedUnit.rank ?? 0) >= 3 ? ['ACE PIERCE 100%'] : ['BASE ARMOR -20%'],
        };
      }
      if (validDemolishTile === anchorTile.id && anchorTile.hp !== undefined) {
        const atkCost = getUnitAttackCost(selectedUnit);
        const dmg = calculateDemolishDamage(selectedUnit, selectedTile);
        const hpAfter = Math.max(0, anchorTile.hp - dmg);
        return {
          tone: 'red',
          headerLeft: 'DEMOLISH BARRIER',
          headerRight: `${atkCost} CP`,
          body: `${hpAfter === 0 ? 'DESTROYS!' : 'HIT'} -${dmg} DMG (${anchorTile.hp} → ${hpAfter} HP)`,
          tags: [] as string[],
        };
      }

      // 4. Valid Move Tile
      const moveCost = validMoveCosts.get(anchorTile.id);
      if (moveCost !== undefined) {
        const currentCp = playerCp[currentPlayer] ?? 0;
        const leftCp = currentCp - moveCost;
        const atkCost = getUnitAttackCost(selectedUnit);
        const canStillFire = selectedUnit.ammo > 0 && leftCp >= atkCost;
        const tags: string[] = [];
        const tileWeather = getTileWeather(anchorTile, weather);
        const stepCost = getStepCost(anchorTile, selectedUnit.type, currentPlayer, weather, selectedUnit.rank ?? 0);
        if (anchorTile.zone !== undefined && tileWeather !== 'CLEAR') {
          tags.push(`Z${anchorTile.zone + 1} ${tileWeather}`);
        }
        if (stepCost !== null) {
          tags.push(`STEP ${stepCost} CP`);
        }

        const defPct = anchorTile.type === 'BUILDING' && anchorTile.subType
          ? Math.round(BUILDING_STATS[anchorTile.subType].defense * 100)
          : Math.round((TERRAIN_DEFENSE[anchorTile.type] || 0) * 100);
        if (defPct > 0) tags.push(`+${defPct}% COVER`);
        else if (defPct < 0) tags.push(`${defPct}% EXPOSED`);
        if (anchorTile.type === 'QUICKSAND') tags.push('ROOTS NEXT TURN');
        if (selectedUnit.type === 'SNIPER' && (anchorTile.type === 'MOUNTAIN' || anchorTile.type === 'DUNES' || (anchorTile.type === 'BUILDING' && anchorTile.owner === currentPlayer))) {
          tags.push('FIRING PERCH');
        }

        const ow = getHoverMoveResolution({
          movingUnit: selectedUnit,
          targetTileId: anchorTile.id,
          validMoveCosts,
          validMoveParents,
          mapData,
          units,
          weather,
          gridSize,
          fogOfWar: settings.fogOfWar,
          maxBudget: currentCp,
          visibleTiles: settings.fogOfWar ? visibleTiles : null,
        });
        if (ow.trigger) {
          tags.push(ow.trigger.pinResisted ? `OW -${ow.trigger.damage} (RESIST)` : `OW -${ow.trigger.damage} PINS!`);
        }
        if (activeBanks.some(b => getManhattanDistance(b, anchorTile) <= BANK_STATS.RANGE)) {
          tags.push(`TURRET -${BANK_STATS.DAMAGE}/t`);
        }
        if (enemyBases.some(b => getManhattanDistance(b, anchorTile) <= BASE_STATS.RANGE)) {
          tags.push(`ARTY -${BASE_STATS.MIN_DMG}..${BASE_STATS.MAX_DMG}/t`);
        }
        const threatCount = canStillFire
          ? getPostMoveTargetTiles({
              unit: selectedUnit,
              destTile: anchorTile,
              remainingCp: leftCp,
              mapData,
              units,
              weather,
              gridSize,
              fogOfWar: settings.fogOfWar,
              visibleTiles: settings.fogOfWar ? visibleTiles : null,
            }).length
          : 0;
        if (threatCount > 0) tags.push(`CAN SHOOT ${threatCount} AFTER`);

        return {
          tone: ow.trigger ? 'amber' : 'blue',
          headerLeft: `MOVE → (${anchorTile.x},${anchorTile.y})`,
          headerRight: `${moveCost} CP`,
          body: `${leftCp} CP left${selectedUnit.ammo > 0 ? (canStillFire ? ' • Can shoot after' : ` • Need ${atkCost} CP to shoot`) : ' • 0 Ammo'}`,
          tags,
        };
      }

      // 5. Blocked ground tiles: Already Moved, Rooted, Mountain (non-Sniper), Unowned Building, Sniper Watchtower
      if (!visibleUnit && (!settings.fogOfWar || visibleTiles.has(anchorTile.id))) {
        if (anchorTile.type === 'MOUNTAIN' && selectedUnit.type !== 'SNIPER') {
          return {
            tone: 'slate',
            headerLeft: 'MOUNTAIN • BLOCKED',
            headerRight: 'SNIPER ONLY',
            body: 'Only Snipers climb Mountains — Scouts & Breachers flank around',
            tags: ['BLOCKS GROUND LOS'],
          };
        }
        if (anchorTile.type === 'BUILDING' && anchorTile.owner !== currentPlayer) {
          const bName = anchorTile.subType ? BUILDING_STATS[anchorTile.subType].name.toUpperCase() : 'BUILDING';
          return {
            tone: 'amber',
            headerLeft: `${bName} • FLANK BLOCKED`,
            headerRight: 'UNOWNED',
            body: 'Cannot walk through unowned buildings — capture adjacent via SECURE',
            tags: ['+5€/t IF CAPTURED'],
          };
        }
        if (
          anchorTile.type === 'BUILDING' &&
          anchorTile.owner === currentPlayer &&
          anchorTile.subType === 'WATCHTOWER' &&
          selectedUnit.type !== 'SNIPER'
        ) {
          return {
            tone: 'slate',
            headerLeft: 'WATCHTOWER • SNIPER PERCH',
            headerRight: 'SNIPER ONLY',
            body: 'Watchtowers only seat your Snipers — Scouts & Breachers flank around',
            tags: ['OWNED +5€/t'],
          };
        }
        if (selectedUnit.isRooted && TERRAIN_COSTS[anchorTile.type] < 90 && anchorTile.hazardState !== 'LAVA') {
          return {
            tone: 'amber',
            headerLeft: 'ROOTED • CANT MOVE',
            headerRight: '',
            body: 'Trapped by Quicksand — cannot move this turn',
            tags: [] as string[],
          };
        }
        if (selectedUnit.hasMoved && TERRAIN_COSTS[anchorTile.type] < 90 && anchorTile.hazardState !== 'LAVA') {
          return {
            tone: 'amber',
            headerLeft: 'CANT MOVE • ALREADY MOVED',
            headerRight: '',
            body: 'Already moved this turn — choose Attack, Action, or Overwatch (O)',
            tags: [] as string[],
          };
        }
      }
    }

    // 6. Placement Mode (Build / Supply Drop)
    if (placementMode?.active) {
      const valid = placementMode.validTiles.includes(anchorTile.id);
      if (placementMode.kind === 'DROP') {
        return {
          tone: valid ? 'cyan' : 'slate',
          headerLeft: valid ? 'AIRDROP ZONE' : 'OUTSIDE DROP ZONE',
          headerRight: `€${placementMode.cost}`,
          body: valid ? 'Click to schedule supply pod (lands end of turn)' : 'Pick within 6 of HQ or 2 of ally unit',
          tags: [] as string[],
        };
      }
      if (placementMode.itemKey === 'LAND_MINE') {
        const inHqZone = !valid && isWithinEnemyHqExclusion(anchorTile, currentPlayer, mapData);
        return {
          tone: valid ? 'cyan' : inHqZone ? 'amber' : 'slate',
          headerLeft: valid ? 'PLANT LAND MINE' : inHqZone ? 'RESTRICTED • HQ ZONE' : 'CANNOT PLANT HERE',
          headerRight: valid ? `€${placementMode.cost}` : inHqZone ? `${LAND_MINE_STATS.ENEMY_HQ_EXCLUSION_RADIUS}-TILE HQ RADIUS` : '',
          body: valid
            ? `Hidden to enemies • ${LAND_MINE_STATS.DAMAGE} DMG + stops movement`
            : inHqZone
              ? `Cannot place within ${LAND_MINE_STATS.ENEMY_HQ_EXCLUSION_RADIUS} tiles of an enemy HQ`
              : 'Select any highlighted cyan ground tile',
          tags: [] as string[],
        };
      }
      if (placementMode.itemKey === 'BARRIER') {
        const selectedTiles = placementMode.selectedTiles ?? [];
        const req = placementMode.requiredCount ?? BARRIER_STATS.BUILD_COUNT;
        const isPicked = selectedTiles.includes(anchorTile.id);
        return {
          tone: isPicked ? 'amber' : valid ? 'cyan' : 'slate',
          headerLeft: isPicked
            ? 'SEGMENT PICKED • CLICK TO UNDO'
            : valid
              ? `PLACE BARRIER (${selectedTiles.length + 1}/${req})`
              : 'CANNOT BUILD HERE',
          headerRight: isPicked ? `${selectedTiles.length}/${req}` : valid ? `€${placementMode.cost}` : '',
          body: isPicked
            ? 'Click again to remove, or confirm selected walls in panel'
            : valid
              ? `${BARRIER_STATS.HP} HP waist-high cover • Blocks move & Overwatch`
              : 'Select any highlighted cyan land tile',
          tags: [] as string[],
        };
      }
      return {
        tone: valid ? 'cyan' : 'slate',
        headerLeft: valid ? 'DEPLOY BRIDGE' : 'NEED WATER OR CANYON',
        headerRight: valid ? `€${placementMode.cost}` : '',
        body: valid ? 'Click to build a 1 CP crossing' : 'Pick a highlighted cyan Water or Canyon tile',
        tags: [] as string[],
      };
    }

    // 7. Lightweight Battlefield Inspect Strip (Unit / Landmark / Terrain)
    if (visibleUnit) {
      const atkCost = getUnitAttackCost(visibleUnit);
      const dmg = getUnitBaseDamage(visibleUnit);
      const rng = getUnitRange(visibleUnit, mapData, weather, anchorTile);
      const tags = [`DMG ${dmg}`, `SHOT ${atkCost} CP`, `RNG ${rng}`, `AMMO ${visibleUnit.ammo}/${visibleUnit.maxAmmo}`];
      if (visibleUnit.isOverwatching) tags.push('OVERWATCH');
      if (visibleUnit.completed) tags.push('DONE THIS TURN');
      else if (visibleUnit.hasMoved) tags.push('MOVED');
      return {
        tone: visibleUnit.completed && visibleUnit.owner === currentPlayer ? 'amber' : 'slate',
        headerLeft: `${visibleUnit.completed && visibleUnit.owner === currentPlayer ? 'DONE • ' : ''}P${visibleUnit.owner + 1} ${UNIT_STATS[visibleUnit.type].name.toUpperCase()}`,
        headerRight: `${visibleUnit.hp}/${getUnitMaxHp(visibleUnit)} HP`,
        body: tags.slice(0, 4).join(' • '),
        tags: tags.slice(4),
      };
    }

    const pendingDrop = pendingDrops.find(d => d.tileId === anchorTile.id);
    if (settings.fogOfWar && !visibleTiles.has(anchorTile.id) && !pendingDrop) return null;

    const tags: string[] = [];
    const tileWeather = getTileWeather(anchorTile, weather);
    if (anchorTile.zone !== undefined && tileWeather !== 'CLEAR') {
      tags.push(`Z${anchorTile.zone + 1} ${tileWeather}`);
    }
    const baseStepCost = TERRAIN_COSTS[anchorTile.type] ?? 1;
    if (anchorTile.type === 'MOUNTAIN') {
      tags.push('SNIPER ONLY • 3 CP');
    } else if (anchorTile.type === 'BUILDING') {
      if (anchorTile.owner === null || anchorTile.owner === undefined) {
        tags.push('BLOCKS PASSAGE • SECURE ADJ');
      } else if (anchorTile.subType === 'WATCHTOWER') {
        tags.push('SNIPER ONLY • +4 RNG');
      } else {
        tags.push('BUNKER • GARRISON');
      }
    } else if (baseStepCost < 90) {
      const scoutStep = getStepCost(anchorTile, 'SOLDIER', currentPlayer, weather, 0);
      const heavyStep = getStepCost(anchorTile, 'ASSAULTER', currentPlayer, weather, 0);
      if (scoutStep !== null && heavyStep !== null) {
        tags.push(`STEP ${scoutStep}/${heavyStep} CP`);
      } else {
        tags.push(`BASE ${baseStepCost} CP`);
      }
    } else {
      tags.push('IMPASSABLE');
    }
    const def = Math.round((TERRAIN_DEFENSE[anchorTile.type] || 0) * 100);
    if (def > 0) tags.push(`+${def}% DEF`);
    else if (def < 0) tags.push(`${def}% EXPOSED`);
    const formatLootTag = (item: string) => (item === 'FIRST_AID' ? 'FIRST AID' : item);
    const ownMine = (mines ?? []).find(m => m.tileId === anchorTile.id && m.owner === viewer);
    if (ownMine) tags.push(`ARMED MINE (${LAND_MINE_STATS.DAMAGE} DMG)`);
    if (pendingDrop) tags.push(`INCOMING ${formatLootTag(pendingDrop.item)}`);
    if (anchorTile.loot) tags.push(`LOOT: ${formatLootTag(anchorTile.loot)}`);
    if (anchorTile.hazardState) tags.push(anchorTile.hazardState);

    let title: string = anchorTile.type;
    let rightTag = '';
    if (anchorTile.type === 'BUILDING' && anchorTile.subType) {
      title = BUILDING_STATS[anchorTile.subType].name.toUpperCase();
      rightTag = anchorTile.owner !== undefined && anchorTile.owner !== null ? `P${anchorTile.owner + 1} • +5€/t` : 'NEUTRAL • +5€/t';
    } else if (anchorTile.type === 'BANK') {
      title = 'BANK VAULT';
      rightTag = (anchorTile.hackProgress || 0) >= 100 ? 'LOOTED' : `€${anchorTile.bankGoldReward || 200}`;
    } else if (anchorTile.type === 'BASE') {
      title = `P${(anchorTile.owner ?? 0) + 1} HQ`;
      if (anchorTile.hp !== undefined) rightTag = `${anchorTile.hp}/${anchorTile.maxHp} HP`;
    } else if (anchorTile.type === 'BARRIER') {
      title = 'BARRIER';
      rightTag = `${anchorTile.hp ?? BARRIER_STATS.HP}/${anchorTile.maxHp ?? BARRIER_STATS.HP} HP`;
    }

    return {
      tone: 'slate',
      headerLeft: title,
      headerRight: rightTag,
      body: tags.join(' • '),
      tags: [] as string[],
    };
  }, [
    mapFeedback,
    hoveredTileId,
    anchorTile,
    isAiTurn,
    winner,
    selectedUnitId,
    units,
    mapData,
    gridSize,
    currentPlayer,
    viewer,
    settings,
    visibleTiles,
    validAttackTargets,
    validSiegeTile,
    validDemolishTile,
    validMoveCosts,
    validMoveParents,
    playerCp,
    weather,
    activeBanks,
    enemyBases,
    placementMode,
    pendingDrops,
    mines,
  ]);

  const tonePalette: Record<string, { bg: string; border: string; headBg: string; headInk: string }> = {
    red: { bg: 'rgba(20, 24, 33, 0.94)', border: '#EF4444', headBg: '#DC2626', headInk: '#FFFFFF' },
    blue: { bg: 'rgba(20, 24, 33, 0.94)', border: '#38BDF8', headBg: '#1D4ED8', headInk: '#FFFFFF' },
    amber: { bg: 'rgba(20, 24, 33, 0.94)', border: '#F59E0B', headBg: '#D97706', headInk: '#FFFFFF' },
    cyan: { bg: 'rgba(20, 24, 33, 0.94)', border: '#06B6D4', headBg: '#0891B2', headInk: '#FFFFFF' },
    slate: { bg: 'rgba(20, 24, 33, 0.92)', border: '#64748B', headBg: '#334155', headInk: '#F8FAFC' },
  };

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 25, overflow: 'hidden' }}>
      {pos && cardContent && (
        <div
          style={{
            position: 'absolute',
            left: pos.left,
            top: pos.top,
            transform: pos.placeBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            minWidth: '175px',
            maxWidth: '260px',
            background: (tonePalette[cardContent.tone] ?? tonePalette.slate).bg,
            border: `1.5px solid ${(tonePalette[cardContent.tone] ?? tonePalette.slate).border}`,
            borderRadius: '6px',
            boxShadow: '0 6px 16px rgba(0, 0, 0, 0.36)',
            color: '#F8FAFC',
            fontSize: '11px',
            lineHeight: 1.35,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              background: (tonePalette[cardContent.tone] ?? tonePalette.slate).headBg,
              color: (tonePalette[cardContent.tone] ?? tonePalette.slate).headInk,
              padding: '3px 7px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 900,
              letterSpacing: '0.4px',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cardContent.headerLeft}</span>
            {cardContent.headerRight && <span style={{ fontFamily: 'monospace', flexShrink: 0 }}>{cardContent.headerRight}</span>}
          </div>
          <div style={{ padding: '4px 7px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ fontWeight: 700, color: '#F1F5F9' }}>{cardContent.body}</div>
            {cardContent.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                {cardContent.tags.map((tag, i) => (
                  <span
                    key={i}
                    style={{
                      background: 'rgba(255,255,255,0.12)',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      fontSize: '10px',
                      fontWeight: 800,
                      color: '#FDE68A',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
