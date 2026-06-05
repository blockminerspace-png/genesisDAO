/**
 * Avisos in-app (popup ler uma vez) — rotas jogador e admin.
 */

import type { Express, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../../config/prisma.js';
import { getClientIpFromRequest } from '../../utils/clientIp.js';
import { sanitizeForLog } from '../../lib/safeText.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import {
  InAppAnnouncementValidationError,
  parseAnnouncementId,
  parseCreateInput,
  parseUpdateInput
} from '../../validation/inAppAnnouncementValidation.js';
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

const dismissLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `dismiss:${uidNum(req) ?? getClientIpFromRequest(req)}`,
  message: { error: 'Demasiados pedidos. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

const adminMutateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `in-app-admin:${uidNum(req) ?? getClientIpFromRequest(req)}`,
  message: { error: 'Limite de alterações atingido. Tenta mais tarde.', code: 'RATE_LIMIT' }
});

function uidNum(req: Request): number | null {
  const v = req.userId as unknown;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function validationErrorResponse(res: Response, e: InAppAnnouncementValidationError): Response {
  const code = e.code === 'INVALID_IMAGE_URL' ? 'INVALID_IMAGE_URL' : 'VALIDATION';
  const msg =
    code === 'INVALID_IMAGE_URL'
      ? 'Imagem inválida. Use apenas upload interno (PNG, JPG ou GIF).'
      : e.message || 'Dados inválidos.';
  return res.status(400).json({ error: msg, code });
}

async function logAdminAnnouncementAction(
  req: Request,
  action: string,
  announcementId: string | null,
  titleHint?: string
): Promise<void> {
  const adminId = uidNum(req);
  const ip = getClientIpFromRequest(req);
  const details = sanitizeForLog(
    `in_app_announcement.${action} admin=${adminId ?? '?'} id=${announcementId ?? '-'} title=${titleHint ?? ''}`,
    200
  );
  try {
    await prisma.admin_access_logs.create({
      data: {
        ip,
        attempted_url: String(req.originalUrl || req.url || '/api/admin/in-app-announcements'),
        user_agent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 512) : null,
        details,
        created_at: BigInt(Date.now())
      }
    });
  } catch (err) {
    console.error('[in-app-announcements audit]', err);
  }
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
    dismissLimiter,
    async (req: Request, res: Response) => {
      const userId = uidNum(req);
      if (!userId) {
        return res.status(401).json({ error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
      }
      try {
        const result = await dismissAnnouncementForUser(userId, req.params.id);
        if (result === 'invalid_id') {
          return res.status(400).json({ error: 'Identificador de aviso inválido.', code: 'VALIDATION' });
        }
        if (result === 'not_found') {
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

  app.post(
    '/api/admin/in-app-announcements',
    isAdmin,
    adminMutateLimiter,
    async (req: Request, res: Response) => {
      const adminId = uidNum(req);
      try {
        const validated = parseCreateInput((req.body || {}) as Record<string, unknown>);
        const created = await createAnnouncementAdmin(validated, adminId);
        await logAdminAnnouncementAction(req, 'create', created.id, created.title);
        return res.status(201).json({ ok: true, announcement: created });
      } catch (e) {
        if (e instanceof InAppAnnouncementValidationError) {
          return validationErrorResponse(res, e);
        }
        console.error('[admin/in-app-announcements POST]', e);
        sendInternalErrorSafeMessageOrPrisma(
          res,
          'POST /api/admin/in-app-announcements',
          e,
          'Não foi possível criar o aviso.'
        );
      }
    }
  );

  app.put(
    '/api/admin/in-app-announcements/:id',
    isAdmin,
    adminMutateLimiter,
    async (req: Request, res: Response) => {
      try {
        parseAnnouncementId(req.params.id);
        const validated = parseUpdateInput((req.body || {}) as Record<string, unknown>);
        const updated = await updateAnnouncementAdmin(req.params.id, validated);
        if (!updated) {
          return res.status(404).json({ error: 'Aviso não encontrado.', code: 'NOT_FOUND' });
        }
        await logAdminAnnouncementAction(req, 'update', updated.id, updated.title);
        return res.json({ ok: true, announcement: updated });
      } catch (e) {
        if (e instanceof InAppAnnouncementValidationError) {
          return validationErrorResponse(res, e);
        }
        console.error('[admin/in-app-announcements PUT]', e);
        sendInternalErrorSafeMessageOrPrisma(
          res,
          'PUT /api/admin/in-app-announcements/:id',
          e,
          'Não foi possível atualizar o aviso.'
        );
      }
    }
  );

  app.delete(
    '/api/admin/in-app-announcements/:id',
    isAdmin,
    adminMutateLimiter,
    async (req: Request, res: Response) => {
      try {
        const id = parseAnnouncementId(req.params.id);
        const ok = await deleteAnnouncementAdmin(id);
        if (!ok) {
          return res.status(404).json({ error: 'Aviso não encontrado.', code: 'NOT_FOUND' });
        }
        await logAdminAnnouncementAction(req, 'delete', id);
        return res.json({ ok: true });
      } catch (e) {
        if (e instanceof InAppAnnouncementValidationError) {
          return validationErrorResponse(res, e);
        }
        console.error('[admin/in-app-announcements DELETE]', e);
        sendInternalErrorSafeMessageOrPrisma(
          res,
          'DELETE /api/admin/in-app-announcements/:id',
          e,
          'Não foi possível apagar o aviso.'
        );
      }
    }
  );
}
