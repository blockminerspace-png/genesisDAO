import type { Pool } from 'pg';
import { computePlayerGameHeaderSnapshot } from '../../../lib/playerGameHeaderSnapshot.js';
import { DISPOSABLE_EMAIL_DOMAINS } from './disposableEmailDomains.js';
import {
  detectSuspiciousEmail,
  getEmailDomain,
  FAKE_EXACT_EMAILS_LIST,
  TRUSTED_EMAIL_DOMAINS,
  type SuspiciousEmailReasonCode,
} from './suspiciousEmailDetect.js';
import { calculateUserSuspicionScore, type RiskLevel } from './suspicionScore.js';
import {
  mergeEmailAndActivityReasons,
  type UserActivitySignals,
} from './suspiciousUserSignals.js';

export type SuspiciousEmailsListQuery = {
  q?: string;
  reason?: string;
  status?: string;
  domain?: string;
  /** Filtro de actividade: all | never_mined | no_wallet | no_deposit | no_recent_login | referral_entry */
  activity?: string;
  page?: number;
  limit?: number;
  sort?: string;
};

export type SuspiciousEmailReferrer = {
  id: number | null;
  username: string | null;
  email: string | null;
};

export type SuspiciousEmailUserRow = {
  id: number;
  username: string;
  email: string;
  emailDomain: string | null;
  status: 'active' | 'blocked';
  accessLevel: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  emailVerified: boolean | null;
  walletAddress: string | null;
  totalHash: number;
  /** Soma dos saldos em `coin_balances` (unidades de moeda na BD; não é USD oráculo). */
  totalMinedUsd: number;
  totalDepositedUsdc: number;
  hasMinedFlag: boolean;
  referrer: SuspiciousEmailReferrer | null;
  riskScore: number;
  riskLevel: RiskLevel;
  reasons: SuspiciousEmailReasonCode[];
};

export type SuspiciousEmailsReport = {
  ok: true;
  summary: {
    totalSuspicious: number;
    domainNotTrusted: number;
    invalidFormat: number;
    temporaryDomains: number;
    fakePatterns: number;
    duplicates: number;
    unverified: number;
    suspiciousDomain: number;
    deadAccounts: number;
    referralOnly: number;
    highRisk: number;
  };
  trustedDomains: readonly string[];
  domainStats: Array<{ domain: string; count: number; reason: SuspiciousEmailReasonCode | 'high_volume' }>;
  users: SuspiciousEmailUserRow[];
  pagination: { page: number; limit: number; total: number };
  meta?: { note?: string; unverifiedEmailSupported?: boolean };
};

const MAX_LIMIT = 100;
const MAX_EXPORT = 5000;
const Q_MAX_LEN = 200;

const REASON_FILTERS = new Set<string>([
  'all',
  'domain_not_trusted',
  'invalid_format',
  'temporary_domain',
  'fake_pattern',
  'duplicate_email',
  'unverified_email',
  'suspicious_domain',
  'specific_domain',
  'dead_account',
  'referral_only',
  'never_mined',
  'no_wallet',
  'no_deposit',
  'no_recent_login',
  'high_risk',
]);

const ACTIVITY_FILTERS = new Set(['all', 'never_mined', 'no_wallet', 'no_deposit', 'no_recent_login', 'referral_entry']);

function clampInt(n: unknown, def: number, min: number, max: number): number {
  const x = parseInt(String(n ?? ''), 10);
  if (!Number.isFinite(x)) return def;
  return Math.min(max, Math.max(min, x));
}

function sanitizeQ(raw: unknown): string {
  const s = String(raw ?? '').trim().slice(0, Q_MAX_LEN);
  if (!s) return '';
  return s.replace(/\0/g, '');
}

type DbUserRow = {
  id: number;
  username: string;
  email: string;
  referred_by: string | null;
  is_blocked: number | null;
  last_active_at: string | number | null;
  polygon_wallet: string | null;
  access_level_id: string | null;
  access_level_name: string | null;
  gs_last_updated: string | number | null;
  gs_start_time: string | number | null;
  referrer_id: number | null;
  referrer_username: string | null;
  referrer_email: string | null;
  coin_balance_sum: string | number | null;
  rack_count: string | number | null;
  racks_mining_on: string | number | null;
  has_stock: boolean | null;
  total_usdc_deposited: string | number | null;
  last_checkin_at_ms: string | number | null;
};

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function lastLoginMs(r: DbUserRow): number | null {
  const la = r.last_active_at != null ? Number(r.last_active_at) : NaN;
  const gs = r.gs_last_updated != null ? Number(r.gs_last_updated) : NaN;
  const candidates = [la, gs].filter((x) => Number.isFinite(x) && x > 0);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function createdAtIso(r: DbUserRow): string | null {
  const st = r.gs_start_time != null ? Number(r.gs_start_time) : NaN;
  if (Number.isFinite(st) && st > 0) return new Date(st).toISOString();
  return null;
}

function sortCreatedMs(r: DbUserRow): number {
  const st = r.gs_start_time != null ? Number(r.gs_start_time) : NaN;
  if (Number.isFinite(st) && st > 0) return st;
  return r.id;
}

function rowToSignals(r: DbUserRow): UserActivitySignals {
  const st = r.gs_start_time != null ? Number(r.gs_start_time) : NaN;
  return {
    coinBalanceSum: num(r.coin_balance_sum),
    racksMiningOn: Math.floor(num(r.racks_mining_on)),
    rackCount: Math.floor(num(r.rack_count)),
    hasStock: !!r.has_stock,
    totalUsdcDeposited: num(r.total_usdc_deposited),
    hasWallet: !!(r.polygon_wallet && String(r.polygon_wallet).trim()),
    referredBy: r.referred_by,
    lastLoginMs: lastLoginMs(r),
    accountStartMs: Number.isFinite(st) && st > 0 ? st : null,
    lastCheckinMs: r.last_checkin_at_ms != null ? Number(r.last_checkin_at_ms) : null,
  };
}

const userSelectSql = `
      u.id,
      u.username,
      u.email,
      u.referred_by,
      u.is_blocked,
      u.last_active_at,
      u.polygon_wallet,
      u.access_level_id,
      al.name AS access_level_name,
      gs.last_updated_at AS gs_last_updated,
      gs.start_time AS gs_start_time,
      gs.total_usdc_deposited,
      gs.last_checkin_at_ms,
      ref.id AS referrer_id,
      ref.username AS referrer_username,
      ref.email AS referrer_email,
      COALESCE((
        SELECT SUM(cb.amount)::float FROM coin_balances cb WHERE cb.user_id = u.id
      ), 0) AS coin_balance_sum,
      COALESCE((SELECT COUNT(*)::int FROM placed_racks pr WHERE pr.user_id = u.id), 0) AS rack_count,
      COALESCE((
        SELECT COUNT(*)::int FROM placed_racks pr
        WHERE pr.user_id = u.id AND pr.is_on = 1
          AND trim(coalesce(pr.wiring_id, '')) <> ''
          AND trim(coalesce(pr.battery_id, '')) <> ''
          AND trim(coalesce(pr.selected_coin_id, '')) <> ''
      ), 0) AS racks_mining_on,
      EXISTS (
        SELECT 1 FROM stock s WHERE s.user_id = u.id AND s.qty > 0
      ) AS has_stock
`;

const userJoinSql = `
    FROM users u
    LEFT JOIN access_levels al ON al.id = u.access_level_id
    LEFT JOIN game_states gs ON gs.user_id = u.id
    LEFT JOIN users ref ON ref.username = u.referred_by AND u.referred_by IS NOT NULL AND trim(u.referred_by) <> ''
`;

export function buildSuspiciousEmailsCsv(users: SuspiciousEmailUserRow[]): string {
  const headers = [
    'id',
    'username',
    'email',
    'emailDomain',
    'riskScore',
    'riskLevel',
    'status',
    'accessLevel',
    'createdAt',
    'lastLoginAt',
    'walletAddress',
    'emailVerified',
    'totalHash',
    'totalMinedCoinSum',
    'totalDepositedUsdc',
    'hasMinedFlag',
    'referrerUsername',
    'referrerEmail',
    'reasons',
  ];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];
  for (const u of users) {
    const row = [
      String(u.id),
      esc(String(u.username ?? '')),
      esc(String(u.email ?? '')),
      esc(String(u.emailDomain ?? '')),
      String(u.riskScore),
      u.riskLevel,
      u.status,
      esc(String(u.accessLevel ?? '')),
      esc(String(u.createdAt ?? '')),
      esc(u.lastLoginAt ?? ''),
      esc(String(u.walletAddress ?? '')),
      u.emailVerified == null ? '' : u.emailVerified ? 'true' : 'false',
      String(u.totalHash),
      String(u.totalMinedUsd),
      String(u.totalDepositedUsdc),
      u.hasMinedFlag ? 'true' : 'false',
      esc(String(u.referrer?.username ?? '')),
      esc(String(u.referrer?.email ?? '')),
      esc((u.reasons || []).join('|')),
    ];
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

type Internal = {
  _db: DbUserRow;
  emailReasons: SuspiciousEmailReasonCode[];
  sig: UserActivitySignals;
  id: number;
  username: string;
  email: string;
  status: 'active' | 'blocked';
  accessLevel: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  walletAddress: string | null;
  emailVerified: boolean | null;
  reasons: SuspiciousEmailReasonCode[];
  riskScore: number;
  riskLevel: RiskLevel;
  coinBalanceSum: number;
  totalDepositedUsdc: number;
  referrer: SuspiciousEmailReferrer | null;
};

function internalToPublic(i: Internal, totalHash: number, reasons: SuspiciousEmailReasonCode[]): SuspiciousEmailUserRow {
  const { score, riskLevel } = calculateUserSuspicionScore(reasons);
  const dom = getEmailDomain(i.email);
  const mined = totalHash > 1e-10 || i.coinBalanceSum > 1e-8 || i.sig.racksMiningOn > 0;
  return {
    id: i.id,
    username: i.username,
    email: i.email,
    emailDomain: dom,
    status: i.status,
    accessLevel: i.accessLevel,
    createdAt: i.createdAt,
    lastLoginAt: i.lastLoginAt,
    emailVerified: i.emailVerified,
    walletAddress: i.walletAddress,
    totalHash,
    totalMinedUsd: i.coinBalanceSum,
    totalDepositedUsdc: i.totalDepositedUsdc,
    hasMinedFlag: mined,
    referrer: i.referrer,
    riskScore: score,
    riskLevel,
    reasons,
  };
}

export async function fetchSuspiciousEmailsReport(
  db: Pool,
  query: SuspiciousEmailsListQuery,
  opts?: { exportMode?: boolean }
): Promise<SuspiciousEmailsReport> {
  const exportMode = !!opts?.exportMode;
  const page = clampInt(query.page, 1, 1, 1_000_000);
  const cap = exportMode ? MAX_EXPORT : MAX_LIMIT;
  const defaultLimit = exportMode ? MAX_EXPORT : 50;
  const limit = clampInt(query.limit, defaultLimit, 1, cap);
  const reason = REASON_FILTERS.has(String(query.reason || '').trim())
    ? String(query.reason || 'all').trim()
    : 'all';
  const activity = ACTIVITY_FILTERS.has(String(query.activity || '').trim().toLowerCase())
    ? String(query.activity || 'all').trim().toLowerCase()
    : 'all';
  const status = String(query.status || 'all').trim().toLowerCase();
  const sort = String(query.sort || 'created_desc').trim().toLowerCase();
  const q = sanitizeQ(query.q);
  const specificDomain = String(query.domain || '')
    .trim()
    .toLowerCase()
    .slice(0, 200)
    .replace(/\0/g, '');

  const trusted = [...TRUSTED_EMAIL_DOMAINS].map((d) => d.toLowerCase());
  const trustedSet = new Set(trusted);
  const disposables = DISPOSABLE_EMAIL_DOMAINS.map((d) => d.toLowerCase());
  const fakeExact = [...FAKE_EXACT_EMAILS_LIST];

  const dupRes = await db.query<{ em: string }>(
    `
    SELECT lower(trim(email)) AS em
    FROM users
    GROUP BY 1
    HAVING count(*) > 1
    `
  );
  const duplicateSet = new Set(dupRes.rows.map((r) => r.em).filter(Boolean));

  const domainCountRes = await db.query<{ d: string; c: string }>(
    `
    SELECT lower(trim(split_part(trim(email), '@', 2))) AS d, count(*)::text AS c
    FROM users
    WHERE position('@' in trim(email)) > 0
    GROUP BY 1
    `
  );
  const domainTotalCounts = new Map<string, number>();
  for (const row of domainCountRes.rows) {
    if (row.d) domainTotalCounts.set(row.d, parseInt(row.c, 10) || 0);
  }

  const ctxEmail = {
    duplicateNormalizedEmails: duplicateSet,
    domainTotalCounts,
    highVolumeDomainThreshold: 8,
    emailVerified: null as boolean | null,
    trustedDomains: trustedSet,
  };

  let candidates: DbUserRow[];

  if (reason === 'specific_domain' && specificDomain) {
    const { rows } = await db.query<DbUserRow>(
      `
      SELECT ${userSelectSql}
      ${userJoinSql}
      WHERE lower(trim(split_part(trim(u.email), '@', 2))) = $1
      `,
      [specificDomain]
    );
    candidates = rows;
  } else {
    const candidateSql = `
    WITH dup AS (
      SELECT lower(trim(email)) AS em
      FROM users
      GROUP BY 1
      HAVING count(*) > 1
    )
    SELECT ${userSelectSql}
    ${userJoinSql}
    LEFT JOIN dup ON dup.em = lower(trim(u.email))
    WHERE
      dup.em IS NOT NULL
      OR coalesce(trim(u.email), '') = ''
      OR u.email ~ '[[:space:]]'
      OR (length(u.email) - length(replace(u.email, '@', ''))) <> 1
      OR split_part(trim(u.email), '@', 1) = ''
      OR split_part(trim(u.email), '@', 2) = ''
      OR position('.' in split_part(trim(u.email), '@', 2)) = 0
      OR lower(split_part(trim(u.email), '@', 2)) = ANY($1::text[])
      OR lower(trim(u.email)) = ANY($2::text[])
      OR lower(trim(u.email)) LIKE '%@example.com'
      OR lower(trim(u.email)) LIKE '%@example.org'
      OR lower(trim(u.email)) LIKE '%@example.net'
      OR lower(split_part(trim(u.email), '@', 1)) IN ('no-reply','noreply','mailer-daemon','postmaster','donotreply','do-not-reply')
      OR char_length(lower(split_part(trim(u.email), '@', 2))) >= 32
      OR (
        char_length(regexp_replace(lower(split_part(trim(u.email), '@', 2)), '[^0-9]', '', 'g')) >= 5
        AND char_length(lower(split_part(trim(u.email), '@', 2))) <= 18
      )
      OR (
        position('@' in trim(u.email)) > 0
        AND (length(u.email) - length(replace(u.email, '@', ''))) = 1
        AND position('.' in split_part(trim(lower(u.email)), '@', 2)) > 0
        AND split_part(trim(lower(u.email)), '@', 2) <> ALL($3::text[])
      )
      OR (
        COALESCE((SELECT SUM(cb.amount) FROM coin_balances cb WHERE cb.user_id = u.id), 0) < 0.00000001
        AND COALESCE(gs.total_usdc_deposited, 0) < 0.000001
        AND (u.polygon_wallet IS NULL OR trim(u.polygon_wallet) = '')
        AND NOT EXISTS (
          SELECT 1 FROM placed_racks pr
          WHERE pr.user_id = u.id AND pr.is_on = 1
            AND trim(coalesce(pr.wiring_id, '')) <> ''
            AND trim(coalesce(pr.battery_id, '')) <> ''
            AND trim(coalesce(pr.selected_coin_id, '')) <> ''
        )
      )
  `;
    const { rows } = await db.query<DbUserRow>(candidateSql, [disposables, fakeExact, trusted]);
    candidates = rows;
  }

  const enriched: Internal[] = [];

  for (const r of candidates) {
    const emailReasons = detectSuspiciousEmail(r.email, ctxEmail);
    const sig = rowToSignals(r);
    const reasons = mergeEmailAndActivityReasons(emailReasons, sig, null);
    if (reason === 'specific_domain' && specificDomain) {
      /* manter linhas do domínio mesmo sem motivos */
    } else if (reasons.length === 0) {
      continue;
    }

    const blocked = !!(r.is_blocked && Number(r.is_blocked) !== 0);
    const st: 'active' | 'blocked' = blocked ? 'blocked' : 'active';
    const lastMs = lastLoginMs(r);
    const refUser = (r.referred_by || '').trim()
      ? {
          id: r.referrer_id != null && Number.isFinite(Number(r.referrer_id)) ? Number(r.referrer_id) : null,
          username: r.referrer_username ?? null,
          email: r.referrer_email ?? null,
        }
      : null;

    const { score, riskLevel } = calculateUserSuspicionScore(reasons);

    enriched.push({
      _db: r,
      emailReasons,
      sig,
      id: r.id,
      username: r.username,
      email: r.email,
      status: st,
      accessLevel: r.access_level_name ?? r.access_level_id ?? null,
      createdAt: createdAtIso(r),
      lastLoginAt: lastMs != null ? new Date(lastMs).toISOString() : null,
      walletAddress: r.polygon_wallet && String(r.polygon_wallet).trim() ? String(r.polygon_wallet).trim() : null,
      emailVerified: null,
      reasons,
      riskScore: score,
      riskLevel,
      coinBalanceSum: num(r.coin_balance_sum),
      totalDepositedUsdc: num(r.total_usdc_deposited),
      referrer: refUser,
    });
  }

  let working = [...enriched];

  if (reason === 'specific_domain') {
    if (!specificDomain) working = [];
    else working = working.filter((u) => getEmailDomain(u.email) === specificDomain);
  } else if (reason === 'unverified_email') {
    working = working.filter((u) => u.reasons.includes('unverified_email'));
  } else if (reason === 'high_risk') {
    working = working.filter((u) => u.riskLevel === 'high');
  } else if (reason === 'no_recent_login') {
    const now = Date.now();
    const ms = 30 * 24 * 60 * 60 * 1000;
    working = working.filter((u) => {
      const lm = lastLoginMs(u._db);
      return lm == null || now - lm > ms;
    });
  } else if (reason !== 'all') {
    working = working.filter((u) => u.reasons.includes(reason as SuspiciousEmailReasonCode));
  }

  if (activity === 'never_mined') {
    working = working.filter((u) => u.reasons.includes('never_mined'));
  } else if (activity === 'no_wallet') {
    working = working.filter((u) => u.reasons.includes('no_wallet'));
  } else if (activity === 'no_deposit') {
    working = working.filter((u) => u.reasons.includes('no_deposit'));
  } else if (activity === 'no_recent_login') {
    const now = Date.now();
    const ms = 30 * 24 * 60 * 60 * 1000;
    working = working.filter((u) => {
      const lm = lastLoginMs(u._db);
      return lm == null || now - lm > ms;
    });
  } else if (activity === 'referral_entry') {
    working = working.filter((u) => !!(u._db.referred_by && String(u._db.referred_by).trim()));
  }

  if (status === 'active') {
    working = working.filter((u) => u.status === 'active');
  } else if (status === 'blocked' || status === 'suspended') {
    working = working.filter((u) => u.status === 'blocked');
  }

  if (q) {
    const ql = q.toLowerCase();
    const qId = parseInt(q, 10);
    working = working.filter((u) => {
      const em = (u.email || '').toLowerCase();
      const un = (u.username || '').toLowerCase();
      const dom = getEmailDomain(u.email) || '';
      const refn = (u.referrer?.username || '').toLowerCase();
      const refe = (u.referrer?.email || '').toLowerCase();
      const idMatch = Number.isFinite(qId) && qId > 0 && u.id === qId;
      return idMatch || em.includes(ql) || un.includes(ql) || dom.includes(ql) || refn.includes(ql) || refe.includes(ql);
    });
  }

  const cmpStr = (a: string | null, b: string | null, dir: number) => {
    const sa = (a ?? '').toLowerCase();
    const sb = (b ?? '').toLowerCase();
    if (sa < sb) return -dir;
    if (sa > sb) return dir;
    return 0;
  };

  const sorted = [...working];
  switch (sort) {
    case 'risk_desc':
      sorted.sort((a, b) => b.riskScore - a.riskScore || b.id - a.id);
      break;
    case 'risk_asc':
      sorted.sort((a, b) => a.riskScore - b.riskScore || a.id - b.id);
      break;
    case 'last_login_desc':
      sorted.sort((a, b) => {
        const la = lastLoginMs(a._db) ?? 0;
        const lb = lastLoginMs(b._db) ?? 0;
        return lb - la || b.id - a.id;
      });
      break;
    case 'total_mined_desc':
      sorted.sort((a, b) => b.coinBalanceSum - a.coinBalanceSum || b.id - a.id);
      break;
    case 'total_deposited_desc':
      sorted.sort((a, b) => b.totalDepositedUsdc - a.totalDepositedUsdc || b.id - a.id);
      break;
    case 'created_asc':
      sorted.sort((a, b) => sortCreatedMs(a._db) - sortCreatedMs(b._db) || a.id - b.id);
      break;
    case 'domain_asc':
      sorted.sort((a, b) => {
        const da = getEmailDomain(a.email) || '';
        const db = getEmailDomain(b.email) || '';
        return cmpStr(da, db, 1) || b.id - a.id;
      });
      break;
    case 'domain_desc':
      sorted.sort((a, b) => {
        const da = getEmailDomain(a.email) || '';
        const db = getEmailDomain(b.email) || '';
        return cmpStr(da, db, -1) || b.id - a.id;
      });
      break;
    case 'username_asc':
      sorted.sort((a, b) => cmpStr(a.username, b.username, 1) || b.id - a.id);
      break;
    case 'username_desc':
      sorted.sort((a, b) => cmpStr(a.username, b.username, -1) || b.id - a.id);
      break;
    case 'created_desc':
    default:
      sorted.sort((a, b) => sortCreatedMs(b._db) - sortCreatedMs(a._db) || b.id - a.id);
  }

  const total = sorted.length;
  const offset = (page - 1) * limit;
  const pageInternals = sorted.slice(offset, offset + limit);

  const hashById = new Map<number, number>();
  const CONC = 8;
  for (let i = 0; i < pageInternals.length; i += CONC) {
    const chunk = pageInternals.slice(i, i + CONC);
    await Promise.all(
      chunk.map(async (row) => {
        try {
          const snap = await computePlayerGameHeaderSnapshot(row.id);
          hashById.set(row.id, snap.totalHash);
        } catch {
          hashById.set(row.id, 0);
        }
      })
    );
  }

  const users: SuspiciousEmailUserRow[] = pageInternals.map((row) => {
    const th = hashById.get(row.id) ?? 0;
    const refined = mergeEmailAndActivityReasons(row.emailReasons, row.sig, th);
    const { score, riskLevel } = calculateUserSuspicionScore(refined);
    return internalToPublic({ ...row, reasons: refined, riskScore: score, riskLevel }, th, refined);
  });

  const summary = {
    totalSuspicious: total,
    domainNotTrusted: working.filter((u) => u.reasons.includes('domain_not_trusted')).length,
    invalidFormat: working.filter((u) => u.reasons.includes('invalid_format')).length,
    temporaryDomains: working.filter((u) => u.reasons.includes('temporary_domain')).length,
    fakePatterns: working.filter((u) => u.reasons.includes('fake_pattern')).length,
    duplicates: working.filter((u) => u.reasons.includes('duplicate_email')).length,
    unverified: working.filter((u) => u.reasons.includes('unverified_email')).length,
    suspiciousDomain: working.filter((u) => u.reasons.includes('suspicious_domain')).length,
    deadAccounts: working.filter((u) => u.reasons.includes('dead_account')).length,
    referralOnly: working.filter((u) => u.reasons.includes('referral_only')).length,
    highRisk: working.filter((u) => u.riskLevel === 'high').length,
  };

  const domainAgg = new Map<string, { count: number; reason: SuspiciousEmailReasonCode | 'high_volume' }>();
  for (const u of working) {
    const d = getEmailDomain(u.email);
    if (!d) continue;
    const prev = domainAgg.get(d)?.count ?? 0;
    let tag: SuspiciousEmailReasonCode | 'high_volume' = 'suspicious_domain';
    if (u.reasons.includes('temporary_domain')) tag = 'temporary_domain';
    else if ((domainTotalCounts.get(d) ?? 0) >= 8) tag = 'high_volume';
    domainAgg.set(d, { count: prev + 1, reason: tag });
  }
  const domainStats = [...domainAgg.entries()]
    .filter(([, v]) => v.count >= 3)
    .map(([domain, v]) => ({ domain, count: v.count, reason: v.reason }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 80);

  return {
    ok: true,
    summary,
    trustedDomains: TRUSTED_EMAIL_DOMAINS,
    domainStats,
    users,
    pagination: { page, limit, total },
    meta: {
      unverifiedEmailSupported: false,
      note:
        'totalMinedUsd na API é a soma de `coin_balances.amount` (unidades na BD), não conversão USD. totalHash vem do mesmo cálculo do jogo (última página). email_verified não existe em users.',
    },
  };
}
