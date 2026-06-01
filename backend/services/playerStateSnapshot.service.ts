/**
 * Snapshot compacto do estado global do jogador (auditoria admin).
 */
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
export type PlayerStateSnapshotPayload = {
  economy: {
    usdc: number;
    blackMarketBalance: number;
    topCoins: Array<{ coinId: string; amount: number }>;
  };
  inventory: {
    distinctItems: number;
    totalQty: number;
    items: Array<{ itemId: string; qty: number }>;
    truncated: boolean;
  };
  boxes: { distinctBoxes: number; totalQty: number };
  rigs: { count: number; rooms: string[]; poweredOn: number };
  batteries: { count: number };
  fingerprint: string;
};

const MAX_STOCK_ITEMS = 40;

function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

export function fingerprintFromSnapshot(payload: Omit<PlayerStateSnapshotPayload, 'fingerprint'>): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

export async function buildPlayerStateSnapshot(
  db: Pool | PoolClient,
  userId: number
): Promise<PlayerStateSnapshotPayload> {
  const uid = Math.floor(userId);
  const q = (text: string, params?: unknown[]) => db.query(text, params);

  const [gsRes, stockRes, boxesRes, racksRes, batRes, coinsRes] = await Promise.all([
    q(
      `SELECT usdc, COALESCE(black_market_balance, 0) AS black_market_balance FROM game_states WHERE user_id = $1`,
      [uid]
    ),
    q(`SELECT item_id, qty FROM stock WHERE user_id = $1 ORDER BY qty DESC, item_id ASC`, [uid]),
    q(`SELECT box_id, qty FROM unopened_boxes WHERE user_id = $1`, [uid]),
    q(
      `SELECT id, COALESCE(NULLIF(BTRIM(room_id::text), ''), 'room_initial') AS room_id, is_on
       FROM placed_racks WHERE user_id = $1`,
      [uid]
    ),
    q(`SELECT COUNT(*)::int AS c FROM stored_batteries WHERE user_id = $1`, [uid]),
    q(
      `SELECT coin_id, amount FROM coin_balances WHERE user_id = $1 ORDER BY amount DESC LIMIT 5`,
      [uid]
    )
  ]);

  const gs = gsRes.rows[0] as { usdc?: number; black_market_balance?: number } | undefined;
  const stockRows = stockRes.rows as Array<{ item_id: string; qty: number }>;
  const boxRows = boxesRes.rows as Array<{ box_id: string; qty: number }>;
  const rackRows = racksRes.rows as Array<{ room_id: string; is_on: number }>;

  let totalQty = 0;
  for (const r of stockRows) totalQty += Number(r.qty) || 0;

  let boxesTotal = 0;
  for (const r of boxRows) boxesTotal += Number(r.qty) || 0;

  const rooms = [...new Set(rackRows.map((r) => String(r.room_id || '')))].filter(Boolean);
  const poweredOn = rackRows.filter((r) => Number(r.is_on) === 1).length;

  const allItems = stockRows.map((r) => ({ itemId: String(r.item_id), qty: Number(r.qty) || 0 }));
  const truncated = allItems.length > MAX_STOCK_ITEMS;
  const items = allItems.slice(0, MAX_STOCK_ITEMS);

  const base: Omit<PlayerStateSnapshotPayload, 'fingerprint'> = {
    economy: {
      usdc: Number(gs?.usdc) || 0,
      blackMarketBalance: Number(gs?.black_market_balance) || 0,
      topCoins: (coinsRes.rows as Array<{ coin_id: string; amount: number }>).map((c) => ({
        coinId: String(c.coin_id),
        amount: Number(c.amount) || 0
      }))
    },
    inventory: {
      distinctItems: stockRows.length,
      totalQty,
      items,
      truncated
    },
    boxes: {
      distinctBoxes: boxRows.length,
      totalQty: boxesTotal
    },
    rigs: {
      count: rackRows.length,
      rooms,
      poweredOn
    },
    batteries: {
      count: Number((batRes.rows[0] as { c?: number })?.c) || 0
    }
  };

  return {
    ...base,
    fingerprint: fingerprintFromSnapshot(base)
  };
}

export async function appendSessionStateSnapshot(
  appendLog: (userId: number, action: string, meta: Record<string, unknown>) => Promise<void>,
  db: Pool | PoolClient,
  userId: number,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    const snapshot = await buildPlayerStateSnapshot(db, userId);
    await appendLog(userId, 'session_state_snapshot', {
      ...snapshot,
      ...extra
    });
  } catch (e) {
    console.warn(
      '[PlayerStateSnapshot] falha:',
      e instanceof Error ? e.message : String(e)
    );
  }
}

export type SnapshotDiffItem = {
  itemId: string;
  before: number;
  after: number;
  delta: number;
};

export function diffSnapshotInventory(
  prev: PlayerStateSnapshotPayload | null,
  next: PlayerStateSnapshotPayload
): SnapshotDiffItem[] {
  if (!prev) return [];
  const prevMap = new Map(prev.inventory.items.map((i) => [i.itemId, i.qty]));
  const nextMap = new Map(next.inventory.items.map((i) => [i.itemId, i.qty]));
  const ids = new Set([...prevMap.keys(), ...nextMap.keys()]);
  const out: SnapshotDiffItem[] = [];
  for (const itemId of ids) {
    const before = prevMap.get(itemId) ?? 0;
    const after = nextMap.get(itemId) ?? 0;
    if (before !== after) out.push({ itemId, before, after, delta: after - before });
  }
  return out.sort((a, b) => a.delta - b.delta);
}
