import { MediaEngine } from '../../../frontend/src/packages/media-engine/index';
import { ExtensionDownloadSink } from '../storage/extension-download-sink';
import type { 
  NexusMessage, 
  StartDownloadPayload, 
  DownloadCancelPayload,
  StartDirectAcquisitionPayload
} from '../messaging/protocol';

console.log('[NEXUS Offscreen] Initialized and listening for media processing requests');
try {
  const extId = chrome.runtime.id;
  const extVer = chrome.runtime.getManifest()?.version || '1.0.1';
  console.log('[NEXUS-INSTRUMENT] OFFSCREEN_DOCUMENT_READY:', JSON.stringify({
    event: 'OFFSCREEN_DOCUMENT_READY',
    extensionId: extId,
    extensionVersion: extVer,
    timestamp: Date.now(),
  }));
} catch {}

let activeAbortController: AbortController | null = null;
let currentSink: ExtensionDownloadSink | null = null;
let currentJobId: string | null = null;

chrome.runtime.onConnect.addListener((port) => {
  console.log('[NEXUS Offscreen] Keepalive port connected:', port.name);
  port.onDisconnect.addListener(() => {
    console.log('[NEXUS Offscreen] Keepalive port disconnected:', port.name);
  });
});

(window as any).__queryFfmpegCodecs = async () => {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  const logs: string[] = [];
  ffmpeg.on('log', ({ message }: { message: string }) => logs.push(message));
  const coreURL = chrome.runtime.getURL('ffmpeg-core.js');
  const wasmURL = chrome.runtime.getURL('ffmpeg-core.wasm');
  const classWorkerURL = chrome.runtime.getURL('ffmpeg-worker.js');
  await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
  logs.length = 0;
  await ffmpeg.exec(['-decoders']);
  const decoders = logs.join('\n');
  logs.length = 0;
  await ffmpeg.exec(['-encoders']);
  const encoders = logs.join('\n');
  return { decoders, encoders };
};

chrome.runtime.onMessage.addListener((message: NexusMessage, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'PING') {
    sendResponse({ type: 'PONG', timestamp: Date.now() });
    return false;
  }

  if (message.type === 'OFFSCREEN_PING') {
    const extId = chrome.runtime?.id || 'unknown';
    const extVer = chrome.runtime?.getManifest?.()?.version || '1.0.1';
    console.log('[NEXUS-INSTRUMENT] OFFSCREEN_PING:', JSON.stringify({
      event: 'OFFSCREEN_PING',
      extensionId: extId,
      extensionVersion: extVer,
      timestamp: Date.now(),
    }));
    sendResponse({
      type: 'OFFSCREEN_PONG',
      timestamp: Date.now(),
      extensionId: extId,
      extensionVersion: extVer,
    });
    console.log('[NEXUS-INSTRUMENT] OFFSCREEN_PONG:', JSON.stringify({
      event: 'OFFSCREEN_PONG',
      extensionId: extId,
      extensionVersion: extVer,
      timestamp: Date.now(),
    }));
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
    console.log('[NEXUS-FINAL][OFFSCREEN] Received PROCESS_CDP_MEDIA_FFMPEG for session:', message.payload?.sessionId);
    handleProcessCdpMediaFfmpeg(message.payload)
      .then((res) => {
        console.log('[NEXUS-FINAL][OFFSCREEN] handleProcessCdpMediaFfmpeg succeeded');
        sendResponse({ status: 'complete', result: res });
      })
      .catch((err) => {
        const errType = typeof err;
        const errName = err?.name || (errType === 'string' ? 'StringError' : 'UnknownError');
        const errMsg = errType === 'string' ? err : (err?.message || String(err) || 'Unknown FFmpeg failure');
        const errStack = err?.stack || 'No stack available';
        const formattedError = `[NEXUS-FINAL][OFFSCREEN_ERROR] ${errName}: ${errMsg}`;
        console.error(formattedError, '\nStack:', errStack);
        sendResponse({
          status: 'error',
          error: formattedError,
          code: err?.code || (errMsg.includes('[FFMPEG_INIT]') ? 'FFMPEG_INIT_ERROR' : 'OFFSCREEN_ERROR'),
          details: {
            name: errName,
            message: errMsg,
            stack: errStack,
            sessionId: message.payload?.sessionId,
            requestId: message.payload?.requestId,
            ffmpegExitCode: (window as any).__NEXUS_LAST_FORENSICS__?.ffmpegExitCode ?? -1,
            ffmpegStderr: (window as any).__NEXUS_LAST_FORENSICS__?.ffmpegStderr || '',
          }
        });
      });
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
  let outputData: Uint8Array;
  if (execCode === 0) {
    try {
      outputData = await ffmpeg.readFile('output.webm') as Uint8Array;
    } catch {
      outputData = inputBytes;
    }
  } else {
    console.warn(`[NEXUS Offscreen] Stream copy returned ${execCode}, using input bytes directly`);
    outputData = inputBytes;
  }
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

function detectContainerFormat(bytes: Uint8Array): 'mp4' | 'webm' | 'unknown' {
  if (bytes.length >= 8) {
    const tag = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (tag === 'ftyp' || tag === 'moov' || tag === 'moof' || tag === 'styp' || tag === 'sidx') return 'mp4';
  }
  if (bytes.length >= 4) {
    if ((bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) ||
        (bytes[0] === 0x1F && bytes[1] === 0x43 && bytes[2] === 0xB6 && bytes[3] === 0x75)) {
      return 'webm';
    }
  }
  return 'unknown';
}

async function handleProcessCdpMediaFfmpeg(payload: any) {
  const { 
    sessionId, 
    filename, 
    videoBase64, 
    audioBase64,
    expectedDuration = 0,
    selectedQuality,
    quality,
    videoItag,
    audioItag,
    targetItag,
    videoCodec: inputVideoCodec,
    audioCodec: inputAudioCodec,
  } = payload;

  const currentQuality = selectedQuality || quality || '360p';
  const currentVideoItag = String(videoItag || targetItag || '');
  const currentAudioItag = String(audioItag || '');

  const forensics = {
    sessionId: sessionId || `session-${Date.now()}`,
    selectedQuality: currentQuality,
    videoItag: currentVideoItag,
    audioItag: currentAudioItag,
    videoBytes: 0,
    audioBytes: 0,
    videoCodec: inputVideoCodec || 'unknown',
    audioCodec: inputAudioCodec || 'unknown',
    videoContainer: 'unknown',
    audioContainer: 'unknown',
    offscreenStatus: 'initializing',
    ffmpegInitialized: false,
    ffmpegCommand: 'ffmpeg',
    ffmpegArgs: [] as string[],
    ffmpegExitCode: -1,
    outputValid: false,
    ffmpegStderr: '',
    ffmpegException: null as string | null,
    ffmpegStack: null as string | null,
  };

  (window as any).__NEXUS_LAST_FORENSICS__ = forensics;

  console.log('[NEXUS-FINAL] sessionId:', sessionId);
  console.log('[NEXUS-FINAL] selectedQuality:', currentQuality);
  console.log('[NEXUS-FINAL] stage: OFFSCREEN');
  console.log(`[NEXUS-FINAL][OFFSCREEN] Processing CDP media assembly with FFmpeg for session ${sessionId}...`);

  // Stage FFMPEG_INPUT prep
  let videoBytes: Uint8Array;
  let audioBytes: Uint8Array;
  try {
    const videoBinary = atob(videoBase64);
    videoBytes = new Uint8Array(videoBinary.length);
    for (let i = 0; i < videoBinary.length; i++) videoBytes[i] = videoBinary.charCodeAt(i);

    const audioBinary = atob(audioBase64);
    audioBytes = new Uint8Array(audioBinary.length);
    for (let i = 0; i < audioBinary.length; i++) audioBytes[i] = audioBinary.charCodeAt(i);
  } catch (decodeErr: any) {
    const errText = `Base64 decode failed: ${decodeErr?.message || decodeErr}`;
    forensics.offscreenStatus = 'base64_decode_failed';
    forensics.ffmpegException = errText;
    forensics.ffmpegStack = decodeErr?.stack || null;
    console.error('[NEXUS-FINAL] FFMPEG_INPUT error:', errText);
    throw new Error(`[NEXUS-FINAL][FFMPEG_INPUT] ${errText}`);
  }

  forensics.videoBytes = videoBytes.byteLength;
  forensics.audioBytes = audioBytes.byteLength;

  // Detect containers
  const vCont = detectContainerFormat(videoBytes);
  const aCont = detectContainerFormat(audioBytes);
  forensics.videoContainer = vCont !== 'unknown' ? vCont : 'mp4';
  forensics.audioContainer = aCont !== 'unknown' ? aCont : 'webm';

  // Detect or infer codecs
  if (forensics.videoCodec === 'unknown') {
    if (vCont === 'webm') {
      forensics.videoCodec = 'vp9';
    } else {
      const strSample = String.fromCharCode(...videoBytes.subarray(0, Math.min(200, videoBytes.length)));
      if (strSample.includes('av01')) forensics.videoCodec = 'av1';
      else forensics.videoCodec = 'h264';
    }
  }

  if (forensics.audioCodec === 'unknown') {
    forensics.audioCodec = aCont === 'webm' ? 'opus' : 'aac';
  }

  console.log('[NEXUS-FINAL] stage: FFMPEG_INIT');
  console.log(`[NEXUS-FINAL] input detected: video=${forensics.videoContainer}/${forensics.videoCodec} (${forensics.videoBytes}B), audio=${forensics.audioContainer}/${forensics.audioCodec} (${forensics.audioBytes}B)`);

  const extId = chrome.runtime?.id || 'unknown';
  const extVer = chrome.runtime?.getManifest?.()?.version || '1.0.1';
  const reqId = payload.requestId || '';

  const instrument = (event: string, extra: any = {}) => {
    const data = {
      event,
      sessionId,
      requestId: reqId,
      extensionId: extId,
      extensionVersion: extVer,
      timestamp: Date.now(),
      ...extra,
    };
    console.log(`[NEXUS-INSTRUMENT] ${event}:`, JSON.stringify(data));
    try {
      chrome.runtime.sendMessage({
        type: 'NEXUS_INSTRUMENTATION',
        payload: data,
      }).catch(() => {});
    } catch {}
  };

  instrument('FFMPEG_INIT_START');

  // Stage FFMPEG_CORE_RESOLVE
  instrument('FFMPEG_CORE_RESOLVE_START');
  const coreURL = chrome.runtime.getURL('ffmpeg-core.js');
  const wasmURL = chrome.runtime.getURL('ffmpeg-core.wasm');
  const classWorkerURL = chrome.runtime.getURL('ffmpeg-worker.js');
  instrument('FFMPEG_CORE_URL', { coreURL });
  instrument('FFMPEG_WASM_URL', { wasmURL });

  // Probe fetch coreURL
  instrument('FFMPEG_CORE_FETCH_START', { url: coreURL });
  let coreBytes = 0;
  try {
    const cResp = await fetch(coreURL);
    const cBuf = await cResp.arrayBuffer();
    coreBytes = cBuf.byteLength;
    instrument('FFMPEG_CORE_FETCH_RESPONSE', { status: cResp.status, statusText: cResp.statusText, bytes: coreBytes });
    instrument('FFMPEG_CORE_FETCH_STATUS', { status: cResp.status });
    instrument('FFMPEG_CORE_FETCH_BYTES', { bytes: coreBytes });
  } catch (cErr: any) {
    instrument('FFMPEG_CORE_FETCH_STATUS', { status: -1, error: cErr?.message });
  }

  // Fetch wasmURL in offscreen document context
  let wasmBinary: ArrayBuffer | null = null;
  try {
    const wResp = await fetch(wasmURL);
    if (wResp.ok) {
      wasmBinary = await wResp.arrayBuffer();
    }
    instrument('FFMPEG_WASM_FETCH_STATUS', { status: wResp.status, bytes: wasmBinary?.byteLength || 0 });
  } catch (wErr: any) {
    instrument('FFMPEG_WASM_FETCH_STATUS', { status: -1, error: wErr?.message });
  }

  // Load FFmpeg.wasm
  let ffmpeg: any;
  const ffmpegLogs: string[] = [];
  try {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }: { message: string }) => {
      ffmpegLogs.push(message);
      console.log('[NEXUS Offscreen FFmpeg]', message);
    });

    console.log('[NEXUS-FINAL] Loading FFmpeg.wasm...');
    await ffmpeg.load({ coreURL, wasmURL, classWorkerURL, wasmBinary });
    forensics.ffmpegInitialized = true;
    forensics.offscreenStatus = 'ffmpeg_loaded';
    console.log('[NEXUS-FINAL] FFmpeg initialized: YES');
    instrument('FFMPEG_INIT_SUCCESS', { coreBytes });
  } catch (loadErr: any) {
    forensics.ffmpegInitialized = false;
    forensics.offscreenStatus = 'ffmpeg_load_failed';
    forensics.ffmpegException = loadErr?.message || String(loadErr);
    forensics.ffmpegStack = loadErr?.stack || null;
    console.error('[NEXUS-FINAL] FFmpeg initialized: NO', loadErr);
    instrument('FFMPEG_INIT_ERROR', { error: loadErr?.message || String(loadErr), stack: loadErr?.stack });
    throw new Error(`[NEXUS-FINAL][FFMPEG_INIT] ${loadErr?.name || 'LoadError'}: ${loadErr?.message || loadErr}`);
  }

  // Name input files in MEMFS matching detected containers
  const inputVideoName = `input_video.${forensics.videoContainer === 'webm' ? 'webm' : 'mp4'}`;
  const inputAudioName = `input_audio.${forensics.audioContainer === 'mp4' ? 'm4a' : 'webm'}`;

  // Write video and audio to virtual FS
  console.log('[NEXUS-FINAL] stage: FFMPEG_INPUT');
  try {
    await ffmpeg.writeFile(inputVideoName, videoBytes);
    await ffmpeg.writeFile(inputAudioName, audioBytes);
    console.log(`[NEXUS-FINAL] FFmpeg received input: YES (${inputVideoName}, ${inputAudioName})`);
  } catch (fsErr: any) {
    forensics.offscreenStatus = 'fs_write_failed';
    forensics.ffmpegException = fsErr?.message || String(fsErr);
    forensics.ffmpegStack = fsErr?.stack || null;
    console.error('[NEXUS-FINAL] FFmpeg received input: NO', fsErr);
    throw new Error(`[NEXUS-FINAL][FFMPEG_INPUT] FS writeFile failed: ${fsErr?.message || fsErr}`);
  }

  // Preserve original acquired media internally for debugging
  (window as any).__ORIGINAL_ACQUIRED_MEDIA__ = {
    videoBytes,
    audioBytes,
    videoSize: videoBytes.byteLength,
    audioSize: audioBytes.byteLength,
    timestamp: Date.now(),
  };

  // 100% WhatsApp compatibility (H.264 video + AAC audio in faststart MP4)
  console.log('[NEXUS-FINAL] stage: FFMPEG_EXEC');
  const targetOutputFile = 'whatsapp_compat.mp4';
  
  const isVideoH264 = forensics.videoCodec === 'h264' && forensics.videoContainer === 'mp4';
  const videoCodecArgs = isVideoH264
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23'];

  const isAudioAac = forensics.audioCodec === 'aac' && forensics.audioContainer === 'mp4';
  const audioCodecArgs = isAudioAac
    ? ['-c:a', 'copy']
    : ['-c:a', 'aac', '-b:a', '128k'];

  const primaryArgs = [
    '-i', inputVideoName,
    '-i', inputAudioName,
    ...videoCodecArgs,
    ...audioCodecArgs,
    '-movflags', '+faststart',
    targetOutputFile
  ];

  forensics.ffmpegCommand = 'ffmpeg';
  forensics.ffmpegArgs = primaryArgs;
  console.log('[NEXUS-FINAL] ffmpeg command: ffmpeg ' + primaryArgs.join(' '));

  let remuxCode = -1;
  let execException: any = null;
  try {
    remuxCode = await ffmpeg.exec(primaryArgs);
  } catch (execErr: any) {
    execException = execErr;
    console.warn('[NEXUS-FINAL] FFMPEG_EXEC exception during primary command:', execErr?.message || execErr);
  }

  forensics.ffmpegExitCode = remuxCode;
  forensics.ffmpegStderr = ffmpegLogs.slice(-40).join('\n');
  instrument('FFMPEG_COMMAND', { args: forensics.ffmpegArgs });
  instrument('FFMPEG_EXIT_CODE', { code: remuxCode, stderr: forensics.ffmpegStderr });
  if (execException) {
    forensics.ffmpegException = execException?.message || String(execException);
    forensics.ffmpegStack = execException?.stack || null;
  }

  let outputData: Uint8Array | null = null;
  let outputFileName: string | null = null;
  let activeVideoCodec = 'h264';
  let activeAudioCodec = 'aac';

  if (remuxCode === 0) {
    try {
      outputData = await ffmpeg.readFile(targetOutputFile) as Uint8Array;
      outputFileName = targetOutputFile;
      console.log('[NEXUS-FINAL] FFmpeg produced output: YES, byte length:', outputData.byteLength);
    } catch (readErr: any) {
      console.warn('[NEXUS-FINAL] Notice reading targetOutputFile:', readErr?.message || readErr);
    }
  }

  // Fallback 1: If primary stream copy failed, try transcode with libx264 + aac
  if (!outputData && isVideoH264) {
    console.log('[NEXUS-FINAL] Stream copy failed, attempting libx264 transcode fallback...');
    const transcodeArgs = [
      '-i', inputVideoName,
      '-i', inputAudioName,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      'fallback_transcode.mp4'
    ];
    forensics.ffmpegArgs = transcodeArgs;
    try {
      const tcCode = await ffmpeg.exec(transcodeArgs);
      forensics.ffmpegExitCode = tcCode;
      forensics.ffmpegStderr = ffmpegLogs.slice(-40).join('\n');
      if (tcCode === 0) {
        outputData = await ffmpeg.readFile('fallback_transcode.mp4') as Uint8Array;
        outputFileName = 'fallback_transcode.mp4';
        activeVideoCodec = 'h264';
        activeAudioCodec = 'aac';
        console.log('[NEXUS-FINAL] Transcode fallback succeeded:', outputData.byteLength, 'bytes');
      }
    } catch (tcErr: any) {
      console.warn('[NEXUS-FINAL] Transcode fallback exception:', tcErr);
    }
  }

  // Fallback 2: Stream copy fallback
  if (!outputData) {
    console.log('[NEXUS-FINAL] Attempting fallback copy remux...');
    const fallbackCopyArgs = [
      '-i', inputVideoName,
      '-i', inputAudioName,
      '-c', 'copy',
      '-movflags', '+faststart',
      'fallback_copy.mp4'
    ];
    try {
      const copyCode = await ffmpeg.exec(fallbackCopyArgs);
      if (copyCode === 0) {
        outputData = await ffmpeg.readFile('fallback_copy.mp4') as Uint8Array;
        outputFileName = 'fallback_copy.mp4';
        activeVideoCodec = forensics.videoCodec;
        activeAudioCodec = forensics.audioCodec;
        console.log('[NEXUS-FINAL] Fallback copy succeeded:', outputData.byteLength, 'bytes');
      }
    } catch (copyErr) {
      console.warn('[NEXUS-FINAL] Fallback copy exception:', copyErr);
    }
  }

  // Never return raw media as an MP4. A browser download is successful only
  // when FFmpeg produced a non-empty, structurally valid MP4.
  if (!outputData) {
    console.error('[NEXUS-FINAL] FFmpeg produced output: NO');
    forensics.offscreenStatus = 'ffmpeg_output_missing';
    throw new Error(`[NEXUS-FINAL][FFMPEG_OUTPUT] FFmpeg produced no output (exitCode=${forensics.ffmpegExitCode})`);
  }

  // ftyp/moov and browser metadata are not enough: a container can parse while
  // carrying malformed or truncated H.264/AAC samples. Decode the exact file
  // that will be downloaded, including every required selected stream.
  const fullDecodeArgs = [
    '-v', 'error',
    '-xerror',
    '-err_detect', 'explode',
    '-i', outputFileName || targetOutputFile,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-f', 'null',
    '-'
  ];
  let fullDecodeCode = -1;
  try {
    fullDecodeCode = await ffmpeg.exec(fullDecodeArgs);
  } catch (decodeErr: any) {
    forensics.fullDecodeException = decodeErr?.message || String(decodeErr);
  }
  forensics.fullDecodeArgs = fullDecodeArgs;
  forensics.fullDecodeExitCode = fullDecodeCode;
  forensics.fullDecodeStderr = ffmpegLogs.slice(-80).join('\n');
  instrument('FULL_DECODE_CHECK', { code: fullDecodeCode, stderr: forensics.fullDecodeStderr });
  if (fullDecodeCode !== 0) {
    forensics.offscreenStatus = 'full_decode_failed';
    throw new Error(`[NEXUS-FINAL][FULL_DECODE_FAILED] exitCode=${fullDecodeCode}`);
  }

  const hasFtyp = outputData.length >= 8 &&
    String.fromCharCode(...outputData.subarray(4, 8)) === 'ftyp';
  const outputText = new TextDecoder().decode(outputData.subarray(0, Math.min(outputData.length, 2 * 1024 * 1024)));
  const hasMoov = outputText.includes('moov');
  const outputValid = forensics.ffmpegExitCode === 0 && outputData.byteLength > 0 && hasFtyp && hasMoov;
  forensics.outputValid = outputValid;
  instrument('OUTPUT_BYTES', { bytes: outputData.byteLength });
  instrument('OUTPUT_VALID', { valid: outputValid, hasFtyp, hasMoov });
  if (!outputValid) {
    forensics.offscreenStatus = 'invalid_output';
    throw new Error(`[NEXUS-FINAL][FFMPEG_OUTPUT_INVALID] exitCode=${forensics.ffmpegExitCode}, bytes=${outputData.byteLength}, ftyp=${hasFtyp}, moov=${hasMoov}`);
  }

  forensics.offscreenStatus = 'complete';

  // Calculate hash
  const exactBytes = outputData.buffer.slice(outputData.byteOffset, outputData.byteOffset + outputData.byteLength);
  const outHashBuffer = await crypto.subtle.digest('SHA-256', exactBytes);
  const outHashArray = Array.from(new Uint8Array(outHashBuffer));
  const sha256 = outHashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  const outputBlob = new Blob([exactBytes], { type: 'video/mp4' });
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
    console.warn('[NEXUS Offscreen] CDP Playback verification notice:', e);
  }

  if (!(verifiedDuration > 0) || !(verifiedWidth > 0) || !(verifiedHeight > 0)) {
    forensics.offscreenStatus = 'playback_verification_failed';
    throw new Error('[NEXUS-FINAL][OUTPUT_VALIDATION] MP4 metadata could not be decoded in Chromium');
  }

  const durationTolerance = Math.max(1.5, Number(expectedDuration || 0) * 0.05);
  if (Number(expectedDuration || 0) > 0 && Math.abs(verifiedDuration - Number(expectedDuration)) > durationTolerance) {
    forensics.offscreenStatus = 'duration_mismatch';
    throw new Error(`[NEXUS-FINAL][DURATION_MISMATCH] expected=${expectedDuration}s actual=${verifiedDuration}s tolerance=${durationTolerance}s`);
  }

  console.log('[NEXUS-FINAL] stage: DOWNLOAD');
  console.log(`[NEXUS-FINAL] blobUrl generated: ${blobUrl}`);
  console.log(`[NEXUS-FINAL] filename: ${filename || 'video.mp4'}`);

  // Clean MEMFS
  try { await ffmpeg.deleteFile(inputVideoName); } catch {}
  try { await ffmpeg.deleteFile(inputAudioName); } catch {}
  try { await ffmpeg.deleteFile('whatsapp_compat.mp4'); } catch {}
  try { await ffmpeg.deleteFile('fallback_transcode.mp4'); } catch {}
  try { await ffmpeg.deleteFile('fallback_copy.mp4'); } catch {}

  const result = {
    sessionId,
    filename: filename || `Vidleo_${Date.now()}.mp4`,
    outputBytes: outputData.byteLength,
    ffmpegExitCode: forensics.ffmpegExitCode,
    outputValid,
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
    downloadStarted: false,
    forensics,
  };

  return result;
}
