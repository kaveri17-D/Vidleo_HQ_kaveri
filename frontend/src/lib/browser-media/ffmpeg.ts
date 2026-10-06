/**
 * Lazy-loaded FFmpeg.wasm Manager Singleton
 *
 * Designed for Next.js:
 * 1. ZERO initial bundle impact: Dynamic imports only load when an operation starts.
 * 2. Single-threaded @ffmpeg/core compatibility: Runs without requiring SharedArrayBuffer
 *    or COOP/COEP isolation headers that could break OAuth popups or CDN assets.
 * 3. Re-use & Lifecycle: Reuses warmed instance during session, cleanly terminates on cancel.
 */
import { EngineLoadError } from './errors';
import { BrowserMediaProgressCallback } from './types';

// Dynamic import type placeholders
type FFmpegType = import('@ffmpeg/ffmpeg').FFmpeg;

class FFmpegManager {
  private static instance: FFmpegManager;
  private ffmpegInstance: FFmpegType | null = null;
  private loadPromise: Promise<FFmpegType> | null = null;
  private isBusyState = false;
  private loaded = false;

  private constructor() {}

  public static getInstance(): FFmpegManager {
    if (!FFmpegManager.instance) {
      FFmpegManager.instance = new FFmpegManager();
    }
    return FFmpegManager.instance;
  }

  public isLoaded(): boolean {
    return this.loaded && this.ffmpegInstance !== null;
  }

  public isBusy(): boolean {
    return this.isBusyState;
  }

  public setBusy(busy: boolean): void {
    this.isBusyState = busy;
  }

  /**
   * Lazy-loads FFmpeg.wasm and initializes the core WebAssembly binary
   */
  public async getEngine(onProgress?: BrowserMediaProgressCallback): Promise<FFmpegType> {
    if (this.ffmpegInstance && this.loaded) {
      return this.ffmpegInstance;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = (async () => {
      try {
        if (typeof window === 'undefined') {
          throw new EngineLoadError('Cannot initialize FFmpeg WebAssembly in SSR environment');
        }

        if (onProgress) {
          onProgress({
            stage: 'loading_engine',
            percent: 5,
            message: 'Loading WebAssembly media engine packages...',
          });
        }

        // 1. Dynamic imports to keep initial bundle clean
        const { FFmpeg } = await import('@ffmpeg/ffmpeg');
        const { toBlobURL } = await import('@ffmpeg/util');

        const ffmpeg = new FFmpeg();

        if (onProgress) {
          onProgress({
            stage: 'loading_engine',
            percent: 15,
            message: 'Fetching WebAssembly core binaries...',
          });
        }

        // 2. Base URLs for single-threaded @ffmpeg/core (CORS friendly, no COOP/COEP required)
        const primaryBase = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
        const fallbackBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
        const ffmpegPkgBase = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/esm';

        let coreBlobUrl = '';
        let wasmBlobUrl = '';
        let workerBlobUrl = '';

        try {
          coreBlobUrl = await toBlobURL(`${primaryBase}/ffmpeg-core.js`, 'text/javascript');
          wasmBlobUrl = await toBlobURL(`${primaryBase}/ffmpeg-core.wasm`, 'application/wasm');
          workerBlobUrl = await toBlobURL(`${ffmpegPkgBase}/worker.js`, 'text/javascript');
        } catch (cdnErr) {
          console.warn('[FFmpegManager] Primary CDN load failed, falling back to jsdelivr:', cdnErr);
          coreBlobUrl = await toBlobURL(`${fallbackBase}/ffmpeg-core.js`, 'text/javascript');
          wasmBlobUrl = await toBlobURL(`${fallbackBase}/ffmpeg-core.wasm`, 'application/wasm');
          workerBlobUrl = await toBlobURL('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/worker.js', 'text/javascript');
        }

        if (onProgress) {
          onProgress({
            stage: 'loading_engine',
            percent: 30,
            message: 'Initializing WebAssembly engine...',
          });
        }

        await ffmpeg.load({
          coreURL: coreBlobUrl,
          wasmURL: wasmBlobUrl,
          classWorkerURL: workerBlobUrl,
        });

        this.ffmpegInstance = ffmpeg;
        this.loaded = true;

        if (onProgress) {
          onProgress({
            stage: 'loading_engine',
            percent: 40,
            message: 'Media engine initialized successfully.',
          });
        }

        return ffmpeg;
      } catch (err: any) {
        this.loaded = false;
        this.ffmpegInstance = null;
        this.loadPromise = null;
        throw new EngineLoadError(err?.message || 'Failed to instantiate WebAssembly engine', err);
      } finally {
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Gracefully terminates the running FFmpeg instance and frees WebAssembly memory
   */
  public async terminate(): Promise<void> {
    try {
      if (this.ffmpegInstance) {
        await this.ffmpegInstance.terminate();
      }
    } catch (termErr) {
      console.warn('[FFmpegManager] Termination warning:', termErr);
    } finally {
      this.ffmpegInstance = null;
      this.loaded = false;
      this.isBusyState = false;
      this.loadPromise = null;
    }
  }
}

export const ffmpegManager = FFmpegManager.getInstance();
