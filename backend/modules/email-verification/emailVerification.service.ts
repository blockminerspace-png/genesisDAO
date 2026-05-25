import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { sendVerificationEmail } from '../../utils/mailer.js';
import { getAuthFlowTokenSecret } from '../../utils/authFlowSecret.js';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export type EmailVerificationFlags = {
  emailVerified: boolean;
  emailVerificationRequired: boolean;
};

export function buildSignedEmailVerificationToken(email: string, expiryMs: number): string {
  const payload = JSON.stringify({
    email: String(email || '').trim().toLowerCase(),
    expiry: expiryMs,
    purpose: 'email_verification'
  });
  const signature = crypto
    .createHmac('sha256', getAuthFlowTokenSecret())
    .update(payload)
    .digest('hex');
  return `${Buffer.from(payload).toString('base64')}.${signature}`;
}

export function parseSignedEmailVerificationToken(rawToken: unknown): { email: string; expiry: number } | null {
  if (typeof rawToken !== 'string' || !rawToken.trim()) return null;
  const [payloadB64, signature] = rawToken.trim().split('.');
  if (!payloadB64 || !signature) return null;

  const payloadRaw = Buffer.from(payloadB64, 'base64').toString();
  const expectedSig = crypto
    .createHmac('sha256', getAuthFlowTokenSecret())
    .update(payloadRaw)
    .digest('hex');
  // C1: comparação em tempo constante para prevenir timing attacks
  let sigOk = false;
  try {
    sigOk = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return null;

  const payload = JSON.parse(payloadRaw) as { email?: unknown; expiry?: unknown; purpose?: unknown };
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const expiry = Number(payload.expiry);
  const purpose = typeof payload.purpose === 'string' ? payload.purpose : '';
  if (!email || !Number.isFinite(expiry) || purpose !== 'email_verification') return null;
  return { email, expiry };
}

export function getEmailVerificationFlags(user: {
  email_verified?: unknown;
  email_verification_required?: unknown;
}): EmailVerificationFlags {
  return {
    emailVerified: Number(user.email_verified || 0) === 1,
    emailVerificationRequired: Number(user.email_verification_required || 0) === 1
  };
}

export function userRequiresEmailVerification(user: {
  email_verified?: unknown;
  email_verification_required?: unknown;
}): boolean {
  return (
    Number(user.email_verification_required || 0) === 1 &&
    Number(user.email_verified || 0) !== 1
  );
}

export async function markUserPendingEmailVerificationTx(
  tx: Prisma.TransactionClient,
  userId: number
): Promise<void> {
  await tx.users.update({
    where: { id: userId },
    data: {
      email_verification_required: 1,
      email_verified: 0
    }
  });
}

export async function sendSignupVerificationEmail(email: string): Promise<void> {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return;
  const token = buildSignedEmailVerificationToken(normalizedEmail, Date.now() + EMAIL_VERIFICATION_TTL_MS);
  // M1: persistir hash do token para garantir uso único e invalidar link anterior ao reenviar
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await prisma.users.updateMany({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    data: { email_verification_token_hash: tokenHash }
  });
  await sendVerificationEmail(normalizedEmail, token, { validityHours: 24 });
}

export async function resendVerificationEmailIfPending(email: string): Promise<void> {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return;

  const row = await prisma.users.findFirst({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    select: {
      email: true,
      email_verification_required: true,
      email_verified: true
    }
  });
  if (!row || !userRequiresEmailVerification(row)) return;
  await sendSignupVerificationEmail(row.email);
}

export async function verifyEmailTokenAndActivate(rawToken: string): Promise<{
  ok: boolean;
  alreadyVerified?: boolean;
  message?: string;
  error?: string;
  status?: number;
}> {
  const parsed = parseSignedEmailVerificationToken(rawToken);
  if (!parsed) {
    return { ok: false, error: 'Link de verificação inválido.', status: 400 };
  }
  if (Date.now() > parsed.expiry) {
    return { ok: false, error: 'O link de verificação expirou. Peça um novo envio.', status: 403 };
  }

  const row = await prisma.users.findFirst({
    where: { email: { equals: parsed.email, mode: 'insensitive' } },
    select: { id: true, email_verified: true, email_verification_token_hash: true }
  });
  if (!row) {
    return { ok: false, error: 'Conta não encontrada para este link.', status: 404 };
  }
  if (Number(row.email_verified || 0) === 1) {
    return { ok: true, alreadyVerified: true, message: 'O seu email já estava confirmado.' };
  }

  // M1: verificar que o token não foi substituído por um reenvio posterior
  if (row.email_verification_token_hash) {
    const incomingHash = crypto.createHash('sha256').update(String(rawToken)).digest('hex');
    let hashOk = false;
    try {
      hashOk = crypto.timingSafeEqual(
        Buffer.from(incomingHash, 'hex'),
        Buffer.from(row.email_verification_token_hash, 'hex')
      );
    } catch { hashOk = false; }
    if (!hashOk) {
      return { ok: false, error: 'Link de verificação expirado. Use o link mais recente enviado ao seu email.', status: 403 };
    }
  }

  await prisma.users.update({
    where: { id: row.id },
    data: {
      email_verified: 1,
      email_verification_required: 0,
      email_verification_token_hash: null
    }
  });
  return { ok: true, message: 'Email confirmado com sucesso. Já pode iniciar sessão.' };
}
