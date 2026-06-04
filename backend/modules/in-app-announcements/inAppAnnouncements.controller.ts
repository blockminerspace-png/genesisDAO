/**
 * Avisos in-app (popup ler uma vez) — rotas jogador e admin.
 */

import type { Express, Request, RequestHandler, Response } from 'express';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import {
  createAnnouncementAdmin,
  deleteAnnouncementAdmin,
  dismissAnnouncementForUser,
  listAnnouncementsAdmin,
  listPendingAnnouncementsForUser,
  updateAnnouncementAdmin
} from './inAppAnnouncements.service.js';

export type InAppAnnouncementsModuleDeps = {
  authenticateToken: RequestHandler;
  isAdmin: RequestHandler;
};

function uidNum(req: Request): number | null {
  const v = req.userId as unknown;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function registerInAppAnnouncementsModuleRoutes(
  app: Express,
  deps: InAppAnnouncementsModuleDeps
): void {
  const { authenticateToken, isAdmin } = deps;

  app.get('/api/in-app-announcements/pending', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
    }
    try {
      const announcements = await listPendingAnnouncementsForUser(userId);
      return res.json({ ok: true, announcements });
    } catch (e) {
      console.error('[in-app-announcements/pending]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'GET /api/in-app-announcements/pending',
        e,
        'Não foi possível carregar os avisos agora.'
      );
    }
  });

  app.post(
    '/api/in-app-announcements/:id/dismiss',
    authenticateToken,
    async (req: Request, res: Response) => {
      const userId = uidNum(req);
      if (!userId) {
        return res.status(401).json({ error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
      }
      try {
        const ok = await dismissAnnouncementForUser(userId, req.params.id);
        if (!ok) {
          return res.status(404).json({ error: 'Aviso não encontrado.', code: 'NOT_FOUND' });
        }
        return res.json({ ok: true });
      } catch (e) {
        console.error('[in-app-announcements/dismiss]', e);
        sendInternalErrorSafeMessageOrPrisma(
          res,
          'POST /api/in-app-announcements/:id/dismiss',
          e,
          'Não foi possível registar a leitura agora.'
        );
      }
    }
  );

  app.get('/api/admin/in-app-announcements', isAdmin, async (_req: Request, res: Response) => {
    try {
      const announcements = await listAnnouncementsAdmin();
      return res.json({ ok: true, announcements });
    } catch (e) {
      console.error('[admin/in-app-announcements GET]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'GET /api/admin/in-app-announcements',
        e,
        'Não foi possível listar os avisos.'
      );
    }
  });

  app.post('/api/admin/in-app-announcements', isAdmin, async (req: Request, res: Response) => {
    const adminId = uidNum(req);
    try {
      const body = req.body || {};
      const created = await createAnnouncementAdmin({
        title: body.title,
        message: body.message,
        link: body.link,
        imageUrl: body.imageUrl ?? body.image_url ?? null,
        priority: body.priority,
        isActive: body.isActive !== false && body.is_active !== 0,
        startsAt: body.startsAt ?? body.starts_at ?? null,
        endsAt: body.endsAt ?? body.ends_at ?? null,
        createdBy: adminId
      });
      return res.status(201).json({ ok: true, announcement: created });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'TITLE_MESSAGE_REQUIRED') {
        return res.status(400).json({ error: 'Título e mensagem são obrigatórios.', code: 'VALIDATION' });
      }
      console.error('[admin/in-app-announcements POST]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'POST /api/admin/in-app-announcements',
        e,
        'Não foi possível criar o aviso.'
      );
    }
  });

  app.put('/api/admin/in-app-announcements/:id', isAdmin, async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const updated = await updateAnnouncementAdmin(req.params.id, {
        title: body.title,
        message: body.message,
        link: body.link,
        imageUrl: body.imageUrl ?? body.image_url,
        priority: body.priority,
        isActive:
          body.isActive !== undefined
            ? body.isActive !== false && body.is_active !== 0
            : body.is_active !== undefined
              ? body.is_active !== 0
              : undefined,
        startsAt: body.startsAt ?? body.starts_at,
        endsAt: body.endsAt ?? body.ends_at
      });
      if (!updated) {
        return res.status(404).json({ error: 'Aviso não encontrado.', code: 'NOT_FOUND' });
      }
      return res.json({ ok: true, announcement: updated });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'TITLE_MESSAGE_REQUIRED') {
        return res.status(400).json({ error: 'Título e mensagem são obrigatórios.', code: 'VALIDATION' });
      }
      console.error('[admin/in-app-announcements PUT]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'PUT /api/admin/in-app-announcements/:id',
        e,
        'Não foi possível atualizar o aviso.'
      );
    }
  });

  app.delete('/api/admin/in-app-announcements/:id', isAdmin, async (req: Request, res: Response) => {
    try {
      const ok = await deleteAnnouncementAdmin(req.params.id);
      if (!ok) {
        return res.status(404).json({ error: 'Aviso não encontrado.', code: 'NOT_FOUND' });
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error('[admin/in-app-announcements DELETE]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'DELETE /api/admin/in-app-announcements/:id',
        e,
        'Não foi possível apagar o aviso.'
      );
    }
  });
}
