/**
 * Leitura de inventory_movements para o painel admin.
 */
import { prisma } from '../config/prisma.js';

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function parseMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export type InventoryAuditRow = {
  id: string;
  createdAtMs: number;
  action: string;
  catalogItemId: string | null;
  itemName: string | null;
  instanceId: string | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  delta: number | null;
  source: string;
  summary: string;
};

export async function listUserInventoryAudit(params: {
  userId: number;
  fromMs?: number | null;
  toMs?: number | null;
  page: number;
  limit: number;
  lossesOnly?: boolean;
}): Promise<{ total: number; page: number; limit: number; rows: InventoryAuditRow[] }> {
  const uid = Math.floor(params.userId);
  const page = clamp(params.page, 1, 99999);
  const limit = clamp(params.limit, 1, 200);
  const offset = (page - 1) * limit;

  const whereParts: string[] = ['user_id = $1'];
  const sqlParams: unknown[] = [uid];
  if (params.fromMs != null) {
    sqlParams.push(BigInt(Math.floor(params.fromMs)));
    whereParts.push(`created_at >= $${sqlParams.length}`);
  }
  if (params.toMs != null) {
    sqlParams.push(BigInt(Math.floor(params.toMs)));
    whereParts.push(`created_at <= $${sqlParams.length}`);
  }
  if (params.lossesOnly) {
    whereParts.push(
      `quantity_after IS NOT NULL AND quantity_before IS NOT NULL AND quantity_after < quantity_before`
    );
  }
  const whereSql = whereParts.join(' AND ');

  const totalRows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS total FROM inventory_movements WHERE ${whereSql}`,
    ...sqlParams
  );
  const total = Number(totalRows[0]?.total ?? 0);

  const listParams = [...sqlParams, limit, offset];
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      action: string;
      catalog_item_id: string | null;
      instance_id: string | null;
      quantity_before: number | null;
      quantity_after: number | null;
      meta: string | null;
      created_at: bigint | number;
      upgrade_name: string | null;
    }>
  >(
    `SELECT
        m.id::text,
        m.action,
        m.catalog_item_id,
        m.instance_id,
        m.quantity_before,
        m.quantity_after,
        m.meta,
        m.created_at,
        u.name AS upgrade_name
      FROM inventory_movements m
      LEFT JOIN upgrades u ON u.id = m.catalog_item_id
      WHERE ${whereSql}
      ORDER BY m.created_at DESC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    ...listParams
  );

  const mapped: InventoryAuditRow[] = rows.map((r) => {
    const before = r.quantity_before != null ? Number(r.quantity_before) : null;
    const after = r.quantity_after != null ? Number(r.quantity_after) : null;
    const delta = before != null && after != null ? after - before : null;
    const itemName = r.upgrade_name || r.catalog_item_id;
    let source = r.action;
    try {
      if (r.meta) {
        const parsed = JSON.parse(r.meta) as { source?: string };
        if (parsed.source) source = String(parsed.source);
      }
    } catch {
      /* ignore */
    }
    const summary =
      delta != null && itemName
        ? `${itemName}: ${before} → ${after} (Δ ${delta > 0 ? '+' : ''}${delta})`
        : r.action;
    return {
      id: r.id,
      createdAtMs: Number(r.created_at),
      action: r.action,
      catalogItemId: r.catalog_item_id,
      itemName,
      instanceId: r.instance_id,
      quantityBefore: before,
      quantityAfter: after,
      delta,
      source,
      summary
    };
  });

  return { total, page, limit, rows: mapped };
}

export function parseInventoryAuditRange(fromRaw: unknown, toRaw: unknown): {
  fromMs: number | null;
  toMs: number | null;
} {
  return { fromMs: parseMs(fromRaw), toMs: parseMs(toRaw) };
}
