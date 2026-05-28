/**
 * Integração ZERads PTC (Site ID 11294).
 *
 * Rotas:
 *   GET/POST /zeradsptc.php        — callback público do servidor ZERads (~5 min)
 *   GET      /api/zerads/me/token  — gera/retorna token opaco do user autenticado
 *   GET      /api/zerads/me/stats  — totais + últimos callbacks do user autenticado
 *
 * Segurança do callback público:
 *   1) `pwd` deve bater com ZERADS_CALLBACK_PASSWORD (timingSafeEqual).
 *   2) IP de origem ∈ ZERADS_ALLOWED_IPS. IP é resolvido pelo CF-Connecting-IP
 *      (genesisdao.tech está atrás de Cloudflare → Nginx → Node). Como segunda
 *      checagem usamos também req.ip (já filtrado pelo trust proxy).
 *   3) `user` é um token opaco de 32–64 hex que mapeia para users.id.
 *
 * Cada callback bem-sucedido:
 *   - converte ZER em USDC pela taxa fixa de .env (ZERADS_ZER_TO_USDC)
 *   - faz split 80/20 (ZERADS_USER_SPLIT) — só o user é creditado em
 *     game_states.usdc; a parte da plataforma é apenas anotada no ledger
 *   - é idempotente por bucket de 5 min (ZERads pode retransmitir)
 *   - é sempre registado em zerads_callback_log (sucesso ou falha)
 */

import crypto from 'node:crypto';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/prisma.js';
import { normalizeClientIp } from '../utils/clientIp.js';
import { sendInternalErrorSafeMessageOrPrisma } from '../utils/apiErrorResponse.js';

type AppendGameActivityLog = (
  _q: unknown,
  userId: number,
  action: string,
  meta: Record<string, unknown>
) => Promise<void>;

export type ZeradsCallbackDeps = {
  authenticateToken: RequestHandler;
  appendGameActivityLog: AppendGameActivityLog;
  db: Pool;
};

const TOKEN_REGEX = /^[a-f0-9]{32,64}$/i;
const RAW_USER_MAX = 120;
const BUCKET_MS = 5 * 60 * 1000; // 5 min — janela de idempotência

function readEnvFloat(key: string, fallback: number): number {
  const v = parseFloat(String(process.env[key] ?? ''));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function readAllowedIps(): Set<string> {
  const raw = String(process.env.ZERADS_ALLOWED_IPS ?? '').trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => normalizeClientIp(s))
      .filter((s): s is string => !!s)
  );
}

function timingSafeStringEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function pickFromQueryOrBody(req: Request, key: string): string | undefined {
  const q = (req.query as Record<string, unknown>)[key];
  if (typeof q === 'string') return q;
  const b = (req.body as Record<string, unknown> | undefined)?.[key];
  if (typeof b === 'string') return b;
  return undefined;
}

function resolveCallbackIps(req: Request): { cfIp: string | null; reqIp: string | null } {
  const headerCf = req.headers['cf-connecting-ip'];
  const cfRaw = Array.isArray(headerCf) ? headerCf[0] : headerCf;
  return {
    cfIp: normalizeClientIp(cfRaw ?? null),
    reqIp: normalizeClientIp(req.ip ?? null)
  };
}

async function insertCallbackLog(row: {
  user_id: number | null;
  raw_user: string | null;
  amount_zer: number | null;
  clicks: number | null;
  cf_ip: string | null;
  req_ip: string | null;
  status: string;
  message: string | null;
}): Promise<void> {
  try {
    await prisma.zerads_callback_log.create({
      data: {
        user_id: row.user_id,
        raw_user: row.raw_user,
        amount_zer: row.amount_zer,
        clicks: row.clicks,
        cf_ip: row.cf_ip,
        req_ip: row.req_ip,
        status: row.status,
        message: row.message,
        created_at: BigInt(Date.now())
      }
    });
  } catch (err) {
    console.error('[ZERads] failed to write callback log:', err);
  }
}

function buildIdempotencyKey(userId: number, amountZer: number, clicks: number, nowMs: number): string {
  const bucket = Math.floor(nowMs / BUCKET_MS);
  const sig = crypto
    .createHash('sha1')
    .update(`${amountZer.toFixed(8)}|${clicks}`)
    .digest('hex')
    .slice(0, 16);
  return `${userId}:${bucket}:${sig}`;
}

async function ensureUserToken(userId: number): Promise<string> {
  const existing = await prisma.zerads_user_tokens.findUnique({ where: { user_id: userId } });
  if (existing) return existing.token;
  // 32 bytes hex (64 chars) — colide praticamente nunca
  const token = crypto.randomBytes(32).toString('hex');
  try {
    const created = await prisma.zerads_user_tokens.create({
      data: { user_id: userId, token, created_at: BigInt(Date.now()) }
    });
    return created.token;
  } catch {
    // condição de corrida: outro request criou o token
    const row = await prisma.zerads_user_tokens.findUnique({ where: { user_id: userId } });
    if (row) return row.token;
    throw new Error('Falha a gerar token ZERads.');
  }
}

export function registerZeradsCallbackRoutes(app: Express, deps: ZeradsCallbackDeps): void {
  const { authenticateToken, appendGameActivityLog } = deps;

  // Rate limit do callback público — ZERads chama ~1× a cada 5 min por user,
  // 60/min permite retries + múltiplos users em paralelo sem soltar 429.
  const callbackLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limited.' }
  });

  // Rate limit do endpoint de token (por user autenticado)
  const tokenLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados pedidos. Aguarda 1 minuto.' }
  });

  async function handleZeradsCallback(req: Request, res: Response): Promise<void> {
    const { cfIp, reqIp } = resolveCallbackIps(req);
    const rawUser = pickFromQueryOrBody(req, 'user')?.slice(0, RAW_USER_MAX) ?? null;
    const rawAmount = pickFromQueryOrBody(req, 'amount') ?? '';
    const rawClicks = pickFromQueryOrBody(req, 'clicks') ?? '';
    const rawPwd = pickFromQueryOrBody(req, 'pwd') ?? '';

    const amountZer = parseFloat(rawAmount);
    const clicks = parseInt(rawClicks, 10);

    // 1) senha
    const expected = String(process.env.ZERADS_CALLBACK_PASSWORD ?? '');
    if (!expected || !timingSafeStringEq(rawPwd, expected)) {
      await insertCallbackLog({
        user_id: null,
        raw_user: rawUser,
        amount_zer: Number.isFinite(amountZer) ? amountZer : null,
        clicks: Number.isFinite(clicks) ? clicks : null,
        cf_ip: cfIp,
        req_ip: reqIp,
        status: 'bad_pwd',
        message: null
      });
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }

    // 2) whitelist de IP (CF-Connecting-IP é a fonte canónica; fallback req.ip)
    const allowed = readAllowedIps();
    const requireCf = String(process.env.ZERADS_REQUIRE_CF ?? '1') !== '0';
    if (allowed.size > 0) {
      const candidates = [cfIp, reqIp].filter((v): v is string => !!v);
      const matched = candidates.some((ip) => allowed.has(ip));
      const cfMissing = requireCf && !cfIp;
      if (!matched || cfMissing) {
        await insertCallbackLog({
          user_id: null,
          raw_user: rawUser,
          amount_zer: Number.isFinite(amountZer) ? amountZer : null,
          clicks: Number.isFinite(clicks) ? clicks : null,
          cf_ip: cfIp,
          req_ip: reqIp,
          status: 'bad_ip',
          message: cfMissing ? 'cf-connecting-ip missing' : 'ip not in whitelist'
        });
        res.status(403).json({ ok: false, error: 'forbidden' });
        return;
      }
    }

    // 3) payload
    if (!rawUser || !TOKEN_REGEX.test(rawUser)) {
      await insertCallbackLog({
        user_id: null,
        raw_user: rawUser,
        amount_zer: Number.isFinite(amountZer) ? amountZer : null,
        clicks: Number.isFinite(clicks) ? clicks : null,
        cf_ip: cfIp,
        req_ip: reqIp,
        status: 'bad_payload',
        message: 'invalid token format'
      });
      res.status(400).json({ ok: false, error: 'bad_user' });
      return;
    }
    if (!Number.isFinite(amountZer) || amountZer < 0) {
      await insertCallbackLog({
        user_id: null,
        raw_user: rawUser,
        amount_zer: null,
        clicks: Number.isFinite(clicks) ? clicks : null,
        cf_ip: cfIp,
        req_ip: reqIp,
        status: 'bad_payload',
        message: 'invalid amount'
      });
      res.status(400).json({ ok: false, error: 'bad_amount' });
      return;
    }
    const safeClicks = Number.isFinite(clicks) && clicks >= 0 ? Math.floor(clicks) : 0;

    // 4) resolver token → user_id
    const tokenRow = await prisma.zerads_user_tokens.findUnique({ where: { token: rawUser } });
    if (!tokenRow) {
      await insertCallbackLog({
        user_id: null,
        raw_user: rawUser,
        amount_zer: amountZer,
        clicks: safeClicks,
        cf_ip: cfIp,
        req_ip: reqIp,
        status: 'unknown_user',
        message: null
      });
      // resposta 200 para não dar pistas a scanners; ZERads não interpreta o body
      res.status(200).json({ ok: false, error: 'unknown_user' });
      return;
    }
    const userId = tokenRow.user_id;

    // 5) split + conversão
    const rate = readEnvFloat('ZERADS_ZER_TO_USDC', 0.013);
    const userSplit = Math.min(1, Math.max(0, readEnvFloat('ZERADS_USER_SPLIT', 0.8)));
    const totalUsdc = amountZer * rate;
    const userUsdc = totalUsdc * userSplit;
    const platformUsdc = totalUsdc - userUsdc;

    // 6) idempotência + crédito atómico
    const idempotencyKey = buildIdempotencyKey(userId, amountZer, safeClicks, Date.now());

    try {
      // Quando amount=0 (ZERads chama com 0 só para sinalizar clicks),
      // não há crédito; ainda assim queremos guardar o ledger para estatística.
      await prisma.$transaction(async (tx) => {
        // ledger insere primeiro — se duplicar, throw e abortamos o crédito
        await tx.zerads_earnings_ledger.create({
          data: {
            idempotency_key: idempotencyKey,
            user_id: userId,
            amount_zer: amountZer,
            amount_usdc_total: totalUsdc,
            user_amount_usdc: userUsdc,
            platform_amount_usdc: platformUsdc,
            clicks: safeClicks,
            zer_to_usdc_rate: rate,
            created_at: BigInt(Date.now())
          }
        });
        if (userUsdc > 0) {
          // game_states.usdc é Float — crédito incremental por SQL para evitar lost-update.
          await tx.$executeRaw`UPDATE game_states SET usdc = usdc + ${userUsdc} WHERE user_id = ${userId}`;
        }
      });
    } catch (err) {
      const code = (err && typeof err === 'object' && 'code' in err)
        ? (err as { code?: string }).code
        : null;
      // P2002 = unique violation (idempotência)
      if (code === 'P2002') {
        await insertCallbackLog({
          user_id: userId,
          raw_user: rawUser,
          amount_zer: amountZer,
          clicks: safeClicks,
          cf_ip: cfIp,
          req_ip: reqIp,
          status: 'dup',
          message: idempotencyKey
        });
        res.status(200).json({ ok: true, dup: true });
        return;
      }
      console.error('[ZERads] credit failed:', err);
      await insertCallbackLog({
        user_id: userId,
        raw_user: rawUser,
        amount_zer: amountZer,
        clicks: safeClicks,
        cf_ip: cfIp,
        req_ip: reqIp,
        status: 'error',
        message: err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400)
      });
      sendInternalErrorSafeMessageOrPrisma(res, '[ZERads] credit', err, 'Erro interno ZERads.');
      return;
    }

    // 7) log de sucesso (best-effort, fora da transação)
    await insertCallbackLog({
      user_id: userId,
      raw_user: rawUser,
      amount_zer: amountZer,
      clicks: safeClicks,
      cf_ip: cfIp,
      req_ip: reqIp,
      status: 'ok',
      message: null
    });

    try {
      await appendGameActivityLog(null, userId, 'zerads_credit', {
        amount_zer: amountZer,
        amount_usdc: userUsdc,
        platform_usdc: platformUsdc,
        clicks: safeClicks,
        rate
      });
    } catch (logErr) {
      console.warn('[ZERads] appendGameActivityLog:', logErr);
    }

    res.status(200).json({ ok: true, credited_usdc: userUsdc, clicks: safeClicks });
  }

  app.get('/zeradsptc.php', callbackLimiter, handleZeradsCallback);
  app.post('/zeradsptc.php', callbackLimiter, handleZeradsCallback);

  // -------- endpoints autenticados pro frontend --------

  function uidNum(req: Request): number | null {
    const v = req.userId as unknown;
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  app.get('/api/zerads/me/token', tokenLimiter, authenticateToken, async (req: Request, res: Response) => {
    const uid = uidNum(req);
    if (uid == null) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    try {
      const token = await ensureUserToken(uid);
      const refId = String(process.env.ZERADS_REF_ID ?? '11294');
      res.json({
        token,
        ptc_url: `https://zerads.com/ptc.php?ref=${encodeURIComponent(refId)}&user=${encodeURIComponent(token)}`
      });
    } catch (err) {
      sendInternalErrorSafeMessageOrPrisma(res, '[ZERads] token', err, 'Erro interno ZERads.');
    }
  });

  app.get('/api/zerads/me/stats', authenticateToken, async (req: Request, res: Response) => {
    const uid = uidNum(req);
    if (uid == null) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    try {
      const [agg, recent] = await Promise.all([
        prisma.zerads_earnings_ledger.aggregate({
          where: { user_id: uid },
          _sum: { amount_zer: true, user_amount_usdc: true, platform_amount_usdc: true, clicks: true },
          _count: { _all: true }
        }),
        prisma.zerads_earnings_ledger.findMany({
          where: { user_id: uid },
          orderBy: { created_at: 'desc' },
          take: 30,
          select: {
            amount_zer: true,
            user_amount_usdc: true,
            clicks: true,
            zer_to_usdc_rate: true,
            created_at: true
          }
        })
      ]);

      res.json({
        totals: {
          callbacks: agg._count._all,
          amount_zer: agg._sum.amount_zer ?? 0,
          user_amount_usdc: agg._sum.user_amount_usdc ?? 0,
          platform_amount_usdc: agg._sum.platform_amount_usdc ?? 0,
          clicks: agg._sum.clicks ?? 0
        },
        recent: recent.map((r) => ({
          amount_zer: r.amount_zer,
          user_amount_usdc: r.user_amount_usdc,
          clicks: r.clicks,
          zer_to_usdc_rate: r.zer_to_usdc_rate,
          created_at: Number(r.created_at)
        }))
      });
    } catch (err) {
      sendInternalErrorSafeMessageOrPrisma(res, '[ZERads] stats', err, 'Erro interno ZERads.');
    }
  });
}
