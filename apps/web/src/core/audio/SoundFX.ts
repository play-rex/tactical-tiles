import type { TerrainType, UnitType } from '@tactical/engine/types';

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

/**
 * Realistic procedural military Foley & ballistic Web Audio engine.
 *
 * Uses waveshaper-saturated impulse transients, multi-band filtered noise, granular
 * bootstep/tread envelopes, a master dynamics compressor, and a synthesized outdoor
 * battlefield convolution reverb so shots, blasts, machine guns, footsteps, and tank
 * treads sound grounded and physical rather than arcade oscillator beeps.
 */
class SoundFXManager {
    private ctx: AudioContext | null = null;
    private masterIn: GainNode | null = null;
    private reverbSend: GainNode | null = null;
    private whiteNoise: AudioBuffer | null = null;
    private pinkNoise: AudioBuffer | null = null;
    private shaperCurve: Float32Array<ArrayBuffer> | null = null;
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

    private ensureAudio(): { ctx: AudioContext; out: AudioNode; reverb: AudioNode | null } | null {
        if (this.muted || typeof window === 'undefined') return null;
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return null;

        if (!this.ctx) {
            this.ctx = new AudioCtx();
            this.setupBus(this.ctx);
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
        if (!this.masterIn) {
            this.setupBus(this.ctx);
        }
        return { ctx: this.ctx, out: this.masterIn!, reverb: this.reverbSend };
    }

    private setupBus(ctx: AudioContext): void {
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-11, ctx.currentTime);
        compressor.knee.setValueAtTime(16, ctx.currentTime);
        compressor.ratio.setValueAtTime(4.5, ctx.currentTime);
        compressor.attack.setValueAtTime(0.002, ctx.currentTime);
        compressor.release.setValueAtTime(0.11, ctx.currentTime);

        const master = ctx.createGain();
        master.gain.setValueAtTime(0.95, ctx.currentTime);
        master.connect(compressor);
        compressor.connect(ctx.destination);
        this.masterIn = master;

        // Synthesize realistic outdoor battlefield impulse response (early ground bounces + air decay)
        try {
            const irLen = Math.floor(ctx.sampleRate * 0.52);
            const irBuf = ctx.createBuffer(2, irLen, ctx.sampleRate);
            for (let ch = 0; ch < 2; ch++) {
                const data = irBuf.getChannelData(ch);
                let prev = 0;
                for (let i = 0; i < irLen; i++) {
                    const t = i / irLen;
                    // Air absorption darkens the outdoor echo tail smoothly over distance
                    const raw = Math.random() * 2 - 1;
                    prev = prev * 0.72 + raw * 0.28;
                    let env = Math.pow(1 - t, 3.4) * 0.45;
                    // Crisp early terrain/building reflections around 14ms, 31ms, 56ms
                    const ms = (i / ctx.sampleRate) * 1000;
                    if (Math.abs(ms - (14 + ch * 2.5)) < 1.2) env += 0.42;
                    if (Math.abs(ms - (31 + ch * 3.1)) < 1.5) env += 0.26;
                    if (Math.abs(ms - (56 + ch * 2.0)) < 1.8) env += 0.16;
                    data[i] = prev * env;
                }
            }
            const convolver = ctx.createConvolver();
            convolver.buffer = irBuf;
            const reverbGain = ctx.createGain();
            reverbGain.gain.setValueAtTime(0.32, ctx.currentTime);
            const reverbLp = ctx.createBiquadFilter();
            reverbLp.type = 'lowpass';
            reverbLp.frequency.setValueAtTime(2400, ctx.currentTime);

            reverbGain.connect(convolver);
            convolver.connect(reverbLp);
            reverbLp.connect(master);
            this.reverbSend = reverbGain;
        } catch {
            this.reverbSend = null;
        }
    }

    private getWhiteNoise(ctx: AudioContext): AudioBuffer | null {
        if (this.whiteNoise && this.whiteNoise.sampleRate === ctx.sampleRate) return this.whiteNoise;
        try {
            const len = Math.floor(ctx.sampleRate * 1.0);
            const buf = ctx.createBuffer(1, len, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
            this.whiteNoise = buf;
            return buf;
        } catch {
            return null;
        }
    }

    private getPinkNoise(ctx: AudioContext): AudioBuffer | null {
        if (this.pinkNoise && this.pinkNoise.sampleRate === ctx.sampleRate) return this.pinkNoise;
        try {
            const len = Math.floor(ctx.sampleRate * 1.0);
            const buf = ctx.createBuffer(1, len, ctx.sampleRate);
            const data = buf.getChannelData(0);
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < len; i++) {
                const w = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + w * 0.0555179;
                b1 = 0.99332 * b1 + w * 0.0750759;
                b2 = 0.96900 * b2 + w * 0.1538520;
                b3 = 0.86650 * b3 + w * 0.3104856;
                b4 = 0.55000 * b4 + w * 0.5329522;
                b5 = -0.7616 * b5 - w * 0.0168980;
                data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.14;
                b6 = w * 0.115926;
            }
            this.pinkNoise = buf;
            return buf;
        } catch {
            return null;
        }
    }

    private getSaturationCurve(drive = 3.2): Float32Array<ArrayBuffer> {
        if (this.shaperCurve) return this.shaperCurve;
        const samples = 1024;
        const curve = new Float32Array(new ArrayBuffer(samples * 4));
        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            curve[i] = Math.tanh(x * drive);
        }
        this.shaperCurve = curve;
        return curve;
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

    private playFilteredNoise(params: {
        ctx: AudioContext;
        out: AudioNode;
        reverb?: AudioNode | null;
        reverbMix?: number;
        pink?: boolean;
        delay?: number;
        attack?: number;
        duration: number;
        filterType: BiquadFilterType;
        freqStart: number;
        freqEnd: number;
        q?: number;
        gain: number;
        saturate?: boolean;
    }): void {
        const buf = params.pink ? this.getPinkNoise(params.ctx) : this.getWhiteNoise(params.ctx);
        if (!buf) return;

        const now = params.ctx.currentTime + (params.delay ?? 0);
        const src = params.ctx.createBufferSource();
        src.buffer = buf;
        const maxOffset = Math.max(0, buf.duration - params.duration - 0.04);
        const offset = maxOffset > 0 ? Math.random() * maxOffset : 0;

        const filter = params.ctx.createBiquadFilter();
        filter.type = params.filterType;
        filter.Q.setValueAtTime(params.q ?? 1.0, now);
        filter.frequency.setValueAtTime(Math.max(30, params.freqStart), now);
        filter.frequency.exponentialRampToValueAtTime(Math.max(30, params.freqEnd), now + params.duration);

        const gain = params.ctx.createGain();
        const atk = params.attack ?? 0.002;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(params.gain, now + atk);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + params.duration);

        let head: AudioNode = filter;
        src.connect(filter);
        if (params.saturate) {
            const shaper = params.ctx.createWaveShaper();
            shaper.curve = this.getSaturationCurve();
            shaper.oversample = '2x';
            filter.connect(shaper);
            head = shaper;
        }
        head.connect(gain);
        gain.connect(params.out);

        if (params.reverb && (params.reverbMix ?? 0) > 0) {
            const send = params.ctx.createGain();
            send.gain.setValueAtTime(params.reverbMix!, now);
            gain.connect(send);
            send.connect(params.reverb);
        }

        src.start(now, offset, params.duration + 0.02);
    }

    /** Short non-musical pressure thump (damped sub-bass punch, zero melodic beep). */
    private playPressurePunch(params: {
        ctx: AudioContext;
        out: AudioNode;
        reverb?: AudioNode | null;
        reverbMix?: number;
        delay?: number;
        freqStart: number;
        freqEnd: number;
        duration: number;
        gain: number;
        type?: OscillatorType;
    }): void {
        const now = params.ctx.currentTime + (params.delay ?? 0);
        const osc = params.ctx.createOscillator();
        const gain = params.ctx.createGain();

        osc.type = params.type ?? 'sine';
        osc.frequency.setValueAtTime(params.freqStart, now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(18, params.freqEnd), now + params.duration);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(params.gain, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + params.duration);

        osc.connect(gain);
        gain.connect(params.out);
        if (params.reverb && (params.reverbMix ?? 0) > 0) {
            const send = params.ctx.createGain();
            send.gain.setValueAtTime(params.reverbMix!, now);
            gain.connect(send);
            send.connect(params.reverb);
        }
        osc.start(now);
        osc.stop(now + params.duration + 0.015);
    }

    // ── Realistic Ballistic Weapons ────────────────────────────────────────

    /** Scout: sharp dry 9mm tactical pistol shot + metallic slide snap + outdoor crack echo. */
    public playPistolShot(delay = 0): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out, reverb } = bus;
            const jitter = 0.94 + Math.random() * 0.12;

            // 1. Sub-millisecond supersonic muzzle snap (saturated)
            this.playFilteredNoise({
                ctx, out, reverb, reverbMix: 0.45,
                delay, attack: 0.0005, duration: 0.042,
                filterType: 'bandpass', freqStart: 2700 * jitter, freqEnd: 950, q: 1.1,
                gain: 0.48, saturate: true,
            });
            // 2. Crisp dry gunpowder blast body
            this.playFilteredNoise({
                ctx, out, reverb, reverbMix: 0.55, pink: true,
                delay, attack: 0.001, duration: 0.11,
                filterType: 'lowpass', freqStart: 1650 * jitter, freqEnd: 240, q: 0.8,
                gain: 0.44, saturate: true,
            });
            // 3. Tight chest pressure wave (ultra-short 36ms, non-tonal)
            this.playPressurePunch({
                ctx, out, delay, freqStart: 155, freqEnd: 42, duration: 0.038, gain: 0.34,
            });
            // 4. Metallic slide cycle clack + brass eject click
            this.playFilteredNoise({
                ctx, out,
                delay: delay + 0.018, attack: 0.001, duration: 0.026,
                filterType: 'bandpass', freqStart: 5400, freqEnd: 3800, q: 4.5,
                gain: 0.14,
            });
        } catch {
            // Never disrupt gameplay
        }
    }

    /** Breacher: heavy tank cannon breech boom + blast missile ignition whoosh. */
    public playTankCannonFire(delay = 0): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out, reverb } = bus;

            // 1. Massive chest concussion thump
            this.playPressurePunch({
                ctx, out, reverb, reverbMix: 0.4,
                delay, freqStart: 92, freqEnd: 22, duration: 0.24, gain: 0.55, type: 'triangle',
            });
            // 2. Saturated heavy cannon blast roar
            this.playFilteredNoise({
                ctx, out, reverb, reverbMix: 0.72, pink: true,
                delay, attack: 0.0015, duration: 0.32,
                filterType: 'lowpass', freqStart: 620, freqEnd: 85, q: 0.9,
                gain: 0.62, saturate: true,
            });
            // 3. Heavy steel breech clank
            this.playFilteredNoise({
                ctx, out,
                delay: delay + 0.006, attack: 0.001, duration: 0.065,
                filterType: 'bandpass', freqStart: 1450, freqEnd: 780, q: 3.5,
                gain: 0.22,
            });
            // 4. Rocket/missile propellant whoosh trailing the shell
            this.playFilteredNoise({
                ctx, out, reverb, reverbMix: 0.25,
                delay: delay + 0.025, attack: 0.03, duration: 0.2,
                filterType: 'bandpass', freqStart: 750, freqEnd: 1750, q: 1.4,
                gain: 0.19,
            });
        } catch {
            // Never disrupt gameplay
        }
    }

    /** Breacher HE shell / Siege impact: deep explosive concussion + flying debris crackle. */
    public playTankBlastImpact(delay = 0): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out, reverb } = bus;

            // 1. Sub-bass concussion boom
            this.playPressurePunch({
                ctx, out, reverb, reverbMix: 0.5,
                delay, freqStart: 88, freqEnd: 19, duration: 0.38, gain: 0.58,
            });
            // 2. Roaring saturated HE fireball
            this.playFilteredNoise({
                ctx, out, reverb, reverbMix: 0.8, pink: true,
                delay, attack: 0.002, duration: 0.5,
                filterType: 'lowpass', freqStart: 980, freqEnd: 75, q: 0.85,
                gain: 0.64, saturate: true,
            });
            // 3. Sharp blast crack + dirt/shrapnel spray
            this.playFilteredNoise({
                ctx, out, reverb, reverbMix: 0.45,
                delay: delay + 0.015, attack: 0.002, duration: 0.22,
                filterType: 'bandpass', freqStart: 2500, freqEnd: 520, q: 1.1,
                gain: 0.26,
            });
        } catch {
            // Never disrupt gameplay
        }
    }

    /** Sniper: preserves the crisp high-velocity sniper signature + outdoor echo & bolt cycle. */
    public playSniperShot(delay = 0): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out, reverb } = bus;

            // Signature crisp high-energy crack + harmonic drop (user liked current sniper!)
            this.playFilteredNoise({
                ctx, out, reverb, reverbMix: 0.65,
                delay, attack: 0.0005, duration: 0.14,
                filterType: 'highpass', freqStart: 2500, freqEnd: 850, q: 1.3,
                gain: 0.28, saturate: true,
            });
            this.playPressurePunch({
                ctx, out, reverb, reverbMix: 0.5,
                delay, freqStart: 1120, freqEnd: 145, duration: 0.21, gain: 0.14, type: 'sawtooth',
            });
            this.playPressurePunch({
                ctx, out, reverb, reverbMix: 0.4,
                delay: delay + 0.008, freqStart: 160, freqEnd: 46, duration: 0.17, gain: 0.22, type: 'triangle',
            });
            // Crisp mechanical bolt-action cycle right after recoil
            this.playFilteredNoise({
                ctx, out,
                delay: delay + 0.2, attack: 0.002, duration: 0.032,
                filterType: 'bandpass', freqStart: 3600, freqEnd: 2400, q: 5.0,
                gain: 0.09,
            });
            this.playFilteredNoise({
                ctx, out,
                delay: delay + 0.26, attack: 0.002, duration: 0.038,
                filterType: 'bandpass', freqStart: 4200, freqEnd: 2900, q: 5.5,
                gain: 0.11,
            });
        } catch {
            // Never disrupt gameplay
        }
    }

    /** Base Defense: authentic 6-round rapid-fire heavy .50 cal machine gun burst + brass clink. */
    public playMachineGunBurst(rounds = 6, intervalSec = 0.056): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out, reverb } = bus;

            for (let i = 0; i < rounds; i++) {
                const jitterTime = (Math.random() - 0.5) * 0.006;
                const t = Math.max(0, i * intervalSec + jitterTime);
                const pitchVar = 0.92 + Math.random() * 0.16;

                // Saturated heavy MG crack
                this.playFilteredNoise({
                    ctx, out, reverb, reverbMix: 0.45,
                    delay: t, attack: 0.0005, duration: 0.05,
                    filterType: 'bandpass', freqStart: 1750 * pitchVar, freqEnd: 620, q: 1.15,
                    gain: 0.38, saturate: true,
                });
                // Heavy low-end gas punch
                this.playFilteredNoise({
                    ctx, out, reverb, reverbMix: 0.35, pink: true,
                    delay: t, attack: 0.001, duration: 0.068,
                    filterType: 'lowpass', freqStart: 880 * pitchVar, freqEnd: 170, q: 0.85,
                    gain: 0.34, saturate: true,
                });
                this.playPressurePunch({
                    ctx, out, delay: t, freqStart: 130 * pitchVar, freqEnd: 40, duration: 0.035, gain: 0.24,
                });
                // Mechanical receiver bolt clatter
                this.playFilteredNoise({
                    ctx, out,
                    delay: t + 0.012, attack: 0.001, duration: 0.02,
                    filterType: 'highpass', freqStart: 3900 * pitchVar, freqEnd: 2800, q: 2.0,
                    gain: 0.11,
                });
            }

            // Subtle brass casings clinking on concrete deck after burst
            const tailStart = rounds * intervalSec + 0.05;
            for (let c = 0; c < 3; c++) {
                this.playFilteredNoise({
                    ctx, out,
                    delay: tailStart + c * 0.045, attack: 0.001, duration: 0.025,
                    filterType: 'bandpass', freqStart: 6200 + c * 420, freqEnd: 5600, q: 10,
                    gain: 0.045,
                });
            }
        } catch {
            // Never disrupt gameplay
        }
    }

    /** Subtle hydraulic/electric turret slewing whirr when HQ switches between targets. */
    public playTurretSwivel(): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out } = bus;

            // Short damped servo slew + mechanical lock click at end of rotation
            this.playFilteredNoise({
                ctx, out,
                delay: 0, attack: 0.012, duration: 0.095,
                filterType: 'bandpass', freqStart: 540, freqEnd: 880, q: 4.5,
                gain: 0.085,
            });
            this.playFilteredNoise({
                ctx, out,
                delay: 0.085, attack: 0.001, duration: 0.022,
                filterType: 'bandpass', freqStart: 3200, freqEnd: 2000, q: 5.0,
                gain: 0.1,
            });
        } catch {
            // Never disrupt gameplay
        }
    }

    /** Bank Security Turret: tight servo lock + high-energy twin security pulse. */
    public playTurretShot(): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out, reverb } = bus;

            this.playFilteredNoise({
                ctx, out, reverb, reverbMix: 0.4,
                delay: 0, attack: 0.001, duration: 0.07,
                filterType: 'bandpass', freqStart: 2200, freqEnd: 780, q: 2.2,
                gain: 0.34, saturate: true,
            });
            this.playFilteredNoise({
                ctx, out, reverb, reverbMix: 0.4,
                delay: 0.045, attack: 0.001, duration: 0.08,
                filterType: 'bandpass', freqStart: 2400, freqEnd: 820, q: 2.2,
                gain: 0.3, saturate: true,
            });
            this.playPressurePunch({
                ctx, out, delay: 0, freqStart: 185, freqEnd: 55, duration: 0.05, gain: 0.22,
            });
        } catch {
            // Never disrupt gameplay
        }
    }

    // ── Realistic Movement Foley (Footsteps vs Heavy Tank Treads) ──────────

    /** Plays unit-appropriate movement Foley: heavy tank treads for Breacher, tactical footsteps for Scout/Sniper. */
    public playUnitMove(unitType: UnitType, durationMs: number, terrain?: TerrainType): void {
        if (unitType === 'ASSAULTER') {
            this.playTankMovement(durationMs);
        } else {
            this.playFootsteps(durationMs, unitType === 'SNIPER' ? 0.85 : 1.0, terrain);
        }
    }

    /** Tactical boots crunching across gravel, grass, sand, forest leaves, or water/bridges. */
    public playFootsteps(durationMs = 260, volumeScale = 1, terrain?: TerrainType): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out, reverb } = bus;

            const durSec = Math.max(0.16, Math.min(0.55, durationMs / 1000));
            const stepInterval = 0.105;
            const count = Math.max(2, Math.min(6, Math.round(durSec / stepInterval)));

            const isWet = terrain === 'WATER' || terrain === 'BRIDGE' || terrain === 'BRIDGE_V';
            const isForest = terrain === 'FOREST';
            const isSand = terrain === 'SAND' || terrain === 'DUNES' || terrain === 'QUICKSAND';

            for (let i = 0; i < count; i++) {
                const t = i * stepInterval + (Math.random() - 0.5) * 0.012;
                const alt = i % 2 === 0 ? 1.0 : 0.92;
                const v = volumeScale * alt;

                // 1. Dull grounded heel strike thud
                this.playFilteredNoise({
                    ctx, out, pink: true,
                    delay: Math.max(0, t), attack: 0.002, duration: 0.036,
                    filterType: 'lowpass', freqStart: isSand ? 280 : 380, freqEnd: 110, q: 0.8,
                    gain: 0.22 * v,
                });
                // 2. Terrain sole crunch / gravel scuff / leaf rustle / wet splash
                this.playFilteredNoise({
                    ctx, out, reverb, reverbMix: 0.14,
                    delay: Math.max(0, t + 0.015), attack: 0.004, duration: isSand ? 0.068 : 0.052,
                    filterType: isForest ? 'highpass' : 'bandpass',
                    freqStart: isWet ? 1350 : isForest ? 2600 : isSand ? 1500 : 2250 * alt,
                    freqEnd: isWet ? 700 : isForest ? 1700 : isSand ? 950 : 1200,
                    q: isWet ? 1.8 : 1.3,
                    gain: (isWet ? 0.17 : 0.15) * v,
                });
            }
        } catch {
            // Never disrupt gameplay
        }
    }

    /** Breacher: heavy diesel armored engine chug + clanking steel caterpillar treads + crushed earth. */
    public playTankMovement(durationMs = 360): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out, reverb } = bus;

            const durSec = Math.max(0.24, Math.min(0.62, durationMs / 1000));
            const now = ctx.currentTime;

            // 1. Low diesel engine chug (sawtooth heavily lowpassed + 16 Hz cylinder LFO throb)
            const engOsc = ctx.createOscillator();
            engOsc.type = 'sawtooth';
            engOsc.frequency.setValueAtTime(42, now);
            engOsc.frequency.linearRampToValueAtTime(54, now + durSec * 0.45);
            engOsc.frequency.linearRampToValueAtTime(38, now + durSec);

            const engSub = ctx.createOscillator();
            engSub.type = 'triangle';
            engSub.frequency.setValueAtTime(28, now);
            engSub.frequency.linearRampToValueAtTime(34, now + durSec * 0.5);
            engSub.frequency.linearRampToValueAtTime(25, now + durSec);

            const engLp = ctx.createBiquadFilter();
            engLp.type = 'lowpass';
            engLp.frequency.setValueAtTime(145, now);
            engLp.Q.setValueAtTime(1.6, now);

            const engGain = ctx.createGain();
            engGain.gain.setValueAtTime(0.0001, now);
            engGain.gain.linearRampToValueAtTime(0.24, now + 0.045);
            engGain.gain.setValueAtTime(0.22, now + Math.max(0.06, durSec - 0.08));
            engGain.gain.exponentialRampToValueAtTime(0.0001, now + durSec + 0.03);

            // 16 Hz diesel cylinder pulsation
            const lfo = ctx.createOscillator();
            const lfoDepth = ctx.createGain();
            lfo.frequency.setValueAtTime(16, now);
            lfoDepth.gain.setValueAtTime(0.07, now);
            lfo.connect(lfoDepth);
            lfoDepth.connect(engGain.gain);

            engOsc.connect(engLp);
            engSub.connect(engLp);
            engLp.connect(engGain);
            engGain.connect(out);

            engOsc.start(now);
            engSub.start(now);
            lfo.start(now);
            engOsc.stop(now + durSec + 0.05);
            engSub.stop(now + durSec + 0.05);
            lfo.stop(now + durSec + 0.05);

            // 2. Crushed gravel/earth rumble beneath heavy tracks
            this.playFilteredNoise({
                ctx, out, reverb, reverbMix: 0.18, pink: true,
                delay: 0, attack: 0.04, duration: durSec,
                filterType: 'bandpass', freqStart: 420, freqEnd: 260, q: 0.9,
                gain: 0.24,
            });

            // 3. Rhythmic steel caterpillar track link clanks
            const linkStep = 0.068;
            const links = Math.max(3, Math.min(8, Math.floor(durSec / linkStep)));
            for (let i = 0; i < links; i++) {
                const t = i * linkStep + (Math.random() - 0.5) * 0.008;
                const pitch = 0.9 + Math.random() * 0.2;
                this.playFilteredNoise({
                    ctx, out,
                    delay: Math.max(0, t), attack: 0.002, duration: 0.042,
                    filterType: 'bandpass', freqStart: 1180 * pitch, freqEnd: 760, q: 4.5,
                    gain: 0.14,
                });
                if (i % 2 === 0) {
                    this.playFilteredNoise({
                        ctx, out,
                        delay: Math.max(0, t + 0.015), attack: 0.002, duration: 0.036,
                        filterType: 'bandpass', freqStart: 2550 * pitch, freqEnd: 1850, q: 6.0,
                        gain: 0.075,
                    });
                }
            }
        } catch {
            // Never disrupt gameplay
        }
    }

    // ── Mechanical Tactical Foley (Reload, Overwatch, Heal, Build, Kill) ──

    /** Mechanical magazine seat + metallic bolt rack (`chk-clack`). */
    public playReload(): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out } = bus;

            // Mag click release
            this.playFilteredNoise({
                ctx, out, delay: 0, attack: 0.001, duration: 0.024,
                filterType: 'bandpass', freqStart: 3200, freqEnd: 1800, q: 4.5, gain: 0.14,
            });
            // Magazine solid seat thump
            this.playFilteredNoise({
                ctx, out, pink: true, delay: 0.09, attack: 0.001, duration: 0.045,
                filterType: 'lowpass', freqStart: 900, freqEnd: 240, q: 1.2, gain: 0.22,
            });
            // Metallic slide/bolt rack
            this.playFilteredNoise({
                ctx, out, delay: 0.18, attack: 0.001, duration: 0.035,
                filterType: 'bandpass', freqStart: 4100, freqEnd: 2600, q: 5.2, gain: 0.15,
            });
            this.playFilteredNoise({
                ctx, out, delay: 0.23, attack: 0.001, duration: 0.03,
                filterType: 'bandpass', freqStart: 4900, freqEnd: 3100, q: 6.0, gain: 0.16,
            });
        } catch {
            // Never disrupt gameplay
        }
    }

    /** Crisp mechanical safety / optic lock when entering Overwatch. */
    public playOverwatchLock(): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out } = bus;

            this.playFilteredNoise({
                ctx, out, delay: 0, attack: 0.001, duration: 0.025,
                filterType: 'bandpass', freqStart: 3800, freqEnd: 2200, q: 5.5, gain: 0.15,
            });
            this.playFilteredNoise({
                ctx, out, delay: 0.055, attack: 0.001, duration: 0.04,
                filterType: 'bandpass', freqStart: 2100, freqEnd: 1600, q: 3.5, gain: 0.13,
            });
        } catch {
            // Never disrupt gameplay
        }
    }

    /** Medkit pouch latch + pressurized sterile hiss (zero arcade beep). */
    public playHealFoley(): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out } = bus;

            this.playFilteredNoise({
                ctx, out, delay: 0, attack: 0.004, duration: 0.07,
                filterType: 'bandpass', freqStart: 2400, freqEnd: 1400, q: 1.8, gain: 0.12,
            });
            this.playFilteredNoise({
                ctx, out, delay: 0.075, attack: 0.015, duration: 0.22,
                filterType: 'highpass', freqStart: 3600, freqEnd: 2200, q: 1.0, gain: 0.11,
            });
        } catch {
            // Never disrupt gameplay
        }
    }

    /** Heavy construction placement thud (Barrier / Bridge). */
    public playBuildFoley(): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out, reverb } = bus;

            this.playPressurePunch({
                ctx, out, reverb, reverbMix: 0.25,
                delay: 0, freqStart: 120, freqEnd: 34, duration: 0.11, gain: 0.34,
            });
            this.playFilteredNoise({
                ctx, out, reverb, reverbMix: 0.2, pink: true,
                delay: 0, attack: 0.002, duration: 0.14,
                filterType: 'lowpass', freqStart: 850, freqEnd: 180, q: 1.0, gain: 0.28,
            });
            this.playFilteredNoise({
                ctx, out, delay: 0.035, attack: 0.002, duration: 0.05,
                filterType: 'bandpass', freqStart: 2100, freqEnd: 1300, q: 4.5, gain: 0.12,
            });
        } catch {
            // Never disrupt gameplay
        }
    }

    /** Subtle mechanical tactical kill confirmation (muted radio click + crisp steel double-tap). */
    public playKillConfirm(): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out } = bus;

            // Crisp muted tactical comms click-confirm (no melodic arcade chime)
            this.playFilteredNoise({
                ctx, out, delay: 0.03, attack: 0.001, duration: 0.028,
                filterType: 'bandpass', freqStart: 2800, freqEnd: 1900, q: 6.0, gain: 0.11,
            });
            this.playFilteredNoise({
                ctx, out, delay: 0.08, attack: 0.001, duration: 0.036,
                filterType: 'bandpass', freqStart: 3600, freqEnd: 2400, q: 7.0, gain: 0.12,
            });
        } catch {
            // Never disrupt gameplay
        }
    }

    /** Default legacy event dispatcher (all realistic Foley, zero raw oscillator beeps). */
    public play(effect: SoundEffectType): void {
        try {
            const bus = this.ensureAudio();
            if (!bus) return;
            const { ctx, out, reverb } = bus;

            switch (effect) {
                case 'click':
                    // Crisp 14ms mechanical steel console detent switch
                    this.playFilteredNoise({
                        ctx, out, delay: 0, attack: 0.0005, duration: 0.016,
                        filterType: 'bandpass', freqStart: 2800, freqEnd: 1600, q: 3.2, gain: 0.14,
                    });
                    break;

                case 'move':
                    this.playFootsteps(240, 1.0);
                    break;

                case 'attack':
                    this.playPistolShot(0);
                    break;

                case 'sniper':
                    this.playSniperShot(0);
                    break;

                case 'hit':
                    // Dry ballistic armor/kevlar impact slap + dull body thud
                    this.playFilteredNoise({
                        ctx, out, reverb, reverbMix: 0.22, pink: true,
                        delay: 0, attack: 0.001, duration: 0.09,
                        filterType: 'lowpass', freqStart: 1250, freqEnd: 180, q: 1.0,
                        gain: 0.36, saturate: true,
                    });
                    this.playFilteredNoise({
                        ctx, out,
                        delay: 0, attack: 0.001, duration: 0.045,
                        filterType: 'bandpass', freqStart: 2600, freqEnd: 1100, q: 2.0,
                        gain: 0.18,
                    });
                    this.playPressurePunch({
                        ctx, out, delay: 0, freqStart: 135, freqEnd: 38, duration: 0.055, gain: 0.28,
                    });
                    break;

                case 'explosion':
                    // Heavy military land mine / structure detonation
                    this.playTankBlastImpact(0);
                    // Trailing gravel & debris shower
                    this.playFilteredNoise({
                        ctx, out, reverb, reverbMix: 0.35,
                        delay: 0.14, attack: 0.01, duration: 0.34,
                        filterType: 'bandpass', freqStart: 1900, freqEnd: 650, q: 0.9,
                        gain: 0.14,
                    });
                    break;

                case 'heist':
                    // Heavy steel vault lock clunk + door release + metallic bullion/coin clinks
                    this.playPressurePunch({
                        ctx, out, reverb, reverbMix: 0.2,
                        delay: 0, freqStart: 110, freqEnd: 35, duration: 0.09, gain: 0.3,
                    });
                    this.playFilteredNoise({
                        ctx, out, delay: 0.02, attack: 0.001, duration: 0.06,
                        filterType: 'bandpass', freqStart: 1650, freqEnd: 900, q: 4.5, gain: 0.22,
                    });
                    this.playFilteredNoise({
                        ctx, out, delay: 0.11, attack: 0.002, duration: 0.08,
                        filterType: 'bandpass', freqStart: 2400, freqEnd: 1300, q: 3.5, gain: 0.16,
                    });
                    for (let c = 0; c < 4; c++) {
                        this.playFilteredNoise({
                            ctx, out, reverb, reverbMix: 0.25,
                            delay: 0.19 + c * 0.055, attack: 0.001, duration: 0.065,
                            filterType: 'bandpass', freqStart: 5400 + c * 520, freqEnd: 5100 + c * 400, q: 14,
                            gain: 0.11,
                        });
                    }
                    break;

                case 'capture':
                    // Crisp VHF tactical radio squelch + mechanical latch confirm
                    this.playFilteredNoise({
                        ctx, out, delay: 0, attack: 0.002, duration: 0.06,
                        filterType: 'bandpass', freqStart: 1950, freqEnd: 1450, q: 2.6, gain: 0.13,
                    });
                    this.playPressurePunch({
                        ctx, out, delay: 0.045, freqStart: 145, freqEnd: 55, duration: 0.07, gain: 0.2,
                    });
                    this.playFilteredNoise({
                        ctx, out, delay: 0.075, attack: 0.001, duration: 0.032,
                        filterType: 'bandpass', freqStart: 3400, freqEnd: 2400, q: 6.5, gain: 0.11,
                    });
                    break;

                case 'turn':
                    // Subtle military comms squelch (calm, zero harsh beep)
                    this.playFilteredNoise({
                        ctx, out, delay: 0, attack: 0.003, duration: 0.055,
                        filterType: 'bandpass', freqStart: 1700, freqEnd: 1300, q: 3.0, gain: 0.095,
                    });
                    this.playFilteredNoise({
                        ctx, out, delay: 0.06, attack: 0.002, duration: 0.025,
                        filterType: 'bandpass', freqStart: 2800, freqEnd: 2200, q: 6.0, gain: 0.075,
                    });
                    break;

                case 'victory': {
                    // Warm lowpass-filtered orchestral brass swell (stately finish, zero 8-bit beep)
                    const now = ctx.currentTime;
                    const freqs = [196, 246.94, 293.66, 392];
                    const lp = ctx.createBiquadFilter();
                    lp.type = 'lowpass';
                    lp.frequency.setValueAtTime(950, now);
                    lp.frequency.linearRampToValueAtTime(1750, now + 0.35);
                    lp.frequency.exponentialRampToValueAtTime(650, now + 1.1);
                    lp.connect(out);
                    if (reverb) {
                        const rv = ctx.createGain();
                        rv.gain.setValueAtTime(0.45, now);
                        lp.connect(rv);
                        rv.connect(reverb);
                    }
                    freqs.forEach((f, idx) => {
                        const osc = ctx.createOscillator();
                        const g = ctx.createGain();
                        osc.type = 'sawtooth';
                        osc.frequency.setValueAtTime(f, now);
                        g.gain.setValueAtTime(0.0001, now + idx * 0.06);
                        g.gain.linearRampToValueAtTime(0.042, now + idx * 0.06 + 0.16);
                        g.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
                        osc.connect(g);
                        g.connect(lp);
                        osc.start(now + idx * 0.06);
                        osc.stop(now + 1.2);
                    });
                    break;
                }
            }
        } catch {
            // Never let audio playback disrupt gameplay
        }
    }
}

export const SoundFX = new SoundFXManager();
