import { normalizePlacedRackRoomId } from '../modules/batteries/batteries.validation.js';
import { listSlotMiningCredits, type UpgradeMiningRow } from './nftRoomMining.js';

/** Subconjunto de `upgrades` necessário para a calculadora de mineração. */
export type CalculatorUpgradeLite = {
  id: string;
  type: string;
  category?: string;
  baseProduction: number;
  multiplier: number | null;
  powerCapacity: number | null;
  nftMiningCoinId?: string | null;
};

export type CalculatorRackForProjection = {
  roomId: string | null;
  wiringId: string | null;
  batteryId: string | null;
  batteryCatalogItemId?: string | null;
  isOn: boolean;
  selectedCoinId: string | null;
  slots: (string | null)[];
  multiplierSlots: (string | null)[];
};

/** Hashrate de rede efectiva (≥1), alinhado ao bootstrap / calculadora legada. */
export function effectiveNetworkHashrateForCoin(coinId: string, dbNetworkHashrate: number, runtimeByCoin: Map<string, number>): number {
  const dyn = runtimeByCoin.get(coinId);
  const base = Number(dbNetworkHashrate);
  const chosen = dyn != null && dyn > 0 ? dyn : base;
  return Math.max(1, Number.isFinite(chosen) ? chosen : 1);
}

/**
 * Soma H/s por `mining_coins.id` a partir das rigs operacionais (mesma regra que `PlayerCalculator` no cliente).
 */
export function computeUserHashByCoinId(
  racks: CalculatorRackForProjection[],
  upgradesById: Map<string, CalculatorUpgradeLite>,
  scopeRoom: 'total' | string
): Record<string, number> {
  const out: Record<string, number> = {};
  const scopeNorm = scopeRoom === 'total' ? 'total' : normalizePlacedRackRoomId(scopeRoom);

  for (const rack of racks) {
    if (scopeRoom !== 'total') {
      const rNorm = normalizePlacedRackRoomId(rack.roomId);
      if (rNorm !== scopeNorm) continue;
    }

    const isOperational = rack.isOn && Boolean(rack.wiringId) && Boolean(rack.batteryId);
    if (!isOperational) continue;

    const upgradesMap = new Map<string, UpgradeMiningRow>();
    for (const sid of rack.slots) {
      if (!sid) continue;
      const machine = upgradesById.get(String(sid));
      if (!machine) continue;
      upgradesMap.set(String(sid), {
        id: machine.id,
        type: machine.type,
        category: machine.category,
        base_production: machine.baseProduction,
        multiplier: machine.multiplier,
        nft_mining_coin_id: machine.nftMiningCoinId
      });
    }
    for (const sid of rack.multiplierSlots || []) {
      if (!sid) continue;
      const modifier = upgradesById.get(String(sid));
      if (!modifier) continue;
      upgradesMap.set(String(sid), {
        id: modifier.id,
        type: modifier.type,
        base_production: 0,
        multiplier: modifier.multiplier,
        nft_mining_coin_id: null
      });
    }

    const slotCredits = listSlotMiningCredits(
      rack.roomId,
      rack.slots.filter((s): s is string => Boolean(s)),
      (rack.multiplierSlots || []).filter((s): s is string => Boolean(s)),
      upgradesMap,
      rack.selectedCoinId != null ? String(rack.selectedCoinId).trim() : ''
    );
    for (const sc of slotCredits) {
      out[sc.coinId] = (out[sc.coinId] || 0) + sc.effectiveBaseProd;
    }
  }
  return out;
}

export function computeDailyEarnings(
  userHashHps: number,
  blockTimeSec: number,
  effectiveNetworkHash: number,
  blockReward: number,
  priceUsd: number
): { dailyCoins: number; dailyUsd: number } {
  const bt = Number(blockTimeSec);
  const net = Number(effectiveNetworkHash);
  if (!Number.isFinite(bt) || bt <= 0 || !Number.isFinite(net) || net <= 0) {
    return { dailyCoins: 0, dailyUsd: 0 };
  }
  const uh = Number(userHashHps);
  if (!Number.isFinite(uh) || uh < 0) return { dailyCoins: 0, dailyUsd: 0 };

  const share = uh / net;
  const blocksPerDay = 86400 / bt;
  const br = Number(blockReward);
  const dailyCoins = share * (Number.isFinite(br) ? br : 0) * blocksPerDay;
  const pu = Number(priceUsd);
  const dailyUsd = dailyCoins * (Number.isFinite(pu) ? pu : 0);
  return { dailyCoins, dailyUsd };
}

export const CALCULATOR_PROJECTION_PERIODS: { label: string; multiplier: number }[] = [
  { label: '1 Hora', multiplier: 1 / 24 },
  { label: '24 Horas', multiplier: 1 },
  { label: '7 Dias', multiplier: 7 },
  { label: '30 Dias', multiplier: 30 },
  { label: '1 Ano', multiplier: 365 }
];
