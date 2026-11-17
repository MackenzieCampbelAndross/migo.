import { ApiError, readJson, withApi } from '@/lib/api';
import { getWalletByUserId, requireUser } from '@/lib/auth';
import { safeLog } from '@/lib/logger';
import { enforceRateLimit, enforceUserAndIpRateLimit } from '@/lib/rate-limit';
import { getIssuerAddress } from '@/lib/xrpl-config';
import { getQuote } from '@/lib/xrpl-payment';
import { chatSchema, CURRENCIES } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SYSTEM_PROMPT = `You are Xenmo Assistant, a helpful chatbot for a testnet cross-border payment demo built on the XRP Ledger.

About Xenmo/Migo:
- Testnet demo only. No real money is involved.
- Supports USD, INR, EUR and NGN test tokens.
- Three ways to send: QR scan, claim code, or direct address.
- Fees include the XRPL network fee and any AMM/DEX spread shown in the quote.
- Settlement is typically a few seconds on the XRPL testnet.
- Rates come from the XRPL testnet AMM/DEX when available; otherwise a clearly-labelled fallback rate is used.

How to use:
- Create a wallet after signing in, or import an existing testnet wallet.
- Send money from the Send tab using a username or r-address.
- Share your QR code or wallet address to receive money.
- Claim codes are 10 characters. Unclaimed codes can be refunded after expiry.
- Request money from the Request tab.

Security:
- Funds and claim codes auto-expire; refunded value returns to the sender.
- Trust lines limit which issued tokens a wallet accepts.
- Never share a wallet seed in chat.

Keep responses short, friendly and focused on helping the user. If asked about something unrelated to payments, gently redirect.
When live quote data is provided, use those exact numbers and mention the rate source.`;

function detectRateQuery(message) {
  const upper = message.toUpperCase();
  const mentioned = CURRENCIES.filter((currency) => upper.includes(currency));
  if (mentioned.length >= 2 && /rate|convert|exchange|how much|cost|worth|send/i.test(message)) {
    return { from: mentioned[0], to: mentioned[1] };
  }
  return null;
}

export async function POST(req) {
  return withApi(req, async () => {
    const user = await requireUser();

    await enforceUserAndIpRateLimit(req, user.id, 'chat:send', {
      userLimit: 20,
      ipLimit: 40,
      windowSeconds: 60,
      failClosed: true,
    });
    await enforceRateLimit({
      key: 'chat:global',
      limit: 500,
      windowSeconds: 60 * 60,
      failClosed: true,
    });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new ApiError(503, 'Assistant is not configured');

    const body = await readJson(req, chatSchema, 4 * 1024);

    let rateContext = '';
    const rateQuery = detectRateQuery(body.message);
    if (rateQuery) {
      try {
        const wallet = await getWalletByUserId(user.id);
        if (wallet) {
          const quote = await getQuote({
            fromCurrency: rateQuery.from,
            toCurrency: rateQuery.to,
            amount: '100',
            senderAddress: wallet.address,
            receiverAddress: getIssuerAddress(rateQuery.to),
          });
          rateContext = `\n\n[LIVE TESTNET QUOTE]\n` +
            `${rateQuery.from} -> ${rateQuery.to}: 1 ${rateQuery.from} ~= ${quote.rate.toFixed(4)} ${rateQuery.to}\n` +
            `100 ${rateQuery.from} ~= ${quote.estimatedReceive} ${rateQuery.to}\n` +
            `Minimum received: ${quote.minReceived} ${rateQuery.to}\n` +
            `Rate source: ${quote.rateSource}\n` +
            `Estimated fee: ${quote.fee}`;
        }
      } catch {
        safeLog('warn', 'chat.rate_context_failed', {});
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ parts: [{ text: body.message + rateContext }] }],
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        safeLog('error', 'chat.provider_failed', { status: response.status });
        throw new ApiError(502, 'Chat is temporarily unavailable');
      }

      const data = await response.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!reply) throw new ApiError(502, 'Chat is temporarily unavailable');

      return { reply };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      safeLog('error', 'chat.request_failed', { code: error?.name || 'UnknownError' });
      throw new ApiError(502, 'Chat is temporarily unavailable');
    } finally {
      clearTimeout(timeout);
    }
  });
}
