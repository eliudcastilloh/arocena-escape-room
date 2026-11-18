import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

const MAX_BODY_BYTES = 4096;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function reply(status, body, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function failure(status, code, headers) {
  return reply(status, { success: false, code }, headers);
}

function invalidBody(status = 400) {
  const error = new Error('invalid_body');
  error.status = status;
  return error;
}

async function readLimitedJSON(request) {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) throw invalidBody();
    if (Number(contentLength) > MAX_BODY_BYTES) throw invalidBody(413);
  }
  if (!request.body) throw invalidBody();

  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw invalidBody(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw invalidBody();
  }
}

function trustedClientIP(request) {
  // Vercel sets this header itself. Never fall back to user-controlled forwarding
  // headers in a deployed Vercel function.
  let forwarded = request.headers.get('x-vercel-forwarded-for');
  if (!process.env.VERCEL) {
    forwarded ||= request.headers.get('x-forwarded-for') || '127.0.0.1';
  }
  const address = forwarded?.split(',')[0].trim().toLowerCase();
  return address && isIP(address) ? address : null;
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return failure(405, 'method_not_allowed', { Allow: 'POST' });
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return failure(415, 'unsupported_media_type');
    }

    // The browser submits to this same-origin endpoint; no cross-origin access
    // or cookies are required. Non-browser clients may omit the Origin header.
    const origin = request.headers.get('origin');
    try {
      if ((origin && new URL(origin).origin !== new URL(request.url).origin)
        || request.headers.get('sec-fetch-site') === 'cross-site') {
        return failure(403, 'forbidden_origin');
      }
    } catch {
      return failure(403, 'forbidden_origin');
    }

    let body;
    try {
      body = await readLimitedJSON(request);
    } catch (error) {
      return failure(error.status === 413 ? 413 : 400, error.status === 413 ? 'payload_too_large' : 'invalid_input');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return failure(400, 'invalid_input');
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const website = body.website ?? '';
    if ([...name].length < 1 || [...name].length > 80
      || email.length > 160 || !EMAIL_PATTERN.test(email)
      || body.consent !== true
      || typeof website !== 'string' || website.trim() !== '') {
      return failure(400, 'invalid_input');
    }

    const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    const salt = process.env.RATE_LIMIT_SALT;
    let upstreamURL;
    try {
      const projectURL = new URL(process.env.SUPABASE_URL);
      if (projectURL.protocol !== 'https:' || !projectURL.hostname.endsWith('.supabase.co')
        || projectURL.username || projectURL.password
        || !apiKey?.startsWith('sb_publishable_') || !salt || salt.length < 32) {
        return failure(503, 'temporarily_unavailable');
      }
      upstreamURL = new URL('/rest/v1/rpc/register_escape_room_interest', projectURL);
    } catch {
      return failure(503, 'temporarily_unavailable');
    }

    const clientIP = trustedClientIP(request);
    if (!clientIP) return failure(503, 'temporarily_unavailable');
    const requestHash = createHmac('sha256', salt).update(clientIP).digest('hex');

    try {
      const response = await fetch(upstreamURL, {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ p_name: name, p_email: email, p_consent: true, p_request_hash: requestHash }),
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      if (response.status === 429) {
        return failure(429, 'rate_limited', { 'Retry-After': '600' });
      }
      if (!response.ok) return failure(502, 'registration_unavailable');
      const result = await response.json().catch(() => null);
      if (result?.success === true) return reply(200, { success: true });
      if (result?.code === 'rate_limited') {
        return failure(429, 'rate_limited', { 'Retry-After': '600' });
      }
      if (result?.code === 'validation_error') return failure(400, 'invalid_input');
      return failure(502, 'registration_unavailable');
    } catch {
      // Never log submitted contact data, the IP address, credentials or raw
      // database/network errors. A failed/ambiguous save is never confirmed.
      return failure(503, 'temporarily_unavailable');
    }
  },
};
