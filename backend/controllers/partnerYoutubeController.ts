import type { Express, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { rateLimit } from 'express-rate-limit';
import {
  countPartnerSubmissionsForUserUtcDay,
  getPartnerAccessLevelIdsLower,
  listPartnerYoutubeApprovedPublic,
  listPartnerYoutubeApprovedPublicCursor,
  listPartnerYoutubeByUser,
  listPartnerYoutubeSubmissionsForAdmin,
  updatePartnerYoutubeApprove,
  updatePartnerYoutubeReject,
  deletePartnerYoutubeSubmission,
  getPartnerYoutubeCreatorProfile,
  upsertPartnerYoutubeCreatorProfile,
  listPartnerYoutubePartnersForAdmin,
  isPartnerYoutubeManualAllowlisted,
  addPartnerYoutubeManualAllowlist,
  removePartnerYoutubeManualAllowlist,
  findUserIdsByNormalizedEmail,
  findUserIdsByNormalizedUsername,
  userExistsById
} from '../models/partnerYoutubeModel.js';
import {
  partnerYoutubeUtcDayKeyYYYYMMDD,
  parsePartnerYoutubeVideoCursor,
  userAccessSetHasPartnerLevel,
  sanitizePartnerCreatorAvatarUrl,
  sanitizePartnerCreatorChannelUrl
} from '../utils/partnerYoutubeHelpers.js';
import { PartnerYoutubeSubmitError, runPartnerYoutubeSubmitVideo } from '../modules/partners/partnersSubmit.service.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';
import { NFT_AUTO_ROOM_ID, resolveNftAutoArmario1OnlyRoomIds } from '../lib/nftRoomMining.js';
import {
  loadUserPlacedRacksWithSlots,
  persistStockStoredBatteriesPlacedRacks
} from '../lib/serverRoomPersistence.js';

const partnerYoutubeSubmitLimiter = rateLimit({
  windowMs: 60_000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados envios. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

export type AppendGameActivityLog = (
  _q: unknown,
  userId: number,
  action: string,
  meta: Record<string, unknown>
) => Promise<void>;

export type PartnerYoutubeDeps = {
  authenticateToken: RequestHandler;
  isAdmin: RequestHandler;
  appendGameActivityLog: AppendGameActivityLog;
  db: Pool;
};

function uidNum(req: Request): number | null {
  const v = req.userId as unknown;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function registerPartnerYoutubeRoutes(app: Express, deps: PartnerYoutubeDeps): void {
  const { authenticateToken, isAdmin, appendGameActivityLog, db } = deps;
  const partnerVideoWindowMs = 60 * 24 * 60 * 60 * 1000;

  function buildPartnerRoomCompliance(lastApprovedAt: number | null | undefined, approvedLast365d: number) {
    const lastMs = Number(lastApprovedAt) || 0;
    const now = Date.now();
    const nextDeadlineAt = lastMs > 0 ? lastMs + partnerVideoWindowMs : 0;
    const overdue = !lastMs || nextDeadlineAt < now;
    return {
      requiredApprovedPerYear: 6,
      requiredIntervalDays: 60,
      approvedLast365d: Math.max(0, Number(approvedLast365d) || 0),
      lastApprovedAt: lastMs || null,
      nextDeadlineAt: nextDeadlineAt || null,
      overdue,
      compliant: !overdue
    };
  }

  async function loadPartnerRowsForUserIds(userIds: number[]): Promise<Array<{
    user_id: number;
    username: string;
    email: string;
    approved_count: number;
    approved_last_365d: number;
    last_approved_at: bigint | null;
    partner_channel_url: string;
    partner_avatar_url: string;
    is_allowlisted: boolean;
  }>> {
    if (userIds.length === 0) return [];
    const cutoff365d = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const r = await db.query(
      `SELECT
          u.id AS user_id,
          u.username,
          u.email,
          COALESCE(SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END), 0)::int AS approved_count,
          COALESCE(
            SUM(
              CASE
                WHEN s.status = 'approved' AND COALESCE(s.reviewed_at, s.created_at) >= $2::bigint THEN 1
                ELSE 0
              END
            ),
            0
          )::int AS approved_last_365d,
          MAX(CASE WHEN s.status = 'approved' THEN COALESCE(s.reviewed_at, s.created_at) ELSE NULL END)::bigint AS last_approved_at,
          COALESCE(NULLIF(BTRIM(p.channel_url), ''), '') AS partner_channel_url,
          COALESCE(NULLIF(BTRIM(p.avatar_url), ''), '') AS partner_avatar_url,
          EXISTS (SELECT 1 FROM partner_youtube_manual_allowlist m WHERE m.user_id = u.id) AS is_allowlisted
       FROM users u
       LEFT JOIN partner_youtube_submissions s ON s.user_id = u.id
       LEFT JOIN partner_youtube_creator_profiles p ON p.user_id = u.id
       WHERE u.id = ANY($1::int[])
       GROUP BY
         u.id, u.username, u.email,
         COALESCE(NULLIF(BTRIM(p.channel_url), ''), ''),
         COALESCE(NULLIF(BTRIM(p.avatar_url), ''), '')
       ORDER BY u.username ASC`,
      [userIds, cutoff365d]
    );
    return r.rows as Array<{
      user_id: number;
      username: string;
      email: string;
      approved_count: number;
      approved_last_365d: number;
      last_approved_at: bigint | null;
      partner_channel_url: string;
      partner_avatar_url: string;
      is_allowlisted: boolean;
    }>;
  }

  async function loadPartnerNftRoomUserIds(filterUserIds?: number[]): Promise<Set<number>> {
    // Sala STREAMERS — quem tem acesso à room_1766898636697 (níveis tester/creator)
    const STREAMER_ROOM_ID = 'room_1766898636697';
    const roomIds = [STREAMER_ROOM_ID];
    const hasFilter = Array.isArray(filterUserIds) && filterUserIds.length > 0;
    const sql = hasFilter
      ? `SELECT DISTINCT u.id AS user_id
           FROM users u
          WHERE u.id = ANY($2::int[])
            AND (
              EXISTS (
                SELECT 1
                  FROM user_rig_rooms urr
                 WHERE urr.user_id = u.id
                   AND urr.room_id = ANY($1::text[])
              )
              OR EXISTS (
                SELECT 1
                  FROM placed_racks pr
                 WHERE pr.user_id = u.id
                   AND COALESCE(NULLIF(BTRIM(pr.room_id::text), ''), 'room_initial') = ANY($1::text[])
              )
              OR EXISTS (
                SELECT 1
                  FROM rig_rooms rr
                 WHERE rr.id = ANY($1::text[])
                   AND COALESCE(rr.is_active, 1) = 1
                   AND (
                     COALESCE(NULLIF(BTRIM(rr.allowed_levels), ''), '[]') = '[]'
                     OR EXISTS (
                       SELECT 1
                         FROM jsonb_array_elements_text(COALESCE(NULLIF(BTRIM(rr.allowed_levels), ''), '[]')::jsonb) AS room_lvl(level_id)
                        WHERE LOWER(BTRIM(room_lvl.level_id)) IN (
                          SELECT lvl.level_id
                            FROM (
                              SELECT LOWER(BTRIM(u.access_level_id::text)) AS level_id
                               WHERE u.access_level_id IS NOT NULL
                                 AND BTRIM(u.access_level_id::text) <> ''
                              UNION
                              SELECT LOWER(BTRIM(ual.access_level_id::text)) AS level_id
                                FROM user_access_levels ual
                               WHERE ual.user_id = u.id
                                 AND ual.access_level_id IS NOT NULL
                                 AND BTRIM(ual.access_level_id::text) <> ''
                            ) lvl
                        )
                     )
                   )
              )
            )`
      : `SELECT DISTINCT u.id AS user_id
           FROM users u
          WHERE
            EXISTS (
              SELECT 1
                FROM user_rig_rooms urr
               WHERE urr.user_id = u.id
                 AND urr.room_id = ANY($1::text[])
            )
            OR EXISTS (
              SELECT 1
                FROM placed_racks pr
               WHERE pr.user_id = u.id
                 AND COALESCE(NULLIF(BTRIM(pr.room_id::text), ''), 'room_initial') = ANY($1::text[])
            )
            OR EXISTS (
              SELECT 1
                FROM rig_rooms rr
               WHERE rr.id = ANY($1::text[])
                 AND COALESCE(rr.is_active, 1) = 1
                 AND (
                   COALESCE(NULLIF(BTRIM(rr.allowed_levels), ''), '[]') = '[]'
                   OR EXISTS (
                     SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(NULLIF(BTRIM(rr.allowed_levels), ''), '[]')::jsonb) AS room_lvl(level_id)
                      WHERE LOWER(BTRIM(room_lvl.level_id)) IN (
                        SELECT lvl.level_id
                          FROM (
                            SELECT LOWER(BTRIM(u.access_level_id::text)) AS level_id
                             WHERE u.access_level_id IS NOT NULL
                               AND BTRIM(u.access_level_id::text) <> ''
                            UNION
                            SELECT LOWER(BTRIM(ual.access_level_id::text)) AS level_id
                              FROM user_access_levels ual
                             WHERE ual.user_id = u.id
                               AND ual.access_level_id IS NOT NULL
                               AND BTRIM(ual.access_level_id::text) <> ''
                          ) lvl
                      )
                   )
                 )
            )`;
    const params = hasFilter ? [roomIds, filterUserIds] : [roomIds];
    const r = await db.query(sql, params);
    return new Set(
      r.rows
        .map((row) => Number(row.user_id))
        .filter((v) => Number.isFinite(v) && v > 0)
    );
  }

  app.get('/api/partner-videos/public', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(48, Math.max(1, parseInt(String(req.query.limit ?? '24'), 10) || 24));
      const cursorRaw = req.query.cursor != null ? String(req.query.cursor).trim() : '';
      const cursorParsed = cursorRaw ? parsePartnerYoutubeVideoCursor(cursorRaw) : null;
      if (cursorRaw && !cursorParsed) {
        res.status(400).json({ error: 'Cursor inválido.', code: 'INVALID_CURSOR' });
        return;
      }
      const rows = cursorParsed
        ? await listPartnerYoutubeApprovedPublicCursor(limit, cursorParsed)
        : await listPartnerYoutubeApprovedPublic(
            limit,
            Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0)
          );
      res.json({
        videos: rows.map((row) => ({
          id: row.id,
          title: row.title,
          youtubeUrl: row.youtube_url,
          youtubeVideoId: row.youtube_video_id,
          description: row.description || '',
          createdAt: Number(row.created_at) || 0,
          approvedAt: row.reviewed_at != null ? Number(row.reviewed_at) : undefined,
          username: row.username,
          userId: Number(row.user_id) || 0,
          partnerChannelUrl: row.partner_channel_url || '',
          partnerAvatarUrl: row.partner_avatar_url || ''
        })),
        pagination: cursorParsed
          ? {
              nextCursor:
                rows.length === limit
                  ? `${Number(rows[rows.length - 1].reviewed_at ?? rows[rows.length - 1].created_at) || 0}_${rows[rows.length - 1].id}`
                  : null,
              limit
            }
          : undefined
      });
    } catch (e) {
      console.error('[GET /api/partner-videos/public]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/partner-videos/public', e, 'Erro ao listar vídeos.');
    }
  });

  app.get('/api/partner-videos/my', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidNum(req);
    if (!uid) {
      res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const idSet = await getPartnerAccessLevelIdsLower(uid);
      const manualListed = await isPartnerYoutubeManualAllowlisted(uid);
      const isPartner = userAccessSetHasPartnerLevel(idSet) || manualListed;
      const dayKey = partnerYoutubeUtcDayKeyYYYYMMDD(Date.now());
      const usedToday = await countPartnerSubmissionsForUserUtcDay(uid, dayKey);
      const listRows = await listPartnerYoutubeByUser(uid);
      res.json({
        isPartner,
        canSubmitToday: isPartner && usedToday < 1,
        submissionsToday: usedToday,
        submissions: listRows.map((row) => ({
          id: row.id,
          title: row.title,
          youtubeUrl: row.youtube_url,
          youtubeVideoId: row.youtube_video_id,
          description: row.description || '',
          status: row.status,
          createdAt: Number(row.created_at) || 0,
          reviewedAt: row.reviewed_at != null ? Number(row.reviewed_at) : undefined,
          rejectReason: row.reject_reason || undefined
        }))
      });
    } catch (e) {
      console.error('[GET /api/partner-videos/my]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/partner-videos/my', e, 'Erro ao carregar envios.');
    }
  });

  app.post(
    '/api/partner-videos/submit',
    partnerYoutubeSubmitLimiter,
    authenticateToken,
    async (req: Request, res: Response) => {
      const uid = uidNum(req);
      if (!uid) {
        res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
        return;
      }
      const body = (req.body || {}) as Record<string, unknown>;
      try {
        const { id } = await runPartnerYoutubeSubmitVideo({
          userId: uid,
          titleRaw: body.title,
          youtubeUrlRaw: body.youtubeUrl,
          descriptionRaw: body.description
        });
        try {
          await appendGameActivityLog(null, uid, 'partner_youtube_submit', { submissionId: id });
        } catch {
          /* ignore */
        }
        res.status(201).json({ ok: true, id, publicId: id, status: 'pending' });
      } catch (e) {
        if (e instanceof PartnerYoutubeSubmitError) {
          const payload: Record<string, unknown> = { error: e.message };
          if (e.code) payload.code = e.code;
          res.status(e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).json(payload);
          return;
        }
        console.error('[POST /api/partner-videos/submit]', e);
        sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/partner-videos/submit', e, 'Erro ao guardar envio.');
      }
    }
  );

  app.post('/api/admin/partner-youtube-allowlist', isAdmin, async (req: Request, res: Response) => {
    const adminId = uidNum(req);
    if (!adminId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const body = (req.body || {}) as { userId?: unknown; username?: unknown };
    let userId = parseInt(String(body.userId ?? '').trim(), 10);
    if (!Number.isFinite(userId) || userId < 1) {
      const raw = typeof body.username === 'string' ? body.username.trim() : '';
      if (!raw) {
        res.status(400).json({ error: 'Indica userId ou texto (nome ou email).' });
        return;
      }
      try {
        const ids = raw.includes('@')
          ? await findUserIdsByNormalizedEmail(raw)
          : await findUserIdsByNormalizedUsername(raw);
        if (ids.length === 0) {
          res.status(404).json({ error: 'Utilizador não encontrado.' });
          return;
        }
        if (ids.length > 1) {
          res.status(400).json({ error: 'Vários resultados; escolhe na lista pelo ID ou refina a pesquisa.' });
          return;
        }
        userId = ids[0];
      } catch (e) {
        console.error('[POST /api/admin/partner-youtube-allowlist] lookup', e);
        sendInternalErrorSafeMessageOrPrisma(
          res,
          'POST /api/admin/partner-youtube-allowlist lookup',
          e,
          'Erro ao procurar utilizador.'
        );
        return;
      }
    } else {
      const ok = await userExistsById(userId);
      if (!ok) {
        res.status(404).json({ error: 'Utilizador não encontrado.' });
        return;
      }
    }
    try {
      const inserted = await addPartnerYoutubeManualAllowlist(userId, adminId, Date.now());
      res.json({ ok: true, inserted, userId });
    } catch (e) {
      console.error('[POST /api/admin/partner-youtube-allowlist]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'POST /api/admin/partner-youtube-allowlist',
        e,
        'Erro ao adicionar à lista.'
      );
    }
  });

  app.delete('/api/admin/partner-youtube-allowlist/:userId', isAdmin, async (req: Request, res: Response) => {
    if (!uidNum(req)) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const targetId = parseInt(String(req.params.userId || '').trim(), 10);
    if (!Number.isFinite(targetId) || targetId < 1) {
      res.status(400).json({ error: 'ID de utilizador inválido.' });
      return;
    }
    try {
      const removed = await removePartnerYoutubeManualAllowlist(targetId);
      if (!removed) {
        res.status(404).json({ error: 'Este utilizador não está na lista manual.' });
        return;
      }
      res.json({ ok: true, userId: targetId });
    } catch (e) {
      console.error('[DELETE /api/admin/partner-youtube-allowlist/:userId]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'DELETE /api/admin/partner-youtube-allowlist/:userId',
        e,
        'Erro ao remover da lista.'
      );
    }
  });

  app.get('/api/admin/partner-youtube-partners', isAdmin, async (_req: Request, res: Response) => {
    try {
      const basePartnerRows = await listPartnerYoutubePartnersForAdmin();
      const partnerUserIds = basePartnerRows
        .map((row) => Number(row.user_id))
        .filter((v) => Number.isFinite(v) && v > 0);
      const nftRoomActiveUserIds = await loadPartnerNftRoomUserIds();
      const missingNftRoomUserIds = Array.from(nftRoomActiveUserIds).filter((uid) => !partnerUserIds.includes(uid));
      const extraRows = await loadPartnerRowsForUserIds(missingNftRoomUserIds);
      const mergedRows = [...basePartnerRows, ...extraRows].sort((a, b) =>
        String(a.username || '').localeCompare(String(b.username || ''), 'pt-PT', { sensitivity: 'base' })
      );
      const activeRoomRows = mergedRows.filter((row) => nftRoomActiveUserIds.has(Number(row.user_id) || 0));
      res.json({
        partners: activeRoomRows.map((row) => ({
          ...(function () {
            const hasNftRoom = nftRoomActiveUserIds.has(Number(row.user_id) || 0);
            const compliance = buildPartnerRoomCompliance(
              row.last_approved_at != null ? Number(row.last_approved_at) : null,
              Number(row.approved_last_365d) || 0
            );
            return {
              nftRoom: {
                ...compliance,
                active: hasNftRoom,
                overdue: hasNftRoom ? compliance.overdue : false,
                compliant: hasNftRoom ? compliance.compliant : true
              }
            };
          })(),
          userId: row.user_id,
          username: row.username,
          email: row.email,
          approvedCount: Number(row.approved_count) || 0,
          approvedLast365d: Number(row.approved_last_365d) || 0,
          lastApprovedAt: row.last_approved_at != null ? Number(row.last_approved_at) : null,
          channelUrl: row.partner_channel_url || '',
          avatarUrl: row.partner_avatar_url || '',
          allowlisted: Boolean(row.is_allowlisted)
        }))
      });
    } catch (e) {
      console.error('[GET /api/admin/partner-youtube-partners]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'GET /api/admin/partner-youtube-partners',
        e,
        'Erro ao listar parceiros.'
      );
    }
  });

  app.post('/api/admin/partner-youtube-partners/:userId/deactivate-nft-room', isAdmin, async (req: Request, res: Response) => {
    const targetUserId = parseInt(String(req.params.userId || '').trim(), 10);
    const adminId = uidNum(req);
    if (!Number.isFinite(targetUserId) || targetUserId < 1) {
      res.status(400).json({ error: 'ID de utilizador inválido.' });
      return;
    }
    if (!adminId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const nftRoomIds = await resolveNftAutoArmario1OnlyRoomIds({
        query: (text: string, params?: unknown[]) => client.query(text, params)
      });
      const roomIds = Array.from(nftRoomIds);

      const roomOwnRes = await client.query(
        `SELECT room_id
           FROM user_rig_rooms
          WHERE user_id = $1
            AND room_id = ANY($2::text[])
          LIMIT 1`,
        [targetUserId, roomIds]
      );
      if (!roomOwnRes.rows[0]) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Este utilizador não tem a sala NFT ativa.' });
        return;
      }

      const currentRacks = await loadUserPlacedRacksWithSlots(client, targetUserId);
      const nextRacks = currentRacks.filter((rack) => !nftRoomIds.has(String(rack.roomId || '')));
      const saveActivityLogs: Array<{ action: string; meta: Record<string, unknown> }> = [];

      await persistStockStoredBatteriesPlacedRacks(
        client,
        targetUserId,
        {
          placedRacks: nextRacks
        },
        saveActivityLogs
      );

      await client.query(
        `DELETE FROM user_rig_rooms
          WHERE user_id = $1
            AND room_id = ANY($2::text[])`,
        [targetUserId, roomIds]
      );

      await client.query('COMMIT');

      try {
        await appendGameActivityLog(null, targetUserId, 'partner_nft_room_deactivated_by_admin', {
          roomId: NFT_AUTO_ROOM_ID,
          adminUserId: adminId,
          removedRackCount: Math.max(0, currentRacks.length - nextRacks.length)
        });
      } catch {
        /* ignore */
      }

      res.json({
        ok: true,
        roomId: NFT_AUTO_ROOM_ID,
        removedRackCount: Math.max(0, currentRacks.length - nextRacks.length)
      });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      console.error('[POST /api/admin/partner-youtube-partners/:userId/deactivate-nft-room]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'POST /api/admin/partner-youtube-partners/:userId/deactivate-nft-room',
        e,
        'Erro ao desativar a sala NFT.'
      );
    } finally {
      client.release();
    }
  });

  app.get(['/api/admin/partner-videos', '/api/admin/partners/submissions'], isAdmin, async (req: Request, res: Response) => {
    const st = String(req.query.status || 'all').toLowerCase();
    const statusFilter =
      st === 'pending' || st === 'approved' || st === 'rejected' ? (st as 'pending' | 'approved' | 'rejected') : 'all';
    try {
      const subRows = await listPartnerYoutubeSubmissionsForAdmin(statusFilter);
      res.json({
        submissions: subRows.map((row) => ({
          id: row.id,
          userId: row.user_id,
          username: row.username,
          email: row.email,
          title: row.title,
          youtubeUrl: row.youtube_url,
          youtubeVideoId: row.youtube_video_id,
          description: row.description || '',
          status: row.status,
          createdAt: Number(row.created_at) || 0,
          reviewedAt: row.reviewed_at != null ? Number(row.reviewed_at) : undefined,
          reviewedBy: row.reviewed_by,
          rejectReason: row.reject_reason || undefined
        }))
      });
    } catch (e) {
      console.error('[GET /api/admin/partner-videos]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/admin/partner-videos', e, 'Erro ao listar envios.');
    }
  });

  app.post(
    ['/api/admin/partner-videos/:id/approve', '/api/admin/partners/videos/:id/approve'],
    isAdmin,
    async (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const adminId = uidNum(req);
    if (!adminId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    try {
      const n = await updatePartnerYoutubeApprove(id, adminId, Date.now());
      if (!n) {
        res.status(404).json({ error: 'Envio não encontrado ou já processado.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[POST /api/admin/partner-videos/:id/approve]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/admin/partner-videos/:id/approve', e, 'Erro ao aprovar.');
    }
  }
  );

  app.post(
    ['/api/admin/partner-videos/:id/reject', '/api/admin/partners/videos/:id/reject'],
    isAdmin,
    async (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const adminId = uidNum(req);
    if (!adminId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const body = (req.body || {}) as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    try {
      const n = await updatePartnerYoutubeReject(id, adminId, reason || null, Date.now());
      if (!n) {
        res.status(404).json({ error: 'Envio não encontrado ou já processado.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[POST /api/admin/partner-videos/:id/reject]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/admin/partner-videos/:id/reject', e, 'Erro ao recusar.');
    }
  }
  );

  app.get('/api/admin/partner-youtube-creators/:userId', isAdmin, async (req: Request, res: Response) => {
    const uid = parseInt(String(req.params.userId || '').trim(), 10);
    if (!Number.isFinite(uid) || uid < 1) {
      res.status(400).json({ error: 'ID de utilizador inválido.' });
      return;
    }
    try {
      const row = await getPartnerYoutubeCreatorProfile(uid);
      res.json({
        channelUrl: row?.channel_url ?? '',
        avatarUrl: row?.avatar_url ?? ''
      });
    } catch (e) {
      console.error('[GET /api/admin/partner-youtube-creators/:userId]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'GET /api/admin/partner-youtube-creators/:userId',
        e,
        'Erro ao carregar perfil.'
      );
    }
  });

  app.put('/api/admin/partner-youtube-creators/:userId', isAdmin, async (req: Request, res: Response) => {
    const uid = parseInt(String(req.params.userId || '').trim(), 10);
    if (!Number.isFinite(uid) || uid < 1) {
      res.status(400).json({ error: 'ID de utilizador inválido.' });
      return;
    }
    const adminId = uidNum(req);
    if (!adminId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const body = (req.body || {}) as { channelUrl?: unknown; avatarUrl?: unknown };
    const rawCh = typeof body.channelUrl === 'string' ? body.channelUrl : '';
    const rawAv = typeof body.avatarUrl === 'string' ? body.avatarUrl : '';
    const channelUrl = sanitizePartnerCreatorChannelUrl(rawCh);
    const avatarUrl = sanitizePartnerCreatorAvatarUrl(rawAv);
    if (rawCh.trim() && !channelUrl) {
      res.status(400).json({ error: 'Link do canal inválido (use https:// no YouTube).' });
      return;
    }
    if (rawAv.trim() && !avatarUrl) {
      res.status(400).json({ error: 'URL da foto inválida (https:// ou caminho /...).' });
      return;
    }
    try {
      await upsertPartnerYoutubeCreatorProfile({
        userId: uid,
        channelUrl,
        avatarUrl,
        updatedAt: Date.now(),
        updatedBy: adminId
      });
      res.json({ ok: true, channelUrl, avatarUrl });
    } catch (e) {
      console.error('[PUT /api/admin/partner-youtube-creators/:userId]', e);
      sendInternalErrorSafeMessageOrPrisma(
        res,
        'PUT /api/admin/partner-youtube-creators/:userId',
        e,
        'Erro ao guardar perfil (verifica se o utilizador existe).'
      );
    }
  });

  // ── Streamer Room Management ────────────────────────────────────────────────

  const STREAMER_ROOM_ID_CONST = 'room_1766898636697';
  const STREAMER_LEVEL_IDS = ['creator', 'tester'];
  const OVERDUE_DAYS = 60;

  app.get('/api/admin/streamer-room-users', isAdmin, async (_req: Request, res: Response) => {
    try {
      const overdueThresholdMs = Date.now() - OVERDUE_DAYS * 24 * 60 * 60 * 1000;
      const sql = `
        SELECT DISTINCT ON (u.id)
          u.id AS user_id,
          u.username,
          u.email,
          (
            SELECT MAX(pys.created_at)
              FROM partner_youtube_submissions pys
             WHERE pys.user_id = u.id
               AND pys.status = 'approved'
          ) AS last_approved_at,
          (
            SELECT COUNT(*)
              FROM partner_youtube_submissions pys
             WHERE pys.user_id = u.id
               AND pys.status = 'approved'
               AND pys.created_at >= $1
          ) AS approved_last_60d
        FROM users u
        WHERE (
          EXISTS (
            SELECT 1 FROM user_rig_rooms urr
             WHERE urr.user_id = u.id AND urr.room_id = $2
          )
          OR EXISTS (
            SELECT 1 FROM placed_racks pr
             WHERE pr.user_id = u.id
               AND COALESCE(NULLIF(BTRIM(pr.room_id::text), ''), 'room_initial') = $2
          )
          OR EXISTS (
            SELECT 1 FROM user_access_levels ual
             WHERE ual.user_id = u.id
               AND LOWER(BTRIM(ual.access_level_id::text)) = ANY($3::text[])
          )
          OR LOWER(BTRIM(u.access_level_id::text)) = ANY($3::text[])
        )
        ORDER BY u.id ASC
      `;
      const r = await db.query(sql, [overdueThresholdMs, STREAMER_ROOM_ID_CONST, STREAMER_LEVEL_IDS]);
      const users = r.rows.map((row) => {
        const lastApprovedAt = row.last_approved_at != null ? Number(row.last_approved_at) : null;
        const approvedLast60d = parseInt(String(row.approved_last_60d || '0'), 10);
        const overdue = approvedLast60d === 0;
        return {
          userId: Number(row.user_id),
          username: String(row.username || ''),
          email: String(row.email || ''),
          lastApprovedAt,
          approvedLast60d,
          overdue
        };
      });
      res.json({ users });
    } catch (e) {
      console.error('[GET /api/admin/streamer-room-users]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'GET /api/admin/streamer-room-users', e, 'Erro ao listar streamers.');
    }
  });

  app.post('/api/admin/streamer-room-users/:userId/deactivate', isAdmin, async (req: Request, res: Response) => {
    const targetUserId = parseInt(String(req.params.userId || '').trim(), 10);
    const adminId = uidNum(req);
    if (!Number.isFinite(targetUserId) || targetUserId < 1) {
      res.status(400).json({ error: 'ID de utilizador inválido.' });
      return;
    }
    if (!adminId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const currentRacks = await loadUserPlacedRacksWithSlots(client, targetUserId);
      const streamerRacks = currentRacks.filter(
        (rack) => String(rack.roomId || '').trim() === STREAMER_ROOM_ID_CONST
      );
      const nextRacks = currentRacks.filter(
        (rack) => String(rack.roomId || '').trim() !== STREAMER_ROOM_ID_CONST
      );
      const removedRackCount = streamerRacks.length;

      const saveActivityLogs: Array<{ action: string; meta: Record<string, unknown> }> = [];
      await persistStockStoredBatteriesPlacedRacks(client, targetUserId, { placedRacks: nextRacks }, saveActivityLogs);

      await client.query(
        'DELETE FROM user_rig_rooms WHERE user_id = $1 AND room_id = $2',
        [targetUserId, STREAMER_ROOM_ID_CONST]
      );

      await client.query(
        `DELETE FROM user_access_levels WHERE user_id = $1 AND LOWER(BTRIM(access_level_id::text)) = ANY($2::text[])`,
        [targetUserId, STREAMER_LEVEL_IDS]
      );

      await client.query(
        `UPDATE users SET access_level_id = 'normal'
          WHERE id = $1 AND LOWER(BTRIM(access_level_id::text)) = ANY($2::text[])`,
        [targetUserId, STREAMER_LEVEL_IDS]
      );

      await client.query('COMMIT');

      try {
        await appendGameActivityLog(null, targetUserId, 'streamer_room_deactivated_by_admin', {
          roomId: STREAMER_ROOM_ID_CONST,
          adminUserId: adminId,
          removedRackCount
        });
      } catch { /* ignore */ }

      res.json({ ok: true, removedRackCount });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      console.error('[POST /api/admin/streamer-room-users/:userId/deactivate]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'POST /api/admin/streamer-room-users/:userId/deactivate', e, 'Erro ao desativar sala streamer.');
    } finally {
      client.release();
    }
  });

  // ── End Streamer Room Management ────────────────────────────────────────────

  app.delete(
    ['/api/admin/partner-videos/:id', '/api/admin/partners/videos/:id/archive'],
    isAdmin,
    async (req: Request, res: Response) => {
    const raw = String(req.params.id || '').trim();
    if (!raw || raw.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(raw)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    if (!uidNum(req)) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    try {
      const n = await deletePartnerYoutubeSubmission(raw);
      if (!n) {
        res.status(404).json({ error: 'Envio não encontrado.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /api/admin/partner-videos/:id]', e);
      sendInternalErrorSafeMessageOrPrisma(res, 'DELETE /api/admin/partner-videos/:id', e, 'Erro ao apagar.');
    }
  }
  );
}
