import { describe, it, expect, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  deactivateFilteredSuspiciousUsers,
  deactivateSuspiciousActiveUserIds,
} from '../modules/admin/suspiciousEmails/suspiciousEmailsAdmin.service.js';

describe('deactivateSuspiciousActiveUserIds', () => {
  it('desactiva ids em batch e limpa sessões', async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(String(sql));
        if (/UPDATE users SET is_blocked/i.test(sql)) return { rowCount: 2 };
        return { rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const db = {
      connect: vi.fn(async () => client as unknown as PoolClient),
    } as unknown as Pool;

    const n = await deactivateSuspiciousActiveUserIds(db, [10, 11]);
    expect(n).toBe(2);
    expect(queries.some((q) => /UPDATE users SET is_blocked = 1/i.test(q))).toBe(true);
    expect(queries.some((q) => /DELETE FROM sessions/i.test(q))).toBe(true);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
});

describe('deactivateFilteredSuspiciousUsers', () => {
  it('rejeita expectedCount inválido', async () => {
    const db = {} as Pool;
    const r = await deactivateFilteredSuspiciousUsers(db, {}, { expectedCount: 0, adminUserId: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID');
  });
});
