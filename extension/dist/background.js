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
  let mediaPartCount = 0;
  while (offset < rawUmp.length) {
    const [partType, afterType] = readVarInt(rawUmp, offset);
    if (partType < 0) throw new Error(`UMP_TRUNCATED_PART_TYPE offset=${offset}`);
    offset = afterType;
    const [partSize, afterSize] = readVarInt(rawUmp, offset);
    if (partSize < 0) throw new Error(`UMP_TRUNCATED_PART_SIZE offset=${offset}`);
    offset = afterSize;
    if (offset + partSize > rawUmp.length) {
      throw new Error(`UMP_TRUNCATED_PART payloadOffset=${offset} declared=${partSize} available=${rawUmp.length - offset}`);
    }
    if (partType === 21 && partSize > 1) {
      mediaPartCount++;
      const streamId = rawUmp[offset];
      const payload = rawUmp.subarray(offset + 1, offset + partSize);
      if (!streamTracks.has(streamId)) streamTracks.set(streamId, []);
      streamTracks.get(streamId).push(payload);
    }
    offset += partSize;
  }
  if (offset !== rawUmp.length) {
    throw new Error(`UMP_TRAILING_BYTES offset=${offset} total=${rawUmp.length}`);
  }
  if (mediaPartCount === 0) {
    throw new Error("UMP_MEDIA_PARTS_MISSING");
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
  function boxType(box) {
    return String.fromCharCode(box[4], box[5], box[6], box[7]);
  }
  function parseMp4Track(chunks, streamId) {
    const joined = concatByteArrays(chunks);
    const boxes = [];
    let cursor = 0;
    while (cursor < joined.length) {
      if (joined.length - cursor < 8) {
        throw new Error(`UMP_MP4_BOX_HEADER_TRUNCATED stream=${streamId} offset=${cursor}`);
      }
      const size32 = new DataView(joined.buffer, joined.byteOffset + cursor, 4).getUint32(0, false);
      let headerSize = 8;
      let boxSize = size32;
      if (size32 === 1) {
        if (joined.length - cursor < 16) {
          throw new Error(`UMP_MP4_LARGE_BOX_HEADER_TRUNCATED stream=${streamId} offset=${cursor}`);
        }
        const high = new DataView(joined.buffer, joined.byteOffset + cursor + 8, 4).getUint32(0, false);
        const low = new DataView(joined.buffer, joined.byteOffset + cursor + 12, 4).getUint32(0, false);
        boxSize = high * 4294967296 + low;
        headerSize = 16;
      } else if (size32 === 0) {
        boxSize = joined.length - cursor;
      }
      if (!Number.isSafeInteger(boxSize) || boxSize < headerSize || cursor + boxSize > joined.length) {
        throw new Error(`UMP_MP4_BOX_TRUNCATED stream=${streamId} offset=${cursor} declared=${boxSize} available=${joined.length - cursor}`);
      }
      boxes.push(joined.slice(cursor, cursor + boxSize));
      cursor += boxSize;
    }
    const seenInit = /* @__PURE__ */ new Set();
    const output = [];
    for (const box of boxes) {
      const type = boxType(box);
      if (type === "ftyp" || type === "moov") {
        const key = `${type}:${box.byteLength}:${Array.from(box.subarray(0, Math.min(32, box.length))).join(",")}`;
        if (seenInit.has(key)) continue;
        seenInit.add(key);
      }
      output.push(box);
    }
    if (!output.some((box) => boxType(box) === "moov" || boxType(box) === "moof")) {
      throw new Error(`UMP_MP4_MEDIA_BOXES_MISSING stream=${streamId}`);
    }
    return concatByteArrays(output);
  }
  const sortedTrackIds = Array.from(streamTracks.keys()).sort((a, b) => a - b);
  const audioTracks = [];
  const videoTracks = [];
  for (const id of sortedTrackIds) {
    const chunks = streamTracks.get(id) || [];
    const joined = concatByteArrays(chunks);
    if (isWebm(joined)) {
      audioTracks.push(joined);
    } else if (isMp4(joined)) {
      videoTracks.push(parseMp4Track(chunks, id));
    }
  }
  const audioWebm = audioTracks.length > 0 ? concatByteArrays(audioTracks) : null;
  const videoMp4 = videoTracks.length > 0 ? concatByteArrays(videoTracks) : null;
  let videoCodec = "h264";
  if (videoMp4) {
    const headerStr = String.fromCharCode(...videoMp4.subarray(0, Math.min(256, videoMp4.length)));
    if (headerStr.includes("av01")) videoCodec = "av1";
    else if (headerStr.includes("vp09") || headerStr.includes("vp9")) videoCodec = "vp9";
  }
  let audioCodec = "opus";
  if (audioWebm) {
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

// src/utils/media-response-accumulator.ts
function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function bodyFingerprint(bytes) {
  const sample = Math.min(64, bytes.byteLength);
  let head = "";
  let tail = "";
  for (let i = 0; i < sample; i++) head += bytes[i].toString(16).padStart(2, "0");
  for (let i = Math.max(0, bytes.byteLength - sample); i < bytes.byteLength; i++) {
    tail += bytes[i].toString(16).padStart(2, "0");
  }
  return `${bytes.byteLength}:${head}:${tail}`;
}
function assembleMediaResponseBodies(input) {
  const bodies = input.filter((body) => body.bytes.byteLength > 0).slice().sort((a, b) => a.sequence - b.sequence);
  const ranged = /* @__PURE__ */ new Map();
  const unranged = [];
  for (const body of bodies) {
    if (Number.isFinite(body.rangeStart) && Number.isFinite(body.rangeEnd)) {
      const group = ranged.get(body.streamKey) || [];
      group.push(body);
      ranged.set(body.streamKey, group);
    } else {
      unranged.push(body);
    }
  }
  let duplicateCount = 0;
  const reconstructed = [];
  for (const [streamKey, group] of ranged) {
    const byStart = group.slice().sort((a, b) => a.rangeStart - b.rangeStart || a.rangeEnd - b.rangeEnd);
    const unique = [];
    for (const body of byStart) {
      const previous = unique[unique.length - 1];
      if (previous && body.rangeStart === previous.rangeStart && body.rangeEnd === previous.rangeEnd) {
        if (!sameBytes(previous.bytes, body.bytes)) {
          throw new Error(`MEDIA_RANGE_CONFLICT stream=${streamKey} range=${body.rangeStart}-${body.rangeEnd}`);
        }
        duplicateCount++;
        continue;
      }
      unique.push(body);
    }
    for (let i = 0; i < unique.length; i++) {
      const body = unique[i];
      const declaredLength = body.rangeEnd - body.rangeStart + 1;
      if (declaredLength !== body.bytes.byteLength) {
        throw new Error(`MEDIA_RANGE_LENGTH_MISMATCH stream=${streamKey} range=${body.rangeStart}-${body.rangeEnd} body=${body.bytes.byteLength}`);
      }
      const next = unique[i + 1];
      if (next && next.rangeStart <= body.rangeEnd) {
        throw new Error(`MEDIA_RANGE_OVERLAP stream=${streamKey} ranges=${body.rangeStart}-${body.rangeEnd},${next.rangeStart}-${next.rangeEnd}`);
      }
      if (next && next.rangeStart > body.rangeEnd + 1) {
        throw new Error(`MEDIA_RANGE_GAP stream=${streamKey} after=${body.rangeEnd} before=${next.rangeStart}`);
      }
    }
    const total = unique.find((body) => Number.isFinite(body.rangeTotal))?.rangeTotal;
    if (total !== void 0 && unique.length > 0) {
      if (unique[0].rangeStart !== 0 || unique[unique.length - 1].rangeEnd !== total - 1) {
        throw new Error(`MEDIA_RANGE_INCOMPLETE stream=${streamKey} expected=0-${total - 1}`);
      }
    }
    reconstructed.push({
      firstSequence: unique[0]?.sequence ?? Number.MAX_SAFE_INTEGER,
      streamKey,
      bytes: concatBytes(unique.map((body) => body.bytes)),
      ranges: unique.map((body) => ({ start: body.rangeStart, end: body.rangeEnd, total: body.rangeTotal }))
    });
  }
  const seenUnranged = /* @__PURE__ */ new Map();
  const uniqueUnranged = [];
  for (const body of unranged) {
    const key = `${body.streamKey}:${bodyFingerprint(body.bytes)}`;
    const previous = seenUnranged.get(key);
    if (previous && sameBytes(previous.bytes, body.bytes)) {
      duplicateCount++;
      continue;
    }
    seenUnranged.set(key, body);
    uniqueUnranged.push(body);
  }
  const parts = [
    ...reconstructed.map((item) => ({ sequence: item.firstSequence, bytes: item.bytes })),
    ...uniqueUnranged.map((body) => ({ sequence: body.sequence, bytes: body.bytes }))
  ].sort((a, b) => a.sequence - b.sequence);
  return {
    bytes: concatBytes(parts.map((part) => part.bytes)),
    responseCount: bodies.length,
    duplicateCount,
    rangeCount: ranged.size,
    rangeGroups: reconstructed.map(({ streamKey, ranges }) => ({ streamKey, ranges }))
  };
}

// src/utils/duration-validation.ts
function durationToleranceSeconds(expectedDuration) {
  if (!(expectedDuration > 0)) return 2;
  return Math.max(2, expectedDuration * 0.05);
}
function validateDurationMetrics(metrics) {
  const { mode, expectedDuration, observedPlayerDuration } = metrics;
  const tolerance = durationToleranceSeconds(expectedDuration);
  if (mode === "DEMO") {
    return {
      valid: observedPlayerDuration > 0,
      expectedDuration,
      observedDuration: observedPlayerDuration,
      tolerance,
      delta: Math.abs(observedPlayerDuration - expectedDuration)
    };
  }
  if (expectedDuration > 0) {
    if (!(observedPlayerDuration > 0)) {
      return {
        valid: false,
        code: "PLAYER_DURATION_ZERO",
        message: `Observed player duration is zero or invalid: observed=${observedPlayerDuration}s`,
        expectedDuration,
        observedDuration: observedPlayerDuration,
        tolerance,
        delta: expectedDuration
      };
    }
    const delta = Math.abs(observedPlayerDuration - expectedDuration);
    if (delta > tolerance) {
      return {
        valid: false,
        code: "PLAYER_DURATION_MISMATCH",
        message: `Player duration mismatch: expected=${expectedDuration}s observed=${observedPlayerDuration}s tolerance=${tolerance}s delta=${delta.toFixed(3)}s`,
        expectedDuration,
        observedDuration: observedPlayerDuration,
        tolerance,
        delta
      };
    }
  }
  return {
    valid: true,
    expectedDuration,
    observedDuration: observedPlayerDuration,
    tolerance,
    delta: Math.abs(observedPlayerDuration - expectedDuration)
  };
}

// src/background/service-worker.ts
var DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
var OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
function withTimeout(promise, timeoutMs, code, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(message);
      error.code = code;
      reject(error);
    }, timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
function sendDebuggerCommand(debuggee, method, commandParams = {}, timeoutMs = 1e4) {
  return withTimeout(new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee, method, commandParams, (result) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        const error = new Error(lastError.message || `${method} failed`);
        error.code = `CDP_${method.replace(/[^A-Z0-9]+/gi, "_").toUpperCase()}_FAILED`;
        reject(error);
        return;
      }
      resolve(result);
    });
  }), timeoutMs, `CDP_${method.replace(/[^A-Z0-9]+/gi, "_").toUpperCase()}_TIMEOUT`, `${method} did not complete within ${timeoutMs}ms`);
}
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
    console.log("[NEXUS-INSTRUMENT] OFFSCREEN_CREATED:", JSON.stringify({
      event: "OFFSCREEN_CREATED",
      extensionId: chrome.runtime?.id || "unknown",
      extensionVersion: chrome.runtime?.getManifest?.()?.version || "1.0.1",
      timestamp: Date.now()
    }));
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
      source: "REAL_YOUTUBE_PLAYER_INVENTORY",
      streamIdentity: `youtube:${videoId || "unknown"}:video:${s.itag}`,
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
      source: "REAL_YOUTUBE_PLAYER_INVENTORY",
      streamIdentity: `youtube:${videoId || "unknown"}:audio:${s.itag}`,
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
var activeRequests = /* @__PURE__ */ new Map();
var activeSessions = /* @__PURE__ */ new Map();
var activeTabJobs = /* @__PURE__ */ new Map();
var tabDebuggerOwners = /* @__PURE__ */ new Map();
var terminalSessions = /* @__PURE__ */ new Map();
async function waitForNativeDownloadCompletion(options) {
  const downloads = globalThis.chrome?.downloads;
  if (!downloads?.download || !downloads?.search) {
    const error2 = new Error("Chrome downloads API is unavailable");
    error2.code = "NATIVE_DOWNLOAD_UNAVAILABLE";
    throw error2;
  }
  if (!options.url) {
    const error2 = new Error("Validated output did not provide a native download URL");
    error2.code = "NATIVE_DOWNLOAD_URL_MISSING";
    throw error2;
  }
  const timeoutMs = Math.max(3e4, Number(options.timeoutMs || 18e4));
  const startedAt = Date.now();
  const item = await new Promise((resolve, reject) => {
    downloads.download({
      url: options.url,
      filename: options.filename,
      saveAs: false
    }, (downloadId) => {
      const runtimeError = globalThis.chrome?.runtime?.lastError;
      if (runtimeError) {
        const error2 = new Error(runtimeError.message || "Chrome native download failed to start");
        error2.code = "NATIVE_DOWNLOAD_START_FAILED";
        reject(error2);
      } else if (!Number.isFinite(downloadId)) {
        const error2 = new Error("Chrome did not return a download ID");
        error2.code = "NATIVE_DOWNLOAD_START_FAILED";
        reject(error2);
      } else {
        resolve({ id: downloadId });
      }
    });
  });
  while (Date.now() - startedAt < timeoutMs) {
    const rows = await new Promise((resolve) => {
      downloads.search({ id: item.id }, (results) => resolve(Array.isArray(results) ? results : []));
    });
    const current = rows[0];
    if (current?.state === "complete") {
      const received = Number(current.bytesReceived || 0);
      const fileSize = Number(current.fileSize || 0);
      if (received <= 0 || options.expectedBytes > 0 && received !== options.expectedBytes) {
        const error2 = new Error(`Native download byte mismatch: expected=${options.expectedBytes} received=${received}`);
        error2.code = "NATIVE_DOWNLOAD_SIZE_MISMATCH";
        error2.download = current;
        throw error2;
      }
      if (fileSize > 0 && options.expectedBytes > 0 && fileSize !== options.expectedBytes) {
        const error2 = new Error(`Native download file size mismatch: expected=${options.expectedBytes} fileSize=${fileSize}`);
        error2.code = "NATIVE_DOWNLOAD_FILE_SIZE_MISMATCH";
        error2.download = current;
        throw error2;
      }
      return { downloadId: item.id, bytesReceived: received, fileSize, state: current.state };
    }
    if (current?.state === "interrupted") {
      const error2 = new Error(`Native download interrupted${current.error ? `: ${current.error}` : ""}`);
      error2.code = "NATIVE_DOWNLOAD_INTERRUPTED";
      error2.download = current;
      throw error2;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const error = new Error(`Timed out waiting for native download completion after ${timeoutMs}ms`);
  error.code = "NATIVE_DOWNLOAD_TIMEOUT";
  error.downloadId = item.id;
  throw error;
}
async function dispatchCdpMediaDownload(payload, sendResponse) {
  const sessionId = payload.sessionId || `cdp-${Date.now()}`;
  const requestId = payload.requestId || payload.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const selectedQuality = payload.quality || "360p";
  console.log(`[NEXUS-FINAL] dispatchCdpMediaDownload: requestId=${requestId}, sessionId=${sessionId}, quality=${selectedQuality}`);
  if (terminalSessions.has(sessionId)) {
    const term = terminalSessions.get(sessionId);
    console.log(`[NEXUS-FINAL] Session ${sessionId} already terminal (${term.state}). Returning terminal result.`);
    sendResponse({
      type: term.state === "SUCCESS" ? "CDP_MEDIA_DOWNLOAD_SUCCESS" : "CDP_MEDIA_DOWNLOAD_ERROR",
      payload: term.result
    });
    return;
  }
  let existingPromise = activeRequests.get(requestId) || activeSessions.get(sessionId);
  if (existingPromise) {
    console.log(`[NEXUS-FINAL] Reusing existing in-flight job for requestId=${requestId} / sessionId=${sessionId}`);
    try {
      const result = await existingPromise;
      sendResponse({ type: "CDP_MEDIA_DOWNLOAD_SUCCESS", payload: result });
    } catch (err) {
      sendResponse({ type: "CDP_MEDIA_DOWNLOAD_ERROR", payload: err });
    }
    return;
  }
  let ownedTabId;
  const jobPromise = (async () => {
    try {
      const result = await handleStartCdpMediaDownload({
        ...payload,
        sessionId,
        requestId
      }, (tabId) => {
        ownedTabId = tabId;
        if (activeTabJobs.has(tabId) && activeTabJobs.get(tabId).sessionId !== sessionId) {
          const err = new Error("Target playback tab is currently owned by another acquisition session");
          err.code = "CDP_TAB_BUSY";
          throw err;
        }
        activeTabJobs.set(tabId, { sessionId, requestId });
      });
      terminalSessions.set(sessionId, { state: "SUCCESS", result });
      return result;
    } catch (err) {
      terminalSessions.set(sessionId, { state: "FAILED", result: err });
      throw err;
    } finally {
      activeRequests.delete(requestId);
      activeSessions.delete(sessionId);
      if (ownedTabId !== void 0) {
        activeTabJobs.delete(ownedTabId);
      }
    }
  })();
  activeRequests.set(requestId, jobPromise);
  activeSessions.set(sessionId, jobPromise);
  try {
    const result = await jobPromise;
    sendResponse({
      type: "CDP_MEDIA_DOWNLOAD_SUCCESS",
      payload: result
    });
  } catch (err) {
    const errMsg = err?.message || String(err);
    const errCode = err?.code || "CDP_DOWNLOAD_FAILED";
    console.error(`[NEXUS-FINAL][SW] CDP Download failed (${errCode}):`, errMsg, err?.stack);
    const errorPayload = {
      type: "CDP_MEDIA_DOWNLOAD_ERROR",
      requestId,
      sessionId,
      stage: err?.stage || (errCode === "FFMPEG_INIT_ERROR" ? "FFMPEG_INIT" : "ACQUISITION_FAILED"),
      code: errCode,
      message: errMsg,
      error: errMsg,
      ffmpegExitCode: err?.ffmpegExitCode ?? -1,
      ffmpegStderr: err?.ffmpegStderr || ""
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
      let itag = "";
      try {
        const u = new URL(payload.streamUrl);
        itag = u.searchParams.get("itag") || "";
      } catch {
      }
      if (vid) {
        const entry = {
          url: payload.streamUrl,
          itag,
          videoId: vid,
          timestamp: Date.now()
        };
        observedYouTubeStreams.set(vid, entry);
        if (itag) {
          observedYouTubeStreams.set(`${vid}-${itag}`, entry);
        }
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
    (async () => {
      try {
        await waitForNativeDownloadCompletion({
          url: payload.blobUrl,
          filename: payload.filename,
          expectedBytes: Number(payload.totalBytes || 0)
        });
        notifyComplete(payload.jobId, "extension_format", payload.deliveryMode, payload.totalBytes);
      } catch (error) {
        console.error("[NEXUS Service Worker] Native download failed:", error);
      }
    })();
    return true;
  }
  if (message.type === "ACQUISITION_COMPLETE") {
    const payload = message.payload;
    console.log(`[NEXUS Service Worker] Direct acquisition complete for session ${payload.sessionId}: ${payload.filename}`);
    (async () => {
      try {
        const nativeDownload = await waitForNativeDownloadCompletion({
          url: payload.blobUrl,
          filename: payload.filename,
          expectedBytes: Number(payload.outputBytes || payload.totalBytes || payload.bytes || 0)
        });
        broadcastToTabs({ ...message, payload: { ...payload, downloadStarted: true, nativeDownload } });
      } catch (error) {
        console.error("[NEXUS Service Worker] Acquisition native download failed:", error);
        broadcastToTabs({ type: "ACQUISITION_FAILED", payload: { ...payload, error: error.message, code: error.code } });
      }
    })();
    return true;
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
async function handleStartCdpMediaDownload(payload, onTabAssigned) {
  const { sessionId, videoId, videoUrl, targetFilename, durationSeconds } = payload;
  const expectedDuration = Number(durationSeconds || 0);
  const requestedItag = payload.targetItag == null ? "" : String(payload.targetItag);
  const acquisitionMode = payload.mode || "FULL";
  if (acquisitionMode !== "FULL") {
    const error = new Error("CDP Full Video acquisition requires mode=FULL");
    error.code = "INVALID_ACQUISITION_MODE";
    throw error;
  }
  const trace = (event, extra = {}) => {
    const data = {
      event,
      sessionId,
      requestId: payload.requestId || "",
      extensionId: chrome.runtime?.id || "unknown",
      extensionVersion: chrome.runtime?.getManifest?.()?.version || "1.0.1",
      timestamp: Date.now(),
      ...extra
    };
    console.log(`[NEXUS-INSTRUMENT] ${event}:`, JSON.stringify(data));
  };
  trace("DOWNLOAD_START", { videoUrl, selectedQuality: payload.quality, targetItag: requestedItag, expectedDuration, mode: acquisitionMode });
  console.log("[NEXUS-FINAL] sessionId:", sessionId);
  console.log("[NEXUS-FINAL] selectedQuality:", payload.quality || "unknown");
  console.log("[NEXUS-FINAL] stage: CDP_ATTACH");
  await ensureOffscreenDocument();
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      requestId: payload.requestId,
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
  let targetTab = videoId ? ytTabs.find((t) => t.url?.includes(videoId)) : ytTabs[0];
  if (!targetTab && videoUrl && chrome.tabs && chrome.tabs.create) {
    targetTab = await withTimeout(new Promise((resolve, reject) => {
      chrome.tabs.create({ url: videoUrl, active: false }, (newTab) => {
        if (chrome.runtime.lastError || !newTab) reject(new Error(chrome.runtime.lastError?.message || "Unable to create YouTube playback tab"));
        else resolve(newTab);
      });
    }), 3e4, "TARGET_TAB_LOAD_TIMEOUT", "Timed out opening the YouTube playback tab");
    await new Promise((r) => setTimeout(r, 3e3));
  }
  if (!targetTab?.id) {
    const error = new Error(videoId ? "No YouTube tab for the selected video is available. Open the exact video tab and retry." : "No YouTube tab available for media byte acquisition. Please open the video in YouTube.");
    error.code = "TARGET_TAB_NOT_FOUND";
    throw error;
  }
  const tabId = targetTab.id;
  if (onTabAssigned) {
    onTabAssigned(tabId);
  }
  let previousActiveTabId = null;
  try {
    const activeTabs = await new Promise((r) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => r(tabs || []));
    });
    if (activeTabs[0]?.id && activeTabs[0].id !== tabId) {
      previousActiveTabId = activeTabs[0].id;
    }
  } catch {
  }
  try {
    await new Promise((r) => {
      chrome.tabs.update(tabId, { active: true }, () => r());
    });
  } catch {
  }
  const debuggee = { tabId };
  console.log("[NEXUS SW] Selected targetTab:", tabId, targetTab.url);
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      requestId: payload.requestId,
      sessionId,
      state: "YOUTUBE_TAB_READY",
      percent: 20,
      message: `Active YouTube playback tab connected (tab ${tabId})`
    }
  });
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      requestId: payload.requestId,
      sessionId,
      state: "CDP_ATTACHING",
      percent: 30,
      message: "Attaching Chrome DevTools Protocol to target playback tab..."
    }
  });
  let debuggerAttached = false;
  let rawUmpBytes;
  let observedPlayerDuration = 0;
  try {
    await withTimeout(new Promise((resolve, reject) => {
      chrome.debugger.attach(debuggee, "1.3", () => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || "";
          console.warn("[NEXUS SW] chrome.debugger.attach message:", msg);
          const err = new Error(msg.includes("Another debugger is already attached") ? "Target playback tab is already controlled by another debugger session. Close DevTools or retry after the other acquisition finishes." : `CDP attach failed: ${msg}`);
          err.code = msg.includes("Another debugger is already attached") ? "CDP_TAB_BUSY" : "CDP_ATTACH_FAILED";
          reject(err);
        } else {
          debuggerAttached = true;
          tabDebuggerOwners.set(tabId, { sessionId, requestId: payload.requestId || "", attached: true });
          console.log("[NEXUS SW] Debugger attached successfully to tab", tabId);
          resolve();
        }
      });
    }), 15e3, "CDP_ATTACH_TIMEOUT", "Timed out attaching Chrome DevTools Protocol");
    try {
      await sendDebuggerCommand(debuggee, "Network.enable", {
        maxResourceBufferSize: 100 * 1024 * 1024,
        maxTotalBufferSize: 200 * 1024 * 1024
      }, 15e3);
      trace("NETWORK_ENABLE_SUCCESS", { targetTabId: tabId });
    } catch (error) {
      trace("NETWORK_ENABLE_FAILED", { targetTabId: tabId, code: error?.code, message: error?.message });
      throw error;
    }
    try {
      await sendDebuggerCommand(debuggee, "Network.setBlockedURLs", {
        urls: [
          "*://*.doubleclick.net/*",
          "*://googleads.g.doubleclick.net/*",
          "*://pagead2.googlesyndication.com/*",
          "*://*.youtube.com/pagead/*",
          "*://*.youtube.com/ptracking*"
        ]
      }, 5e3);
      trace("NETWORK_BLOCKED_URLS_SET", { targetTabId: tabId });
    } catch {
    }
    await sendDebuggerCommand(debuggee, "Page.enable", {}, 1e4);
    await sendDebuggerCommand(debuggee, "Page.addScriptToEvaluateOnNewDocument", {
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
    }, 1e4);
    try {
      const qLabel = String(payload.quality || "");
      let qParam = "medium";
      if (qLabel.includes("1080")) qParam = "hd1080";
      else if (qLabel.includes("720")) qParam = "hd720";
      else if (qLabel.includes("480")) qParam = "large";
      else if (qLabel.includes("360")) qParam = "medium";
      else if (qLabel.includes("240")) qParam = "small";
      else if (qLabel.includes("144")) qParam = "tiny";
      await sendDebuggerCommand(debuggee, "Runtime.evaluate", {
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
      }, 1e4);
    } catch (error) {
      trace("QUALITY_SETUP_FAILED", { code: error?.code, message: error?.message });
    }
    console.log("[NEXUS-FINAL] stage: NETWORK");
    observedPlayerDuration = 0;
    broadcastToTabs({
      type: "NEXUS_CDP_PROGRESS",
      payload: {
        sessionId,
        state: "NETWORK_LISTENING",
        percent: 40,
        message: "Listening for YouTube active player media response bodies..."
      }
    });
    rawUmpBytes = await new Promise((resolve, reject) => {
      let settled = false;
      let playerEnded = false;
      let listeningActive = false;
      let responseOrder = 0;
      let targetCpn = null;
      let quietTimer = null;
      let acquisitionTimer = null;
      const pendingBodies = /* @__PURE__ */ new Set();
      const responseMeta = /* @__PURE__ */ new Map();
      const bodies = [];
      const timeoutMs = Math.max(12e4, expectedDuration > 0 ? expectedDuration * 1500 : 18e4);
      const cleanup = () => {
        if (quietTimer) clearTimeout(quietTimer);
        if (acquisitionTimer) clearTimeout(acquisitionTimer);
        try {
          chrome.debugger.onEvent.removeListener(eventListener);
        } catch {
        }
      };
      const finishIfReady = () => {
        if (settled || !playerEnded || pendingBodies.size > 0) return;
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          const ordered = bodies.slice().sort((a, b) => a.sequence - b.sequence);
          const totalBytes = ordered.reduce((n, item) => n + item.bytes.length, 0);
          const hasMedia = ordered.some((item) => item.bytes.length > 0 && (containsMoof(item.bytes) || item.meta.mimeType.includes("vnd.yt-ump")));
          trace("MEDIA_BYTES_ACQUIRED", {
            responseCount: ordered.length,
            totalBytes,
            responses: ordered.map((item) => ({ ...item.meta, responseId: item.requestId, encodedDataLength: item.bytes.length })),
            playerEnded
          });
          if (!hasMedia || ordered.length === 0) {
            const error = new Error("No complete browser media response set was acquired before player ended");
            error.code = "MEDIA_ACQUISITION_INCOMPLETE";
            reject(error);
            return;
          }
          try {
            const assembled = assembleMediaResponseBodies(ordered.map((item) => ({
              sequence: item.sequence,
              requestId: item.requestId,
              bytes: item.bytes,
              streamKey: item.meta.streamKey,
              rangeStart: item.meta.rangeStart,
              rangeEnd: item.meta.rangeEnd,
              rangeTotal: item.meta.rangeTotal
            })));
            trace("MEDIA_RESPONSE_ASSEMBLED", {
              responseCount: assembled.responseCount,
              duplicateCount: assembled.duplicateCount,
              rangeCount: assembled.rangeCount,
              rangeGroups: assembled.rangeGroups,
              assembledBytes: assembled.bytes.length
            });
            resolve(assembled.bytes);
          } catch (assemblyErr) {
            const error = new Error(assemblyErr?.message || "Media response range reconstruction failed");
            error.code = assemblyErr?.message?.startsWith("MEDIA_RANGE_") ? "MEDIA_RANGE_INCOMPLETE" : "MEDIA_ASSEMBLY_FAILED";
            reject(error);
          }
        }, 500);
      };
      acquisitionTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        const error = new Error(`Timed out acquiring complete browser media stream after ${Math.round(timeoutMs / 1e3)}s`);
        error.code = "MEDIA_ACQUISITION_TIMEOUT";
        reject(error);
      }, timeoutMs);
      const getBody = (requestId) => {
        const meta = responseMeta.get(requestId);
        if (!meta) return;
        const operation = new Promise((done) => {
          trace("GET_RESPONSE_BODY", { responseId: requestId, ...meta });
          broadcastToTabs({
            type: "NEXUS_CDP_PROGRESS",
            payload: {
              requestId: payload.requestId,
              sessionId,
              state: "ACQUIRING_MEDIA",
              percent: 50,
              message: "Retrieving and accumulating active-player media response bytes..."
            }
          });
          chrome.debugger.sendCommand(debuggee, "Network.getResponseBody", { requestId }, (res) => {
            if (chrome.runtime.lastError || !res?.body) {
              trace("MEDIA_RESPONSE_BODY_FAILED", {
                responseId: requestId,
                reason: chrome.runtime.lastError?.message || "EMPTY_RESPONSE_BODY",
                ...meta
              });
              done();
              return;
            }
            if (!res.base64Encoded) {
              trace("MEDIA_RESPONSE_BODY_REJECTED", {
                responseId: requestId,
                reason: "BINARY_BODY_NOT_BASE64",
                ...meta
              });
              done();
              return;
            }
            let bytes;
            if (res.base64Encoded) {
              const binary = atob(res.body);
              bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            }
            if (bytes.length > 0) {
              bodies.push({ sequence: meta.responseOrder, requestId, bytes, meta });
              trace("MEDIA_RESPONSE_BODY_ACQUIRED", { responseId: requestId, bytes: bytes.length, ...meta });
            }
            done();
          });
        });
        pendingBodies.add(operation);
        operation.finally(() => {
          pendingBodies.delete(operation);
          finishIfReady();
        });
      };
      const eventListener = (source, method, params) => {
        if (source.tabId && source.tabId !== tabId) return;
        if (!listeningActive || playerEnded) return;
        if (method === "Network.responseReceived" && params?.response) {
          const response = params.response;
          const url = response.url || "";
          const mimeType = String(response.mimeType || "").toLowerCase();
          if (!url.includes("videoplayback") && !mimeType.includes("vnd.yt-ump")) return;
          const parsed = new URL(url);
          if (parsed.searchParams.has("adformat") || parsed.searchParams.has("ad_type") || url.includes("/ads/")) {
            trace("AD_MEDIA_IGNORED", { responseId: params.requestId });
            return;
          }
          const cpn = parsed.searchParams.get("cpn") || "";
          if (cpn) {
            targetCpn = cpn;
          }
          const itag = parsed.searchParams.get("itag") || "";
          if (requestedItag && itag && itag !== requestedItag && !mimeType.includes("audio") && !mimeType.includes("vnd.yt-ump")) return;
          const headers = response.headers || {};
          const contentRange = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-range")?.[1] || "";
          const contentLength = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-length")?.[1] || "";
          const rangeMatch = String(contentRange).match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
          const stableUrl = new URL(url);
          for (const key of ["range", "rn", "rbuf", "alr", "cpn"]) stableUrl.searchParams.delete(key);
          const rangeTotal = rangeMatch && rangeMatch[3] !== "*" ? Number(rangeMatch[3]) : void 0;
          const meta = {
            itag,
            mimeType,
            url,
            streamKey: `${itag || "unknown"}:${mimeType}:${stableUrl.origin}${stableUrl.pathname}${stableUrl.search}`,
            responseOrder: responseOrder++,
            requestType: response.type || "",
            contentRange: String(contentRange),
            rangeStart: rangeMatch ? Number(rangeMatch[1]) : void 0,
            rangeEnd: rangeMatch ? Number(rangeMatch[2]) : void 0,
            rangeTotal,
            contentLength: Number(contentLength) || 0,
            timestamp: Date.now()
          };
          responseMeta.set(params.requestId, meta);
          trace("MEDIA_RESPONSE_DETECTED", { responseId: params.requestId, ...meta });
          if (responseMeta.size === 1) {
            broadcastToTabs({
              type: "NEXUS_CDP_PROGRESS",
              payload: {
                requestId: payload.requestId,
                sessionId,
                state: "MEDIA_DETECTED",
                percent: 45,
                message: "Eligible player media response detected; retrieving binary body..."
              }
            });
          }
        }
        if (method === "Network.loadingFinished" && params?.requestId && responseMeta.has(params.requestId)) {
          getBody(params.requestId);
        }
      };
      chrome.debugger.onEvent.addListener(eventListener);
      trace("NETWORK_LISTENING", { targetTabId: tabId, requestedItag, expectedDuration });
      broadcastToTabs({
        type: "NEXUS_CDP_PROGRESS",
        payload: {
          requestId: payload.requestId,
          sessionId,
          state: "WAITING_FOR_MEDIA",
          percent: 40,
          message: "Waiting for eligible active-player media responses (bounded timeout)..."
        }
      });
      const expectedDurationLiteral = JSON.stringify(expectedDuration);
      const videoIdLiteral = JSON.stringify(videoId || "");
      const driveExpression = `(async () => {
      const expected = ${expectedDurationLiteral};
      const expectedId = ${videoIdLiteral};
      let player = null;
      let v = null;
      let sourceDuration = 0;

      for (let i = 0; i < 120; i++) {
        player = document.getElementById('movie_player') || document.querySelector('ytd-player')?.getPlayer?.();
        v = player?.querySelector('video') || document.querySelector('video');

        const skipBtns = document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .videoAdUiSkipButton, button[id^="skip-button"], .ytp-ad-skip-button-slot button');
        for (const btn of skipBtns) {
          try { btn.click(); } catch (e) {}
        }
        try { player?.skipAd?.(); } catch (e) {}

        const isAd = (player?.getAdState && player.getAdState() > 0) ||
                     Boolean(document.querySelector('.ad-showing, .ad-interrupting'));
        if (isAd && v) {
          v.muted = true;
          try { v.playbackRate = 16.0; } catch (e) {}
          try { v.play(); } catch (e) {}
        }

        if (!isAd && v) {
          const dataId = String(player?.getVideoData?.()?.video_id || '');
          const apiDuration = Number(player?.getDuration?.()) || 0;
          const elementDuration = Number(v?.duration) || 0;
          const candidateDuration = apiDuration || elementDuration;
          const idMatches = !expectedId || !dataId || dataId === expectedId;
          const durationMatches = !expected || !candidateDuration ||
            Math.abs(candidateDuration - expected) <= Math.max(2, expected * 0.05);

          if (idMatches && durationMatches && candidateDuration > 0) {
            sourceDuration = candidateDuration;
            break;
          }
        }
        await new Promise(r => setTimeout(r, 500));
      }

      if (!v || !sourceDuration) {
        throw new Error('YouTube full-source player duration was not available or player remained in ad state');
      }

      if (v.currentTime > 1.5) {
        try { player?.seekTo?.(0, true); } catch (e) { v.currentTime = 0; }
        await new Promise(r => setTimeout(r, 200));
      }

      v.muted = true;
      try { v.playbackRate = 2.0; } catch (e) {}
      try { await v.play(); } catch (e) {}

      return await new Promise((resolve, reject) => {
        let lastBufferedEnd = 0;
        let maxBufferedSeen = 0;
        let stallTicks = 0;
        const startTime = Date.now();
        const maxWaitMs = Math.max(90000, sourceDuration * 1200);

        const timer = setInterval(() => {
          try {
            const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .videoAdUiSkipButton');
            if (skipBtn) {
              try { skipBtn.click(); } catch (e) {}
            }

            const cur = Number(player?.getCurrentTime?.()) || Number(v?.currentTime) || 0;
            const dur = Number(player?.getDuration?.()) || Number(v?.duration) || sourceDuration;

            // Inspect buffered ranges and track highest buffered end
            let bEnd = 0;
            if (v && v.buffered && v.buffered.length > 0) {
              bEnd = v.buffered.end(v.buffered.length - 1);
              if (bEnd > maxBufferedSeen) {
                maxBufferedSeen = bEnd;
              }
            }

            const bufferReachedEnd = dur > 0 && maxBufferedSeen >= dur - 1.0;
            const playerReachedEnd = Boolean(v?.ended) || (dur > 0 && cur >= dur - 1.0);

            if (bufferReachedEnd || playerReachedEnd) {
              clearInterval(timer);
              try { player?.seekTo?.(dur, true); } catch (e) { if (v) v.currentTime = dur; }
              setTimeout(() => {
                resolve({
                  duration: dur,
                  videoDuration: Number(v?.duration) || 0,
                  currentTime: dur,
                  sourceDuration,
                  bufferedEnd: maxBufferedSeen,
                });
              }, 600);
              return;
            }

            // Buffer Frontier Advancement:
            // Whenever buffered range extends beyond current playhead + 1.0s, advance playhead
            // to 0.5s before the end of the buffered region. This immediately stimulates YouTube's
            // DASH scheduler to request the subsequent contiguous chunk!
            if (bEnd > cur + 1.0) {
              stallTicks = 0;
              const targetTime = Math.min(dur - 0.5, Math.max(0, bEnd - 0.5));
              try {
                player?.seekTo?.(targetTime, true);
              } catch (e) {
                if (v) v.currentTime = targetTime;
              }
              try { v?.play?.(); } catch (e) {}
            } else {
              stallTicks++;
              if (v && v.paused && !v.ended) {
                try { v.play(); } catch (e) {}
              }
              if (!v.muted) {
                v.muted = true;
              }
              if (stallTicks % 10 === 0 && maxBufferedSeen > 0) {
                const nudgeTime = Math.min(dur - 0.5, Math.max(0, maxBufferedSeen - 0.5));
                try { player?.seekTo?.(nudgeTime, true); } catch (e) { if (v) v.currentTime = nudgeTime; }
                try { v.play(); } catch (e) {}
              }
            }

            if (Date.now() - startTime > maxWaitMs) {
              clearInterval(timer);
              reject(new Error('Timed out driving buffer frontier advancement to full duration: reached ' + maxBufferedSeen.toFixed(1) + 's / ' + dur.toFixed(1) + 's'));
            }
          } catch (tickErr) {
            // keep timer alive
          }
        }, 300);
      });
    })()`;
      const startPlayback = () => {
        listeningActive = true;
        targetCpn = null;
        bodies.length = 0;
        responseMeta.clear();
        chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", { expression: driveExpression, awaitPromise: true, returnByValue: true }, (result) => {
          if (chrome.runtime.lastError || result?.exceptionDetails) {
            const detail = result?.exceptionDetails?.exception?.description || result?.exceptionDetails?.text || chrome.runtime.lastError?.message || "unknown";
            const error = new Error(`Unable to drive the real YouTube player to full duration: ${detail}`);
            error.code = "PLAYER_FULL_DURATION_FAILED";
            settled = true;
            cleanup();
            reject(error);
            return;
          }
          playerEnded = true;
          observedPlayerDuration = Number(result?.result?.value?.duration) || Number(result?.result?.value?.sourceDuration) || 0;
          const curTime = Number(result?.result?.value?.currentTime) || 0;
          trace("PLAYER_REACHED_END", {
            playerDuration: observedPlayerDuration,
            currentTime: curTime,
            expectedDuration,
            responseCount: bodies.length,
            acquiredBytes: bodies.reduce((n, item) => n + item.bytes.length, 0)
          });
          const validation = validateDurationMetrics({
            mode: acquisitionMode,
            expectedDuration,
            observedPlayerDuration,
            playerCurrentTime: curTime
          });
          if (!validation.valid) {
            trace("PLAYER_DURATION_MISMATCH", {
              expectedDuration,
              observedPlayerDuration,
              currentTime: curTime,
              tolerance: validation.tolerance,
              delta: validation.delta,
              responseCount: bodies.length,
              acquiredBytes: bodies.reduce((n, item) => n + item.bytes.length, 0)
            });
            settled = true;
            cleanup();
            const error = new Error(validation.message || "Player duration mismatch");
            error.code = validation.code || "PLAYER_DURATION_MISMATCH";
            reject(error);
            return;
          }
          finishIfReady();
        });
      };
      withTimeout(new Promise((resolve2, reject2) => {
        chrome.tabs.reload(tabId, {}, () => {
          if (chrome.runtime.lastError) {
            const error = new Error(chrome.runtime.lastError.message || "Unable to reload the target playback tab");
            error.code = "TARGET_TAB_RELOAD_FAILED";
            reject2(error);
          } else {
            resolve2();
          }
        });
      }), 3e4, "TARGET_TAB_RELOAD_TIMEOUT", "Timed out reloading the target playback tab").then(() => setTimeout(startPlayback, 1500)).catch((error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });
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
  } finally {
    if (debuggerAttached) {
      try {
        chrome.debugger.detach(debuggee, () => {
        });
      } catch {
      }
      debuggerAttached = false;
      tabDebuggerOwners.delete(tabId);
    }
    if (previousActiveTabId) {
      try {
        chrome.tabs.update(previousActiveTabId, { active: true }, () => {
        });
      } catch {
      }
    }
  }
  console.log("[NEXUS-FINAL] stage: UMP, raw bytes:", rawUmpBytes.length);
  trace("UMP_DEMUX", { rawUmpBytes: rawUmpBytes.length });
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
  console.log(`[NEXUS-FINAL] videoStream: bytes=${demux.videoBytes}, itag=${requestedItag || "observed"}, container=mp4`);
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "VIDEO_ASSEMBLY",
      percent: 80,
      message: `Assembled video track (${demux.videoBytes} bytes, itag ${requestedItag || "observed"})`,
      videoBytes: demux.videoBytes,
      audioBytes: demux.audioBytes
    }
  });
  console.log("[NEXUS-FINAL] stage: AUDIO_ASSEMBLY");
  console.log(`[NEXUS-FINAL] audioStream: bytes=${demux.audioBytes}, itag=observed, container=webm`);
  broadcastToTabs({
    type: "NEXUS_CDP_PROGRESS",
    payload: {
      sessionId,
      state: "AUDIO_ASSEMBLY",
      percent: 85,
      message: `Assembled audio track (${demux.audioBytes} bytes, itag observed)`,
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
        requestId: payload.requestId || "",
        sessionId,
        filename: targetFilename || `Vidleo_YouTube_${videoId || Date.now()}.mp4`,
        videoBase64,
        audioBase64,
        videoBytesCount: demux.videoBytes,
        audioBytesCount: demux.audioBytes,
        expectedDuration: observedPlayerDuration || expectedDuration,
        selectedQuality: payload.quality,
        quality: payload.quality,
        targetItag: payload.targetItag,
        videoItag: requestedItag,
        audioItag: "",
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
        const error = new Error(resp.error || resp.details?.message || "Offscreen processing failed");
        error.code = resp.code || "OFFSCREEN_ERROR";
        error.ffmpegExitCode = resp.details?.ffmpegExitCode ?? -1;
        error.ffmpegStderr = resp.details?.ffmpegStderr || "";
        error.stage = error.code === "FFMPEG_INIT_ERROR" ? "FFMPEG_INIT" : "OFFSCREEN";
        reject(error);
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
  const resultPayload = {
    type: "CDP_MEDIA_DOWNLOAD_SUCCESS",
    requestId: payload.requestId,
    sessionId,
    filename: ffmpegRes.filename,
    bytes: ffmpegRes.outputBytes,
    totalBytes: ffmpegRes.outputBytes,
    mimeType: ffmpegRes.mimeType || "video/mp4",
    outputPath: ffmpegRes.filename,
    blobUrl: ffmpegRes.blobUrl,
    ffmpegExitCode: ffmpegRes.ffmpegExitCode,
    rawUmpBytes: demux.rawUmpBytes,
    videoBytes: demux.videoBytes,
    audioBytes: demux.audioBytes,
    duration: ffmpegRes.duration,
    videoCodec: ffmpegRes.videoCodec || "h264",
    audioCodec: ffmpegRes.audioCodec || "aac",
    resolution: `${ffmpegRes.width}x${ffmpegRes.height}`,
    sha256: ffmpegRes.sha256,
    downloadStarted: false,
    provenance: "CDP_ACTIVE_PLAYER_MEDIA_RESPONSE_BODY"
  };
  if (resultPayload.ffmpegExitCode !== 0 || ffmpegRes.outputValid !== true || resultPayload.bytes <= 0) {
    const error = new Error("FFmpeg completed without a valid non-empty MP4 output");
    error.code = "FFMPEG_OUTPUT_INVALID";
    error.ffmpegExitCode = resultPayload.ffmpegExitCode;
    error.ffmpegStderr = ffmpegRes.forensics?.ffmpegStderr || "";
    throw error;
  }
  const nativeDownload = await waitForNativeDownloadCompletion({
    url: ffmpegRes.blobUrl,
    filename: ffmpegRes.filename,
    expectedBytes: resultPayload.bytes
  });
  resultPayload.downloadStarted = true;
  resultPayload.nativeDownload = nativeDownload;
  console.log("[NEXUS SW] Native Chrome download completed:", nativeDownload);
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
    const nativeDownload = await waitForNativeDownloadCompletion({
      url: finalResult.blobUrl,
      filename: finalResult.filename,
      expectedBytes: Number(finalResult.outputBytes || finalResult.bytes || 0)
    });
    finalResult.downloadStarted = true;
    finalResult.nativeDownload = nativeDownload;
    console.log("[NEXUS Service Worker] Chrome download completed:", nativeDownload);
  } else {
    const error = new Error("Playback capture did not produce a native download URL");
    error.code = "NATIVE_DOWNLOAD_URL_MISSING";
    throw error;
  }
  broadcastToTabs({
    type: "PLAYBACK_CAPTURE_COMPLETE",
    payload: finalResult
  });
  return finalResult;
}
//# sourceMappingURL=background.js.map
