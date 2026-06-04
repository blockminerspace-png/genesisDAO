import type { PoolClient } from 'pg';
import crypto from 'node:crypto';

const CHECKIN_WINDOW_MS = 24 * 60 * 60 * 1000;
const CHECKIN_REWARD_EVERY_DAYS = 7;
const CHECKIN_REWARD_ITEM_ID = 'battery_estelar';

/** Até 48h entre check-ins diários preserva a sequência (1 ciclo perdido). */
export const CHECKIN_STREAK_GRACE_MS = 2 * CHECKIN_WINDOW_MS;

export function computeNextDailyCheckinStreak(
  prevStreak: number,
  prevPeriod: number | null,
  streakAnchorPeriod: number
): { nextStreak: number; streakReset: boolean } {
  if (prevPeriod == null) {
    return { nextStreak: 1, streakReset: false };
  }
  const periodGap = streakAnchorPeriod - prevPeriod;
  if (periodGap === CHECKIN_WINDOW_MS || periodGap === CHECKIN_STREAK_GRACE_MS) {
    return { nextStreak: prevStreak + 1, streakReset: false };
  }
  return { nextStreak: 1, streakReset: prevStreak !== 0 };
}

export function computeNextPremiumCheckinStreak(
  prevStreak: number,
  prevAtMs: number | null,
  nowMs: number,
  intervalMs: number
): { nextStreak: number; streakReset: boolean } {
  if (prevAtMs != null && nowMs - prevAtMs <= intervalMs + CHECKIN_WINDOW_MS) {
    return { nextStreak: prevStreak + 1, streakReset: false };
  }
  return { nextStreak: 1, streakReset: prevStreak !== 0 || prevAtMs !== null };
}

/** Premium: 1 Estelar a cada check-in do intervalo. Daily: a cada 7 check-ins seguidos. */
export function shouldGrantCheckinEstelarReward(
  nextStreak: number,
  premiumWeeklyCheckin: boolean
): boolean {
  if (premiumWeeklyCheckin) return true;
  return nextStreak > 0 && nextStreak % CHECKIN_REWARD_EVERY_DAYS === 0;
}

export async function grantCheckinEstelarBattery(
  client: PoolClient,
  userId: number
): Promise<{ rewardGranted: number; batteryId: string | null }> {
  const batteryId = crypto.randomUUID();
  const ins = await client.query(
    `INSERT INTO stored_batteries (id, user_id, item_id, display_name, image_url)
     SELECT $1, $2, u.id, u.name, NULLIF(BTRIM(COALESCE(u.image::text, '')), '')
       FROM upgrades u
      WHERE u.id = $3
        AND COALESCE(u.is_active, 1) <> 0
        AND (lower(COALESCE(u.type, '')) = 'battery' OR lower(COALESCE(u.category, '')) = 'battery')
      LIMIT 1`,
    [batteryId, userId, CHECKIN_REWARD_ITEM_ID]
  );
  const rewardGranted = ins.rowCount ?? 0;
  if (rewardGranted === 0) {
    console.error('[checkin] Falha ao conceder battery_estelar — upgrade ausente ou inactivo', {
      userId,
      itemId: CHECKIN_REWARD_ITEM_ID
    });
    return { rewardGranted: 0, batteryId: null };
  }
  return { rewardGranted, batteryId };
}
