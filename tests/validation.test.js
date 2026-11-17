import { describe, expect, it } from 'vitest';
import {
  addressSchema,
  amountSchema,
  claimCodeSchema,
  paymentSchema,
  requestActionSchema,
  usernameSchema,
  uuidSchema,
} from '../lib/validation.js';

const VALID_ADDRESS = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const VALID_UUID = '00000000-0000-4000-8000-000000000001';

describe('input validation', () => {
  it('accepts finite positive amounts only', () => {
    expect(amountSchema.safeParse('100').success).toBe(true);
    expect(amountSchema.safeParse('0.000001').success).toBe(true);
    expect(amountSchema.safeParse('999999999.999999').success).toBe(true);

    for (const bad of ['0', '-1', 'NaN', 'Infinity', '1e3', '1.1234567', '1000000000', '00.5']) {
      expect(amountSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('validates XRPL classic addresses', () => {
    expect(addressSchema.safeParse(VALID_ADDRESS).success).toBe(true);
    expect(addressSchema.safeParse('rNotARealAddress').success).toBe(false);
    expect(addressSchema.safeParse('').success).toBe(false);
  });

  it('normalizes usernames and rejects reserved names', () => {
    const result = usernameSchema.safeParse('Alice_01');
    expect(result.success).toBe(true);
    expect(result.data).toBe('alice_01');

    for (const bad of ['ab', 'admin', 'hello world', 'a'.repeat(21), 'name!']) {
      expect(usernameSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('validates claim codes with or without separators', () => {
    expect(claimCodeSchema.safeParse('ABCDE-FGHJK').success).toBe(true);
    expect(claimCodeSchema.safeParse('ABCDEFGHJK').success).toBe(true);
    expect(claimCodeSchema.safeParse('short').success).toBe(false);
  });

  it('rejects unknown payment fields and missing idempotency keys', () => {
    const valid = {
      to: '@alice',
      amount: '10',
      fromCurrency: 'USD',
      toCurrency: 'INR',
      idempotencyKey: VALID_UUID,
    };

    expect(paymentSchema.safeParse(valid).success).toBe(true);
    expect(paymentSchema.safeParse({ ...valid, extra: 'no' }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...valid, idempotencyKey: undefined }).success).toBe(false);
  });

  it('allows only approved/declined request actions', () => {
    expect(requestActionSchema.safeParse({ requestId: VALID_UUID, action: 'approved' }).success).toBe(true);
    expect(requestActionSchema.safeParse({ requestId: VALID_UUID, action: 'declined' }).success).toBe(true);
    expect(requestActionSchema.safeParse({ requestId: VALID_UUID, action: 'paid' }).success).toBe(false);
  });

  it('validates UUIDs', () => {
    expect(uuidSchema.safeParse(VALID_UUID).success).toBe(true);
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});
