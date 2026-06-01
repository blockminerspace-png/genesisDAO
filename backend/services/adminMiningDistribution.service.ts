/**
 * Relatórios admin: distribuição de créditos de mineração (mining_block_history + rollups diários UTC).
 */
import type { Pool } from 'pg';
import { prisma } from '../config/prisma.js';

const MS_PER_DAY = 86400_000;
const MAX_LEDGER_RANGE_MS = 93 * MS_PER_DAY;
const MAX_EXPORT_ROWS = 50_000;
const MAX_LEDGER_LIMIT = 100;

export type DistributionTotals = {
  totalCoins: number;
  totalUsd: number;
  creditRows: number;
  uniqueUsers: number;
};

export type DistributionOverviewPeriod = DistributionTotals & {
  label: string;
  fromMs: number;
  toMs: number;
};

export type DistributionByCoinRow = {
  coinId: string;
  symbol: string;
  name: string;
  totalCoins: number;
  totalUsd: number;
  creditRows: number;
  uniqueUsers: number;
  pctOfTotalUsd: number;
  theoreticalEmissionCoins: number | null;
  emissionUtilizationPct: number | null;
};

export type DistributionTimelineRow = {
  bucketStartMs: number;
  bucketLabel: string;
  totalCoins: number;
  totalUsd: number;
  creditRows: number;
  uniqueUsers: number;
};

export type MiningCreditLedgerRow = {
  id: string;
  userId: number;
  username: string | null;
  email: string | null;
  coinId: string;
  coinSymbol: string | null;
  roomId: string | null;
  windowStartMs: number;
  windowEndMs: number;
  creditBlocks: number;
  amountCoins: number;
  amountUsd: number;
  userHashHps: number;
  networkHashrate: number;
  blockReward: number;
  blockTime: number;
  createdAtMs: number;
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function asNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function parseDistributionDateMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return Date.parse(`${s}T00:00:00.000Z`);
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** Início do dia UTC (ms) para timestamp arbitrário. */
export function utcDayStartMsFromTs(tsMs: number): number {
  const d = new Date(tsMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}

export function utcDayEndMsFromTs(tsMs: number): number {
  const start = utcDayStartMsFromTs(tsMs);
  return start + MS_PER_DAY - 1;
}

function ymdFromUtcMs(tsMs: number): string {
  const d = new Date(tsMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetweenUtc(fromMs: number, toMs: number): number {
  const a = utcDayStartMsFromTs(fromMs);
  const b = utcDayStartMsFromTs(toMs);
  return Math.max(1, Math.round((b - a) / MS_PER_DAY) + 1);
}

async function aggregateFromBlockHistory(
  fromMs: number,
  toMs: number,
  coinId?: string
): Promise<DistributionTotals> {
  const where: string[] = ['h.window_end_ms >= $1', 'h.window_end_ms <= $2'];
  const params: unknown[] = [Math.floor(fromMs), Math.floor(toMs)];
  if (coinId) {
    params.push(coinId);
    where.push(`h.coin_id = $${params.length}`);
  }
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      total_coins: number | string | null;
      total_usd: number | string | null;
      credit_rows: bigint | number | string | null;
      unique_users: bigint | number | string | null;
    }>
  >(
    `SELECT
        COALESCE(SUM(h.amount_coins), 0)::float8 AS total_coins,
        COALESCE(SUM(h.amount_usd), 0)::float8 AS total_usd,
        COUNT(*)::bigint AS credit_rows,
        COUNT(DISTINCT h.user_id)::bigint AS unique_users
      FROM mining_block_history h
      WHERE ${where.join(' AND ')}`,
    ...params
  );
  const r = rows[0];
  return {
    totalCoins: asNum(r?.total_coins),
    totalUsd: asNum(r?.total_usd),
    creditRows: asNum(r?.credit_rows),
    uniqueUsers: asNum(r?.unique_users)
  };
}

/**
 * Reconstrói rollups diários UTC para o intervalo [fromDayYmd, toDayYmd] inclusive.
 */
export async function rebuildMiningDistributionRollups(
  pool: Pool,
  fromDayYmd: string,
  toDayYmd: string
): Promise<{ daysProcessed: number; rowsUpserted: number }> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `INSERT INTO mining_distribution_daily (
          day_utc, coin_id, total_coins, total_usd, credit_rows, unique_users, updated_at
        )
        SELECT
          (to_timestamp(h.window_end_ms / 1000.0) AT TIME ZONE 'UTC')::date AS day_utc,
          h.coin_id,
          COALESCE(SUM(h.amount_coins), 0)::float8,
          COALESCE(SUM(h.amount_usd), 0)::float8,
          COUNT(*)::int,
          COUNT(DISTINCT h.user_id)::int,
          (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
        FROM mining_block_history h
        WHERE (to_timestamp(h.window_end_ms / 1000.0) AT TIME ZONE 'UTC')::date >= $1::date
          AND (to_timestamp(h.window_end_ms / 1000.0) AT TIME ZONE 'UTC')::date <= $2::date
        GROUP BY day_utc, h.coin_id
        ON CONFLICT (day_utc, coin_id) DO UPDATE SET
          total_coins = EXCLUDED.total_coins,
          total_usd = EXCLUDED.total_usd,
          credit_rows = EXCLUDED.credit_rows,
          unique_users = EXCLUDED.unique_users,
          updated_at = EXCLUDED.updated_at`,
      [fromDayYmd, toDayYmd]
    );
    const fromMs = Date.parse(`${fromDayYmd}T00:00:00.000Z`);
    const toMs = Date.parse(`${toDayYmd}T23:59:59.999Z`);
    const daysProcessed =
      Number.isFinite(fromMs) && Number.isFinite(toMs)
        ? Math.max(0, Math.round((utcDayStartMsFromTs(toMs) - utcDayStartMsFromTs(fromMs)) / MS_PER_DAY) + 1)
        : 0;
    return { daysProcessed, rowsUpserted: r.rowCount ?? 0 };
  } finally {
    client.release();
  }
}

/** Últimos N dias UTC (inclui hoje) para rebuild automático. */
export async function rebuildMiningDistributionRollupsRecent(
  pool: Pool,
  daysBack = 45
): Promise<{ daysProcessed: number; rowsUpserted: number }> {
  const now = Date.now();
  const toYmd = ymdFromUtcMs(now);
  const fromMs = utcDayStartMsFromTs(now) - (daysBack - 1) * MS_PER_DAY;
  const fromYmd = ymdFromUtcMs(fromMs);
  return rebuildMiningDistributionRollups(pool, fromYmd, toYmd);
}

export async function getDistributionOverview(
  customFromMs?: number | null,
  customToMs?: number | null
): Promise<{
  generatedAtMs: number;
  timezone: 'UTC';
  periods: {
    today: DistributionOverviewPeriod;
    last7Days: DistributionOverviewPeriod;
    last30Days: DistributionOverviewPeriod;
    custom: DistributionOverviewPeriod | null;
  };
}> {
  const now = Date.now();
  const todayStart = utcDayStartMsFromTs(now);

  const today = await aggregateFromBlockHistory(todayStart, now);
  const last7Start = todayStart - 6 * MS_PER_DAY;
  const last7 = await aggregateFromBlockHistory(last7Start, now);
  const last30Start = todayStart - 29 * MS_PER_DAY;
  const last30 = await aggregateFromBlockHistory(last30Start, now);

  let custom: DistributionOverviewPeriod | null = null;
  if (customFromMs != null && customToMs != null && customToMs >= customFromMs) {
    const totals = await aggregateFromBlockHistory(customFromMs, customToMs);
    custom = {
      label: 'custom',
      fromMs: customFromMs,
      toMs: customToMs,
      ...totals
    };
  }

  return {
    generatedAtMs: now,
    timezone: 'UTC',
    periods: {
      today: { label: 'today', fromMs: todayStart, toMs: now, ...today },
      last7Days: { label: 'last7Days', fromMs: last7Start, toMs: now, ...last7 },
      last30Days: { label: 'last30Days', fromMs: last30Start, toMs: now, ...last30 },
      custom
    }
  };
}

export async function getDistributionByCoin(
  fromMs: number,
  toMs: number
): Promise<{ fromMs: number; toMs: number; rows: DistributionByCoinRow[]; totals: DistributionTotals }> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      coin_id: string;
      symbol: string | null;
      name: string | null;
      block_reward: number | string | null;
      block_time: number | string | null;
      total_coins: number | string | null;
      total_usd: number | string | null;
      credit_rows: bigint | number | string | null;
      unique_users: bigint | number | string | null;
    }>
  >(
    `SELECT
        h.coin_id,
        COALESCE(c.symbol, h.coin_id) AS symbol,
        COALESCE(c.name, h.coin_id) AS name,
        c.block_reward,
        c.block_time,
        COALESCE(SUM(h.amount_coins), 0)::float8 AS total_coins,
        COALESCE(SUM(h.amount_usd), 0)::float8 AS total_usd,
        COUNT(*)::bigint AS credit_rows,
        COUNT(DISTINCT h.user_id)::bigint AS unique_users
      FROM mining_block_history h
      LEFT JOIN mining_coins c ON c.id = h.coin_id
      WHERE h.window_end_ms >= $1 AND h.window_end_ms <= $2
      GROUP BY h.coin_id, c.symbol, c.name, c.block_reward, c.block_time
      ORDER BY total_usd DESC, total_coins DESC`,
    Math.floor(fromMs),
    Math.floor(toMs)
  );

  const dayCount = daysBetweenUtc(fromMs, toMs);
  let totalUsdAll = 0;
  const mapped: DistributionByCoinRow[] = rows.map((r) => {
    const totalUsd = asNum(r.total_usd);
    totalUsdAll += totalUsd;
    const blockReward = asNum(r.block_reward);
    const blockTime = asNum(r.block_time);
    let theoreticalEmissionCoins: number | null = null;
    let emissionUtilizationPct: number | null = null;
    if (blockReward > 0 && blockTime > 0) {
      theoreticalEmissionCoins = blockReward * (86400 / blockTime) * dayCount;
      const distributed = asNum(r.total_coins);
      if (theoreticalEmissionCoins > 0) {
        emissionUtilizationPct = (distributed / theoreticalEmissionCoins) * 100;
      }
    }
    return {
      coinId: r.coin_id,
      symbol: String(r.symbol || r.coin_id),
      name: String(r.name || r.coin_id),
      totalCoins: asNum(r.total_coins),
      totalUsd,
      creditRows: asNum(r.credit_rows),
      uniqueUsers: asNum(r.unique_users),
      pctOfTotalUsd: 0,
      theoreticalEmissionCoins,
      emissionUtilizationPct
    };
  });

  for (const row of mapped) {
    row.pctOfTotalUsd = totalUsdAll > 0 ? (row.totalUsd / totalUsdAll) * 100 : 0;
  }

  const totals = mapped.reduce<DistributionTotals>(
    (acc, r) => ({
      totalCoins: acc.totalCoins + r.totalCoins,
      totalUsd: acc.totalUsd + r.totalUsd,
      creditRows: acc.creditRows + r.creditRows,
      uniqueUsers: acc.uniqueUsers
    }),
    { totalCoins: 0, totalUsd: 0, creditRows: 0, uniqueUsers: 0 }
  );

  return { fromMs, toMs, rows: mapped, totals };
}

export async function getDistributionTimeline(
  fromMs: number,
  toMs: number,
  bucket: 'day' | 'week',
  coinId?: string
): Promise<{ bucket: 'day' | 'week'; rows: DistributionTimelineRow[] }> {
  const trunc = bucket === 'week' ? 'week' : 'day';
  const where: string[] = ['h.window_end_ms >= $1', 'h.window_end_ms <= $2'];
  const params: unknown[] = [Math.floor(fromMs), Math.floor(toMs)];
  if (coinId) {
    params.push(coinId);
    where.push(`h.coin_id = $${params.length}`);
  }

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      bucket_start: Date | string;
      total_coins: number | string | null;
      total_usd: number | string | null;
      credit_rows: bigint | number | string | null;
      unique_users: bigint | number | string | null;
    }>
  >(
    `SELECT
        date_trunc('${trunc}', to_timestamp(h.window_end_ms / 1000.0) AT TIME ZONE 'UTC') AS bucket_start,
        COALESCE(SUM(h.amount_coins), 0)::float8 AS total_coins,
        COALESCE(SUM(h.amount_usd), 0)::float8 AS total_usd,
        COUNT(*)::bigint AS credit_rows,
        COUNT(DISTINCT h.user_id)::bigint AS unique_users
      FROM mining_block_history h
      WHERE ${where.join(' AND ')}
      GROUP BY bucket_start
      ORDER BY bucket_start ASC`,
    ...params
  );

  const mapped: DistributionTimelineRow[] = rows.map((r) => {
    const d = r.bucket_start instanceof Date ? r.bucket_start : new Date(String(r.bucket_start));
    const bucketStartMs = d.getTime();
    return {
      bucketStartMs,
      bucketLabel: d.toISOString().slice(0, bucket === 'week' ? 10 : 10),
      totalCoins: asNum(r.total_coins),
      totalUsd: asNum(r.total_usd),
      creditRows: asNum(r.credit_rows),
      uniqueUsers: asNum(r.unique_users)
    };
  });

  return { bucket, rows: mapped };
}

export type CreditsQueryFilters = {
  fromMs: number;
  toMs: number;
  userId?: number;
  coinId?: string;
  roomId?: string;
  q?: string;
  page: number;
  limit: number;
};

export function validateCreditsRange(fromMs: number, toMs: number, forExport: boolean): string | null {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return 'Intervalo de datas inválido (from/to).';
  }
  if (toMs - fromMs > MAX_LEDGER_RANGE_MS) {
    return forExport
      ? `Intervalo máximo de ${MAX_LEDGER_RANGE_MS / MS_PER_DAY} dias para exportação.`
      : `Intervalo máximo de ${MAX_LEDGER_RANGE_MS / MS_PER_DAY} dias no ledger.`;
  }
  return null;
}

function buildCreditsWhere(filters: CreditsQueryFilters): { whereSql: string; params: unknown[] } {
  const where: string[] = ['h.window_end_ms >= $1', 'h.window_end_ms <= $2'];
  const params: unknown[] = [Math.floor(filters.fromMs), Math.floor(filters.toMs)];
  if (filters.userId != null && Number.isFinite(filters.userId)) {
    params.push(Math.floor(filters.userId));
    where.push(`h.user_id = $${params.length}`);
  }
  if (filters.coinId) {
    params.push(filters.coinId);
    where.push(`h.coin_id = $${params.length}`);
  }
  if (filters.roomId) {
    params.push(filters.roomId);
    where.push(`h.room_id = $${params.length}`);
  }
  if (filters.q) {
    const qNorm = filters.q.replace(/%/g, '').trim().toLowerCase();
    params.push(`%${qNorm}%`);
    const likeIdx = params.length;
    params.push(qNorm);
    const exactIdx = params.length;
    where.push(
      `(LOWER(COALESCE(u.username,'')) LIKE $${likeIdx} OR LOWER(COALESCE(u.email,'')) LIKE $${likeIdx} OR u.id::text = $${exactIdx})`
    );
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function getMiningCreditsLedger(
  filters: CreditsQueryFilters
): Promise<{ total: number; page: number; limit: number; rows: MiningCreditLedgerRow[] }> {
  const err = validateCreditsRange(filters.fromMs, filters.toMs, false);
  if (err) throw new Error(err);

  const limit = clamp(filters.limit, 1, MAX_LEDGER_LIMIT);
  const page = clamp(filters.page, 1, 99999);
  const offset = (page - 1) * limit;

  const { whereSql, params } = buildCreditsWhere(filters);

  const totalRows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number | string | null }>>(
    `SELECT COUNT(*)::bigint AS total
       FROM mining_block_history h
       LEFT JOIN users u ON u.id = h.user_id
       ${whereSql}`,
    ...params
  );
  const total = asNum(totalRows[0]?.total);

  const listParams = [...params, limit, offset];
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: bigint | number | string;
      user_id: number;
      username: string | null;
      email: string | null;
      coin_id: string;
      coin_symbol: string | null;
      room_id: string | null;
      window_start_ms: bigint | number;
      window_end_ms: bigint | number;
      credit_blocks: number;
      amount_coins: number | string | null;
      amount_usd: number | string | null;
      user_hash_hps: number | string | null;
      network_hashrate: number | string | null;
      block_reward: number | string | null;
      block_time: number | string | null;
      created_at: bigint | number;
    }>
  >(
    `SELECT
        h.id,
        h.user_id,
        u.username,
        u.email,
        h.coin_id,
        c.symbol AS coin_symbol,
        h.room_id,
        h.window_start_ms,
        h.window_end_ms,
        h.credit_blocks,
        h.amount_coins,
        h.amount_usd,
        h.user_hash_hps,
        h.network_hashrate,
        h.block_reward,
        h.block_time,
        h.created_at
      FROM mining_block_history h
      LEFT JOIN users u ON u.id = h.user_id
      LEFT JOIN mining_coins c ON c.id = h.coin_id
      ${whereSql}
      ORDER BY h.window_end_ms DESC, h.id DESC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    ...listParams
  );

  const mapped: MiningCreditLedgerRow[] = rows.map((r) => ({
    id: String(r.id),
    userId: r.user_id,
    username: r.username,
    email: r.email,
    coinId: r.coin_id,
    coinSymbol: r.coin_symbol,
    roomId: r.room_id,
    windowStartMs: asNum(r.window_start_ms),
    windowEndMs: asNum(r.window_end_ms),
    creditBlocks: r.credit_blocks,
    amountCoins: asNum(r.amount_coins),
    amountUsd: asNum(r.amount_usd),
    userHashHps: asNum(r.user_hash_hps),
    networkHashrate: asNum(r.network_hashrate),
    blockReward: asNum(r.block_reward),
    blockTime: asNum(r.block_time),
    createdAtMs: asNum(r.created_at)
  }));

  return { total, page, limit, rows: mapped };
}

export async function streamMiningCreditsCsv(
  filters: CreditsQueryFilters,
  write: (chunk: string) => void
): Promise<{ rowsWritten: number; truncated: boolean }> {
  const err = validateCreditsRange(filters.fromMs, filters.toMs, true);
  if (err) throw new Error(err);

  const { whereSql, params } = buildCreditsWhere(filters);
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: bigint | number | string;
      user_id: number;
      username: string | null;
      email: string | null;
      coin_id: string;
      coin_symbol: string | null;
      room_id: string | null;
      window_start_ms: bigint | number;
      window_end_ms: bigint | number;
      credit_blocks: number;
      amount_coins: number | string | null;
      amount_usd: number | string | null;
      user_hash_hps: number | string | null;
      network_hashrate: number | string | null;
      created_at: bigint | number;
    }>
  >(
    `SELECT
        h.id,
        h.user_id,
        u.username,
        u.email,
        h.coin_id,
        c.symbol AS coin_symbol,
        h.room_id,
        h.window_start_ms,
        h.window_end_ms,
        h.credit_blocks,
        h.amount_coins,
        h.amount_usd,
        h.user_hash_hps,
        h.network_hashrate,
        h.created_at
      FROM mining_block_history h
      LEFT JOIN users u ON u.id = h.user_id
      LEFT JOIN mining_coins c ON c.id = h.coin_id
      ${whereSql}
      ORDER BY h.window_end_ms DESC, h.id DESC
      LIMIT $${params.length + 1}`,
    ...params,
    MAX_EXPORT_ROWS + 1
  );

  const truncated = rows.length > MAX_EXPORT_ROWS;
  const slice = truncated ? rows.slice(0, MAX_EXPORT_ROWS) : rows;

  write(
    'id,user_id,username,email,coin_id,coin_symbol,room_id,window_start_utc,window_end_utc,credit_blocks,amount_coins,amount_usd,user_hash_hps,network_hashrate,created_at_utc\n'
  );

  for (const r of slice) {
    const cells = [
      r.id,
      r.user_id,
      r.username ?? '',
      r.email ?? '',
      r.coin_id,
      r.coin_symbol ?? '',
      r.room_id ?? '',
      new Date(asNum(r.window_start_ms)).toISOString(),
      new Date(asNum(r.window_end_ms)).toISOString(),
      r.credit_blocks,
      asNum(r.amount_coins),
      asNum(r.amount_usd),
      asNum(r.user_hash_hps),
      asNum(r.network_hashrate),
      new Date(asNum(r.created_at)).toISOString()
    ].map(csvCell);
    write(cells.join(',') + '\n');
  }

  return { rowsWritten: slice.length, truncated };
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function getUserMiningDistributionSummary(
  userId: number,
  fromMs: number,
  toMs: number
): Promise<{
  userId: number;
  fromMs: number;
  toMs: number;
  totals: DistributionTotals;
  byCoin: DistributionByCoinRow[];
}> {
  const err = validateCreditsRange(fromMs, toMs, false);
  if (err) throw new Error(err);

  const filtered = await prisma.$queryRawUnsafe<
    Array<{
      coin_id: string;
      symbol: string | null;
      name: string | null;
      total_coins: number | string | null;
      total_usd: number | string | null;
      credit_rows: bigint | number | string | null;
    }>
  >(
    `SELECT
        h.coin_id,
        COALESCE(c.symbol, h.coin_id) AS symbol,
        COALESCE(c.name, h.coin_id) AS name,
        COALESCE(SUM(h.amount_coins), 0)::float8 AS total_coins,
        COALESCE(SUM(h.amount_usd), 0)::float8 AS total_usd,
        COUNT(*)::bigint AS credit_rows
      FROM mining_block_history h
      LEFT JOIN mining_coins c ON c.id = h.coin_id
      WHERE h.user_id = $1 AND h.window_end_ms >= $2 AND h.window_end_ms <= $3
      GROUP BY h.coin_id, c.symbol, c.name
      ORDER BY total_usd DESC`,
    userId,
    Math.floor(fromMs),
    Math.floor(toMs)
  );

  let totalUsdAll = 0;
  const byCoin: DistributionByCoinRow[] = filtered.map((r) => {
    const totalUsd = asNum(r.total_usd);
    totalUsdAll += totalUsd;
    return {
      coinId: r.coin_id,
      symbol: String(r.symbol || r.coin_id),
      name: String(r.name || r.coin_id),
      totalCoins: asNum(r.total_coins),
      totalUsd,
      creditRows: asNum(r.credit_rows),
      uniqueUsers: 1,
      pctOfTotalUsd: 0,
      theoreticalEmissionCoins: null,
      emissionUtilizationPct: null
    };
  });
  for (const row of byCoin) {
    row.pctOfTotalUsd = totalUsdAll > 0 ? (row.totalUsd / totalUsdAll) * 100 : 0;
  }

  const userTotals = await aggregateFromBlockHistory(fromMs, toMs);
  void rows;

  return {
    userId,
    fromMs,
    toMs,
    totals: { ...userTotals, uniqueUsers: 1 },
    byCoin
  };
}
