(() => {
  // src/content/content.ts
  try {
    if (document.documentElement) {
      document.documentElement.setAttribute("data-nexus-extension-installed", "true");
      document.documentElement.setAttribute("data-nexus-extension-version", "1.0.0");
      document.documentElement.dataset.nexusExtensionInstalled = "true";
      document.documentElement.dataset.nexusExtensionVersion = "1.0.0";
    }
    window.dispatchEvent(new CustomEvent("nexus-extension-ready", { detail: { version: "1.0.0" } }));
  } catch (e) {
    console.warn("[NEXUS Content Bridge] Error setting DOM markers:", e);
  }
  try {
    window.postMessage({
      source: "nexus-extension",
      type: "PONG",
      version: "1.0.0",
      capabilities: {
        playbackCapture: true,
        captureStream: true,
        ffmpegLocal: true,
        zeroServerTransit: true
      }
    }, "*");
  } catch {
  }
  window.addEventListener("message", (event) => {
    if (!event.data || event.data.source !== "nexus-webpage") return;
    const { type, payload, messageId } = event.data;
    if (type === "PING") {
      window.postMessage({
        source: "nexus-extension",
        type: "PONG",
        messageId,
        version: "1.0.0",
        capabilities: {
          playbackCapture: true,
          captureStream: true,
          ffmpegLocal: true,
          zeroServerTransit: true
        }
      }, "*");
      try {
        chrome.runtime.sendMessage({ type: "PING" }, () => {
          if (chrome.runtime.lastError) {
          }
        });
      } catch {
      }
      return;
    }
    chrome.runtime.sendMessage({
      type,
      payload,
      timestamp: Date.now()
    }, (response) => {
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || "Unknown extension error";
        console.warn("[NEXUS Content Bridge] chrome.runtime.sendMessage lastError:", errMsg);
        window.postMessage({
          source: "nexus-extension",
          type: `${type}_ERROR`,
          messageId,
          error: errMsg
        }, "*");
        if (type === "NEXUS_CDP_DOWNLOAD_START") {
          window.postMessage({
            source: "nexus-extension",
            type: "NEXUS_CDP_ERROR",
            messageId,
            payload: { error: errMsg }
          }, "*");
        }
        return;
      }
      if (response) {
        window.postMessage({
          source: "nexus-extension",
          type: response.type || `${type}_ACK`,
          messageId,
          payload: response.payload || response,
          response
        }, "*");
      }
    });
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;
    if (typeof message.type === "string" && message.type.startsWith("PROCESS_")) return;
    window.postMessage({
      source: "nexus-extension",
      ...message
    }, "*");
  });
})();
//# sourceMappingURL=content.js.map
