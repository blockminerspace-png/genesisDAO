import type { Express, Request, Response } from 'express';
import type bcryptjs from 'bcryptjs';
import crypto from 'node:crypto';
import {
  findUserByEmail,
  insertSession,
  listUserAccessLevelIds,
  recordLoginIp,
  ensureUserReferralCode
} from '../../models/authModel.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import { resolveIsSuperAdminFromUserRow } from '../../utils/legacySuperAdmin.js';
import {
  validateLoginEmail,
  validateLoginFieldsPresent,
  validateLoginPassword
} from '../../models/registrationValidation.js';
import {
  getEmailVerificationFlags,
  userRequiresEmailVerification
} from '../email-verification/emailVerification.service.js';
import { issueJwtAuthCookies } from '../../src/auth/index.js';

export type AuthLoginModuleDeps = {
  bcrypt: typeof bcryptjs;
  getClientIp: (req: Request) => string;
};

function parseAdminPermissions(raw: unknown): unknown {
  if (raw == null) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export function registerAuthLoginModuleRoutes(app: Express, deps: AuthLoginModuleDeps): void {
  const { bcrypt, getClientIp } = deps;

  app.post('/api/login', async (req: Request, res: Response) => {
    const { email, password } = (req.body || {}) as { email?: string; password?: string };
    const emailStr = typeof email === 'string' ? email : '';
    const passwordStr = typeof password === 'string' ? password : '';
    const present = validateLoginFieldsPresent(email, password);
    if (!present.ok) return res.status(400).json({ error: present.error });
    const emailCheck = validateLoginEmail(emailStr);
    if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.error });
    const passwordCheck = validateLoginPassword(passwordStr);
    if (!passwordCheck.ok) return res.status(400).json({ error: passwordCheck.error });

    try {
      const normalizedEmail = emailStr.trim().toLowerCase();
      let u = await findUserByEmail(normalizedEmail);

      if (!u) {
        await bcrypt.compare(passwordStr, '$2b$10$abcdefghijklmnopqrstuvwxyz123456');
        return res.status(401).json({ error: 'E-mail ou palavra-passe incorretos.' });
      }

      if (u.is_blocked) return res.status(403).json({ error: 'Este usuário está bloqueado.' });
      if (userRequiresEmailVerification(u)) {
        return res.status(403).json({
          error: 'Confirme o email da sua conta pelo link enviado antes de iniciar sessão.',
          code: 'EMAIL_NOT_VERIFIED',
          emailVerificationRequired: true
        });
      }

      let isMatch = false;
      const pwd = String(u.password ?? '');
      if (pwd && (pwd.startsWith('$2a$') || pwd.startsWith('$2b$'))) {
        try {
          isMatch = await bcrypt.compare(passwordStr, pwd);
        } catch (bcError: unknown) {
          console.error('[Login] bcrypt:', bcError instanceof Error ? bcError.message : bcError);
        }
      }

      if (!isMatch) {
        return res.status(401).json({ error: 'E-mail ou palavra-passe incorretos.' });
      }

      const currentIp = getClientIp(req);
      try {
        await recordLoginIp(u.id as string | number, currentIp);
      } catch (ipErr: unknown) {
        console.error('[Login] Erro ao registrar histórico de IP:', ipErr instanceof Error ? ipErr.message : ipErr);
      }

      const referralCode = await ensureUserReferralCode(
        u.id as string | number,
        String(u.username ?? ''),
        u.referral_code as string | null | undefined
      );
      u = { ...u, referral_code: referralCode };

      const sid = crypto.randomUUID();
      const expiresAt = Date.now() + 30 * 24 * 3600 * 1000;
      await insertSession(sid, u.id as string | number, Date.now(), expiresAt);

      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      res.append('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${30 * 24 * 3600}`);
      try {
        await issueJwtAuthCookies(res, Number(u.id), req);
      } catch (jwtErr) {
        console.error('[Login] JWT cookies:', jwtErr);
      }

      const userLvlIds = await listUserAccessLevelIds(u.id as string | number, u.access_level_id);

      res.json({
        id: String(u.id),
        email: u.email,
        username: u.username,
        isAdmin: !!u.is_admin,
        isSuperAdmin: resolveIsSuperAdminFromUserRow({
          is_super_admin: (u as { is_super_admin?: unknown }).is_super_admin,
          is_admin: (u as { is_admin?: unknown }).is_admin,
          email: u.email
        }),
        isBlocked: !!u.is_blocked,
        adminPermissions: parseAdminPermissions(u.admin_permissions),
        polygonWallet: u.polygon_wallet,
        accessLevelId: u.access_level_id,
        accessLevelIds: userLvlIds,
        referralCode: u.referral_code,
        referredBy: u.referred_by,
        ...getEmailVerificationFlags(u)
      });
    } catch (e: unknown) {
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/login', e, 'Erro ao iniciar sessão.');
    }
  });
}
