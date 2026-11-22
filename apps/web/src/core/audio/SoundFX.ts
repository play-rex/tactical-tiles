export type SoundEffectType =
    | 'click'
    | 'move'
    | 'attack'
    | 'sniper'
    | 'hit'
    | 'explosion'
    | 'heist'
    | 'capture'
    | 'turn'
    | 'victory';

const MUTE_STORAGE_KEY = 'tactical_tiles_muted';

class SoundFXManager {
    private ctx: AudioContext | null = null;
    private muted: boolean = false;

    constructor() {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                this.muted = window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
            }
        } catch {
            this.muted = false;
        }
    }

    private getContext(): AudioContext | null {
        if (this.muted || typeof window === 'undefined') return null;
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return null;

        if (!this.ctx) {
            this.ctx = new AudioCtx();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
        return this.ctx;
    }

    public isMuted(): boolean {
        return this.muted;
    }

    public setMuted(muted: boolean): void {
        this.muted = muted;
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
            }
        } catch {
            // Ignore storage unavailability
        }
    }

    private playTone(
        freqStart: number,
        freqEnd: number,
        duration: number,
        type: OscillatorType = 'sine',
        gainPeak: number = 0.08,
        delay: number = 0
    ): void {
        const ctx = this.getContext();
        if (!ctx) return;

        const now = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freqStart, now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(gainPeak, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + duration + 0.02);
    }

    public play(effect: SoundEffectType): void {
        try {
            switch (effect) {
                case 'click':
                    this.playTone(520, 420, 0.05, 'triangle', 0.04);
                    break;
                case 'move':
                    this.playTone(220, 320, 0.09, 'triangle', 0.06);
                    break;
                case 'attack':
                    this.playTone(440, 120, 0.14, 'sawtooth', 0.08);
                    break;
                case 'sniper':
                    this.playTone(900, 140, 0.22, 'sawtooth', 0.1);
                    break;
                case 'hit':
                    this.playTone(180, 65, 0.16, 'square', 0.08, 0.05);
                    break;
                case 'explosion':
                    this.playTone(140, 40, 0.35, 'sawtooth', 0.12);
                    this.playTone(95, 32, 0.4, 'square', 0.08, 0.04);
                    break;
                case 'heist':
                    this.playTone(523, 659, 0.1, 'triangle', 0.08, 0);
                    this.playTone(659, 784, 0.12, 'triangle', 0.08, 0.09);
                    this.playTone(784, 1046, 0.18, 'triangle', 0.09, 0.18);
                    break;
                case 'capture':
                    this.playTone(392, 523, 0.14, 'triangle', 0.08, 0);
                    this.playTone(523, 659, 0.18, 'triangle', 0.08, 0.11);
                    break;
                case 'turn':
                    this.playTone(330, 440, 0.12, 'sine', 0.06, 0);
                    break;
                case 'victory':
                    this.playTone(523, 523, 0.15, 'triangle', 0.09, 0);
                    this.playTone(659, 659, 0.15, 'triangle', 0.09, 0.14);
                    this.playTone(784, 1046, 0.35, 'triangle', 0.1, 0.28);
                    break;
            }
        } catch {
            // Never let audio playback disrupt gameplay
        }
    }
}

export const SoundFX = new SoundFXManager();
