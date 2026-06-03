/**
 * Rotas do check-in diário (`/api/checkin/...`).
 *
 *  - GET  `/api/checkin/status` → snapshot (idempotente).
 *  - POST `/api/checkin`        → tenta aplicar check-in no ciclo BRT actual (21:00→21:00).
 *
 * Segue o mesmo padrão dos outros módulos (Dashboard, Profile):
 *  - middleware `authenticateToken` recebido por dependency injection;
 *  - `uidNum` para resolver o `userId`;
 *  - `sendInternalErrorSafeMessageOrPrisma` para erros não previstos.
 */

import type { Express, Request, RequestHandler, Response } from 'express';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import { CHECKIN_PREMIUM_COOLDOWN_CODE, CheckinPremiumCooldownError } from './checkinErrors.js';
import { getCheckinStatus, performCheckin } from './checkin.service.js';
import { loadCheckinPremiumPolicy, saveCheckinPremiumPolicy } from './checkinPremiumPolicy.js';

export type CheckinModuleDeps = {
  authenticateToken: RequestHandler;
  isAdmin: RequestHandler;
};

function uidNum(req: Request): number | null {
  const v = req.userId as unknown;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatPremiumCooldownMessage(nextMs: number, intervalDays: number): string {
  const left = Math.max(0, nextMs - Date.now());
  const days = Math.floor(left / (24 * 60 * 60 * 1000));
  const hours = Math.floor((left % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const every = intervalDays >= 1 ? intervalDays : 7;
  if (days > 0) {
    return `Compradores de passe premium (≥ limite USDC) só podem fazer check-in a cada ${every} dias. Próximo em ~${days}d ${hours}h.`;
  }
  if (hours > 0) {
    return `Compradores de passe premium (≥ limite USDC) só podem fazer check-in a cada ${every} dias. Próximo em ~${hours}h.`;
  }
  const mins = Math.max(1, Math.ceil(left / 60000));
  return `Compradores de passe premium (≥ limite USDC) só podem fazer check-in a cada ${every} dias. Próximo em ~${mins} min.`;
}

export function registerCheckinModuleRoutes(app: Express, deps: CheckinModuleDeps): void {
  const { authenticateToken, isAdmin } = deps;

  app.get('/api/admin/checkin-premium-policy', isAdmin, async (_req: Request, res: Response) => {
    try {
      const policy = await loadCheckinPremiumPolicy();
      return res.json({ ok: true, ...policy });
    } catch (e) {
      console.error('[admin/checkin-premium-policy GET]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'GET /api/admin/checkin-premium-policy',
        e,
        'Não foi possível ler a política de check-in premium.'
      );
    }
  });

  app.post('/api/admin/checkin-premium-policy', isAdmin, async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const policy = await saveCheckinPremiumPolicy({
        enabled: body.enabled !== undefined ? body.enabled !== false && body.enabled !== 0 : undefined,
        minUsdc: body.minUsdc ?? body.min_usdc,
        intervalDays: body.intervalDays ?? body.interval_days
      });
      return res.json({ ok: true, ...policy });
    } catch (e) {
      console.error('[admin/checkin-premium-policy POST]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'POST /api/admin/checkin-premium-policy',
        e,
        'Não foi possível guardar a política de check-in premium.'
      );
    }
  });

  app.get('/api/checkin/status', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
    }
    try {
      const status = await getCheckinStatus(userId);
      return res.json({ ok: true, ...status });
    } catch (e) {
      console.error('[checkin/status]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'GET /api/checkin/status',
        e,
        'Não foi possível ler o estado do check-in agora.'
      );
    }
  });

  app.post('/api/checkin', authenticateToken, async (req: Request, res: Response) => {
    const userId = uidNum(req);
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado.', code: 'AUTH_REQUIRED' });
    }
    try {
      const result = await performCheckin(userId);
      return res.json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'GAME_STATE_NOT_FOUND') {
        return res.status(404).json({
          error: 'Estado de jogo não encontrado para este utilizador.',
          code: 'GAME_STATE_NOT_FOUND'
        });
      }
      if (e instanceof CheckinPremiumCooldownError) {
        return res.status(429).json({
          error: formatPremiumCooldownMessage(e.nextCheckinAllowedMs, e.intervalDays),
          code: CHECKIN_PREMIUM_COOLDOWN_CODE,
          nextCheckinAllowedMs: e.nextCheckinAllowedMs
        });
      }
      console.error('[checkin/perform]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'POST /api/checkin',
        e,
        'Não foi possível registar o check-in agora.'
      );
    }
  });
}
