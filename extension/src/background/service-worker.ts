import type { 
  NexusMessage, 
  StartDownloadPayload, 
  DownloadCompletePayload,
  ResolveMediaPayload 
} from '../messaging/protocol';

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

console.log('[NEXUS Service Worker] Background Service Worker initialized');

/**
 * Ensures the offscreen document is loaded and running.
 */
async function ensureOffscreenDocument(): Promise<void> {
  try {
    if (chrome.offscreen && chrome.offscreen.hasDocument) {
      const hasDoc = await chrome.offscreen.hasDocument();
      if (hasDoc) {
        return;
      }
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH),
        reasons: ['BLOBS' as any],
        justification: 'NEXUS client-first media demuxing and MP4 multiplexing',
      });
      console.log('[NEXUS Service Worker] Created offscreen document, awaiting liveness...');
      // Wait for offscreen document to register its message listener
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 50));
        try {
          const res = await chrome.runtime.sendMessage({ type: 'PING' });
          if (res && res.type === 'PONG') {
            console.log('[NEXUS Service Worker] Offscreen document confirmed ready via PONG');
            break;
          }
        } catch {}
      }
    }
  } catch (err: any) {
    if (!err.message?.includes('Only a single offscreen document may be created')) {
      console.error('[NEXUS Service Worker] Error creating offscreen document:', err);
      throw err;
    }
  }
}

/**
 * Resolves YouTube media directly from the user's browser network.
 * Zero Railway transit; bypasses server datacenter IP rate limits (HTTP 429/403).
 */
async function resolveYouTubeDirect(url: string): Promise<any> {
  const videoIdMatch = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  const videoId = videoIdMatch ? videoIdMatch[1] : '';

  let oembedData: any = null;
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (oembedRes.ok) {
      oembedData = await oembedRes.json();
    }
  } catch {}

  let playerData: any = null;
  try {
    const pageRes = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/);
      if (match) {
        playerData = JSON.parse(match[1]);
      }
    }
  } catch (e) {
    console.warn('[NEXUS Extension] Direct watch page fetch error:', e);
  }

  const title = playerData?.videoDetails?.title || oembedData?.title || 'YouTube Stream';
  const author = playerData?.videoDetails?.author || oembedData?.author_name || 'YouTube Creator';
  const durationSec = parseInt(playerData?.videoDetails?.lengthSeconds || '0', 10);
  const thumbnail = oembedData?.thumbnail_url || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '');

  const formats = playerData?.streamingData?.formats || [];
  const adaptiveFormats = playerData?.streamingData?.adaptiveFormats || [];

  const candidateStream = formats.find((f: any) => Boolean(f.url)) || adaptiveFormats.find((f: any) => Boolean(f.url));
  const hasDirectUrl = Boolean(candidateStream?.url);

  return {
    job_id: `yt-ext-${Date.now()}`,
    id: videoId || `yt-${Date.now()}`,
    title,
    uploader: author,
    duration: durationSec,
    thumbnail,
    platform: 'youtube',
    pipeline_status: hasDirectUrl ? 'STREAM_CANDIDATE_AVAILABLE' : 'METADATA_DETECTED',
    direct_stream_available: hasDirectUrl,
    candidate_stream_url: candidateStream?.url || null,
    video_formats: formats.map((f: any) => ({
      format_id: String(f.itag),
      format_note: f.qualityLabel || `${f.height || 360}p`,
      ext: f.mimeType?.includes('webm') ? 'webm' : 'mp4',
      filesize: f.contentLength ? parseInt(f.contentLength, 10) : 0,
      vcodec: f.mimeType?.split('codecs=')[1]?.replace(/["']/g, '') || 'h264',
      acodec: 'aac',
      url: f.url || undefined,
      is_ciphered: !f.url && (Boolean(f.signatureCipher) || Boolean(f.cipher)),
    })),
    audio_formats: adaptiveFormats
      .filter((f: any) => f.mimeType?.startsWith('audio/'))
      .map((f: any) => ({
        format_id: String(f.itag),
        format_note: `${Math.round((f.bitrate || 128000) / 1000)} kbps`,
        ext: f.mimeType?.includes('webm') ? 'webm' : 'm4a',
        filesize: f.contentLength ? parseInt(f.contentLength, 10) : 0,
        acodec: f.mimeType?.includes('webm') ? 'opus' : 'aac',
        url: f.url || undefined,
        is_ciphered: !f.url && (Boolean(f.signatureCipher) || Boolean(f.cipher)),
      })),
  };
}

/**
 * Resolves a media URL via client-direct network or FastAPI Control Plane
 */
async function resolveMedia(url: string, apiBaseUrl: string = DEFAULT_API_BASE_URL) {
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
  if (isYoutube) {
    try {
      const directData = await resolveYouTubeDirect(url);
      if (directData && (directData.title !== 'YouTube Stream' || directData.video_formats.length > 0)) {
        console.log('[NEXUS Extension] YouTube media resolved directly via client network (0 Railway requests)');
        return directData;
      }
    } catch (directErr) {
      console.warn('[NEXUS Extension] Direct YouTube client resolution failed, attempting control plane fallback:', directErr);
    }
  }

  const endpoint = `${apiBaseUrl.replace(/\/+$/, '')}/api/resolve`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Control plane resolve failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data;
}

/**
 * Notifies control plane of completion
 */
async function notifyComplete(
  jobId: string, 
  formatId: string, 
  deliveryMode: string, 
  bytesDownloaded: number, 
  apiBaseUrl: string = DEFAULT_API_BASE_URL
) {
  try {
    const endpoint = `${apiBaseUrl.replace(/\/+$/, '')}/api/downloads/${jobId}/complete`;
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format_id: formatId,
        delivery_mode: deliveryMode,
        bytes_downloaded: bytesDownloaded,
      }),
    });
  } catch (err) {
    console.warn('[NEXUS Service Worker] Failed to report download completion:', err);
  }
}

// Global Message Router
chrome.runtime.onMessage.addListener((message: NexusMessage, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'PING') {
    sendResponse({ type: 'PONG', role: 'service_worker', timestamp: Date.now() });
    return false;
  }

  // Handle media resolution request
  if (message.type === 'RESOLVE_MEDIA') {
    const payload = message.payload as ResolveMediaPayload;
    const apiBaseUrl = payload.apiBaseUrl || DEFAULT_API_BASE_URL;

    resolveMedia(payload.url, apiBaseUrl)
      .then((data) => {
        sendResponse({
          type: 'RESOLVE_MEDIA_SUCCESS',
          payload: {
            jobId: data.job_id || data.manifest?.job_id,
            manifest: data.manifest || data,
          },
        });
      })
      .catch((err) => {
        sendResponse({
          type: 'RESOLVE_MEDIA_ERROR',
          payload: { error: err.message },
        });
      });

    return true; // Keep message channel open for async response
  }

  // Handle start download from Popup / Web
  if (message.type === 'START_DOWNLOAD') {
    const payload = message.payload as StartDownloadPayload;

    ensureOffscreenDocument()
      .then(() => {
        // Forward start command to offscreen document
        chrome.runtime.sendMessage(message).catch((err) => {
          console.error('[NEXUS Service Worker] Failed to dispatch START_DOWNLOAD to offscreen:', err);
        });
        sendResponse({ status: 'dispatched_to_offscreen' });
      })
      .catch((err) => {
        sendResponse({ status: 'error', error: err.message });
      });

    return true;
  }

  // Handle START_DIRECT_ACQUISITION from Web Page
  if (message.type === 'START_DIRECT_ACQUISITION') {
    const payload = message.payload as any;
    ensureOffscreenDocument()
      .then(() => {
        chrome.runtime.sendMessage(message).catch((err) => {
          console.error('[NEXUS Service Worker] Failed to dispatch START_DIRECT_ACQUISITION to offscreen:', err);
        });
        sendResponse({ status: 'dispatched_to_offscreen', sessionId: payload.sessionId });
      })
      .catch((err) => {
        sendResponse({ status: 'error', error: err.message });
      });

    return true;
  }

  // Handle completion from Offscreen Document
  if (message.type === 'DOWNLOAD_COMPLETE') {
    const payload = message.payload as DownloadCompletePayload;
    console.log(`[NEXUS Service Worker] Download complete for job ${payload.jobId}, initiating chrome.downloads...`);

    if (payload.blobUrl && chrome.downloads) {
      chrome.downloads.download({
        url: payload.blobUrl,
        filename: payload.filename,
        saveAs: false,
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('[NEXUS Service Worker] chrome.downloads error:', chrome.runtime.lastError.message);
        } else {
          console.log(`[NEXUS Service Worker] Download started with ID: ${downloadId}`);
        }
      });
    }

    notifyComplete(
      payload.jobId,
      'extension_format',
      payload.deliveryMode,
      payload.totalBytes
    );

    return false;
  }

  // Handle direct acquisition completion from offscreen document
  if (message.type === 'ACQUISITION_COMPLETE') {
    const payload = message.payload as any;
    console.log(`[NEXUS Service Worker] Direct acquisition complete for session ${payload.sessionId}: ${payload.filename}`);

    if (payload.blobUrl && chrome.downloads) {
      chrome.downloads.download({
        url: payload.blobUrl,
        filename: payload.filename,
        saveAs: false,
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.warn('[NEXUS Service Worker] chrome.downloads error:', chrome.runtime.lastError.message);
        } else {
          console.log(`[NEXUS Service Worker] Acquisition download started with ID: ${downloadId}`);
        }
      });
    }

    broadcastToTabs(message);
    return false;
  }

  // Handle direct acquisition progress / lifecycle
  if (
    message.type === 'ACQUISITION_PROGRESS' || 
    message.type === 'ACQUISITION_STARTED' || 
    message.type === 'ACQUISITION_FAILED' ||
    message.type === 'DOWNLOAD_PROGRESS' ||
    message.type === 'DOWNLOAD_FAILED'
  ) {
    broadcastToTabs(message);
    return false;
  }

  // Handle cancel request
  if (message.type === 'DOWNLOAD_CANCEL') {
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  return false;
});

function broadcastToTabs(message: NexusMessage) {
  if (chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      }
    });
  }
}

// External Message Listener (from authenticated Vidleo web pages)
if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((message: NexusMessage, sender, sendResponse) => {
    const senderUrl = sender.url || '';
    const isAllowedOrigin = 
      senderUrl.includes('frontend-kaveri-d.vercel.app') ||
      senderUrl.includes('localhost:3000') ||
      senderUrl.includes('127.0.0.1:3000') ||
      senderUrl.includes('localhost:8092');

    if (!isAllowedOrigin) {
      sendResponse({ error: 'Origin unauthorized' });
      return false;
    }

    if (message.type === 'PING') {
      sendResponse({ type: 'PONG', version: '1.0.0', role: 'nexus_extension' });
      return false;
    }

    if (message.type === 'START_DIRECT_ACQUISITION') {
      const payload = message.payload as any;
      ensureOffscreenDocument()
        .then(() => {
          chrome.runtime.sendMessage(message).catch((err) => {
            console.error('[NEXUS Service Worker] Failed to dispatch START_DIRECT_ACQUISITION:', err);
          });
          sendResponse({ status: 'dispatched_to_offscreen', sessionId: payload.sessionId });
        })
        .catch((err) => {
          sendResponse({ status: 'error', error: err.message });
        });
      return true;
    }

    if (message.type === 'START_DOWNLOAD') {
      const payload = message.payload as StartDownloadPayload;
      ensureOffscreenDocument()
        .then(() => {
          chrome.runtime.sendMessage(message).catch((err) => {
            console.error('[NEXUS Service Worker] Failed to dispatch START_DOWNLOAD to offscreen:', err);
          });
          sendResponse({ status: 'dispatched_to_offscreen', jobId: payload.jobId });
        })
        .catch((err) => {
          sendResponse({ status: 'error', error: err.message });
        });
      return true;
    }

    if (message.type === 'RESOLVE_MEDIA') {
      const payload = message.payload as ResolveMediaPayload;
      const apiBaseUrl = payload.apiBaseUrl || DEFAULT_API_BASE_URL;
      resolveMedia(payload.url, apiBaseUrl)
        .then((data) => {
          sendResponse({
            type: 'RESOLVE_MEDIA_SUCCESS',
            payload: data,
          });
        })
        .catch((err) => {
          sendResponse({
            type: 'RESOLVE_MEDIA_ERROR',
            payload: { error: err.message },
          });
        });
      return true;
    }

    return false;
  });
}

