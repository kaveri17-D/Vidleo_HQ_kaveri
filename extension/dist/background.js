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
async function resolveMedia(url, apiBaseUrl = DEFAULT_API_BASE_URL) {
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
  if (message.type === "DOWNLOAD_CANCEL") {
    chrome.runtime.sendMessage(message).catch(() => {
    });
    return false;
  }
  return false;
});
//# sourceMappingURL=background.js.map
