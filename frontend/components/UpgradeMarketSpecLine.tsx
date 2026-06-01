import React from 'react';
import type { Upgrade } from '../types';
import { getUpgradeMarketSpecs } from '../lib/upgradeMarketSpec';

const TONE_CLASS = {
  green: 'text-emerald-400',
  orange: 'text-orange-400',
  sky: 'text-sky-400',
  yellow: 'text-yellow-400',
  slate: 'text-slate-400'
} as const;

type Props = {
  item: Upgrade;
  catalog?: Upgrade[];
  className?: string;
  /** Mostra só o valor (sem label) — mais compacto nos cards. */
  compact?: boolean;
};

export const UpgradeMarketSpecLine: React.FC<Props> = ({ item, catalog = [], className = '', compact = true }) => {
  const specs = getUpgradeMarketSpecs(item, catalog);
  if (specs.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-x-2 gap-y-0.5 ${className}`}>
      {specs.map((s) => (
        <span
          key={`${s.label}-${s.value}`}
          className={`text-[10px] font-mono leading-snug ${TONE_CLASS[s.tone || 'slate']}`}
          title={`${s.label}: ${s.value}`}
        >
          {compact ? s.value : `${s.label}: ${s.value}`}
        </span>
      ))}
    </div>
  );
};
