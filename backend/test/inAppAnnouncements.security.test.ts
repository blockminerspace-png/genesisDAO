import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { RequestHandler } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  in_app_announcements: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    groupBy: vi.fn()
  },
  in_app_announcement_reads: {
    upsert: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn()
  },
  admin_access_logs: {
    create: vi.fn()
  }
}));

vi.mock('express-rate-limit', () => ({
  rateLimit: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
}));

vi.mock('../config/prisma.js', () => ({
  prisma: prismaMock
}));

import { registerInAppAnnouncementsModuleRoutes } from '../modules/in-app-announcements/inAppAnnouncements.controller.js';

const authPass: RequestHandler = (req, _res, next) => {
  (req as express.Request & { userId?: number }).userId = 42;
  next();
};

const isAdminPass: RequestHandler = (req, _res, next) => {
  (req as express.Request & { userId?: number }).userId = 1;
  next();
};

async function withApp(
  fn: (baseUrl: string) => Promise<void>,
  opts?: { admin?: boolean }
): Promise<void> {
  const app = express();
  app.use(express.json());
  if (opts?.admin) {
    app.use((req, _res, next) => {
      (req as express.Request & { userId?: number }).userId = 1;
      next();
    });
  }
  registerInAppAnnouncementsModuleRoutes(app, {
    authenticateToken: authPass,
    isAdmin: isAdminPass
  });
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

describe('inAppAnnouncements security routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.in_app_announcement_reads.groupBy.mockResolvedValue([]);
    prismaMock.admin_access_logs.create.mockResolvedValue({ id: 1 });
  });

  it('POST admin create rejeita link javascript:', async () => {
    await withApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/in-app-announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test',
          message: 'Body',
          link: 'javascript:alert(1)'
        })
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('VALIDATION');
      expect(prismaMock.in_app_announcements.create).not.toHaveBeenCalled();
    });
  });

  it('POST admin create rejeita imageUrl externa', async () => {
    await withApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/in-app-announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test',
          message: 'Body',
          imageUrl: 'https://evil.com/x.png'
        })
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('INVALID_IMAGE_URL');
    });
  });

  it('POST admin create aceita imageUrl /img/uploads/', async () => {
    prismaMock.in_app_announcements.create.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Test',
      message: 'Body',
      link: null,
      image_url: '/img/uploads/ad-1-2.png',
      is_active: 1,
      priority: 0,
      starts_at: null,
      ends_at: null,
      created_at: BigInt(Date.now()),
      created_by: 1
    });
    await withApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/in-app-announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test',
          message: 'Body',
          imageUrl: '/img/uploads/ad-1-2.png'
        })
      });
      expect(res.status).toBe(201);
      expect(prismaMock.in_app_announcements.create).toHaveBeenCalled();
    });
  });

  it('PUT admin update faz clamp de priority', async () => {
    prismaMock.in_app_announcements.findUnique.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440000',
      starts_at: null,
      ends_at: null
    });
    prismaMock.in_app_announcements.update.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'T',
      message: 'M',
      link: null,
      image_url: null,
      is_active: 1,
      priority: 1000,
      starts_at: null,
      ends_at: null,
      created_at: BigInt(1),
      created_by: 1
    });
    prismaMock.in_app_announcement_reads.count.mockResolvedValue(0);

    await withApp(async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/api/admin/in-app-announcements/550e8400-e29b-41d4-a716-446655440000`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priority: 999999 })
        }
      );
      expect(res.status).toBe(200);
      const updateCall = prismaMock.in_app_announcements.update.mock.calls[0]?.[0] as {
        data?: { priority?: number };
      };
      expect(updateCall?.data?.priority).toBe(1000);
    });
  });

  it('POST dismiss com id inválido retorna 400', async () => {
    await withApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/in-app-announcements/not-uuid/dismiss`, {
        method: 'POST'
      });
      expect(res.status).toBe(400);
      expect(prismaMock.in_app_announcement_reads.upsert).not.toHaveBeenCalled();
    });
  });

  it('GET pending usa query filtrada', async () => {
    prismaMock.in_app_announcements.findMany.mockResolvedValue([]);
    await withApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/in-app-announcements/pending`);
      expect(res.status).toBe(200);
      expect(prismaMock.in_app_announcements.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            is_active: 1,
            reads: { none: { user_id: 42 } }
          }),
          take: 20
        })
      );
    });
  });
});
