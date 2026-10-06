// src/background/service-worker.ts
var DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
var OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
console.log("[NEXUS Service Worker] Background Service Worker initialized");
async function ensureOffscreenDocument() {
  try {
    if (chrome.offscreen && chrome.offscreen.hasDocument) {
      const hasDoc = await chrome.offscreen.hasDocument();
      if (hasDoc) {
        return;
      }
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH),
        reasons: ["BLOBS"],
        justification: "NEXUS client-first media demuxing and MP4 multiplexing"
      });
      console.log("[NEXUS Service Worker] Created offscreen document, awaiting liveness...");
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 50));
        try {
          const res = await chrome.runtime.sendMessage({ type: "PING" });
          if (res && res.type === "PONG") {
            console.log("[NEXUS Service Worker] Offscreen document confirmed ready via PONG");
            break;
          }
        } catch {
        }
      }
    }
  } catch (err) {
    if (!err.message?.includes("Only a single offscreen document may be created")) {
      console.error("[NEXUS Service Worker] Error creating offscreen document:", err);
      throw err;
    }
  }
}
var observedYouTubeStreams = /* @__PURE__ */ new Map();
if (chrome.webRequest && chrome.webRequest.onBeforeRequest) {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      try {
        const streamUrl = details.url;
        if (!streamUrl.includes("/videoplayback")) return;
        const parsed = new URL(streamUrl);
        const itag = parsed.searchParams.get("itag") || "";
        if (details.tabId >= 0 && chrome.tabs) {
          chrome.tabs.get(details.tabId, (tab) => {
            if (chrome.runtime.lastError || !tab?.url) return;
            const vm = tab.url.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
            if (vm && vm[1]) {
              const videoId = vm[1];
              const entry = { url: streamUrl, itag, videoId, timestamp: Date.now() };
              observedYouTubeStreams.set(videoId, entry);
              if (itag) observedYouTubeStreams.set(`${videoId}-${itag}`, entry);
            }
          });
        }
      } catch {
      }
    },
    { urls: ["*://*.googlevideo.com/videoplayback*"] }
  );
}
async function resolveYouTubeDirect(url) {
  const videoIdMatch = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  const videoId = videoIdMatch ? videoIdMatch[1] : "";
  let oembedData = null;
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (oembedRes.ok) {
      oembedData = await oembedRes.json();
    }
  } catch {
  }
  let playerData = null;
  try {
    const pageRes = await fetch(url, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
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
    console.warn("[NEXUS Extension] Direct watch page fetch error:", e);
  }
  const title = playerData?.videoDetails?.title || oembedData?.title || "YouTube Stream";
  const author = playerData?.videoDetails?.author || oembedData?.author_name || "YouTube Creator";
  const durationSec = parseInt(playerData?.videoDetails?.lengthSeconds || "0", 10);
  const thumbnail = oembedData?.thumbnail_url || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "");
  const formats = playerData?.streamingData?.formats || [];
  const adaptiveFormats = playerData?.streamingData?.adaptiveFormats || [];
  const observed = videoId ? observedYouTubeStreams.get(videoId) : null;
  const isObservedRecent = Boolean(observed && Date.now() - observed.timestamp < 36e5);
  const candidateStream = formats.find((f) => Boolean(f.url)) || adaptiveFormats.find((f) => Boolean(f.url)) || (isObservedRecent && observed ? { url: observed.url } : null);
  const hasDirectUrl = Boolean(candidateStream?.url);
  const pipelineStatus = hasDirectUrl ? isObservedRecent ? "BROWSER_ACQUISITION_READY" : "STREAM_CANDIDATE_AVAILABLE" : "STREAM_SOURCE_UNRESOLVED";
  return {
    job_id: `yt-ext-${Date.now()}`,
    id: videoId || `yt-${Date.now()}`,
    title,
    uploader: author,
    duration: durationSec,
    thumbnail,
    platform: "youtube",
    pipeline_status: pipelineStatus,
    direct_stream_available: hasDirectUrl,
    candidate_stream_url: candidateStream?.url || null,
    video_formats: formats.map((f) => ({
      format_id: String(f.itag),
      format_note: f.qualityLabel || `${f.height || 360}p`,
      ext: f.mimeType?.includes("webm") ? "webm" : "mp4",
      filesize: f.contentLength ? parseInt(f.contentLength, 10) : 0,
      vcodec: f.mimeType?.split("codecs=")[1]?.replace(/["']/g, "") || "h264",
      acodec: "aac",
      url: f.url || (isObservedRecent && observed?.itag === String(f.itag) ? observed.url : void 0),
      is_ciphered: !f.url && !(isObservedRecent && observed?.itag === String(f.itag)) && (Boolean(f.signatureCipher) || Boolean(f.cipher))
    })),
    audio_formats: adaptiveFormats.filter((f) => f.mimeType?.startsWith("audio/")).map((f) => ({
      format_id: String(f.itag),
      format_note: `${Math.round((f.bitrate || 128e3) / 1e3)} kbps`,
      ext: f.mimeType?.includes("webm") ? "webm" : "m4a",
      filesize: f.contentLength ? parseInt(f.contentLength, 10) : 0,
      acodec: f.mimeType?.includes("webm") ? "opus" : "aac",
      url: f.url || (isObservedRecent && observed?.itag === String(f.itag) ? observed.url : void 0),
      is_ciphered: !f.url && !(isObservedRecent && observed?.itag === String(f.itag)) && (Boolean(f.signatureCipher) || Boolean(f.cipher))
    }))
  };
}
async function resolveMedia(url, apiBaseUrl = DEFAULT_API_BASE_URL) {
  const isYoutube = url.includes("youtube.com") || url.includes("youtu.be");
  if (isYoutube) {
    try {
      const directData = await resolveYouTubeDirect(url);
      if (directData && (directData.title !== "YouTube Stream" || directData.video_formats.length > 0)) {
        console.log("[NEXUS Extension] YouTube media resolved directly via client network (0 Railway requests)");
        return directData;
      }
    } catch (directErr) {
      console.warn("[NEXUS Extension] Direct YouTube client resolution failed, attempting control plane fallback:", directErr);
    }
  }
  const endpoint = `${apiBaseUrl.replace(/\/+$/, "")}/api/resolve`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Control plane resolve failed (${res.status}): ${errorText}`);
  }
  const data = await res.json();
  return data;
}
async function notifyComplete(jobId, formatId, deliveryMode, bytesDownloaded, apiBaseUrl = DEFAULT_API_BASE_URL) {
  try {
    const endpoint = `${apiBaseUrl.replace(/\/+$/, "")}/api/downloads/${jobId}/complete`;
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format_id: formatId,
        delivery_mode: deliveryMode,
        bytes_downloaded: bytesDownloaded
      })
    });
  } catch (err) {
    console.warn("[NEXUS Service Worker] Failed to report download completion:", err);
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;
  if (message.type === "PING") {
    sendResponse({ type: "PONG", role: "service_worker", timestamp: Date.now() });
    return false;
  }
  if (message.type === "YOUTUBE_MEDIA_OBSERVED") {
    const payload = message.payload;
    if (payload?.streamUrl) {
      const vid = payload.videoId;
      if (vid) {
        observedYouTubeStreams.set(vid, {
          url: payload.streamUrl,
          videoId: vid,
          timestamp: Date.now()
        });
      }
    }
    sendResponse({ status: "recorded" });
    return false;
  }
  if (message.type === "RESOLVE_MEDIA") {
    const payload = message.payload;
    const apiBaseUrl = payload.apiBaseUrl || DEFAULT_API_BASE_URL;
    resolveMedia(payload.url, apiBaseUrl).then((data) => {
      sendResponse({
        type: "RESOLVE_MEDIA_SUCCESS",
        payload: {
          jobId: data.job_id || data.manifest?.job_id,
          manifest: data.manifest || data
        }
      });
    }).catch((err) => {
      sendResponse({
        type: "RESOLVE_MEDIA_ERROR",
        payload: { error: err.message }
      });
    });
    return true;
  }
  if (message.type === "START_DOWNLOAD") {
    const payload = message.payload;
    ensureOffscreenDocument().then(() => {
      chrome.runtime.sendMessage(message).catch((err) => {
        console.error("[NEXUS Service Worker] Failed to dispatch START_DOWNLOAD to offscreen:", err);
      });
      sendResponse({ status: "dispatched_to_offscreen" });
    }).catch((err) => {
      sendResponse({ status: "error", error: err.message });
    });
    return true;
  }
  if (message.type === "START_DIRECT_ACQUISITION") {
    const payload = message.payload;
    ensureOffscreenDocument().then(() => {
      chrome.runtime.sendMessage(message).catch((err) => {
        console.error("[NEXUS Service Worker] Failed to dispatch START_DIRECT_ACQUISITION to offscreen:", err);
      });
      sendResponse({ status: "dispatched_to_offscreen", sessionId: payload.sessionId });
    }).catch((err) => {
      sendResponse({ status: "error", error: err.message });
    });
    return true;
  }
  if (message.type === "START_PLAYBACK_CAPTURE") {
    const payload = message.payload;
    handleStartPlaybackCapture(payload).then((result) => {
      sendResponse({ status: "complete", result });
    }).catch((err) => {
      console.error("[NEXUS Service Worker] Playback capture failed:", err);
      broadcastToTabs({
        type: "PLAYBACK_CAPTURE_FAILED",
        payload: { sessionId: payload?.sessionId, error: err.message }
      });
      sendResponse({ status: "error", error: err.message });
    });
    return true;
  }
  if (message.type === "DOWNLOAD_COMPLETE") {
    const payload = message.payload;
    console.log(`[NEXUS Service Worker] Download complete for job ${payload.jobId}, initiating chrome.downloads...`);
    if (payload.blobUrl && chrome.downloads) {
      chrome.downloads.download({
        url: payload.blobUrl,
        filename: payload.filename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error("[NEXUS Service Worker] chrome.downloads error:", chrome.runtime.lastError.message);
        } else {
          console.log(`[NEXUS Service Worker] Download started with ID: ${downloadId}`);
        }
      });
    }
    notifyComplete(
      payload.jobId,
      "extension_format",
      payload.deliveryMode,
      payload.totalBytes
    );
    return false;
  }
  if (message.type === "ACQUISITION_COMPLETE") {
    const payload = message.payload;
    console.log(`[NEXUS Service Worker] Direct acquisition complete for session ${payload.sessionId}: ${payload.filename}`);
    if (payload.blobUrl && chrome.downloads) {
      chrome.downloads.download({
        url: payload.blobUrl,
        filename: payload.filename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.warn("[NEXUS Service Worker] chrome.downloads error:", chrome.runtime.lastError.message);
        } else {
          console.log(`[NEXUS Service Worker] Acquisition download started with ID: ${downloadId}`);
        }
      });
    }
    broadcastToTabs(message);
    return false;
  }
  if (message.type === "ACQUISITION_PROGRESS" || message.type === "ACQUISITION_STARTED" || message.type === "ACQUISITION_FAILED" || message.type === "DOWNLOAD_PROGRESS" || message.type === "DOWNLOAD_FAILED") {
    broadcastToTabs(message);
    return false;
  }
  if (message.type === "DOWNLOAD_CANCEL") {
    chrome.runtime.sendMessage(message).catch(() => {
    });
    return false;
  }
  return false;
});
function broadcastToTabs(message) {
  if (chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {
          });
        }
      }
    });
  }
}
if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    const senderUrl = sender.url || "";
    const isAllowedOrigin = senderUrl.includes("frontend-kaveri-d.vercel.app") || senderUrl.includes("localhost:3000") || senderUrl.includes("127.0.0.1:3000") || senderUrl.includes("localhost:8092");
    if (!isAllowedOrigin) {
      sendResponse({ error: "Origin unauthorized" });
      return false;
    }
    if (message.type === "PING") {
      sendResponse({ type: "PONG", version: "1.0.0", role: "nexus_extension" });
      return false;
    }
    if (message.type === "START_DIRECT_ACQUISITION") {
      const payload = message.payload;
      ensureOffscreenDocument().then(() => {
        chrome.runtime.sendMessage(message).catch((err) => {
          console.error("[NEXUS Service Worker] Failed to dispatch START_DIRECT_ACQUISITION:", err);
        });
        sendResponse({ status: "dispatched_to_offscreen", sessionId: payload.sessionId });
      }).catch((err) => {
        sendResponse({ status: "error", error: err.message });
      });
      return true;
    }
    if (message.type === "START_DOWNLOAD") {
      const payload = message.payload;
      ensureOffscreenDocument().then(() => {
        chrome.runtime.sendMessage(message).catch((err) => {
          console.error("[NEXUS Service Worker] Failed to dispatch START_DOWNLOAD to offscreen:", err);
        });
        sendResponse({ status: "dispatched_to_offscreen", jobId: payload.jobId });
      }).catch((err) => {
        sendResponse({ status: "error", error: err.message });
      });
      return true;
    }
    if (message.type === "RESOLVE_MEDIA") {
      const payload = message.payload;
      const apiBaseUrl = payload.apiBaseUrl || DEFAULT_API_BASE_URL;
      resolveMedia(payload.url, apiBaseUrl).then((data) => {
        sendResponse({
          type: "RESOLVE_MEDIA_SUCCESS",
          payload: data
        });
      }).catch((err) => {
        sendResponse({
          type: "RESOLVE_MEDIA_ERROR",
          payload: { error: err.message }
        });
      });
      return true;
    }
    if (message.type === "START_PLAYBACK_CAPTURE") {
      const payload = message.payload;
      handleStartPlaybackCapture(payload).then((result) => {
        sendResponse({ status: "complete", result });
      }).catch((err) => {
        sendResponse({ status: "error", error: err.message });
      });
      return true;
    }
    return false;
  });
}
async function handleStartPlaybackCapture(payload) {
  const { sessionId, videoId, videoUrl, durationSeconds, mode, targetFilename } = payload;
  await ensureOffscreenDocument();
  broadcastToTabs({
    type: "PLAYBACK_CAPTURE_STARTED",
    payload: { sessionId, stage: "locating_player" }
  });
  const ytTabs = await new Promise((resolve) => {
    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ url: ["*://*.youtube.com/*", "*://youtube.com/*"] }, (tabs) => {
        resolve(tabs || []);
      });
    } else {
      resolve([]);
    }
  });
  let targetTab = ytTabs.find((t) => videoId && t.url?.includes(videoId)) || ytTabs[0];
  if (!targetTab && videoUrl && chrome.tabs && chrome.tabs.create) {
    targetTab = await new Promise((resolve) => {
      chrome.tabs.create({ url: videoUrl, active: false }, (newTab) => {
        resolve(newTab);
      });
    });
    await new Promise((r) => setTimeout(r, 3e3));
  }
  if (!targetTab?.id) {
    throw new Error("No YouTube tab available for playback capture. Please open video in YouTube first.");
  }
  console.log(`[NEXUS Service Worker] Requesting START_TAB_PLAYBACK_CAPTURE from tab ${targetTab.id}...`);
  const tabResponse = await new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(targetTab.id, {
      type: "START_TAB_PLAYBACK_CAPTURE",
      payload: { sessionId, durationSeconds, mode, targetFilename }
    }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (resp?.status === "error") {
        reject(new Error(resp.error));
      } else {
        resolve(resp?.result || resp);
      }
    });
  });
  console.log(`[NEXUS Service Worker] Content script capture finished, dispatching to offscreen FFmpeg...`);
  broadcastToTabs({
    type: "PLAYBACK_CAPTURE_PROGRESS",
    payload: {
      sessionId,
      stage: "processing_ffmpeg",
      percent: 50,
      bytesReceived: tabResponse.captureBytes
    }
  });
  const ffmpegResponse = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: "PROCESS_PLAYBACK_CAPTURE_FFMPEG",
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
        videoHeight: tabResponse.videoHeight
      }
    }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (resp?.status === "error") {
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
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn("[NEXUS Service Worker] chrome.downloads error:", chrome.runtime.lastError.message);
      } else {
        console.log(`[NEXUS Service Worker] Chrome download started with ID ${downloadId}`);
      }
    });
  }
  broadcastToTabs({
    type: "PLAYBACK_CAPTURE_COMPLETE",
    payload: finalResult
  });
  return finalResult;
}
//# sourceMappingURL=background.js.map
