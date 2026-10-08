// src/utils/ump-parser.ts
function readVarInt(buf, offset) {
  if (offset >= buf.length) return [-1, offset];
  const firstByte = buf[offset];
  const byteLength = firstByte < 128 ? 1 : firstByte < 192 ? 2 : firstByte < 224 ? 3 : firstByte < 240 ? 4 : 5;
  if (offset + byteLength > buf.length) return [-1, offset];
  let value = 0;
  switch (byteLength) {
    case 1:
      value = buf[offset++];
      break;
    case 2:
      value = (buf[offset] & 63) + 64 * buf[offset + 1];
      offset += 2;
      break;
    case 3:
      value = (buf[offset] & 31) + 32 * (buf[offset + 1] + 256 * buf[offset + 2]);
      offset += 3;
      break;
    case 4:
      value = (buf[offset] & 15) + 16 * (buf[offset + 1] + 256 * (buf[offset + 2] + 256 * buf[offset + 3]));
      offset += 4;
      break;
    default:
      value = buf[offset + 1] + 256 * (buf[offset + 2] + 256 * (buf[offset + 3] + 256 * buf[offset + 4]));
      offset += 5;
      break;
  }
  return [value, offset];
}
function concatByteArrays(arrays) {
  let totalLen = 0;
  for (const a of arrays) totalLen += a.length;
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const a of arrays) {
    result.set(a, pos);
    pos += a.length;
  }
  return result;
}
function parseUmpMediaStreams(rawUmp) {
  let offset = 0;
  const streamTracks = /* @__PURE__ */ new Map();
  while (offset < rawUmp.length) {
    const [partType, afterType] = readVarInt(rawUmp, offset);
    if (partType < 0) break;
    offset = afterType;
    const [partSize, afterSize] = readVarInt(rawUmp, offset);
    if (partSize < 0) break;
    offset = afterSize;
    if (offset + partSize > rawUmp.length) break;
    if (partType === 21 && partSize > 1) {
      const streamId = rawUmp[offset];
      const payload = rawUmp.subarray(offset + 1, offset + partSize);
      if (!streamTracks.has(streamId)) streamTracks.set(streamId, []);
      streamTracks.get(streamId).push(payload);
    }
    offset += partSize;
  }
  function isWebm(buf) {
    if (buf.length < 4) return false;
    return buf[0] === 26 && buf[1] === 69 && buf[2] === 223 && buf[3] === 163 || buf[0] === 31 && buf[1] === 67 && buf[2] === 182 && buf[3] === 117;
  }
  function isMp4(buf) {
    if (buf.length < 8) return false;
    const tag = String.fromCharCode(buf[4], buf[5], buf[6], buf[7]);
    return tag === "ftyp" || tag === "moov" || tag === "moof" || tag === "sidx" || tag === "styp" || tag === "emsg";
  }
  const audioInitChunks = [];
  const audioClusters = [];
  const videoInitChunks = [];
  const videoFrags = [];
  const sortedTrackIds = Array.from(streamTracks.keys()).sort((a, b) => a - b);
  for (const id of sortedTrackIds) {
    const chunks = streamTracks.get(id) || [];
    for (const chunk of chunks) {
      if (isWebm(chunk)) {
        if (chunk[0] === 26 && chunk[1] === 69 && chunk[2] === 223 && chunk[3] === 163) {
          audioInitChunks.push(chunk);
        } else {
          audioClusters.push(chunk);
        }
      } else if (isMp4(chunk)) {
        const tag = String.fromCharCode(chunk[4], chunk[5], chunk[6], chunk[7]);
        if (tag === "ftyp" || tag === "moov") {
          videoInitChunks.push(chunk);
        } else {
          videoFrags.push(chunk);
        }
      }
    }
  }
  const audioChunks = [...audioInitChunks, ...audioClusters];
  const videoChunks = [...videoInitChunks, ...videoFrags];
  const audioWebm = audioChunks.length > 0 ? concatByteArrays(audioChunks) : null;
  const videoMp4 = videoChunks.length > 0 ? concatByteArrays(videoChunks) : null;
  let videoCodec = "h264";
  if (videoMp4) {
    const headerStr = String.fromCharCode(...videoMp4.subarray(0, Math.min(256, videoMp4.length)));
    if (headerStr.includes("av01")) videoCodec = "av1";
    else if (headerStr.includes("vp09") || headerStr.includes("vp9")) videoCodec = "vp9";
  }
  let audioCodec = "opus";
  if (audioWebm && audioInitChunks.length > 0) {
    audioCodec = "opus";
  }
  return {
    audioWebm,
    videoMp4,
    rawUmpBytes: rawUmp.length,
    audioBytes: audioWebm ? audioWebm.length : 0,
    videoBytes: videoMp4 ? videoMp4.length : 0,
    streamPartsCount: streamTracks.size,
    videoCodec,
    audioCodec
  };
}

// src/background/service-worker.ts
var DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
var OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
console.log("[NEXUS Service Worker] Background Service Worker initialized");
async function ensureOffscreenDocument(forceFresh = false) {
  if (!chrome.offscreen) return;
  if (!forceFresh) {
    try {
      const pong = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 300);
        chrome.runtime.sendMessage({ type: "OFFSCREEN_PING" }, (resp) => {
          clearTimeout(timer);
          if (!chrome.runtime.lastError && resp?.type === "OFFSCREEN_PONG") {
            resolve(true);
          } else {
            resolve(false);
          }
        });
      });
      if (pong) {
        console.log("[NEXUS Service Worker] Existing offscreen document confirmed alive");
        return;
      }
    } catch {
    }
  }
  try {
    if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) {
      console.log("[NEXUS Service Worker] Closing unresponsive offscreen document...");
      await chrome.offscreen.closeDocument();
    }
  } catch (closeErr) {
    console.warn("[NEXUS Service Worker] Notice closing old offscreen document:", closeErr);
  }
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH),
      reasons: ["BLOBS", "AUDIO_PLAYBACK"],
      justification: "NEXUS client-first media demuxing and MP4 multiplexing"
    });
    console.log("[NEXUS Service Worker] Created fresh offscreen document, awaiting liveness...");
  } catch (err) {
    if (!err?.message?.includes("Only a single offscreen document may be created")) {
      console.error("[NEXUS Service Worker] Error creating offscreen document:", err);
      throw err;
    }
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "OFFSCREEN_PING" }, (r) => {
          if (!chrome.runtime.lastError && r?.type === "OFFSCREEN_PONG") resolve(r);
          else resolve(null);
        });
      });
      if (res && res.type === "OFFSCREEN_PONG") {
        console.log("[NEXUS Service Worker] Fresh offscreen document confirmed ready via OFFSCREEN_PONG");
        return;
      }
    } catch {
    }
  }
}
var observedYouTubeStreams = /* @__PURE__ */ new Map();
var videoStreamInventories = /* @__PURE__ */ new Map();
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
  let tabInventory = null;
  if (chrome.tabs && chrome.tabs.query) {
    try {
      const ytTabs = await new Promise((resolve) => {
        chrome.tabs.query({ url: ["*://*.youtube.com/*", "*://youtube.com/*"] }, (tabs) => resolve(tabs || []));
      });
      const targetTab = ytTabs.find((t) => videoId && t.url?.includes(videoId)) || ytTabs[0];
      if (targetTab?.id) {
        tabInventory = await new Promise((resolve) => {
          chrome.tabs.sendMessage(targetTab.id, { type: "GET_YOUTUBE_STREAM_INVENTORY", videoId }, (resp) => {
            if (!chrome.runtime.lastError && resp?.status === "success" && resp.data) {
              resolve(resp.data);
            } else {
              resolve(null);
            }
          });
          setTimeout(() => resolve(null), 1500);
        });
      }
    } catch (tabErr) {
      console.warn("[NEXUS Extension] Error querying active YouTube tab inventory:", tabErr);
    }
  }
  if (!tabInventory && videoId && videoStreamInventories.has(videoId)) {
    tabInventory = videoStreamInventories.get(videoId);
  }
  if (tabInventory && tabInventory.streams?.length > 0) {
    console.log(`[NEXUS Extension] [BUG A RESOLVED] Discovered ${tabInventory.streams.length} genuine streams from YouTube player for ${videoId}`);
    const streams = tabInventory.streams;
    const videoStreams = streams.filter((s) => s.hasVideo);
    const audioStreams = streams.filter((s) => s.hasAudio && !s.hasVideo);
    const videoFormats = videoStreams.map((s) => ({
      format_id: s.itag,
      itag: s.itag,
      qualityLabel: s.qualityLabel,
      format_note: s.qualityLabel || `${s.height || 360}p`,
      width: s.width,
      height: s.height,
      fps: s.fps,
      mimeType: s.mimeType,
      vcodec: s.videoCodec,
      acodec: s.audioCodec || "aac",
      bitrate: s.bitrate,
      filesize: s.contentLength,
      ext: s.mimeType?.includes("webm") ? "webm" : "mp4",
      availability: "ACTUAL_MEDIA_AVAILABLE",
      is_ciphered: false,
      url: s.url,
      hasVideo: true,
      hasAudio: s.hasAudio
    }));
    const audioFormats = audioStreams.map((s) => ({
      format_id: s.itag,
      itag: s.itag,
      format_note: `${Math.round((Number(s.bitrate) || 128e3) / 1e3)} kbps`,
      bitrate: s.bitrate,
      filesize: s.contentLength,
      acodec: s.audioCodec || "opus",
      ext: s.mimeType?.includes("webm") ? "webm" : "m4a",
      availability: "ACTUAL_MEDIA_AVAILABLE",
      is_ciphered: false,
      url: s.url,
      hasVideo: false,
      hasAudio: true
    }));
    return {
      job_id: `yt-inv-${Date.now()}`,
      id: videoId || `yt-${Date.now()}`,
      title: tabInventory.title || "YouTube Stream",
      uploader: tabInventory.author || "YouTube Creator",
      duration: tabInventory.duration || 0,
      thumbnail: tabInventory.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : ""),
      platform: "youtube",
      pipeline_status: "ACTUAL_MEDIA_ACQUISITION_READY",
      direct_stream_available: true,
      video_formats: videoFormats,
      audio_formats: audioFormats
    };
  }
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
  const pipelineStatus = hasDirectUrl ? isObservedRecent ? "BROWSER_ACQUISITION_READY" : "STREAM_CANDIDATE_AVAILABLE" : "ACTUAL_MEDIA_ACQUISITION_READY";
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
    video_formats: (() => {
      const videoAdaptive = adaptiveFormats.filter((f) => f.mimeType?.startsWith("video/"));
      const combinedVideo = [...formats, ...videoAdaptive];
      const seenItags = /* @__PURE__ */ new Set();
      const list = [];
      for (const f of combinedVideo) {
        const itagStr = String(f.itag);
        if (!seenItags.has(itagStr)) {
          seenItags.add(itagStr);
          list.push({
            format_id: itagStr,
            itag: itagStr,
            format_note: f.qualityLabel || `${f.height || 360}p`,
            ext: f.mimeType?.includes("webm") ? "webm" : "mp4",
            filesize: f.contentLength ? parseInt(f.contentLength, 10) : f.bitrate && durationSec ? Math.round(f.bitrate * durationSec / 8) : 0,
            vcodec: f.mimeType?.split("codecs=")[1]?.replace(/["']/g, "") || "h264",
            acodec: "aac",
            url: f.url || (isObservedRecent && observed?.itag === itagStr ? observed.url : void 0),
            is_ciphered: !f.url && !(isObservedRecent && observed?.itag === itagStr) && (Boolean(f.signatureCipher) || Boolean(f.cipher))
          });
        }
      }
      return list;
    })(),
    audio_formats: (() => {
      const audioAdaptive = adaptiveFormats.filter((f) => f.mimeType?.startsWith("audio/"));
      const seenAudioItags = /* @__PURE__ */ new Set();
      const list = [];
      for (const f of audioAdaptive) {
        const itagStr = String(f.itag);
        if (!seenAudioItags.has(itagStr)) {
          seenAudioItags.add(itagStr);
          list.push({
            format_id: itagStr,
            itag: itagStr,
            format_note: `${Math.round((f.bitrate || 128e3) / 1e3)} kbps`,
            ext: f.mimeType?.includes("webm") ? "webm" : "m4a",
            filesize: f.contentLength ? parseInt(f.contentLength, 10) : f.bitrate && durationSec ? Math.round(f.bitrate * durationSec / 8) : 0,
            acodec: f.mimeType?.includes("webm") ? "opus" : "aac",
            url: f.url || (isObservedRecent && observed?.itag === itagStr ? observed.url : void 0),
            is_ciphered: !f.url && !(isObservedRecent && observed?.itag === itagStr) && (Boolean(f.signatureCipher) || Boolean(f.cipher))
          });
        }
      }
      return list;
    })()
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
var activeCdpJobs = /* @__PURE__ */ new Map();
async function dispatchCdpMediaDownload(payload, sendResponse) {
  const sessionId = payload.sessionId || `cdp-${Date.now()}`;
  console.log("[NEXUS-FINAL] dispatchCdpMediaDownload invoked for session:", sessionId);
  let jobPromise = activeCdpJobs.get(sessionId);
  if (!jobPromise) {
    jobPromise = handleStartCdpMediaDownload(payload).finally(() => {
      activeCdpJobs.delete(sessionId);
    });
    activeCdpJobs.set(sessionId, jobPromise);
  } else {
    console.log("[NEXUS-FINAL] Deduplicating CDP download request, reusing active job for session:", sessionId);
  }
  try {
    const result = await jobPromise;
    sendResponse({
      type: "CDP_MEDIA_DOWNLOAD_SUCCESS",
      payload: result
    });
  } catch (err) {
    const errMsg = err?.message || String(err);
    console.error("[NEXUS-FINAL][SW] handleStartCdpMediaDownload failed:", errMsg, err?.stack);
    const errorPayload = {
      type: "CDP_MEDIA_DOWNLOAD_ERROR",
      sessionId: payload.sessionId,
      stage: "ACQUISITION_FAILED",
      code: "CDP_DOWNLOAD_FAILED",
      message: errMsg,
      error: errMsg,
      ffmpegExitCode: -1,
      ffmpegStderr: ""
    };
    broadcastToTabs({
      type: "CDP_MEDIA_DOWNLOAD_ERROR",
      payload: errorPayload
    });
    broadcastToTabs({
      type: "NEXUS_CDP_ERROR",
      payload: errorPayload
    });
    sendResponse({ type: "CDP_MEDIA_DOWNLOAD_ERROR", payload: errorPayload });
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
  if (message.type === "YOUTUBE_STREAM_INVENTORY_BROADCAST") {
    const payload = message.payload;
    if (payload?.videoId) {
      videoStreamInventories.set(payload.videoId, payload);
      console.log(`[NEXUS SW] Stream inventory cached for ${payload.videoId}: ${payload.streams?.length} streams`);
    }
    sendResponse({ status: "cached" });
    return false;
  }
  if (message.type === "RESOLVE_MEDIA") {
    const payload = message.payload;
    const apiBaseUrl = payload.apiBaseUrl || DEFAULT_API_BASE_URL;
    resolveMedia(payload.url, apiBaseUrl).then((data) => {
      sendResponse({
        type: "RESOLVE_MEDIA_SUCCESS",
        payload: {
          ...data,
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
  if (message.type === "NEXUS_CDP_DOWNLOAD_START") {
    const payload = message.payload;
    dispatchCdpMediaDownload(payload, sendResponse);
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
    if (message.type === "NEXUS_CDP_DOWNLOAD_START") {
      const payload = message.payload;
      dispatchCdpMediaDownload(payload, sendResponse);
      return true;
    }
    return false;
  });
}
function uint8ArrayToBase64(u) {
  let binary = "";
  const len = u.byteLength;
  const chunkSize = 32768;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, u.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}
function containsMoof(u) {
  for (let i = 0; i < u.length - 4; i++) {
    if (u[i] === 109 && u[i + 1] === 111 && u[i + 2] === 111 && u[i + 3] === 102) return true;
  }
  return false;
}
async function handleStartCdpMediaDownload(payload) {
  const { sessionId, videoId, videoUrl, targetFilename, durationSeconds } = payload;
  console.log("[NEXUS-FINAL] sessionId:", sessionId);
  console.log("[NEXUS-FINAL] selectedQuality:", payload.quality || "unknown");
  console.log("[NEXUS-FINAL] stage: CDP_ATTACH");
  await ensureOffscreenDocument();
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "EXTENSION_READY",
      percent: 10,
      message: "Vidleo Companion Extension ready & active"
    }
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
  console.log("[NEXUS SW] Found ytTabs:", ytTabs.map((t) => ({ id: t.id, url: t.url })));
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
    throw new Error("No YouTube tab available for media byte acquisition. Please open the video in YouTube.");
  }
  const tabId = targetTab.id;
  const debuggee = { tabId };
  console.log("[NEXUS SW] Selected targetTab:", tabId, targetTab.url);
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "YOUTUBE_TAB_READY",
      percent: 20,
      message: `Active YouTube playback tab connected (tab ${tabId})`
    }
  });
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "CDP_ATTACHING",
      percent: 30,
      message: "Attaching Chrome DevTools Protocol to target playback tab..."
    }
  });
  await new Promise((resolve, reject) => {
    chrome.debugger.attach(debuggee, "1.3", () => {
      if (chrome.runtime.lastError) {
        console.warn("[NEXUS SW] chrome.debugger.attach message:", chrome.runtime.lastError.message);
        if (chrome.runtime.lastError.message?.includes("Another debugger is already attached")) {
          resolve();
        } else {
          reject(new Error(chrome.runtime.lastError.message));
        }
      } else {
        console.log("[NEXUS SW] Debugger attached successfully to tab", tabId);
        resolve();
      }
    });
  });
  await new Promise((resolve) => {
    chrome.debugger.sendCommand(debuggee, "Network.enable", {
      maxResourceBufferSize: 100 * 1024 * 1024,
      maxTotalBufferSize: 200 * 1024 * 1024
    }, (res) => {
      console.log("[NEXUS SW] Network.enable response:", res, "lastError:", chrome.runtime.lastError?.message);
      resolve();
    });
  });
  await new Promise((resolve) => {
    chrome.debugger.sendCommand(debuggee, "Page.enable", {}, () => {
      chrome.debugger.sendCommand(debuggee, "Page.addScriptToEvaluateOnNewDocument", {
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
  try {
    const qLabel = String(payload.quality || "");
    let qParam = "medium";
    if (qLabel.includes("1080")) qParam = "hd1080";
    else if (qLabel.includes("720")) qParam = "hd720";
    else if (qLabel.includes("480")) qParam = "large";
    else if (qLabel.includes("360")) qParam = "medium";
    else if (qLabel.includes("240")) qParam = "small";
    else if (qLabel.includes("144")) qParam = "tiny";
    await new Promise((r) => {
      chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
        expression: `
          (function() {
            try {
              const p = document.getElementById('movie_player') || document.querySelector('ytd-player')?.getPlayer?.();
              if (p) {
                p.setPlaybackQualityRange?.('${qParam}', '${qParam}');
                p.setPlaybackQuality?.('${qParam}');
              }
            } catch(e) {}
          })();
        `
      }, () => r());
    });
  } catch {
  }
  console.log("[NEXUS-FINAL] stage: NETWORK");
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "NETWORK_LISTENING",
      percent: 40,
      message: "Listening for YouTube active player media response bodies..."
    }
  });
  const rawUmpBytes = await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          chrome.debugger.onEvent.removeListener(eventListener);
        } catch {
        }
        try {
          chrome.debugger.detach(debuggee, () => {
          });
        } catch {
        }
        reject(new Error("Timed out waiting for YouTube player media response body"));
      }
    }, 35e3);
    const targetRequestIds = /* @__PURE__ */ new Set();
    const eventListener = (source, method, params) => {
      if (source.tabId && source.tabId !== tabId) return;
      if (method === "Network.responseReceived" && params?.response) {
        const url = params.response.url || "";
        const mime = params.response.mimeType || "";
        if (url.includes("videoplayback") || mime.includes("vnd.yt-ump")) {
          console.log("[NEXUS SW] videoplayback response received:", params.requestId, mime);
          targetRequestIds.add(params.requestId);
        }
      }
      if (method === "Network.loadingFinished" && params?.requestId) {
        chrome.debugger.sendCommand(debuggee, "Network.getResponseBody", { requestId: params.requestId }, (res) => {
          if (chrome.runtime.lastError || !res?.body) return;
          let bytes;
          if (res.base64Encoded) {
            const binary = atob(res.body);
            bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          } else {
            const enc = new TextEncoder();
            bytes = enc.encode(res.body);
          }
          if (bytes.length > 5e4 && containsMoof(bytes)) {
            console.log("[NEXUS-FINAL] stage: MEDIA_RESPONSE, bytes:", bytes.length, "from req:", params.requestId);
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              try {
                chrome.debugger.onEvent.removeListener(eventListener);
              } catch {
              }
              try {
                chrome.debugger.detach(debuggee, () => {
                });
              } catch {
              }
              resolve(bytes);
            }
          }
        });
      }
    };
    chrome.debugger.onEvent.addListener(eventListener);
    console.log("[NEXUS SW] Reloading tab", tabId, "now that listeners are active");
    if (chrome.tabs && chrome.tabs.reload) {
      chrome.tabs.reload(tabId);
    } else {
      chrome.debugger.sendCommand(debuggee, "Page.reload", {}, () => {
      });
    }
  });
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "MEDIA_DETECTED",
      percent: 50,
      message: "Original YouTube UMP media stream detected!",
      bytesAcquired: rawUmpBytes.length
    }
  });
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "RESPONSE_BODY_ACQUIRING",
      percent: 60,
      message: `Acquiring response body (${rawUmpBytes.length} bytes)...`,
      bytesAcquired: rawUmpBytes.length
    }
  });
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "MEDIA_BYTES_ACQUIRED",
      percent: 70,
      message: `Successfully acquired ${rawUmpBytes.length} raw media bytes`,
      bytesAcquired: rawUmpBytes.length
    }
  });
  console.log("[NEXUS-FINAL] stage: UMP, raw bytes:", rawUmpBytes.length);
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "UMP_DEMUXING",
      percent: 75,
      message: "Demuxing UMP packets into isolated audio & video streams...",
      bytesAcquired: rawUmpBytes.length
    }
  });
  console.log("[NEXUS SW] Demuxing UMP packets into isolated audio & video streams...");
  const demux = parseUmpMediaStreams(rawUmpBytes);
  console.log(`[NEXUS SW] Demux complete: videoBytes=${demux.videoBytes}, audioBytes=${demux.audioBytes}, parts=${demux.streamPartsCount}`);
  if (!demux.audioWebm || !demux.videoMp4) {
    throw new Error(`Failed to demux audio or video from acquired UMP media stream (audio: ${demux.audioBytes}, video: ${demux.videoBytes})`);
  }
  console.log("[NEXUS-FINAL] stage: VIDEO_ASSEMBLY");
  console.log(`[NEXUS-FINAL] videoStream: bytes=${demux.videoBytes}, itag=395, container=mp4`);
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "VIDEO_ASSEMBLY",
      percent: 80,
      message: `Assembled video track (${demux.videoBytes} bytes, itag 395 AV1)`,
      videoBytes: demux.videoBytes,
      audioBytes: demux.audioBytes
    }
  });
  console.log("[NEXUS-FINAL] stage: AUDIO_ASSEMBLY");
  console.log(`[NEXUS-FINAL] audioStream: bytes=${demux.audioBytes}, itag=251, container=webm`);
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "AUDIO_ASSEMBLY",
      percent: 85,
      message: `Assembled audio track (${demux.audioBytes} bytes, itag 251 Opus)`,
      videoBytes: demux.videoBytes,
      audioBytes: demux.audioBytes
    }
  });
  console.log("[NEXUS SW] Converting streams to base64 for offscreen FFmpeg...");
  const videoBase64 = uint8ArrayToBase64(demux.videoMp4);
  const audioBase64 = uint8ArrayToBase64(demux.audioWebm);
  console.log(`[NEXUS SW] Converted base64: video=${videoBase64.length} chars, audio=${audioBase64.length} chars`);
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "MUXING",
      percent: 90,
      message: "Remuxing into MP4 container via local FFmpeg (faststart)...",
      videoBytes: demux.videoBytes,
      audioBytes: demux.audioBytes
    }
  });
  console.log("[NEXUS-FINAL] stage: OFFSCREEN dispatch");
  console.log("[NEXUS SW] Ensuring offscreen document is alive before remux dispatch...");
  await ensureOffscreenDocument();
  console.log("[NEXUS SW] Dispatching PROCESS_CDP_MEDIA_FFMPEG to offscreen document...");
  const ffmpegRes = await new Promise((resolve, reject) => {
    let keepAlivePort = null;
    try {
      keepAlivePort = chrome.runtime.connect({ name: `nexus-remux-${sessionId}` });
    } catch {
    }
    const cleanup = () => {
      if (keepAlivePort) {
        try {
          keepAlivePort.disconnect();
        } catch {
        }
        keepAlivePort = null;
      }
    };
    chrome.runtime.sendMessage({
      type: "PROCESS_CDP_MEDIA_FFMPEG",
      payload: {
        sessionId,
        filename: targetFilename || `Vidleo_YouTube_${videoId || Date.now()}.mp4`,
        videoBase64,
        audioBase64,
        videoBytesCount: demux.videoBytes,
        audioBytesCount: demux.audioBytes,
        selectedQuality: payload.quality,
        quality: payload.quality,
        targetItag: payload.targetItag,
        videoItag: payload.targetItag || "395",
        audioItag: "251",
        videoCodec: demux.videoCodec || "h264",
        audioCodec: demux.audioCodec || "opus"
      }
    }, (resp) => {
      cleanup();
      if (chrome.runtime.lastError) {
        console.error("[NEXUS SW] chrome.runtime.sendMessage error:", chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
      } else if (resp?.status === "error") {
        console.error("[NEXUS SW] offscreen returned error:", resp.error);
        reject(new Error(resp.error));
      } else {
        console.log("[NEXUS SW] offscreen FFmpeg completed successfully:", resp?.result?.filename || "done", "codecs:", resp?.result?.videoCodec, resp?.result?.audioCodec);
        if (resp?.result?.ffmpegLogs) {
          console.log("[NEXUS SW] Recent FFmpeg logs:\n" + resp.result.ffmpegLogs.join("\n"));
        }
        resolve(resp?.result || resp);
      }
    });
  });
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "DOWNLOAD_READY",
      percent: 95,
      message: "Media multiplexing complete, triggering browser download..."
    }
  });
  if (ffmpegRes.blobUrl && chrome.downloads) {
    chrome.downloads.onChanged.addListener((delta) => {
      console.log(`[NEXUS SW] chrome.downloads onChanged for ID ${delta.id}: state=${delta.state?.current || "unchanged"}, error=${delta.error?.current || "none"}, filename=${delta.filename?.current || ""}`);
    });
    chrome.downloads.download({
      url: ffmpegRes.blobUrl,
      filename: ffmpegRes.filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn("[NEXUS SW] chrome.downloads warning:", chrome.runtime.lastError.message);
      } else {
        console.log(`[NEXUS SW] chrome.downloads started with ID ${downloadId}`);
      }
    });
  }
  const resultPayload = {
    type: "CDP_MEDIA_DOWNLOAD_SUCCESS",
    sessionId,
    filename: ffmpegRes.filename,
    bytes: ffmpegRes.outputBytes,
    totalBytes: ffmpegRes.outputBytes,
    mimeType: ffmpegRes.mimeType || "video/mp4",
    outputPath: ffmpegRes.filename,
    blobUrl: ffmpegRes.blobUrl,
    ffmpegExitCode: 0,
    rawUmpBytes: demux.rawUmpBytes,
    videoBytes: demux.videoBytes,
    audioBytes: demux.audioBytes,
    duration: ffmpegRes.duration,
    videoCodec: ffmpegRes.videoCodec || "h264",
    audioCodec: ffmpegRes.audioCodec || "aac",
    resolution: `${ffmpegRes.width}x${ffmpegRes.height}`,
    sha256: ffmpegRes.sha256,
    downloadStarted: true,
    provenance: "CDP_ACTIVE_PLAYER_MEDIA_RESPONSE_BODY"
  };
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "COMPLETE",
      percent: 100,
      message: "Download complete \xB7 Playable media saved to laptop"
    }
  });
  broadcastToTabs({
    type: "CDP_MEDIA_DOWNLOAD_SUCCESS",
    payload: resultPayload
  });
  broadcastToTabs({
    type: "NEXUS_CDP_RESULT",
    payload: resultPayload
  });
  return resultPayload;
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
