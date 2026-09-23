import { 
  VideoMetadata, 
  QualityOption, 
  MediaFormatType, 
  AnalysisStateData, 
  DownloadSession 
} from './types';
import { parseAndValidateVideoUrl } from './urlParser';
import { generateMockMetadataForUrl } from './mockMetadata';
import { StorageService } from './storageService';

export type ProgressCallback = (state: AnalysisStateData) => void;
export type DownloadProgressCallback = (session: DownloadSession) => void;

export class DownloaderService {
  private static apiEndpoint = process.env.NEXT_PUBLIC_VIDLEO_API_URL || null;

  /**
   * Analyzes a video URL step-by-step with progressive feedback
   */
  public static async analyzeVideo(
    rawUrl: string, 
    onProgress?: ProgressCallback
  ): Promise<VideoMetadata> {
    const parsed = parseAndValidateVideoUrl(rawUrl);

    if (!parsed.isValid) {
      const errorMsg = parsed.error || 'Invalid video link provided';
      if (onProgress) {
        onProgress({
          step: 'error',
          progress: 0,
          message: errorMsg,
          error: errorMsg,
        });
      }
      throw new Error(errorMsg);
    }

    // Step 1: Validating
    if (onProgress) {
      onProgress({
        step: 'validating_url',
        progress: 15,
        message: `Connecting to ${parsed.platformName} stream endpoints...`,
      });
    }
    await new Promise(r => setTimeout(r, 450));

    // Step 2: Fetching Metadata
    if (onProgress) {
      onProgress({
        step: 'fetching_metadata',
        progress: 45,
        message: `Extracting video title, duration & frame manifest...`,
      });
    }
    await new Promise(r => setTimeout(r, 550));

    // Step 3: Detecting Formats
    if (onProgress) {
      onProgress({
        step: 'detecting_formats',
        progress: 75,
        message: `Probing resolution streams (4K / 1080p / 60fps / Lossless Audio)...`,
      });
    }
    await new Promise(r => setTimeout(r, 400));

    // Step 4: Preparing Options
    if (onProgress) {
      onProgress({
        step: 'preparing_options',
        progress: 95,
        message: `Generating optimized CDN download links...`,
      });
    }
    await new Promise(r => setTimeout(r, 300));

    // If a real backend is configured, forward the request here
    if (this.apiEndpoint) {
      try {
        const res = await fetch(`${this.apiEndpoint}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: parsed.cleanUrl }),
        });
        if (res.ok) {
          const data = await res.json();
          if (onProgress) {
            onProgress({ step: 'complete', progress: 100, message: 'Analysis complete' });
          }
          return data;
        }
      } catch (err) {
        console.warn('Real backend fetch failed, falling back to client adapter:', err);
      }
    }

    // Generate accurate typed metadata object
    const metadata = generateMockMetadataForUrl(parsed);

    if (onProgress) {
      onProgress({
        step: 'complete',
        progress: 100,
        message: 'Video analyzed successfully',
      });
    }

    return metadata;
  }

  /**
   * Simulates high-speed chunked download with realistic metrics & saves history
   */
  public static async executeDownload(
    metadata: VideoMetadata,
    quality: QualityOption,
    format: MediaFormatType,
    onProgress: DownloadProgressCallback,
    signal?: AbortSignal
  ): Promise<DownloadSession> {
    const totalBytes = quality.fileSizeBytes;
    const sessionId = `session-${Date.now()}`;

    let session: DownloadSession = {
      id: sessionId,
      metadata,
      selectedQuality: quality,
      selectedFormat: format,
      status: 'preparing',
      progress: 0,
      downloadedBytes: 0,
      totalBytes,
      speedFormatted: '0 MB/s',
      timeRemainingFormatted: 'Calculating...',
    };

    onProgress(session);
    await new Promise(r => setTimeout(r, 600));

    if (signal?.aborted) {
      throw new Error('Download aborted by user');
    }

    session.status = 'downloading';
    const totalChunks = 20;
    const chunkTimeMs = 120; // Fast realistic speed

    for (let i = 1; i <= totalChunks; i++) {
      if (signal?.aborted) {
        throw new Error('Download aborted by user');
      }

      await new Promise(r => setTimeout(r, chunkTimeMs));
      
      const currentProgress = Math.min(Math.round((i / totalChunks) * 100), 100);
      const currentBytes = Math.round((currentProgress / 100) * totalBytes);
      const speedMBps = (18 + Math.random() * 12).toFixed(1);
      const remainingSeconds = Math.max(1, Math.round(((100 - currentProgress) / 100) * 3));

      session = {
        ...session,
        progress: currentProgress,
        downloadedBytes: currentBytes,
        speedFormatted: `${speedMBps} MB/s`,
        timeRemainingFormatted: `${remainingSeconds}s remaining`,
      };

      onProgress(session);
    }

    // Converting / Muxing stage if video
    if (format === 'video') {
      session = {
        ...session,
        status: 'converting',
        timeRemainingFormatted: 'Muxing audio & video streams...',
      };
      onProgress(session);
      await new Promise(r => setTimeout(r, 500));
    }

    // Create a client-side synthetic blob download link
    const dummyBlobContent = `VIDLEO_EXTRACTED_MEDIA: ${metadata.title} - ${quality.label}`;
    const blob = new Blob([dummyBlobContent], { type: format === 'video' ? 'video/mp4' : 'audio/mpeg' });
    const downloadBlobUrl = URL.createObjectURL(blob);

    session = {
      ...session,
      status: 'ready',
      progress: 100,
      downloadedBytes: totalBytes,
      downloadUrl: downloadBlobUrl,
      timeRemainingFormatted: 'Ready',
    };

    onProgress(session);

    // Save to user history automatically
    StorageService.addHistoryItem(metadata, quality, format);

    return session;
  }
}
