/**
 * Admin: atividade legível, inventário audit, snapshots de sessão.
 */
import type { Express, Request, RequestHandler, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { formatActivityEvent, matchesActivityFilter } from '../lib/activityEventFormatter.js';
import {
  getGenesisMongo,
  listAdminUserActivityLogsMongo,
  listSessionSnapshotsMongo
} from '../lib/mongoLogs.js';
import {
  listUserInventoryAudit,
  parseInventoryAuditRange
} from '../services/adminUserInventoryAudit.service.js';
import {
  diffSnapshotInventory,
  type PlayerStateSnapshotPayload
} from '../services/playerStateSnapshot.service.js';
import { getAdminUserAccountTrace } from '../services/adminUserAccountTrace.service.js';

export type AdminUserAuditDeps = {
  isAdmin: RequestHandler;
};

async function resolveUserId(req: Request): Promise<number | null> {
  const rawQ = String(req.query.email || req.query.q || '').trim().toLowerCase();
  const uidParsed = parseInt(String(req.query.userId || req.params.userId || ''), 10);
  if (rawQ) {
    const uRows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM users
      WHERE lower(trim(email::text)) = ${rawQ} OR lower(trim(username::text)) = ${rawQ}
      LIMIT 1
    `;
    return uRows[0]?.id ?? null;
  }
  if (Number.isFinite(uidParsed) && uidParsed > 0) return uidParsed;
  return null;
}

function withDisplay(row: { id: string; action: string; meta: Record<string, unknown>; createdAt: number }) {
  const display = formatActivityEvent(row.action, row.meta);
  return { ...row, display };
}

export function registerAdminUserAuditRoutes(app: Express, deps: AdminUserAuditDeps): void {
  const { isAdmin } = deps;

  app.get('/api/admin/user-activity', isAdmin, async (req: Request, res: Response) => {
    try {
      const uid = await resolveUserId(req);
      if (uid == null) {
        const rawQ = String(req.query.email || req.query.q || '').trim();
        if (!rawQ && !req.query.userId) {
          return res.status(400).json({ error: 'Indique email, username ou userId válido' });
        }
        return res.status(404).json({ error: 'Utilizador não encontrado (email ou username).' });
      }

      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '80'), 10) || 80));
      const beforeMs = parseInt(String(req.query.beforeMs || req.query.cursor || ''), 10);
      const categoryFilter = String(req.query.category || '').trim();
      const severityFilter = String(req.query.severity || '').trim();
      const filterId = String(req.query.filterId || 'all').trim();

      let accountCreatedAtMs: number | null = null;
      try {
        const gs = await prisma.game_states.findUnique({
          where: { user_id: Number(uid) },
          select: { start_time: true }
        });
        const raw = gs?.start_time;
        if (raw != null) {
          const n = typeof raw === 'bigint' ? Number(raw) : Number(raw);
          if (Number.isFinite(n) && n > 0) accountCreatedAtMs = n;
        }
      } catch {
        /* ignore */
      }

      const { rows, hasMore } = await listAdminUserActivityLogsMongo(Number(uid), limit, {
        accountCreatedAtMs,
        beforeMs: Number.isFinite(beforeMs) && beforeMs > 0 ? beforeMs : null
      });

      let enriched = rows.map((r) => withDisplay(r));

      if (filterId && filterId !== 'all') {
        enriched = enriched.filter((r) => matchesActivityFilter(r.display, r.action, filterId));
      }
      if (categoryFilter) {
        enriched = enriched.filter((r) => r.display.category === categoryFilter);
      }
      if (severityFilter) {
        enriched = enriched.filter((r) => r.display.severity === severityFilter);
      }

      const searchQ = String(req.query.q || req.query.search || '')
        .trim()
        .toLowerCase();
      if (searchQ) {
        enriched = enriched.filter((r) => {
          const hay = `${r.action} ${r.display.title} ${r.display.summary}`.toLowerCase();
          return hay.includes(searchQ);
        });
      }

      const mongoOk = !!getGenesisMongo();
      const nextCursor =
        enriched.length > 0 ? enriched[enriched.length - 1].createdAt : null;

      res.json({
        logs: enriched,
        hasMore,
        nextCursor,
        accountCreatedAtMs,
        ...(mongoOk
          ? {}
          : {
              activityLogNote:
                'MONGODB_URI não está definido: o histórico de atividade de jogo só existe no MongoDB.'
            })
      });
    } catch (e) {
      console.error('[AdminUserActivity]', e);
      res.status(500).json({ error: 'Falha ao carregar atividade' });
    }
  });

  app.get('/api/admin/users/:userId/inventory-audit', isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(userId) || userId <= 0) {
        return res.status(400).json({ error: 'userId inválido' });
      }
      const page = parseInt(String(req.query.page || '1'), 10) || 1;
      const limit = parseInt(String(req.query.limit || '50'), 10) || 50;
      const { fromMs, toMs } = parseInventoryAuditRange(req.query.from, req.query.to);
      const lossesOnly = req.query.lossesOnly === '1' || req.query.lossesOnly === 'true';

      const data = await listUserInventoryAudit({
        userId,
        fromMs,
        toMs,
        page,
        limit,
        lossesOnly
      });
      res.json(data);
    } catch (e) {
      console.error('[AdminInventoryAudit]', e);
      res.status(500).json({ error: 'Falha ao carregar auditoria de inventário' });
    }
  });

  app.get('/api/admin/users/:userId/session-snapshots', isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(userId) || userId <= 0) {
        return res.status(400).json({ error: 'userId inválido' });
      }
      const limit = Math.min(50, parseInt(String(req.query.limit || '20'), 10) || 20);
      const rows = await listSessionSnapshotsMongo(userId, limit);

      const snapshots = rows.map((r) => {
        const meta = r.meta as PlayerStateSnapshotPayload;
        const display = formatActivityEvent(r.action, r.meta);
        return {
          id: r.id,
          action: r.action,
          createdAt: r.createdAt,
          snapshot: meta,
          display
        };
      });

      const diffs: Array<{
        snapshotId: string;
        createdAt: number;
        fingerprintChanged: boolean;
        inventoryDiff: ReturnType<typeof diffSnapshotInventory>;
      }> = [];

      for (let i = 0; i < snapshots.length; i++) {
        const cur = snapshots[i].snapshot;
        const prevRaw = i + 1 < snapshots.length ? snapshots[i + 1].snapshot : null;
        const curSnap = cur as PlayerStateSnapshotPayload;
        const prevSnap = prevRaw as PlayerStateSnapshotPayload | null;
        if (!curSnap?.fingerprint) continue;
        diffs.push({
          snapshotId: snapshots[i].id,
          createdAt: snapshots[i].createdAt,
          fingerprintChanged: !prevSnap || prevSnap.fingerprint !== curSnap.fingerprint,
          inventoryDiff: diffSnapshotInventory(prevSnap, curSnap)
        });
      }

      res.json({ snapshots, diffs });
    } catch (e) {
      console.error('[AdminSessionSnapshots]', e);
      res.status(500).json({ error: 'Falha ao carregar snapshots de sessão' });
    }
  });

  app.get('/api/admin/users/:userId/account-trace', isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(userId) || userId <= 0) {
        return res.status(400).json({ error: 'userId inválido' });
      }
      const fromMs = parseInt(String(req.query.fromMs || ''), 10);
      const toMs = parseInt(String(req.query.toMs || ''), 10);
      const timelineLimit = parseInt(String(req.query.timelineLimit || '100'), 10) || 100;
      const timelineBeforeMs = parseInt(String(req.query.timelineBeforeMs || req.query.cursor || ''), 10);
      const sectionsRaw = String(req.query.sections || '').trim();
      const sections = sectionsRaw ? sectionsRaw.split(',').map((s) => s.trim()).filter(Boolean) : null;

      const data = await getAdminUserAccountTrace({
        userId,
        fromMs: Number.isFinite(fromMs) && fromMs > 0 ? fromMs : null,
        toMs: Number.isFinite(toMs) && toMs > 0 ? toMs : null,
        timelineLimit,
        timelineBeforeMs: Number.isFinite(timelineBeforeMs) && timelineBeforeMs > 0 ? timelineBeforeMs : null,
        sections
      });

      if (!data) return res.status(404).json({ error: 'Utilizador não encontrado' });

      if (sections && sections.length > 0) {
        const out: Record<string, unknown> = {};
        for (const key of sections) {
          if (key in data) out[key] = (data as Record<string, unknown>)[key];
        }
        if (!sections.includes('timeline')) {
          out.timelineHasMore = data.timelineHasMore;
          out.timelineNextCursor = data.timelineNextCursor;
        }
        return res.json(out);
      }

      res.json(data);
    } catch (e) {
      console.error('[AdminAccountTrace]', e);
      res.status(500).json({ error: 'Falha ao carregar rastreio da conta' });
    }
  });
}
