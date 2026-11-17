import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { decryptSecret, encryptSecret } from './seed-vault.js';

const scrypt = promisify(scryptCallback);
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashDeviceCredential(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pepperPin(pin) {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must contain four digits');
  const key = process.env.WALLET_ENCRYPTION_KEY;
  if (!key) throw new Error('PIN protection is not configured');
  return createHmac('sha256', key).update(`migo:device-pin:${pin}`).digest();
}

export async function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(pepperPin(pin), salt, 32, SCRYPT_OPTIONS);
  return `s1.${salt}.${derived.toString('hex')}`;
}

export async function verifyPin(pin, stored) {
  if (!/^\d{4}$/.test(pin) || !/^s1\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(stored)) return false;
  const [, salt, expected] = stored.split('.');
  const actual = await scrypt(pepperPin(pin), salt, 32, SCRYPT_OPTIONS);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export function issueGrant(scope, userId, payload, ttlSeconds) {
  return encryptSecret(JSON.stringify({ ...payload, userId, expiresAt: Date.now() + ttlSeconds * 1000 }), `migo:${scope}:${userId}`);
}

export function readGrant(scope, userId, token) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  try {
    const payload = JSON.parse(decryptSecret(token, `migo:${scope}:${userId}`));
    if (payload.userId !== userId || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
