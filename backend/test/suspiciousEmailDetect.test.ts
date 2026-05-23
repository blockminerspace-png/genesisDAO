import { describe, expect, it } from 'vitest';
import {
  detectSuspiciousEmail,
  getEmailDomain,
  isFakeEmailPattern,
  isInvalidEmailFormat,
  isTemporaryEmailDomain,
  isTrustedEmailDomain,
  isValidEmailFormat,
  normalizeEmail,
} from '../modules/admin/suspiciousEmails/suspiciousEmailDetect.js';

describe('suspiciousEmailDetect', () => {
  it('normalizeEmail', () => {
    expect(normalizeEmail('  A@B.COM ')).toBe('a@b.com');
    expect(normalizeEmail(null)).toBe('');
  });

  it('isValidEmailFormat', () => {
    expect(isValidEmailFormat('a@b')).toBe(false);
    expect(isValidEmailFormat('ok@gmail.com')).toBe(true);
  });

  it('isTrustedEmailDomain', () => {
    expect(isTrustedEmailDomain('gmail.com')).toBe(true);
    expect(isTrustedEmailDomain('proton.me')).toBe(true);
    expect(isTrustedEmailDomain('kk.com')).toBe(false);
  });
  it('getEmailDomain', () => {
    expect(getEmailDomain('  User@Example.COM ')).toBe('example.com');
    expect(getEmailDomain('bad')).toBe(null);
  });

  it('isInvalidEmailFormat', () => {
    expect(isInvalidEmailFormat('')).toBe(true);
    expect(isInvalidEmailFormat('   ')).toBe(true);
    expect(isInvalidEmailFormat('a@b')).toBe(true);
    expect(isInvalidEmailFormat('no-at.com')).toBe(true);
    expect(isInvalidEmailFormat('spaces in@here.com')).toBe(true);
    expect(isInvalidEmailFormat('a@@b.com')).toBe(true);
    expect(isInvalidEmailFormat('ok@here.co.uk')).toBe(false);
  });

  it('isTemporaryEmailDomain', () => {
    expect(isTemporaryEmailDomain('tempmail.com')).toBe(true);
    expect(isTemporaryEmailDomain('gmail.com')).toBe(false);
  });

  it('isFakeEmailPattern', () => {
    expect(isFakeEmailPattern('fake@fake.com')).toBe(true);
    expect(isFakeEmailPattern('someone@example.com')).toBe(true);
    expect(isFakeEmailPattern('no-reply@company.com')).toBe(true);
    expect(isFakeEmailPattern('real@gmail.com')).toBe(false);
  });

  it('detectSuspiciousEmail aggregates reasons', () => {
    const dups = new Set(['fake@fake.com']);
    const r = detectSuspiciousEmail('fake@fake.com', {
      duplicateNormalizedEmails: dups,
      domainTotalCounts: new Map([['fake.com', 20]]),
    });
    expect(r).toContain('fake_pattern');
    expect(r).toContain('duplicate_email');
  });

  it('detectSuspiciousEmail: trusted gmail has no domain_not_trusted', () => {
    const r = detectSuspiciousEmail('user@gmail.com', {});
    expect(r).not.toContain('domain_not_trusted');
  });

  it('detectSuspiciousEmail: unknown domain gets domain_not_trusted', () => {
    const r = detectSuspiciousEmail('u@kk.com', {});
    expect(r).toContain('domain_not_trusted');
  });

  it('detectSuspiciousEmail: provider typo is fake_pattern', () => {
    expect(detectSuspiciousEmail('x@gmai.com', {})).toContain('fake_pattern');
    expect(detectSuspiciousEmail('x@hotmial.com', {})).toContain('fake_pattern');
  });

  it('detectSuspiciousEmail: invalid format returns early with invalid_format only', () => {
    const r = detectSuspiciousEmail('notanemail', {});
    expect(r).toEqual(['invalid_format']);
  });
});
