import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getTexture, preloadTextures } from '../../core/graphics/TextureManager';
import { RESPAWN_CP_COST, RESPAWN_TIMERS, UNIT_STATS } from '@tactical/engine/constants/Config';
import type { UnitType } from '@tactical/engine/types';
import { GeoButton, GeoCard, GeoChip, GeoWell } from './GeoPrimitives';

const ORDER: UnitType[] = ['SOLDIER', 'ASSAULTER', 'SNIPER'];

const UNIT_FLAVOR: Record<UnitType, { accent: string; soft: string; ink: string; tagline: string }> = {
      SOLDIER: { accent: 'var(--acc-blue)', soft: 'var(--acc-blue-soft)', ink: 'var(--acc-blue-ink)', tagline: 'Fast recon — captures, breaches & finishes' },
  ASSAULTER: { accent: 'var(--acc-red)', soft: 'var(--acc-red-soft)', ink: 'var(--acc-red-ink)', tagline: 'Heavy frontline — breaks bases & holds ground' },
  SNIPER: { accent: 'var(--acc-violet)', soft: 'var(--acc-violet-soft)', ink: 'var(--acc-violet-ink)', tagline: 'High-ground cannon — deletes from afar' },
};

const ALL_DEEDS: string[] = [
  'MOVE then ATTACK — one order per turn',
  'OVERWATCH — ambush the first enemy that steps in',
  'SECURE buildings — +€ income every turn',
      'SIEGE banks — crack 15 HP vaults (€100–300 or intel)',
  'LOOT supply drops on the field',
  'DEMOLISH barriers in the way',
      'SIEGE the enemy HQ (Conquer) or a bank vault',
  'RELOAD to refill ammo (5 CP)',
];

const SPECIAL_RULE: Record<UnitType, string> = {
  SOLDIER: 'Cheapest stepper (1 CP per tile) with 4 vision — your eyes, thief and finisher.',
  ASSAULTER: '30 HP wall with 10 damage — your best HQ-sieger and bodyguard.',
  SNIPER: 'Must fire from Mountain, Dunes or an owned Building. Fog & sandstorms cap range to 3.',
};

const useSmallScreen = (query = '(max-width: 760px)') => {
  const [small, setSmall] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setSmall(e.matches);
    mq.addEventListener('change', onChange);
    setSmall(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return small;
};

/** Data-URL snapshot of the exact procedural map texture, extracted once per unit type.
 * Same canvas the board renders — but a plain <img>, so icons cost zero extra WebGL contexts. */
const snapshotCache = new Map<UnitType, string>();
const snapshotUnitIcon = async (type: UnitType): Promise<string | null> => {
  const hit = snapshotCache.get(type);
  if (hit) return hit;
  try {
    await preloadTextures();
    const tex = getTexture('UNIT_P0_' + type) as unknown as {
      baseTexture?: { resource?: { source?: unknown } };
    };
    const source = tex?.baseTexture?.resource?.source;
    if (!(source instanceof HTMLCanvasElement) || source.width < 32) return null;
    const url = source.toDataURL('image/png');
    snapshotCache.set(type, url);
    return url;
  } catch {
    return null;
  }
};

export const UnitMapIcon: React.FC<{ type: UnitType; label: string; size?: number }> = ({ type, label, size = 52 }) => {
  const [url, setUrl] = useState<string | null>(() => snapshotCache.get(type) ?? null);
  useEffect(() => {
    let live = true;
    if (!snapshotCache.get(type)) {
      snapshotUnitIcon(type).then(u => {
        if (live && u) setUrl(u);
      });
    }
    return () => {
      live = false;
    };
  }, [type]);
  if (!url) {
    return (
      <span className="geo-chip" style={{ width: size + 'px', height: size + 'px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '13px', flexShrink: 0 }}>
        {label.substring(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={label + ' unit'}
      draggable={false}
      style={{
        width: size + 'px',
        height: size + 'px',
        objectFit: 'contain',
        flexShrink: 0,
        filter: 'drop-shadow(2px 2px 0 rgba(20,24,33,0.35))',
      }}
    />
  );
};

/** One unit's deck card (no overlay): stats + its special rule. */
const UnitDeckCard: React.FC<{ type: UnitType }> = ({ type }) => {
  const flavor = UNIT_FLAVOR[type];
  const stats = UNIT_STATS[type];
  const cells: Array<[string, string]> = [
    ['HP', String(stats.hp)],
    ['DMG', String(stats.damage)],
    ['RANGE', String(stats.range)],
    ['VISION', String(stats.vision)],
    ['AMMO', String(stats.ammo)],
    ['RESPAWN', RESPAWN_TIMERS[type] + 't'],
    ['MOVE', stats.moveCost + ' CP'],
    ['SHOT', stats.attackCost + ' CP'],
    ['REDEPLOY', RESPAWN_CP_COST[type] + ' CP'],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <UnitMapIcon type={type} label={stats.name} size={52} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 900, color: 'var(--op-ink)' }}>{stats.name.toUpperCase()}</div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--op-ink-muted)', lineHeight: 1.4, minHeight: '2.8em' }}>{flavor.tagline}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '5px' }}>
        {cells.map(([k, v]) => (
          <GeoWell key={k} coreStyle={{ padding: '5px 2px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--op-ink-muted)' }}>{k}</div>
            <div style={{ fontSize: '14px', fontWeight: 900, color: 'var(--op-ink)', fontVariantNumeric: 'tabular-nums' }}>
              {v}
            </div>
          </GeoWell>
        ))}
      </div>
      <GeoWell coreStyle={{ padding: '7px 9px', background: flavor.soft }}>
        <div style={{ fontSize: '11px', fontWeight: 900, color: flavor.ink }}>★ UNIT RULE</div>
        <div style={{ fontSize: '12px', fontWeight: 700, color: flavor.ink, lineHeight: 1.45, minHeight: '4.35em' }}>{SPECIAL_RULE[type]}</div>
      </GeoWell>
    </div>
  );
};

/** Unified guide: all three deck cards side by side on desktop, tabbed on small screens. */
export const UnitGuideModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const small = useSmallScreen();
  const [tab, setTab] = useState<UnitType>('SOLDIER');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const visible: UnitType[] = small ? [tab] : ORDER;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Squad unit guide"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(20,24,33,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.15s ease-out',
      }}
    >
      <div style={{ width: 'min(880px, 94vw)', maxHeight: '90dvh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <GeoCard>
          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '16px', fontWeight: 900, color: 'var(--op-ink)', letterSpacing: '0.4px' }}>
                  SQUAD GUIDE
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--op-ink-muted)' }}>
                  Every unit's stats, rule and shared deeds
                </div>
              </div>
              <GeoButton onClick={onClose} coreStyle={{ padding: '4px 10px' }} aria-label="Close squad guide">
                ✕
              </GeoButton>
            </div>

            {small && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
                {ORDER.map(t => (
                  <GeoButton
                    key={t}
                    fullWidth
                    variant={tab === t ? 'blue' : 'default'}
                    onClick={() => setTab(t)}
                    coreStyle={{ padding: '7px 4px', fontSize: '12px' }}
                  >
                    {UNIT_STATS[t].name.toUpperCase()}
                  </GeoButton>
                ))}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: small ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
              {visible.map(t => (
                <UnitDeckCard key={t} type={t} />
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--op-line)', paddingTop: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.6px', marginBottom: '5px' }}>
                EVERY UNIT CAN
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: small ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: '4px 12px' }}>
                {ALL_DEEDS.map(d => (
                  <div key={d} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--op-ink)' }}>
                    <GeoChip variant="softMint" style={{ padding: '0 7px', flexShrink: 0, marginTop: '1px' }}>✓</GeoChip>
                    <span>{d}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 600, lineHeight: 1.5 }}>
              Kills promote Recruit → Veteran → Elite → Ace: +max HP, +ammo and new perks each rank.
            </div>

            <GeoButton variant="blue" fullWidth onClick={onClose} coreStyle={{ padding: '10px' }}>
              GOT IT
            </GeoButton>
          </div>
        </GeoCard>
      </div>
    </div>,
    document.body,
  );
};
