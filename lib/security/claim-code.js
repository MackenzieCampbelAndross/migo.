import crypto from 'crypto';
import {
  CLAIM_CODE_ALPHABET,
  CLAIM_CODE_LENGTH,
  formatClaimCode,
  isValidClaimCodeFormat,
  normalizeClaimCode,
} from '../claim-code-format.js';

const DERIVATION_PREFIX = 'xenmo-escrow-v2:';

export function generateClaimCode() {
  const bytes = crypto.randomBytes(CLAIM_CODE_LENGTH);
  let normalized = '';
  for (let i = 0; i < CLAIM_CODE_LENGTH; i += 1) {
    normalized += CLAIM_CODE_ALPHABET[bytes[i] % CLAIM_CODE_ALPHABET.length];
  }
  return formatClaimCode(normalized);
}

export function hashClaimCode(code) {
  const pepper = process.env.CLAIM_CODE_PEPPER;
  if (!pepper) throw new Error('Claim code hashing is not configured');

  const normalized = normalizeClaimCode(code);
  if (!isValidClaimCodeFormat(normalized)) throw new Error('Invalid claim code');

  return crypto.createHmac('sha256', pepper).update(normalized).digest('hex');
}

// The on-chain condition is the hash of a preimage derived from the code.
// Only the condition is stored with the escrow; the code itself is never stored.
export function codeToCondition(code) {
  const normalized = normalizeClaimCode(code);
  if (!isValidClaimCodeFormat(normalized)) throw new Error('Invalid claim code');

  const preimage = crypto
    .createHash('sha256')
    .update(DERIVATION_PREFIX + normalized)
    .digest();

  const fulfillmentHex = `A0228020${preimage.toString('hex')}`.toUpperCase();
  const conditionHash = crypto.createHash('sha256').update(preimage).digest();
  const conditionHex = `A0258020${conditionHash.toString('hex')}810120`.toUpperCase();

  return { conditionHex, fulfillmentHex };
}
