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

  it('rack_aux_intent traduz scope para texto legível', () => {
    const d = formatActivityEvent('rack_aux_intent', {
      rackId: 'dcceeee3-5e5e-4ed2-ed914a0faf',
      scope: 'rack_miner_equip:dcceeee3-5e5e-4ed2-ed914a0faf:5',
      ok: true,
      source: 'intent_api'
    });
    expect(d.title).toBe('GPU / ASIC montado');
    expect(d.summary).toBe('Equipou miner no slot 5');
    expect(d.summary).not.toContain('rackId');
  });

  it('mining_rack_update traduz campos alterados', () => {
    const d = formatActivityEvent('mining_rack_update', {
      rackId: 'abc-123',
      changed: ['miners', 'battery']
    });
    expect(d.summary).toBe('Alterou: GPUs / ASICs, bateria');
    expect(d.summary).not.toContain('abc');
  });
});
