const SENSITIVE_KEY = /(seed|secret|private|token|password|authorization|cookie|api[_-]?key|claim[_-]?code|code[_-]?hash)/i;
const SEED_PATTERN = /\bs(?:Ed|ec)[1-9A-HJ-NP-Za-km-z]{20,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._-]+\b/gi;

export function redactString(value) {
  return String(value).replace(SEED_PATTERN, '[REDACTED_SEED]').replace(BEARER_PATTERN, 'Bearer [REDACTED]');
}

export function redact(value, depth = 0) {
  if (depth > 5) return '[TRUNCATED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}
