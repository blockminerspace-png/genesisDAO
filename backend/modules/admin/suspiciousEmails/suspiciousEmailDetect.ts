import { DISPOSABLE_EMAIL_DOMAINS } from './disposableEmailDomains.js';
import { TRUSTED_EMAIL_DOMAINS } from './trustedEmailDomains.js';

export const SUSPICIOUS_EMAIL_REASON_CODES = [
  'invalid_format',
  'temporary_domain',
  'fake_pattern',
  'duplicate_email',
  'unverified_email',
  'suspicious_domain',
  'domain_not_trusted',
  'never_mined',
  'zero_hash',
  'no_wallet',
  'no_deposit',
  'referral_only',
  'inactive_account',
  'no_game_progress',
  'dead_account',
] as const;

export type SuspiciousEmailReasonCode = (typeof SUSPICIOUS_EMAIL_REASON_CODES)[number];

const DISPOSABLE_SET = new Set(DISPOSABLE_EMAIL_DOMAINS.map((d) => d.toLowerCase()));
const TRUSTED_SET = new Set(TRUSTED_EMAIL_DOMAINS.map((d) => d.toLowerCase()));

/** Domínios que imitam provedores conhecidos (typos) — motivo `fake_pattern`. */
const PROVIDER_TYPO_DOMAINS = new Set(
  [
    'gmai.com',
    'gmial.com',
    'gmal.com',
    'gmail.con',
    'gmaill.com',
    'hotmial.com',
    'outlok.com',
    'outlookk.com',
    'yahooo.com',
    'protonmai.com',
    'protonmaill.com',
    'iclod.com',
    'icloud.co',
  ].map((d) => d.toLowerCase())
);

/** Emails exactos (lower) — reutilizado na pré-selecção SQL. */
export const FAKE_EXACT_EMAILS_LIST: readonly string[] = [
  'test@test.com',
  'fake@fake.com',
  'a@a.com',
  '123@123.com',
  'email@email.com',
  'user@example.com',
  'admin@admin.com',
  'xxx@xxx.com',
  'test@example.com',
  'user@test.com',
  'sample@sample.com',
  'demo@demo.com',
  'foo@foo.com',
  'bar@bar.com',
];

const FAKE_EXACT_EMAILS = new Set(FAKE_EXACT_EMAILS_LIST);

const EXAMPLE_DOMAIN_SUFFIXES = ['@example.com', '@example.org', '@example.net', '@test.com', '@localhost'];

const SUSPICIOUS_LOCAL_PREFIXES = ['no-reply', 'noreply', 'mailer-daemon', 'postmaster', 'donotreply', 'do-not-reply'];

const RARE_TLDS = new Set([
  'tk',
  'ml',
  'ga',
  'cf',
  'gq',
  'xyz',
  'top',
  'work',
  'click',
  'link',
  'zip',
  'mov',
]);

const HIGH_DOMAIN_DIGIT_RATIO = 0.55;
const MIN_DOMAIN_LEN_FOR_DIGIT_HEURISTIC = 6;
const MAX_DOMAIN_LEN_FOR_DIGIT_HEURISTIC = 22;

export function normalizeEmail(email: string | null | undefined): string {
  if (email == null) return '';
  return String(email).trim().toLowerCase();
}

export function getEmailDomain(email: string | null | undefined): string | null {
  if (email == null) return null;
  const t = normalizeEmail(email);
  const at = t.indexOf('@');
  if (at < 0 || at === t.length - 1) return null;
  const dom = t.slice(at + 1).trim();
  return dom.length > 0 ? dom : null;
}

export function isTrustedEmailDomain(domainLower: string | null | undefined): boolean {
  if (!domainLower) return false;
  return TRUSTED_SET.has(domainLower.trim().toLowerCase());
}

export function isTemporaryEmailDomain(domainLower: string): boolean {
  if (!domainLower) return false;
  return DISPOSABLE_SET.has(domainLower.trim().toLowerCase());
}

export function isInvalidEmailFormat(email: string | null | undefined): boolean {
  if (email == null) return true;
  const raw = String(email);
  if (raw.length > 254) return true;
  const t = raw.trim();
  if (t.length === 0) return true;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) return true;
  }
  let atCount = 0;
  for (let i = 0; i < t.length; i++) {
    if (t.charCodeAt(i) === 64) atCount++;
  }
  if (atCount !== 1) return true;
  const at = t.indexOf('@');
  const local = t.slice(0, at);
  const domain = t.slice(at + 1);
  if (local.length === 0 || domain.length === 0) return true;
  if (local.length > 64) return true;
  if (domain.indexOf('.') < 0) return true;
  const lastDot = domain.lastIndexOf('.');
  if (lastDot < 0 || lastDot >= domain.length - 1) return true;
  const tld = domain.slice(lastDot + 1).toLowerCase();
  if (tld.length < 2 || tld.length > 24) return true;
  for (let i = 0; i < tld.length; i++) {
    const c = tld.charCodeAt(i);
    const ok = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57);
    if (!ok) return true;
  }
  return false;
}

export function isValidEmailFormat(email: string | null | undefined): boolean {
  return !isInvalidEmailFormat(email);
}

export function isProviderTypoDomain(domainLower: string | null | undefined): boolean {
  if (!domainLower) return false;
  return PROVIDER_TYPO_DOMAINS.has(domainLower.trim().toLowerCase());
}

export function isFakeEmailPattern(email: string | null | undefined): boolean {
  if (email == null) return false;
  const t = normalizeEmail(email);
  if (!t) return false;
  const dom = getEmailDomain(email);
  if (dom && isProviderTypoDomain(dom)) return true;
  if (FAKE_EXACT_EMAILS.has(t)) return true;
  for (const suf of EXAMPLE_DOMAIN_SUFFIXES) {
    if (t.endsWith(suf)) return true;
  }
  const at = t.indexOf('@');
  if (at <= 0) return false;
  const local = t.slice(0, at);
  const domain = t.slice(at + 1);
  for (const p of SUSPICIOUS_LOCAL_PREFIXES) {
    if (local === p || local.startsWith(`${p}.`) || local.startsWith(`${p}+`)) return true;
  }
  if (local === 'admin' && domain === 'admin.com') return true;
  if (local === 'test' && domain === 'test.com') return true;
  if (local === 'user' && domain === 'user.com') return true;
  return false;
}

function countDigits(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) n++;
  }
  return n;
}

export function isSuspiciousDomainHeuristic(domainLower: string): boolean {
  if (!domainLower) return false;
  const d = domainLower.trim().toLowerCase();
  if (d.length >= 40) return true;
  const lastDot = d.lastIndexOf('.');
  if (lastDot > 0 && lastDot < d.length - 1) {
    const tld = d.slice(lastDot + 1);
    if (tld.length <= 3 && RARE_TLDS.has(tld)) return true;
  }
  if (d.length >= MIN_DOMAIN_LEN_FOR_DIGIT_HEURISTIC && d.length <= MAX_DOMAIN_LEN_FOR_DIGIT_HEURISTIC) {
    const digits = countDigits(d);
    if (digits > 0 && digits / d.length >= HIGH_DOMAIN_DIGIT_RATIO) return true;
  }
  return false;
}

export type DetectSuspiciousEmailContext = {
  duplicateNormalizedEmails?: ReadonlySet<string>;
  domainTotalCounts?: ReadonlyMap<string, number>;
  highVolumeDomainThreshold?: number;
  emailVerified?: boolean | null;
  /** Se omitido, usa `TRUSTED_EMAIL_DOMAINS`. */
  trustedDomains?: ReadonlySet<string>;
};

const DEFAULT_HIGH_VOLUME = 8;

function trustedSet(ctx: DetectSuspiciousEmailContext): ReadonlySet<string> {
  return ctx.trustedDomains ?? TRUSTED_SET;
}

/**
 * Motivos ligados ao endereço de email (formato, domínio, duplicados).
 */
export function detectSuspiciousEmail(
  email: string | null | undefined,
  ctx: DetectSuspiciousEmailContext = {}
): SuspiciousEmailReasonCode[] {
  const reasons: SuspiciousEmailReasonCode[] = [];
  const push = (r: SuspiciousEmailReasonCode) => {
    if (!reasons.includes(r)) reasons.push(r);
  };

  if (isInvalidEmailFormat(email)) {
    push('invalid_format');
    return reasons;
  }

  const dom = getEmailDomain(email);
  if (!dom) {
    push('invalid_format');
    return reasons;
  }

  const dLower = dom.toLowerCase();

  if (isProviderTypoDomain(dLower)) {
    push('fake_pattern');
  }

  if (isTemporaryEmailDomain(dLower)) {
    push('temporary_domain');
  }

  if (isFakeEmailPattern(email)) {
    push('fake_pattern');
  }

  const norm = normalizeEmail(email);
  if (norm && ctx.duplicateNormalizedEmails?.has(norm)) {
    push('duplicate_email');
  }

  if (ctx.emailVerified === false) {
    push('unverified_email');
  }

  if (isSuspiciousDomainHeuristic(dLower)) {
    push('suspicious_domain');
  }

  const thr = ctx.highVolumeDomainThreshold ?? DEFAULT_HIGH_VOLUME;
  if (ctx.domainTotalCounts) {
    const c = ctx.domainTotalCounts.get(dLower) ?? 0;
    if (c >= thr && (isTemporaryEmailDomain(dLower) || isSuspiciousDomainHeuristic(dLower) || isFakeEmailPattern(email))) {
      push('suspicious_domain');
    }
  }

  const tset = trustedSet(ctx);
  if (!isTemporaryEmailDomain(dLower) && !isProviderTypoDomain(dLower) && !tset.has(dLower)) {
    push('domain_not_trusted');
  }

  return reasons;
}

export { TRUSTED_EMAIL_DOMAINS } from './trustedEmailDomains.js';