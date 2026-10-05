import { MediaEngine } from '../../../frontend/src/packages/media-engine/index';
import { ExtensionDownloadSink } from '../storage/extension-download-sink';
import type { 
  NexusMessage, 
  StartDownloadPayload, 
  DownloadCancelPayload 
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
