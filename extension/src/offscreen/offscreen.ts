import { MediaEngine } from '../../../frontend/src/packages/media-engine/index';
import { ExtensionDownloadSink } from '../storage/extension-download-sink';
import type { 
  NexusMessage, 
  StartDownloadPayload, 
  DownloadCancelPayload,
  StartDirectAcquisitionPayload
} from '../messaging/protocol';

console.log('[NEXUS Offscreen] Initialized and listening for media processing requests');

let activeAbortController: AbortController | null = null;
let currentSink: ExtensionDownloadSink | null = null;
let currentJobId: string | null = null;

chrome.runtime.onMessage.addListener((message: NexusMessage, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'PING') {
    sendResponse({ type: 'PONG', timestamp: Date.now() });
    return false;
  }

  if (message.type === 'START_DOWNLOAD') {
    handleStartDownload(message.payload as StartDownloadPayload);
    sendResponse({ status: 'started' });
    return false;
  }

  if (message.type === 'START_DIRECT_ACQUISITION') {
    handleStartDirectAcquisition(message.payload as StartDirectAcquisitionPayload);
    sendResponse({ status: 'started' });
    return false;
  }

  if (message.type === 'DOWNLOAD_CANCEL') {
    handleCancelDownload(message.payload as DownloadCancelPayload);
    sendResponse({ status: 'cancelling' });
    return false;
  }

  return false;
});

async function handleStartDownload(payload: StartDownloadPayload) {
  const { jobId, manifest, targetFormatId, targetFormatType, apiBaseUrl, authHeaders } = payload;
  currentJobId = jobId;
  activeAbortController = new AbortController();
  currentSink = new ExtensionDownloadSink();

  try {
    console.log(`[NEXUS Offscreen] Starting download job ${jobId} for format ${targetFormatId}`);

    const result = await MediaEngine.execute({
      manifest,
      targetFormatId,
      targetFormatType: targetFormatType || 'video',
      apiBaseUrl,
      authHeaders,
      signal: activeAbortController.signal,
      sink: currentSink,
      autoTriggerBrowserDownload: false,
      onProgress: (progress) => {
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_PROGRESS',
          payload: {
            jobId,
            ...progress,
          },
        }).catch(() => {});
      },
    });

    if (!result) {
      throw new Error('MediaEngine returned null (unsupported client strategy or server fallback required)');
    }

    const blobUrl = currentSink.getBlobUrl() || result.downloadUrl;
    (window as any).__LAST_DOWNLOAD_RESULT__ = {
      jobId,
      filename: result.filename,
      totalBytes: result.totalBytes,
      deliveryMode: result.deliveryMode,
      blobUrl,
      blob: currentSink.getBlob() || result.blob
    };
    console.log(`[NEXUS Offscreen] Job ${jobId} completed successfully. Generated blobUrl: ${blobUrl}`);

    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_COMPLETE',
      payload: {
        jobId,
        filename: result.filename,
        totalBytes: result.totalBytes,
        deliveryMode: result.deliveryMode,
        blobUrl,
      },
    }).catch((err) => {
      console.error('[NEXUS Offscreen] Failed to dispatch DOWNLOAD_COMPLETE message:', err);
    });

  } catch (err: any) {
    const isAbort = err.name === 'AbortError' || err.message?.includes('aborted');
    console.error(`[NEXUS Offscreen] Job ${jobId} failed (abort=${isAbort}):`, err);

    if (currentSink) {
      try {
        await currentSink.abort();
      } catch {}
    }

    if (!isAbort) {
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_FAILED',
        payload: {
          jobId,
          error: err.message || 'Media processing error',
          code: err.code || 'PROCESSING_FAILED',
        },
      }).catch(() => {});
    }
  } finally {
    activeAbortController = null;
    currentJobId = null;
  }
}

async function handleCancelDownload(payload: DownloadCancelPayload) {
  const { jobId } = payload;
  if (currentJobId === jobId && activeAbortController) {
    console.log(`[NEXUS Offscreen] Aborting active job ${jobId}`);
    activeAbortController.abort();
    if (currentSink) {
      try {
        await currentSink.abort();
      } catch {}
    }
  }
}

async function handleStartDirectAcquisition(payload: StartDirectAcquisitionPayload) {
  const { sessionId, streamUrl, targetFilename, expectedBytes, mimeType } = payload;
  currentJobId = sessionId;
  activeAbortController = new AbortController();

  console.log(`[NEXUS Offscreen] Starting direct client acquisition for session ${sessionId}: ${streamUrl.substring(0, 80)}...`);

  chrome.runtime.sendMessage({
    type: 'ACQUISITION_STARTED',
    payload: { sessionId, targetFilename }
  }).catch(() => {});

  const startTime = Date.now();
  let lastReportTime = startTime;
  let lastReportBytes = 0;

  try {
    const res = await fetch(streamUrl, {
      signal: activeAbortController.signal,
      headers: {
        'Accept': '*/*',
      }
    });

    if (!res.ok) {
      throw new Error(`Upstream acquisition failed with HTTP status ${res.status}: ${res.statusText}`);
    }

    const contentLengthHeader = res.headers.get('content-length');
    const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : (expectedBytes || 0);

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('ReadableStream not supported on response body');
    }

    const chunks: Uint8Array[] = [];
    let bytesReceived = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        bytesReceived += value.byteLength;

        const now = Date.now();
        if (now - lastReportTime >= 250) {
          const durationSec = (now - lastReportTime) / 1000;
          const bytesDelta = bytesReceived - lastReportBytes;
          const speedBps = durationSec > 0 ? bytesDelta / durationSec : 0;
          const speedMb = (speedBps / (1024 * 1024)).toFixed(2);
          const percent = totalBytes > 0 ? Math.min(99.9, (bytesReceived / totalBytes) * 100) : 0;

          chrome.runtime.sendMessage({
            type: 'ACQUISITION_PROGRESS',
            payload: {
              sessionId,
              percent,
              bytesReceived,
              totalBytes,
              speedFormatted: `${speedMb} MB/s`,
            }
          }).catch(() => {});

          lastReportTime = now;
          lastReportBytes = bytesReceived;
        }
      }
    }

    const contentType = res.headers.get('content-type') || mimeType || 'video/mp4';
    const blob = new Blob(chunks, { type: contentType });
    const blobUrl = URL.createObjectURL(blob);

    console.log(`[NEXUS Offscreen] Direct acquisition completed for ${sessionId}. Total: ${bytesReceived} bytes. Generated blob.`);

    (window as any).__LAST_ACQUISITION_RESULT__ = {
      sessionId,
      filename: targetFilename,
      totalBytes: bytesReceived,
      mimeType: contentType,
      blobUrl,
      blob,
    };

    chrome.runtime.sendMessage({
      type: 'ACQUISITION_COMPLETE',
      payload: {
        sessionId,
        filename: targetFilename,
        totalBytes: bytesReceived,
        mimeType: contentType,
        blobUrl,
      }
    }).catch(() => {});

  } catch (err: any) {
    const isAbort = err.name === 'AbortError' || err.message?.includes('aborted');
    console.error(`[NEXUS Offscreen] Direct acquisition failed for ${sessionId}:`, err);

    if (!isAbort) {
      chrome.runtime.sendMessage({
        type: 'ACQUISITION_FAILED',
        payload: {
          sessionId,
          error: err.message || 'Direct browser acquisition failed',
          code: 'ACQUISITION_ERROR'
        }
      }).catch(() => {});
    }
  } finally {
    activeAbortController = null;
    currentJobId = null;
  }
}

