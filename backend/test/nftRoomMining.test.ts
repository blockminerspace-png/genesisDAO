import { describe, expect, it } from 'vitest';
import {
  isAsicMachineUpgradeRow,
  isNftAutoRoomId,
  isNftMiningRoomId,
  isNftRoomExclusiveMiningCoinRef,
  isNftRoomExclusiveMiningCoinSymbol,
  listSlotMiningCredits,
  nftMiningCoinIdFromUpgrade,
  resolveMiningCoinUsdRate,
  type UpgradeMiningRow
} from '../lib/nftRoomMining.js';

describe('isNftAutoRoomId', () => {
  it('reconhece a sala NFT fixa', () => {
    expect(isNftAutoRoomId('room_1775484506874')).toBe(true);
    expect(isNftAutoRoomId('room_initial')).toBe(false);
  });
});

describe('isAsicMachineUpgradeRow', () => {
  it('aceita id asic_*', () => {
    expect(isAsicMachineUpgradeRow({ id: 'asic_s9', type: 'machine' })).toBe(true);
  });

  it('aceita categoria com asic', () => {
    expect(isAsicMachineUpgradeRow({ id: 'miner_x', type: 'machine', category: 'ASIC Pro' })).toBe(true);
  });

  it('rejeita GPU normal', () => {
    expect(isAsicMachineUpgradeRow({ id: 'gpu_4090', type: 'machine', category: 'GPU' })).toBe(false);
  });
});

describe('listSlotMiningCredits', () => {
  const upgradesMap = new Map<string, UpgradeMiningRow>([
    ['asic_a', { id: 'asic_a', type: 'machine', base_production: 100, nft_mining_coin_id: 'btc' }],
    ['asic_b', { id: 'asic_b', type: 'machine', base_production: 50, nft_mining_coin_id: 'eth' }],
    ['gpu_1', { id: 'gpu_1', type: 'machine', base_production: 200, nft_mining_coin_id: 'btc' }],
    ['chip', { id: 'chip', type: 'multiplier', multiplier: 0.1 }]
  ]);

  it('sala normal agrega na moeda da rig', () => {
    const credits = listSlotMiningCredits(
      'room_initial',
      ['asic_a', 'gpu_1'],
      ['chip'],
      upgradesMap,
      'btc'
    );
    expect(credits).toHaveLength(1);
    expect(credits[0].coinId).toBe('btc');
    expect(credits[0].effectiveBaseProd).toBeCloseTo(330, 5);
  });

  it('sala NFT credita por ASIC e ignora GPU', () => {
    const credits = listSlotMiningCredits(
      'room_1775484506874',
      ['asic_a', 'asic_b', 'gpu_1'],
      ['chip'],
      upgradesMap,
      ''
    );
    expect(credits).toHaveLength(2);
    const byCoin = Object.fromEntries(credits.map((c) => [c.coinId, c.effectiveBaseProd]));
    expect(byCoin.btc).toBeCloseTo(110, 5);
    expect(byCoin.eth).toBeCloseTo(55, 5);
  });

  it('ignora ASIC sem moeda admin', () => {
    const map = new Map(upgradesMap);
    map.set('asic_c', { id: 'asic_c', type: 'machine', base_production: 999 });
    const credits = listSlotMiningCredits('room_1775484506874', ['asic_c'], [], map, '');
    expect(credits).toHaveLength(0);
  });

  it('sala normal não credita moedas exclusivas NFT (USDT)', () => {
    const credits = listSlotMiningCredits('room_initial', ['gpu_1'], [], upgradesMap, 'usdt');
    expect(credits).toHaveLength(0);
  });

  it('sala NFT credita ASIC com moeda exclusiva', () => {
    const map = new Map(upgradesMap);
    map.set('asic_usdt', {
      id: 'asic_usdt',
      type: 'machine',
      base_production: 80,
      nft_mining_coin_id: 'usdt'
    });
    const credits = listSlotMiningCredits('room_1775484506874', ['asic_usdt'], [], map, '');
    expect(credits).toHaveLength(1);
    expect(credits[0].coinId).toBe('usdt');
  });
});

describe('isNftRoomExclusiveMiningCoinRef', () => {
  it('reconhece símbolos USDT, cbBTC e GEMT', () => {
    expect(isNftRoomExclusiveMiningCoinSymbol('usdt')).toBe(true);
    expect(isNftRoomExclusiveMiningCoinSymbol('cbBTC')).toBe(true);
    expect(isNftRoomExclusiveMiningCoinSymbol('gemt')).toBe(true);
    expect(isNftRoomExclusiveMiningCoinSymbol('btc')).toBe(false);
  });

  it('reconhece id usdt', () => {
    expect(isNftRoomExclusiveMiningCoinRef('usdt')).toBe(true);
    expect(isNftRoomExclusiveMiningCoinRef('btc')).toBe(false);
  });
});

describe('resolveMiningCoinUsdRate', () => {
  it('usa usdc_rate quando definido', () => {
    expect(resolveMiningCoinUsdRate({ id: 'dai', symbol: 'DAI', usdc_rate: 1.01 })).toBe(1.01);
  });

  it('fallback 1.0 para DAI sem taxa na BD', () => {
    expect(resolveMiningCoinUsdRate({ id: 'dai', symbol: 'DAI', usdc_rate: 0, price_usd: 0 })).toBe(1);
  });

  it('fallback 1.0 para USDT e GHO sem taxa na BD', () => {
    expect(resolveMiningCoinUsdRate({ id: 'usdt', symbol: 'USDT', usdc_rate: 0 })).toBe(1);
    expect(resolveMiningCoinUsdRate({ id: 'gho', symbol: 'GHO', price_usd: 0 })).toBe(1);
  });

  it('cbBTC sem taxa na BD fica 0 (definir preço no admin)', () => {
    expect(resolveMiningCoinUsdRate({ id: 'cbbtc', symbol: 'cbBTC', usdc_rate: 0, price_usd: 0 })).toBe(0);
  });

  it('cbBTC usa usdc_rate quando configurado', () => {
    expect(resolveMiningCoinUsdRate({ id: 'cbbtc', symbol: 'cbBTC', usdc_rate: 95000 })).toBe(95000);
  });

  it('zero para moeda não exclusiva sem taxa', () => {
    expect(resolveMiningCoinUsdRate({ id: 'btc', symbol: 'BTC', usdc_rate: 0 })).toBe(0);
  });
});

describe('isNftMiningRoomId', () => {
  it('aceita qualquer id no conjunto de salas NFT', () => {
    const ids = new Set(['room_1775484506874', 'room_custom_nft']);
    expect(isNftMiningRoomId('room_custom_nft', ids)).toBe(true);
    expect(isNftMiningRoomId('room_initial', ids)).toBe(false);
  });
});

describe('nftMiningCoinIdFromUpgrade', () => {
  it('trim e null para vazio', () => {
    expect(nftMiningCoinIdFromUpgrade({ nft_mining_coin_id: '  btc  ' })).toBe('btc');
    expect(nftMiningCoinIdFromUpgrade({ nft_mining_coin_id: '' })).toBeNull();
    expect(nftMiningCoinIdFromUpgrade(null)).toBeNull();
  });
});
