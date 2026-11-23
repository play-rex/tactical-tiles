import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MapDraftState, MapSuggestion } from '@tactical/engine';
import { applyMapTilePatches, cloneTiles } from '@tactical/engine';
import type { BuildingSubType, TerrainType, Tile, Unit, UnitType } from '@tactical/engine/types';
import { computeTerrainSignature, renderTacticalReconCanvases } from '../../core/graphics/TacticalReconRenderer';
import { GeoButton, GeoCard, GeoChip, GeoWell, PLAYER_UI_THEME, playerDisplayName } from './GeoPrimitives';

export interface PreviewBattlefield {
  mapData: Tile[];
  gridSize: number;
  units: Unit[];
  activeSeed?: string;
}

export interface MapPreviewCardProps {
  game: PreviewBattlefield | null;
  title: string;
  subtitle?: string;
  seedLabel?: string;
  canRandomize?: boolean;
  onRandomize?: () => void;
  canEdit?: boolean;
  isEdited?: boolean;
  onApplyEdits?: (editedTiles: Tile[]) => void;
  onResetEdits?: () => void;
  /** Online guest suggestion capabilities & host controls. */
  canSuggest?: boolean;
  onSendSuggestion?: (suggestedTiles: Tile[]) => void;
  onWithdrawSuggestion?: () => void;
  hasOwnSuggestion?: boolean;
  isLocked?: boolean;
  isHost?: boolean;
  suggestionsEnabled?: boolean;
  onToggleSuggestions?: () => void;
  liveDraft?: MapDraftState | null;
  mySeat?: number;
  onDraftTilesChange?: (draftTiles: Tile[] | null) => void;
  suggestions?: MapSuggestion[];
  onResolveSuggestion?: (seat: number, accept: boolean) => void;
  playerNames?: string[];
  /** Maximum CSS width of the miniature preview square before clicking to enlarge. */
  maxPreviewPx?: number;
}

const UNIT_BADGE_LETTER: Record<UnitType, string> = {
  SOLDIER: 'S',
  ASSAULTER: 'A',
  SNIPER: 'R',
};

type BrushKey =
  | 'PLAINS'
  | 'FOREST'
  | 'MOUNTAIN'
  | 'WATER'
  | 'SAND'
  | 'DUNES'
  | 'QUICKSAND'
  | 'CANYON'
  | 'ROAD'
  | 'ROAD_H'
  | 'BRIDGE'
  | 'BRIDGE_V'
  | 'BANK'
  | 'WATCHTOWER'
  | 'BUNKER'
  | 'BARRIER';

type EditTool = 'MOVE' | 'DELETE' | BrushKey;
type InteractMode = 'VIEW' | 'EDIT' | 'SUGGEST';

const EDIT_BRUSHES: ReadonlyArray<{ key: BrushKey; label: string; icon: string }> = [
  { key: 'PLAINS', label: 'Plains', icon: '▫️' },
  { key: 'FOREST', label: 'Forest', icon: '🌲' },
  { key: 'MOUNTAIN', label: 'Mount', icon: '⛰️' },
  { key: 'WATER', label: 'Water', icon: '🌊' },
  { key: 'SAND', label: 'Sand', icon: '🟨' },
  { key: 'DUNES', label: 'Dunes', icon: '🏜️' },
  { key: 'QUICKSAND', label: 'Quicksand', icon: '🕳️' },
  { key: 'CANYON', label: 'Canyon', icon: '🪨' },
  { key: 'ROAD', label: 'Road V', icon: '↕️' },
  { key: 'ROAD_H', label: 'Road H', icon: '↔️' },
  { key: 'BRIDGE', label: 'Bridge H', icon: '🌉' },
  { key: 'BRIDGE_V', label: 'Bridge V', icon: '🌁' },
  { key: 'BANK', label: 'Bank €', icon: '🏦' },
  { key: 'WATCHTOWER', label: 'Tower', icon: '🗼' },
  { key: 'BUNKER', label: 'Bunker', icon: '🛡️' },
  { key: 'BARRIER', label: 'Barrier', icon: '🚧' },
];

interface MapStats {
  banks: number;
  towers: number;
  bunkers: number;
  trees: number;
  water: number;
  owners: number[];
}

function summarizeMap(mapData: Tile[]): MapStats {
  let banks = 0;
  let towers = 0;
  let bunkers = 0;
  let trees = 0;
  let water = 0;
  const ownerSet = new Set<number>();

  for (const tile of mapData) {
    if (tile.type === 'BANK') banks++;
    else if (tile.type === 'BUILDING' && tile.subType === 'WATCHTOWER') towers++;
    else if (tile.type === 'BUILDING' && tile.subType === 'BUNKER') bunkers++;
    else if (tile.type === 'FOREST') trees++;
    else if (tile.type === 'WATER') water++;
    else if (tile.type === 'BASE' && typeof tile.owner === 'number') ownerSet.add(tile.owner);
  }

  return {
    banks,
    towers,
    bunkers,
    trees,
    water,
    owners: Array.from(ownerSet).sort((a, b) => a - b),
  };
}

function buildEditedTile(oldTile: Tile, brush: BrushKey): Tile {
  let type: TerrainType;
  let height = 1;
  let subType: BuildingSubType | undefined;
  let bankGoldReward: number | undefined;
  let bankCpReward: number | undefined;
  let hackProgress: number | undefined;

  if (brush === 'WATCHTOWER' || brush === 'BUNKER') {
    type = 'BUILDING';
    subType = brush;
  } else if (brush === 'BANK') {
    type = 'BANK';
    bankGoldReward = 200;
    bankCpReward = 10;
    hackProgress = 0;
  } else {
    type = brush;
    if (brush === 'WATER' || brush === 'CANYON') height = 0;
    if (brush === 'MOUNTAIN' || brush === 'DUNES') height = 2;
  }

  return {
    ...oldTile,
    type,
    height,
    subType,
    owner: undefined,
    bankGoldReward,
    bankCpReward,
    hackProgress,
    hp: undefined,
    maxHp: undefined,
  };
}

function swapTileContents(mapData: Tile[], srcIdx: number, dstIdx: number): Tile[] {
  if (srcIdx === dstIdx) return mapData;
  const next = cloneTiles(mapData);
  const a = next[srcIdx];
  const b = next[dstIdx];
  if (!a || !b) return mapData;

  const extractPayload = (t: Tile) => ({
    type: t.type,
    height: t.height,
    subType: t.subType,
    owner: t.owner,
    bankGoldReward: t.bankGoldReward,
    bankCpReward: t.bankCpReward,
    hackProgress: t.hackProgress,
    hp: t.hp,
    maxHp: t.maxHp,
    loot: t.loot,
  });

  const payA = extractPayload(a);
  const payB = extractPayload(b);

  next[srcIdx] = { ...a, ...payB };
  next[dstIdx] = { ...b, ...payA };
  return next;
}

interface BoardHighlightOverlay {
  selectedCoord?: { x: number; y: number } | null;
  hoverCoord?: { x: number; y: number } | null;
  hoverDanger?: boolean;
  changedCoords?: Array<{ x: number; y: number }>;
  changedColor?: string;
  moveArrow?: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
}

function inferMoveArrow(
  patches: Array<{ x: number; y: number; type: TerrainType }>,
  previousMap: Tile[],
  gridSize: number,
): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
  if (patches.length !== 2) return null;
  const [a, b] = patches;
  const prevA = previousMap[a.y * gridSize + a.x];
  const prevB = previousMap[b.y * gridSize + b.x];
  if (!prevA || !prevB) return null;
  if (a.type === 'PLAINS' && prevA.type !== 'PLAINS' && b.type !== 'PLAINS') {
    return { from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } };
  }
  if (b.type === 'PLAINS' && prevB.type !== 'PLAINS' && a.type !== 'PLAINS') {
    return { from: { x: b.x, y: b.y }, to: { x: a.x, y: a.y } };
  }
  return null;
}

function drawAnnotatedBoard(
  targetCanvas: HTMLCanvasElement,
  baseCanvas: HTMLCanvasElement,
  mapData: Tile[],
  gridSize: number,
  units: Unit[],
  detailed: boolean,
  overlay?: BoardHighlightOverlay,
): void {
  const { width, height } = baseCanvas;
  if (targetCanvas.width !== width) targetCanvas.width = width;
  if (targetCanvas.height !== height) targetCanvas.height = height;

  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(baseCanvas, 0, 0);

  const tilePx = width / Math.max(1, gridSize);

  if (detailed) {
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < gridSize; i++) {
      const pos = Math.round(i * tilePx) + 0.5;
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, height);
      ctx.moveTo(0, pos);
      ctx.lineTo(width, pos);
    }
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const tileById = new Map<string, Tile>();
  for (const t of mapData) tileById.set(t.id, t);

  // Starting unit tokens
  for (const unit of units) {
    const tile = tileById.get(unit.tileId);
    if (!tile) continue;
    const cx = (tile.x + 0.5) * tilePx;
    const cy = (tile.y + 0.5) * tilePx;
    const theme = PLAYER_UI_THEME[unit.owner] ?? PLAYER_UI_THEME[0];
    const radius = detailed ? tilePx * 0.27 : tilePx * 0.24;

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx, cy, radius + (detailed ? 2.5 : 2), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = theme.badgeBg;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    if (detailed) {
      ctx.fillStyle = theme.badgeText;
      ctx.font = `900 ${Math.round(tilePx * 0.28)}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(UNIT_BADGE_LETTER[unit.type], cx, cy + 0.5);
    }
  }

  // Bank vaults & Player HQ badges
  for (const tile of mapData) {
    if (tile.type === 'BANK') {
      const cx = (tile.x + 0.5) * tilePx;
      const cy = (tile.y + 0.5) * tilePx;
      const radius = detailed ? tilePx * 0.3 : tilePx * 0.36;

      ctx.fillStyle = '#1C1200';
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1C1200';
      ctx.font = `900 ${Math.round(radius * 1.25)}px system-ui, -apple-system, sans-serif`;
      ctx.fillText('€', cx, cy + 0.5);
    } else if (tile.type === 'BASE' && typeof tile.owner === 'number') {
      const cx = (tile.x + 0.5) * tilePx;
      const cy = (tile.y + 0.5) * tilePx;
      const theme = PLAYER_UI_THEME[tile.owner] ?? PLAYER_UI_THEME[0];
      const boxW = detailed ? tilePx * 0.72 : tilePx * 0.92;
      const boxH = detailed ? tilePx * 0.44 : tilePx * 0.62;
      const rx = cx - boxW / 2;
      const ry = cy - boxH / 2;

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(rx - 2, ry - 2, boxW + 4, boxH + 4, 5);
      ctx.fill();

      ctx.fillStyle = theme.badgeBg;
      ctx.beginPath();
      ctx.roundRect(rx, ry, boxW, boxH, 4);
      ctx.fill();

      ctx.fillStyle = theme.badgeText;
      ctx.font = `900 ${Math.round(boxH * 0.72)}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(`P${tile.owner + 1}`, cx, cy + 0.5);
    }
  }

  // Highlight tiles modified in live draft or currently previewed guest suggestion
  if (overlay?.changedCoords?.length) {
    const strokeColor = overlay.changedColor ?? '#7C3AED';
    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(2.5, tilePx * 0.08);
    ctx.setLineDash([Math.max(4, tilePx * 0.14), Math.max(3, tilePx * 0.09)]);
    for (const c of overlay.changedCoords) {
      ctx.fillStyle = strokeColor === '#0EA5E9' ? 'rgba(14, 165, 233, 0.16)' : 'rgba(124, 58, 237, 0.18)';
      ctx.fillRect(c.x * tilePx + 1, c.y * tilePx + 1, tilePx - 2, tilePx - 2);
      ctx.strokeRect(c.x * tilePx + 2, c.y * tilePx + 2, tilePx - 4, tilePx - 4);
    }
    ctx.restore();
  }

  // Dashed arrow when reviewing a 2-tile asset relocation suggestion
  if (overlay?.moveArrow) {
    const { from, to } = overlay.moveArrow;
    const fx = (from.x + 0.5) * tilePx;
    const fy = (from.y + 0.5) * tilePx;
    const tx = (to.x + 0.5) * tilePx;
    const ty = (to.y + 0.5) * tilePx;
    const angle = Math.atan2(ty - fy, tx - fx);
    const headLen = Math.max(10, tilePx * 0.35);

    ctx.save();
    ctx.strokeStyle = '#6D28D9';
    ctx.fillStyle = '#6D28D9';
    ctx.lineWidth = Math.max(3, tilePx * 0.08);
    ctx.setLineDash([Math.max(6, tilePx * 0.18), Math.max(4, tilePx * 0.12)]);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - headLen * Math.cos(angle - Math.PI / 6), ty - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(tx - headLen * Math.cos(angle + Math.PI / 6), ty - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Interactive hover & Move selection highlights
  if (overlay?.hoverCoord) {
    const { x, y } = overlay.hoverCoord;
    if (overlay.hoverDanger) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
      ctx.fillRect(x * tilePx, y * tilePx, tilePx, tilePx);
      ctx.strokeStyle = '#EF4444';
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    }
    ctx.lineWidth = Math.max(2, tilePx * 0.05);
    ctx.strokeRect(x * tilePx + 2, y * tilePx + 2, tilePx - 4, tilePx - 4);
  }
  if (overlay?.selectedCoord) {
    const { x, y } = overlay.selectedCoord;
    ctx.fillStyle = 'rgba(245, 158, 11, 0.28)';
    ctx.fillRect(x * tilePx, y * tilePx, tilePx, tilePx);
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = Math.max(3, tilePx * 0.08);
    ctx.strokeRect(x * tilePx + 2, y * tilePx + 2, tilePx - 4, tilePx - 4);
  }
}

interface BoardCanvasViewProps {
  baseCanvas: HTMLCanvasElement | null;
  mapData: Tile[];
  gridSize: number;
  units: Unit[];
  detailed: boolean;
  overlay?: BoardHighlightOverlay;
  style?: React.CSSProperties;
  onPointerDown?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
  onPointerLeave?: () => void;
}

const BoardCanvasView = React.forwardRef<HTMLCanvasElement, BoardCanvasViewProps>(
  ({ baseCanvas, mapData, gridSize, units, detailed, overlay, style, ...pointerHandlers }, ref) => {
    const internalRef = useRef<HTMLCanvasElement | null>(null);

    const setRefs = useCallback(
      (el: HTMLCanvasElement | null) => {
        internalRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      },
      [ref],
    );

    useEffect(() => {
      const el = internalRef.current;
      if (!el || !baseCanvas) return;
      drawAnnotatedBoard(el, baseCanvas, mapData, gridSize, units, detailed, overlay);
    }, [baseCanvas, mapData, gridSize, units, detailed, overlay]);

    return <canvas ref={setRefs} style={style} {...pointerHandlers} />;
  },
);

BoardCanvasView.displayName = 'BoardCanvasView';

interface FullMapDialogProps {
  open: boolean;
  initialMode: InteractMode;
  initialReviewSeat: number | null;
  onClose: () => void;
  baseCanvas: HTMLCanvasElement | null;
  game: PreviewBattlefield | null;
  displayMapData: Tile[];
  liveDraft?: MapDraftState | null;
  mySeat?: number;
  stats: MapStats | null;
  title: string;
  subtitle?: string;
  seedLabel?: string;
  canRandomize: boolean;
  onRandomize?: () => void;
  canEdit: boolean;
  isEdited: boolean;
  onApplyEdits?: (editedTiles: Tile[]) => void;
  onResetEdits?: () => void;
  canSuggest: boolean;
  onSendSuggestion?: (suggestedTiles: Tile[]) => void;
  onWithdrawSuggestion?: () => void;
  hasOwnSuggestion: boolean;
  isLocked: boolean;
  isHost: boolean;
  suggestionsEnabled: boolean;
  onToggleSuggestions?: () => void;
  onDraftTilesChange?: (draftTiles: Tile[] | null) => void;
  suggestions: MapSuggestion[];
  onResolveSuggestion?: (seat: number, accept: boolean) => void;
  playerNames?: string[];
}

const FullMapDialog: React.FC<FullMapDialogProps> = ({
  open,
  initialMode,
  initialReviewSeat,
  onClose,
  baseCanvas,
  game,
  displayMapData,
  liveDraft,
  mySeat,
  stats,
  title,
  subtitle,
  seedLabel,
  canRandomize,
  onRandomize,
  canEdit,
  isEdited,
  onApplyEdits,
  onResetEdits,
  canSuggest,
  onSendSuggestion,
  onWithdrawSuggestion,
  hasOwnSuggestion,
  isLocked,
  isHost,
  suggestionsEnabled,
  onToggleSuggestions,
  onDraftTilesChange,
  suggestions,
  onResolveSuggestion,
  playerNames,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const headingId = useId();
  const [nativeScale, setNativeScale] = useState(false);

  const [interactMode, setInteractMode] = useState<InteractMode>('VIEW');
  const [reviewSeat, setReviewSeat] = useState<number | null>(null);
  const [tool, setTool] = useState<EditTool>('MOVE');
  const [draftMap, setDraftMap] = useState<Tile[] | null>(null);
  const [history, setHistory] = useState<Tile[][]>([]);
  const [pendingMove, setPendingMove] = useState<{ x: number; y: number } | null>(null);
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number } | null>(null);
  const [editNote, setEditNote] = useState<string | null>(null);
  const paintingRef = useRef(false);
  const strokeDirtyRef = useRef(false);
  const latestDraftRef = useRef<Tile[] | null>(null);
  const onDraftTilesChangeRef = useRef(onDraftTilesChange);
  onDraftTilesChangeRef.current = onDraftTilesChange;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wasOpenRef = useRef(false);

  const committedSignature = useMemo(
    () => (game ? `${game.activeSeed ?? ''}:${game.gridSize}:${computeTerrainSignature(game.mapData, game.gridSize)}` : ''),
    [game],
  );
  const lastCommittedSigRef = useRef(committedSignature);

  const clearDraftBroadcast = useCallback(() => {
    onDraftTilesChangeRef.current?.(null);
  }, []);

  // Open/close native dialog cleanly ONLY on open transition (never wiping active draft on background re-renders)
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;

    if (open) {
      if (!el.open) el.showModal();
      if (justOpened) {
        const targetMode: InteractMode =
          initialMode === 'EDIT' && canEdit
            ? 'EDIT'
            : initialMode === 'SUGGEST' && canSuggest
              ? 'SUGGEST'
              : 'VIEW';
        setInteractMode(targetMode);
        setReviewSeat(targetMode === 'VIEW' ? initialReviewSeat : null);
        const initialDraft = targetMode !== 'VIEW' && game ? cloneTiles(game.mapData) : null;
        latestDraftRef.current = initialDraft;
        setDraftMap(initialDraft);
        lastCommittedSigRef.current = committedSignature;
        setHistory([]);
        setPendingMove(null);
        setTool('MOVE');
        setEditNote(null);
        if (targetMode === 'EDIT' && initialDraft) {
          onDraftTilesChangeRef.current?.(initialDraft);
        }
      }
    } else if (el.open) {
      el.close();
    }
  }, [open, initialMode, initialReviewSeat, canEdit, canSuggest, game, committedSignature]);

  // Auto-exit Edit or Suggest if host revokes access, locks the player, or disables suggestions live
  useEffect(() => {
    if (interactMode === 'EDIT' && !canEdit) {
      setInteractMode('VIEW');
      latestDraftRef.current = null;
      setDraftMap(null);
      setPendingMove(null);
      clearDraftBroadcast();
    } else if (interactMode === 'SUGGEST' && !canSuggest) {
      setInteractMode('VIEW');
      latestDraftRef.current = null;
      setDraftMap(null);
      setPendingMove(null);
    }
  }, [interactMode, canEdit, canSuggest, clearDraftBroadcast]);

  // Sync local draft ONLY when committed map contents actually change externally (seed roll or accepted edit)
  useEffect(() => {
    if (lastCommittedSigRef.current === committedSignature) return;
    lastCommittedSigRef.current = committedSignature;
    if (!open || interactMode === 'VIEW' || !game) return;
    const synced = cloneTiles(game.mapData);
    latestDraftRef.current = synced;
    setDraftMap(synced);
    setHistory([]);
    setPendingMove(null);
  }, [committedSignature, open, interactMode, game]);

  // Clear stale review selection if suggestion was dismissed/accepted
  useEffect(() => {
    if (reviewSeat !== null && !suggestions.some(s => s.seat === reviewSeat)) {
      setReviewSeat(null);
    }
  }, [suggestions, reviewSeat]);

  // Keep React state aligned with Esc / light-dismiss native closing + Safari closedby fallback
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleClose = () => {
      setInteractMode('VIEW');
      setReviewSeat(null);
      latestDraftRef.current = null;
      setDraftMap(null);
      setPendingMove(null);
      setHoverCoord(null);
      clearDraftBroadcast();
      onCloseRef.current();
    };
    el.addEventListener('close', handleClose);

    if ('closedBy' in HTMLDialogElement.prototype) {
      return () => el.removeEventListener('close', handleClose);
    }

    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      return e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
    };
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = el.open && isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (el.open && pressedOutside && isOutside(e)) el.close();
      pressedOutside = false;
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    return () => {
      el.removeEventListener('close', handleClose);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
    };
  }, [clearDraftBroadcast]);

  const enterMode = (mode: 'EDIT' | 'SUGGEST') => {
    if (!game) return;
    if (mode === 'EDIT' && !canEdit) return;
    if (mode === 'SUGGEST' && !canSuggest) return;
    setReviewSeat(null);
    const initialDraft = cloneTiles(game.mapData);
    latestDraftRef.current = initialDraft;
    lastCommittedSigRef.current = committedSignature;
    setDraftMap(initialDraft);
    setHistory([]);
    setPendingMove(null);
    setTool('MOVE');
    setEditNote(null);
    setInteractMode(mode);
    if (mode === 'EDIT') {
      onDraftTilesChangeRef.current?.(initialDraft);
    }
  };

  const exitModeDiscard = () => {
    if (interactMode === 'EDIT') clearDraftBroadcast();
    setInteractMode('VIEW');
    latestDraftRef.current = null;
    setDraftMap(null);
    setHistory([]);
    setPendingMove(null);
    setHoverCoord(null);
    setEditNote(null);
  };

  const commitModeAction = () => {
    const finalDraft = latestDraftRef.current;
    if (finalDraft && history.length > 0) {
      if (interactMode === 'EDIT') onApplyEdits?.(finalDraft);
      else if (interactMode === 'SUGGEST') onSendSuggestion?.(finalDraft);
    } else if (interactMode === 'EDIT') {
      // No tile edits made, but exiting Edit still releases the active editor lock cleanly.
      clearDraftBroadcast();
    }
    setInteractMode('VIEW');
    latestDraftRef.current = null;
    setDraftMap(null);
    setHistory([]);
    setPendingMove(null);
    setHoverCoord(null);
    setEditNote(null);
  };

  const isInteracting = interactMode !== 'VIEW';
  const gridSize = game?.gridSize ?? 20;
  const activeSuggestion =
    !isInteracting && reviewSeat !== null ? (suggestions.find(s => s.seat === reviewSeat) ?? null) : null;
  const otherLiveDraft = !isInteracting && !activeSuggestion && liveDraft && liveDraft.seat !== mySeat ? liveDraft : null;

  const activeMapData = useMemo(() => {
    if (isInteracting && draftMap) return draftMap;
    if (activeSuggestion && game) return applyMapTilePatches(game.mapData, activeSuggestion.edits);
    return displayMapData;
  }, [isInteracting, draftMap, activeSuggestion, game, displayMapData]);

  const activeBaseCanvas = useMemo(() => {
    if ((!isInteracting && !activeSuggestion) || typeof document === 'undefined' || activeMapData.length === 0) {
      return baseCanvas;
    }
    return renderTacticalReconCanvases(activeMapData, gridSize, 0).terrainCanvas;
  }, [isInteracting, activeSuggestion, activeMapData, gridSize, baseCanvas]);

  const activeStats = useMemo(
    () => (isInteracting || activeSuggestion ? summarizeMap(activeMapData) : stats),
    [isInteracting, activeSuggestion, activeMapData, stats],
  );

  const highlightOverlay: BoardHighlightOverlay | undefined = useMemo(() => {
    if (isInteracting) {
      return { selectedCoord: pendingMove, hoverCoord, hoverDanger: tool === 'DELETE' };
    }
    if (activeSuggestion && game) {
      return {
        changedCoords: activeSuggestion.edits,
        changedColor: '#7C3AED',
        moveArrow: inferMoveArrow(activeSuggestion.edits, game.mapData, gridSize),
      };
    }
    if (otherLiveDraft && otherLiveDraft.edits.length > 0) {
      return {
        changedCoords: otherLiveDraft.edits,
        changedColor: '#0EA5E9',
      };
    }
    return undefined;
  }, [isInteracting, pendingMove, hoverCoord, activeSuggestion, game, gridSize, otherLiveDraft]);

  const coordFromPointer = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const el = canvasElRef.current;
    if (!el || !game) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * gridSize);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * gridSize);
    if (x < 0 || x >= gridSize || y < 0 || y >= gridSize) return null;
    return { x, y };
  };

  const paintAt = (x: number, y: number, activeTool: BrushKey | 'DELETE') => {
    const prev = latestDraftRef.current;
    if (!prev) return;
    const idx = y * gridSize + x;
    const oldTile = prev[idx];
    if (!oldTile) return;
    if (oldTile.type === 'BASE') {
      setEditNote(
        activeTool === 'DELETE'
          ? 'Player HQs cannot be deleted — use ⇄ Move to relocate them.'
          : 'Player HQs cannot be painted over — use ⇄ Move to relocate them.',
      );
      return;
    }
    const targetBrush: BrushKey = activeTool === 'DELETE' ? 'PLAINS' : activeTool;
    const replacement = buildEditedTile(oldTile, targetBrush);
    if (
      replacement.type === oldTile.type &&
      replacement.height === oldTile.height &&
      replacement.subType === oldTile.subType
    ) {
      return;
    }
    if (!strokeDirtyRef.current) {
      strokeDirtyRef.current = true;
      setHistory(h => [...h, prev]);
    }
    setEditNote(null);
    const next = [...prev];
    next[idx] = replacement;
    latestDraftRef.current = next;
    setDraftMap(next);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const curDraft = latestDraftRef.current;
    if (!isInteracting || !curDraft) return;
    const coord = coordFromPointer(e);
    if (!coord) return;

    if (tool === 'MOVE') {
      if (!pendingMove) {
        setPendingMove(coord);
        setEditNote(null);
        return;
      }
      if (pendingMove.x === coord.x && pendingMove.y === coord.y) {
        setPendingMove(null);
        return;
      }
      const srcIdx = pendingMove.y * gridSize + pendingMove.x;
      const dstIdx = coord.y * gridSize + coord.x;
      setHistory(h => [...h, curDraft]);
      const swapped = swapTileContents(curDraft, srcIdx, dstIdx);
      latestDraftRef.current = swapped;
      setDraftMap(swapped);
      setPendingMove(null);
      setEditNote(null);
      if (interactMode === 'EDIT') onDraftTilesChangeRef.current?.(swapped);
      return;
    }

    paintingRef.current = true;
    strokeDirtyRef.current = false;
    paintAt(coord.x, coord.y, tool);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isInteracting) return;
    const coord = coordFromPointer(e);
    setHoverCoord(prev => (prev?.x === coord?.x && prev?.y === coord?.y ? prev : coord));
    if (paintingRef.current && tool !== 'MOVE' && coord) {
      paintAt(coord.x, coord.y, tool);
    }
  };

  const handleCanvasPointerUp = () => {
    const wasDirty = strokeDirtyRef.current;
    paintingRef.current = false;
    strokeDirtyRef.current = false;
    if (wasDirty && interactMode === 'EDIT' && latestDraftRef.current) {
      onDraftTilesChangeRef.current?.(latestDraftRef.current);
    }
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    latestDraftRef.current = prev;
    setDraftMap(prev);
    setPendingMove(null);
    setEditNote(null);
    if (interactMode === 'EDIT') onDraftTilesChangeRef.current?.(prev);
  };

  const handleResetInsideEdit = () => {
    setPendingMove(null);
    setEditNote(null);
    setHistory([]);
    if (interactMode === 'EDIT' && isEdited && onResetEdits) {
      clearDraftBroadcast();
      onResetEdits();
    } else if (game) {
      const fresh = cloneTiles(game.mapData);
      latestDraftRef.current = fresh;
      setDraftMap(fresh);
      if (interactMode === 'EDIT') clearDraftBroadcast();
    }
  };

  const nativePx = activeBaseCanvas?.width ?? gridSize * 64;
  const hasDraftEdits = history.length > 0;
  const selectedTileLabel = pendingMove ? draftMap?.[pendingMove.y * gridSize + pendingMove.x] : null;

  return (
    <dialog
      ref={dialogRef}
      className="tt-map-dialog"
      aria-labelledby={headingId}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div style={{ width: 'min(94vw, 900px)', maxHeight: '92dvh', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <GeoCard hug>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '180px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <h1
                    id={headingId}
                    style={{ margin: 0, fontSize: '16px', fontWeight: 900, color: 'var(--op-ink)', letterSpacing: '0.4px' }}
                  >
                    {title}
                  </h1>
                  {(isEdited || (interactMode === 'EDIT' && hasDraftEdits)) && (
                    <GeoChip variant="softAmber" style={{ fontSize: '10px', padding: '1px 6px' }}>
                      ✏️ EDITED
                    </GeoChip>
                  )}
                  {otherLiveDraft && (
                    <GeoChip variant="softMint" style={{ fontSize: '10px', padding: '1px 7px' }}>
                      ● {otherLiveDraft.name} EDITING LIVE…
                    </GeoChip>
                  )}
                  {isLocked && !isHost && (
                    <GeoChip variant="softRed" style={{ fontSize: '10px', padding: '1px 6px' }}>
                      🔒 LOCKED
                    </GeoChip>
                  )}
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--op-ink-muted)' }}>
                  {subtitle ?? `${gridSize}×${gridSize} Tactical Sector`}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {seedLabel && (
                  <GeoChip variant="softBlue" style={{ fontSize: '11px', padding: '3px 8px' }}>
                    SEED: {seedLabel}
                  </GeoChip>
                )}
                <GeoButton
                  onClick={() => setNativeScale(s => !s)}
                  variant={nativeScale ? 'amber' : 'default'}
                  coreStyle={{ padding: '5px 10px', fontSize: '11px' }}
                  title={nativeScale ? 'Fit entire board to window' : 'Inspect at native 64px/tile game pixel size'}
                >
                  {nativeScale ? 'FIT BOARD' : '1:1 SCALE'}
                </GeoButton>
                {isHost && onToggleSuggestions && !isInteracting && (
                  <GeoButton
                    onClick={onToggleSuggestions}
                    variant={suggestionsEnabled ? 'softMint' : 'default'}
                    coreStyle={{ padding: '5px 9px', fontSize: '11px' }}
                    title="Turn guest map suggestions ON or OFF"
                  >
                    💡 {suggestionsEnabled ? 'SUGGEST ON' : 'SUGGEST OFF'}
                  </GeoButton>
                )}
                {canEdit && interactMode !== 'SUGGEST' && (
                  <GeoButton
                    onClick={interactMode === 'EDIT' ? exitModeDiscard : () => enterMode('EDIT')}
                    variant={interactMode === 'EDIT' ? 'softAmber' : 'default'}
                    coreStyle={{ padding: '5px 10px', fontSize: '11px' }}
                  >
                    {interactMode === 'EDIT' ? 'VIEW ONLY' : '✏️ EDIT'}
                  </GeoButton>
                )}
                {!canEdit && canSuggest && interactMode !== 'EDIT' && (
                  <GeoButton
                    onClick={interactMode === 'SUGGEST' ? exitModeDiscard : () => enterMode('SUGGEST')}
                    variant={interactMode === 'SUGGEST' ? 'softViolet' : 'violet'}
                    coreStyle={{ padding: '5px 10px', fontSize: '11px' }}
                  >
                    {interactMode === 'SUGGEST' ? 'VIEW ONLY' : '💡 SUGGEST'}
                  </GeoButton>
                )}
                {!isInteracting && canRandomize && onRandomize && (
                  <GeoButton
                    onClick={onRandomize}
                    variant="blue"
                    coreStyle={{ padding: '5px 12px', fontSize: '12px' }}
                    title="Generate a different random battlefield layout"
                  >
                    🎲 RANDOMIZE
                  </GeoButton>
                )}
                <GeoButton onClick={onClose} coreStyle={{ padding: '5px 10px' }} aria-label="Close map preview">
                  ✕
                </GeoButton>
              </div>
            </div>

            {/* Guest Suggestion Queue / Active Review Banner */}
            {!isInteracting && suggestions.length > 0 && (
              <GeoWell coreStyle={{ padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', fontWeight: 900, color: 'var(--acc-violet-ink)' }}>
                    💡 MAP SUGGESTIONS ({suggestions.length}):
                  </span>
                  {suggestions.map(s => (
                    <GeoButton
                      key={s.seat}
                      variant={reviewSeat === s.seat ? 'violet' : 'softViolet'}
                      onClick={() => setReviewSeat(cur => (cur === s.seat ? null : s.seat))}
                      coreStyle={{ padding: '3px 8px', fontSize: '11px' }}
                    >
                      P{s.seat + 1} · {s.name} ({s.edits.length})
                    </GeoButton>
                  ))}
                  {hasOwnSuggestion && onWithdrawSuggestion && (
                    <GeoButton
                      variant="softRed"
                      onClick={onWithdrawSuggestion}
                      coreStyle={{ padding: '3px 8px', fontSize: '11px', marginLeft: 'auto' }}
                    >
                      WITHDRAW MINE
                    </GeoButton>
                  )}
                </div>

                {activeSuggestion && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', paddingTop: '2px', borderTop: '1px solid var(--op-line)' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--op-ink)' }}>
                      Previewing {activeSuggestion.name}&apos;s suggestion ({activeSuggestion.edits.length} tile{activeSuggestion.edits.length === 1 ? '' : 's'} highlighted on map)
                    </span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {isHost && onResolveSuggestion && (
                        <>
                          <GeoButton
                            variant="mint"
                            onClick={() => onResolveSuggestion(activeSuggestion.seat, true)}
                            coreStyle={{ padding: '4px 10px', fontSize: '11px' }}
                          >
                            ✓ ACCEPT
                          </GeoButton>
                          <GeoButton
                            variant="softRed"
                            onClick={() => onResolveSuggestion(activeSuggestion.seat, false)}
                            coreStyle={{ padding: '4px 10px', fontSize: '11px' }}
                          >
                            ✕ DISMISS
                          </GeoButton>
                        </>
                      )}
                      <GeoButton
                        onClick={() => setReviewSeat(null)}
                        coreStyle={{ padding: '4px 9px', fontSize: '11px' }}
                      >
                        HIDE OVERLAY
                      </GeoButton>
                    </div>
                  </div>
                )}
              </GeoWell>
            )}

            {/* Minimal Quick Edit / Suggest Toolbar */}
            {isInteracting && (
              <GeoWell coreStyle={{ padding: '7px 9px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                  <GeoButton
                    variant={tool === 'MOVE' ? 'blue' : 'default'}
                    onClick={() => {
                      setTool('MOVE');
                      setPendingMove(null);
                      setEditNote(null);
                    }}
                    coreStyle={{ padding: '4px 9px', fontSize: '11px' }}
                    title="Click a tile, then click destination to move/swap terrain, banks, buildings, or HQs"
                  >
                    ⇄ MOVE
                  </GeoButton>
                  <GeoButton
                    variant={tool === 'DELETE' ? 'red' : 'softRed'}
                    onClick={() => {
                      setTool('DELETE');
                      setPendingMove(null);
                      setEditNote(null);
                    }}
                    coreStyle={{ padding: '4px 9px', fontSize: '11px' }}
                    title="Click or drag to delete an asset or terrain back to Plains"
                  >
                    🗑️ DELETE
                  </GeoButton>

                  <span style={{ width: '1px', height: '18px', background: 'var(--op-line)', margin: '0 2px' }} />

                  {EDIT_BRUSHES.map(b => (
                    <GeoButton
                      key={b.key}
                      variant={tool === b.key ? 'blue' : 'default'}
                      onClick={() => {
                        setTool(b.key);
                        setPendingMove(null);
                        setEditNote(null);
                      }}
                      coreStyle={{ padding: '4px 7px', fontSize: '11px' }}
                    >
                      {b.icon} {b.label}
                    </GeoButton>
                  ))}

                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
                    <GeoButton
                      disabled={!hasDraftEdits}
                      onClick={handleUndo}
                      coreStyle={{ padding: '4px 8px', fontSize: '11px' }}
                      title="Undo last change"
                    >
                      ↩ UNDO
                    </GeoButton>
                    {((interactMode === 'EDIT' && (isEdited || hasDraftEdits)) || (interactMode === 'SUGGEST' && hasDraftEdits)) && (
                      <GeoButton
                        variant="softRed"
                        onClick={handleResetInsideEdit}
                        coreStyle={{ padding: '4px 8px', fontSize: '11px' }}
                        title="Reset changes"
                      >
                        ⟲ RESET
                      </GeoButton>
                    )}
                  </div>
                </div>

                <div style={{ fontSize: '11px', fontWeight: 700, color: editNote ? 'var(--acc-amber-ink)' : 'var(--op-ink-muted)' }}>
                  {editNote
                    ? editNote
                    : tool === 'MOVE'
                      ? pendingMove
                        ? `Moving ${selectedTileLabel?.subType ?? selectedTileLabel?.type ?? 'tile'} from (${pendingMove.x}, ${pendingMove.y}) — click destination tile to swap.`
                        : `${interactMode === 'SUGGEST' ? 'SUGGESTION · ' : ''}Click any tile or HQ to pick it up, then click where to move it.`
                      : tool === 'DELETE'
                        ? `${interactMode === 'SUGGEST' ? 'SUGGESTION · ' : ''}Click or drag on any asset or terrain to erase it back to Plains.`
                        : `${interactMode === 'SUGGEST' ? 'SUGGESTION · ' : ''}Click or drag on the map to place ${EDIT_BRUSHES.find(b => b.key === tool)?.label ?? tool}.`}
                </div>
              </GeoWell>
            )}

            {/* Full-Scale / Fitted Game Map Viewport */}
            {game && activeBaseCanvas && (
              <div
                className="opgeo-scroll"
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  display: 'flex',
                  justifyContent: nativeScale ? 'flex-start' : 'center',
                  alignItems: nativeScale ? 'flex-start' : 'center',
                  background: '#1E2736',
                  border: '2px solid var(--op-line)',
                  borderRadius: '6px',
                  padding: '6px',
                }}
              >
                <BoardCanvasView
                  ref={canvasElRef}
                  baseCanvas={activeBaseCanvas}
                  mapData={activeMapData}
                  gridSize={gridSize}
                  units={isInteracting || activeSuggestion || Boolean(otherLiveDraft?.edits.length) ? [] : game.units}
                  detailed
                  overlay={highlightOverlay}
                  onPointerDown={handleCanvasPointerDown}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerUp={handleCanvasPointerUp}
                  onPointerCancel={handleCanvasPointerUp}
                  onPointerLeave={() => {
                    handleCanvasPointerUp();
                    setHoverCoord(null);
                  }}
                  style={{
                    ...(nativeScale
                      ? { width: `${nativePx}px`, height: `${nativePx}px`, display: 'block', borderRadius: '4px', flexShrink: 0 }
                      : {
                          width: `min(${isInteracting ? '56dvh' : suggestions.length > 0 ? '60dvh' : '66dvh'}, 84vw, 720px)`,
                          height: `min(${isInteracting ? '56dvh' : suggestions.length > 0 ? '60dvh' : '66dvh'}, 84vw, 720px)`,
                          aspectRatio: '1 / 1',
                          display: 'block',
                          borderRadius: '4px',
                        }),
                    cursor: isInteracting ? (tool === 'MOVE' ? (pendingMove ? 'grabbing' : 'grab') : 'crosshair') : 'default',
                    touchAction: isInteracting && !nativeScale ? 'none' : 'auto',
                  }}
                />
              </div>
            )}

            {/* Intel strip & Player HQ Legend */}
            {activeStats && game && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  {activeStats.owners.map(pid => {
                    const theme = PLAYER_UI_THEME[pid] ?? PLAYER_UI_THEME[0];
                    return (
                      <span
                        key={pid}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          fontSize: '11px',
                          fontWeight: 800,
                          color: 'var(--op-ink)',
                          background: '#EEF2F7',
                          border: '1px solid var(--op-line)',
                          borderRadius: '4px',
                          padding: '2px 7px',
                        }}
                      >
                        <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: theme.badgeBg }} />
                        P{pid + 1} · {playerDisplayName(pid, playerNames)}
                      </span>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11px', fontWeight: 800, color: 'var(--op-ink-muted)' }}>
                  <GeoChip variant="softAmber" style={{ padding: '2px 7px', fontSize: '11px' }}>
                    € {activeStats.banks} {activeStats.banks === 1 ? 'BANK' : 'BANKS'}
                  </GeoChip>
                  {activeStats.towers > 0 && (
                    <GeoChip variant="softBlue" style={{ padding: '2px 7px', fontSize: '11px' }}>
                      🗼 {activeStats.towers} TOWER{activeStats.towers === 1 ? '' : 'S'}
                    </GeoChip>
                  )}
                  {activeStats.bunkers > 0 && (
                    <GeoChip variant="default" style={{ padding: '2px 7px', fontSize: '11px' }}>
                      🛡 {activeStats.bunkers} BUNKER{activeStats.bunkers === 1 ? '' : 'S'}
                    </GeoChip>
                  )}
                  <span>
                    {interactMode === 'EDIT'
                      ? 'OTHERS SEE DRAFT LIVE · SPAWNS UPDATE ON APPLY'
                      : interactMode === 'SUGGEST'
                        ? 'HOST REVIEWS SUGGESTED TILES'
                        : 'S/A/R = STARTING SQUAD'}
                  </span>
                </div>
              </div>
            )}

            {isInteracting ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <GeoButton onClick={exitModeDiscard} coreStyle={{ padding: '8px 16px' }}>
                  CANCEL
                </GeoButton>
                <GeoButton
                  variant={interactMode === 'SUGGEST' ? 'violet' : 'mint'}
                  fullWidth
                  disabled={interactMode === 'SUGGEST' && !hasDraftEdits}
                  onClick={commitModeAction}
                  coreStyle={{ padding: '8px' }}
                >
                  {interactMode === 'SUGGEST'
                    ? hasDraftEdits
                      ? '📤 SEND SUGGESTION TO HOST'
                      : 'MAKE A CHANGE TO SUGGEST'
                    : hasDraftEdits
                      ? '✓ APPLY MAP CHANGES'
                      : 'DONE EDITING'}
                </GeoButton>
              </div>
            ) : (
              <GeoButton variant="mint" fullWidth onClick={onClose} coreStyle={{ padding: '8px' }}>
                DONE PREVIEWING
              </GeoButton>
            )}
          </div>
        </GeoCard>
      </div>
    </dialog>
  );
};

/**
 * Compact setup preview card with clickable miniature canvas, live host draft preview,
 * guest map suggestions, minimal edit/suggest modes, and full game-scale inspection dialog.
 */
export const MapPreviewCard: React.FC<MapPreviewCardProps> = ({
  game,
  title,
  subtitle,
  seedLabel,
  canRandomize = false,
  onRandomize,
  canEdit = false,
  isEdited = false,
  onApplyEdits,
  onResetEdits,
  canSuggest = false,
  onSendSuggestion,
  onWithdrawSuggestion,
  hasOwnSuggestion = false,
  isLocked = false,
  isHost = false,
  suggestionsEnabled = true,
  onToggleSuggestions,
  liveDraft = null,
  mySeat,
  onDraftTilesChange,
  suggestions = [],
  onResolveSuggestion,
  playerNames,
  maxPreviewPx = 220,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [initialMode, setInitialMode] = useState<InteractMode>('VIEW');
  const [initialReviewSeat, setInitialReviewSeat] = useState<number | null>(null);

  // Live preview triggers whenever another seat is actively editing (even before placing their first tile)
  const someoneElseEditing = Boolean(liveDraft && liveDraft.seat !== mySeat);
  const showingOtherDraftTiles = Boolean(someoneElseEditing && liveDraft && liveDraft.edits.length > 0);
  const displayMapData = useMemo(() => {
    if (!game) return [];
    if (showingOtherDraftTiles && liveDraft) {
      return applyMapTilePatches(game.mapData, liveDraft.edits);
    }
    return game.mapData;
  }, [game, showingOtherDraftTiles, liveDraft]);

  const gridSize = game?.gridSize ?? 20;
  const baseCanvas = useMemo(() => {
    if (!game || displayMapData.length === 0 || typeof document === 'undefined') return null;
    return renderTacticalReconCanvases(displayMapData, gridSize, 0).terrainCanvas;
  }, [game, displayMapData, gridSize]);

  const stats = useMemo(
    () => (displayMapData.length > 0 ? summarizeMap(displayMapData) : null),
    [displayMapData],
  );

  if (!game || !stats) return null;

  const openModal = (mode: InteractMode, reviewSeat: number | null = null) => {
    setInitialMode(mode);
    setInitialReviewSeat(reviewSeat);
    setModalOpen(true);
  };

  return (
    <>
      <GeoWell coreStyle={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
            <span style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.5px' }}>
              LIVE MAP PREVIEW
            </span>
            {seedLabel && (
              <GeoChip variant="softBlue" style={{ fontSize: '11px', padding: '1px 7px' }}>
                {seedLabel}
              </GeoChip>
            )}
            {isEdited && (
              <GeoChip variant="softAmber" style={{ fontSize: '10px', padding: '1px 6px' }}>
                EDITED
              </GeoChip>
            )}
            {someoneElseEditing && liveDraft && (
              <GeoChip variant="softMint" style={{ fontSize: '10px', padding: '1px 6px' }}>
                ● {liveDraft.name} EDITING
              </GeoChip>
            )}
          </div>
          <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--op-ink-muted)' }}>
            {game.gridSize}×{game.gridSize} · {stats.owners.length} HQ · {stats.banks} €
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="tt-preview-thumb-btn"
            onClick={() => openModal('VIEW', suggestions[0]?.seat ?? null)}
            aria-label={`Open full size preview of ${title}`}
            style={{ width: `min(100%, ${maxPreviewPx}px)`, aspectRatio: '1 / 1', flexShrink: 0 }}
          >
            <BoardCanvasView
              baseCanvas={baseCanvas}
              mapData={displayMapData}
              gridSize={game.gridSize}
              units={showingOtherDraftTiles ? [] : game.units}
              detailed={false}
              overlay={
                showingOtherDraftTiles && liveDraft
                  ? { changedCoords: liveDraft.edits, changedColor: '#0EA5E9' }
                  : undefined
              }
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
            <span
              style={{
                position: 'absolute',
                right: '6px',
                bottom: '6px',
                padding: '2px 7px',
                borderRadius: '4px',
                background: 'rgba(15, 23, 42, 0.82)',
                color: '#FFFFFF',
                fontSize: '10px',
                fontWeight: 900,
                letterSpacing: '0.4px',
                pointerEvents: 'none',
              }}
            >
              🔍 ENLARGE
            </span>
          </button>

          <div style={{ flex: 1, minWidth: '150px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 900, color: 'var(--op-ink)' }}>{title}</div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--op-ink-muted)', marginTop: '2px', lineHeight: 1.35 }}>
                {someoneElseEditing && liveDraft
                  ? `${liveDraft.name} is editing the map right now — you can suggest changes until they click Apply / Done.`
                  : isLocked && !isHost
                    ? 'Locked to view-only by host — click preview to inspect full size.'
                    : `Click the mini map to inspect full size${canEdit ? ' or edit terrain & assets.' : canSuggest ? ' or suggest changes.' : '.'}`}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <GeoButton
                variant="softBlue"
                onClick={() => openModal('VIEW')}
                coreStyle={{ padding: '6px 9px', fontSize: '11px' }}
              >
                🔍 FULL VIEW
              </GeoButton>
              {canEdit && (
                <GeoButton
                  variant="default"
                  onClick={() => openModal('EDIT')}
                  coreStyle={{ padding: '6px 9px', fontSize: '11px' }}
                >
                  ✏️ EDIT
                </GeoButton>
              )}
              {!canEdit && canSuggest && (
                <GeoButton
                  variant="violet"
                  onClick={() => openModal('SUGGEST')}
                  coreStyle={{ padding: '6px 9px', fontSize: '11px' }}
                >
                  💡 {hasOwnSuggestion ? 'EDIT SUGGEST' : 'SUGGEST'}
                </GeoButton>
              )}
              {canRandomize && onRandomize && (
                <GeoButton
                  variant="amber"
                  onClick={onRandomize}
                  coreStyle={{ padding: '6px 9px', fontSize: '11px' }}
                >
                  🎲 RANDOMIZE
                </GeoButton>
              )}
              {isEdited && canEdit && onResetEdits && (
                <GeoButton
                  variant="softRed"
                  onClick={onResetEdits}
                  coreStyle={{ padding: '6px 9px', fontSize: '11px' }}
                >
                  ⟲ RESET
                </GeoButton>
              )}
            </div>

            {(suggestions.length > 0 || (isHost && onToggleSuggestions) || hasOwnSuggestion) && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                {suggestions.length > 0 && (
                  <GeoButton
                    variant="softViolet"
                    onClick={() => openModal('VIEW', suggestions[0].seat)}
                    coreStyle={{ padding: '4px 8px', fontSize: '11px' }}
                  >
                    💡 {suggestions.length} SUGGESTION{suggestions.length > 1 ? 'S' : ''}
                  </GeoButton>
                )}
                {hasOwnSuggestion && onWithdrawSuggestion && (
                  <GeoButton
                    variant="softRed"
                    onClick={onWithdrawSuggestion}
                    coreStyle={{ padding: '4px 8px', fontSize: '11px' }}
                  >
                    ✕ WITHDRAW
                  </GeoButton>
                )}
                {isHost && onToggleSuggestions && (
                  <GeoButton
                    variant={suggestionsEnabled ? 'softMint' : 'default'}
                    onClick={onToggleSuggestions}
                    coreStyle={{ padding: '4px 8px', fontSize: '11px' }}
                    title="Allow or block guest map suggestions"
                  >
                    💡 SUGGEST: {suggestionsEnabled ? 'ON' : 'OFF'}
                  </GeoButton>
                )}
              </div>
            )}
          </div>
        </div>
      </GeoWell>

      <FullMapDialog
        open={modalOpen}
        initialMode={initialMode}
        initialReviewSeat={initialReviewSeat}
        onClose={() => setModalOpen(false)}
        baseCanvas={baseCanvas}
        game={game}
        displayMapData={displayMapData}
        liveDraft={liveDraft}
        mySeat={mySeat}
        stats={stats}
        title={title}
        subtitle={subtitle}
        seedLabel={seedLabel}
        canRandomize={canRandomize}
        onRandomize={onRandomize}
        canEdit={canEdit}
        isEdited={isEdited}
        onApplyEdits={onApplyEdits}
        onResetEdits={onResetEdits}
        canSuggest={canSuggest}
        onSendSuggestion={onSendSuggestion}
        onWithdrawSuggestion={onWithdrawSuggestion}
        hasOwnSuggestion={hasOwnSuggestion}
        isLocked={isLocked}
        isHost={isHost}
        suggestionsEnabled={suggestionsEnabled}
        onToggleSuggestions={onToggleSuggestions}
        onDraftTilesChange={onDraftTilesChange}
        suggestions={suggestions}
        onResolveSuggestion={onResolveSuggestion}
        playerNames={playerNames}
      />
    </>
  );
};
