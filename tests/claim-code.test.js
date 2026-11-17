import { beforeEach, describe, expect, it } from 'vitest';
import {
  generateClaimCode,
  hashClaimCode,
  codeToCondition,
} from '../lib/security/claim-code.js';
import {
  isValidClaimCodeFormat,
  normalizeClaimCode,
} from '../lib/claim-code-format.js';

describe('claim codes', () => {
  beforeEach(() => {
    process.env.CLAIM_CODE_PEPPER = 'test-pepper-not-a-real-secret';
  });

  it('generates a formatted 10-character code', () => {
    const code = generateClaimCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(normalizeClaimCode(code)).toHaveLength(10);
    expect(isValidClaimCodeFormat(code)).toBe(true);
  });

  it('normalizes separators and ambiguous characters', () => {
    expect(normalizeClaimCode('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(normalizeClaimCode('OOOOO-11111')).toBe('0000011111');
    expect(normalizeClaimCode('IIIII-UUUUU')).toBe('11111VVVVV');
    expect(isValidClaimCodeFormat('bad')).toBe(false);
  });

  it('hashes deterministically without storing the code', () => {
    const code = 'ABCDE-FGHJK';
    const first = hashClaimCode(code);
    const second = hashClaimCode('abcde fghjk');

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
    expect(first).not.toContain('ABCDE');
  });

  it('derives deterministic condition and fulfillment values', () => {
    const first = codeToCondition('ABCDE-FGHJK');
    const second = codeToCondition('ABCDE-FGHJK');
    const other = codeToCondition('ABCDE-FGHJM');

    expect(first).toEqual(second);
    expect(first.conditionHex).toMatch(/^A0258020[0-9A-F]{64}810120$/);
    expect(first.fulfillmentHex).toMatch(/^A0228020[0-9A-F]{64}$/);
    expect(other.conditionHex).not.toBe(first.conditionHex);
  });
});
