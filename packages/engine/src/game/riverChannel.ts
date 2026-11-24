/**
 * River channel sizing.
 *
 * `waterPct` asks for a *share of the board*, so the width of the channel has to come from that
 * demand: a `size`×`size` board wanting `waterPct`% water spread across `rivers` full-length
 * channels needs
 *
 *     width = (size² × waterPct / 100) / (rivers × size) = size × waterPct / (100 × rivers)
 *
 * A four-step lookup (≤8% → 1 tile, ≤16% → 2, …) throws that away twice. It ignores the board size,
 * so 10% was a 2-tile river on every board from 12×12 to 30×30 — 5% of the small one and 2% of the
 * large one. And it puts a cliff at every threshold: 8% and 9% land on opposite sides of one, so a
 * single point on the slider doubled the water on the map.
 *
 * Whole tiles are still the only thing you can paint, so the channel is laid at `fullWidth` tiles
 * with an extra tile on a fraction of its steps; `channelWidthStepper` spreads that fraction evenly
 * along the run, which turns 8% → 9% into a few extra tiles instead of a new river.
 */

export interface RiverChannelPlan {
  /** Average channel width in tiles; may be fractional (1.6, 2.4, …). */
  width: number;
  /** Tiles painted across the channel on every step. */
  fullWidth: number;
  /** Fraction of steps that also get one extra tile, so the run averages `width`. */
  extraShare: number;
  /** Water tiles the knob asks for. */
  requestedTiles: number;
  /** True when even a single-tile channel overshoots the request (small board, many rivers). */
  floored: boolean;
}

/** Widest `waterPct` the knobs allow, mirroring the slider. */
export const MAX_RIVER_PCT = 30;

export const planRiverChannel = (
  size: number,
  riverCount: number,
  waterPct: number,
): RiverChannelPlan => {
  const edge = Math.max(1, Math.round(size));
  const rivers = Math.max(1, Math.round(riverCount));
  const pct = Math.max(0, Math.min(MAX_RIVER_PCT, Number.isFinite(waterPct) ? waterPct : 0));
  const requestedTiles = Math.round((edge * edge * pct) / 100);

  // Every channel runs the full board once, so the width that spends the demand exactly is
  // demand / total channel length.
  const exact = requestedTiles / (rivers * edge);
  const width = Math.max(1, exact);
  const fullWidth = Math.max(1, Math.floor(width));
  const extraShare = Math.max(0, Math.min(1, width - fullWidth));

  return { width, fullWidth, extraShare, requestedTiles, floored: exact < 1 };
};

/**
 * Returns a per-step channel width for one run: `fullWidth` most steps, `fullWidth + 1` often
 * enough that the whole run averages `plan.width`. The extra tiles are spread Bresenham-style, so
 * the widening reads as banks and pools along the river instead of one fat stretch.
 */
export const channelWidthStepper = (plan: RiverChannelPlan): (() => number) => {
  let carry = 0;
  return () => {
    if (plan.extraShare <= 0) return plan.fullWidth;
    carry += plan.extraShare;
    if (carry >= 0.999) {
      carry -= 1;
      return plan.fullWidth + 1;
    }
    return plan.fullWidth;
  };
};
