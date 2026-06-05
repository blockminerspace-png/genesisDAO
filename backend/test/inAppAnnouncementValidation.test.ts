import { describe, expect, it } from 'vitest';
import {
  InAppAnnouncementValidationError,
  parseAnnouncementId,
  parseCreateInput,
  parseOptionalHttpsLink,
  parseOptionalSelfImagePath,
  parsePriority,
  parseUpdateInput
} from '../validation/inAppAnnouncementValidation.js';

describe('inAppAnnouncementValidation', () => {
  it('rejeita link javascript:', () => {
    expect(() => parseOptionalHttpsLink('javascript:alert(1)')).toThrow(InAppAnnouncementValidationError);
  });

  it('aceita link https válido', () => {
    expect(parseOptionalHttpsLink('https://example.com/path')).toBe('https://example.com/path');
  });

  it('rejeita imageUrl externa', () => {
    expect(() => parseOptionalSelfImagePath('https://evil.com/x.png')).toThrow(
      InAppAnnouncementValidationError
    );
  });

  it('rejeita path com directory traversal', () => {
    expect(() => parseOptionalSelfImagePath('/img/uploads/../../../etc/passwd')).toThrow(
      InAppAnnouncementValidationError
    );
  });

  it('aceita path /img/uploads/ seguro', () => {
    expect(parseOptionalSelfImagePath('/img/uploads/ad-123-456.png')).toBe('/img/uploads/ad-123-456.png');
  });

  it('parsePriority faz clamp a 1000', () => {
    expect(parsePriority(999999)).toBe(1000);
  });

  it('parseCreateInput rejeita título vazio', () => {
    expect(() =>
      parseCreateInput({ title: '  ', message: 'ok', link: null, imageUrl: null })
    ).toThrow(InAppAnnouncementValidationError);
  });

  it('parseUpdateInput valida intervalo de datas', () => {
    expect(() =>
      parseUpdateInput({ startsAt: 5000, endsAt: 1000 })
    ).toThrow(InAppAnnouncementValidationError);
  });

  it('parseAnnouncementId exige UUID v4', () => {
    expect(() => parseAnnouncementId('not-a-uuid')).toThrow(InAppAnnouncementValidationError);
    expect(parseAnnouncementId('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    );
  });
});
