let unlockToken = null;
let unlockTimer;

export function clearUnlockToken() {
  unlockToken = null;
  clearTimeout(unlockTimer);
}

export function setUnlockToken(token, expiresIn = 900) {
  clearUnlockToken();
  unlockToken = token;
  unlockTimer = setTimeout(() => {
    clearUnlockToken();
    window.dispatchEvent(new Event('migo:locked'));
  }, expiresIn * 1000);
}

export function getUnlockToken() {
  return unlockToken;
}

export class ApiClientError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
  }
}

export async function apiFetch(url, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(unlockToken ? { 'X-Migo-Unlock': unlockToken } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearUnlockToken();
    if (typeof window !== 'undefined') {
      const next = window.location.pathname + window.location.search;
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    }
    throw new ApiClientError('Authentication required', 401);
  }

  const data = await response.json().catch(() => null);

  if (response.status === 423) {
    clearUnlockToken();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('migo:locked'));
  }

  if (!response.ok) {
    const error = new ApiClientError(data?.error || 'Request failed', response.status);
    error.retryAfter = Number(response.headers.get('Retry-After')) || null;
    throw error;
  }

  return data;
}

export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
