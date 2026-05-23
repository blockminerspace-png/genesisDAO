import { describe, it, expect } from 'vitest';
import { EmailPolicyError, IpLimitError } from '../models/userModel.js';

describe('userModel errors', () => {
  it('EmailPolicyError', () => {
    const e = new EmailPolicyError('msg');
    expect(e.code).toBe('EMAIL_POLICY');
    expect(e.message).toBe('msg');
  });

  it('IpLimitError', () => {
    const e = new IpLimitError('limite');
    expect(e.message).toBe('limite');
  });
});
