export const CHECKIN_PREMIUM_COOLDOWN_CODE = 'CHECKIN_PREMIUM_COOLDOWN';

export class CheckinPremiumCooldownError extends Error {
  readonly code = CHECKIN_PREMIUM_COOLDOWN_CODE;
  readonly nextCheckinAllowedMs: number;
  readonly intervalDays: number;

  constructor(nextCheckinAllowedMs: number, intervalDays: number) {
    super(
      `Compradores de passe premium só podem fazer check-in a cada ${intervalDays} dias. Próximo disponível em breve.`
    );
    this.name = 'CheckinPremiumCooldownError';
    this.nextCheckinAllowedMs = nextCheckinAllowedMs;
    this.intervalDays = intervalDays;
  }
}
