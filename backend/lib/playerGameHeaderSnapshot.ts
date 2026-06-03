import { prisma } from '../config/prisma.js';
import { isCheckinFrozenForUser } from '../modules/checkin/checkin.service.js';
import { normalizePlacedRackRoomId } from '../modules/batteries/batteries.validation.js';
import {
  listSlotMiningCredits,
  NFT_AUTO_POLICY_ROOM_NAME_KEYS,
  NFT_AUTO_ROOM_ID,
  type UpgradeMiningRow
} from './nftRoomMining.js';

function num(v: unknown, def = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : def;
}

export type UpgradeRow = {
  base: number;
  mult: number;
  cap: number | null;
  type: string;
  category: string | null;
  nft_mining_coin_id: string | null;
};

function parsePowerCapacity(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return raw === -1 ? -1 : num(raw);
  const s = String(raw).trim();
  if (s === '-1') return -1;
  return num(s);
}

/** Catálogo `upgrades` muda raramente; evita leitura completa a cada tick do WS (por jogador). */
const UPGRADES_CATALOG_CACHE_TTL_MS = Math.min(
  600_000,
  Math.max(15_000, parseInt(String(process.env.UPGRADES_SNAPSHOT_CACHE_TTL_MS || '60000'), 10) || 60_000)
);

let upgradesCatalogCache: {
  map: Map<string, UpgradeRow>;
  miningMap: Map<string, UpgradeMiningRow>;
  expiresAt: number;
} | null = null;

/** Só para testes (Vitest); invalida cache entre casos. */
export function resetUpgradesCatalogCacheForTests(): void {
  upgradesCatalogCache = null;
}

function normalizeRigRoomPolicyNameKey(name: unknown): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

async function loadNftMiningRoomIds(): Promise<Set<string>> {
  const rows = await prisma.rig_rooms.findMany({ select: { id: true, name: true } });
  const policyKeys = new Set<string>(NFT_AUTO_POLICY_ROOM_NAME_KEYS);
  const ids = new Set<string>();
  const canonical = normalizePlacedRackRoomId(NFT_AUTO_ROOM_ID);
  for (const r of rows) {
    const id = normalizePlacedRackRoomId(r.id);
    if (id === canonical || policyKeys.has(normalizeRigRoomPolicyNameKey(r.name))) ids.add(id);
  }
  ids.add(canonical);
  return ids;
}

async function loadUpgradesCatalogMaps(): Promise<{
  catalog: Map<string, UpgradeRow>;
  mining: Map<string, UpgradeMiningRow>;
}> {
  const now = Date.now();
  if (upgradesCatalogCache && upgradesCatalogCache.expiresAt > now) {
    return { catalog: upgradesCatalogCache.map, mining: upgradesCatalogCache.miningMap };
  }
  const upRows = await prisma.upgrades.findMany({
    select: {
      id: true,
      base_production: true,
      multiplier: true,
      power_capacity: true,
      type: true,
      category: true,
      nft_mining_coin_id: true
    }
  });
  const upgrades = new Map<string, UpgradeRow>();
  const upgradesMining = new Map<string, UpgradeMiningRow>();
  for (const u of upRows) {
    const id = String(u.id);
    const cap = parsePowerCapacity(u.power_capacity);
    upgrades.set(id, {
      base: num(u.base_production),
      mult: num(u.multiplier),
      cap,
      type: String(u.type ?? ''),
      category: u.category != null ? String(u.category) : null,
      nft_mining_coin_id: u.nft_mining_coin_id != null ? String(u.nft_mining_coin_id) : null
    });
    upgradesMining.set(id, {
      id,
      type: u.type,
      category: u.category,
      base_production: u.base_production,
      multiplier: u.multiplier,
      nft_mining_coin_id: u.nft_mining_coin_id
    });
  }
  upgradesCatalogCache = {
    map: upgrades,
    miningMap: upgradesMining,
    expiresAt: now + UPGRADES_CATALOG_CACHE_TTL_MS
  };
  return { catalog: upgrades, mining: upgradesMining };
}

export type PlayerGameHeaderPayload = {
  coinBalances: Record<string, number>;
  usdc: number;
  hashByCoinId: Record<string, number>;
  totalHash: number;
  serverUpdatedAt: number;
};

/**
 * Saldos USDC/moedas e hashrate por moeda + total, a partir da BD (alinhado ao cálculo de produção do cliente).
 */
export async function computePlayerGameHeaderSnapshot(userId: number): Promise<PlayerGameHeaderPayload> {
  const gs = await prisma.game_states.findUnique({
    where: { user_id: userId },
    select: { usdc: true, server_updated_at: true, last_checkin_at_ms: true }
  });
  if (!gs) {
    return {
      coinBalances: {},
      usdc: 0,
      hashByCoinId: {},
      totalHash: 0,
      serverUpdatedAt: Date.now()
    };
  }
  const usdc = num(gs.usdc);
  const su = gs.server_updated_at;
  const serverUpdatedAt = su == null ? Date.now() : Number(su) || Date.now();

  const balRows = await prisma.coin_balances.findMany({
    where: { user_id: userId },
    select: { coin_id: true, amount: true }
  });
  const coinBalances: Record<string, number> = {};
  for (const row of balRows) {
    coinBalances[String(row.coin_id)] = num(row.amount);
  }

  const { mining: upgradesMining } = await loadUpgradesCatalogMaps();

  const lastCheckinAtMs = gs.last_checkin_at_ms != null ? Number(gs.last_checkin_at_ms) : null;
  const checkinFrozen = await isCheckinFrozenForUser(userId, lastCheckinAtMs, Date.now());

  const racksRows = checkinFrozen
    ? []
    : await prisma.placed_racks.findMany({
        where: { user_id: userId },
        select: {
          id: true,
          is_on: true,
          wiring_id: true,
          battery_id: true,
          selected_coin_id: true,
          room_id: true
        }
      });
  const rackIds = racksRows.map((r) => String(r.id));
  const slotsMap = new Map<string, string[]>();
  const multiMap = new Map<string, string[]>();
  if (rackIds.length > 0) {
    const slots = await prisma.rack_slots.findMany({
      where: { rack_id: { in: rackIds } },
      orderBy: [{ rack_id: 'asc' }, { slot_index: 'asc' }],
      select: { rack_id: true, slot_index: true, machine_item_id: true }
    });
    for (const s of slots) {
      const rid = String(s.rack_id);
      if (!slotsMap.has(rid)) slotsMap.set(rid, []);
      const arr = slotsMap.get(rid)!;
      const idx = Math.max(0, Math.floor(num(s.slot_index, 0)));
      while (arr.length <= idx) arr.push('');
      arr[idx] = s.machine_item_id ? String(s.machine_item_id) : '';
    }
    const mults = await prisma.rack_multiplier_slots.findMany({
      where: { rack_id: { in: rackIds } },
      orderBy: [{ rack_id: 'asc' }, { slot_index: 'asc' }],
      select: { rack_id: true, slot_index: true, multiplier_item_id: true }
    });
    for (const m of mults) {
      const rid = String(m.rack_id);
      if (!multiMap.has(rid)) multiMap.set(rid, []);
      const arr = multiMap.get(rid)!;
      const idx = Math.max(0, Math.floor(num(m.slot_index, 0)));
      while (arr.length <= idx) arr.push('');
      arr[idx] = m.multiplier_item_id ? String(m.multiplier_item_id) : '';
    }
  }

  const nftRoomIds = await loadNftMiningRoomIds();
  const hashByCoinId: Record<string, number> = {};
  let totalHash = 0;

  for (const r of racksRows) {
    const isOn = Number(r.is_on) === 1;
    const wiringId = r.wiring_id ? String(r.wiring_id).trim() : '';
    const batteryId = r.battery_id ? String(r.battery_id).trim() : '';

    // Baterias são instâncias UUID infinitas: rig opera se montada e ligada.
    if (!isOn || !wiringId || !batteryId) continue;

    const rid = String(r.id);
    const slots = slotsMap.get(rid) || [];
    const multSlots = multiMap.get(rid) || [];
    const roomId = r.room_id != null ? String(r.room_id) : null;
    const selectedCoinId = r.selected_coin_id ? String(r.selected_coin_id).trim() : '';
    const credits = listSlotMiningCredits(
      roomId,
      slots,
      multSlots,
      upgradesMining,
      selectedCoinId,
      nftRoomIds
    );
    for (const sc of credits) {
      if (!Number.isFinite(sc.effectiveBaseProd) || sc.effectiveBaseProd <= 0) continue;
      hashByCoinId[sc.coinId] = (hashByCoinId[sc.coinId] || 0) + sc.effectiveBaseProd;
      totalHash += sc.effectiveBaseProd;
    }
  }

  return { coinBalances, usdc, hashByCoinId, totalHash, serverUpdatedAt };
}
