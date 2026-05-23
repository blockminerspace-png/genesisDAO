import { prisma } from '../config/db.js';
import { normalizePlacedRackRoomId } from '../modules/batteries/batteries.validation.js';
import {
  listSlotMiningCredits,
  NFT_AUTO_POLICY_ROOM_NAME_KEYS,
  NFT_AUTO_ROOM_ID,
  type UpgradeMiningRow
} from './nftRoomMining.js';

type CoinLite = { id: string; name: string; symbol: string };

type PublicRankingUser = {
  user_id: number;
  username: string;
  coins: Record<string, number>;
};

type AdminRankingUser = PublicRankingUser & {
  balances: Record<string, number>;
};

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

function buildUpgradesMiningMap(
  upgrades: Array<{
    id: string;
    type: string;
    category: string;
    base_production: number;
    multiplier: number | null;
    nft_mining_coin_id: string | null;
  }>
): Map<string, UpgradeMiningRow> {
  const m = new Map<string, UpgradeMiningRow>();
  for (const u of upgrades) {
    m.set(u.id, {
      id: u.id,
      type: u.type,
      category: u.category,
      base_production: u.base_production,
      multiplier: u.multiplier,
      nft_mining_coin_id: u.nft_mining_coin_id
    });
  }
  return m;
}

function slotIdsFromRows(rows: Array<{ machine_item_id: string | null }>): string[] {
  const out: string[] = [];
  for (const s of rows) {
    if (s.machine_item_id) out.push(String(s.machine_item_id));
  }
  return out;
}

function multIdsFromRows(rows: Array<{ multiplier_item_id: string | null }>): string[] {
  const out: string[] = [];
  for (const m of rows) {
    if (m.multiplier_item_id) out.push(String(m.multiplier_item_id));
  }
  return out;
}

/** Poder por moeda (alinhado com `listSlotMiningCredits` / header do jogo). */
async function accumulateRankingPowerFromRacks(
  rankingData: Map<number, PublicRankingUser>,
  racks: Array<{
    id: string;
    user_id: number;
    selected_coin_id: string | null;
    room_id: string | null;
  }>,
  slotsByRack: Map<string, Array<{ machine_item_id: string | null }>>,
  multByRack: Map<string, Array<{ multiplier_item_id: string | null }>>,
  upgradesMining: Map<string, UpgradeMiningRow>,
  nftRoomIds: Set<string>,
  usernameById: Map<number, string>
): Promise<void> {
  for (const rack of racks) {
    const uname = usernameById.get(rack.user_id);
    if (uname == null) continue;

    const slots = slotIdsFromRows(slotsByRack.get(rack.id) || []);
    const multSlots = multIdsFromRows(multByRack.get(rack.id) || []);
    const selectedCoinId = rack.selected_coin_id ? String(rack.selected_coin_id).trim() : '';
    const credits = listSlotMiningCredits(
      rack.room_id != null ? String(rack.room_id) : null,
      slots,
      multSlots,
      upgradesMining,
      selectedCoinId,
      nftRoomIds
    );
    if (credits.length === 0) continue;

    if (!rankingData.has(rack.user_id)) {
      rankingData.set(rack.user_id, {
        user_id: rack.user_id,
        username: uname,
        coins: {}
      });
    }
    const uData = rankingData.get(rack.user_id)!;
    for (const sc of credits) {
      if (!Number.isFinite(sc.effectiveBaseProd) || sc.effectiveBaseProd <= 0) continue;
      uData.coins[sc.coinId] = (uData.coins[sc.coinId] || 0) + sc.effectiveBaseProd;
    }
  }
}

/** Ranking público: poder por moeda por utilizador (mesmas regras que o jogo). */
export async function getPublicMiningRankingPayload(): Promise<{
  timestamp: number;
  ranking: PublicRankingUser[];
  coins: CoinLite[];
}> {
  const coins = await prisma.mining_coins.findMany({
    select: { id: true, name: true, symbol: true }
  });

  const upgrades = await prisma.upgrades.findMany({
    select: {
      id: true,
      type: true,
      category: true,
      base_production: true,
      multiplier: true,
      nft_mining_coin_id: true
    }
  });
  const upgradesMining = buildUpgradesMiningMap(upgrades);
  const nftRoomIds = await loadNftMiningRoomIds();

  const eligibleUsers = await prisma.users.findMany({
    where: { is_blocked: 0, ranking_excluded: 0 },
    select: { id: true, username: true }
  });
  const usernameById = new Map(eligibleUsers.map((u) => [u.id, u.username]));
  const eligibleIds = eligibleUsers.map((u) => u.id);

  const racks =
    eligibleIds.length === 0
      ? []
      : await prisma.placed_racks.findMany({
          where: {
            is_on: 1,
            user_id: { in: eligibleIds },
            wiring_id: { not: null },
            battery_id: { not: null }
          },
          select: {
            id: true,
            user_id: true,
            selected_coin_id: true,
            room_id: true
          }
        });

  const rackIds = racks.map((r) => r.id);
  const allSlots =
    rackIds.length === 0
      ? []
      : await prisma.rack_slots.findMany({
          where: { rack_id: { in: rackIds } },
          select: { rack_id: true, machine_item_id: true }
        });
  const allMult =
    rackIds.length === 0
      ? []
      : await prisma.rack_multiplier_slots.findMany({
          where: { rack_id: { in: rackIds } },
          select: { rack_id: true, multiplier_item_id: true }
        });

  const slotsByRack = new Map<string, Array<{ machine_item_id: string | null }>>();
  for (const s of allSlots) {
    const k = s.rack_id;
    if (!slotsByRack.has(k)) slotsByRack.set(k, []);
    slotsByRack.get(k)!.push(s);
  }
  const multByRack = new Map<string, Array<{ multiplier_item_id: string | null }>>();
  for (const m of allMult) {
    const k = m.rack_id;
    if (!multByRack.has(k)) multByRack.set(k, []);
    multByRack.get(k)!.push(m);
  }

  const rankingData = new Map<number, PublicRankingUser>();
  await accumulateRankingPowerFromRacks(
    rankingData,
    racks,
    slotsByRack,
    multByRack,
    upgradesMining,
    nftRoomIds,
    usernameById
  );

  return {
    timestamp: Date.now(),
    ranking: Array.from(rankingData.values()),
    coins: coins.map((c) => ({ id: c.id, name: c.name, symbol: c.symbol }))
  };
}

/** Ranking admin: poder + saldos `coin_balances` por moeda minerável. */
export async function getAdminMiningRankingPayload(): Promise<{
  timestamp: number;
  ranking: AdminRankingUser[];
  coins: CoinLite[];
}> {
  const coins = await prisma.mining_coins.findMany({
    select: { id: true, name: true, symbol: true }
  });
  const coinsMap = new Map(coins.map((c) => [c.id, c]));

  const upgrades = await prisma.upgrades.findMany({
    select: {
      id: true,
      type: true,
      category: true,
      base_production: true,
      multiplier: true,
      nft_mining_coin_id: true
    }
  });
  const upgradesMining = buildUpgradesMiningMap(upgrades);
  const nftRoomIds = await loadNftMiningRoomIds();

  const eligibleUsers = await prisma.users.findMany({
    where: { is_blocked: 0, ranking_excluded: 0 },
    select: { id: true, username: true }
  });
  const eligibleIds = eligibleUsers.map((u) => u.id);

  const rankingData = new Map<number, AdminRankingUser>();
  for (const u of eligibleUsers) {
    rankingData.set(u.id, {
      user_id: u.id,
      username: u.username,
      coins: {},
      balances: {}
    });
  }

  const racks =
    eligibleIds.length === 0
      ? []
      : await prisma.placed_racks.findMany({
          where: {
            is_on: 1,
            user_id: { in: eligibleIds },
            wiring_id: { not: null },
            battery_id: { not: null }
          },
          select: {
            id: true,
            user_id: true,
            selected_coin_id: true,
            room_id: true
          }
        });

  const rackIds = racks.map((r) => r.id);
  const allSlots =
    rackIds.length === 0
      ? []
      : await prisma.rack_slots.findMany({
          where: { rack_id: { in: rackIds } },
          select: { rack_id: true, machine_item_id: true }
        });
  const allMult =
    rackIds.length === 0
      ? []
      : await prisma.rack_multiplier_slots.findMany({
          where: { rack_id: { in: rackIds } },
          select: { rack_id: true, multiplier_item_id: true }
        });

  const slotsByRack = new Map<string, Array<{ machine_item_id: string | null }>>();
  for (const s of allSlots) {
    const k = s.rack_id;
    if (!slotsByRack.has(k)) slotsByRack.set(k, []);
    slotsByRack.get(k)!.push(s);
  }
  const multByRack = new Map<string, Array<{ multiplier_item_id: string | null }>>();
  for (const m of allMult) {
    const k = m.rack_id;
    if (!multByRack.has(k)) multByRack.set(k, []);
    multByRack.get(k)!.push(m);
  }

  await accumulateRankingPowerFromRacks(
    rankingData,
    racks,
    slotsByRack,
    multByRack,
    upgradesMining,
    nftRoomIds,
    new Map(eligibleUsers.map((u) => [u.id, u.username]))
  );

  const coinIdsForBalances = Array.from(coinsMap.keys());
  if (coinIdsForBalances.length > 0) {
    const balances = await prisma.coin_balances.findMany({
      where: { coin_id: { in: coinIdsForBalances } },
      select: { user_id: true, coin_id: true, amount: true }
    });
    for (const b of balances) {
      const userEntry = rankingData.get(b.user_id);
      if (userEntry) userEntry.balances[b.coin_id] = b.amount;
    }
  }

  const result = Array.from(rankingData.values()).filter((u) => {
    const hasPower = Object.values(u.coins).some((v) => Number(v) > 0);
    const hasBalance = Object.values(u.balances).some((v) => Number(v) > 0);
    return hasPower || hasBalance;
  });

  return {
    timestamp: Date.now(),
    ranking: result,
    coins: Array.from(coinsMap.values())
  };
}
