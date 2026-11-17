import { z } from 'zod';
import * as xrpl from 'xrpl';
import { isValidClaimCodeFormat } from './claim-code-format.js';

export const CURRENCIES = ['USD', 'INR', 'EUR', 'NGN'];

const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'official',
  'migo', 'xenmo', 'remitx', 'wallet', 'pay', 'payment', 'payments', 'claim',
  'claims', 'login', 'signin', 'signup', 'register', 'api', 'www', 'app',
  'security', 'team', 'staff', 'service', 'bank', 'escrow', 'split', 'send',
  'receive', 'test', 'demo', 'guest', 'anonymous',
]);

export const MAX_AMOUNT = 1_000_000_000;

export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

export const currencySchema = z.enum(CURRENCIES);

export const amountSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/, 'Invalid amount')
  .refine((value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number <= MAX_AMOUNT;
  }, 'Invalid amount');

export const addressSchema = z
  .string()
  .trim()
  .refine((value) => xrpl.isValidClassicAddress(value), 'Invalid XRPL address');

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9_]+$/, 'Invalid username')
  .transform((value) => value.toLowerCase())
  .refine((value) => !RESERVED_USERNAMES.has(value), 'Username is not available');

export const displayNameSchema = z
  .string()
  .trim()
  .max(50)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Invalid display name')
  .default('');

export const recipientSchema = z.string().trim().min(3).max(64);

export const claimCodeSchema = z
  .string()
  .trim()
  .min(10)
  .max(12)
  .refine((value) => isValidClaimCodeFormat(value), 'Invalid claim code');

export const uuidSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'Invalid id');

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9:_-]+$/, 'Invalid idempotency key');

export const seedSchema = z.string().trim().min(20).max(120);

export const createWalletSchema = z.object({
  displayName: displayNameSchema,
  baseCurrency: currencySchema.default('USD'),
  username: usernameSchema,
}).strict();

export const importWalletSchema = z.object({
  seed: seedSchema,
  displayName: displayNameSchema,
  baseCurrency: currencySchema.default('USD'),
  username: usernameSchema.optional(),
}).strict();

export const quoteQuerySchema = z.object({
  fromCurrency: currencySchema,
  toCurrency: currencySchema,
  amount: amountSchema,
  recipient: recipientSchema,
}).strict();

export const paymentSchema = z.object({
  to: recipientSchema,
  amount: amountSchema,
  fromCurrency: currencySchema,
  toCurrency: currencySchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const escrowCreateSchema = z.object({
  amount: amountSchema,
  currency: currencySchema,
  to: recipientSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
  cancelSeconds: z.coerce.number().int().min(60).max(900).default(300),
}).strict();

export const escrowClaimSchema = z.object({
  code: claimCodeSchema,
  escrowId: uuidSchema.optional(),
}).strict();

export const escrowRefundSchema = z.object({
  escrowId: uuidSchema,
}).strict();

export const splitCreateSchema = z.object({
  currency: currencySchema,
  idempotencyKey: idempotencyKeySchema,
  cancelSeconds: z.coerce.number().int().min(60).max(900).default(600),
  splits: z.array(z.object({
    to: recipientSchema,
    amount: amountSchema,
  }).strict()).min(1).max(10),
}).strict();

export const splitClaimSchema = z.object({
  escrowId: uuidSchema,
  code: claimCodeSchema,
}).strict();

export const requestCreateSchema = z.object({
  to: recipientSchema,
  amount: amountSchema,
  currency: currencySchema,
}).strict();

export const requestActionSchema = z.object({
  requestId: uuidSchema,
  action: z.enum(['approved', 'declined']),
}).strict();

export const chatSchema = z.object({
  message: z.string().trim().min(1).max(500),
}).strict();

export const usernameQuerySchema = z.object({
  username: usernameSchema,
}).strict();

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const escrowListQuerySchema = z.object({}).strict();

export const splitListQuerySchema = z.object({
  groupId: uuidSchema.optional(),
}).strict();
