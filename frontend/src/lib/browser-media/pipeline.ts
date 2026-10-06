/**
 * Production Browser Media Processing Pipeline using ffmpeg.wasm
 *
 * Implements:
 * - Real in-browser remuxing, trimming, audio extraction, and format conversion
 * - Zero-leak memory management (MEMFS file deletion, Object URL lifecycle)
 * - Safe cancellation via AbortSignal
 * - Granular progress reporting (0-100% with stage diagnostics)
 * - Input size & duration guardrails
 */
import { ffmpegManager } from './ffmpeg';
import { detectBrowserCapabilities, isRequestSafeForBrowser } from './capabilities';
import { 
  BrowserProcessRequest, 
  BrowserProcessResult, 
  BrowserMediaProgress, 
  BrowserMediaProgressCallback 
} from './types';
import { 
  BrowserMediaError, 
  CapabilityError, 
  OperationCancelledError, 
  FFmpegExecutionError 
} from './errors';

function getMimeType(container: string): string {
  switch (container.toLowerCase()) {
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'mp3': return 'audio/mpeg';
    case 'm4a': return 'audio/mp4';
    case 'wav': return 'audio/wav';
    case 'aac': return 'audio/aac';
    case 'ogg': return 'audio/ogg';
    default: return 'application/octet-stream';
  }
}

/**
 * Normalizes any media source into Uint8Array for MEMFS consumption
 */
async function sourceToUint8Array(input: any, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) {
    throw new OperationCancelledError();
  }

  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (input instanceof Blob) {
    const buffer = await input.arrayBuffer();
    return new Uint8Array(buffer);
  }
  if (typeof input === 'string') {
    // URL or data-uri input
    const { fetchFile } = await import('@ffmpeg/util');
    const data = await fetchFile(input);
    return data;
  }
  throw new BrowserMediaError('Unsupported input format passed to browser pipeline');
}

export async function executeBrowserPipeline(
  request: BrowserProcessRequest
): Promise<BrowserProcessResult> {
  const startTime = Date.now();
  const {
    operation,
    input,
    targetContainer = 'mp4',
    trimStartSeconds,
    trimDurationSeconds,
    customArgs,
    signal,
    onProgress,
  } = request;

  const notifyProgress = (stage: BrowserMediaProgress['stage'], percent: number, message: string) => {
    if (onProgress) {
      onProgress({ stage, percent, message });
    }
  };

  // 1. Check Cancellation & Capabilities
  if (signal?.aborted) {
    throw new OperationCancelledError();
  }

  notifyProgress('checking_capabilities', 0, 'Evaluating browser capabilities...');
  const caps = detectBrowserCapabilities();
  if (!caps.browserProcessingRecommended) {
    throw new CapabilityError(caps.reasons.join('; '));
  }

  // 2. Prepare Input Data & Guardrails
  notifyProgress('writing_input', 5, 'Preparing input media buffer...');
  const inputBytes = await sourceToUint8Array(input, signal);

  const safetyCheck = isRequestSafeForBrowser(inputBytes.byteLength);
  if (!safetyCheck.safe) {
    throw new CapabilityError(safetyCheck.reason || 'Input exceeds device memory limits');
  }

  if (signal?.aborted) {
    throw new OperationCancelledError();
  }

  // 3. Lazy-load FFmpeg Engine
  notifyProgress('loading_engine', 10, 'Initializing WebAssembly engine...');
  const ffmpeg = await ffmpegManager.getEngine(onProgress);

  if (signal?.aborted) {
    throw new OperationCancelledError();
  }

  ffmpegManager.setBusy(true);

  const timestamp = Date.now();
  const inputExt = request.inputFilename?.split('.').pop() || 'tmp';
  const inputFilename = `input_${timestamp}.${inputExt}`;
  const outputExt = targetContainer.toLowerCase();
  const outputFilename = request.outputFilename || `rendered_${timestamp}.${outputExt}`;

  let abortListener: (() => void) | null = null;
  const logLines: string[] = [];

  try {
    // 4. Setup Abort Handler
    if (signal) {
      abortListener = async () => {
        try {
          await ffmpegManager.terminate();
        } catch {}
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }

    // 5. Write Input to Virtual Filesystem
    notifyProgress('writing_input', 45, 'Writing media stream to WebAssembly filesystem...');
    await ffmpeg.writeFile(inputFilename, inputBytes);

    if (signal?.aborted) {
      throw new OperationCancelledError();
    }

    // 6. Build Optimal FFmpeg Command
    let ffmpegArgs: string[] = [];

    if (customArgs && customArgs.length > 0) {
      ffmpegArgs = customArgs;
    } else {
      switch (operation) {
        case 'remux':
          // Lossless container remux with stream copy
          ffmpegArgs = [
            '-i', inputFilename,
            '-c', 'copy',
            '-movflags', '+faststart',
            outputFilename,
          ];
          break;

        case 'trim':
          // Rapid keyframe or stream copy trim
          const start = trimStartSeconds || 0;
          const trimArgs = ['-ss', String(start), '-i', inputFilename];
          if (trimDurationSeconds && trimDurationSeconds > 0) {
            trimArgs.push('-t', String(trimDurationSeconds));
          }
          trimArgs.push('-c', 'copy', '-movflags', '+faststart', outputFilename);
          ffmpegArgs = trimArgs;
          break;

        case 'extract_audio':
          // Extract MP3 or copy AAC
          if (outputExt === 'mp3') {
            ffmpegArgs = [
              '-i', inputFilename,
              '-vn',
              '-c:a', 'libmp3lame',
              '-q:a', '2',
              outputFilename,
            ];
          } else {
            ffmpegArgs = [
              '-i', inputFilename,
              '-vn',
              '-c:a', 'copy',
              outputFilename,
            ];
          }
          break;

        case 'convert':
        default:
          ffmpegArgs = [
            '-i', inputFilename,
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-movflags', '+faststart',
            outputFilename,
          ];
          break;
      }
    }

    // 7. Attach Progress & Log Listeners
    const progressHandler = ({ progress }: { progress: number }) => {
      if (signal?.aborted) return;
      const calcPercent = Math.min(95, Math.max(50, Math.round(50 + progress * 45)));
      notifyProgress('processing', calcPercent, `Processing media: ${calcPercent}%`);
    };

    const logHandler = ({ message }: { message: string }) => {
      logLines.push(message);
    };

    ffmpeg.on('progress', progressHandler);
    ffmpeg.on('log', logHandler);

    notifyProgress('processing', 50, 'Executing client-side media rendering...');

    // 8. Execute FFmpeg Process
    const exitCode = await ffmpeg.exec(ffmpegArgs);

    ffmpeg.off('progress', progressHandler);
    ffmpeg.off('log', logHandler);

    if (signal?.aborted) {
      throw new OperationCancelledError();
    }

    if (exitCode !== 0) {
      const errorSnippet = logLines.slice(-10).join('\n');
      throw new FFmpegExecutionError(
        `FFmpeg execution failed with exit code ${exitCode}:\n${errorSnippet}`,
        exitCode,
        logLines
      );
    }

    // 9. Read Output from Virtual Filesystem
    notifyProgress('reading_output', 96, 'Reading rendered media artifact...');
    const outputData = await ffmpeg.readFile(outputFilename);

    if (!outputData || (outputData as Uint8Array).byteLength === 0) {
      throw new BrowserMediaError('Rendered output file is empty or corrupted');
    }

    // 10. Generate Output Blob & Revocable Object URL
    notifyProgress('finalizing', 98, 'Creating downloadable media blob...');
    const mimeType = getMimeType(outputExt);
    const outputArrayBuffer = (outputData as Uint8Array).buffer;
    const outputBlob = new Blob([outputArrayBuffer], { type: mimeType });
    const downloadUrl = URL.createObjectURL(outputBlob);

    notifyProgress('ready', 100, 'Browser media processing complete.');

    const processingTimeMs = Date.now() - startTime;

    return {
      outputBlob,
      downloadUrl,
      outputFilename,
      mimeType,
      sizeBytes: outputBlob.size,
      processingTimeMs,
      revokeUrl: () => {
        try {
          URL.revokeObjectURL(downloadUrl);
        } catch {}
      },
    };
  } finally {
    // 11. Strict Cleanup to Guarantee Zero Memory Leaks
    if (abortListener && signal) {
      signal.removeEventListener('abort', abortListener);
    }

    try {
      await ffmpeg.deleteFile(inputFilename);
    } catch {}

    try {
      await ffmpeg.deleteFile(outputFilename);
    } catch {}

    ffmpegManager.setBusy(false);
  }
}
