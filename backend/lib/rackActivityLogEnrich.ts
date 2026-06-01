import type { PoolClient } from 'pg';

type SaveLog = { action: string; meta: Record<string, unknown> };

function collectUpgradeIds(logs: SaveLog[]): Set<string> {
  const ids = new Set<string>();
  for (const ev of logs) {
    const m = ev.meta;
    if (ev.action === 'rack_place' && m.itemId) ids.add(String(m.itemId));
    if (ev.action === 'rack_dismantle') {
      const parts = m.parts as Record<string, unknown> | undefined;
      if (parts?.chassis) ids.add(String(parts.chassis));
      if (parts?.wiring) ids.add(String(parts.wiring));
      if (parts?.battery) ids.add(String(parts.battery));
      for (const listKey of ['miners', 'multipliers'] as const) {
        const arr = parts?.[listKey];
        if (Array.isArray(arr)) {
          for (const x of arr) {
            if (x && typeof x === 'object' && 'id' in x) ids.add(String((x as { id: string }).id));
          }
        }
      }
    }
    if (ev.action === 'mining_rack_update' && m.rackId) {
      /* names resolved from changed fields only if present */
    }
  }
  return ids;
}

/**
 * Enriquece meta de rack_* com nomes legíveis de upgrades.
 */
export async function enrichSaveActivityLogsWithUpgradeNames(
  client: PoolClient,
  logs: SaveLog[]
): Promise<void> {
  const ids = [...collectUpgradeIds(logs)].filter(Boolean);
  if (ids.length === 0) return;
  const res = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM upgrades WHERE id = ANY($1::text[])`,
    [ids]
  );
  const nameById = new Map(res.rows.map((r) => [String(r.id), String(r.name)]));

  for (const ev of logs) {
    const m = ev.meta;
    if (ev.action === 'rack_place' && m.itemId) {
      m.itemName = nameById.get(String(m.itemId)) || m.itemId;
    }
    if (ev.action === 'rack_dismantle') {
      const parts = m.parts as Record<string, unknown> | undefined;
      if (parts?.chassis) m.chassisName = nameById.get(String(parts.chassis)) || parts.chassis;
    }
    if (ev.action === 'mining_rack_update' && Array.isArray(m.changed)) {
      const details: string[] = [];
      for (const field of m.changed as string[]) {
        details.push(field);
      }
      if (details.length) m.changeDetail = details;
    }
  }
}
