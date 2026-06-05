import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  economy_settings: { findUnique: vi.fn() },
  settings: { findUnique: vi.fn() },
  users: { findUnique: vi.fn() },
  $executeRawUnsafe: vi.fn(),
  $queryRawUnsafe: vi.fn(),
  $transaction: vi.fn()
}));

vi.mock('../config/prisma.js', () => ({
  prisma: prismaMock
}));

vi.mock('../lib/mongoLogs.js', () => ({
  logUserAction: vi.fn()
}));

vi.mock('../models/referralCommissionModel.js', () => ({
  runReferralCommissionOnTx: vi.fn()
}));

import { registerP2pMarketRoutes } from '../controllers/p2pMarketController.js';
import { mapListingForClient } from '../models/p2pMarketModel.js';

const noopWs = () => {};

function uidMiddleware(userId: number) {
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId?: number }).userId = userId;
    next();
  };
}

async function withSellApp(
  userId: number,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(uidMiddleware(userId));
  registerP2pMarketRoutes(app, { emitMarketWs: noopWs });
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('p2pMarketSellerIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.economy_settings.findUnique.mockResolvedValue({
      black_market_enabled: 1,
      black_market_price_band_percent: 20
    } as never);
    prismaMock.settings.findUnique.mockResolvedValue(null);
    prismaMock.$executeRawUnsafe.mockResolvedValue(0);
    prismaMock.users.findUnique.mockResolvedValue({ username: 'seller_a', email: 'a@test.invalid' });
  });

  it('mapListingForClient não mistura seller_id com reserver_username', () => {
    const now = Date.now();
    const dto = mapListingForClient(
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        seller_id: 100,
        seller_display_name: 'VendedorA',
        item_id: 'gpu_v4',
        price: 5,
        qty: 1,
        expires_at: now + 60_000,
        reserved_until: now + 30_000,
        reserver_username: 'CompradorB'
      },
      now
    );
    expect(dto.sellerId).toBe(100);
    expect(dto.sellerName).toBe('VendedorA');
    expect(dto.reservedBy).toBe('CompradorB');
  });

  it('POST /api/market/sell regista userId da sessão no INSERT', async () => {
    const sellerId = 55;
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<string>) => {
      const tx = {
        $queryRawUnsafe: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ sell_in_black_market: 1, base_cost: 10 }])
          .mockResolvedValueOnce([{ qty: 5 }]),
        $executeRawUnsafe: vi.fn().mockResolvedValue(1)
      };
      return fn(tx);
    });

    await withSellApp(sellerId, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/market/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: 'gpu_v4', price: 10, qty: 1 })
      });
      expect(res.status).toBe(200);
      const tx = prismaMock.$transaction.mock.calls[0]?.[0];
      expect(tx).toBeTypeOf('function');
    });

    const txFn = prismaMock.$transaction.mock.calls[0][0] as (tx: {
      $queryRawUnsafe: ReturnType<typeof vi.fn>;
      $executeRawUnsafe: ReturnType<typeof vi.fn>;
    }) => Promise<string>;
    const tx = {
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ sell_in_black_market: 1, base_cost: 10 }])
        .mockResolvedValueOnce([{ qty: 5 }]),
      $executeRawUnsafe: vi.fn()
    };
    await txFn(tx);
    const insertCall = tx.$executeRawUnsafe.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO player_listings')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![2]).toBe(sellerId);
  });
});
