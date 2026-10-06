(() => {
  // src/content/youtube-observer.ts
  (function() {
    const seenUrls = /* @__PURE__ */ new Set();
    function extractVideoId(url) {
      const match = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
      return match ? match[1] : null;
    }
    function reportStream(streamUrl) {
      if (!streamUrl || !streamUrl.includes("/videoplayback") || seenUrls.has(streamUrl)) {
        return;
      }
      seenUrls.add(streamUrl);
      const videoId = extractVideoId(window.location.href);
      try {
        chrome.runtime.sendMessage({
          type: "YOUTUBE_MEDIA_OBSERVED",
          payload: {
            videoId,
            streamUrl,
            pageUrl: window.location.href,
            timestamp: Date.now()
          }
        }).catch(() => {
        });
      } catch {
      }
    }
    try {
      const existing = performance.getEntriesByType("resource");
      for (const entry of existing) {
        if (entry.name && entry.name.includes("/videoplayback")) {
          reportStream(entry.name);
        }
      }
    } catch {
    }
    if (typeof PerformanceObserver !== "undefined") {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.name && entry.name.includes("/videoplayback")) {
              reportStream(entry.name);
            }
          }
        });
        observer.observe({ type: "resource", buffered: true });
      } catch (e) {
        console.warn("[Vidleo YouTube Observer] PerformanceObserver failed:", e);
      }
    }
    function checkVideoElement() {
      const video = document.querySelector("video");
      if (video) {
        if (video.src && video.src.includes("/videoplayback")) {
          reportStream(video.src);
        }
        if (video.currentSrc && video.currentSrc.includes("/videoplayback")) {
          reportStream(video.currentSrc);
        }
      }
    }
    checkVideoElement();
    document.addEventListener("play", checkVideoElement, true);
    document.addEventListener("timeupdate", checkVideoElement, true);
  })();
})();
//# sourceMappingURL=youtube-observer.js.map
