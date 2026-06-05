import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { releaseAllEquippedLeasesOnRack } from '../lib/asicLease.js';

describe('releaseAllEquippedLeasesOnRack', () => {
  it('liberta lease para stock em vez de DELETE em massa por rack_id', async () => {
    const leaseId = '11111111-1111-4111-8111-111111111111';
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push(String(sql));
        const s = String(sql);

        if (s.includes('FROM rack_slots s') && s.includes('machine_lease_id IS NULL')) {
          return { rows: [], rowCount: 0 };
        }
        if (s.includes('FROM rack_slots') && s.includes('WHERE rack_id = $1 AND machine_item_id IS NOT NULL')) {
          return {
            rows: [
              {
                slot_index: 0,
                machine_item_id: 'asic_timed',
                machine_lease_id: leaseId
              }
            ],
            rowCount: 1
          };
        }
        if (s.includes('FROM player_asic_leases WHERE id = $1')) {
          return {
            rows: [{ id: leaseId, item_id: 'asic_timed', expires_at: Date.now() + 86400000 }],
            rowCount: 1
          };
        }
        if (s.includes("status = 'stock'") && s.includes('COUNT(*)')) {
          return { rows: [{ n: 1 }], rowCount: 1 };
        }
        if (s.includes('FROM upgrades WHERE id = $1')) {
          return {
            rows: [{ asic_duration_amount: 7, asic_duration_unit: 'day', asic_duration_kind: 'daily' }],
            rowCount: 1
          };
        }
        if (s.includes("status = 'equipped'") && s.includes('rack_id = $2')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      })
    } as unknown as PoolClient;

    await releaseAllEquippedLeasesOnRack(client, 1, 'rack_a', Date.now());

    const joined = queries.join('\n');
    expect(joined).not.toMatch(/DELETE FROM player_asic_leases WHERE user_id = \$1 AND rack_id = \$2/);
    expect(joined).toMatch(/UPDATE player_asic_leases SET status = 'stock'/);
  });
});
