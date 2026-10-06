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

  // 4. Handle Active In-Browser Playback Capture
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'START_TAB_PLAYBACK_CAPTURE') {
      const payload = message.payload || {};
      handleTabPlaybackCapture(payload)
        .then((result) => sendResponse({ status: 'success', result }))
        .catch((err) => sendResponse({ status: 'error', error: err?.message || 'Playback capture failed' }));
      return true; // Keep channel open for async response
    }
    return false;
  });

  async function handleTabPlaybackCapture(options: {
    sessionId?: string;
    durationSeconds?: number;
    mode?: 'demo_10s' | 'full_video';
    targetFilename?: string;
  }) {
    const sessionId = options.sessionId || `session-${Date.now()}`;
    const mode = options.mode || 'demo_10s';
    const targetDuration = options.durationSeconds && options.durationSeconds > 0 
      ? options.durationSeconds 
      : (mode === 'demo_10s' ? 10 : 0);

    // Locate active video element
    let video = document.querySelector('video.video-stream, video') as HTMLVideoElement | null;
    if (!video) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 250));
        video = document.querySelector('video.video-stream, video') as HTMLVideoElement | null;
        if (video) break;
      }
    }

    if (!video) {
      throw new Error('No active YouTube HTMLVideoElement found on page');
    }

    // For full_video mode, reset playback to start if near the end or already played
    if (mode === 'full_video' && video.currentTime > 1) {
      video.currentTime = 0;
      await new Promise((r) => setTimeout(r, 200));
    }

    // Ensure playback
    if (video.paused) {
      try {
        await video.play();
      } catch {
        video.muted = true;
        await video.play();
      }
    }

    // Wait until video has dimensions and is playing
    for (let i = 0; i < 20; i++) {
      if (video.readyState >= 2 && video.videoWidth > 0 && !video.paused) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    const captureStreamFn = (video as any).captureStream || (video as any).mozCaptureStream;
    if (typeof captureStreamFn !== 'function') {
      throw new Error('HTMLVideoElement.captureStream is not supported in this browser environment');
    }

    const stream: MediaStream = captureStreamFn.call(video);
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();

    // Dynamically detect best supported MIME type
    let mimeType = 'video/webm;codecs=vp9,opus';
    if (typeof MediaRecorder !== 'undefined') {
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8,opus';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    chrome.runtime.sendMessage({
      type: 'PLAYBACK_CAPTURE_STARTED',
      payload: {
        sessionId,
        videoTracksCount: videoTracks.length,
        audioTracksCount: audioTracks.length,
        mimeType,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      },
    }).catch(() => {});

    recorder.start(500);

    const recordingStartTime = Date.now();
    const finalDurationLimit = targetDuration > 0 ? targetDuration : (video.duration > 0 ? video.duration : 60);

    await new Promise<void>((resolve) => {
      let stopped = false;
      const doStop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(interval);
        video.removeEventListener('ended', onEnded);
        recorder.onstop = () => resolve();
        try {
          recorder.stop();
        } catch {
          resolve();
        }
      };

      const onEnded = () => {
        doStop();
      };
      video.addEventListener('ended', onEnded);

      const interval = setInterval(() => {
        const elapsed = (Date.now() - recordingStartTime) / 1000;
        const currentBytes = chunks.reduce((acc, c) => acc + c.size, 0);

        chrome.runtime.sendMessage({
          type: 'PLAYBACK_CAPTURE_PROGRESS',
          payload: {
            sessionId,
            stage: 'recording',
            recordedSeconds: elapsed,
            targetSeconds: finalDurationLimit,
            percent: Math.min(99, Math.round((elapsed / finalDurationLimit) * 100)),
            bytesReceived: currentBytes,
          },
        }).catch(() => {});

        const isTimeUp = mode === 'demo_10s' ? elapsed >= finalDurationLimit : elapsed >= (finalDurationLimit + 3);
        const isVideoFinished = mode === 'full_video' && (
          video.ended || 
          (video.duration > 0 && video.currentTime >= Math.max(1, video.duration - 0.3))
        );

        if (isTimeUp || isVideoFinished) {
          doStop();
        }
      }, 400);
    });

    const capturedBlob = new Blob(chunks, { type: mimeType });
    const arrayBuffer = await capturedBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    // Compute SHA-256 hash in browser
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const captureSha256 = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    // Convert buffer to base64
    let binary = '';
    const len = uint8.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64Data = btoa(binary);

    return {
      sessionId,
      filename: options.targetFilename || `Vidleo_YouTube_Demo_${Date.now()}.webm`,
      base64Data,
      captureBytes: uint8.byteLength,
      captureSha256,
      mimeType,
      videoTracksCount: videoTracks.length,
      audioTracksCount: audioTracks.length,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      outputDuration: (Date.now() - recordingStartTime) / 1000,
    };
  }
})();
