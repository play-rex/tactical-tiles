import React from 'react';

export type GeoVariant =
  | 'default'
  | 'blue'
  | 'mint'
  | 'amber'
  | 'red'
  | 'violet'
  | 'softBlue'
  | 'softMint'
  | 'softAmber'
  | 'softRed'
  | 'softViolet';

const VARIANT_STYLES: Record<GeoVariant, { bg: string; color: string; rim?: string }> = {
  default: { bg: 'linear-gradient(180deg, #FFFFFF 0%, #F3F6FB 100%)', color: 'var(--op-ink)' },
  blue: { bg: 'var(--acc-blue)', color: '#FFFFFF', rim: '#1444B8' },
  mint: { bg: 'var(--acc-mint)', color: '#FFFFFF', rim: '#026B3D' },
  amber: { bg: 'var(--acc-amber)', color: '#1C1200', rim: '#B86B00' },
  red: { bg: 'var(--acc-red)', color: '#FFFFFF', rim: '#992116' },
  violet: { bg: 'var(--acc-violet)', color: '#FFFFFF', rim: '#4C2EC4' },
  softBlue: { bg: 'var(--acc-blue-soft)', color: 'var(--acc-blue-ink)' },
  softMint: { bg: 'var(--acc-mint-soft)', color: 'var(--acc-mint-ink)' },
  softAmber: { bg: 'var(--acc-amber-soft)', color: 'var(--acc-amber-ink)' },
  softRed: { bg: 'var(--acc-red-soft)', color: 'var(--acc-red-ink)' },
  softViolet: { bg: 'var(--acc-violet-soft)', color: 'var(--acc-violet-ink)' },
};

/** Converts a CSS `#RRGGBB` hex string into a numeric 0xRRGGBB PixiJS color. */
export const hexToPixiColor = (hex: string): number => parseInt(hex.replace('#', ''), 16);

/** High-contrast light-mode theme mapping for all 6 faction colors. */
export const PLAYER_UI_THEME: Record<number, { badgeBg: string; badgeText: string; ink: string; border: string }> = {
  0: { badgeBg: '#E53935', badgeText: '#FFFFFF', ink: '#C62828', border: '#E53935' },
  1: { badgeBg: '#1E88E5', badgeText: '#FFFFFF', ink: '#1565C0', border: '#1E88E5' },
  2: { badgeBg: '#2E7D32', badgeText: '#FFFFFF', ink: '#1B5E20', border: '#2E7D32' },
  3: { badgeBg: '#FDD835', badgeText: '#1C1200', ink: '#8D6200', border: '#D4A000' },
  4: { badgeBg: '#8E24AA', badgeText: '#FFFFFF', ink: '#6A1B9A', border: '#8E24AA' },
  5: { badgeBg: '#0097A7', badgeText: '#FFFFFF', ink: '#006978', border: '#0097A7' },
};

interface GeoCardProps {
  children: React.ReactNode;
  armed?: boolean;
  accentColor?: string;
  fill?: boolean;
  hug?: boolean;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
}

/** Chamfered OP hardware card with offset steel parallax backplate. */
export const GeoCard: React.FC<GeoCardProps> = ({
  children,
  armed = false,
  accentColor,
  fill = false,
  hug = false,
  style,
  bodyStyle,
  className = '',
  onClick,
}) => {
  const rimStyle: React.CSSProperties | undefined = accentColor
    ? { background: `linear-gradient(135deg, ${accentColor} 0%, #98A3B6 65%, ${accentColor}99 100%)` }
    : undefined;

  return (
    <div
      onClick={onClick}
      className={`geo-drop ${fill ? 'geo-fill' : ''} ${hug ? 'geo-hug' : ''} ${className}`}
      style={style}
    >
      <div className="geo-backplate" />
      <div className={`geo-rim ${armed ? 'armed' : ''}`} style={rimStyle}>
        <div className="geo-body" style={bodyStyle}>
          {children}
        </div>
      </div>
    </div>
  );
};

interface GeoWellProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  coreStyle?: React.CSSProperties;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

/** Chamfered recessed aluminum stat/info well. */
export const GeoWell: React.FC<GeoWellProps> = ({
  children,
  style,
  coreStyle,
  className = '',
  onClick,
}) => (
  <div className={`geo-well-rim ${className}`} style={style} onClick={onClick}>
    <div className="geo-well-core" style={{ padding: '8px 10px', ...coreStyle }}>
      {children}
    </div>
  </div>
);

interface GeoButtonProps {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: GeoVariant;
  fullWidth?: boolean;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit' | 'reset';
  style?: React.CSSProperties;
  coreStyle?: React.CSSProperties;
}

/** Tactile chamfered push-keycap button matching OP-Chamfer Geo geometry. */
export const GeoButton: React.FC<GeoButtonProps> = ({
  children,
  onClick,
  variant = 'default',
  fullWidth = false,
  disabled = false,
  title,
  type = 'button',
  style,
  coreStyle,
}) => {
  const v = VARIANT_STYLES[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`geo-btn-wrap ${fullWidth ? 'full' : ''}`}
      style={style}
    >
      <span
        className="geo-btn-rim"
        style={v.rim ? { background: `linear-gradient(180deg, ${v.rim}88 0%, ${v.rim} 100%)` } : undefined}
      >
        <span
          className="geo-btn-core"
          style={{
            background: v.bg,
            color: v.color,
            padding: '7px 12px',
            ...coreStyle,
          }}
        >
          {children}
        </span>
      </span>
    </button>
  );
};

interface GeoChipProps {
  children: React.ReactNode;
  variant?: GeoVariant;
  style?: React.CSSProperties;
}

/** Chamfered inline tag / pill / badge. */
export const GeoChip: React.FC<GeoChipProps> = ({ children, variant = 'softBlue', style }) => {
  const v = VARIANT_STYLES[variant];
  return (
    <span
      className="geo-chip"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '3px 9px',
        fontSize: '12px',
        fontWeight: 800,
        background: v.bg,
        color: v.color,
        ...style,
      }}
    >
      {children}
    </span>
  );
};

interface GeoToggleProps {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  variant?: 'mint' | 'amber';
}

/** Hardware rocker switch styled as a chamfered push-toggle row. */
export const GeoToggle: React.FC<GeoToggleProps> = ({
  label,
  value,
  onChange,
  disabled = false,
  variant = 'mint',
}) => {
  const activeBg = variant === 'amber' ? 'var(--acc-amber-soft)' : 'var(--acc-mint-soft)';
  const activeInk = variant === 'amber' ? 'var(--acc-amber-ink)' : 'var(--acc-mint-ink)';
  const dotColor = value ? activeInk : '#8A96AB';

  return (
    <GeoButton
      onClick={() => {
        if (!disabled) onChange(!value);
      }}
      disabled={disabled}
      fullWidth
      coreStyle={{
        background: value ? activeBg : 'var(--op-well)',
        color: value ? activeInk : 'var(--op-ink-muted)',
        justifyContent: 'space-between',
        padding: '9px 12px',
      }}
    >
      <span style={{ textAlign: 'left', fontWeight: 700 }}>{label}</span>
      <span
        className="geo-chip"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          padding: '2px 8px',
          background: value ? '#FFFFFF' : '#CBD3E0',
          color: dotColor,
          fontSize: '12px',
          fontWeight: 800,
        }}
      >
        <span
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: dotColor,
          }}
        />
        {value ? 'ON' : 'OFF'}
      </span>
    </GeoButton>
  );
};
