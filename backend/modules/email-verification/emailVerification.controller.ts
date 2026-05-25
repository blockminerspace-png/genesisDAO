import type { Express, Request, Response } from 'express';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import {
  resendVerificationEmailIfPending,
  verifyEmailTokenAndActivate
} from './emailVerification.service.js';

// A5: rate limit de reenvio por email alvo (5 min de cooldown por endereço)
const EMAIL_RESEND_COOLDOWN_MS = 5 * 60 * 1000;
const emailResendCooldowns = new Map<string, number>();
function isEmailOnCooldown(email: string): boolean {
  const last = emailResendCooldowns.get(email);
  if (!last) return false;
  if (Date.now() - last < EMAIL_RESEND_COOLDOWN_MS) return true;
  emailResendCooldowns.delete(email);
  return false;
}
function markEmailCooldown(email: string): void {
  emailResendCooldowns.set(email, Date.now());
  // Limpeza periódica para evitar memory leak
  if (emailResendCooldowns.size > 10000) {
    const cutoff = Date.now() - EMAIL_RESEND_COOLDOWN_MS;
    for (const [k, v] of emailResendCooldowns) {
      if (v < cutoff) emailResendCooldowns.delete(k);
    }
  }
}

// A4: delay constante para prevenir email enumeration por timing
const ANTI_TIMING_DELAY_MS = 100;
function withAntiTimingDelay<T>(fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  return fn().finally(() => {
    const elapsed = Date.now() - start;
    const remaining = ANTI_TIMING_DELAY_MS - elapsed;
    if (remaining > 0) return new Promise((r) => setTimeout(r, remaining));
  });
}

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
    const raw = req.body && req.body.email != null ? String(req.body.email).trim().toLowerCase() : '';
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

    // A5: rate limit por email alvo (além do IP já coberto pelo emailRequestLimiter)
    if (isEmailOnCooldown(raw)) {
      return res.json(genericOk); // resposta genérica para não revelar o cooldown
    }

    try {
      // A4: delay constante para prevenir email enumeration via timing
      await withAntiTimingDelay(async () => {
        void resendVerificationEmailIfPending(raw).catch((mailErr: unknown) => {
          console.error(
            '[request-email-verification] envio SMTP:',
            mailErr instanceof Error ? mailErr.message : mailErr
          );
        });
      });
      markEmailCooldown(raw);
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
