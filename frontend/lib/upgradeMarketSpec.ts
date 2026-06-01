import type { Upgrade } from '../types';
import { formatHashrateDisplay } from '../models/serverRoomModel';

export type UpgradeMarketSpec = {
  label: string;
  value: string;
  tone?: 'green' | 'orange' | 'sky' | 'yellow' | 'slate';
};

function resolveCompatibleRackNames(item: Upgrade, catalog: Upgrade[]): string {
  if (!Array.isArray(item.compatibleRacks) || item.compatibleRacks.length === 0) {
    return 'Qualquer rack';
  }
  return item.compatibleRacks
    .map((rid) => catalog.find((u) => u.id === rid)?.name || rid)
    .join(', ');
}

/** Linhas curtas de spec para comparar valor vs desempenho no Mercado Negro / P2P. */
export function getUpgradeMarketSpecs(item: Upgrade, catalog: Upgrade[] = []): UpgradeMarketSpec[] {
  const specs: UpgradeMarketSpec[] = [];
  const t = item.type;

  if (t === 'machine') {
    const bp = Number(item.baseProduction) || 0;
    if (bp > 0) {
      specs.push({ label: 'Hashrate', value: `+${formatHashrateDisplay(bp)} H/s`, tone: 'green' });
    }
    if (typeof item.powerConsumption === 'number' && item.powerConsumption > 0) {
      specs.push({ label: 'Consumo', value: `${item.powerConsumption} W`, tone: 'slate' });
    }
    specs.push({ label: 'Compatível', value: resolveCompatibleRackNames(item, catalog), tone: 'slate' });
  } else if (t === 'multiplier') {
    const pct = (Number(item.multiplier) || 0) * 100;
    if (pct > 0) {
      specs.push({ label: 'Boost', value: `+${pct.toFixed(1)}%`, tone: 'orange' });
    }
    specs.push({ label: 'Compatível', value: resolveCompatibleRackNames(item, catalog), tone: 'slate' });
  } else if (t === 'wiring') {
    specs.push({ label: 'Encaixa em', value: resolveCompatibleRackNames(item, catalog), tone: 'sky' });
    if (typeof item.powerConsumption === 'number' && item.powerConsumption > 0) {
      specs.push({ label: 'Consumo', value: `${item.powerConsumption} W`, tone: 'slate' });
    }
  } else if (t === 'infrastructure') {
    const slots = Number(item.slotsCapacity) || 0;
    const ai = Number(item.aiSlotsCapacity) || 0;
    const parts: string[] = ['Rack / gabinete'];
    if (slots > 0) parts.push(`${slots} slot${slots === 1 ? '' : 's'} GPU`);
    if (ai > 0) parts.push(`${ai} chip${ai === 1 ? '' : 's'} IA`);
    specs.push({ label: 'Tipo', value: parts.join(' · '), tone: 'sky' });
  } else if (t === 'battery') {
    const cap = item.powerCapacity;
    specs.push({
      label: 'Capacidade',
      value: cap === -1 ? '∞ Wh' : `${Number(cap || 0).toLocaleString('pt-PT')} Wh`,
      tone: 'yellow'
    });
    specs.push({ label: 'Compatível', value: resolveCompatibleRackNames(item, catalog), tone: 'slate' });
  }

  return specs;
}

export function getUpgradeMarketSpecSummary(item: Upgrade, catalog: Upgrade[] = []): string {
  return getUpgradeMarketSpecs(item, catalog)
    .map((s) => s.value)
    .join(' · ');
}
