/** Pontuação heurística só para priorização visual — não altera contas. */
const WEIGHTS: ReadonlyArray<[string, number]> = [
  ['invalid_format', 50],
  ['temporary_domain', 60],
  ['fake_pattern', 45],
  ['duplicate_email', 40],
  ['domain_not_trusted', 30],
  ['referral_only', 30],
  ['never_mined', 25],
  ['no_game_progress', 20],
  ['suspicious_domain', 20],
  ['unverified_email', 15],
  ['no_wallet', 15],
  ['no_deposit', 15],
  ['zero_hash', 10],
  ['inactive_account', 10],
  ['dead_account', 35],
];

export type RiskLevel = 'minimal' | 'low' | 'medium' | 'high';

export function calculateUserSuspicionScore(reasons: ReadonlyArray<string>): { score: number; riskLevel: RiskLevel } {
  let score = 0;
  const seen = new Set<string>();
  for (const [code, w] of WEIGHTS) {
    if (!reasons.includes(code) || seen.has(code)) continue;
    seen.add(code);
    score += w;
  }
  const riskLevel: RiskLevel =
    score >= 80 ? 'high' : score >= 50 ? 'medium' : score >= 30 ? 'low' : 'minimal';
  return { score, riskLevel };
}
