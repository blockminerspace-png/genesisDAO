import { describe, it, expect } from 'vitest';
import { formatActivityEvent, matchesActivityFilter } from '../lib/activityEventFormatter.js';

describe('activityEventFormatter', () => {
  it('login_success', () => {
    const d = formatActivityEvent('login_success', { ip: '10.0.0.1' });
    expect(d.category).toBe('auth');
    expect(d.summary).toContain('10.0.0.1');
  });

  it('matchesActivityFilter losses', () => {
    const d = formatActivityEvent('inventory_loss_alert', {
      itemId: 'a',
      before: 2,
      after: 0,
      delta: -2
    });
    expect(matchesActivityFilter(d, 'inventory_loss_alert', 'losses')).toBe(true);
    expect(matchesActivityFilter(d, 'login_success', 'losses')).toBe(false);
  });
});
