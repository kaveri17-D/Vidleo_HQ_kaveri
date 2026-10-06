var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/const.js
var CORE_VERSION, CORE_URL, FFMessageType;
var init_const = __esm({
  "../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/const.js"() {
    CORE_VERSION = "0.12.9";
    CORE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`;
    (function(FFMessageType2) {
      FFMessageType2["LOAD"] = "LOAD";
      FFMessageType2["EXEC"] = "EXEC";
      FFMessageType2["FFPROBE"] = "FFPROBE";
      FFMessageType2["WRITE_FILE"] = "WRITE_FILE";
      FFMessageType2["READ_FILE"] = "READ_FILE";
      FFMessageType2["DELETE_FILE"] = "DELETE_FILE";
      FFMessageType2["RENAME"] = "RENAME";
      FFMessageType2["CREATE_DIR"] = "CREATE_DIR";
      FFMessageType2["LIST_DIR"] = "LIST_DIR";
      FFMessageType2["DELETE_DIR"] = "DELETE_DIR";
      FFMessageType2["ERROR"] = "ERROR";
      FFMessageType2["DOWNLOAD"] = "DOWNLOAD";
      FFMessageType2["PROGRESS"] = "PROGRESS";
      FFMessageType2["LOG"] = "LOG";
      FFMessageType2["MOUNT"] = "MOUNT";
      FFMessageType2["UNMOUNT"] = "UNMOUNT";
    })(FFMessageType || (FFMessageType = {}));
  }
});

// ../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/utils.js
var getMessageID;
var init_utils = __esm({
  "../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/utils.js"() {
    getMessageID = /* @__PURE__ */ (() => {
      let messageID = 0;
      return () => messageID++;
    })();
  }
});

// ../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js
var ERROR_UNKNOWN_MESSAGE_TYPE, ERROR_NOT_LOADED, ERROR_TERMINATED, ERROR_IMPORT_FAILURE;
var init_errors = __esm({
  "../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js"() {
    ERROR_UNKNOWN_MESSAGE_TYPE = new Error("unknown message type");
    ERROR_NOT_LOADED = new Error("ffmpeg is not loaded, call `await ffmpeg.load()` first");
    ERROR_TERMINATED = new Error("called FFmpeg.terminate()");
    ERROR_IMPORT_FAILURE = new Error("failed to import ffmpeg-core.js");
  }
});

// ../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/classes.js
var FFmpeg;
var init_classes = __esm({
  "../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/classes.js"() {
    init_const();
    init_utils();
    init_errors();
    FFmpeg = class {
      #worker = null;
      /**
       * #resolves and #rejects tracks Promise resolves and rejects to
       * be called when we receive message from web worker.
       */
      #resolves = {};
      #rejects = {};
      #logEventCallbacks = [];
      #progressEventCallbacks = [];
      loaded = false;
      /**
       * register worker message event handlers.
       */
      #registerHandlers = () => {
        if (this.#worker) {
          this.#worker.onmessage = ({ data: { id, type, data } }) => {
            switch (type) {
              case FFMessageType.LOAD:
                this.loaded = true;
                this.#resolves[id](data);
                break;
              case FFMessageType.MOUNT:
              case FFMessageType.UNMOUNT:
              case FFMessageType.EXEC:
              case FFMessageType.FFPROBE:
              case FFMessageType.WRITE_FILE:
              case FFMessageType.READ_FILE:
              case FFMessageType.DELETE_FILE:
              case FFMessageType.RENAME:
              case FFMessageType.CREATE_DIR:
              case FFMessageType.LIST_DIR:
              case FFMessageType.DELETE_DIR:
                this.#resolves[id](data);
                break;
              case FFMessageType.LOG:
                this.#logEventCallbacks.forEach((f) => f(data));
                break;
              case FFMessageType.PROGRESS:
                this.#progressEventCallbacks.forEach((f) => f(data));
                break;
              case FFMessageType.ERROR:
                this.#rejects[id](data);
                break;
            }
            delete this.#resolves[id];
            delete this.#rejects[id];
          };
        }
      };
      /**
       * Generic function to send messages to web worker.
       */
      #send = ({ type, data }, trans = [], signal) => {
        if (!this.#worker) {
          return Promise.reject(ERROR_NOT_LOADED);
        }
        return new Promise((resolve, reject) => {
          const id = getMessageID();
          this.#worker && this.#worker.postMessage({ id, type, data }, trans);
          this.#resolves[id] = resolve;
          this.#rejects[id] = reject;
          signal?.addEventListener("abort", () => {
            reject(new DOMException(`Message # ${id} was aborted`, "AbortError"));
          }, { once: true });
        });
      };
      on(event, callback) {
        if (event === "log") {
          this.#logEventCallbacks.push(callback);
        } else if (event === "progress") {
          this.#progressEventCallbacks.push(callback);
        }
      }
      off(event, callback) {
        if (event === "log") {
          this.#logEventCallbacks = this.#logEventCallbacks.filter((f) => f !== callback);
        } else if (event === "progress") {
          this.#progressEventCallbacks = this.#progressEventCallbacks.filter((f) => f !== callback);
        }
      }
      /**
       * Loads ffmpeg-core inside web worker. It is required to call this method first
       * as it initializes WebAssembly and other essential variables.
       *
       * @category FFmpeg
       * @returns `true` if ffmpeg core is loaded for the first time.
       */
      load = ({ classWorkerURL, ...config } = {}, { signal } = {}) => {
        if (!this.#worker) {
          this.#worker = classWorkerURL ? new Worker(new URL(classWorkerURL, import.meta.url), {
            type: "module"
          }) : (
            // We need to duplicated the code here to enable webpack
            // to bundle worekr.js here.
            new Worker(new URL("./worker.js", import.meta.url), {
              type: "module"
            })
          );
          this.#registerHandlers();
        }
        return this.#send({
          type: FFMessageType.LOAD,
          data: config
        }, void 0, signal);
      };
      /**
       * Execute ffmpeg command.
       *
       * @remarks
       * To avoid common I/O issues, ["-nostdin", "-y"] are prepended to the args
       * by default.
       *
       * @example
       * ```ts
       * const ffmpeg = new FFmpeg();
       * await ffmpeg.load();
       * await ffmpeg.writeFile("video.avi", ...);
       * // ffmpeg -i video.avi video.mp4
       * await ffmpeg.exec(["-i", "video.avi", "video.mp4"]);
       * const data = ffmpeg.readFile("video.mp4");
       * ```
       *
       * @returns `0` if no error, `!= 0` if timeout (1) or error.
       * @category FFmpeg
       */
      exec = (args, timeout = -1, { signal } = {}) => this.#send({
        type: FFMessageType.EXEC,
        data: { args, timeout }
      }, void 0, signal);
      /**
       * Execute ffprobe command.
       *
       * @example
       * ```ts
       * const ffmpeg = new FFmpeg();
       * await ffmpeg.load();
       * await ffmpeg.writeFile("video.avi", ...);
       * // Getting duration of a video in seconds: ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 video.avi -o output.txt
       * await ffmpeg.ffprobe(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", "video.avi", "-o", "output.txt"]);
       * const data = ffmpeg.readFile("output.txt");
       * ```
       *
       * @returns `0` if no error, `!= 0` if timeout (1) or error.
       * @category FFmpeg
       */
      ffprobe = (args, timeout = -1, { signal } = {}) => this.#send({
        type: FFMessageType.FFPROBE,
        data: { args, timeout }
      }, void 0, signal);
      /**
       * Terminate all ongoing API calls and terminate web worker.
       * `FFmpeg.load()` must be called again before calling any other APIs.
       *
       * @category FFmpeg
       */
      terminate = () => {
        const ids = Object.keys(this.#rejects);
        for (const id of ids) {
          this.#rejects[id](ERROR_TERMINATED);
          delete this.#rejects[id];
          delete this.#resolves[id];
        }
        if (this.#worker) {
          this.#worker.terminate();
          this.#worker = null;
          this.loaded = false;
        }
      };
      /**
       * Write data to ffmpeg.wasm.
       *
       * @example
       * ```ts
       * const ffmpeg = new FFmpeg();
       * await ffmpeg.load();
       * await ffmpeg.writeFile("video.avi", await fetchFile("../video.avi"));
       * await ffmpeg.writeFile("text.txt", "hello world");
       * ```
       *
       * @category File System
       */
      writeFile = (path, data, { signal } = {}) => {
        const trans = [];
        if (data instanceof Uint8Array) {
          trans.push(data.buffer);
        }
        return this.#send({
          type: FFMessageType.WRITE_FILE,
          data: { path, data }
        }, trans, signal);
      };
      mount = (fsType, options, mountPoint) => {
        const trans = [];
        return this.#send({
          type: FFMessageType.MOUNT,
          data: { fsType, options, mountPoint }
        }, trans);
      };
      unmount = (mountPoint) => {
        const trans = [];
        return this.#send({
          type: FFMessageType.UNMOUNT,
          data: { mountPoint }
        }, trans);
      };
      /**
       * Read data from ffmpeg.wasm.
       *
       * @example
       * ```ts
       * const ffmpeg = new FFmpeg();
       * await ffmpeg.load();
       * const data = await ffmpeg.readFile("video.mp4");
       * ```
       *
       * @category File System
       */
      readFile = (path, encoding = "binary", { signal } = {}) => this.#send({
        type: FFMessageType.READ_FILE,
        data: { path, encoding }
      }, void 0, signal);
      /**
       * Delete a file.
       *
       * @category File System
       */
      deleteFile = (path, { signal } = {}) => this.#send({
        type: FFMessageType.DELETE_FILE,
        data: { path }
      }, void 0, signal);
      /**
       * Rename a file or directory.
       *
       * @category File System
       */
      rename = (oldPath, newPath, { signal } = {}) => this.#send({
        type: FFMessageType.RENAME,
        data: { oldPath, newPath }
      }, void 0, signal);
      /**
       * Create a directory.
       *
       * @category File System
       */
      createDir = (path, { signal } = {}) => this.#send({
        type: FFMessageType.CREATE_DIR,
        data: { path }
      }, void 0, signal);
      /**
       * List directory contents.
       *
       * @category File System
       */
      listDir = (path, { signal } = {}) => this.#send({
        type: FFMessageType.LIST_DIR,
        data: { path }
      }, void 0, signal);
      /**
       * Delete an empty directory.
       *
       * @category File System
       */
      deleteDir = (path, { signal } = {}) => this.#send({
        type: FFMessageType.DELETE_DIR,
        data: { path }
      }, void 0, signal);
    };
  }
});

// ../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/types.js
var FFFSType;
var init_types = __esm({
  "../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/types.js"() {
    (function(FFFSType2) {
      FFFSType2["MEMFS"] = "MEMFS";
      FFFSType2["NODEFS"] = "NODEFS";
      FFFSType2["NODERAWFS"] = "NODERAWFS";
      FFFSType2["IDBFS"] = "IDBFS";
      FFFSType2["WORKERFS"] = "WORKERFS";
      FFFSType2["PROXYFS"] = "PROXYFS";
    })(FFFSType || (FFFSType = {}));
  }
});

// ../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js
var esm_exports = {};
__export(esm_exports, {
  FFFSType: () => FFFSType,
  FFmpeg: () => FFmpeg
});
var init_esm = __esm({
  "../frontend/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js"() {
    init_classes();
    init_types();
  }
});

// ../frontend/src/packages/media-engine/capability.ts
var cachedCapabilities = null;
function detectCapabilities() {
  if (cachedCapabilities) {
    return cachedCapabilities;
  }
  const isBrowser = typeof window !== "undefined";
  if (!isBrowser) {
    return {
      fsa_supported: false,
      opfs_supported: false,
      remux_supported: false,
      hls_supported: false
    };
  }
  const fsa_supported = typeof window.showSaveFilePicker === "function";
  const opfs_supported = typeof navigator !== "undefined" && typeof navigator.storage !== "undefined" && typeof navigator.storage.getDirectory === "function";
  const remux_supported = typeof ArrayBuffer !== "undefined" && typeof DataView !== "undefined";
  let hls_supported = false;
  if (typeof window.MediaSource !== "undefined") {
    hls_supported = window.MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
  }
  cachedCapabilities = {
    fsa_supported,
    opfs_supported,
    remux_supported,
    hls_supported
  };
  return cachedCapabilities;
}

// ../frontend/src/packages/media-engine/strategy.ts
function evaluateClientStrategy(manifest, targetFormatId, targetFormatType = "video", customCapabilities) {
  const caps = customCapabilities || detectCapabilities();
  const targetFid = String(targetFormatId).trim();
  const isProcessDefined = typeof process !== "undefined" && typeof process.env !== "undefined";
  const relayDisabled = isProcessDefined && false || typeof window !== "undefined" && !!window.__NEXUS_DISABLE_WORKER_RELAY;
  const hlsEnabled = isProcessDefined && true || typeof window !== "undefined" && !window.__NEXUS_BROWSER_HLS_DISABLED;
  const matchingProgressive = manifest.media.progressive.find(
    (p) => p.format_id === targetFid || p.id === targetFid
  );
  if (matchingProgressive) {
    const estSize = matchingProgressive.filesize || 0;
    if (matchingProgressive.relay_required) {
      if (relayDisabled && manifest.fallback.server_fallback_allowed) {
        return {
          strategy: "SERVER_FALLBACK",
          reason: "Worker relay disabled via feature flag; routing to server fallback",
          target_format_id: targetFid,
          progressive_stream: matchingProgressive,
          estimated_bytes: estSize
        };
      }
      return {
        strategy: "SIGNED_WORKER_RANGE",
        reason: "Progressive media stream requiring signed worker range relay",
        target_format_id: targetFid,
        progressive_stream: matchingProgressive,
        ticket_required: true,
        estimated_bytes: estSize
      };
    }
    if (matchingProgressive.range_supported && estSize > 10 * 1024 * 1024) {
      return {
        strategy: "DIRECT_RANGE",
        reason: "Progressive media stream with client range slicing",
        target_format_id: targetFid,
        progressive_stream: matchingProgressive,
        estimated_bytes: estSize
      };
    }
    return {
      strategy: "DIRECT_PROGRESSIVE",
      reason: "Progressive media stream with direct CDN delivery",
      target_format_id: targetFid,
      progressive_stream: matchingProgressive,
      estimated_bytes: estSize
    };
  }
  if (targetFormatType === "audio") {
    const matchingAudio = manifest.media.audio.find(
      (a) => a.format_id === targetFid || a.id === targetFid
    ) || manifest.media.audio[0];
    if (matchingAudio) {
      const estSize = matchingAudio.filesize || 0;
      if (matchingAudio.relay_required) {
        if (relayDisabled && manifest.fallback.server_fallback_allowed) {
          return {
            strategy: "SERVER_FALLBACK",
            reason: "Worker relay disabled via feature flag; routing to server fallback",
            target_format_id: matchingAudio.format_id,
            audio_stream: matchingAudio,
            estimated_bytes: estSize
          };
        }
        return {
          strategy: "SIGNED_WORKER_RANGE",
          reason: "Audio media stream requiring signed worker range relay",
          target_format_id: matchingAudio.format_id,
          audio_stream: matchingAudio,
          ticket_required: true,
          estimated_bytes: estSize
        };
      }
      return {
        strategy: matchingAudio.range_supported ? "DIRECT_RANGE" : "DIRECT_PROGRESSIVE",
        reason: "Audio-only direct media stream",
        target_format_id: matchingAudio.format_id,
        audio_stream: matchingAudio,
        estimated_bytes: estSize
      };
    }
  }
  const matchingVideo = manifest.media.video.find(
    (v) => v.format_id === targetFid || v.id === targetFid
  );
  if (matchingVideo) {
    const matchingAudio = manifest.media.audio[0];
    if (caps.remux_supported && matchingAudio) {
      const estSize = (matchingVideo.filesize || 0) + (matchingAudio.filesize || 0);
      const requiresRelay = !!(matchingVideo.relay_required || matchingAudio.relay_required);
      if (requiresRelay && relayDisabled && manifest.fallback.server_fallback_allowed) {
        return {
          strategy: "SERVER_FALLBACK",
          reason: "Worker relay disabled via feature flag; routing to server fallback",
          target_format_id: targetFid,
          video_stream: matchingVideo,
          audio_stream: matchingAudio,
          estimated_bytes: estSize
        };
      }
      return {
        strategy: requiresRelay ? "SIGNED_WORKER_RANGE" : "BROWSER_ADAPTIVE_MUX",
        reason: requiresRelay ? "Adaptive streams requiring signed worker range relay and in-browser multiplexing" : "Adaptive separate video and audio streams multiplexed in-browser",
        target_format_id: targetFid,
        video_stream: matchingVideo,
        audio_stream: matchingAudio,
        ticket_required: requiresRelay,
        estimated_bytes: estSize
      };
    } else if (manifest.fallback.server_fallback_allowed) {
      return {
        strategy: "SERVER_FALLBACK",
        reason: "Client remuxing unsupported; fallback to governed server runner",
        target_format_id: targetFid,
        video_stream: matchingVideo,
        audio_stream: matchingAudio,
        estimated_bytes: matchingVideo.filesize || 0
      };
    }
  }
  const hlsStreams = manifest.media.hls || [];
  const matchingHls = hlsStreams.find(
    (h) => h.format_id === targetFid || h.id === targetFid || targetFid === "hls" || targetFid === "m3u8"
  );
  if (matchingHls) {
    const estSize = matchingHls.filesize || 0;
    if (!hlsEnabled) {
      if (manifest.fallback.server_fallback_allowed) {
        return {
          strategy: "SERVER_FALLBACK",
          reason: "Browser HLS disabled via feature flag; routing to server fallback",
          target_format_id: targetFid,
          hls_stream: matchingHls,
          estimated_bytes: estSize
        };
      }
      return {
        strategy: "UNSUPPORTED",
        reason: "Browser HLS disabled via feature flag and server fallback not allowed",
        target_format_id: targetFid,
        estimated_bytes: 0
      };
    }
    if (!caps.hls_supported || !caps.remux_supported) {
      if (manifest.fallback.server_fallback_allowed) {
        return {
          strategy: "SERVER_FALLBACK",
          reason: "Client browser lacks HLS/remux capabilities; routing to server fallback",
          target_format_id: targetFid,
          hls_stream: matchingHls,
          estimated_bytes: estSize
        };
      }
      return {
        strategy: "UNSUPPORTED",
        reason: "Client browser lacks HLS/remux capabilities",
        target_format_id: targetFid,
        estimated_bytes: 0
      };
    }
    if (matchingHls.encryption && matchingHls.encryption.toUpperCase() !== "NONE" && matchingHls.encryption.toUpperCase() !== "AES-128") {
      if (manifest.fallback.server_fallback_allowed) {
        return {
          strategy: "SERVER_FALLBACK",
          reason: `Unsupported HLS encryption (${matchingHls.encryption}); routing to server fallback`,
          target_format_id: targetFid,
          hls_stream: matchingHls,
          estimated_bytes: estSize
        };
      }
      return {
        strategy: "UNSUPPORTED",
        reason: `Unsupported HLS encryption (${matchingHls.encryption})`,
        target_format_id: targetFid,
        estimated_bytes: 0
      };
    }
    const codecStr = (matchingHls.codec || "").toLowerCase();
    if (codecStr && !["h264", "avc", "mp4a", "aac"].some((c) => codecStr.includes(c))) {
      if (manifest.fallback.server_fallback_allowed) {
        return {
          strategy: "SERVER_FALLBACK",
          reason: `Unsupported HLS codec (${matchingHls.codec}); routing to server fallback`,
          target_format_id: targetFid,
          hls_stream: matchingHls,
          estimated_bytes: estSize
        };
      }
      return {
        strategy: "UNSUPPORTED",
        reason: `Unsupported HLS codec (${matchingHls.codec})`,
        target_format_id: targetFid,
        estimated_bytes: 0
      };
    }
    return {
      strategy: "BROWSER_HLS",
      reason: "Supported HLS stream selected for in-browser demuxing and remuxing",
      target_format_id: targetFid,
      hls_stream: matchingHls,
      ticket_required: !!matchingHls.relay_required,
      estimated_bytes: estSize
    };
  }
  if (manifest.fallback.server_fallback_allowed) {
    return {
      strategy: "SERVER_FALLBACK",
      reason: "No direct stream candidate matched; routed to server fallback",
      target_format_id: targetFid,
      estimated_bytes: 0
    };
  }
  return {
    strategy: "UNSUPPORTED",
    reason: `No viable execution strategy for format ${targetFid}`,
    target_format_id: targetFid,
    estimated_bytes: 0
  };
}

// ../frontend/src/packages/media-engine/fetcher.ts
function formatSpeed(bytesPerSec) {
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${Math.round(bytesPerSec / 1024)} KB/s`;
}
function formatEta(seconds) {
  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const remSecs = Math.ceil(seconds % 60);
  return `${mins}m ${remSecs}s`;
}
var FORBIDDEN_BROWSER_HEADERS = /* @__PURE__ */ new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
  "user-agent"
]);
function filterSafeBrowserHeaders(headers = {}) {
  const safe = {};
  for (const [key, val] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!FORBIDDEN_BROWSER_HEADERS.has(lower) && !lower.startsWith("sec-") && !lower.startsWith("proxy-")) {
      safe[key] = val;
    }
  }
  return safe;
}
async function fetchStreamWithRange(options) {
  const {
    url: url2,
    totalBytes: initialTotalBytes = 0,
    chunkSize = 1048576,
    // 1MB chunks
    headers = {},
    signal,
    onProgress,
    sink,
    stageName = "fetching",
    chunkTimeoutMs = 2e4
  } = options;
  const safeHeaders = filterSafeBrowserHeaders(headers);
  let downloadedBytes = 0;
  let totalBytes = initialTotalBytes;
  let startOffset = 0;
  const startTime = Date.now();
  let lastSpeedCalcTime = startTime;
  let lastSpeedBytes = 0;
  let currentSpeedBps = 0;
  function emitProgress(stage, currentDownloaded) {
    if (!onProgress) return;
    const now = Date.now();
    if (now - lastSpeedCalcTime >= 400 || currentDownloaded === totalBytes) {
      const timeDelta = Math.max((now - lastSpeedCalcTime) / 1e3, 0.05);
      const bytesDelta = currentDownloaded - lastSpeedBytes;
      currentSpeedBps = Math.round(bytesDelta / timeDelta);
      lastSpeedCalcTime = now;
      lastSpeedBytes = currentDownloaded;
    }
    const percent = totalBytes > 0 ? Math.min(Math.round(currentDownloaded / totalBytes * 100), 99) : 50;
    const remBytes = totalBytes > currentDownloaded ? totalBytes - currentDownloaded : 0;
    const etaSeconds = currentSpeedBps > 0 && remBytes > 0 ? remBytes / currentSpeedBps : void 0;
    onProgress({
      stage,
      progressPercent: currentDownloaded >= totalBytes && totalBytes > 0 ? 100 : percent,
      downloadedBytes: currentDownloaded,
      totalBytes: totalBytes > 0 ? totalBytes : currentDownloaded,
      speedBps: currentSpeedBps,
      speedFormatted: currentSpeedBps > 0 ? formatSpeed(currentSpeedBps) : void 0,
      etaSeconds,
      etaFormatted: etaSeconds !== void 0 ? formatEta(etaSeconds) : void 0
    });
  }
  if (totalBytes <= 0) {
    try {
      const probeRes = await fetch(url2, {
        method: "GET",
        headers: {
          ...safeHeaders,
          Range: "bytes=0-0"
        },
        signal
      });
      const contentRange = probeRes.headers.get("content-range");
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match) {
          totalBytes = parseInt(match[1], 10);
        }
      }
      if (!totalBytes) {
        const cl = probeRes.headers.get("content-length");
        if (cl) totalBytes = parseInt(cl, 10);
      }
    } catch {
    }
  }
  while (totalBytes <= 0 || startOffset < totalBytes) {
    if (signal?.aborted) {
      throw new Error("Download aborted by user");
    }
    const endOffset = totalBytes > 0 ? Math.min(startOffset + chunkSize - 1, totalBytes - 1) : startOffset + chunkSize - 1;
    let attempts = 0;
    let success = false;
    let chunkBytes = 0;
    while (!success && attempts < 4) {
      attempts++;
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), chunkTimeoutMs);
      const abortHandler = () => timeoutController.abort();
      if (signal) signal.addEventListener("abort", abortHandler, { once: true });
      try {
        const res = await fetch(url2, {
          method: "GET",
          headers: {
            ...safeHeaders,
            Range: `bytes=${startOffset}-${endOffset}`
          },
          signal: timeoutController.signal
        });
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener("abort", abortHandler);
        if (res.status === 200 && startOffset > 0) {
          throw new Error(`Server ignored Range header: returned HTTP 200 for offset ${startOffset}`);
        }
        if (res.status === 200 && startOffset === 0) {
          const cl = res.headers.get("content-length");
          if (cl) totalBytes = parseInt(cl, 10);
          if (!res.body) {
            const buf = await res.arrayBuffer();
            const u82 = new Uint8Array(buf);
            await sink.write(u82);
            downloadedBytes += u82.byteLength;
            emitProgress(stageName, downloadedBytes);
            return downloadedBytes;
          }
          const reader = res.body.getReader();
          while (true) {
            if (signal?.aborted) {
              await reader.cancel();
              throw new Error("Download aborted by user");
            }
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              await sink.write(value);
              downloadedBytes += value.byteLength;
              emitProgress(stageName, downloadedBytes);
            }
          }
          return downloadedBytes;
        }
        if (res.status !== 206) {
          throw new Error(`HTTP range request failed with status ${res.status}`);
        }
        const cr = res.headers.get("content-range");
        if (cr) {
          const rangeMatch = cr.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
          if (rangeMatch) {
            const returnedStart = parseInt(rangeMatch[1], 10);
            if (returnedStart !== startOffset) {
              throw new Error(`Content-Range offset mismatch: expected ${startOffset}, got ${returnedStart}`);
            }
            if (totalBytes <= 0 && rangeMatch[3] !== "*") {
              totalBytes = parseInt(rangeMatch[3], 10);
            }
          }
        }
        if (res.body) {
          const reader = res.body.getReader();
          while (true) {
            if (signal?.aborted) {
              await reader.cancel();
              throw new Error("Download aborted by user");
            }
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.byteLength > 0) {
              await sink.write(value);
              chunkBytes += value.byteLength;
              downloadedBytes += value.byteLength;
              startOffset += value.byteLength;
              emitProgress(stageName, downloadedBytes);
            }
          }
        } else {
          const arrayBuffer = await res.arrayBuffer();
          const uint8Chunk = new Uint8Array(arrayBuffer);
          chunkBytes = uint8Chunk.byteLength;
          if (chunkBytes > 0) {
            await sink.write(uint8Chunk);
            downloadedBytes += chunkBytes;
            startOffset += chunkBytes;
            emitProgress(stageName, downloadedBytes);
          }
        }
        if (chunkBytes === 0) {
          success = true;
          startOffset = totalBytes > 0 ? totalBytes : startOffset;
          break;
        }
        success = true;
      } catch (err) {
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener("abort", abortHandler);
        if (signal?.aborted) throw err;
        if (attempts >= 4) {
          throw new Error(`Failed to fetch chunk at offset ${startOffset} after 4 attempts: ${err.message}`);
        }
        const delay = Math.pow(2, attempts) * 150 + Math.random() * 100;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (chunkBytes === 0) {
      break;
    }
  }
  return downloadedBytes;
}

// ../frontend/src/packages/media-engine/sink/sink.ts
var FileSystemAccessSink = class {
  constructor() {
    this.writable = null;
    this.filename = "";
    this.writeChain = Promise.resolve();
    this.bytesWritten = 0;
    this.writeError = null;
  }
  async open(filename, expectedSize, mimeType) {
    this.filename = filename;
    this.bytesWritten = 0;
    this.writeError = null;
    this.writeChain = Promise.resolve();
    if (typeof window === "undefined" || !window.showSaveFilePicker) {
      throw new Error("File System Access API is not supported in this browser");
    }
    const ext = filename.split(".").pop() || "mp4";
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: "Video file",
          accept: {
            [mimeType || (ext === "webm" ? "video/webm" : "video/mp4")]: [`.${ext}`]
          }
        }
      ]
    });
    this.writable = await handle.createWritable();
  }
  async write(chunk, position) {
    if (!this.writable) {
      throw new Error("Sink is not open for writing");
    }
    if (this.writeError) {
      throw this.writeError;
    }
    this.writeChain = this.writeChain.then(async () => {
      if (!this.writable) return;
      try {
        if (typeof position === "number") {
          await this.writable.write({
            type: "write",
            data: chunk,
            position
          });
        } else {
          await this.writable.write(chunk);
        }
        this.bytesWritten += chunk.byteLength;
      } catch (err) {
        this.writeError = err;
        throw err;
      }
    });
    return this.writeChain;
  }
  async close() {
    await this.writeChain;
    if (this.writeError) {
      throw this.writeError;
    }
    if (this.writable) {
      await this.writable.close();
      this.writable = null;
    }
    if (this.bytesWritten === 0) {
      throw new Error("File System write failed: 0 bytes written to destination file");
    }
  }
  async abort() {
    this.writeError = null;
    if (this.writable) {
      try {
        await this.writable.abort();
      } catch {
      }
      this.writable = null;
    }
  }
};
var OPFSSink = class {
  constructor() {
    this.fileHandle = null;
    this.writable = null;
    this.filename = "";
    this.writeChain = Promise.resolve();
    this.bytesWritten = 0;
    this.writeError = null;
  }
  async open(filename) {
    this.filename = filename;
    this.bytesWritten = 0;
    this.writeError = null;
    this.writeChain = Promise.resolve();
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
      throw new Error("OPFS is not supported in this browser");
    }
    const root = await navigator.storage.getDirectory();
    this.fileHandle = await root.getFileHandle(filename, { create: true });
    this.writable = await this.fileHandle.createWritable();
  }
  async write(chunk, position) {
    if (!this.writable) {
      throw new Error("Sink is not open for writing");
    }
    if (this.writeError) {
      throw this.writeError;
    }
    this.writeChain = this.writeChain.then(async () => {
      if (!this.writable) return;
      try {
        if (typeof position === "number") {
          await this.writable.write({
            type: "write",
            data: chunk,
            position
          });
        } else {
          await this.writable.write(chunk);
        }
        this.bytesWritten += chunk.byteLength;
      } catch (err) {
        this.writeError = err;
        throw err;
      }
    });
    return this.writeChain;
  }
  async close() {
    await this.writeChain;
    if (this.writeError) {
      throw this.writeError;
    }
    if (this.writable) {
      await this.writable.close();
      this.writable = null;
    }
    if (this.bytesWritten === 0) {
      throw new Error("OPFS write failed: 0 bytes written");
    }
    if (this.fileHandle) {
      const file = await this.fileHandle.getFile();
      return file;
    }
    throw new Error("File handle not found");
  }
  async abort() {
    this.writeError = null;
    if (this.writable) {
      try {
        await this.writable.abort();
      } catch {
      }
      this.writable = null;
    }
  }
};
var BlobSink = class {
  constructor() {
    this.chunks = [];
    this.mimeType = "video/mp4";
    this.totalBytes = 0;
  }
  async open(filename, expectedSize, mimeType) {
    this.chunks = [];
    this.totalBytes = 0;
    this.mimeType = mimeType || "video/mp4";
  }
  async write(chunk, position) {
    this.chunks.push(chunk);
    this.totalBytes += chunk.byteLength;
  }
  async close() {
    if (this.totalBytes === 0) {
      throw new Error("BlobSink write failed: 0 bytes collected");
    }
    const blob = new Blob(this.chunks, { type: this.mimeType });
    this.chunks = [];
    return blob;
  }
  async abort() {
    this.chunks = [];
    this.totalBytes = 0;
  }
};

// ../frontend/node_modules/mp4box/dist/mp4box.all.mjs
var mp4box_all_exports = {};
__export(mp4box_all_exports, {
  AudioSampleEntry: () => AudioSampleEntry,
  Box: () => Box,
  BoxParser: () => BoxParser,
  DIFF_BOXES_PROP_NAMES: () => DIFF_BOXES_PROP_NAMES,
  DIFF_PRIMITIVE_ARRAY_PROP_NAMES: () => DIFF_PRIMITIVE_ARRAY_PROP_NAMES,
  DataStream: () => DataStream,
  Descriptor: () => Descriptor,
  ES_Descriptor: () => ES_Descriptor,
  Endianness: () => Endianness,
  FullBox: () => FullBox,
  HintSampleEntry: () => HintSampleEntry,
  ISOFile: () => ISOFile,
  Log: () => Log,
  MP4BoxBuffer: () => MP4BoxBuffer,
  MPEG4DescriptorParser: () => MPEG4DescriptorParser,
  MetadataSampleEntry: () => MetadataSampleEntry,
  MultiBufferStream: () => MultiBufferStream,
  SampleEntry: () => SampleEntry,
  SampleGroupEntry: () => SampleGroupEntry,
  SampleGroupInfo: () => SampleGroupInfo,
  SingleItemTypeReferenceBox: () => SingleItemTypeReferenceBox,
  SingleItemTypeReferenceBoxLarge: () => SingleItemTypeReferenceBoxLarge,
  SubtitleSampleEntry: () => SubtitleSampleEntry,
  SystemSampleEntry: () => SystemSampleEntry,
  TX3GParser: () => TX3GParser,
  TextSampleEntry: () => TextSampleEntry,
  Textin4Parser: () => Textin4Parser,
  TrackGroupTypeBox: () => TrackGroupTypeBox,
  TrackReferenceTypeBox: () => TrackReferenceTypeBox,
  VTTin4Parser: () => VTTin4Parser,
  VisualSampleEntry: () => VisualSampleEntry,
  XMLSubtitlein4Parser: () => XMLSubtitlein4Parser,
  boxEqual: () => boxEqual,
  boxEqualFields: () => boxEqualFields,
  createFile: () => createFile
});

// ../frontend/node_modules/mp4box/dist/rolldown-runtime-w6R9maHv.mjs
var __defProp2 = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
  let target = {};
  for (var name in all) {
    __defProp2(target, name, {
      get: all[name],
      enumerable: true
    });
  }
  if (!no_symbols) {
    __defProp2(target, Symbol.toStringTag, { value: "Module" });
  }
  return target;
};

// ../frontend/node_modules/mp4box/dist/styp-9TIZZDLN.mjs
var MAX_SIZE = Math.pow(2, 32);
var MAX_UINT32 = Math.pow(2, 32) - 1;
var TFHD_FLAG_DEFAULT_BASE_IS_MOOF = 131072;
var TRUN_FLAGS_FLAGS = 1024;
var TRUN_FLAGS_CTS_OFFSET = 2048;
var MP4BoxBuffer = class MP4BoxBuffer2 extends ArrayBuffer {
  constructor(byteLength) {
    super(byteLength);
    this.fileStart = 0;
    this.usedBytes = 0;
  }
  static fromArrayBuffer(buffer, fileStart) {
    const mp4BoxBuffer = new MP4BoxBuffer2(buffer.byteLength);
    new Uint8Array(mp4BoxBuffer).set(new Uint8Array(buffer));
    mp4BoxBuffer.fileStart = fileStart;
    return mp4BoxBuffer;
  }
};
var Endianness = /* @__PURE__ */ (function(Endianness2) {
  Endianness2[Endianness2["BIG_ENDIAN"] = 1] = "BIG_ENDIAN";
  Endianness2[Endianness2["LITTLE_ENDIAN"] = 2] = "LITTLE_ENDIAN";
  return Endianness2;
})({});
var DataStream = class DataStream2 {
  static {
    this.ENDIANNESS = new Int8Array(new Int16Array([1]).buffer)[0] > 0 ? 2 : 1;
  }
  /**
  * DataStream reads scalars, arrays and structs of data from an ArrayBuffer.
  * It's like a file-like DataView on steroids.
  *
  * @param arrayBuffer ArrayBuffer to read from.
  * @param byteOffset Offset from arrayBuffer beginning for the DataStream.
  * @param endianness Endianness of the DataStream (default: BIG_ENDIAN).
  */
  constructor(arrayBuffer, byteOffset, endianness) {
    this._byteLength = 0;
    this.failurePosition = 0;
    this._dynamicSize = 1;
    this._byteOffset = byteOffset || 0;
    if (arrayBuffer instanceof ArrayBuffer) this.buffer = MP4BoxBuffer.fromArrayBuffer(arrayBuffer, 0);
    else if (arrayBuffer instanceof DataView) {
      this.dataView = arrayBuffer;
      if (byteOffset) this._byteOffset += byteOffset;
    } else this.buffer = new MP4BoxBuffer(arrayBuffer || 0);
    this.position = 0;
    this.endianness = endianness ? endianness : 1;
  }
  getPosition() {
    return this.position;
  }
  /**
  * Internal function to resize the DataStream buffer when required.
  * @param extra Number of bytes to add to the buffer allocation.
  */
  _realloc(extra) {
    if (!this._dynamicSize) return;
    const req = this._byteOffset + this.position + extra;
    let blen = this._buffer.byteLength;
    if (req <= blen) {
      if (req > this._byteLength) this._byteLength = req;
      return;
    }
    if (blen < 1) blen = 1;
    while (req > blen) blen *= 2;
    const buf = new MP4BoxBuffer(blen);
    const src = new Uint8Array(this._buffer);
    new Uint8Array(buf, 0, src.length).set(src);
    this.buffer = buf;
    this._byteLength = req;
  }
  /**
  * Internal function to trim the DataStream buffer when required.
  * Used for stripping out the extra bytes from the backing buffer when
  * the virtual byteLength is smaller than the buffer byteLength (happens after
  * growing the buffer with writes and not filling the extra space completely).
  */
  _trimAlloc() {
    if (this._byteLength === this._buffer.byteLength) return;
    const buf = new MP4BoxBuffer(this._byteLength);
    const dst = new Uint8Array(buf);
    const src = new Uint8Array(this._buffer, 0, dst.length);
    dst.set(src);
    this.buffer = buf;
  }
  /**
  * Returns the byte length of the DataStream object.
  * @type {number}
  */
  get byteLength() {
    return this._byteLength - this._byteOffset;
  }
  /**
  * Set/get the backing ArrayBuffer of the DataStream object.
  * The setter updates the DataView to point to the new buffer.
  * @type {Object}
  */
  get buffer() {
    this._trimAlloc();
    return this._buffer;
  }
  set buffer(value) {
    this._buffer = value;
    this._dataView = new DataView(value, this._byteOffset);
    this._byteLength = value.byteLength;
  }
  /**
  * Set/get the byteOffset of the DataStream object.
  * The setter updates the DataView to point to the new byteOffset.
  * @type {number}
  */
  get byteOffset() {
    return this._byteOffset;
  }
  set byteOffset(value) {
    this._byteOffset = value;
    this._dataView = new DataView(this._buffer, this._byteOffset);
    this._byteLength = this._buffer.byteLength;
  }
  /**
  * Set/get the byteOffset of the DataStream object.
  * The setter updates the DataView to point to the new byteOffset.
  * @type {number}
  */
  get dataView() {
    return this._dataView;
  }
  set dataView(value) {
    this._byteOffset = value.byteOffset;
    this._buffer = MP4BoxBuffer.fromArrayBuffer(value.buffer, 0);
    this._dataView = new DataView(this._buffer, this._byteOffset);
    this._byteLength = this._byteOffset + value.byteLength;
  }
  /**
  *   Sets the DataStream read/write position to given position.
  *   Clamps between 0 and DataStream length.
  *
  *   @param pos Position to seek to.
  *   @return
  */
  seek(pos) {
    const npos = Math.max(0, Math.min(this.byteLength, pos));
    this.position = isNaN(npos) || !isFinite(npos) ? 0 : npos;
  }
  /**
  * Returns true if the DataStream seek pointer is at the end of buffer and
  * there's no more data to read.
  *
  * @return True if the seek pointer is at the end of the buffer.
  */
  isEof() {
    return this.position >= this._byteLength;
  }
  #isTupleType(type) {
    return Array.isArray(type) && type.length === 3 && type[0] === "[]";
  }
  /**
  * Maps a Uint8Array into the DataStream buffer.
  *
  * Nice for quickly reading in data.
  *
  * @param length Number of elements to map.
  * @param e Endianness of the data to read.
  * @return Uint8Array to the DataStream backing buffer.
  */
  mapUint8Array(length) {
    this._realloc(length * 1);
    const arr = new Uint8Array(this._buffer, this.byteOffset + this.position, length);
    this.position += length * 1;
    return arr;
  }
  /**
  * Reads an Int32Array of desired length and endianness from the DataStream.
  *
  * @param length Number of elements to map.
  * @param endianness Endianness of the data to read.
  * @return The read Int32Array.
  */
  readInt32Array(length, endianness) {
    length = length === void 0 ? this.byteLength - this.position / 4 : length;
    const arr = new Int32Array(length);
    DataStream2.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
    DataStream2.arrayToNative(arr, endianness ?? this.endianness);
    this.position += arr.byteLength;
    return arr;
  }
  /**
  * Reads an Int16Array of desired length and endianness from the DataStream.
  *
  * @param length Number of elements to map.
  * @param endianness Endianness of the data to read.
  * @return The read Int16Array.
  */
  readInt16Array(length, endianness) {
    length = length === void 0 ? this.byteLength - this.position / 2 : length;
    const arr = new Int16Array(length);
    DataStream2.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
    DataStream2.arrayToNative(arr, endianness ?? this.endianness);
    this.position += arr.byteLength;
    return arr;
  }
  /**
  * Reads an Int8Array of desired length from the DataStream.
  *
  * @param length Number of elements to map.
  * @param e Endianness of the data to read.
  * @return The read Int8Array.
  */
  readInt8Array(length) {
    length = length === void 0 ? this.byteLength - this.position : length;
    const arr = new Int8Array(length);
    DataStream2.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
    this.position += arr.byteLength;
    return arr;
  }
  /**
  * Reads a Uint32Array of desired length and endianness from the DataStream.
  *
  *  @param length Number of elements to map.
  *  @param endianness Endianness of the data to read.
  *  @return The read Uint32Array.
  */
  readUint32Array(length, endianness) {
    length = length === void 0 ? this.byteLength - this.position / 4 : length;
    const arr = new Uint32Array(length);
    DataStream2.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
    DataStream2.arrayToNative(arr, endianness ?? this.endianness);
    this.position += arr.byteLength;
    return arr;
  }
  /**
  * Reads a Uint16Array of desired length and endianness from the DataStream.
  *
  * @param length Number of elements to map.
  * @param endianness Endianness of the data to read.
  * @return The read Uint16Array.
  */
  readUint16Array(length, endianness) {
    length = length === void 0 ? this.byteLength - this.position / 2 : length;
    const arr = new Uint16Array(length);
    DataStream2.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
    DataStream2.arrayToNative(arr, endianness ?? this.endianness);
    this.position += arr.byteLength;
    return arr;
  }
  /**
  * Reads a Uint8Array of desired length from the DataStream.
  *
  * @param length Number of elements to map.
  * @param e Endianness of the data to read.
  * @return The read Uint8Array.
  */
  readUint8Array(length) {
    length = length === void 0 ? this.byteLength - this.position : length;
    const arr = new Uint8Array(length);
    DataStream2.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
    this.position += arr.byteLength;
    return arr;
  }
  /**
  * Reads a Float64Array of desired length and endianness from the DataStream.
  *
  * @param length Number of elements to map.
  * @param endianness Endianness of the data to read.
  * @return The read Float64Array.
  */
  readFloat64Array(length, endianness) {
    length = length === void 0 ? this.byteLength - this.position / 8 : length;
    const arr = new Float64Array(length);
    DataStream2.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
    DataStream2.arrayToNative(arr, endianness ?? this.endianness);
    this.position += arr.byteLength;
    return arr;
  }
  /**
  * Reads a Float32Array of desired length and endianness from the DataStream.
  *
  * @param length Number of elements to map.
  * @param endianness Endianness of the data to read.
  * @return The read Float32Array.
  */
  readFloat32Array(length, endianness) {
    length = length === void 0 ? this.byteLength - this.position / 4 : length;
    const arr = new Float32Array(length);
    DataStream2.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
    DataStream2.arrayToNative(arr, endianness ?? this.endianness);
    this.position += arr.byteLength;
    return arr;
  }
  /**
  * Reads a 32-bit int from the DataStream with the desired endianness.
  *
  * @param endianness Endianness of the number.
  * @return The read number.
  */
  readInt32(endianness) {
    const v = this._dataView.getInt32(this.position, (endianness ?? this.endianness) === 2);
    this.position += 4;
    return v;
  }
  /**
  * Reads a 16-bit int from the DataStream with the desired endianness.
  *
  * @param endianness Endianness of the number.
  * @return The read number.
  */
  readInt16(endianness) {
    const v = this._dataView.getInt16(this.position, (endianness ?? this.endianness) === 2);
    this.position += 2;
    return v;
  }
  /**
  * Reads an 8-bit int from the DataStream.
  *
  * @return The read number.
  */
  readInt8() {
    const v = this._dataView.getInt8(this.position);
    this.position += 1;
    return v;
  }
  /**
  * Reads a 32-bit unsigned int from the DataStream with the desired endianness.
  *
  * @param endianness Endianness of the number.
  * @return The read number.
  */
  readUint32(endianness) {
    const v = this._dataView.getUint32(this.position, (endianness ?? this.endianness) === 2);
    this.position += 4;
    return v;
  }
  /**
  * Reads a 16-bit unsigned int from the DataStream with the desired endianness.
  *
  * @param endianness Endianness of the number.
  * @return The read number.
  */
  readUint16(endianness) {
    const v = this._dataView.getUint16(this.position, (endianness ?? this.endianness) === 2);
    this.position += 2;
    return v;
  }
  /**
  * Reads an 8-bit unsigned int from the DataStream.
  *
  * @return The read number.
  */
  readUint8() {
    const v = this._dataView.getUint8(this.position);
    this.position += 1;
    return v;
  }
  /**
  * Reads a 32-bit float from the DataStream with the desired endianness.
  *
  * @param endianness Endianness of the number.
  * @return The read number.
  */
  readFloat32(endianness) {
    const value = this._dataView.getFloat32(this.position, (endianness ?? this.endianness) === 2);
    this.position += 4;
    return value;
  }
  /**
  * Reads a 64-bit float from the DataStream with the desired endianness.
  *
  * @param endianness Endianness of the number.
  * @return The read number.
  */
  readFloat64(endianness) {
    const value = this._dataView.getFloat64(this.position, (endianness ?? this.endianness) === 2);
    this.position += 8;
    return value;
  }
  /**
  * Copies byteLength bytes from the src buffer at srcOffset to the
  * dst buffer at dstOffset.
  *
  * @param dst Destination ArrayBuffer to write to.
  * @param dstOffset Offset to the destination ArrayBuffer.
  * @param src Source ArrayBuffer to read from.
  * @param srcOffset Offset to the source ArrayBuffer.
  * @param byteLength Number of bytes to copy.
  */
  static memcpy(dst, dstOffset, src, srcOffset, byteLength) {
    const dstU8 = new Uint8Array(dst, dstOffset, byteLength);
    const srcU8 = new Uint8Array(src, srcOffset, byteLength);
    dstU8.set(srcU8);
  }
  /**
  * Converts array to native endianness in-place.
  *
  * @param typedArray Typed array to convert.
  * @param endianness True if the data in the array is
  *                                      little-endian. Set false for big-endian.
  * @return The converted typed array.
  */
  static arrayToNative(typedArray, endianness) {
    if (endianness === DataStream2.ENDIANNESS) return typedArray;
    else return this.flipArrayEndianness(typedArray);
  }
  /**
  * Converts native endianness array to desired endianness in-place.
  *
  * @param typedArray Typed array to convert.
  * @param littleEndian True if the converted array should be
  *                               little-endian. Set false for big-endian.
  * @return The converted typed array.
  */
  static nativeToEndian(typedArray, littleEndian) {
    if (littleEndian && DataStream2.ENDIANNESS === 2) return typedArray;
    else return this.flipArrayEndianness(typedArray);
  }
  /**
  * Flips typed array endianness in-place.
  *
  * @param typedArray Typed array to flip.
  * @return The converted typed array.
  */
  static flipArrayEndianness(typedArray) {
    const u82 = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    for (let i = 0; i < typedArray.byteLength; i += typedArray.BYTES_PER_ELEMENT) for (let j = i + typedArray.BYTES_PER_ELEMENT - 1, k = i; j > k; j--, k++) {
      const tmp = u82[k];
      u82[k] = u82[j];
      u82[j] = tmp;
    }
    return typedArray;
  }
  /**
  * Read a string of desired length and encoding from the DataStream.
  *
  * @param length The length of the string to read in bytes.
  * @param encoding The encoding of the string data in the DataStream.
  *                           Defaults to ASCII.
  * @return The read string.
  */
  readString(length, encoding) {
    if (encoding === void 0 || encoding === "ASCII") return fromCharCodeUint8(this.mapUint8Array(length === void 0 ? this.byteLength - this.position : length));
    else return new TextDecoder(encoding).decode(this.mapUint8Array(length));
  }
  /**
  * Read null-terminated string of desired length from the DataStream. Truncates
  * the returned string so that the null byte is not a part of it.
  *
  * @param length The length of the string to read.
  * @return The read string.
  */
  readCString(length) {
    let i = 0;
    const blen = this.byteLength - this.position;
    const u82 = new Uint8Array(this._buffer, this._byteOffset + this.position);
    const len = length !== void 0 ? Math.min(length, blen) : blen;
    for (; i < len && u82[i] !== 0; i++) ;
    const s = fromCharCodeUint8(this.mapUint8Array(i));
    if (length !== void 0) this.position += len - i;
    else if (i !== blen) this.position += 1;
    return s;
  }
  readInt64() {
    return this.readInt32() * MAX_SIZE + this.readUint32();
  }
  readUint64() {
    return this.readUint32() * MAX_SIZE + this.readUint32();
  }
  readUint24() {
    return (this.readUint8() << 16) + (this.readUint8() << 8) + this.readUint8();
  }
  /**
  * Saves the DataStream contents to the given filename.
  * Uses Chrome's anchor download property to initiate download.
  *
  * @param filename Filename to save as.
  * @return
  * @bundle DataStream-write.js
  */
  save(filename) {
    const blob = new Blob([this.buffer]);
    if (typeof window !== "undefined" && typeof document !== "undefined") if (window.URL && URL.createObjectURL) {
      const url2 = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      document.body.appendChild(a);
      a.setAttribute("href", url2);
      a.setAttribute("download", filename);
      a.setAttribute("target", "_self");
      a.click();
      window.URL.revokeObjectURL(url2);
      document.body.removeChild(a);
    } else throw new Error("DataStream.save: Can't create object URL.");
    return blob;
  }
  /** @bundle DataStream-write.js */
  get dynamicSize() {
    return this._dynamicSize;
  }
  /** @bundle DataStream-write.js */
  set dynamicSize(v) {
    if (!v) this._trimAlloc();
    this._dynamicSize = v;
  }
  /**
  * Internal function to trim the DataStream buffer when required.
  * Used for stripping out the first bytes when not needed anymore.
  *
  * @return
  * @bundle DataStream-write.js
  */
  shift(offset) {
    const buf = new MP4BoxBuffer(this._byteLength - offset);
    const dst = new Uint8Array(buf);
    const src = new Uint8Array(this._buffer, offset, dst.length);
    dst.set(src);
    this.buffer = buf;
    this.position -= offset;
  }
  /**
  * Writes an Int32Array of specified endianness to the DataStream.
  *
  * @param array The array to write.
  * @param endianness Endianness of the data to write.
  * @bundle DataStream-write.js
  */
  writeInt32Array(array, endianness) {
    this._realloc(array.length * 4);
    if (array instanceof Int32Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
      DataStream2.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
      this.mapInt32Array(array.length, endianness);
    } else for (let i = 0; i < array.length; i++) this.writeInt32(array[i], endianness);
  }
  /**
  * Writes an Int16Array of specified endianness to the DataStream.
  *
  * @param array The array to write.
  * @param endianness Endianness of the data to write.
  * @bundle DataStream-write.js
  */
  writeInt16Array(array, endianness) {
    this._realloc(array.length * 2);
    if (array instanceof Int16Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
      DataStream2.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
      this.mapInt16Array(array.length, endianness);
    } else for (let i = 0; i < array.length; i++) this.writeInt16(array[i], endianness);
  }
  /**
  * Writes an Int8Array to the DataStream.
  *
  * @param array The array to write.
  * @bundle DataStream-write.js
  */
  writeInt8Array(array) {
    this._realloc(array.length * 1);
    if (array instanceof Int8Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
      DataStream2.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
      this.mapInt8Array(array.length);
    } else for (let i = 0; i < array.length; i++) this.writeInt8(array[i]);
  }
  /**
  * Writes a Uint32Array of specified endianness to the DataStream.
  *
  * @param array The array to write.
  * @param endianness Endianness of the data to write.
  * @bundle DataStream-write.js
  */
  writeUint32Array(array, endianness) {
    this._realloc(array.length * 4);
    if (array instanceof Uint32Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
      DataStream2.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
      this.mapUint32Array(array.length, endianness);
    } else for (let i = 0; i < array.length; i++) this.writeUint32(array[i], endianness);
  }
  /**
  * Writes a Uint16Array of specified endianness to the DataStream.
  *
  * @param array The array to write.
  * @param endianness Endianness of the data to write.
  * @bundle DataStream-write.js
  */
  writeUint16Array(array, endianness) {
    this._realloc(array.length * 2);
    if (array instanceof Uint16Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
      DataStream2.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
      this.mapUint16Array(array.length, endianness);
    } else for (let i = 0; i < array.length; i++) this.writeUint16(array[i], endianness);
  }
  /**
  * Writes a Uint8Array to the DataStream.
  *
  * @param array The array to write.
  * @bundle DataStream-write.js
  */
  writeUint8Array(array) {
    this._realloc(array.length * 1);
    if (array instanceof Uint8Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
      DataStream2.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
      this.mapUint8Array(array.length);
    } else for (let i = 0; i < array.length; i++) this.writeUint8(array[i]);
  }
  /**
  * Writes a Float64Array of specified endianness to the DataStream.
  *
  * @param array The array to write.
  * @param endianness Endianness of the data to write.
  * @bundle DataStream-write.js
  */
  writeFloat64Array(array, endianness) {
    this._realloc(array.length * 8);
    if (array instanceof Float64Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
      DataStream2.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
      this.mapFloat64Array(array.length, endianness);
    } else for (let i = 0; i < array.length; i++) this.writeFloat64(array[i], endianness);
  }
  /**
  * Writes a Float32Array of specified endianness to the DataStream.
  *
  * @param array The array to write.
  * @param endianness Endianness of the data to write.
  * @bundle DataStream-write.js
  */
  writeFloat32Array(array, endianness) {
    this._realloc(array.length * 4);
    if (array instanceof Float32Array && this.byteOffset + this.position % array.BYTES_PER_ELEMENT === 0) {
      DataStream2.memcpy(this._buffer, this.byteOffset + this.position, array.buffer, 0, array.byteLength);
      this.mapFloat32Array(array.length, endianness);
    } else for (let i = 0; i < array.length; i++) this.writeFloat32(array[i], endianness);
  }
  /**
  * Writes a 64-bit int to the DataStream with the desired endianness.
  *
  * @param value Number to write.
  * @param endianness Endianness of the number.
  * @bundle DataStream-write.js
  */
  writeInt64(value, endianness) {
    this._realloc(8);
    this._dataView.setBigInt64(this.position, BigInt(value), (endianness ?? this.endianness) === 2);
    this.position += 8;
  }
  /**
  * Writes a 32-bit int to the DataStream with the desired endianness.
  *
  * @param value Number to write.
  * @param endianness Endianness of the number.
  * @bundle DataStream-write.js
  */
  writeInt32(value, endianness) {
    this._realloc(4);
    this._dataView.setInt32(this.position, value, (endianness ?? this.endianness) === 2);
    this.position += 4;
  }
  /**
  * Writes a 16-bit int to the DataStream with the desired endianness.
  *
  * @param value Number to write.
  * @param endianness Endianness of the number.
  * @bundle DataStream-write.js
  */
  writeInt16(value, endianness) {
    this._realloc(2);
    this._dataView.setInt16(this.position, value, (endianness ?? this.endianness) === 2);
    this.position += 2;
  }
  /**
  * Writes an 8-bit int to the DataStream.
  *
  * @param value Number to write.
  * @bundle DataStream-write.js
  */
  writeInt8(value) {
    this._realloc(1);
    this._dataView.setInt8(this.position, value);
    this.position += 1;
  }
  /**
  * Writes a 32-bit unsigned int to the DataStream with the desired endianness.
  *
  * @param value Number to write.
  * @param endianness Endianness of the number.
  * @bundle DataStream-write.js
  */
  writeUint32(value, endianness) {
    this._realloc(4);
    this._dataView.setUint32(this.position, value, (endianness ?? this.endianness) === 2);
    this.position += 4;
  }
  /**
  * Writes a 16-bit unsigned int to the DataStream with the desired endianness.
  *
  * @param value Number to write.
  * @param endianness Endianness of the number.
  * @bundle DataStream-write.js
  */
  writeUint16(value, endianness) {
    this._realloc(2);
    this._dataView.setUint16(this.position, value, (endianness ?? this.endianness) === 2);
    this.position += 2;
  }
  /**
  * Writes an 8-bit unsigned  int to the DataStream.
  *
  * @param value Number to write.
  * @bundle DataStream-write.js
  */
  writeUint8(value) {
    this._realloc(1);
    this._dataView.setUint8(this.position, value);
    this.position += 1;
  }
  /**
  * Writes a 32-bit float to the DataStream with the desired endianness.
  *
  * @param value Number to write.
  * @param endianness Endianness of the number.
  * @bundle DataStream-write.js
  */
  writeFloat32(value, endianness) {
    this._realloc(4);
    this._dataView.setFloat32(this.position, value, (endianness ?? this.endianness) === 2);
    this.position += 4;
  }
  /**
  * Writes a 64-bit float to the DataStream with the desired endianness.
  *
  * @param value Number to write.
  * @param endianness Endianness of the number.
  * @bundle DataStream-write.js
  */
  writeFloat64(value, endianness) {
    this._realloc(8);
    this._dataView.setFloat64(this.position, value, (endianness ?? this.endianness) === 2);
    this.position += 8;
  }
  /**
  * Write a UCS-2 string of desired endianness to the DataStream. The
  * lengthOverride argument lets you define the number of characters to write.
  * If the string is shorter than lengthOverride, the extra space is padded with
  * zeroes.
  *
  * @param value The string to write.
  * @param endianness The endianness to use for the written string data.
  * @param lengthOverride The number of characters to write.
  * @bundle DataStream-write.js
  */
  writeUCS2String(value, endianness, lengthOverride) {
    if (lengthOverride === void 0) lengthOverride = value.length;
    let i;
    for (i = 0; i < value.length && i < lengthOverride; i++) this.writeUint16(value.charCodeAt(i), endianness);
    for (; i < lengthOverride; i++) this.writeUint16(0);
  }
  /**
  * Writes a string of desired length and encoding to the DataStream.
  *
  * @param value The string to write.
  * @param encoding The encoding for the written string data.
  *                           Defaults to ASCII.
  * @param length The number of characters to write.
  * @bundle DataStream-write.js
  */
  writeString(value, encoding, length) {
    let i = 0;
    if (encoding === void 0 || encoding === "ASCII") if (length !== void 0) {
      const len = Math.min(value.length, length);
      for (i = 0; i < len; i++) this.writeUint8(value.charCodeAt(i));
      for (; i < length; i++) this.writeUint8(0);
    } else for (i = 0; i < value.length; i++) this.writeUint8(value.charCodeAt(i));
    else this.writeUint8Array(new TextEncoder(encoding).encode(value.substring(0, length)));
  }
  /**
  * Writes a null-terminated string to DataStream and zero-pads it to length
  * bytes. If length is not given, writes the string followed by a zero.
  * If string is longer than length, the written part of the string does not have
  * a trailing zero.
  *
  * @param value The string to write.
  * @param length The number of characters to write.
  * @bundle DataStream-write.js
  */
  writeCString(value, length) {
    let i = 0;
    if (length !== void 0) {
      const len = Math.min(value.length, length);
      for (i = 0; i < len; i++) this.writeUint8(value.charCodeAt(i));
      for (; i < length; i++) this.writeUint8(0);
    } else {
      for (i = 0; i < value.length; i++) this.writeUint8(value.charCodeAt(i));
      this.writeUint8(0);
    }
  }
  /**
  * Writes a struct to the DataStream. Takes a structDefinition that gives the
  * types and a struct object that gives the values. Refer to readStruct for the
  * structure of structDefinition.
  *
  * @param structDefinition Type definition of the struct.
  * @param struct The struct data object.
  * @bundle DataStream-write.js
  */
  writeStruct(structDefinition, struct) {
    for (let i = 0; i < structDefinition.length; i++) {
      const [structName, structType] = structDefinition[i];
      const structValue = struct[structName];
      this.writeType(structType, structValue, struct);
    }
  }
  /**
  * Writes object v of type t to the DataStream.
  *
  * @param type Type of data to write.
  * @param value Value of data to write.
  * @param struct Struct to pass to write callback functions.
  * @bundle DataStream-write.js
  */
  writeType(type, value, struct) {
    if (typeof type === "function") return type(this, value);
    else if (typeof type === "object" && !(type instanceof Array)) return type.set(this, value, struct);
    let lengthOverride;
    let charset = "ASCII";
    const pos = this.position;
    let parsedType = type;
    if (typeof type === "string" && /:/.test(type)) {
      const tp = type.split(":");
      parsedType = tp[0];
      lengthOverride = parseInt(tp[1]);
    }
    if (typeof parsedType === "string" && /,/.test(parsedType)) {
      const tp = parsedType.split(",");
      parsedType = tp[0];
      charset = tp[1];
    }
    switch (parsedType) {
      case "uint8":
        this.writeUint8(value);
        break;
      case "int8":
        this.writeInt8(value);
        break;
      case "uint16":
        this.writeUint16(value, this.endianness);
        break;
      case "int16":
        this.writeInt16(value, this.endianness);
        break;
      case "uint32":
        this.writeUint32(value, this.endianness);
        break;
      case "int32":
        this.writeInt32(value, this.endianness);
        break;
      case "float32":
        this.writeFloat32(value, this.endianness);
        break;
      case "float64":
        this.writeFloat64(value, this.endianness);
        break;
      case "uint16be":
        this.writeUint16(value, 1);
        break;
      case "int16be":
        this.writeInt16(value, 1);
        break;
      case "uint32be":
        this.writeUint32(value, 1);
        break;
      case "int32be":
        this.writeInt32(value, 1);
        break;
      case "float32be":
        this.writeFloat32(value, 1);
        break;
      case "float64be":
        this.writeFloat64(value, 1);
        break;
      case "uint16le":
        this.writeUint16(value, 2);
        break;
      case "int16le":
        this.writeInt16(value, 2);
        break;
      case "uint32le":
        this.writeUint32(value, 2);
        break;
      case "int32le":
        this.writeInt32(value, 2);
        break;
      case "float32le":
        this.writeFloat32(value, 2);
        break;
      case "float64le":
        this.writeFloat64(value, 2);
        break;
      case "cstring":
        this.writeCString(value, lengthOverride);
        break;
      case "string":
        this.writeString(value, charset, lengthOverride);
        break;
      case "u16string":
        this.writeUCS2String(value, this.endianness, lengthOverride);
        break;
      case "u16stringle":
        this.writeUCS2String(value, 2, lengthOverride);
        break;
      case "u16stringbe":
        this.writeUCS2String(value, 1, lengthOverride);
        break;
      default:
        if (this.#isTupleType(parsedType)) {
          const [, ta] = parsedType;
          for (let i = 0; i < value.length; i++) this.writeType(ta, value[i]);
          break;
        } else {
          this.writeStruct(parsedType, value);
          break;
        }
    }
    if (lengthOverride) {
      this.position = pos;
      this._realloc(lengthOverride);
      this.position = pos + lengthOverride;
    }
  }
  /** @bundle DataStream-write.js */
  writeUint64(value) {
    const h = Math.floor(value / MAX_SIZE);
    this.writeUint32(h);
    this.writeUint32(value & 4294967295);
  }
  /** @bundle DataStream-write.js */
  writeUint24(value) {
    this.writeUint8((value & 16711680) >> 16);
    this.writeUint8((value & 65280) >> 8);
    this.writeUint8(value & 255);
  }
  /** @bundle DataStream-write.js */
  adjustUint32(position, value) {
    const pos = this.position;
    this.seek(position);
    this.writeUint32(value);
    this.seek(pos);
  }
  /**
  * Reads a struct of data from the DataStream. The struct is defined as
  * an array of [name, type]-pairs. See the example below:
  *
  * ```ts
  * ds.readStruct([
  *   ['headerTag', 'uint32'], // Uint32 in DataStream endianness.
  *   ['headerTag2', 'uint32be'], // Big-endian Uint32.
  *   ['headerTag3', 'uint32le'], // Little-endian Uint32.
  *   ['array', ['[]', 'uint32', 16]], // Uint32Array of length 16.
  *   ['array2', ['[]', 'uint32', 'array2Length']] // Uint32Array of length array2Length
  * ]);
  * ```
  *
  * The possible values for the type are as follows:
  *
  * ## Number types
  *
  * Unsuffixed number types use DataStream endianness.
  * To explicitly specify endianness, suffix the type with
  * 'le' for little-endian or 'be' for big-endian,
  * e.g. 'int32be' for big-endian int32.
  *
  * - `uint8` -- 8-bit unsigned int
  * - `uint16` -- 16-bit unsigned int
  * - `uint32` -- 32-bit unsigned int
  * - `int8` -- 8-bit int
  * - `int16` -- 16-bit int
  * - `int32` -- 32-bit int
  * - `float32` -- 32-bit float
  * - `float64` -- 64-bit float
  *
  * ## String types
  *
  * - `cstring` -- ASCII string terminated by a zero byte.
  * - `string:N` -- ASCII string of length N.
  * - `string,CHARSET:N` -- String of byteLength N encoded with given CHARSET.
  * - `u16string:N` -- UCS-2 string of length N in DataStream endianness.
  * - `u16stringle:N` -- UCS-2 string of length N in little-endian.
  * - `u16stringbe:N` -- UCS-2 string of length N in big-endian.
  *
  * ## Complex types
  *
  * ### Struct
  * ```ts
  * [[name, type], [name_2, type_2], ..., [name_N, type_N]]
  * ```
  *
  * ### Callback function to read and return data
  * ```ts
  * function(dataStream, struct) {}
  * ```
  *
  * ###  Getter/setter functions
  * to read and return data, handy for using the same struct definition
  * for reading and writing structs.
  * ```ts
  * {
  *    get: function(dataStream, struct) {},
  *    set: function(dataStream, struct) {}
  * }
  * ```
  *
  * ### Array
  * Array of given type and length. The length can be either
  * - a number
  * - a string that references a previously-read field
  * - `*`
  * - a callback: `function(struct, dataStream, type){}`
  *
  * If length is `*`, reads in as many elements as it can.
  * ```ts
  * ['[]', type, length]
  * ```
  *
  * @param structDefinition Struct definition object.
  * @return The read struct. Null if failed to read struct.
  * @bundle DataStream-read-struct.js
  */
  readStruct(structDefinition) {
    const struct = {};
    const p = this.position;
    for (let i = 0; i < structDefinition.length; i += 1) {
      const t = structDefinition[i][1];
      const v = this.readType(t, struct);
      if (!v) {
        if (this.failurePosition === 0) this.failurePosition = this.position;
        this.position = p;
        return;
      }
      struct[structDefinition[i][0]] = v;
    }
    return struct;
  }
  /**
  * Read UCS-2 string of desired length and endianness from the DataStream.
  *
  * @param length The length of the string to read.
  * @param endianness The endianness of the string data in the DataStream.
  * @return The read string.
  * @bundle DataStream-read-struct.js
  */
  readUCS2String(length, endianness) {
    return String.fromCharCode.apply(void 0, this.readUint16Array(length, endianness));
  }
  /**
  * Reads an object of type t from the DataStream, passing struct as the thus-far
  * read struct to possible callbacks that refer to it. Used by readStruct for
  * reading in the values, so the type is one of the readStruct types.
  *
  * @param type Type of the object to read.
  * @param struct Struct to refer to when resolving length references
  *                         and for calling callbacks.
  * @return  Returns the object on successful read, null on unsuccessful.
  * @bundle DataStream-read-struct.js
  */
  readType(type, struct) {
    if (typeof type === "function") return type(this, struct);
    if (typeof type === "object" && !(type instanceof Array)) return type.get(this, struct);
    if (type instanceof Array && type.length !== 3) return this.readStruct(type);
    let value;
    let lengthOverride;
    let charset = "ASCII";
    const pos = this.position;
    let parsedType = type;
    if (typeof parsedType === "string" && /:/.test(parsedType)) {
      const tp = parsedType.split(":");
      parsedType = tp[0];
      lengthOverride = parseInt(tp[1]);
    }
    if (typeof parsedType === "string" && /,/.test(parsedType)) {
      const tp = parsedType.split(",");
      parsedType = tp[0];
      charset = tp[1];
    }
    switch (parsedType) {
      case "uint8":
        value = this.readUint8();
        break;
      case "int8":
        value = this.readInt8();
        break;
      case "uint16":
        value = this.readUint16(this.endianness);
        break;
      case "int16":
        value = this.readInt16(this.endianness);
        break;
      case "uint32":
        value = this.readUint32(this.endianness);
        break;
      case "int32":
        value = this.readInt32(this.endianness);
        break;
      case "float32":
        value = this.readFloat32(this.endianness);
        break;
      case "float64":
        value = this.readFloat64(this.endianness);
        break;
      case "uint16be":
        value = this.readUint16(1);
        break;
      case "int16be":
        value = this.readInt16(1);
        break;
      case "uint32be":
        value = this.readUint32(1);
        break;
      case "int32be":
        value = this.readInt32(1);
        break;
      case "float32be":
        value = this.readFloat32(1);
        break;
      case "float64be":
        value = this.readFloat64(1);
        break;
      case "uint16le":
        value = this.readUint16(2);
        break;
      case "int16le":
        value = this.readInt16(2);
        break;
      case "uint32le":
        value = this.readUint32(2);
        break;
      case "int32le":
        value = this.readInt32(2);
        break;
      case "float32le":
        value = this.readFloat32(2);
        break;
      case "float64le":
        value = this.readFloat64(2);
        break;
      case "cstring":
        value = this.readCString(lengthOverride);
        break;
      case "string":
        value = this.readString(lengthOverride, charset);
        break;
      case "u16string":
        value = this.readUCS2String(lengthOverride, this.endianness);
        break;
      case "u16stringle":
        value = this.readUCS2String(lengthOverride, 2);
        break;
      case "u16stringbe":
        value = this.readUCS2String(lengthOverride, 1);
        break;
      default:
        if (this.#isTupleType(parsedType)) {
          const [, ta, len] = parsedType;
          const length = typeof len === "function" ? len(struct, this, parsedType) : typeof len === "string" && struct[len] !== void 0 ? parseInt(struct[len]) : typeof len === "number" ? len : len === "*" ? void 0 : parseInt(len);
          if (typeof ta === "string") {
            const tap = ta.replace(/(le|be)$/, "");
            let endianness;
            if (/le$/.test(ta)) endianness = 2;
            else if (/be$/.test(ta)) endianness = 1;
            switch (tap) {
              case "uint8":
                value = this.readUint8Array(length);
                break;
              case "uint16":
                value = this.readUint16Array(length, endianness);
                break;
              case "uint32":
                value = this.readUint32Array(length, endianness);
                break;
              case "int8":
                value = this.readInt8Array(length);
                break;
              case "int16":
                value = this.readInt16Array(length, endianness);
                break;
              case "int32":
                value = this.readInt32Array(length, endianness);
                break;
              case "float32":
                value = this.readFloat32Array(length, endianness);
                break;
              case "float64":
                value = this.readFloat64Array(length, endianness);
                break;
              case "cstring":
              case "utf16string":
              case "string":
                if (!length) {
                  value = [];
                  while (!this.isEof()) {
                    const u = this.readType(ta, struct);
                    if (!u) break;
                    value.push(u);
                  }
                } else {
                  value = new Array(length);
                  for (let i = 0; i < length; i++) value[i] = this.readType(ta, struct);
                }
                break;
            }
          } else if (!length) {
            value = [];
            while (true) {
              const pos2 = this.position;
              try {
                const type2 = this.readType(ta, struct);
                if (!type2) {
                  this.position = pos2;
                  break;
                }
                value.push(type2);
              } catch {
                this.position = pos2;
                break;
              }
            }
          } else {
            value = new Array(length);
            for (let i = 0; i < length; i++) {
              const type2 = this.readType(ta, struct);
              if (!type2) return;
              value[i] = type2;
            }
          }
          break;
        }
    }
    if (lengthOverride) this.position = pos + lengthOverride;
    return value;
  }
  /**
  * Maps an Int32Array into the DataStream buffer, swizzling it to native
  * endianness in-place. The current offset from the start of the buffer needs to
  * be a multiple of element size, just like with typed array views.
  *
  * Nice for quickly reading in data. Warning: potentially modifies the buffer
  * contents.
  *
  * @param length Number of elements to map.
  * @param endianness Endianness of the data to read.
  * @return Int32Array to the DataStream backing buffer.
  * @bundle DataStream-map.js
  */
  mapInt32Array(length, endianness) {
    this._realloc(length * 4);
    const arr = new Int32Array(this._buffer, this.byteOffset + this.position, length);
    DataStream2.arrayToNative(arr, endianness ?? this.endianness);
    this.position += length * 4;
    return arr;
  }
  /**
  * Maps an Int16Array into the DataStream buffer, swizzling it to native
  * endianness in-place. The current offset from the start of the buffer needs to
  * be a multiple of element size, just like with typed array views.
  *
  * Nice for quickly reading in data. Warning: potentially modifies the buffer
  * contents.
  *
  * @param length Number of elements to map.
  * @param endianness Endianness of the data to read.
  * @return Int16Array to the DataStream backing buffer.
  * @bundle DataStream-map.js
  */
  mapInt16Array(length, endianness) {
    this._realloc(length * 2);
    const arr = new Int16Array(this._buffer, this.byteOffset + this.position, length);
    DataStream2.arrayToNative(arr, endianness ?? this.endianness);
    this.position += length * 2;
    return arr;
  }
  /**
  * Maps an Int8Array into the DataStream buffer.
  *
  * Nice for quickly reading in data.
  *
  * @param length Number of elements to map.
  * @param endianness Endianness of the data to read.
  * @return Int8Array to the DataStream backing buffer.
  * @bundle DataStream-map.js
  */
  mapInt8Array(length, _endianness) {
    this._realloc(length * 1);
    const arr = new Int8Array(this._buffer, this.byteOffset + this.position, length);
    this.position += length * 1;
    return arr;
  }
  /**
  * Maps a Uint32Array into the DataStream buffer, swizzling it to native
  * endianness in-place. The current offset from the start of the buffer needs to
  * be a multiple of element size, just like with typed array views.
  *
  * Nice for quickly reading in data. Warning: potentially modifies the buffer
  * contents.
  *
  * @param length Number of elements to map.
  * @param endianness Endianness of the data to read.
  * @return Uint32Array to the DataStream backing buffer.
  * @bundle DataStream-map.js
  */
  mapUint32Array(length, endianness) {
    this._realloc(length * 4);
    const arr = new Uint32Array(this._buffer, this.byteOffset + this.position, length);
    DataStream2.arrayToNative(arr, endianness ?? this.endianness);
    this.position += length * 4;
    return arr;
  }
  /**
  * Maps a Uint16Array into the DataStream buffer, swizzling it to native
  * endianness in-place. The current offset from the start of the buffer needs to
  * be a multiple of element size, just like with typed array views.
  *
  * Nice for quickly reading in data. Warning: potentially modifies the buffer
  * contents.
  *
  * @param length Number of elements to map.
  * @param endianness Endianness of the data to read.
  * @return Uint16Array to the DataStream backing buffer.
  * @bundle DataStream-map.js
  */
  mapUint16Array(length, endianness) {
    this._realloc(length * 2);
    const arr = new Uint16Array(this._buffer, this.byteOffset + this.position, length);
    DataStream2.arrayToNative(arr, endianness ?? this.endianness);
    this.position += length * 2;
    return arr;
  }
  /**
  * Maps a Float64Array into the DataStream buffer, swizzling it to native
  * endianness in-place. The current offset from the start of the buffer needs to
  * be a multiple of element size, just like with typed array views.
  *
  * Nice for quickly reading in data. Warning: potentially modifies the buffer
  * contents.
  *
  * @param length Number of elements to map.
  * @param endianness Endianness of the data to read.
  * @return Float64Array to the DataStream backing buffer.
  * @bundle DataStream-map.js
  */
  mapFloat64Array(length, endianness) {
    this._realloc(length * 8);
    const arr = new Float64Array(this._buffer, this.byteOffset + this.position, length);
    DataStream2.arrayToNative(arr, endianness ?? this.endianness);
    this.position += length * 8;
    return arr;
  }
  /**
  * Maps a Float32Array into the DataStream buffer, swizzling it to native
  * endianness in-place. The current offset from the start of the buffer needs to
  * be a multiple of element size, just like with typed array views.
  *
  * Nice for quickly reading in data. Warning: potentially modifies the buffer
  * contents.
  *
  * @param length Number of elements to map.
  * @param endianness Endianness of the data to read.
  * @return Float32Array to the DataStream backing buffer.
  * @bundle DataStream-map.js
  */
  mapFloat32Array(length, endianness) {
    this._realloc(length * 4);
    const arr = new Float32Array(this._buffer, this.byteOffset + this.position, length);
    DataStream2.arrayToNative(arr, endianness ?? this.endianness);
    this.position += length * 4;
    return arr;
  }
};
function fromCharCodeUint8(uint8arr) {
  const arr = [];
  for (let i = 0; i < uint8arr.length; i++) arr[i] = uint8arr[i];
  return String.fromCharCode.apply(void 0, arr);
}
var start = /* @__PURE__ */ new Date();
var LOG_LEVEL_ERROR = 4;
var LOG_LEVEL_WARNING = 3;
var LOG_LEVEL_INFO = 2;
var LOG_LEVEL_DEBUG = 1;
var log_level = LOG_LEVEL_ERROR;
var Log = {
  setLogLevel(level) {
    if (level === this.debug) log_level = LOG_LEVEL_DEBUG;
    else if (level === this.info) log_level = LOG_LEVEL_INFO;
    else if (level === this.warn) log_level = LOG_LEVEL_WARNING;
    else if (level === this.error) log_level = LOG_LEVEL_ERROR;
    else log_level = LOG_LEVEL_ERROR;
  },
  debug(module, msg) {
    if (console.debug === void 0) console.debug = console.log;
    if (LOG_LEVEL_DEBUG >= log_level) console.debug("[" + Log.getDurationString((/* @__PURE__ */ new Date()).getTime() - start.getTime(), 1e3) + "]", "[" + module + "]", msg);
  },
  log(module, _msg) {
    this.debug(module.msg);
  },
  info(module, msg) {
    if (LOG_LEVEL_INFO >= log_level) console.info("[" + Log.getDurationString((/* @__PURE__ */ new Date()).getTime() - start.getTime(), 1e3) + "]", "[" + module + "]", msg);
  },
  warn(module, msg) {
    if (LOG_LEVEL_WARNING >= log_level) console.warn("[" + Log.getDurationString((/* @__PURE__ */ new Date()).getTime() - start.getTime(), 1e3) + "]", "[" + module + "]", msg);
  },
  error(module, msg, isofile) {
    if (isofile?.onError) isofile.onError(module, msg);
    else if (LOG_LEVEL_ERROR >= log_level) console.error("[" + Log.getDurationString((/* @__PURE__ */ new Date()).getTime() - start.getTime(), 1e3) + "]", "[" + module + "]", msg);
  },
  getDurationString(duration, _timescale) {
    let neg;
    function pad(number, length) {
      const a = ("" + number).split(".");
      while (a[0].length < length) a[0] = "0" + a[0];
      return a.join(".");
    }
    if (duration < 0) {
      neg = true;
      duration = -duration;
    } else neg = false;
    let duration_sec = duration / (_timescale || 1);
    const hours = Math.floor(duration_sec / 3600);
    duration_sec -= hours * 3600;
    const minutes = Math.floor(duration_sec / 60);
    duration_sec -= minutes * 60;
    let msec = duration_sec * 1e3;
    duration_sec = Math.floor(duration_sec);
    msec -= duration_sec * 1e3;
    msec = Math.floor(msec);
    return (neg ? "-" : "") + hours + ":" + pad(minutes, 2) + ":" + pad(duration_sec, 2) + "." + pad(msec, 3);
  },
  printRanges(ranges) {
    const length = ranges.length;
    if (length > 0) {
      let str = "";
      for (let i = 0; i < length; i++) {
        if (i > 0) str += ",";
        str += "[" + Log.getDurationString(ranges.start(i)) + "," + Log.getDurationString(ranges.end(i)) + "]";
      }
      return str;
    } else return "(empty)";
  }
};
function concatBuffers(buffer1, buffer2) {
  Log.debug("ArrayBuffer", "Trying to create a new buffer of size: " + (buffer1.byteLength + buffer2.byteLength));
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp.buffer;
}
var MultiBufferStream = class extends DataStream {
  constructor(buffer) {
    super(/* @__PURE__ */ new ArrayBuffer(), 0);
    this.buffers = [];
    this.bufferIndex = -1;
    if (buffer) {
      this.insertBuffer(buffer);
      this.bufferIndex = 0;
    }
  }
  /***********************************************************************************
  *                     Methods for the managnement of the buffers                  *
  *                     (insertion, removal, concatenation, ...)                    *
  ***********************************************************************************/
  initialized() {
    if (this.bufferIndex > -1) return true;
    else if (this.buffers.length > 0) {
      const firstBuffer = this.buffers[0];
      if (firstBuffer.fileStart === 0) {
        this.buffer = firstBuffer;
        this.bufferIndex = 0;
        Log.debug("MultiBufferStream", "Stream ready for parsing");
        return true;
      } else {
        Log.warn("MultiBufferStream", "The first buffer should have a fileStart of 0");
        this.logBufferLevel();
        return false;
      }
    } else {
      Log.warn("MultiBufferStream", "No buffer to start parsing from");
      this.logBufferLevel();
      return false;
    }
  }
  /**
  * Reduces the size of a given buffer, but taking the part between offset and offset+newlength
  * @param  {ArrayBuffer} buffer
  * @param  {Number}      offset    the start of new buffer
  * @param  {Number}      newLength the length of the new buffer
  * @return {ArrayBuffer}           the new buffer
  */
  reduceBuffer(buffer, offset, newLength) {
    const smallB = new Uint8Array(newLength);
    smallB.set(new Uint8Array(buffer, offset, newLength));
    smallB.buffer.fileStart = buffer.fileStart + offset;
    smallB.buffer.usedBytes = 0;
    return smallB.buffer;
  }
  /**
  * Inserts the new buffer in the sorted list of buffers,
  *  making sure, it is not overlapping with existing ones (possibly reducing its size).
  *  if the new buffer overrides/replaces the 0-th buffer (for instance because it is bigger),
  *  updates the DataStream buffer for parsing
  */
  insertBuffer(ab) {
    let to_add = true;
    let i = 0;
    for (; i < this.buffers.length; i++) {
      const b = this.buffers[i];
      if (ab.fileStart <= b.fileStart) {
        if (ab.fileStart === b.fileStart) if (ab.byteLength > b.byteLength) {
          this.buffers.splice(i, 1);
          i--;
          continue;
        } else Log.warn("MultiBufferStream", "Buffer (fileStart: " + ab.fileStart + " - Length: " + ab.byteLength + ") already appended, ignoring");
        else {
          if (ab.fileStart + ab.byteLength <= b.fileStart) {
          } else ab = this.reduceBuffer(ab, 0, b.fileStart - ab.fileStart);
          Log.debug("MultiBufferStream", "Appending new buffer (fileStart: " + ab.fileStart + " - Length: " + ab.byteLength + ")");
          this.buffers.splice(i, 0, ab);
          if (i === 0) this.buffer = ab;
        }
        to_add = false;
        break;
      } else if (ab.fileStart < b.fileStart + b.byteLength) {
        const offset = b.fileStart + b.byteLength - ab.fileStart;
        const newLength = ab.byteLength - offset;
        if (newLength > 0) ab = this.reduceBuffer(ab, offset, newLength);
        else {
          to_add = false;
          break;
        }
      }
    }
    if (to_add) {
      Log.debug("MultiBufferStream", "Appending new buffer (fileStart: " + ab.fileStart + " - Length: " + ab.byteLength + ")");
      this.buffers.push(ab);
      if (i === 0) this.buffer = ab;
    }
  }
  /**
  * Displays the status of the buffers (number and used bytes)
  * @param  {Object} info callback method for display
  */
  logBufferLevel(info) {
    const ranges = [];
    let bufferedString = "";
    let range;
    let used = 0;
    let total = 0;
    for (let i = 0; i < this.buffers.length; i++) {
      const buffer = this.buffers[i];
      if (i === 0) {
        range = {
          start: buffer.fileStart,
          end: buffer.fileStart + buffer.byteLength
        };
        ranges.push(range);
        bufferedString += "[" + range.start + "-";
      } else if (range.end === buffer.fileStart) range.end = buffer.fileStart + buffer.byteLength;
      else {
        range = {
          start: buffer.fileStart,
          end: buffer.fileStart + buffer.byteLength
        };
        bufferedString += ranges[ranges.length - 1].end - 1 + "], [" + range.start + "-";
        ranges.push(range);
      }
      used += buffer.usedBytes;
      total += buffer.byteLength;
    }
    if (ranges.length > 0) bufferedString += range.end - 1 + "]";
    const log = info ? Log.info : Log.debug;
    if (this.buffers.length === 0) log("MultiBufferStream", "No more buffer in memory");
    else log("MultiBufferStream", "" + this.buffers.length + " stored buffer(s) (" + used + "/" + total + " bytes), continuous ranges: " + bufferedString);
  }
  cleanBuffers() {
    for (let i = 0; i < this.buffers.length; i++) {
      const buffer = this.buffers[i];
      if (buffer.usedBytes === buffer.byteLength) {
        Log.debug("MultiBufferStream", "Removing buffer #" + i);
        this.buffers.splice(i, 1);
        i--;
      }
    }
  }
  mergeNextBuffer() {
    if (this.bufferIndex + 1 < this.buffers.length) {
      const next_buffer = this.buffers[this.bufferIndex + 1];
      if (next_buffer.fileStart === this.buffer.fileStart + this.buffer.byteLength) {
        const oldLength = this.buffer.byteLength;
        const oldUsedBytes = this.buffer.usedBytes;
        const oldFileStart = this.buffer.fileStart;
        this.buffers[this.bufferIndex] = concatBuffers(this.buffer, next_buffer);
        this.buffer = this.buffers[this.bufferIndex];
        this.buffers.splice(this.bufferIndex + 1, 1);
        this.buffer.usedBytes = oldUsedBytes;
        this.buffer.fileStart = oldFileStart;
        Log.debug("ISOFile", "Concatenating buffer for box parsing (length: " + oldLength + "->" + this.buffer.byteLength + ")");
        return true;
      } else return false;
    } else return false;
  }
  /*************************************************************************
  *                        Seek-related functions                         *
  *************************************************************************/
  /**
  * Finds the buffer that holds the given file position
  * @param  {Boolean} fromStart    indicates if the search should start from the current buffer (false)
  *                                or from the first buffer (true)
  * @param  {Number}  filePosition position in the file to seek to
  * @param  {Boolean} markAsUsed   indicates if the bytes in between the current position and the seek position
  *                                should be marked as used for garbage collection
  * @return {Number}               the index of the buffer holding the seeked file position, -1 if not found.
  */
  findPosition(fromStart, filePosition, markAsUsed) {
    let index = -1;
    let i = fromStart === true ? 0 : this.bufferIndex;
    while (i < this.buffers.length) {
      const abuffer2 = this.buffers[i];
      if (abuffer2 && abuffer2.fileStart <= filePosition) {
        index = i;
        if (markAsUsed) {
          if (abuffer2.fileStart + abuffer2.byteLength <= filePosition) abuffer2.usedBytes = abuffer2.byteLength;
          else abuffer2.usedBytes = filePosition - abuffer2.fileStart;
          this.logBufferLevel();
        }
      } else break;
      i++;
    }
    if (index === -1) return -1;
    const abuffer = this.buffers[index];
    if (abuffer.fileStart + abuffer.byteLength >= filePosition) {
      Log.debug("MultiBufferStream", "Found position in existing buffer #" + index);
      return index;
    } else return -1;
  }
  /**
  * Finds the largest file position contained in a buffer or in the next buffers if they are contiguous (no gap)
  * starting from the given buffer index or from the current buffer if the index is not given
  *
  * @param  {Number} inputindex Index of the buffer to start from
  * @return {Number}            The largest file position found in the buffers
  */
  findEndContiguousBuf(inputindex) {
    const index = inputindex !== void 0 ? inputindex : this.bufferIndex;
    let currentBuf = this.buffers[index];
    if (this.buffers.length > index + 1) for (let i = index + 1; i < this.buffers.length; i++) {
      const nextBuf = this.buffers[i];
      if (nextBuf.fileStart === currentBuf.fileStart + currentBuf.byteLength) currentBuf = nextBuf;
      else break;
    }
    return currentBuf.fileStart + currentBuf.byteLength;
  }
  /**
  * Returns the largest file position contained in the buffers, larger than the given position
  * @param  {Number} pos the file position to start from
  * @return {Number}     the largest position in the current buffer or in the buffer and the next contiguous
  *                      buffer that holds the given position
  */
  getEndFilePositionAfter(pos) {
    const index = this.findPosition(true, pos, false);
    if (index !== -1) return this.findEndContiguousBuf(index);
    else return pos;
  }
  /*************************************************************************
  *                  Garbage collection related functions                 *
  *************************************************************************/
  /**
  * Marks a given number of bytes as used in the current buffer for garbage collection
  * @param {Number} nbBytes
  */
  addUsedBytes(nbBytes) {
    this.buffer.usedBytes += nbBytes;
    this.logBufferLevel();
  }
  /**
  * Marks the entire current buffer as used, ready for garbage collection
  */
  setAllUsedBytes() {
    this.buffer.usedBytes = this.buffer.byteLength;
    this.logBufferLevel();
  }
  /*************************************************************************
  *          Common API between MultiBufferStream and SimpleStream        *
  *************************************************************************/
  /**
  * Tries to seek to a given file position
  * if possible, repositions the parsing from there and returns true
  * if not possible, does not change anything and returns false
  * @param  {Number}  filePosition position in the file to seek to
  * @param  {Boolean} fromStart    indicates if the search should start from the current buffer (false)
  *                                or from the first buffer (true)
  * @param  {Boolean} markAsUsed   indicates if the bytes in between the current position and the seek position
  *                                should be marked as used for garbage collection
  * @return {Boolean}              true if the seek succeeded, false otherwise
  */
  seek(filePosition, fromStart, markAsUsed) {
    const index = this.findPosition(fromStart, filePosition, markAsUsed);
    if (index !== -1) {
      this.buffer = this.buffers[index];
      this.bufferIndex = index;
      this.position = filePosition - this.buffer.fileStart;
      Log.debug("MultiBufferStream", "Repositioning parser at buffer position: " + this.position);
      return true;
    } else {
      Log.debug("MultiBufferStream", "Position " + filePosition + " not found in buffered data");
      return false;
    }
  }
  /**
  * Returns the current position in the file
  * @return {Number} the position in the file
  */
  getPosition() {
    if (this.bufferIndex === -1 || this.buffers[this.bufferIndex] === void 0) return 0;
    return this.buffers[this.bufferIndex].fileStart + this.position;
  }
  /**
  * Returns the length of the current buffer
  * @return {Number} the length of the current buffer
  */
  getLength() {
    return this.byteLength;
  }
  getEndPosition() {
    if (this.bufferIndex === -1 || this.buffers[this.bufferIndex] === void 0) return 0;
    return this.buffers[this.bufferIndex].fileStart + this.byteLength;
  }
  getAbsoluteEndPosition() {
    if (this.buffers.length === 0) return 0;
    const lastBuffer = this.buffers[this.buffers.length - 1];
    return lastBuffer.fileStart + lastBuffer.byteLength;
  }
};
var Box = class {
  static {
    this.registryId = /* @__PURE__ */ Symbol.for("BoxIdentifier");
  }
  #type;
  get type() {
    return this.constructor.fourcc ?? this.#type;
  }
  set type(value) {
    this.#type = value;
  }
  constructor(size = 0) {
    this.size = size;
  }
  addBox(box2) {
    if (!this.boxes) this.boxes = [];
    this.boxes.push(box2);
    if (this[box2.type + "s"]) this[box2.type + "s"].push(box2);
    else this[box2.type] = box2;
    return box2;
  }
  set(prop, value) {
    this[prop] = value;
    return this;
  }
  addEntry(value, _prop) {
    const prop = _prop || "entries";
    if (!this[prop]) this[prop] = [];
    this[prop].push(value);
    return this;
  }
  /** @bundle box-write.js */
  writeHeader(stream, msg) {
    this.size += 8;
    if (this.size > MAX_UINT32 || this.original_size === 1) this.size += 8;
    if (this.type === "uuid") this.size += 16;
    Log.debug("BoxWriter", "Writing box " + this.type + " of size: " + this.size + " at position " + stream.getPosition() + (msg || ""));
    if (this.original_size === 0) stream.writeUint32(0);
    else if (this.size > MAX_UINT32 || this.original_size === 1) stream.writeUint32(1);
    else {
      this.sizePosition = stream.getPosition();
      stream.writeUint32(this.size);
    }
    stream.writeString(this.type, void 0, 4);
    if (this.type === "uuid") {
      const uuidBytes = /* @__PURE__ */ new Uint8Array(16);
      for (let i = 0; i < 16; i++) uuidBytes[i] = parseInt(this.uuid.substring(i * 2, i * 2 + 2), 16);
      stream.writeUint8Array(uuidBytes);
    }
    if (this.size > MAX_UINT32 || this.original_size === 1) {
      this.sizePosition = stream.getPosition();
      stream.writeUint64(this.size);
    }
  }
  /** @bundle box-write.js */
  write(stream) {
    if (this.type === "mdat") {
      const box2 = this;
      if (box2.stream) {
        this.size = box2.stream.getAbsoluteEndPosition();
        this.writeHeader(stream);
        for (const buffer of box2.stream.buffers) {
          const u82 = new Uint8Array(buffer);
          stream.writeUint8Array(u82);
        }
      } else if (box2.data) {
        this.size = box2.data.length;
        this.writeHeader(stream);
        stream.writeUint8Array(box2.data);
      }
    } else {
      this.size = this.data ? this.data.length : 0;
      this.writeHeader(stream);
      if (this.data) stream.writeUint8Array(this.data);
    }
  }
  /** @bundle box-print.js */
  printHeader(output) {
    this.size += 8;
    if (this.size > MAX_UINT32) this.size += 8;
    if (this.type === "uuid") this.size += 16;
    output.log(output.indent + "size:" + this.size);
    output.log(output.indent + "type:" + this.type);
  }
  /** @bundle box-print.js */
  print(output) {
    this.printHeader(output);
  }
  /** @bundle box-parse.js */
  parse(stream) {
    if (this.type !== "mdat") this.data = stream.readUint8Array(this.size - this.hdr_size);
    else if (this.size === 0) stream.seek(stream.getEndPosition());
    else stream.seek(this.start + this.size);
  }
  /** @bundle box-parse.js */
  parseDataAndRewind(stream) {
    this.data = stream.readUint8Array(this.size - this.hdr_size);
    stream.seek(this.start + this.hdr_size);
  }
  /** @bundle box-parse.js */
  parseLanguage(stream) {
    this.language = stream.readUint16();
    const chars = [];
    chars[0] = this.language >> 10 & 31;
    chars[1] = this.language >> 5 & 31;
    chars[2] = this.language & 31;
    this.languageString = String.fromCharCode(chars[0] + 96, chars[1] + 96, chars[2] + 96);
  }
  /** @bundle isofile-advanced-creation.js */
  computeSize(stream_) {
    const stream = stream_ || new MultiBufferStream();
    this.write(stream);
  }
  isEndOfBox(stream) {
    return stream.getPosition() === this.start + this.size;
  }
};
var FullBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.flags = 0;
    this.version = 0;
  }
  /** @bundle box-write.js */
  writeHeader(stream) {
    this.size += 4;
    super.writeHeader(stream, " v=" + this.version + " f=" + this.flags);
    stream.writeUint8(this.version);
    stream.writeUint24(this.flags);
  }
  /** @bundle box-print.js */
  printHeader(output) {
    this.size += 4;
    super.printHeader(output);
    output.log(output.indent + "version:" + this.version);
    output.log(output.indent + "flags:" + this.flags);
  }
  /** @bundle box-parse.js */
  parseDataAndRewind(stream) {
    this.parseFullHeader(stream);
    this.data = stream.readUint8Array(this.size - this.hdr_size);
    this.hdr_size -= 4;
    stream.seek(this.start + this.hdr_size);
  }
  /** @bundle box-parse.js */
  parseFullHeader(stream) {
    this.version = stream.readUint8();
    this.flags = stream.readUint24();
    this.hdr_size += 4;
  }
  /** @bundle box-parse.js */
  parse(stream) {
    this.parseFullHeader(stream);
    this.data = stream.readUint8Array(this.size - this.hdr_size);
  }
};
var SampleGroupEntry = class {
  static {
    this.registryId = /* @__PURE__ */ Symbol.for("SampleGroupEntryIdentifier");
  }
  constructor(grouping_type) {
    this.grouping_type = grouping_type;
  }
  /** @bundle writing/samplegroups/samplegroup.js */
  write(stream) {
    stream.writeUint8Array(this.data);
  }
  /** @bundle parsing/samplegroups/samplegroup.js */
  parse(stream) {
    Log.warn("BoxParser", `Unknown sample group type: '${this.grouping_type}'`);
    this.data = stream.readUint8Array(this.description_length);
  }
};
var TrackGroupTypeBox = class extends FullBox {
  /** @bundle parsing/TrackGroup.js */
  parse(stream) {
    this.parseFullHeader(stream);
    this.track_group_id = stream.readUint32();
  }
};
var SingleItemTypeReferenceBox = class extends Box {
  constructor(fourcc, size, box_name, hdr_size, start2) {
    super(size);
    this.box_name = box_name;
    this.hdr_size = hdr_size;
    this.start = start2;
    this.type = fourcc;
  }
  parse(stream) {
    this.from_item_ID = stream.readUint16();
    const count = stream.readUint16();
    this.references = [];
    for (let i = 0; i < count; i++) this.references[i] = { to_item_ID: stream.readUint16() };
  }
};
var SingleItemTypeReferenceBoxLarge = class extends Box {
  constructor(fourcc, size, box_name, hdr_size, start2) {
    super(size);
    this.box_name = box_name;
    this.hdr_size = hdr_size;
    this.start = start2;
    this.type = fourcc;
  }
  parse(stream) {
    this.from_item_ID = stream.readUint32();
    const count = stream.readUint16();
    this.references = [];
    for (let i = 0; i < count; i++) this.references[i] = { to_item_ID: stream.readUint32() };
  }
};
var TrackReferenceTypeBox = class extends Box {
  constructor(fourcc, size, hdr_size, start2) {
    super(size);
    this.hdr_size = hdr_size;
    this.start = start2;
    this.type = fourcc;
  }
  parse(stream) {
    this.track_ids = stream.readUint32Array((this.size - this.hdr_size) / 4);
  }
  /** @bundle box-write.js */
  write(stream) {
    this.size = this.track_ids.length * 4;
    this.writeHeader(stream);
    stream.writeUint32Array(this.track_ids);
  }
};
var DIFF_BOXES_PROP_NAMES = [
  "boxes",
  "entries",
  "references",
  "subsamples",
  "items",
  "item_infos",
  "extents",
  "associations",
  "subsegments",
  "ranges",
  "seekLists",
  "seekPoints",
  "esd",
  "levels"
];
var DIFF_PRIMITIVE_ARRAY_PROP_NAMES = [
  "compatible_brands",
  "matrix",
  "opcolor",
  "sample_counts",
  "sample_deltas",
  "first_chunk",
  "samples_per_chunk",
  "sample_sizes",
  "chunk_offsets",
  "sample_offsets",
  "sample_description_index",
  "sample_duration"
];
function boxEqualFields(box_a, box_b) {
  if (box_a && !box_b) return false;
  let prop;
  for (prop in box_a) if (DIFF_BOXES_PROP_NAMES.find((name) => name === prop)) continue;
  else if (box_a[prop] instanceof Box || box_b[prop] instanceof Box) continue;
  else if (typeof box_a[prop] === "undefined" || typeof box_b[prop] === "undefined") continue;
  else if (typeof box_a[prop] === "function" || typeof box_b[prop] === "function") continue;
  else if ("subBoxNames" in box_a && box_a.subBoxNames.indexOf(prop.slice(0, 4)) > -1 || "subBoxNames" in box_b && box_b.subBoxNames.indexOf(prop.slice(0, 4)) > -1) continue;
  else if (prop === "data" || prop === "start" || prop === "size" || prop === "creation_time" || prop === "modification_time") continue;
  else if (DIFF_PRIMITIVE_ARRAY_PROP_NAMES.find((name) => name === prop)) continue;
  else if (box_a[prop] !== box_b[prop]) return false;
  return true;
}
function boxEqual(box_a, box_b) {
  if (!boxEqualFields(box_a, box_b)) return false;
  for (let j = 0; j < DIFF_BOXES_PROP_NAMES.length; j++) {
    const name = DIFF_BOXES_PROP_NAMES[j];
    if (box_a[name] && box_b[name]) {
      if (!boxEqual(box_a[name], box_b[name])) return false;
    }
  }
  return true;
}
function getRegistryId(boxClass) {
  let current = boxClass;
  while (current) {
    if ("registryId" in current) return current["registryId"];
    current = Object.getPrototypeOf(current);
  }
}
var isSampleGroupEntry = (value) => {
  const symbol = /* @__PURE__ */ Symbol.for("SampleGroupEntryIdentifier");
  return getRegistryId(value) === symbol;
};
var isSampleEntry = (value) => {
  const symbol = /* @__PURE__ */ Symbol.for("SampleEntryIdentifier");
  return getRegistryId(value) === symbol;
};
var isBox = (value) => {
  const symbol = /* @__PURE__ */ Symbol.for("BoxIdentifier");
  return getRegistryId(value) === symbol;
};
var BoxRegistry = {
  uuid: {},
  sampleEntry: {},
  sampleGroupEntry: {},
  box: {}
};
function registerBoxes(registry) {
  const localRegistry = {
    uuid: {},
    sampleEntry: {},
    sampleGroupEntry: {},
    box: {}
  };
  for (const [key, value] of Object.entries(registry)) {
    if (isSampleGroupEntry(value)) {
      const groupingType = "grouping_type" in value ? value.grouping_type : void 0;
      if (!groupingType) throw new Error(`SampleGroupEntry class ${key} does not have a valid static grouping_type. Please ensure it is defined correctly.`);
      if (groupingType in localRegistry.sampleGroupEntry) throw new Error(`SampleGroupEntry class ${key} has a grouping_type that is already registered. Please ensure it is unique.`);
      localRegistry.sampleGroupEntry[groupingType] = value;
      continue;
    }
    if (isSampleEntry(value)) {
      const fourcc = "fourcc" in value ? value.fourcc : void 0;
      if (!fourcc) throw new Error(`SampleEntry class ${key} does not have a valid static fourcc. Please ensure it is defined correctly.`);
      if (fourcc in localRegistry.sampleEntry) throw new Error(`SampleEntry class ${key} has a fourcc that is already registered. Please ensure it is unique.`);
      localRegistry.sampleEntry[fourcc] = value;
      continue;
    }
    if (isBox(value)) {
      const fourcc = "fourcc" in value ? value.fourcc : void 0;
      const uuid = "uuid" in value ? value.uuid : void 0;
      if (fourcc === "uuid") {
        if (!uuid) throw new Error(`Box class ${key} has a fourcc of 'uuid' but does not have a valid uuid. Please ensure it is defined correctly.`);
        if (uuid in localRegistry.uuid) throw new Error(`Box class ${key} has a uuid that is already registered. Please ensure it is unique.`);
        localRegistry.uuid[uuid] = value;
        continue;
      }
      localRegistry.box[fourcc] = value;
      continue;
    }
    throw new Error(`Box class ${key} does not have a valid static fourcc, uuid, or grouping_type. Please ensure it is defined correctly.`);
  }
  BoxRegistry.uuid = { ...localRegistry.uuid };
  BoxRegistry.sampleEntry = { ...localRegistry.sampleEntry };
  BoxRegistry.sampleGroupEntry = { ...localRegistry.sampleGroupEntry };
  BoxRegistry.box = { ...localRegistry.box };
  return BoxRegistry;
}
var DescriptorRegistry = {};
function registerDescriptors(registry) {
  Object.entries(registry).forEach(([key, value]) => DescriptorRegistry[key] = value);
  return DescriptorRegistry;
}
function parseUUID(stream) {
  return parseHex16(stream);
}
function parseHex16(stream) {
  let hex16 = "";
  for (let i = 0; i < 16; i++) {
    const hex = stream.readUint8().toString(16);
    hex16 += hex.length === 1 ? "0" + hex : hex;
  }
  return hex16;
}
function parseOneBox(stream, headerOnly, parentSize) {
  let box2;
  let originalSize;
  const start2 = stream.getPosition();
  let hdr_size = 0;
  let uuid;
  if (stream.getEndPosition() - start2 < 8) {
    Log.debug("BoxParser", "Not enough data in stream to parse the type and size of the box");
    return { code: 0 };
  }
  if (parentSize && parentSize < 8) {
    Log.debug("BoxParser", "Not enough bytes left in the parent box to parse a new box");
    return { code: 0 };
  }
  let size = stream.readUint32();
  const type = stream.readString(4);
  if (type.length !== 4 || !/^[\x20-\x7E]{4}$/.test(type)) {
    Log.error("BoxParser", `Invalid box type: '${type}'`);
    return {
      code: -1,
      start: start2,
      type
    };
  }
  let box_type = type;
  Log.debug("BoxParser", "Found box of type '" + type + "' and size " + size + " at position " + start2);
  hdr_size = 8;
  if (type === "uuid") {
    if (stream.getEndPosition() - stream.getPosition() < 16 || parentSize - hdr_size < 16) {
      stream.seek(start2);
      Log.debug("BoxParser", "Not enough bytes left in the parent box to parse a UUID box");
      return { code: 0 };
    }
    uuid = parseUUID(stream);
    hdr_size += 16;
    box_type = uuid;
  }
  if (size === 1) {
    if (stream.getEndPosition() - stream.getPosition() < 8 || parentSize && parentSize - hdr_size < 8) {
      stream.seek(start2);
      Log.warn("BoxParser", 'Not enough data in stream to parse the extended size of the "' + type + '" box');
      return { code: 0 };
    }
    originalSize = size;
    size = stream.readUint64();
    hdr_size += 8;
  } else if (size === 0) if (parentSize) size = parentSize;
  else if (type !== "mdat") {
    Log.error("BoxParser", "Unlimited box size not supported for type: '" + type + "'");
    box2 = new Box(size);
    box2.type = type;
    return {
      code: 1,
      box: box2,
      size: box2.size
    };
  } else size = stream.getEndPosition() - start2;
  if (size !== 0 && size < hdr_size) {
    Log.error("BoxParser", "Box of type " + type + " has an invalid size " + size + " (too small to be a box)");
    return {
      code: 0,
      type,
      size,
      hdr_size,
      start: start2
    };
  }
  if (size !== 0 && parentSize && size > parentSize) {
    Log.error("BoxParser", "Box of type '" + type + "' has a size " + size + " greater than its container size " + parentSize);
    return {
      code: 0,
      type,
      size,
      hdr_size,
      start: start2
    };
  }
  if (size !== 0 && start2 + size > stream.getEndPosition()) {
    stream.seek(start2);
    Log.info("BoxParser", "Not enough data in stream to parse the entire '" + type + "' box");
    return {
      code: 0,
      type,
      size,
      hdr_size,
      start: start2,
      original_size: originalSize
    };
  }
  if (headerOnly) return {
    code: 1,
    type,
    size,
    hdr_size,
    start: start2
  };
  else if (type in BoxRegistry.box) box2 = new BoxRegistry.box[type](size);
  else if (type !== "uuid") {
    Log.warn("BoxParser", `Unknown box type: '${type}'`);
    box2 = new Box(size);
    box2.type = type;
    box2.has_unparsed_data = true;
  } else if (uuid in BoxRegistry.uuid) box2 = new BoxRegistry.uuid[uuid](size);
  else {
    Log.warn("BoxParser", `Unknown UUID box type: '${uuid}'`);
    box2 = new Box(size);
    box2.type = type;
    box2.uuid = uuid;
    box2.has_unparsed_data = true;
  }
  box2.original_size = originalSize;
  box2.hdr_size = hdr_size;
  box2.start = start2;
  if (box2.write === Box.prototype.write && box2.type !== "mdat") {
    Log.info("BoxParser", "'" + box_type + "' box writing not yet implemented, keeping unparsed data in memory for later write");
    box2.parseDataAndRewind(stream);
  }
  box2.parse(stream);
  const diff = stream.getPosition() - (box2.start + box2.size);
  if (diff < 0) {
    Log.warn("BoxParser", "Parsing of box '" + box_type + "' did not read the entire indicated box data size (missing " + -diff + " bytes), seeking forward");
    stream.seek(box2.start + box2.size);
  } else if (diff > 0 && box2.size !== 0) {
    Log.error("BoxParser", "Parsing of box '" + box_type + "' read " + diff + " more bytes than the indicated box data size, seeking backwards");
    stream.seek(box2.start + box2.size);
  }
  return {
    code: 1,
    box: box2,
    size: box2.size
  };
}
var ContainerBox = class extends Box {
  /** @bundle box-write.js */
  write(stream) {
    this.size = 0;
    this.writeHeader(stream);
    if (this.boxes) {
      for (let i = 0; i < this.boxes.length; i++) if (this.boxes[i]) {
        this.boxes[i].write(stream);
        this.size += this.boxes[i].size;
      }
    }
    Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
    stream.adjustUint32(this.sizePosition, this.size);
  }
  /** @bundle box-print.js */
  print(output) {
    this.printHeader(output);
    for (let i = 0; i < this.boxes.length; i++) if (this.boxes[i]) {
      const prev_indent = output.indent;
      output.indent += " ";
      this.boxes[i].print(output);
      output.indent = prev_indent;
    }
  }
  /** @bundle box-parse.js */
  parse(stream) {
    let ret;
    while (stream.getPosition() < this.start + this.size) {
      ret = parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
      if (ret.code === 1) {
        const box2 = ret.box;
        if (!this.boxes) this.boxes = [];
        this.boxes.push(box2);
        if (this.subBoxNames && this.subBoxNames.indexOf(box2.type) !== -1) {
          const fourcc = this.subBoxNames[this.subBoxNames.indexOf(box2.type)] + "s";
          if (!this[fourcc]) this[fourcc] = [];
          this[fourcc].push(box2);
        } else {
          const box_type = box2.type !== "uuid" ? box2.type : box2.uuid;
          if (this[box_type]) Log.warn("ContainerBox", `Box of type ${box_type} already exists in container box ${this.type}.`);
          else this[box_type] = box2;
        }
      } else return;
    }
  }
};
var SampleEntry = class extends ContainerBox {
  static {
    this.registryId = /* @__PURE__ */ Symbol.for("SampleEntryIdentifier");
  }
  constructor(size, hdr_size, start2) {
    super(size);
    this.hdr_size = hdr_size;
    this.start = start2;
  }
  /** @bundle box-codecs.js */
  isVideo() {
    return false;
  }
  /** @bundle box-codecs.js */
  isAudio() {
    return false;
  }
  /** @bundle box-codecs.js */
  isSubtitle() {
    return false;
  }
  /** @bundle box-codecs.js */
  isMetadata() {
    return false;
  }
  /** @bundle box-codecs.js */
  isHint() {
    return false;
  }
  /** @bundle box-codecs.js */
  getCodec() {
    return this.type.replace(".", "");
  }
  /** @bundle box-codecs.js */
  getWidth() {
    return "";
  }
  /** @bundle box-codecs.js */
  getHeight() {
    return "";
  }
  /** @bundle box-codecs.js */
  getChannelCount() {
    return "";
  }
  /** @bundle box-codecs.js */
  getSampleRate() {
    return "";
  }
  /** @bundle box-codecs.js */
  getSampleSize() {
    return "";
  }
  /** @bundle parsing/sampleentries/sampleentry.js */
  parseHeader(stream) {
    stream.readUint8Array(6);
    this.data_reference_index = stream.readUint16();
    this.hdr_size += 8;
  }
  /** @bundle parsing/sampleentries/sampleentry.js */
  parse(stream) {
    this.parseHeader(stream);
    this.data = stream.readUint8Array(this.size - this.hdr_size);
  }
  /** @bundle parsing/sampleentries/sampleentry.js */
  parseDataAndRewind(stream) {
    this.parseHeader(stream);
    this.data = stream.readUint8Array(this.size - this.hdr_size);
    this.hdr_size -= 8;
    stream.seek(this.start + this.hdr_size);
  }
  /** @bundle parsing/sampleentries/sampleentry.js */
  parseFooter(stream) {
    super.parse(stream);
  }
  /** @bundle writing/sampleentry.js */
  writeHeader(stream) {
    this.size = 8;
    super.writeHeader(stream);
    stream.writeUint8(0);
    stream.writeUint8(0);
    stream.writeUint8(0);
    stream.writeUint8(0);
    stream.writeUint8(0);
    stream.writeUint8(0);
    stream.writeUint16(this.data_reference_index);
  }
  /** @bundle writing/sampleentry.js */
  writeFooter(stream) {
    if (this.boxes) for (let i = 0; i < this.boxes.length; i++) {
      this.boxes[i].write(stream);
      this.size += this.boxes[i].size;
    }
    Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
    stream.adjustUint32(this.sizePosition, this.size);
  }
  /** @bundle writing/sampleentry.js */
  write(stream) {
    this.writeHeader(stream);
    stream.writeUint8Array(this.data);
    this.size += this.data.length;
    Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
    stream.adjustUint32(this.sizePosition, this.size);
  }
};
var HintSampleEntry = class extends SampleEntry {
};
var MetadataSampleEntry = class extends SampleEntry {
  /** @bundle box-codecs.js */
  isMetadata() {
    return true;
  }
};
var SubtitleSampleEntry = class extends SampleEntry {
  /** @bundle box-codecs.js */
  isSubtitle() {
    return true;
  }
};
var TextSampleEntry = class extends SampleEntry {
};
var VisualSampleEntry = class extends SampleEntry {
  parse(stream) {
    this.parseHeader(stream);
    stream.readUint16();
    stream.readUint16();
    stream.readUint32Array(3);
    this.width = stream.readUint16();
    this.height = stream.readUint16();
    this.horizresolution = stream.readUint32();
    this.vertresolution = stream.readUint32();
    stream.readUint32();
    this.frame_count = stream.readUint16();
    const compressorname_length = Math.min(31, stream.readUint8());
    this.compressorname = stream.readString(compressorname_length);
    if (compressorname_length < 31) stream.readString(31 - compressorname_length);
    this.depth = stream.readUint16();
    stream.readUint16();
    this.parseFooter(stream);
  }
  /** @bundle box-codecs.js */
  isVideo() {
    return true;
  }
  /** @bundle box-codecs.js */
  getWidth() {
    return this.width;
  }
  /** @bundle box-codecs.js */
  getHeight() {
    return this.height;
  }
  /** @bundle writing/sampleentries/sampleentry.js */
  write(stream) {
    this.writeHeader(stream);
    this.size += 70;
    stream.writeUint16(0);
    stream.writeUint16(0);
    stream.writeUint32(0);
    stream.writeUint32(0);
    stream.writeUint32(0);
    stream.writeUint16(this.width);
    stream.writeUint16(this.height);
    stream.writeUint32(this.horizresolution);
    stream.writeUint32(this.vertresolution);
    stream.writeUint32(0);
    stream.writeUint16(this.frame_count);
    stream.writeUint8(Math.min(31, this.compressorname.length));
    stream.writeString(this.compressorname, void 0, 31);
    stream.writeUint16(this.depth);
    stream.writeInt16(-1);
    this.writeFooter(stream);
  }
};
var AudioSampleEntry = class extends SampleEntry {
  parse(stream) {
    this.parseHeader(stream);
    this.version = stream.readUint16();
    stream.readUint16();
    stream.readUint32();
    this.channel_count = stream.readUint16();
    this.samplesize = stream.readUint16();
    stream.readUint16();
    stream.readUint16();
    this.samplerate = stream.readUint32() / 65536;
    if (stream.isofile?.ftyp?.major_brand.includes("qt")) {
      if (this.version === 1) this.extensions = stream.readUint8Array(16);
      else if (this.version === 2) this.extensions = stream.readUint8Array(36);
    }
    this.parseFooter(stream);
  }
  /** @bundle box-codecs.js */
  isAudio() {
    return true;
  }
  /** @bundle box-codecs.js */
  getChannelCount() {
    return this.channel_count;
  }
  /** @bundle box-codecs.js */
  getSampleRate() {
    return this.samplerate;
  }
  /** @bundle box-codecs.js */
  getSampleSize() {
    return this.samplesize;
  }
  /** @bundle writing/sampleentry.js */
  write(stream) {
    this.writeHeader(stream);
    this.size += 20;
    stream.writeUint32(0);
    stream.writeUint32(0);
    stream.writeUint16(this.channel_count);
    stream.writeUint16(this.samplesize);
    stream.writeUint16(0);
    stream.writeUint16(0);
    stream.writeUint32(this.samplerate << 16);
    this.writeFooter(stream);
  }
};
var SystemSampleEntry = class extends SampleEntry {
  parse(stream) {
    this.parseHeader(stream);
    this.parseFooter(stream);
  }
  /** @bundle writing/sampleentry.js */
  write(stream) {
    this.writeHeader(stream);
    this.writeFooter(stream);
  }
};
var ParameterSetArray = class extends Array {
  toString() {
    let str = "<table class='inner-table'>";
    str += "<thead><tr><th>length</th><th>nalu_data</th></tr></thead>";
    str += "<tbody>";
    for (let i = 0; i < this.length; i++) {
      const nalu = this[i];
      str += "<tr>";
      str += "<td>" + nalu.length + "</td>";
      str += "<td>";
      str += nalu.data.reduce(function(str2, byte) {
        return str2 + byte.toString(16).padStart(2, "0");
      }, "0x");
      str += "</td></tr>";
    }
    str += "</tbody></table>";
    return str;
  }
};
var avcCBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "AVCConfigurationBox";
  }
  static {
    this.fourcc = "avcC";
  }
  parse(stream) {
    this.configurationVersion = stream.readUint8();
    this.AVCProfileIndication = stream.readUint8();
    this.profile_compatibility = stream.readUint8();
    this.AVCLevelIndication = stream.readUint8();
    this.lengthSizeMinusOne = stream.readUint8() & 3;
    this.nb_SPS_nalus = stream.readUint8() & 31;
    let toparse = this.size - this.hdr_size - 6;
    this.SPS = new ParameterSetArray();
    for (let i = 0; i < this.nb_SPS_nalus; i++) {
      const length = stream.readUint16();
      this.SPS.push({
        length,
        data: stream.readUint8Array(length)
      });
      toparse -= 2 + length;
    }
    this.nb_PPS_nalus = stream.readUint8();
    toparse--;
    this.PPS = new ParameterSetArray();
    for (let i = 0; i < this.nb_PPS_nalus; i++) {
      const length = stream.readUint16();
      this.PPS.push({
        length,
        data: stream.readUint8Array(length)
      });
      toparse -= 2 + length;
    }
    if (toparse > 0) this.ext = stream.readUint8Array(toparse);
  }
  /** @bundle writing/avcC.js */
  write(stream) {
    this.size = 7;
    for (let i = 0; i < this.SPS.length; i++) this.size += 2 + this.SPS[i].length;
    for (let i = 0; i < this.PPS.length; i++) this.size += 2 + this.PPS[i].length;
    if (this.ext) this.size += this.ext.length;
    this.writeHeader(stream);
    stream.writeUint8(this.configurationVersion);
    stream.writeUint8(this.AVCProfileIndication);
    stream.writeUint8(this.profile_compatibility);
    stream.writeUint8(this.AVCLevelIndication);
    stream.writeUint8(this.lengthSizeMinusOne + 252);
    stream.writeUint8(this.SPS.length + 224);
    for (let i = 0; i < this.SPS.length; i++) {
      stream.writeUint16(this.SPS[i].length);
      stream.writeUint8Array(this.SPS[i].data);
    }
    stream.writeUint8(this.PPS.length);
    for (let i = 0; i < this.PPS.length; i++) {
      stream.writeUint16(this.PPS[i].length);
      stream.writeUint8Array(this.PPS[i].data);
    }
    if (this.ext) stream.writeUint8Array(this.ext);
  }
};
var mdatBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "MediaDataBox";
  }
  static {
    this.fourcc = "mdat";
  }
};
var idatBox = class extends Box {
  constructor(..._args2) {
    super(..._args2);
    this.box_name = "ItemDataBox";
  }
  static {
    this.fourcc = "idat";
  }
};
var freeBox = class extends Box {
  constructor(..._args3) {
    super(..._args3);
    this.box_name = "FreeSpaceBox";
  }
  static {
    this.fourcc = "free";
  }
};
var skipBox = class extends Box {
  constructor(..._args4) {
    super(..._args4);
    this.box_name = "FreeSpaceBox";
  }
  static {
    this.fourcc = "skip";
  }
};
var hmhdBox = class extends FullBox {
  constructor(..._args5) {
    super(..._args5);
    this.box_name = "HintMediaHeaderBox";
  }
  static {
    this.fourcc = "hmhd";
  }
};
var nmhdBox = class extends FullBox {
  constructor(..._args6) {
    super(..._args6);
    this.box_name = "NullMediaHeaderBox";
  }
  static {
    this.fourcc = "nmhd";
  }
};
var iodsBox = class extends FullBox {
  constructor(..._args7) {
    super(..._args7);
    this.box_name = "ObjectDescriptorBox";
  }
  static {
    this.fourcc = "iods";
  }
};
var xmlBox = class extends FullBox {
  constructor(..._args8) {
    super(..._args8);
    this.box_name = "XMLBox";
  }
  static {
    this.fourcc = "xml ";
  }
};
var bxmlBox = class extends FullBox {
  constructor(..._args9) {
    super(..._args9);
    this.box_name = "BinaryXMLBox";
  }
  static {
    this.fourcc = "bxml";
  }
};
var iproBox = class extends FullBox {
  constructor(..._args10) {
    super(..._args10);
    this.box_name = "ItemProtectionBox";
    this.sinfs = [];
  }
  static {
    this.fourcc = "ipro";
  }
  get protections() {
    return this.sinfs;
  }
};
var moovBox = class extends ContainerBox {
  constructor(..._args11) {
    super(..._args11);
    this.box_name = "MovieBox";
    this.traks = [];
    this.psshs = [];
    this.subBoxNames = ["trak", "pssh"];
  }
  static {
    this.fourcc = "moov";
  }
};
var trakBox = class extends ContainerBox {
  constructor(..._args12) {
    super(..._args12);
    this.box_name = "TrackBox";
    this.samples = [];
  }
  static {
    this.fourcc = "trak";
  }
};
var edtsBox = class extends ContainerBox {
  constructor(..._args13) {
    super(..._args13);
    this.box_name = "EditBox";
  }
  static {
    this.fourcc = "edts";
  }
};
var mdiaBox = class extends ContainerBox {
  constructor(..._args14) {
    super(..._args14);
    this.box_name = "MediaBox";
  }
  static {
    this.fourcc = "mdia";
  }
};
var minfBox = class extends ContainerBox {
  constructor(..._args15) {
    super(..._args15);
    this.box_name = "MediaInformationBox";
  }
  static {
    this.fourcc = "minf";
  }
};
var dinfBox = class extends ContainerBox {
  constructor(..._args16) {
    super(..._args16);
    this.box_name = "DataInformationBox";
  }
  static {
    this.fourcc = "dinf";
  }
};
var stblBox = class extends ContainerBox {
  constructor(..._args17) {
    super(..._args17);
    this.box_name = "SampleTableBox";
    this.sgpds = [];
    this.sbgps = [];
    this.subBoxNames = ["sgpd", "sbgp"];
  }
  static {
    this.fourcc = "stbl";
  }
};
var mvexBox = class extends ContainerBox {
  constructor(..._args18) {
    super(..._args18);
    this.box_name = "MovieExtendsBox";
    this.trexs = [];
    this.subBoxNames = ["trex"];
  }
  static {
    this.fourcc = "mvex";
  }
};
var moofBox = class extends ContainerBox {
  constructor(..._args19) {
    super(..._args19);
    this.box_name = "MovieFragmentBox";
    this.trafs = [];
    this.subBoxNames = ["traf"];
  }
  static {
    this.fourcc = "moof";
  }
};
var trafBox = class extends ContainerBox {
  constructor(..._args20) {
    super(..._args20);
    this.box_name = "TrackFragmentBox";
    this.truns = [];
    this.sgpds = [];
    this.sbgps = [];
    this.subBoxNames = [
      "trun",
      "sgpd",
      "sbgp"
    ];
  }
  static {
    this.fourcc = "traf";
  }
};
var vttcBox = class extends ContainerBox {
  constructor(..._args21) {
    super(..._args21);
    this.box_name = "VTTCueBox";
  }
  static {
    this.fourcc = "vttc";
  }
};
var mfraBox = class extends ContainerBox {
  constructor(..._args22) {
    super(..._args22);
    this.box_name = "MovieFragmentRandomAccessBox";
    this.tfras = [];
    this.subBoxNames = ["tfra"];
  }
  static {
    this.fourcc = "mfra";
  }
};
var mecoBox = class extends ContainerBox {
  constructor(..._args23) {
    super(..._args23);
    this.box_name = "AdditionalMetadataContainerBox";
  }
  static {
    this.fourcc = "meco";
  }
};
var hntiBox = class extends ContainerBox {
  constructor(..._args24) {
    super(..._args24);
    this.box_name = "trackhintinformation";
    this.subBoxNames = ["sdp ", "rtp "];
  }
  static {
    this.fourcc = "hnti";
  }
};
var hinfBox = class extends ContainerBox {
  constructor(..._args25) {
    super(..._args25);
    this.box_name = "hintstatisticsbox";
    this.maxrs = [];
    this.subBoxNames = ["maxr"];
  }
  static {
    this.fourcc = "hinf";
  }
};
var strkBox = class extends ContainerBox {
  constructor(..._args26) {
    super(..._args26);
    this.box_name = "SubTrackBox";
  }
  static {
    this.fourcc = "strk";
  }
};
var strdBox = class extends ContainerBox {
  constructor(..._args27) {
    super(..._args27);
    this.box_name = "SubTrackDefinitionBox";
  }
  static {
    this.fourcc = "strd";
  }
};
var sinfBox = class extends ContainerBox {
  constructor(..._args28) {
    super(..._args28);
    this.box_name = "ProtectionSchemeInfoBox";
  }
  static {
    this.fourcc = "sinf";
  }
};
var rinfBox = class extends ContainerBox {
  constructor(..._args29) {
    super(..._args29);
    this.box_name = "RestrictedSchemeInfoBox";
  }
  static {
    this.fourcc = "rinf";
  }
};
var schiBox = class extends ContainerBox {
  constructor(..._args30) {
    super(..._args30);
    this.box_name = "SchemeInformationBox";
  }
  static {
    this.fourcc = "schi";
  }
};
var trgrBox = class extends ContainerBox {
  constructor(..._args31) {
    super(..._args31);
    this.box_name = "TrackGroupBox";
  }
  static {
    this.fourcc = "trgr";
  }
};
var udtaBox = class extends ContainerBox {
  constructor(..._args32) {
    super(..._args32);
    this.box_name = "UserDataBox";
    this.kinds = [];
    this.strks = [];
    this.subBoxNames = ["kind", "strk"];
  }
  static {
    this.fourcc = "udta";
  }
};
var iprpBox = class extends ContainerBox {
  constructor(..._args33) {
    super(..._args33);
    this.box_name = "ItemPropertiesBox";
    this.ipmas = [];
    this.subBoxNames = ["ipma"];
  }
  static {
    this.fourcc = "iprp";
  }
};
var ipcoBox = class extends ContainerBox {
  constructor(..._args34) {
    super(..._args34);
    this.box_name = "ItemPropertyContainerBox";
    this.hvcCs = [];
    this.ispes = [];
    this.claps = [];
    this.irots = [];
    this.subBoxNames = [
      "hvcC",
      "ispe",
      "clap",
      "irot"
    ];
  }
  static {
    this.fourcc = "ipco";
  }
};
var grplBox = class extends ContainerBox {
  constructor(..._args35) {
    super(..._args35);
    this.box_name = "GroupsListBox";
  }
  static {
    this.fourcc = "grpl";
  }
};
var j2kHBox = class extends ContainerBox {
  constructor(..._args36) {
    super(..._args36);
    this.box_name = "J2KHeaderInfoBox";
  }
  static {
    this.fourcc = "j2kH";
  }
};
var etypBox = class extends ContainerBox {
  constructor(..._args37) {
    super(..._args37);
    this.box_name = "ExtendedTypeBox";
    this.tycos = [];
    this.subBoxNames = ["tyco"];
  }
  static {
    this.fourcc = "etyp";
  }
};
var povdBox = class extends ContainerBox {
  constructor(..._args38) {
    super(..._args38);
    this.box_name = "ProjectedOmniVideoBox";
    this.subBoxNames = ["prfr"];
  }
  static {
    this.fourcc = "povd";
  }
};
var drefBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "DataReferenceBox";
  }
  static {
    this.fourcc = "dref";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.entries = [];
    const entry_count = stream.readUint32();
    for (let i = 0; i < entry_count; i++) {
      const ret = parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
      if (ret.code === 1) {
        const box2 = ret.box;
        this.entries.push(box2);
      } else return;
    }
  }
  /** @bundle writing/dref.js */
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = 4;
    this.writeHeader(stream);
    stream.writeUint32(this.entries.length);
    for (let i = 0; i < this.entries.length; i++) {
      this.entries[i].write(stream);
      this.size += this.entries[i].size;
    }
    Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
    stream.adjustUint32(this.sizePosition, this.size);
  }
};
var elngBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ExtendedLanguageBox";
  }
  static {
    this.fourcc = "elng";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.extended_language = stream.readString(this.size - this.hdr_size);
  }
  /** @bundle writing/elng.js */
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = this.extended_language.length;
    this.writeHeader(stream);
    stream.writeString(this.extended_language);
  }
};
var ftypBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "FileTypeBox";
  }
  static {
    this.fourcc = "ftyp";
  }
  parse(stream) {
    let toparse = this.size - this.hdr_size;
    this.major_brand = stream.readString(4);
    this.minor_version = stream.readUint32();
    const minor_version_str = String.fromCharCode(this.minor_version >> 24, this.minor_version >> 16 & 255, this.minor_version >> 8 & 255, this.minor_version & 255);
    if (minor_version_str.match("[a-zA-Z0-9]{4}")) this.minor_version = minor_version_str;
    toparse -= 8;
    this.compatible_brands = [];
    let i = 0;
    while (toparse >= 4) {
      this.compatible_brands[i] = stream.readString(4);
      toparse -= 4;
      i++;
    }
  }
  /** @bundle writing/ftyp.js */
  write(stream) {
    this.size = 8 + 4 * this.compatible_brands.length;
    this.writeHeader(stream);
    stream.writeString(this.major_brand, void 0, 4);
    if (typeof this.minor_version === "number") stream.writeUint32(this.minor_version);
    else stream.writeString(this.minor_version, void 0, 4);
    for (let i = 0; i < this.compatible_brands.length; i++) stream.writeString(this.compatible_brands[i], void 0, 4);
  }
};
var hdlrBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "HandlerBox";
  }
  static {
    this.fourcc = "hdlr";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.version === 0) {
      stream.readUint32();
      this.handler = stream.readString(4);
      stream.readUint32Array(3);
      if (!this.isEndOfBox(stream)) {
        const name_size = this.start + this.size - stream.getPosition();
        this.name = stream.readCString();
        const end = this.start + this.size - 1;
        stream.seek(end);
        if (stream.readUint8() !== 0 && name_size > 1) {
          Log.info("BoxParser", "Warning: hdlr name is not null-terminated, possibly length-prefixed string. Trimming first byte.");
          this.name = this.name.slice(1);
        }
      }
    }
  }
  /** @bundle writing/hldr.js */
  write(stream) {
    this.size = 20 + this.name.length + 1;
    this.version = 0;
    this.flags = 0;
    this.writeHeader(stream);
    stream.writeUint32(0);
    stream.writeString(this.handler, void 0, 4);
    stream.writeUint32Array([
      0,
      0,
      0
    ]);
    stream.writeCString(this.name);
  }
};
var hvcCBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "HEVCConfigurationBox";
  }
  static {
    this.fourcc = "hvcC";
  }
  parse(stream) {
    this.configurationVersion = stream.readUint8();
    let tmp_byte = stream.readUint8();
    this.general_profile_space = tmp_byte >> 6;
    this.general_tier_flag = (tmp_byte & 32) >> 5;
    this.general_profile_idc = tmp_byte & 31;
    this.general_profile_compatibility = stream.readUint32();
    this.general_constraint_indicator = stream.readUint8Array(6);
    this.general_level_idc = stream.readUint8();
    this.min_spatial_segmentation_idc = stream.readUint16() & 4095;
    this.parallelismType = stream.readUint8() & 3;
    this.chroma_format_idc = stream.readUint8() & 3;
    this.bit_depth_luma_minus8 = stream.readUint8() & 7;
    this.bit_depth_chroma_minus8 = stream.readUint8() & 7;
    this.avgFrameRate = stream.readUint16();
    tmp_byte = stream.readUint8();
    this.constantFrameRate = tmp_byte >> 6;
    this.numTemporalLayers = (tmp_byte & 13) >> 3;
    this.temporalIdNested = (tmp_byte & 4) >> 2;
    this.lengthSizeMinusOne = tmp_byte & 3;
    this.nalu_arrays = [];
    const numOfArrays = stream.readUint8();
    for (let i = 0; i < numOfArrays; i++) {
      const nalu_array = [];
      this.nalu_arrays.push(nalu_array);
      tmp_byte = stream.readUint8();
      nalu_array.completeness = (tmp_byte & 128) >> 7;
      nalu_array.nalu_type = tmp_byte & 63;
      const numNalus = stream.readUint16();
      for (let j = 0; j < numNalus; j++) {
        const length = stream.readUint16();
        nalu_array.push({ data: stream.readUint8Array(length) });
      }
    }
  }
  /** @bundle writing/write.js */
  write(stream) {
    this.size = 23;
    for (let i = 0; i < this.nalu_arrays.length; i++) {
      this.size += 3;
      for (let j = 0; j < this.nalu_arrays[i].length; j++) this.size += 2 + this.nalu_arrays[i][j].data.length;
    }
    this.writeHeader(stream);
    stream.writeUint8(this.configurationVersion);
    stream.writeUint8((this.general_profile_space << 6) + (this.general_tier_flag << 5) + this.general_profile_idc);
    stream.writeUint32(this.general_profile_compatibility);
    stream.writeUint8Array(this.general_constraint_indicator);
    stream.writeUint8(this.general_level_idc);
    stream.writeUint16(this.min_spatial_segmentation_idc + (15 << 24));
    stream.writeUint8(this.parallelismType + 252);
    stream.writeUint8(this.chroma_format_idc + 252);
    stream.writeUint8(this.bit_depth_luma_minus8 + 248);
    stream.writeUint8(this.bit_depth_chroma_minus8 + 248);
    stream.writeUint16(this.avgFrameRate);
    stream.writeUint8((this.constantFrameRate << 6) + (this.numTemporalLayers << 3) + (this.temporalIdNested << 2) + this.lengthSizeMinusOne);
    stream.writeUint8(this.nalu_arrays.length);
    for (let i = 0; i < this.nalu_arrays.length; i++) {
      stream.writeUint8((this.nalu_arrays[i].completeness << 7) + this.nalu_arrays[i].nalu_type);
      stream.writeUint16(this.nalu_arrays[i].length);
      for (let j = 0; j < this.nalu_arrays[i].length; j++) {
        stream.writeUint16(this.nalu_arrays[i][j].data.length);
        stream.writeUint8Array(this.nalu_arrays[i][j].data);
      }
    }
  }
};
var mdhdBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "MediaHeaderBox";
  }
  static {
    this.fourcc = "mdhd";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.version === 1) {
      this.creation_time = stream.readUint64();
      this.modification_time = stream.readUint64();
      this.timescale = stream.readUint32();
      this.duration = stream.readUint64();
    } else {
      this.creation_time = stream.readUint32();
      this.modification_time = stream.readUint32();
      this.timescale = stream.readUint32();
      this.duration = stream.readUint32();
    }
    this.parseLanguage(stream);
    stream.readUint16();
  }
  /** @bundle writing/mdhd.js */
  write(stream) {
    const useVersion1 = this.modification_time > MAX_UINT32 || this.creation_time > MAX_UINT32 || this.duration > MAX_UINT32 || this.version === 1;
    this.version = useVersion1 ? 1 : 0;
    this.size = 20;
    this.size += useVersion1 ? 12 : 0;
    this.flags = 0;
    this.writeHeader(stream);
    if (useVersion1) {
      stream.writeUint64(this.creation_time);
      stream.writeUint64(this.modification_time);
      stream.writeUint32(this.timescale);
      stream.writeUint64(this.duration);
    } else {
      stream.writeUint32(this.creation_time);
      stream.writeUint32(this.modification_time);
      stream.writeUint32(this.timescale);
      stream.writeUint32(this.duration);
    }
    stream.writeUint16(this.language);
    stream.writeUint16(0);
  }
};
var mehdBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "MovieExtendsHeaderBox";
  }
  static {
    this.fourcc = "mehd";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.flags & 1) {
      Log.warn("BoxParser", "mehd box incorrectly uses flags set to 1, converting version to 1");
      this.version = 1;
    }
    if (this.version === 1) this.fragment_duration = stream.readUint64();
    else this.fragment_duration = stream.readUint32();
  }
  /** @bundle writing/mehd.js */
  write(stream) {
    const useVersion1 = this.fragment_duration > MAX_UINT32 || this.version === 1;
    this.version = useVersion1 ? 1 : 0;
    this.size = 4;
    this.size += useVersion1 ? 4 : 0;
    this.flags = 0;
    this.writeHeader(stream);
    if (useVersion1) stream.writeUint64(this.fragment_duration);
    else stream.writeUint32(this.fragment_duration);
  }
};
var infeBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ItemInfoEntry";
  }
  static {
    this.fourcc = "infe";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.version === 0 || this.version === 1) {
      this.item_ID = stream.readUint16();
      this.item_protection_index = stream.readUint16();
      this.item_name = stream.readCString();
      this.content_type = stream.readCString();
      if (!this.isEndOfBox(stream)) this.content_encoding = stream.readCString();
    }
    if (this.version === 1) {
      this.extension_type = stream.readString(4);
      Log.warn("BoxParser", "Cannot parse extension type");
      stream.seek(this.start + this.size);
      return;
    }
    if (this.version >= 2) {
      if (this.version === 2) this.item_ID = stream.readUint16();
      else if (this.version === 3) this.item_ID = stream.readUint32();
      this.item_protection_index = stream.readUint16();
      this.item_type = stream.readString(4);
      this.item_name = stream.readCString();
      if (this.item_type === "mime") {
        this.content_type = stream.readCString();
        this.content_encoding = stream.readCString();
      } else if (this.item_type === "uri ") this.item_uri_type = stream.readCString();
    }
  }
};
var iinfBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ItemInfoBox";
  }
  static {
    this.fourcc = "iinf";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.version === 0) this.entry_count = stream.readUint16();
    else this.entry_count = stream.readUint32();
    this.item_infos = [];
    for (let i = 0; i < this.entry_count; i++) {
      const ret = parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
      if (ret.code === 1) {
        const box2 = ret.box;
        if (box2.type === "infe") this.item_infos[i] = box2;
        else Log.error("BoxParser", "Expected 'infe' box, got " + ret.box.type, stream.isofile);
      } else return;
    }
  }
};
var ilocBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ItemLocationBox";
  }
  static {
    this.fourcc = "iloc";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    let byte;
    byte = stream.readUint8();
    this.offset_size = byte >> 4 & 15;
    this.length_size = byte & 15;
    byte = stream.readUint8();
    this.base_offset_size = byte >> 4 & 15;
    if (this.version === 1 || this.version === 2) this.index_size = byte & 15;
    else this.index_size = 0;
    this.items = [];
    let item_count = 0;
    if (this.version < 2) item_count = stream.readUint16();
    else if (this.version === 2) item_count = stream.readUint32();
    else throw new Error("version of iloc box not supported");
    for (let i = 0; i < item_count; i++) {
      let item_ID = 0;
      let construction_method = 0;
      let base_offset = 0;
      if (this.version < 2) item_ID = stream.readUint16();
      else if (this.version === 2) item_ID = stream.readUint32();
      else throw new Error("version of iloc box not supported");
      if (this.version === 1 || this.version === 2) construction_method = stream.readUint16() & 15;
      else construction_method = 0;
      const data_reference_index = stream.readUint16();
      switch (this.base_offset_size) {
        case 0:
          base_offset = 0;
          break;
        case 4:
          base_offset = stream.readUint32();
          break;
        case 8:
          base_offset = stream.readUint64();
          break;
        default:
          throw new Error("Error reading base offset size");
      }
      const extents = [];
      const extent_count = stream.readUint16();
      for (let j = 0; j < extent_count; j++) {
        let extent_index = 0;
        let extent_offset = 0;
        let extent_length = 0;
        if (this.version === 1 || this.version === 2) switch (this.index_size) {
          case 0:
            extent_index = 0;
            break;
          case 4:
            extent_index = stream.readUint32();
            break;
          case 8:
            extent_index = stream.readUint64();
            break;
          default:
            throw new Error("Error reading extent index");
        }
        switch (this.offset_size) {
          case 0:
            extent_offset = 0;
            break;
          case 4:
            extent_offset = stream.readUint32();
            break;
          case 8:
            extent_offset = stream.readUint64();
            break;
          default:
            throw new Error("Error reading extent index");
        }
        switch (this.length_size) {
          case 0:
            extent_length = 0;
            break;
          case 4:
            extent_length = stream.readUint32();
            break;
          case 8:
            extent_length = stream.readUint64();
            break;
          default:
            throw new Error("Error reading extent index");
        }
        extents.push({
          extent_index,
          extent_length,
          extent_offset
        });
      }
      this.items.push({
        base_offset,
        construction_method,
        item_ID,
        data_reference_index,
        extents
      });
    }
  }
};
var REFERENCE_TYPE_NAMES = {
  auxl: "Auxiliary image item",
  base: "Pre-derived image item base",
  cdsc: "Item describes referenced item",
  dimg: "Derived image item",
  dpnd: "Item coding dependency",
  eroi: "Region",
  evir: "EVC slice",
  exbl: "Scalable image item",
  "fdl ": "File delivery",
  font: "Font item",
  iloc: "Item data location",
  mask: "Region mask",
  mint: "Data integrity",
  pred: "Predictively coded item",
  prem: "Pre-multiplied item",
  tbas: "HEVC tile track base item",
  text: "Text item",
  thmb: "Thumbnail image item"
};
var irefBox = class irefBox2 extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ItemReferenceBox";
    this.references = [];
  }
  static {
    this.fourcc = "iref";
  }
  static {
    this.allowed_types = [
      "auxl",
      "base",
      "cdsc",
      "dimg",
      "dpnd",
      "eroi",
      "evir",
      "exbl",
      "fdl ",
      "font",
      "iloc",
      "mask",
      "mint",
      "pred",
      "prem",
      "tbas",
      "text",
      "thmb"
    ];
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.references = [];
    while (stream.getPosition() < this.start + this.size) {
      const ret = parseOneBox(stream, true, this.size - (stream.getPosition() - this.start));
      if (ret.code === 1) {
        let name = "Unknown item reference";
        if (!irefBox2.allowed_types.includes(ret.type)) Log.warn("BoxParser", `Unknown item reference type: '${ret.type}'`);
        else name = REFERENCE_TYPE_NAMES[ret.type];
        const box2 = this.version === 0 ? new SingleItemTypeReferenceBox(ret.type, ret.size, name, ret.hdr_size, ret.start) : new SingleItemTypeReferenceBoxLarge(ret.type, ret.size, name, ret.hdr_size, ret.start);
        if (box2.write === Box.prototype.write && box2.type !== "mdat") {
          Log.warn("BoxParser", box2.type + " box writing not yet implemented, keeping unparsed data in memory for later write");
          box2.parseDataAndRewind(stream);
        }
        box2.parse(stream);
        this.references.push(box2);
      } else return;
    }
  }
};
var pitmBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "PrimaryItemBox";
  }
  static {
    this.fourcc = "pitm";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.version === 0) this.item_id = stream.readUint16();
    else this.item_id = stream.readUint32();
  }
};
var metaBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "MetaBox";
    this.isQT = false;
  }
  static {
    this.fourcc = "meta";
  }
  parse(stream) {
    const pos = stream.getPosition();
    if (this.size > 8) {
      stream.readUint32();
      switch (stream.readString(4)) {
        case "hdlr":
        case "mhdr":
        case "keys":
        case "ilst":
        case "ctry":
        case "lang":
          this.isQT = true;
          break;
        default:
          break;
      }
      stream.seek(pos);
    }
    if (!this.isQT) this.parseFullHeader(stream);
    ContainerBox.prototype.parse.call(this, stream);
  }
};
var mfhdBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "MovieFragmentHeaderBox";
  }
  static {
    this.fourcc = "mfhd";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.sequence_number = stream.readUint32();
  }
  /** @bundle writing/mfhd.js */
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = 4;
    this.writeHeader(stream);
    stream.writeUint32(this.sequence_number);
  }
};
var mvhdBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "MovieHeaderBox";
  }
  static {
    this.fourcc = "mvhd";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.version === 1) {
      this.creation_time = stream.readUint64();
      this.modification_time = stream.readUint64();
      this.timescale = stream.readUint32();
      this.duration = stream.readUint64();
    } else {
      this.creation_time = stream.readUint32();
      this.modification_time = stream.readUint32();
      this.timescale = stream.readUint32();
      this.duration = stream.readUint32();
    }
    this.rate = stream.readUint32();
    this.volume = stream.readUint16() >> 8;
    stream.readUint16();
    stream.readUint32Array(2);
    this.matrix = stream.readInt32Array(9);
    stream.readUint32Array(6);
    this.next_track_id = stream.readUint32();
  }
  /** @bundle writing/mvhd.js */
  write(stream) {
    const useVersion1 = this.modification_time > MAX_UINT32 || this.creation_time > MAX_UINT32 || this.duration > MAX_UINT32 || this.version === 1;
    this.version = useVersion1 ? 1 : 0;
    this.size = 96;
    this.size += useVersion1 ? 12 : 0;
    this.flags = 0;
    this.writeHeader(stream);
    if (useVersion1) {
      stream.writeUint64(this.creation_time);
      stream.writeUint64(this.modification_time);
      stream.writeUint32(this.timescale);
      stream.writeUint64(this.duration);
    } else {
      stream.writeUint32(this.creation_time);
      stream.writeUint32(this.modification_time);
      stream.writeUint32(this.timescale);
      stream.writeUint32(this.duration);
    }
    stream.writeUint32(this.rate);
    stream.writeUint16(this.volume << 8);
    stream.writeUint16(0);
    stream.writeUint32(0);
    stream.writeUint32(0);
    stream.writeInt32Array(this.matrix);
    stream.writeUint32(0);
    stream.writeUint32(0);
    stream.writeUint32(0);
    stream.writeUint32(0);
    stream.writeUint32(0);
    stream.writeUint32(0);
    stream.writeUint32(this.next_track_id);
  }
  /** @bundle box-print.js */
  print(output) {
    super.printHeader(output);
    output.log(output.indent + "creation_time: " + this.creation_time);
    output.log(output.indent + "modification_time: " + this.modification_time);
    output.log(output.indent + "timescale: " + this.timescale);
    output.log(output.indent + "duration: " + this.duration);
    output.log(output.indent + "rate: " + this.rate);
    output.log(output.indent + "volume: " + (this.volume >> 8));
    output.log(output.indent + "matrix: " + this.matrix.join(", "));
    output.log(output.indent + "next_track_id: " + this.next_track_id);
  }
};
var mettSampleEntry = class extends MetadataSampleEntry {
  static {
    this.fourcc = "mett";
  }
  parse(stream) {
    this.parseHeader(stream);
    this.content_encoding = stream.readCString();
    this.mime_format = stream.readCString();
    this.parseFooter(stream);
  }
};
var metxSampleEntry = class extends MetadataSampleEntry {
  static {
    this.fourcc = "metx";
  }
  parse(stream) {
    this.parseHeader(stream);
    this.content_encoding = stream.readCString();
    this.namespace = stream.readCString();
    this.schema_location = stream.readCString();
    this.parseFooter(stream);
  }
};
var av1CBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "AV1CodecConfigurationBox";
  }
  static {
    this.fourcc = "av1C";
  }
  parse(stream) {
    let tmp = stream.readUint8();
    if ((tmp >> 7 & 1) !== 1) {
      Log.error("BoxParser", "av1C marker problem", stream.isofile);
      return;
    }
    this.version = tmp & 127;
    if (this.version !== 1) {
      Log.error("BoxParser", "av1C version " + this.version + " not supported", stream.isofile);
      return;
    }
    tmp = stream.readUint8();
    this.seq_profile = tmp >> 5 & 7;
    this.seq_level_idx_0 = tmp & 31;
    tmp = stream.readUint8();
    this.seq_tier_0 = tmp >> 7 & 1;
    this.high_bitdepth = tmp >> 6 & 1;
    this.twelve_bit = tmp >> 5 & 1;
    this.monochrome = tmp >> 4 & 1;
    this.chroma_subsampling_x = tmp >> 3 & 1;
    this.chroma_subsampling_y = tmp >> 2 & 1;
    this.chroma_sample_position = tmp & 3;
    tmp = stream.readUint8();
    this.reserved_1 = tmp >> 5 & 7;
    if (this.reserved_1 !== 0) {
      Log.error("BoxParser", "av1C reserved_1 parsing problem", stream.isofile);
      return;
    }
    this.initial_presentation_delay_present = tmp >> 4 & 1;
    if (this.initial_presentation_delay_present === 1) this.initial_presentation_delay_minus_one = tmp & 15;
    else {
      this.reserved_2 = tmp & 15;
      if (this.reserved_2 !== 0) {
        Log.error("BoxParser", "av1C reserved_2 parsing problem", stream.isofile);
        return;
      }
    }
    const configOBUs_length = this.size - this.hdr_size - 4;
    this.configOBUs = stream.readUint8Array(configOBUs_length);
  }
};
var esdsBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ElementaryStreamDescriptorBox";
  }
  static {
    this.fourcc = "esds";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const esd_data = stream.readUint8Array(this.size - this.hdr_size);
    if ("MPEG4DescriptorParser" in DescriptorRegistry) {
      const esd_parser = new DescriptorRegistry.MPEG4DescriptorParser();
      this.esd = esd_parser.parseOneDescriptor(new DataStream(esd_data.buffer, 0));
    }
  }
};
var waveBox = class extends ContainerBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "siDecompressionParamBox";
  }
  static {
    this.fourcc = "wave";
  }
};
var lvcCBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "LCEVCConfigurationBox";
  }
  static {
    this.fourcc = "lvcC";
  }
  parse(stream) {
    this.configurationVersion = stream.readUint8();
    if (this.configurationVersion !== 1) {
      Log.error("BoxParser", "lvcC version " + this.configurationVersion + " not supported", stream.isofile);
      return;
    }
    this.LCEVCProfileIndication = stream.readUint8();
    this.LCEVCLevelIndication = stream.readUint8();
    let tmp_byte = stream.readUint8();
    this.chroma_format_idc = tmp_byte >> 6 & 3;
    this.bit_depth_luma_minus8 = tmp_byte >> 3 & 7;
    this.bit_depth_chroma_minus8 = tmp_byte & 7;
    tmp_byte = stream.readUint8();
    this.lengthSizeMinusOne = tmp_byte >> 6 & 3;
    let reserved = tmp_byte & 63;
    if (reserved !== 63) {
      Log.error("BoxParser", "lvcC reserved parsing problem", stream.isofile);
      return;
    }
    this.pic_width_in_luma_samples = stream.readUint32();
    this.pic_height_in_luma_samples = stream.readUint32();
    tmp_byte = stream.readUint8();
    this.sc_in_stream = tmp_byte >> 7 & 1;
    this.gc_in_stream = tmp_byte >> 6 & 1;
    this.ai_in_stream = tmp_byte >> 5 & 1;
    reserved = tmp_byte & 31;
    if (reserved !== 31) {
      Log.error("BoxParser", "lvcC reserved parsing problem", stream.isofile);
      return;
    }
    this.nalu_arrays = [];
    const numOfArrays = stream.readUint8();
    for (let i = 0; i < numOfArrays; i++) {
      const nalu_array = [];
      this.nalu_arrays.push(nalu_array);
      tmp_byte = stream.readUint8();
      reserved = tmp_byte >> 6 & 3;
      if (reserved !== 0) {
        Log.error("BoxParser", "lvcC reserved parsing problem", stream.isofile);
        return;
      }
      nalu_array.nalu_type = tmp_byte & 63;
      const numOfNalus = stream.readUint16();
      for (let j = 0; j < numOfNalus; j++) {
        const length = stream.readUint16();
        nalu_array.push({ data: stream.readUint8Array(length) });
      }
    }
  }
};
var vpcCBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "VPCodecConfigurationRecord";
  }
  static {
    this.fourcc = "vpcC";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.version === 1) {
      this.profile = stream.readUint8();
      this.level = stream.readUint8();
      const tmp = stream.readUint8();
      this.bitDepth = tmp >> 4;
      this.chromaSubsampling = tmp >> 1 & 7;
      this.videoFullRangeFlag = tmp & 1;
      this.colourPrimaries = stream.readUint8();
      this.transferCharacteristics = stream.readUint8();
      this.matrixCoefficients = stream.readUint8();
      this.codecIntializationDataSize = stream.readUint16();
      this.codecIntializationData = stream.readUint8Array(this.codecIntializationDataSize);
    } else {
      this.profile = stream.readUint8();
      this.level = stream.readUint8();
      let tmp = stream.readUint8();
      this.bitDepth = tmp >> 4 & 15;
      this.colorSpace = tmp & 15;
      tmp = stream.readUint8();
      this.chromaSubsampling = tmp >> 4 & 15;
      this.transferFunction = tmp >> 1 & 7;
      this.videoFullRangeFlag = tmp & 1;
      this.codecIntializationDataSize = stream.readUint16();
      this.codecIntializationData = stream.readUint8Array(this.codecIntializationDataSize);
    }
  }
};
var vvcCBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "VvcConfigurationBox";
  }
  static {
    this.fourcc = "vvcC";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const bitReader = {
      held_bits: void 0,
      num_held_bits: 0,
      stream_read_1_bytes: function(strm) {
        this.held_bits = strm.readUint8();
        this.num_held_bits = 8;
      },
      stream_read_2_bytes: function(strm) {
        this.held_bits = strm.readUint16();
        this.num_held_bits = 16;
      },
      extract_bits: function(num_bits) {
        const ret = this.held_bits >> this.num_held_bits - num_bits & (1 << num_bits) - 1;
        this.num_held_bits -= num_bits;
        return ret;
      }
    };
    bitReader.stream_read_1_bytes(stream);
    bitReader.extract_bits(5);
    this.lengthSizeMinusOne = bitReader.extract_bits(2);
    this.ptl_present_flag = bitReader.extract_bits(1);
    if (this.ptl_present_flag) {
      bitReader.stream_read_2_bytes(stream);
      this.ols_idx = bitReader.extract_bits(9);
      this.num_sublayers = bitReader.extract_bits(3);
      this.constant_frame_rate = bitReader.extract_bits(2);
      this.chroma_format_idc = bitReader.extract_bits(2);
      bitReader.stream_read_1_bytes(stream);
      this.bit_depth_minus8 = bitReader.extract_bits(3);
      bitReader.extract_bits(5);
      bitReader.stream_read_2_bytes(stream);
      bitReader.extract_bits(2);
      this.num_bytes_constraint_info = bitReader.extract_bits(6);
      this.general_profile_idc = bitReader.extract_bits(7);
      this.general_tier_flag = bitReader.extract_bits(1);
      this.general_level_idc = stream.readUint8();
      bitReader.stream_read_1_bytes(stream);
      this.ptl_frame_only_constraint_flag = bitReader.extract_bits(1);
      this.ptl_multilayer_enabled_flag = bitReader.extract_bits(1);
      this.general_constraint_info = new Uint8Array(this.num_bytes_constraint_info);
      if (this.num_bytes_constraint_info) {
        for (let i = 0; i < this.num_bytes_constraint_info - 1; i++) {
          const cnstr1 = bitReader.extract_bits(6);
          bitReader.stream_read_1_bytes(stream);
          const cnstr2 = bitReader.extract_bits(2);
          this.general_constraint_info[i] = cnstr1 << 2 | cnstr2;
        }
        this.general_constraint_info[this.num_bytes_constraint_info - 1] = bitReader.extract_bits(6);
      } else bitReader.extract_bits(6);
      if (this.num_sublayers > 1) {
        bitReader.stream_read_1_bytes(stream);
        this.ptl_sublayer_present_mask = 0;
        for (let j = this.num_sublayers - 2; j >= 0; --j) {
          const val = bitReader.extract_bits(1);
          this.ptl_sublayer_present_mask |= val << j;
        }
        for (let j = this.num_sublayers; j <= 8 && this.num_sublayers > 1; ++j) bitReader.extract_bits(1);
        this.sublayer_level_idc = [];
        for (let j = this.num_sublayers - 2; j >= 0; --j) if (this.ptl_sublayer_present_mask & 1 << j) this.sublayer_level_idc[j] = stream.readUint8();
      }
      this.ptl_num_sub_profiles = stream.readUint8();
      this.general_sub_profile_idc = [];
      if (this.ptl_num_sub_profiles) for (let i = 0; i < this.ptl_num_sub_profiles; i++) this.general_sub_profile_idc.push(stream.readUint32());
      this.max_picture_width = stream.readUint16();
      this.max_picture_height = stream.readUint16();
      this.avg_frame_rate = stream.readUint16();
    }
    const VVC_NALU_OPI = 12;
    const VVC_NALU_DEC_PARAM = 13;
    this.nalu_arrays = [];
    const num_of_arrays = stream.readUint8();
    for (let i = 0; i < num_of_arrays; i++) {
      const nalu_array = [];
      this.nalu_arrays.push(nalu_array);
      bitReader.stream_read_1_bytes(stream);
      nalu_array.completeness = bitReader.extract_bits(1);
      bitReader.extract_bits(2);
      nalu_array.nalu_type = bitReader.extract_bits(5);
      let numNalus = 1;
      if (nalu_array.nalu_type !== VVC_NALU_DEC_PARAM && nalu_array.nalu_type !== VVC_NALU_OPI) numNalus = stream.readUint16();
      for (let j = 0; j < numNalus; j++) {
        const len = stream.readUint16();
        nalu_array.push({
          data: stream.readUint8Array(len),
          length: len
        });
      }
    }
  }
};
var colrBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ColourInformationBox";
  }
  static {
    this.fourcc = "colr";
  }
  parse(stream) {
    this.colour_type = stream.readString(4);
    if (this.colour_type === "nclx") {
      this.colour_primaries = stream.readUint16();
      this.transfer_characteristics = stream.readUint16();
      this.matrix_coefficients = stream.readUint16();
      const tmp = stream.readUint8();
      this.full_range_flag = tmp >> 7;
    } else if (this.colour_type === "rICC") this.ICC_profile = stream.readUint8Array(this.size - 4);
    else if (this.colour_type === "prof") this.ICC_profile = stream.readUint8Array(this.size - 4);
  }
};
function decimalToHex(d, padding) {
  let hex = Number(d).toString(16);
  padding = typeof padding === "undefined" ? 2 : padding;
  while (hex.length < padding) hex = "0" + hex;
  return hex;
}
var avcCSampleEntryBase = class extends VisualSampleEntry {
  /** @bundle box-codecs.js */
  getCodec() {
    const baseCodec = super.getCodec();
    if (this.avcC) return `${baseCodec}.${decimalToHex(this.avcC.AVCProfileIndication)}${decimalToHex(this.avcC.profile_compatibility)}${decimalToHex(this.avcC.AVCLevelIndication)}`;
    else return baseCodec;
  }
};
var avc1SampleEntry = class extends avcCSampleEntryBase {
  constructor(..._args) {
    super(..._args);
    this.box_name = "AVCSampleEntry";
  }
  static {
    this.fourcc = "avc1";
  }
};
var avc2SampleEntry = class extends avcCSampleEntryBase {
  constructor(..._args2) {
    super(..._args2);
    this.box_name = "AVC2SampleEntry";
  }
  static {
    this.fourcc = "avc2";
  }
};
var avc3SampleEntry = class extends avcCSampleEntryBase {
  constructor(..._args3) {
    super(..._args3);
    this.box_name = "AVCSampleEntry";
  }
  static {
    this.fourcc = "avc3";
  }
};
var avc4SampleEntry = class extends avcCSampleEntryBase {
  constructor(..._args4) {
    super(..._args4);
    this.box_name = "AVC2SampleEntry";
  }
  static {
    this.fourcc = "avc4";
  }
};
var av01SampleEntry = class extends VisualSampleEntry {
  constructor(..._args5) {
    super(..._args5);
    this.box_name = "AV1SampleEntry";
  }
  static {
    this.fourcc = "av01";
  }
  /** @bundle box-codecs.js */
  getCodec() {
    const baseCodec = super.getCodec();
    const level_idx_0 = this.av1C.seq_level_idx_0;
    const level = level_idx_0 < 10 ? "0" + level_idx_0 : level_idx_0;
    let bitdepth;
    if (this.av1C.seq_profile === 2 && this.av1C.high_bitdepth === 1) bitdepth = this.av1C.twelve_bit === 1 ? "12" : "10";
    else if (this.av1C.seq_profile <= 2) bitdepth = this.av1C.high_bitdepth === 1 ? "10" : "08";
    return baseCodec + "." + this.av1C.seq_profile + "." + level + (this.av1C.seq_tier_0 ? "H" : "M") + "." + bitdepth;
  }
};
var dav1SampleEntry = class extends VisualSampleEntry {
  static {
    this.fourcc = "dav1";
  }
};
var hvcCSampleEntryBase = class extends VisualSampleEntry {
  /** @bundle box-codecs.js */
  getCodec() {
    let baseCodec = super.getCodec();
    if (this.hvcC) {
      baseCodec += ".";
      switch (this.hvcC.general_profile_space) {
        case 0:
          baseCodec += "";
          break;
        case 1:
          baseCodec += "A";
          break;
        case 2:
          baseCodec += "B";
          break;
        case 3:
          baseCodec += "C";
          break;
      }
      baseCodec += this.hvcC.general_profile_idc;
      baseCodec += ".";
      let val = this.hvcC.general_profile_compatibility;
      let reversed = 0;
      for (let i = 0; i < 32; i++) {
        reversed |= val & 1;
        if (i === 31) break;
        reversed <<= 1;
        val >>= 1;
      }
      baseCodec += decimalToHex(reversed, 0);
      baseCodec += ".";
      if (this.hvcC.general_tier_flag === 0) baseCodec += "L";
      else baseCodec += "H";
      baseCodec += this.hvcC.general_level_idc;
      let hasByte = false;
      let constraint_string = "";
      for (let i = 5; i >= 0; i--) if (this.hvcC.general_constraint_indicator[i] || hasByte) {
        constraint_string = "." + decimalToHex(this.hvcC.general_constraint_indicator[i], 0) + constraint_string;
        hasByte = true;
      }
      baseCodec += constraint_string;
    }
    return baseCodec;
  }
};
var hvc1SampleEntry = class extends hvcCSampleEntryBase {
  constructor(..._args6) {
    super(..._args6);
    this.box_name = "HEVCSampleEntry";
  }
  static {
    this.fourcc = "hvc1";
  }
};
var hvc2SampleEntry = class extends hvcCSampleEntryBase {
  static {
    this.fourcc = "hvc2";
  }
};
var hev1SampleEntry = class extends hvcCSampleEntryBase {
  constructor(..._args7) {
    super(..._args7);
    this.box_name = "HEVCSampleEntry";
    this.colrs = [];
    this.subBoxNames = ["colr"];
  }
  static {
    this.fourcc = "hev1";
  }
};
var hev2SampleEntry = class extends hvcCSampleEntryBase {
  static {
    this.fourcc = "hev2";
  }
};
var hvt1SampleEntry = class extends VisualSampleEntry {
  constructor(..._args8) {
    super(..._args8);
    this.box_name = "HEVCTileSampleSampleEntry";
  }
  static {
    this.fourcc = "hvt1";
  }
};
var lhe1SampleEntry = class extends VisualSampleEntry {
  constructor(..._args9) {
    super(..._args9);
    this.box_name = "LHEVCSampleEntry";
  }
  static {
    this.fourcc = "lhe1";
  }
};
var lhv1SampleEntry = class extends VisualSampleEntry {
  constructor(..._args10) {
    super(..._args10);
    this.box_name = "LHEVCSampleEntry";
  }
  static {
    this.fourcc = "lhv1";
  }
};
var lvc1SampleEntry = class extends VisualSampleEntry {
  constructor(..._args11) {
    super(..._args11);
    this.box_name = "LCEVCSampleEntry";
  }
  static {
    this.fourcc = "lvc1";
  }
  /** @bundle box-codecs.js */
  getCodec() {
    let baseCodec = super.getCodec();
    if (this.lvcC) {
      baseCodec += ".";
      baseCodec += "vprf";
      baseCodec += this.lvcC.LCEVCProfileIndication;
      baseCodec += ".";
      baseCodec += "vlev";
      baseCodec += this.lvcC.LCEVCLevelIndication;
    }
    return baseCodec;
  }
};
var dvh1SampleEntry = class extends VisualSampleEntry {
  static {
    this.fourcc = "dvh1";
  }
};
var dvheSampleEntry = class extends VisualSampleEntry {
  static {
    this.fourcc = "dvhe";
  }
};
var vvcCSampleEntryBase = class extends VisualSampleEntry {
  getCodec() {
    let baseCodec = super.getCodec();
    if (this.vvcC) {
      baseCodec += "." + this.vvcC.general_profile_idc;
      if (this.vvcC.general_tier_flag) baseCodec += ".H";
      else baseCodec += ".L";
      baseCodec += this.vvcC.general_level_idc;
      let constraint_string = "";
      if (this.vvcC.general_constraint_info) {
        const bytes2 = [];
        let byte = 0;
        byte |= this.vvcC.ptl_frame_only_constraint_flag << 7;
        byte |= this.vvcC.ptl_multilayer_enabled_flag << 6;
        let last_nonzero;
        for (let i = 0; i < this.vvcC.general_constraint_info.length; ++i) {
          byte |= this.vvcC.general_constraint_info[i] >> 2 & 63;
          bytes2.push(byte);
          if (byte) last_nonzero = i;
          byte = this.vvcC.general_constraint_info[i] >> 2 & 3;
        }
        if (last_nonzero === void 0) constraint_string = ".CA";
        else {
          constraint_string = ".C";
          const base32_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
          let held_bits = 0;
          let num_held_bits = 0;
          for (let i = 0; i <= last_nonzero; ++i) {
            held_bits = held_bits << 8 | bytes2[i];
            num_held_bits += 8;
            while (num_held_bits >= 5) {
              const val = held_bits >> num_held_bits - 5 & 31;
              constraint_string += base32_chars[val];
              num_held_bits -= 5;
              held_bits &= (1 << num_held_bits) - 1;
            }
          }
          if (num_held_bits) {
            held_bits <<= 5 - num_held_bits;
            constraint_string += base32_chars[held_bits & 31];
          }
        }
      }
      baseCodec += constraint_string;
    }
    return baseCodec;
  }
};
var vvc1SampleEntry = class extends vvcCSampleEntryBase {
  constructor(..._args12) {
    super(..._args12);
    this.box_name = "VvcSampleEntry";
  }
  static {
    this.fourcc = "vvc1";
  }
};
var vvi1SampleEntry = class extends vvcCSampleEntryBase {
  constructor(..._args13) {
    super(..._args13);
    this.box_name = "VvcSampleEntry";
  }
  static {
    this.fourcc = "vvi1";
  }
};
var vvs1SampleEntry = class extends VisualSampleEntry {
  constructor(..._args14) {
    super(..._args14);
    this.box_name = "VvcSampleEntry";
  }
  static {
    this.fourcc = "vvs1";
  }
};
var vvcNSampleEntry = class extends VisualSampleEntry {
  constructor(..._args15) {
    super(..._args15);
    this.box_name = "VvcNonVCLSampleEntry";
  }
  static {
    this.fourcc = "vvcN";
  }
};
var vpcCSampleEntryBase = class extends VisualSampleEntry {
  getCodec() {
    const baseCodec = super.getCodec();
    let level = this.vpcC.level;
    if (level === 0) level = "00";
    let bitDepth = this.vpcC.bitDepth;
    if (bitDepth === 8) bitDepth = "08";
    return `${baseCodec}.0${this.vpcC.profile}.${level}.${bitDepth}`;
  }
};
var vp08SampleEntry = class extends vpcCSampleEntryBase {
  static {
    this.fourcc = "vp08";
  }
};
var vp09SampleEntry = class extends vpcCSampleEntryBase {
  static {
    this.fourcc = "vp09";
  }
};
var avs3SampleEntry = class extends VisualSampleEntry {
  static {
    this.fourcc = "avs3";
  }
};
var j2kiSampleEntry = class extends VisualSampleEntry {
  constructor(..._args16) {
    super(..._args16);
    this.box_name = "J2KSampleEntry";
  }
  static {
    this.fourcc = "j2ki";
  }
};
var mjp2SampleEntry = class extends VisualSampleEntry {
  static {
    this.fourcc = "mjp2";
  }
};
var mjpgSampleEntry = class extends VisualSampleEntry {
  static {
    this.fourcc = "mjpg";
  }
};
var uncvSampleEntry = class extends VisualSampleEntry {
  constructor(..._args17) {
    super(..._args17);
    this.box_name = "UncompressedVideoSampleEntry";
  }
  static {
    this.fourcc = "uncv";
  }
};
var mp4vSampleEntry = class extends VisualSampleEntry {
  constructor(..._args18) {
    super(..._args18);
    this.box_name = "MP4VisualSampleEntry";
  }
  static {
    this.fourcc = "mp4v";
  }
};
var mp4aSampleEntry = class extends AudioSampleEntry {
  constructor(..._args19) {
    super(..._args19);
    this.box_name = "MP4AudioSampleEntry";
  }
  static {
    this.fourcc = "mp4a";
  }
  getCodec() {
    const baseCodec = super.getCodec();
    const esds2 = this.esds ?? this.wave?.esds;
    if (esds2 && esds2.esd) {
      const oti = esds2.esd.getOTI();
      const dsi = esds2.esd.getAudioConfig();
      return baseCodec + "." + decimalToHex(oti) + (dsi ? "." + dsi : "");
    } else return baseCodec;
  }
};
var m4aeSampleEntry = class extends AudioSampleEntry {
  static {
    this.fourcc = "m4ae";
  }
};
var ac_3SampleEntry = class extends AudioSampleEntry {
  static {
    this.fourcc = "ac-3";
  }
};
var ac_4SampleEntry = class extends AudioSampleEntry {
  static {
    this.fourcc = "ac-4";
  }
};
var ec_3SampleEntry = class extends AudioSampleEntry {
  static {
    this.fourcc = "ec-3";
  }
};
var OpusSampleEntry = class extends AudioSampleEntry {
  static {
    this.fourcc = "Opus";
  }
};
var mha1SampleEntry = class extends AudioSampleEntry {
  static {
    this.fourcc = "mha1";
  }
};
var mha2SampleEntry = class extends AudioSampleEntry {
  static {
    this.fourcc = "mha2";
  }
};
var mhm1SampleEntry = class extends AudioSampleEntry {
  static {
    this.fourcc = "mhm1";
  }
};
var mhm2SampleEntry = class extends AudioSampleEntry {
  static {
    this.fourcc = "mhm2";
  }
};
var fLaCSampleEntry = class extends AudioSampleEntry {
  static {
    this.fourcc = "fLaC";
  }
};
var encvSampleEntry = class extends VisualSampleEntry {
  static {
    this.fourcc = "encv";
  }
};
var encaSampleEntry = class extends AudioSampleEntry {
  static {
    this.fourcc = "enca";
  }
};
var encuSampleEntry = class extends SubtitleSampleEntry {
  constructor(..._args20) {
    super(..._args20);
    this.subBoxNames = ["sinf"];
    this.sinfs = [];
  }
  static {
    this.fourcc = "encu";
  }
};
var encsSampleEntry = class extends SystemSampleEntry {
  constructor(..._args21) {
    super(..._args21);
    this.subBoxNames = ["sinf"];
    this.sinfs = [];
  }
  static {
    this.fourcc = "encs";
  }
};
var mp4sSampleEntry = class extends SystemSampleEntry {
  static {
    this.fourcc = "mp4s";
  }
};
var enctSampleEntry = class extends TextSampleEntry {
  constructor(..._args22) {
    super(..._args22);
    this.subBoxNames = ["sinf"];
    this.sinfs = [];
  }
  static {
    this.fourcc = "enct";
  }
};
var encmSampleEntry = class extends MetadataSampleEntry {
  constructor(..._args23) {
    super(..._args23);
    this.subBoxNames = ["sinf"];
    this.sinfs = [];
  }
  static {
    this.fourcc = "encm";
  }
};
var resvSampleEntry = class extends VisualSampleEntry {
  constructor(..._args24) {
    super(..._args24);
    this.box_name = "RestrictedVideoSampleEntry";
  }
  static {
    this.fourcc = "resv";
  }
};
var sbttSampleEntry = class extends SubtitleSampleEntry {
  static {
    this.fourcc = "sbtt";
  }
  parse(stream) {
    this.parseHeader(stream);
    this.content_encoding = stream.readCString();
    this.mime_format = stream.readCString();
    this.parseFooter(stream);
  }
};
var stppSampleEntry = class extends SubtitleSampleEntry {
  static {
    this.fourcc = "stpp";
  }
  parse(stream) {
    this.parseHeader(stream);
    this.namespace = stream.readCString();
    this.schema_location = stream.readCString();
    this.auxiliary_mime_types = stream.readCString();
    this.parseFooter(stream);
  }
  /** @bundle writing/sampleentry.js */
  write(stream) {
    this.writeHeader(stream);
    this.size += this.namespace.length + 1 + this.schema_location.length + 1 + this.auxiliary_mime_types.length + 1;
    stream.writeCString(this.namespace);
    stream.writeCString(this.schema_location);
    stream.writeCString(this.auxiliary_mime_types);
    this.writeFooter(stream);
  }
};
var stxtSampleEntry = class extends SubtitleSampleEntry {
  static {
    this.fourcc = "stxt";
  }
  parse(stream) {
    this.parseHeader(stream);
    this.content_encoding = stream.readCString();
    this.mime_format = stream.readCString();
    this.parseFooter(stream);
  }
  getCodec() {
    const baseCodec = super.getCodec();
    if (this.mime_format) return baseCodec + "." + this.mime_format;
    else return baseCodec;
  }
};
var tx3gSampleEntry = class extends SubtitleSampleEntry {
  static {
    this.fourcc = "tx3g";
  }
  parse(stream) {
    this.parseHeader(stream);
    this.displayFlags = stream.readUint32();
    this.horizontal_justification = stream.readInt8();
    this.vertical_justification = stream.readInt8();
    this.bg_color_rgba = stream.readUint8Array(4);
    this.box_record = stream.readInt16Array(4);
    this.style_record = stream.readUint8Array(12);
    this.parseFooter(stream);
  }
};
var wvttSampleEntry = class extends MetadataSampleEntry {
  static {
    this.fourcc = "wvtt";
  }
  parse(stream) {
    this.parseHeader(stream);
    this.parseFooter(stream);
  }
};
var sbgpBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SampleToGroupBox";
  }
  static {
    this.fourcc = "sbgp";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.grouping_type = stream.readString(4);
    if (this.version === 1) this.grouping_type_parameter = stream.readUint32();
    else this.grouping_type_parameter = 0;
    this.entries = [];
    const entry_count = stream.readUint32();
    for (let i = 0; i < entry_count; i++) this.entries.push({
      sample_count: stream.readInt32(),
      group_description_index: stream.readInt32()
    });
  }
  /** @bundle writing/sbgp.js */
  write(stream) {
    if (this.grouping_type_parameter) this.version = 1;
    else this.version = 0;
    this.flags = 0;
    this.size = 8 + 8 * this.entries.length + (this.version === 1 ? 4 : 0);
    this.writeHeader(stream);
    stream.writeString(this.grouping_type, void 0, 4);
    if (this.version === 1) stream.writeUint32(this.grouping_type_parameter);
    stream.writeUint32(this.entries.length);
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      stream.writeInt32(entry.sample_count);
      stream.writeInt32(entry.group_description_index);
    }
  }
};
var sdtpBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SampleDependencyTypeBox";
  }
  static {
    this.fourcc = "sdtp";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const count = this.size - this.hdr_size;
    this.is_leading = [];
    this.sample_depends_on = [];
    this.sample_is_depended_on = [];
    this.sample_has_redundancy = [];
    for (let i = 0; i < count; i++) {
      const tmp_byte = stream.readUint8();
      this.is_leading[i] = tmp_byte >> 6;
      this.sample_depends_on[i] = tmp_byte >> 4 & 3;
      this.sample_is_depended_on[i] = tmp_byte >> 2 & 3;
      this.sample_has_redundancy[i] = tmp_byte & 3;
    }
  }
};
var sgpdBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SampleGroupDescriptionBox";
  }
  static {
    this.fourcc = "sgpd";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.grouping_type = stream.readString(4);
    Log.debug("BoxParser", "Found Sample Groups of type " + this.grouping_type);
    if (this.version === 1) this.default_length = stream.readUint32();
    else this.default_length = 0;
    if (this.version >= 2) this.default_group_description_index = stream.readUint32();
    this.entries = [];
    const entry_count = stream.readUint32();
    for (let i = 0; i < entry_count; i++) {
      let entry;
      if (this.grouping_type in BoxRegistry.sampleGroupEntry) entry = new BoxRegistry.sampleGroupEntry[this.grouping_type](this.grouping_type);
      else entry = new SampleGroupEntry(this.grouping_type);
      this.entries.push(entry);
      if (this.version === 1) if (this.default_length === 0) entry.description_length = stream.readUint32();
      else entry.description_length = this.default_length;
      else entry.description_length = this.default_length;
      if (entry.write === SampleGroupEntry.prototype.write) {
        Log.info("BoxParser", "SampleGroup for type " + this.grouping_type + " writing not yet implemented, keeping unparsed data in memory for later write");
        entry.data = stream.readUint8Array(entry.description_length);
        stream.seek(stream.getPosition() - entry.description_length);
      }
      entry.parse(stream);
    }
  }
  /** @bundle writing/sgpd.js */
  write(stream) {
    this.flags = 0;
    this.size = 12;
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (this.version === 1) {
        if (this.default_length === 0) this.size += 4;
        this.size += entry.data.length;
      }
    }
    this.writeHeader(stream);
    stream.writeString(this.grouping_type, void 0, 4);
    if (this.version === 1) stream.writeUint32(this.default_length);
    if (this.version >= 2) stream.writeUint32(this.default_sample_description_index);
    stream.writeUint32(this.entries.length);
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (this.version === 1) {
        if (this.default_length === 0) stream.writeUint32(entry.description_length);
      }
      entry.write(stream);
    }
  }
};
var sidxBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CompressedSegmentIndexBox";
  }
  static {
    this.fourcc = "sidx";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.reference_ID = stream.readUint32();
    this.timescale = stream.readUint32();
    if (this.version === 0) {
      this.earliest_presentation_time = stream.readUint32();
      this.first_offset = stream.readUint32();
    } else {
      this.earliest_presentation_time = stream.readUint64();
      this.first_offset = stream.readUint64();
    }
    stream.readUint16();
    this.references = [];
    const count = stream.readUint16();
    for (let i = 0; i < count; i++) {
      const type = stream.readUint32();
      const subsegment_duration = stream.readUint32();
      const sap = stream.readUint32();
      this.references.push({
        reference_type: type >> 31 & 1,
        referenced_size: type & 2147483647,
        subsegment_duration,
        starts_with_SAP: sap >> 31 & 1,
        SAP_type: sap >> 28 & 7,
        SAP_delta_time: sap & 268435455
      });
    }
  }
  /** @bundle writing/sidx.js */
  write(stream) {
    const useVersion1 = this.earliest_presentation_time > MAX_UINT32 || this.first_offset > MAX_UINT32 || this.version === 1;
    this.version = useVersion1 ? 1 : 0;
    this.size = 12 + 12 * this.references.length;
    this.size += useVersion1 ? 16 : 8;
    this.flags = 0;
    this.writeHeader(stream);
    stream.writeUint32(this.reference_ID);
    stream.writeUint32(this.timescale);
    if (useVersion1) {
      stream.writeUint64(this.earliest_presentation_time);
      stream.writeUint64(this.first_offset);
    } else {
      stream.writeUint32(this.earliest_presentation_time);
      stream.writeUint32(this.first_offset);
    }
    stream.writeUint16(0);
    stream.writeUint16(this.references.length);
    for (let i = 0; i < this.references.length; i++) {
      const ref = this.references[i];
      stream.writeUint32(ref.reference_type << 31 | ref.referenced_size);
      stream.writeUint32(ref.subsegment_duration);
      stream.writeUint32(ref.starts_with_SAP << 31 | ref.SAP_type << 28 | ref.SAP_delta_time);
    }
  }
};
var smhdBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SoundMediaHeaderBox";
  }
  static {
    this.fourcc = "smhd";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.balance = stream.readUint16();
    stream.readUint16();
  }
  /** @bundle writing/smhd.js */
  write(stream) {
    this.version = 0;
    this.size = 4;
    this.writeHeader(stream);
    stream.writeUint16(this.balance);
    stream.writeUint16(0);
  }
};
var stcoBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ChunkOffsetBox";
  }
  static {
    this.fourcc = "stco";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const entry_count = stream.readUint32();
    this.chunk_offsets = [];
    if (this.version === 0) for (let i = 0; i < entry_count; i++) this.chunk_offsets.push(stream.readUint32());
  }
  /** @bundle writings/stco.js */
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = 4 + 4 * this.chunk_offsets.length;
    this.writeHeader(stream);
    stream.writeUint32(this.chunk_offsets.length);
    stream.writeUint32Array(this.chunk_offsets);
  }
  /** @bundle box-unpack.js */
  unpack(samples) {
    for (let i = 0; i < this.chunk_offsets.length; i++) samples[i].offset = this.chunk_offsets[i];
  }
};
var sthdBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SubtitleMediaHeaderBox";
  }
  static {
    this.fourcc = "sthd";
  }
};
var stscBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SampleToChunkBox";
  }
  static {
    this.fourcc = "stsc";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const entry_count = stream.readUint32();
    this.first_chunk = [];
    this.samples_per_chunk = [];
    this.sample_description_index = [];
    if (this.version === 0) for (let i = 0; i < entry_count; i++) {
      this.first_chunk.push(stream.readUint32());
      this.samples_per_chunk.push(stream.readUint32());
      this.sample_description_index.push(stream.readUint32());
    }
  }
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = 4 + 12 * this.first_chunk.length;
    this.writeHeader(stream);
    stream.writeUint32(this.first_chunk.length);
    for (let i = 0; i < this.first_chunk.length; i++) {
      stream.writeUint32(this.first_chunk[i]);
      stream.writeUint32(this.samples_per_chunk[i]);
      stream.writeUint32(this.sample_description_index[i]);
    }
  }
  unpack(samples) {
    let l = 0;
    let m = 0;
    for (let i = 0; i < this.first_chunk.length; i++) for (let j = 0; j < (i + 1 < this.first_chunk.length ? this.first_chunk[i + 1] : Infinity); j++) {
      m++;
      for (let k = 0; k < this.samples_per_chunk[i]; k++) {
        if (samples[l]) {
          samples[l].description_index = this.sample_description_index[i];
          samples[l].chunk_index = m;
        } else return;
        l++;
      }
    }
  }
};
var stsdBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SampleDescriptionBox";
  }
  static {
    this.fourcc = "stsd";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.entries = [];
    const entryCount = stream.readUint32();
    for (let i = 1; i <= entryCount; i++) {
      const ret = parseOneBox(stream, true, this.size - (stream.getPosition() - this.start));
      if (ret.code === 1) {
        let box2;
        if (ret.type in BoxRegistry.sampleEntry) {
          box2 = new BoxRegistry.sampleEntry[ret.type](ret.size);
          box2.hdr_size = ret.hdr_size;
          box2.start = ret.start;
        } else {
          Log.warn("BoxParser", `Unknown sample entry type: '${ret.type}'`);
          box2 = new SampleEntry(ret.size, ret.hdr_size, ret.start);
          box2.type = ret.type;
        }
        if (box2.write === SampleEntry.prototype.write) {
          Log.info("BoxParser", "SampleEntry " + box2.type + " box writing not yet implemented, keeping unparsed data in memory for later write");
          box2.parseDataAndRewind(stream);
        }
        box2.parse(stream);
        this.entries.push(box2);
      } else return;
    }
  }
  /** @bundle writing/stsd.js */
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = 0;
    this.writeHeader(stream);
    stream.writeUint32(this.entries.length);
    this.size += 4;
    for (let i = 0; i < this.entries.length; i++) {
      this.entries[i].write(stream);
      this.size += this.entries[i].size;
    }
    Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
    stream.adjustUint32(this.sizePosition, this.size);
  }
};
var stszBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SampleSizeBox";
  }
  static {
    this.fourcc = "stsz";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.sample_sizes = [];
    if (this.version === 0) {
      this.sample_size = stream.readUint32();
      this.sample_count = stream.readUint32();
      for (let i = 0; i < this.sample_count; i++) if (this.sample_size === 0) this.sample_sizes.push(stream.readUint32());
      else this.sample_sizes[i] = this.sample_size;
    }
  }
  /** @bundle writing/stsz.js */
  write(stream) {
    let constant = true;
    this.version = 0;
    this.flags = 0;
    if (this.sample_sizes.length > 0 && this.sample_size === 0) constant = false;
    this.size = 8;
    if (!constant) this.size += 4 * this.sample_sizes.length;
    this.writeHeader(stream);
    stream.writeUint32(this.sample_size);
    stream.writeUint32(this.sample_sizes.length);
    if (!constant) stream.writeUint32Array(this.sample_sizes);
  }
  /** @bundle box-unpack.js */
  unpack(samples) {
    for (let i = 0; i < this.sample_sizes.length; i++) samples[i].size = this.sample_sizes[i];
  }
};
var sttsBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TimeToSampleBox";
    this.sample_counts = [];
    this.sample_deltas = [];
  }
  static {
    this.fourcc = "stts";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const entry_count = stream.readUint32();
    this.sample_counts.length = 0;
    this.sample_deltas.length = 0;
    if (this.version === 0) for (let i = 0; i < entry_count; i++) {
      this.sample_counts.push(stream.readUint32());
      let delta = stream.readInt32();
      if (delta < 0) {
        Log.warn("BoxParser", "File uses negative stts sample delta, using value 1 instead, sync may be lost!");
        delta = 1;
      }
      this.sample_deltas.push(delta);
    }
  }
  /** @bundle writing/stts.js */
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = 4 + 8 * this.sample_counts.length;
    this.writeHeader(stream);
    stream.writeUint32(this.sample_counts.length);
    for (let i = 0; i < this.sample_counts.length; i++) {
      stream.writeUint32(this.sample_counts[i]);
      stream.writeUint32(this.sample_deltas[i]);
    }
  }
  /** @bundle box-unpack.js */
  unpack(samples) {
    let k = 0;
    for (let i = 0; i < this.sample_counts.length; i++) for (let j = 0; j < this.sample_counts[i]; j++) {
      if (k === 0) samples[k].dts = 0;
      else samples[k].dts = samples[k - 1].dts + this.sample_deltas[i];
      k++;
    }
  }
};
var tfdtBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackFragmentBaseMediaDecodeTimeBox";
  }
  static {
    this.fourcc = "tfdt";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.version === 1) this.baseMediaDecodeTime = stream.readUint64();
    else this.baseMediaDecodeTime = stream.readUint32();
  }
  /** @bundle writing/tdft.js */
  write(stream) {
    const useVersion1 = this.baseMediaDecodeTime > MAX_UINT32 || this.version === 1;
    this.version = useVersion1 ? 1 : 0;
    this.size = 4;
    this.size += useVersion1 ? 4 : 0;
    this.flags = 0;
    this.writeHeader(stream);
    if (useVersion1) stream.writeUint64(this.baseMediaDecodeTime);
    else stream.writeUint32(this.baseMediaDecodeTime);
  }
};
var tfhdBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackFragmentHeaderBox";
  }
  static {
    this.fourcc = "tfhd";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    let readBytes = 0;
    this.track_id = stream.readUint32();
    if (this.size - this.hdr_size > readBytes && this.flags & 1) {
      this.base_data_offset = stream.readUint64();
      readBytes += 8;
    } else this.base_data_offset = 0;
    if (this.size - this.hdr_size > readBytes && this.flags & 2) {
      this.default_sample_description_index = stream.readUint32();
      readBytes += 4;
    } else this.default_sample_description_index = 0;
    if (this.size - this.hdr_size > readBytes && this.flags & 8) {
      this.default_sample_duration = stream.readUint32();
      readBytes += 4;
    } else this.default_sample_duration = 0;
    if (this.size - this.hdr_size > readBytes && this.flags & 16) {
      this.default_sample_size = stream.readUint32();
      readBytes += 4;
    } else this.default_sample_size = 0;
    if (this.size - this.hdr_size > readBytes && this.flags & 32) {
      this.default_sample_flags = stream.readUint32();
      readBytes += 4;
    } else this.default_sample_flags = 0;
  }
  /** @bundle writing/tfhd.js */
  write(stream) {
    this.version = 0;
    this.size = 4;
    if (this.flags & 1) this.size += 8;
    if (this.flags & 2) this.size += 4;
    if (this.flags & 8) this.size += 4;
    if (this.flags & 16) this.size += 4;
    if (this.flags & 32) this.size += 4;
    this.writeHeader(stream);
    stream.writeUint32(this.track_id);
    if (this.flags & 1) stream.writeUint64(this.base_data_offset);
    if (this.flags & 2) stream.writeUint32(this.default_sample_description_index);
    if (this.flags & 8) stream.writeUint32(this.default_sample_duration);
    if (this.flags & 16) stream.writeUint32(this.default_sample_size);
    if (this.flags & 32) stream.writeUint32(this.default_sample_flags);
  }
};
var tkhdBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackHeaderBox";
    this.layer = 0;
    this.alternate_group = 0;
  }
  static {
    this.fourcc = "tkhd";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.version === 1) {
      this.creation_time = stream.readUint64();
      this.modification_time = stream.readUint64();
      this.track_id = stream.readUint32();
      stream.readUint32();
      this.duration = stream.readUint64();
    } else {
      this.creation_time = stream.readUint32();
      this.modification_time = stream.readUint32();
      this.track_id = stream.readUint32();
      stream.readUint32();
      this.duration = stream.readUint32();
    }
    stream.readUint32Array(2);
    this.layer = stream.readInt16();
    this.alternate_group = stream.readInt16();
    this.volume = stream.readInt16() >> 8;
    stream.readUint16();
    this.matrix = stream.readInt32Array(9);
    this.width = stream.readUint32();
    this.height = stream.readUint32();
  }
  write(stream) {
    const useVersion1 = this.modification_time > MAX_UINT32 || this.creation_time > MAX_UINT32 || this.duration > MAX_UINT32 || this.version === 1;
    this.version = useVersion1 ? 1 : 0;
    this.size = 80;
    this.size += useVersion1 ? 12 : 0;
    this.flags = this.flags ?? 3;
    this.writeHeader(stream);
    if (useVersion1) {
      stream.writeUint64(this.creation_time);
      stream.writeUint64(this.modification_time);
      stream.writeUint32(this.track_id);
      stream.writeUint32(0);
      stream.writeUint64(this.duration);
    } else {
      stream.writeUint32(this.creation_time);
      stream.writeUint32(this.modification_time);
      stream.writeUint32(this.track_id);
      stream.writeUint32(0);
      stream.writeUint32(this.duration);
    }
    stream.writeUint32Array([0, 0]);
    stream.writeInt16(this.layer);
    stream.writeInt16(this.alternate_group);
    stream.writeInt16(this.volume << 8);
    stream.writeInt16(0);
    stream.writeInt32Array(this.matrix);
    stream.writeUint32(this.width);
    stream.writeUint32(this.height);
  }
  /** @bundle box-print.js */
  print(output) {
    super.printHeader(output);
    output.log(output.indent + "creation_time: " + this.creation_time);
    output.log(output.indent + "modification_time: " + this.modification_time);
    output.log(output.indent + "track_id: " + this.track_id);
    output.log(output.indent + "duration: " + this.duration);
    output.log(output.indent + "volume: " + (this.volume >> 8));
    output.log(output.indent + "matrix: " + this.matrix.join(", "));
    output.log(output.indent + "layer: " + this.layer);
    output.log(output.indent + "alternate_group: " + this.alternate_group);
    output.log(output.indent + "width: " + this.width);
    output.log(output.indent + "height: " + this.height);
  }
};
var trexBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackExtendsBox";
  }
  static {
    this.fourcc = "trex";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.track_id = stream.readUint32();
    this.default_sample_description_index = stream.readUint32();
    this.default_sample_duration = stream.readUint32();
    this.default_sample_size = stream.readUint32();
    this.default_sample_flags = stream.readUint32();
  }
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = 20;
    this.writeHeader(stream);
    stream.writeUint32(this.track_id);
    stream.writeUint32(this.default_sample_description_index);
    stream.writeUint32(this.default_sample_duration);
    stream.writeUint32(this.default_sample_size);
    stream.writeUint32(this.default_sample_flags);
  }
};
var trunBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackRunBox";
    this.sample_duration = [];
    this.sample_size = [];
    this.sample_flags = [];
    this.sample_composition_time_offset = [];
  }
  static {
    this.fourcc = "trun";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    let readBytes = 0;
    this.sample_count = stream.readUint32();
    readBytes += 4;
    if (this.size - this.hdr_size > readBytes && this.flags & 1) {
      this.data_offset = stream.readInt32();
      readBytes += 4;
    } else this.data_offset = 0;
    if (this.size - this.hdr_size > readBytes && this.flags & 4) {
      this.first_sample_flags = stream.readUint32();
      readBytes += 4;
    } else this.first_sample_flags = 0;
    this.sample_duration = [];
    this.sample_size = [];
    this.sample_flags = [];
    this.sample_composition_time_offset = [];
    if (this.size - this.hdr_size > readBytes) for (let i = 0; i < this.sample_count; i++) {
      if (this.flags & 256) this.sample_duration[i] = stream.readUint32();
      if (this.flags & 512) this.sample_size[i] = stream.readUint32();
      if (this.flags & 1024) this.sample_flags[i] = stream.readUint32();
      if (this.flags & 2048) if (this.version === 0) this.sample_composition_time_offset[i] = stream.readUint32();
      else this.sample_composition_time_offset[i] = stream.readInt32();
    }
  }
  /** @bundle writing/trun.js */
  write(stream) {
    this.size = 4;
    if (this.flags & 1) this.size += 4;
    if (this.flags & 4) this.size += 4;
    if (this.flags & 256) this.size += 4 * this.sample_duration.length;
    if (this.flags & 512) this.size += 4 * this.sample_size.length;
    if (this.flags & 1024) this.size += 4 * this.sample_flags.length;
    if (this.flags & 2048) this.size += 4 * this.sample_composition_time_offset.length;
    this.writeHeader(stream);
    stream.writeUint32(this.sample_count);
    if (this.flags & 1) {
      this.data_offset_position = stream.getPosition();
      stream.writeInt32(this.data_offset);
    }
    if (this.flags & 4) stream.writeUint32(this.first_sample_flags);
    for (let i = 0; i < this.sample_count; i++) {
      if (this.flags & 256) stream.writeUint32(this.sample_duration[i]);
      if (this.flags & 512) stream.writeUint32(this.sample_size[i]);
      if (this.flags & 1024) stream.writeUint32(this.sample_flags[i]);
      if (this.flags & 2048) if (this.version === 0) stream.writeUint32(this.sample_composition_time_offset[i]);
      else stream.writeInt32(this.sample_composition_time_offset[i]);
    }
  }
};
var urlBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "DataEntryUrlBox";
  }
  static {
    this.fourcc = "url ";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.flags !== 1) this.location = stream.readCString();
  }
  /** @bundle writing/url.js */
  write(stream) {
    this.version = 0;
    if (this.location) {
      this.flags = 0;
      this.size = this.location.length + 1;
    } else {
      this.flags = 1;
      this.size = 0;
    }
    this.writeHeader(stream);
    if (this.location) stream.writeCString(this.location);
  }
};
var vmhdBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "VideoMediaHeaderBox";
  }
  static {
    this.fourcc = "vmhd";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.graphicsmode = stream.readUint16();
    this.opcolor = stream.readUint16Array(3);
  }
  /** @bundle writing/vmhd.js */
  write(stream) {
    this.version = 0;
    this.size = 8;
    this.writeHeader(stream);
    stream.writeUint16(this.graphicsmode);
    stream.writeUint16Array(this.opcolor);
  }
};
var SampleGroupInfo = class {
  constructor(grouping_type, grouping_type_parameter, sbgp) {
    this.grouping_type = grouping_type;
    this.grouping_type_parameter = grouping_type_parameter;
    this.sbgp = sbgp;
    this.last_sample_in_run = -1;
    this.entry_index = -1;
  }
};
var ISOFile = class ISOFile2 {
  constructor(stream, discardMdatData = true) {
    this.boxes = [];
    this.mdats = [];
    this.moofs = [];
    this.isProgressive = false;
    this.moovStartFound = false;
    this.moovStartSent = false;
    this.readySent = false;
    this.sampleListBuilt = false;
    this.fragmentedTracks = [];
    this.extractedTracks = [];
    this.isFragmentationInitialized = false;
    this.sampleProcessingStarted = false;
    this.nextMoofNumber = 0;
    this.itemListBuilt = false;
    this.sidxSent = false;
    this.items = [];
    this.entity_groups = [];
    this.itemsDataSize = 0;
    this.lastMoofIndex = 0;
    this.samplesDataSize = 0;
    this.lastBoxStartPosition = 0;
    this.nextParsePosition = 0;
    this.discardMdatData = true;
    this.discardMdatData = discardMdatData;
    if (stream) {
      this.stream = stream;
      this.parse();
    } else this.stream = new MultiBufferStream();
    this.stream.isofile = this;
  }
  setSegmentOptions(id, user, opts) {
    const { sizePerSegment = Number.MAX_SAFE_INTEGER, rapAlignement = true, normalizeAudioSampleEntriesForMSE = true } = opts;
    let nbSamples = opts.nbSamples ?? opts.nbSamplesPerFragment ?? 1e3;
    const nbSamplesPerFragment = opts.nbSamplesPerFragment ?? nbSamples;
    if (nbSamples <= 0 || nbSamplesPerFragment <= 0 || sizePerSegment <= 0) {
      Log.error("ISOFile", `Invalid segment options: nbSamples=${nbSamples}, nbSamplesPerFragment=${nbSamplesPerFragment}, sizePerSegment=${sizePerSegment}`);
      return;
    }
    if (nbSamples < nbSamplesPerFragment) {
      Log.warn("ISOFile", `nbSamples (${nbSamples}) is less than nbSamplesPerFragment (${nbSamplesPerFragment}), setting nbSamples to nbSamplesPerFragment`);
      nbSamples = nbSamplesPerFragment;
    }
    if (this.fragmentedTracks.some((track) => track.nb_samples !== nbSamples)) {
      Log.error("ISOFile", `Cannot set segment options for track ${id}: nbSamples (${nbSamples}) does not match existing tracks`);
      return;
    }
    const trak2 = this.getTrackById(id);
    if (trak2) {
      const fragTrack = {
        id,
        user,
        trak: trak2,
        segmentStream: void 0,
        nb_samples: nbSamples,
        nb_samples_per_fragment: nbSamplesPerFragment,
        size_per_segment: sizePerSegment,
        rapAlignement,
        normalizeAudioSampleEntriesForMSE,
        state: {
          lastFragmentSampleNumber: 0,
          lastSegmentSampleNumber: 0,
          accumulatedSize: 0
        }
      };
      this.fragmentedTracks.push(fragTrack);
      trak2.nextSample = 0;
    }
    if (this.discardMdatData) Log.warn("ISOFile", "Segmentation options set but discardMdatData is true, samples will not be segmented");
  }
  unsetSegmentOptions(id) {
    let index = -1;
    for (let i = 0; i < this.fragmentedTracks.length; i++) if (this.fragmentedTracks[i].id === id) index = i;
    if (index > -1) this.fragmentedTracks.splice(index, 1);
  }
  setExtractionOptions(id, user, { nbSamples: nb_samples = 1e3 } = {}) {
    const trak2 = this.getTrackById(id);
    if (trak2) {
      this.extractedTracks.push({
        id,
        user,
        trak: trak2,
        nb_samples,
        samples: []
      });
      trak2.nextSample = 0;
    }
    if (this.discardMdatData) Log.warn("ISOFile", "Extraction options set but discardMdatData is true, samples will not be extracted");
  }
  unsetExtractionOptions(id) {
    let index = -1;
    for (let i = 0; i < this.extractedTracks.length; i++) if (this.extractedTracks[i].id === id) index = i;
    if (index > -1) this.extractedTracks.splice(index, 1);
  }
  parse() {
    const parseBoxHeadersOnly = false;
    if (this.restoreParsePosition) {
      if (!this.restoreParsePosition()) return;
    }
    while (true) if (this.hasIncompleteMdat && this.hasIncompleteMdat()) if (this.processIncompleteMdat()) continue;
    else return;
    else {
      if (this.saveParsePosition) this.saveParsePosition();
      const ret = parseOneBox(this.stream, parseBoxHeadersOnly);
      if (ret.code === 0) if (this.processIncompleteBox) if (this.processIncompleteBox(ret)) continue;
      else return;
      else return;
      else if (ret.code === 1) {
        const box2 = ret.box;
        this.boxes.push(box2);
        if (box2.type === "uuid") {
          if (this[box2.uuid] !== void 0) Log.warn("ISOFile", "Duplicate Box of uuid: " + box2.uuid + ", overriding previous occurrence");
          this[box2.uuid] = box2;
        } else switch (box2.type) {
          case "mdat":
            this.mdats.push(box2);
            this.transferMdatData(box2);
            break;
          case "moof":
            this.moofs.push(box2);
            break;
          case "free":
          case "skip":
            break;
          case "moov":
            this.moovStartFound = true;
            if (this.mdats.length === 0) this.isProgressive = true;
          default:
            if (this[box2.type] !== void 0) if (Array.isArray(this[box2.type + "s"])) {
              Log.info("ISOFile", `Found multiple boxes of type ${box2.type} in ISOFile, adding to array`);
              this[box2.type + "s"].push(box2);
            } else {
              Log.warn("ISOFile", `Found multiple boxes of type ${box2.type} but no array exists. Creating array dynamically.`);
              this[box2.type + "s"] = [this[box2.type], box2];
            }
            else {
              this[box2.type] = box2;
              if (Array.isArray(this[box2.type + "s"])) this[box2.type + "s"].push(box2);
            }
            break;
        }
        if (this.updateUsedBytes) this.updateUsedBytes(box2, ret);
      } else if (ret.code === -1) {
        Log.error("ISOFile", `Invalid data found while parsing box of type '${ret.type}' at position ${ret.start}. Aborting parsing.`, this);
        break;
      }
    }
  }
  checkBuffer(ab) {
    if (!ab) throw new Error("Buffer must be defined and non empty");
    if (ab.byteLength === 0) {
      Log.warn("ISOFile", "Ignoring empty buffer (fileStart: " + ab.fileStart + ")");
      this.stream.logBufferLevel();
      return false;
    }
    Log.info("ISOFile", "Processing buffer (fileStart: " + ab.fileStart + ")");
    ab.usedBytes = 0;
    this.stream.insertBuffer(ab);
    this.stream.logBufferLevel();
    if (!this.stream.initialized()) {
      Log.warn("ISOFile", "Not ready to start parsing");
      return false;
    }
    return true;
  }
  /**
  * Processes a new ArrayBuffer (with a fileStart property)
  * Returns the next expected file position, or undefined if not ready to parse
  */
  appendBuffer(ab, last2) {
    let nextFileStart;
    if (!this.checkBuffer(ab)) return;
    this.parse();
    if (this.moovStartFound && !this.moovStartSent) {
      this.moovStartSent = true;
      if (this.onMoovStart) this.onMoovStart();
    }
    if (this.moov) {
      if (!this.sampleListBuilt) {
        this.buildSampleLists();
        this.sampleListBuilt = true;
      }
      this.updateSampleLists();
      if (this.onReady && !this.readySent) {
        this.readySent = true;
        this.onReady(this.getInfo());
      }
      this.processSamples(last2);
      if (this.nextSeekPosition) {
        nextFileStart = this.nextSeekPosition;
        this.nextSeekPosition = void 0;
      } else nextFileStart = this.nextParsePosition;
      if (this.stream.getEndFilePositionAfter) nextFileStart = this.stream.getEndFilePositionAfter(nextFileStart);
    } else if (this.nextParsePosition) nextFileStart = this.nextParsePosition;
    else nextFileStart = 0;
    if (this.sidx) {
      if (this.onSidx && !this.sidxSent) {
        this.onSidx(this.sidx);
        this.sidxSent = true;
      }
    }
    if (this.meta) {
      if (this.flattenItemInfo && !this.itemListBuilt) {
        this.flattenItemInfo();
        this.itemListBuilt = true;
      }
      if (this.processItems) this.processItems(this.onItem);
    }
    if (this.stream.cleanBuffers) {
      Log.info("ISOFile", "Done processing buffer (fileStart: " + ab.fileStart + ") - next buffer to fetch should have a fileStart position of " + nextFileStart);
      this.stream.logBufferLevel();
      this.stream.cleanBuffers();
      this.stream.logBufferLevel(true);
      Log.info("ISOFile", "Sample data size in memory: " + this.getAllocatedSampleDataSize());
    }
    return nextFileStart;
  }
  getFragmentDuration() {
    const mvex2 = this.getBox("mvex");
    if (!mvex2) return;
    if (mvex2.mehd) return {
      num: mvex2.mehd.fragment_duration,
      den: this.moov.mvhd.timescale
    };
    const traks = this.getBoxes("trak", false);
    let maximum = {
      num: 0,
      den: 1
    };
    for (const trak2 of traks) {
      const duration = trak2.samples_duration;
      const timescale = trak2.mdia.mdhd.timescale;
      if (duration && timescale) {
        if (duration / timescale > maximum.num / maximum.den) maximum = {
          num: duration,
          den: timescale
        };
      }
    }
    return maximum;
  }
  getInfo() {
    if (!this.moov) return {
      hasMoov: false,
      mime: ""
    };
    const _1904 = (/* @__PURE__ */ new Date("1904-01-01T00:00:00Z")).getTime();
    const isFragmented = this.getBox("mvex") !== void 0;
    const movie = {
      hasMoov: true,
      duration: this.moov.mvhd.duration,
      timescale: this.moov.mvhd.timescale,
      isFragmented,
      fragment_duration: this.getFragmentDuration(),
      isProgressive: this.isProgressive,
      hasIOD: this.moov.iods !== void 0,
      brands: [this.ftyp.major_brand].concat(this.ftyp.compatible_brands),
      created: new Date(_1904 + this.moov.mvhd.creation_time * 1e3),
      modified: new Date(_1904 + this.moov.mvhd.modification_time * 1e3),
      tracks: [],
      audioTracks: [],
      videoTracks: [],
      subtitleTracks: [],
      metadataTracks: [],
      hintTracks: [],
      otherTracks: [],
      mime: ""
    };
    for (let i = 0; i < this.moov.traks.length; i++) {
      const trak2 = this.moov.traks[i];
      const sample_desc = trak2.mdia.minf.stbl.stsd.entries[0];
      const size = trak2.samples_size;
      const track_timescale = trak2.mdia.mdhd.timescale;
      const samples_duration = trak2.samples_duration;
      const track = {
        samples_duration,
        bitrate: size * 8 * track_timescale / samples_duration,
        size,
        timescale: track_timescale,
        alternate_group: trak2.tkhd.alternate_group,
        codec: sample_desc.getCodec(),
        created: new Date(_1904 + trak2.tkhd.creation_time * 1e3),
        cts_shift: trak2.mdia.minf.stbl.cslg,
        duration: trak2.mdia.mdhd.duration,
        id: trak2.tkhd.track_id,
        kind: trak2.udta && trak2.udta.kinds.length ? trak2.udta.kinds[0] : {
          schemeURI: "",
          value: ""
        },
        language: trak2.mdia.elng ? trak2.mdia.elng.extended_language : trak2.mdia.mdhd.languageString,
        layer: trak2.tkhd.layer,
        matrix: trak2.tkhd.matrix,
        modified: new Date(_1904 + trak2.tkhd.modification_time * 1e3),
        movie_duration: trak2.tkhd.duration,
        movie_timescale: movie.timescale,
        name: trak2.mdia.hdlr.name,
        nb_samples: trak2.samples.length,
        references: [],
        track_height: trak2.tkhd.height / 65536,
        track_width: trak2.tkhd.width / 65536,
        volume: trak2.tkhd.volume
      };
      movie.tracks.push(track);
      if (trak2.tref) for (let j = 0; j < trak2.tref.references.length; j++) track.references.push({
        type: trak2.tref.references[j].type,
        track_ids: trak2.tref.references[j].track_ids
      });
      if (trak2.edts !== void 0 && trak2.edts.elst !== void 0) track.edits = trak2.edts.elst.entries;
      if (sample_desc instanceof AudioSampleEntry) {
        track.type = "audio";
        movie.audioTracks.push(track);
        track.audio = {
          sample_rate: sample_desc.getSampleRate(),
          channel_count: sample_desc.getChannelCount(),
          sample_size: sample_desc.getSampleSize()
        };
      } else if (sample_desc instanceof VisualSampleEntry) {
        track.type = "video";
        movie.videoTracks.push(track);
        track.video = {
          width: sample_desc.getWidth(),
          height: sample_desc.getHeight()
        };
      } else if (sample_desc instanceof SubtitleSampleEntry) {
        track.type = "subtitles";
        movie.subtitleTracks.push(track);
      } else if (sample_desc instanceof HintSampleEntry) {
        track.type = "metadata";
        movie.hintTracks.push(track);
      } else if (sample_desc instanceof MetadataSampleEntry) {
        track.type = "metadata";
        movie.metadataTracks.push(track);
      } else {
        track.type = "metadata";
        movie.otherTracks.push(track);
      }
    }
    if (movie.videoTracks && movie.videoTracks.length > 0) movie.mime += 'video/mp4; codecs="';
    else if (movie.audioTracks && movie.audioTracks.length > 0) movie.mime += 'audio/mp4; codecs="';
    else movie.mime += 'application/mp4; codecs="';
    for (let i = 0; i < movie.tracks.length; i++) {
      if (i !== 0) movie.mime += ",";
      movie.mime += movie.tracks[i].codec;
    }
    movie.mime += '"; profiles="';
    movie.mime += this.ftyp.compatible_brands.join();
    movie.mime += '"';
    return movie;
  }
  setNextSeekPositionFromSample(sample) {
    if (!sample) return;
    if (this.nextSeekPosition) this.nextSeekPosition = Math.min(sample.offset + sample.alreadyRead, this.nextSeekPosition);
    else this.nextSeekPosition = sample.offset + sample.alreadyRead;
  }
  processSamples(last2) {
    if (!this.sampleProcessingStarted) return;
    if (this.isFragmentationInitialized && this.onSegment !== void 0) {
      const consumedTracks = /* @__PURE__ */ new Set();
      while (consumedTracks.size < this.fragmentedTracks.length && this.fragmentedTracks.some((track) => track.trak.nextSample < track.trak.samples.length) && this.sampleProcessingStarted) for (const fragTrak of this.fragmentedTracks) {
        const trak2 = fragTrak.trak;
        if (!consumedTracks.has(fragTrak.id)) {
          const sample = trak2.nextSample < trak2.samples.length ? this.getSample(trak2, trak2.nextSample) : void 0;
          if (!sample) {
            this.setNextSeekPositionFromSample(trak2.samples[trak2.nextSample]);
            consumedTracks.add(fragTrak.id);
            continue;
          }
          fragTrak.state.accumulatedSize += sample.size;
          const sampleNum = trak2.nextSample + 1;
          const isFragmentOverdue = sampleNum - fragTrak.state.lastFragmentSampleNumber > fragTrak.nb_samples_per_fragment;
          const isSegmentOverdue = sampleNum - fragTrak.state.lastSegmentSampleNumber > fragTrak.nb_samples;
          let isFragmentBoundary = isFragmentOverdue || sampleNum % fragTrak.nb_samples_per_fragment === 0;
          let isSegmentBoundary = isSegmentOverdue || sampleNum % fragTrak.nb_samples === 0;
          let isSizeBoundary = fragTrak.state.accumulatedSize >= fragTrak.size_per_segment;
          const isRAP = !fragTrak.rapAlignement || sample.is_sync;
          const isFlush = last2 || trak2.nextSample + 1 >= trak2.samples.length;
          if (isFlush && !isRAP) Log.warn("ISOFile", "Flushing track #" + fragTrak.id + " at sample #" + trak2.nextSample + " which is not a RAP, this may lead to playback issues");
          isFragmentBoundary = isFragmentBoundary && isRAP;
          isSegmentBoundary = isSegmentBoundary && isRAP;
          isSizeBoundary = isSizeBoundary && isRAP;
          if (isFragmentBoundary || isSizeBoundary || isFlush) {
            if (isFragmentOverdue) Log.warn("ISOFile", "Fragment on track #" + fragTrak.id + " is overdue, creating it with samples [" + fragTrak.state.lastFragmentSampleNumber + ", " + trak2.nextSample + "]");
            else Log.debug("ISOFile", "Creating media fragment on track #" + fragTrak.id + " for samples [" + fragTrak.state.lastFragmentSampleNumber + ", " + trak2.nextSample + "]");
            const result = this.createFragment(fragTrak.id, fragTrak.state.lastFragmentSampleNumber, trak2.nextSample, fragTrak.segmentStream);
            if (result) {
              fragTrak.segmentStream = result;
              fragTrak.state.lastFragmentSampleNumber = trak2.nextSample + 1;
            } else {
              consumedTracks.add(fragTrak.id);
              continue;
            }
          }
          if (isSegmentBoundary || isSizeBoundary || isFlush) {
            if (isSegmentOverdue) Log.warn("ISOFile", "Segment on track #" + fragTrak.id + " is overdue, sending it with samples [" + Math.max(0, trak2.nextSample - fragTrak.nb_samples) + ", " + (trak2.nextSample - 1) + "]");
            else Log.info("ISOFile", "Sending fragmented data on track #" + fragTrak.id + " for samples [" + Math.max(0, trak2.nextSample - fragTrak.nb_samples) + ", " + (trak2.nextSample - 1) + "]");
            Log.info("ISOFile", "Sample data size in memory: " + this.getAllocatedSampleDataSize());
            if (this.onSegment) this.onSegment(fragTrak.id, fragTrak.user, fragTrak.segmentStream.buffer, trak2.nextSample + 1, last2 || trak2.nextSample + 1 >= trak2.samples.length);
            fragTrak.segmentStream = void 0;
            fragTrak.state.accumulatedSize = 0;
            fragTrak.state.lastSegmentSampleNumber = trak2.nextSample + 1;
          }
          trak2.nextSample++;
        }
      }
    }
    if (this.onSamples !== void 0) for (let i = 0; i < this.extractedTracks.length; i++) {
      const extractTrak = this.extractedTracks[i];
      const trak2 = extractTrak.trak;
      while (trak2.nextSample < trak2.samples.length && this.sampleProcessingStarted) {
        Log.debug("ISOFile", "Exporting on track #" + extractTrak.id + " sample #" + trak2.nextSample);
        const sample = this.getSample(trak2, trak2.nextSample);
        if (sample) {
          trak2.nextSample++;
          extractTrak.samples.push(sample);
        } else {
          this.setNextSeekPositionFromSample(trak2.samples[trak2.nextSample]);
          break;
        }
        if (trak2.nextSample % extractTrak.nb_samples === 0 || trak2.nextSample >= trak2.samples.length) {
          Log.debug("ISOFile", "Sending samples on track #" + extractTrak.id + " for sample " + trak2.nextSample);
          if (this.onSamples) this.onSamples(extractTrak.id, extractTrak.user, extractTrak.samples);
          extractTrak.samples = [];
          if (extractTrak !== this.extractedTracks[i]) break;
        }
      }
    }
  }
  getBox(type) {
    const result = this.getBoxes(type, true);
    return result.length ? result[0] : void 0;
  }
  getBoxes(type, returnEarly) {
    const result = [];
    const sweep = (root) => {
      if (root instanceof Box && root.type && root.type === type) result.push(root);
      const inner = [];
      if (root["boxes"]) inner.push(...root.boxes);
      if (root["entries"]) inner.push(...root["entries"]);
      if (root["item_infos"]) inner.push(...root["item_infos"]);
      if (root["references"]) inner.push(...root["references"]);
      for (const box2 of inner) {
        if (result.length && returnEarly) return;
        sweep(box2);
      }
    };
    sweep(this);
    return result;
  }
  getTrackSamplesInfo(track_id) {
    const track = this.getTrackById(track_id);
    if (track) return track.samples;
  }
  getTrackSample(track_id, number) {
    const track = this.getTrackById(track_id);
    return this.getSample(track, number);
  }
  releaseUsedSamples(id, sampleNum) {
    let size = 0;
    const trak2 = this.getTrackById(id);
    if (!trak2.lastValidSample) trak2.lastValidSample = 0;
    for (let i = trak2.lastValidSample; i < sampleNum; i++) size += this.releaseSample(trak2, i);
    Log.info("ISOFile", "Track #" + id + " released samples up to " + sampleNum + " (released size: " + size + ", remaining: " + this.samplesDataSize + ")");
    trak2.lastValidSample = sampleNum;
  }
  start() {
    this.sampleProcessingStarted = true;
    this.processSamples(false);
  }
  stop() {
    this.sampleProcessingStarted = false;
  }
  flush() {
    Log.info("ISOFile", "Flushing remaining samples");
    this.updateSampleLists();
    this.processSamples(true);
    this.stream.cleanBuffers();
    this.stream.logBufferLevel(true);
  }
  seekTrack(time, useRap, trak2) {
    let rap_seek_sample_num = 0;
    let seek_sample_num = 0;
    let timescale;
    if (trak2.samples.length === 0) {
      Log.info("ISOFile", "No sample in track, cannot seek! Using time " + Log.getDurationString(0, 1) + " and offset: 0");
      return {
        offset: 0,
        time: 0
      };
    }
    for (let j = 0; j < trak2.samples.length; j++) {
      const sample = trak2.samples[j];
      if (j === 0) {
        seek_sample_num = 0;
        timescale = sample.timescale;
      } else if (sample.cts > time * sample.timescale) {
        seek_sample_num = j - 1;
        break;
      }
      if (useRap && sample.is_sync) rap_seek_sample_num = j;
    }
    if (useRap) seek_sample_num = rap_seek_sample_num;
    time = trak2.samples[seek_sample_num].cts;
    trak2.nextSample = seek_sample_num;
    this.resetFragmentedTrackStateAfterSeek(trak2, seek_sample_num);
    this.resetExtractedTrackStateAfterSeek(trak2);
    while (trak2.samples[seek_sample_num].alreadyRead === trak2.samples[seek_sample_num].size) {
      if (!trak2.samples[seek_sample_num + 1]) break;
      seek_sample_num++;
    }
    const seek_offset = trak2.samples[seek_sample_num].offset + trak2.samples[seek_sample_num].alreadyRead;
    Log.info("ISOFile", "Seeking to " + (useRap ? "RAP" : "") + " sample #" + trak2.nextSample + " on track " + trak2.tkhd.track_id + ", time " + Log.getDurationString(time, timescale) + " and offset: " + seek_offset);
    return {
      offset: seek_offset,
      time: time / timescale
    };
  }
  resetFragmentedTrackStateAfterSeek(trak2, seekSampleNumber) {
    const fragTrack = this.fragmentedTracks.find((t) => t.trak === trak2);
    if (!fragTrack) return;
    fragTrack.state.lastFragmentSampleNumber = seekSampleNumber;
    fragTrack.state.lastSegmentSampleNumber = seekSampleNumber;
    fragTrack.state.accumulatedSize = 0;
    fragTrack.segmentStream = void 0;
  }
  resetExtractedTrackStateAfterSeek(trak2) {
    const extractTrack = this.extractedTracks.find((t) => t.trak === trak2);
    if (!extractTrack) return;
    extractTrack.samples = [];
  }
  getTrackDuration(trak2) {
    if (!trak2.samples) return Infinity;
    const sample = trak2.samples[trak2.samples.length - 1];
    return (sample.cts + sample.duration) / sample.timescale;
  }
  seek(time, useRap) {
    const moov2 = this.moov;
    let seek_info = {
      offset: Infinity,
      time: Infinity
    };
    if (!this.moov) throw new Error("Cannot seek: moov not received!");
    else {
      for (let i = 0; i < moov2.traks.length; i++) {
        const trak2 = moov2.traks[i];
        if (time > this.getTrackDuration(trak2)) continue;
        const trak_seek_info = this.seekTrack(time, useRap, trak2);
        if (trak_seek_info.offset < seek_info.offset) seek_info.offset = trak_seek_info.offset;
        if (trak_seek_info.time < seek_info.time) seek_info.time = trak_seek_info.time;
      }
      Log.info("ISOFile", "Seeking at time " + Log.getDurationString(seek_info.time, 1) + " needs a buffer with a fileStart position of " + seek_info.offset);
      if (seek_info.offset === Infinity) seek_info = {
        offset: this.nextParsePosition,
        time: 0
      };
      else seek_info.offset = this.stream.getEndFilePositionAfter(seek_info.offset);
      Log.info("ISOFile", "Adjusted seek position (after checking data already in buffer): " + seek_info.offset);
      return seek_info;
    }
  }
  equal(b) {
    let box_index = 0;
    while (box_index < this.boxes.length && box_index < b.boxes.length) {
      const a_box = this.boxes[box_index];
      const b_box = b.boxes[box_index];
      if (!boxEqual(a_box, b_box)) return false;
      box_index++;
    }
    return true;
  }
  /**
  * Rewrite the entire file
  * @bundle isofile-write.js
  */
  write(outstream) {
    for (let i = 0; i < this.boxes.length; i++) this.boxes[i].write(outstream);
  }
  /** @bundle isofile-write.js */
  createFragment(track_id, sampleStart, sampleEnd, existingStream) {
    if (sampleEnd < sampleStart) {
      Log.warn("ISOFile", `Skipping fragment creation on track #${track_id}: invalid sample range [${sampleStart}, ${sampleEnd}]`);
      return existingStream || new DataStream();
    }
    const samples = [];
    for (let i = sampleStart; i <= sampleEnd; i++) {
      const trak2 = this.getTrackById(track_id);
      const sample = this.getSample(trak2, i);
      if (!sample) {
        this.setNextSeekPositionFromSample(trak2.samples[i]);
        return;
      }
      samples.push(sample);
    }
    const stream = existingStream || new DataStream();
    const moof2 = this.createMoof(samples);
    moof2.write(stream);
    moof2.trafs[0].truns[0].data_offset = moof2.size + 8;
    Log.debug("MP4Box", "Adjusting data_offset with new value " + moof2.trafs[0].truns[0].data_offset);
    stream.adjustUint32(moof2.trafs[0].truns[0].data_offset_position, moof2.trafs[0].truns[0].data_offset);
    const mdat2 = new mdatBox();
    mdat2.stream = new MultiBufferStream();
    let offset = 0;
    for (const sample of samples) if (sample.data) {
      const mp4Buffer = MP4BoxBuffer.fromArrayBuffer(sample.data.buffer, offset);
      mdat2.stream.insertBuffer(mp4Buffer);
      offset += sample.data.byteLength;
    }
    mdat2.write(stream);
    return stream;
  }
  /**
  * Modify the file and create the initialization segment
  * @bundle isofile-write.js
  */
  static writeInitializationSegment(ftyp2, moov2, total_duration, normalizeAudioSampleEntryTrackIds) {
    Log.debug("ISOFile", "Generating initialization segment");
    const stream = new DataStream();
    ftyp2.write(stream);
    const restoreCallbacks = ISOFile2.normalizeAudioSampleEntriesForMSEFragmentedInit(moov2.traks, normalizeAudioSampleEntryTrackIds);
    try {
      const mvex2 = moov2.addBox(new mvexBox());
      if (total_duration) {
        const mehd = mvex2.addBox(new mehdBox());
        mehd.fragment_duration = total_duration;
      }
      for (let i = 0; i < moov2.traks.length; i++) {
        const trex2 = mvex2.addBox(new trexBox());
        trex2.track_id = moov2.traks[i].tkhd.track_id;
        trex2.default_sample_description_index = 1;
        trex2.default_sample_duration = moov2.traks[i].samples[0]?.duration ?? 0;
        trex2.default_sample_size = 0;
        trex2.default_sample_flags = 65536;
      }
      moov2.write(stream);
    } finally {
      for (let i = restoreCallbacks.length - 1; i >= 0; i--) restoreCallbacks[i]();
    }
    return stream.buffer;
  }
  /** @bundle isofile-write.js */
  save(name) {
    const stream = new DataStream();
    stream.isofile = this;
    this.write(stream);
    return stream.save(name);
  }
  /** @bundle isofile-write.js */
  getBuffer() {
    const stream = new DataStream();
    stream.isofile = this;
    this.write(stream);
    return stream;
  }
  /** @bundle isofile-write.js */
  static normalizeAudioSampleEntriesForMSEFragmentedInit(traks, normalizeAudioSampleEntryTrackIds) {
    const restoreCallbacks = [];
    for (const trak2 of traks) {
      if (!normalizeAudioSampleEntryTrackIds?.has(trak2.tkhd.track_id)) continue;
      for (const sampleEntry of trak2.mdia.minf.stbl.stsd?.entries ?? []) {
        if (!(sampleEntry instanceof mp4aSampleEntry)) continue;
        const esds2 = sampleEntry.wave?.esds;
        if (sampleEntry.esds || !esds2) continue;
        const previousEsds = sampleEntry.esds;
        const previousWave = sampleEntry.wave;
        const previousBoxes = sampleEntry.boxes;
        restoreCallbacks.push(() => {
          sampleEntry.esds = previousEsds;
          sampleEntry.wave = previousWave;
          sampleEntry.boxes = previousBoxes;
        });
        const boxesWithoutWave = Array.isArray(sampleEntry.boxes) ? sampleEntry.boxes.filter((box2) => box2?.type !== "wave" && box2?.type !== "esds") : [];
        sampleEntry.esds = esds2;
        sampleEntry.boxes = [...boxesWithoutWave, esds2];
        sampleEntry.wave = void 0;
      }
    }
    return restoreCallbacks;
  }
  initializeSegmentation(mode) {
    if (!this.onSegment) Log.warn("MP4Box", "No segmentation callback set!");
    if (mode !== void 0 && mode !== "combined" && mode !== "per-track") throw new Error(`Invalid segmentation mode: ${mode}`);
    if (!this.isFragmentationInitialized) {
      this.isFragmentationInitialized = true;
      this.resetTables();
    }
    const tracksToInitialize = [];
    for (const fragmentedTrack of this.fragmentedTracks) {
      const trak2 = this.getTrackById(fragmentedTrack.id);
      if (!trak2) {
        Log.warn("ISOFile", `Track with id ${fragmentedTrack.id} not found, skipping fragmentation initialization`);
        continue;
      }
      tracksToInitialize.push({
        id: fragmentedTrack.id,
        user: fragmentedTrack.user,
        trak: trak2
      });
    }
    const fragmentDuration = this.moov?.mvex?.mehd?.fragment_duration;
    const normalizeAudioSampleEntryTrackIds = new Set(this.fragmentedTracks.filter((track) => track.normalizeAudioSampleEntriesForMSE !== false).map((track) => track.id));
    if (mode === "per-track") return tracksToInitialize.map(({ id, user, trak: trak2 }) => {
      const moov3 = new moovBox();
      moov3.addBox(this.moov.mvhd);
      moov3.addBox(trak2);
      return {
        id,
        user,
        buffer: ISOFile2.writeInitializationSegment(this.ftyp, moov3, fragmentDuration, normalizeAudioSampleEntryTrackIds)
      };
    });
    const moov2 = new moovBox();
    moov2.addBox(this.moov.mvhd);
    for (const track of tracksToInitialize) moov2.addBox(track.trak);
    return {
      tracks: tracksToInitialize.map(({ id, user }) => ({
        id,
        user
      })),
      buffer: ISOFile2.writeInitializationSegment(this.ftyp, moov2, fragmentDuration, normalizeAudioSampleEntryTrackIds)
    };
  }
  /**
  * Resets all sample tables
  * @bundle isofile-sample-processing.js
  */
  resetTables() {
    this.initial_duration = this.moov.mvhd.duration;
    this.moov.mvhd.duration = 0;
    for (let i = 0; i < this.moov.traks.length; i++) {
      const trak2 = this.moov.traks[i];
      trak2.tkhd.duration = 0;
      trak2.mdia.mdhd.duration = 0;
      const stco2 = trak2.mdia.minf.stbl.stco || trak2.mdia.minf.stbl.co64;
      stco2.chunk_offsets = [];
      const stsc2 = trak2.mdia.minf.stbl.stsc;
      stsc2.first_chunk = [];
      stsc2.samples_per_chunk = [];
      stsc2.sample_description_index = [];
      const stsz2 = trak2.mdia.minf.stbl.stsz || trak2.mdia.minf.stbl.stz2;
      stsz2.sample_sizes = [];
      const stts2 = trak2.mdia.minf.stbl.stts;
      stts2.sample_counts = [];
      stts2.sample_deltas = [];
      const ctts2 = trak2.mdia.minf.stbl.ctts;
      if (ctts2) {
        ctts2.sample_counts = [];
        ctts2.sample_offsets = [];
      }
      const stss2 = trak2.mdia.minf.stbl.stss;
      const k = trak2.mdia.minf.stbl.boxes.indexOf(stss2);
      if (k !== -1) trak2.mdia.minf.stbl.boxes[k] = void 0;
    }
  }
  /** @bundle isofile-sample-processing.js */
  static initSampleGroups(trak2, traf2, sbgps, trak_sgpds, traf_sgpds) {
    if (traf2) traf2.sample_groups_info = [];
    if (!trak2.sample_groups_info) trak2.sample_groups_info = [];
    for (let k = 0; k < sbgps.length; k++) {
      const sample_group_key = sbgps[k].grouping_type + "/" + sbgps[k].grouping_type_parameter;
      const sample_group_info = new SampleGroupInfo(sbgps[k].grouping_type, sbgps[k].grouping_type_parameter, sbgps[k]);
      if (traf2) traf2.sample_groups_info[sample_group_key] = sample_group_info;
      if (!trak2.sample_groups_info[sample_group_key]) trak2.sample_groups_info[sample_group_key] = sample_group_info;
      for (let l = 0; l < trak_sgpds.length; l++) if (trak_sgpds[l].grouping_type === sbgps[k].grouping_type) {
        sample_group_info.description = trak_sgpds[l];
        sample_group_info.description.used = true;
      }
      if (traf_sgpds) {
        for (let l = 0; l < traf_sgpds.length; l++) if (traf_sgpds[l].grouping_type === sbgps[k].grouping_type) {
          sample_group_info.fragment_description = traf_sgpds[l];
          sample_group_info.fragment_description.used = true;
          sample_group_info.is_fragment = true;
        }
      }
    }
    if (!traf2) {
      for (let k = 0; k < trak_sgpds.length; k++) if (!trak_sgpds[k].used && trak_sgpds[k].version >= 2) {
        const sample_group_key = trak_sgpds[k].grouping_type + "/0";
        const sample_group_info = new SampleGroupInfo(trak_sgpds[k].grouping_type, 0);
        if (!trak2.sample_groups_info[sample_group_key]) trak2.sample_groups_info[sample_group_key] = sample_group_info;
      }
    } else if (traf_sgpds) {
      for (let k = 0; k < traf_sgpds.length; k++) if (!traf_sgpds[k].used && traf_sgpds[k].version >= 2) {
        const sample_group_key = traf_sgpds[k].grouping_type + "/0";
        const sample_group_info = new SampleGroupInfo(traf_sgpds[k].grouping_type, 0);
        sample_group_info.is_fragment = true;
        if (!traf2.sample_groups_info[sample_group_key]) traf2.sample_groups_info[sample_group_key] = sample_group_info;
      }
    }
  }
  /** @bundle isofile-sample-processing.js */
  static setSampleGroupProperties(trak2, sample, sample_number, sample_groups_info) {
    sample.sample_groups = [];
    for (const k in sample_groups_info) {
      sample.sample_groups[k] = {
        grouping_type: sample_groups_info[k].grouping_type,
        grouping_type_parameter: sample_groups_info[k].grouping_type_parameter
      };
      if (sample_number >= sample_groups_info[k].last_sample_in_run) {
        if (sample_groups_info[k].last_sample_in_run < 0) sample_groups_info[k].last_sample_in_run = 0;
        sample_groups_info[k].entry_index++;
        if (sample_groups_info[k].entry_index <= sample_groups_info[k].sbgp.entries.length - 1) sample_groups_info[k].last_sample_in_run += sample_groups_info[k].sbgp.entries[sample_groups_info[k].entry_index].sample_count;
      }
      if (sample_groups_info[k].entry_index <= sample_groups_info[k].sbgp.entries.length - 1) sample.sample_groups[k].group_description_index = sample_groups_info[k].sbgp.entries[sample_groups_info[k].entry_index].group_description_index;
      else sample.sample_groups[k].group_description_index = -1;
      if (sample.sample_groups[k].group_description_index !== 0) {
        let description;
        if (sample_groups_info[k].fragment_description) description = sample_groups_info[k].fragment_description;
        else description = sample_groups_info[k].description;
        if (sample.sample_groups[k].group_description_index > 0) {
          let index;
          if (sample.sample_groups[k].group_description_index > 65535) index = (sample.sample_groups[k].group_description_index >> 16) - 1;
          else index = sample.sample_groups[k].group_description_index - 1;
          if (description && index >= 0) sample.sample_groups[k].description = description.entries[index];
        } else if (description && description.version >= 2) {
          if (description.default_group_description_index > 0) sample.sample_groups[k].description = description.entries[description.default_group_description_index - 1];
        }
      }
    }
  }
  /** @bundle isofile-sample-processing.js */
  static process_sdtp(sdtp, sample, number) {
    if (!sample) return;
    if (sdtp) {
      sample.is_leading = sdtp.is_leading[number];
      sample.depends_on = sdtp.sample_depends_on[number];
      sample.is_depended_on = sdtp.sample_is_depended_on[number];
      sample.has_redundancy = sdtp.sample_has_redundancy[number];
    } else {
      sample.is_leading = 0;
      sample.depends_on = 0;
      sample.is_depended_on = 0;
      sample.has_redundancy = 0;
    }
  }
  buildSampleLists() {
    for (let i = 0; i < this.moov.traks.length; i++) this.buildTrakSampleLists(this.moov.traks[i]);
  }
  buildTrakSampleLists(trak2) {
    let j;
    let chunk_run_index;
    let chunk_index;
    let last_chunk_in_run;
    let offset_in_chunk;
    let last_sample_in_chunk;
    trak2.samples = [];
    trak2.samples_duration = 0;
    trak2.samples_size = 0;
    const stco2 = trak2.mdia.minf.stbl.stco || trak2.mdia.minf.stbl.co64;
    const stsc2 = trak2.mdia.minf.stbl.stsc;
    const stsz2 = trak2.mdia.minf.stbl.stsz || trak2.mdia.minf.stbl.stz2;
    const stts2 = trak2.mdia.minf.stbl.stts;
    const ctts2 = trak2.mdia.minf.stbl.ctts;
    const stss2 = trak2.mdia.minf.stbl.stss;
    const stsd2 = trak2.mdia.minf.stbl.stsd;
    const subs = trak2.mdia.minf.stbl.subs;
    const stdp = trak2.mdia.minf.stbl.stdp;
    const sbgps = trak2.mdia.minf.stbl.sbgps;
    const sgpds = trak2.mdia.minf.stbl.sgpds;
    let last_sample_in_stts_run = -1;
    let stts_run_index = -1;
    let last_sample_in_ctts_run = -1;
    let ctts_run_index = -1;
    let last_stss_index = 0;
    let subs_entry_index = 0;
    let last_subs_sample_index = 0;
    ISOFile2.initSampleGroups(trak2, void 0, sbgps, sgpds);
    if (typeof stsz2 === "undefined") return;
    for (j = 0; j < stsz2.sample_sizes.length; j++) {
      const sample = {
        number: j,
        track_id: trak2.tkhd.track_id,
        timescale: trak2.mdia.mdhd.timescale,
        alreadyRead: 0,
        size: stsz2.sample_sizes[j]
      };
      trak2.samples[j] = sample;
      trak2.samples_size += sample.size;
      if (j === 0) {
        chunk_index = 1;
        chunk_run_index = 0;
        sample.chunk_index = chunk_index;
        sample.chunk_run_index = chunk_run_index;
        last_sample_in_chunk = stsc2.samples_per_chunk[chunk_run_index];
        offset_in_chunk = 0;
        if (chunk_run_index + 1 < stsc2.first_chunk.length) last_chunk_in_run = stsc2.first_chunk[chunk_run_index + 1] - 1;
        else last_chunk_in_run = Infinity;
      } else if (j < last_sample_in_chunk) {
        sample.chunk_index = chunk_index;
        sample.chunk_run_index = chunk_run_index;
      } else {
        chunk_index++;
        sample.chunk_index = chunk_index;
        offset_in_chunk = 0;
        if (chunk_index <= last_chunk_in_run) {
        } else {
          chunk_run_index++;
          if (chunk_run_index + 1 < stsc2.first_chunk.length) last_chunk_in_run = stsc2.first_chunk[chunk_run_index + 1] - 1;
          else last_chunk_in_run = Infinity;
        }
        sample.chunk_run_index = chunk_run_index;
        last_sample_in_chunk += stsc2.samples_per_chunk[chunk_run_index];
      }
      sample.description_index = stsc2.sample_description_index[sample.chunk_run_index] - 1;
      sample.description = stsd2.entries[sample.description_index];
      sample.offset = stco2.chunk_offsets[sample.chunk_index - 1] + offset_in_chunk;
      offset_in_chunk += sample.size;
      if (j > last_sample_in_stts_run) {
        stts_run_index++;
        if (last_sample_in_stts_run < 0) last_sample_in_stts_run = 0;
        last_sample_in_stts_run += stts2.sample_counts[stts_run_index];
      }
      if (j > 0) {
        trak2.samples[j - 1].duration = stts2.sample_deltas[stts_run_index];
        trak2.samples_duration += trak2.samples[j - 1].duration;
        sample.dts = trak2.samples[j - 1].dts + trak2.samples[j - 1].duration;
      } else sample.dts = 0;
      if (ctts2) {
        if (j >= last_sample_in_ctts_run) {
          ctts_run_index++;
          if (last_sample_in_ctts_run < 0) last_sample_in_ctts_run = 0;
          last_sample_in_ctts_run += ctts2.sample_counts[ctts_run_index];
        }
        sample.cts = trak2.samples[j].dts + ctts2.sample_offsets[ctts_run_index];
      } else sample.cts = sample.dts;
      if (stss2) {
        if (j === stss2.sample_numbers[last_stss_index] - 1) {
          sample.is_sync = true;
          last_stss_index++;
        } else {
          sample.is_sync = false;
          sample.degradation_priority = 0;
        }
        if (subs) {
          if (subs.entries[subs_entry_index].sample_delta + last_subs_sample_index === j + 1) {
            sample.subsamples = subs.entries[subs_entry_index].subsamples;
            last_subs_sample_index += subs.entries[subs_entry_index].sample_delta;
            subs_entry_index++;
          }
        }
      } else sample.is_sync = true;
      ISOFile2.process_sdtp(trak2.mdia.minf.stbl.sdtp, sample, sample.number);
      if (stdp) sample.degradation_priority = stdp.priority[j];
      else sample.degradation_priority = 0;
      if (subs) {
        if (subs.entries[subs_entry_index].sample_delta + last_subs_sample_index === j) {
          sample.subsamples = subs.entries[subs_entry_index].subsamples;
          last_subs_sample_index += subs.entries[subs_entry_index].sample_delta;
        }
      }
      if (sbgps.length > 0 || sgpds.length > 0) ISOFile2.setSampleGroupProperties(trak2, sample, j, trak2.sample_groups_info);
    }
    if (j > 0) {
      trak2.samples[j - 1].duration = Math.max(trak2.mdia.mdhd.duration - trak2.samples[j - 1].dts, 0);
      trak2.samples_duration += trak2.samples[j - 1].duration;
    }
  }
  /**
  * Update sample list when new 'moof' boxes are received
  * @bundle isofile-sample-processing.js
  */
  updateSampleLists() {
    let default_sample_description_index;
    let default_sample_duration;
    let default_sample_size;
    let default_sample_flags;
    let last_run_position;
    if (this.moov === void 0) return;
    while (this.lastMoofIndex < this.moofs.length) {
      const box2 = this.moofs[this.lastMoofIndex];
      this.lastMoofIndex++;
      if (box2.type === "moof") {
        const moof2 = box2;
        for (let i = 0; i < moof2.trafs.length; i++) {
          const traf2 = moof2.trafs[i];
          const trak2 = this.getTrackById(traf2.tfhd.track_id);
          const trex2 = this.getTrexById(traf2.tfhd.track_id);
          if (traf2.tfhd.flags & 2) default_sample_description_index = traf2.tfhd.default_sample_description_index;
          else default_sample_description_index = trex2 ? trex2.default_sample_description_index : 1;
          if (traf2.tfhd.flags & 8) default_sample_duration = traf2.tfhd.default_sample_duration;
          else default_sample_duration = trex2 ? trex2.default_sample_duration : 0;
          if (traf2.tfhd.flags & 16) default_sample_size = traf2.tfhd.default_sample_size;
          else default_sample_size = trex2 ? trex2.default_sample_size : 0;
          if (traf2.tfhd.flags & 32) default_sample_flags = traf2.tfhd.default_sample_flags;
          else default_sample_flags = trex2 ? trex2.default_sample_flags : 0;
          traf2.sample_number = 0;
          if (traf2.sbgps.length > 0) ISOFile2.initSampleGroups(trak2, traf2, traf2.sbgps, trak2.mdia.minf.stbl.sgpds, traf2.sgpds);
          for (let j = 0; j < traf2.truns.length; j++) {
            const trun2 = traf2.truns[j];
            for (let k = 0; k < trun2.sample_count; k++) {
              const description_index = default_sample_description_index - 1;
              let sample_flags = default_sample_flags;
              if (trun2.flags & 1024) sample_flags = trun2.sample_flags[k];
              else if (k === 0 && trun2.flags & 4) sample_flags = trun2.first_sample_flags;
              let size = default_sample_size;
              if (trun2.flags & 512) size = trun2.sample_size[k];
              trak2.samples_size += size;
              let duration = default_sample_duration;
              if (trun2.flags & 256) duration = trun2.sample_duration[k];
              trak2.samples_duration += duration;
              let dts;
              if (trak2.first_traf_merged || k > 0) dts = trak2.samples[trak2.samples.length - 1].dts + trak2.samples[trak2.samples.length - 1].duration;
              else {
                if (traf2.tfdt) dts = traf2.tfdt.baseMediaDecodeTime;
                else dts = 0;
                trak2.first_traf_merged = true;
              }
              let cts = dts;
              if (trun2.flags & 2048) cts = dts + trun2.sample_composition_time_offset[k];
              const bdop = traf2.tfhd.flags & 1 ? true : false;
              const dbim = traf2.tfhd.flags & 131072 ? true : false;
              const dop = trun2.flags & 1 ? true : false;
              let bdo = 0;
              if (!bdop) if (!dbim) if (j === 0) bdo = moof2.start;
              else bdo = last_run_position;
              else bdo = moof2.start;
              else bdo = traf2.tfhd.base_data_offset;
              let offset;
              if (j === 0 && k === 0) if (dop) offset = bdo + trun2.data_offset;
              else offset = bdo;
              else offset = last_run_position;
              last_run_position = offset + size;
              const number_in_traf = traf2.sample_number;
              traf2.sample_number++;
              const sample = {
                cts,
                description_index,
                description: trak2.mdia.minf.stbl.stsd.entries[description_index],
                dts,
                duration,
                moof_number: this.lastMoofIndex,
                number_in_traf,
                number: trak2.samples.length,
                offset,
                size,
                timescale: trak2.mdia.mdhd.timescale,
                track_id: trak2.tkhd.track_id,
                is_sync: sample_flags >> 16 & 1 ? false : true,
                is_leading: sample_flags >> 26 & 3,
                depends_on: sample_flags >> 24 & 3,
                is_depended_on: sample_flags >> 22 & 3,
                has_redundancy: sample_flags >> 20 & 3,
                degradation_priority: sample_flags & 65535
              };
              traf2.first_sample_index = trak2.samples.length;
              trak2.samples.push(sample);
              if (traf2.sbgps.length > 0 || traf2.sgpds.length > 0 || trak2.mdia.minf.stbl.sbgps.length > 0 || trak2.mdia.minf.stbl.sgpds.length > 0) ISOFile2.setSampleGroupProperties(trak2, sample, sample.number_in_traf, traf2.sample_groups_info);
            }
          }
          if (traf2.subs) {
            trak2.has_fragment_subsamples = true;
            let sample_index = traf2.first_sample_index;
            for (let j = 0; j < traf2.subs.entries.length; j++) {
              sample_index += traf2.subs.entries[j].sample_delta;
              const sample = trak2.samples[sample_index - 1];
              sample.subsamples = traf2.subs.entries[j].subsamples;
            }
          }
        }
      }
    }
  }
  /**
  * Try to get sample data for a given sample:
  * returns null if not found
  * returns the same sample if already requested
  *
  * @bundle isofile-sample-processing.js
  */
  getSample(trak2, sampleNum) {
    const sample = trak2.samples[sampleNum];
    if (!this.moov) return;
    if (!sample.data) {
      sample.data = new Uint8Array(sample.size);
      sample.alreadyRead = 0;
      this.samplesDataSize += sample.size;
      Log.debug("ISOFile", "Allocating sample #" + sampleNum + " on track #" + trak2.tkhd.track_id + " of size " + sample.size + " (total: " + this.samplesDataSize + ")");
    } else if (sample.alreadyRead === sample.size) return sample;
    while (true) {
      let stream = this.stream;
      let index = stream.findPosition(true, sample.offset + sample.alreadyRead, false);
      let buffer;
      let fileStart;
      if (index > -1) {
        buffer = stream.buffers[index];
        fileStart = buffer.fileStart;
      } else for (const mdat2 of this.mdats) {
        if (!mdat2.stream) {
          Log.debug("ISOFile", "mdat stream not yet fully read for #" + this.mdats.indexOf(mdat2) + " mdat");
          continue;
        }
        index = mdat2.stream.findPosition(true, sample.offset + sample.alreadyRead - mdat2.start - mdat2.hdr_size, false);
        if (index > -1) {
          stream = mdat2.stream;
          buffer = mdat2.stream.buffers[index];
          fileStart = mdat2.start + mdat2.hdr_size + buffer.fileStart;
          break;
        }
      }
      if (buffer) {
        const lengthAfterStart = buffer.byteLength - (sample.offset + sample.alreadyRead - fileStart);
        if (sample.size - sample.alreadyRead <= lengthAfterStart) {
          Log.debug("ISOFile", "Getting sample #" + sampleNum + " data (alreadyRead: " + sample.alreadyRead + " offset: " + (sample.offset + sample.alreadyRead - fileStart) + " read size: " + (sample.size - sample.alreadyRead) + " full size: " + sample.size + ")");
          DataStream.memcpy(sample.data.buffer, sample.alreadyRead, buffer, sample.offset + sample.alreadyRead - fileStart, sample.size - sample.alreadyRead);
          buffer.usedBytes += sample.size - sample.alreadyRead;
          stream.logBufferLevel();
          sample.alreadyRead = sample.size;
          return sample;
        } else {
          if (lengthAfterStart === 0) return;
          Log.debug("ISOFile", "Getting sample #" + sampleNum + " partial data (alreadyRead: " + sample.alreadyRead + " offset: " + (sample.offset + sample.alreadyRead - fileStart) + " read size: " + lengthAfterStart + " full size: " + sample.size + ")");
          DataStream.memcpy(sample.data.buffer, sample.alreadyRead, buffer, sample.offset + sample.alreadyRead - fileStart, lengthAfterStart);
          sample.alreadyRead += lengthAfterStart;
          buffer.usedBytes += lengthAfterStart;
          stream.logBufferLevel();
        }
      } else return;
    }
  }
  /**
  * Release the memory used to store the data of the sample
  *
  * @bundle isofile-sample-processing.js
  */
  releaseSample(trak2, sampleNum) {
    const sample = trak2.samples[sampleNum];
    if (sample.data) {
      this.samplesDataSize -= sample.size;
      sample.data = void 0;
      sample.alreadyRead = 0;
      return sample.size;
    } else return 0;
  }
  /** @bundle isofile-sample-processing.js */
  getAllocatedSampleDataSize() {
    return this.samplesDataSize;
  }
  /**
  * Builds the MIME Type 'codecs' sub-parameters for the whole file
  *
  * @bundle isofile-sample-processing.js
  */
  getCodecs() {
    let codecs = "";
    for (let i = 0; i < this.moov.traks.length; i++) {
      const trak2 = this.moov.traks[i];
      if (i > 0) codecs += ",";
      codecs += trak2.mdia.minf.stbl.stsd.entries[0].getCodec();
    }
    return codecs;
  }
  /**
  * Helper function
  *
  * @bundle isofile-sample-processing.js
  */
  getTrexById(id) {
    if (!this.moov || !this.moov.mvex) return;
    for (let i = 0; i < this.moov.mvex.trexs.length; i++) {
      const trex2 = this.moov.mvex.trexs[i];
      if (trex2.track_id === id) return trex2;
    }
  }
  /**
  * Helper function
  *
  * @bundle isofile-sample-processing.js
  */
  getTrackById(id) {
    if (!this.moov) return;
    for (let j = 0; j < this.moov.traks.length; j++) {
      const trak2 = this.moov.traks[j];
      if (trak2.tkhd.track_id === id) return trak2;
    }
  }
  /** @bundle isofile-item-processing.js */
  flattenItemInfo() {
    const items = this.items;
    const entity_groups = this.entity_groups;
    const meta = this.meta;
    if (!meta || !meta.hdlr || !meta.iinf) return;
    for (let i = 0; i < meta.iinf.item_infos.length; i++) {
      const id = meta.iinf.item_infos[i].item_ID;
      items[id] = {
        id,
        name: meta.iinf.item_infos[i].item_name,
        ref_to: [],
        content_type: meta.iinf.item_infos[i].content_type,
        content_encoding: meta.iinf.item_infos[i].content_encoding,
        item_uri_type: meta.iinf.item_infos[i].item_uri_type,
        type: meta.iinf.item_infos[i].item_type ? meta.iinf.item_infos[i].item_type : "mime",
        protection: meta.iinf.item_infos[i].item_protection_index > 0 ? meta.ipro.protections[meta.iinf.item_infos[i].item_protection_index - 1] : void 0
      };
    }
    if (meta.grpl) for (let i = 0; i < meta.grpl.boxes.length; i++) {
      const entityGroup = meta.grpl.boxes[i];
      entity_groups[entityGroup.group_id] = {
        id: entityGroup.group_id,
        entity_ids: entityGroup.entity_ids,
        type: entityGroup.type
      };
    }
    if (meta.iloc) for (let i = 0; i < meta.iloc.items.length; i++) {
      const itemloc = meta.iloc.items[i];
      const item = items[itemloc.item_ID];
      if (itemloc.data_reference_index !== 0) {
        Log.warn("Item storage with reference to other files: not supported");
        item.source = meta.dinf.boxes[itemloc.data_reference_index - 1];
      }
      item.extents = [];
      item.size = 0;
      for (let j = 0; j < itemloc.extents.length; j++) {
        item.extents[j] = {
          offset: itemloc.extents[j].extent_offset + itemloc.base_offset,
          length: itemloc.extents[j].extent_length,
          alreadyRead: 0
        };
        if (itemloc.construction_method === 1) item.extents[j].offset += meta.idat.start + meta.idat.hdr_size;
        item.size += item.extents[j].length;
      }
    }
    if (meta.pitm) {
      const id = meta.pitm.item_id;
      if (!items[id]) Log.warn("ISOFile", "Primary item_id #" + id + " does not exist in items");
      else items[id].primary = true;
    }
    if (meta.iref) for (let i = 0; i < meta.iref.references.length; i++) {
      const ref = meta.iref.references[i];
      for (let j = 0; j < ref.references.length; j++) items[ref.from_item_ID].ref_to.push({
        type: ref.type,
        id: ref.references[j]
      });
    }
    if (meta.iprp) for (let k = 0; k < meta.iprp.ipmas.length; k++) {
      const ipma = meta.iprp.ipmas[k];
      for (let i = 0; i < ipma.associations.length; i++) {
        const association = ipma.associations[i];
        const item = items[association.id] ?? entity_groups[association.id];
        if (item) {
          if (item.properties === void 0) item.properties = { boxes: [] };
          for (let j = 0; j < association.props.length; j++) {
            const propEntry = association.props[j];
            if (propEntry.property_index > 0 && propEntry.property_index - 1 < meta.iprp.ipco.boxes.length) {
              const propbox = meta.iprp.ipco.boxes[propEntry.property_index - 1];
              item.properties[propbox.type] = propbox;
              item.properties.boxes.push(propbox);
            }
          }
        }
      }
    }
  }
  /** @bundle isofile-item-processing.js */
  getItem(item_id) {
    if (!this.meta) return;
    const item = this.items[item_id];
    if (!item.data && item.size) {
      item.data = new Uint8Array(item.size);
      item.alreadyRead = 0;
      this.itemsDataSize += item.size;
      Log.debug("ISOFile", "Allocating item #" + item_id + " of size " + item.size + " (total: " + this.itemsDataSize + ")");
    } else if (item.alreadyRead === item.size) return item;
    for (let i = 0; i < item.extents.length; i++) {
      const extent = item.extents[i];
      if (extent.alreadyRead === extent.length) continue;
      else {
        const index = this.stream.findPosition(true, extent.offset + extent.alreadyRead, false);
        if (index > -1) {
          const buffer = this.stream.buffers[index];
          const lengthAfterStart = buffer.byteLength - (extent.offset + extent.alreadyRead - buffer.fileStart);
          if (extent.length - extent.alreadyRead <= lengthAfterStart) {
            Log.debug("ISOFile", "Getting item #" + item_id + " extent #" + i + " data (alreadyRead: " + extent.alreadyRead + " offset: " + (extent.offset + extent.alreadyRead - buffer.fileStart) + " read size: " + (extent.length - extent.alreadyRead) + " full extent size: " + extent.length + " full item size: " + item.size + ")");
            DataStream.memcpy(item.data.buffer, item.alreadyRead, buffer, extent.offset + extent.alreadyRead - buffer.fileStart, extent.length - extent.alreadyRead);
            if (!this.parsingMdat || this.discardMdatData) buffer.usedBytes += extent.length - extent.alreadyRead;
            this.stream.logBufferLevel();
            item.alreadyRead += extent.length - extent.alreadyRead;
            extent.alreadyRead = extent.length;
          } else {
            Log.debug("ISOFile", "Getting item #" + item_id + " extent #" + i + " partial data (alreadyRead: " + extent.alreadyRead + " offset: " + (extent.offset + extent.alreadyRead - buffer.fileStart) + " read size: " + lengthAfterStart + " full extent size: " + extent.length + " full item size: " + item.size + ")");
            DataStream.memcpy(item.data.buffer, item.alreadyRead, buffer, extent.offset + extent.alreadyRead - buffer.fileStart, lengthAfterStart);
            extent.alreadyRead += lengthAfterStart;
            item.alreadyRead += lengthAfterStart;
            if (!this.parsingMdat || this.discardMdatData) buffer.usedBytes += lengthAfterStart;
            this.stream.logBufferLevel();
            return;
          }
        } else return;
      }
    }
    if (item.alreadyRead === item.size) return item;
  }
  /**
  * Release the memory used to store the data of the item
  *
  * @bundle isofile-item-processing.js
  */
  releaseItem(item_id) {
    const item = this.items[item_id];
    if (item.data) {
      this.itemsDataSize -= item.size;
      item.data = void 0;
      item.alreadyRead = 0;
      for (let i = 0; i < item.extents.length; i++) {
        const extent = item.extents[i];
        extent.alreadyRead = 0;
      }
      return item.size;
    } else return 0;
  }
  /** @bundle isofile-item-processing.js */
  processItems(callback) {
    for (const i in this.items) {
      const item = this.items[i];
      this.getItem(item.id);
      if (callback && !item.sent) {
        callback(item);
        item.sent = true;
        item.data = void 0;
      }
    }
  }
  /** @bundle isofile-item-processing.js */
  hasItem(name) {
    for (const i in this.items) {
      const item = this.items[i];
      if (item.name === name) return item.id;
    }
    return -1;
  }
  /** @bundle isofile-item-processing.js */
  getMetaHandler() {
    if (this.meta) return this.meta.hdlr.handler;
  }
  /** @bundle isofile-item-processing.js */
  getPrimaryItem() {
    if (this.meta && this.meta.pitm) return this.getItem(this.meta.pitm.item_id);
  }
  /** @bundle isofile-item-processing.js */
  itemToFragmentedTrackFile({ itemId } = {}) {
    let item;
    if (itemId) item = this.getItem(itemId);
    else item = this.getPrimaryItem();
    if (!item) return;
    const file = new ISOFile2();
    file.discardMdatData = false;
    const trackOptions = {
      type: item.type,
      description_boxes: item.properties.boxes
    };
    if (item.properties.ispe) {
      trackOptions.width = item.properties.ispe.image_width;
      trackOptions.height = item.properties.ispe.image_height;
    }
    const trackId = file.addTrack(trackOptions);
    if (trackId) {
      file.addSample(trackId, item.data);
      return file;
    }
  }
  /** @bundle isofile-advanced-parsing.js */
  processIncompleteBox(ret) {
    if (ret.type === "mdat") {
      const box2 = new mdatBox(ret.size);
      this.parsingMdat = box2;
      this.boxes.push(box2);
      this.mdats.push(box2);
      box2.start = ret.start;
      box2.hdr_size = ret.hdr_size;
      box2.original_size = ret.original_size;
      this.stream.addUsedBytes(box2.hdr_size);
      this.lastBoxStartPosition = box2.start + box2.size;
      if (this.stream.seek(box2.start + box2.size, false, this.discardMdatData)) {
        this.transferMdatData();
        this.parsingMdat = void 0;
        return true;
      } else {
        if (!this.moovStartFound) this.nextParsePosition = box2.start + box2.size;
        else this.nextParsePosition = this.stream.findEndContiguousBuf();
        return false;
      }
    } else {
      if (ret.type === "moov") {
        this.moovStartFound = true;
        if (this.mdats.length === 0) this.isProgressive = true;
      }
      if (this.stream.mergeNextBuffer ? this.stream.mergeNextBuffer() : false) {
        this.nextParsePosition = this.stream.getEndPosition();
        return true;
      } else {
        if (!ret.type) this.nextParsePosition = this.stream.getEndPosition();
        else if (this.moovStartFound) this.nextParsePosition = this.stream.getEndPosition();
        else this.nextParsePosition = this.stream.getPosition() + ret.size;
        return false;
      }
    }
  }
  /** @bundle isofile-advanced-parsing.js */
  hasIncompleteMdat() {
    return this.parsingMdat !== void 0;
  }
  /**
  * Transfer the data of the mdat box to its stream
  * @param mdat the mdat box to use
  */
  transferMdatData(inMdat) {
    const mdat2 = inMdat ?? this.parsingMdat;
    if (this.discardMdatData) {
      Log.debug("ISOFile", "Discarding 'mdat' data, not transferring it to the mdat box stream");
      return;
    }
    if (!mdat2) {
      Log.warn("ISOFile", "Cannot transfer 'mdat' data, no mdat box is being parsed");
      return;
    }
    const startBufferIndex = this.stream.findPosition(true, mdat2.start + mdat2.hdr_size, false);
    const endBufferIndex = this.stream.findPosition(true, mdat2.start + mdat2.size, false);
    if (startBufferIndex === -1 || endBufferIndex === -1) {
      Log.warn("ISOFile", "Cannot transfer 'mdat' data, start or end buffer not found");
      return;
    }
    mdat2.stream = new MultiBufferStream();
    for (let i = startBufferIndex; i <= endBufferIndex; i++) {
      const buffer = this.stream.buffers[i];
      const startOffset = i === startBufferIndex ? mdat2.start + mdat2.hdr_size - buffer.fileStart : 0;
      const endOffset = i === endBufferIndex ? mdat2.start + mdat2.size - buffer.fileStart : buffer.byteLength;
      if (endOffset > startOffset) {
        Log.debug("ISOFile", "Transferring 'mdat' data from buffer #" + i + " (" + startOffset + " to " + endOffset + ")");
        const transferSize = endOffset - startOffset;
        const newBuffer = new MP4BoxBuffer(transferSize);
        const lastPosition = mdat2.stream.getAbsoluteEndPosition();
        DataStream.memcpy(newBuffer, 0, buffer, startOffset, transferSize);
        newBuffer.fileStart = lastPosition;
        mdat2.stream.insertBuffer(newBuffer);
        buffer.usedBytes += transferSize;
      }
    }
  }
  /** @bundle isofile-advanced-parsing.js */
  processIncompleteMdat() {
    const box2 = this.parsingMdat;
    if (this.stream.seek(box2.start + box2.size, false, this.discardMdatData)) {
      Log.debug("ISOFile", "Found 'mdat' end in buffered data");
      this.transferMdatData();
      this.parsingMdat = void 0;
      return true;
    } else {
      this.nextParsePosition = this.stream.findEndContiguousBuf();
      return false;
    }
  }
  /** @bundle isofile-advanced-parsing.js */
  restoreParsePosition() {
    return this.stream.seek(this.lastBoxStartPosition, true, this.discardMdatData);
  }
  /** @bundle isofile-advanced-parsing.js */
  saveParsePosition() {
    this.lastBoxStartPosition = this.stream.getPosition();
  }
  /** @bundle isofile-advanced-parsing.js */
  updateUsedBytes(box2, _ret) {
    if (this.stream.addUsedBytes) if (box2.type === "mdat") {
      this.stream.addUsedBytes(box2.hdr_size);
      if (this.discardMdatData) this.stream.addUsedBytes(box2.size - box2.hdr_size);
    } else this.stream.addUsedBytes(box2.size);
  }
  /** @bundle isofile-advanced-creation.js */
  addBox(box2) {
    return Box.prototype.addBox.call(this, box2);
  }
  /** @bundle isofile-advanced-creation.js */
  init(options = {}) {
    const ftyp2 = this.addBox(new ftypBox());
    ftyp2.major_brand = options.brands && options.brands[0] || "iso4";
    ftyp2.minor_version = 0;
    ftyp2.compatible_brands = options.brands || ["iso4"];
    const moov2 = this.addBox(new moovBox());
    moov2.addBox(new mvexBox());
    const mvhd2 = moov2.addBox(new mvhdBox());
    mvhd2.timescale = options.timescale || 600;
    mvhd2.rate = options.rate || 65536;
    mvhd2.creation_time = 0;
    mvhd2.modification_time = 0;
    mvhd2.duration = options.duration || 0;
    mvhd2.volume = options.width ? 0 : 256;
    mvhd2.matrix = [
      65536,
      0,
      0,
      0,
      65536,
      0,
      0,
      0,
      1073741824
    ];
    mvhd2.next_track_id = 1;
    return this;
  }
  /** @bundle isofile-advanced-creation.js */
  addTrack(_options3 = {}) {
    if (!this.moov) this.init(_options3);
    const options = _options3 || {};
    options.width = options.width || 320;
    options.height = options.height || 320;
    options.id = options.id || this.moov.mvhd.next_track_id;
    options.type = options.type || "avc1";
    const trak2 = this.moov.addBox(new trakBox());
    this.moov.mvhd.next_track_id = options.id + 1;
    const tkhd2 = trak2.addBox(new tkhdBox());
    tkhd2.flags = 1 | 2 | 4;
    tkhd2.creation_time = 0;
    tkhd2.modification_time = 0;
    tkhd2.track_id = options.id;
    tkhd2.duration = options.duration || 0;
    tkhd2.layer = options.layer || 0;
    tkhd2.alternate_group = 0;
    tkhd2.volume = 1;
    tkhd2.matrix = [
      65536,
      0,
      0,
      0,
      65536,
      0,
      0,
      0,
      1073741824
    ];
    tkhd2.width = options.width << 16;
    tkhd2.height = options.height << 16;
    const mdia2 = trak2.addBox(new mdiaBox());
    const mdhd2 = mdia2.addBox(new mdhdBox());
    mdhd2.creation_time = 0;
    mdhd2.modification_time = 0;
    mdhd2.timescale = options.timescale || 1;
    mdhd2.duration = options.media_duration || 0;
    mdhd2.language = options.language || "und";
    const hdlr2 = mdia2.addBox(new hdlrBox());
    hdlr2.handler = options.hdlr || "vide";
    hdlr2.name = options.name || "Track created with MP4Box.js";
    const elng = mdia2.addBox(new elngBox());
    elng.extended_language = options.language || "fr-FR";
    const minf2 = mdia2.addBox(new minfBox());
    const sampleEntry = BoxRegistry.sampleEntry[options.type];
    if (!sampleEntry) return;
    const sample_description_entry = new sampleEntry();
    sample_description_entry.data_reference_index = 1;
    if (sample_description_entry instanceof VisualSampleEntry) {
      const sde = sample_description_entry;
      const vmhd2 = minf2.addBox(new vmhdBox());
      vmhd2.graphicsmode = 0;
      vmhd2.opcolor = [
        0,
        0,
        0
      ];
      sde.width = options.width;
      sde.height = options.height;
      sde.horizresolution = 72 << 16;
      sde.vertresolution = 72 << 16;
      sde.frame_count = 1;
      sde.compressorname = options.type + " Compressor";
      sde.depth = 24;
      if (options.avcDecoderConfigRecord) sde.addBox(new avcCBox(options.avcDecoderConfigRecord.byteLength)).parse(new DataStream(options.avcDecoderConfigRecord));
      else if (options.hevcDecoderConfigRecord) sde.addBox(new hvcCBox(options.hevcDecoderConfigRecord.byteLength)).parse(new DataStream(options.hevcDecoderConfigRecord));
    } else if (sample_description_entry instanceof AudioSampleEntry) {
      const sde = sample_description_entry;
      const smhd2 = minf2.addBox(new smhdBox());
      smhd2.balance = options.balance || 0;
      sde.channel_count = options.channel_count || 2;
      sde.samplesize = options.samplesize || 16;
      sde.samplerate = options.samplerate || 65536;
    } else if (sample_description_entry instanceof HintSampleEntry) minf2.addBox(new hmhdBox());
    else if (sample_description_entry instanceof SubtitleSampleEntry) {
      minf2.addBox(new sthdBox());
      if (sample_description_entry instanceof stppSampleEntry) {
        sample_description_entry.namespace = options.namespace || "nonamespace";
        sample_description_entry.schema_location = options.schema_location || "";
        sample_description_entry.auxiliary_mime_types = options.auxiliary_mime_types || "";
      }
    } else if (sample_description_entry instanceof MetadataSampleEntry) minf2.addBox(new nmhdBox());
    else if (sample_description_entry instanceof SystemSampleEntry) minf2.addBox(new nmhdBox());
    else minf2.addBox(new nmhdBox());
    if (options.description) sample_description_entry.addBox.call(sample_description_entry, options.description);
    if (options.description_boxes) options.description_boxes.forEach(function(b) {
      sample_description_entry.addBox.call(sample_description_entry, b);
    });
    const dref2 = minf2.addBox(new dinfBox()).addBox(new drefBox());
    const url2 = new urlBox();
    url2.flags = 1;
    dref2.addEntry(url2);
    const stbl2 = minf2.addBox(new stblBox());
    stbl2.addBox(new stsdBox()).addEntry(sample_description_entry);
    const stts2 = stbl2.addBox(new sttsBox());
    stts2.sample_counts = [];
    stts2.sample_deltas = [];
    const stsc2 = stbl2.addBox(new stscBox());
    stsc2.first_chunk = [];
    stsc2.samples_per_chunk = [];
    stsc2.sample_description_index = [];
    const stco2 = stbl2.addBox(new stcoBox());
    stco2.chunk_offsets = [];
    const stsz2 = stbl2.addBox(new stszBox());
    stsz2.sample_sizes = [];
    const trex2 = this.moov.mvex.addBox(new trexBox());
    trex2.track_id = options.id;
    trex2.default_sample_description_index = options.default_sample_description_index || 1;
    trex2.default_sample_duration = options.default_sample_duration || 0;
    trex2.default_sample_size = options.default_sample_size || 0;
    trex2.default_sample_flags = options.default_sample_flags || 0;
    this.buildTrakSampleLists(trak2);
    return options.id;
  }
  /** @bundle isofile-advanced-creation.js */
  addSample(track_id, data, { sample_description_index, duration = 1, cts = 0, dts = 0, is_sync = false, is_leading = 0, depends_on = 0, is_depended_on = 0, has_redundancy = 0, degradation_priority = 0, subsamples, offset = 0 } = {}) {
    const trak2 = this.getTrackById(track_id);
    if (trak2 === void 0) return;
    const descriptionIndex = sample_description_index ? sample_description_index - 1 : 0;
    const sample = {
      number: trak2.samples.length,
      track_id: trak2.tkhd.track_id,
      timescale: trak2.mdia.mdhd.timescale,
      description_index: descriptionIndex,
      description: trak2.mdia.minf.stbl.stsd.entries[descriptionIndex],
      data,
      size: data.byteLength,
      alreadyRead: data.byteLength,
      duration,
      cts,
      dts,
      is_sync,
      is_leading,
      depends_on,
      is_depended_on,
      has_redundancy,
      degradation_priority,
      offset,
      subsamples
    };
    trak2.samples.push(sample);
    trak2.samples_size += sample.size;
    trak2.samples_duration += sample.duration;
    if (trak2.first_dts === void 0) trak2.first_dts = dts;
    this.processSamples();
    const moof2 = this.addBox(this.createMoof([sample]));
    moof2.computeSize();
    moof2.trafs[0].truns[0].data_offset = moof2.size + 8;
    const mdat2 = this.addBox(new mdatBox());
    mdat2.data = new Uint8Array(data);
    return sample;
  }
  /** @bundle isofile-advanced-creation.js */
  createMoof(samples) {
    if (samples.length === 0) return;
    if (samples.some((s) => s.track_id !== samples[0].track_id)) throw new Error("Cannot create moof for samples from different tracks: " + samples.map((s) => s.track_id).join(", "));
    const trackId = samples[0].track_id;
    const trak2 = this.getTrackById(trackId);
    if (!trak2) throw new Error("Cannot create moof for non-existing track: " + trackId);
    const moof2 = new moofBox();
    const mfhd2 = moof2.addBox(new mfhdBox());
    mfhd2.sequence_number = ++this.nextMoofNumber;
    const traf2 = moof2.addBox(new trafBox());
    const tfhd2 = traf2.addBox(new tfhdBox());
    tfhd2.track_id = trackId;
    tfhd2.flags = TFHD_FLAG_DEFAULT_BASE_IS_MOOF;
    const tfdt2 = traf2.addBox(new tfdtBox());
    tfdt2.baseMediaDecodeTime = samples[0].dts - (trak2.first_dts || 0);
    const trun2 = traf2.addBox(new trunBox());
    trun2.flags = 1 | 256 | 512 | TRUN_FLAGS_FLAGS | TRUN_FLAGS_CTS_OFFSET;
    trun2.data_offset = 0;
    trun2.first_sample_flags = 0;
    trun2.sample_count = samples.length;
    for (const sample of samples) {
      let sample_flags = 0;
      if (sample.is_sync) sample_flags = 1 << 25;
      else sample_flags = 65536;
      trun2.sample_duration.push(sample.duration);
      trun2.sample_size.push(sample.size);
      trun2.sample_flags.push(sample_flags);
      trun2.sample_composition_time_offset.push(sample.cts - sample.dts);
    }
    return moof2;
  }
  /** @bundle box-print.js */
  print(output) {
    output.indent = "";
    for (let i = 0; i < this.boxes.length; i++) if (this.boxes[i]) this.boxes[i].print(output);
  }
};
function createFile(keepMdatData = false, stream) {
  return new ISOFile(stream, !keepMdatData);
}
var emsgBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "EventMessageBox";
  }
  static {
    this.fourcc = "emsg";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.version === 1) {
      this.timescale = stream.readUint32();
      this.presentation_time = stream.readUint64();
      this.event_duration = stream.readUint32();
      this.id = stream.readUint32();
      this.scheme_id_uri = stream.readCString();
      this.value = stream.readCString();
    } else {
      this.scheme_id_uri = stream.readCString();
      this.value = stream.readCString();
      this.timescale = stream.readUint32();
      this.presentation_time_delta = stream.readUint32();
      this.event_duration = stream.readUint32();
      this.id = stream.readUint32();
    }
    let message_size = this.size - this.hdr_size - (16 + (this.scheme_id_uri.length + 1) + (this.value.length + 1));
    if (this.version === 1) message_size -= 4;
    this.message_data = stream.readUint8Array(message_size);
  }
  /** @bundle writing/emsg.js */
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = 16 + this.message_data.length + (this.scheme_id_uri.length + 1) + (this.value.length + 1);
    this.writeHeader(stream);
    stream.writeCString(this.scheme_id_uri);
    stream.writeCString(this.value);
    stream.writeUint32(this.timescale);
    stream.writeUint32(this.presentation_time_delta);
    stream.writeUint32(this.event_duration);
    stream.writeUint32(this.id);
    stream.writeUint8Array(this.message_data);
  }
};
var ssixBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CompressedSubsegmentIndexBox";
  }
  static {
    this.fourcc = "ssix";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.subsegments = [];
    const subsegment_count = stream.readUint32();
    for (let i = 0; i < subsegment_count; i++) {
      const subsegment = {};
      this.subsegments.push(subsegment);
      subsegment.ranges = [];
      const range_count = stream.readUint32();
      for (let j = 0; j < range_count; j++) {
        const range = {};
        subsegment.ranges.push(range);
        range.level = stream.readUint8();
        range.range_size = stream.readUint24();
      }
    }
  }
};
var stypBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SegmentTypeBox";
  }
  static {
    this.fourcc = "styp";
  }
  parse(stream) {
    let toparse = this.size - this.hdr_size;
    this.major_brand = stream.readString(4);
    this.minor_version = stream.readUint32();
    toparse -= 8;
    this.compatible_brands = [];
    let i = 0;
    while (toparse >= 4) {
      this.compatible_brands[i] = stream.readString(4);
      toparse -= 4;
      i++;
    }
  }
  write(stream) {
    this.size = 8 + 4 * this.compatible_brands.length;
    this.writeHeader(stream);
    stream.writeString(this.major_brand, void 0, 4);
    stream.writeUint32(this.minor_version);
    for (let i = 0; i < this.compatible_brands.length; i++) stream.writeString(this.compatible_brands[i], void 0, 4);
  }
};

// ../frontend/node_modules/mp4box/dist/mp4box.all.mjs
var descriptor_exports = /* @__PURE__ */ __exportAll({
  Descriptor: () => Descriptor,
  ES_Descriptor: () => ES_Descriptor,
  MPEG4DescriptorParser: () => MPEG4DescriptorParser
});
var ES_DescrTag = 3;
var DecoderConfigDescrTag = 4;
var DecSpecificInfoTag = 5;
var SLConfigDescrTag = 6;
var Descriptor = class Descriptor2 {
  constructor(tag, size) {
    this.tag = tag;
    this.size = size;
    this.descs = [];
  }
  parse(stream) {
    this.data = stream.readUint8Array(this.size);
  }
  findDescriptor(tag) {
    for (let i = 0; i < this.descs.length; i++) if (this.descs[i].tag === tag) return this.descs[i];
  }
  parseOneDescriptor(stream) {
    let size = 0;
    const tag = stream.readUint8();
    let byteRead = stream.readUint8();
    while (byteRead & 128) {
      size = (size << 7) + (byteRead & 127);
      byteRead = stream.readUint8();
    }
    size = (size << 7) + (byteRead & 127);
    Log.debug("Descriptor", "Found " + (descTagToName[tag] || "Descriptor " + tag) + ", size " + size + " at position " + stream.getPosition());
    const desc = descTagToName[tag] ? new DESCRIPTOR_CLASSES[descTagToName[tag]](size) : new Descriptor2(size);
    desc.parse(stream);
    return desc;
  }
  parseRemainingDescriptors(stream) {
    const start2 = stream.getPosition();
    while (stream.getPosition() < start2 + this.size) {
      const desc = this.parseOneDescriptor?.(stream);
      this.descs.push(desc);
    }
  }
};
var ES_Descriptor = class extends Descriptor {
  constructor(size) {
    super(ES_DescrTag, size);
  }
  parse(stream) {
    this.ES_ID = stream.readUint16();
    this.flags = stream.readUint8();
    this.size -= 3;
    if (this.flags & 128) {
      this.dependsOn_ES_ID = stream.readUint16();
      this.size -= 2;
    } else this.dependsOn_ES_ID = 0;
    if (this.flags & 64) {
      const l = stream.readUint8();
      this.URL = stream.readString(l);
      this.size -= l + 1;
    } else this.URL = "";
    if (this.flags & 32) {
      this.OCR_ES_ID = stream.readUint16();
      this.size -= 2;
    } else this.OCR_ES_ID = 0;
    this.parseRemainingDescriptors(stream);
  }
  getOTI() {
    const dcd = this.findDescriptor(DecoderConfigDescrTag);
    if (dcd) return dcd.oti;
    else return 0;
  }
  getAudioConfig() {
    const dcd = this.findDescriptor(DecoderConfigDescrTag);
    if (!dcd) return;
    const dsi = dcd.findDescriptor(DecSpecificInfoTag);
    if (dsi && dsi.data) {
      let audioObjectType = (dsi.data[0] & 248) >> 3;
      if (audioObjectType === 31 && dsi.data.length >= 2) audioObjectType = 32 + ((dsi.data[0] & 7) << 3) + ((dsi.data[1] & 224) >> 5);
      return audioObjectType;
    }
  }
};
var DecoderConfigDescriptor = class extends Descriptor {
  constructor(size) {
    super(DecoderConfigDescrTag, size);
  }
  parse(stream) {
    this.oti = stream.readUint8();
    this.streamType = stream.readUint8();
    this.upStream = (this.streamType >> 1 & 1) !== 0;
    this.streamType = this.streamType >>> 2;
    this.bufferSize = stream.readUint24();
    this.maxBitrate = stream.readUint32();
    this.avgBitrate = stream.readUint32();
    this.size -= 13;
    this.parseRemainingDescriptors(stream);
  }
};
var DecoderSpecificInfo = class extends Descriptor {
  constructor(size) {
    super(DecSpecificInfoTag, size);
  }
};
var SLConfigDescriptor = class extends Descriptor {
  constructor(size) {
    super(SLConfigDescrTag, size);
  }
};
var DESCRIPTOR_CLASSES = {
  Descriptor,
  ES_Descriptor,
  DecoderConfigDescriptor,
  DecoderSpecificInfo,
  SLConfigDescriptor
};
var descTagToName = {
  [ES_DescrTag]: "ES_Descriptor",
  [DecoderConfigDescrTag]: "DecoderConfigDescriptor",
  [DecSpecificInfoTag]: "DecoderSpecificInfo",
  [SLConfigDescrTag]: "SLConfigDescriptor"
};
var MPEG4DescriptorParser = class {
  constructor() {
    this.parseOneDescriptor = Descriptor.prototype.parseOneDescriptor;
  }
  getDescriptorName(tag) {
    return descTagToName[tag];
  }
};
var VTTin4Parser = class {
  parseSample(data) {
    const cues = [];
    const stream = new MultiBufferStream(MP4BoxBuffer.fromArrayBuffer(data.buffer, 0));
    while (!stream.isEof()) {
      const cue = parseOneBox(stream, false);
      if (cue.code === 1 && cue.box?.type === "vttc") cues.push(cue.box);
    }
    return cues;
  }
  getText(startTime, endTime, data) {
    function pad(value, width) {
      const string2 = value.toString();
      if (string2.length >= width) return string2;
      return new Array(width - string2.length + 1).join("0") + string2;
    }
    function secToTimestamp(insec) {
      const h = Math.floor(insec / 3600);
      const m = Math.floor((insec - h * 3600) / 60);
      const s = Math.floor(insec - h * 3600 - m * 60);
      const ms = Math.floor((insec - h * 3600 - m * 60 - s) * 1e3);
      return "" + pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s, 2) + "." + pad(ms, 3);
    }
    const cues = this.parseSample(data);
    let string = "";
    for (let i = 0; i < cues.length; i++) {
      const cueIn4 = cues[i];
      string += secToTimestamp(startTime) + " --> " + secToTimestamp(endTime) + "\r\n";
      string += cueIn4.payl.text;
    }
    return string;
  }
};
var XMLSubtitlein4Parser = class {
  parseSample(sample) {
    const res = {
      resources: [],
      documentString: "",
      document: void 0
    };
    const stream = new DataStream(sample.data.buffer);
    if (!sample.subsamples || sample.subsamples.length === 0) res.documentString = stream.readString(sample.data.length);
    else {
      res.documentString = stream.readString(sample.subsamples[0].size);
      if (sample.subsamples.length > 1) for (let i = 1; i < sample.subsamples.length; i++) res.resources[i] = stream.readUint8Array(sample.subsamples[i].size);
    }
    if (typeof DOMParser !== "undefined") res.document = new DOMParser().parseFromString(res.documentString, "application/xml");
    return res;
  }
};
var Textin4Parser = class {
  parseSample(sample) {
    return new DataStream(sample.data.buffer).readString(sample.data.length);
  }
  parseConfig(data) {
    const stream = new DataStream(data.buffer);
    stream.readUint32();
    return stream.readCString();
  }
};
var TX3GParser = class {
  parseSample(sample) {
    const stream = new DataStream(sample.data.buffer);
    const size = stream.readUint16();
    if (size === 0) return;
    return stream.readString(size);
  }
};
var a1lxBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "AV1LayeredImageIndexingProperty";
  }
  static {
    this.fourcc = "a1lx";
  }
  parse(stream) {
    const FieldLength = ((stream.readUint8() & 1) + 1) * 16;
    this.layer_size = [];
    for (let i = 0; i < 3; i++) if (FieldLength === 16) this.layer_size[i] = stream.readUint16();
    else this.layer_size[i] = stream.readUint32();
  }
};
var a1opBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "OperatingPointSelectorProperty";
  }
  static {
    this.fourcc = "a1op";
  }
  parse(stream) {
    this.op_index = stream.readUint8();
  }
};
var auxCBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "AuxiliaryTypeProperty";
  }
  static {
    this.fourcc = "auxC";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.aux_type = stream.readCString();
    const aux_subtype_length = this.size - this.hdr_size - (this.aux_type.length + 1);
    this.aux_subtype = stream.readUint8Array(aux_subtype_length);
  }
};
var btrtBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "BitRateBox";
  }
  static {
    this.fourcc = "btrt";
  }
  parse(stream) {
    this.bufferSizeDB = stream.readUint32();
    this.maxBitrate = stream.readUint32();
    this.avgBitrate = stream.readUint32();
  }
};
var ccstBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CodingConstraintsBox";
  }
  static {
    this.fourcc = "ccst";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const flags = stream.readUint8();
    this.all_ref_pics_intra = (flags & 128) === 128;
    this.intra_pred_used = (flags & 64) === 64;
    this.max_ref_per_pic = (flags & 63) >> 2;
    stream.readUint24();
  }
};
var cdefBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ComponentDefinitionBox";
  }
  static {
    this.fourcc = "cdef";
  }
  parse(stream) {
    this.channel_count = stream.readUint16();
    this.channel_indexes = [];
    this.channel_types = [];
    this.channel_associations = [];
    for (let i = 0; i < this.channel_count; i++) {
      this.channel_indexes.push(stream.readUint16());
      this.channel_types.push(stream.readUint16());
      this.channel_associations.push(stream.readUint16());
    }
  }
};
var clapBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CleanApertureBox";
  }
  static {
    this.fourcc = "clap";
  }
  parse(stream) {
    this.cleanApertureWidthN = stream.readUint32();
    this.cleanApertureWidthD = stream.readUint32();
    this.cleanApertureHeightN = stream.readUint32();
    this.cleanApertureHeightD = stream.readUint32();
    this.horizOffN = stream.readUint32();
    this.horizOffD = stream.readUint32();
    this.vertOffN = stream.readUint32();
    this.vertOffD = stream.readUint32();
  }
};
var clliBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ContentLightLevelBox";
  }
  static {
    this.fourcc = "clli";
  }
  parse(stream) {
    this.max_content_light_level = stream.readUint16();
    this.max_pic_average_light_level = stream.readUint16();
  }
};
var cmexBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CameraExtrinsicMatrixProperty";
  }
  static {
    this.fourcc = "cmex";
  }
  parse(stream) {
    if (this.flags & 1) this.pos_x = stream.readInt32();
    if (this.flags & 2) this.pos_y = stream.readInt32();
    if (this.flags & 4) this.pos_z = stream.readInt32();
    if (this.flags & 8) {
      if (this.version === 0) if (this.flags & 16) {
        this.quat_x = stream.readInt32();
        this.quat_y = stream.readInt32();
        this.quat_z = stream.readInt32();
      } else {
        this.quat_x = stream.readInt16();
        this.quat_y = stream.readInt16();
        this.quat_z = stream.readInt16();
      }
      else if (this.version === 1) {
      }
    }
    if (this.flags & 32) this.id = stream.readUint32();
  }
};
var cminBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CameraIntrinsicMatrixProperty";
  }
  static {
    this.fourcc = "cmin";
  }
  parse(stream) {
    this.focal_length_x = stream.readInt32();
    this.principal_point_x = stream.readInt32();
    this.principal_point_y = stream.readInt32();
    if (this.flags & 1) {
      this.focal_length_y = stream.readInt32();
      this.skew_factor = stream.readInt32();
    }
  }
};
var cmpCBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CompressionConfigurationBox";
  }
  static {
    this.fourcc = "cmpC";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.compression_type = stream.readString(4);
    this.compressed_unit_type = stream.readUint8();
  }
};
var cmpdBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ComponentDefinitionBox";
  }
  static {
    this.fourcc = "cmpd";
  }
  parse(stream) {
    this.component_count = stream.readUint32();
    this.component_types = [];
    this.component_type_urls = [];
    for (let i = 0; i < this.component_count; i++) {
      const component_type = stream.readUint16();
      this.component_types.push(component_type);
      if (component_type >= 32768) this.component_type_urls.push(stream.readCString());
    }
  }
};
var co64Box = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ChunkLargeOffsetBox";
  }
  static {
    this.fourcc = "co64";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const entry_count = stream.readUint32();
    this.chunk_offsets = [];
    if (this.version === 0) for (let i = 0; i < entry_count; i++) this.chunk_offsets.push(stream.readUint64());
  }
  /** @bundle writing/co64.js */
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = 4 + 8 * this.chunk_offsets.length;
    this.writeHeader(stream);
    stream.writeUint32(this.chunk_offsets.length);
    for (let i = 0; i < this.chunk_offsets.length; i++) stream.writeUint64(this.chunk_offsets[i]);
  }
};
var CoLLBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ContentLightLevelBox";
  }
  static {
    this.fourcc = "CoLL";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.maxCLL = stream.readUint16();
    this.maxFALL = stream.readUint16();
  }
};
var SphereRegion = class {
  toString() {
    let s = "centre_azimuth: ";
    s += this.centre_azimuth;
    s += " (";
    s += this.centre_azimuth * 2 ** -16;
    s += "\xB0), centre_elevation: ";
    s += this.centre_elevation;
    s += " (";
    s += this.centre_elevation * 2 ** -16;
    s += "\xB0), centre_tilt: ";
    s += this.centre_tilt;
    s += " (";
    s += this.centre_tilt * 2 ** -16;
    s += "\xB0)";
    if (this.range_included_flag) {
      s += ", azimuth_range: ";
      s += this.azimuth_range;
      s += " (";
      s += this.azimuth_range * 2 ** -16;
      s += "\xB0), elevation_range: ";
      s += this.elevation_range;
      s += " (";
      s += this.elevation_range * 2 ** -16;
      s += "\xB0)";
    }
    if (this.interpolate_included_flag) {
      s += ", interpolate: ";
      s += this.interpolate;
    }
    return s;
  }
};
var CoverageSphereRegion = class {
  toString() {
    let s = "";
    if (this.view_idc) {
      s += "view_idc: ";
      s += this.view_idc;
      s += ", ";
    }
    s += "sphere_region: {";
    s += this.sphere_region;
    s += "}";
    return s;
  }
};
var coviBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CoverageInformationBox";
  }
  static {
    this.fourcc = "covi";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.coverage_shape_type = stream.readUint8();
    const num_regions = stream.readUint8();
    const f = stream.readInt8();
    const view_idc_presence_flag = f & 128;
    if (view_idc_presence_flag) this.default_view_idc = (f & 96) >> 5;
    this.coverage_regions = new Array();
    for (let i = 0; i < num_regions; i++) {
      const region = new CoverageSphereRegion();
      if (view_idc_presence_flag) region.view_idc = stream.readUint8() >> 6;
      region.sphere_region = this.parseSphereRegion(stream, true, true);
      this.coverage_regions.push(region);
    }
  }
  parseSphereRegion(stream, range_included_flag, interpolate_included_flag) {
    const sphere_region = new SphereRegion();
    sphere_region.centre_azimuth = stream.readInt32();
    sphere_region.centre_elevation = stream.readInt32();
    sphere_region.centre_tilt = stream.readInt32();
    sphere_region.range_included_flag = range_included_flag;
    if (range_included_flag) {
      sphere_region.azimuth_range = stream.readUint32();
      sphere_region.elevation_range = stream.readUint32();
    }
    sphere_region.interpolate_included_flag = interpolate_included_flag;
    if (interpolate_included_flag) sphere_region.interpolate = (stream.readUint8() & 128) === 128;
    return sphere_region;
  }
};
var cprtBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CopyrightBox";
  }
  static {
    this.fourcc = "cprt";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.parseLanguage(stream);
    this.notice = stream.readCString();
  }
};
var cschBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CompatibleSchemeTypeBox";
  }
  static {
    this.fourcc = "csch";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.scheme_type = stream.readString(4);
    this.scheme_version = stream.readUint32();
    if (this.flags & 1) this.scheme_uri = stream.readCString();
  }
};
var INT32_MAX = 2147483647;
var cslgBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CompositionToDecodeBox";
  }
  static {
    this.fourcc = "cslg";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.version === 0) {
      this.compositionToDTSShift = stream.readInt32();
      this.leastDecodeToDisplayDelta = stream.readInt32();
      this.greatestDecodeToDisplayDelta = stream.readInt32();
      this.compositionStartTime = stream.readInt32();
      this.compositionEndTime = stream.readInt32();
    } else if (this.version === 1) {
      this.compositionToDTSShift = stream.readInt64();
      this.leastDecodeToDisplayDelta = stream.readInt64();
      this.greatestDecodeToDisplayDelta = stream.readInt64();
      this.compositionStartTime = stream.readInt64();
      this.compositionEndTime = stream.readInt64();
    }
  }
  /** @bundle writing/cslg.js */
  write(stream) {
    this.version = 0;
    if (this.compositionToDTSShift > INT32_MAX || this.leastDecodeToDisplayDelta > INT32_MAX || this.greatestDecodeToDisplayDelta > INT32_MAX || this.compositionStartTime > INT32_MAX || this.compositionEndTime > INT32_MAX) this.version = 1;
    this.flags = 0;
    if (this.version === 0) {
      this.size = 20;
      this.writeHeader(stream);
      stream.writeInt32(this.compositionToDTSShift);
      stream.writeInt32(this.leastDecodeToDisplayDelta);
      stream.writeInt32(this.greatestDecodeToDisplayDelta);
      stream.writeInt32(this.compositionStartTime);
      stream.writeInt32(this.compositionEndTime);
    } else if (this.version === 1) {
      this.size = 40;
      this.writeHeader(stream);
      stream.writeInt64(this.compositionToDTSShift);
      stream.writeInt64(this.leastDecodeToDisplayDelta);
      stream.writeInt64(this.greatestDecodeToDisplayDelta);
      stream.writeInt64(this.compositionStartTime);
      stream.writeInt64(this.compositionEndTime);
    }
  }
};
var cttsBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CompositionOffsetBox";
  }
  static {
    this.fourcc = "ctts";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const entry_count = stream.readUint32();
    this.sample_counts = [];
    this.sample_offsets = [];
    if (this.version === 0) for (let i = 0; i < entry_count; i++) {
      this.sample_counts.push(stream.readUint32());
      const value = stream.readInt32();
      if (value < 0) Log.warn("BoxParser", "ctts box uses negative values without using version 1");
      this.sample_offsets.push(value);
    }
    else if (this.version === 1) for (let i = 0; i < entry_count; i++) {
      this.sample_counts.push(stream.readUint32());
      this.sample_offsets.push(stream.readInt32());
    }
  }
  /** @bundle writing/ctts.js */
  write(stream) {
    this.version = this.sample_offsets.some((offset) => offset < 0) ? 1 : 0;
    this.flags = 0;
    this.size = 4 + 8 * this.sample_counts.length;
    this.writeHeader(stream);
    stream.writeUint32(this.sample_counts.length);
    for (let i = 0; i < this.sample_counts.length; i++) {
      stream.writeUint32(this.sample_counts[i]);
      if (this.version === 1) stream.writeInt32(this.sample_offsets[i]);
      else stream.writeUint32(this.sample_offsets[i]);
    }
  }
  /** @bundle box-unpack.js */
  unpack(samples) {
    let k = 0;
    for (let i = 0; i < this.sample_counts.length; i++) for (let j = 0; j < this.sample_counts[i]; j++) {
      samples[k].pts = samples[k].dts + this.sample_offsets[i];
      k++;
    }
  }
};
var dac3Box = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "AC3SpecificBox";
  }
  static {
    this.fourcc = "dac3";
  }
  parse(stream) {
    const tmp_byte1 = stream.readUint8();
    const tmp_byte2 = stream.readUint8();
    const tmp_byte3 = stream.readUint8();
    this.fscod = tmp_byte1 >> 6;
    this.bsid = tmp_byte1 >> 1 & 31;
    this.bsmod = (tmp_byte1 & 1) << 2 | tmp_byte2 >> 6 & 3;
    this.acmod = tmp_byte2 >> 3 & 7;
    this.lfeon = tmp_byte2 >> 2 & 1;
    this.bit_rate_code = tmp_byte2 & 3 | tmp_byte3 >> 5 & 7;
  }
};
var dec3Box = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "EC3SpecificBox";
  }
  static {
    this.fourcc = "dec3";
  }
  parse(stream) {
    const tmp_16 = stream.readUint16();
    this.data_rate = tmp_16 >> 3;
    this.num_ind_sub = tmp_16 & 7;
    this.ind_subs = [];
    for (let i = 0; i < this.num_ind_sub + 1; i++) {
      const tmp_byte1 = stream.readUint8();
      const tmp_byte2 = stream.readUint8();
      const tmp_byte3 = stream.readUint8();
      const ind_sub = {
        fscod: tmp_byte1 >> 6,
        bsid: tmp_byte1 >> 1 & 31,
        bsmod: (tmp_byte1 & 1) << 4 | tmp_byte2 >> 4 & 15,
        acmod: tmp_byte2 >> 1 & 7,
        lfeon: tmp_byte2 & 1,
        num_dep_sub: tmp_byte3 >> 1 & 15
      };
      this.ind_subs.push(ind_sub);
      if (ind_sub.num_dep_sub > 0) ind_sub.chan_loc = (tmp_byte3 & 1) << 8 | stream.readUint8();
    }
  }
};
var dfLaBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "FLACSpecificBox";
  }
  static {
    this.fourcc = "dfLa";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const BLOCKTYPE_MASK = 127;
    const LASTMETADATABLOCKFLAG_MASK = 128;
    const boxesFound = [];
    const knownBlockTypes = [
      "STREAMINFO",
      "PADDING",
      "APPLICATION",
      "SEEKTABLE",
      "VORBIS_COMMENT",
      "CUESHEET",
      "PICTURE",
      "RESERVED"
    ];
    let flagAndType;
    do {
      flagAndType = stream.readUint8();
      const type = Math.min(flagAndType & BLOCKTYPE_MASK, knownBlockTypes.length - 1);
      if (!type) {
        stream.readUint8Array(13);
        this.samplerate = stream.readUint32() >> 12;
        stream.readUint8Array(20);
      } else stream.readUint8Array(stream.readUint24());
      boxesFound.push(knownBlockTypes[type]);
    } while (flagAndType & LASTMETADATABLOCKFLAG_MASK);
    this.numMetadataBlocks = boxesFound.length + " (" + boxesFound.join(", ") + ")";
  }
};
var dimmBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintimmediateBytesSent";
  }
  static {
    this.fourcc = "dimm";
  }
  parse(stream) {
    this.bytessent = stream.readUint64();
  }
};
var dmax = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintlongestpacket";
  }
  static {
    this.fourcc = "dmax";
  }
  parse(stream) {
    this.time = stream.readUint32();
  }
};
var dmedBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintmediaBytesSent";
  }
  static {
    this.fourcc = "dmed";
  }
  parse(stream) {
    this.bytessent = stream.readUint64();
  }
};
var dOpsBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "OpusSpecificBox";
  }
  static {
    this.fourcc = "dOps";
  }
  parse(stream) {
    this.Version = stream.readUint8();
    this.OutputChannelCount = stream.readUint8();
    this.PreSkip = stream.readUint16();
    this.InputSampleRate = stream.readUint32();
    this.OutputGain = stream.readInt16();
    this.ChannelMappingFamily = stream.readUint8();
    if (this.ChannelMappingFamily !== 0) {
      this.StreamCount = stream.readUint8();
      this.CoupledCount = stream.readUint8();
      this.ChannelMapping = [];
      for (let i = 0; i < this.OutputChannelCount; i++) this.ChannelMapping[i] = stream.readUint8();
    }
  }
  write(stream) {
    this.size = 11;
    if (this.ChannelMappingFamily !== 0) this.size += 2 + this.OutputChannelCount;
    this.writeHeader(stream);
    stream.writeUint8(this.Version);
    stream.writeUint8(this.OutputChannelCount);
    stream.writeUint16(this.PreSkip);
    stream.writeUint32(this.InputSampleRate);
    stream.writeInt16(this.OutputGain);
    stream.writeUint8(this.ChannelMappingFamily);
    if (this.ChannelMappingFamily !== 0) {
      stream.writeUint8(this.StreamCount);
      stream.writeUint8(this.CoupledCount);
      for (let i = 0; i < this.OutputChannelCount; i++) stream.writeUint8(this.ChannelMapping[i]);
    }
  }
};
var drepBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintrepeatedBytesSent";
  }
  static {
    this.fourcc = "drep";
  }
  parse(stream) {
    this.bytessent = stream.readUint64();
  }
};
var elstBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "EditListBox";
  }
  static {
    this.fourcc = "elst";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.entries = [];
    const entry_count = stream.readUint32();
    for (let i = 0; i < entry_count; i++) {
      const entry = {
        segment_duration: this.version === 1 ? stream.readUint64() : stream.readUint32(),
        media_time: this.version === 1 ? stream.readInt64() : stream.readInt32(),
        media_rate_integer: stream.readInt16(),
        media_rate_fraction: stream.readInt16()
      };
      this.entries.push(entry);
    }
  }
  /** @bundle writing/elst.js */
  write(stream) {
    const useVersion1 = this.entries.some((entry) => entry.segment_duration > MAX_UINT32 || entry.media_time > MAX_UINT32) || this.version === 1;
    this.version = useVersion1 ? 1 : 0;
    this.size = 4 + 12 * this.entries.length;
    this.size += useVersion1 ? 8 * this.entries.length : 0;
    this.writeHeader(stream);
    stream.writeUint32(this.entries.length);
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (useVersion1) {
        stream.writeUint64(entry.segment_duration);
        stream.writeInt64(entry.media_time);
      } else {
        stream.writeUint32(entry.segment_duration);
        stream.writeInt32(entry.media_time);
      }
      stream.writeInt16(entry.media_rate_integer);
      stream.writeInt16(entry.media_rate_fraction);
    }
  }
};
var EntityToGroup = class extends FullBox {
  parse(stream) {
    this.parseFullHeader(stream);
    this.group_id = stream.readUint32();
    this.num_entities_in_group = stream.readUint32();
    this.entity_ids = [];
    for (let i = 0; i < this.num_entities_in_group; i++) {
      const entity_id = stream.readUint32();
      this.entity_ids.push(entity_id);
    }
  }
};
var aebrBox = class extends EntityToGroup {
  constructor(..._args) {
    super(..._args);
    this.box_name = "Auto exposure bracketing";
  }
  static {
    this.fourcc = "aebr";
  }
};
var afbrBox = class extends EntityToGroup {
  constructor(..._args2) {
    super(..._args2);
    this.box_name = "Flash exposure information";
  }
  static {
    this.fourcc = "afbr";
  }
};
var albcBox = class extends EntityToGroup {
  constructor(..._args3) {
    super(..._args3);
    this.box_name = "Album collection";
  }
  static {
    this.fourcc = "albc";
  }
};
var altrBox = class extends EntityToGroup {
  constructor(..._args4) {
    super(..._args4);
    this.box_name = "Alternative entity";
  }
  static {
    this.fourcc = "altr";
  }
};
var brstBox = class extends EntityToGroup {
  constructor(..._args5) {
    super(..._args5);
    this.box_name = "Burst image";
  }
  static {
    this.fourcc = "brst";
  }
};
var dobrBox = class extends EntityToGroup {
  constructor(..._args6) {
    super(..._args6);
    this.box_name = "Depth of field bracketing";
  }
  static {
    this.fourcc = "dobr";
  }
};
var eqivBox = class extends EntityToGroup {
  constructor(..._args7) {
    super(..._args7);
    this.box_name = "Equivalent entity";
  }
  static {
    this.fourcc = "eqiv";
  }
};
var favcBox = class extends EntityToGroup {
  constructor(..._args8) {
    super(..._args8);
    this.box_name = "Favorites collection";
  }
  static {
    this.fourcc = "favc";
  }
};
var fobrBox = class extends EntityToGroup {
  constructor(..._args9) {
    super(..._args9);
    this.box_name = "Focus bracketing";
  }
  static {
    this.fourcc = "fobr";
  }
};
var iaugBox = class extends EntityToGroup {
  constructor(..._args10) {
    super(..._args10);
    this.box_name = "Image item with an audio track";
  }
  static {
    this.fourcc = "iaug";
  }
};
var panoBox = class extends EntityToGroup {
  constructor(..._args11) {
    super(..._args11);
    this.box_name = "Panorama";
  }
  static {
    this.fourcc = "pano";
  }
};
var slidBox = class extends EntityToGroup {
  constructor(..._args12) {
    super(..._args12);
    this.box_name = "Slideshow";
  }
  static {
    this.fourcc = "slid";
  }
};
var sterBox = class extends EntityToGroup {
  constructor(..._args13) {
    super(..._args13);
    this.box_name = "Stereo";
  }
  static {
    this.fourcc = "ster";
  }
};
var tsynBox = class extends EntityToGroup {
  constructor(..._args14) {
    super(..._args14);
    this.box_name = "Time-synchronized capture";
  }
  static {
    this.fourcc = "tsyn";
  }
};
var wbbrBox = class extends EntityToGroup {
  constructor(..._args15) {
    super(..._args15);
    this.box_name = "White balance bracketing";
  }
  static {
    this.fourcc = "wbbr";
  }
};
var prgrBox = class extends EntityToGroup {
  constructor(..._args16) {
    super(..._args16);
    this.box_name = "Progressive rendering";
  }
  static {
    this.fourcc = "prgr";
  }
};
var pymdBox = class extends EntityToGroup {
  constructor(..._args17) {
    super(..._args17);
    this.box_name = "Image pyramid";
  }
  static {
    this.fourcc = "pymd";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.group_id = stream.readUint32();
    this.num_entities_in_group = stream.readUint32();
    this.entity_ids = [];
    for (let i = 0; i < this.num_entities_in_group; i++) {
      const entity_id = stream.readUint32();
      this.entity_ids.push(entity_id);
    }
    this.tile_size_x = stream.readUint16();
    this.tile_size_y = stream.readUint16();
    this.layer_binning = [];
    this.tiles_in_layer_column_minus1 = [];
    this.tiles_in_layer_row_minus1 = [];
    for (let i = 0; i < this.num_entities_in_group; i++) {
      this.layer_binning[i] = stream.readUint16();
      this.tiles_in_layer_row_minus1[i] = stream.readUint16();
      this.tiles_in_layer_column_minus1[i] = stream.readUint16();
    }
  }
};
var fielBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "FieldHandlingBox";
  }
  static {
    this.fourcc = "fiel";
  }
  parse(stream) {
    this.fieldCount = stream.readUint8();
    this.fieldOrdering = stream.readUint8();
  }
};
var frmaBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "OriginalFormatBox";
  }
  static {
    this.fourcc = "frma";
  }
  parse(stream) {
    this.data_format = stream.readString(4);
  }
};
var imirBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ImageMirror";
  }
  static {
    this.fourcc = "imir";
  }
  parse(stream) {
    const tmp = stream.readUint8();
    this.reserved = tmp >> 7;
    this.axis = tmp & 1;
  }
};
var ipmaBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ItemPropertyAssociationBox";
  }
  static {
    this.fourcc = "ipma";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const entry_count = stream.readUint32();
    this.associations = [];
    for (let i = 0; i < entry_count; i++) {
      const id = this.version < 1 ? stream.readUint16() : stream.readUint32();
      const props = [];
      const association_count = stream.readUint8();
      for (let j = 0; j < association_count; j++) {
        const tmp = stream.readUint8();
        props.push({
          essential: (tmp & 128) >> 7 === 1,
          property_index: this.flags & 1 ? (tmp & 127) << 8 | stream.readUint8() : tmp & 127
        });
      }
      this.associations.push({
        id,
        props
      });
    }
  }
};
var irotBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ImageRotation";
  }
  static {
    this.fourcc = "irot";
  }
  parse(stream) {
    this.angle = stream.readUint8() & 3;
  }
};
var ispeBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ImageSpatialExtentsProperty";
  }
  static {
    this.fourcc = "ispe";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.image_width = stream.readUint32();
    this.image_height = stream.readUint32();
  }
};
var itaiBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TAITimestampBox";
  }
  static {
    this.fourcc = "itai";
  }
  parse(stream) {
    this.TAI_timestamp = stream.readUint64();
    const status_bits = stream.readUint8();
    this.sychronization_state = status_bits >> 7 & 1;
    this.timestamp_generation_failure = status_bits >> 6 & 1;
    this.timestamp_is_modified = status_bits >> 5 & 1;
  }
};
var kindBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "KindBox";
  }
  static {
    this.fourcc = "kind";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.schemeURI = stream.readCString();
    if (!this.isEndOfBox(stream)) this.value = stream.readCString();
  }
  /** @bundle writing/kind.js */
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = this.schemeURI.length + 1 + (this.value ? this.value.length + 1 : 0);
    this.writeHeader(stream);
    stream.writeCString(this.schemeURI);
    if (this.value) stream.writeCString(this.value);
  }
};
var levaBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "LevelAssignmentBox";
  }
  static {
    this.fourcc = "leva";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const count = stream.readUint8();
    this.levels = [];
    for (let i = 0; i < count; i++) {
      const level = {};
      this.levels[i] = level;
      level.track_ID = stream.readUint32();
      const tmp_byte = stream.readUint8();
      level.padding_flag = tmp_byte >> 7;
      level.assignment_type = tmp_byte & 127;
      switch (level.assignment_type) {
        case 0:
          level.grouping_type = stream.readString(4);
          break;
        case 1:
          level.grouping_type = stream.readString(4);
          level.grouping_type_parameter = stream.readUint32();
          break;
        case 2:
          break;
        case 3:
          break;
        case 4:
          level.sub_track_id = stream.readUint32();
          break;
        default:
          Log.warn("BoxParser", `Unknown level assignment type: ${level.assignment_type}`);
      }
    }
  }
};
var lhvCBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "LHEVCConfigurationBox";
  }
  static {
    this.fourcc = "lhvC";
  }
  parse(stream) {
    this.configurationVersion = stream.readUint8();
    this.min_spatial_segmentation_idc = stream.readUint16() & 4095;
    this.parallelismType = stream.readUint8() & 3;
    let tmp_byte = stream.readUint8();
    this.numTemporalLayers = (tmp_byte & 13) >> 3;
    this.temporalIdNested = (tmp_byte & 4) >> 2;
    this.lengthSizeMinusOne = tmp_byte & 3;
    this.nalu_arrays = [];
    const numOfArrays = stream.readUint8();
    for (let i = 0; i < numOfArrays; i++) {
      const nalu_array = [];
      this.nalu_arrays.push(nalu_array);
      tmp_byte = stream.readUint8();
      nalu_array.completeness = (tmp_byte & 128) >> 7;
      nalu_array.nalu_type = tmp_byte & 63;
      const numNalus = stream.readUint16();
      for (let j = 0; j < numNalus; j++) {
        const length = stream.readUint16();
        nalu_array.push({ data: stream.readUint8Array(length) });
      }
    }
  }
};
var lselBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "LayerSelectorProperty";
  }
  static {
    this.fourcc = "lsel";
  }
  parse(stream) {
    this.layer_id = stream.readUint16();
  }
};
var maxrBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintmaxrate";
  }
  static {
    this.fourcc = "maxr";
  }
  parse(stream) {
    this.period = stream.readUint32();
    this.bytes = stream.readUint32();
  }
};
var ColorPoint = class {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  toString() {
    return "(" + this.x + "," + this.y + ")";
  }
};
var mdcvBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "MasteringDisplayColourVolumeBox";
  }
  static {
    this.fourcc = "mdcv";
  }
  parse(stream) {
    this.display_primaries = [];
    this.display_primaries[0] = new ColorPoint(stream.readUint16(), stream.readUint16());
    this.display_primaries[1] = new ColorPoint(stream.readUint16(), stream.readUint16());
    this.display_primaries[2] = new ColorPoint(stream.readUint16(), stream.readUint16());
    this.white_point = new ColorPoint(stream.readUint16(), stream.readUint16());
    this.max_display_mastering_luminance = stream.readUint32();
    this.min_display_mastering_luminance = stream.readUint32();
  }
};
var mfroBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "MovieFragmentRandomAccessOffsetBox";
  }
  static {
    this.fourcc = "mfro";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this._size = stream.readUint32();
  }
};
var mskCBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "MaskConfigurationProperty";
  }
  static {
    this.fourcc = "mskC";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.bits_per_pixel = stream.readUint8();
  }
};
var npckBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintPacketsSent";
  }
  static {
    this.fourcc = "npck";
  }
  parse(stream) {
    this.packetssent = stream.readUint32();
  }
};
var numpBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintPacketsSent";
  }
  static {
    this.fourcc = "nump";
  }
  parse(stream) {
    this.packetssent = stream.readUint64();
  }
};
var PaddingBit = class {
  constructor(pad1, pad2) {
    this.pad1 = pad1;
    this.pad2 = pad2;
  }
};
var padbBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "PaddingBitsBox";
  }
  static {
    this.fourcc = "padb";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const sample_count = stream.readUint32();
    this.padbits = [];
    for (let i = 0; i < Math.floor((sample_count + 1) / 2); i++) {
      const bits = stream.readUint8();
      const pad1 = (bits & 112) >> 4;
      const pad2 = bits & 7;
      this.padbits.push(new PaddingBit(pad1, pad2));
    }
  }
};
var paspBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "PixelAspectRatioBox";
  }
  static {
    this.fourcc = "pasp";
  }
  parse(stream) {
    this.hSpacing = stream.readUint32();
    this.vSpacing = stream.readUint32();
  }
};
var paylBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CuePayloadBox";
  }
  static {
    this.fourcc = "payl";
  }
  parse(stream) {
    this.text = stream.readString(this.size - this.hdr_size);
  }
};
var paytBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintpayloadID";
  }
  static {
    this.fourcc = "payt";
  }
  parse(stream) {
    this.payloadID = stream.readUint32();
    const count = stream.readUint8();
    this.rtpmap_string = stream.readString(count);
  }
};
var pdinBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ProgressiveDownloadInfoBox";
    this.rate = [];
    this.initial_delay = [];
  }
  static {
    this.fourcc = "pdin";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const count = (this.size - this.hdr_size) / 8;
    for (let i = 0; i < count; i++) {
      this.rate[i] = stream.readUint32();
      this.initial_delay[i] = stream.readUint32();
    }
  }
};
var pixiBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "PixelInformationProperty";
  }
  static {
    this.fourcc = "pixi";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.num_channels = stream.readUint8();
    this.bits_per_channels = [];
    for (let i = 0; i < this.num_channels; i++) this.bits_per_channels[i] = stream.readUint8();
  }
};
var pmaxBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintlargestpacket";
  }
  static {
    this.fourcc = "pmax";
  }
  parse(stream) {
    this.bytes = stream.readUint32();
  }
};
var prdiBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ProgressiveDerivedImageItemInformationProperty";
  }
  static {
    this.fourcc = "prdi";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.step_count = stream.readUint16();
    this.item_count = [];
    if (this.flags & 2) for (let i = 0; i < this.step_count; i++) this.item_count[i] = stream.readUint16();
  }
};
var prfrBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ProjectionFormatBox";
  }
  static {
    this.fourcc = "prfr";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.projection_type = stream.readUint8() & 31;
  }
};
var prftBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ProducerReferenceTimeBox";
  }
  static {
    this.fourcc = "prft";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.ref_track_id = stream.readUint32();
    this.ntp_timestamp = stream.readUint64();
    if (this.version === 0) this.media_time = stream.readUint32();
    else this.media_time = stream.readUint64();
  }
};
var psshBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ProtectionSystemSpecificHeaderBox";
  }
  static {
    this.fourcc = "pssh";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.system_id = parseHex16(stream);
    this.kid = [];
    if (this.version > 0) {
      const count = stream.readUint32();
      for (let i = 0; i < count; i++) this.kid[i] = parseHex16(stream);
    }
    const datasize = stream.readUint32();
    if (datasize > 0) this.protection_data = stream.readUint8Array(datasize);
  }
};
var clefBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackCleanApertureDimensionsBox";
  }
  static {
    this.fourcc = "clef";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.width = stream.readUint32();
    this.height = stream.readUint32();
  }
};
function parseItifData(type, data) {
  if (type === dataBox.Types.UTF8) return new TextDecoder("utf-8").decode(data);
  const view2 = new DataView(data.buffer);
  if (type === dataBox.Types.BE_UNSIGNED_INT) if (data.length === 1) return view2.getUint8(0);
  else if (data.length === 2) return view2.getUint16(0, false);
  else if (data.length === 4) return view2.getUint32(0, false);
  else if (data.length === 8) return view2.getBigUint64(0, false);
  else throw new Error("Unsupported ITIF_TYPE_BE_UNSIGNED_INT length " + data.length);
  else if (type === dataBox.Types.BE_SIGNED_INT) if (data.length === 1) return view2.getInt8(0);
  else if (data.length === 2) return view2.getInt16(0, false);
  else if (data.length === 4) return view2.getInt32(0, false);
  else if (data.length === 8) return view2.getBigInt64(0, false);
  else throw new Error("Unsupported ITIF_TYPE_BE_SIGNED_INT length " + data.length);
  else if (type === dataBox.Types.BE_FLOAT32) return view2.getFloat32(0, false);
  Log.warn("DataBox", "Unsupported or unimplemented itif data type: " + type);
}
var dataBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "DataBox";
  }
  static {
    this.fourcc = "data";
  }
  static {
    this.Types = {
      RESERVED: 0,
      UTF8: 1,
      UTF16: 2,
      SJIS: 3,
      UTF8_SORT: 4,
      UTF16_SORT: 5,
      JPEG: 13,
      PNG: 14,
      BE_SIGNED_INT: 21,
      BE_UNSIGNED_INT: 22,
      BE_FLOAT32: 23,
      BE_FLOAT64: 24,
      BMP: 27,
      QT_ATOM: 28,
      BE_SIGNED_INT8: 65,
      BE_SIGNED_INT16: 66,
      BE_SIGNED_INT32: 67,
      BE_FLOAT32_POINT: 70,
      BE_FLOAT32_DIMENSIONS: 71,
      BE_FLOAT32_RECT: 72,
      BE_SIGNED_INT64: 74,
      BE_UNSIGNED_INT8: 75,
      BE_UNSIGNED_INT16: 76,
      BE_UNSIGNED_INT32: 77,
      BE_UNSIGNED_INT64: 78,
      BE_FLOAT64_AFFINE_TRANSFORM: 79
    };
  }
  parse(stream) {
    this.valueType = stream.readUint32();
    this.country = stream.readUint16();
    if (this.country > 255) {
      stream.seek(stream.getPosition() - 2);
      this.countryString = stream.readString(2);
    }
    this.language = stream.readUint16();
    if (this.language > 255) {
      stream.seek(stream.getPosition() - 2);
      this.parseLanguage(stream);
    }
    this.raw = stream.readUint8Array(this.size - this.hdr_size - 8);
    this.value = parseItifData(this.valueType, this.raw);
  }
};
var enofBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackEncodedPixelsDimensionsBox";
  }
  static {
    this.fourcc = "enof";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.width = stream.readUint32();
    this.height = stream.readUint32();
  }
};
var ilstBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "IlstBox";
  }
  static {
    this.fourcc = "ilst";
  }
  parse(stream) {
    this.list = {};
    let total = this.size - this.hdr_size;
    while (total > 0) {
      const size = stream.readUint32();
      const index = stream.readUint32();
      const res = parseOneBox(stream, false, size - 8);
      if (res.code === 1) this.list[index] = res.box;
      total -= size;
    }
  }
};
var keysBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "KeysBox";
  }
  static {
    this.fourcc = "keys";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.count = stream.readUint32();
    this.keys = {};
    for (let i = 0; i < this.count; i++) {
      const len = stream.readUint32();
      this.keys[i + 1] = stream.readString(len - 4);
    }
  }
};
var profBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackProductionApertureDimensionsBox";
  }
  static {
    this.fourcc = "prof";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.width = stream.readUint32();
    this.height = stream.readUint32();
  }
};
var taptBox = class extends ContainerBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackApertureModeDimensionsBox";
    this.clefs = [];
    this.profs = [];
    this.enofs = [];
    this.subBoxNames = [
      "clef",
      "prof",
      "enof"
    ];
  }
  static {
    this.fourcc = "tapt";
  }
};
var rtp_Box = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "rtpmoviehintinformation";
  }
  static {
    this.fourcc = "rtp ";
  }
  parse(stream) {
    this.descriptionformat = stream.readString(4);
    this.sdptext = stream.readString(this.size - this.hdr_size - 4);
  }
};
var saioBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SampleAuxiliaryInformationOffsetsBox";
  }
  static {
    this.fourcc = "saio";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.flags & 1) {
      this.aux_info_type = stream.readString(4);
      this.aux_info_type_parameter = stream.readUint32();
    }
    this.entry_count = stream.readUint32();
    this.offset = [];
    for (let i = 0; i < this.entry_count; i++) if (this.version === 0) this.offset[i] = stream.readUint32();
    else this.offset[i] = stream.readUint64();
  }
};
var saizBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SampleAuxiliaryInformationSizesBox";
  }
  static {
    this.fourcc = "saiz";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.flags & 1) {
      this.aux_info_type = stream.readString(4);
      this.aux_info_type_parameter = stream.readUint32();
    }
    this.default_sample_info_size = stream.readUint8();
    this.sample_count = stream.readUint32();
    this.sample_info_size = [];
    if (this.default_sample_info_size === 0) for (let i = 0; i < this.sample_count; i++) this.sample_info_size[i] = stream.readUint8();
  }
};
var Pixel = class {
  constructor(bad_pixel_row, bad_pixel_column) {
    this.bad_pixel_row = bad_pixel_row;
    this.bad_pixel_column = bad_pixel_column;
  }
  toString() {
    return "[row: " + this.bad_pixel_row + ", column: " + this.bad_pixel_column + "]";
  }
};
var sbpmBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SensorBadPixelsMapBox";
  }
  static {
    this.fourcc = "sbpm";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.component_count = stream.readUint16();
    this.component_index = [];
    for (let i = 0; i < this.component_count; i++) this.component_index.push(stream.readUint16());
    const flags = stream.readUint8();
    this.correction_applied = 128 === (flags & 128);
    this.num_bad_rows = stream.readUint32();
    this.num_bad_cols = stream.readUint32();
    this.num_bad_pixels = stream.readUint32();
    this.bad_rows = [];
    this.bad_columns = [];
    this.bad_pixels = [];
    for (let i = 0; i < this.num_bad_rows; i++) this.bad_rows.push(stream.readUint32());
    for (let i = 0; i < this.num_bad_cols; i++) this.bad_columns.push(stream.readUint32());
    for (let i = 0; i < this.num_bad_pixels; i++) {
      const row = stream.readUint32();
      const col = stream.readUint32();
      this.bad_pixels.push(new Pixel(row, col));
    }
  }
};
var schmBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SchemeTypeBox";
  }
  static {
    this.fourcc = "schm";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.scheme_type = stream.readString(4);
    this.scheme_version = stream.readUint32();
    if (this.flags & 1) this.scheme_uri = stream.readString(this.size - this.hdr_size - 8);
  }
};
var sdp_Box = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "rtptracksdphintinformation";
  }
  static {
    this.fourcc = "sdp ";
  }
  parse(stream) {
    this.sdptext = stream.readString(this.size - this.hdr_size);
  }
};
var sencBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SampleEncryptionBox";
  }
  static {
    this.fourcc = "senc";
  }
};
var SmDmBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SMPTE2086MasteringDisplayMetadataBox";
  }
  static {
    this.fourcc = "SmDm";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.primaryRChromaticity_x = stream.readUint16();
    this.primaryRChromaticity_y = stream.readUint16();
    this.primaryGChromaticity_x = stream.readUint16();
    this.primaryGChromaticity_y = stream.readUint16();
    this.primaryBChromaticity_x = stream.readUint16();
    this.primaryBChromaticity_y = stream.readUint16();
    this.whitePointChromaticity_x = stream.readUint16();
    this.whitePointChromaticity_y = stream.readUint16();
    this.luminanceMax = stream.readUint32();
    this.luminanceMin = stream.readUint32();
  }
};
var sratBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SamplingRateBox";
  }
  static {
    this.fourcc = "srat";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.sampling_rate = stream.readUint32();
  }
};
var stdpBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "DegradationPriorityBox";
  }
  static {
    this.fourcc = "stdp";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const count = (this.size - this.hdr_size) / 2;
    this.priority = [];
    for (let i = 0; i < count; i++) this.priority[i] = stream.readUint16();
  }
};
var striBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SubTrackInformationBox";
  }
  static {
    this.fourcc = "stri";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.switch_group = stream.readUint16();
    this.alternate_group = stream.readUint16();
    this.sub_track_id = stream.readUint32();
    const count = (this.size - this.hdr_size - 8) / 4;
    this.attribute_list = [];
    for (let i = 0; i < count; i++) this.attribute_list[i] = stream.readUint32();
  }
};
var stsgBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SubTrackSampleGroupBox";
  }
  static {
    this.fourcc = "stsg";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.grouping_type = stream.readUint32();
    const count = stream.readUint16();
    this.group_description_index = [];
    for (let i = 0; i < count; i++) this.group_description_index[i] = stream.readUint32();
  }
};
var stshBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "ShadowSyncSampleBox";
  }
  static {
    this.fourcc = "stsh";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const entry_count = stream.readUint32();
    this.shadowed_sample_numbers = [];
    this.sync_sample_numbers = [];
    if (this.version === 0) for (let i = 0; i < entry_count; i++) {
      this.shadowed_sample_numbers.push(stream.readUint32());
      this.sync_sample_numbers.push(stream.readUint32());
    }
  }
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = 4 + 8 * this.shadowed_sample_numbers.length;
    this.writeHeader(stream);
    stream.writeUint32(this.shadowed_sample_numbers.length);
    for (let i = 0; i < this.shadowed_sample_numbers.length; i++) {
      stream.writeUint32(this.shadowed_sample_numbers[i]);
      stream.writeUint32(this.sync_sample_numbers[i]);
    }
  }
};
var stssBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SyncSampleBox";
  }
  static {
    this.fourcc = "stss";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const entry_count = stream.readUint32();
    if (this.version === 0) {
      this.sample_numbers = [];
      for (let i = 0; i < entry_count; i++) this.sample_numbers.push(stream.readUint32());
    }
  }
  /** @bundle writing/stss.js */
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = 4 + 4 * this.sample_numbers.length;
    this.writeHeader(stream);
    stream.writeUint32(this.sample_numbers.length);
    stream.writeUint32Array(this.sample_numbers);
  }
};
var stviBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "StereoVideoBox";
  }
  static {
    this.fourcc = "stvi";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const tmp32 = stream.readUint32();
    this.single_view_allowed = tmp32 & 3;
    this.stereo_scheme = stream.readUint32();
    const length = stream.readUint32();
    this.stereo_indication_type = stream.readString(length);
    this.boxes = [];
    while (stream.getPosition() < this.start + this.size) {
      const ret = parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
      if (ret.code === 1) {
        const box2 = ret.box;
        this.boxes.push(box2);
        this[box2.type] = box2;
      } else return;
    }
  }
};
var stz2Box = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "CompactSampleSizeBox";
  }
  static {
    this.fourcc = "stz2";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.sample_sizes = [];
    if (this.version === 0) {
      this.reserved = stream.readUint24();
      this.field_size = stream.readUint8();
      const sample_count = stream.readUint32();
      if (this.field_size === 4) for (let i = 0; i < sample_count; i += 2) {
        const tmp = stream.readUint8();
        this.sample_sizes[i] = tmp >> 4 & 15;
        this.sample_sizes[i + 1] = tmp & 15;
      }
      else if (this.field_size === 8) for (let i = 0; i < sample_count; i++) this.sample_sizes[i] = stream.readUint8();
      else if (this.field_size === 16) for (let i = 0; i < sample_count; i++) this.sample_sizes[i] = stream.readUint16();
      else Log.error("BoxParser", "Error in length field in stz2 box", stream.isofile);
    }
  }
};
var subsBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "SubSampleInformationBox";
  }
  static {
    this.fourcc = "subs";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const entry_count = stream.readUint32();
    this.entries = [];
    let subsample_count;
    for (let i = 0; i < entry_count; i++) {
      const sampleInfo = {};
      this.entries[i] = sampleInfo;
      sampleInfo.sample_delta = stream.readUint32();
      sampleInfo.subsamples = [];
      subsample_count = stream.readUint16();
      if (subsample_count > 0) for (let j = 0; j < subsample_count; j++) {
        const subsample = {};
        sampleInfo.subsamples.push(subsample);
        if (this.version === 1) subsample.size = stream.readUint32();
        else subsample.size = stream.readUint16();
        subsample.priority = stream.readUint8();
        subsample.discardable = stream.readUint8();
        subsample.codec_specific_parameters = stream.readUint32();
      }
    }
  }
};
var taicBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TAIClockInfoBox";
  }
  static {
    this.fourcc = "taic";
  }
  parse(stream) {
    this.time_uncertainty = stream.readUint64();
    this.clock_resolution = stream.readUint32();
    this.clock_drift_rate = stream.readInt32();
    const reserved_byte = stream.readUint8();
    this.clock_type = (reserved_byte & 192) >> 6;
  }
};
var tencBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackEncryptionBox";
  }
  static {
    this.fourcc = "tenc";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    stream.readUint8();
    if (this.version === 0) stream.readUint8();
    else {
      const tmp = stream.readUint8();
      this.default_crypt_byte_block = tmp >> 4 & 15;
      this.default_skip_byte_block = tmp & 15;
    }
    this.default_isProtected = stream.readUint8();
    this.default_Per_Sample_IV_Size = stream.readUint8();
    this.default_KID = parseHex16(stream);
    if (this.default_isProtected === 1 && this.default_Per_Sample_IV_Size === 0) {
      this.default_constant_IV_size = stream.readUint8();
      this.default_constant_IV = stream.readUint8Array(this.default_constant_IV_size);
    }
  }
};
var TfraEntry = class {
};
var tfraBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackFragmentRandomAccessBox";
  }
  static {
    this.fourcc = "tfra";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.track_ID = stream.readUint32();
    stream.readUint24();
    const tmp_byte = stream.readUint8();
    this.length_size_of_traf_num = tmp_byte >> 4 & 3;
    this.length_size_of_trun_num = tmp_byte >> 2 & 3;
    this.length_size_of_sample_num = tmp_byte & 3;
    this.entries = [];
    const number_of_entries = stream.readUint32();
    for (let i = 0; i < number_of_entries; i++) {
      const entry = new TfraEntry();
      if (this.version === 1) {
        entry.time = stream.readUint64();
        entry.moof_offset = stream.readUint64();
      } else {
        entry.time = stream.readUint32();
        entry.moof_offset = stream.readUint32();
      }
      entry.traf_number = stream["readUint" + 8 * (this.length_size_of_traf_num + 1)]();
      entry.trun_number = stream["readUint" + 8 * (this.length_size_of_trun_num + 1)]();
      entry.sample_delta = stream["readUint" + 8 * (this.length_size_of_sample_num + 1)]();
      this.entries.push(entry);
    }
  }
};
var tmaxBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintmaxrelativetime";
  }
  static {
    this.fourcc = "tmax";
  }
  parse(stream) {
    this.time = stream.readUint32();
  }
};
var tminBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintminrelativetime";
  }
  static {
    this.fourcc = "tmin";
  }
  parse(stream) {
    this.time = stream.readUint32();
  }
};
var totlBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintBytesSent";
  }
  static {
    this.fourcc = "totl";
  }
  parse(stream) {
    this.bytessent = stream.readUint32();
  }
};
var tpayBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintBytesSent";
  }
  static {
    this.fourcc = "tpay";
  }
  parse(stream) {
    this.bytessent = stream.readUint32();
  }
};
var tpylBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintBytesSent";
  }
  static {
    this.fourcc = "tpyl";
  }
  parse(stream) {
    this.bytessent = stream.readUint64();
  }
};
var msrcTrackGroupTypeBox = class extends TrackGroupTypeBox {
  static {
    this.fourcc = "msrc";
  }
};
var trefBox = class trefBox2 extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackReferenceBox";
    this.references = [];
  }
  static {
    this.fourcc = "tref";
  }
  static {
    this.allowed_types = [
      "hint",
      "cdsc",
      "font",
      "hind",
      "vdep",
      "vplx",
      "subt",
      "thmb",
      "auxl",
      "cdtg",
      "shsc",
      "aest"
    ];
  }
  parse(stream) {
    while (stream.getPosition() < this.start + this.size) {
      const ret = parseOneBox(stream, true, this.size - (stream.getPosition() - this.start));
      if (ret.code === 1) {
        if (!trefBox2.allowed_types.includes(ret.type)) Log.warn("BoxParser", `Unknown track reference type: '${ret.type}'`);
        const box2 = new TrackReferenceTypeBox(ret.type, ret.size, ret.hdr_size, ret.start);
        if (box2.write === Box.prototype.write && box2.type !== "mdat") {
          Log.info("BoxParser", "TrackReference " + box2.type + " box writing not yet implemented, keeping unparsed data in memory for later write");
          box2.parseDataAndRewind(stream);
        }
        box2.parse(stream);
        this.references.push(box2);
      } else return;
    }
  }
};
var trepBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackExtensionPropertiesBox";
  }
  static {
    this.fourcc = "trep";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.track_ID = stream.readUint32();
    this.boxes = [];
    while (stream.getPosition() < this.start + this.size) {
      const ret = parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
      if (ret.code === 1) {
        const box2 = ret.box;
        this.boxes.push(box2);
      } else return;
    }
  }
};
var trpyBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "hintBytesSent";
  }
  static {
    this.fourcc = "trpy";
  }
  parse(stream) {
    this.bytessent = stream.readUint64();
  }
};
var tselBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TrackSelectionBox";
  }
  static {
    this.fourcc = "tsel";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.switch_group = stream.readUint32();
    const count = (this.size - this.hdr_size - 4) / 4;
    this.attribute_list = [];
    for (let i = 0; i < count; i++) this.attribute_list[i] = stream.readUint32();
  }
};
var txtcBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TextConfigBox";
  }
  static {
    this.fourcc = "txtc";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.config = stream.readCString();
  }
};
var tycoBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "TypeCombinationBox";
  }
  static {
    this.fourcc = "tyco";
  }
  parse(stream) {
    const count = (this.size - this.hdr_size) / 4;
    this.compatible_brands = [];
    for (let i = 0; i < count; i++) this.compatible_brands[i] = stream.readString(4);
  }
};
var udesBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "UserDescriptionProperty";
  }
  static {
    this.fourcc = "udes";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.lang = stream.readCString();
    this.name = stream.readCString();
    this.description = stream.readCString();
    this.tags = stream.readCString();
  }
};
var uncCBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "UncompressedFrameConfigBox";
  }
  static {
    this.fourcc = "uncC";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.profile = stream.readString(4);
    if (this.version === 1) {
    } else if (this.version === 0) {
      this.component_count = stream.readUint32();
      this.component_index = [];
      this.component_bit_depth_minus_one = [];
      this.component_format = [];
      this.component_align_size = [];
      for (let i = 0; i < this.component_count; i++) {
        this.component_index.push(stream.readUint16());
        this.component_bit_depth_minus_one.push(stream.readUint8());
        this.component_format.push(stream.readUint8());
        this.component_align_size.push(stream.readUint8());
      }
      this.sampling_type = stream.readUint8();
      this.interleave_type = stream.readUint8();
      this.block_size = stream.readUint8();
      const flags = stream.readUint8();
      this.component_little_endian = flags >> 7 & 1;
      this.block_pad_lsb = flags >> 6 & 1;
      this.block_little_endian = flags >> 5 & 1;
      this.block_reversed = flags >> 4 & 1;
      this.pad_unknown = flags >> 3 & 1;
      this.pixel_size = stream.readUint32();
      this.row_align_size = stream.readUint32();
      this.tile_align_size = stream.readUint32();
      this.num_tile_cols_minus_one = stream.readUint32();
      this.num_tile_rows_minus_one = stream.readUint32();
    }
  }
};
var urnBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "DataEntryUrnBox";
  }
  static {
    this.fourcc = "urn ";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.name = stream.readCString();
    if (this.size - this.hdr_size - this.name.length - 1 > 0) this.location = stream.readCString();
  }
  /** @bundle writing/urn.js */
  write(stream) {
    this.version = 0;
    this.flags = 0;
    this.size = this.name.length + 1 + (this.location ? this.location.length + 1 : 0);
    this.writeHeader(stream);
    stream.writeCString(this.name);
    if (this.location) stream.writeCString(this.location);
  }
};
var vttCBox = class extends Box {
  constructor(..._args) {
    super(..._args);
    this.box_name = "WebVTTConfigurationBox";
  }
  static {
    this.fourcc = "vttC";
  }
  parse(stream) {
    this.text = stream.readString(this.size - this.hdr_size);
  }
};
var vvnCBox = class extends FullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "VvcNALUConfigBox";
  }
  static {
    this.fourcc = "vvnC";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    const tmp = stream.readUint8();
    this.lengthSizeMinusOne = tmp & 3;
  }
};
var alstSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "alst";
  }
  parse(stream) {
    const roll_count = stream.readUint16();
    this.first_output_sample = stream.readUint16();
    this.sample_offset = [];
    for (let i = 0; i < roll_count; i++) this.sample_offset[i] = stream.readUint32();
    const remaining = this.description_length - 4 - 4 * roll_count;
    this.num_output_samples = [];
    this.num_total_samples = [];
    for (let i = 0; i < remaining / 4; i++) {
      this.num_output_samples[i] = stream.readUint16();
      this.num_total_samples[i] = stream.readUint16();
    }
  }
};
var avllSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "avll";
  }
  parse(stream) {
    this.layerNumber = stream.readUint8();
    this.accurateStatisticsFlag = stream.readUint8();
    this.avgBitRate = stream.readUint16();
    this.avgFrameRate = stream.readUint16();
  }
};
var avssSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "avss";
  }
  parse(stream) {
    this.subSequenceIdentifier = stream.readUint16();
    this.layerNumber = stream.readUint8();
    const tmp_byte = stream.readUint8();
    this.durationFlag = tmp_byte >> 7;
    this.avgRateFlag = tmp_byte >> 6 & 1;
    if (this.durationFlag) this.duration = stream.readUint32();
    if (this.avgRateFlag) {
      this.accurateStatisticsFlag = stream.readUint8();
      this.avgBitRate = stream.readUint16();
      this.avgFrameRate = stream.readUint16();
    }
    this.dependency = [];
    const numReferences = stream.readUint8();
    for (let i = 0; i < numReferences; i++) this.dependency.push({
      subSeqDirectionFlag: stream.readUint8(),
      layerNumber: stream.readUint8(),
      subSequenceIdentifier: stream.readUint16()
    });
  }
};
var dtrtSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "dtrt";
  }
  parse(_stream) {
    Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
  }
};
var mvifSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "mvif";
  }
  parse(_stream) {
    Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
  }
};
var prolSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "prol";
  }
  parse(stream) {
    this.roll_distance = stream.readInt16();
  }
};
var rapSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "rap ";
  }
  parse(stream) {
    const tmp_byte = stream.readUint8();
    this.num_leading_samples_known = tmp_byte >> 7;
    this.num_leading_samples = tmp_byte & 127;
  }
};
var rashSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "rash";
  }
  parse(stream) {
    this.operation_point_count = stream.readUint16();
    if (this.description_length !== 2 + (this.operation_point_count === 1 ? 2 : this.operation_point_count * 6) + 9) {
      Log.warn("BoxParser", "Mismatch in " + this.grouping_type + " sample group length");
      this.data = stream.readUint8Array(this.description_length - 2);
    } else {
      if (this.operation_point_count === 1) this.target_rate_share = stream.readUint16();
      else {
        this.target_rate_share = [];
        this.available_bitrate = [];
        for (let i = 0; i < this.operation_point_count; i++) {
          this.available_bitrate[i] = stream.readUint32();
          this.target_rate_share[i] = stream.readUint16();
        }
      }
      this.maximum_bitrate = stream.readUint32();
      this.minimum_bitrate = stream.readUint32();
      this.discard_priority = stream.readUint8();
    }
  }
};
var rollSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "roll";
  }
  parse(stream) {
    this.roll_distance = stream.readInt16();
  }
};
var scifSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "scif";
  }
  parse(_stream) {
    Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
  }
};
var scnmSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "scnm";
  }
  parse(_stream) {
    Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
  }
};
var seigSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "seig";
  }
  parse(stream) {
    this.reserved = stream.readUint8();
    const tmp = stream.readUint8();
    this.crypt_byte_block = tmp >> 4;
    this.skip_byte_block = tmp & 15;
    this.isProtected = stream.readUint8();
    this.Per_Sample_IV_Size = stream.readUint8();
    this.KID = parseHex16(stream);
    this.constant_IV_size = 0;
    this.constant_IV = 0;
    if (this.isProtected === 1 && this.Per_Sample_IV_Size === 0) {
      this.constant_IV_size = stream.readUint8();
      this.constant_IV = stream.readUint8Array(this.constant_IV_size);
    }
  }
};
var stsaSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "stsa";
  }
  parse(_stream) {
    Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
  }
};
var syncSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "sync";
  }
  parse(stream) {
    const tmp_byte = stream.readUint8();
    this.NAL_unit_type = tmp_byte & 63;
  }
};
var teleSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "tele";
  }
  parse(stream) {
    const tmp_byte = stream.readUint8();
    this.level_independently_decodable = tmp_byte >> 7;
  }
};
var tsasSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "tsas";
  }
  parse(_stream) {
    Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
  }
};
var tsclSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "tscl";
  }
  parse(_stream) {
    Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
  }
};
var viprSampleGroupEntry = class extends SampleGroupEntry {
  static {
    this.grouping_type = "vipr";
  }
  parse(_stream) {
    Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
  }
};
var UUIDBox = class extends Box {
  static {
    this.fourcc = "uuid";
  }
};
var UUIDFullBox = class extends FullBox {
  static {
    this.fourcc = "uuid";
  }
};
var piffLsmBox = class extends UUIDFullBox {
  constructor(..._args) {
    super(..._args);
    this.box_name = "LiveServerManifestBox";
  }
  static {
    this.uuid = "a5d40b30e81411ddba2f0800200c9a66";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.LiveServerManifest = stream.readString(this.size - this.hdr_size).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
};
var piffPsshBox = class extends UUIDFullBox {
  constructor(..._args2) {
    super(..._args2);
    this.box_name = "PiffProtectionSystemSpecificHeaderBox";
  }
  static {
    this.uuid = "d08a4f1810f34a82b6c832d8aba183d3";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.system_id = parseHex16(stream);
    const datasize = stream.readUint32();
    if (datasize > 0) this.data = stream.readUint8Array(datasize);
  }
};
var piffSencBox = class extends UUIDFullBox {
  constructor(..._args3) {
    super(..._args3);
    this.box_name = "PiffSampleEncryptionBox";
  }
  static {
    this.uuid = "a2394f525a9b4f14a2446c427c648df4";
  }
};
var piffTencBox = class extends UUIDFullBox {
  constructor(..._args4) {
    super(..._args4);
    this.box_name = "PiffTrackEncryptionBox";
  }
  static {
    this.uuid = "8974dbce7be74c5184f97148f9882554";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.default_AlgorithmID = stream.readUint24();
    this.default_IV_size = stream.readUint8();
    this.default_KID = parseHex16(stream);
  }
};
var piffTfrfBox = class extends UUIDFullBox {
  constructor(..._args5) {
    super(..._args5);
    this.box_name = "TfrfBox";
  }
  static {
    this.uuid = "d4807ef2ca3946958e5426cb9e46a79f";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    this.fragment_count = stream.readUint8();
    this.entries = [];
    for (let i = 0; i < this.fragment_count; i++) {
      let absolute_time = 0;
      let absolute_duration = 0;
      if (this.version === 1) {
        absolute_time = stream.readUint64();
        absolute_duration = stream.readUint64();
      } else {
        absolute_time = stream.readUint32();
        absolute_duration = stream.readUint32();
      }
      this.entries.push({
        absolute_time,
        absolute_duration
      });
    }
  }
};
var piffTfxdBox = class extends UUIDFullBox {
  constructor(..._args6) {
    super(..._args6);
    this.box_name = "TfxdBox";
  }
  static {
    this.uuid = "6d1d9b0542d544e680e2141daff757b2";
  }
  parse(stream) {
    this.parseFullHeader(stream);
    if (this.version === 1) {
      this.absolute_time = stream.readUint64();
      this.duration = stream.readUint64();
    } else {
      this.absolute_time = stream.readUint32();
      this.duration = stream.readUint32();
    }
  }
};
var ItemContentIDPropertyBox = class extends UUIDBox {
  constructor(..._args7) {
    super(..._args7);
    this.box_name = "ItemContentIDProperty";
  }
  static {
    this.uuid = "261ef3741d975bbaacbd9d2c8ea73522";
  }
  parse(stream) {
    this.content_id = stream.readCString();
  }
};
var ItemComponentContentIDPropertyBox = class extends UUIDBox {
  constructor(..._args8) {
    super(..._args8);
    this.box_name = "ItemComponentContentIDProperty";
  }
  static {
    this.uuid = "9db9dd6e373c5a4e811021fc83a911fd";
  }
  parse(stream) {
    this.number_of_components = stream.readUint32();
    this.content_ids = [];
    for (let i = 0; i < this.number_of_components; i++) {
      const content_id = stream.readCString();
      this.content_ids.push(content_id);
    }
  }
};
var all_boxes_exports = /* @__PURE__ */ __exportAll({
  CoLLBox: () => CoLLBox,
  ItemComponentContentIDPropertyBox: () => ItemComponentContentIDPropertyBox,
  ItemContentIDPropertyBox: () => ItemContentIDPropertyBox,
  OpusSampleEntry: () => OpusSampleEntry,
  SmDmBox: () => SmDmBox,
  a1lxBox: () => a1lxBox,
  a1opBox: () => a1opBox,
  ac_3SampleEntry: () => ac_3SampleEntry,
  ac_4SampleEntry: () => ac_4SampleEntry,
  aebrBox: () => aebrBox,
  afbrBox: () => afbrBox,
  albcBox: () => albcBox,
  alstSampleGroupEntry: () => alstSampleGroupEntry,
  altrBox: () => altrBox,
  auxCBox: () => auxCBox,
  av01SampleEntry: () => av01SampleEntry,
  av1CBox: () => av1CBox,
  avc1SampleEntry: () => avc1SampleEntry,
  avc2SampleEntry: () => avc2SampleEntry,
  avc3SampleEntry: () => avc3SampleEntry,
  avc4SampleEntry: () => avc4SampleEntry,
  avcCBox: () => avcCBox,
  avllSampleGroupEntry: () => avllSampleGroupEntry,
  avs3SampleEntry: () => avs3SampleEntry,
  avssSampleGroupEntry: () => avssSampleGroupEntry,
  brstBox: () => brstBox,
  btrtBox: () => btrtBox,
  bxmlBox: () => bxmlBox,
  ccstBox: () => ccstBox,
  cdefBox: () => cdefBox,
  clapBox: () => clapBox,
  clefBox: () => clefBox,
  clliBox: () => clliBox,
  cmexBox: () => cmexBox,
  cminBox: () => cminBox,
  cmpCBox: () => cmpCBox,
  cmpdBox: () => cmpdBox,
  co64Box: () => co64Box,
  colrBox: () => colrBox,
  coviBox: () => coviBox,
  cprtBox: () => cprtBox,
  cschBox: () => cschBox,
  cslgBox: () => cslgBox,
  cttsBox: () => cttsBox,
  dOpsBox: () => dOpsBox,
  dac3Box: () => dac3Box,
  dataBox: () => dataBox,
  dav1SampleEntry: () => dav1SampleEntry,
  dec3Box: () => dec3Box,
  dfLaBox: () => dfLaBox,
  dimmBox: () => dimmBox,
  dinfBox: () => dinfBox,
  dmax: () => dmax,
  dmedBox: () => dmedBox,
  dobrBox: () => dobrBox,
  drefBox: () => drefBox,
  drepBox: () => drepBox,
  dtrtSampleGroupEntry: () => dtrtSampleGroupEntry,
  dvh1SampleEntry: () => dvh1SampleEntry,
  dvheSampleEntry: () => dvheSampleEntry,
  ec_3SampleEntry: () => ec_3SampleEntry,
  edtsBox: () => edtsBox,
  elngBox: () => elngBox,
  elstBox: () => elstBox,
  emsgBox: () => emsgBox,
  encaSampleEntry: () => encaSampleEntry,
  encmSampleEntry: () => encmSampleEntry,
  encsSampleEntry: () => encsSampleEntry,
  enctSampleEntry: () => enctSampleEntry,
  encuSampleEntry: () => encuSampleEntry,
  encvSampleEntry: () => encvSampleEntry,
  enofBox: () => enofBox,
  eqivBox: () => eqivBox,
  esdsBox: () => esdsBox,
  etypBox: () => etypBox,
  fLaCSampleEntry: () => fLaCSampleEntry,
  favcBox: () => favcBox,
  fielBox: () => fielBox,
  fobrBox: () => fobrBox,
  freeBox: () => freeBox,
  frmaBox: () => frmaBox,
  ftypBox: () => ftypBox,
  grplBox: () => grplBox,
  hdlrBox: () => hdlrBox,
  hev1SampleEntry: () => hev1SampleEntry,
  hev2SampleEntry: () => hev2SampleEntry,
  hinfBox: () => hinfBox,
  hmhdBox: () => hmhdBox,
  hntiBox: () => hntiBox,
  hvc1SampleEntry: () => hvc1SampleEntry,
  hvc2SampleEntry: () => hvc2SampleEntry,
  hvcCBox: () => hvcCBox,
  hvt1SampleEntry: () => hvt1SampleEntry,
  iaugBox: () => iaugBox,
  idatBox: () => idatBox,
  iinfBox: () => iinfBox,
  ilocBox: () => ilocBox,
  ilstBox: () => ilstBox,
  imirBox: () => imirBox,
  infeBox: () => infeBox,
  iodsBox: () => iodsBox,
  ipcoBox: () => ipcoBox,
  ipmaBox: () => ipmaBox,
  iproBox: () => iproBox,
  iprpBox: () => iprpBox,
  irefBox: () => irefBox,
  irotBox: () => irotBox,
  ispeBox: () => ispeBox,
  itaiBox: () => itaiBox,
  j2kHBox: () => j2kHBox,
  j2kiSampleEntry: () => j2kiSampleEntry,
  keysBox: () => keysBox,
  kindBox: () => kindBox,
  levaBox: () => levaBox,
  lhe1SampleEntry: () => lhe1SampleEntry,
  lhv1SampleEntry: () => lhv1SampleEntry,
  lhvCBox: () => lhvCBox,
  lselBox: () => lselBox,
  lvc1SampleEntry: () => lvc1SampleEntry,
  lvcCBox: () => lvcCBox,
  m4aeSampleEntry: () => m4aeSampleEntry,
  maxrBox: () => maxrBox,
  mdatBox: () => mdatBox,
  mdcvBox: () => mdcvBox,
  mdhdBox: () => mdhdBox,
  mdiaBox: () => mdiaBox,
  mecoBox: () => mecoBox,
  mehdBox: () => mehdBox,
  metaBox: () => metaBox,
  mettSampleEntry: () => mettSampleEntry,
  metxSampleEntry: () => metxSampleEntry,
  mfhdBox: () => mfhdBox,
  mfraBox: () => mfraBox,
  mfroBox: () => mfroBox,
  mha1SampleEntry: () => mha1SampleEntry,
  mha2SampleEntry: () => mha2SampleEntry,
  mhm1SampleEntry: () => mhm1SampleEntry,
  mhm2SampleEntry: () => mhm2SampleEntry,
  minfBox: () => minfBox,
  mjp2SampleEntry: () => mjp2SampleEntry,
  mjpgSampleEntry: () => mjpgSampleEntry,
  moofBox: () => moofBox,
  moovBox: () => moovBox,
  mp4aSampleEntry: () => mp4aSampleEntry,
  mp4sSampleEntry: () => mp4sSampleEntry,
  mp4vSampleEntry: () => mp4vSampleEntry,
  mskCBox: () => mskCBox,
  msrcTrackGroupTypeBox: () => msrcTrackGroupTypeBox,
  mvexBox: () => mvexBox,
  mvhdBox: () => mvhdBox,
  mvifSampleGroupEntry: () => mvifSampleGroupEntry,
  nmhdBox: () => nmhdBox,
  npckBox: () => npckBox,
  numpBox: () => numpBox,
  padbBox: () => padbBox,
  panoBox: () => panoBox,
  paspBox: () => paspBox,
  paylBox: () => paylBox,
  paytBox: () => paytBox,
  pdinBox: () => pdinBox,
  piffLsmBox: () => piffLsmBox,
  piffPsshBox: () => piffPsshBox,
  piffSencBox: () => piffSencBox,
  piffTencBox: () => piffTencBox,
  piffTfrfBox: () => piffTfrfBox,
  piffTfxdBox: () => piffTfxdBox,
  pitmBox: () => pitmBox,
  pixiBox: () => pixiBox,
  pmaxBox: () => pmaxBox,
  povdBox: () => povdBox,
  prdiBox: () => prdiBox,
  prfrBox: () => prfrBox,
  prftBox: () => prftBox,
  prgrBox: () => prgrBox,
  profBox: () => profBox,
  prolSampleGroupEntry: () => prolSampleGroupEntry,
  psshBox: () => psshBox,
  pymdBox: () => pymdBox,
  rapSampleGroupEntry: () => rapSampleGroupEntry,
  rashSampleGroupEntry: () => rashSampleGroupEntry,
  resvSampleEntry: () => resvSampleEntry,
  rinfBox: () => rinfBox,
  rollSampleGroupEntry: () => rollSampleGroupEntry,
  rtp_Box: () => rtp_Box,
  saioBox: () => saioBox,
  saizBox: () => saizBox,
  sbgpBox: () => sbgpBox,
  sbpmBox: () => sbpmBox,
  sbttSampleEntry: () => sbttSampleEntry,
  schiBox: () => schiBox,
  schmBox: () => schmBox,
  scifSampleGroupEntry: () => scifSampleGroupEntry,
  scnmSampleGroupEntry: () => scnmSampleGroupEntry,
  sdp_Box: () => sdp_Box,
  sdtpBox: () => sdtpBox,
  seigSampleGroupEntry: () => seigSampleGroupEntry,
  sencBox: () => sencBox,
  sgpdBox: () => sgpdBox,
  sidxBox: () => sidxBox,
  sinfBox: () => sinfBox,
  skipBox: () => skipBox,
  slidBox: () => slidBox,
  smhdBox: () => smhdBox,
  sratBox: () => sratBox,
  ssixBox: () => ssixBox,
  stblBox: () => stblBox,
  stcoBox: () => stcoBox,
  stdpBox: () => stdpBox,
  sterBox: () => sterBox,
  sthdBox: () => sthdBox,
  stppSampleEntry: () => stppSampleEntry,
  strdBox: () => strdBox,
  striBox: () => striBox,
  strkBox: () => strkBox,
  stsaSampleGroupEntry: () => stsaSampleGroupEntry,
  stscBox: () => stscBox,
  stsdBox: () => stsdBox,
  stsgBox: () => stsgBox,
  stshBox: () => stshBox,
  stssBox: () => stssBox,
  stszBox: () => stszBox,
  sttsBox: () => sttsBox,
  stviBox: () => stviBox,
  stxtSampleEntry: () => stxtSampleEntry,
  stypBox: () => stypBox,
  stz2Box: () => stz2Box,
  subsBox: () => subsBox,
  syncSampleGroupEntry: () => syncSampleGroupEntry,
  taicBox: () => taicBox,
  taptBox: () => taptBox,
  teleSampleGroupEntry: () => teleSampleGroupEntry,
  tencBox: () => tencBox,
  tfdtBox: () => tfdtBox,
  tfhdBox: () => tfhdBox,
  tfraBox: () => tfraBox,
  tkhdBox: () => tkhdBox,
  tmaxBox: () => tmaxBox,
  tminBox: () => tminBox,
  totlBox: () => totlBox,
  tpayBox: () => tpayBox,
  tpylBox: () => tpylBox,
  trafBox: () => trafBox,
  trakBox: () => trakBox,
  trefBox: () => trefBox,
  trepBox: () => trepBox,
  trexBox: () => trexBox,
  trgrBox: () => trgrBox,
  trpyBox: () => trpyBox,
  trunBox: () => trunBox,
  tsasSampleGroupEntry: () => tsasSampleGroupEntry,
  tsclSampleGroupEntry: () => tsclSampleGroupEntry,
  tselBox: () => tselBox,
  tsynBox: () => tsynBox,
  tx3gSampleEntry: () => tx3gSampleEntry,
  txtcBox: () => txtcBox,
  tycoBox: () => tycoBox,
  udesBox: () => udesBox,
  udtaBox: () => udtaBox,
  uncCBox: () => uncCBox,
  uncvSampleEntry: () => uncvSampleEntry,
  urlBox: () => urlBox,
  urnBox: () => urnBox,
  viprSampleGroupEntry: () => viprSampleGroupEntry,
  vmhdBox: () => vmhdBox,
  vp08SampleEntry: () => vp08SampleEntry,
  vp09SampleEntry: () => vp09SampleEntry,
  vpcCBox: () => vpcCBox,
  vttCBox: () => vttCBox,
  vttcBox: () => vttcBox,
  vvc1SampleEntry: () => vvc1SampleEntry,
  vvcCBox: () => vvcCBox,
  vvcNSampleEntry: () => vvcNSampleEntry,
  vvi1SampleEntry: () => vvi1SampleEntry,
  vvnCBox: () => vvnCBox,
  vvs1SampleEntry: () => vvs1SampleEntry,
  waveBox: () => waveBox,
  wbbrBox: () => wbbrBox,
  wvttSampleEntry: () => wvttSampleEntry,
  xmlBox: () => xmlBox
});
var BoxParser = registerBoxes(all_boxes_exports);
registerDescriptors(descriptor_exports);

// ../frontend/node_modules/mp4-muxer/build/mp4-muxer.mjs
var __accessCheck = (obj, member, msg) => {
  if (!member.has(obj))
    throw TypeError("Cannot " + msg);
};
var __privateGet = (obj, member, getter) => {
  __accessCheck(obj, member, "read from private field");
  return getter ? getter.call(obj) : member.get(obj);
};
var __privateAdd = (obj, member, value) => {
  if (member.has(obj))
    throw TypeError("Cannot add the same private member more than once");
  member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
};
var __privateSet = (obj, member, value, setter) => {
  __accessCheck(obj, member, "write to private field");
  setter ? setter.call(obj, value) : member.set(obj, value);
  return value;
};
var __privateWrapper = (obj, member, setter, getter) => ({
  set _(value) {
    __privateSet(obj, member, value, setter);
  },
  get _() {
    return __privateGet(obj, member, getter);
  }
});
var __privateMethod = (obj, member, method) => {
  __accessCheck(obj, member, "access private method");
  return method;
};
var bytes = new Uint8Array(8);
var view = new DataView(bytes.buffer);
var u8 = (value) => {
  return [(value % 256 + 256) % 256];
};
var u16 = (value) => {
  view.setUint16(0, value, false);
  return [bytes[0], bytes[1]];
};
var i16 = (value) => {
  view.setInt16(0, value, false);
  return [bytes[0], bytes[1]];
};
var u24 = (value) => {
  view.setUint32(0, value, false);
  return [bytes[1], bytes[2], bytes[3]];
};
var u32 = (value) => {
  view.setUint32(0, value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
};
var i32 = (value) => {
  view.setInt32(0, value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
};
var u64 = (value) => {
  view.setUint32(0, Math.floor(value / 2 ** 32), false);
  view.setUint32(4, value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7]];
};
var fixed_8_8 = (value) => {
  view.setInt16(0, 2 ** 8 * value, false);
  return [bytes[0], bytes[1]];
};
var fixed_16_16 = (value) => {
  view.setInt32(0, 2 ** 16 * value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
};
var fixed_2_30 = (value) => {
  view.setInt32(0, 2 ** 30 * value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
};
var ascii = (text, nullTerminated = false) => {
  let bytes2 = Array(text.length).fill(null).map((_, i) => text.charCodeAt(i));
  if (nullTerminated)
    bytes2.push(0);
  return bytes2;
};
var last = (arr) => {
  return arr && arr[arr.length - 1];
};
var lastPresentedSample = (samples) => {
  let result = void 0;
  for (let sample of samples) {
    if (!result || sample.presentationTimestamp > result.presentationTimestamp) {
      result = sample;
    }
  }
  return result;
};
var intoTimescale = (timeInSeconds, timescale, round = true) => {
  let value = timeInSeconds * timescale;
  return round ? Math.round(value) : value;
};
var rotationMatrix = (rotationInDegrees) => {
  let theta = rotationInDegrees * (Math.PI / 180);
  let cosTheta = Math.cos(theta);
  let sinTheta = Math.sin(theta);
  return [
    cosTheta,
    sinTheta,
    0,
    -sinTheta,
    cosTheta,
    0,
    0,
    0,
    1
  ];
};
var IDENTITY_MATRIX = rotationMatrix(0);
var matrixToBytes = (matrix) => {
  return [
    fixed_16_16(matrix[0]),
    fixed_16_16(matrix[1]),
    fixed_2_30(matrix[2]),
    fixed_16_16(matrix[3]),
    fixed_16_16(matrix[4]),
    fixed_2_30(matrix[5]),
    fixed_16_16(matrix[6]),
    fixed_16_16(matrix[7]),
    fixed_2_30(matrix[8])
  ];
};
var deepClone = (x) => {
  if (!x)
    return x;
  if (typeof x !== "object")
    return x;
  if (Array.isArray(x))
    return x.map(deepClone);
  return Object.fromEntries(Object.entries(x).map(([key, value]) => [key, deepClone(value)]));
};
var isU32 = (value) => {
  return value >= 0 && value < 2 ** 32;
};
var box = (type, contents, children) => ({
  type,
  contents: contents && new Uint8Array(contents.flat(10)),
  children
});
var fullBox = (type, version, flags, contents, children) => box(
  type,
  [u8(version), u24(flags), contents ?? []],
  children
);
var ftyp = (details) => {
  let minorVersion = 512;
  if (details.fragmented)
    return box("ftyp", [
      ascii("iso5"),
      // Major brand
      u32(minorVersion),
      // Minor version
      // Compatible brands
      ascii("iso5"),
      ascii("iso6"),
      ascii("mp41")
    ]);
  return box("ftyp", [
    ascii("isom"),
    // Major brand
    u32(minorVersion),
    // Minor version
    // Compatible brands
    ascii("isom"),
    details.holdsAvc ? ascii("avc1") : [],
    ascii("mp41")
  ]);
};
var mdat = (reserveLargeSize) => ({ type: "mdat", largeSize: reserveLargeSize });
var free = (size) => ({ type: "free", size });
var moov = (tracks, creationTime, fragmented = false) => box("moov", null, [
  mvhd(creationTime, tracks),
  ...tracks.map((x) => trak(x, creationTime)),
  fragmented ? mvex(tracks) : null
]);
var mvhd = (creationTime, tracks) => {
  let duration = intoTimescale(Math.max(
    0,
    ...tracks.filter((x) => x.samples.length > 0).map((x) => {
      const lastSample = lastPresentedSample(x.samples);
      return lastSample.presentationTimestamp + lastSample.duration;
    })
  ), GLOBAL_TIMESCALE);
  let nextTrackId = Math.max(...tracks.map((x) => x.id)) + 1;
  let needsU64 = !isU32(creationTime) || !isU32(duration);
  let u32OrU64 = needsU64 ? u64 : u32;
  return fullBox("mvhd", +needsU64, 0, [
    u32OrU64(creationTime),
    // Creation time
    u32OrU64(creationTime),
    // Modification time
    u32(GLOBAL_TIMESCALE),
    // Timescale
    u32OrU64(duration),
    // Duration
    fixed_16_16(1),
    // Preferred rate
    fixed_8_8(1),
    // Preferred volume
    Array(10).fill(0),
    // Reserved
    matrixToBytes(IDENTITY_MATRIX),
    // Matrix
    Array(24).fill(0),
    // Pre-defined
    u32(nextTrackId)
    // Next track ID
  ]);
};
var trak = (track, creationTime) => box("trak", null, [
  tkhd(track, creationTime),
  mdia(track, creationTime)
]);
var tkhd = (track, creationTime) => {
  let lastSample = lastPresentedSample(track.samples);
  let durationInGlobalTimescale = intoTimescale(
    lastSample ? lastSample.presentationTimestamp + lastSample.duration : 0,
    GLOBAL_TIMESCALE
  );
  let needsU64 = !isU32(creationTime) || !isU32(durationInGlobalTimescale);
  let u32OrU64 = needsU64 ? u64 : u32;
  let matrix;
  if (track.info.type === "video") {
    matrix = typeof track.info.rotation === "number" ? rotationMatrix(track.info.rotation) : track.info.rotation;
  } else {
    matrix = IDENTITY_MATRIX;
  }
  return fullBox("tkhd", +needsU64, 3, [
    u32OrU64(creationTime),
    // Creation time
    u32OrU64(creationTime),
    // Modification time
    u32(track.id),
    // Track ID
    u32(0),
    // Reserved
    u32OrU64(durationInGlobalTimescale),
    // Duration
    Array(8).fill(0),
    // Reserved
    u16(0),
    // Layer
    u16(0),
    // Alternate group
    fixed_8_8(track.info.type === "audio" ? 1 : 0),
    // Volume
    u16(0),
    // Reserved
    matrixToBytes(matrix),
    // Matrix
    fixed_16_16(track.info.type === "video" ? track.info.width : 0),
    // Track width
    fixed_16_16(track.info.type === "video" ? track.info.height : 0)
    // Track height
  ]);
};
var mdia = (track, creationTime) => box("mdia", null, [
  mdhd(track, creationTime),
  hdlr(track.info.type === "video" ? "vide" : "soun"),
  minf(track)
]);
var mdhd = (track, creationTime) => {
  let lastSample = lastPresentedSample(track.samples);
  let localDuration = intoTimescale(
    lastSample ? lastSample.presentationTimestamp + lastSample.duration : 0,
    track.timescale
  );
  let needsU64 = !isU32(creationTime) || !isU32(localDuration);
  let u32OrU64 = needsU64 ? u64 : u32;
  return fullBox("mdhd", +needsU64, 0, [
    u32OrU64(creationTime),
    // Creation time
    u32OrU64(creationTime),
    // Modification time
    u32(track.timescale),
    // Timescale
    u32OrU64(localDuration),
    // Duration
    u16(21956),
    // Language ("und", undetermined)
    u16(0)
    // Quality
  ]);
};
var hdlr = (componentSubtype) => fullBox("hdlr", 0, 0, [
  ascii("mhlr"),
  // Component type
  ascii(componentSubtype),
  // Component subtype
  u32(0),
  // Component manufacturer
  u32(0),
  // Component flags
  u32(0),
  // Component flags mask
  ascii("mp4-muxer-hdlr", true)
  // Component name
]);
var minf = (track) => box("minf", null, [
  track.info.type === "video" ? vmhd() : smhd(),
  dinf(),
  stbl(track)
]);
var vmhd = () => fullBox("vmhd", 0, 1, [
  u16(0),
  // Graphics mode
  u16(0),
  // Opcolor R
  u16(0),
  // Opcolor G
  u16(0)
  // Opcolor B
]);
var smhd = () => fullBox("smhd", 0, 0, [
  u16(0),
  // Balance
  u16(0)
  // Reserved
]);
var dinf = () => box("dinf", null, [
  dref()
]);
var dref = () => fullBox("dref", 0, 0, [
  u32(1)
  // Entry count
], [
  url()
]);
var url = () => fullBox("url ", 0, 1);
var stbl = (track) => {
  const needsCtts = track.compositionTimeOffsetTable.length > 1 || track.compositionTimeOffsetTable.some((x) => x.sampleCompositionTimeOffset !== 0);
  return box("stbl", null, [
    stsd(track),
    stts(track),
    stss(track),
    stsc(track),
    stsz(track),
    stco(track),
    needsCtts ? ctts(track) : null
  ]);
};
var stsd = (track) => fullBox("stsd", 0, 0, [
  u32(1)
  // Entry count
], [
  track.info.type === "video" ? videoSampleDescription(
    VIDEO_CODEC_TO_BOX_NAME[track.info.codec],
    track
  ) : soundSampleDescription(
    AUDIO_CODEC_TO_BOX_NAME[track.info.codec],
    track
  )
]);
var videoSampleDescription = (compressionType, track) => box(compressionType, [
  Array(6).fill(0),
  // Reserved
  u16(1),
  // Data reference index
  u16(0),
  // Pre-defined
  u16(0),
  // Reserved
  Array(12).fill(0),
  // Pre-defined
  u16(track.info.width),
  // Width
  u16(track.info.height),
  // Height
  u32(4718592),
  // Horizontal resolution
  u32(4718592),
  // Vertical resolution
  u32(0),
  // Reserved
  u16(1),
  // Frame count
  Array(32).fill(0),
  // Compressor name
  u16(24),
  // Depth
  i16(65535)
  // Pre-defined
], [
  VIDEO_CODEC_TO_CONFIGURATION_BOX[track.info.codec](track),
  track.info.decoderConfig.colorSpace ? colr(track) : null
]);
var COLOR_PRIMARIES_MAP = {
  "bt709": 1,
  // ITU-R BT.709
  "bt470bg": 5,
  // ITU-R BT.470BG
  "smpte170m": 6
  // ITU-R BT.601 525 - SMPTE 170M
};
var TRANSFER_CHARACTERISTICS_MAP = {
  "bt709": 1,
  // ITU-R BT.709
  "smpte170m": 6,
  // SMPTE 170M
  "iec61966-2-1": 13
  // IEC 61966-2-1
};
var MATRIX_COEFFICIENTS_MAP = {
  "rgb": 0,
  // Identity
  "bt709": 1,
  // ITU-R BT.709
  "bt470bg": 5,
  // ITU-R BT.470BG
  "smpte170m": 6
  // SMPTE 170M
};
var colr = (track) => box("colr", [
  ascii("nclx"),
  // Colour type
  u16(COLOR_PRIMARIES_MAP[track.info.decoderConfig.colorSpace.primaries]),
  // Colour primaries
  u16(TRANSFER_CHARACTERISTICS_MAP[track.info.decoderConfig.colorSpace.transfer]),
  // Transfer characteristics
  u16(MATRIX_COEFFICIENTS_MAP[track.info.decoderConfig.colorSpace.matrix]),
  // Matrix coefficients
  u8((track.info.decoderConfig.colorSpace.fullRange ? 1 : 0) << 7)
  // Full range flag
]);
var avcC = (track) => track.info.decoderConfig && box("avcC", [
  // For AVC, description is an AVCDecoderConfigurationRecord, so nothing else to do here
  ...new Uint8Array(track.info.decoderConfig.description)
]);
var hvcC = (track) => track.info.decoderConfig && box("hvcC", [
  // For HEVC, description is a HEVCDecoderConfigurationRecord, so nothing else to do here
  ...new Uint8Array(track.info.decoderConfig.description)
]);
var vpcC = (track) => {
  if (!track.info.decoderConfig) {
    return null;
  }
  let decoderConfig = track.info.decoderConfig;
  if (!decoderConfig.colorSpace) {
    throw new Error(`'colorSpace' is required in the decoder config for VP9.`);
  }
  let parts = decoderConfig.codec.split(".");
  let profile = Number(parts[1]);
  let level = Number(parts[2]);
  let bitDepth = Number(parts[3]);
  let chromaSubsampling = 0;
  let thirdByte = (bitDepth << 4) + (chromaSubsampling << 1) + Number(decoderConfig.colorSpace.fullRange);
  let colourPrimaries = 2;
  let transferCharacteristics = 2;
  let matrixCoefficients = 2;
  return fullBox("vpcC", 1, 0, [
    u8(profile),
    // Profile
    u8(level),
    // Level
    u8(thirdByte),
    // Bit depth, chroma subsampling, full range
    u8(colourPrimaries),
    // Colour primaries
    u8(transferCharacteristics),
    // Transfer characteristics
    u8(matrixCoefficients),
    // Matrix coefficients
    u16(0)
    // Codec initialization data size
  ]);
};
var av1C = () => {
  let marker = 1;
  let version = 1;
  let firstByte = (marker << 7) + version;
  return box("av1C", [
    firstByte,
    0,
    0,
    0
  ]);
};
var soundSampleDescription = (compressionType, track) => box(compressionType, [
  Array(6).fill(0),
  // Reserved
  u16(1),
  // Data reference index
  u16(0),
  // Version
  u16(0),
  // Revision level
  u32(0),
  // Vendor
  u16(track.info.numberOfChannels),
  // Number of channels
  u16(16),
  // Sample size (bits)
  u16(0),
  // Compression ID
  u16(0),
  // Packet size
  fixed_16_16(track.info.sampleRate)
  // Sample rate
], [
  AUDIO_CODEC_TO_CONFIGURATION_BOX[track.info.codec](track)
]);
var esds = (track) => {
  let description = new Uint8Array(track.info.decoderConfig.description);
  return fullBox("esds", 0, 0, [
    // https://stackoverflow.com/a/54803118
    u32(58753152),
    // TAG(3) = Object Descriptor ([2])
    u8(32 + description.byteLength),
    // length of this OD (which includes the next 2 tags)
    u16(1),
    // ES_ID = 1
    u8(0),
    // flags etc = 0
    u32(75530368),
    // TAG(4) = ES Descriptor ([2]) embedded in above OD
    u8(18 + description.byteLength),
    // length of this ESD
    u8(64),
    // MPEG-4 Audio
    u8(21),
    // stream type(6bits)=5 audio, flags(2bits)=1
    u24(0),
    // 24bit buffer size
    u32(130071),
    // max bitrate
    u32(130071),
    // avg bitrate
    u32(92307584),
    // TAG(5) = ASC ([2],[3]) embedded in above OD
    u8(description.byteLength),
    // length
    ...description,
    u32(109084800),
    // TAG(6)
    u8(1),
    // length
    u8(2)
    // data
  ]);
};
var dOps = (track) => {
  let preskip = 3840;
  let gain = 0;
  const description = track.info.decoderConfig?.description;
  if (description) {
    if (description.byteLength < 18) {
      throw new TypeError("Invalid decoder description provided for Opus; must be at least 18 bytes long.");
    }
    const view2 = ArrayBuffer.isView(description) ? new DataView(description.buffer, description.byteOffset, description.byteLength) : new DataView(description);
    preskip = view2.getUint16(10, true);
    gain = view2.getInt16(14, true);
  }
  return box("dOps", [
    u8(0),
    // Version
    u8(track.info.numberOfChannels),
    // OutputChannelCount
    u16(preskip),
    u32(track.info.sampleRate),
    // InputSampleRate
    fixed_8_8(gain),
    // OutputGain
    u8(0)
    // ChannelMappingFamily
  ]);
};
var stts = (track) => {
  return fullBox("stts", 0, 0, [
    u32(track.timeToSampleTable.length),
    // Number of entries
    track.timeToSampleTable.map((x) => [
      // Time-to-sample table
      u32(x.sampleCount),
      // Sample count
      u32(x.sampleDelta)
      // Sample duration
    ])
  ]);
};
var stss = (track) => {
  if (track.samples.every((x) => x.type === "key"))
    return null;
  let keySamples = [...track.samples.entries()].filter(([, sample]) => sample.type === "key");
  return fullBox("stss", 0, 0, [
    u32(keySamples.length),
    // Number of entries
    keySamples.map(([index]) => u32(index + 1))
    // Sync sample table
  ]);
};
var stsc = (track) => {
  return fullBox("stsc", 0, 0, [
    u32(track.compactlyCodedChunkTable.length),
    // Number of entries
    track.compactlyCodedChunkTable.map((x) => [
      // Sample-to-chunk table
      u32(x.firstChunk),
      // First chunk
      u32(x.samplesPerChunk),
      // Samples per chunk
      u32(1)
      // Sample description index
    ])
  ]);
};
var stsz = (track) => fullBox("stsz", 0, 0, [
  u32(0),
  // Sample size (0 means non-constant size)
  u32(track.samples.length),
  // Number of entries
  track.samples.map((x) => u32(x.size))
  // Sample size table
]);
var stco = (track) => {
  if (track.finalizedChunks.length > 0 && last(track.finalizedChunks).offset >= 2 ** 32) {
    return fullBox("co64", 0, 0, [
      u32(track.finalizedChunks.length),
      // Number of entries
      track.finalizedChunks.map((x) => u64(x.offset))
      // Chunk offset table
    ]);
  }
  return fullBox("stco", 0, 0, [
    u32(track.finalizedChunks.length),
    // Number of entries
    track.finalizedChunks.map((x) => u32(x.offset))
    // Chunk offset table
  ]);
};
var ctts = (track) => {
  return fullBox("ctts", 0, 0, [
    u32(track.compositionTimeOffsetTable.length),
    // Number of entries
    track.compositionTimeOffsetTable.map((x) => [
      // Time-to-sample table
      u32(x.sampleCount),
      // Sample count
      u32(x.sampleCompositionTimeOffset)
      // Sample offset
    ])
  ]);
};
var mvex = (tracks) => {
  return box("mvex", null, tracks.map(trex));
};
var trex = (track) => {
  return fullBox("trex", 0, 0, [
    u32(track.id),
    // Track ID
    u32(1),
    // Default sample description index
    u32(0),
    // Default sample duration
    u32(0),
    // Default sample size
    u32(0)
    // Default sample flags
  ]);
};
var moof = (sequenceNumber, tracks) => {
  return box("moof", null, [
    mfhd(sequenceNumber),
    ...tracks.map(traf)
  ]);
};
var mfhd = (sequenceNumber) => {
  return fullBox("mfhd", 0, 0, [
    u32(sequenceNumber)
    // Sequence number
  ]);
};
var fragmentSampleFlags = (sample) => {
  let byte1 = 0;
  let byte2 = 0;
  let byte3 = 0;
  let byte4 = 0;
  let sampleIsDifferenceSample = sample.type === "delta";
  byte2 |= +sampleIsDifferenceSample;
  if (sampleIsDifferenceSample) {
    byte1 |= 1;
  } else {
    byte1 |= 2;
  }
  return byte1 << 24 | byte2 << 16 | byte3 << 8 | byte4;
};
var traf = (track) => {
  return box("traf", null, [
    tfhd(track),
    tfdt(track),
    trun(track)
  ]);
};
var tfhd = (track) => {
  let tfFlags = 0;
  tfFlags |= 8;
  tfFlags |= 16;
  tfFlags |= 32;
  tfFlags |= 131072;
  let referenceSample = track.currentChunk.samples[1] ?? track.currentChunk.samples[0];
  let referenceSampleInfo = {
    duration: referenceSample.timescaleUnitsToNextSample,
    size: referenceSample.size,
    flags: fragmentSampleFlags(referenceSample)
  };
  return fullBox("tfhd", 0, tfFlags, [
    u32(track.id),
    // Track ID
    u32(referenceSampleInfo.duration),
    // Default sample duration
    u32(referenceSampleInfo.size),
    // Default sample size
    u32(referenceSampleInfo.flags)
    // Default sample flags
  ]);
};
var tfdt = (track) => {
  return fullBox("tfdt", 1, 0, [
    u64(intoTimescale(track.currentChunk.startTimestamp, track.timescale))
    // Base Media Decode Time
  ]);
};
var trun = (track) => {
  let allSampleDurations = track.currentChunk.samples.map((x) => x.timescaleUnitsToNextSample);
  let allSampleSizes = track.currentChunk.samples.map((x) => x.size);
  let allSampleFlags = track.currentChunk.samples.map(fragmentSampleFlags);
  let allSampleCompositionTimeOffsets = track.currentChunk.samples.map((x) => intoTimescale(x.presentationTimestamp - x.decodeTimestamp, track.timescale));
  let uniqueSampleDurations = new Set(allSampleDurations);
  let uniqueSampleSizes = new Set(allSampleSizes);
  let uniqueSampleFlags = new Set(allSampleFlags);
  let uniqueSampleCompositionTimeOffsets = new Set(allSampleCompositionTimeOffsets);
  let firstSampleFlagsPresent = uniqueSampleFlags.size === 2 && allSampleFlags[0] !== allSampleFlags[1];
  let sampleDurationPresent = uniqueSampleDurations.size > 1;
  let sampleSizePresent = uniqueSampleSizes.size > 1;
  let sampleFlagsPresent = !firstSampleFlagsPresent && uniqueSampleFlags.size > 1;
  let sampleCompositionTimeOffsetsPresent = uniqueSampleCompositionTimeOffsets.size > 1 || [...uniqueSampleCompositionTimeOffsets].some((x) => x !== 0);
  let flags = 0;
  flags |= 1;
  flags |= 4 * +firstSampleFlagsPresent;
  flags |= 256 * +sampleDurationPresent;
  flags |= 512 * +sampleSizePresent;
  flags |= 1024 * +sampleFlagsPresent;
  flags |= 2048 * +sampleCompositionTimeOffsetsPresent;
  return fullBox("trun", 1, flags, [
    u32(track.currentChunk.samples.length),
    // Sample count
    u32(track.currentChunk.offset - track.currentChunk.moofOffset || 0),
    // Data offset
    firstSampleFlagsPresent ? u32(allSampleFlags[0]) : [],
    track.currentChunk.samples.map((_, i) => [
      sampleDurationPresent ? u32(allSampleDurations[i]) : [],
      // Sample duration
      sampleSizePresent ? u32(allSampleSizes[i]) : [],
      // Sample size
      sampleFlagsPresent ? u32(allSampleFlags[i]) : [],
      // Sample flags
      // Sample composition time offsets
      sampleCompositionTimeOffsetsPresent ? i32(allSampleCompositionTimeOffsets[i]) : []
    ])
  ]);
};
var mfra = (tracks) => {
  return box("mfra", null, [
    ...tracks.map(tfra),
    mfro()
  ]);
};
var tfra = (track, trackIndex) => {
  let version = 1;
  return fullBox("tfra", version, 0, [
    u32(track.id),
    // Track ID
    u32(63),
    // This specifies that traf number, trun number and sample number are 32-bit ints
    u32(track.finalizedChunks.length),
    // Number of entries
    track.finalizedChunks.map((chunk) => [
      u64(intoTimescale(chunk.startTimestamp, track.timescale)),
      // Time
      u64(chunk.moofOffset),
      // moof offset
      u32(trackIndex + 1),
      // traf number
      u32(1),
      // trun number
      u32(1)
      // Sample number
    ])
  ]);
};
var mfro = () => {
  return fullBox("mfro", 0, 0, [
    // This value needs to be overwritten manually from the outside, where the actual size of the enclosing mfra box
    // is known
    u32(0)
    // Size
  ]);
};
var VIDEO_CODEC_TO_BOX_NAME = {
  "avc": "avc1",
  "hevc": "hvc1",
  "vp9": "vp09",
  "av1": "av01"
};
var VIDEO_CODEC_TO_CONFIGURATION_BOX = {
  "avc": avcC,
  "hevc": hvcC,
  "vp9": vpcC,
  "av1": av1C
};
var AUDIO_CODEC_TO_BOX_NAME = {
  "aac": "mp4a",
  "opus": "Opus"
};
var AUDIO_CODEC_TO_CONFIGURATION_BOX = {
  "aac": esds,
  "opus": dOps
};
var Target = class {
};
var ArrayBufferTarget = class extends Target {
  constructor() {
    super(...arguments);
    this.buffer = null;
  }
};
var StreamTarget = class extends Target {
  constructor(options) {
    super();
    this.options = options;
    if (typeof options !== "object") {
      throw new TypeError("StreamTarget requires an options object to be passed to its constructor.");
    }
    if (options.onData) {
      if (typeof options.onData !== "function") {
        throw new TypeError("options.onData, when provided, must be a function.");
      }
      if (options.onData.length < 2) {
        throw new TypeError(
          "options.onData, when provided, must be a function that takes in at least two arguments (data and position). Ignoring the position argument, which specifies the byte offset at which the data is to be written, can lead to broken outputs."
        );
      }
    }
    if (options.chunked !== void 0 && typeof options.chunked !== "boolean") {
      throw new TypeError("options.chunked, when provided, must be a boolean.");
    }
    if (options.chunkSize !== void 0 && (!Number.isInteger(options.chunkSize) || options.chunkSize < 1024)) {
      throw new TypeError("options.chunkSize, when provided, must be an integer and not smaller than 1024.");
    }
  }
};
var FileSystemWritableFileStreamTarget = class extends Target {
  constructor(stream, options) {
    super();
    this.stream = stream;
    this.options = options;
    if (!(stream instanceof FileSystemWritableFileStream)) {
      throw new TypeError("FileSystemWritableFileStreamTarget requires a FileSystemWritableFileStream instance.");
    }
    if (options !== void 0 && typeof options !== "object") {
      throw new TypeError("FileSystemWritableFileStreamTarget's options, when provided, must be an object.");
    }
    if (options) {
      if (options.chunkSize !== void 0 && (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0)) {
        throw new TypeError("options.chunkSize, when provided, must be a positive integer");
      }
    }
  }
};
var _helper;
var _helperView;
var Writer = class {
  constructor() {
    this.pos = 0;
    __privateAdd(this, _helper, new Uint8Array(8));
    __privateAdd(this, _helperView, new DataView(__privateGet(this, _helper).buffer));
    this.offsets = /* @__PURE__ */ new WeakMap();
  }
  /** Sets the current position for future writes to a new one. */
  seek(newPos) {
    this.pos = newPos;
  }
  writeU32(value) {
    __privateGet(this, _helperView).setUint32(0, value, false);
    this.write(__privateGet(this, _helper).subarray(0, 4));
  }
  writeU64(value) {
    __privateGet(this, _helperView).setUint32(0, Math.floor(value / 2 ** 32), false);
    __privateGet(this, _helperView).setUint32(4, value, false);
    this.write(__privateGet(this, _helper).subarray(0, 8));
  }
  writeAscii(text) {
    for (let i = 0; i < text.length; i++) {
      __privateGet(this, _helperView).setUint8(i % 8, text.charCodeAt(i));
      if (i % 8 === 7)
        this.write(__privateGet(this, _helper));
    }
    if (text.length % 8 !== 0) {
      this.write(__privateGet(this, _helper).subarray(0, text.length % 8));
    }
  }
  writeBox(box2) {
    this.offsets.set(box2, this.pos);
    if (box2.contents && !box2.children) {
      this.writeBoxHeader(box2, box2.size ?? box2.contents.byteLength + 8);
      this.write(box2.contents);
    } else {
      let startPos = this.pos;
      this.writeBoxHeader(box2, 0);
      if (box2.contents)
        this.write(box2.contents);
      if (box2.children) {
        for (let child of box2.children)
          if (child)
            this.writeBox(child);
      }
      let endPos = this.pos;
      let size = box2.size ?? endPos - startPos;
      this.seek(startPos);
      this.writeBoxHeader(box2, size);
      this.seek(endPos);
    }
  }
  writeBoxHeader(box2, size) {
    this.writeU32(box2.largeSize ? 1 : size);
    this.writeAscii(box2.type);
    if (box2.largeSize)
      this.writeU64(size);
  }
  measureBoxHeader(box2) {
    return 8 + (box2.largeSize ? 8 : 0);
  }
  patchBox(box2) {
    let endPos = this.pos;
    this.seek(this.offsets.get(box2));
    this.writeBox(box2);
    this.seek(endPos);
  }
  measureBox(box2) {
    if (box2.contents && !box2.children) {
      let headerSize = this.measureBoxHeader(box2);
      return headerSize + box2.contents.byteLength;
    } else {
      let result = this.measureBoxHeader(box2);
      if (box2.contents)
        result += box2.contents.byteLength;
      if (box2.children) {
        for (let child of box2.children)
          if (child)
            result += this.measureBox(child);
      }
      return result;
    }
  }
};
_helper = /* @__PURE__ */ new WeakMap();
_helperView = /* @__PURE__ */ new WeakMap();
var _target;
var _buffer;
var _bytes;
var _maxPos;
var _ensureSize;
var ensureSize_fn;
var ArrayBufferTargetWriter = class extends Writer {
  constructor(target) {
    super();
    __privateAdd(this, _ensureSize);
    __privateAdd(this, _target, void 0);
    __privateAdd(this, _buffer, new ArrayBuffer(2 ** 16));
    __privateAdd(this, _bytes, new Uint8Array(__privateGet(this, _buffer)));
    __privateAdd(this, _maxPos, 0);
    __privateSet(this, _target, target);
  }
  write(data) {
    __privateMethod(this, _ensureSize, ensureSize_fn).call(this, this.pos + data.byteLength);
    __privateGet(this, _bytes).set(data, this.pos);
    this.pos += data.byteLength;
    __privateSet(this, _maxPos, Math.max(__privateGet(this, _maxPos), this.pos));
  }
  finalize() {
    __privateMethod(this, _ensureSize, ensureSize_fn).call(this, this.pos);
    __privateGet(this, _target).buffer = __privateGet(this, _buffer).slice(0, Math.max(__privateGet(this, _maxPos), this.pos));
  }
};
_target = /* @__PURE__ */ new WeakMap();
_buffer = /* @__PURE__ */ new WeakMap();
_bytes = /* @__PURE__ */ new WeakMap();
_maxPos = /* @__PURE__ */ new WeakMap();
_ensureSize = /* @__PURE__ */ new WeakSet();
ensureSize_fn = function(size) {
  let newLength = __privateGet(this, _buffer).byteLength;
  while (newLength < size)
    newLength *= 2;
  if (newLength === __privateGet(this, _buffer).byteLength)
    return;
  let newBuffer = new ArrayBuffer(newLength);
  let newBytes = new Uint8Array(newBuffer);
  newBytes.set(__privateGet(this, _bytes), 0);
  __privateSet(this, _buffer, newBuffer);
  __privateSet(this, _bytes, newBytes);
};
var DEFAULT_CHUNK_SIZE = 2 ** 24;
var MAX_CHUNKS_AT_ONCE = 2;
var _target2;
var _sections;
var _chunked;
var _chunkSize;
var _chunks;
var _writeDataIntoChunks;
var writeDataIntoChunks_fn;
var _insertSectionIntoChunk;
var insertSectionIntoChunk_fn;
var _createChunk;
var createChunk_fn;
var _flushChunks;
var flushChunks_fn;
var StreamTargetWriter = class extends Writer {
  constructor(target) {
    super();
    __privateAdd(this, _writeDataIntoChunks);
    __privateAdd(this, _insertSectionIntoChunk);
    __privateAdd(this, _createChunk);
    __privateAdd(this, _flushChunks);
    __privateAdd(this, _target2, void 0);
    __privateAdd(this, _sections, []);
    __privateAdd(this, _chunked, void 0);
    __privateAdd(this, _chunkSize, void 0);
    __privateAdd(this, _chunks, []);
    __privateSet(this, _target2, target);
    __privateSet(this, _chunked, target.options?.chunked ?? false);
    __privateSet(this, _chunkSize, target.options?.chunkSize ?? DEFAULT_CHUNK_SIZE);
  }
  write(data) {
    __privateGet(this, _sections).push({
      data: data.slice(),
      start: this.pos
    });
    this.pos += data.byteLength;
  }
  flush() {
    if (__privateGet(this, _sections).length === 0)
      return;
    let chunks = [];
    let sorted = [...__privateGet(this, _sections)].sort((a, b) => a.start - b.start);
    chunks.push({
      start: sorted[0].start,
      size: sorted[0].data.byteLength
    });
    for (let i = 1; i < sorted.length; i++) {
      let lastChunk = chunks[chunks.length - 1];
      let section = sorted[i];
      if (section.start <= lastChunk.start + lastChunk.size) {
        lastChunk.size = Math.max(lastChunk.size, section.start + section.data.byteLength - lastChunk.start);
      } else {
        chunks.push({
          start: section.start,
          size: section.data.byteLength
        });
      }
    }
    for (let chunk of chunks) {
      chunk.data = new Uint8Array(chunk.size);
      for (let section of __privateGet(this, _sections)) {
        if (chunk.start <= section.start && section.start < chunk.start + chunk.size) {
          chunk.data.set(section.data, section.start - chunk.start);
        }
      }
      if (__privateGet(this, _chunked)) {
        __privateMethod(this, _writeDataIntoChunks, writeDataIntoChunks_fn).call(this, chunk.data, chunk.start);
        __privateMethod(this, _flushChunks, flushChunks_fn).call(this);
      } else {
        __privateGet(this, _target2).options.onData?.(chunk.data, chunk.start);
      }
    }
    __privateGet(this, _sections).length = 0;
  }
  finalize() {
    if (__privateGet(this, _chunked)) {
      __privateMethod(this, _flushChunks, flushChunks_fn).call(this, true);
    }
  }
};
_target2 = /* @__PURE__ */ new WeakMap();
_sections = /* @__PURE__ */ new WeakMap();
_chunked = /* @__PURE__ */ new WeakMap();
_chunkSize = /* @__PURE__ */ new WeakMap();
_chunks = /* @__PURE__ */ new WeakMap();
_writeDataIntoChunks = /* @__PURE__ */ new WeakSet();
writeDataIntoChunks_fn = function(data, position) {
  let chunkIndex = __privateGet(this, _chunks).findIndex((x) => x.start <= position && position < x.start + __privateGet(this, _chunkSize));
  if (chunkIndex === -1)
    chunkIndex = __privateMethod(this, _createChunk, createChunk_fn).call(this, position);
  let chunk = __privateGet(this, _chunks)[chunkIndex];
  let relativePosition = position - chunk.start;
  let toWrite = data.subarray(0, Math.min(__privateGet(this, _chunkSize) - relativePosition, data.byteLength));
  chunk.data.set(toWrite, relativePosition);
  let section = {
    start: relativePosition,
    end: relativePosition + toWrite.byteLength
  };
  __privateMethod(this, _insertSectionIntoChunk, insertSectionIntoChunk_fn).call(this, chunk, section);
  if (chunk.written[0].start === 0 && chunk.written[0].end === __privateGet(this, _chunkSize)) {
    chunk.shouldFlush = true;
  }
  if (__privateGet(this, _chunks).length > MAX_CHUNKS_AT_ONCE) {
    for (let i = 0; i < __privateGet(this, _chunks).length - 1; i++) {
      __privateGet(this, _chunks)[i].shouldFlush = true;
    }
    __privateMethod(this, _flushChunks, flushChunks_fn).call(this);
  }
  if (toWrite.byteLength < data.byteLength) {
    __privateMethod(this, _writeDataIntoChunks, writeDataIntoChunks_fn).call(this, data.subarray(toWrite.byteLength), position + toWrite.byteLength);
  }
};
_insertSectionIntoChunk = /* @__PURE__ */ new WeakSet();
insertSectionIntoChunk_fn = function(chunk, section) {
  let low = 0;
  let high = chunk.written.length - 1;
  let index = -1;
  while (low <= high) {
    let mid = Math.floor(low + (high - low + 1) / 2);
    if (chunk.written[mid].start <= section.start) {
      low = mid + 1;
      index = mid;
    } else {
      high = mid - 1;
    }
  }
  chunk.written.splice(index + 1, 0, section);
  if (index === -1 || chunk.written[index].end < section.start)
    index++;
  while (index < chunk.written.length - 1 && chunk.written[index].end >= chunk.written[index + 1].start) {
    chunk.written[index].end = Math.max(chunk.written[index].end, chunk.written[index + 1].end);
    chunk.written.splice(index + 1, 1);
  }
};
_createChunk = /* @__PURE__ */ new WeakSet();
createChunk_fn = function(includesPosition) {
  let start2 = Math.floor(includesPosition / __privateGet(this, _chunkSize)) * __privateGet(this, _chunkSize);
  let chunk = {
    start: start2,
    data: new Uint8Array(__privateGet(this, _chunkSize)),
    written: [],
    shouldFlush: false
  };
  __privateGet(this, _chunks).push(chunk);
  __privateGet(this, _chunks).sort((a, b) => a.start - b.start);
  return __privateGet(this, _chunks).indexOf(chunk);
};
_flushChunks = /* @__PURE__ */ new WeakSet();
flushChunks_fn = function(force = false) {
  for (let i = 0; i < __privateGet(this, _chunks).length; i++) {
    let chunk = __privateGet(this, _chunks)[i];
    if (!chunk.shouldFlush && !force)
      continue;
    for (let section of chunk.written) {
      __privateGet(this, _target2).options.onData?.(
        chunk.data.subarray(section.start, section.end),
        chunk.start + section.start
      );
    }
    __privateGet(this, _chunks).splice(i--, 1);
  }
};
var FileSystemWritableFileStreamTargetWriter = class extends StreamTargetWriter {
  constructor(target) {
    super(new StreamTarget({
      onData: (data, position) => target.stream.write({
        type: "write",
        data,
        position
      }),
      chunked: true,
      chunkSize: target.options?.chunkSize
    }));
  }
};
var GLOBAL_TIMESCALE = 1e3;
var SUPPORTED_VIDEO_CODECS = ["avc", "hevc", "vp9", "av1"];
var SUPPORTED_AUDIO_CODECS = ["aac", "opus"];
var TIMESTAMP_OFFSET = 2082844800;
var FIRST_TIMESTAMP_BEHAVIORS = ["strict", "offset", "cross-track-offset"];
var _options;
var _writer;
var _ftypSize;
var _mdat;
var _videoTrack;
var _audioTrack;
var _creationTime;
var _finalizedChunks;
var _nextFragmentNumber;
var _videoSampleQueue;
var _audioSampleQueue;
var _finalized;
var _validateOptions;
var validateOptions_fn;
var _writeHeader;
var writeHeader_fn;
var _computeMoovSizeUpperBound;
var computeMoovSizeUpperBound_fn;
var _prepareTracks;
var prepareTracks_fn;
var _generateMpeg4AudioSpecificConfig;
var generateMpeg4AudioSpecificConfig_fn;
var _createSampleForTrack;
var createSampleForTrack_fn;
var _addSampleToTrack;
var addSampleToTrack_fn;
var _validateTimestamp;
var validateTimestamp_fn;
var _finalizeCurrentChunk;
var finalizeCurrentChunk_fn;
var _finalizeFragment;
var finalizeFragment_fn;
var _maybeFlushStreamingTargetWriter;
var maybeFlushStreamingTargetWriter_fn;
var _ensureNotFinalized;
var ensureNotFinalized_fn;
var Muxer = class {
  constructor(options) {
    __privateAdd(this, _validateOptions);
    __privateAdd(this, _writeHeader);
    __privateAdd(this, _computeMoovSizeUpperBound);
    __privateAdd(this, _prepareTracks);
    __privateAdd(this, _generateMpeg4AudioSpecificConfig);
    __privateAdd(this, _createSampleForTrack);
    __privateAdd(this, _addSampleToTrack);
    __privateAdd(this, _validateTimestamp);
    __privateAdd(this, _finalizeCurrentChunk);
    __privateAdd(this, _finalizeFragment);
    __privateAdd(this, _maybeFlushStreamingTargetWriter);
    __privateAdd(this, _ensureNotFinalized);
    __privateAdd(this, _options, void 0);
    __privateAdd(this, _writer, void 0);
    __privateAdd(this, _ftypSize, void 0);
    __privateAdd(this, _mdat, void 0);
    __privateAdd(this, _videoTrack, null);
    __privateAdd(this, _audioTrack, null);
    __privateAdd(this, _creationTime, Math.floor(Date.now() / 1e3) + TIMESTAMP_OFFSET);
    __privateAdd(this, _finalizedChunks, []);
    __privateAdd(this, _nextFragmentNumber, 1);
    __privateAdd(this, _videoSampleQueue, []);
    __privateAdd(this, _audioSampleQueue, []);
    __privateAdd(this, _finalized, false);
    __privateMethod(this, _validateOptions, validateOptions_fn).call(this, options);
    options.video = deepClone(options.video);
    options.audio = deepClone(options.audio);
    options.fastStart = deepClone(options.fastStart);
    this.target = options.target;
    __privateSet(this, _options, {
      firstTimestampBehavior: "strict",
      ...options
    });
    if (options.target instanceof ArrayBufferTarget) {
      __privateSet(this, _writer, new ArrayBufferTargetWriter(options.target));
    } else if (options.target instanceof StreamTarget) {
      __privateSet(this, _writer, new StreamTargetWriter(options.target));
    } else if (options.target instanceof FileSystemWritableFileStreamTarget) {
      __privateSet(this, _writer, new FileSystemWritableFileStreamTargetWriter(options.target));
    } else {
      throw new Error(`Invalid target: ${options.target}`);
    }
    __privateMethod(this, _prepareTracks, prepareTracks_fn).call(this);
    __privateMethod(this, _writeHeader, writeHeader_fn).call(this);
  }
  addVideoChunk(sample, meta, timestamp, compositionTimeOffset) {
    if (!(sample instanceof EncodedVideoChunk)) {
      throw new TypeError("addVideoChunk's first argument (sample) must be of type EncodedVideoChunk.");
    }
    if (meta && typeof meta !== "object") {
      throw new TypeError("addVideoChunk's second argument (meta), when provided, must be an object.");
    }
    if (timestamp !== void 0 && (!Number.isFinite(timestamp) || timestamp < 0)) {
      throw new TypeError(
        "addVideoChunk's third argument (timestamp), when provided, must be a non-negative real number."
      );
    }
    if (compositionTimeOffset !== void 0 && !Number.isFinite(compositionTimeOffset)) {
      throw new TypeError(
        "addVideoChunk's fourth argument (compositionTimeOffset), when provided, must be a real number."
      );
    }
    let data = new Uint8Array(sample.byteLength);
    sample.copyTo(data);
    this.addVideoChunkRaw(
      data,
      sample.type,
      timestamp ?? sample.timestamp,
      sample.duration,
      meta,
      compositionTimeOffset
    );
  }
  addVideoChunkRaw(data, type, timestamp, duration, meta, compositionTimeOffset) {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError("addVideoChunkRaw's first argument (data) must be an instance of Uint8Array.");
    }
    if (type !== "key" && type !== "delta") {
      throw new TypeError("addVideoChunkRaw's second argument (type) must be either 'key' or 'delta'.");
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new TypeError("addVideoChunkRaw's third argument (timestamp) must be a non-negative real number.");
    }
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError("addVideoChunkRaw's fourth argument (duration) must be a non-negative real number.");
    }
    if (meta && typeof meta !== "object") {
      throw new TypeError("addVideoChunkRaw's fifth argument (meta), when provided, must be an object.");
    }
    if (compositionTimeOffset !== void 0 && !Number.isFinite(compositionTimeOffset)) {
      throw new TypeError(
        "addVideoChunkRaw's sixth argument (compositionTimeOffset), when provided, must be a real number."
      );
    }
    __privateMethod(this, _ensureNotFinalized, ensureNotFinalized_fn).call(this);
    if (!__privateGet(this, _options).video)
      throw new Error("No video track declared.");
    if (typeof __privateGet(this, _options).fastStart === "object" && __privateGet(this, _videoTrack).samples.length === __privateGet(this, _options).fastStart.expectedVideoChunks) {
      throw new Error(`Cannot add more video chunks than specified in 'fastStart' (${__privateGet(this, _options).fastStart.expectedVideoChunks}).`);
    }
    let videoSample = __privateMethod(this, _createSampleForTrack, createSampleForTrack_fn).call(this, __privateGet(this, _videoTrack), data, type, timestamp, duration, meta, compositionTimeOffset);
    if (__privateGet(this, _options).fastStart === "fragmented" && __privateGet(this, _audioTrack)) {
      while (__privateGet(this, _audioSampleQueue).length > 0 && __privateGet(this, _audioSampleQueue)[0].decodeTimestamp <= videoSample.decodeTimestamp) {
        let audioSample = __privateGet(this, _audioSampleQueue).shift();
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
      }
      if (videoSample.decodeTimestamp <= __privateGet(this, _audioTrack).lastDecodeTimestamp) {
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
      } else {
        __privateGet(this, _videoSampleQueue).push(videoSample);
      }
    } else {
      __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
    }
  }
  addAudioChunk(sample, meta, timestamp) {
    if (!(sample instanceof EncodedAudioChunk)) {
      throw new TypeError("addAudioChunk's first argument (sample) must be of type EncodedAudioChunk.");
    }
    if (meta && typeof meta !== "object") {
      throw new TypeError("addAudioChunk's second argument (meta), when provided, must be an object.");
    }
    if (timestamp !== void 0 && (!Number.isFinite(timestamp) || timestamp < 0)) {
      throw new TypeError(
        "addAudioChunk's third argument (timestamp), when provided, must be a non-negative real number."
      );
    }
    let data = new Uint8Array(sample.byteLength);
    sample.copyTo(data);
    this.addAudioChunkRaw(data, sample.type, timestamp ?? sample.timestamp, sample.duration, meta);
  }
  addAudioChunkRaw(data, type, timestamp, duration, meta) {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError("addAudioChunkRaw's first argument (data) must be an instance of Uint8Array.");
    }
    if (type !== "key" && type !== "delta") {
      throw new TypeError("addAudioChunkRaw's second argument (type) must be either 'key' or 'delta'.");
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new TypeError("addAudioChunkRaw's third argument (timestamp) must be a non-negative real number.");
    }
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError("addAudioChunkRaw's fourth argument (duration) must be a non-negative real number.");
    }
    if (meta && typeof meta !== "object") {
      throw new TypeError("addAudioChunkRaw's fifth argument (meta), when provided, must be an object.");
    }
    __privateMethod(this, _ensureNotFinalized, ensureNotFinalized_fn).call(this);
    if (!__privateGet(this, _options).audio)
      throw new Error("No audio track declared.");
    if (typeof __privateGet(this, _options).fastStart === "object" && __privateGet(this, _audioTrack).samples.length === __privateGet(this, _options).fastStart.expectedAudioChunks) {
      throw new Error(`Cannot add more audio chunks than specified in 'fastStart' (${__privateGet(this, _options).fastStart.expectedAudioChunks}).`);
    }
    let audioSample = __privateMethod(this, _createSampleForTrack, createSampleForTrack_fn).call(this, __privateGet(this, _audioTrack), data, type, timestamp, duration, meta);
    if (__privateGet(this, _options).fastStart === "fragmented" && __privateGet(this, _videoTrack)) {
      while (__privateGet(this, _videoSampleQueue).length > 0 && __privateGet(this, _videoSampleQueue)[0].decodeTimestamp <= audioSample.decodeTimestamp) {
        let videoSample = __privateGet(this, _videoSampleQueue).shift();
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
      }
      if (audioSample.decodeTimestamp <= __privateGet(this, _videoTrack).lastDecodeTimestamp) {
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
      } else {
        __privateGet(this, _audioSampleQueue).push(audioSample);
      }
    } else {
      __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
    }
  }
  /** Finalizes the file, making it ready for use. Must be called after all video and audio chunks have been added. */
  finalize() {
    if (__privateGet(this, _finalized)) {
      throw new Error("Cannot finalize a muxer more than once.");
    }
    if (__privateGet(this, _options).fastStart === "fragmented") {
      for (let videoSample of __privateGet(this, _videoSampleQueue))
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
      for (let audioSample of __privateGet(this, _audioSampleQueue))
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
      __privateMethod(this, _finalizeFragment, finalizeFragment_fn).call(this, false);
    } else {
      if (__privateGet(this, _videoTrack))
        __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, __privateGet(this, _videoTrack));
      if (__privateGet(this, _audioTrack))
        __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, __privateGet(this, _audioTrack));
    }
    let tracks = [__privateGet(this, _videoTrack), __privateGet(this, _audioTrack)].filter(Boolean);
    if (__privateGet(this, _options).fastStart === "in-memory") {
      let mdatSize;
      for (let i = 0; i < 2; i++) {
        let movieBox2 = moov(tracks, __privateGet(this, _creationTime));
        let movieBoxSize = __privateGet(this, _writer).measureBox(movieBox2);
        mdatSize = __privateGet(this, _writer).measureBox(__privateGet(this, _mdat));
        let currentChunkPos = __privateGet(this, _writer).pos + movieBoxSize + mdatSize;
        for (let chunk of __privateGet(this, _finalizedChunks)) {
          chunk.offset = currentChunkPos;
          for (let { data } of chunk.samples) {
            currentChunkPos += data.byteLength;
            mdatSize += data.byteLength;
          }
        }
        if (currentChunkPos < 2 ** 32)
          break;
        if (mdatSize >= 2 ** 32)
          __privateGet(this, _mdat).largeSize = true;
      }
      let movieBox = moov(tracks, __privateGet(this, _creationTime));
      __privateGet(this, _writer).writeBox(movieBox);
      __privateGet(this, _mdat).size = mdatSize;
      __privateGet(this, _writer).writeBox(__privateGet(this, _mdat));
      for (let chunk of __privateGet(this, _finalizedChunks)) {
        for (let sample of chunk.samples) {
          __privateGet(this, _writer).write(sample.data);
          sample.data = null;
        }
      }
    } else if (__privateGet(this, _options).fastStart === "fragmented") {
      let startPos = __privateGet(this, _writer).pos;
      let mfraBox2 = mfra(tracks);
      __privateGet(this, _writer).writeBox(mfraBox2);
      let mfraBoxSize = __privateGet(this, _writer).pos - startPos;
      __privateGet(this, _writer).seek(__privateGet(this, _writer).pos - 4);
      __privateGet(this, _writer).writeU32(mfraBoxSize);
    } else {
      let mdatPos = __privateGet(this, _writer).offsets.get(__privateGet(this, _mdat));
      let mdatSize = __privateGet(this, _writer).pos - mdatPos;
      __privateGet(this, _mdat).size = mdatSize;
      __privateGet(this, _mdat).largeSize = mdatSize >= 2 ** 32;
      __privateGet(this, _writer).patchBox(__privateGet(this, _mdat));
      let movieBox = moov(tracks, __privateGet(this, _creationTime));
      if (typeof __privateGet(this, _options).fastStart === "object") {
        __privateGet(this, _writer).seek(__privateGet(this, _ftypSize));
        __privateGet(this, _writer).writeBox(movieBox);
        let remainingBytes = mdatPos - __privateGet(this, _writer).pos;
        __privateGet(this, _writer).writeBox(free(remainingBytes));
      } else {
        __privateGet(this, _writer).writeBox(movieBox);
      }
    }
    __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
    __privateGet(this, _writer).finalize();
    __privateSet(this, _finalized, true);
  }
};
_options = /* @__PURE__ */ new WeakMap();
_writer = /* @__PURE__ */ new WeakMap();
_ftypSize = /* @__PURE__ */ new WeakMap();
_mdat = /* @__PURE__ */ new WeakMap();
_videoTrack = /* @__PURE__ */ new WeakMap();
_audioTrack = /* @__PURE__ */ new WeakMap();
_creationTime = /* @__PURE__ */ new WeakMap();
_finalizedChunks = /* @__PURE__ */ new WeakMap();
_nextFragmentNumber = /* @__PURE__ */ new WeakMap();
_videoSampleQueue = /* @__PURE__ */ new WeakMap();
_audioSampleQueue = /* @__PURE__ */ new WeakMap();
_finalized = /* @__PURE__ */ new WeakMap();
_validateOptions = /* @__PURE__ */ new WeakSet();
validateOptions_fn = function(options) {
  if (typeof options !== "object") {
    throw new TypeError("The muxer requires an options object to be passed to its constructor.");
  }
  if (!(options.target instanceof Target)) {
    throw new TypeError("The target must be provided and an instance of Target.");
  }
  if (options.video) {
    if (!SUPPORTED_VIDEO_CODECS.includes(options.video.codec)) {
      throw new TypeError(`Unsupported video codec: ${options.video.codec}`);
    }
    if (!Number.isInteger(options.video.width) || options.video.width <= 0) {
      throw new TypeError(`Invalid video width: ${options.video.width}. Must be a positive integer.`);
    }
    if (!Number.isInteger(options.video.height) || options.video.height <= 0) {
      throw new TypeError(`Invalid video height: ${options.video.height}. Must be a positive integer.`);
    }
    const videoRotation = options.video.rotation;
    if (typeof videoRotation === "number" && ![0, 90, 180, 270].includes(videoRotation)) {
      throw new TypeError(`Invalid video rotation: ${videoRotation}. Has to be 0, 90, 180 or 270.`);
    } else if (Array.isArray(videoRotation) && (videoRotation.length !== 9 || videoRotation.some((value) => typeof value !== "number"))) {
      throw new TypeError(`Invalid video transformation matrix: ${videoRotation.join()}`);
    }
    if (options.video.frameRate !== void 0 && (!Number.isInteger(options.video.frameRate) || options.video.frameRate <= 0)) {
      throw new TypeError(
        `Invalid video frame rate: ${options.video.frameRate}. Must be a positive integer.`
      );
    }
  }
  if (options.audio) {
    if (!SUPPORTED_AUDIO_CODECS.includes(options.audio.codec)) {
      throw new TypeError(`Unsupported audio codec: ${options.audio.codec}`);
    }
    if (!Number.isInteger(options.audio.numberOfChannels) || options.audio.numberOfChannels <= 0) {
      throw new TypeError(
        `Invalid number of audio channels: ${options.audio.numberOfChannels}. Must be a positive integer.`
      );
    }
    if (!Number.isInteger(options.audio.sampleRate) || options.audio.sampleRate <= 0) {
      throw new TypeError(
        `Invalid audio sample rate: ${options.audio.sampleRate}. Must be a positive integer.`
      );
    }
  }
  if (options.firstTimestampBehavior && !FIRST_TIMESTAMP_BEHAVIORS.includes(options.firstTimestampBehavior)) {
    throw new TypeError(`Invalid first timestamp behavior: ${options.firstTimestampBehavior}`);
  }
  if (typeof options.fastStart === "object") {
    if (options.video) {
      if (options.fastStart.expectedVideoChunks === void 0) {
        throw new TypeError(`'fastStart' is an object but is missing property 'expectedVideoChunks'.`);
      } else if (!Number.isInteger(options.fastStart.expectedVideoChunks) || options.fastStart.expectedVideoChunks < 0) {
        throw new TypeError(`'expectedVideoChunks' must be a non-negative integer.`);
      }
    }
    if (options.audio) {
      if (options.fastStart.expectedAudioChunks === void 0) {
        throw new TypeError(`'fastStart' is an object but is missing property 'expectedAudioChunks'.`);
      } else if (!Number.isInteger(options.fastStart.expectedAudioChunks) || options.fastStart.expectedAudioChunks < 0) {
        throw new TypeError(`'expectedAudioChunks' must be a non-negative integer.`);
      }
    }
  } else if (![false, "in-memory", "fragmented"].includes(options.fastStart)) {
    throw new TypeError(`'fastStart' option must be false, 'in-memory', 'fragmented' or an object.`);
  }
  if (options.minFragmentDuration !== void 0 && (!Number.isFinite(options.minFragmentDuration) || options.minFragmentDuration < 0)) {
    throw new TypeError(`'minFragmentDuration' must be a non-negative number.`);
  }
};
_writeHeader = /* @__PURE__ */ new WeakSet();
writeHeader_fn = function() {
  __privateGet(this, _writer).writeBox(ftyp({
    holdsAvc: __privateGet(this, _options).video?.codec === "avc",
    fragmented: __privateGet(this, _options).fastStart === "fragmented"
  }));
  __privateSet(this, _ftypSize, __privateGet(this, _writer).pos);
  if (__privateGet(this, _options).fastStart === "in-memory") {
    __privateSet(this, _mdat, mdat(false));
  } else if (__privateGet(this, _options).fastStart === "fragmented") {
  } else {
    if (typeof __privateGet(this, _options).fastStart === "object") {
      let moovSizeUpperBound = __privateMethod(this, _computeMoovSizeUpperBound, computeMoovSizeUpperBound_fn).call(this);
      __privateGet(this, _writer).seek(__privateGet(this, _writer).pos + moovSizeUpperBound);
    }
    __privateSet(this, _mdat, mdat(true));
    __privateGet(this, _writer).writeBox(__privateGet(this, _mdat));
  }
  __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
};
_computeMoovSizeUpperBound = /* @__PURE__ */ new WeakSet();
computeMoovSizeUpperBound_fn = function() {
  if (typeof __privateGet(this, _options).fastStart !== "object")
    return;
  let upperBound = 0;
  let sampleCounts = [
    __privateGet(this, _options).fastStart.expectedVideoChunks,
    __privateGet(this, _options).fastStart.expectedAudioChunks
  ];
  for (let n of sampleCounts) {
    if (!n)
      continue;
    upperBound += (4 + 4) * Math.ceil(2 / 3 * n);
    upperBound += 4 * n;
    upperBound += (4 + 4 + 4) * Math.ceil(2 / 3 * n);
    upperBound += 4 * n;
    upperBound += 8 * n;
  }
  upperBound += 4096;
  return upperBound;
};
_prepareTracks = /* @__PURE__ */ new WeakSet();
prepareTracks_fn = function() {
  if (__privateGet(this, _options).video) {
    __privateSet(this, _videoTrack, {
      id: 1,
      info: {
        type: "video",
        codec: __privateGet(this, _options).video.codec,
        width: __privateGet(this, _options).video.width,
        height: __privateGet(this, _options).video.height,
        rotation: __privateGet(this, _options).video.rotation ?? 0,
        decoderConfig: null
      },
      // The fallback contains many common frame rates as factors
      timescale: __privateGet(this, _options).video.frameRate ?? 57600,
      samples: [],
      finalizedChunks: [],
      currentChunk: null,
      firstDecodeTimestamp: void 0,
      lastDecodeTimestamp: -1,
      timeToSampleTable: [],
      compositionTimeOffsetTable: [],
      lastTimescaleUnits: null,
      lastSample: null,
      compactlyCodedChunkTable: []
    });
  }
  if (__privateGet(this, _options).audio) {
    __privateSet(this, _audioTrack, {
      id: __privateGet(this, _options).video ? 2 : 1,
      info: {
        type: "audio",
        codec: __privateGet(this, _options).audio.codec,
        numberOfChannels: __privateGet(this, _options).audio.numberOfChannels,
        sampleRate: __privateGet(this, _options).audio.sampleRate,
        decoderConfig: null
      },
      timescale: __privateGet(this, _options).audio.sampleRate,
      samples: [],
      finalizedChunks: [],
      currentChunk: null,
      firstDecodeTimestamp: void 0,
      lastDecodeTimestamp: -1,
      timeToSampleTable: [],
      compositionTimeOffsetTable: [],
      lastTimescaleUnits: null,
      lastSample: null,
      compactlyCodedChunkTable: []
    });
    if (__privateGet(this, _options).audio.codec === "aac") {
      let guessedCodecPrivate = __privateMethod(this, _generateMpeg4AudioSpecificConfig, generateMpeg4AudioSpecificConfig_fn).call(
        this,
        2,
        // Object type for AAC-LC, since it's the most common
        __privateGet(this, _options).audio.sampleRate,
        __privateGet(this, _options).audio.numberOfChannels
      );
      __privateGet(this, _audioTrack).info.decoderConfig = {
        codec: __privateGet(this, _options).audio.codec,
        description: guessedCodecPrivate,
        numberOfChannels: __privateGet(this, _options).audio.numberOfChannels,
        sampleRate: __privateGet(this, _options).audio.sampleRate
      };
    }
  }
};
_generateMpeg4AudioSpecificConfig = /* @__PURE__ */ new WeakSet();
generateMpeg4AudioSpecificConfig_fn = function(objectType, sampleRate, numberOfChannels) {
  let frequencyIndices = [96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350];
  let frequencyIndex = frequencyIndices.indexOf(sampleRate);
  let channelConfig = numberOfChannels;
  let configBits = "";
  configBits += objectType.toString(2).padStart(5, "0");
  configBits += frequencyIndex.toString(2).padStart(4, "0");
  if (frequencyIndex === 15)
    configBits += sampleRate.toString(2).padStart(24, "0");
  configBits += channelConfig.toString(2).padStart(4, "0");
  let paddingLength = Math.ceil(configBits.length / 8) * 8;
  configBits = configBits.padEnd(paddingLength, "0");
  let configBytes = new Uint8Array(configBits.length / 8);
  for (let i = 0; i < configBits.length; i += 8) {
    configBytes[i / 8] = parseInt(configBits.slice(i, i + 8), 2);
  }
  return configBytes;
};
_createSampleForTrack = /* @__PURE__ */ new WeakSet();
createSampleForTrack_fn = function(track, data, type, timestamp, duration, meta, compositionTimeOffset) {
  let presentationTimestampInSeconds = timestamp / 1e6;
  let decodeTimestampInSeconds = (timestamp - (compositionTimeOffset ?? 0)) / 1e6;
  let durationInSeconds = duration / 1e6;
  let adjusted = __privateMethod(this, _validateTimestamp, validateTimestamp_fn).call(this, presentationTimestampInSeconds, decodeTimestampInSeconds, track);
  presentationTimestampInSeconds = adjusted.presentationTimestamp;
  decodeTimestampInSeconds = adjusted.decodeTimestamp;
  if (meta?.decoderConfig) {
    if (track.info.decoderConfig === null) {
      track.info.decoderConfig = meta.decoderConfig;
    } else {
      Object.assign(track.info.decoderConfig, meta.decoderConfig);
    }
  }
  let sample = {
    presentationTimestamp: presentationTimestampInSeconds,
    decodeTimestamp: decodeTimestampInSeconds,
    duration: durationInSeconds,
    data,
    size: data.byteLength,
    type,
    // Will be refined once the next sample comes in
    timescaleUnitsToNextSample: intoTimescale(durationInSeconds, track.timescale)
  };
  return sample;
};
_addSampleToTrack = /* @__PURE__ */ new WeakSet();
addSampleToTrack_fn = function(track, sample) {
  if (__privateGet(this, _options).fastStart !== "fragmented") {
    track.samples.push(sample);
  }
  const sampleCompositionTimeOffset = intoTimescale(sample.presentationTimestamp - sample.decodeTimestamp, track.timescale);
  if (track.lastTimescaleUnits !== null) {
    let timescaleUnits = intoTimescale(sample.decodeTimestamp, track.timescale, false);
    let delta = Math.round(timescaleUnits - track.lastTimescaleUnits);
    track.lastTimescaleUnits += delta;
    track.lastSample.timescaleUnitsToNextSample = delta;
    if (__privateGet(this, _options).fastStart !== "fragmented") {
      let lastTableEntry = last(track.timeToSampleTable);
      if (lastTableEntry.sampleCount === 1) {
        lastTableEntry.sampleDelta = delta;
        lastTableEntry.sampleCount++;
      } else if (lastTableEntry.sampleDelta === delta) {
        lastTableEntry.sampleCount++;
      } else {
        lastTableEntry.sampleCount--;
        track.timeToSampleTable.push({
          sampleCount: 2,
          sampleDelta: delta
        });
      }
      const lastCompositionTimeOffsetTableEntry = last(track.compositionTimeOffsetTable);
      if (lastCompositionTimeOffsetTableEntry.sampleCompositionTimeOffset === sampleCompositionTimeOffset) {
        lastCompositionTimeOffsetTableEntry.sampleCount++;
      } else {
        track.compositionTimeOffsetTable.push({
          sampleCount: 1,
          sampleCompositionTimeOffset
        });
      }
    }
  } else {
    track.lastTimescaleUnits = 0;
    if (__privateGet(this, _options).fastStart !== "fragmented") {
      track.timeToSampleTable.push({
        sampleCount: 1,
        sampleDelta: intoTimescale(sample.duration, track.timescale)
      });
      track.compositionTimeOffsetTable.push({
        sampleCount: 1,
        sampleCompositionTimeOffset
      });
    }
  }
  track.lastSample = sample;
  let beginNewChunk = false;
  if (!track.currentChunk) {
    beginNewChunk = true;
  } else {
    let currentChunkDuration = sample.presentationTimestamp - track.currentChunk.startTimestamp;
    if (__privateGet(this, _options).fastStart === "fragmented") {
      let mostImportantTrack = __privateGet(this, _videoTrack) ?? __privateGet(this, _audioTrack);
      const chunkDuration = __privateGet(this, _options).minFragmentDuration ?? 1;
      if (track === mostImportantTrack && sample.type === "key" && currentChunkDuration >= chunkDuration) {
        beginNewChunk = true;
        __privateMethod(this, _finalizeFragment, finalizeFragment_fn).call(this);
      }
    } else {
      beginNewChunk = currentChunkDuration >= 0.5;
    }
  }
  if (beginNewChunk) {
    if (track.currentChunk) {
      __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, track);
    }
    track.currentChunk = {
      startTimestamp: sample.presentationTimestamp,
      samples: []
    };
  }
  track.currentChunk.samples.push(sample);
};
_validateTimestamp = /* @__PURE__ */ new WeakSet();
validateTimestamp_fn = function(presentationTimestamp, decodeTimestamp, track) {
  const strictTimestampBehavior = __privateGet(this, _options).firstTimestampBehavior === "strict";
  const noLastDecodeTimestamp = track.lastDecodeTimestamp === -1;
  const timestampNonZero = decodeTimestamp !== 0;
  if (strictTimestampBehavior && noLastDecodeTimestamp && timestampNonZero) {
    throw new Error(
      `The first chunk for your media track must have a timestamp of 0 (received DTS=${decodeTimestamp}).Non-zero first timestamps are often caused by directly piping frames or audio data from a MediaStreamTrack into the encoder. Their timestamps are typically relative to the age of thedocument, which is probably what you want.

If you want to offset all timestamps of a track such that the first one is zero, set firstTimestampBehavior: 'offset' in the options.
`
    );
  } else if (__privateGet(this, _options).firstTimestampBehavior === "offset" || __privateGet(this, _options).firstTimestampBehavior === "cross-track-offset") {
    if (track.firstDecodeTimestamp === void 0) {
      track.firstDecodeTimestamp = decodeTimestamp;
    }
    let baseDecodeTimestamp;
    if (__privateGet(this, _options).firstTimestampBehavior === "offset") {
      baseDecodeTimestamp = track.firstDecodeTimestamp;
    } else {
      baseDecodeTimestamp = Math.min(
        __privateGet(this, _videoTrack)?.firstDecodeTimestamp ?? Infinity,
        __privateGet(this, _audioTrack)?.firstDecodeTimestamp ?? Infinity
      );
    }
    decodeTimestamp -= baseDecodeTimestamp;
    presentationTimestamp -= baseDecodeTimestamp;
  }
  if (decodeTimestamp < track.lastDecodeTimestamp) {
    throw new Error(
      `Timestamps must be monotonically increasing (DTS went from ${track.lastDecodeTimestamp * 1e6} to ${decodeTimestamp * 1e6}).`
    );
  }
  track.lastDecodeTimestamp = decodeTimestamp;
  return { presentationTimestamp, decodeTimestamp };
};
_finalizeCurrentChunk = /* @__PURE__ */ new WeakSet();
finalizeCurrentChunk_fn = function(track) {
  if (__privateGet(this, _options).fastStart === "fragmented") {
    throw new Error("Can't finalize individual chunks if 'fastStart' is set to 'fragmented'.");
  }
  if (!track.currentChunk)
    return;
  track.finalizedChunks.push(track.currentChunk);
  __privateGet(this, _finalizedChunks).push(track.currentChunk);
  if (track.compactlyCodedChunkTable.length === 0 || last(track.compactlyCodedChunkTable).samplesPerChunk !== track.currentChunk.samples.length) {
    track.compactlyCodedChunkTable.push({
      firstChunk: track.finalizedChunks.length,
      // 1-indexed
      samplesPerChunk: track.currentChunk.samples.length
    });
  }
  if (__privateGet(this, _options).fastStart === "in-memory") {
    track.currentChunk.offset = 0;
    return;
  }
  track.currentChunk.offset = __privateGet(this, _writer).pos;
  for (let sample of track.currentChunk.samples) {
    __privateGet(this, _writer).write(sample.data);
    sample.data = null;
  }
  __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
};
_finalizeFragment = /* @__PURE__ */ new WeakSet();
finalizeFragment_fn = function(flushStreamingWriter = true) {
  if (__privateGet(this, _options).fastStart !== "fragmented") {
    throw new Error("Can't finalize a fragment unless 'fastStart' is set to 'fragmented'.");
  }
  let tracks = [__privateGet(this, _videoTrack), __privateGet(this, _audioTrack)].filter((track) => track && track.currentChunk);
  if (tracks.length === 0)
    return;
  let fragmentNumber = __privateWrapper(this, _nextFragmentNumber)._++;
  if (fragmentNumber === 1) {
    let movieBox = moov(tracks, __privateGet(this, _creationTime), true);
    __privateGet(this, _writer).writeBox(movieBox);
  }
  let moofOffset = __privateGet(this, _writer).pos;
  let moofBox2 = moof(fragmentNumber, tracks);
  __privateGet(this, _writer).writeBox(moofBox2);
  {
    let mdatBox2 = mdat(false);
    let totalTrackSampleSize = 0;
    for (let track of tracks) {
      for (let sample of track.currentChunk.samples) {
        totalTrackSampleSize += sample.size;
      }
    }
    let mdatSize = __privateGet(this, _writer).measureBox(mdatBox2) + totalTrackSampleSize;
    if (mdatSize >= 2 ** 32) {
      mdatBox2.largeSize = true;
      mdatSize = __privateGet(this, _writer).measureBox(mdatBox2) + totalTrackSampleSize;
    }
    mdatBox2.size = mdatSize;
    __privateGet(this, _writer).writeBox(mdatBox2);
  }
  for (let track of tracks) {
    track.currentChunk.offset = __privateGet(this, _writer).pos;
    track.currentChunk.moofOffset = moofOffset;
    for (let sample of track.currentChunk.samples) {
      __privateGet(this, _writer).write(sample.data);
      sample.data = null;
    }
  }
  let endPos = __privateGet(this, _writer).pos;
  __privateGet(this, _writer).seek(__privateGet(this, _writer).offsets.get(moofBox2));
  let newMoofBox = moof(fragmentNumber, tracks);
  __privateGet(this, _writer).writeBox(newMoofBox);
  __privateGet(this, _writer).seek(endPos);
  for (let track of tracks) {
    track.finalizedChunks.push(track.currentChunk);
    __privateGet(this, _finalizedChunks).push(track.currentChunk);
    track.currentChunk = null;
  }
  if (flushStreamingWriter) {
    __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
  }
};
_maybeFlushStreamingTargetWriter = /* @__PURE__ */ new WeakSet();
maybeFlushStreamingTargetWriter_fn = function() {
  if (__privateGet(this, _writer) instanceof StreamTargetWriter) {
    __privateGet(this, _writer).flush();
  }
};
_ensureNotFinalized = /* @__PURE__ */ new WeakSet();
ensureNotFinalized_fn = function() {
  if (__privateGet(this, _finalized)) {
    throw new Error("Cannot add new video or audio chunks after the file has been finalized.");
  }
};

// ../frontend/src/packages/media-engine/muxer/mp4Muxer.ts
var MP4Box = void 0 || mp4box_all_exports;
var StreamingMP4Muxer = class {
  static async remux(options) {
    const {
      video,
      audio,
      sink,
      chunkSize = 512 * 1024,
      signal,
      onProgress
    } = options;
    const vDemux = MP4Box.createFile();
    const aDemux = MP4Box.createFile();
    let vReady = false;
    let aReady = false;
    let vInfo = null;
    let aInfo = null;
    let muxer = null;
    let firstVideoSample = true;
    let avcDescription = null;
    let bytesWritten = 0;
    const pendingWrites = [];
    const pendingVideoSamples = [];
    const pendingAudioSamples = [];
    let vSampleCount = 0;
    let aSampleCount = 0;
    let firstVideoPts = -1;
    let lastVideoPts = -1;
    let firstAudioPts = -1;
    let lastAudioPts = -1;
    let vActualTotal = video.totalBytes || null;
    let aActualTotal = audio.totalBytes || null;
    const processVideoSample = (s) => {
      vSampleCount++;
      const timestampUs = Math.round(s.cts / s.timescale * 1e6);
      const durationUs = Math.round(s.duration / s.timescale * 1e6);
      const compositionTimeOffsetUs = Math.round((s.cts - s.dts) / s.timescale * 1e6);
      if (firstVideoPts === -1) firstVideoPts = timestampUs;
      lastVideoPts = timestampUs + durationUs;
      const meta = firstVideoSample ? {
        decoderConfig: {
          codec: vInfo.tracks[0]?.codec || "avc1.4d401f",
          description: avcDescription || void 0,
          codedWidth: vInfo.tracks[0]?.video?.width,
          codedHeight: vInfo.tracks[0]?.video?.height
        }
      } : void 0;
      firstVideoSample = false;
      muxer.addVideoChunkRaw(
        s.data,
        s.is_sync ? "key" : "delta",
        timestampUs,
        durationUs,
        meta,
        compositionTimeOffsetUs
      );
    };
    const processAudioSample = (s) => {
      aSampleCount++;
      const timestampUs = Math.round(s.cts / s.timescale * 1e6);
      const durationUs = Math.round(s.duration / s.timescale * 1e6);
      if (firstAudioPts === -1) firstAudioPts = timestampUs;
      lastAudioPts = timestampUs + durationUs;
      muxer.addAudioChunkRaw(s.data, "key", timestampUs, durationUs);
    };
    vDemux.onReady = (info) => {
      vInfo = info;
      vReady = true;
      vDemux.setExtractionOptions(info.tracks[0].id, null, { nbSamples: 1e3 });
      vDemux.start();
      initMuxerIfReady();
    };
    aDemux.onReady = (info) => {
      aInfo = info;
      aReady = true;
      aDemux.setExtractionOptions(info.tracks[0].id, null, { nbSamples: 1e3 });
      aDemux.start();
      initMuxerIfReady();
    };
    const initMuxerIfReady = () => {
      if (muxer || !vReady || !aReady) return;
      const vTrack = vInfo.tracks[0];
      const aTrack = aInfo.tracks[0];
      try {
        const avcCBox2 = vDemux.moov.traks[0].mdia.minf.stbl.stsd.entries[0].avcC;
        const stream = new MP4Box.DataStream(void 0, 0, MP4Box.DataStream.BIG_ENDIAN);
        avcCBox2.write(stream);
        avcDescription = new Uint8Array(stream.buffer.slice(8));
      } catch {
        avcDescription = null;
      }
      muxer = new Muxer({
        target: new StreamTarget({
          onData: (dataChunk, position) => {
            const p = (async () => {
              await sink.write(dataChunk, position);
              bytesWritten += dataChunk.byteLength;
            })();
            pendingWrites.push(p);
          }
        }),
        video: {
          codec: "avc",
          width: vTrack.video?.width || 1280,
          height: vTrack.video?.height || 720
        },
        audio: {
          codec: "aac",
          numberOfChannels: aTrack.audio?.channel_count || 2,
          sampleRate: aTrack.audio?.sample_rate || 44100
        },
        fastStart: "fragmented",
        firstTimestampBehavior: "cross-track-offset"
      });
      while (pendingVideoSamples.length > 0) {
        processVideoSample(pendingVideoSamples.shift());
      }
      while (pendingAudioSamples.length > 0) {
        processAudioSample(pendingAudioSamples.shift());
      }
    };
    vDemux.onSamples = (id, user, samples) => {
      for (const s of samples) {
        if (!muxer) {
          pendingVideoSamples.push(s);
        } else {
          processVideoSample(s);
        }
      }
    };
    aDemux.onSamples = (id, user, samples) => {
      for (const s of samples) {
        if (!muxer) {
          pendingAudioSamples.push(s);
        } else {
          processAudioSample(s);
        }
      }
    };
    const fetchRange = async (url2, start2, end, headers = {}, isVideo = true) => {
      const safeHeaders = filterSafeBrowserHeaders(headers);
      const res = await fetch(url2, {
        headers: {
          ...safeHeaders,
          Range: `bytes=${start2}-${end}`
        },
        signal
      });
      if (res.status === 416) {
        return new Uint8Array(0);
      }
      if (res.status !== 206 && res.status !== 200) {
        throw new Error(`Upstream returned HTTP ${res.status}`);
      }
      const cr = res.headers.get("content-range");
      if (cr) {
        const match = cr.match(/\/(\d+)$/);
        if (match) {
          const totalFromHeader = parseInt(match[1], 10);
          if (isVideo) vActualTotal = totalFromHeader;
          else aActualTotal = totalFromHeader;
        }
      }
      const buffer = await res.arrayBuffer();
      return new Uint8Array(buffer);
    };
    const totalEst = (video.totalBytes || 10 * 1024 * 1024) + (audio.totalBytes || 2 * 1024 * 1024);
    let vOffset = 0;
    let aOffset = 0;
    let vDone = false;
    let aDone = false;
    const initSize = 256 * 1024;
    const [vHeader, aHeader] = await Promise.all([
      fetchRange(video.url, 0, initSize - 1, video.headers, true),
      fetchRange(audio.url, 0, initSize - 1, audio.headers, false)
    ]);
    const vBuf = vHeader.buffer.slice(vHeader.byteOffset, vHeader.byteOffset + vHeader.byteLength);
    vBuf.fileStart = 0;
    vDemux.appendBuffer(vBuf);
    vOffset = vHeader.byteLength;
    const aBuf = aHeader.buffer.slice(aHeader.byteOffset, aHeader.byteOffset + aHeader.byteLength);
    aBuf.fileStart = 0;
    aDemux.appendBuffer(aBuf);
    aOffset = aHeader.byteLength;
    initMuxerIfReady();
    while (!vDone || !aDone) {
      if (signal?.aborted) {
        throw new Error("Download aborted by user");
      }
      const tasks = [];
      if (!vDone) {
        const vEnd = vActualTotal && vOffset + chunkSize >= vActualTotal ? vActualTotal - 1 : vOffset + chunkSize - 1;
        tasks.push(
          fetchRange(video.url, vOffset, vEnd, video.headers, true).then((data) => {
            if (data.length === 0 || vActualTotal && vOffset >= vActualTotal) {
              vDone = true;
              return;
            }
            const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            buf.fileStart = vOffset;
            vDemux.appendBuffer(buf);
            vOffset += data.length;
            if (data.length < vEnd - vOffset + data.length + 1 && !vActualTotal) {
              vDone = true;
            }
            if (vActualTotal && vOffset >= vActualTotal) {
              vDone = true;
            }
          })
        );
      }
      if (!aDone) {
        const aEnd = aActualTotal && aOffset + chunkSize >= aActualTotal ? aActualTotal - 1 : aOffset + chunkSize - 1;
        tasks.push(
          fetchRange(audio.url, aOffset, aEnd, audio.headers, false).then((data) => {
            if (data.length === 0 || aActualTotal && aOffset >= aActualTotal) {
              aDone = true;
              return;
            }
            const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            buf.fileStart = aOffset;
            aDemux.appendBuffer(buf);
            aOffset += data.length;
            if (data.length < aEnd - aOffset + data.length + 1 && !aActualTotal) {
              aDone = true;
            }
            if (aActualTotal && aOffset >= aActualTotal) {
              aDone = true;
            }
          })
        );
      }
      await Promise.all(tasks);
      if (onProgress) {
        const currentBytes = vOffset + aOffset;
        const pct = Math.min(99, Math.round(currentBytes / totalEst * 100));
        onProgress({
          stage: "muxing",
          progressPercent: pct,
          downloadedBytes: currentBytes,
          totalBytes: totalEst,
          message: `Streaming & remuxing: ${pct}%`
        });
      }
    }
    vDemux.flush();
    aDemux.flush();
    if (muxer) {
      muxer.finalize();
    }
    await Promise.all(pendingWrites);
    if (bytesWritten === 0) {
      throw new Error("MEDIA_INTEGRITY: FAIL_EMPTY_STREAM (StreamingMP4Muxer wrote 0 bytes to sink)");
    }
    const videoDuration = firstVideoPts >= 0 ? (lastVideoPts - firstVideoPts) / 1e6 : 0;
    const audioDuration = firstAudioPts >= 0 ? (lastAudioPts - firstAudioPts) / 1e6 : 0;
    if (vSampleCount === 0 || aSampleCount === 0) {
      throw new Error(
        `MEDIA_INTEGRITY: FAIL_AV_SYNC (missing stream samples: video=${vSampleCount} frames, audio=${aSampleCount} samples)`
      );
    }
    const delta = Math.abs(videoDuration - audioDuration);
    if (Math.max(videoDuration, audioDuration) > 5 && delta > 3) {
      throw new Error(
        `MEDIA_INTEGRITY: FAIL_AV_SYNC (video: ${videoDuration.toFixed(2)}s [${vSampleCount} frames], audio: ${audioDuration.toFixed(2)}s [${aSampleCount} samples], delta: ${delta.toFixed(2)}s exceeds 3.0s threshold)`
      );
    }
    console.log(
      `[NEXUS MediaEngine] MEDIA_INTEGRITY: PASS (video: ${videoDuration.toFixed(3)}s [${vSampleCount} frames], audio: ${audioDuration.toFixed(3)}s [${aSampleCount} samples], delta: ${(delta * 1e3).toFixed(1)}ms)`
    );
    return bytesWritten;
  }
};

// ../frontend/node_modules/webm-muxer/build/webm-muxer.mjs
var __accessCheck2 = (obj, member, msg) => {
  if (!member.has(obj))
    throw TypeError("Cannot " + msg);
};
var __privateGet2 = (obj, member, getter) => {
  __accessCheck2(obj, member, "read from private field");
  return getter ? getter.call(obj) : member.get(obj);
};
var __privateAdd2 = (obj, member, value) => {
  if (member.has(obj))
    throw TypeError("Cannot add the same private member more than once");
  member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
};
var __privateSet2 = (obj, member, value, setter) => {
  __accessCheck2(obj, member, "write to private field");
  setter ? setter.call(obj, value) : member.set(obj, value);
  return value;
};
var __privateMethod2 = (obj, member, method) => {
  __accessCheck2(obj, member, "access private method");
  return method;
};
var EBMLFloat32 = class {
  constructor(value) {
    this.value = value;
  }
};
var EBMLFloat64 = class {
  constructor(value) {
    this.value = value;
  }
};
var measureUnsignedInt = (value) => {
  if (value < 1 << 8) {
    return 1;
  } else if (value < 1 << 16) {
    return 2;
  } else if (value < 1 << 24) {
    return 3;
  } else if (value < 2 ** 32) {
    return 4;
  } else if (value < 2 ** 40) {
    return 5;
  } else {
    return 6;
  }
};
var measureEBMLVarInt = (value) => {
  if (value < (1 << 7) - 1) {
    return 1;
  } else if (value < (1 << 14) - 1) {
    return 2;
  } else if (value < (1 << 21) - 1) {
    return 3;
  } else if (value < (1 << 28) - 1) {
    return 4;
  } else if (value < 2 ** 35 - 1) {
    return 5;
  } else if (value < 2 ** 42 - 1) {
    return 6;
  } else {
    throw new Error("EBML VINT size not supported " + value);
  }
};
var readBits = (bytes2, start2, end) => {
  let result = 0;
  for (let i = start2; i < end; i++) {
    let byteIndex = Math.floor(i / 8);
    let byte = bytes2[byteIndex];
    let bitIndex = 7 - (i & 7);
    let bit = (byte & 1 << bitIndex) >> bitIndex;
    result <<= 1;
    result |= bit;
  }
  return result;
};
var writeBits = (bytes2, start2, end, value) => {
  for (let i = start2; i < end; i++) {
    let byteIndex = Math.floor(i / 8);
    let byte = bytes2[byteIndex];
    let bitIndex = 7 - (i & 7);
    byte &= ~(1 << bitIndex);
    byte |= (value & 1 << end - i - 1) >> end - i - 1 << bitIndex;
    bytes2[byteIndex] = byte;
  }
};
var Target2 = class {
};
var ArrayBufferTarget2 = class extends Target2 {
  constructor() {
    super(...arguments);
    this.buffer = null;
  }
};
var StreamTarget2 = class extends Target2 {
  constructor(options) {
    super();
    this.options = options;
    if (typeof options !== "object") {
      throw new TypeError("StreamTarget requires an options object to be passed to its constructor.");
    }
    if (options.onData) {
      if (typeof options.onData !== "function") {
        throw new TypeError("options.onData, when provided, must be a function.");
      }
      if (options.onData.length < 2) {
        throw new TypeError(
          "options.onData, when provided, must be a function that takes in at least two arguments (data and position). Ignoring the position argument, which specifies the byte offset at which the data is to be written, can lead to broken outputs."
        );
      }
    }
    if (options.onHeader && typeof options.onHeader !== "function") {
      throw new TypeError("options.onHeader, when provided, must be a function.");
    }
    if (options.onCluster && typeof options.onCluster !== "function") {
      throw new TypeError("options.onCluster, when provided, must be a function.");
    }
    if (options.chunked !== void 0 && typeof options.chunked !== "boolean") {
      throw new TypeError("options.chunked, when provided, must be a boolean.");
    }
    if (options.chunkSize !== void 0 && (!Number.isInteger(options.chunkSize) || options.chunkSize < 1024)) {
      throw new TypeError("options.chunkSize, when provided, must be an integer and not smaller than 1024.");
    }
  }
};
var FileSystemWritableFileStreamTarget2 = class extends Target2 {
  constructor(stream, options) {
    super();
    this.stream = stream;
    this.options = options;
    if (!(stream instanceof FileSystemWritableFileStream)) {
      throw new TypeError("FileSystemWritableFileStreamTarget requires a FileSystemWritableFileStream instance.");
    }
    if (options !== void 0 && typeof options !== "object") {
      throw new TypeError("FileSystemWritableFileStreamTarget's options, when provided, must be an object.");
    }
    if (options) {
      if (options.chunkSize !== void 0 && (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0)) {
        throw new TypeError("options.chunkSize, when provided, must be a positive integer");
      }
    }
  }
};
var _helper2;
var _helperView2;
var _writeByte;
var writeByte_fn;
var _writeFloat32;
var writeFloat32_fn;
var _writeFloat64;
var writeFloat64_fn;
var _writeUnsignedInt;
var writeUnsignedInt_fn;
var _writeString;
var writeString_fn;
var Writer2 = class {
  constructor() {
    __privateAdd2(this, _writeByte);
    __privateAdd2(this, _writeFloat32);
    __privateAdd2(this, _writeFloat64);
    __privateAdd2(this, _writeUnsignedInt);
    __privateAdd2(this, _writeString);
    this.pos = 0;
    __privateAdd2(this, _helper2, new Uint8Array(8));
    __privateAdd2(this, _helperView2, new DataView(__privateGet2(this, _helper2).buffer));
    this.offsets = /* @__PURE__ */ new WeakMap();
    this.dataOffsets = /* @__PURE__ */ new WeakMap();
  }
  seek(newPos) {
    this.pos = newPos;
  }
  writeEBMLVarInt(value, width = measureEBMLVarInt(value)) {
    let pos = 0;
    switch (width) {
      case 1:
        __privateGet2(this, _helperView2).setUint8(pos++, 1 << 7 | value);
        break;
      case 2:
        __privateGet2(this, _helperView2).setUint8(pos++, 1 << 6 | value >> 8);
        __privateGet2(this, _helperView2).setUint8(pos++, value);
        break;
      case 3:
        __privateGet2(this, _helperView2).setUint8(pos++, 1 << 5 | value >> 16);
        __privateGet2(this, _helperView2).setUint8(pos++, value >> 8);
        __privateGet2(this, _helperView2).setUint8(pos++, value);
        break;
      case 4:
        __privateGet2(this, _helperView2).setUint8(pos++, 1 << 4 | value >> 24);
        __privateGet2(this, _helperView2).setUint8(pos++, value >> 16);
        __privateGet2(this, _helperView2).setUint8(pos++, value >> 8);
        __privateGet2(this, _helperView2).setUint8(pos++, value);
        break;
      case 5:
        __privateGet2(this, _helperView2).setUint8(pos++, 1 << 3 | value / 2 ** 32 & 7);
        __privateGet2(this, _helperView2).setUint8(pos++, value >> 24);
        __privateGet2(this, _helperView2).setUint8(pos++, value >> 16);
        __privateGet2(this, _helperView2).setUint8(pos++, value >> 8);
        __privateGet2(this, _helperView2).setUint8(pos++, value);
        break;
      case 6:
        __privateGet2(this, _helperView2).setUint8(pos++, 1 << 2 | value / 2 ** 40 & 3);
        __privateGet2(this, _helperView2).setUint8(pos++, value / 2 ** 32 | 0);
        __privateGet2(this, _helperView2).setUint8(pos++, value >> 24);
        __privateGet2(this, _helperView2).setUint8(pos++, value >> 16);
        __privateGet2(this, _helperView2).setUint8(pos++, value >> 8);
        __privateGet2(this, _helperView2).setUint8(pos++, value);
        break;
      default:
        throw new Error("Bad EBML VINT size " + width);
    }
    this.write(__privateGet2(this, _helper2).subarray(0, pos));
  }
  writeEBML(data) {
    if (data === null)
      return;
    if (data instanceof Uint8Array) {
      this.write(data);
    } else if (Array.isArray(data)) {
      for (let elem of data) {
        this.writeEBML(elem);
      }
    } else {
      this.offsets.set(data, this.pos);
      __privateMethod2(this, _writeUnsignedInt, writeUnsignedInt_fn).call(this, data.id);
      if (Array.isArray(data.data)) {
        let sizePos = this.pos;
        let sizeSize = data.size === -1 ? 1 : data.size ?? 4;
        if (data.size === -1) {
          __privateMethod2(this, _writeByte, writeByte_fn).call(this, 255);
        } else {
          this.seek(this.pos + sizeSize);
        }
        let startPos = this.pos;
        this.dataOffsets.set(data, startPos);
        this.writeEBML(data.data);
        if (data.size !== -1) {
          let size = this.pos - startPos;
          let endPos = this.pos;
          this.seek(sizePos);
          this.writeEBMLVarInt(size, sizeSize);
          this.seek(endPos);
        }
      } else if (typeof data.data === "number") {
        let size = data.size ?? measureUnsignedInt(data.data);
        this.writeEBMLVarInt(size);
        __privateMethod2(this, _writeUnsignedInt, writeUnsignedInt_fn).call(this, data.data, size);
      } else if (typeof data.data === "string") {
        this.writeEBMLVarInt(data.data.length);
        __privateMethod2(this, _writeString, writeString_fn).call(this, data.data);
      } else if (data.data instanceof Uint8Array) {
        this.writeEBMLVarInt(data.data.byteLength, data.size);
        this.write(data.data);
      } else if (data.data instanceof EBMLFloat32) {
        this.writeEBMLVarInt(4);
        __privateMethod2(this, _writeFloat32, writeFloat32_fn).call(this, data.data.value);
      } else if (data.data instanceof EBMLFloat64) {
        this.writeEBMLVarInt(8);
        __privateMethod2(this, _writeFloat64, writeFloat64_fn).call(this, data.data.value);
      }
    }
  }
};
_helper2 = /* @__PURE__ */ new WeakMap();
_helperView2 = /* @__PURE__ */ new WeakMap();
_writeByte = /* @__PURE__ */ new WeakSet();
writeByte_fn = function(value) {
  __privateGet2(this, _helperView2).setUint8(0, value);
  this.write(__privateGet2(this, _helper2).subarray(0, 1));
};
_writeFloat32 = /* @__PURE__ */ new WeakSet();
writeFloat32_fn = function(value) {
  __privateGet2(this, _helperView2).setFloat32(0, value, false);
  this.write(__privateGet2(this, _helper2).subarray(0, 4));
};
_writeFloat64 = /* @__PURE__ */ new WeakSet();
writeFloat64_fn = function(value) {
  __privateGet2(this, _helperView2).setFloat64(0, value, false);
  this.write(__privateGet2(this, _helper2));
};
_writeUnsignedInt = /* @__PURE__ */ new WeakSet();
writeUnsignedInt_fn = function(value, width = measureUnsignedInt(value)) {
  let pos = 0;
  switch (width) {
    case 6:
      __privateGet2(this, _helperView2).setUint8(pos++, value / 2 ** 40 | 0);
    case 5:
      __privateGet2(this, _helperView2).setUint8(pos++, value / 2 ** 32 | 0);
    case 4:
      __privateGet2(this, _helperView2).setUint8(pos++, value >> 24);
    case 3:
      __privateGet2(this, _helperView2).setUint8(pos++, value >> 16);
    case 2:
      __privateGet2(this, _helperView2).setUint8(pos++, value >> 8);
    case 1:
      __privateGet2(this, _helperView2).setUint8(pos++, value);
      break;
    default:
      throw new Error("Bad UINT size " + width);
  }
  this.write(__privateGet2(this, _helper2).subarray(0, pos));
};
_writeString = /* @__PURE__ */ new WeakSet();
writeString_fn = function(str) {
  this.write(new Uint8Array(str.split("").map((x) => x.charCodeAt(0))));
};
var _target3;
var _buffer2;
var _bytes2;
var _ensureSize2;
var ensureSize_fn2;
var ArrayBufferTargetWriter2 = class extends Writer2 {
  constructor(target) {
    super();
    __privateAdd2(this, _ensureSize2);
    __privateAdd2(this, _target3, void 0);
    __privateAdd2(this, _buffer2, new ArrayBuffer(2 ** 16));
    __privateAdd2(this, _bytes2, new Uint8Array(__privateGet2(this, _buffer2)));
    __privateSet2(this, _target3, target);
  }
  write(data) {
    __privateMethod2(this, _ensureSize2, ensureSize_fn2).call(this, this.pos + data.byteLength);
    __privateGet2(this, _bytes2).set(data, this.pos);
    this.pos += data.byteLength;
  }
  finalize() {
    __privateMethod2(this, _ensureSize2, ensureSize_fn2).call(this, this.pos);
    __privateGet2(this, _target3).buffer = __privateGet2(this, _buffer2).slice(0, this.pos);
  }
};
_target3 = /* @__PURE__ */ new WeakMap();
_buffer2 = /* @__PURE__ */ new WeakMap();
_bytes2 = /* @__PURE__ */ new WeakMap();
_ensureSize2 = /* @__PURE__ */ new WeakSet();
ensureSize_fn2 = function(size) {
  let newLength = __privateGet2(this, _buffer2).byteLength;
  while (newLength < size)
    newLength *= 2;
  if (newLength === __privateGet2(this, _buffer2).byteLength)
    return;
  let newBuffer = new ArrayBuffer(newLength);
  let newBytes = new Uint8Array(newBuffer);
  newBytes.set(__privateGet2(this, _bytes2), 0);
  __privateSet2(this, _buffer2, newBuffer);
  __privateSet2(this, _bytes2, newBytes);
};
var _trackingWrites;
var _trackedWrites;
var _trackedStart;
var _trackedEnd;
var BaseStreamTargetWriter = class extends Writer2 {
  constructor(target) {
    super();
    this.target = target;
    __privateAdd2(this, _trackingWrites, false);
    __privateAdd2(this, _trackedWrites, void 0);
    __privateAdd2(this, _trackedStart, void 0);
    __privateAdd2(this, _trackedEnd, void 0);
  }
  write(data) {
    if (!__privateGet2(this, _trackingWrites))
      return;
    let pos = this.pos;
    if (pos < __privateGet2(this, _trackedStart)) {
      if (pos + data.byteLength <= __privateGet2(this, _trackedStart))
        return;
      data = data.subarray(__privateGet2(this, _trackedStart) - pos);
      pos = 0;
    }
    let neededSize = pos + data.byteLength - __privateGet2(this, _trackedStart);
    let newLength = __privateGet2(this, _trackedWrites).byteLength;
    while (newLength < neededSize)
      newLength *= 2;
    if (newLength !== __privateGet2(this, _trackedWrites).byteLength) {
      let copy = new Uint8Array(newLength);
      copy.set(__privateGet2(this, _trackedWrites), 0);
      __privateSet2(this, _trackedWrites, copy);
    }
    __privateGet2(this, _trackedWrites).set(data, pos - __privateGet2(this, _trackedStart));
    __privateSet2(this, _trackedEnd, Math.max(__privateGet2(this, _trackedEnd), pos + data.byteLength));
  }
  startTrackingWrites() {
    __privateSet2(this, _trackingWrites, true);
    __privateSet2(this, _trackedWrites, new Uint8Array(2 ** 10));
    __privateSet2(this, _trackedStart, this.pos);
    __privateSet2(this, _trackedEnd, this.pos);
  }
  getTrackedWrites() {
    if (!__privateGet2(this, _trackingWrites)) {
      throw new Error("Can't get tracked writes since nothing was tracked.");
    }
    let slice = __privateGet2(this, _trackedWrites).subarray(0, __privateGet2(this, _trackedEnd) - __privateGet2(this, _trackedStart));
    let result = {
      data: slice,
      start: __privateGet2(this, _trackedStart),
      end: __privateGet2(this, _trackedEnd)
    };
    __privateSet2(this, _trackedWrites, void 0);
    __privateSet2(this, _trackingWrites, false);
    return result;
  }
};
_trackingWrites = /* @__PURE__ */ new WeakMap();
_trackedWrites = /* @__PURE__ */ new WeakMap();
_trackedStart = /* @__PURE__ */ new WeakMap();
_trackedEnd = /* @__PURE__ */ new WeakMap();
var DEFAULT_CHUNK_SIZE2 = 2 ** 24;
var MAX_CHUNKS_AT_ONCE2 = 2;
var _sections2;
var _lastFlushEnd;
var _ensureMonotonicity;
var _chunked2;
var _chunkSize2;
var _chunks2;
var _writeDataIntoChunks2;
var writeDataIntoChunks_fn2;
var _insertSectionIntoChunk2;
var insertSectionIntoChunk_fn2;
var _createChunk2;
var createChunk_fn2;
var _flushChunks2;
var flushChunks_fn2;
var StreamTargetWriter2 = class extends BaseStreamTargetWriter {
  constructor(target, ensureMonotonicity) {
    super(target);
    __privateAdd2(this, _writeDataIntoChunks2);
    __privateAdd2(this, _insertSectionIntoChunk2);
    __privateAdd2(this, _createChunk2);
    __privateAdd2(this, _flushChunks2);
    __privateAdd2(this, _sections2, []);
    __privateAdd2(this, _lastFlushEnd, 0);
    __privateAdd2(this, _ensureMonotonicity, void 0);
    __privateAdd2(this, _chunked2, void 0);
    __privateAdd2(this, _chunkSize2, void 0);
    __privateAdd2(this, _chunks2, []);
    __privateSet2(this, _ensureMonotonicity, ensureMonotonicity);
    __privateSet2(this, _chunked2, target.options?.chunked ?? false);
    __privateSet2(this, _chunkSize2, target.options?.chunkSize ?? DEFAULT_CHUNK_SIZE2);
  }
  write(data) {
    super.write(data);
    __privateGet2(this, _sections2).push({
      data: data.slice(),
      start: this.pos
    });
    this.pos += data.byteLength;
  }
  flush() {
    if (__privateGet2(this, _sections2).length === 0)
      return;
    let chunks = [];
    let sorted = [...__privateGet2(this, _sections2)].sort((a, b) => a.start - b.start);
    chunks.push({
      start: sorted[0].start,
      size: sorted[0].data.byteLength
    });
    for (let i = 1; i < sorted.length; i++) {
      let lastChunk = chunks[chunks.length - 1];
      let section = sorted[i];
      if (section.start <= lastChunk.start + lastChunk.size) {
        lastChunk.size = Math.max(lastChunk.size, section.start + section.data.byteLength - lastChunk.start);
      } else {
        chunks.push({
          start: section.start,
          size: section.data.byteLength
        });
      }
    }
    for (let chunk of chunks) {
      chunk.data = new Uint8Array(chunk.size);
      for (let section of __privateGet2(this, _sections2)) {
        if (chunk.start <= section.start && section.start < chunk.start + chunk.size) {
          chunk.data.set(section.data, section.start - chunk.start);
        }
      }
      if (__privateGet2(this, _chunked2)) {
        __privateMethod2(this, _writeDataIntoChunks2, writeDataIntoChunks_fn2).call(this, chunk.data, chunk.start);
        __privateMethod2(this, _flushChunks2, flushChunks_fn2).call(this);
      } else {
        if (__privateGet2(this, _ensureMonotonicity) && chunk.start < __privateGet2(this, _lastFlushEnd)) {
          throw new Error("Internal error: Monotonicity violation.");
        }
        this.target.options.onData?.(chunk.data, chunk.start);
        __privateSet2(this, _lastFlushEnd, chunk.start + chunk.data.byteLength);
      }
    }
    __privateGet2(this, _sections2).length = 0;
  }
  finalize() {
    if (__privateGet2(this, _chunked2)) {
      __privateMethod2(this, _flushChunks2, flushChunks_fn2).call(this, true);
    }
  }
};
_sections2 = /* @__PURE__ */ new WeakMap();
_lastFlushEnd = /* @__PURE__ */ new WeakMap();
_ensureMonotonicity = /* @__PURE__ */ new WeakMap();
_chunked2 = /* @__PURE__ */ new WeakMap();
_chunkSize2 = /* @__PURE__ */ new WeakMap();
_chunks2 = /* @__PURE__ */ new WeakMap();
_writeDataIntoChunks2 = /* @__PURE__ */ new WeakSet();
writeDataIntoChunks_fn2 = function(data, position) {
  let chunkIndex = __privateGet2(this, _chunks2).findIndex((x) => x.start <= position && position < x.start + __privateGet2(this, _chunkSize2));
  if (chunkIndex === -1)
    chunkIndex = __privateMethod2(this, _createChunk2, createChunk_fn2).call(this, position);
  let chunk = __privateGet2(this, _chunks2)[chunkIndex];
  let relativePosition = position - chunk.start;
  let toWrite = data.subarray(0, Math.min(__privateGet2(this, _chunkSize2) - relativePosition, data.byteLength));
  chunk.data.set(toWrite, relativePosition);
  let section = {
    start: relativePosition,
    end: relativePosition + toWrite.byteLength
  };
  __privateMethod2(this, _insertSectionIntoChunk2, insertSectionIntoChunk_fn2).call(this, chunk, section);
  if (chunk.written[0].start === 0 && chunk.written[0].end === __privateGet2(this, _chunkSize2)) {
    chunk.shouldFlush = true;
  }
  if (__privateGet2(this, _chunks2).length > MAX_CHUNKS_AT_ONCE2) {
    for (let i = 0; i < __privateGet2(this, _chunks2).length - 1; i++) {
      __privateGet2(this, _chunks2)[i].shouldFlush = true;
    }
    __privateMethod2(this, _flushChunks2, flushChunks_fn2).call(this);
  }
  if (toWrite.byteLength < data.byteLength) {
    __privateMethod2(this, _writeDataIntoChunks2, writeDataIntoChunks_fn2).call(this, data.subarray(toWrite.byteLength), position + toWrite.byteLength);
  }
};
_insertSectionIntoChunk2 = /* @__PURE__ */ new WeakSet();
insertSectionIntoChunk_fn2 = function(chunk, section) {
  let low = 0;
  let high = chunk.written.length - 1;
  let index = -1;
  while (low <= high) {
    let mid = Math.floor(low + (high - low + 1) / 2);
    if (chunk.written[mid].start <= section.start) {
      low = mid + 1;
      index = mid;
    } else {
      high = mid - 1;
    }
  }
  chunk.written.splice(index + 1, 0, section);
  if (index === -1 || chunk.written[index].end < section.start)
    index++;
  while (index < chunk.written.length - 1 && chunk.written[index].end >= chunk.written[index + 1].start) {
    chunk.written[index].end = Math.max(chunk.written[index].end, chunk.written[index + 1].end);
    chunk.written.splice(index + 1, 1);
  }
};
_createChunk2 = /* @__PURE__ */ new WeakSet();
createChunk_fn2 = function(includesPosition) {
  let start2 = Math.floor(includesPosition / __privateGet2(this, _chunkSize2)) * __privateGet2(this, _chunkSize2);
  let chunk = {
    start: start2,
    data: new Uint8Array(__privateGet2(this, _chunkSize2)),
    written: [],
    shouldFlush: false
  };
  __privateGet2(this, _chunks2).push(chunk);
  __privateGet2(this, _chunks2).sort((a, b) => a.start - b.start);
  return __privateGet2(this, _chunks2).indexOf(chunk);
};
_flushChunks2 = /* @__PURE__ */ new WeakSet();
flushChunks_fn2 = function(force = false) {
  for (let i = 0; i < __privateGet2(this, _chunks2).length; i++) {
    let chunk = __privateGet2(this, _chunks2)[i];
    if (!chunk.shouldFlush && !force)
      continue;
    for (let section of chunk.written) {
      if (__privateGet2(this, _ensureMonotonicity) && chunk.start + section.start < __privateGet2(this, _lastFlushEnd)) {
        throw new Error("Internal error: Monotonicity violation.");
      }
      this.target.options.onData?.(
        chunk.data.subarray(section.start, section.end),
        chunk.start + section.start
      );
      __privateSet2(this, _lastFlushEnd, chunk.start + section.end);
    }
    __privateGet2(this, _chunks2).splice(i--, 1);
  }
};
var FileSystemWritableFileStreamTargetWriter2 = class extends StreamTargetWriter2 {
  constructor(target, ensureMonotonicity) {
    super(new StreamTarget2({
      onData: (data, position) => target.stream.write({
        type: "write",
        data,
        position
      }),
      chunked: true,
      chunkSize: target.options?.chunkSize
    }), ensureMonotonicity);
  }
};
var VIDEO_TRACK_NUMBER = 1;
var AUDIO_TRACK_NUMBER = 2;
var SUBTITLE_TRACK_NUMBER = 3;
var VIDEO_TRACK_TYPE = 1;
var AUDIO_TRACK_TYPE = 2;
var SUBTITLE_TRACK_TYPE = 17;
var MAX_CHUNK_LENGTH_MS = 2 ** 15;
var CODEC_PRIVATE_MAX_SIZE = 2 ** 13;
var APP_NAME = "https://github.com/Vanilagy/webm-muxer";
var SEGMENT_SIZE_BYTES = 6;
var CLUSTER_SIZE_BYTES = 5;
var FIRST_TIMESTAMP_BEHAVIORS2 = ["strict", "offset", "permissive"];
var _options2;
var _writer2;
var _segment;
var _segmentInfo;
var _seekHead;
var _tracksElement;
var _segmentDuration;
var _colourElement;
var _videoCodecPrivate;
var _audioCodecPrivate;
var _subtitleCodecPrivate;
var _cues;
var _currentCluster;
var _currentClusterTimestamp;
var _duration;
var _videoChunkQueue;
var _audioChunkQueue;
var _subtitleChunkQueue;
var _firstVideoTimestamp;
var _firstAudioTimestamp;
var _lastVideoTimestamp;
var _lastAudioTimestamp;
var _lastSubtitleTimestamp;
var _colorSpace;
var _finalized2;
var _validateOptions2;
var validateOptions_fn2;
var _createFileHeader;
var createFileHeader_fn;
var _writeEBMLHeader;
var writeEBMLHeader_fn;
var _createCodecPrivatePlaceholders;
var createCodecPrivatePlaceholders_fn;
var _createColourElement;
var createColourElement_fn;
var _createSeekHead;
var createSeekHead_fn;
var _createSegmentInfo;
var createSegmentInfo_fn;
var _createTracks;
var createTracks_fn;
var _createSegment;
var createSegment_fn;
var _createCues;
var createCues_fn;
var _maybeFlushStreamingTargetWriter2;
var maybeFlushStreamingTargetWriter_fn2;
var _segmentDataOffset;
var segmentDataOffset_get;
var _writeVideoDecoderConfig;
var writeVideoDecoderConfig_fn;
var _fixVP9ColorSpace;
var fixVP9ColorSpace_fn;
var _writeSubtitleChunks;
var writeSubtitleChunks_fn;
var _createInternalChunk;
var createInternalChunk_fn;
var _validateTimestamp2;
var validateTimestamp_fn2;
var _writeBlock;
var writeBlock_fn;
var _createCodecPrivateElement;
var createCodecPrivateElement_fn;
var _writeCodecPrivate;
var writeCodecPrivate_fn;
var _createNewCluster;
var createNewCluster_fn;
var _finalizeCurrentCluster;
var finalizeCurrentCluster_fn;
var _ensureNotFinalized2;
var ensureNotFinalized_fn2;
var Muxer2 = class {
  constructor(options) {
    __privateAdd2(this, _validateOptions2);
    __privateAdd2(this, _createFileHeader);
    __privateAdd2(this, _writeEBMLHeader);
    __privateAdd2(this, _createCodecPrivatePlaceholders);
    __privateAdd2(this, _createColourElement);
    __privateAdd2(this, _createSeekHead);
    __privateAdd2(this, _createSegmentInfo);
    __privateAdd2(this, _createTracks);
    __privateAdd2(this, _createSegment);
    __privateAdd2(this, _createCues);
    __privateAdd2(this, _maybeFlushStreamingTargetWriter2);
    __privateAdd2(this, _segmentDataOffset);
    __privateAdd2(this, _writeVideoDecoderConfig);
    __privateAdd2(this, _fixVP9ColorSpace);
    __privateAdd2(this, _writeSubtitleChunks);
    __privateAdd2(this, _createInternalChunk);
    __privateAdd2(this, _validateTimestamp2);
    __privateAdd2(this, _writeBlock);
    __privateAdd2(this, _createCodecPrivateElement);
    __privateAdd2(this, _writeCodecPrivate);
    __privateAdd2(this, _createNewCluster);
    __privateAdd2(this, _finalizeCurrentCluster);
    __privateAdd2(this, _ensureNotFinalized2);
    __privateAdd2(this, _options2, void 0);
    __privateAdd2(this, _writer2, void 0);
    __privateAdd2(this, _segment, void 0);
    __privateAdd2(this, _segmentInfo, void 0);
    __privateAdd2(this, _seekHead, void 0);
    __privateAdd2(this, _tracksElement, void 0);
    __privateAdd2(this, _segmentDuration, void 0);
    __privateAdd2(this, _colourElement, void 0);
    __privateAdd2(this, _videoCodecPrivate, void 0);
    __privateAdd2(this, _audioCodecPrivate, void 0);
    __privateAdd2(this, _subtitleCodecPrivate, void 0);
    __privateAdd2(this, _cues, void 0);
    __privateAdd2(this, _currentCluster, void 0);
    __privateAdd2(this, _currentClusterTimestamp, void 0);
    __privateAdd2(this, _duration, 0);
    __privateAdd2(this, _videoChunkQueue, []);
    __privateAdd2(this, _audioChunkQueue, []);
    __privateAdd2(this, _subtitleChunkQueue, []);
    __privateAdd2(this, _firstVideoTimestamp, void 0);
    __privateAdd2(this, _firstAudioTimestamp, void 0);
    __privateAdd2(this, _lastVideoTimestamp, -1);
    __privateAdd2(this, _lastAudioTimestamp, -1);
    __privateAdd2(this, _lastSubtitleTimestamp, -1);
    __privateAdd2(this, _colorSpace, void 0);
    __privateAdd2(this, _finalized2, false);
    __privateMethod2(this, _validateOptions2, validateOptions_fn2).call(this, options);
    __privateSet2(this, _options2, {
      type: "webm",
      firstTimestampBehavior: "strict",
      ...options
    });
    this.target = options.target;
    let ensureMonotonicity = !!__privateGet2(this, _options2).streaming;
    if (options.target instanceof ArrayBufferTarget2) {
      __privateSet2(this, _writer2, new ArrayBufferTargetWriter2(options.target));
    } else if (options.target instanceof StreamTarget2) {
      __privateSet2(this, _writer2, new StreamTargetWriter2(options.target, ensureMonotonicity));
    } else if (options.target instanceof FileSystemWritableFileStreamTarget2) {
      __privateSet2(this, _writer2, new FileSystemWritableFileStreamTargetWriter2(options.target, ensureMonotonicity));
    } else {
      throw new Error(`Invalid target: ${options.target}`);
    }
    __privateMethod2(this, _createFileHeader, createFileHeader_fn).call(this);
  }
  addVideoChunk(chunk, meta, timestamp) {
    if (!(chunk instanceof EncodedVideoChunk)) {
      throw new TypeError("addVideoChunk's first argument (chunk) must be of type EncodedVideoChunk.");
    }
    if (meta && typeof meta !== "object") {
      throw new TypeError("addVideoChunk's second argument (meta), when provided, must be an object.");
    }
    if (timestamp !== void 0 && (!Number.isFinite(timestamp) || timestamp < 0)) {
      throw new TypeError(
        "addVideoChunk's third argument (timestamp), when provided, must be a non-negative real number."
      );
    }
    let data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.addVideoChunkRaw(data, chunk.type, timestamp ?? chunk.timestamp, meta);
  }
  addVideoChunkRaw(data, type, timestamp, meta) {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError("addVideoChunkRaw's first argument (data) must be an instance of Uint8Array.");
    }
    if (type !== "key" && type !== "delta") {
      throw new TypeError("addVideoChunkRaw's second argument (type) must be either 'key' or 'delta'.");
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new TypeError("addVideoChunkRaw's third argument (timestamp) must be a non-negative real number.");
    }
    if (meta && typeof meta !== "object") {
      throw new TypeError("addVideoChunkRaw's fourth argument (meta), when provided, must be an object.");
    }
    __privateMethod2(this, _ensureNotFinalized2, ensureNotFinalized_fn2).call(this);
    if (!__privateGet2(this, _options2).video)
      throw new Error("No video track declared.");
    if (__privateGet2(this, _firstVideoTimestamp) === void 0)
      __privateSet2(this, _firstVideoTimestamp, timestamp);
    if (meta)
      __privateMethod2(this, _writeVideoDecoderConfig, writeVideoDecoderConfig_fn).call(this, meta);
    let videoChunk = __privateMethod2(this, _createInternalChunk, createInternalChunk_fn).call(this, data, type, timestamp, VIDEO_TRACK_NUMBER);
    if (__privateGet2(this, _options2).video.codec === "V_VP9")
      __privateMethod2(this, _fixVP9ColorSpace, fixVP9ColorSpace_fn).call(this, videoChunk);
    __privateSet2(this, _lastVideoTimestamp, videoChunk.timestamp);
    while (__privateGet2(this, _audioChunkQueue).length > 0 && __privateGet2(this, _audioChunkQueue)[0].timestamp <= videoChunk.timestamp) {
      let audioChunk = __privateGet2(this, _audioChunkQueue).shift();
      __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, audioChunk, false);
    }
    if (!__privateGet2(this, _options2).audio || videoChunk.timestamp <= __privateGet2(this, _lastAudioTimestamp)) {
      __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, videoChunk, true);
    } else {
      __privateGet2(this, _videoChunkQueue).push(videoChunk);
    }
    __privateMethod2(this, _writeSubtitleChunks, writeSubtitleChunks_fn).call(this);
    __privateMethod2(this, _maybeFlushStreamingTargetWriter2, maybeFlushStreamingTargetWriter_fn2).call(this);
  }
  addAudioChunk(chunk, meta, timestamp) {
    if (!(chunk instanceof EncodedAudioChunk)) {
      throw new TypeError("addAudioChunk's first argument (chunk) must be of type EncodedAudioChunk.");
    }
    if (meta && typeof meta !== "object") {
      throw new TypeError("addAudioChunk's second argument (meta), when provided, must be an object.");
    }
    if (timestamp !== void 0 && (!Number.isFinite(timestamp) || timestamp < 0)) {
      throw new TypeError(
        "addAudioChunk's third argument (timestamp), when provided, must be a non-negative real number."
      );
    }
    let data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.addAudioChunkRaw(data, chunk.type, timestamp ?? chunk.timestamp, meta);
  }
  addAudioChunkRaw(data, type, timestamp, meta) {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError("addAudioChunkRaw's first argument (data) must be an instance of Uint8Array.");
    }
    if (type !== "key" && type !== "delta") {
      throw new TypeError("addAudioChunkRaw's second argument (type) must be either 'key' or 'delta'.");
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new TypeError("addAudioChunkRaw's third argument (timestamp) must be a non-negative real number.");
    }
    if (meta && typeof meta !== "object") {
      throw new TypeError("addAudioChunkRaw's fourth argument (meta), when provided, must be an object.");
    }
    __privateMethod2(this, _ensureNotFinalized2, ensureNotFinalized_fn2).call(this);
    if (!__privateGet2(this, _options2).audio)
      throw new Error("No audio track declared.");
    if (__privateGet2(this, _firstAudioTimestamp) === void 0)
      __privateSet2(this, _firstAudioTimestamp, timestamp);
    if (meta?.decoderConfig) {
      if (__privateGet2(this, _options2).streaming) {
        __privateSet2(this, _audioCodecPrivate, __privateMethod2(this, _createCodecPrivateElement, createCodecPrivateElement_fn).call(this, meta.decoderConfig.description));
      } else {
        __privateMethod2(this, _writeCodecPrivate, writeCodecPrivate_fn).call(this, __privateGet2(this, _audioCodecPrivate), meta.decoderConfig.description);
      }
    }
    let audioChunk = __privateMethod2(this, _createInternalChunk, createInternalChunk_fn).call(this, data, type, timestamp, AUDIO_TRACK_NUMBER);
    __privateSet2(this, _lastAudioTimestamp, audioChunk.timestamp);
    while (__privateGet2(this, _videoChunkQueue).length > 0 && __privateGet2(this, _videoChunkQueue)[0].timestamp <= audioChunk.timestamp) {
      let videoChunk = __privateGet2(this, _videoChunkQueue).shift();
      __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, videoChunk, true);
    }
    if (!__privateGet2(this, _options2).video || audioChunk.timestamp <= __privateGet2(this, _lastVideoTimestamp)) {
      __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, audioChunk, !__privateGet2(this, _options2).video);
    } else {
      __privateGet2(this, _audioChunkQueue).push(audioChunk);
    }
    __privateMethod2(this, _writeSubtitleChunks, writeSubtitleChunks_fn).call(this);
    __privateMethod2(this, _maybeFlushStreamingTargetWriter2, maybeFlushStreamingTargetWriter_fn2).call(this);
  }
  addSubtitleChunk(chunk, meta, timestamp) {
    if (typeof chunk !== "object" || !chunk) {
      throw new TypeError("addSubtitleChunk's first argument (chunk) must be an object.");
    } else {
      if (!(chunk.body instanceof Uint8Array)) {
        throw new TypeError("body must be an instance of Uint8Array.");
      }
      if (!Number.isFinite(chunk.timestamp) || chunk.timestamp < 0) {
        throw new TypeError("timestamp must be a non-negative real number.");
      }
      if (!Number.isFinite(chunk.duration) || chunk.duration < 0) {
        throw new TypeError("duration must be a non-negative real number.");
      }
      if (chunk.additions && !(chunk.additions instanceof Uint8Array)) {
        throw new TypeError("additions, when present, must be an instance of Uint8Array.");
      }
    }
    if (typeof meta !== "object") {
      throw new TypeError("addSubtitleChunk's second argument (meta) must be an object.");
    }
    __privateMethod2(this, _ensureNotFinalized2, ensureNotFinalized_fn2).call(this);
    if (!__privateGet2(this, _options2).subtitles)
      throw new Error("No subtitle track declared.");
    if (meta?.decoderConfig) {
      if (__privateGet2(this, _options2).streaming) {
        __privateSet2(this, _subtitleCodecPrivate, __privateMethod2(this, _createCodecPrivateElement, createCodecPrivateElement_fn).call(this, meta.decoderConfig.description));
      } else {
        __privateMethod2(this, _writeCodecPrivate, writeCodecPrivate_fn).call(this, __privateGet2(this, _subtitleCodecPrivate), meta.decoderConfig.description);
      }
    }
    let subtitleChunk = __privateMethod2(this, _createInternalChunk, createInternalChunk_fn).call(this, chunk.body, "key", timestamp ?? chunk.timestamp, SUBTITLE_TRACK_NUMBER, chunk.duration, chunk.additions);
    __privateSet2(this, _lastSubtitleTimestamp, subtitleChunk.timestamp);
    __privateGet2(this, _subtitleChunkQueue).push(subtitleChunk);
    __privateMethod2(this, _writeSubtitleChunks, writeSubtitleChunks_fn).call(this);
    __privateMethod2(this, _maybeFlushStreamingTargetWriter2, maybeFlushStreamingTargetWriter_fn2).call(this);
  }
  finalize() {
    if (__privateGet2(this, _finalized2)) {
      throw new Error("Cannot finalize a muxer more than once.");
    }
    while (__privateGet2(this, _videoChunkQueue).length > 0)
      __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, __privateGet2(this, _videoChunkQueue).shift(), true);
    while (__privateGet2(this, _audioChunkQueue).length > 0)
      __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, __privateGet2(this, _audioChunkQueue).shift(), true);
    while (__privateGet2(this, _subtitleChunkQueue).length > 0 && __privateGet2(this, _subtitleChunkQueue)[0].timestamp <= __privateGet2(this, _duration)) {
      __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, __privateGet2(this, _subtitleChunkQueue).shift(), false);
    }
    if (__privateGet2(this, _currentCluster)) {
      __privateMethod2(this, _finalizeCurrentCluster, finalizeCurrentCluster_fn).call(this);
    }
    __privateGet2(this, _writer2).writeEBML(__privateGet2(this, _cues));
    if (!__privateGet2(this, _options2).streaming) {
      let endPos = __privateGet2(this, _writer2).pos;
      let segmentSize = __privateGet2(this, _writer2).pos - __privateGet2(this, _segmentDataOffset, segmentDataOffset_get);
      __privateGet2(this, _writer2).seek(__privateGet2(this, _writer2).offsets.get(__privateGet2(this, _segment)) + 4);
      __privateGet2(this, _writer2).writeEBMLVarInt(segmentSize, SEGMENT_SIZE_BYTES);
      __privateGet2(this, _segmentDuration).data = new EBMLFloat64(__privateGet2(this, _duration));
      __privateGet2(this, _writer2).seek(__privateGet2(this, _writer2).offsets.get(__privateGet2(this, _segmentDuration)));
      __privateGet2(this, _writer2).writeEBML(__privateGet2(this, _segmentDuration));
      __privateGet2(this, _seekHead).data[0].data[1].data = __privateGet2(this, _writer2).offsets.get(__privateGet2(this, _cues)) - __privateGet2(this, _segmentDataOffset, segmentDataOffset_get);
      __privateGet2(this, _seekHead).data[1].data[1].data = __privateGet2(this, _writer2).offsets.get(__privateGet2(this, _segmentInfo)) - __privateGet2(this, _segmentDataOffset, segmentDataOffset_get);
      __privateGet2(this, _seekHead).data[2].data[1].data = __privateGet2(this, _writer2).offsets.get(__privateGet2(this, _tracksElement)) - __privateGet2(this, _segmentDataOffset, segmentDataOffset_get);
      __privateGet2(this, _writer2).seek(__privateGet2(this, _writer2).offsets.get(__privateGet2(this, _seekHead)));
      __privateGet2(this, _writer2).writeEBML(__privateGet2(this, _seekHead));
      __privateGet2(this, _writer2).seek(endPos);
    }
    __privateMethod2(this, _maybeFlushStreamingTargetWriter2, maybeFlushStreamingTargetWriter_fn2).call(this);
    __privateGet2(this, _writer2).finalize();
    __privateSet2(this, _finalized2, true);
  }
};
_options2 = /* @__PURE__ */ new WeakMap();
_writer2 = /* @__PURE__ */ new WeakMap();
_segment = /* @__PURE__ */ new WeakMap();
_segmentInfo = /* @__PURE__ */ new WeakMap();
_seekHead = /* @__PURE__ */ new WeakMap();
_tracksElement = /* @__PURE__ */ new WeakMap();
_segmentDuration = /* @__PURE__ */ new WeakMap();
_colourElement = /* @__PURE__ */ new WeakMap();
_videoCodecPrivate = /* @__PURE__ */ new WeakMap();
_audioCodecPrivate = /* @__PURE__ */ new WeakMap();
_subtitleCodecPrivate = /* @__PURE__ */ new WeakMap();
_cues = /* @__PURE__ */ new WeakMap();
_currentCluster = /* @__PURE__ */ new WeakMap();
_currentClusterTimestamp = /* @__PURE__ */ new WeakMap();
_duration = /* @__PURE__ */ new WeakMap();
_videoChunkQueue = /* @__PURE__ */ new WeakMap();
_audioChunkQueue = /* @__PURE__ */ new WeakMap();
_subtitleChunkQueue = /* @__PURE__ */ new WeakMap();
_firstVideoTimestamp = /* @__PURE__ */ new WeakMap();
_firstAudioTimestamp = /* @__PURE__ */ new WeakMap();
_lastVideoTimestamp = /* @__PURE__ */ new WeakMap();
_lastAudioTimestamp = /* @__PURE__ */ new WeakMap();
_lastSubtitleTimestamp = /* @__PURE__ */ new WeakMap();
_colorSpace = /* @__PURE__ */ new WeakMap();
_finalized2 = /* @__PURE__ */ new WeakMap();
_validateOptions2 = /* @__PURE__ */ new WeakSet();
validateOptions_fn2 = function(options) {
  if (typeof options !== "object") {
    throw new TypeError("The muxer requires an options object to be passed to its constructor.");
  }
  if (!(options.target instanceof Target2)) {
    throw new TypeError("The target must be provided and an instance of Target.");
  }
  if (options.video) {
    if (typeof options.video.codec !== "string") {
      throw new TypeError(`Invalid video codec: ${options.video.codec}. Must be a string.`);
    }
    if (!Number.isInteger(options.video.width) || options.video.width <= 0) {
      throw new TypeError(`Invalid video width: ${options.video.width}. Must be a positive integer.`);
    }
    if (!Number.isInteger(options.video.height) || options.video.height <= 0) {
      throw new TypeError(`Invalid video height: ${options.video.height}. Must be a positive integer.`);
    }
    if (options.video.frameRate !== void 0) {
      if (!Number.isFinite(options.video.frameRate) || options.video.frameRate <= 0) {
        throw new TypeError(
          `Invalid video frame rate: ${options.video.frameRate}. Must be a positive number.`
        );
      }
    }
    if (options.video.alpha !== void 0 && typeof options.video.alpha !== "boolean") {
      throw new TypeError(`Invalid video alpha: ${options.video.alpha}. Must be a boolean.`);
    }
  }
  if (options.audio) {
    if (typeof options.audio.codec !== "string") {
      throw new TypeError(`Invalid audio codec: ${options.audio.codec}. Must be a string.`);
    }
    if (!Number.isInteger(options.audio.numberOfChannels) || options.audio.numberOfChannels <= 0) {
      throw new TypeError(
        `Invalid number of audio channels: ${options.audio.numberOfChannels}. Must be a positive integer.`
      );
    }
    if (!Number.isInteger(options.audio.sampleRate) || options.audio.sampleRate <= 0) {
      throw new TypeError(
        `Invalid audio sample rate: ${options.audio.sampleRate}. Must be a positive integer.`
      );
    }
    if (options.audio.bitDepth !== void 0) {
      if (!Number.isInteger(options.audio.bitDepth) || options.audio.bitDepth <= 0) {
        throw new TypeError(
          `Invalid audio bit depth: ${options.audio.bitDepth}. Must be a positive integer.`
        );
      }
    }
  }
  if (options.subtitles) {
    if (typeof options.subtitles.codec !== "string") {
      throw new TypeError(`Invalid subtitles codec: ${options.subtitles.codec}. Must be a string.`);
    }
  }
  if (options.type !== void 0 && !["webm", "matroska"].includes(options.type)) {
    throw new TypeError(`Invalid type: ${options.type}. Must be 'webm' or 'matroska'.`);
  }
  if (options.firstTimestampBehavior && !FIRST_TIMESTAMP_BEHAVIORS2.includes(options.firstTimestampBehavior)) {
    throw new TypeError(`Invalid first timestamp behavior: ${options.firstTimestampBehavior}`);
  }
  if (options.streaming !== void 0 && typeof options.streaming !== "boolean") {
    throw new TypeError(`Invalid streaming option: ${options.streaming}. Must be a boolean.`);
  }
};
_createFileHeader = /* @__PURE__ */ new WeakSet();
createFileHeader_fn = function() {
  if (__privateGet2(this, _writer2) instanceof BaseStreamTargetWriter && __privateGet2(this, _writer2).target.options.onHeader) {
    __privateGet2(this, _writer2).startTrackingWrites();
  }
  __privateMethod2(this, _writeEBMLHeader, writeEBMLHeader_fn).call(this);
  if (!__privateGet2(this, _options2).streaming) {
    __privateMethod2(this, _createSeekHead, createSeekHead_fn).call(this);
  }
  __privateMethod2(this, _createSegmentInfo, createSegmentInfo_fn).call(this);
  __privateMethod2(this, _createCodecPrivatePlaceholders, createCodecPrivatePlaceholders_fn).call(this);
  __privateMethod2(this, _createColourElement, createColourElement_fn).call(this);
  if (!__privateGet2(this, _options2).streaming) {
    __privateMethod2(this, _createTracks, createTracks_fn).call(this);
    __privateMethod2(this, _createSegment, createSegment_fn).call(this);
  } else {
  }
  __privateMethod2(this, _createCues, createCues_fn).call(this);
  __privateMethod2(this, _maybeFlushStreamingTargetWriter2, maybeFlushStreamingTargetWriter_fn2).call(this);
};
_writeEBMLHeader = /* @__PURE__ */ new WeakSet();
writeEBMLHeader_fn = function() {
  let ebmlHeader = { id: 440786851, data: [
    { id: 17030, data: 1 },
    { id: 17143, data: 1 },
    { id: 17138, data: 4 },
    { id: 17139, data: 8 },
    { id: 17026, data: __privateGet2(this, _options2).type ?? "webm" },
    { id: 17031, data: 2 },
    { id: 17029, data: 2 }
  ] };
  __privateGet2(this, _writer2).writeEBML(ebmlHeader);
};
_createCodecPrivatePlaceholders = /* @__PURE__ */ new WeakSet();
createCodecPrivatePlaceholders_fn = function() {
  __privateSet2(this, _videoCodecPrivate, { id: 236, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) });
  __privateSet2(this, _audioCodecPrivate, { id: 236, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) });
  __privateSet2(this, _subtitleCodecPrivate, { id: 236, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) });
};
_createColourElement = /* @__PURE__ */ new WeakSet();
createColourElement_fn = function() {
  __privateSet2(this, _colourElement, { id: 21936, data: [
    { id: 21937, data: 2 },
    { id: 21946, data: 2 },
    { id: 21947, data: 2 },
    { id: 21945, data: 0 }
  ] });
};
_createSeekHead = /* @__PURE__ */ new WeakSet();
createSeekHead_fn = function() {
  const kaxCues = new Uint8Array([28, 83, 187, 107]);
  const kaxInfo = new Uint8Array([21, 73, 169, 102]);
  const kaxTracks = new Uint8Array([22, 84, 174, 107]);
  let seekHead = { id: 290298740, data: [
    { id: 19899, data: [
      { id: 21419, data: kaxCues },
      { id: 21420, size: 5, data: 0 }
    ] },
    { id: 19899, data: [
      { id: 21419, data: kaxInfo },
      { id: 21420, size: 5, data: 0 }
    ] },
    { id: 19899, data: [
      { id: 21419, data: kaxTracks },
      { id: 21420, size: 5, data: 0 }
    ] }
  ] };
  __privateSet2(this, _seekHead, seekHead);
};
_createSegmentInfo = /* @__PURE__ */ new WeakSet();
createSegmentInfo_fn = function() {
  let segmentDuration = { id: 17545, data: new EBMLFloat64(0) };
  __privateSet2(this, _segmentDuration, segmentDuration);
  let segmentInfo = { id: 357149030, data: [
    { id: 2807729, data: 1e6 },
    { id: 19840, data: APP_NAME },
    { id: 22337, data: APP_NAME },
    !__privateGet2(this, _options2).streaming ? segmentDuration : null
  ] };
  __privateSet2(this, _segmentInfo, segmentInfo);
};
_createTracks = /* @__PURE__ */ new WeakSet();
createTracks_fn = function() {
  let tracksElement = { id: 374648427, data: [] };
  __privateSet2(this, _tracksElement, tracksElement);
  if (__privateGet2(this, _options2).video) {
    tracksElement.data.push({ id: 174, data: [
      { id: 215, data: VIDEO_TRACK_NUMBER },
      { id: 29637, data: VIDEO_TRACK_NUMBER },
      { id: 131, data: VIDEO_TRACK_TYPE },
      { id: 134, data: __privateGet2(this, _options2).video.codec },
      __privateGet2(this, _videoCodecPrivate),
      __privateGet2(this, _options2).video.frameRate ? { id: 2352003, data: 1e9 / __privateGet2(this, _options2).video.frameRate } : null,
      { id: 224, data: [
        { id: 176, data: __privateGet2(this, _options2).video.width },
        { id: 186, data: __privateGet2(this, _options2).video.height },
        __privateGet2(this, _options2).video.alpha ? { id: 21440, data: 1 } : null,
        __privateGet2(this, _colourElement)
      ] }
    ] });
  }
  if (__privateGet2(this, _options2).audio) {
    __privateSet2(this, _audioCodecPrivate, __privateGet2(this, _options2).streaming ? __privateGet2(this, _audioCodecPrivate) || null : { id: 236, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) });
    tracksElement.data.push({ id: 174, data: [
      { id: 215, data: AUDIO_TRACK_NUMBER },
      { id: 29637, data: AUDIO_TRACK_NUMBER },
      { id: 131, data: AUDIO_TRACK_TYPE },
      { id: 134, data: __privateGet2(this, _options2).audio.codec },
      __privateGet2(this, _audioCodecPrivate),
      { id: 225, data: [
        { id: 181, data: new EBMLFloat32(__privateGet2(this, _options2).audio.sampleRate) },
        { id: 159, data: __privateGet2(this, _options2).audio.numberOfChannels },
        __privateGet2(this, _options2).audio.bitDepth ? { id: 25188, data: __privateGet2(this, _options2).audio.bitDepth } : null
      ] }
    ] });
  }
  if (__privateGet2(this, _options2).subtitles) {
    tracksElement.data.push({ id: 174, data: [
      { id: 215, data: SUBTITLE_TRACK_NUMBER },
      { id: 29637, data: SUBTITLE_TRACK_NUMBER },
      { id: 131, data: SUBTITLE_TRACK_TYPE },
      { id: 134, data: __privateGet2(this, _options2).subtitles.codec },
      __privateGet2(this, _subtitleCodecPrivate)
    ] });
  }
};
_createSegment = /* @__PURE__ */ new WeakSet();
createSegment_fn = function() {
  let segment = {
    id: 408125543,
    size: __privateGet2(this, _options2).streaming ? -1 : SEGMENT_SIZE_BYTES,
    data: [
      !__privateGet2(this, _options2).streaming ? __privateGet2(this, _seekHead) : null,
      __privateGet2(this, _segmentInfo),
      __privateGet2(this, _tracksElement)
    ]
  };
  __privateSet2(this, _segment, segment);
  __privateGet2(this, _writer2).writeEBML(segment);
  if (__privateGet2(this, _writer2) instanceof BaseStreamTargetWriter && __privateGet2(this, _writer2).target.options.onHeader) {
    let { data, start: start2 } = __privateGet2(this, _writer2).getTrackedWrites();
    __privateGet2(this, _writer2).target.options.onHeader(data, start2);
  }
};
_createCues = /* @__PURE__ */ new WeakSet();
createCues_fn = function() {
  __privateSet2(this, _cues, { id: 475249515, data: [] });
};
_maybeFlushStreamingTargetWriter2 = /* @__PURE__ */ new WeakSet();
maybeFlushStreamingTargetWriter_fn2 = function() {
  if (__privateGet2(this, _writer2) instanceof StreamTargetWriter2) {
    __privateGet2(this, _writer2).flush();
  }
};
_segmentDataOffset = /* @__PURE__ */ new WeakSet();
segmentDataOffset_get = function() {
  return __privateGet2(this, _writer2).dataOffsets.get(__privateGet2(this, _segment));
};
_writeVideoDecoderConfig = /* @__PURE__ */ new WeakSet();
writeVideoDecoderConfig_fn = function(meta) {
  if (!meta.decoderConfig)
    return;
  if (meta.decoderConfig.colorSpace) {
    let colorSpace = meta.decoderConfig.colorSpace;
    __privateSet2(this, _colorSpace, colorSpace);
    __privateGet2(this, _colourElement).data = [
      { id: 21937, data: {
        "rgb": 1,
        "bt709": 1,
        "bt470bg": 5,
        "smpte170m": 6
      }[colorSpace.matrix] },
      { id: 21946, data: {
        "bt709": 1,
        "smpte170m": 6,
        "iec61966-2-1": 13
      }[colorSpace.transfer] },
      { id: 21947, data: {
        "bt709": 1,
        "bt470bg": 5,
        "smpte170m": 6
      }[colorSpace.primaries] },
      { id: 21945, data: [1, 2][Number(colorSpace.fullRange)] }
    ];
    if (!__privateGet2(this, _options2).streaming) {
      let endPos = __privateGet2(this, _writer2).pos;
      __privateGet2(this, _writer2).seek(__privateGet2(this, _writer2).offsets.get(__privateGet2(this, _colourElement)));
      __privateGet2(this, _writer2).writeEBML(__privateGet2(this, _colourElement));
      __privateGet2(this, _writer2).seek(endPos);
    }
  }
  if (meta.decoderConfig.description) {
    if (__privateGet2(this, _options2).streaming) {
      __privateSet2(this, _videoCodecPrivate, __privateMethod2(this, _createCodecPrivateElement, createCodecPrivateElement_fn).call(this, meta.decoderConfig.description));
    } else {
      __privateMethod2(this, _writeCodecPrivate, writeCodecPrivate_fn).call(this, __privateGet2(this, _videoCodecPrivate), meta.decoderConfig.description);
    }
  }
};
_fixVP9ColorSpace = /* @__PURE__ */ new WeakSet();
fixVP9ColorSpace_fn = function(chunk) {
  if (chunk.type !== "key")
    return;
  if (!__privateGet2(this, _colorSpace))
    return;
  let i = 0;
  if (readBits(chunk.data, 0, 2) !== 2)
    return;
  i += 2;
  let profile = (readBits(chunk.data, i + 1, i + 2) << 1) + readBits(chunk.data, i + 0, i + 1);
  i += 2;
  if (profile === 3)
    i++;
  let showExistingFrame = readBits(chunk.data, i + 0, i + 1);
  i++;
  if (showExistingFrame)
    return;
  let frameType = readBits(chunk.data, i + 0, i + 1);
  i++;
  if (frameType !== 0)
    return;
  i += 2;
  let syncCode = readBits(chunk.data, i + 0, i + 24);
  i += 24;
  if (syncCode !== 4817730)
    return;
  if (profile >= 2)
    i++;
  let colorSpaceID = {
    "rgb": 7,
    "bt709": 2,
    "bt470bg": 1,
    "smpte170m": 3
  }[__privateGet2(this, _colorSpace).matrix];
  writeBits(chunk.data, i + 0, i + 3, colorSpaceID);
};
_writeSubtitleChunks = /* @__PURE__ */ new WeakSet();
writeSubtitleChunks_fn = function() {
  let lastWrittenMediaTimestamp = Math.min(
    __privateGet2(this, _options2).video ? __privateGet2(this, _lastVideoTimestamp) : Infinity,
    __privateGet2(this, _options2).audio ? __privateGet2(this, _lastAudioTimestamp) : Infinity
  );
  let queue = __privateGet2(this, _subtitleChunkQueue);
  while (queue.length > 0 && queue[0].timestamp <= lastWrittenMediaTimestamp) {
    __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, queue.shift(), !__privateGet2(this, _options2).video && !__privateGet2(this, _options2).audio);
  }
};
_createInternalChunk = /* @__PURE__ */ new WeakSet();
createInternalChunk_fn = function(data, type, timestamp, trackNumber, duration, additions) {
  let adjustedTimestamp = __privateMethod2(this, _validateTimestamp2, validateTimestamp_fn2).call(this, timestamp, trackNumber);
  let internalChunk = {
    data,
    additions,
    type,
    timestamp: adjustedTimestamp,
    duration,
    trackNumber
  };
  return internalChunk;
};
_validateTimestamp2 = /* @__PURE__ */ new WeakSet();
validateTimestamp_fn2 = function(timestamp, trackNumber) {
  let lastTimestamp = trackNumber === VIDEO_TRACK_NUMBER ? __privateGet2(this, _lastVideoTimestamp) : trackNumber === AUDIO_TRACK_NUMBER ? __privateGet2(this, _lastAudioTimestamp) : __privateGet2(this, _lastSubtitleTimestamp);
  if (trackNumber !== SUBTITLE_TRACK_NUMBER) {
    let firstTimestamp = trackNumber === VIDEO_TRACK_NUMBER ? __privateGet2(this, _firstVideoTimestamp) : __privateGet2(this, _firstAudioTimestamp);
    if (__privateGet2(this, _options2).firstTimestampBehavior === "strict" && lastTimestamp === -1 && timestamp !== 0) {
      throw new Error(
        `The first chunk for your media track must have a timestamp of 0 (received ${timestamp}). Non-zero first timestamps are often caused by directly piping frames or audio data from a MediaStreamTrack into the encoder. Their timestamps are typically relative to the age of the document, which is probably what you want.

If you want to offset all timestamps of a track such that the first one is zero, set firstTimestampBehavior: 'offset' in the options.
If you want to allow non-zero first timestamps, set firstTimestampBehavior: 'permissive'.
`
      );
    } else if (__privateGet2(this, _options2).firstTimestampBehavior === "offset") {
      timestamp -= firstTimestamp;
    }
  }
  if (timestamp < lastTimestamp) {
    throw new Error(
      `Timestamps must be monotonically increasing (went from ${lastTimestamp} to ${timestamp}).`
    );
  }
  if (timestamp < 0) {
    throw new Error(`Timestamps must be non-negative (received ${timestamp}).`);
  }
  return timestamp;
};
_writeBlock = /* @__PURE__ */ new WeakSet();
writeBlock_fn = function(chunk, canCreateNewCluster) {
  if (__privateGet2(this, _options2).streaming && !__privateGet2(this, _tracksElement)) {
    __privateMethod2(this, _createTracks, createTracks_fn).call(this);
    __privateMethod2(this, _createSegment, createSegment_fn).call(this);
  }
  let msTimestamp = Math.floor(chunk.timestamp / 1e3);
  let relativeTimestamp = msTimestamp - __privateGet2(this, _currentClusterTimestamp);
  let shouldCreateNewClusterFromKeyFrame = canCreateNewCluster && chunk.type === "key" && relativeTimestamp >= 1e3;
  let clusterWouldBeTooLong = relativeTimestamp >= MAX_CHUNK_LENGTH_MS;
  if (!__privateGet2(this, _currentCluster) || shouldCreateNewClusterFromKeyFrame || clusterWouldBeTooLong) {
    __privateMethod2(this, _createNewCluster, createNewCluster_fn).call(this, msTimestamp);
    relativeTimestamp = 0;
  }
  if (relativeTimestamp < 0) {
    return;
  }
  let prelude = new Uint8Array(4);
  let view2 = new DataView(prelude.buffer);
  view2.setUint8(0, 128 | chunk.trackNumber);
  view2.setInt16(1, relativeTimestamp, false);
  if (chunk.duration === void 0 && !chunk.additions) {
    view2.setUint8(3, Number(chunk.type === "key") << 7);
    let simpleBlock = { id: 163, data: [
      prelude,
      chunk.data
    ] };
    __privateGet2(this, _writer2).writeEBML(simpleBlock);
  } else {
    let msDuration = Math.floor(chunk.duration / 1e3);
    let blockGroup = { id: 160, data: [
      { id: 161, data: [
        prelude,
        chunk.data
      ] },
      chunk.duration !== void 0 ? { id: 155, data: msDuration } : null,
      chunk.additions ? { id: 30113, data: chunk.additions } : null
    ] };
    __privateGet2(this, _writer2).writeEBML(blockGroup);
  }
  __privateSet2(this, _duration, Math.max(__privateGet2(this, _duration), msTimestamp));
};
_createCodecPrivateElement = /* @__PURE__ */ new WeakSet();
createCodecPrivateElement_fn = function(data) {
  return { id: 25506, size: 4, data: new Uint8Array(data) };
};
_writeCodecPrivate = /* @__PURE__ */ new WeakSet();
writeCodecPrivate_fn = function(element, data) {
  let endPos = __privateGet2(this, _writer2).pos;
  __privateGet2(this, _writer2).seek(__privateGet2(this, _writer2).offsets.get(element));
  let codecPrivateElementSize = 2 + 4 + data.byteLength;
  let voidDataSize = CODEC_PRIVATE_MAX_SIZE - codecPrivateElementSize;
  if (voidDataSize < 0) {
    let newByteLength = data.byteLength + voidDataSize;
    if (data instanceof ArrayBuffer) {
      data = data.slice(0, newByteLength);
    } else {
      data = data.buffer.slice(0, newByteLength);
    }
    voidDataSize = 0;
  }
  element = [
    __privateMethod2(this, _createCodecPrivateElement, createCodecPrivateElement_fn).call(this, data),
    { id: 236, size: 4, data: new Uint8Array(voidDataSize) }
  ];
  __privateGet2(this, _writer2).writeEBML(element);
  __privateGet2(this, _writer2).seek(endPos);
};
_createNewCluster = /* @__PURE__ */ new WeakSet();
createNewCluster_fn = function(timestamp) {
  if (__privateGet2(this, _currentCluster)) {
    __privateMethod2(this, _finalizeCurrentCluster, finalizeCurrentCluster_fn).call(this);
  }
  if (__privateGet2(this, _writer2) instanceof BaseStreamTargetWriter && __privateGet2(this, _writer2).target.options.onCluster) {
    __privateGet2(this, _writer2).startTrackingWrites();
  }
  __privateSet2(this, _currentCluster, {
    id: 524531317,
    size: __privateGet2(this, _options2).streaming ? -1 : CLUSTER_SIZE_BYTES,
    data: [
      { id: 231, data: timestamp }
    ]
  });
  __privateGet2(this, _writer2).writeEBML(__privateGet2(this, _currentCluster));
  __privateSet2(this, _currentClusterTimestamp, timestamp);
  let clusterOffsetFromSegment = __privateGet2(this, _writer2).offsets.get(__privateGet2(this, _currentCluster)) - __privateGet2(this, _segmentDataOffset, segmentDataOffset_get);
  __privateGet2(this, _cues).data.push({ id: 187, data: [
    { id: 179, data: timestamp },
    __privateGet2(this, _options2).video ? { id: 183, data: [
      { id: 247, data: VIDEO_TRACK_NUMBER },
      { id: 241, data: clusterOffsetFromSegment }
    ] } : null,
    __privateGet2(this, _options2).audio ? { id: 183, data: [
      { id: 247, data: AUDIO_TRACK_NUMBER },
      { id: 241, data: clusterOffsetFromSegment }
    ] } : null
  ] });
};
_finalizeCurrentCluster = /* @__PURE__ */ new WeakSet();
finalizeCurrentCluster_fn = function() {
  if (!__privateGet2(this, _options2).streaming) {
    let clusterSize = __privateGet2(this, _writer2).pos - __privateGet2(this, _writer2).dataOffsets.get(__privateGet2(this, _currentCluster));
    let endPos = __privateGet2(this, _writer2).pos;
    __privateGet2(this, _writer2).seek(__privateGet2(this, _writer2).offsets.get(__privateGet2(this, _currentCluster)) + 4);
    __privateGet2(this, _writer2).writeEBMLVarInt(clusterSize, CLUSTER_SIZE_BYTES);
    __privateGet2(this, _writer2).seek(endPos);
  }
  if (__privateGet2(this, _writer2) instanceof BaseStreamTargetWriter && __privateGet2(this, _writer2).target.options.onCluster) {
    let { data, start: start2 } = __privateGet2(this, _writer2).getTrackedWrites();
    __privateGet2(this, _writer2).target.options.onCluster(data, start2, __privateGet2(this, _currentClusterTimestamp));
  }
};
_ensureNotFinalized2 = /* @__PURE__ */ new WeakSet();
ensureNotFinalized_fn2 = function() {
  if (__privateGet2(this, _finalized2)) {
    throw new Error("Cannot add new video or audio chunks after the file has been finalized.");
  }
};
var timestampRegex = /(?:(\d{2}):)?(\d{2}):(\d{2}).(\d{3})/;
var textEncoder = new TextEncoder();
var _options22;
var _config;
var _preambleSeen;
var _preambleBytes;
var _preambleEmitted;
var _parseTimestamp;
var parseTimestamp_fn;
var _formatTimestamp;
var formatTimestamp_fn;
_options22 = /* @__PURE__ */ new WeakMap();
_config = /* @__PURE__ */ new WeakMap();
_preambleSeen = /* @__PURE__ */ new WeakMap();
_preambleBytes = /* @__PURE__ */ new WeakMap();
_preambleEmitted = /* @__PURE__ */ new WeakMap();
_parseTimestamp = /* @__PURE__ */ new WeakSet();
parseTimestamp_fn = function(string) {
  let match = timestampRegex.exec(string);
  if (!match)
    throw new Error("Expected match.");
  return 60 * 60 * 1e3 * Number(match[1] || "0") + 60 * 1e3 * Number(match[2]) + 1e3 * Number(match[3]) + Number(match[4]);
};
_formatTimestamp = /* @__PURE__ */ new WeakSet();
formatTimestamp_fn = function(timestamp) {
  let hours = Math.floor(timestamp / (60 * 60 * 1e3));
  let minutes = Math.floor(timestamp % (60 * 60 * 1e3) / (60 * 1e3));
  let seconds = Math.floor(timestamp % (60 * 1e3) / 1e3);
  let milliseconds = timestamp % 1e3;
  return hours.toString().padStart(2, "0") + ":" + minutes.toString().padStart(2, "0") + ":" + seconds.toString().padStart(2, "0") + "." + milliseconds.toString().padStart(3, "0");
};

// ../frontend/src/packages/media-engine/muxer/webmMuxer.ts
var StreamingWebMDemuxer = class {
  constructor(type) {
    this.buffer = new Uint8Array(0);
    this.offset = 0;
    this.timecodeScale = 1e6;
    this.clusterTimecode = 0;
    this.trackCodec = "";
    this.width = 0;
    this.height = 0;
    this.sampleRate = 48e3;
    this.channels = 2;
    this.codecPrivate = null;
    this.ready = false;
    this.onReady = null;
    this.onSample = null;
    this.type = type;
  }
  appendBuffer(chunk) {
    if (this.offset > 0) {
      this.buffer = this.buffer.subarray(this.offset);
      this.offset = 0;
    }
    const next = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    next.set(this.buffer, 0);
    next.set(chunk, this.buffer.byteLength);
    this.buffer = next;
    this.parse();
  }
  readVint(offset = this.offset) {
    if (offset >= this.buffer.length) return null;
    const b = this.buffer[offset];
    let len = 1;
    let mask = 128;
    while (len <= 8 && !(b & mask)) {
      len++;
      mask >>= 1;
    }
    if (len > 8 || offset + len > this.buffer.length) return null;
    let val = b & ~mask;
    for (let i = 1; i < len; i++) {
      val = val * 256 + this.buffer[offset + i];
    }
    return { val, len };
  }
  readElementId(offset = this.offset) {
    if (offset >= this.buffer.length) return null;
    const b = this.buffer[offset];
    let len = 1;
    let mask = 128;
    while (len <= 4 && !(b & mask)) {
      len++;
      mask >>= 1;
    }
    if (len > 4 || offset + len > this.buffer.length) return null;
    let id = 0;
    for (let i = 0; i < len; i++) {
      id = id * 256 + this.buffer[offset + i];
    }
    return { id, len };
  }
  parse() {
    while (this.offset < this.buffer.length) {
      const el = this.readElementId(this.offset);
      if (!el) break;
      const sz = this.readVint(this.offset + el.len);
      if (!sz) break;
      const headerLen = el.len + sz.len;
      const dataSize = sz.val;
      const elemStart = this.offset + headerLen;
      if (el.id === 440786851 || // EBML
      el.id === 408125543 || // Segment
      el.id === 357149030 || // Info
      el.id === 374648427 || // Tracks
      el.id === 174 || // TrackEntry
      el.id === 224 || // Video
      el.id === 225 || // Audio
      el.id === 524531317) {
        this.offset += headerLen;
        continue;
      }
      if (elemStart + dataSize > this.buffer.length) {
        break;
      }
      if (el.id === 2807729) {
        let ts = 0;
        for (let i = 0; i < dataSize; i++) ts = ts * 256 + this.buffer[elemStart + i];
        this.timecodeScale = ts || 1e6;
      } else if (el.id === 134) {
        let s = "";
        for (let i = 0; i < dataSize; i++) s += String.fromCharCode(this.buffer[elemStart + i]);
        if (!this.trackCodec) this.trackCodec = s;
      } else if (el.id === 176) {
        let w = 0;
        for (let i = 0; i < dataSize; i++) w = w * 256 + this.buffer[elemStart + i];
        this.width = w;
      } else if (el.id === 186) {
        let h = 0;
        for (let i = 0; i < dataSize; i++) h = h * 256 + this.buffer[elemStart + i];
        this.height = h;
      } else if (el.id === 181) {
        const dv = new DataView(this.buffer.buffer, this.buffer.byteOffset + elemStart, dataSize);
        if (dataSize === 4) this.sampleRate = dv.getFloat32(0, false);
        else if (dataSize === 8) this.sampleRate = dv.getFloat64(0, false);
        else this.sampleRate = 48e3;
      } else if (el.id === 159) {
        let ch = 0;
        for (let i = 0; i < dataSize; i++) ch = ch * 256 + this.buffer[elemStart + i];
        this.channels = ch || 2;
      } else if (el.id === 25506) {
        this.codecPrivate = this.buffer.slice(elemStart, elemStart + dataSize);
      } else if (el.id === 231) {
        let tc = 0;
        for (let i = 0; i < dataSize; i++) tc = tc * 256 + this.buffer[elemStart + i];
        this.clusterTimecode = tc;
        if (!this.ready && (this.width > 0 || this.sampleRate > 0)) {
          this.ready = true;
          if (this.onReady) {
            this.onReady({
              type: this.type,
              codec: this.trackCodec,
              width: this.width || 3840,
              height: this.height || 2160,
              sampleRate: this.sampleRate || 48e3,
              channels: this.channels || 2,
              codecPrivate: this.codecPrivate
            });
          }
        }
      } else if (el.id === 163) {
        const trackVint = this.readVint(elemStart);
        if (trackVint) {
          const relTimeOffset = elemStart + trackVint.len;
          const dv = new DataView(this.buffer.buffer, this.buffer.byteOffset + relTimeOffset, 2);
          const relTime = dv.getInt16(0, false);
          const flags = this.buffer[relTimeOffset + 2];
          const isKeyframe = (flags & 128) !== 0;
          const payload = this.buffer.slice(relTimeOffset + 3, elemStart + dataSize);
          const timecodeMs = this.clusterTimecode + relTime;
          const timestampUs = Math.round(timecodeMs * (this.timecodeScale / 1e3));
          if (this.onSample) {
            this.onSample({
              data: payload,
              is_sync: isKeyframe,
              timestampUs
            });
          }
        }
      }
      this.offset = elemStart + dataSize;
    }
  }
};
var StreamingWebMMuxer = class {
  static async remux(options) {
    const {
      video,
      audio,
      sink,
      chunkSize = 512 * 1024,
      signal,
      onProgress
    } = options;
    const vDemux = new StreamingWebMDemuxer("video");
    const aDemux = new StreamingWebMDemuxer("audio");
    let vReady = false;
    let aReady = false;
    let vInfo = null;
    let aInfo = null;
    let muxer = null;
    let bytesWritten = 0;
    let baseTimestampUs = -1;
    const pendingWrites = [];
    const pendingVideoSamples = [];
    const pendingAudioSamples = [];
    let vSampleCount = 0;
    let aSampleCount = 0;
    let firstVideoPts = -1;
    let lastVideoPts = -1;
    let firstAudioPts = -1;
    let lastAudioPts = -1;
    let firstAudioSample = true;
    let vActualTotal = video.totalBytes || null;
    let aActualTotal = audio.totalBytes || null;
    const processVideoSample = (s) => {
      vSampleCount++;
      if (firstVideoPts === -1) firstVideoPts = s.timestampUs;
      lastVideoPts = s.timestampUs;
      if (baseTimestampUs === -1) {
        baseTimestampUs = Math.min(firstVideoPts, firstAudioPts >= 0 ? firstAudioPts : firstVideoPts);
      }
      const normalizedTs = Math.max(0, s.timestampUs - baseTimestampUs);
      muxer.addVideoChunkRaw(
        s.data,
        s.is_sync ? "key" : "delta",
        normalizedTs
      );
    };
    const processAudioSample = (s) => {
      aSampleCount++;
      if (firstAudioPts === -1) firstAudioPts = s.timestampUs;
      lastAudioPts = s.timestampUs;
      if (baseTimestampUs === -1) {
        baseTimestampUs = Math.min(firstVideoPts >= 0 ? firstVideoPts : firstAudioPts, firstAudioPts);
      }
      const normalizedTs = Math.max(0, s.timestampUs - baseTimestampUs);
      const meta = firstAudioSample && aInfo?.codecPrivate ? { decoderConfig: { description: aInfo.codecPrivate } } : void 0;
      firstAudioSample = false;
      muxer.addAudioChunkRaw(s.data, "key", normalizedTs, meta);
    };
    const initMuxerIfReady = () => {
      if (muxer || !vReady || !aReady) return;
      muxer = new Muxer2({
        target: new StreamTarget2({
          onData: (dataChunk, position) => {
            const p = (async () => {
              await sink.write(dataChunk, position);
              bytesWritten += dataChunk.byteLength;
            })();
            pendingWrites.push(p);
          }
        }),
        video: {
          codec: vInfo.codec?.includes("AV1") || vInfo.codec?.includes("av01") ? "V_AV1" : "V_VP9",
          width: vInfo.width || 3840,
          height: vInfo.height || 2160,
          frameRate: 30
        },
        audio: {
          codec: "A_OPUS",
          numberOfChannels: aInfo.channels || 2,
          sampleRate: Math.round(aInfo.sampleRate) || 48e3
        },
        firstTimestampBehavior: "permissive"
      });
      while (pendingVideoSamples.length > 0) {
        processVideoSample(pendingVideoSamples.shift());
      }
      while (pendingAudioSamples.length > 0) {
        processAudioSample(pendingAudioSamples.shift());
      }
    };
    vDemux.onReady = (info) => {
      vInfo = info;
      vReady = true;
      initMuxerIfReady();
    };
    aDemux.onReady = (info) => {
      aInfo = info;
      aReady = true;
      initMuxerIfReady();
    };
    vDemux.onSample = (s) => {
      if (!muxer) pendingVideoSamples.push(s);
      else processVideoSample(s);
    };
    aDemux.onSample = (s) => {
      if (!muxer) pendingAudioSamples.push(s);
      else processAudioSample(s);
    };
    const fetchRange = async (url2, start2, end, headers = {}, isVideo = true) => {
      const safeHeaders = filterSafeBrowserHeaders(headers);
      const res = await fetch(url2, {
        headers: {
          ...safeHeaders,
          Range: `bytes=${start2}-${end}`
        },
        signal
      });
      if (res.status === 416) return new Uint8Array(0);
      if (res.status !== 206 && res.status !== 200) {
        throw new Error(`Upstream returned HTTP ${res.status}`);
      }
      const cr = res.headers.get("content-range");
      if (cr) {
        const match = cr.match(/\/(\d+)$/);
        if (match) {
          const totalFromHeader = parseInt(match[1], 10);
          if (isVideo) vActualTotal = totalFromHeader;
          else aActualTotal = totalFromHeader;
        }
      }
      const buffer = await res.arrayBuffer();
      return new Uint8Array(buffer);
    };
    const totalEst = (video.totalBytes || 20 * 1024 * 1024) + (audio.totalBytes || 2 * 1024 * 1024);
    let vOffset = 0;
    let aOffset = 0;
    let vDone = false;
    let aDone = false;
    const initSize = 256 * 1024;
    const [vHeader, aHeader] = await Promise.all([
      fetchRange(video.url, 0, initSize - 1, video.headers, true),
      fetchRange(audio.url, 0, initSize - 1, audio.headers, false)
    ]);
    vDemux.appendBuffer(vHeader);
    vOffset = vHeader.byteLength;
    aDemux.appendBuffer(aHeader);
    aOffset = aHeader.byteLength;
    initMuxerIfReady();
    const startTime = Date.now();
    let lastProgressTime = 0;
    while (!vDone || !aDone) {
      if (signal?.aborted) throw new Error("Remuxing aborted by user");
      const vFetchEnd = Math.min(vOffset + chunkSize - 1, (vActualTotal || Infinity) - 1);
      const aFetchEnd = Math.min(aOffset + chunkSize - 1, (aActualTotal || Infinity) - 1);
      const fetches = [];
      if (!vDone) {
        fetches.push(
          fetchRange(video.url, vOffset, vFetchEnd, video.headers, true).then((data) => {
            if (data.length === 0) vDone = true;
            else {
              vDemux.appendBuffer(data);
              vOffset += data.byteLength;
              if (vActualTotal && vOffset >= vActualTotal) vDone = true;
            }
          })
        );
      }
      if (!aDone) {
        fetches.push(
          fetchRange(audio.url, aOffset, aFetchEnd, audio.headers, false).then((data) => {
            if (data.length === 0) aDone = true;
            else {
              aDemux.appendBuffer(data);
              aOffset += data.byteLength;
              if (aActualTotal && aOffset >= aActualTotal) aDone = true;
            }
          })
        );
      }
      await Promise.all(fetches);
      const now = Date.now();
      if (now - lastProgressTime > 150) {
        lastProgressTime = now;
        const totalProcessed = vOffset + aOffset;
        const effectiveTotal = (vActualTotal || video.totalBytes || 0) + (aActualTotal || audio.totalBytes || 0) || totalEst;
        const percent = Math.min(99, Math.round(totalProcessed / effectiveTotal * 100));
        const elapsedSec = (now - startTime) / 1e3;
        const bytesPerSec = elapsedSec > 0 ? totalProcessed / elapsedSec : 0;
        const remainingBytes = Math.max(0, effectiveTotal - totalProcessed);
        const etaSec = bytesPerSec > 0 ? Math.round(remainingBytes / bytesPerSec) : 0;
        if (onProgress) {
          onProgress({
            stage: "muxing",
            progressPercent: percent,
            downloadedBytes: totalProcessed,
            totalBytes: effectiveTotal,
            speedFormatted: bytesPerSec > 1024 * 1024 ? `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s` : `${Math.round(bytesPerSec / 1024)} KB/s`,
            etaFormatted: etaSec > 0 ? `${etaSec}s` : "Finishing...",
            message: `Remuxing 4K streams in-browser (${percent}%)...`
          });
        }
      }
    }
    if (muxer) {
      muxer.finalize();
    }
    await Promise.all(pendingWrites);
    if (bytesWritten === 0) {
      throw new Error("MEDIA_INTEGRITY: FAIL_EMPTY_STREAM (StreamingWebMMuxer wrote 0 bytes to sink)");
    }
    const videoDuration = firstVideoPts >= 0 ? (lastVideoPts - firstVideoPts) / 1e6 : 0;
    const audioDuration = firstAudioPts >= 0 ? (lastAudioPts - firstAudioPts) / 1e6 : 0;
    if (vSampleCount === 0 || aSampleCount === 0) {
      throw new Error(
        `MEDIA_INTEGRITY: FAIL_AV_SYNC (missing stream samples: video=${vSampleCount} frames, audio=${aSampleCount} samples)`
      );
    }
    const delta = Math.abs(videoDuration - audioDuration);
    if (Math.max(videoDuration, audioDuration) > 5 && delta > 3) {
      throw new Error(
        `MEDIA_INTEGRITY: FAIL_AV_SYNC (video: ${videoDuration.toFixed(2)}s [${vSampleCount} frames], audio: ${audioDuration.toFixed(2)}s [${aSampleCount} samples], delta: ${delta.toFixed(2)}s exceeds 3.0s threshold)`
      );
    }
    console.log(
      `[NEXUS MediaEngine] 4K WebM MEDIA_INTEGRITY: PASS (video: ${videoDuration.toFixed(3)}s [${vSampleCount} frames], audio: ${audioDuration.toFixed(3)}s [${aSampleCount} samples], delta: ${(delta * 1e3).toFixed(1)}ms)`
    );
    return bytesWritten;
  }
};

// ../frontend/src/packages/media-engine/hls/constants.ts
var MAX_HLS_PLAYLIST_BYTES = 2 * 1024 * 1024;
var MAX_HLS_SEGMENTS = 5e3;
var MAX_HLS_SEGMENT_BYTES = 50 * 1024 * 1024;
var MAX_HLS_KEY_BYTES = 4096;
var MAX_HLS_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
var MAX_HLS_DURATION_SECONDS = 14400;
var MAX_HLS_CONCURRENT_SEGMENTS = 2;
var MAX_HLS_RETRIES = 3;
var HLS_RETRY_BACKOFF_MS = 500;

// ../frontend/src/packages/media-engine/hls/playlist.ts
var HLSParseError = class extends Error {
  constructor(message, code = "INVALID_PLAYLIST") {
    super(message);
    this.name = "HLSParseError";
    this.code = code;
  }
};
function resolveSafeUrl(uri, baseUrl) {
  const trimmed = uri.trim();
  if (!trimmed) {
    throw new HLSParseError("Empty URI encountered in playlist", "INVALID_PLAYLIST");
  }
  let resolved;
  try {
    resolved = new URL(trimmed, baseUrl);
  } catch (err) {
    throw new HLSParseError(`Malformed URI '${trimmed}': ${err.message}`, "INVALID_PLAYLIST");
  }
  const proto = resolved.protocol.toLowerCase();
  if (proto !== "http:" && proto !== "https:") {
    throw new HLSParseError(`Unsafe URL scheme '${proto}' in playlist: ${resolved.href}`, "SSRF_VIOLATION");
  }
  return resolved.toString();
}
function parseAttributeList(attrStr) {
  const attrs = {};
  const regex = /([A-Z0-9_-]+)=(?:"([^"]*)"|([^,]*))/g;
  let match;
  while ((match = regex.exec(attrStr)) !== null) {
    const key = match[1].trim();
    const val = match[2] !== void 0 ? match[2] : (match[3] || "").trim();
    attrs[key] = val;
  }
  return attrs;
}
function parseHexBytes(hex) {
  const cleaned = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (cleaned.length !== 32) {
    throw new HLSParseError(`Invalid IV hex string length (${cleaned.length} chars, expected 32 for 16 bytes)`, "INVALID_PLAYLIST");
  }
  const bytes2 = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const byteVal = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
    if (isNaN(byteVal)) {
      throw new HLSParseError(`Invalid hex character in IV: ${cleaned}`, "INVALID_PLAYLIST");
    }
    bytes2[i] = byteVal;
  }
  return bytes2;
}
function parseHLSPlaylist(playlistText, baseUrl) {
  if (typeof playlistText !== "string" || !playlistText.trim()) {
    throw new HLSParseError("Playlist is empty or not a string", "INVALID_PLAYLIST");
  }
  if (playlistText.length > MAX_HLS_PLAYLIST_BYTES) {
    throw new HLSParseError(`Playlist exceeds maximum allowed size (${playlistText.length} > ${MAX_HLS_PLAYLIST_BYTES})`, "PLAYLIST_TOO_LARGE");
  }
  const lines = playlistText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0 || lines[0] !== "#EXTM3U") {
    throw new HLSParseError("Missing #EXTM3U header at start of playlist", "INVALID_PLAYLIST");
  }
  const isMaster = lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"));
  if (isMaster) {
    return parseMasterPlaylist(lines, baseUrl);
  } else {
    return parseMediaPlaylist(lines, baseUrl);
  }
}
function parseMasterPlaylist(lines, baseUrl) {
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const attrStr = line.substring("#EXT-X-STREAM-INF:".length);
      const attrs = parseAttributeList(attrStr);
      const bandwidth = parseInt(attrs["BANDWIDTH"] || "0", 10);
      const avgBandwidth = attrs["AVERAGE-BANDWIDTH"] ? parseInt(attrs["AVERAGE-BANDWIDTH"], 10) : void 0;
      const codecs = attrs["CODECS"];
      const audioGroup = attrs["AUDIO"];
      const videoGroup = attrs["VIDEO"];
      const frameRate = attrs["FRAME-RATE"] ? parseFloat(attrs["FRAME-RATE"]) : void 0;
      let resolution;
      if (attrs["RESOLUTION"]) {
        const [wStr, hStr] = attrs["RESOLUTION"].split("x");
        const w = parseInt(wStr, 10);
        const h = parseInt(hStr, 10);
        if (!isNaN(w) && !isNaN(h)) {
          resolution = { width: w, height: h };
        }
      }
      i++;
      while (i < lines.length && lines[i].startsWith("#")) {
        i++;
      }
      if (i >= lines.length) {
        throw new HLSParseError("Unexpected end of playlist following #EXT-X-STREAM-INF", "INVALID_PLAYLIST");
      }
      const variantUri = resolveSafeUrl(lines[i], baseUrl);
      variants.push({
        uri: variantUri,
        bandwidth,
        averageBandwidth: avgBandwidth,
        resolution,
        frameRate,
        codecs,
        audioGroup,
        videoGroup
      });
    }
  }
  if (variants.length === 0) {
    throw new HLSParseError("Master playlist contains 0 valid stream variants", "INVALID_PLAYLIST");
  }
  return {
    type: "master",
    endlist: true,
    variants,
    segments: []
  };
}
function parseMediaPlaylist(lines, baseUrl) {
  let targetDuration;
  let mediaSequence = 0;
  let discontinuitySequence = 0;
  let endlist = false;
  let currentKey;
  let currentMap;
  let pendingDiscontinuity = false;
  let pendingByteRange;
  let lastByteRangeOffset = 0;
  const segments = [];
  let totalDuration = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDuration = parseFloat(line.substring("#EXT-X-TARGETDURATION:".length));
    } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      mediaSequence = parseInt(line.substring("#EXT-X-MEDIA-SEQUENCE:".length), 10) || 0;
    } else if (line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")) {
      discontinuitySequence = parseInt(line.substring("#EXT-X-DISCONTINUITY-SEQUENCE:".length), 10) || 0;
    } else if (line === "#EXT-X-DISCONTINUITY") {
      pendingDiscontinuity = true;
    } else if (line === "#EXT-X-ENDLIST") {
      endlist = true;
    } else if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = parseAttributeList(line.substring("#EXT-X-KEY:".length));
      const method = (attrs["METHOD"] || "NONE").toUpperCase();
      if (method === "NONE") {
        currentKey = void 0;
      } else if (method === "AES-128") {
        const keyUri = attrs["URI"] ? resolveSafeUrl(attrs["URI"], baseUrl) : void 0;
        let ivBytes;
        if (attrs["IV"]) {
          ivBytes = parseHexBytes(attrs["IV"]);
        }
        currentKey = {
          method: "AES-128",
          uri: keyUri,
          iv: ivBytes,
          keyFormat: attrs["KEYFORMAT"] || "identity"
        };
      } else {
        currentKey = {
          method,
          uri: attrs["URI"] ? resolveSafeUrl(attrs["URI"], baseUrl) : void 0
        };
      }
    } else if (line.startsWith("#EXT-X-MAP:")) {
      const attrs = parseAttributeList(line.substring("#EXT-X-MAP:".length));
      if (attrs["URI"]) {
        const mapUri = resolveSafeUrl(attrs["URI"], baseUrl);
        let br;
        if (attrs["BYTERANGE"]) {
          const parts = attrs["BYTERANGE"].split("@");
          const len = parseInt(parts[0], 10);
          const off = parts[1] ? parseInt(parts[1], 10) : 0;
          if (!isNaN(len)) br = { length: len, offset: off };
        }
        currentMap = { uri: mapUri, byteRange: br };
      }
    } else if (line.startsWith("#EXT-X-BYTERANGE:")) {
      const val = line.substring("#EXT-X-BYTERANGE:".length);
      const parts = val.split("@");
      const length = parseInt(parts[0], 10);
      const offset = parts[1] !== void 0 ? parseInt(parts[1], 10) : lastByteRangeOffset;
      if (!isNaN(length)) {
        pendingByteRange = { length, offset };
        lastByteRangeOffset = offset + length;
      }
    } else if (line.startsWith("#EXTINF:")) {
      const infoStr = line.substring("#EXTINF:".length);
      const commaIdx = infoStr.indexOf(",");
      const durStr = commaIdx !== -1 ? infoStr.substring(0, commaIdx) : infoStr;
      const title = commaIdx !== -1 ? infoStr.substring(commaIdx + 1) : void 0;
      const duration = parseFloat(durStr);
      i++;
      while (i < lines.length && lines[i].startsWith("#")) {
        if (lines[i].startsWith("#EXT-X-BYTERANGE:")) {
          const val = lines[i].substring("#EXT-X-BYTERANGE:".length);
          const parts = val.split("@");
          const length = parseInt(parts[0], 10);
          const offset = parts[1] !== void 0 ? parseInt(parts[1], 10) : lastByteRangeOffset;
          if (!isNaN(length)) {
            pendingByteRange = { length, offset };
            lastByteRangeOffset = offset + length;
          }
        }
        i++;
      }
      if (i >= lines.length) {
        throw new HLSParseError("Unexpected end of playlist following #EXTINF", "INVALID_PLAYLIST");
      }
      const segmentUri = resolveSafeUrl(lines[i], baseUrl);
      const segIndex = mediaSequence + segments.length;
      segments.push({
        index: segIndex,
        uri: segmentUri,
        duration: isNaN(duration) ? 0 : duration,
        title,
        byteRange: pendingByteRange,
        discontinuity: pendingDiscontinuity,
        key: currentKey ? { ...currentKey } : void 0,
        map: currentMap ? { ...currentMap } : void 0
      });
      totalDuration += isNaN(duration) ? 0 : duration;
      pendingDiscontinuity = false;
      pendingByteRange = void 0;
      if (segments.length > MAX_HLS_SEGMENTS) {
        throw new HLSParseError(`Playlist exceeds maximum allowed segment count (${segments.length} > ${MAX_HLS_SEGMENTS})`, "SEGMENT_LIMIT");
      }
      if (totalDuration > MAX_HLS_DURATION_SECONDS) {
        throw new HLSParseError(`Playlist exceeds maximum allowed duration (${totalDuration}s > ${MAX_HLS_DURATION_SECONDS}s)`, "DURATION_LIMIT");
      }
    }
  }
  return {
    type: "media",
    targetDuration,
    mediaSequence,
    discontinuitySequence,
    endlist,
    variants: [],
    segments
  };
}

// ../frontend/src/packages/media-engine/hls/variant.ts
var HLSVariantError = class extends Error {
  constructor(message, code = "UNSUPPORTED_CODEC") {
    super(message);
    this.name = "HLSVariantError";
    this.code = code;
  }
};
function isCodecSupported(codecStr) {
  if (!codecStr) {
    return true;
  }
  const codecs = codecStr.toLowerCase().split(",").map((c) => c.trim());
  let hasSupportedVideo = false;
  let hasSupportedAudio = false;
  for (const c of codecs) {
    if (c.startsWith("hvc1") || c.startsWith("hev1") || c.startsWith("vp09") || c.startsWith("av01") || c.startsWith("ac-3") || c.startsWith("ec-3")) {
      return false;
    }
    if (c.startsWith("avc1") || c.includes("h264")) {
      hasSupportedVideo = true;
    }
    if (c.startsWith("mp4a") || c.includes("aac")) {
      hasSupportedAudio = true;
    }
  }
  return hasSupportedVideo || hasSupportedAudio;
}
function selectHLSVariant(variants, options = {}) {
  if (!variants || variants.length === 0) {
    throw new HLSVariantError("No stream variants available in master playlist", "INVALID_PLAYLIST");
  }
  const compatibleVariants = variants.filter((v) => isCodecSupported(v.codecs));
  if (compatibleVariants.length === 0) {
    throw new HLSVariantError(
      `No compatible H.264/AAC variants found among ${variants.length} stream variants`,
      "UNSUPPORTED_CODEC"
    );
  }
  let candidateVariants = compatibleVariants;
  if (options.maxHeight) {
    const heightFiltered = candidateVariants.filter((v) => !v.resolution || v.resolution.height <= options.maxHeight);
    if (heightFiltered.length > 0) {
      candidateVariants = heightFiltered;
    }
  }
  if (options.maxBandwidth) {
    const bwFiltered = candidateVariants.filter((v) => v.bandwidth <= options.maxBandwidth);
    if (bwFiltered.length > 0) {
      candidateVariants = bwFiltered;
    }
  }
  candidateVariants.sort((a, b) => {
    const hA = a.resolution?.height || 0;
    const hB = b.resolution?.height || 0;
    if (hA !== hB) return hB - hA;
    if (a.bandwidth !== b.bandwidth) return b.bandwidth - a.bandwidth;
    return a.uri.localeCompare(b.uri);
  });
  if (options.preferredHeight) {
    const exact = candidateVariants.find((v) => v.resolution?.height === options.preferredHeight);
    if (exact) return exact;
  }
  return candidateVariants[0];
}

// ../frontend/src/packages/media-engine/hls/decryptor.ts
var HLSDecryptError = class extends Error {
  constructor(message, code = "UNSUPPORTED_ENCRYPTION") {
    super(message);
    this.name = "HLSDecryptError";
    this.code = code;
  }
};
function deriveSequenceIV(sequenceNumber) {
  const iv = new Uint8Array(16);
  const view2 = new DataView(iv.buffer);
  view2.setUint32(12, sequenceNumber, false);
  return iv;
}
var AES128Decryptor = class {
  constructor() {
    this.keyCache = /* @__PURE__ */ new Map();
  }
  /**
   * Imports a raw 16-byte key into a Web Crypto CryptoKey.
   */
  async importKey(keyBytes, cacheKey) {
    if (!keyBytes || keyBytes.byteLength !== 16) {
      throw new HLSDecryptError(
        `Invalid AES-128 key length (${keyBytes?.byteLength || 0} bytes, expected exactly 16 bytes)`,
        "INVALID_SEGMENT"
      );
    }
    if (cacheKey && this.keyCache.has(cacheKey)) {
      return this.keyCache.get(cacheKey);
    }
    try {
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-CBC" },
        false,
        ["decrypt"]
      );
      if (cacheKey) {
        this.keyCache.set(cacheKey, cryptoKey);
      }
      return cryptoKey;
    } catch (err) {
      throw new HLSDecryptError(`Failed to import AES-128 key: ${err.message}`, "INVALID_SEGMENT");
    }
  }
  /**
   * Decrypts an encrypted media segment.
   */
  async decryptSegment(encryptedData, keyMetadata, rawKeyBytes, sequenceNumber) {
    if (keyMetadata.method === "NONE") {
      return encryptedData;
    }
    if (keyMetadata.method !== "AES-128") {
      throw new HLSDecryptError(
        `Unsupported HLS encryption method: '${keyMetadata.method}'. Only AES-128 is supported.`,
        "UNSUPPORTED_ENCRYPTION"
      );
    }
    let iv;
    if (keyMetadata.iv && keyMetadata.iv.byteLength === 16) {
      iv = keyMetadata.iv;
    } else {
      iv = deriveSequenceIV(sequenceNumber);
    }
    const cryptoKey = await this.importKey(rawKeyBytes, keyMetadata.uri);
    try {
      const decryptedBuf = await crypto.subtle.decrypt(
        {
          name: "AES-CBC",
          iv
        },
        cryptoKey,
        encryptedData
      );
      return new Uint8Array(decryptedBuf);
    } catch (err) {
      throw new HLSDecryptError(`AES-128 decryption failed: ${err.message}`, "DECRYPT_FAILED");
    }
  }
  clear() {
    this.keyCache.clear();
  }
};

// ../frontend/src/packages/media-engine/hls/tsDemuxer.ts
var HLSDemuxError = class extends Error {
  constructor(message, code = "INVALID_SEGMENT") {
    super(message);
    this.name = "HLSDemuxError";
    this.code = code;
  }
};
var TS_PACKET_SIZE = 188;
var SYNC_BYTE = 71;
var AAC_SAMPLE_RATES = [
  96e3,
  88200,
  64e3,
  48e3,
  44100,
  32e3,
  24e3,
  22050,
  16e3,
  12e3,
  11025,
  8e3,
  7350
];
var MPEGTSDemuxer = class {
  constructor() {
    this.pmtPid = null;
    this.videoPid = null;
    this.audioPid = null;
    // PES reassembly buffers
    this.videoPesBuffer = [];
    this.videoPesLength = 0;
    this.audioPesBuffer = [];
    this.audioPesLength = 0;
    // Track metadata
    this.metadata = {};
    this.sps = null;
    this.pps = null;
  }
  /**
   * Resets demuxer state for a new timeline.
   */
  reset() {
    this.pmtPid = null;
    this.videoPid = null;
    this.audioPid = null;
    this.videoPesBuffer = [];
    this.videoPesLength = 0;
    this.audioPesBuffer = [];
    this.audioPesLength = 0;
    this.metadata = {};
    this.sps = null;
    this.pps = null;
  }
  /**
   * Parses an MPEG-TS segment byte buffer and returns video and audio samples.
   */
  demuxSegment(segmentData) {
    const videoSamples = [];
    const audioSamples = [];
    if (!segmentData || segmentData.length === 0) {
      throw new HLSDemuxError("Segment data is empty", "INVALID_SEGMENT");
    }
    if (segmentData.length >= 10 && segmentData[0] === 73 && segmentData[1] === 68 && segmentData[2] === 51) {
      const id3PayloadLen = (segmentData[6] & 127) << 21 | (segmentData[7] & 127) << 14 | (segmentData[8] & 127) << 7 | segmentData[9] & 127;
      const audioStart = 10 + id3PayloadLen;
      if (audioStart < segmentData.length) {
        const audioEs = segmentData.subarray(audioStart);
        const adtsSamples = this.parseADTS(audioEs, 0);
        if (adtsSamples.length > 0) {
          audioSamples.push(...adtsSamples);
          return { videoSamples, audioSamples };
        }
      }
    } else if (segmentData.length >= 7 && segmentData[0] === 255 && (segmentData[1] & 246) === 240 && (segmentData[2] & 60) >> 2 < 13) {
      const adtsSamples = this.parseADTS(segmentData, 0);
      if (adtsSamples.length > 0) {
        audioSamples.push(...adtsSamples);
        return { videoSamples, audioSamples };
      }
    }
    if (segmentData.length < TS_PACKET_SIZE) {
      throw new HLSDemuxError(
        `Segment data too small (${segmentData.length} bytes, minimum ${TS_PACKET_SIZE})`,
        "INVALID_SEGMENT"
      );
    }
    let offset = 0;
    while (offset < segmentData.length && segmentData[offset] !== SYNC_BYTE) {
      offset++;
    }
    if (offset + TS_PACKET_SIZE > segmentData.length) {
      throw new HLSDemuxError("No valid MPEG-TS sync byte (0x47) found in segment", "INVALID_SEGMENT");
    }
    while (offset + TS_PACKET_SIZE <= segmentData.length) {
      if (segmentData[offset] !== SYNC_BYTE) {
        offset++;
        continue;
      }
      const p1 = segmentData[offset + 1];
      const p2 = segmentData[offset + 2];
      const p3 = segmentData[offset + 3];
      const tei = (p1 & 128) !== 0;
      if (tei) {
        offset += TS_PACKET_SIZE;
        continue;
      }
      const pusi = (p1 & 64) !== 0;
      const pid = (p1 & 31) << 8 | p2;
      const afc = (p3 & 48) >> 4;
      let payloadOffset = offset + 4;
      if (afc === 2 || afc === 3) {
        const afLength = segmentData[offset + 4];
        payloadOffset += 1 + afLength;
      }
      const payloadEnd = offset + TS_PACKET_SIZE;
      if (payloadOffset > payloadEnd) {
        offset += TS_PACKET_SIZE;
        continue;
      }
      const hasPayload = afc === 1 || afc === 3;
      if (!hasPayload || payloadOffset >= payloadEnd) {
        offset += TS_PACKET_SIZE;
        continue;
      }
      const payload = segmentData.subarray(payloadOffset, payloadEnd);
      if (pid === 0) {
        this.parsePAT(payload, pusi);
      } else if (this.pmtPid !== null && pid === this.pmtPid) {
        this.parsePMT(payload, pusi);
      } else if (this.videoPid !== null && pid === this.videoPid) {
        if (pusi && this.videoPesBuffer.length > 0) {
          const vs = this.flushVideoPes();
          if (vs) videoSamples.push(...vs);
        }
        this.videoPesBuffer.push(payload);
        this.videoPesLength += payload.length;
      } else if (this.audioPid !== null && pid === this.audioPid) {
        if (pusi && this.audioPesBuffer.length > 0) {
          const as = this.flushAudioPes();
          if (as) audioSamples.push(...as);
        }
        this.audioPesBuffer.push(payload);
        this.audioPesLength += payload.length;
      }
      offset += TS_PACKET_SIZE;
    }
    if (this.videoPesBuffer.length > 0) {
      const vs = this.flushVideoPes();
      if (vs) videoSamples.push(...vs);
    }
    if (this.audioPesBuffer.length > 0) {
      const as = this.flushAudioPes();
      if (as) audioSamples.push(...as);
    }
    return { videoSamples, audioSamples };
  }
  parsePAT(payload, pusi) {
    let offset = pusi ? 1 + payload[0] : 0;
    if (offset + 8 > payload.length) return;
    const tableId = payload[offset];
    if (tableId !== 0) return;
    const sectionLength = (payload[offset + 1] & 15) << 8 | payload[offset + 2];
    const end = offset + 3 + sectionLength - 4;
    offset += 8;
    while (offset + 4 <= end && offset + 4 <= payload.length) {
      const programNum = payload[offset] << 8 | payload[offset + 1];
      const programPid = (payload[offset + 2] & 31) << 8 | payload[offset + 3];
      if (programNum !== 0) {
        this.pmtPid = programPid;
        break;
      }
      offset += 4;
    }
  }
  parsePMT(payload, pusi) {
    let offset = pusi ? 1 + payload[0] : 0;
    if (offset + 12 > payload.length) return;
    const tableId = payload[offset];
    if (tableId !== 2) return;
    const sectionLength = (payload[offset + 1] & 15) << 8 | payload[offset + 2];
    const progInfoLength = (payload[offset + 10] & 15) << 8 | payload[offset + 11];
    offset += 12 + progInfoLength;
    const end = offset + sectionLength - 9 - progInfoLength - 4;
    while (offset + 5 <= end && offset + 5 <= payload.length) {
      const streamType = payload[offset];
      const elementaryPid = (payload[offset + 1] & 31) << 8 | payload[offset + 2];
      const esInfoLength = (payload[offset + 3] & 15) << 8 | payload[offset + 4];
      if (streamType === 27 && this.videoPid === null) {
        this.videoPid = elementaryPid;
      } else if ((streamType === 15 || streamType === 17) && this.audioPid === null) {
        this.audioPid = elementaryPid;
      }
      offset += 5 + esInfoLength;
    }
  }
  flushVideoPes() {
    if (this.videoPesBuffer.length === 0) return null;
    const total = new Uint8Array(this.videoPesLength);
    let off = 0;
    for (const b of this.videoPesBuffer) {
      total.set(b, off);
      off += b.length;
    }
    this.videoPesBuffer = [];
    this.videoPesLength = 0;
    return this.parseVideoPES(total);
  }
  parseVideoPES(data) {
    if (data.length < 9) return null;
    if (data[0] !== 0 || data[1] !== 0 || data[2] !== 1) return null;
    const ptsDtsFlags = (data[7] & 192) >> 6;
    const headerDataLen = data[8];
    let ptsTicks = 0;
    let dtsTicks = 0;
    if (ptsDtsFlags === 2 && headerDataLen >= 5 && data.length >= 14) {
      ptsTicks = (data[9] & 14) << 29 | data[10] << 22 | (data[11] & 254) << 14 | data[12] << 7 | (data[13] & 254) >> 1;
      dtsTicks = ptsTicks;
    } else if (ptsDtsFlags === 3 && headerDataLen >= 10 && data.length >= 19) {
      ptsTicks = (data[9] & 14) << 29 | data[10] << 22 | (data[11] & 254) << 14 | data[12] << 7 | (data[13] & 254) >> 1;
      dtsTicks = (data[14] & 14) << 29 | data[15] << 22 | (data[16] & 254) << 14 | data[17] << 7 | (data[18] & 254) >> 1;
    }
    const payloadOffset = 9 + headerDataLen;
    if (payloadOffset >= data.length) return null;
    const esData = data.subarray(payloadOffset);
    return this.parseAnnexBToSample(esData, ptsTicks, dtsTicks);
  }
  parseAnnexBToSample(esData, ptsTicks, dtsTicks) {
    const nalUnits = [];
    let startIdx = -1;
    for (let i = 0; i < esData.length - 3; i++) {
      if (esData[i] === 0 && esData[i + 1] === 0) {
        let codeLen = 0;
        if (esData[i + 2] === 1) {
          codeLen = 3;
        } else if (esData[i + 2] === 0 && esData[i + 3] === 1) {
          codeLen = 4;
        }
        if (codeLen > 0) {
          if (startIdx !== -1) {
            nalUnits.push(esData.subarray(startIdx, i));
          }
          startIdx = i + codeLen;
          i += codeLen - 1;
        }
      }
    }
    if (startIdx !== -1 && startIdx < esData.length) {
      nalUnits.push(esData.subarray(startIdx));
    }
    if (nalUnits.length === 0) return null;
    let isKeyframe = false;
    let sampleLength = 0;
    const sampleNals = [];
    for (const nal of nalUnits) {
      if (nal.length === 0) continue;
      const nalType = nal[0] & 31;
      if (nalType === 7) {
        this.sps = nal;
        this.updateAvcMetadata();
      } else if (nalType === 8) {
        this.pps = nal;
        this.updateAvcMetadata();
      } else if (nalType === 5) {
        isKeyframe = true;
        if (this.sps) {
          sampleNals.push(this.sps);
          sampleLength += 4 + this.sps.length;
        }
        if (this.pps) {
          sampleNals.push(this.pps);
          sampleLength += 4 + this.pps.length;
        }
        sampleNals.push(nal);
        sampleLength += 4 + nal.length;
      } else if (nalType === 1) {
        sampleNals.push(nal);
        sampleLength += 4 + nal.length;
      }
    }
    if (sampleNals.length === 0) return null;
    const sampleData = new Uint8Array(sampleLength);
    let pos = 0;
    const view2 = new DataView(sampleData.buffer);
    for (const nal of sampleNals) {
      view2.setUint32(pos, nal.length, false);
      sampleData.set(nal, pos + 4);
      pos += 4 + nal.length;
    }
    return [
      {
        data: sampleData,
        isKeyframe,
        ptsTicks,
        dtsTicks
      }
    ];
  }
  updateAvcMetadata() {
    if (!this.sps || this.sps.length < 4) return;
    const profileIdc = this.sps[1];
    const profileCompat = this.sps[2];
    const levelIdc = this.sps[3];
    const pps = this.pps || new Uint8Array([104, 206, 60, 128]);
    const avcLen = 11 + this.sps.length + pps.length;
    const avc = new Uint8Array(avcLen);
    avc[0] = 1;
    avc[1] = profileIdc;
    avc[2] = profileCompat;
    avc[3] = levelIdc;
    avc[4] = 255;
    avc[5] = 225;
    avc[6] = this.sps.length >> 8 & 255;
    avc[7] = this.sps.length & 255;
    avc.set(this.sps, 8);
    const ppsOffset = 8 + this.sps.length;
    avc[ppsOffset] = 1;
    avc[ppsOffset + 1] = pps.length >> 8 & 255;
    avc[ppsOffset + 2] = pps.length & 255;
    avc.set(pps, ppsOffset + 3);
    const codec = `avc1.${profileIdc.toString(16).padStart(2, "0")}${profileCompat.toString(16).padStart(2, "0")}${levelIdc.toString(16).padStart(2, "0")}`;
    this.metadata.video = {
      codec,
      width: this.metadata.video?.width || 1280,
      height: this.metadata.video?.height || 720,
      sps: this.sps,
      pps: this.pps || void 0,
      avcDescription: avc
    };
  }
  flushAudioPes() {
    if (this.audioPesBuffer.length === 0) return null;
    const total = new Uint8Array(this.audioPesLength);
    let off = 0;
    for (const b of this.audioPesBuffer) {
      total.set(b, off);
      off += b.length;
    }
    this.audioPesBuffer = [];
    this.audioPesLength = 0;
    return this.parseAudioPES(total);
  }
  parseAudioPES(data) {
    if (data.length < 9) return null;
    if (data[0] !== 0 || data[1] !== 0 || data[2] !== 1) return null;
    const ptsDtsFlags = (data[7] & 192) >> 6;
    const headerDataLen = data[8];
    let ptsTicks = 0;
    if (ptsDtsFlags >= 2 && headerDataLen >= 5 && data.length >= 14) {
      ptsTicks = (data[9] & 14) << 29 | data[10] << 22 | (data[11] & 254) << 14 | data[12] << 7 | (data[13] & 254) >> 1;
    }
    const payloadOffset = 9 + headerDataLen;
    if (payloadOffset >= data.length) return null;
    const esData = data.subarray(payloadOffset);
    return this.parseADTS(esData, ptsTicks);
  }
  parseADTS(data, basePtsTicks) {
    const samples = [];
    let offset = 0;
    let currentPts = basePtsTicks;
    while (offset + 7 <= data.length) {
      if (data[offset] !== 255 || (data[offset + 1] & 240) !== 240) {
        offset++;
        continue;
      }
      const profile = ((data[offset + 2] & 192) >> 6) + 1;
      const freqIdx = (data[offset + 2] & 60) >> 2;
      const channelCount = (data[offset + 2] & 1) << 2 | (data[offset + 3] & 192) >> 6;
      const frameLength = (data[offset + 3] & 3) << 11 | data[offset + 4] << 3 | (data[offset + 5] & 224) >> 5;
      const protectionAbsent = (data[offset + 1] & 1) !== 0;
      const headerLength = protectionAbsent ? 7 : 9;
      if (offset + frameLength > data.length || frameLength <= headerLength) {
        break;
      }
      const sampleRate = AAC_SAMPLE_RATES[freqIdx] || 44100;
      if (!this.metadata.audio) {
        const audioDesc = new Uint8Array(2);
        audioDesc[0] = profile << 3 | freqIdx >> 1;
        audioDesc[1] = (freqIdx & 1) << 7 | channelCount << 3;
        this.metadata.audio = {
          codec: "mp4a.40.2",
          sampleRate,
          channelCount,
          profile,
          audioDescription: audioDesc
        };
      }
      const rawAac = data.subarray(offset + headerLength, offset + frameLength);
      samples.push({
        data: rawAac,
        ptsTicks: currentPts,
        dtsTicks: currentPts
      });
      const durationTicks = Math.round(1024 * 9e4 / sampleRate);
      currentPts += durationTicks;
      offset += frameLength;
    }
    return samples;
  }
};

// ../frontend/src/packages/media-engine/hls/timeline.ts
var MPEG_CLOCK_HZ = 9e4;
var ROLLOVER_THRESHOLD_TICKS = 4294967296;
var MAX_33BIT_TICKS = 8589934592;
var HLSTimelineManager = class {
  constructor() {
    this.initialDtsTicks = null;
    this.lastPtsTicks = 0;
    this.rolloverOffsetTicks = 0;
    // Discontinuity rebasing
    this.timelineBaseUs = 0;
    this.lastOutputDtsUs = -1;
    this.lastOutputPtsUs = -1;
    this.lastDurationUs = 0;
    this.isFirstSample = true;
  }
  /**
   * Called when an #EXT-X-DISCONTINUITY boundary is encountered in the playlist.
   * Rebases the timeline so that subsequent samples continue smoothly without
   * overlapping previous samples or jumping unpredictably.
   */
  signalDiscontinuity(expectedPreviousDurationUs) {
    const fallbackStepUs = this.lastDurationUs || 33333;
    const nextBaseUs = Math.max(
      this.lastOutputDtsUs + (expectedPreviousDurationUs || fallbackStepUs),
      this.lastOutputPtsUs + fallbackStepUs,
      0
    );
    this.timelineBaseUs = nextBaseUs;
    this.initialDtsTicks = null;
    this.lastPtsTicks = 0;
    this.rolloverOffsetTicks = 0;
  }
  /**
   * Normalizes a raw 90kHz MPEG PTS/DTS pair into continuous microseconds.
   * Handles 33-bit rollover and offsets.
   */
  normalizeTicks(rawPtsTicks, rawDtsTicks) {
    let pts = rawPtsTicks;
    let dts = rawDtsTicks !== void 0 ? rawDtsTicks : rawPtsTicks;
    if (this.lastPtsTicks > 0 && this.lastPtsTicks - pts > ROLLOVER_THRESHOLD_TICKS) {
      this.rolloverOffsetTicks += MAX_33BIT_TICKS;
    }
    pts += this.rolloverOffsetTicks;
    dts += this.rolloverOffsetTicks;
    this.lastPtsTicks = rawPtsTicks;
    return { ptsTicks: pts, dtsTicks: dts };
  }
  /**
   * Normalizes sample timing, ensuring monotonic DTS and valid CTS offsets.
   */
  processSampleTiming(rawPtsTicks, rawDtsTicks, durationTicks, fallbackDurationUs = 33333) {
    const { ptsTicks, dtsTicks } = this.normalizeTicks(rawPtsTicks, rawDtsTicks);
    const durationUs = durationTicks ? Math.round(durationTicks / MPEG_CLOCK_HZ * 1e6) : fallbackDurationUs;
    if (this.initialDtsTicks === null) {
      this.initialDtsTicks = dtsTicks;
    }
    const relPtsTicks = ptsTicks - this.initialDtsTicks;
    const relDtsTicks = dtsTicks - this.initialDtsTicks;
    let ptsUs = this.timelineBaseUs + Math.round(relPtsTicks / MPEG_CLOCK_HZ * 1e6);
    let dtsUs = this.timelineBaseUs + Math.round(relDtsTicks / MPEG_CLOCK_HZ * 1e6);
    if (this.isFirstSample) {
      if (dtsUs < 0) {
        const offset = -dtsUs;
        ptsUs += offset;
        dtsUs = 0;
      }
      this.isFirstSample = false;
    } else {
      if (dtsUs <= this.lastOutputDtsUs) {
        const stepUs = Math.max(1e3, durationUs > 0 ? durationUs : 16666);
        dtsUs = this.lastOutputDtsUs + stepUs;
      }
    }
    if (ptsUs < dtsUs) {
      ptsUs = dtsUs;
    }
    const compositionTimeOffsetUs = ptsUs - dtsUs;
    this.lastOutputDtsUs = dtsUs;
    this.lastOutputPtsUs = ptsUs;
    this.lastDurationUs = durationUs;
    return {
      ptsUs,
      dtsUs,
      durationUs,
      compositionTimeOffsetUs
    };
  }
  reset() {
    this.initialDtsTicks = null;
    this.lastPtsTicks = 0;
    this.rolloverOffsetTicks = 0;
    this.timelineBaseUs = 0;
    this.lastOutputDtsUs = -1;
    this.lastOutputPtsUs = -1;
    this.lastDurationUs = 0;
    this.isFirstSample = true;
  }
};

// ../frontend/src/packages/media-engine/hls/hlsEngine.ts
var HLSEngineError = class extends Error {
  constructor(message, code) {
    super(message);
    this.name = "HLSEngineError";
    this.code = code;
  }
};
var HLSEngine = class {
  /**
   * Main entry point to execute an in-browser HLS download.
   */
  static async execute(options) {
    const {
      manifest,
      hlsStream,
      sink,
      apiBaseUrl = "",
      authHeaders = {},
      signal,
      onProgress
    } = options;
    if (signal?.aborted) {
      throw new HLSEngineError("Download was aborted before starting", "CANCELLED");
    }
    if (onProgress) {
      onProgress({
        stage: "preparing",
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: hlsStream.filesize || 0,
        message: "Resolving HLS playlist..."
      });
    }
    let playlistUrl = hlsStream.url;
    let initialPlaylistText;
    initialPlaylistText = await this.fetchResourceWithAuth({
      jobId: manifest.job_id,
      formatId: hlsStream.format_id,
      targetUrl: playlistUrl,
      targetHost: hlsStream.host,
      resourceType: "playlist",
      relayRequired: !!hlsStream.relay_required,
      apiBaseUrl,
      authHeaders,
      maxBytes: MAX_HLS_PLAYLIST_BYTES,
      signal
    });
    let playlist = parseHLSPlaylist(initialPlaylistText, playlistUrl);
    if (playlist.type === "master") {
      const selectedVariant = selectHLSVariant(playlist.variants);
      playlistUrl = selectedVariant.uri;
      if (onProgress) {
        onProgress({
          stage: "preparing",
          progressPercent: 2,
          downloadedBytes: 0,
          totalBytes: hlsStream.filesize || 0,
          message: `Selected variant ${selectedVariant.resolution?.width || ""}x${selectedVariant.resolution?.height || ""} (${selectedVariant.bandwidth} bps)...`
        });
      }
      const mediaPlaylistHost = new URL(playlistUrl).hostname;
      const mediaPlaylistText = await this.fetchResourceWithAuth({
        jobId: manifest.job_id,
        formatId: hlsStream.format_id,
        targetUrl: playlistUrl,
        targetHost: mediaPlaylistHost,
        resourceType: "playlist",
        relayRequired: !!hlsStream.relay_required,
        apiBaseUrl,
        authHeaders,
        maxBytes: MAX_HLS_PLAYLIST_BYTES,
        signal
      });
      playlist = parseHLSPlaylist(mediaPlaylistText, playlistUrl);
    }
    if (!playlist.endlist) {
      throw new HLSEngineError(
        "Live or infinite HLS stream (missing #EXT-X-ENDLIST) is unsupported in VOD Phase 3",
        "UNSUPPORTED_LIVE_STREAM"
      );
    }
    const segments = playlist.segments;
    if (segments.length === 0) {
      throw new HLSEngineError("Media playlist contains 0 playable segments", "INVALID_PLAYLIST");
    }
    const decryptor = new AES128Decryptor();
    const tsDemuxer = new MPEGTSDemuxer();
    const videoTimeline = new HLSTimelineManager();
    const audioTimeline = new HLSTimelineManager();
    const keyCache = /* @__PURE__ */ new Map();
    let totalBytesWritten = 0;
    let muxer = null;
    let firstVideoChunk = true;
    let avcDescription = null;
    const initMuxer = (meta) => {
      if (muxer) return;
      const videoMeta = meta.video;
      const audioMeta = meta.audio;
      if (!videoMeta && !audioMeta) return;
      avcDescription = videoMeta?.avcDescription || null;
      muxer = new Muxer({
        target: new StreamTarget({
          onData: (chunk, position) => {
            sink.write(chunk);
            totalBytesWritten += chunk.byteLength;
          }
        }),
        video: videoMeta ? {
          codec: "avc",
          width: videoMeta.width || 1280,
          height: videoMeta.height || 720
        } : void 0,
        audio: audioMeta ? {
          codec: "aac",
          numberOfChannels: audioMeta.channelCount || 2,
          sampleRate: audioMeta.sampleRate || 44100
        } : void 0,
        fastStart: "fragmented",
        firstTimestampBehavior: "cross-track-offset"
      });
    };
    let completedSegments = 0;
    const totalSegments = segments.length;
    let currentIndex = 0;
    const estTotalBytes = (hlsStream.filesize || 0) > 0 ? hlsStream.filesize : totalSegments * 1024 * 1024;
    while (currentIndex < totalSegments) {
      if (signal?.aborted) {
        throw new HLSEngineError("Download aborted by user", "CANCELLED");
      }
      const batchEnd = Math.min(currentIndex + MAX_HLS_CONCURRENT_SEGMENTS, totalSegments);
      const batchSegments = segments.slice(currentIndex, batchEnd);
      const batchData = await Promise.all(
        batchSegments.map(async (seg) => {
          let rawKeyBytes;
          if (seg.key && seg.key.method === "AES-128" && seg.key.uri) {
            if (keyCache.has(seg.key.uri)) {
              rawKeyBytes = keyCache.get(seg.key.uri);
            } else {
              const keyHost = new URL(seg.key.uri).hostname;
              const keyRaw = await this.fetchResourceWithAuth({
                jobId: manifest.job_id,
                formatId: hlsStream.format_id,
                targetUrl: seg.key.uri,
                targetHost: keyHost,
                resourceType: "key",
                relayRequired: !!hlsStream.relay_required,
                apiBaseUrl,
                authHeaders,
                maxBytes: MAX_HLS_KEY_BYTES,
                signal,
                asBinary: true
              });
              rawKeyBytes = new Uint8Array(keyRaw);
              keyCache.set(seg.key.uri, rawKeyBytes);
            }
          }
          const segHost = new URL(seg.uri).hostname;
          let rangeHeader;
          if (seg.byteRange) {
            rangeHeader = `bytes=${seg.byteRange.offset}-${seg.byteRange.offset + seg.byteRange.length - 1}`;
          }
          const segBuffer = await this.fetchResourceWithAuth({
            jobId: manifest.job_id,
            formatId: hlsStream.format_id,
            targetUrl: seg.uri,
            targetHost: segHost,
            resourceType: "segment",
            relayRequired: !!hlsStream.relay_required,
            rangeHeader,
            apiBaseUrl,
            authHeaders,
            maxBytes: MAX_HLS_SEGMENT_BYTES,
            signal,
            asBinary: true
          });
          let segmentBytes = new Uint8Array(segBuffer);
          if (seg.key && seg.key.method === "AES-128" && rawKeyBytes) {
            segmentBytes = await decryptor.decryptSegment(
              segmentBytes,
              seg.key,
              rawKeyBytes,
              seg.index
            );
          }
          return { segment: seg, bytes: segmentBytes };
        })
      );
      for (const item of batchData) {
        if (signal?.aborted) {
          throw new HLSEngineError("Download aborted by user", "CANCELLED");
        }
        const seg = item.segment;
        const segmentBytes = item.bytes;
        if (seg.discontinuity) {
          videoTimeline.signalDiscontinuity(seg.duration * 1e6);
          audioTimeline.signalDiscontinuity(seg.duration * 1e6);
        }
        const { videoSamples, audioSamples } = tsDemuxer.demuxSegment(segmentBytes);
        if (!muxer && (tsDemuxer.metadata.video || tsDemuxer.metadata.audio)) {
          initMuxer(tsDemuxer.metadata);
        }
        if (muxer) {
          for (const vs of videoSamples) {
            const timing = videoTimeline.processSampleTiming(vs.ptsTicks, vs.dtsTicks);
            const meta = firstVideoChunk && tsDemuxer.metadata.video ? {
              decoderConfig: {
                codec: tsDemuxer.metadata.video.codec,
                description: avcDescription || tsDemuxer.metadata.video.avcDescription,
                codedWidth: tsDemuxer.metadata.video.width,
                codedHeight: tsDemuxer.metadata.video.height
              }
            } : void 0;
            firstVideoChunk = false;
            muxer.addVideoChunkRaw(
              vs.data,
              vs.isKeyframe ? "key" : "delta",
              timing.ptsUs,
              timing.durationUs,
              meta,
              timing.compositionTimeOffsetUs
            );
          }
          for (const as of audioSamples) {
            const timing = audioTimeline.processSampleTiming(as.ptsTicks, as.dtsTicks);
            muxer.addAudioChunkRaw(
              as.data,
              "key",
              timing.ptsUs,
              timing.durationUs
            );
          }
        }
        completedSegments++;
        if (onProgress) {
          const progressPercent = Math.min(99, Math.round(completedSegments / totalSegments * 100));
          onProgress({
            stage: "muxing",
            progressPercent,
            downloadedBytes: totalBytesWritten,
            totalBytes: estTotalBytes,
            message: `Processing segment ${completedSegments}/${totalSegments}...`
          });
        }
      }
      currentIndex = batchEnd;
    }
    if (muxer) {
      muxer.finalize();
    }
    decryptor.clear();
    return totalBytesWritten;
  }
  /**
   * Fetches an authorized resource (playlist, key, or segment), either directly or via
   * the signed Cloudflare Worker relay.
   */
  static async fetchResourceWithAuth(options) {
    const {
      jobId,
      formatId,
      targetUrl,
      targetHost,
      resourceType,
      relayRequired,
      rangeHeader,
      apiBaseUrl,
      authHeaders,
      signal,
      asBinary = false
    } = options;
    let fetchUrl = targetUrl;
    const fetchHeaders = {};
    if (rangeHeader) {
      fetchHeaders["Range"] = rangeHeader;
    }
    if (relayRequired) {
      try {
        const ticketRes = await fetch(`${apiBaseUrl}/api/downloads/${jobId}/ticket`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            format_id: formatId,
            host: targetHost,
            target_url: targetUrl,
            ticket_type: resourceType
          }),
          signal
        }).then((r) => r.json());
        if (ticketRes?.relay_url) {
          fetchUrl = ticketRes.relay_url;
        }
      } catch (err) {
        if (signal?.aborted) throw new HLSEngineError("Aborted during ticket acquisition", "CANCELLED");
        throw new HLSEngineError(`Ticket acquisition failed for ${resourceType}: ${err.message}`, "TICKET_INVALID");
      }
    }
    let attempts = 0;
    let lastError = null;
    while (attempts < MAX_HLS_RETRIES) {
      if (signal?.aborted) {
        throw new HLSEngineError("Download aborted", "CANCELLED");
      }
      try {
        const res = await fetch(fetchUrl, {
          method: "GET",
          headers: fetchHeaders,
          signal
        });
        if (res.status === 403) {
          const bodyText = await res.text().catch(() => "");
          throw new HLSEngineError(`Access forbidden: ${bodyText}`, "TICKET_INVALID");
        }
        if (res.status === 404) {
          throw new HLSEngineError(`Resource not found: ${fetchUrl}`, "INVALID_SEGMENT");
        }
        if (res.status === 416) {
          throw new HLSEngineError("Oversized resource or invalid range requested", "SEGMENT_TOO_LARGE");
        }
        if (!res.ok && res.status !== 206) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return asBinary ? await res.arrayBuffer() : await res.text();
      } catch (err) {
        if (signal?.aborted) throw new HLSEngineError("Download aborted", "CANCELLED");
        if (err instanceof HLSEngineError) throw err;
        lastError = err;
        attempts++;
        if (attempts < MAX_HLS_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, HLS_RETRY_BACKOFF_MS * attempts));
        }
      }
    }
    throw new HLSEngineError(
      `Failed to fetch ${resourceType} after ${MAX_HLS_RETRIES} attempts: ${lastError?.message}`,
      "NETWORK_EXHAUSTED"
    );
  }
};

// ../frontend/src/packages/media-engine/index.ts
var MediaEngine = class {
  /**
   * Evaluates strategy and executes client-first media download when possible.
   * Returns EngineDownloadResult if handled client-side.
   * Returns null if strategy is SERVER_FALLBACK or UNSUPPORTED.
   */
  static async execute(options) {
    const {
      manifest,
      targetFormatId,
      targetFormatType = "video",
      apiBaseUrl = "",
      authHeaders = {},
      signal,
      onProgress
    } = options;
    const decision = evaluateClientStrategy(
      manifest,
      targetFormatId,
      targetFormatType
    );
    if (decision.strategy === "SERVER_FALLBACK" || decision.strategy === "UNSUPPORTED") {
      return null;
    }
    if (onProgress) {
      onProgress({
        stage: "preparing",
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: decision.estimated_bytes,
        message: `Executing ${decision.strategy}...`
      });
    }
    const targetStream = decision.progressive_stream || decision.video_stream || decision.audio_stream || decision.hls_stream;
    if (!targetStream) {
      return null;
    }
    const title = manifest.source.title || "video";
    const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "download";
    const ext = (decision.strategy === "BROWSER_HLS" ? "mp4" : targetStream.container) || (targetFormatType === "audio" ? "mp3" : "mp4");
    const filename = `${safeTitle}.${ext}`;
    const caps = detectCapabilities();
    let sink;
    let deliveryMode = "direct_progressive";
    if (options.sink) {
      sink = options.sink;
      deliveryMode = "extension_download";
    } else if (caps.fsa_supported) {
      sink = new FileSystemAccessSink();
      deliveryMode = "direct_fsa";
    } else if (caps.opfs_supported) {
      sink = new OPFSSink();
      deliveryMode = "direct_opfs";
    } else {
      sink = new BlobSink();
      deliveryMode = "direct_blob";
    }
    await sink.open(filename, targetStream.filesize);
    let downloadedBytes = 0;
    try {
      if (decision.strategy === "BROWSER_HLS" && decision.hls_stream) {
        downloadedBytes = await HLSEngine.execute({
          manifest,
          hlsStream: decision.hls_stream,
          sink,
          apiBaseUrl,
          authHeaders,
          signal,
          onProgress
        });
        deliveryMode = "browser_hls";
      } else if (decision.video_stream && decision.audio_stream && (decision.strategy === "SIGNED_WORKER_RANGE" || decision.strategy === "BROWSER_ADAPTIVE_MUX")) {
        let videoUrl = decision.video_stream.url;
        let audioUrl = decision.audio_stream.url;
        const videoHeaders = decision.video_stream.headers_required || {};
        const audioHeaders = decision.audio_stream.headers_required || {};
        if (decision.ticket_required || decision.video_stream.relay_required || decision.audio_stream.relay_required) {
          const [vTicketRes, aTicketRes] = await Promise.all([
            fetch(`${apiBaseUrl}/api/downloads/${manifest.job_id}/ticket`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authHeaders },
              body: JSON.stringify({
                format_id: decision.video_stream.format_id,
                host: decision.video_stream.host,
                target_url: decision.video_stream.url
              })
            }).then((r) => r.json()).catch(() => null),
            fetch(`${apiBaseUrl}/api/downloads/${manifest.job_id}/ticket`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authHeaders },
              body: JSON.stringify({
                format_id: decision.audio_stream.format_id,
                host: decision.audio_stream.host,
                target_url: decision.audio_stream.url
              })
            }).then((r) => r.json()).catch(() => null)
          ]);
          if (vTicketRes?.relay_url) videoUrl = vTicketRes.relay_url;
          if (aTicketRes?.relay_url) audioUrl = aTicketRes.relay_url;
        }
        const isWebM = decision.video_stream.container === "webm" || decision.video_stream.codec?.toLowerCase().includes("vp9") || decision.video_stream.codec?.toLowerCase().includes("vp09") || decision.video_stream.codec?.toLowerCase().includes("av1") || decision.video_stream.codec?.toLowerCase().includes("av01") || decision.audio_stream.codec?.toLowerCase().includes("opus");
        if (isWebM) {
          downloadedBytes = await StreamingWebMMuxer.remux({
            video: { url: videoUrl, totalBytes: decision.video_stream.filesize, headers: videoHeaders },
            audio: { url: audioUrl, totalBytes: decision.audio_stream.filesize, headers: audioHeaders },
            sink,
            signal,
            onProgress
          });
        } else {
          downloadedBytes = await StreamingMP4Muxer.remux({
            video: { url: videoUrl, totalBytes: decision.video_stream.filesize, headers: videoHeaders },
            audio: { url: audioUrl, totalBytes: decision.audio_stream.filesize, headers: audioHeaders },
            sink,
            signal,
            onProgress
          });
        }
        deliveryMode = decision.strategy === "SIGNED_WORKER_RANGE" ? "signed_worker_remux" : "browser_remux";
      } else {
        let streamUrl = targetStream.url;
        if (decision.strategy === "SIGNED_WORKER_RANGE" || decision.ticket_required || targetStream.relay_required) {
          try {
            const ticketRes = await fetch(`${apiBaseUrl}/api/downloads/${manifest.job_id}/ticket`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authHeaders },
              body: JSON.stringify({
                format_id: targetStream.format_id,
                host: targetStream.host,
                target_url: targetStream.url
              })
            }).then((r) => r.json());
            if (ticketRes?.relay_url) {
              streamUrl = ticketRes.relay_url;
            }
          } catch {
          }
          deliveryMode = "signed_worker_range";
        }
        downloadedBytes = await fetchStreamWithRange({
          url: streamUrl,
          totalBytes: targetStream.filesize,
          headers: targetStream.headers_required,
          signal,
          onProgress,
          sink,
          stageName: "fetching"
        });
      }
      const fileResult = await sink.close();
      if (downloadedBytes === 0) {
        throw new Error("MEDIA_INTEGRITY: FAIL_ZERO_BYTES (Download operation wrote 0 bytes to media sink)");
      }
      let blobUrl;
      if (fileResult instanceof Blob) {
        blobUrl = URL.createObjectURL(fileResult);
        if (options.autoTriggerBrowserDownload !== false && typeof document !== "undefined") {
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      }
      if (apiBaseUrl) {
        try {
          await fetch(`${apiBaseUrl}/api/downloads/${manifest.job_id}/complete`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeaders
            },
            body: JSON.stringify({
              format_id: targetFormatId,
              delivery_mode: deliveryMode,
              bytes_downloaded: downloadedBytes
            })
          });
        } catch {
        }
      }
      if (onProgress) {
        onProgress({
          stage: "complete",
          progressPercent: 100,
          downloadedBytes,
          totalBytes: downloadedBytes,
          speedFormatted: "Done",
          etaFormatted: "Complete",
          message: "Download completed successfully",
          downloadUrl: blobUrl,
          blob: fileResult instanceof Blob ? fileResult : void 0
        });
      }
      return {
        jobId: manifest.job_id,
        filename,
        totalBytes: downloadedBytes,
        deliveryMode,
        downloadUrl: blobUrl,
        blob: fileResult instanceof Blob ? fileResult : void 0
      };
    } catch (err) {
      await sink.abort();
      throw err;
    }
  }
};

// src/storage/extension-download-sink.ts
var ExtensionDownloadSink = class {
  fileHandle = null;
  writable = null;
  filename = "";
  mimeType = "video/mp4";
  isOpfs = false;
  blobUrl = null;
  fileBlob = null;
  async open(filename, expectedSize, mimeType) {
    this.filename = filename;
    this.mimeType = mimeType || "video/mp4";
    this.blobUrl = null;
    this.fileBlob = null;
    this.isOpfs = false;
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
      throw new Error("OPFS_UNAVAILABLE: Origin Private File System is not supported in this runtime environment");
    }
    try {
      const root = await navigator.storage.getDirectory();
      this.fileHandle = await root.getFileHandle(filename, { create: true });
      this.writable = await this.fileHandle.createWritable();
      this.isOpfs = true;
    } catch (err) {
      this.isOpfs = false;
      throw new Error(`OPFS_UNAVAILABLE: Failed to initialize OPFS storage for "${filename}": ${err?.message || err}`);
    }
  }
  async write(chunk) {
    if (!this.isOpfs || !this.writable) {
      throw new Error("ExtensionDownloadSink: Sink is not open for writing");
    }
    await this.writable.write(chunk);
  }
  async close() {
    if (!this.isOpfs || !this.writable) {
      throw new Error("ExtensionDownloadSink: Sink was not open or already closed");
    }
    await this.writable.close();
    this.writable = null;
    if (this.fileHandle) {
      this.fileBlob = await this.fileHandle.getFile();
      if (this.fileBlob && typeof URL !== "undefined" && URL.createObjectURL) {
        this.blobUrl = URL.createObjectURL(this.fileBlob);
      }
      return this.fileBlob;
    }
    throw new Error("ExtensionDownloadSink: File handle unavailable upon closing");
  }
  getBlobUrl() {
    return this.blobUrl;
  }
  getBlob() {
    return this.fileBlob;
  }
  async abort() {
    if (this.writable) {
      try {
        await this.writable.abort();
      } catch {
      }
      this.writable = null;
    }
    await this.cleanup();
  }
  async cleanup() {
    if (this.blobUrl && typeof URL !== "undefined" && URL.revokeObjectURL) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    if (this.isOpfs && this.filename && typeof navigator !== "undefined" && navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(this.filename);
      } catch {
      }
    }
    this.fileHandle = null;
    this.fileBlob = null;
    this.isOpfs = false;
  }
};

// src/offscreen/offscreen.ts
console.log("[NEXUS Offscreen] Initialized and listening for media processing requests");
var activeAbortController = null;
var currentSink = null;
var currentJobId = null;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;
  if (message.type === "PING") {
    sendResponse({ type: "PONG", timestamp: Date.now() });
    return false;
  }
  if (message.type === "START_DOWNLOAD") {
    handleStartDownload(message.payload);
    sendResponse({ status: "started" });
    return false;
  }
  if (message.type === "START_DIRECT_ACQUISITION") {
    handleStartDirectAcquisition(message.payload);
    sendResponse({ status: "started" });
    return false;
  }
  if (message.type === "PROCESS_PLAYBACK_CAPTURE_FFMPEG") {
    handleProcessPlaybackCaptureFfmpeg(message.payload).then((res) => sendResponse({ status: "complete", result: res })).catch((err) => sendResponse({ status: "error", error: err?.message || "FFmpeg processing failed" }));
    return true;
  }
  if (message.type === "DOWNLOAD_CANCEL") {
    handleCancelDownload(message.payload);
    sendResponse({ status: "cancelling" });
    return false;
  }
  return false;
});
async function handleStartDownload(payload) {
  const { jobId, manifest, targetFormatId, targetFormatType, apiBaseUrl, authHeaders } = payload;
  currentJobId = jobId;
  activeAbortController = new AbortController();
  currentSink = new ExtensionDownloadSink();
  try {
    console.log(`[NEXUS Offscreen] Starting download job ${jobId} for format ${targetFormatId}`);
    const result = await MediaEngine.execute({
      manifest,
      targetFormatId,
      targetFormatType: targetFormatType || "video",
      apiBaseUrl,
      authHeaders,
      signal: activeAbortController.signal,
      sink: currentSink,
      autoTriggerBrowserDownload: false,
      onProgress: (progress) => {
        chrome.runtime.sendMessage({
          type: "DOWNLOAD_PROGRESS",
          payload: {
            jobId,
            ...progress
          }
        }).catch(() => {
        });
      }
    });
    if (!result) {
      throw new Error("MediaEngine returned null (unsupported client strategy or server fallback required)");
    }
    const blobUrl = currentSink.getBlobUrl() || result.downloadUrl;
    window.__LAST_DOWNLOAD_RESULT__ = {
      jobId,
      filename: result.filename,
      totalBytes: result.totalBytes,
      deliveryMode: result.deliveryMode,
      blobUrl,
      blob: currentSink.getBlob() || result.blob
    };
    console.log(`[NEXUS Offscreen] Job ${jobId} completed successfully. Generated blobUrl: ${blobUrl}`);
    chrome.runtime.sendMessage({
      type: "DOWNLOAD_COMPLETE",
      payload: {
        jobId,
        filename: result.filename,
        totalBytes: result.totalBytes,
        deliveryMode: result.deliveryMode,
        blobUrl
      }
    }).catch((err) => {
      console.error("[NEXUS Offscreen] Failed to dispatch DOWNLOAD_COMPLETE message:", err);
    });
  } catch (err) {
    const isAbort = err.name === "AbortError" || err.message?.includes("aborted");
    console.error(`[NEXUS Offscreen] Job ${jobId} failed (abort=${isAbort}):`, err);
    if (currentSink) {
      try {
        await currentSink.abort();
      } catch {
      }
    }
    if (!isAbort) {
      chrome.runtime.sendMessage({
        type: "DOWNLOAD_FAILED",
        payload: {
          jobId,
          error: err.message || "Media processing error",
          code: err.code || "PROCESSING_FAILED"
        }
      }).catch(() => {
      });
    }
  } finally {
    activeAbortController = null;
    currentJobId = null;
  }
}
async function handleCancelDownload(payload) {
  const { jobId } = payload;
  if (currentJobId === jobId && activeAbortController) {
    console.log(`[NEXUS Offscreen] Aborting active job ${jobId}`);
    activeAbortController.abort();
    if (currentSink) {
      try {
        await currentSink.abort();
      } catch {
      }
    }
  }
}
async function handleStartDirectAcquisition(payload) {
  const { sessionId, streamUrl, targetFilename, expectedBytes, mimeType } = payload;
  currentJobId = sessionId;
  activeAbortController = new AbortController();
  console.log(`[NEXUS Offscreen] Starting direct client acquisition for session ${sessionId}: ${streamUrl.substring(0, 80)}...`);
  chrome.runtime.sendMessage({
    type: "ACQUISITION_STARTED",
    payload: { sessionId, targetFilename }
  }).catch(() => {
  });
  const startTime = Date.now();
  let lastReportTime = startTime;
  let lastReportBytes = 0;
  try {
    const res = await fetch(streamUrl, {
      signal: activeAbortController.signal,
      headers: {
        "Accept": "*/*"
      }
    });
    if (!res.ok) {
      throw new Error(`Upstream acquisition failed with HTTP status ${res.status}: ${res.statusText}`);
    }
    const contentLengthHeader = res.headers.get("content-length");
    const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : expectedBytes || 0;
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("ReadableStream not supported on response body");
    }
    const chunks = [];
    let bytesReceived = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        bytesReceived += value.byteLength;
        const now = Date.now();
        if (now - lastReportTime >= 250) {
          const durationSec = (now - lastReportTime) / 1e3;
          const bytesDelta = bytesReceived - lastReportBytes;
          const speedBps = durationSec > 0 ? bytesDelta / durationSec : 0;
          const speedMb = (speedBps / (1024 * 1024)).toFixed(2);
          const percent = totalBytes > 0 ? Math.min(99.9, bytesReceived / totalBytes * 100) : 0;
          chrome.runtime.sendMessage({
            type: "ACQUISITION_PROGRESS",
            payload: {
              sessionId,
              percent,
              bytesReceived,
              totalBytes,
              speedFormatted: `${speedMb} MB/s`
            }
          }).catch(() => {
          });
          lastReportTime = now;
          lastReportBytes = bytesReceived;
        }
      }
    }
    const contentType = res.headers.get("content-type") || mimeType || "video/mp4";
    const blob = new Blob(chunks, { type: contentType });
    const blobUrl = URL.createObjectURL(blob);
    console.log(`[NEXUS Offscreen] Direct acquisition completed for ${sessionId}. Total: ${bytesReceived} bytes. Generated blob.`);
    window.__LAST_ACQUISITION_RESULT__ = {
      sessionId,
      filename: targetFilename,
      totalBytes: bytesReceived,
      mimeType: contentType,
      blobUrl,
      blob
    };
    chrome.runtime.sendMessage({
      type: "ACQUISITION_COMPLETE",
      payload: {
        sessionId,
        filename: targetFilename,
        totalBytes: bytesReceived,
        mimeType: contentType,
        blobUrl
      }
    }).catch(() => {
    });
  } catch (err) {
    const isAbort = err.name === "AbortError" || err.message?.includes("aborted");
    console.error(`[NEXUS Offscreen] Direct acquisition failed for ${sessionId}:`, err);
    if (!isAbort) {
      chrome.runtime.sendMessage({
        type: "ACQUISITION_FAILED",
        payload: {
          sessionId,
          error: err.message || "Direct browser acquisition failed",
          code: "ACQUISITION_ERROR"
        }
      }).catch(() => {
      });
    }
  } finally {
    activeAbortController = null;
    currentJobId = null;
  }
}
async function handleProcessPlaybackCaptureFfmpeg(payload) {
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
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const inputBytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    inputBytes[i] = binaryString.charCodeAt(i);
  }
  const hashBuffer = await crypto.subtle.digest("SHA-256", inputBytes.buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const ffmpegInputSha256 = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  if (captureSha256 && ffmpegInputSha256 !== captureSha256) {
    throw new Error(`Hash mismatch: captureSha256 (${captureSha256}) !== ffmpegInputSha256 (${ffmpegInputSha256})`);
  }
  console.log(`[NEXUS Offscreen] Verified CAPTURE_BYTES_SHA256 === FFMPEG_INPUT_SHA256: ${ffmpegInputSha256}`);
  chrome.runtime.sendMessage({
    type: "PLAYBACK_CAPTURE_PROGRESS",
    payload: {
      sessionId,
      stage: "processing_ffmpeg",
      percent: 60,
      bytesReceived: inputBytes.byteLength
    }
  }).catch(() => {
  });
  const { FFmpeg: FFmpeg2 } = await Promise.resolve().then(() => (init_esm(), esm_exports));
  const ffmpeg = new FFmpeg2();
  const coreURL = chrome.runtime.getURL("ffmpeg-core.js");
  const wasmURL = chrome.runtime.getURL("ffmpeg-core.wasm");
  const classWorkerURL = chrome.runtime.getURL("ffmpeg-worker.js");
  await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
  await ffmpeg.writeFile("input.webm", inputBytes);
  const execCode = await ffmpeg.exec(["-i", "input.webm", "-c", "copy", "output.webm"]);
  if (execCode !== 0) {
    throw new Error(`FFmpeg remux failed with exit code ${execCode}`);
  }
  const outputData = await ffmpeg.readFile("output.webm");
  const outHashBuffer = await crypto.subtle.digest("SHA-256", outputData.buffer);
  const outHashArray = Array.from(new Uint8Array(outHashBuffer));
  const ffmpegOutputSha256 = outHashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  const outputBlob = new Blob([outputData.buffer], { type: "video/webm" });
  const blobUrl = URL.createObjectURL(outputBlob);
  let verifiedDuration = 0;
  let verifiedWidth = 0;
  let verifiedHeight = 0;
  try {
    const videoEl = document.createElement("video");
    videoEl.preload = "metadata";
    videoEl.src = blobUrl;
    await new Promise((resolve) => {
      videoEl.onloadedmetadata = () => {
        verifiedDuration = videoEl.duration;
        verifiedWidth = videoEl.videoWidth;
        verifiedHeight = videoEl.videoHeight;
        resolve();
      };
      videoEl.onerror = () => resolve();
      setTimeout(() => resolve(), 3e3);
    });
  } catch (e) {
    console.warn("[NEXUS Offscreen] Playback verification notice:", e);
  }
  try {
    await ffmpeg.deleteFile("input.webm");
  } catch {
  }
  try {
    await ffmpeg.deleteFile("output.webm");
  } catch {
  }
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
    mimeType: "video/webm",
    blobUrl,
    downloadStarted: true
  };
  chrome.runtime.sendMessage({
    type: "PLAYBACK_CAPTURE_COMPLETE",
    payload: completeResult
  }).catch(() => {
  });
  return completeResult;
}
//# sourceMappingURL=offscreen.js.map
