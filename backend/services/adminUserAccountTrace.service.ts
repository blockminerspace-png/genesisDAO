/**
 * Rastreio completo de conta — agrega Postgres + Mongo para painel admin.
 */
import { prisma } from '../config/prisma.js';
import { formatActivityEvent } from '../lib/activityEventFormatter.js';
import { computePlayerGameHeaderSnapshot } from '../lib/playerGameHeaderSnapshot.js';
import {
  listAdminUserActivityLogsMongo
} from '../lib/mongoLogs.js';

export type AccountTraceEvent = {
  id: string;
  atMs: number;
  source: 'mongo_game' | 'mongo_action' | 'postgres';
  kind: string;
  action: string;
  title: string;
  summary: string;
  lines?: string[];
  severity: 'info' | 'success' | 'warning' | 'danger';
  category: string;
  meta?: Record<string, unknown>;
};

export type ItemDispositionRow = {
  itemId: string;
  itemName: string;
  acquired: number;
  inStock: number;
  onRigs: Array<{ rackId: string; slotIndex: number; roomId: string | null }>;
  listedP2p: number;
  soldP2p: number;
  unaccounted: number;
  hint: string;
};

export type AccountTraceSummary = {
  userId: number;
  username: string;
  email: string;
  accountCreatedAtMs: number | null;
  lastSaveAtMs: number | null;
  usdc: number;
  blackMarketBalance: number;
  totalUsdcDeposited: number | null;
  totalCryptoWithdrawn: number | null;
  totalHash: number;
};

export type AccountTraceInventoryRow = {
  itemId: string;
  itemName: string;
  qty: number;
};

export type AccountTraceRigRow = {
  rackId: string;
  chassisId: string;
  chassisName: string;
  roomId: string | null;
  slotIndex: number | null;
  miners: Array<{ slotIndex: number; itemId: string; itemName: string }>;
};

export type AccountTraceListingRow = {
  listingId: string;
  itemId: string;
  itemName: string;
  qty: number;
  price: number;
  status: string;
  expiresAtMs: number | null;
  reservedBy: number | null;
};

export type AccountTraceP2pTradeRow = {
  id: string;
  atMs: number;
  role: 'seller' | 'buyer';
  itemId: string;
  itemName: string;
  qty: number;
  unitPrice: number;
  totalUsdc: number;
  counterpartyUserId: number;
};

export type AccountTraceShopRow = {
  atMs: number;
  totalCost: number;
  newUsdc: number;
  lines: Array<{ id: string; qty: number; name?: string }>;
};

export type AccountTraceBoxRow = {
  id: string;
  atMs: number;
  boxId: string;
  rewards: unknown;
  gainedUsdc: number;
};

export type AccountTraceResponse = {
  summary: AccountTraceSummary;
  currentInventory: AccountTraceInventoryRow[];
  currentRigs: AccountTraceRigRow[];
  currentMarket: AccountTraceListingRow[];
  p2p: {
    sold: AccountTraceP2pTradeRow[];
    bought: AccountTraceP2pTradeRow[];
    activeListings: AccountTraceListingRow[];
  };
  shopPurchases: AccountTraceShopRow[];
  boxOpenings: AccountTraceBoxRow[];
  itemDisposition: ItemDispositionRow[];
  timeline: AccountTraceEvent[];
  timelineHasMore: boolean;
  timelineNextCursor: number | null;
};

export type AccountTraceParams = {
  userId: number;
  fromMs?: number | null;
  toMs?: number | null;
  timelineLimit?: number;
  timelineBeforeMs?: number | null;
  sections?: string[] | null;
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function bigMs(v: bigint | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseJsonLines(raw: string | null): Array<{ id: string; qty: number; name?: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((ln) => {
        if (ln == null || typeof ln !== 'object') return null;
        const o = ln as Record<string, unknown>;
        const id = String(o.id ?? o.itemId ?? '').trim();
        if (!id) return null;
        return {
          id,
          qty: Math.max(0, Math.floor(Number(o.qty) || 1)),
          name: o.name != null ? String(o.name) : undefined
        };
      })
      .filter(Boolean) as Array<{ id: string; qty: number; name?: string }>;
  } catch {
    return [];
  }
}

function parseRewardsJson(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return raw;
  }
}

function rewardsToItemQty(rewards: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, qty: number) => {
    const k = id.trim();
    if (!k || qty <= 0) return;
    out.set(k, (out.get(k) ?? 0) + qty);
  };
  if (Array.isArray(rewards)) {
    for (const r of rewards) {
      if (r == null || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const id = String(o.itemId ?? o.id ?? o.upgradeId ?? '').trim();
      const qty = Math.max(1, Math.floor(Number(o.qty ?? o.quantity ?? 1) || 1));
      if (id) add(id, qty);
    }
  } else if (rewards != null && typeof rewards === 'object') {
    const o = rewards as Record<string, unknown>;
    if (Array.isArray(o.items)) return rewardsToItemQty(o.items);
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number' && v > 0) add(k, Math.floor(v));
    }
  }
  return out;
}

export function buildItemDisposition(input: {
  itemNames: Map<string, string>;
  stock: Map<string, number>;
  onRigs: Map<string, Array<{ rackId: string; slotIndex: number; roomId: string | null }>>;
  listedP2p: Map<string, number>;
  acquired: Map<string, number>;
  soldP2p: Map<string, number>;
}): ItemDispositionRow[] {
  const allIds = new Set<string>([
    ...input.acquired.keys(),
    ...input.stock.keys(),
    ...input.onRigs.keys(),
    ...input.listedP2p.keys(),
    ...input.soldP2p.keys()
  ]);

  const rows: ItemDispositionRow[] = [];
  for (const itemId of allIds) {
    const acquired = input.acquired.get(itemId) ?? 0;
    const inStock = input.stock.get(itemId) ?? 0;
    const onRigs = input.onRigs.get(itemId) ?? [];
    const listedP2p = input.listedP2p.get(itemId) ?? 0;
    const soldP2p = input.soldP2p.get(itemId) ?? 0;
    const located = inStock + onRigs.length + listedP2p;
    const unaccounted = Math.max(0, acquired - soldP2p - located);

    const hints: string[] = [];
    if (onRigs.length > 0) {
      hints.push(
        `Montado na rig: ${onRigs.map((r) => `${r.rackId.slice(0, 8)}… slot ${r.slotIndex}`).join(', ')}`
      );
    }
    if (listedP2p > 0) hints.push(`${listedP2p} un. em anúncio P2P`);
    if (soldP2p > 0) hints.push(`${soldP2p} un. vendida(s) no mercado`);
    if (unaccounted > 0) {
      hints.push('Sem localização — verificar save-game, item temporário ou consumo na rig');
    }
    if (acquired === 0 && located > 0) {
      hints.push('Presente no inventário/rigs (origem anterior ao rastreio)');
    }

    rows.push({
      itemId,
      itemName: input.itemNames.get(itemId) ?? itemId,
      acquired,
      inStock,
      onRigs,
      listedP2p,
      soldP2p,
      unaccounted,
      hint: hints.join(' · ') || '—'
    });
  }

  return rows.sort((a, b) => {
    if (b.unaccounted !== a.unaccounted) return b.unaccounted - a.unaccounted;
    return b.acquired - a.acquired;
  });
}

export function formatP2pTradeEvent(
  row: AccountTraceP2pTradeRow,
  role: 'seller' | 'buyer'
): AccountTraceEvent {
  const verb = role === 'seller' ? 'Vendeu' : 'Comprou';
  return {
    id: `pg:p2p:${row.id}`,
    atMs: row.atMs,
    source: 'postgres',
    kind: role === 'seller' ? 'p2p_sell' : 'p2p_buy',
    action: role === 'seller' ? 'p2p_trade_sell' : 'p2p_trade_buy',
    title: role === 'seller' ? 'Venda no mercado P2P' : 'Compra no mercado P2P',
    summary: `${verb} ${row.qty}× ${row.itemName} · ${row.totalUsdc.toFixed(4)} USDC`,
    lines: [`Contraparte: #${row.counterpartyUserId}`, `Preço unit.: ${row.unitPrice.toFixed(4)} USDC`],
    severity: 'info',
    category: 'p2p',
    meta: { ...row }
  };
}

export function formatShopPurchaseEvent(row: AccountTraceShopRow, index: number): AccountTraceEvent {
  const items = row.lines.map((l) => `${l.qty}× ${l.name || l.id}`).join(', ');
  return {
    id: `pg:shop:${row.atMs}:${index}`,
    atMs: row.atMs,
    source: 'postgres',
    kind: 'shop_purchase',
    action: 'shop_checkout_ok',
    title: 'Checkout concluído (loja)',
    summary: `Pagou ${row.totalCost.toFixed(4)} USDC · saldo ${row.newUsdc.toFixed(4)} USDC`,
    lines: items ? [`Itens: ${items}`] : undefined,
    severity: 'success',
    category: 'economy',
    meta: { ...row }
  };
}

export function mongoRowToTraceEvent(row: {
  id: string;
  action: string;
  meta: Record<string, unknown>;
  createdAt: number;
  source?: 'mongo_game' | 'mongo_action';
}): AccountTraceEvent {
  const display = formatActivityEvent(row.action, row.meta);
  return {
    id: row.id,
    atMs: row.createdAt,
    source: row.source ?? (row.id.startsWith('action:') ? 'mongo_action' : 'mongo_game'),
    kind: row.action,
    action: row.action,
    title: display.title,
    summary: display.summary,
    lines: display.lines,
    severity: display.severity,
    category: display.category,
    meta: row.meta
  };
}

const P2P_MONGO_ACTIONS = new Set([
  'p2p_listing_create',
  'p2p_listing_cancel',
  'p2p_listing_buy',
  'p2p_listing_reserve',
  'p2p_reserve_cancel',
  'p2p_proceeds_claim',
  'p2p_custody_claim',
  'p2p_custody_claim_all'
]);

export function mergeTimelineEvents(
  mongoEvents: AccountTraceEvent[],
  postgresEvents: AccountTraceEvent[],
  opts?: { fromMs?: number | null; toMs?: number | null; beforeMs?: number | null; limit: number }
): { events: AccountTraceEvent[]; hasMore: boolean; nextCursor: number | null } {
  const limit = opts?.limit ?? 100;
  const pgBuySellMs = new Set<number>();
  for (const e of postgresEvents) {
    if (e.kind === 'p2p_buy' || e.kind === 'p2p_sell') pgBuySellMs.add(e.atMs);
  }

  const filteredMongo = mongoEvents.filter((e) => {
    if (opts?.fromMs != null && e.atMs < opts.fromMs) return false;
    if (opts?.toMs != null && e.atMs > opts.toMs) return false;
    if (P2P_MONGO_ACTIONS.has(e.action) && e.action === 'p2p_listing_buy') {
      for (const pgMs of pgBuySellMs) {
        if (Math.abs(pgMs - e.atMs) <= 2000) return false;
      }
    }
    return true;
  });

  const merged = [...filteredMongo, ...postgresEvents].sort((a, b) => b.atMs - a.atMs);
  const seen = new Set<string>();
  const deduped: AccountTraceEvent[] = [];
  for (const e of merged) {
    const key = `${e.source}:${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }

  let slice = deduped;
  if (opts?.beforeMs != null && opts.beforeMs > 0) {
    slice = slice.filter((e) => e.atMs < opts.beforeMs!);
  }

  const hasMore = slice.length > limit;
  const events = slice.slice(0, limit);
  const nextCursor = events.length > 0 ? events[events.length - 1].atMs : null;
  return { events, hasMore, nextCursor };
}

async function loadUpgradeNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const uniq = [...new Set(ids.filter(Boolean))];
  const rows = await prisma.upgrades.findMany({
    where: { id: { in: uniq } },
    select: { id: true, name: true }
  });
  for (const r of rows) map.set(String(r.id), String(r.name || r.id));
  return map;
}

export async function getAdminUserAccountTrace(params: AccountTraceParams): Promise<AccountTraceResponse | null> {
  const uid = Math.floor(params.userId);
  if (!Number.isFinite(uid) || uid <= 0) return null;

  const user = await prisma.users.findUnique({
    where: { id: uid },
    select: { id: true, username: true, email: true }
  });
  if (!user) return null;

  const gs = await prisma.game_states.findUnique({
    where: { user_id: uid },
    select: {
      usdc: true,
      black_market_balance: true,
      start_time: true,
      last_updated_at: true,
      total_usdc_deposited: true,
      total_crypto_withdrawn: true
    }
  });

  const header = await computePlayerGameHeaderSnapshot(uid);

  const summary: AccountTraceSummary = {
    userId: uid,
    username: user.username,
    email: user.email,
    accountCreatedAtMs: bigMs(gs?.start_time ?? null),
    lastSaveAtMs: bigMs(gs?.last_updated_at ?? null),
    usdc: gs?.usdc ?? 0,
    blackMarketBalance: gs?.black_market_balance ?? 0,
    totalUsdcDeposited: gs?.total_usdc_deposited ?? null,
    totalCryptoWithdrawn: gs?.total_crypto_withdrawn ?? null,
    totalHash: header.totalHash
  };

  const stockRows = await prisma.stock.findMany({
    where: { user_id: uid, qty: { gt: 0 } },
    select: { item_id: true, qty: true }
  });

  const placedRacks = await prisma.placed_racks.findMany({
    where: { user_id: uid },
    select: { id: true, item_id: true, room_id: true, slot_index: true }
  });
  const rackIds = placedRacks.map((r) => r.id);
  const slotRows =
    rackIds.length > 0
      ? await prisma.rack_slots.findMany({
          where: { rack_id: { in: rackIds }, machine_item_id: { not: null } },
          select: { rack_id: true, slot_index: true, machine_item_id: true }
        })
      : [];

  const listings = await prisma.player_listings.findMany({
    where: { user_id: uid },
    orderBy: { expires_at: 'desc' }
  });

  const p2pSold = await prisma.$queryRawUnsafe<
    Array<{
      id: bigint;
      created_at: bigint;
      buyer_id: number;
      seller_id: number;
      item_id: string;
      qty: number;
      unit_price: number;
      buyer_paid_usdc: number;
    }>
  >(
    `SELECT id, created_at, buyer_id, seller_id, item_id, qty, unit_price, buyer_paid_usdc
     FROM p2p_market_trade_history WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 200`,
    uid
  );

  const p2pBought = await prisma.$queryRawUnsafe<
    Array<{
      id: bigint;
      created_at: bigint;
      buyer_id: number;
      seller_id: number;
      item_id: string;
      qty: number;
      unit_price: number;
      buyer_paid_usdc: number;
    }>
  >(
    `SELECT id, created_at, buyer_id, seller_id, item_id, qty, unit_price, buyer_paid_usdc
     FROM p2p_market_trade_history WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 200`,
    uid
  );

  const shopRows = await prisma.shop_checkout_idempotency.findMany({
    where: { user_id: uid },
    orderBy: { created_at: 'desc' },
    take: 200
  });

  let boxRows: Array<{
    id: string;
    box_id: string;
    rewards_json: unknown;
    gained_usdc: unknown;
    created_at: bigint;
  }> = [];
  try {
    boxRows = await prisma.lucky_box_openings.findMany({
      where: { user_id: uid },
      orderBy: { created_at: 'desc' },
      take: 200,
      select: { id: true, box_id: true, rewards_json: true, gained_usdc: true, created_at: true }
    });
  } catch {
    boxRows = [];
  }

  const allItemIds = new Set<string>();
  for (const s of stockRows) allItemIds.add(String(s.item_id));
  for (const sl of slotRows) if (sl.machine_item_id) allItemIds.add(String(sl.machine_item_id));
  for (const pr of placedRacks) allItemIds.add(String(pr.item_id));
  for (const l of listings) allItemIds.add(String(l.item_id));
  for (const t of [...p2pSold, ...p2pBought]) allItemIds.add(String(t.item_id));
  for (const sh of shopRows) {
    for (const ln of parseJsonLines(sh.lines_json)) allItemIds.add(ln.id);
  }

  const itemNames = await loadUpgradeNames([...allItemIds]);

  const currentInventory: AccountTraceInventoryRow[] = stockRows
    .map((s) => ({
      itemId: String(s.item_id),
      itemName: itemNames.get(String(s.item_id)) ?? String(s.item_id),
      qty: Number(s.qty) || 0
    }))
    .sort((a, b) => b.qty - a.qty);

  const rackRoomMap = new Map(placedRacks.map((r) => [r.id, r.room_id]));
  const currentRigs: AccountTraceRigRow[] = placedRacks.map((pr) => {
    const miners = slotRows
      .filter((s) => s.rack_id === pr.id && s.machine_item_id)
      .map((s) => ({
        slotIndex: s.slot_index,
        itemId: String(s.machine_item_id),
        itemName: itemNames.get(String(s.machine_item_id)) ?? String(s.machine_item_id)
      }))
      .sort((a, b) => a.slotIndex - b.slotIndex);
    return {
      rackId: pr.id,
      chassisId: String(pr.item_id),
      chassisName: itemNames.get(String(pr.item_id)) ?? String(pr.item_id),
      roomId: pr.room_id,
      slotIndex: pr.slot_index,
      miners
    };
  });

  const mapListing = (l: (typeof listings)[0]): AccountTraceListingRow => ({
    listingId: l.id,
    itemId: String(l.item_id),
    itemName: itemNames.get(String(l.item_id)) ?? String(l.item_id),
    qty: Number(l.qty) || 1,
    price: Number(l.price) || 0,
    status: String(l.status || 'active'),
    expiresAtMs: bigMs(l.expires_at),
    reservedBy: l.reserved_by ?? null
  });

  const currentMarket = listings
    .filter((l) => ['active', 'awaiting_pickup', 'reserved'].includes(String(l.status || 'active')))
    .map(mapListing);

  const mapTrade = (
    t: (typeof p2pSold)[0],
    role: 'seller' | 'buyer'
  ): AccountTraceP2pTradeRow => ({
    id: String(t.id),
    atMs: Number(t.created_at),
    role,
    itemId: String(t.item_id),
    itemName: itemNames.get(String(t.item_id)) ?? String(t.item_id),
    qty: Number(t.qty) || 1,
    unitPrice: Number(t.unit_price) || 0,
    totalUsdc: Number(t.buyer_paid_usdc) || 0,
    counterpartyUserId: role === 'seller' ? t.buyer_id : t.seller_id
  });

  const sold = p2pSold.map((t) => mapTrade(t, 'seller'));
  const bought = p2pBought.map((t) => mapTrade(t, 'buyer'));

  const shopPurchases: AccountTraceShopRow[] = shopRows.map((sh) => ({
    atMs: Number(sh.created_at),
    totalCost: Number(sh.total_cost) || 0,
    newUsdc: Number(sh.new_usdc) || 0,
    lines: parseJsonLines(sh.lines_json)
  }));

  const boxOpenings: AccountTraceBoxRow[] = boxRows.map((b) => ({
    id: b.id,
    atMs: Number(b.created_at),
    boxId: String(b.box_id),
    rewards: parseRewardsJson(b.rewards_json),
    gainedUsdc: Number(b.gained_usdc) || 0
  }));

  const acquired = new Map<string, number>();
  const soldP2pMap = new Map<string, number>();
  const stockMap = new Map(currentInventory.map((i) => [i.itemId, i.qty]));
  const onRigsMap = new Map<string, Array<{ rackId: string; slotIndex: number; roomId: string | null }>>();
  const listedP2pMap = new Map<string, number>();

  for (const sh of shopPurchases) {
    for (const ln of sh.lines) {
      acquired.set(ln.id, (acquired.get(ln.id) ?? 0) + ln.qty);
    }
  }
  for (const b of boxOpenings) {
    for (const [id, qty] of rewardsToItemQty(b.rewards)) {
      acquired.set(id, (acquired.get(id) ?? 0) + qty);
    }
  }
  for (const t of bought) {
    acquired.set(t.itemId, (acquired.get(t.itemId) ?? 0) + t.qty);
  }
  for (const t of sold) {
    soldP2pMap.set(t.itemId, (soldP2pMap.get(t.itemId) ?? 0) + t.qty);
  }

  for (const sl of slotRows) {
    if (!sl.machine_item_id) continue;
    const itemId = String(sl.machine_item_id);
    const arr = onRigsMap.get(itemId) ?? [];
    arr.push({
      rackId: sl.rack_id,
      slotIndex: sl.slot_index,
      roomId: rackRoomMap.get(sl.rack_id) ?? null
    });
    onRigsMap.set(itemId, arr);
  }

  for (const l of currentMarket) {
    listedP2pMap.set(l.itemId, (listedP2pMap.get(l.itemId) ?? 0) + l.qty);
  }

  const itemDisposition = buildItemDisposition({
    itemNames,
    stock: stockMap,
    onRigs: onRigsMap,
    listedP2p: listedP2pMap,
    acquired,
    soldP2p: soldP2pMap
  });

  const timelineLimit = clamp(params.timelineLimit ?? 100, 1, 200);
  const mongoCap = Math.min(500, timelineLimit * 3);
  const { rows: mongoRows } = await listAdminUserActivityLogsMongo(uid, mongoCap, {
    beforeMs: params.timelineBeforeMs ?? null
  });

  const mongoEvents = mongoRows.map((r) =>
    mongoRowToTraceEvent({
      id: r.id,
      action: r.action,
      meta: r.meta,
      createdAt: r.createdAt,
      source: r.id.startsWith('action:') ? 'mongo_action' : 'mongo_game'
    })
  );

  const pgEvents: AccountTraceEvent[] = [];
  for (const t of sold) {
    if (params.fromMs != null && t.atMs < params.fromMs) continue;
    if (params.toMs != null && t.atMs > params.toMs) continue;
    pgEvents.push(formatP2pTradeEvent(t, 'seller'));
  }
  for (const t of bought) {
    if (params.fromMs != null && t.atMs < params.fromMs) continue;
    if (params.toMs != null && t.atMs > params.toMs) continue;
    pgEvents.push(formatP2pTradeEvent(t, 'buyer'));
  }
  shopPurchases.forEach((sh, i) => {
    if (params.fromMs != null && sh.atMs < params.fromMs) return;
    if (params.toMs != null && sh.atMs > params.toMs) return;
    pgEvents.push(formatShopPurchaseEvent(sh, i));
  });

  const { events: timeline, hasMore: timelineHasMore, nextCursor: timelineNextCursor } = mergeTimelineEvents(
    mongoEvents,
    pgEvents,
    {
      fromMs: params.fromMs,
      toMs: params.toMs,
      beforeMs: params.timelineBeforeMs,
      limit: timelineLimit
    }
  );

  return {
    summary,
    currentInventory,
    currentRigs,
    currentMarket,
    p2p: { sold, bought, activeListings: currentMarket },
    shopPurchases,
    boxOpenings,
    itemDisposition,
    timeline,
    timelineHasMore,
    timelineNextCursor
  };
}
