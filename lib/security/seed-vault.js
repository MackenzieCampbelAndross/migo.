import crypto from 'crypto';

const VERSION = 'v1';
const IV_BYTES = 12;

function getKey() {
  const raw = process.env.WALLET_ENCRYPTION_KEY;
  if (!raw) throw new Error('Wallet encryption is not configured');

  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (key.length !== 32) {
    throw new Error('WALLET_ENCRYPTION_KEY must decode to 32 bytes');
  }

  return key;
}

export function encryptSecret(value, aad) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid secret');
  if (typeof aad !== 'string' || aad.length < 3) throw new Error('Invalid secret binding');

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(blob, aad) {
  if (typeof blob !== 'string' || typeof aad !== 'string') {
    throw new Error('Invalid encrypted secret');
  }

  const parts = blob.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unsupported encrypted secret format');
  }

  const [, ivPart, tagPart, ciphertextPart] = parts;
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  const ciphertext = Buffer.from(ciphertextPart, 'base64url');

  if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Invalid encrypted secret');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function encryptSeed(seed, userId) {
  if (typeof seed !== 'string' || seed.length < 20) throw new Error('Invalid seed');
  if (typeof userId !== 'string' || userId.length < 10) throw new Error('Invalid user binding');
  return encryptSecret(seed, userId);
}

export function decryptSeed(blob, userId) {
  if (typeof userId !== 'string' || userId.length < 10) throw new Error('Invalid user binding');
  return decryptSecret(blob, userId);
}
