import { describe, it, expect } from 'vitest';
import { formatActivityEvent, filterUserActivityLogs } from '../utils/activityEventFormatter';

describe('activityEventFormatter', () => {
  it('formata login_success em português', () => {
    const d = formatActivityEvent('login_success', { ip: '1.2.3.4' });
    expect(d.title).toMatch(/login/i);
    expect(d.summary).toContain('1.2.3.4');
    expect(d.category).toBe('auth');
  });

  it('formata session_state_snapshot', () => {
    const d = formatActivityEvent('session_state_snapshot', {
      economy: { usdc: 100 },
      inventory: { distinctItems: 2, totalQty: 5 },
      rigs: { count: 1 },
      boxes: { totalQty: 0 },
      batteries: { count: 0 },
      fingerprint: 'abc'
    });
    expect(d.category).toBe('session');
    expect(d.summary).toContain('USDC');
  });

  it('formata perda de stock', () => {
    const d = formatActivityEvent('inventory_loss_alert', {
      itemId: 'x',
      itemName: 'Miner X',
      before: 5,
      after: 2,
      delta: -3,
      source: 'save-game'
    });
    expect(d.severity).toBe('danger');
    expect(d.summary).toContain('5');
    expect(d.summary).toContain('2');
  });

  it('filterUserActivityLogs losses', () => {
    const rows = [
      {
        id: '1',
        action: 'login_success',
        meta: {},
        createdAt: 1,
        display: formatActivityEvent('login_success', {})
      },
      {
        id: '2',
        action: 'stock_delta',
        meta: { before: 3, after: 1 },
        createdAt: 2,
        display: formatActivityEvent('stock_delta', { before: 3, after: 1, delta: -2 })
      }
    ];
    const out = filterUserActivityLogs(rows, 'losses', '');
    expect(out.map((r) => r.id)).toEqual(['2']);
  });
});
