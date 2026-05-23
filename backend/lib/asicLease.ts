/**
 * ASICs com validade: cada unidade comprada gera uma linha em `player_asic_leases`.
 * Após `expires_at`, a unidade é removida (stock + slot na rig).
 */
import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { isAsicMachineUpgradeRow, type UpgradeMiningRow } from './nftRoomMining.js';

/** Legado (dropdown antigo); leitura migra para amount+unit. */
export const ASIC_DURATION_KINDS = ['none', 'daily', 'weekly', 'monthly', 'annual'] as const;
export type AsicDurationKind = (typeof ASIC_DURATION_KINDS)[number];

export const ASIC_DURATION_UNITS = ['day', 'week', 'month', 'year'] as const;
export type AsicDurationUnit = (typeof ASIC_DURATION_UNITS)[number];

export type AsicDurationConfig = {
  amount: number;
  unit: AsicDurationUnit | null;
};

const MS_DAY = 24 * 60 * 60 * 1000;

export function normalizeAsicDurationUnit(raw: unknown): AsicDurationUnit | null {
  const u = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (u === 'day' || u === 'days' || u === 'dia' || u === 'dias') return 'day';
  if (u === 'week' || u === 'weeks' || u === 'semana' || u === 'semanas') return 'week';
  if (u === 'month' || u === 'months' || u === 'mes' || u === 'meses') return 'month';
  if (u === 'year' || u === 'years' || u === 'ano' || u === 'anos') return 'year';
  return null;
}

export function normalizeAsicDurationKind(raw: unknown): AsicDurationKind {
  const k = String(raw ?? 'none')
    .trim()
    .toLowerCase();
  if ((ASIC_DURATION_KINDS as readonly string[]).includes(k)) return k as AsicDurationKind;
  return 'none';
}

/** Resolve validade a partir de amount+unit (preferido) ou kind legado. */
export function normalizeAsicDurationConfig(raw: {
  amount?: unknown;
  unit?: unknown;
  kind?: unknown;
}): AsicDurationConfig {
  const amount = Math.floor(Number(raw.amount) || 0);
  const unit = normalizeAsicDurationUnit(raw.unit);
  if (amount > 0 && unit) return { amount, unit };

  switch (normalizeAsicDurationKind(raw.kind)) {
    case 'daily':
      return { amount: 1, unit: 'day' };
    case 'weekly':
      return { amount: 1, unit: 'week' };
    case 'monthly':
      return { amount: 1, unit: 'month' };
    case 'annual':
      return { amount: 1, unit: 'year' };
    default:
      return { amount: 0, unit: null };
  }
}

export function isTimedAsicDuration(cfg: AsicDurationConfig): boolean {
  return cfg.amount > 0 && cfg.unit != null;
}

/** @deprecated use isTimedAsicDuration */
export function isTimedAsicDurationKind(kind: AsicDurationKind): boolean {
  return isTimedAsicDuration(normalizeAsicDurationConfig({ kind }));
}

export function durationMsForConfig(cfg: AsicDurationConfig): number {
  if (!isTimedAsicDuration(cfg)) return 0;
  const { amount, unit } = cfg;
  switch (unit) {
    case 'day':
      return amount * MS_DAY;
    case 'week':
      return amount * 7 * MS_DAY;
    case 'month':
      return amount * 30 * MS_DAY;
    case 'year':
      return amount * 365 * MS_DAY;
    default:
      return 0;
  }
}

export function computeAsicLeaseExpiresAt(cfg: AsicDurationConfig, fromMs: number): number {
  const ms = durationMsForConfig(cfg);
  if (ms <= 0) return 0;
  return fromMs + ms;
}

export function formatAsicDurationLabelPt(cfg: AsicDurationConfig): string {
  if (!isTimedAsicDuration(cfg)) return 'Permanente';
  const n = cfg.amount;
  const unit = cfg.unit!;
  const labels: Record<AsicDurationUnit, [string, string]> = {
    day: ['dia', 'dias'],
    week: ['semana', 'semanas'],
    month: ['mês', 'meses'],
    year: ['ano', 'anos']
  };
  const pair = labels[unit];
  return `${n} ${n === 1 ? pair[0] : pair[1]}`;
}

export function isAsicCatalogRow(row: UpgradeMiningRow | null | undefined): boolean {
  return isAsicMachineUpgradeRow(row);
}

export async function loadAsicDurationConfig(client: PoolClient, itemId: string): Promise<AsicDurationConfig> {
  const r = await client.query(
    `SELECT type, category, id,
            COALESCE(asic_duration_amount, 0) AS asic_duration_amount,
            asic_duration_unit,
            COALESCE(asic_duration_kind, 'none') AS asic_duration_kind
     FROM upgrades WHERE id = $1 LIMIT 1`,
    [itemId]
  );
  const row = r.rows[0] as {
    type?: string;
    category?: string;
    id?: string;
    asic_duration_amount?: number;
    asic_duration_unit?: string | null;
    asic_duration_kind?: string;
  } | undefined;
  if (!row || !isAsicMachineUpgradeRow(row)) return { amount: 0, unit: null };
  return normalizeAsicDurationConfig({
    amount: row.asic_duration_amount,
    unit: row.asic_duration_unit,
    kind: row.asic_duration_kind
  });
}

/** @deprecated use loadAsicDurationConfig */
export async function loadAsicDurationKind(client: PoolClient, itemId: string): Promise<AsicDurationKind> {
  const cfg = await loadAsicDurationConfig(client, itemId);
  return isTimedAsicDuration(cfg) ? 'daily' : 'none';
}

export async function createAsicLeasesOnPurchase(
  client: PoolClient,
  userId: number,
  itemId: string,
  qty: number,
  cfg: AsicDurationConfig,
  nowMs: number
): Promise<void> {
  const n = Math.floor(Number(qty) || 0);
  if (n <= 0 || !isTimedAsicDuration(cfg)) return;
  const expiresAt = computeAsicLeaseExpiresAt(cfg, nowMs);
  if (expiresAt <= nowMs) return;

  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO player_asic_leases (id, user_id, item_id, acquired_at, expires_at, status, rack_id, slot_index)
       VALUES ($1, $2, $3, $4, $5, 'stock', NULL, NULL)`,
      [id, userId, itemId, nowMs, expiresAt]
    );
  }
}

/**
 * Alinha `player_asic_leases` (stock) com a quantidade pretendida — compra na loja,
 * gift admin ou gravação de stock no perfil.
 */
export async function reconcileTimedAsicStockLeases(
  client: PoolClient,
  userId: number,
  itemId: string,
  targetQty: number,
  nowMs: number
): Promise<boolean> {
  const cfg = await loadAsicDurationConfig(client, itemId);
  if (!isTimedAsicDuration(cfg)) return false;

  const target = Math.max(0, Math.floor(Number(targetQty) || 0));
  const cntRes = await client.query(
    `SELECT COUNT(*)::int AS n FROM player_asic_leases
     WHERE user_id = $1 AND item_id = $2 AND status = 'stock' AND expires_at > $3`,
    [userId, itemId, nowMs]
  );
  const current = Number(cntRes.rows[0]?.n) || 0;

  if (target > current) {
    await createAsicLeasesOnPurchase(client, userId, itemId, target - current, cfg, nowMs);
  } else if (target < current) {
    const toRemove = current - target;
    await client.query(
      `DELETE FROM player_asic_leases
       WHERE id IN (
         SELECT id FROM player_asic_leases
         WHERE user_id = $1 AND item_id = $2 AND status = 'stock' AND expires_at > $3
         ORDER BY expires_at DESC
         LIMIT $4
       )`,
      [userId, itemId, nowMs, toRemove]
    );
  }

  await syncTimedAsicStockForItem(client, userId, itemId, nowMs);
  return true;
}

export async function syncTimedAsicStockForItem(
  client: PoolClient,
  userId: number,
  itemId: string,
  nowMs: number
): Promise<void> {
  const cntRes = await client.query(
    `SELECT COUNT(*)::int AS n FROM player_asic_leases
     WHERE user_id = $1 AND item_id = $2 AND status = 'stock' AND expires_at > $3`,
    [userId, itemId, nowMs]
  );
  const qty = Number(cntRes.rows[0]?.n) || 0;
  if (qty > 0) {
    await client.query(
      `INSERT INTO stock (user_id, item_id, qty) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, item_id) DO UPDATE SET qty = EXCLUDED.qty`,
      [userId, itemId, qty]
    );
  } else {
    await client.query(`DELETE FROM stock WHERE user_id = $1 AND item_id = $2`, [userId, itemId]);
  }
}

export async function syncAllTimedAsicStock(client: PoolClient, userId: number, nowMs: number): Promise<void> {
  const items = await client.query(
    `SELECT DISTINCT item_id FROM player_asic_leases WHERE user_id = $1`,
    [userId]
  );
  for (const row of items.rows as { item_id: string }[]) {
    await syncTimedAsicStockForItem(client, userId, String(row.item_id), nowMs);
  }
}

/** Remove expirados, desequipa rigs, ajusta stock. */
export async function expireUserAsicLeases(client: PoolClient, userId: number, nowMs: number): Promise<number> {
  const expired = await client.query(
    `SELECT id, item_id, status, rack_id, slot_index FROM player_asic_leases
     WHERE user_id = $1 AND expires_at <= $2
     FOR UPDATE`,
    [userId, nowMs]
  );
  let n = 0;
  for (const row of expired.rows as {
    id: string;
    item_id: string;
    status: string;
    rack_id: string | null;
    slot_index: number | null;
  }[]) {
    n++;
    if (row.status === 'equipped' && row.rack_id && row.slot_index != null) {
      await client.query(
        `UPDATE rack_slots SET machine_item_id = NULL, machine_lease_id = NULL
         WHERE rack_id = $1 AND slot_index = $2 AND machine_lease_id = $3`,
        [row.rack_id, row.slot_index, row.id]
      );
    }
    await client.query(`DELETE FROM player_asic_leases WHERE id = $1`, [row.id]);
  }
  if (n > 0) {
    await syncAllTimedAsicStock(client, userId, nowMs);
  }
  return n;
}

export async function reserveAsicLeaseForEquip(
  client: PoolClient,
  userId: number,
  itemId: string,
  nowMs: number
): Promise<{ ok: true; leaseId: string } | { ok: false; error: string }> {
  const res = await client.query(
    `SELECT id FROM player_asic_leases
     WHERE user_id = $1 AND item_id = $2 AND status = 'stock' AND expires_at > $3
     ORDER BY expires_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    [userId, itemId, nowMs]
  );
  const leaseId = res.rows[0]?.id != null ? String(res.rows[0].id) : '';
  if (!leaseId) {
    return { ok: false, error: 'Sem ASICs válidos no estoque (validade expirada ou esgotado).' };
  }
  return { ok: true, leaseId };
}

export async function markLeaseEquipped(
  client: PoolClient,
  leaseId: string,
  userId: number,
  rackId: string,
  slotIndex: number
): Promise<void> {
  await client.query(
    `UPDATE player_asic_leases SET status = 'equipped', rack_id = $3, slot_index = $4
     WHERE id = $1 AND user_id = $2 AND status = 'stock'`,
    [leaseId, userId, rackId, Math.floor(slotIndex)]
  );
}

export async function releaseEquippedAsicLease(
  client: PoolClient,
  userId: number,
  rackId: string,
  slotIndex: number,
  nowMs: number
): Promise<void> {
  const slotRes = await client.query(
    `SELECT machine_item_id, machine_lease_id FROM rack_slots WHERE rack_id = $1 AND slot_index = $2`,
    [rackId, Math.floor(slotIndex)]
  );
  const slot = slotRes.rows[0] as { machine_item_id?: string; machine_lease_id?: string } | undefined;
  const leaseId = slot?.machine_lease_id ? String(slot.machine_lease_id).trim() : '';
  const itemId = slot?.machine_item_id ? String(slot.machine_item_id).trim() : '';

  await client.query(
    `UPDATE rack_slots SET machine_item_id = NULL, machine_lease_id = NULL
     WHERE rack_id = $1 AND slot_index = $2`,
    [rackId, Math.floor(slotIndex)]
  );

  if (!leaseId) return;

  const leaseRes = await client.query(
    `SELECT id, item_id, expires_at FROM player_asic_leases WHERE id = $1 AND user_id = $2`,
    [leaseId, userId]
  );
  const lease = leaseRes.rows[0] as { id: string; item_id: string; expires_at: number } | undefined;
  if (!lease) return;

  if (Number(lease.expires_at) <= nowMs) {
    await client.query(`DELETE FROM player_asic_leases WHERE id = $1`, [leaseId]);
  } else {
    await client.query(
      `UPDATE player_asic_leases SET status = 'stock', rack_id = NULL, slot_index = NULL WHERE id = $1`,
      [leaseId]
    );
  }
  if (itemId) await syncTimedAsicStockForItem(client, userId, itemId, nowMs);
}

export async function purgeEquippedLeasesOnRack(
  client: PoolClient,
  userId: number,
  rackId: string,
  nowMs: number
): Promise<void> {
  await client.query(`DELETE FROM player_asic_leases WHERE user_id = $1 AND rack_id = $2`, [userId, rackId]);
  await syncAllTimedAsicStock(client, userId, nowMs);
}

export async function releaseEquippedAsicLeaseById(
  client: PoolClient,
  userId: number,
  leaseId: string,
  itemId: string,
  nowMs: number
): Promise<void> {
  const id = String(leaseId || '').trim();
  if (!id) return;
  const leaseRes = await client.query(
    `SELECT id, item_id, expires_at FROM player_asic_leases WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  const lease = leaseRes.rows[0] as { id: string; item_id: string; expires_at: number } | undefined;
  if (!lease) return;
  if (Number(lease.expires_at) <= nowMs) {
    await client.query(`DELETE FROM player_asic_leases WHERE id = $1`, [id]);
  } else {
    await client.query(
      `UPDATE player_asic_leases SET status = 'stock', rack_id = NULL, slot_index = NULL WHERE id = $1`,
      [id]
    );
  }
  const syncItem = itemId || String(lease.item_id || '').trim();
  if (syncItem) await syncTimedAsicStockForItem(client, userId, syncItem, nowMs);
}

export async function applyTimedStockQtyToSnapshot(
  client: PoolClient,
  userId: number,
  stock: Record<string, number>,
  itemId: string,
  nowMs: number
): Promise<void> {
  const cntRes = await client.query(
    `SELECT COUNT(*)::int AS n FROM player_asic_leases
     WHERE user_id = $1 AND item_id = $2 AND status = 'stock' AND expires_at > $3`,
    [userId, itemId, nowMs]
  );
  const qty = Number(cntRes.rows[0]?.n) || 0;
  if (qty > 0) stock[itemId] = qty;
  else delete stock[itemId];
}

export async function finalizeTimedMinerEquip(
  client: PoolClient,
  userId: number,
  rackId: string,
  slotIndex: number,
  catalogItemId: string,
  placedRacks: Array<{ id: string; slots?: string[]; slotLeaseIds?: string[] }>,
  stock: Record<string, number>,
  nowMs: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const reserved = await reserveAsicLeaseForEquip(client, userId, catalogItemId, nowMs);
  if (!reserved.ok) return reserved;
  await markLeaseEquipped(client, reserved.leaseId, userId, rackId, slotIndex);
  const ri = placedRacks.findIndex((r) => r.id === rackId);
  if (ri >= 0) {
    const rack = placedRacks[ri];
    rack.slotLeaseIds = [...(rack.slotLeaseIds || [])];
    while (rack.slotLeaseIds.length <= slotIndex) rack.slotLeaseIds.push('');
    rack.slotLeaseIds[slotIndex] = reserved.leaseId;
  }
  await applyTimedStockQtyToSnapshot(client, userId, stock, catalogItemId, nowMs);
  return { ok: true };
}

export type AsicLeaseSummaryRow = {
  itemId: string;
  inStock: number;
  equipped: number;
  nearestExpiresAt: number | null;
};

export type AsicLeaseDetailRow = {
  leaseId: string;
  itemId: string;
  expiresAt: number;
  status: 'stock' | 'equipped';
  rackId: string | null;
  slotIndex: number | null;
};

/**
 * ASICs equipadas antes do sistema de leases (ou sem `machine_lease_id` no slot):
 * cria lease + liga ao slot para o payback mostrar «Resta».
 */
export async function repairEquippedAsicLeasesWithoutSlotLease(
  client: PoolClient,
  userId: number,
  nowMs: number
): Promise<number> {
  const slotsRes = await client.query(
    `SELECT s.rack_id, s.slot_index, s.machine_item_id
     FROM rack_slots s
     INNER JOIN placed_racks pr ON pr.id = s.rack_id AND pr.user_id = $1
     WHERE s.machine_item_id IS NOT NULL
       AND (s.machine_lease_id IS NULL OR BTRIM(s.machine_lease_id::text) = '')`,
    [userId]
  );
  let repaired = 0;
  for (const row of slotsRes.rows as {
    rack_id: string;
    slot_index: number;
    machine_item_id: string;
  }[]) {
    const itemId = String(row.machine_item_id || '').trim();
    if (!itemId) continue;
    const cfg = await loadAsicDurationConfig(client, itemId);
    if (!isTimedAsicDuration(cfg)) continue;

    const existing = await client.query(
      `SELECT id FROM player_asic_leases
       WHERE user_id = $1 AND status = 'equipped' AND rack_id = $2 AND slot_index = $3 AND expires_at > $4
       LIMIT 1`,
      [userId, row.rack_id, row.slot_index, nowMs]
    );
    if (existing.rows[0]?.id) {
      const leaseId = String(existing.rows[0].id);
      await client.query(
        `UPDATE rack_slots SET machine_lease_id = $3 WHERE rack_id = $1 AND slot_index = $2`,
        [row.rack_id, row.slot_index, leaseId]
      );
      continue;
    }

    const expiresAt = computeAsicLeaseExpiresAt(cfg, nowMs);
    if (expiresAt <= nowMs) continue;
    const leaseId = crypto.randomUUID();
    await client.query(
      `INSERT INTO player_asic_leases (id, user_id, item_id, acquired_at, expires_at, status, rack_id, slot_index)
       VALUES ($1, $2, $3, $4, $5, 'equipped', $6, $7)`,
      [leaseId, userId, itemId, nowMs, expiresAt, row.rack_id, row.slot_index]
    );
    await client.query(
      `UPDATE rack_slots SET machine_lease_id = $3 WHERE rack_id = $1 AND slot_index = $2`,
      [row.rack_id, row.slot_index, leaseId]
    );
    repaired++;
  }
  if (repaired > 0) {
    await syncAllTimedAsicStock(client, userId, nowMs);
  }
  return repaired;
}

export async function listUserAsicLeaseDetails(
  client: PoolClient,
  userId: number,
  nowMs: number
): Promise<AsicLeaseDetailRow[]> {
  const r = await client.query(
    `SELECT id, item_id, expires_at, status, rack_id, slot_index
     FROM player_asic_leases
     WHERE user_id = $1 AND expires_at > $2
     ORDER BY expires_at ASC`,
    [userId, nowMs]
  );
  return r.rows.map(
    (row: {
      id: string;
      item_id: string;
      expires_at: number;
      status: string;
      rack_id: string | null;
      slot_index: number | null;
    }) => ({
      leaseId: String(row.id),
      itemId: String(row.item_id),
      expiresAt: Number(row.expires_at),
      status: row.status === 'equipped' ? 'equipped' : 'stock',
      rackId: row.rack_id != null ? String(row.rack_id) : null,
      slotIndex: row.slot_index != null ? Number(row.slot_index) : null
    })
  );
}

export async function listAsicLeaseSummary(
  client: PoolClient,
  userId: number,
  nowMs: number
): Promise<AsicLeaseSummaryRow[]> {
  const r = await client.query(
    `SELECT item_id,
            COUNT(*) FILTER (WHERE status = 'stock' AND expires_at > $2)::int AS in_stock,
            COUNT(*) FILTER (WHERE status = 'equipped' AND expires_at > $2)::int AS equipped,
            MIN(expires_at) FILTER (WHERE expires_at > $2) AS nearest
     FROM player_asic_leases
     WHERE user_id = $1
     GROUP BY item_id`,
    [userId, nowMs]
  );
  return r.rows.map((row: { item_id: string; in_stock: number; equipped: number; nearest: unknown }) => ({
    itemId: String(row.item_id),
    inStock: Number(row.in_stock) || 0,
    equipped: Number(row.equipped) || 0,
    nearestExpiresAt: row.nearest != null ? Number(row.nearest) : null
  }));
}
