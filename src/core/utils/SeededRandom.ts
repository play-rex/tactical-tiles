const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Normalizes a user-supplied seed string to uppercase alphanumeric form.
 */
export const normalizeSeed = (raw?: string): string => {
    if (!raw) return '';
    return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
};

/**
 * Generates a readable 6-character sector seed code.
 */
export const generateSectorSeed = (): string => {
    let out = '';
    for (let i = 0; i < 6; i++) {
        out += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)];
    }
    return out;
};

/**
 * FNV-1a 32-bit string hash for deterministic PRNG seeding.
 */
export const hashSeed = (seed: string): number => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

/**
 * Mulberry32 deterministic PRNG producing floats in [0, 1).
 */
export const createSeededRng = (seed: string): (() => number) => {
    let state = hashSeed(seed || 'TACTICAL') || 1;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};
