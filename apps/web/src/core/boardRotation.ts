export type BoardRotation = 0 | 90 | 180 | 270;

const STORAGE_KEY = 'tactical_tiles_map_rotation';

const VALID_ROTATIONS = new Set<number>([0, 90, 180, 270]);

/** Cycles the local camera angle in 90-degree increments. */
export const nextBoardRotation = (rotation: BoardRotation, delta: 90 | -90 = 90): BoardRotation =>
  (((rotation + delta) % 360 + 360) % 360) as BoardRotation;

/** Maps a logical tile `(x, y)` in `[0, gridSize)` to its rotated screen-grid coordinate. */
export const rotateTileCoord = (
  x: number,
  y: number,
  rotation: BoardRotation,
  gridSize: number,
): { x: number; y: number } => {
  switch (rotation) {
    case 90:
      return { x: gridSize - 1 - y, y: x };
    case 180:
      return { x: gridSize - 1 - x, y: gridSize - 1 - y };
    case 270:
      return { x: y, y: gridSize - 1 - x };
    default:
      return { x, y };
  }
};

/**
 * Maps an unrotated board pixel point `(wx, wy)` inside `[0, boardSize]` into the rotated
 * board coordinate system matching `<Container pivot={[boardSize/2, boardSize/2]} angle={rotation}>`.
 */
export const rotateBoardPoint = (
  wx: number,
  wy: number,
  rotation: BoardRotation,
  boardSize: number,
): { x: number; y: number } => {
  switch (rotation) {
    case 90:
      return { x: boardSize - wy, y: wx };
    case 180:
      return { x: boardSize - wx, y: boardSize - wy };
    case 270:
      return { x: wy, y: boardSize - wx };
    default:
      return { x: wx, y: wy };
  }
};

/** Inverse of `rotateBoardPoint`: maps rotated viewport coordinates back to unrotated map coords. */
export const unrotateBoardPoint = (
  vx: number,
  vy: number,
  rotation: BoardRotation,
  boardSize: number,
): { x: number; y: number } => {
  switch (rotation) {
    case 90:
      return { x: vy, y: boardSize - vx };
    case 180:
      return { x: boardSize - vx, y: boardSize - vy };
    case 270:
      return { x: boardSize - vy, y: vx };
    default:
      return { x: vx, y: vy };
  }
};

export const readSavedBoardRotation = (): BoardRotation => {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? Number(raw) : 0;
    return VALID_ROTATIONS.has(parsed) ? (parsed as BoardRotation) : 0;
  } catch {
    return 0;
  }
};

export const saveBoardRotation = (rotation: BoardRotation): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, String(rotation));
    }
  } catch {
    // Ignore storage quota or private browsing errors
  }
};
