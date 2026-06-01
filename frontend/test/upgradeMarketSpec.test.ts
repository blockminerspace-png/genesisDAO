import { describe, expect, it } from 'vitest';
import type { Upgrade } from '../types';
import { getUpgradeMarketSpecs, getUpgradeMarketSpecSummary } from '../lib/upgradeMarketSpec';

const rackA: Upgrade = {
  id: 'rack_a',
  name: 'Rack H1',
  category: 'Infra',
  type: 'infrastructure',
  baseCost: 1,
  baseProduction: 0,
  description: '',
  icon: '🗄',
  status: 'normal',
  slotsCapacity: 4,
  aiSlotsCapacity: 2
};

const gpu: Upgrade = {
  id: 'gpu_old',
  name: 'Old-School',
  category: 'GPU',
  type: 'machine',
  baseCost: 0.1,
  baseProduction: 1250,
  powerConsumption: 180,
  description: '',
  icon: '🎮',
  status: 'normal',
  compatibleRacks: ['rack_a']
};

const chip: Upgrade = {
  id: 'chip_1',
  name: 'Turbo IA',
  category: 'Chip',
  type: 'multiplier',
  baseCost: 0.05,
  baseProduction: 0,
  multiplier: 0.15,
  description: '',
  icon: '⚡',
  status: 'normal',
  compatibleRacks: []
};

const wiring: Upgrade = {
  id: 'wire_1',
  name: 'Fiação Pro',
  category: 'Fiação',
  type: 'wiring',
  baseCost: 0.02,
  baseProduction: 0,
  powerConsumption: 50,
  description: '',
  icon: '🔌',
  status: 'normal',
  compatibleRacks: ['rack_a']
};

describe('getUpgradeMarketSpecs', () => {
  it('mostra H/s para GPU', () => {
    const specs = getUpgradeMarketSpecs(gpu, [rackA]);
    expect(specs.some((s) => s.value.includes('H/s'))).toBe(true);
    expect(specs.some((s) => s.value.includes('Rack H1'))).toBe(true);
  });

  it('mostra % para chip', () => {
    const specs = getUpgradeMarketSpecs(chip, [rackA]);
    expect(specs.some((s) => s.value === '+15.0%')).toBe(true);
  });

  it('mostra rack compatível para fiação', () => {
    const specs = getUpgradeMarketSpecs(wiring, [rackA]);
    expect(specs.some((s) => s.label === 'Encaixa em' && s.value.includes('Rack H1'))).toBe(true);
  });

  it('mostra slots para rack', () => {
    const specs = getUpgradeMarketSpecs(rackA, [rackA]);
    expect(specs.some((s) => s.value.includes('4 slots GPU'))).toBe(true);
    expect(specs.some((s) => s.value.includes('2 chips IA'))).toBe(true);
  });

  it('summary junta valores', () => {
    const summary = getUpgradeMarketSpecSummary(gpu, [rackA]);
    expect(summary).toContain('H/s');
  });
});
