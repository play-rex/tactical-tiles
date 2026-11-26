import React, { useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import {
  UNIT_STATS,
  TERRAIN_DEFENSE,
  TERRAIN_COSTS,
  RESPAWN_CP_COST,
  CP_SYSTEM,
  BASE_STATS,
  BANK_STATS,
  VETERANCY_CONFIG,
  OVERWATCH_STATS,
} from '@tactical/engine/constants/Config';
import { UnitType } from '@tactical/engine/types';
import { GeoButton, GeoCard, GeoChip, GeoWell } from '../components/ui/GeoPrimitives';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <GeoCard style={{ marginBottom: '20px' }}>
    <div style={{ padding: '20px' }}>
      <h3
        style={{
          color: 'var(--acc-mint-ink)',
          borderBottom: '1.5px solid var(--op-line)',
          paddingBottom: '8px',
          marginTop: 0,
          marginBottom: '14px',
          fontSize: '15px',
          fontWeight: 900,
          letterSpacing: '0.6px',
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  </GeoCard>
);

const StatRow: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '6px 0',
      borderBottom: '1px solid var(--op-line)',
      fontSize: '13px',
    }}
  >
    <span style={{ color: 'var(--op-ink-muted)', fontWeight: 600 }}>{label}</span>
    <span style={{ fontWeight: 800, color: 'var(--op-ink)' }}>{value}</span>
  </div>
);

export const HowToPlay: React.FC = () => {
  const exitTutorial = useGameStore(state => state.exitTutorial);
  const [activeTab, setActiveTab] = useState<'GUIDE' | 'INTEL'>('GUIDE');

  return (
    <div
      className="opgeo-stage"
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: '12px',
        gap: '12px',
        overflow: 'hidden',
      }}
    >
      {/* Top Manual Bar */}
      <GeoCard>
        <div
          style={{
            padding: '10px 18px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 900, letterSpacing: '0.8px' }}>
              TACTICAL FIELD MANUAL
            </h2>
            <GeoChip variant="softAmber">CLASSIFIED BRIEFING</GeoChip>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GeoButton
              variant={activeTab === 'GUIDE' ? 'blue' : 'default'}
              onClick={() => setActiveTab('GUIDE')}
              coreStyle={{ padding: '8px 14px' }}
            >
              MISSION BRIEFING
            </GeoButton>
            <GeoButton
              variant={activeTab === 'INTEL' ? 'blue' : 'default'}
              onClick={() => setActiveTab('INTEL')}
              coreStyle={{ padding: '8px 14px' }}
            >
              TECHNICAL SPECS
            </GeoButton>
            <GeoButton variant="red" onClick={exitTutorial} coreStyle={{ padding: '8px 14px' }}>
              RETURN TO OPERATIONS
            </GeoButton>
          </div>
        </div>
      </GeoCard>

      {/* Scrollable Content */}
      <div className="opgeo-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '6px 4px 28px 4px' }}>
          {activeTab === 'GUIDE' && (
            <div>
              <Section title="1. CORE COMBAT LOOP">
                <p style={{ lineHeight: 1.6, color: 'var(--op-ink)', fontSize: '14px', marginTop: 0 }}>
                  Commander, your goal is to secure the sector using a squad of specialists. Victory requires careful management of your <strong>Command Points (CP)</strong> and terrain cover. Player 1 starts Round 1 with {CP_SYSTEM.P1_ROUND1_CP} CP for opening initiative; all players regenerate {CP_SYSTEM.REGEN_AMOUNT} CP per turn up to {CP_SYSTEM.MAX_CP}.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', marginTop: '14px' }}>
                  {[
                    ['🚀 DEPLOY', 'var(--acc-mint-ink)', 'Spawn units from your HQ using Euros.'],
                    ['🏃 MANEUVER', 'var(--acc-blue-ink)', 'Spend CP to move. Terrain affects cost.'],
                    ['🎯 ENGAGE', 'var(--acc-red-ink)', 'Attack enemies or siege bases with LOS.'],
                    ['💰 ECONOMY', 'var(--acc-amber-ink)', 'Crack Bank vaults and secure Buildings.'],
                  ].map(([title, col, desc]) => (
                    <GeoWell key={title} coreStyle={{ padding: '14px', textAlign: 'center' }}>
                      <div style={{ fontWeight: 900, fontSize: '14px', color: col, marginBottom: '6px' }}>{title}</div>
                      <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', lineHeight: 1.45 }}>{desc}</div>
                    </GeoWell>
                  ))}
                </div>
              </Section>

              <Section title="2. OPERATIONAL MODES">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
                  <GeoWell coreStyle={{ padding: '14px' }}>
                    <h4 style={{ color: 'var(--acc-amber-ink)', margin: '0 0 6px 0', fontSize: '14px' }}>👑 CONQUER MODE</h4>
                    <p style={{ margin: 0, color: 'var(--op-ink)', fontSize: '13px', lineHeight: 1.55 }}>
                      <strong>Objective:</strong> Destroy the enemy <strong>HEADQUARTERS (BASE)</strong>. Enemy Bases have <strong>{BASE_STATS.HP} HP</strong> (20% armored cover). Watchtowers and Breachers/Snipers deal stronger siege damage.
                    </p>
                  </GeoWell>
                  <GeoWell coreStyle={{ padding: '14px' }}>
                    <h4 style={{ color: 'var(--acc-red-ink)', margin: '0 0 6px 0', fontSize: '14px' }}>☠️ DEATHMATCH (DOOMSDAY)</h4>
                    <p style={{ margin: 0, color: 'var(--op-ink)', fontSize: '13px', lineHeight: 1.55 }}>
                      <strong>Objective:</strong> Eliminate <strong>ALL</strong> enemy units. If Doomsday is enabled, a <strong>safe circle</strong> closes around a random, balanced point on the map — the first lava appears around Turn 8 on small boards and Turn 10 on large ones, then closes in seven stages. Anything outside the circle becomes <strong>LAVA</strong>; Collapse adds <strong>+2 CP regen</strong>, and <strong>Meltdown</strong> raises it to <strong>+4 CP regen</strong>.
                    </p>
                  </GeoWell>
                </div>
              </Section>

              <Section title="3. INFRASTRUCTURE & AUTOMATED DEFENSES">
                <p style={{ color: 'var(--op-ink-muted)', fontSize: '13px', fontStyle: 'italic', marginTop: 0 }}>
                  Neutral Banks and Headquarters defend their perimeters automatically each turn.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
                  <GeoWell coreStyle={{ padding: '14px' }}>
                    <div style={{ fontWeight: 900, fontSize: '14px', color: 'var(--acc-amber-ink)', marginBottom: '6px' }}>BANK VAULT</div>
                    <div style={{ fontSize: '13px', marginBottom: '6px' }}>A 15 HP structure. Action: <strong>SIEGE</strong> it with Scouts or Breachers — <strong>Snipers can't crack vaults</strong>. Cash vaults hold €100–300 (take gold or +10 CP); dry vaults hold intel (+12 CP instantly).</div>
                    <div style={{ fontSize: '12px', color: 'var(--acc-red-ink)', fontWeight: 700 }}>
                      Proximity Turret: {BANK_STATS.RANGE} Tile Range • {BANK_STATS.DAMAGE} DMG/turn until looted.
                    </div>
                  </GeoWell>
                  <GeoWell coreStyle={{ padding: '14px' }}>
                    <div style={{ fontWeight: 900, fontSize: '14px', color: 'var(--acc-blue-ink)', marginBottom: '6px' }}>HEADQUARTERS (BASE)</div>
                    <div style={{ fontSize: '13px', marginBottom: '6px' }}>Unit respawn &amp; shop drop center. Primary Conquer target.</div>
                    <div style={{ fontSize: '12px', color: 'var(--acc-red-ink)', fontWeight: 700 }}>
                      Heavy Artillery: {BASE_STATS.RANGE} Tile Range • {BASE_STATS.MIN_DMG}-{BASE_STATS.MAX_DMG} DMG to weakest enemy + {BASE_STATS.SPLASH_MIN_DMG}-{BASE_STATS.SPLASH_MAX_DMG} splash to every other enemy in range.
                    </div>
                  </GeoWell>
                </div>
              </Section>

              <Section title="4. METEOROLOGICAL WEATHER ZONES">
                <p style={{ color: 'var(--op-ink)', fontSize: '13px', marginTop: 0 }}>
                  The battlefield is divided into Voronoi Zones with local weather shifting every <strong>5 Turns</strong>.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
                  {[
                    ['🔥 SCORCHED', '#C2410C', 'Plains & Sand cost 2x CP to move (Rank 2+ Scouts immune).'],
                    ['🌧️ MONSOON', '#1344C4', 'Plains turn to mud (2x Move Cost; Rank 2+ Scouts immune).'],
                    ['🌫️ FOG', '#475569', 'Vision capped at 2 Tiles; Snipers limited to 3 range.'],
                    ['🍃 TAILWIND', '#046C3E', '+1 Attack Range for all units; Plains cost 0.5x Move Cost.'],
                    ['🌪️ SANDSTORM', '#8D5B1C', 'Vision Range capped at 3 Tiles; Sand costs 2x Move Cost.'],
                    ['☀️ CLEAR', 'var(--op-ink)', 'No modifiers. Standard engagement rules apply.'],
                  ].map(([name, col, effect]) => (
                    <GeoWell key={name} coreStyle={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 900, fontSize: '13px', color: col, marginBottom: '3px' }}>{name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)' }}>{effect}</div>
                    </GeoWell>
                  ))}
                </div>
              </Section>

              <Section title="5. LOGISTICS (FIELD SHOP)">
                <ul style={{ color: 'var(--op-ink)', fontSize: '13px', lineHeight: 1.75, margin: 0, paddingLeft: '20px' }}>
                  <li><strong>Ammo Drop (50€) / First Aid Kit (100€) / Medkit (200€):</strong> First Aid restores 50% max HP; Medkit heals to full. Delivered via Drop Pod.</li>
                  <li><strong>Land Mine (75€):</strong> Hidden trap (visible only to you) dealing 8 DMG and halting enemy movement. Cannot be placed within 5 tiles of an enemy HQ.</li>
                  <li><strong>Barrier x3 (150€) / Bridge (100€) / Tunnel (125€):</strong> Click up to 3 tiles to build 10 HP waist-high cover walls, place water/canyon bridges, or blast a tunnel through a mountain for 1-CP travel (no cover inside).</li>
                  <li><strong>Field Reload (5 CP):</strong> Emergency unit action restoring 50% max ammo immediately (ends unit turn).</li>
                  <li><strong>Retrieval Protocol:</strong> Move adjacent to or onto a supply pod and spend <strong>4 CP</strong> (RETRIEVE SUPPLY).</li>
                </ul>
              </Section>

              <Section title="6. UNIT VETERANCY & SECTOR SEEDS">
                <p style={{ color: 'var(--op-ink)', fontSize: '13px', lineHeight: 1.6, marginTop: 0 }}>
                  Units earn XP from attacks (+1 XP), kills (+2 XP, +3 vs Elite/Ace), Bank breaches (+2 XP), Base Destruction (+2 XP), and first Building captures (+1 XP). Respawned units reset to Recruit.
                </p>
                <ul style={{ color: 'var(--op-ink)', fontSize: '13px', lineHeight: 1.75, margin: 0, paddingLeft: '20px' }}>
                  <li><strong>★ Veteran ({VETERANCY_CONFIG.XP_THRESHOLDS[1]} XP):</strong> +20% Max HP (heals gained HP) and +2 Max Ammo (Scout/Breacher) or +1 Max Ammo (Sniper).</li>
                  <li><strong>★★ Elite ({VETERANCY_CONFIG.XP_THRESHOLDS[2]} XP):</strong> Scout +1 Vision &amp; clears Scorched/Monsoon Plains penalty; Breacher -{VETERANCY_CONFIG.ELITE_BREACHER_COVER_DR} DMG in Cover &amp; resists Overwatch pins; Sniper +{VETERANCY_CONFIG.ELITE_SNIPER_DMG_BONUS} DMG &amp; 7 CP shot.</li>
                  <li><strong>★★★ Ace ({VETERANCY_CONFIG.XP_THRESHOLDS[3]} XP):</strong> +20% more Max HP; Scout +{VETERANCY_CONFIG.ACE_SCOUT_DMG_BONUS} DMG &amp; 2 CP shot; Breacher +{VETERANCY_CONFIG.ACE_BREACHER_DMG_BONUS} DMG &amp; pierces Base Armor; Sniper 1 CP Mountain/Dunes move. Killing an Ace pays <strong>+€{VETERANCY_CONFIG.ACE_BOUNTY_GOLD} Bounty Euros</strong>.</li>
                </ul>
              </Section>

              <Section title="7. OVERWATCH & FOG AMBUSH">
                <ul style={{ color: 'var(--op-ink)', fontSize: '13px', lineHeight: 1.75, margin: 0, paddingLeft: '20px' }}>
                  <li><strong>Stance Costs &amp; Refunds (O key):</strong> Scout {OVERWATCH_STATS.SOLDIER.cost} CP ({OVERWATCH_STATS.SOLDIER.damage} DMG, +{OVERWATCH_STATS.SOLDIER.refund} CP refund) • Breacher {OVERWATCH_STATS.ASSAULTER.cost} CP ({OVERWATCH_STATS.ASSAULTER.damage} DMG, +{OVERWATCH_STATS.ASSAULTER.refund} CP) • Sniper {OVERWATCH_STATS.SNIPER.cost} CP ({OVERWATCH_STATS.SNIPER.damage} DMG, +{OVERWATCH_STATS.SNIPER.refund} CP).</li>
                  <li><strong>Interception &amp; Counterplay:</strong> Fires on first entering enemy and pins them (★★ Elite Breachers resist pins). Any damage suppresses Overwatch; Barriers/Fog/Sandstorms block Overwatch lines.</li>
                </ul>
              </Section>

              <Section title="8. TACTICAL OPS & SETUP MUTATORS">
                <ul style={{ color: 'var(--op-ink)', fontSize: '13px', lineHeight: 1.75, margin: 0, paddingLeft: '20px' }}>
                  <li><strong>Classic CP:</strong> 20 MAX CP battery with +10 CP/turn regeneration (15 CP opening turn).</li>
                  <li><strong>Scarcity:</strong> Cuts unit starting &amp; max ammo by 50% while boosting Bank vault rewards +50%.</li>
                  <li><strong>Ironman:</strong> Sets graveyard respawns to 0 — every loss is permanent.</li>
                </ul>
              </Section>
            </div>
          )}

          {activeTab === 'INTEL' && (
            <div>
              <Section title="UNIT CLASSIFICATIONS">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
                  {Object.entries(UNIT_STATS).map(([key, stats]) => (
                    <GeoWell key={key} coreStyle={{ padding: '16px' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderBottom: '1.5px solid var(--op-line)',
                          paddingBottom: '8px',
                          marginBottom: '8px',
                        }}
                      >
                        <strong style={{ fontSize: '15px' }}>{stats.name.toUpperCase()}</strong>
                        <GeoChip variant="softAmber">Redeploy {RESPAWN_CP_COST[key as UnitType]} CP</GeoChip>
                      </div>
                      <StatRow label="HP" value={stats.hp} />
                      <StatRow label="Attack" value={stats.damage} />
                      <StatRow label="Range" value={stats.range} />
                      <StatRow label="Attack Cost" value={`${stats.attackCost} CP`} />
                      <StatRow label="Move Cost" value={`${stats.moveCost}x`} />
                      <StatRow label="Ammo Capacity" value={stats.maxAmmo} />
                      <StatRow label="Vision Radius" value={stats.vision} />
                      {key === 'SNIPER' && (
                        <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--acc-amber-ink)', fontWeight: 700 }}>
                          *Restriction: Can only fire from Mountains, Dunes, or Owned Buildings.
                        </div>
                      )}
                    </GeoWell>
                  ))}
                </div>
              </Section>

              <Section title="TERRAIN DATABASE">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: 'var(--op-well)', color: 'var(--op-ink)' }}>
                        <th style={{ padding: '10px 12px' }}>Type</th>
                        <th style={{ padding: '10px 12px' }}>Defense</th>
                        <th style={{ padding: '10px 12px' }}>Move Cost</th>
                        <th style={{ padding: '10px 12px' }}>Tactical Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(TERRAIN_DEFENSE).map((key, i) => {
                        const def = Math.round(TERRAIN_DEFENSE[key] * 100);
                        const defColor = def < 0 ? 'var(--acc-red-ink)' : def > 0 ? 'var(--acc-mint-ink)' : 'var(--op-ink-muted)';
                        return (
                          <tr key={key} style={{ background: i % 2 === 0 ? '#FFFFFF' : '#F3F6FA', borderBottom: '1px solid var(--op-line)' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 800 }}>{key}</td>
                            <td style={{ padding: '10px 12px', fontWeight: 800, color: defColor }}>
                              {def !== 0 ? `${def > 0 ? '+' : ''}${def}%` : '-'}
                            </td>
                            <td style={{ padding: '10px 12px', fontWeight: 700 }}>{TERRAIN_COSTS[key] >= 99 ? 'Impassable' : TERRAIN_COSTS[key]}</td>
                            <td style={{ padding: '10px 12px', color: 'var(--op-ink-muted)' }}>
                              {key === 'MOUNTAIN' && 'Sniper Only. High ground perch; blocks Scout/Breacher movement & ground LOS.'}
                              {key === 'FOREST' && 'Provides 40% Cover.'}
                              {key === 'SAND' && 'Exposed Terrain (-10% Defense).'}
                              {key === 'DUNES' && 'High Ground. Blocks Line of Sight.'}
                              {key === 'QUICKSAND' && 'Traps units (Rooted) for 1 Turn.'}
                              {key === 'CANYON' && 'Impassable. Allows shooting over.'}
                              {key === 'BUILDING' && 'Blocks neutral/enemy passage. Capture adjacent (+5€/t); Bunkers house infantry, Watchtowers seat Snipers.'}
                              {key === 'WATER' && 'Impassable without Bridge.'}
                              {key === 'BARRIER' && 'Blocks movement; 80% defensive cover.'}
                              {key === 'TUNNEL' && 'Blasted passage: 1-CP travel through mountains, no cover.'}
                              {key === 'BASE' && 'Headquarters. Impassable; 20% siege armor.'}
                              {key === 'BANK' && 'Vault structure. Impassable; breach via siege (20% armor).'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
