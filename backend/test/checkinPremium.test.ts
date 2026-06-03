import { describe, expect, it } from 'vitest';
import {
  canPerformPremiumCheckinNow,
  isPremiumWithinActiveWindow,
  nextPremiumCheckinAllowedMs,
  premiumIntervalMs
} from '../modules/checkin/checkinPremiumPolicy.js';

describe('checkin premium policy (pure)', () => {
  const intervalDays = 7;
  const intervalMs = premiumIntervalMs(intervalDays);

  it('premiumIntervalMs usa dias completos', () => {
    expect(premiumIntervalMs(7)).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('sem check-in anterior: janela inactiva e pode fazer check-in', () => {
    const now = Date.now();
    expect(isPremiumWithinActiveWindow(null, now, intervalDays)).toBe(false);
    expect(canPerformPremiumCheckinNow(null, now, intervalDays)).toBe(true);
    expect(nextPremiumCheckinAllowedMs(null, intervalDays)).toBe(null);
  });

  it('dentro dos 7 dias após check-in: mineração activa, novo check-in bloqueado', () => {
    const last = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    expect(isPremiumWithinActiveWindow(last, now, intervalDays)).toBe(true);
    expect(canPerformPremiumCheckinNow(last, now, intervalDays)).toBe(false);
    expect(nextPremiumCheckinAllowedMs(last, intervalDays)).toBe(last + intervalMs);
  });

  it('após 7 dias: congelado até novo check-in', () => {
    const last = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    expect(isPremiumWithinActiveWindow(last, now, intervalDays)).toBe(false);
    expect(canPerformPremiumCheckinNow(last, now, intervalDays)).toBe(true);
  });

  it('no limite exacto do intervalo: já pode check-in de novo', () => {
    const now = Date.now();
    const last = now - intervalMs;
    expect(isPremiumWithinActiveWindow(last, now, intervalDays)).toBe(false);
    expect(canPerformPremiumCheckinNow(last, now, intervalDays)).toBe(true);
  });
});
