import { describe, expect, it } from 'vitest';
import {
  calculateMinReceived,
  deliveredAtLeast,
} from '../lib/payment/slippage.js';

describe('slippage protection', () => {
  it('calculates a minimum received amount', () => {
    expect(calculateMinReceived('100', 50)).toBe('99.500000');
    expect(calculateMinReceived('0.1', 50)).toBe('0.099500');
    expect(calculateMinReceived('100', 0)).toBe('100.000000');
  });

  it('rejects invalid amounts and slippage', () => {
    expect(() => calculateMinReceived('0')).toThrow();
    expect(() => calculateMinReceived('-1')).toThrow();
    expect(() => calculateMinReceived('100', -1)).toThrow();
    expect(() => calculateMinReceived('100', 5000)).toThrow();
  });

  it('compares delivered amounts safely', () => {
    expect(deliveredAtLeast('99.5', '99.5')).toBe(true);
    expect(deliveredAtLeast('99.500001', '99.5')).toBe(true);
    expect(deliveredAtLeast('99.49', '99.5')).toBe(false);
    expect(deliveredAtLeast('NaN', '99.5')).toBe(false);
  });
});
