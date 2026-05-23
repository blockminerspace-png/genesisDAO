import type { Express, Request, Response } from 'express';
import type bcryptjs from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import db from '../config/db.js';
import { executeUserPutCoreTransaction } from '../models/userPutCoreTransaction.js';
import { loadUserPlacedRacksWithSlots, persistStockStoredBatteriesPlacedRacks } from '../lib/serverRoomPersistence.js';
import { normalizePlacedRackRoomId } from '../modules/batteries/batteries.validation.js';
import {
  assertPublicSignupEmailAllowed,
  getConflictingUserIdByEmail,
  getConflictingUserIdByUsername,
  EMAIL_ADDRESS_MAX_LENGTH,
  SIGNUP_EMAIL_MAX_TOTAL,
  validateAccessLevelIdsArray,
  validateOptionalAccessLevelId,
  validateOptionalPolygonWallet,
  validateOptionalReferralCodeInput,
  validateSignupPassword,
  validateSignupUsername
} from '../models/registrationValidation.js';
import { EmailPolicyError, getUserIdByEmail, IpLimitError } from '../models/userModel.js';
import { insertDeviceFingerprintLog, sanitizeDeviceFingerprint } from '../models/deviceFingerprintModel.js';
import { logUserAction } from '../lib/mongoLogs.js';
import { respondIfHttpControlledError, sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';

export type UserRegistrationDeps = {
  bcrypt: typeof bcryptjs;
  getClientIp: (req: Request) => string;
  publicSignupLimiter?: (req: Request, res: Response, next: () => void) => void;
};

export function registerUserRoutes(app: Express, deps: UserRegistrationDeps): void {
  const { bcrypt, getClientIp, publicSignupLimiter } = deps;
  const STREAMER_ROOM_ID = 'room_1766898636697';
  const STREAMER_ALLOWED_LEVEL_IDS = new Set(['creator', 'tester']);

  async function cleanupStreamerRoomIfAccessRemoved(userId: number): Promise<number> {
    const levelRows = await prisma.$queryRaw<{ access_level_id: string | null }[]>`
      SELECT access_level_id
      FROM user_access_levels
      WHERE user_id = ${userId}
      UNION
      SELECT access_level_id
      FROM users
      WHERE id = ${userId}
    `;
    const levelIds = new Set(
      levelRows
        .map((row) => String(row.access_level_id || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const stillAllowed = Array.from(levelIds).some((id) => STREAMER_ALLOWED_LEVEL_IDS.has(id));
    if (stillAllowed) return 0;

    const roomOwnRes = await prisma.user_rig_rooms.findUnique({
      where: {
        user_id_room_id: {
          user_id: userId,
          room_id: STREAMER_ROOM_ID
        }
      },
      select: { user_id: true }
    });
    if (!roomOwnRes) return 0;

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const currentRacks = await loadUserPlacedRacksWithSlots(client, userId);
      const nextRacks = currentRacks.filter(
        (rack) => normalizePlacedRackRoomId(rack.roomId) !== STREAMER_ROOM_ID
      );
      const removedRackCount = Math.max(0, currentRacks.length - nextRacks.length);
      const saveActivityLogs: Array<{ action: string; meta: Record<string, unknown> }> = [];

      await persistStockStoredBatteriesPlacedRacks(
        client,
        userId,
        {
          placedRacks: nextRacks
        },
        saveActivityLogs
      );

      await client.query(
        'DELETE FROM user_rig_rooms WHERE user_id = $1 AND room_id = $2',
        [userId, STREAMER_ROOM_ID]
      );

      await client.query('COMMIT');
      return removedRackCount;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  const applyPublicSignupLimiter = (req: Request, res: Response, next: () => void) => {
    if (!req.userId && publicSignupLimiter) {
      return publicSignupLimiter(req, res, next);
    }
    next();
  };

  app.put('/api/user', applyPublicSignupLimiter, async (req: Request, res: Response) => {
    const isAuthenticatedRequest = Boolean((req as Request & { userId?: number }).userId);
    const u = req.body as Record<string, unknown>;
    const normalizedEmail = String(u.email || '')
      .toLowerCase()
      .trim();
    console.log(`[UserUpdate] Payload received for email: ${normalizedEmail}, userId: ${req.userId}`);
    try {
      let uid: string | number;
      let usernameForDb: string | unknown = u.username;
      let polygonForDb: unknown = u.polygonWallet ?? null;
      let accessLevelForDb: unknown = u.accessLevelId ?? null;
      let referredByForDb: unknown = u.referredBy ?? null;

      if (req.userId) {
        const adminRow = await prisma.users.findUnique({
          where: { id: Number(req.userId) },
          select: { is_admin: true }
        });
        const isAdminUser = adminRow?.is_admin;

        if (isAdminUser && (u.id || u.email)) {
          if (u.id) {
            uid = u.id as string | number;
          } else {
            uid = await getUserIdByEmail(normalizedEmail, getClientIp(req), { allowAnyDomain: true });
          }
        } else {
          uid = req.userId;
        }

        if (typeof u.username === 'string' && u.username.trim().length > 0) {
          const vu = validateSignupUsername(u.username);
          if (!vu.ok) {
            return res.status(400).json({ error: vu.error });
          }
          const taken = await getConflictingUserIdByUsername(vu.username, uid);
          if (taken != null) {
            return res.status(409).json({
              error: 'Este nome de utilizador já está em uso. Escolha outro.',
              code: 'USERNAME_TAKEN'
            });
          }
          usernameForDb = vu.username;
        }

        if (normalizedEmail.length > 0) {
          if (!normalizedEmail.includes('@') || normalizedEmail.length > EMAIL_ADDRESS_MAX_LENGTH) {
            return res.status(400).json({ error: 'E-mail inválido.' });
          }
          const emailTaken = await getConflictingUserIdByEmail(normalizedEmail, uid);
          if (emailTaken != null) {
            return res.status(409).json({
              error: 'Este e-mail já está associado a outra conta.',
              code: 'EMAIL_TAKEN'
            });
          }
        }

        const pw = validateOptionalPolygonWallet(u.polygonWallet);
        if (pw && typeof pw === 'object' && 'error' in pw) {
          return res.status(400).json({ error: (pw as { error: string }).error });
        }
        polygonForDb = typeof pw === 'string' ? pw : u.polygonWallet ?? null;

        const al = validateOptionalAccessLevelId(u.accessLevelId);
        if (al && typeof al === 'object' && 'error' in al) {
          return res.status(400).json({ error: (al as { error: string }).error });
        }
        accessLevelForDb = typeof al === 'string' ? al : u.accessLevelId ?? null;

        {
          const ref = validateOptionalReferralCodeInput(u.referredBy);
          if (!ref.ok) {
            return res.status(400).json({ error: ref.error });
          }
          referredByForDb = ref.code;
        }

      } else {
        if (!u.email) {
          return res.status(400).json({ error: 'Email é obrigatório para o registro.' });
        }
        if (!normalizedEmail.includes('@') || normalizedEmail.length > SIGNUP_EMAIL_MAX_TOTAL) {
          return res.status(400).json({ error: 'E-mail inválido.' });
        }

        const userVu = validateSignupUsername(u.username);
        if (!userVu.ok) {
          return res.status(400).json({ error: userVu.error });
        }
        const nickname = userVu.username;

        const existing = await prisma.users.findFirst({
          where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
          select: { id: true, password: true }
        });

        if (existing?.password) {
          return res.status(403).json({ error: 'Este email já está cadastrado. Por favor, faça login.' });
        }

        if (existing && !existing.password) {
          const pwdPresent = typeof u.password === 'string' && u.password.trim().length > 0;
          if (!pwdPresent) {
            return res.status(400).json({ error: 'Defina uma palavra-passe para concluir o registo.' });
          }
        }

        const hasPassword = typeof u.password === 'string' && u.password.trim().length > 0;
        if (!existing && !hasPassword) {
          return res.status(400).json({ error: 'Defina uma palavra-passe para o registo.' });
        }
        if (hasPassword) {
          const pv = validateSignupPassword(u.password, true);
          if (!pv.ok) {
            return res.status(400).json({ error: pv.error });
          }
        }

        const pw = validateOptionalPolygonWallet(u.polygonWallet);
        if (pw && typeof pw === 'object' && 'error' in pw) {
          return res.status(400).json({ error: (pw as { error: string }).error });
        }
        polygonForDb = typeof pw === 'string' ? pw : null;

        {
          const ref = validateOptionalReferralCodeInput(u.referredBy);
          if (!ref.ok) {
            return res.status(400).json({ error: ref.error });
          }
          referredByForDb = ref.code;
        }

        if (!existing) {
          const ev = assertPublicSignupEmailAllowed(normalizedEmail);
          if (!ev.ok) {
            return res.status(400).json({ ok: false, error: ev.error });
          }

          const userTaken = await getConflictingUserIdByUsername(nickname, null);
          if (userTaken != null) {
            return res.status(409).json({
              error: 'Este nome de utilizador já está em uso. Escolha outro.',
              code: 'USERNAME_TAKEN'
            });
          }

          uid = (await getUserIdByEmail(normalizedEmail, getClientIp(req), {
            preferredUsername: nickname
          })) as number;
        } else {
          const userTaken = await getConflictingUserIdByUsername(nickname, existing.id);
          if (userTaken != null) {
            return res.status(409).json({
              error: 'Este nome de utilizador já está em uso. Escolha outro.',
              code: 'USERNAME_TAKEN'
            });
          }
          uid = existing.id;
        }

        usernameForDb = nickname;

        const defaultAccessLevel = await prisma.access_levels.findFirst({
          where: { is_default: 1, is_active: 1 },
          orderBy: [{ id: 'asc' }],
          select: { id: true }
        });
        accessLevelForDb = defaultAccessLevel?.id || 'normal';
      }

      let allowAccessLevelFromBody = !req.userId;
      if (req.userId) {
        const gateRow = await prisma.users.findUnique({
          where: { id: Number(req.userId) },
          select: { is_admin: true }
        });
        allowAccessLevelFromBody = !!gateRow?.is_admin;
      }
      if (!req.userId) {
        allowAccessLevelFromBody = false;
      }
      if (!allowAccessLevelFromBody) {
        const curRow = await prisma.users.findUnique({
          where: { id: Number(uid) },
          select: { access_level_id: true }
        });
        accessLevelForDb = curRow?.access_level_id ?? accessLevelForDb ?? null;
      }

      let accessLevelIdsValidated: string[] | null = null;
      if (allowAccessLevelFromBody && Array.isArray(u.accessLevelIds)) {
        const av = validateAccessLevelIdsArray(u.accessLevelIds);
        if (!av.ok) {
          return res.status(400).json({ error: av.error });
        }
        accessLevelIdsValidated = av.ids;
      }

      const hasPassword = typeof u.password === 'string' && u.password.trim().length > 0;
      if (hasPassword) {
        const pv = validateSignupPassword(u.password, true);
        if (!pv.ok) {
          return res.status(400).json({ error: pv.error });
        }
      }

      const passwordHash = hasPassword ? await bcrypt.hash(u.password as string, 10) : null;
      const clientIp = getClientIp(req);

      await prisma.$transaction(async (tx) => {
        await executeUserPutCoreTransaction(tx, {
          uid: Number(uid),
          usernameForUpdate: String(usernameForDb ?? ''),
          normalizedEmail,
          passwordHash,
          polygonForUpdate:
            polygonForDb == null || polygonForDb === ''
              ? null
              : String(polygonForDb),
          accessLevelIdForUpdate:
            accessLevelForDb == null || accessLevelForDb === ''
              ? null
              : String(accessLevelForDb),
          referredByForUpdate:
            referredByForDb == null || referredByForDb === ''
              ? null
              : String(referredByForDb),
          allowAccessLevelFromBody,
          accessLevelIdsValidated,
          clientIpReferral: clientIp
        });
      });
      console.log(`[UserUpdate] Success for uid: ${uid}`);

      if (!isAuthenticatedRequest) {
        const fp = sanitizeDeviceFingerprint(u.deviceFingerprint);
        if (fp) {
          const ip = getClientIp(req);
          const ua = String(req.get('user-agent') || '');
          void insertDeviceFingerprintLog({
            userId: Number(uid),
            eventType: 'register',
            fingerprintHash: fp.fingerprintHash,
            payloadJson: fp.payloadJson,
            ip,
            userAgent: ua
          }).catch((err: unknown) => {
            console.warn('[Fingerprint] registo:', err instanceof Error ? err.message : err);
          });
        }
      }

      const uidForLog = Number(uid);
      if (Number.isFinite(uidForLog)) {
        logUserAction(uidForLog, isAuthenticatedRequest ? 'profile_update' : 'signup_complete', {});
      }

      if (isAuthenticatedRequest && Number.isFinite(uidForLog)) {
        const removedStreamerRacks = await cleanupStreamerRoomIfAccessRemoved(uidForLog);
        if (removedStreamerRacks > 0) {
          logUserAction(uidForLog, 'streamer_room_deactivated_for_access_loss', {
            roomId: STREAMER_ROOM_ID,
            removedRackCount: removedStreamerRacks
          });
        }
      }

      res.json({ ok: true });
    } catch (e: unknown) {
      console.error('[UserUpdate] Error:', e);
      if (respondIfHttpControlledError(res, e)) return;
      if (e instanceof IpLimitError) {
        return res.status(403).json({
          error: e.message,
          code: 'IP_LIMIT_REACHED'
        });
      }
      if (e instanceof EmailPolicyError) {
        return res.status(400).json({ ok: false, error: e.message });
      }
      const pg = e as { code?: string; constraint?: string; existingAccounts?: unknown; message?: string; stack?: string };
      if (pg.code === '23505') {
        return res.status(409).json({
          error: 'Este e-mail ou nome de utilizador já está em uso.',
          code: 'DUPLICATE'
        });
      }
      if (pg.code === 'EMAIL_POLICY') {
        return res.status(400).json({ ok: false, error: pg.message });
      }
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'PUT /api/user',
        e,
        'Erro interno no servidor durante o registro.'
      );
    }
  });
}
