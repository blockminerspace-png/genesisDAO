/**
 * Diff de stock no save-game → inventory_movements + alertas Mongo.
 */
import type { PoolClient } from 'pg';
import { recordInventoryMovement } from './inventory.audit.js';

export type StockAuditHooks = {
  appendGameActivityLog: (
    userId: number,
    action: string,
    meta: Record<string, unknown>
  ) => Promise<void>;
  resolveItemName?: (itemId: string) => string | null;
};

export async function auditStockSaveDelta(
  client: PoolClient,
  userId: number,
  newStock: Record<string, number>,
  hooks: StockAuditHooks
): Promise<void> {
  const uid = Math.floor(userId);
  const prevRes = await client.query<{ item_id: string; qty: number }>(
    `SELECT item_id, qty FROM stock WHERE user_id = $1`,
    [uid]
  );
  const prevMap = new Map<string, number>();
  for (const r of prevRes.rows) prevMap.set(String(r.item_id), Number(r.qty) || 0);

  const nextMap = new Map<string, number>();
  for (const [k, v] of Object.entries(newStock || {})) {
    const qty = Math.floor(Number(v));
    if (qty > 0) nextMap.set(String(k), qty);
  }

  const allIds = new Set([...prevMap.keys(), ...nextMap.keys()]);
  const catalogSet = new Set<string>();
  if (allIds.size > 0) {
    const catalogRes = await client.query<{ id: string }>(
      `SELECT id FROM upgrades WHERE id = ANY($1::text[])`,
      [[...allIds]]
    );
    for (const row of catalogRes.rows) catalogSet.add(String(row.id));
  }

  for (const itemId of allIds) {
    const before = prevMap.get(itemId) ?? 0;
    const after = nextMap.get(itemId) ?? 0;
    if (before === after) continue;

    const delta = after - before;
    const unknownCatalog = !catalogSet.has(itemId);
    const itemName = hooks.resolveItemName?.(itemId) ?? itemId;
    const meta: Record<string, unknown> = {
      itemId,
      itemName,
      before,
      after,
      delta,
      source: 'save-game',
      unknownCatalog,
      ...(delta < 0
        ? { dispositionHint: unknownCatalog ? 'unknown_catalog' : 'stock_only' }
        : {})
    };

    await recordInventoryMovement({
      userId: uid,
      action: 'stock_save_delta',
      catalogItemId: itemId,
      quantityBefore: before,
      quantityAfter: after,
      meta
    });

    await hooks.appendGameActivityLog(uid, 'stock_delta', meta);

    if (delta < 0) {
      await hooks.appendGameActivityLog(uid, 'inventory_loss_alert', {
        ...meta,
        severity: 'loss'
      });
    }
  }
}
