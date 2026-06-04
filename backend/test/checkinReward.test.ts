import { describe, expect, it } from 'vitest';
import {
  CHECKIN_STREAK_GRACE_MS,
  computeNextDailyCheckinStreak,
  computeNextPremiumCheckinStreak,
  shouldGrantCheckinEstelarReward
} from '../modules/checkin/checkinReward.js';
import { CHECKIN_WINDOW_MS, brtCheckinPeriodStartMs } from '../modules/checkin/checkin.service.js';

describe('computeNextDailyCheckinStreak', () => {
  it('primeiro check-in → streak 1', () => {
    const anchor = brtCheckinPeriodStartMs(Date.parse('2026-06-15T22:00:00-03:00'));
    expect(computeNextDailyCheckinStreak(0, null, anchor)).toEqual({ nextStreak: 1, streakReset: false });
  });

  it('ciclo consecutivo → incrementa streak', () => {
    const prev = brtCheckinPeriodStartMs(Date.parse('2026-06-14T22:00:00-03:00'));
    const anchor = prev + CHECKIN_WINDOW_MS;
    expect(computeNextDailyCheckinStreak(3, prev, anchor)).toEqual({ nextStreak: 4, streakReset: false });
  });

  it('1 ciclo perdido (48h) ainda incrementa — regressão manhã→noite seguinte', () => {
    const prev = brtCheckinPeriodStartMs(Date.parse('2026-06-15T10:00:00-03:00'));
    const anchor = prev + CHECKIN_STREAK_GRACE_MS;
    expect(computeNextDailyCheckinStreak(5, prev, anchor)).toEqual({ nextStreak: 6, streakReset: false });
  });

  it('2+ ciclos perdidos → reset', () => {
    const prev = brtCheckinPeriodStartMs(Date.parse('2026-06-14T22:00:00-03:00'));
    const anchor = prev + 3 * CHECKIN_WINDOW_MS;
    expect(computeNextDailyCheckinStreak(6, prev, anchor)).toEqual({ nextStreak: 1, streakReset: true });
  });
});

describe('computeNextPremiumCheckinStreak', () => {
  const intervalMs = 7 * CHECKIN_WINDOW_MS;

  it('check-in semanal consecutivo incrementa streak', () => {
    const prevAt = Date.now() - intervalMs;
    const out = computeNextPremiumCheckinStreak(2, prevAt, Date.now(), intervalMs);
    expect(out.nextStreak).toBe(3);
    expect(out.streakReset).toBe(false);
  });

  it('intervalo longo demais reseta streak', () => {
    const prevAt = Date.now() - intervalMs - 2 * CHECKIN_WINDOW_MS;
    const out = computeNextPremiumCheckinStreak(4, prevAt, Date.now(), intervalMs);
    expect(out.nextStreak).toBe(1);
    expect(out.streakReset).toBe(true);
  });
});

describe('shouldGrantCheckinEstelarReward', () => {
  it('premium concede a cada check-in', () => {
    expect(shouldGrantCheckinEstelarReward(1, true)).toBe(true);
    expect(shouldGrantCheckinEstelarReward(3, true)).toBe(true);
  });

  it('daily concede no múltiplo de 7', () => {
    expect(shouldGrantCheckinEstelarReward(6, false)).toBe(false);
    expect(shouldGrantCheckinEstelarReward(7, false)).toBe(true);
    expect(shouldGrantCheckinEstelarReward(14, false)).toBe(true);
  });
});
