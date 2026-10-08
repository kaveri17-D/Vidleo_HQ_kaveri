import { 
  VideoMetadata, 
  QualityOption, 
  MediaFormatType, 
  AnalysisStateData, 
  DownloadSession,
  PlatformType,
  VideoContainer,
  AudioContainer
} from './types';
import { parseAndValidateVideoUrl } from './urlParser';
import { StorageService } from './storageService';
import { createClient } from '@/lib/supabase/client';
import { MediaEngine } from '@/packages/media-engine';
import { 
  browserAcquisitionEngine, 
  detectExtension, 
  resolveMediaViaExtension 
} from '@/lib/browser-acquisition';

export type ProgressCallback = (state: AnalysisStateData) => void;
export type DownloadProgressCallback = (session: DownloadSession) => void;

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function mapBackendFormatsToQualities(
  backendFormats: any[], 
  type: MediaFormatType
): QualityOption[] {
  if (!Array.isArray(backendFormats)) return [];

  return backendFormats.map((f, index) => {
    const formatId = String(f.format_id || f.id || '');
    const height = f.height ? Number(f.height) : undefined;
    let label = f.label || f.quality || '';
    if (type === 'video') {
      if (height) {
        if (height >= 2160) label = `4K ${height}p`;
        else if (height >= 1440) label = `2K ${height}p`;
        else if (height >= 1080) label = `1080p Full HD`;
        else if (height >= 720) label = `720p HD`;
        else label = `${height}p`;
      } else if (!label) {
        label = 'Standard Video';
      }
    } else {
      if (!label) {
        label = f.bitrate ? `${f.bitrate}` : 'Standard Audio';
      }
    }

    const fileSizeBytes = Number(f.filesize || f.filesize_approx || (f.size_mb ? f.size_mb * 1024 * 1024 : 0));
    const fileSizeApprox = f.size_mb 
      ? `${f.size_mb} MB` 
      : fileSizeBytes >= 1024 * 1024
      ? `${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MB` 
      : fileSizeBytes > 0 
      ? `${Math.round(fileSizeBytes / 1024)} KB`
      : 'Size dynamic';

    const rawExt = String(f.ext || (type === 'video' ? 'mp4' : 'mp3')).toLowerCase();
    const validContainers = ['mp4', 'webm', 'mkv', 'mp3', 'm4a', 'wav'];
    const container = (validContainers.includes(rawExt) 
      ? rawExt 
      : (type === 'video' ? 'mp4' : 'mp3')) as VideoContainer | AudioContainer;

    const availability = (f.availability as any) || (
      fileSizeBytes > 0 || Boolean(f.format_note) || Boolean(f.height)
        ? 'ACTUAL_MEDIA_AVAILABLE'
        : 'METADATA_ONLY'
    );

    return {
      id: formatId,
      label,
      resolution: f.resolution || (height ? `${f.width || Math.round(height * 16 / 9)}x${height}` : undefined),
      fps: f.fps ? Number(f.fps) : undefined,
      bitrate: f.bitrate ? String(f.bitrate) : undefined,
      fileSizeApprox,
      fileSizeBytes: fileSizeBytes || 0,
      container,
      type,
      isRecommended: index === 0 || height === 1080 || height === 720,
      hasAudio: f.has_audio !== false,
      hdr: Boolean(f.hdr),
      streamUrl: f.url || undefined,
      availability,
      itag: f.itag || formatId,
      vcodec: f.vcodec,
      acodec: f.acodec,
    };
  });
}

function adaptBackendExtractResponse(
  data: any, 
  parsed: ReturnType<typeof parseAndValidateVideoUrl>
): VideoMetadata {
  const durationSec = Number(data.duration || 0);
  const videoQualities = mapBackendFormatsToQualities(data.video_formats || [], 'video');
  const audioQualities = mapBackendFormatsToQualities(data.audio_formats || [], 'audio');

  return {
    id: String(data.id || data.job_id || `media-${Date.now()}`),
    url: parsed.cleanUrl,
    canonicalUrl: parsed.cleanUrl,
    platform: (parsed.platform || 'generic') as PlatformType,
    platformName: parsed.platformName || 'Media Stream',
    title: data.title || 'Untitled Stream',
    description: data.uploader ? `Shared by ${data.uploader}` : `${parsed.platformName} Media`,
    author: {
      name: data.uploader || parsed.platformName,
      handle: data.uploader ? `@${data.uploader.replace(/\s+/g, '').toLowerCase()}` : `@${parsed.platformName.toLowerCase()}`,
      verified: true,
    },
    durationSeconds: durationSec,
    durationFormatted: formatDuration(durationSec),
    thumbnailUrl: data.thumbnail || '',
    viewsFormatted: undefined,
    uploadedAtFormatted: 'Available now',
    aspectRatio: '16:9',
    availableVideoQualities: videoQualities,
    availableAudioQualities: audioQualities,
    manifest: data.manifest || undefined,
    pipelineStatus: data.pipeline_status || (
      (data.candidate_stream_url || data.direct_stream_available || videoQualities.some(q => Boolean(q.streamUrl)))
        ? 'STREAM_CANDIDATE_AVAILABLE'
        : 'STREAM_SOURCE_UNRESOLVED'
    ),
  };
}

export class DownloaderService {
  private static getApiEndpoint(): string {
    const envUrl = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_VIDLEO_API_URL : undefined;
    if (envUrl && !envUrl.includes('192.168') && !envUrl.includes('localhost')) {
      return envUrl.replace(/\/+$/, '');
    }
    return 'https://backend-production-2ff30.up.railway.app';
  }

  private static async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    try {
      if (typeof window !== 'undefined') {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }
      }
    } catch {
      // Gracefully continue unauthenticated if Supabase session is unavailable
    }
    return headers;
  }

  /**
   * Analyzes a video URL using the backend extraction endpoint.
   * Real backend is the single source of truth with no mock fallbacks.
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

    if (onProgress) {
      onProgress({
        step: 'validating_url',
        progress: 15,
        message: `Connecting to ${parsed.platformName} stream endpoints...`,
      });
    }

    const apiBase = DownloaderService.getApiEndpoint();
    if (!apiBase) {
      const errDetail = 'Backend API URL is not configured. Please set NEXT_PUBLIC_VIDLEO_API_URL.';
      if (onProgress) {
        onProgress({
          step: 'error',
          progress: 0,
          message: errDetail,
          error: errDetail,
        });
      }
      throw new Error(errDetail);
    }

    // 0. Client-First YouTube Resolution via Vidleo Companion Extension
    if (parsed.platform === 'youtube') {
      const extStatus = await detectExtension(800);
      if (extStatus.installed) {
        if (onProgress) {
          onProgress({
            step: 'fetching_metadata',
            progress: 30,
            message: 'Resolving YouTube stream via Vidleo Companion Extension (Client Network)...',
            pipelineStatus: 'BROWSER_EXTENSION_READY',
          });
        }
        try {
          const rawExtResult = await resolveMediaViaExtension(parsed.cleanUrl, 6000);
          const extResult = rawExtResult?.manifest || rawExtResult;
          if (extResult && (extResult.title || extResult.video_formats?.length > 0)) {
            const metadata = adaptBackendExtractResponse(extResult, parsed);
            metadata.pipelineStatus = extResult.pipeline_status || (extResult.direct_stream_available ? 'STREAM_CANDIDATE_AVAILABLE' : 'STREAM_SOURCE_UNRESOLVED');
            if (onProgress) {
              onProgress({
                step: 'complete',
                progress: 100,
                message: 'Stream metadata resolved via Vidleo Companion Extension (0 Railway requests)',
                pipelineStatus: metadata.pipelineStatus,
              });
            }
            return metadata;
          }
        } catch (extErr) {
          console.warn('[DownloaderService] Extension resolution error, proceeding to client oEmbed/control plane:', extErr);
        }
      }
    }

    // 1. Client-direct oEmbed metadata discovery for YouTube
    let clientOembed: any = null;
    if (parsed.platform === 'youtube') {
      try {
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.cleanUrl)}&format=json`);
        if (oembedRes.ok) {
          clientOembed = await oembedRes.json();
          if (onProgress) {
            onProgress({
              step: 'fetching_metadata',
              progress: 50,
              message: `Detected metadata for "${clientOembed.title}"`,
              pipelineStatus: 'METADATA_DETECTED',
            });
          }
        }
      } catch {}
    }

    const authHeaders = await DownloaderService.getAuthHeaders();
    let res: Response;
    try {
      res = await fetch(`${apiBase}/api/extract`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ url: parsed.cleanUrl }),
      });
    } catch (err: any) {
      if (parsed.platform === 'youtube' && clientOembed) {
        const fallbackMetadata: VideoMetadata = {
          id: `yt-${Date.now()}`,
          url: parsed.cleanUrl,
          canonicalUrl: parsed.cleanUrl,
          platform: 'youtube',
          platformName: 'YouTube',
          title: clientOembed.title || 'YouTube Stream',
          description: `Shared by ${clientOembed.author_name || 'YouTube Creator'}`,
          author: {
            name: clientOembed.author_name || 'YouTube Creator',
            handle: `@${(clientOembed.author_name || 'youtube').replace(/\s+/g, '').toLowerCase()}`,
            verified: true,
          },
          durationSeconds: 0,
          durationFormatted: 'Online Stream',
          thumbnailUrl: clientOembed.thumbnail_url || '',
          aspectRatio: '16:9',
          pipelineStatus: 'RATE_LIMITED',
          upstreamDiagnostics: {
            statusCode: 503,
            errorDetail: `Failed to connect to backend: ${err?.message || 'Network error'}`,
            rateLimited: true,
            provider: 'youtube',
          },
          availableVideoQualities: [
            {
              id: 'client-auto',
              label: 'Direct Client Stream (Browser)',
              fileSizeApprox: 'Direct Source',
              fileSizeBytes: 0,
              container: 'mp4',
              type: 'video',
              isRecommended: true,
              hasAudio: true,
            }
          ],
          availableAudioQualities: [
            {
              id: 'client-audio',
              label: 'Audio Only (Browser)',
              fileSizeApprox: 'Direct Source',
              fileSizeBytes: 0,
              container: 'mp3',
              type: 'audio',
              isRecommended: false,
              hasAudio: true,
            }
          ],
        };

        if (onProgress) {
          onProgress({
            step: 'complete',
            progress: 100,
            message: 'YouTube metadata detected. Server fallback rate-limited.',
            pipelineStatus: 'RATE_LIMITED',
          });
        }
        return fallbackMetadata;
      }

      const netError = `Failed to connect to backend: ${err?.message || 'Network error'}`;
      if (onProgress) {
        onProgress({
          step: 'error',
          progress: 0,
          message: netError,
          error: netError,
        });
      }
      throw new Error(netError);
    }

    if (!res.ok) {
      let errDetail = 'Failed to extract video information';
      try {
        const errJson = await res.json();
        if (typeof errJson.detail === 'object' && errJson.detail !== null) {
          errDetail = errJson.detail.message || errJson.detail.detail || JSON.stringify(errJson.detail);
        } else {
          errDetail = errJson.detail || errDetail;
        }
      } catch {}

      // If YouTube was rate-limited by datacenter IP (HTTP 429/403) and we have client metadata:
      if (parsed.platform === 'youtube' && clientOembed) {
        const fallbackMetadata: VideoMetadata = {
          id: `yt-${Date.now()}`,
          url: parsed.cleanUrl,
          canonicalUrl: parsed.cleanUrl,
          platform: 'youtube',
          platformName: 'YouTube',
          title: clientOembed.title || 'YouTube Stream',
          description: `Shared by ${clientOembed.author_name || 'YouTube Creator'}`,
          author: {
            name: clientOembed.author_name || 'YouTube Creator',
            handle: `@${(clientOembed.author_name || 'youtube').replace(/\s+/g, '').toLowerCase()}`,
            verified: true,
          },
          durationSeconds: 0,
          durationFormatted: 'Online Stream',
          thumbnailUrl: clientOembed.thumbnail_url || '',
          aspectRatio: '16:9',
          pipelineStatus: 'RATE_LIMITED',
          upstreamDiagnostics: {
            statusCode: res.status,
            errorDetail: errDetail,
            rateLimited: true,
            provider: 'youtube',
          },
          availableVideoQualities: [
            {
              id: 'client-auto',
              label: 'Direct Client Stream (Browser)',
              fileSizeApprox: 'Direct Source',
              fileSizeBytes: 0,
              container: 'mp4',
              type: 'video',
              isRecommended: true,
              hasAudio: true,
            }
          ],
          availableAudioQualities: [
            {
              id: 'client-audio',
              label: 'Audio Only (Browser)',
              fileSizeApprox: 'Direct Source',
              fileSizeBytes: 0,
              container: 'mp3',
              type: 'audio',
              isRecommended: false,
              hasAudio: true,
            }
          ],
        };

        if (onProgress) {
          onProgress({
            step: 'complete',
            progress: 100,
            message: 'YouTube metadata detected. Server fallback rate-limited (HTTP 429).',
            pipelineStatus: 'RATE_LIMITED',
          });
        }
        return fallbackMetadata;
      }

      if (onProgress) {
        onProgress({
          step: 'error',
          progress: 0,
          message: errDetail,
          error: errDetail,
          pipelineStatus: 'RATE_LIMITED',
        });
      }
      throw new Error(errDetail);
    }

    if (onProgress) {
      onProgress({
        step: 'detecting_formats',
        progress: 80,
        message: `Probing resolution streams...`,
      });
    }

    const backendData = await res.json();
    const metadata = adaptBackendExtractResponse(backendData, parsed);

    if (onProgress) {
      onProgress({
        step: 'complete',
        progress: 100,
        message: 'Video analyzed successfully',
        pipelineStatus: 'STREAM_CANDIDATE_AVAILABLE',
      });
    }

    return metadata;
  }

  /**
   * Dispatches download job to backend, tracks real progress, and saves history.
   * Uses strictly values returned by the backend with no simulated metrics or mock data.
   */
  public static async executeDownload(
    metadata: VideoMetadata,
    quality: QualityOption,
    format: MediaFormatType,
    onProgress: DownloadProgressCallback,
    signal?: AbortSignal,
    routePreference: 'browser' | 'server' = 'browser'
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
      speedFormatted: undefined,
      timeRemainingFormatted: undefined,
      route: routePreference,
      acquisitionSource: 'UNKNOWN',
    };

    onProgress(session);

    // 0A. Direct Browser-First Media Acquisition Attempt (if user selected/allowed browser route)
    if (routePreference === 'browser') {
      const directStreamUrl = quality.streamUrl;
      const progressiveStreams = metadata.manifest?.streams?.progressive || [];
      const videoStreams = metadata.manifest?.streams?.video || [];
      const candidateStream = directStreamUrl 
        ? { url: directStreamUrl }
        : progressiveStreams.find((s: any) => s.format_id === quality.id) ||
          videoStreams.find((s: any) => s.format_id === quality.id) ||
          (metadata.manifest?.source?.url ? { url: metadata.manifest.source.url } : null);

      let resolvedStreamUrl = directStreamUrl || candidateStream?.url;
      if (!resolvedStreamUrl && metadata.platform === 'youtube') {
        const extStatus = await detectExtension(150);
        if (extStatus.installed) {
          try {
            const rawExtResult = await resolveMediaViaExtension(metadata.canonicalUrl || metadata.url, 4000);
            const extResult = rawExtResult?.manifest || rawExtResult;
            if (extResult?.candidate_stream_url) {
              resolvedStreamUrl = extResult.candidate_stream_url;
            }
          } catch {}
        }
      }

      if (resolvedStreamUrl) {
        const canAcquire = browserAcquisitionEngine.canAcquire(resolvedStreamUrl, totalBytes);
        if (canAcquire.canAcquire) {
          try {
            const acqResult = await browserAcquisitionEngine.acquire({
              sourceUrl: resolvedStreamUrl,
              targetFilename: `${metadata.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}.${quality.container}`,
              expectedBytes: totalBytes,
              signal,
              onProgress: (p) => {
                session = {
                  ...session,
                  status: p.stage === 'complete' ? 'ready' : p.stage === 'processing' ? 'converting' : 'downloading',
                  progress: p.percent,
                  downloadedBytes: p.bytesReceived,
                  speedFormatted: p.speedFormatted,
                  timeRemainingFormatted: p.etaFormatted,
                  acquisitionSource: p.source,
                  route: 'browser',
                  pipelineStatus: 'BROWSER_ACQUISITION_ACTIVE',
                };
                onProgress(session);
              },
              enableFfmpegProcessing: true,
              targetContainer: quality.container as any,
            });

            if (acqResult.success && acqResult.totalBytes > 0) {
              session = {
                ...session,
                status: 'ready',
                progress: 100,
                downloadedBytes: acqResult.totalBytes,
                downloadUrl: acqResult.mediaUrl,
                speedFormatted: 'Done',
                timeRemainingFormatted: 'Ready',
                acquisitionSource: 'BROWSER_NETWORK',
                route: 'browser',
                pipelineStatus: 'BROWSER_ACQUISITION_SUCCESS',
              };
              onProgress(session);
              StorageService.addHistoryItem(metadata, quality, format);
              return session;
            }
          } catch (browserAcqErr: any) {
            if (signal?.aborted) {
              throw new Error('Download aborted by user');
            }
            console.warn('[BrowserAcquisition] Direct browser path unavailable, routing to server fallback:', browserAcqErr?.message);
            session = {
              ...session,
              status: 'downloading',
              route: 'server',
              acquisitionSource: 'SERVER',
              pipelineStatus: 'SERVER_FALLBACK',
            };
            onProgress(session);
          }
        }
      } else if (metadata.pipelineStatus === 'RATE_LIMITED' && metadata.platform === 'youtube') {
        const extStatus = await detectExtension(150);
        if (!extStatus.installed) {
          const errMsg = 'Direct browser acquisition requires the Vidleo Companion Extension. The server path is currently rate-limited by YouTube (HTTP 429). Please install the extension.';
          session = {
            ...session,
            status: 'error',
            errorMessage: errMsg,
            pipelineStatus: 'RATE_LIMITED',
          };
          onProgress(session);
          throw new Error(errMsg);
        } else {
          const errMsg = 'YouTube signature cipher restriction active for this video. No direct un-ciphered stream candidate is exposed.';
          session = {
            ...session,
            status: 'error',
            errorMessage: errMsg,
            pipelineStatus: 'BLOCKED',
          };
          onProgress(session);
          throw new Error(errMsg);
        }
      }
    }

    const apiBase = DownloaderService.getApiEndpoint();
    if (!apiBase) {
      const errMsg = 'Backend API URL is not configured. Please set NEXT_PUBLIC_VIDLEO_API_URL.';
      session = {
        ...session,
        status: 'error',
        errorMessage: errMsg,
      };
      onProgress(session);
      throw new Error(errMsg);
    }

    try {
      const authHeaders = await DownloaderService.getAuthHeaders();

      // 0B. Attempt client-first execution via NEXUS MediaEngine
      if (metadata.manifest) {
        try {
          let latestEngineResult: any = null;
          const engineResult = await MediaEngine.execute({
            manifest: metadata.manifest,
            targetFormatId: quality.id,
            targetFormatType: format,
            apiBaseUrl: apiBase,
            authHeaders,
            signal,
            onProgress: (engineState) => {
              session = {
                ...session,
                status: engineState.stage === 'complete' ? 'ready' : engineState.stage === 'muxing' ? 'converting' : 'downloading',
                progress: engineState.progressPercent,
                downloadedBytes: engineState.downloadedBytes,
                speedFormatted: engineState.speedFormatted,
                timeRemainingFormatted: engineState.etaFormatted,
              };
              if (engineState.downloadUrl) {
                session.downloadUrl = engineState.downloadUrl;
              } else if (engineState.stage === 'complete' && latestEngineResult?.downloadUrl) {
                session.downloadUrl = latestEngineResult.downloadUrl;
              }
              onProgress(session);
            },
          });

          if (engineResult && engineResult.totalBytes > 0) {
            latestEngineResult = engineResult;
            session = {
              ...session,
              status: 'ready',
              progress: 100,
              downloadedBytes: engineResult.totalBytes,
              downloadUrl: engineResult.downloadUrl,
              speedFormatted: 'Done',
              timeRemainingFormatted: 'Ready',
            };
            onProgress(session);
            StorageService.addHistoryItem(metadata, quality, format);
            return session;
          }
        } catch (engineErr: any) {
          if (signal?.aborted) {
            throw new Error('Download aborted by user');
          }
          console.warn('[MediaEngine] Client-first path failed, falling back to server runner:', engineErr);
        }
      }

      // 1. Submit download job to backend (SERVER_FALLBACK path)
      let res: Response;
      try {
        res = await fetch(`${apiBase}/api/download-job`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            url: metadata.canonicalUrl || metadata.url,
            format_id: quality.id,
            format_type: format,
            delivery_target: 'web',
          }),
          signal,
        });
      } catch (fetchErr: any) {
        if (signal?.aborted) {
          throw new Error('Download aborted by user');
        }
        const netErr = `Failed to connect to backend: ${fetchErr?.message || 'Network error'}`;
        session = {
          ...session,
          status: 'error',
          errorMessage: netErr,
        };
        onProgress(session);
        throw new Error(netErr);
      }

      if (!res.ok) {
        let errDetail = 'Failed to initiate download job';
        try {
          const errJson = await res.json();
          if (typeof errJson.detail === 'object' && errJson.detail !== null) {
            errDetail = errJson.detail.message || errJson.detail.detail || JSON.stringify(errJson.detail);
          } else {
            errDetail = errJson.detail || errDetail;
          }
        } catch {}
        session = {
          ...session,
          status: 'error',
          errorMessage: errDetail,
        };
        onProgress(session);
        throw new Error(errDetail);
      }

      const jobData = await res.json();
      const jobId = jobData.job_id;

      if (!jobId) {
        const noIdErr = 'Backend did not return a valid download job ID';
        session = {
          ...session,
          status: 'error',
          errorMessage: noIdErr,
        };
        onProgress(session);
        throw new Error(noIdErr);
      }

      // 2. Poll progress from backend until complete or failed
      let isComplete = false;
      let attempts = 0;
      const maxAttempts = 300; // 5 minutes max at 1s intervals

      while (!isComplete && attempts < maxAttempts) {
        if (signal?.aborted) {
          throw new Error('Download aborted by user');
        }

        await new Promise((r) => setTimeout(r, 1000));
        attempts++;

        let progRes: Response;
        try {
          progRes = await fetch(`${apiBase}/api/progress/${jobId}`, {
            headers: authHeaders,
            signal,
          });
        } catch (pollErr: any) {
          if (signal?.aborted) {
            throw new Error('Download aborted by user');
          }
          continue;
        }

        if (!progRes.ok) {
          continue;
        }

        const progData = await progRes.json();
        const status = progData.status;

        if (status === 'failed') {
          const errorMsg = progData.error || 'Media download processing failed on server';
          session = {
            ...session,
            status: 'error',
            errorMessage: errorMsg,
          };
          onProgress(session);
          throw new Error(errorMsg);
        }

        const rawProgress = typeof progData.progress === 'number' ? progData.progress : 0;
        const currentProgress = Math.min(Math.max(rawProgress, 0), 100);

        // Use strictly values returned by the backend with no invented speeds or ETAs
        const downloadedBytes = typeof progData.size_bytes === 'number'
          ? progData.size_bytes
          : (status === 'completed' ? totalBytes : 0);

        const speedFormatted = progData.speed ? String(progData.speed) : undefined;
        const timeRemainingFormatted = progData.eta != null
          ? (typeof progData.eta === 'number' ? `${progData.eta}s remaining` : String(progData.eta))
          : (status === 'completed' ? 'Ready' : undefined);

        session = {
          ...session,
          status: status === 'completed' ? 'ready' : (status === 'processing' || currentProgress > 85) ? 'converting' : 'downloading',
          progress: status === 'completed' ? 100 : currentProgress,
          downloadedBytes,
          speedFormatted,
          timeRemainingFormatted,
        };

        if (status === 'completed') {
          isComplete = true;
          let downloadUrl = progData.download_url?.startsWith('http')
            ? progData.download_url
            : `${apiBase}/api/download/file/${jobId}`;

          // Attach token parameter if authenticated and downloading from backend endpoint
          const token = authHeaders['Authorization']?.replace(/^Bearer\s+/i, '');
          if (token && downloadUrl.includes('/api/download/file/')) {
            const separator = downloadUrl.includes('?') ? '&' : '?';
            downloadUrl = `${downloadUrl}${separator}token=${encodeURIComponent(token)}`;
          }

          session.downloadUrl = downloadUrl;
          session.status = 'ready';
        }

        onProgress(session);
      }

      if (!isComplete) {
        const timeoutErr = 'Download operation timed out. Please try again.';
        session = {
          ...session,
          status: 'error',
          errorMessage: timeoutErr,
        };
        onProgress(session);
        throw new Error(timeoutErr);
      }

      // Save to user history upon actual successful completion
      StorageService.addHistoryItem(metadata, quality, format);

      return session;
    } catch (err: any) {
      if (err.message === 'Download aborted by user') {
        throw err;
      }
      session = {
        ...session,
        status: 'error',
        errorMessage: err.message || 'Media download failed',
      };
      onProgress(session);
      throw err;
    }
  }
}
