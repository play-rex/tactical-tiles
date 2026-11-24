/**
 * Broadcast-composited Play-of-the-Match clip exporter (`clipExporter`).
 *
 * Hooks PixiJS's post-render ticker (`UPDATE_PRIORITY.UTILITY`) to copy the live WebGL frame
 * into a 2D broadcast canvas—zero `preserveDrawingBuffer` GPU tax during normal play—paints
 * synchronized letterbox bars, headline, Tactical Receipt, and killer/victim cards on top,
 * taps `SoundFX`'s live audio stream, and downloads a `.webm` video (with automatic `.png`
 * peak-frame Share Card fallback when `MediaRecorder` WebM isn't supported).
 */
import { getLivePixiApp } from './livePixiRef';
import { PLAYER_UI_THEME } from '../../components/ui/GeoPrimitives';
import { SoundFX } from '../audio/SoundFX';
import { fxTimeline } from './fxTimeline';
import { buildReceiptSteps, resolveKillCamNarrative, type KillCamFrame } from './killCam';

/** Matches `PIXI.UPDATE_PRIORITY.UTILITY` (-50) so capture copies right after WebGL render. */
const TICKER_UTILITY_PRIORITY = -50;

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
};

const downloadDataUrl = (dataUrl: string, filename: string) => {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 500);
};

/** Paints the broadcast kill-cam HUD directly onto the 2D export canvas in sync with `frame`. */
function paintBroadcastHud(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: KillCamFrame,
  seed: string,
  turn: number,
): void {
  if (!frame.active || !frame.cue) return;
  const cue = frame.cue;
  const barH = Math.max(30, Math.round(h * 0.076 * frame.letterbox));

  // Soft vignette
  if (frame.dim > 0.01) {
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.25, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    grad.addColorStop(0, 'rgba(2, 6, 12, 0)');
    grad.addColorStop(1, `rgba(2, 6, 12, ${Math.min(0.72, frame.dim * 1.15)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // Impact white flash
  if (frame.flash > 0.04) {
    ctx.fillStyle = `rgba(255, 255, 255, ${frame.flash * 0.52})`;
    ctx.fillRect(0, 0, w, h);
  }

  // Top & bottom cinema letterbox bars
  if (barH > 2) {
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, w, barH);
    ctx.fillRect(0, h - barH, w, barH);
    ctx.fillStyle = 'rgba(248, 250, 252, 0.1)';
    ctx.fillRect(0, barH, w, 1);
    ctx.fillRect(0, h - barH - 1, w, 1);

    ctx.font = '800 11px "Space Grotesk", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f87171';
    ctx.textAlign = 'left';
    ctx.fillText('● PLAY OF THE MATCH', 18, barH / 2);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.textAlign = 'right';
    ctx.fillText(`TURN ${turn} · SEED ${seed || 'LIVE'}`, w - 18, barH / 2);

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.fillText('TACTICAL TILES', 18, h - barH / 2);
  }

  if (frame.phase === 'PUSH' || frame.phase === 'ARM') return;

  const narrative = resolveKillCamNarrative(cue, frame.combo);
  const killerColor = narrative.accentGold
    ? '#FACC15'
    : (cue.killerOwner !== null ? PLAYER_UI_THEME[cue.killerOwner]?.badgeBg : null) ?? '#38BDF8';
  const topY = barH + 14;

  // Headline (upper lane)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '800 11px "Space Grotesk", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(248, 250, 252, 0.76)';
  ctx.fillText(`● ${narrative.eyebrow}`, w / 2, topY);

  ctx.font = `900 ${Math.round(Math.max(26, Math.min(48, w * 0.044)))}px "Space Grotesk", system-ui, sans-serif`;
  ctx.shadowColor = 'rgba(2, 6, 12, 0.9)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = narrative.accentGold ? '#FEF08A' : '#FFFFFF';
  ctx.fillText(narrative.headline, w / 2, topY + 16);
  ctx.shadowBlur = 0;

  // Off-center damage stamp + Tactical Receipt (corner-dodging)
  const sub = fxTimeline.getKillCamSubjectScreen();
  const dodgeRight = sub.x > 0.56 && sub.y < 0.52;
  const stampW = 210;
  const stampX = dodgeRight ? 18 : w - stampW - 18;
  const stampY = topY + 4;
  if (cue.damage > 0) {
    const steps = buildReceiptSteps(cue.breakdown, cue.damage, cue.subject === 'KILL');
    const boxH = steps.length > 0 ? 78 : 56;
    ctx.fillStyle = 'rgba(7, 11, 18, 0.84)';
    ctx.fillRect(stampX, stampY, stampW, boxH);
    ctx.fillStyle = '#EF4444';
    ctx.fillRect(dodgeRight ? stampX : stampX + stampW - 3, stampY, 3, boxH);

    ctx.textAlign = dodgeRight ? 'left' : 'right';
    const textX = dodgeRight ? stampX + 12 : stampX + stampW - 12;
    ctx.font = '900 32px "Space Grotesk", system-ui, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`−${cue.damage}`, textX, stampY + 8);

    if (steps.length > 0) {
      ctx.font = '800 9px "Space Grotesk", system-ui, sans-serif';
      ctx.fillStyle = '#BAE6FD';
      ctx.fillText(steps.map(s => s.text).join('  '), textX, stampY + 48, stampW - 22);
    }
  }

  // Bottom attribution pill
  const footY = h - barH - 42;
  ctx.fillStyle = 'rgba(7, 11, 18, 0.88)';
  const cardW = Math.min(360, w - 40);
  const cardX = (w - cardW) / 2;
  ctx.fillRect(cardX, footY, cardW, 32);
  ctx.fillStyle = killerColor;
  ctx.fillRect(cardX, footY, 3, 32);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 12px "Space Grotesk", system-ui, sans-serif';
  ctx.fillStyle = '#F8FAFC';
  const unitTag = (cue.victimName ?? cue.structureType ?? 'TARGET').toUpperCase();
  ctx.fillText(`P${(cue.killerOwner ?? 0) + 1}  ⚡  ${unitTag}`, w / 2, footY + 16);
}

const pickSupportedWebmMime = (): string | null => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  for (const mime of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
};

export interface ClipExportOptions {
  seed: string;
  turn: number;
  runReplay: (onComplete: () => void) => void;
  onStatus?: (msg: string) => void;
}

/**
 * Replays the Play of the Match while capturing composited WebGL + HUD + procedural audio
 * into a downloadable `.webm` file (falling back cleanly to a peak-frame `.png` share card).
 */
export async function exportPlayOfTheMatchClip(
  options: ClipExportOptions,
): Promise<'webm' | 'png' | 'unsupported'> {
  const app = getLivePixiApp();
  if (!app || !app.view) return 'unsupported';

  const viewCanvas = app.view as HTMLCanvasElement;
  const srcW = Math.max(320, viewCanvas.width || 960);
  const srcH = Math.max(240, viewCanvas.height || 540);
  const scaleDown = Math.min(1, 1280 / srcW, 720 / srcH);
  const outW = Math.max(320, Math.round(srcW * scaleDown));
  const outH = Math.max(240, Math.round(srcH * scaleDown));

  const compCanvas = document.createElement('canvas');
  compCanvas.width = outW;
  compCanvas.height = outH;
  const ctx = compCanvas.getContext('2d');
  if (!ctx) return 'unsupported';

  let peakPngUrl: string | null = null;
  let capturedPeak = false;

  const compositeFrame = () => {
    try {
      ctx.fillStyle = '#0B1220';
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(viewCanvas, 0, 0, outW, outH);
      const frame = fxTimeline.getKillCamFrame();
      paintBroadcastHud(ctx, outW, outH, frame, options.seed, options.turn);
      if (!capturedPeak && frame.active && (frame.phase === 'SLOW' || (frame.phase === 'SLAM' && frame.impact > 0.6))) {
        capturedPeak = true;
        peakPngUrl = compCanvas.toDataURL('image/png');
      }
    } catch {
      // Ignore single-frame capture failures cleanly
    }
  };

  app.ticker?.add(compositeFrame, undefined, TICKER_UTILITY_PRIORITY);
  const mime = pickSupportedWebmMime();
  const canRecordStream = Boolean(mime && typeof compCanvas.captureStream === 'function');
  const safeSeed = (options.seed || 'clip').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'clip';

  try {
    if (!canRecordStream || !mime) {
      options.onStatus?.('Capturing highlight frame...');
      await new Promise<void>(resolve => {
        const guard = window.setTimeout(resolve, 6500);
        options.runReplay(() => {
          window.clearTimeout(guard);
          resolve();
        });
      });
      if (!peakPngUrl) {
        compositeFrame();
        peakPngUrl = compCanvas.toDataURL('image/png');
      }
      downloadDataUrl(peakPngUrl, `tactical-tiles-potm-${safeSeed}.png`);
      return 'png';
    }

    options.onStatus?.('Recording WebM clip...');
    const videoStream = compCanvas.captureStream(30);
    const audioStream = SoundFX.getAudioCaptureStream();
    const combinedTracks = [
      ...videoStream.getVideoTracks(),
      ...(audioStream ? audioStream.getAudioTracks() : []),
    ];
    const combined = new MediaStream(combinedTracks);
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 3_500_000 });
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    const stopped = new Promise<void>(resolve => {
      recorder.onstop = () => resolve();
    });

    recorder.start(100);
    await new Promise<void>(resolve => {
      const guard = window.setTimeout(resolve, 6500);
      options.runReplay(() => {
        window.clearTimeout(guard);
        window.setTimeout(resolve, 180);
      });
    });

    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    await stopped;
    videoStream.getTracks().forEach(t => t.stop());

    if (chunks.length > 0) {
      const blob = new Blob(chunks, { type: mime });
      downloadBlob(blob, `tactical-tiles-potm-${safeSeed}.webm`);
      return 'webm';
    }
    if (peakPngUrl) {
      downloadDataUrl(peakPngUrl, `tactical-tiles-potm-${safeSeed}.png`);
      return 'png';
    }
    return 'unsupported';
  } finally {
    app.ticker?.remove(compositeFrame);
  }
}
