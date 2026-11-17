import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock server-only before importing internal modules
vi.mock('server-only', () => ({}));

// Read .env.local into process.env if not already present
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

import * as xrpl from 'xrpl';
import { createAdminClient } from '../lib/supabase/admin.js';
import { getQuote } from '../lib/xrpl-payment.js';
import { executePayment } from '../lib/payment-service.js';
import { getClient } from '../lib/xrpl-client.js';

describe('Live XRPL & Payment Flow Test', () => {
  let senderWalletRecord;
  let receiverWalletRecord;
  let senderUser;
  let receiverUser;

  beforeAll(async () => {
    const admin = createAdminClient();
    const { data: wallets, error } = await admin
      .from('wallets')
      .select('id, user_id, address, encrypted_seed');

    expect(error).toBeNull();
    expect(wallets?.length).toBeGreaterThanOrEqual(2);

    senderWalletRecord = wallets.find((w) => w.address === 'rGsKfhmgpFnrSijpAbLGe2BRkEsDbNzg5x'); // mac
    receiverWalletRecord = wallets.find((w) => w.address === 'rB7qoHQ8wUXvPqiCmxPXrqN4UZPdLWpbwp'); // rag

    expect(senderWalletRecord).toBeDefined();
    expect(receiverWalletRecord).toBeDefined();
  });

  it('connects to XRPL testnet successfully', async () => {
    const client = await getClient();
    expect(client.isConnected()).toBe(true);
  }, 25000);

  it('fetches a valid live quote for direct USD payment', async () => {
    const quote = await getQuote({
      fromCurrency: 'USD',
      toCurrency: 'USD',
      amount: '0.10',
      senderAddress: senderWalletRecord.address,
      receiverAddress: receiverWalletRecord.address,
    });

    console.log('Direct USD Quote:', quote);
    expect(quote.fromCurrency).toBe('USD');
    expect(quote.toCurrency).toBe('USD');
    expect(Number(quote.amount)).toBe(0.1);
    expect(quote.rate).toBe(1);
    expect(quote.minReceived).toBe('0.100000');
  }, 25000);

  it('fetches a valid cross-currency quote (USD -> INR) via DEX pathfinding', async () => {
    const quote = await getQuote({
      fromCurrency: 'USD',
      toCurrency: 'INR',
      amount: '0.10',
      senderAddress: senderWalletRecord.address,
      receiverAddress: receiverWalletRecord.address,
    });

    console.log('Cross-currency Quote (USD -> INR):', quote);
    expect(quote.fromCurrency).toBe('USD');
    expect(quote.toCurrency).toBe('INR');
    expect(Number(quote.estimatedReceive)).toBeGreaterThan(0);
    expect(Number(quote.rate)).toBeGreaterThan(0);
  });

  it('executes a real end-to-end payment on XRPL testnet and logs to DB without errors', async () => {
    const idempotencyKey = 'test-e2e-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const amountToSend = '0.05';

    console.log(`Executing payment: ${amountToSend} USD from ${senderWalletRecord.address} to ${receiverWalletRecord.address}`);

    const result = await executePayment({
      userId: senderWalletRecord.user_id,
      walletRecord: senderWalletRecord,
      toAddress: receiverWalletRecord.address,
      amount: amountToSend,
      fromCurrency: 'USD',
      toCurrency: 'USD',
      idempotencyKey,
    });

    console.log('Payment Execution Result:', result);

    expect(result.status).toBe('CONFIRMED');
    expect(result.hash).toBeDefined();
    expect(result.hash.length).toBe(64);
    expect(result.amountSent).toBe('0.05');
    expect(result.currencySent).toBe('USD');

    // Verify on the XRPL ledger directly
    const client = await getClient();
    const txInfo = await client.request({
      command: 'tx',
      transaction: result.hash,
    });

    expect(txInfo.result.validated).toBe(true);
    expect(txInfo.result.meta.TransactionResult).toBe('tesSUCCESS');

    // Verify written to Supabase payments table
    const admin = createAdminClient();
    const { data: dbPayment, error: dbError } = await admin
      .from('payments')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .single();

    expect(dbError).toBeNull();
    expect(dbPayment).toBeDefined();
    expect(dbPayment.tx_hash).toBe(result.hash);
    expect(dbPayment.status).toBe('CONFIRMED');
    console.log('Verified on Ledger and DB:', dbPayment.tx_hash);
  }, 45000); // 45s timeout for XRPL ledger validation

  it('executes a cross-currency payment (USD -> INR) across AMM DEX liquidity', async () => {
    const idempotencyKey = 'test-e2e-fx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const amountToSend = '0.05';

    console.log(`Executing cross-currency payment: ${amountToSend} USD -> INR to ${receiverWalletRecord.address}`);

    const result = await executePayment({
      userId: senderWalletRecord.user_id,
      walletRecord: senderWalletRecord,
      toAddress: receiverWalletRecord.address,
      amount: amountToSend,
      fromCurrency: 'USD',
      toCurrency: 'INR',
      idempotencyKey,
    });

    console.log('Cross-Currency Payment Execution Result:', result);

    expect(result.status).toBe('CONFIRMED');
    expect(result.hash).toBeDefined();
    expect(result.currencySent).toBe('USD');
    expect(result.currencyReceived).toBe('INR');
    expect(Number(result.amountReceived)).toBeGreaterThan(0);

    // Verify on the XRPL ledger directly
    const client = await getClient();
    const txInfo = await client.request({
      command: 'tx',
      transaction: result.hash,
    });

    expect(txInfo.result.validated).toBe(true);
    expect(txInfo.result.meta.TransactionResult).toBe('tesSUCCESS');
    console.log('Cross-currency confirmed on ledger with hash:', result.hash);
  }, 45000);
});
