/**
 * Check-in diário (substitui carregamento de baterias).
 *
 * Regras (servidor é a fonte de verdade):
 *  - O dia de check-in segue o calendário America/Sao_Paulo com fronteira às
 *    `CHECKIN_CYCLE_HOUR_BRT` (21:00): cada ciclo é [21:00 D, 21:00 D+1).
 *    Enquanto o último check-in cair no mesmo ciclo que `now`, a mineração
 *    permanece activa e novos cliques são idempotentes.
 *  - Ao mudar de ciclo (passou das 21:00 BRT sem novo check-in), as rigs
 *    ficam "frozen" até o próximo check-in.
 *  - Com check-in já feito no ciclo actual, nas últimas
 *    `CHECKIN_EARLY_WINDOW_MS` (4h) antes das 21:00 BRT pode registar o
 *    ciclo seguinte antecipadamente (mineração continua sem pausa na fronteira).
 *  - Streak:
 *      - check-in no ciclo imediatamente a seguir ao do anterior → `streak += 1`;
 *      - caso contrário (ou primeiro de sempre) → `streak = 1`.
 *  - Sempre que `streak` atinge um múltiplo de 7 (7, 14, 21, …), o jogador
 *    ganha 1 instância UUID de `battery_estelar` em `stored_batteries`.
 *  - `last_checkin_day` é mantido por compatibilidade/diagnóstico (dia civil
 *    BRT do instante do check-in). Freeze/streak usam `last_checkin_at_ms` +
 *    fronteira 21:00 BRT.
 */

import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import db from '../../config/db.js';

export const CHECKIN_TIMEZONE = 'America/Sao_Paulo';
export const CHECKIN_REWARD_ITEM_ID = 'battery_estelar';
export const CHECKIN_REWARD_EVERY_DAYS = 7;
/** Hora local (BRT) em que abre um novo ciclo de check-in / mineração. */
export const CHECKIN_CYCLE_HOUR_BRT = 21;
/** Duração nominal de um ciclo (24h em ms) — usado em streak e UI. */
export const CHECKIN_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Antecipação permitida antes do fim do ciclo (4h antes das 21:00 BRT). */
export const CHECKIN_EARLY_WINDOW_MS = 4 * 60 * 60 * 1000;

export type CheckinStatus = {
  today: string;
  timezone: string;
  lastCheckinDay: string | null;
  lastCheckinAtMs: number | null;
  streak: number;
  todayCheckedIn: boolean;
  /** True nas últimas 4h do ciclo actual, com check-in feito, antes do próximo 21:00 BRT. */
  canEarlyCheckin: boolean;
  frozen: boolean;
  /** Próximo fim de ciclo BRT (21:00→21:00) em relação ao último check-in. */
  nextResetMs: number;
  /** Quantos ms restam na janela actual (0 quando frozen). */
  windowRemainingMs: number;
  /** Tamanho total da janela (24h em ms) — útil ao frontend renderizar barras. */
  windowDurationMs: number;
  /** Posição relativa dentro do ciclo de 7 dias (0..7). */
  rewardCycleProgress: number;
  rewardCycleSize: number;
};

export type CheckinResult = CheckinStatus & {
  /** True quando este pedido aplicou um novo check-in (não-idempotente). */
  performed: boolean;
  /** Quantas baterias estelar foram concedidas neste pedido (0 ou 1). */
  rewardGranted: number;
  /** True se a sequência reiniciou agora (streak voltou para 1 vinda de >0 ou nula). */
  streakReset: boolean;
};

const DAY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `formatToParts` com `timeZone` é a forma canónica de obter calendário
 * local sem depender de variáveis de ambiente do processo.
 */
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CHECKIN_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Devolve o dia local America/Sao_Paulo no formato `YYYY-MM-DD` para o instante dado. */
export function brtDayFromMs(ms: number): string {
  const safe = Number.isFinite(ms) ? ms : Date.now();
  return dayFormatter.format(new Date(safe));
}

/** `YYYY-MM-DD` que precede o dia recebido (sem atravessar para fuso UTC). */
export function previousBrtDay(day: string): string {
  if (!DAY_REGEX.test(day)) return day;
  const [y, m, d] = day.split('-').map((p) => parseInt(p, 10));
  // Usa UTC só como aritmética calendárica (subtrai 1 dia); não há
  // ambiguidade de fuso porque tratamos sempre como datas civis.
  const base = Date.UTC(y, m - 1, d);
  const prev = new Date(base - 24 * 3600 * 1000);
  const yy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(prev.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** `YYYY-MM-DD` que se segue ao dia recebido (aritmética civil +1 dia). */
export function nextBrtDay(day: string): string {
  if (!DAY_REGEX.test(day)) return day;
  const [y, m, d] = day.split('-').map((p) => parseInt(p, 10));
  const base = Date.UTC(y, m - 1, d);
  const nxt = new Date(base + 24 * 3600 * 1000);
  const yy = nxt.getUTCFullYear();
  const mm = String(nxt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(nxt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Instante UTC (ms epoch) em que o relógio de America/Sao_Paulo marca
 * `hour:minute:second` no dia civil `ymd` (YYYY-MM-DD).
 * Usa o deslocamento fixo UTC−3 (BRT), coerente com America/Sao_Paulo
 * sem horário de verão.
 */
export function brtYmdAtWallTimeMs(ymd: string, hour: number, minute = 0, second = 0): number {
  if (!DAY_REGEX.test(ymd)) return NaN;
  const [ys, mo, ds] = ymd.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(ys) || !Number.isFinite(mo) || !Number.isFinite(ds)) return NaN;
  const BRT_OFFSET_H = 3;
  return Date.UTC(ys, mo - 1, ds, hour + BRT_OFFSET_H, minute, second);
}

/**
 * Início do ciclo de check-in [21:00 D, 21:00 D+1) em BRT que contém `nowMs`.
 */
export function brtCheckinPeriodStartMs(nowMs: number): number {
  const safe = Number.isFinite(nowMs) ? nowMs : Date.now();
  const ymd = brtDayFromMs(safe);
  const boundaryToday = brtYmdAtWallTimeMs(ymd, CHECKIN_CYCLE_HOUR_BRT, 0, 0);
  if (safe >= boundaryToday) return boundaryToday;
  return brtYmdAtWallTimeMs(previousBrtDay(ymd), CHECKIN_CYCLE_HOUR_BRT, 0, 0);
}

/** Fim do ciclo que começa em `periodStartMs` (próximo 21:00 BRT). */
export function nextCheckinPeriodEndMs(periodStartMs: number): number {
  const anchor = brtDayFromMs(periodStartMs);
  return brtYmdAtWallTimeMs(nextBrtDay(anchor), CHECKIN_CYCLE_HOUR_BRT, 0, 0);
}

/** Início do próximo ciclo BRT [21:00→21:00) em relação a `nowMs`. */
export function nextCheckinPeriodStartMs(nowMs: number): number {
  return nextCheckinPeriodEndMs(brtCheckinPeriodStartMs(nowMs));
}

/** Check-in gravado antecipadamente para o ciclo que abre no próximo 21:00 BRT. */
export function isEarlyCheckinTimestamp(lastCheckinAtMs: number, nowMs: number): boolean {
  const nowPeriod = brtCheckinPeriodStartMs(nowMs);
  const lastPeriod = brtCheckinPeriodStartMs(lastCheckinAtMs);
  const upcomingStart = nextCheckinPeriodStartMs(nowMs);
  return (
    lastPeriod === upcomingStart &&
    lastCheckinAtMs >= upcomingStart - CHECKIN_EARLY_WINDOW_MS
  );
}

/** Mineração activa: mesmo ciclo ou check-in antecipado do ciclo seguinte. */
export function isWithinActiveCheckinWindow(
  lastCheckinAtMs: number | null | undefined,
  nowMs: number
): boolean {
  const at = lastCheckinAtMsNumber(lastCheckinAtMs);
  if (at == null) return false;
  const nowPeriod = brtCheckinPeriodStartMs(nowMs);
  const lastPeriod = brtCheckinPeriodStartMs(at);
  if (lastPeriod === nowPeriod) return true;
  return isEarlyCheckinTimestamp(at, nowMs);
}

/** Pode registar o próximo ciclo até 4h antes das 21:00 BRT (já fez check-in no ciclo actual). */
export function canEarlyCheckinForNextPeriod(
  lastCheckinAtMs: number | null | undefined,
  nowMs: number
): boolean {
  const at = lastCheckinAtMsNumber(lastCheckinAtMs);
  if (at == null) return false;
  if (isEarlyCheckinTimestamp(at, nowMs)) return false;
  const nowPeriod = brtCheckinPeriodStartMs(nowMs);
  const lastPeriod = brtCheckinPeriodStartMs(at);
  if (lastPeriod !== nowPeriod) return false;
  const nextEnd = nextCheckinPeriodEndMs(nowPeriod);
  return nowMs >= nextEnd - CHECKIN_EARLY_WINDOW_MS;
}

/**
 * Próximo "midnight America/Sao_Paulo" estritamente após `nowMs` (em ms epoch).
 * Mantido para uso em logs/telemetria.
 */
export function nextBrtMidnightMs(nowMs: number): number {
  const startDay = brtDayFromMs(nowMs);
  let lo = nowMs;
  let hi = nowMs + 25 * 3600 * 1000;
  while (brtDayFromMs(hi) === startDay) hi += 60 * 60 * 1000;
  while (hi - lo > 250) {
    const mid = Math.floor((lo + hi) / 2);
    if (brtDayFromMs(mid) === startDay) lo = mid;
    else hi = mid;
  }
  return hi;
}

type GameStateRow = {
  last_checkin_day: string | null;
  last_checkin_at_ms: number | string | bigint | null;
  checkin_streak: number | string | null;
};

async function readGameStateForCheckin(
  client: PoolClient,
  userId: number,
  forUpdate: boolean
): Promise<GameStateRow | null> {
  const sql = `SELECT last_checkin_day, last_checkin_at_ms, checkin_streak
                 FROM game_states
                WHERE user_id = $1
                ${forUpdate ? 'FOR UPDATE' : ''}`;
  const r = await client.query<GameStateRow>(sql, [userId]);
  if (!r.rowCount) return null;
  return r.rows[0];
}

function streakNumber(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '0'), 10);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Coage o `BIGINT` (que vem do `pg` como string ou number) para `number | null`. */
function lastCheckinAtMsNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw === 'bigint') {
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  const v = parseInt(String(raw), 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function buildStatus(
  today: string,
  lastCheckinDay: string | null,
  lastCheckinAtMs: number | null,
  streak: number,
  nowMs: number
): CheckinStatus {
  const nowPeriodStart = brtCheckinPeriodStartMs(nowMs);
  const lastPeriodStart =
    lastCheckinAtMs == null ? null : brtCheckinPeriodStartMs(lastCheckinAtMs);
  const withinWindow = isWithinActiveCheckinWindow(lastCheckinAtMs, nowMs);
  const canEarlyCheckin = canEarlyCheckinForNextPeriod(lastCheckinAtMs, nowMs);
  const frozen = !withinWindow;
  const nextResetMs =
    lastPeriodStart != null
      ? nextCheckinPeriodEndMs(lastPeriodStart)
      : nextCheckinPeriodEndMs(brtCheckinPeriodStartMs(nowMs));
  const windowRemainingMs = withinWindow ? Math.max(0, nextResetMs - nowMs) : 0;
  const cycleSize = CHECKIN_REWARD_EVERY_DAYS;
  const cycleProgress = streak === 0 ? 0 : streak % cycleSize === 0 ? cycleSize : streak % cycleSize;
  return {
    today,
    timezone: CHECKIN_TIMEZONE,
    lastCheckinDay,
    lastCheckinAtMs,
    streak,
    todayCheckedIn: withinWindow,
    canEarlyCheckin,
    frozen,
    nextResetMs,
    windowRemainingMs,
    windowDurationMs: CHECKIN_WINDOW_MS,
    rewardCycleProgress: cycleProgress,
    rewardCycleSize: cycleSize
  };
}

/** Snapshot do check-in (para `GET /api/checkin/status`). */
export async function getCheckinStatus(userId: number, nowMs: number = Date.now()): Promise<CheckinStatus> {
  const today = brtDayFromMs(nowMs);
  const client = await db.connect();
  try {
    const row = await readGameStateForCheckin(client, userId, false);
    if (!row) {
      return buildStatus(today, null, null, 0, nowMs);
    }
    return buildStatus(
      today,
      row.last_checkin_day,
      lastCheckinAtMsNumber(row.last_checkin_at_ms),
      streakNumber(row.checkin_streak),
      nowMs
    );
  } finally {
    client.release();
  }
}

/**
 * Aplica um check-in para o utilizador. Idempotente dentro do mesmo ciclo
 * BRT 21:00→21:00. Devolve o estado pós-aplicação (mesmo quando idempotente).
 */
export async function performCheckin(userId: number, nowMs: number = Date.now()): Promise<CheckinResult> {
  const today = brtDayFromMs(nowMs);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET statement_timeout = '5s'");

    await client.query(
      `INSERT INTO game_states (
          user_id,
          usdc,
          start_time,
          claimed_referrals,
          referral_bonus_claimed,
          last_updated_at,
          server_updated_at,
          black_market_balance
        )
        VALUES ($1, 0, $2, 0, 0, $2, $2, 0)
        ON CONFLICT (user_id) DO NOTHING`,
      [userId, nowMs]
    );

    const row = await readGameStateForCheckin(client, userId, true);
    if (!row) {
      await client.query('ROLLBACK');
      throw new Error('GAME_STATE_NOT_FOUND');
    }

    const prevStreak = streakNumber(row.checkin_streak);
    const prevAtMs = lastCheckinAtMsNumber(row.last_checkin_at_ms);
    const prevDay = row.last_checkin_day;

    const nowPeriod = brtCheckinPeriodStartMs(nowMs);
    const prevPeriod = prevAtMs == null ? null : brtCheckinPeriodStartMs(prevAtMs);

    if (prevAtMs != null && isEarlyCheckinTimestamp(prevAtMs, nowMs)) {
      await client.query('ROLLBACK');
      const status = buildStatus(today, prevDay, prevAtMs, prevStreak, nowMs);
      return { ...status, performed: false, rewardGranted: 0, streakReset: false };
    }

    let checkinAtMs = nowMs;
    let streakAnchorPeriod = nowPeriod;

    if (prevAtMs != null && prevPeriod === nowPeriod) {
      const nextPeriodStart = nextCheckinPeriodStartMs(nowMs);
      const nextEnd = nextCheckinPeriodEndMs(nowPeriod);
      if (nowMs < nextEnd - CHECKIN_EARLY_WINDOW_MS) {
        await client.query('ROLLBACK');
        const status = buildStatus(today, prevDay, prevAtMs, prevStreak, nowMs);
        return { ...status, performed: false, rewardGranted: 0, streakReset: false };
      }
      checkinAtMs = nextPeriodStart;
      streakAnchorPeriod = nextPeriodStart;
    }

    let nextStreak: number;
    let streakReset = false;
    if (prevPeriod != null && streakAnchorPeriod - prevPeriod === CHECKIN_WINDOW_MS) {
      nextStreak = prevStreak + 1;
    } else {
      nextStreak = 1;
      streakReset = prevStreak !== 0 || prevAtMs !== null;
    }

    const grantsReward = nextStreak > 0 && nextStreak % CHECKIN_REWARD_EVERY_DAYS === 0;
    const checkinDay = brtDayFromMs(checkinAtMs);

    await client.query(
      `UPDATE game_states
          SET last_checkin_day = $2,
              last_checkin_at_ms = $3,
              checkin_streak = $4
        WHERE user_id = $1`,
      [userId, checkinDay, checkinAtMs, nextStreak]
    );

    let rewardGranted = 0;
    if (grantsReward) {
      const newId = crypto.randomUUID();
      const ins = await client.query(
        `INSERT INTO stored_batteries (id, user_id, item_id, display_name, image_url)
         SELECT $1, $2, u.id, u.name, NULLIF(BTRIM(COALESCE(u.image::text, '')), '')
           FROM upgrades u
          WHERE u.id = $3
            AND COALESCE(u.is_active, 1) <> 0
            AND (lower(COALESCE(u.type, '')) = 'battery' OR lower(COALESCE(u.category, '')) = 'battery')
          LIMIT 1`,
        [newId, userId, CHECKIN_REWARD_ITEM_ID]
      );
      rewardGranted = ins.rowCount ?? 0;
    }

    await client.query('COMMIT');

    const status = buildStatus(checkinDay, checkinDay, checkinAtMs, nextStreak, nowMs);
    return { ...status, performed: true, rewardGranted, streakReset };
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

/**
 * Helper barato (single read) para o cron de mineração descobrir se o
 * utilizador está congelado neste tick. Não usa lock — leitura best-effort.
 */
export async function isUserFrozenForToday(userId: number, nowMs: number = Date.now()): Promise<boolean> {
  const client = await db.connect();
  try {
    const r = await client.query<{ last_checkin_at_ms: number | string | bigint | null }>(
      'SELECT last_checkin_at_ms FROM game_states WHERE user_id = $1',
      [userId]
    );
    if (!r.rowCount) return true;
    return isCheckinFrozenAtMs(lastCheckinAtMsNumber(r.rows[0].last_checkin_at_ms), nowMs);
  } finally {
    client.release();
  }
}

/** Versão pura para reutilização em readers que já têm o valor lido (cron, snapshots). */
export function isCheckinFrozenAtMs(lastCheckinAtMs: number | null | undefined, nowMs: number): boolean {
  return !isWithinActiveCheckinWindow(lastCheckinAtMs, nowMs);
}
