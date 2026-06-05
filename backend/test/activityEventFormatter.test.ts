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
    const login = formatActivityEvent('login_success', { ip: '1.2.3.4' });
    expect(matchesActivityFilter(login, 'login_success', 'losses')).toBe(false);
  });

  it('rack_aux_intent com itemName mostra equip legível', () => {
    const d = formatActivityEvent('rack_aux_intent', {
      scope: 'rack_miner_equip:abc-rack:4',
      itemId: 'gpu_v4',
      itemName: 'Gamer Bee',
      slotIndex: 4,
      ok: true
    });
    expect(d.title).toBe('Equipou na rig');
    expect(d.summary).toContain('Gamer Bee');
    expect(d.summary).toContain('slot 4');
  });

  it('support_attachment_download legível', () => {
    const d = formatActivityEvent('support_attachment_download', {
      file: 'support-18736.png',
      ticketId: 'aa988cc5-cf90-4c0a-aed9-419be2f204b5'
    });
    expect(d.title).toBe('Anexo de suporte transferido');
    expect(d.summary).toContain('support-18736.png');
    expect(d.summary).not.toContain('file=');
  });

  it('room_coin_bulk legível', () => {
    const d = formatActivityEvent('room_coin_bulk', {
      roomId: 'room_initial',
      coinId: '94a1a3bc-abcc-4717-81e1-1c0a828a9526'
    });
    expect(d.summary).toContain('Sala inicial');
    expect(d.summary).not.toContain('roomId=');
  });

  it('rack_aux_intent scope-only fallback slot', () => {
    const d = formatActivityEvent('rack_aux_intent', {
      rackId: 'dcceeee3-5e5e-4ed2-ed914a0faf',
      scope: 'rack_miner_equip:dcceeee3-5e5e-4ed2-ed914a0faf:5',
      ok: true,
      source: 'intent_api'
    });
    expect(d.title).toBe('Equipou na rig');
    expect(d.summary).toContain('slot 5');
  });

  it('hardware_buy lista itens e USDC', () => {
    const d = formatActivityEvent('hardware_buy', {
      totalUsdc: 0.75,
      newUsdc: 0.08,
      lines: [{ id: 'gpu_v4', qty: 1, name: 'Gamer Raw' }],
      source: 'shop_checkout'
    });
    expect(d.title).toBe('Comprou hardware');
    expect(d.summary).toContain('0.75');
    expect(d.lines?.some((l) => l.includes('Gamer Raw'))).toBe(true);
  });

  it('inventory_loss_alert com after 0 explica verificação', () => {
    const d = formatActivityEvent('inventory_loss_alert', {
      itemId: 'gpu_v4',
      itemName: 'Gamer Raw',
      before: 2,
      after: 0,
      delta: -2,
      source: 'save-game'
    });
    expect(d.title).toContain('sumiu');
    expect(d.lines?.some((l) => /rig\/sala|P2P|órfão/i.test(l))).toBe(true);
  });

  it('orphan_risk_detected legível', () => {
    const d = formatActivityEvent('orphan_risk_detected', {
      kind: 'rack_battery_uuid',
      count: 2,
      autoRecover: false
    });
    expect(d.title).toContain('órfão');
    expect(d.summary).toContain('2');
  });
});
