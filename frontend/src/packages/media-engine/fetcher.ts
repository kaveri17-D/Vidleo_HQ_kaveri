import { MediaSink } from './sink/sink';
import { EngineProgressCallback } from './types';

export interface RangeFetchOptions {
  url: string;
  totalBytes?: number;
  chunkSize?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: EngineProgressCallback;
  sink: MediaSink;
  stageName?: 'fetching' | 'muxing';
  chunkTimeoutMs?: number;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${Math.round(bytesPerSec / 1024)} KB/s`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const remSecs = Math.ceil(seconds % 60);
  return `${mins}m ${remSecs}s`;
}

const FORBIDDEN_BROWSER_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'user-agent',
]);

export function filterSafeBrowserHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, val] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!FORBIDDEN_BROWSER_HEADERS.has(lower) && !lower.startsWith('sec-') && !lower.startsWith('proxy-')) {
      safe[key] = val;
    }
  }
  return safe;
}

/**
 * Robust Range Fetcher complying with NEXUS Client-First Media Download Architecture.
 * Handles 206 Partial Content, Content-Range parsing, graceful progressive stream consumption
 * when 200 is returned at offset 0, and strict rejection of 200 at non-zero offsets.
 */
export async function fetchStreamWithRange(options: RangeFetchOptions): Promise<number> {
  const {
    url,
    totalBytes: initialTotalBytes = 0,
    chunkSize = 1048576, // 1MB chunks
    headers = {},
    signal,
    onProgress,
    sink,
    stageName = 'fetching',
    chunkTimeoutMs = 20000,
  } = options;

  const safeHeaders = filterSafeBrowserHeaders(headers);

  let downloadedBytes = 0;
  let totalBytes = initialTotalBytes;
  let startOffset = 0;

  const startTime = Date.now();
  let lastSpeedCalcTime = startTime;
  let lastSpeedBytes = 0;
  let currentSpeedBps = 0;

  function emitProgress(stage: 'fetching' | 'muxing' | 'complete', currentDownloaded: number) {
    if (!onProgress) return;
    const now = Date.now();
    if (now - lastSpeedCalcTime >= 400 || currentDownloaded === totalBytes) {
      const timeDelta = Math.max((now - lastSpeedCalcTime) / 1000, 0.05);
      const bytesDelta = currentDownloaded - lastSpeedBytes;
      currentSpeedBps = Math.round(bytesDelta / timeDelta);
      lastSpeedCalcTime = now;
      lastSpeedBytes = currentDownloaded;
    }

    const percent = totalBytes > 0 
      ? Math.min(Math.round((currentDownloaded / totalBytes) * 100), 99)
      : 50;

    const remBytes = totalBytes > currentDownloaded ? totalBytes - currentDownloaded : 0;
    const etaSeconds = currentSpeedBps > 0 && remBytes > 0 ? remBytes / currentSpeedBps : undefined;

    onProgress({
      stage,
      progressPercent: currentDownloaded >= totalBytes && totalBytes > 0 ? 100 : percent,
      downloadedBytes: currentDownloaded,
      totalBytes: totalBytes > 0 ? totalBytes : currentDownloaded,
      speedBps: currentSpeedBps,
      speedFormatted: currentSpeedBps > 0 ? formatSpeed(currentSpeedBps) : undefined,
      etaSeconds,
      etaFormatted: etaSeconds !== undefined ? formatEta(etaSeconds) : undefined,
    });
  }

  // If totalBytes is unknown, probe HEAD or first byte
  if (totalBytes <= 0) {
    try {
      const probeRes = await fetch(url, {
        method: 'GET',
        headers: {
          ...safeHeaders,
          Range: 'bytes=0-0',
        },
        signal,
      });

      const contentRange = probeRes.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match) {
          totalBytes = parseInt(match[1], 10);
        }
      }
      if (!totalBytes) {
        const cl = probeRes.headers.get('content-length');
        if (cl) totalBytes = parseInt(cl, 10);
      }
    } catch {}
  }

  while (totalBytes <= 0 || startOffset < totalBytes) {
    if (signal?.aborted) {
      throw new Error('Download aborted by user');
    }

    const endOffset = totalBytes > 0 
      ? Math.min(startOffset + chunkSize - 1, totalBytes - 1)
      : startOffset + chunkSize - 1;

    let attempts = 0;
    let success = false;
    let chunkBytes = 0;

    while (!success && attempts < 4) {
      attempts++;
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), chunkTimeoutMs);

      // Link parent signal with per-chunk timeout
      const abortHandler = () => timeoutController.abort();
      if (signal) signal.addEventListener('abort', abortHandler, { once: true });

      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            ...safeHeaders,
            Range: `bytes=${startOffset}-${endOffset}`,
          },
          signal: timeoutController.signal,
        });

        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', abortHandler);

        // Deterministic status handling:
        // 200 at startOffset > 0 is an error (server ignored Range header)
        if (res.status === 200 && startOffset > 0) {
          throw new Error(`Server ignored Range header: returned HTTP 200 for offset ${startOffset}`);
        }

        // 200 at startOffset === 0 means server only supports continuous streaming
        if (res.status === 200 && startOffset === 0) {
          const cl = res.headers.get('content-length');
          if (cl) totalBytes = parseInt(cl, 10);

          if (!res.body) {
            const buf = await res.arrayBuffer();
            const u8 = new Uint8Array(buf);
            await sink.write(u8);
            downloadedBytes += u8.byteLength;
            emitProgress(stageName, downloadedBytes);
            return downloadedBytes;
          }

          const reader = res.body.getReader();
          while (true) {
            if (signal?.aborted) {
              await reader.cancel();
              throw new Error('Download aborted by user');
            }
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              await sink.write(value);
              downloadedBytes += value.byteLength;
              emitProgress(stageName, downloadedBytes);
            }
          }
          return downloadedBytes;
        }

        if (res.status !== 206) {
          throw new Error(`HTTP range request failed with status ${res.status}`);
        }

        // Validate Content-Range header
        const cr = res.headers.get('content-range');
        if (cr) {
          const rangeMatch = cr.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
          if (rangeMatch) {
            const returnedStart = parseInt(rangeMatch[1], 10);
            if (returnedStart !== startOffset) {
              throw new Error(`Content-Range offset mismatch: expected ${startOffset}, got ${returnedStart}`);
            }
            if (totalBytes <= 0 && rangeMatch[3] !== '*') {
              totalBytes = parseInt(rangeMatch[3], 10);
            }
          }
        }

        if (res.body) {
          const reader = res.body.getReader();
          while (true) {
            if (signal?.aborted) {
              await reader.cancel();
              throw new Error('Download aborted by user');
            }
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.byteLength > 0) {
              await sink.write(value);
              chunkBytes += value.byteLength;
              downloadedBytes += value.byteLength;
              startOffset += value.byteLength;
              emitProgress(stageName, downloadedBytes);
            }
          }
        } else {
          const arrayBuffer = await res.arrayBuffer();
          const uint8Chunk = new Uint8Array(arrayBuffer);
          chunkBytes = uint8Chunk.byteLength;
          if (chunkBytes > 0) {
            await sink.write(uint8Chunk);
            downloadedBytes += chunkBytes;
            startOffset += chunkBytes;
            emitProgress(stageName, downloadedBytes);
          }
        }

        if (chunkBytes === 0) {
          // Reached EOF
          success = true;
          startOffset = totalBytes > 0 ? totalBytes : startOffset;
          break;
        }

        success = true;
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', abortHandler);
        if (signal?.aborted) throw err;

        if (attempts >= 4) {
          throw new Error(`Failed to fetch chunk at offset ${startOffset} after 4 attempts: ${err.message}`);
        }
        // Jittered exponential backoff: 300ms, 600ms, 1200ms
        const delay = Math.pow(2, attempts) * 150 + Math.random() * 100;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    if (chunkBytes === 0) {
      break;
    }
  }

  return downloadedBytes;
}
