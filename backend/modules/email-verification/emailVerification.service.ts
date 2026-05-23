import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { sendVerificationEmail } from '../../utils/mailer.js';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

function resolveAuthTokenSecret(): string {
  return (
    process.env.AUTH_FLOW_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    'secret'
  );
}

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
    .createHmac('sha256', resolveAuthTokenSecret())
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
    .createHmac('sha256', resolveAuthTokenSecret())
    .update(payloadRaw)
    .digest('hex');
  if (signature !== expectedSig) return null;

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
    select: { id: true, email_verified: true }
  });
  if (!row) {
    return { ok: false, error: 'Conta não encontrada para este link.', status: 404 };
  }
  if (Number(row.email_verified || 0) === 1) {
    return { ok: true, alreadyVerified: true, message: 'O seu email já estava confirmado.' };
  }

  await prisma.users.update({
    where: { id: row.id },
    data: {
      email_verified: 1,
      email_verification_required: 0
    }
  });
  return { ok: true, message: 'Email confirmado com sucesso. Já pode iniciar sessão.' };
}
