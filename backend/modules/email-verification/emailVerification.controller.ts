import type { Express, Request, Response } from 'express';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import {
  resendVerificationEmailIfPending,
  verifyEmailTokenAndActivate
} from './emailVerification.service.js';

export type EmailVerificationModuleDeps = {
  emailRequestLimiter: (req: Request, res: Response, next: () => void) => void;
  verifyAttemptLimiter: (req: Request, res: Response, next: () => void) => void;
  emailAddressMaxLength: number;
};

export function registerEmailVerificationModuleRoutes(
  app: Express,
  deps: EmailVerificationModuleDeps
): void {
  const { emailRequestLimiter, verifyAttemptLimiter, emailAddressMaxLength } = deps;

  app.post('/api/request-email-verification', emailRequestLimiter, async (req: Request, res: Response) => {
    const raw = req.body && req.body.email != null ? String(req.body.email).trim() : '';
    const genericOk = {
      ok: true,
      message: 'Se o email pertencer a uma conta nova pendente, reenviámos o link de confirmação.'
    };
    if (!raw || raw.length > emailAddressMaxLength) {
      return res.status(400).json({ error: 'Indique um email válido.' });
    }
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRx.test(raw)) {
      return res.status(400).json({ error: 'Indique um email válido.' });
    }

    try {
      void resendVerificationEmailIfPending(raw).catch((mailErr: unknown) => {
        console.error(
          '[request-email-verification] envio SMTP:',
          mailErr instanceof Error ? mailErr.message : mailErr
        );
      });
      return res.json(genericOk);
    } catch (e) {
      console.error('[request-email-verification]', e instanceof Error ? e.message : e);
      return res.json(genericOk);
    }
  });

  app.post('/api/verify-email', verifyAttemptLimiter, async (req: Request, res: Response) => {
    const token = req.body && req.body.token != null ? String(req.body.token) : '';
    try {
      const result = await verifyEmailTokenAndActivate(token);
      if (!result.ok) {
        return res.status(result.status || 400).json({ ok: false, error: result.error });
      }
      return res.json(result);
    } catch (e) {
      console.error('[verify-email]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'POST /api/verify-email',
        e,
        'Erro ao confirmar o email.'
      );
    }
  });
}
