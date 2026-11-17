// Crockford-style base32 without I, L, O or U. 10 characters = 50 bits.
export const CLAIM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CLAIM_CODE_LENGTH = 10;
export const CLAIM_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;

export function normalizeClaimCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

export function isValidClaimCodeFormat(input) {
  return CLAIM_CODE_PATTERN.test(normalizeClaimCode(input));
}

export function formatClaimCode(normalized) {
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}
