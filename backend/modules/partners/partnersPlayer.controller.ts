import type { Express, Request, RequestHandler, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { sendInternalErrorSafeMessageOrPrisma } from '../../utils/apiErrorResponse.js';
import { PartnerYoutubeSubmitError, runPartnerYoutubeSubmitVideo } from './partnersSubmit.service.js';
import { buildPartnersStatePayload, getApprovedPartnerVideoByPublicId } from './partnersState.service.js';
import {
  PartnerYoutubeApplyError,
  runPartnerYoutubeApplicationSubmit
} from './partnersApply.service.js';
import { PartnerYoutubeProfileError, runPartnerYoutubeProfileUpdate } from './partnersProfile.service.js';
import { buildStoredUploadFilename, sanitizeOriginalNameBase } from '../../models/imageAssetModel.js';

const partnersSubmitLimiter = rateLimit({
  windowMs: 60_000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados envios. Aguarda um minuto.', code: 'RATE_LIMIT' }
});

const partnersApplyLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas candidaturas. Aguarda um momento.', code: 'RATE_LIMIT' }
});

function uidOptional(req: Request): number | null {
  const v = req.userId as unknown;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function uidRequired(req: Request): number | null {
  return uidOptional(req);
}

function createPartnerAvatarMulter(uploadsDir: string): ReturnType<typeof multer> {
  const dest = path.join(uploadsDir, 'partner-avatars');
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(dest, { recursive: true });
      } catch {
        /* ignore */
      }
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
      const safeBase = sanitizeOriginalNameBase(file.originalname);
      cb(null, buildStoredUploadFilename(`partner-${safeBase}`, ext));
    }
  });
  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const mime = String(file.mimetype || '').toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext) && /^image\//.test(mime)) cb(null, true);
      else cb(new Error('Formato inválido. Usa PNG, JPG ou WEBP.'));
    }
  });
}

export type PartnersPlayerControllerDeps = {
  authenticateToken: RequestHandler;
  uploadsDir: string;
  appendGameActivityLog: (
    _q: unknown,
    userId: number,
    action: string,
    meta: Record<string, unknown>
  ) => Promise<void>;
};

export function registerPartnersPlayerRoutes(app: Express, deps: PartnersPlayerControllerDeps): void {
  const { authenticateToken, appendGameActivityLog, uploadsDir } = deps;
  const uploadPartnerAvatar = createPartnerAvatarMulter(uploadsDir);

  app.get('/api/partners/state', async (req: Request, res: Response) => {
    try {
      const payload = await buildPartnersStatePayload({
        optionalUserId: uidOptional(req),
        query: {
          limit: typeof req.query.limit === 'string' ? req.query.limit : undefined,
          cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined
        }
      });
      res.json(payload);
    } catch (e) {
      console.error('[GET /api/partners/state]', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao carregar parceiros.');
    }
  });

  app.get('/api/partners/videos', async (req: Request, res: Response) => {
    try {
      const st = await buildPartnersStatePayload({
        optionalUserId: null,
        query: {
          limit: typeof req.query.limit === 'string' ? req.query.limit : undefined,
          cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined
        }
      });
      const showcase = st.showcase as Record<string, unknown> | undefined;
      res.json({
        ok: true,
        videos: showcase?.videos ?? [],
        pagination: showcase?.pagination ?? { nextCursor: null, limit: 24 }
      });
    } catch (e) {
      console.error('[GET /api/partners/videos]', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao listar vídeos.');
    }
  });

  app.get('/api/partners/videos/:publicId', async (req: Request, res: Response) => {
    const publicId = String(req.params.publicId || '').trim().slice(0, 120);
    if (!publicId) {
      res.status(400).json({ error: 'ID inválido.', code: 'VALIDATION' });
      return;
    }
    try {
      const v = await getApprovedPartnerVideoByPublicId(publicId);
      if (!v) {
        res.status(404).json({ error: 'Vídeo não encontrado.', code: 'NOT_FOUND' });
        return;
      }
      res.json({ ok: true, video: v });
    } catch (e) {
      console.error('[GET /api/partners/videos/:publicId]', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao carregar vídeo.');
    }
  });

  app.get('/api/partners/my-submissions', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidRequired(req);
    if (!uid) {
      res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const st = await buildPartnersStatePayload({
        optionalUserId: uid,
        query: {}
      });
      res.json({
        ok: true,
        mySubmissions: st.mySubmissions ?? [],
        auth: st.auth
      });
    } catch (e) {
      console.error('[GET /api/partners/my-submissions]', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao carregar envios.');
    }
  });

  app.post(
    '/api/partners/videos/submit',
    partnersSubmitLimiter,
    authenticateToken,
    async (req: Request, res: Response) => {
      const uid = uidRequired(req);
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
        res.status(201).json({ ok: true, publicId: id, id, status: 'pending' });
      } catch (e) {
        if (e instanceof PartnerYoutubeSubmitError) {
          const code = e.code;
          const payload: Record<string, unknown> = { error: e.message };
          if (code) payload.code = code;
          res.status(e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400).json(payload);
          return;
        }
        console.error('[POST /api/partners/videos/submit]', e);
        sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao guardar envio.');
      }
    }
  );

  app.post(
    '/api/partners/youtube/apply',
    partnersApplyLimiter,
    authenticateToken,
    async (req: Request, res: Response) => {
      const uid = uidRequired(req);
      if (!uid) {
        res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
        return;
      }
      const body = (req.body || {}) as Record<string, unknown>;
      try {
        const { id } = await runPartnerYoutubeApplicationSubmit({
          userId: uid,
          channelNameRaw: body.channelName,
          channelUrlRaw: body.channelUrl,
          avatarUrlRaw: body.avatarUrl,
          descriptionRaw: body.description
        });
        try {
          await appendGameActivityLog(null, uid, 'partner_youtube_apply', { applicationId: id });
        } catch {
          /* ignore */
        }
        res.status(201).json({ ok: true, id, status: 'pending' });
      } catch (e) {
        if (e instanceof PartnerYoutubeApplyError) {
          const payload: Record<string, unknown> = { error: e.message };
          if (e.code) payload.code = e.code;
          res.status(e.statusCode).json(payload);
          return;
        }
        console.error('[POST /api/partners/youtube/apply]', e);
        sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao enviar candidatura.');
      }
    }
  );

  app.post(
    '/api/partners/youtube/avatar-upload',
    authenticateToken,
    (req, res, next) => {
      uploadPartnerAvatar.single('avatar')(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : 'Upload inválido.' });
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const uid = uidRequired(req);
      if (!uid) {
        res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
        return;
      }
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Ficheiro em falta.', code: 'VALIDATION' });
        return;
      }
      const publicPath = `/img/partner-avatars/${file.filename}`;
      res.json({ ok: true, avatarUrl: publicPath });
    }
  );

  app.put('/api/partners/youtube/my-profile', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidRequired(req);
    if (!uid) {
      res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    try {
      const out = await runPartnerYoutubeProfileUpdate({
        userId: uid,
        channelNameRaw: body.channelName,
        avatarUrlRaw: body.avatarUrl
      });
      res.json({ ok: true, ...out });
    } catch (e) {
      if (e instanceof PartnerYoutubeProfileError) {
        const payload: Record<string, unknown> = { error: e.message };
        if (e.code) payload.code = e.code;
        res.status(e.statusCode).json(payload);
        return;
      }
      console.error('[PUT /api/partners/youtube/my-profile]', e);
      sendInternalErrorSafeMessageOrPrisma(res, req.originalUrl || 'api', e, 'Erro ao guardar perfil.');
    }
  });
}
