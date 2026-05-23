import { describe, expect, it } from 'vitest';
import {
  getClientIpFromRequest,
  isUsablePublicClientIp,
  normalizeClientIp,
  resolveRegistrationIp
} from '../utils/clientIp.js';

describe('normalizeClientIp', () => {
  it('remove prefixo IPv6 mapeado', () => {
    expect(normalizeClientIp('::ffff:203.0.113.50')).toBe('203.0.113.50');
  });

  it('usa primeiro hop de XFF', () => {
    expect(normalizeClientIp(' 203.0.113.1, 10.0.0.1 ')).toBe('203.0.113.1');
  });
});

describe('isUsablePublicClientIp', () => {
  it('rejeita privados e loopback', () => {
    expect(isUsablePublicClientIp('127.0.0.1')).toBe(false);
    expect(isUsablePublicClientIp('10.0.0.5')).toBe(false);
    expect(isUsablePublicClientIp('192.168.1.1')).toBe(false);
    expect(isUsablePublicClientIp('unknown')).toBe(false);
  });

  it('aceita IP público', () => {
    expect(isUsablePublicClientIp('203.0.113.50')).toBe(true);
  });
});

describe('resolveRegistrationIp', () => {
  it('devolve null para IP interno (não conta no limite)', () => {
    expect(resolveRegistrationIp('10.0.0.1')).toBeNull();
  });

  it('normaliza IP público', () => {
    expect(resolveRegistrationIp('::ffff:203.0.113.50')).toBe('203.0.113.50');
  });
});

describe('getClientIpFromRequest', () => {
  it('prefere CF-Connecting-IP quando há cf-ray', () => {
    const ip = getClientIpFromRequest({
      ip: '10.0.0.1',
      headers: {
        'cf-ray': 'abc123',
        'cf-connecting-ip': '203.0.113.77',
        'x-forwarded-for': '198.51.100.1'
      },
      socket: { remoteAddress: '127.0.0.1' }
    });
    expect(ip).toBe('203.0.113.77');
  });

  it('usa primeiro IP público em XFF quando req.ip é privado', () => {
    const ip = getClientIpFromRequest({
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.88, 10.0.0.1' },
      socket: { remoteAddress: '10.0.0.1' }
    });
    expect(ip).toBe('203.0.113.88');
  });
});
