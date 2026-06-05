import { describe, it, expect } from 'vitest';
import {
  buildStableLegacyTempUpgradeId,
  normalizeStockCatalogItemId,
  remapPurgedStockItemId,
  CANONICAL_1000WH_BATTERY_ID
} from '../modules/batteries/batteries.catalog.js';

describe('stock catalog purge remap', () => {
  it('remapPurgedStockItemId mapeia baterias legadas para battery_estelar', () => {
    expect(remapPurgedStockItemId('battery_car')).toBe(CANONICAL_1000WH_BATTERY_ID);
    expect(remapPurgedStockItemId('battery_wall')).toBe(CANONICAL_1000WH_BATTERY_ID);
  });

  it('remapPurgedStockItemId remove carregadores expurgados', () => {
    expect(remapPurgedStockItemId('charger_a1')).toBe('');
  });

  it('normalizeStockCatalogItemId combina legado 1000Wh e purge', () => {
    expect(normalizeStockCatalogItemId('small_battery')).toBe(CANONICAL_1000WH_BATTERY_ID);
    expect(normalizeStockCatalogItemId('server_v1')).toBe('server_v1');
  });

  it('buildStableLegacyTempUpgradeId é determinístico por user+original', () => {
    const a = buildStableLegacyTempUpgradeId(42, 'battery_car');
    const b = buildStableLegacyTempUpgradeId(42, 'battery_car');
    expect(a).toBe(b);
    expect(a).toBe('temp_legacy_42_battery_car');
    expect(buildStableLegacyTempUpgradeId(42, 'battery_car')).not.toBe(
      buildStableLegacyTempUpgradeId(43, 'battery_car')
    );
  });
});
