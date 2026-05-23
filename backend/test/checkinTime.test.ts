import { describe, expect, it } from 'vitest';
import {
  brtCheckinPeriodStartMs,
  brtDayFromMs,
  brtYmdAtWallTimeMs,
  canEarlyCheckinForNextPeriod,
  CHECKIN_EARLY_WINDOW_MS,
  isCheckinFrozenAtMs,
  isEarlyCheckinTimestamp,
  isWithinActiveCheckinWindow,
  nextBrtDay,
  nextBrtMidnightMs,
  nextCheckinPeriodStartMs,
  previousBrtDay
} from '../modules/checkin/checkin.service.js';

describe('checkin BRT calendar helpers', () => {
  it('previousBrtDay subtrai um dia civil', () => {
    expect(previousBrtDay('2026-03-01')).toBe('2026-02-28');
    expect(previousBrtDay('2026-01-01')).toBe('2025-12-31');
  });

  it('nextBrtDay soma um dia civil', () => {
    expect(nextBrtDay('2026-02-28')).toBe('2026-03-01');
    expect(nextBrtDay('2025-12-31')).toBe('2026-01-01');
  });

  it('nextBrtMidnightMs devolve instante no futuro com dia BRT diferente', () => {
    const t = Date.parse('2026-06-15T15:30:00-03:00');
    const mid = nextBrtMidnightMs(t);
    expect(mid).toBeGreaterThan(t);
    expect(brtDayFromMs(mid)).not.toBe(brtDayFromMs(t));
    expect(brtDayFromMs(mid - 500)).toBe(brtDayFromMs(t));
  });

  it('brtDayFromMs devolve YYYY-MM-DD', () => {
    const d = brtDayFromMs(Date.parse('2026-08-20T02:00:00Z'));
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('brtYmdAtWallTimeMs alinha com ISO America/Sao_Paulo (UTC−3)', () => {
    const iso = Date.parse('2026-06-14T21:00:00-03:00');
    expect(brtYmdAtWallTimeMs('2026-06-14', 21, 0, 0)).toBe(iso);
  });
});

describe('checkin ciclo 21:00 BRT (brtCheckinPeriodStartMs)', () => {
  it('antes das 21h o ciclo actual começou no dia anterior às 21h', () => {
    const t = Date.parse('2026-06-15T20:00:00-03:00');
    expect(brtCheckinPeriodStartMs(t)).toBe(Date.parse('2026-06-14T21:00:00-03:00'));
  });

  it('às 21h00 o ciclo actual começa nesse dia', () => {
    const t = Date.parse('2026-06-15T21:00:00-03:00');
    expect(brtCheckinPeriodStartMs(t)).toBe(Date.parse('2026-06-15T21:00:00-03:00'));
  });
});

describe('checkin ciclo 21:00 BRT (isCheckinFrozenAtMs)', () => {
  it('NULL last check-in → frozen', () => {
    const now = Date.parse('2026-06-15T20:00:00-03:00');
    expect(isCheckinFrozenAtMs(null, now)).toBe(true);
    expect(isCheckinFrozenAtMs(undefined, now)).toBe(true);
    expect(isCheckinFrozenAtMs(0, now)).toBe(true);
  });

  it('último check-in no mesmo ciclo (véspera 22h, hoje 20h) → activo', () => {
    const last = Date.parse('2026-06-14T22:00:00-03:00');
    const now = Date.parse('2026-06-15T20:00:00-03:00');
    expect(isCheckinFrozenAtMs(last, now)).toBe(false);
  });

  it('passou a fronteira 21h → frozen até novo check-in', () => {
    const last = Date.parse('2026-06-14T22:00:00-03:00');
    const now = Date.parse('2026-06-15T21:00:00-03:00');
    expect(isCheckinFrozenAtMs(last, now)).toBe(true);
  });

  it('no mesmo ciclo, 1h após o check-in → activo', () => {
    const last = Date.parse('2026-06-14T21:30:00-03:00');
    const now = Date.parse('2026-06-14T22:30:00-03:00');
    expect(isCheckinFrozenAtMs(last, now)).toBe(false);
  });

  it('check-in antecipado (4h antes das 21h) → activo antes da fronteira', () => {
    const now = Date.parse('2026-06-15T17:30:00-03:00');
    const last = nextCheckinPeriodStartMs(now);
    expect(isEarlyCheckinTimestamp(last, now)).toBe(true);
    expect(isWithinActiveCheckinWindow(last, now)).toBe(true);
    expect(isCheckinFrozenAtMs(last, now)).toBe(false);
  });

  it('5h antes das 21h, só check-in do ciclo actual → ainda não pode antecipar', () => {
    const now = Date.parse('2026-06-15T16:00:00-03:00');
    const last = Date.parse('2026-06-14T22:00:00-03:00');
    expect(canEarlyCheckinForNextPeriod(last, now)).toBe(false);
    expect(isCheckinFrozenAtMs(last, now)).toBe(false);
  });

  it('4h antes das 21h, check-in do ciclo actual → pode antecipar', () => {
    const now = Date.parse('2026-06-15T17:00:00-03:00');
    const last = Date.parse('2026-06-14T22:00:00-03:00');
    expect(canEarlyCheckinForNextPeriod(last, now)).toBe(true);
  });

  it('janela antecipada = 4h', () => {
    expect(CHECKIN_EARLY_WINDOW_MS).toBe(4 * 60 * 60 * 1000);
  });
});
