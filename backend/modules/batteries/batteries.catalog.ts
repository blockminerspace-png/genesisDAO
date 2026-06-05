/**
 * `placed_racks.battery_id` pode ser o id de catálogo (upgrades.id) ou o id de instância em `stored_batteries`.
 * Cron / ranking devem resolver para o id de catálogo antes de consultar `upgrades`.
 */
export function resolvePlacedRackBatteryCatalogId(
  batteryIdRaw: unknown,
  storedInstanceIdToCatalogId: Map<string, string>,
  snapshotCatalogIdRaw?: unknown
): string {
  const s = batteryIdRaw == null ? '' : String(batteryIdRaw).trim();
  if (!s) return '';
  const snap = snapshotCatalogIdRaw == null ? '' : normalizeKnown1000WhBatteryCatalogId(snapshotCatalogIdRaw);
  if (snap) return snap;
  return storedInstanceIdToCatalogId.get(s) || s;
}

/**
 * Catálogo canónico único: toda bateria do sistema é `battery_estelar`, infinita
 * por design. Migração `20260516120000_all_batteries_become_estelar` colapsa todas
 * as instâncias e o stock para este id; o normalizador abaixo cobre referências
 * em código / payloads enviados por clientes antigos.
 */
export const CANONICAL_1000WH_BATTERY_ID = 'battery_estelar';

/** Ids legados conhecidos que devem ser tratados como `battery_estelar`. */
export const LEGACY_1000WH_BATTERY_IDS = new Set([
  'small_battery',
  'battery_protostar',
  'battery_stellar'
]);

/**
 * IDs removidos do catálogo em `20260516200000_purge_all_legacy_battery_and_charger_residue`.
 * Stock / save-game não devem reintroduzi-los (evita placeholders `temp_legacy_*`).
 */
export const PURGED_LEGACY_STOCK_IDS = new Set([
  'charger_a1',
  'charger_a2',
  'battery_aa',
  'battery_car',
  'battery_diesel',
  'battery_fusion',
  'battery_nebula',
  'battery_protostar',
  'battery_ups',
  'battery_wall',
  'nebula',
  'small_battery',
  'supernova'
]);

/** Subconjunto expurgado que deve fundir-se em `battery_estelar` (não carregadores). */
export const PURGED_LEGACY_STOCK_REMAP_TO_ESTELAR = new Set(
  [...PURGED_LEGACY_STOCK_IDS].filter((id) => !id.startsWith('charger_'))
);

export const KNOWN_INFINITE_BATTERY_IDS = new Set([
  'battery_estelar',
  'battery_protostar',
  'battery_stellar'
]);

export function remapPurgedStockItemId(itemIdRaw: unknown): string {
  const itemId = itemIdRaw == null ? '' : String(itemIdRaw).trim();
  if (!itemId) return '';
  if (PURGED_LEGACY_STOCK_REMAP_TO_ESTELAR.has(itemId)) return CANONICAL_1000WH_BATTERY_ID;
  if (PURGED_LEGACY_STOCK_IDS.has(itemId)) return '';
  return itemId;
}

/** Normalização de chaves de `stock` no save-game e saneamento de BD. */
export function normalizeStockCatalogItemId(itemIdRaw: unknown): string {
  const legacy = normalizeKnown1000WhBatteryCatalogId(itemIdRaw);
  return remapPurgedStockItemId(legacy);
}

export function normalizeKnown1000WhBatteryCatalogId(itemIdRaw: unknown): string {
  const itemId = itemIdRaw == null ? '' : String(itemIdRaw).trim();
  if (!itemId) return '';
  return LEGACY_1000WH_BATTERY_IDS.has(itemId) ? CANONICAL_1000WH_BATTERY_ID : itemId;
}

/** ID determinístico para placeholder legacy (sem contador global por arranque). */
export function buildStableLegacyTempUpgradeId(userId: number, normalizedOriginal: string): string {
  const slug =
    normalizedOriginal
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'sem-id';
  return `temp_legacy_${userId}_${slug}`.slice(0, 200);
}

/**
 * Sistema de baterias é infinito por design: qualquer bateria existente é tratada
 * como ilimitada, sem necessidade de carregar. Mantemos guard para id vazio para
 * preservar semântica "sem bateria equipada" nos chamadores.
 */
export function isKnownInfiniteBatteryCatalogId(itemIdRaw: unknown): boolean {
  const itemId = normalizeKnown1000WhBatteryCatalogId(itemIdRaw).toLowerCase();
  if (!itemId) return false;
  return true;
}
