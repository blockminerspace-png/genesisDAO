/**
 * Sala NFT (NFTs AUTO): apenas ASICs; cada modelo de ASIC minera a moeda
 * definida em `upgrades.nft_mining_coin_id` (painel admin).
 */
import { normalizePlacedRackRoomId } from '../modules/batteries/batteries.validation.js';

export const NFT_AUTO_ROOM_ID = 'room_1775484506874';
export const NFT_AUTO_ALLOWED_CHASSIS_ID = 'armario_1';
export const NFT_AUTO_POLICY_ROOM_NAME_KEYS = ['nfts auto', 'nft auto', 'nfts arbam'] as const;

/** Só mineiráveis na Sala NFT (ASIC + moeda admin). Símbolos canónicos (uppercase). */
export const NFT_ROOM_EXCLUSIVE_MINING_COIN_SYMBOLS = ['USDT', 'CBBTC', 'DAI', 'GHO', 'GEMT'] as const;

/** Stables: fallback $1 em payback se taxa USD ausente na BD. */
export const NFT_ROOM_STABLE_USD_SYMBOLS = ['DAI', 'USDT', 'GHO'] as const;

const NFT_EXCLUSIVE_COIN_ID_KEYS = ['usdt', 'cbbtc', 'dai', 'gho', 'gemt'] as const;

export function normalizeMiningCoinSymbolKey(symbol: unknown): string {
  return String(symbol ?? '')
    .trim()
    .toUpperCase();
}

export function isNftRoomExclusiveMiningCoinSymbol(symbol: unknown): boolean {
  return (NFT_ROOM_EXCLUSIVE_MINING_COIN_SYMBOLS as readonly string[]).includes(
    normalizeMiningCoinSymbolKey(symbol)
  );
}

/** Por id de `mining_coins` ou símbolo (USDT, cbBTC, DAI, GHO, GEMT). */
export function isNftRoomExclusiveMiningCoinRef(
  ref: { id?: unknown; symbol?: unknown } | string | null | undefined
): boolean {
  if (ref == null) return false;
  if (typeof ref === 'string') {
    const low = ref.trim().toLowerCase();
    if (!low) return false;
    return (NFT_EXCLUSIVE_COIN_ID_KEYS as readonly string[]).some(
      (k) => low === k || low.endsWith(`_${k}`) || low.startsWith(`${k}_`)
    );
  }
  if (isNftRoomExclusiveMiningCoinSymbol(ref.symbol)) return true;
  return isNftRoomExclusiveMiningCoinRef(String(ref.id ?? ''));
}

export const NFT_ROOM_EXCLUSIVE_COIN_ERROR_PT =
  'USDT, cbBTC, DAI, GHO e GEMT só podem ser mineirados por ASICs na Sala NFT.';

export type UpgradeMiningRow = {
  id?: unknown;
  type?: unknown;
  category?: unknown;
  base_production?: unknown;
  multiplier?: unknown;
  nft_mining_coin_id?: unknown;
};

function normalizeRigRoomPolicyNameKey(name: unknown): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isNftAutoRoomId(roomId: string | null | undefined): boolean {
  const id = normalizePlacedRackRoomId(roomId);
  return id === NFT_AUTO_ROOM_ID;
}

/** Salas NFT (id fixo + nomes «NFTs AUTO», etc.) — alinhado com `resolveNftAutoArmario1OnlyRoomIds`. */
export function isNftMiningRoomId(
  roomId: string | null | undefined,
  nftRoomIds: ReadonlySet<string>
): boolean {
  const id = normalizePlacedRackRoomId(roomId);
  return nftRoomIds.has(id);
}

export async function resolveNftAutoArmario1OnlyRoomIds(q: {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ id?: unknown }> }>;
}): Promise<Set<string>> {
  const r = await q.query(
    `SELECT id FROM rig_rooms
     WHERE id = $1
        OR lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = ANY($2::text[])`,
    [NFT_AUTO_ROOM_ID, NFT_AUTO_POLICY_ROOM_NAME_KEYS]
  );
  const ids = new Set<string>();
  for (const row of r.rows) {
    const id = row.id != null ? String(row.id).trim() : '';
    if (id) ids.add(normalizePlacedRackRoomId(id));
  }
  ids.add(normalizePlacedRackRoomId(NFT_AUTO_ROOM_ID));
  return ids;
}

function coinUsdNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Taxa USD para payback NFT: `usdc_rate` / `price_usd`, com fallback 1.0 em stables (DAI, USDT, GHO). */
export function resolveMiningCoinUsdRate(coin: {
  id?: unknown;
  symbol?: unknown;
  usdc_rate?: unknown;
  price_usd?: unknown;
  usdcRate?: unknown;
  priceUSD?: unknown;
}): number {
  const usdc = coinUsdNumber(coin.usdc_rate ?? coin.usdcRate);
  if (usdc > 0) return usdc;
  const px = coinUsdNumber(coin.price_usd ?? coin.priceUSD);
  if (px > 0) return px;
  if (!isNftRoomExclusiveMiningCoinRef({ id: coin.id, symbol: coin.symbol })) return 0;
  const sym = normalizeMiningCoinSymbolKey(coin.symbol);
  if ((NFT_ROOM_STABLE_USD_SYMBOLS as readonly string[]).includes(sym)) return 1;
  // cbBTC: definir `usdc_rate` ou `price_usd` no admin (não é stable $1).
  return 0;
}

export function isNftAutoArmario1OnlyRoomRow(row: { id?: unknown; name?: unknown }): boolean {
  const id = String(row.id ?? '').trim();
  if (id === NFT_AUTO_ROOM_ID) return true;
  const kn = normalizeRigRoomPolicyNameKey(row.name);
  return (NFT_AUTO_POLICY_ROOM_NAME_KEYS as readonly string[]).includes(kn);
}

export function isAsicMachineUpgradeRow(up: UpgradeMiningRow | null | undefined): boolean {
  if (!up || String(up.type ?? '') !== 'machine') return false;
  const id = String(up.id ?? '').trim().toLowerCase();
  if (id.startsWith('asic_')) return true;
  const cat = String(up.category ?? '').trim().toLowerCase();
  return cat.includes('asic');
}

export function nftMiningCoinIdFromUpgrade(up: UpgradeMiningRow | null | undefined): string | null {
  if (!up) return null;
  const c = String(up.nft_mining_coin_id ?? '').trim();
  return c || null;
}

export function rackMultiplierFactor(
  multiplierSlots: string[],
  upgradesMap: Map<string, UpgradeMiningRow>
): number {
  let mult = 1;
  for (const sid of multiplierSlots) {
    if (!sid) continue;
    const up = upgradesMap.get(String(sid));
    if (!up) continue;
    const m = Number(up.multiplier);
    if (Number.isFinite(m)) mult += m;
  }
  return mult;
}

export type SlotMiningCredit = {
  coinId: string;
  /** Hashrate efectivo (base × multiplicadores da rig). */
  effectiveBaseProd: number;
};

/**
 * Créditos de mineração por moeda: sala normal usa `selected_coin_id` na rig;
 * sala NFT credita cada slot ASIC na moeda admin (`nft_mining_coin_id`).
 */
export function listSlotMiningCredits(
  roomId: string | null | undefined,
  slots: string[],
  multiplierSlots: string[],
  upgradesMap: Map<string, UpgradeMiningRow>,
  rackSelectedCoinId: string,
  nftRoomIds?: ReadonlySet<string>
): SlotMiningCredit[] {
  const mult = rackMultiplierFactor(multiplierSlots, upgradesMap);
  const isNftRoom = nftRoomIds ? isNftMiningRoomId(roomId, nftRoomIds) : isNftAutoRoomId(roomId);

  if (!isNftRoom) {
    const cid = rackSelectedCoinId.trim();
    if (!cid) return [];
    if (isNftRoomExclusiveMiningCoinRef(cid)) return [];
    let rackBase = 0;
    for (const sid of slots) {
      if (!sid) continue;
      const up = upgradesMap.get(String(sid));
      if (!up) continue;
      const bp = Number(up.base_production);
      if (Number.isFinite(bp)) rackBase += bp;
    }
    if (rackBase <= 0) return [];
    return [{ coinId: cid, effectiveBaseProd: rackBase * mult }];
  }

  const out: SlotMiningCredit[] = [];
  for (const sid of slots) {
    if (!sid) continue;
    const up = upgradesMap.get(String(sid));
    if (!up || !isAsicMachineUpgradeRow(up)) continue;
    const coinId = nftMiningCoinIdFromUpgrade(up);
    if (!coinId) continue;
    const bp = Number(up.base_production);
    if (!Number.isFinite(bp) || bp <= 0) continue;
    out.push({ coinId, effectiveBaseProd: bp * mult });
  }
  return out;
}
