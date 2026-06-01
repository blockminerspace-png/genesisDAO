/**
 * Endpoints admin: logs de distribuição de mineração (UTC).
 */
import type { Express, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';
import {
  getDistributionOverview,
  getDistributionByCoin,
  getDistributionTimeline,
  getMiningCreditsLedger,
  streamMiningCreditsCsv,
  getUserMiningDistributionSummary,
  rebuildMiningDistributionRollups,
  rebuildMiningDistributionRollupsRecent,
  parseDistributionDateMs,
  utcDayEndMsFromTs
} from '../services/adminMiningDistribution.service.js';

export type AdminMiningDistributionDeps = {
  isAdmin: RequestHandler;
  db: Pool;
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function parseRangeFromQuery(req: Request): { fromMs: number; toMs: number } | null {
  const fromMs = parseDistributionDateMs(req.query.from ?? req.query.fromMs);
  const toRaw = parseDistributionDateMs(req.query.to ?? req.query.toMs);
  if (fromMs == null || toRaw == null) return null;
  const toMs =
    typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to.trim())
      ? utcDayEndMsFromTs(toRaw)
      : toRaw;
  return { fromMs, toMs };
}

let lastRebuildAtMs = 0;
const REBUILD_COOLDOWN_MS = 60_000;

export function registerAdminMiningDistributionRoutes(
  app: Express,
  deps: AdminMiningDistributionDeps
): void {
  const { isAdmin, db } = deps;

  app.get('/api/admin/mining-distribution/overview', isAdmin, async (req: Request, res: Response) => {
    try {
      const customFrom = parseDistributionDateMs(req.query.customFrom);
      const customToRaw = parseDistributionDateMs(req.query.customTo);
      let customTo: number | null = customToRaw;
      if (
        customToRaw != null &&
        typeof req.query.customTo === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(req.query.customTo.trim())
      ) {
        customTo = utcDayEndMsFromTs(customToRaw);
      }
      const data = await getDistributionOverview(customFrom, customTo);
      res.json(data);
    } catch (e) {
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e);
    }
  });

  app.get('/api/admin/mining-distribution/by-coin', isAdmin, async (req: Request, res: Response) => {
    try {
      const range = parseRangeFromQuery(req);
      if (!range) {
        return res.status(400).json({ error: 'Parâmetros from e to obrigatórios (ms ou YYYY-MM-DD UTC).' });
      }
      const data = await getDistributionByCoin(range.fromMs, range.toMs);
      res.json(data);
    } catch (e) {
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e);
    }
  });

  app.get('/api/admin/mining-distribution/timeline', isAdmin, async (req: Request, res: Response) => {
    try {
      const range = parseRangeFromQuery(req);
      if (!range) {
        return res.status(400).json({ error: 'Parâmetros from e to obrigatórios.' });
      }
      const bucket = req.query.bucket === 'week' ? 'week' : 'day';
      const coinId = typeof req.query.coinId === 'string' ? req.query.coinId.trim() : undefined;
      const data = await getDistributionTimeline(range.fromMs, range.toMs, bucket, coinId || undefined);
      res.json(data);
    } catch (e) {
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e);
    }
  });

  app.get('/api/admin/mining-distribution/credits', isAdmin, async (req: Request, res: Response) => {
    try {
      const range = parseRangeFromQuery(req);
      if (!range) {
        return res.status(400).json({ error: 'Parâmetros from e to obrigatórios.' });
      }
      const page = clamp(parseInt(String(req.query.page ?? '1'), 10), 1, 99999);
      const limit = clamp(parseInt(String(req.query.limit ?? '50'), 10), 1, 100);
      const userIdRaw = req.query.userId;
      const userId =
        userIdRaw != null && String(userIdRaw).trim() !== ''
          ? parseInt(String(userIdRaw), 10)
          : undefined;
      const coinId = typeof req.query.coinId === 'string' ? req.query.coinId.trim() : undefined;
      const roomId = typeof req.query.roomId === 'string' ? req.query.roomId.trim() : undefined;
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;

      const data = await getMiningCreditsLedger({
        fromMs: range.fromMs,
        toMs: range.toMs,
        userId: Number.isFinite(userId) ? userId : undefined,
        coinId: coinId || undefined,
        roomId: roomId || undefined,
        q: q || undefined,
        page,
        limit
      });
      res.json(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Intervalo')) return res.status(400).json({ error: msg });
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e);
    }
  });

  app.get(
    '/api/admin/mining-distribution/credits/export.csv',
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const range = parseRangeFromQuery(req);
        if (!range) {
          return res.status(400).json({ error: 'Parâmetros from e to obrigatórios.' });
        }
        const userIdRaw = req.query.userId;
        const userId =
          userIdRaw != null && String(userIdRaw).trim() !== ''
            ? parseInt(String(userIdRaw), 10)
            : undefined;
        const coinId = typeof req.query.coinId === 'string' ? req.query.coinId.trim() : undefined;
        const roomId = typeof req.query.roomId === 'string' ? req.query.roomId.trim() : undefined;
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="mining-credits-export.csv"'
        );

        const result = await streamMiningCreditsCsv(
          {
            fromMs: range.fromMs,
            toMs: range.toMs,
            userId: Number.isFinite(userId) ? userId : undefined,
            coinId: coinId || undefined,
            roomId: roomId || undefined,
            q: q || undefined,
            page: 1,
            limit: 100
          },
          (chunk) => {
            res.write(chunk);
          }
        );

        if (result.truncated) {
          res.write(`# AVISO: exportação limitada a ${result.rowsWritten} linhas.\n`);
        }
        res.end();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('Intervalo')) return res.status(400).json({ error: msg });
        sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e);
      }
    }
  );

  app.get(
    '/api/admin/mining-distribution/users/:userId/summary',
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const userId = parseInt(String(req.params.userId), 10);
        if (!Number.isFinite(userId) || userId <= 0) {
          return res.status(400).json({ error: 'userId inválido.' });
        }
        const range = parseRangeFromQuery(req);
        if (!range) {
          return res.status(400).json({ error: 'Parâmetros from e to obrigatórios.' });
        }
        const data = await getUserMiningDistributionSummary(userId, range.fromMs, range.toMs);
        res.json(data);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('Intervalo')) return res.status(400).json({ error: msg });
        sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e);
      }
    }
  );

  app.post('/api/admin/mining-distribution/rebuild-rollups', isAdmin, async (req: Request, res: Response) => {
    try {
      const now = Date.now();
      if (now - lastRebuildAtMs < REBUILD_COOLDOWN_MS) {
        return res.status(429).json({
          error: 'Aguarde 60 segundos entre reconstruções de rollup.'
        });
      }
      lastRebuildAtMs = now;

      const fromYmd =
        typeof req.body?.fromDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.fromDay)
          ? req.body.fromDay
          : null;
      const toYmd =
        typeof req.body?.toDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.toDay)
          ? req.body.toDay
          : null;

      const result =
        fromYmd && toYmd
          ? await rebuildMiningDistributionRollups(db, fromYmd, toYmd)
          : await rebuildMiningDistributionRollupsRecent(
              db,
              parseInt(String(req.body?.daysBack ?? process.env.MINING_DISTRIBUTION_ROLLUP_DAYS_BACK ?? '45'), 10) ||
                45
            );

      res.json({ ok: true, ...result });
    } catch (e) {
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e);
    }
  });
}
