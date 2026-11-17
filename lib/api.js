import 'server-only';
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { safeLog } from './logger.js';

export class ApiError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.headers = headers;
  }
}

function baseHeaders(requestId) {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Vary: 'Cookie',
    'X-Request-Id': requestId,
  };
}

export function assertSameOrigin(req) {
  const origin = req.headers.get('origin');
  const fetchSite = req.headers.get('sec-fetch-site');

  if (fetchSite === 'cross-site') {
    throw new ApiError(403, 'Request blocked');
  }

  if (!origin) {
    if (process.env.NODE_ENV === 'production') {
      throw new ApiError(403, 'Request blocked');
    }
    return;
  }

  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  const requestOrigin = new URL(req.url).origin;

  if (origin !== requestOrigin && (!configured || origin !== configured)) {
    throw new ApiError(403, 'Request blocked');
  }
}

export async function readJson(req, schema, maxBytes = 16 * 1024) {
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'Expected application/json');
  }

  const declaredLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(413, 'Request body too large');
  }

  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new ApiError(413, 'Request body too large');
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'Invalid JSON');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    safeLog('warn', 'api.validation_failed', {
      paths: parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 10),
    });
    throw new ApiError(400, 'Invalid request');
  }

  return parsed.data;
}

export function readQuery(searchParams, schema) {
  const raw = {};
  for (const [key, value] of searchParams.entries()) {
    if (raw[key] !== undefined) throw new ApiError(400, 'Invalid request');
    raw[key] = value;
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    safeLog('warn', 'api.query_validation_failed', {
      paths: parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 10),
    });
    throw new ApiError(400, 'Invalid request');
  }

  return parsed.data;
}

export async function withApi(req, handler, { skipCsrf = false } = {}) {
  const requestId = randomUUID();

  try {
    if (!skipCsrf && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      assertSameOrigin(req);
    }

    const result = await handler({ requestId });
    return NextResponse.json(result, {
      status: 200,
      headers: baseHeaders(requestId),
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status, headers: { ...baseHeaders(requestId), ...err.headers } }
      );
    }

    safeLog('error', 'api.unhandled', {
      requestId,
      method: req.method,
      path: new URL(req.url).pathname,
      error: err?.name || 'UnknownError',
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: baseHeaders(requestId) }
    );
  }
}

export function assertAuthenticated(user) {
  if (!user) throw new ApiError(401, 'Authentication required');
  return user;
}

export function assertOwnership(ownerId, userId) {
  if (!ownerId || ownerId !== userId) {
    throw new ApiError(403, 'You do not have permission to do that');
  }
}
