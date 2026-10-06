/**
 * Vidleo NEXUS YouTube Player Observer Content Script
 * 
 * Runs legitimately in YouTube tabs to observe player-initiated media playback streams.
 * When the browser plays a video, YouTube's own player handles deciphering and issues
 * requests to googlevideo.com/videoplayback. This observer captures those legitimate,
 * deciphered streams via standard Performance Timing APIs and sends them to the
 * Vidleo Companion Service Worker.
 */

(function () {
  const seenUrls = new Set<string>();

  function extractVideoId(url: string): string | null {
    const match = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  function reportStream(streamUrl: string) {
    if (!streamUrl || !streamUrl.includes('/videoplayback') || seenUrls.has(streamUrl)) {
      return;
    }
    seenUrls.add(streamUrl);

    const videoId = extractVideoId(window.location.href);
    try {
      chrome.runtime.sendMessage({
        type: 'YOUTUBE_MEDIA_OBSERVED',
        payload: {
          videoId,
          streamUrl,
          pageUrl: window.location.href,
          timestamp: Date.now(),
        },
      }).catch(() => {});
    } catch {}
  }

  // 1. Check existing resource entries
  try {
    const existing = performance.getEntriesByType('resource');
    for (const entry of existing) {
      if (entry.name && entry.name.includes('/videoplayback')) {
        reportStream(entry.name);
      }
    }
  } catch {}

  // 2. Observe ongoing resource requests via PerformanceObserver
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name && entry.name.includes('/videoplayback')) {
            reportStream(entry.name);
          }
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch (e) {
      console.warn('[Vidleo YouTube Observer] PerformanceObserver failed:', e);
    }
  }

  // 3. Check HTML5 Video element
  function checkVideoElement() {
    const video = document.querySelector('video');
    if (video) {
      if (video.src && video.src.includes('/videoplayback')) {
        reportStream(video.src);
      }
      if (video.currentSrc && video.currentSrc.includes('/videoplayback')) {
        reportStream(video.currentSrc);
      }
    }
  }

  checkVideoElement();
  document.addEventListener('play', checkVideoElement, true);
  document.addEventListener('timeupdate', checkVideoElement, true);
})();
