import { 
  MediaManifest, 
  StrategyDecision, 
  EngineProgressCallback, 
  EngineDownloadResult 
} from './types';
import { detectCapabilities } from './capability';
import { evaluateClientStrategy } from './strategy';
import { fetchStreamWithRange } from './fetcher';
import { FileSystemAccessSink, OPFSSink, BlobSink, MediaSink } from './sink/sink';
import { StreamingMP4Muxer } from './muxer/mp4Muxer';
import { StreamingWebMMuxer } from './muxer/webmMuxer';
import { HLSEngine } from './hls/hlsEngine';

export interface ExecuteEngineOptions {
  manifest: MediaManifest;
  targetFormatId: string;
  targetFormatType?: 'video' | 'audio';
  apiBaseUrl?: string;
  authHeaders?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: EngineProgressCallback;
  sink?: MediaSink;
  autoTriggerBrowserDownload?: boolean;
}

export class MediaEngine {
  /**
   * Evaluates strategy and executes client-first media download when possible.
   * Returns EngineDownloadResult if handled client-side.
   * Returns null if strategy is SERVER_FALLBACK or UNSUPPORTED.
   */
  public static async execute(options: ExecuteEngineOptions): Promise<EngineDownloadResult | null> {
    const {
      manifest,
      targetFormatId,
      targetFormatType = 'video',
      apiBaseUrl = '',
      authHeaders = {},
      signal,
      onProgress,
    } = options;

    const decision: StrategyDecision = evaluateClientStrategy(
      manifest,
      targetFormatId,
      targetFormatType
    );

    // If strategy requires server execution or is unsupported, exit to caller
    if (decision.strategy === 'SERVER_FALLBACK' || decision.strategy === 'UNSUPPORTED') {
      return null;
    }

    if (onProgress) {
      onProgress({
        stage: 'preparing',
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: decision.estimated_bytes,
        message: `Executing ${decision.strategy}...`,
      });
    }

    // Determine target stream
    const targetStream = decision.progressive_stream || decision.video_stream || decision.audio_stream || decision.hls_stream;
    if (!targetStream) {
      return null;
    }

    const title = manifest.source.title || 'video';
    const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'download';
    const ext = (decision.strategy === 'BROWSER_HLS' ? 'mp4' : targetStream.container) || (targetFormatType === 'audio' ? 'mp3' : 'mp4');
    const filename = `${safeTitle}.${ext}`;

    // Select sink based on capabilities or caller provided sink
    const caps = detectCapabilities();
    let sink: MediaSink;
    let deliveryMode = 'direct_progressive';

    if (options.sink) {
      sink = options.sink;
      deliveryMode = 'extension_download';
    } else if (caps.fsa_supported) {
      sink = new FileSystemAccessSink();
      deliveryMode = 'direct_fsa';
    } else if (caps.opfs_supported) {
      sink = new OPFSSink();
      deliveryMode = 'direct_opfs';
    } else {
      sink = new BlobSink();
      deliveryMode = 'direct_blob';
    }

    await sink.open(filename, targetStream.filesize);

    let downloadedBytes = 0;
    try {
      if (decision.strategy === 'BROWSER_HLS' && decision.hls_stream) {
        // Browser HLS pipeline
        downloadedBytes = await HLSEngine.execute({
          manifest,
          hlsStream: decision.hls_stream,
          sink,
          apiBaseUrl,
          authHeaders,
          signal,
          onProgress,
        });
        deliveryMode = 'browser_hls';
      } else if (decision.video_stream && decision.audio_stream && (decision.strategy === 'SIGNED_WORKER_RANGE' || decision.strategy === 'BROWSER_ADAPTIVE_MUX')) {
        // Adaptive video + audio multiplexing flow
        let videoUrl = decision.video_stream.url;
        let audioUrl = decision.audio_stream.url;
        const videoHeaders = decision.video_stream.headers_required || {};
        const audioHeaders = decision.audio_stream.headers_required || {};

        if (decision.ticket_required || decision.video_stream.relay_required || decision.audio_stream.relay_required) {
          const [vTicketRes, aTicketRes] = await Promise.all([
            fetch(`${apiBaseUrl}/api/downloads/${manifest.job_id}/ticket`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders },
              body: JSON.stringify({
                format_id: decision.video_stream.format_id,
                host: decision.video_stream.host,
                target_url: decision.video_stream.url,
              }),
            }).then((r) => r.json()).catch(() => null),
            fetch(`${apiBaseUrl}/api/downloads/${manifest.job_id}/ticket`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders },
              body: JSON.stringify({
                format_id: decision.audio_stream.format_id,
                host: decision.audio_stream.host,
                target_url: decision.audio_stream.url,
              }),
            }).then((r) => r.json()).catch(() => null),
          ]);

          if (vTicketRes?.relay_url) videoUrl = vTicketRes.relay_url;
          if (aTicketRes?.relay_url) audioUrl = aTicketRes.relay_url;
        }

        const isWebM = 
          decision.video_stream.container === 'webm' || 
          decision.video_stream.codec?.toLowerCase().includes('vp9') || 
          decision.video_stream.codec?.toLowerCase().includes('vp09') ||
          decision.video_stream.codec?.toLowerCase().includes('av1') ||
          decision.video_stream.codec?.toLowerCase().includes('av01') ||
          decision.audio_stream.codec?.toLowerCase().includes('opus');

        if (isWebM) {
          downloadedBytes = await StreamingWebMMuxer.remux({
            video: { url: videoUrl, totalBytes: decision.video_stream.filesize, headers: videoHeaders },
            audio: { url: audioUrl, totalBytes: decision.audio_stream.filesize, headers: audioHeaders },
            sink,
            signal,
            onProgress,
          });
        } else {
          downloadedBytes = await StreamingMP4Muxer.remux({
            video: { url: videoUrl, totalBytes: decision.video_stream.filesize, headers: videoHeaders },
            audio: { url: audioUrl, totalBytes: decision.audio_stream.filesize, headers: audioHeaders },
            sink,
            signal,
            onProgress,
          });
        }

        deliveryMode = decision.strategy === 'SIGNED_WORKER_RANGE' ? 'signed_worker_remux' : 'browser_remux';
      } else {
        // Single stream flow (progressive or audio-only)
        let streamUrl = targetStream.url;
        if (decision.strategy === 'SIGNED_WORKER_RANGE' || decision.ticket_required || targetStream.relay_required) {
          try {
            const ticketRes = await fetch(`${apiBaseUrl}/api/downloads/${manifest.job_id}/ticket`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders },
              body: JSON.stringify({
                format_id: targetStream.format_id,
                host: targetStream.host,
                target_url: targetStream.url,
              }),
            }).then((r) => r.json());
            if (ticketRes?.relay_url) {
              streamUrl = ticketRes.relay_url;
            }
          } catch {
            // Fall back to direct streamUrl if ticket call fails
          }
          deliveryMode = 'signed_worker_range';
        }

        downloadedBytes = await fetchStreamWithRange({
          url: streamUrl,
          totalBytes: targetStream.filesize,
          headers: targetStream.headers_required,
          signal,
          onProgress,
          sink,
          stageName: 'fetching',
        });
      }

      const fileResult = await sink.close();

      if (downloadedBytes === 0) {
        throw new Error('MEDIA_INTEGRITY: FAIL_ZERO_BYTES (Download operation wrote 0 bytes to media sink)');
      }

      // Trigger standard browser download if not using FSA (which already saved to disk)
      let blobUrl: string | undefined;
      if (fileResult instanceof Blob) {
        blobUrl = URL.createObjectURL(fileResult);
        if (options.autoTriggerBrowserDownload !== false && typeof document !== 'undefined') {
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      }

      // Notify control plane of successful client-side download
      if (apiBaseUrl) {
        try {
          await fetch(`${apiBaseUrl}/api/downloads/${manifest.job_id}/complete`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders,
            },
            body: JSON.stringify({
              format_id: targetFormatId,
              delivery_mode: deliveryMode,
              bytes_downloaded: downloadedBytes,
            }),
          });
        } catch {
          // Gracefully continue if completion report fails
        }
      }

      if (onProgress) {
        onProgress({
          stage: 'complete',
          progressPercent: 100,
          downloadedBytes,
          totalBytes: downloadedBytes,
          speedFormatted: 'Done',
          etaFormatted: 'Complete',
          message: 'Download completed successfully',
          downloadUrl: blobUrl,
          blob: fileResult instanceof Blob ? fileResult : undefined,
        });
      }

      return {
        jobId: manifest.job_id,
        filename,
        totalBytes: downloadedBytes,
        deliveryMode,
        downloadUrl: blobUrl,
        blob: fileResult instanceof Blob ? fileResult : undefined,
      };
    } catch (err: any) {
      await sink.abort();
      throw err;
    }
  }
}

export * from './types';
export * from './capability';
export * from './strategy';
export * from './fetcher';
export * from './sink/sink';
export * from './muxer/mp4Muxer';
export * from './hls/hlsEngine';
export * from './hls/playlist';
export * from './hls/variant';
export * from './hls/decryptor';
export * from './hls/timeline';
export * from './hls/tsDemuxer';
export * from './hls/fmp4Demuxer';
export * from './hls/constants';
export * from './governor';

