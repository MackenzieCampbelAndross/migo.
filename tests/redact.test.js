import { describe, expect, it } from 'vitest';
import { redact } from '../lib/security/redact.js';

describe('log redaction', () => {
  it('redacts sensitive field names recursively', () => {
    const result = redact({
      userId: 'user-1',
      seed: 'sEdAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      nested: {
        authorization: 'Bearer abc.def.ghi',
        claimCode: 'ABCDE-FGHJK',
        safe: 'visible',
      },
    });

    expect(result.userId).toBe('user-1');
    expect(result.seed).toBe('[REDACTED]');
    expect(result.nested.authorization).toBe('[REDACTED]');
    expect(result.nested.claimCode).toBe('[REDACTED]');
    expect(result.nested.safe).toBe('visible');
  });

  it('redacts seed-like strings inside messages', () => {
    const fakeSeed = `sEd${'A'.repeat(30)}`;
    const result = redact({ message: `failed for ${fakeSeed}` });
    expect(result.message).not.toContain(fakeSeed);
    expect(result.message).toContain('[REDACTED_SEED]');
  });
});
