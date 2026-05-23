import type { SuspiciousEmailReasonCode } from './suspiciousEmailDetect.js';

export type UserActivitySignals = {
  coinBalanceSum: number;
  racksMiningOn: number;
  rackCount: number;
  hasStock: boolean;
  totalUsdcDeposited: number;
  hasWallet: boolean;
  referredBy: string | null;
  lastLoginMs: number | null;
  /** game_states.start_time ms ou null */
  accountStartMs: number | null;
  lastCheckinMs: number | null;
};

const EPS_COIN = 1e-8;
const EPS_DEP = 1e-6;
const INACTIVE_MS = 90 * 24 * 60 * 60 * 1000;

function pushUnique(arr: SuspiciousEmailReasonCode[], r: SuspiciousEmailReasonCode) {
  if (!arr.includes(r)) arr.push(r);
}

/**
 * Motivos derivados de dados reais da BD (sem chamadas externas).
 * `totalHashFromSnapshot` opcional: quando > 0, anula heurísticas de hash zero / nunca minerou baseadas só em saldos.
 */
export function deriveActivityReasons(
  sig: UserActivitySignals,
  totalHashFromSnapshot: number | null
): SuspiciousEmailReasonCode[] {
  const out: SuspiciousEmailReasonCode[] = [];

  const hashKnown = totalHashFromSnapshot != null && Number.isFinite(totalHashFromSnapshot);
  const effectiveHash = hashKnown ? Math.max(0, totalHashFromSnapshot as number) : null;

  const minedByCoins = sig.coinBalanceSum > EPS_COIN;
  const minedByRacks = sig.racksMiningOn > 0;
  const mined = (effectiveHash != null && effectiveHash > EPS_COIN) || minedByCoins || minedByRacks;

  if (!mined) {
    pushUnique(out, 'never_mined');
    if (effectiveHash != null && effectiveHash <= EPS_COIN) {
      pushUnique(out, 'zero_hash');
    } else if (!hashKnown && !minedByCoins && !minedByRacks) {
      pushUnique(out, 'zero_hash');
    }
  }

  if (!sig.hasWallet) {
    pushUnique(out, 'no_wallet');
  }

  if (sig.totalUsdcDeposited <= EPS_DEP) {
    pushUnique(out, 'no_deposit');
  }

  const ref = (sig.referredBy || '').trim();
  if (ref && !mined && !sig.hasWallet && sig.totalUsdcDeposited <= EPS_DEP) {
    pushUnique(out, 'referral_only');
  }

  const now = Date.now();
  if (sig.lastLoginMs != null && now - sig.lastLoginMs > INACTIVE_MS) {
    pushUnique(out, 'inactive_account');
  } else if (sig.lastLoginMs == null && sig.accountStartMs != null && now - sig.accountStartMs > 30 * 24 * 60 * 60 * 1000) {
    pushUnique(out, 'inactive_account');
  }

  const noProgress =
    sig.rackCount === 0 &&
    !sig.hasStock &&
    sig.coinBalanceSum <= EPS_COIN &&
    sig.totalUsdcDeposited <= EPS_DEP &&
    (sig.lastCheckinMs == null || Number(sig.lastCheckinMs) <= 0);
  if (noProgress && !mined) {
    pushUnique(out, 'no_game_progress');
  }

  const inactive =
    (sig.lastLoginMs != null && now - sig.lastLoginMs > INACTIVE_MS) ||
    (sig.lastLoginMs == null && sig.accountStartMs != null && now - sig.accountStartMs > 30 * 24 * 60 * 60 * 1000);

  if (!mined && !sig.hasWallet && sig.totalUsdcDeposited <= EPS_DEP && inactive && noProgress) {
    pushUnique(out, 'dead_account');
  }

  return out;
}

export function mergeEmailAndActivityReasons(
  emailReasons: SuspiciousEmailReasonCode[],
  sig: UserActivitySignals,
  totalHashFromSnapshot: number | null
): SuspiciousEmailReasonCode[] {
  const act = deriveActivityReasons(sig, totalHashFromSnapshot);
  const merged: SuspiciousEmailReasonCode[] = [];
  for (const r of emailReasons) {
    if (!merged.includes(r)) merged.push(r);
  }
  for (const r of act) {
    if (!merged.includes(r)) merged.push(r);
  }
  return merged;
}
