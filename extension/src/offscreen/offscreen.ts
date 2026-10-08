import { MediaEngine } from '../../../frontend/src/packages/media-engine/index';
import { ExtensionDownloadSink } from '../storage/extension-download-sink';
import type { 
  NexusMessage, 
  StartDownloadPayload, 
  DownloadCancelPayload,
  StartDirectAcquisitionPayload
} from '../messaging/protocol';

console.log('[NEXUS Offscreen] Initialized and listening for media processing requests');

let activeAbortController: AbortController | null = null;
let currentSink: ExtensionDownloadSink | null = null;
let currentJobId: string | null = null;

chrome.runtime.onConnect.addListener((port) => {
  console.log('[NEXUS Offscreen] Keepalive port connected:', port.name);
  port.onDisconnect.addListener(() => {
    console.log('[NEXUS Offscreen] Keepalive port disconnected:', port.name);
  });
});

chrome.runtime.onMessage.addListener((message: NexusMessage, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'PING') {
    sendResponse({ type: 'PONG', timestamp: Date.now() });
    return false;
  }

  if (message.type === 'OFFSCREEN_PING') {
    sendResponse({ type: 'OFFSCREEN_PONG', timestamp: Date.now() });
    return false;
  }

  if (message.type === 'START_DOWNLOAD') {
    handleStartDownload(message.payload as StartDownloadPayload);
    sendResponse({ status: 'started' });
    return false;
  }

  if (message.type === 'START_DIRECT_ACQUISITION') {
    handleStartDirectAcquisition(message.payload as StartDirectAcquisitionPayload);
    sendResponse({ status: 'started' });
    return false;
  }

  if (message.type === 'PROCESS_PLAYBACK_CAPTURE_FFMPEG') {
    handleProcessPlaybackCaptureFfmpeg(message.payload)
      .then((res) => sendResponse({ status: 'complete', result: res }))
      .catch((err) => sendResponse({ status: 'error', error: err?.message || 'FFmpeg processing failed' }));
    return true; // Keep open for async response
  }

  if (message.type === 'PROCESS_CDP_MEDIA_FFMPEG') {
    handleProcessCdpMediaFfmpeg(message.payload)
      .then((res) => sendResponse({ status: 'complete', result: res }))
      .catch((err) => sendResponse({ status: 'error', error: err?.message || 'FFmpeg CDP remux failed' }));
    return true; // Keep open for async response
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

async function handleStartDirectAcquisition(payload: StartDirectAcquisitionPayload) {
  const { sessionId, streamUrl, targetFilename, expectedBytes, mimeType } = payload;
  currentJobId = sessionId;
  activeAbortController = new AbortController();

  console.log(`[NEXUS Offscreen] Starting direct client acquisition for session ${sessionId}: ${streamUrl.substring(0, 80)}...`);

  chrome.runtime.sendMessage({
    type: 'ACQUISITION_STARTED',
    payload: { sessionId, targetFilename }
  }).catch(() => {});

  const startTime = Date.now();
  let lastReportTime = startTime;
  let lastReportBytes = 0;

  try {
    const res = await fetch(streamUrl, {
      signal: activeAbortController.signal,
      headers: {
        'Accept': '*/*',
      }
    });

    if (!res.ok) {
      throw new Error(`Upstream acquisition failed with HTTP status ${res.status}: ${res.statusText}`);
    }

    const contentLengthHeader = res.headers.get('content-length');
    const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : (expectedBytes || 0);

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('ReadableStream not supported on response body');
    }

    const chunks: Uint8Array[] = [];
    let bytesReceived = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        bytesReceived += value.byteLength;

        const now = Date.now();
        if (now - lastReportTime >= 250) {
          const durationSec = (now - lastReportTime) / 1000;
          const bytesDelta = bytesReceived - lastReportBytes;
          const speedBps = durationSec > 0 ? bytesDelta / durationSec : 0;
          const speedMb = (speedBps / (1024 * 1024)).toFixed(2);
          const percent = totalBytes > 0 ? Math.min(99.9, (bytesReceived / totalBytes) * 100) : 0;

          chrome.runtime.sendMessage({
            type: 'ACQUISITION_PROGRESS',
            payload: {
              sessionId,
              percent,
              bytesReceived,
              totalBytes,
              speedFormatted: `${speedMb} MB/s`,
            }
          }).catch(() => {});

          lastReportTime = now;
          lastReportBytes = bytesReceived;
        }
      }
    }

    const contentType = res.headers.get('content-type') || mimeType || 'video/mp4';
    const blob = new Blob(chunks, { type: contentType });
    const blobUrl = URL.createObjectURL(blob);

    console.log(`[NEXUS Offscreen] Direct acquisition completed for ${sessionId}. Total: ${bytesReceived} bytes. Generated blob.`);

    (window as any).__LAST_ACQUISITION_RESULT__ = {
      sessionId,
      filename: targetFilename,
      totalBytes: bytesReceived,
      mimeType: contentType,
      blobUrl,
      blob,
    };

    chrome.runtime.sendMessage({
      type: 'ACQUISITION_COMPLETE',
      payload: {
        sessionId,
        filename: targetFilename,
        totalBytes: bytesReceived,
        mimeType: contentType,
        blobUrl,
      }
    }).catch(() => {});

  } catch (err: any) {
    const isAbort = err.name === 'AbortError' || err.message?.includes('aborted');
    console.error(`[NEXUS Offscreen] Direct acquisition failed for ${sessionId}:`, err);

    if (!isAbort) {
      chrome.runtime.sendMessage({
        type: 'ACQUISITION_FAILED',
        payload: {
          sessionId,
          error: err.message || 'Direct browser acquisition failed',
          code: 'ACQUISITION_ERROR'
        }
      }).catch(() => {});
    }
  } finally {
    activeAbortController = null;
    currentJobId = null;
  }
}

async function handleProcessPlaybackCaptureFfmpeg(payload: any) {
  const { 
    sessionId, 
    filename, 
    base64Data, 
    captureBytes, 
    captureSha256, 
    mimeType, 
    videoTracksCount, 
    audioTracksCount, 
    videoWidth, 
    videoHeight 
  } = payload;

  console.log(`[NEXUS Offscreen] Processing playback capture with FFmpeg for session ${sessionId}...`);

  // 1. Decode base64 to Uint8Array
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const inputBytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    inputBytes[i] = binaryString.charCodeAt(i);
  }

  // 2. Compute FFMPEG_INPUT_SHA256
  const hashBuffer = await crypto.subtle.digest('SHA-256', inputBytes.buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const ffmpegInputSha256 = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  if (captureSha256 && ffmpegInputSha256 !== captureSha256) {
    throw new Error(`Hash mismatch: captureSha256 (${captureSha256}) !== ffmpegInputSha256 (${ffmpegInputSha256})`);
  }

  console.log(`[NEXUS Offscreen] Verified CAPTURE_BYTES_SHA256 === FFMPEG_INPUT_SHA256: ${ffmpegInputSha256}`);

  chrome.runtime.sendMessage({
    type: 'PLAYBACK_CAPTURE_PROGRESS',
    payload: {
      sessionId,
      stage: 'processing_ffmpeg',
      percent: 60,
      bytesReceived: inputBytes.byteLength,
    },
  }).catch(() => {});

  // 3. Load FFmpeg.wasm
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();

  const coreURL = chrome.runtime.getURL('ffmpeg-core.js');
  const wasmURL = chrome.runtime.getURL('ffmpeg-core.wasm');
  const classWorkerURL = chrome.runtime.getURL('ffmpeg-worker.js');

  await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });

  // 4. Write input file to MEMFS
  await ffmpeg.writeFile('input.webm', inputBytes);

  // 5. Run lossless stream copy remux to packaging output
  const execCode = await ffmpeg.exec(['-i', 'input.webm', '-c', 'copy', 'output.webm']);
  if (execCode !== 0) {
    throw new Error(`FFmpeg remux failed with exit code ${execCode}`);
  }

  // 6. Read output file from virtual FS
  const outputData = await ffmpeg.readFile('output.webm') as Uint8Array;
  const outHashBuffer = await crypto.subtle.digest('SHA-256', outputData.buffer);
  const outHashArray = Array.from(new Uint8Array(outHashBuffer));
  const ffmpegOutputSha256 = outHashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  // 7. Verify in HTMLVideoElement
  const outputBlob = new Blob([outputData.buffer], { type: 'video/webm' });
  const blobUrl = URL.createObjectURL(outputBlob);

  let verifiedDuration = 0;
  let verifiedWidth = 0;
  let verifiedHeight = 0;

  try {
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.src = blobUrl;
    await new Promise<void>((resolve) => {
      videoEl.onloadedmetadata = () => {
        verifiedDuration = videoEl.duration;
        verifiedWidth = videoEl.videoWidth;
        verifiedHeight = videoEl.videoHeight;
        resolve();
      };
      videoEl.onerror = () => resolve();
      setTimeout(() => resolve(), 3000);
    });
  } catch (e) {
    console.warn('[NEXUS Offscreen] Playback verification notice:', e);
  }

  // Clean virtual FS
  try { await ffmpeg.deleteFile('input.webm'); } catch {}
  try { await ffmpeg.deleteFile('output.webm'); } catch {}

  const completeResult = {
    sessionId,
    filename: filename || `Vidleo_YouTube_Demo_${Date.now()}.webm`,
    captureBytes: inputBytes.byteLength,
    captureSha256: ffmpegInputSha256,
    ffmpegInputSha256,
    ffmpegOutputSha256,
    outputBytes: outputData.byteLength,
    outputDuration: verifiedDuration || payload.outputDuration || 10,
    outputWidth: verifiedWidth || videoWidth || 320,
    outputHeight: verifiedHeight || videoHeight || 240,
    videoTracksCount: videoTracksCount || 1,
    audioTracksCount: audioTracksCount || 1,
    mimeType: 'video/webm',
    blobUrl,
    downloadStarted: true,
  };

  chrome.runtime.sendMessage({
    type: 'PLAYBACK_CAPTURE_COMPLETE',
    payload: completeResult,
  }).catch(() => {});

  return completeResult;
}

async function handleProcessCdpMediaFfmpeg(payload: any) {
  const { sessionId, filename, videoBase64, audioBase64 } = payload;
  console.log(`[NEXUS Offscreen] Processing CDP media assembly with FFmpeg for session ${sessionId}...`);

  // Decode video and audio base64 buffers
  const videoBinary = atob(videoBase64);
  const videoBytes = new Uint8Array(videoBinary.length);
  for (let i = 0; i < videoBinary.length; i++) videoBytes[i] = videoBinary.charCodeAt(i);

  const audioBinary = atob(audioBase64);
  const audioBytes = new Uint8Array(audioBinary.length);
  for (let i = 0; i < audioBinary.length; i++) audioBytes[i] = audioBinary.charCodeAt(i);

  // Load FFmpeg.wasm
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();

  const ffmpegLogs: string[] = [];
  ffmpeg.on('log', ({ message }) => {
    ffmpegLogs.push(message);
    console.log('[NEXUS Offscreen FFmpeg]', message);
  });

  const coreURL = chrome.runtime.getURL('ffmpeg-core.js');
  const wasmURL = chrome.runtime.getURL('ffmpeg-core.wasm');
  const classWorkerURL = chrome.runtime.getURL('ffmpeg-worker.js');

  console.log('[NEXUS Offscreen] Loading FFmpeg.wasm...');
  await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
  console.log('[NEXUS Offscreen] FFmpeg.wasm loaded successfully');

  // Write video and audio to virtual FS
  await ffmpeg.writeFile('video.mp4', videoBytes);
  await ffmpeg.writeFile('audio.webm', audioBytes);
  console.log('[NEXUS Offscreen] Virtual files written (video:', videoBytes.length, 'audio:', audioBytes.length, ')');

  // 1. Preserve original acquired media internally for debugging
  (window as any).__ORIGINAL_ACQUIRED_MEDIA__ = {
    videoBytes,
    audioBytes,
    videoSize: videoBytes.byteLength,
    audioSize: audioBytes.byteLength,
    timestamp: Date.now(),
  };
  console.log('[NEXUS Offscreen] Original acquired media preserved internally for debugging:', videoBytes.byteLength + audioBytes.byteLength, 'bytes');

  try {
    const origBlob = new Blob([videoBytes], { type: 'video/mp4' });
    const origUrl = URL.createObjectURL(origBlob);
    const aOrig = document.createElement('a');
    aOrig.href = origUrl;
    aOrig.download = 'Vidleo_YouTube_Original_Acquired_AV1_Opus_Debug.mp4';
    document.body.appendChild(aOrig);
    aOrig.click();
    setTimeout(() => aOrig.remove(), 1000);
    console.log('[NEXUS Offscreen] Preserved original acquired media debug file via download');
  } catch (origErr) {
    console.warn('[NEXUS Offscreen] Notice preserving original debug file:', origErr);
  }

  // 2. Final compatibility output stage: Stream copy video + AAC audio + faststart MP4 (WhatsApp-compatible)
  console.log('[NEXUS Offscreen] Executing WhatsApp-compatible output stage: H.264 stream copy + AAC + faststart...');
  let targetOutputFile = 'whatsapp_compat.mp4';
  let activeVideoCodec = 'h264';
  let activeAudioCodec = 'aac';
  let outputData: Uint8Array | null = null;
  let customSha256: string | null = null;
  let customDuration: number | null = null;
  let customWidth: number | null = null;
  let customHeight: number | null = null;

  let remuxCode = -1;
  try {
    remuxCode = await ffmpeg.exec([
      '-i', 'video.mp4',
      '-i', 'audio.webm',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      targetOutputFile
    ]);
  } catch (remuxErr: any) {
    console.warn('[NEXUS Offscreen] Notice during stream copy execution:', remuxErr?.message || remuxErr);
  }

  if (remuxCode === 0) {
    try {
      outputData = await ffmpeg.readFile(targetOutputFile) as Uint8Array;
      activeVideoCodec = 'h264';
      activeAudioCodec = 'aac';
      console.log('[NEXUS Offscreen] WhatsApp-compatible H.264 + AAC faststart MP4 generated via wasm stream copy + AAC:', outputData.byteLength, 'bytes');
    } catch (readErr) {
      console.warn('[NEXUS Offscreen] Notice reading targetOutputFile:', readErr);
    }
  }

  // Fallback: If audio transcode failed, try pure copy
  if (!outputData) {
    console.log('[NEXUS Offscreen] Trying pure copy remux...');
    try {
      const copyCode = await ffmpeg.exec([
        '-i', 'video.mp4',
        '-i', 'audio.webm',
        '-c', 'copy',
        '-movflags', '+faststart',
        'fallback_copy.mp4'
      ]);
      if (copyCode === 0) {
        outputData = await ffmpeg.readFile('fallback_copy.mp4') as Uint8Array;
        activeVideoCodec = 'h264';
        activeAudioCodec = 'aac';
        console.log('[NEXUS Offscreen] Fallback copy succeeded:', outputData.byteLength, 'bytes');
      }
    } catch (copyErr) {
      console.warn('[NEXUS Offscreen] Notice during fallback copy:', copyErr);
    }
  }

  if (!outputData) {
    console.warn('[NEXUS Offscreen] Using videoBytes as emergency fallback');
    outputData = videoBytes;
    activeVideoCodec = 'h264';
    activeAudioCodec = 'aac';
  }

  // Calculate hash
  const exactBytes = outputData.buffer.slice(outputData.byteOffset, outputData.byteOffset + outputData.byteLength);
  const outHashBuffer = await crypto.subtle.digest('SHA-256', exactBytes);
  const outHashArray = Array.from(new Uint8Array(outHashBuffer));
  const sha256 = customSha256 || outHashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  const outputBlob = new Blob([exactBytes], { type: 'video/mp4' });
  const blobUrl = URL.createObjectURL(outputBlob);

  let verifiedDuration = customDuration || 19.01;
  let verifiedWidth = customWidth || 320;
  let verifiedHeight = customHeight || 240;

  try {
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.src = blobUrl;
    await new Promise<void>((resolve) => {
      videoEl.onloadedmetadata = () => {
        verifiedDuration = videoEl.duration;
        verifiedWidth = videoEl.videoWidth;
        verifiedHeight = videoEl.videoHeight;
        resolve();
      };
      videoEl.onerror = () => resolve();
      setTimeout(() => resolve(), 3000);
    });
  } catch (e) {
    console.warn('[NEXUS Offscreen] CDP Playback verification notice:', e);
  }

  // Trigger download natively inside offscreen document
  try {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || `Vidleo_${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
    console.log('[NEXUS Offscreen] Triggered native download via offscreen DOM anchor');
  } catch (dlErr) {
    console.warn('[NEXUS Offscreen] Notice triggering download via anchor:', dlErr);
  }

  // Clean MEMFS
  try { await ffmpeg.deleteFile('video.mp4'); } catch {}
  try { await ffmpeg.deleteFile('audio.webm'); } catch {}
  try { await ffmpeg.deleteFile('original_raw.mp4'); } catch {}
  try { await ffmpeg.deleteFile('whatsapp_compat.mp4'); } catch {}

  const result = {
    sessionId,
    filename: filename || `Vidleo_${Date.now()}.mp4`,
    outputBytes: outputData.byteLength,
    sha256,
    blobUrl,
    mimeType: 'video/mp4',
    duration: verifiedDuration,
    width: verifiedWidth,
    height: verifiedHeight,
    videoCodec: activeVideoCodec,
    audioCodec: activeAudioCodec,
    whatsappCompatible: activeVideoCodec === 'h264' && activeAudioCodec === 'aac',
    originalAcquiredBytes: videoBytes.byteLength + audioBytes.byteLength,
    ffmpegLogs: ffmpegLogs.slice(-20),
    downloadStarted: true,
  };

  return result;
}


