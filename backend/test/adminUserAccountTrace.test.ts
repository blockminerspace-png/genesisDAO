import { describe, expect, it } from 'vitest';
import {
  buildItemDisposition,
  formatP2pTradeEvent,
  mergeTimelineEvents,
  type AccountTraceEvent
} from '../services/adminUserAccountTrace.service.js';

describe('buildItemDisposition', () => {
  it('fecha contas quando item está na rig', () => {
    const rows = buildItemDisposition({
      itemNames: new Map([['gpu_v4', 'Gamer Bee']]),
      stock: new Map(),
      onRigs: new Map([
        [
          'gpu_v4',
          [{ rackId: 'a34b4abc-5e7f-4fbf-98db-3e586d0defdb', slotIndex: 1, roomId: 'room_initial' }]
        ]
      ]),
      listedP2p: new Map(),
      acquired: new Map([['gpu_v4', 1]]),
      soldP2p: new Map()
    });
    const gpu = rows.find((r) => r.itemId === 'gpu_v4');
    expect(gpu).toBeDefined();
    expect(gpu!.unaccounted).toBe(0);
    expect(gpu!.onRigs).toHaveLength(1);
    expect(gpu!.hint).toMatch(/Montado na rig/);
  });

  it('sinaliza unaccounted quando adquirido não localizado', () => {
    const rows = buildItemDisposition({
      itemNames: new Map([['gpu_v2', 'GPU']]),
      stock: new Map(),
      onRigs: new Map(),
      listedP2p: new Map(),
      acquired: new Map([['gpu_v2', 2]]),
      soldP2p: new Map()
    });
    expect(rows[0].unaccounted).toBe(2);
    expect(rows[0].hint).toMatch(/Sem localização/);
  });

  it('caso Osvaldo: gpu_v4 na rig, zero unaccounted', () => {
    const rows = buildItemDisposition({
      itemNames: new Map([['gpu_v4', 'Gamer Bee']]),
      stock: new Map([['battery_estelar', 29], ['cic', 19]]),
      onRigs: new Map([
        ['gpu_v4', [{ rackId: 'a34b4abc-5e7f-4fbf-98db-3e586d0defdb', slotIndex: 1, roomId: 'room_initial' }]]
      ]),
      listedP2p: new Map(),
      acquired: new Map([['gpu_v4', 1]]),
      soldP2p: new Map()
    });
    const gpu = rows.find((r) => r.itemId === 'gpu_v4');
    expect(gpu?.unaccounted).toBe(0);
    expect(gpu?.inStock).toBe(0);
    expect(gpu?.onRigs[0]?.slotIndex).toBe(1);
  });
});

describe('mergeTimelineEvents', () => {
  it('deduplica p2p_listing_buy quando trade postgres coincide', () => {
    const mongo: AccountTraceEvent[] = [
      {
        id: 'm1',
        atMs: 1000,
        source: 'mongo_action',
        kind: 'p2p_listing_buy',
        action: 'p2p_listing_buy',
        title: 'Compra P2P',
        summary: 'mongo',
        severity: 'info',
        category: 'p2p'
      }
    ];
    const pg: AccountTraceEvent[] = [
      {
        id: 'pg:1',
        atMs: 1001,
        source: 'postgres',
        kind: 'p2p_buy',
        action: 'p2p_trade_buy',
        title: 'Compra',
        summary: 'postgres',
        severity: 'info',
        category: 'p2p'
      }
    ];
    const { events } = mergeTimelineEvents(mongo, pg, { limit: 10 });
    expect(events.some((e) => e.source === 'mongo_action' && e.action === 'p2p_listing_buy')).toBe(false);
    expect(events.some((e) => e.source === 'postgres')).toBe(true);
  });
});

describe('formatP2pTradeEvent', () => {
  it('formata venda com item e contraparte', () => {
    const e = formatP2pTradeEvent(
      {
        id: '1',
        atMs: 1,
        role: 'seller',
        itemId: 'gpu_v4',
        itemName: 'Gamer Bee',
        qty: 1,
        unitPrice: 0.5,
        totalUsdc: 0.5,
        counterpartyUserId: 99
      },
      'seller'
    );
    expect(e.summary).toMatch(/Gamer Bee/);
    expect(e.lines?.some((l) => l.includes('#99'))).toBe(true);
  });
});
