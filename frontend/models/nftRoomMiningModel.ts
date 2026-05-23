import {
  isAsicMachineUpgrade,
  isNftRoomExclusiveMiningCoin,
  normalizePlacedRackRoomId,
  NFT_AUTO_ROOM_ID,
  type PlacedRack,
  type Upgrade
} from '../types';

export type SlotMiningCredit = {
  coinId: string;
  effectiveBaseProd: number;
};

function isNftAutoRoomId(roomId: string | null | undefined): boolean {
  return normalizePlacedRackRoomId(roomId) === NFT_AUTO_ROOM_ID;
}

function rackMultiplierFactor(multiplierSlots: (string | null)[], upgrades: Upgrade[]): number {
  let mult = 1;
  for (const sid of multiplierSlots) {
    if (!sid) continue;
    const up = upgrades.find((u) => u.id === sid);
    if (up?.multiplier != null && Number.isFinite(up.multiplier)) mult += Number(up.multiplier);
  }
  return mult;
}

/** Alinhado com `backend/lib/nftRoomMining.ts` → `listSlotMiningCredits`. */
export function listSlotMiningCredits(
  roomId: string | null | undefined,
  slots: (string | null)[],
  multiplierSlots: (string | null)[],
  upgrades: Upgrade[],
  rackSelectedCoinId: string
): SlotMiningCredit[] {
  const mult = rackMultiplierFactor(multiplierSlots, upgrades);

  if (!isNftAutoRoomId(roomId)) {
    const cid = rackSelectedCoinId.trim();
    if (!cid || isNftRoomExclusiveMiningCoin(cid)) return [];
    let rackBase = 0;
    for (const sid of slots) {
      if (!sid) continue;
      const up = upgrades.find((u) => u.id === sid);
      if (!up) continue;
      const bp = Number(up.baseProduction);
      if (Number.isFinite(bp)) rackBase += bp;
    }
    if (rackBase <= 0) return [];
    return [{ coinId: cid, effectiveBaseProd: rackBase * mult }];
  }

  const out: SlotMiningCredit[] = [];
  for (const sid of slots) {
    if (!sid) continue;
    const up = upgrades.find((u) => u.id === sid);
    if (!up || !isAsicMachineUpgrade(up)) continue;
    const coinId = up.nftMiningCoinId?.trim() || '';
    if (!coinId) continue;
    const bp = Number(up.baseProduction);
    if (!Number.isFinite(bp) || bp <= 0) continue;
    out.push({ coinId, effectiveBaseProd: bp * mult });
  }
  return out;
}

/** Hashrate por moeda para o cabeçalho (inclui Sala NFT / ASIC + moeda admin). */
export function computeHashByCoinFromPlacedRacks(
  racks: PlacedRack[],
  upgrades: Upgrade[]
): Record<string, number> {
  const hashByCoinId: Record<string, number> = {};
  for (const r of racks) {
    if (!r.isOn || !r.wiringId || !r.batteryId) continue;
    const credits = listSlotMiningCredits(
      r.roomId,
      r.slots,
      r.multiplierSlots || [],
      upgrades,
      r.selectedCoinId || ''
    );
    for (const sc of credits) {
      if (sc.effectiveBaseProd <= 0) continue;
      hashByCoinId[sc.coinId] = (hashByCoinId[sc.coinId] || 0) + sc.effectiveBaseProd;
    }
  }
  return hashByCoinId;
}
