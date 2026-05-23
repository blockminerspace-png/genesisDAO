import { describe, it, expect } from 'vitest';
import {
  formatUserActivityMeta,
  ACTIVITY_LOG_FILTER_GROUPS,
  filterUserActivityLogs,
  formatAccountCreatedBrt
} from '../utils/adminUserActivityLog';
import type { GameUserActivityEntry } from '../types';

describe('adminUserActivityLog', () => {
  it('formatUserActivityMeta', () => {
    expect(formatUserActivityMeta(null)).toBe('—');
    expect(formatUserActivityMeta({ a: 1 })).toBe('{"a":1}');
    const big = { x: 'y'.repeat(500) };
    expect(formatUserActivityMeta(big).length).toBeLessThanOrEqual(422);
  });

  it('formatAccountCreatedBrt', () => {
    const s = formatAccountCreatedBrt(Date.parse('2026-06-15T18:30:00.000Z'));
    expect(s).toBeTruthy();
    expect(formatAccountCreatedBrt(null)).toBeNull();
  });

  it('ACTIVITY_LOG_FILTER_GROUPS cobre ações típicas', () => {
    const deposit = ACTIVITY_LOG_FILTER_GROUPS.find((g) => g.id === 'deposit');
    expect(deposit?.test?.('usdc_deposit_confirmed')).toBe(true);
    const roleta = ACTIVITY_LOG_FILTER_GROUPS.find((g) => g.id === 'roleta');
    expect(roleta?.test?.('roleta_roll')).toBe(true);
    const signup = ACTIVITY_LOG_FILTER_GROUPS.find((g) => g.id === 'signup_complete');
    expect(signup?.test?.('signup_complete')).toBe(true);
    expect(signup?.test?.('login')).toBe(false);
  });

  it('filterUserActivityLogs near_account_creation usa janela ±5 min', () => {
    const t0 = 1_000_000_000_000;
    const rows: GameUserActivityEntry[] = [
      { id: '1', action: 'x', meta: {}, createdAt: t0 - 4 * 60 * 1000 },
      { id: '2', action: 'y', meta: {}, createdAt: t0 - 10 * 60 * 1000 }
    ];
    const out = filterUserActivityLogs(rows, 'near_account_creation', '', { accountCreatedAtMs: t0 });
    expect(out.map((r) => r.id)).toEqual(['1']);
  });
});
