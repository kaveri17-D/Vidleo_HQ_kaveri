/**
 * NEXUS Controlled Edge Range Relay — Cloudflare Worker
 * 
 * Strict cryptographic authorization, SSRF prevention, manual redirect revalidation,
 * Range 206 passthrough, and direct zero-buffer streaming.
 */

import { validateTargetUrl, SSRFViolationError } from './ssrf.js';
import { verifyWorkerTicket, TicketValidationError, TicketPayload } from './ticket.js';

export interface Env {
  SIGNED_DOWNLOAD_SECRET?: string;
  DEFAULT_SECRET?: string;
  ALLOWED_ORIGIN?: string;
  MAX_RANGE_BYTES?: number | string;
  ALLOW_LOOPBACK_FOR_TEST?: string;
}

const DEFAULT_SECRET = 'nexus-fallback-ticket-secret-key-change-in-prod';
const DEFAULT_MAX_RANGE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_REDIRECTS = 3;

interface StructuredLog {
  timestamp: string;
  request_id: string;
  job_id: string;
  strategy: 'SIGNED_WORKER_RANGE';
  outcome: 'success' | 'failure';
  status: number;
  upstream_status?: number;
  range_requested?: string;
  content_range?: string;
  bytes_transferred?: number;
  latency_ms: number;
  failure_category?: string;
}

function buildCorsHeaders(origin: string | null, env: Env): Headers {
  const headers = new Headers();
  const allowed = env.ALLOWED_ORIGIN || '*';
  
  if (allowed === '*') {
    headers.set('Access-Control-Allow-Origin', origin || '*');
  } else {
    const list = allowed.split(',').map((o) => o.trim());
    if (origin && list.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
    } else {
      headers.set('Access-Control-Allow-Origin', list[0] || '*');
    }
  }

  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Range, Content-Type, X-Nexus-Ticket, Authorization');
  headers.set(
    'Access-Control-Expose-Headers',
    'Content-Range, Content-Length, Content-Type, Accept-Ranges, X-Nexus-Job, X-Worker-Latency, X-Nexus-Outcome'
  );
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

function jsonResponse(data: unknown, status: number, corsHeaders: Headers): Response {
  const headers = new Headers(corsHeaders);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(data), { status, headers });
}

function parseRangeHeader(rangeHeader: string, maxBytes: number): { start: number; end?: number } {
  const match = rangeHeader.trim().match(/^bytes=(\d+)-(\d+)?$/);
  if (!match) {
    throw new Error('INVALID_RANGE_SYNTAX');
  }
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : undefined;

  if (isNaN(start) || start < 0) {
    throw new Error('INVALID_RANGE_START');
  }
  if (end !== undefined) {
    if (isNaN(end) || end < start) {
      throw new Error('INVALID_RANGE_BOUNDS');
    }
    const requestedSize = end - start + 1;
    if (requestedSize > maxBytes) {
      throw new Error('OVERSIZED_RANGE_REQUEST');
    }
  }
  return { start, end };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const requestOrigin = request.headers.get('Origin');
    const corsHeaders = buildCorsHeaders(requestOrigin, env);

    // 1. Handle CORS OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, corsHeaders);
    }

    let jobId = 'unknown';
    let rangeHeaderVal: string | null = null;

    try {
      const reqUrl = new URL(request.url);

      // Extract ticket
      const ticket = reqUrl.searchParams.get('ticket') || request.headers.get('X-Nexus-Ticket');
      if (!ticket) {
        return jsonResponse(
          { error: 'Unauthorized ticket', code: 'TICKET_INVALID', detail: 'Missing ticket parameter or X-Nexus-Ticket header' },
          403,
          corsHeaders
        );
      }

      // Extract target media URL
      const targetUrl = reqUrl.searchParams.get('url') || reqUrl.searchParams.get('u');
      if (!targetUrl) {
        return jsonResponse({ error: 'Missing target url parameter', code: 'MISSING_URL' }, 400, corsHeaders);
      }

      // 2. Validate Ticket
      const secret = env.SIGNED_DOWNLOAD_SECRET || env.DEFAULT_SECRET || DEFAULT_SECRET;
      let ticketPayload: TicketPayload;
      try {
        ticketPayload = await verifyWorkerTicket(ticket, secret, targetUrl);
        jobId = ticketPayload.job;
      } catch (err: any) {
        const logEntry: StructuredLog = {
          timestamp: new Date().toISOString(),
          request_id: requestId,
          job_id: jobId,
          strategy: 'SIGNED_WORKER_RANGE',
          outcome: 'failure',
          status: 403,
          latency_ms: Date.now() - startTime,
          failure_category: 'TICKET_INVALID'
        };
        console.warn(JSON.stringify(logEntry));
        return jsonResponse({ error: 'Unauthorized ticket', code: 'TICKET_INVALID', detail: err.message }, 403, corsHeaders);
      }

      // 3. Validate Target URL & Initial SSRF Check
      let currentUrlObj: URL;
      const allowDev = env.ALLOW_LOOPBACK_FOR_TEST === 'true';
      try {
        currentUrlObj = validateTargetUrl(targetUrl, ticketPayload.hst, allowDev);
      } catch (err: any) {
        const logEntry: StructuredLog = {
          timestamp: new Date().toISOString(),
          request_id: requestId,
          job_id: jobId,
          strategy: 'SIGNED_WORKER_RANGE',
          outcome: 'failure',
          status: 403,
          latency_ms: Date.now() - startTime,
          failure_category: 'SSRF_VIOLATION'
        };
        console.warn(JSON.stringify(logEntry));
        return jsonResponse({ error: 'Forbidden target', code: 'SSRF_VIOLATION', detail: err.message }, 403, corsHeaders);
      }

      // 4. Validate Resource Type & Range Policy
      const requestedTyp = (reqUrl.searchParams.get('typ') || request.headers.get('X-Nexus-Resource-Type') || ticketPayload.typ || 'range').toLowerCase();
      const VALID_RESOURCE_TYPES = ['range', 'playlist', 'key', 'segment'];
      if (!VALID_RESOURCE_TYPES.includes(requestedTyp)) {
        return jsonResponse({ error: 'Invalid resource type', code: 'INVALID_RESOURCE_TYPE' }, 403, corsHeaders);
      }

      // Ensure ticket authorizes this resource type
      const authorizedTyp = (ticketPayload.typ || 'range').toLowerCase();
      if (authorizedTyp !== requestedTyp) {
        return jsonResponse({
          error: `Resource type mismatch: ticket is authorized for '${authorizedTyp}', requested '${requestedTyp}'`,
          code: 'RESOURCE_TYPE_MISMATCH'
        }, 403, corsHeaders);
      }

      // Resource-specific max byte limits
      let maxResourceBytes = Number(env.MAX_RANGE_BYTES) || DEFAULT_MAX_RANGE_BYTES; // 50MB
      if (requestedTyp === 'playlist') {
        maxResourceBytes = 2 * 1024 * 1024; // 2MB
      } else if (requestedTyp === 'key') {
        maxResourceBytes = 4096; // 4KB (AES-128 key is 16B)
      }

      rangeHeaderVal = request.headers.get('Range');
      if (requestedTyp === 'range') {
        // Range is STRICTLY REQUIRED for range resource type (Phase-2 invariant)
        if (!rangeHeaderVal) {
          return jsonResponse({ error: 'Range header is required for relay', code: 'RANGE_REQUIRED' }, 400, corsHeaders);
        }
        try {
          parseRangeHeader(rangeHeaderVal, maxResourceBytes);
        } catch (err: any) {
          const isOversized = err.message === 'OVERSIZED_RANGE_REQUEST';
          const headers = new Headers(corsHeaders);
          headers.set('Content-Range', 'bytes */0');
          headers.set('Content-Type', 'application/json');
          return new Response(JSON.stringify({ 
            error: isOversized ? 'Requested Range exceeds maximum allowed chunk size' : 'Invalid Range header',
            code: isOversized ? 'OVERSIZED_RANGE_REQUEST' : 'INVALID_RANGE' 
          }), {
            status: 416,
            headers
          });
        }
      } else {
        // For playlist, key, or segment: if Range header is present, validate it; otherwise full GET bounded by maxResourceBytes
        if (rangeHeaderVal) {
          try {
            parseRangeHeader(rangeHeaderVal, maxResourceBytes);
          } catch (err: any) {
            const isOversized = err.message === 'OVERSIZED_RANGE_REQUEST';
            const headers = new Headers(corsHeaders);
            headers.set('Content-Range', 'bytes */0');
            headers.set('Content-Type', 'application/json');
            return new Response(JSON.stringify({ 
              error: isOversized ? 'Requested Range exceeds maximum allowed chunk size' : 'Invalid Range header',
              code: isOversized ? 'OVERSIZED_RANGE_REQUEST' : 'INVALID_RANGE' 
            }), {
              status: 416,
              headers
            });
          }
        }
      }

      // 5. Fetch Upstream with Manual Redirect Revalidation
      let currentFetchUrl = currentUrlObj.toString();
      let redirectHops = 0;
      let upstreamRes: Response | null = null;

      const upstreamHeaders = new Headers();
      upstreamHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36');
      if (rangeHeaderVal) {
        upstreamHeaders.set('Range', rangeHeaderVal);
      }
      upstreamHeaders.set('Accept', '*/*');

      while (redirectHops <= MAX_REDIRECTS) {
        try {
          upstreamRes = await fetch(currentFetchUrl, {
            method: request.method,
            headers: upstreamHeaders,
            redirect: 'manual'
          });
        } catch (fetchErr: any) {
          const logEntry: StructuredLog = {
            timestamp: new Date().toISOString(),
            request_id: requestId,
            job_id: jobId,
            strategy: 'SIGNED_WORKER_RANGE',
            outcome: 'failure',
            status: 502,
            latency_ms: Date.now() - startTime,
            failure_category: 'UPSTREAM_FETCH_ERROR'
          };
          console.error(JSON.stringify(logEntry));
          return jsonResponse({ error: 'Upstream fetch failed', code: 'UPSTREAM_FETCH_ERROR' }, 502, corsHeaders);
        }

        // Check for redirects
        if ([301, 302, 303, 307, 308].includes(upstreamRes.status)) {
          const loc = upstreamRes.headers.get('Location');
          if (!loc) {
            return jsonResponse({ error: 'Redirect missing Location', code: 'INVALID_REDIRECT' }, 502, corsHeaders);
          }

          let nextResolvedUrl: URL;
          try {
            nextResolvedUrl = new URL(loc, currentFetchUrl);
            // Revalidate destination URL and hostname against SSRF policy and authorized host
            currentUrlObj = validateTargetUrl(nextResolvedUrl.toString(), ticketPayload.hst, allowDev);
            currentFetchUrl = currentUrlObj.toString();
          } catch (redErr: any) {
            return jsonResponse({ 
              error: 'Redirect to unauthorized destination blocked', 
              code: 'REDIRECT_SSRF_BLOCKED', 
              detail: redErr.message 
            }, 403, corsHeaders);
          }

          redirectHops++;
          if (redirectHops > MAX_REDIRECTS) {
            return jsonResponse({ error: 'Too many redirects', code: 'TOO_MANY_REDIRECTS' }, 508, corsHeaders);
          }
          continue;
        }

        // Non-redirect response reached
        break;
      }

      if (!upstreamRes) {
        return jsonResponse({ error: 'Upstream unreachable', code: 'UPSTREAM_UNREACHABLE' }, 502, corsHeaders);
      }

      // 6. Handle Upstream Errors (404, 403, 410, etc.)
      if (upstreamRes.status === 404) {
        return jsonResponse({ error: 'Upstream resource not found', code: 'UPSTREAM_404' }, 404, corsHeaders);
      }
      if (upstreamRes.status === 403) {
        return jsonResponse({ error: 'Upstream access forbidden', code: 'UPSTREAM_403' }, 403, corsHeaders);
      }
      if (upstreamRes.status === 410) {
        return jsonResponse({ error: 'Upstream URL has expired', code: 'EXPIRED_UPSTREAM_URL' }, 410, corsHeaders);
      }

      // Check upstream Content-Length against resource-specific limits
      const contentLength = upstreamRes.headers.get('Content-Length');
      if (contentLength) {
        const clBytes = parseInt(contentLength, 10);
        if (!isNaN(clBytes) && clBytes > maxResourceBytes) {
          return jsonResponse({
            error: `Upstream resource size (${clBytes} bytes) exceeds maximum limit for ${requestedTyp} (${maxResourceBytes} bytes)`,
            code: 'OVERSIZED_RESOURCE'
          }, 416, corsHeaders);
        }
      }

      // 7. Prepare Streaming Response Headers
      const resHeaders = new Headers(corsHeaders);
      const contentRange = upstreamRes.headers.get('Content-Range');
      const defaultCt = requestedTyp === 'playlist' ? 'application/vnd.apple.mpegurl' : (requestedTyp === 'key' ? 'application/octet-stream' : 'video/mp4');
      const contentType = upstreamRes.headers.get('Content-Type') || defaultCt;
      const acceptRanges = upstreamRes.headers.get('Accept-Ranges') || 'bytes';

      if (contentRange) resHeaders.set('Content-Range', contentRange);
      if (contentLength) resHeaders.set('Content-Length', contentLength);
      resHeaders.set('Content-Type', contentType);
      resHeaders.set('Accept-Ranges', acceptRanges);
      resHeaders.set('X-Nexus-Job', jobId);
      resHeaders.set('X-Nexus-Outcome', 'STREAMING_OK');
      resHeaders.set('X-Worker-Latency', String(Date.now() - startTime));

      // 8. Structured Logging
      const logEntry: StructuredLog = {
        timestamp: new Date().toISOString(),
        request_id: requestId,
        job_id: jobId,
        strategy: 'SIGNED_WORKER_RANGE',
        outcome: 'success',
        status: upstreamRes.status,
        upstream_status: upstreamRes.status,
        range_requested: rangeHeaderVal || undefined,
        content_range: contentRange || undefined,
        bytes_transferred: contentLength ? parseInt(contentLength, 10) : undefined,
        latency_ms: Date.now() - startTime
      };
      console.log(JSON.stringify(logEntry));

      // 9. Zero-buffering Streaming Passthrough
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: resHeaders
      });

    } catch (unexpectedErr: any) {
      const logEntry: StructuredLog = {
        timestamp: new Date().toISOString(),
        request_id: requestId,
        job_id: jobId,
        strategy: 'SIGNED_WORKER_RANGE',
        outcome: 'failure',
        status: 500,
        latency_ms: Date.now() - startTime,
        failure_category: 'INTERNAL_RELAY_ERROR'
      };
      console.error(JSON.stringify(logEntry));
      return jsonResponse({ 
        error: 'Internal relay error', 
        code: 'INTERNAL_RELAY_ERROR', 
        detail: unexpectedErr.message 
      }, 500, corsHeaders);
    }
  }
};
