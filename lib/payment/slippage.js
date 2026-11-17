export const DEFAULT_SLIPPAGE_BPS = 50;

export function calculateMinReceived(amount, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Invalid amount');
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 1000) {
    throw new Error('Invalid slippage');
  }

  const minimum = value * (1 - slippageBps / 10_000);
  return minimum.toFixed(6);
}

export function deliveredAtLeast(delivered, minimum) {
  const actual = Number(delivered);
  const required = Number(minimum);
  return Number.isFinite(actual) && Number.isFinite(required) && actual + 1e-9 >= required;
}
