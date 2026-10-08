import type { 
  NexusMessage, 
  StartDownloadPayload, 
  DownloadCompletePayload,
  ResolveMediaPayload,
  StartCdpDownloadPayload,
  CdpDownloadProgressPayload,
  CdpDownloadResultPayload
} from '../messaging/protocol';
import { parseUmpMediaStreams } from '../utils/ump-parser';

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

console.log('[NEXUS Service Worker] Background Service Worker initialized');

/**
 * Ensures the offscreen document is loaded and actively responding to messages.
 */
async function ensureOffscreenDocument(forceFresh: boolean = false): Promise<void> {
  if (!chrome.offscreen) return;

  // 1. If not forcing fresh document, check if existing offscreen document is alive
  if (!forceFresh) {
    try {
      const pong = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 300);
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_PING' }, (resp) => {
          clearTimeout(timer);
          if (!chrome.runtime.lastError && resp?.type === 'OFFSCREEN_PONG') {
            resolve(true);
          } else {
            resolve(false);
          }
        });
      });
      if (pong) {
        console.log('[NEXUS Service Worker] Existing offscreen document confirmed alive');
        return;
      }
    } catch {
      // Proceed to recreation
    }
  }

  // 2. If offscreen document is dead, crashed, or missing, close any zombie document first
  try {
    if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) {
      console.log('[NEXUS Service Worker] Closing unresponsive offscreen document...');
      await chrome.offscreen.closeDocument();
    }
  } catch (closeErr) {
    console.warn('[NEXUS Service Worker] Notice closing old offscreen document:', closeErr);
  }

  // 3. Create fresh offscreen document
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH),
      reasons: ['BLOBS' as any, 'AUDIO_PLAYBACK' as any],
      justification: 'NEXUS client-first media demuxing and MP4 multiplexing',
    });
    console.log('[NEXUS Service Worker] Created fresh offscreen document, awaiting liveness...');
  } catch (err: any) {
    if (!err?.message?.includes('Only a single offscreen document may be created')) {
      console.error('[NEXUS Service Worker] Error creating offscreen document:', err);
      throw err;
    }
  }

  // 4. Wait for fresh offscreen document to respond to OFFSCREEN_PING
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const res = await new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_PING' }, (r) => {
          if (!chrome.runtime.lastError && r?.type === 'OFFSCREEN_PONG') resolve(r);
          else resolve(null);
        });
      });
      if (res && res.type === 'OFFSCREEN_PONG') {
        console.log('[NEXUS Service Worker] Fresh offscreen document confirmed ready via OFFSCREEN_PONG');
        return;
      }
    } catch {}
  }
}

interface ObservedYouTubeStream {
  url: string;
  itag?: string;
  videoId?: string;
  timestamp: number;
}

const observedYouTubeStreams = new Map<string, ObservedYouTubeStream>();

// Non-blocking webRequest observer for googlevideo streams initiated by active tabs
if (chrome.webRequest && chrome.webRequest.onBeforeRequest) {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      try {
        const streamUrl = details.url;
        if (!streamUrl.includes('/videoplayback')) return;

        const parsed = new URL(streamUrl);
        const itag = parsed.searchParams.get('itag') || '';

        if (details.tabId >= 0 && chrome.tabs) {
          chrome.tabs.get(details.tabId, (tab) => {
            if (chrome.runtime.lastError || !tab?.url) return;
            const vm = tab.url.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
            if (vm && vm[1]) {
              const videoId = vm[1];
              const entry: ObservedYouTubeStream = { url: streamUrl, itag, videoId, timestamp: Date.now() };
              observedYouTubeStreams.set(videoId, entry);
              if (itag) observedYouTubeStreams.set(`${videoId}-${itag}`, entry);
            }
          });
        }
      } catch {}
    },
    { urls: ['*://*.googlevideo.com/videoplayback*'] }
  );
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

  // Check if an observed player stream exists for this video ID from active player playback
  const observed = videoId ? observedYouTubeStreams.get(videoId) : null;
  const isObservedRecent = Boolean(observed && (Date.now() - observed.timestamp < 3600000)); // 1 hour

  const candidateStream = formats.find((f: any) => Boolean(f.url)) || 
                          adaptiveFormats.find((f: any) => Boolean(f.url)) ||
                          (isObservedRecent && observed ? { url: observed.url } : null);

  const hasDirectUrl = Boolean(candidateStream?.url);
  const pipelineStatus = hasDirectUrl 
    ? (isObservedRecent ? 'BROWSER_ACQUISITION_READY' : 'STREAM_CANDIDATE_AVAILABLE')
    : 'ACTUAL_MEDIA_ACQUISITION_READY';

  return {
    job_id: `yt-ext-${Date.now()}`,
    id: videoId || `yt-${Date.now()}`,
    title,
    uploader: author,
    duration: durationSec,
    thumbnail,
    platform: 'youtube',
    pipeline_status: pipelineStatus,
    direct_stream_available: hasDirectUrl,
    candidate_stream_url: candidateStream?.url || null,
    video_formats: (() => {
      const videoAdaptive = adaptiveFormats.filter((f: any) => f.mimeType?.startsWith('video/'));
      const combinedVideo = [...formats, ...videoAdaptive];
      const seenItags = new Set<string>();
      const list: any[] = [];
      for (const f of combinedVideo) {
        const itagStr = String(f.itag);
        if (!seenItags.has(itagStr)) {
          seenItags.add(itagStr);
          list.push({
            format_id: itagStr,
            format_note: f.qualityLabel || `${f.height || 360}p`,
            ext: f.mimeType?.includes('webm') ? 'webm' : 'mp4',
            filesize: f.contentLength ? parseInt(f.contentLength, 10) : (f.bitrate && durationSec ? Math.round((f.bitrate * durationSec) / 8) : 0),
            vcodec: f.mimeType?.split('codecs=')[1]?.replace(/["']/g, '') || 'h264',
            acodec: 'aac',
            url: f.url || (isObservedRecent && observed?.itag === itagStr ? observed.url : undefined),
            is_ciphered: !f.url && !(isObservedRecent && observed?.itag === itagStr) && (Boolean(f.signatureCipher) || Boolean(f.cipher)),
          });
        }
      }
      return list;
    })(),
    audio_formats: (() => {
      const audioAdaptive = adaptiveFormats.filter((f: any) => f.mimeType?.startsWith('audio/'));
      const seenAudioItags = new Set<string>();
      const list: any[] = [];
      for (const f of audioAdaptive) {
        const itagStr = String(f.itag);
        if (!seenAudioItags.has(itagStr)) {
          seenAudioItags.add(itagStr);
          list.push({
            format_id: itagStr,
            format_note: `${Math.round((f.bitrate || 128000) / 1000)} kbps`,
            ext: f.mimeType?.includes('webm') ? 'webm' : 'm4a',
            filesize: f.contentLength ? parseInt(f.contentLength, 10) : (f.bitrate && durationSec ? Math.round((f.bitrate * durationSec) / 8) : 0),
            acodec: f.mimeType?.includes('webm') ? 'opus' : 'aac',
            url: f.url || (isObservedRecent && observed?.itag === itagStr ? observed.url : undefined),
            is_ciphered: !f.url && !(isObservedRecent && observed?.itag === itagStr) && (Boolean(f.signatureCipher) || Boolean(f.cipher)),
          });
        }
      }
      return list;
    })(),
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

  // Handle observed YouTube media from content script
  if (message.type === 'YOUTUBE_MEDIA_OBSERVED') {
    const payload = (message as any).payload;
    if (payload?.streamUrl) {
      const vid = payload.videoId;
      if (vid) {
        observedYouTubeStreams.set(vid, {
          url: payload.streamUrl,
          videoId: vid,
          timestamp: Date.now(),
        });
      }
    }
    sendResponse({ status: 'recorded' });
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

  // Handle START_PLAYBACK_CAPTURE from Web Page or Extension Popup
  if (message.type === 'START_PLAYBACK_CAPTURE') {
    const payload = message.payload as any;
    handleStartPlaybackCapture(payload)
      .then((result) => {
        sendResponse({ status: 'complete', result });
      })
      .catch((err) => {
        console.error('[NEXUS Service Worker] Playback capture failed:', err);
        broadcastToTabs({
          type: 'PLAYBACK_CAPTURE_FAILED',
          payload: { sessionId: payload?.sessionId, error: err.message },
        });
        sendResponse({ status: 'error', error: err.message });
      });

    return true; // Keep open for async response
  }

  // Handle NEXUS_CDP_DOWNLOAD_START from Web Page or Extension Popup
  if (message.type === 'NEXUS_CDP_DOWNLOAD_START') {
    const payload = message.payload as StartCdpDownloadPayload;
    handleStartCdpMediaDownload(payload)
      .then((result) => {
        sendResponse({ type: 'NEXUS_CDP_RESULT', payload: result });
      })
      .catch((err) => {
        console.error('[NEXUS SW] CDP Download failed:', err);
        broadcastToTabs({
          type: 'NEXUS_CDP_ERROR',
          payload: { sessionId: payload?.sessionId, error: err.message },
        });
        sendResponse({ type: 'NEXUS_CDP_ERROR', payload: { error: err.message } });
      });

    return true; // Keep open for async response
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

    if (message.type === 'START_PLAYBACK_CAPTURE') {
      const payload = message.payload as any;
      handleStartPlaybackCapture(payload)
        .then((result) => {
          sendResponse({ status: 'complete', result });
        })
        .catch((err) => {
          sendResponse({ status: 'error', error: err.message });
        });
      return true;
    }

    if (message.type === 'NEXUS_CDP_DOWNLOAD_START') {
      const payload = message.payload as StartCdpDownloadPayload;
      console.log('[NEXUS-FINAL] sessionId:', payload.sessionId);
      console.log('[NEXUS-FINAL] selectedQuality:', payload.quality || 'unknown');
      handleStartCdpMediaDownload(payload)
        .then((result) => {
          sendResponse({ type: 'NEXUS_CDP_RESULT', payload: result });
        })
        .catch((err) => {
          const errMsg = err?.message || String(err);
          console.error('[NEXUS-FINAL][SW] handleStartCdpMediaDownload failed:', errMsg, err?.stack);
          sendResponse({ type: 'NEXUS_CDP_ERROR', payload: { error: errMsg, stack: err?.stack } });
          broadcastToTabs({
            type: 'NEXUS_CDP_ERROR',
            payload: {
              sessionId: payload.sessionId,
              error: errMsg,
              stack: err?.stack,
            }
          });
        });
      return true;
    }

    return false;
  });
}

function uint8ArrayToBase64(u: Uint8Array): string {
  let binary = '';
  const len = u.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, u.subarray(i, Math.min(i + chunkSize, len)) as any);
  }
  return btoa(binary);
}

function containsMoof(u: Uint8Array): boolean {
  for (let i = 0; i < u.length - 4; i++) {
    if (u[i] === 109 && u[i + 1] === 111 && u[i + 2] === 111 && u[i + 3] === 102) return true;
  }
  return false;
}

/**
 * Attaches Chrome DevTools Protocol debugger to acquire actual media response bodies directly from the player.
 * Demuxes client-side with zero-dependency UMP parser, passes pure AV1 and Opus to offscreen FFmpeg,
 * and downloads the resulting high-fidelity MP4 directly to the user's laptop.
 */
async function handleStartCdpMediaDownload(payload: StartCdpDownloadPayload): Promise<CdpDownloadResultPayload> {
  const { sessionId, videoId, videoUrl, targetFilename, durationSeconds } = payload;
  console.log('[NEXUS-FINAL] sessionId:', sessionId);
  console.log('[NEXUS-FINAL] selectedQuality:', payload.quality || 'unknown');
  console.log('[NEXUS-FINAL] stage: CDP_ATTACH');
  await ensureOffscreenDocument();

  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'EXTENSION_READY',
      percent: 10,
      message: 'Vidleo Companion Extension ready & active',
    },
  });

  // Query existing tabs for YouTube
  const ytTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ url: ['*://*.youtube.com/*', '*://youtube.com/*'] }, (tabs) => {
        resolve(tabs || []);
      });
    } else {
      resolve([]);
    }
  });

  console.log('[NEXUS SW] Found ytTabs:', ytTabs.map(t => ({ id: t.id, url: t.url })));

  let targetTab = ytTabs.find((t) => videoId && t.url?.includes(videoId)) || ytTabs[0];

  if (!targetTab && videoUrl && chrome.tabs && chrome.tabs.create) {
    targetTab = await new Promise<chrome.tabs.Tab>((resolve) => {
      chrome.tabs.create({ url: videoUrl, active: false }, (newTab) => {
        resolve(newTab);
      });
    });
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (!targetTab?.id) {
    throw new Error('No YouTube tab available for media byte acquisition. Please open the video in YouTube.');
  }

  const tabId = targetTab.id;
  const debuggee = { tabId };
  console.log('[NEXUS SW] Selected targetTab:', tabId, targetTab.url);

  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'YOUTUBE_TAB_READY',
      percent: 20,
      message: `Active YouTube playback tab connected (tab ${tabId})`,
    },
  });

  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'CDP_ATTACHING',
      percent: 30,
      message: 'Attaching Chrome DevTools Protocol to target playback tab...',
    },
  });

  // Attach debugger
  await new Promise<void>((resolve, reject) => {
    chrome.debugger.attach(debuggee, '1.3', () => {
      if (chrome.runtime.lastError) {
        console.warn('[NEXUS SW] chrome.debugger.attach message:', chrome.runtime.lastError.message);
        if (chrome.runtime.lastError.message?.includes('Another debugger is already attached')) {
          resolve();
        } else {
          reject(new Error(chrome.runtime.lastError.message));
        }
      } else {
        console.log('[NEXUS SW] Debugger attached successfully to tab', tabId);
        resolve();
      }
    });
  });

  // Enable Network domain with large buffers
  await new Promise<void>((resolve) => {
    chrome.debugger.sendCommand(debuggee, 'Network.enable', {
      maxResourceBufferSize: 100 * 1024 * 1024,
      maxTotalBufferSize: 200 * 1024 * 1024,
    }, (res) => {
      console.log('[NEXUS SW] Network.enable response:', res, 'lastError:', chrome.runtime.lastError?.message);
      resolve();
    });
  });

  // Enable Page domain and add script to prefer AVC1 / H.264 over AV1 / VP9 for universal WhatsApp compatibility
  await new Promise<void>((resolve) => {
    chrome.debugger.sendCommand(debuggee, 'Page.enable', {}, () => {
      chrome.debugger.sendCommand(debuggee, 'Page.addScriptToEvaluateOnNewDocument', {
        source: `
          (function() {
            try {
              const orig = window.MediaSource?.isTypeSupported?.bind(window.MediaSource);
              if (orig) {
                window.MediaSource.isTypeSupported = function(mime) {
                  if (typeof mime === 'string') {
                    const m = mime.toLowerCase();
                    if (m.includes('av01') || m.includes('av1') || m.includes('vp9') || m.includes('vp09')) {
                      return false;
                    }
                  }
                  return orig(mime);
                };
              }
            } catch(e) {}
          })();
        `
      }, () => resolve());
    });
  });


  console.log('[NEXUS-FINAL] stage: NETWORK');
  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'NETWORK_LISTENING',
      percent: 40,
      message: 'Listening for YouTube active player media response bodies...',
    },
  });

  // Wait for media response body
  const rawUmpBytes = await new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { chrome.debugger.onEvent.removeListener(eventListener); } catch {}
        try { chrome.debugger.detach(debuggee, () => {}); } catch {}
        reject(new Error('Timed out waiting for YouTube player media response body'));
      }
    }, 35000);

    const targetRequestIds = new Set<string>();

    const eventListener = (source: chrome.debugger.Debuggee, method: string, params?: any) => {
      if (source.tabId && source.tabId !== tabId) return;

      if (method === 'Network.responseReceived' && params?.response) {
        const url = params.response.url || '';
        const mime = params.response.mimeType || '';
        if (url.includes('videoplayback') || mime.includes('vnd.yt-ump')) {
          console.log('[NEXUS SW] videoplayback response received:', params.requestId, mime);
          targetRequestIds.add(params.requestId);
        }
      }

      if (method === 'Network.loadingFinished' && params?.requestId) {
        // Check if targeted or large response
        chrome.debugger.sendCommand(debuggee, 'Network.getResponseBody', { requestId: params.requestId }, (res: any) => {
          if (chrome.runtime.lastError || !res?.body) return;

          let bytes: Uint8Array;
          if (res.base64Encoded) {
            const binary = atob(res.body);
            bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          } else {
            const enc = new TextEncoder();
            bytes = enc.encode(res.body);
          }

          if (bytes.length > 50000 && containsMoof(bytes)) {
            console.log('[NEXUS-FINAL] stage: MEDIA_RESPONSE, bytes:', bytes.length, 'from req:', params.requestId);
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              try { chrome.debugger.onEvent.removeListener(eventListener); } catch {}
              try { chrome.debugger.detach(debuggee, () => {}); } catch {}
              resolve(bytes);
            }
          }
        });
      }
    };

    chrome.debugger.onEvent.addListener(eventListener);

    // Trigger fresh media request by reloading target tab with debugger and listeners active
    console.log('[NEXUS SW] Reloading tab', tabId, 'now that listeners are active');
    if (chrome.tabs && chrome.tabs.reload) {
      chrome.tabs.reload(tabId);
    } else {
      chrome.debugger.sendCommand(debuggee, 'Page.reload', {}, () => {});
    }
  });

  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'MEDIA_DETECTED',
      percent: 50,
      message: 'Original YouTube UMP media stream detected!',
      bytesAcquired: rawUmpBytes.length,
    },
  });

  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'RESPONSE_BODY_ACQUIRING',
      percent: 60,
      message: `Acquiring response body (${rawUmpBytes.length} bytes)...`,
      bytesAcquired: rawUmpBytes.length,
    },
  });

  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'MEDIA_BYTES_ACQUIRED',
      percent: 70,
      message: `Successfully acquired ${rawUmpBytes.length} raw media bytes`,
      bytesAcquired: rawUmpBytes.length,
    },
  });

  // Demux UMP packets
  console.log('[NEXUS-FINAL] stage: UMP, raw bytes:', rawUmpBytes.length);
  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'UMP_DEMUXING',
      percent: 75,
      message: 'Demuxing UMP packets into isolated audio & video streams...',
      bytesAcquired: rawUmpBytes.length,
    },
  });

  console.log('[NEXUS SW] Demuxing UMP packets into isolated audio & video streams...');
  const demux = parseUmpMediaStreams(rawUmpBytes);
  console.log(`[NEXUS SW] Demux complete: videoBytes=${demux.videoBytes}, audioBytes=${demux.audioBytes}, parts=${demux.streamPartsCount}`);

  if (!demux.audioWebm || !demux.videoMp4) {
    throw new Error(`Failed to demux audio or video from acquired UMP media stream (audio: ${demux.audioBytes}, video: ${demux.videoBytes})`);
  }

  console.log('[NEXUS-FINAL] stage: VIDEO_ASSEMBLY');
  console.log(`[NEXUS-FINAL] videoStream: bytes=${demux.videoBytes}, itag=395, container=mp4`);
  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'VIDEO_ASSEMBLY',
      percent: 80,
      message: `Assembled video track (${demux.videoBytes} bytes, itag 395 AV1)`,
      videoBytes: demux.videoBytes,
      audioBytes: demux.audioBytes,
    },
  });

  console.log('[NEXUS-FINAL] stage: AUDIO_ASSEMBLY');
  console.log(`[NEXUS-FINAL] audioStream: bytes=${demux.audioBytes}, itag=251, container=webm`);
  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'AUDIO_ASSEMBLY',
      percent: 85,
      message: `Assembled audio track (${demux.audioBytes} bytes, itag 251 Opus)`,
      videoBytes: demux.videoBytes,
      audioBytes: demux.audioBytes,
    },
  });

  // Convert to base64 for message passing to offscreen FFmpeg
  console.log('[NEXUS SW] Converting streams to base64 for offscreen FFmpeg...');
  const videoBase64 = uint8ArrayToBase64(demux.videoMp4);
  const audioBase64 = uint8ArrayToBase64(demux.audioWebm);
  console.log(`[NEXUS SW] Converted base64: video=${videoBase64.length} chars, audio=${audioBase64.length} chars`);

  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'MUXING',
      percent: 90,
      message: 'Remuxing into MP4 container via local FFmpeg (faststart)...',
      videoBytes: demux.videoBytes,
      audioBytes: demux.audioBytes,
    },
  });

  // Ensure offscreen document is alive immediately before sending media message
  console.log('[NEXUS-FINAL] stage: OFFSCREEN dispatch');
  console.log('[NEXUS SW] Ensuring offscreen document is alive before remux dispatch...');
  await ensureOffscreenDocument();

  console.log('[NEXUS SW] Dispatching PROCESS_CDP_MEDIA_FFMPEG to offscreen document...');
  const ffmpegRes = await new Promise<any>((resolve, reject) => {
    // Keep offscreen alive with a port connection during remux
    let keepAlivePort: chrome.runtime.Port | null = null;
    try {
      keepAlivePort = chrome.runtime.connect({ name: `nexus-remux-${sessionId}` });
    } catch {}

    const cleanup = () => {
      if (keepAlivePort) {
        try { keepAlivePort.disconnect(); } catch {}
        keepAlivePort = null;
      }
    };

    chrome.runtime.sendMessage({
      type: 'PROCESS_CDP_MEDIA_FFMPEG',
      payload: {
        sessionId,
        filename: targetFilename || `Vidleo_YouTube_${videoId || Date.now()}.mp4`,
        videoBase64,
        audioBase64,
        videoBytesCount: demux.videoBytes,
        audioBytesCount: demux.audioBytes,
      },
    }, (resp) => {
      cleanup();
      if (chrome.runtime.lastError) {
        console.error('[NEXUS SW] chrome.runtime.sendMessage error:', chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
      } else if (resp?.status === 'error') {
        console.error('[NEXUS SW] offscreen returned error:', resp.error);
        reject(new Error(resp.error));
      } else {
        console.log('[NEXUS SW] offscreen FFmpeg completed successfully:', resp?.result?.filename || 'done', 'codecs:', resp?.result?.videoCodec, resp?.result?.audioCodec);
        if (resp?.result?.ffmpegLogs) {
          console.log('[NEXUS SW] Recent FFmpeg logs:\n' + resp.result.ffmpegLogs.join('\n'));
        }
        resolve(resp?.result || resp);
      }
    });
  });

  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'DOWNLOAD_READY',
      percent: 95,
      message: 'Media multiplexing complete, triggering browser download...',
    },
  });

  if (ffmpegRes.blobUrl && chrome.downloads) {
    chrome.downloads.onChanged.addListener((delta) => {
      console.log(`[NEXUS SW] chrome.downloads onChanged for ID ${delta.id}: state=${delta.state?.current || 'unchanged'}, error=${delta.error?.current || 'none'}, filename=${delta.filename?.current || ''}`);
    });

    chrome.downloads.download({
      url: ffmpegRes.blobUrl,
      filename: ffmpegRes.filename,
      saveAs: false,
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn('[NEXUS SW] chrome.downloads warning:', chrome.runtime.lastError.message);
      } else {
        console.log(`[NEXUS SW] chrome.downloads started with ID ${downloadId}`);
      }
    });
  }

  const resultPayload: CdpDownloadResultPayload = {
    success: true,
    sessionId,
    filename: ffmpegRes.filename,
    totalBytes: ffmpegRes.outputBytes,
    rawUmpBytes: demux.rawUmpBytes,
    videoBytes: demux.videoBytes,
    audioBytes: demux.audioBytes,
    duration: ffmpegRes.duration,
    videoCodec: ffmpegRes.videoCodec || 'av1',
    audioCodec: ffmpegRes.audioCodec || 'opus',
    resolution: `${ffmpegRes.width}x${ffmpegRes.height}`,
    sha256: ffmpegRes.sha256,
    blobUrl: ffmpegRes.blobUrl,
    downloadStarted: true,
    provenance: 'CDP_ACTIVE_PLAYER_MEDIA_RESPONSE_BODY',
  };

  broadcastToTabs({
    type: 'NEXUS_CDP_PROGRESS',
    payload: {
      sessionId,
      state: 'COMPLETE',
      percent: 100,
      message: 'Download complete · Playable media saved to laptop',
    },
  });

  broadcastToTabs({
    type: 'NEXUS_CDP_RESULT',
    payload: resultPayload,
  });

  return resultPayload;
}

/**
 * Coordinates in-browser playback capture across YouTube tab and offscreen FFmpeg engine
 */
async function handleStartPlaybackCapture(payload: any) {
  const { sessionId, videoId, videoUrl, durationSeconds, mode, targetFilename } = payload;
  await ensureOffscreenDocument();

  broadcastToTabs({
    type: 'PLAYBACK_CAPTURE_STARTED',
    payload: { sessionId, stage: 'locating_player' }
  });

  // Query existing tabs
  const ytTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ url: ['*://*.youtube.com/*', '*://youtube.com/*'] }, (tabs) => {
        resolve(tabs || []);
      });
    } else {
      resolve([]);
    }
  });

  let targetTab = ytTabs.find((t) => videoId && t.url?.includes(videoId)) || ytTabs[0];

  if (!targetTab && videoUrl && chrome.tabs && chrome.tabs.create) {
    targetTab = await new Promise<chrome.tabs.Tab>((resolve) => {
      chrome.tabs.create({ url: videoUrl, active: false }, (newTab) => {
        resolve(newTab);
      });
    });
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (!targetTab?.id) {
    throw new Error('No YouTube tab available for playback capture. Please open video in YouTube first.');
  }

  console.log(`[NEXUS Service Worker] Requesting START_TAB_PLAYBACK_CAPTURE from tab ${targetTab.id}...`);

  const tabResponse = await new Promise<any>((resolve, reject) => {
    chrome.tabs.sendMessage(targetTab.id!, {
      type: 'START_TAB_PLAYBACK_CAPTURE',
      payload: { sessionId, durationSeconds, mode, targetFilename }
    }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (resp?.status === 'error') {
        reject(new Error(resp.error));
      } else {
        resolve(resp?.result || resp);
      }
    });
  });

  console.log(`[NEXUS Service Worker] Content script capture finished, dispatching to offscreen FFmpeg...`);

  broadcastToTabs({
    type: 'PLAYBACK_CAPTURE_PROGRESS',
    payload: {
      sessionId,
      stage: 'processing_ffmpeg',
      percent: 50,
      bytesReceived: tabResponse.captureBytes,
    }
  });

  const ffmpegResponse = await new Promise<any>((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'PROCESS_PLAYBACK_CAPTURE_FFMPEG',
      payload: {
        sessionId,
        filename: targetFilename || tabResponse.filename || `Vidleo_YouTube_Demo_${Date.now()}.webm`,
        base64Data: tabResponse.base64Data,
        captureBytes: tabResponse.captureBytes,
        captureSha256: tabResponse.captureSha256,
        mimeType: tabResponse.mimeType,
        videoTracksCount: tabResponse.videoTracksCount,
        audioTracksCount: tabResponse.audioTracksCount,
        videoWidth: tabResponse.videoWidth,
        videoHeight: tabResponse.videoHeight,
      }
    }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (resp?.status === 'error') {
        reject(new Error(resp.error));
      } else {
        resolve(resp?.result || resp);
      }
    });
  });

  const finalResult = ffmpegResponse || tabResponse;

  if (finalResult.blobUrl && chrome.downloads) {
    console.log(`[NEXUS Service Worker] Initiating chrome.downloads for ${finalResult.filename}...`);
    chrome.downloads.download({
      url: finalResult.blobUrl,
      filename: finalResult.filename,
      saveAs: false,
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn('[NEXUS Service Worker] chrome.downloads error:', chrome.runtime.lastError.message);
      } else {
        console.log(`[NEXUS Service Worker] Chrome download started with ID ${downloadId}`);
      }
    });
  }

  broadcastToTabs({
    type: 'PLAYBACK_CAPTURE_COMPLETE',
    payload: finalResult,
  });

  return finalResult;
}

