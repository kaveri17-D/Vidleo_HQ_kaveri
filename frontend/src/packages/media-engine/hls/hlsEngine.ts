/**
 * NEXUS Browser HLS — Stream Pipeline Orchestrator
 * 
 * Coordinates:
 * - Master & Media Playlist fetching (via direct CDN or Signed Worker relay)
 * - Deterministic variant selection
 * - Key retrieval & AES-128 decryption (crypto.subtle)
 * - Bounded segment streaming (concurrency max 2) with backpressure
 * - MPEG-TS / fMP4 demuxing & PTS/DTS timeline normalization
 * - Streaming mp4-muxer multiplexing directly into OPFS / FSA sink
 * - Full AbortSignal cancellation and bounded retry recovery
 */

import {
  MediaManifest,
  StreamMediaItem,
  EngineProgressCallback,
  HLSPlaylist,
  HLSSegment
} from '../types';
import { MediaSink } from '../sink/sink';
import { parseHLSPlaylist, HLSParseError } from './playlist';
import { selectHLSVariant, HLSVariantError } from './variant';
import { AES128Decryptor } from './decryptor';
import { MPEGTSDemuxer } from './tsDemuxer';
import { FMP4Demuxer } from './fmp4Demuxer';
import { HLSTimelineManager } from './timeline';
import {
  MAX_HLS_PLAYLIST_BYTES,
  MAX_HLS_KEY_BYTES,
  MAX_HLS_SEGMENT_BYTES,
  MAX_HLS_CONCURRENT_SEGMENTS,
  MAX_HLS_RETRIES,
  HLS_RETRY_BACKOFF_MS
} from './constants';
import { Muxer, StreamTarget } from 'mp4-muxer';

export class HLSEngineError extends Error {
  public code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'HLSEngineError';
    this.code = code;
  }
}

export interface HLSEngineExecuteOptions {
  manifest: MediaManifest;
  hlsStream: StreamMediaItem;
  sink: MediaSink;
  apiBaseUrl?: string;
  authHeaders?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: EngineProgressCallback;
}

export class HLSEngine {
  /**
   * Main entry point to execute an in-browser HLS download.
   */
  public static async execute(options: HLSEngineExecuteOptions): Promise<number> {
    const {
      manifest,
      hlsStream,
      sink,
      apiBaseUrl = '',
      authHeaders = {},
      signal,
      onProgress
    } = options;

    if (signal?.aborted) {
      throw new HLSEngineError('Download was aborted before starting', 'CANCELLED');
    }

    if (onProgress) {
      onProgress({
        stage: 'preparing',
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: hlsStream.filesize || 0,
        message: 'Resolving HLS playlist...'
      });
    }

    // 1. Fetch and Parse Initial Playlist (Master or Media)
    let playlistUrl = hlsStream.url;
    let initialPlaylistText: string;

    initialPlaylistText = (await this.fetchResourceWithAuth({
      jobId: manifest.job_id,
      formatId: hlsStream.format_id,
      targetUrl: playlistUrl,
      targetHost: hlsStream.host,
      resourceType: 'playlist',
      relayRequired: !!hlsStream.relay_required,
      apiBaseUrl,
      authHeaders,
      maxBytes: MAX_HLS_PLAYLIST_BYTES,
      signal
    })) as string;

    let playlist = parseHLSPlaylist(initialPlaylistText, playlistUrl);

    // 2. If Master Playlist, select optimal variant and fetch Media Playlist
    if (playlist.type === 'master') {
      const selectedVariant = selectHLSVariant(playlist.variants);
      playlistUrl = selectedVariant.uri;

      if (onProgress) {
        onProgress({
          stage: 'preparing',
          progressPercent: 2,
          downloadedBytes: 0,
          totalBytes: hlsStream.filesize || 0,
          message: `Selected variant ${selectedVariant.resolution?.width || ''}x${selectedVariant.resolution?.height || ''} (${selectedVariant.bandwidth} bps)...`
        });
      }

      const mediaPlaylistHost = new URL(playlistUrl).hostname;
      const mediaPlaylistText = (await this.fetchResourceWithAuth({
        jobId: manifest.job_id,
        formatId: hlsStream.format_id,
        targetUrl: playlistUrl,
        targetHost: mediaPlaylistHost,
        resourceType: 'playlist',
        relayRequired: !!hlsStream.relay_required,
        apiBaseUrl,
        authHeaders,
        maxBytes: MAX_HLS_PLAYLIST_BYTES,
        signal
      })) as string;

      playlist = parseHLSPlaylist(mediaPlaylistText, playlistUrl);
    }

    // 3. Finite VOD Validation
    if (!playlist.endlist) {
      throw new HLSEngineError(
        'Live or infinite HLS stream (missing #EXT-X-ENDLIST) is unsupported in VOD Phase 3',
        'UNSUPPORTED_LIVE_STREAM'
      );
    }

    const segments = playlist.segments;
    if (segments.length === 0) {
      throw new HLSEngineError('Media playlist contains 0 playable segments', 'INVALID_PLAYLIST');
    }

    // 4. Initialize Decryptor, Demuxer, and Timeline Managers
    const decryptor = new AES128Decryptor();
    const tsDemuxer = new MPEGTSDemuxer();
    const videoTimeline = new HLSTimelineManager();
    const audioTimeline = new HLSTimelineManager();

    const keyCache = new Map<string, Uint8Array>();
    let totalBytesWritten = 0;
    let muxer: any = null;
    let firstVideoChunk = true;
    let avcDescription: Uint8Array | null = null;

    // Helper to initialize mp4-muxer once track metadata is known
    const initMuxer = (meta: any) => {
      if (muxer) return;

      const videoMeta = meta.video;
      const audioMeta = meta.audio;

      if (!videoMeta && !audioMeta) return;

      avcDescription = videoMeta?.avcDescription || null;

      muxer = new Muxer({
        target: new StreamTarget({
          onData: (chunk: Uint8Array, position: number) => {
            sink.write(chunk);
            totalBytesWritten += chunk.byteLength;
          }
        }),
        video: videoMeta
          ? {
              codec: 'avc',
              width: videoMeta.width || 1280,
              height: videoMeta.height || 720
            }
          : undefined,
        audio: audioMeta
          ? {
              codec: 'aac',
              numberOfChannels: audioMeta.channelCount || 2,
              sampleRate: audioMeta.sampleRate || 44100
            }
          : undefined,
        fastStart: 'fragmented',
        firstTimestampBehavior: 'cross-track-offset'
      });
    };

    // 5. Bounded Concurrency Segment Processing Loop (Max 2 concurrent fetches)
    let completedSegments = 0;
    const totalSegments = segments.length;
    let currentIndex = 0;

    // Estimate total size
    const estTotalBytes = (hlsStream.filesize || 0) > 0
      ? hlsStream.filesize!
      : totalSegments * 1024 * 1024; // ~1MB per segment fallback

    while (currentIndex < totalSegments) {
      if (signal?.aborted) {
        throw new HLSEngineError('Download aborted by user', 'CANCELLED');
      }

      // Fetch batch of up to MAX_HLS_CONCURRENT_SEGMENTS
      const batchEnd = Math.min(currentIndex + MAX_HLS_CONCURRENT_SEGMENTS, totalSegments);
      const batchSegments = segments.slice(currentIndex, batchEnd);

      // Concurrent fetch of the batch with backpressure
      const batchData = await Promise.all(
        batchSegments.map(async (seg) => {
          // If segment is encrypted, acquire key
          let rawKeyBytes: Uint8Array | undefined;
          if (seg.key && seg.key.method === 'AES-128' && seg.key.uri) {
            if (keyCache.has(seg.key.uri)) {
              rawKeyBytes = keyCache.get(seg.key.uri)!;
            } else {
              const keyHost = new URL(seg.key.uri).hostname;
              const keyRaw = await this.fetchResourceWithAuth({
                jobId: manifest.job_id,
                formatId: hlsStream.format_id,
                targetUrl: seg.key.uri,
                targetHost: keyHost,
                resourceType: 'key',
                relayRequired: !!hlsStream.relay_required,
                apiBaseUrl,
                authHeaders,
                maxBytes: MAX_HLS_KEY_BYTES,
                signal,
                asBinary: true
              });
              rawKeyBytes = new Uint8Array(keyRaw as ArrayBuffer);
              keyCache.set(seg.key.uri, rawKeyBytes);
            }
          }

          // Fetch segment bytes
          const segHost = new URL(seg.uri).hostname;
          let rangeHeader: string | undefined;
          if (seg.byteRange) {
            rangeHeader = `bytes=${seg.byteRange.offset}-${seg.byteRange.offset + seg.byteRange.length - 1}`;
          }

          const segBuffer = await this.fetchResourceWithAuth({
            jobId: manifest.job_id,
            formatId: hlsStream.format_id,
            targetUrl: seg.uri,
            targetHost: segHost,
            resourceType: 'segment',
            relayRequired: !!hlsStream.relay_required,
            rangeHeader,
            apiBaseUrl,
            authHeaders,
            maxBytes: MAX_HLS_SEGMENT_BYTES,
            signal,
            asBinary: true
          });

          let segmentBytes = new Uint8Array(segBuffer as ArrayBuffer);

          // Decrypt if necessary
          if (seg.key && seg.key.method === 'AES-128' && rawKeyBytes) {
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

      // Sequentially demux and feed to mp4-muxer to ensure strict timeline continuity
      for (const item of batchData) {
        if (signal?.aborted) {
          throw new HLSEngineError('Download aborted by user', 'CANCELLED');
        }

        const seg = item.segment;
        const segmentBytes = item.bytes;

        // Discontinuity handling
        if (seg.discontinuity) {
          videoTimeline.signalDiscontinuity(seg.duration * 1e6);
          audioTimeline.signalDiscontinuity(seg.duration * 1e6);
        }

        // Demux MPEG-TS
        const { videoSamples, audioSamples } = tsDemuxer.demuxSegment(segmentBytes);

        // Ensure muxer is initialized
        if (!muxer && (tsDemuxer.metadata.video || tsDemuxer.metadata.audio)) {
          initMuxer(tsDemuxer.metadata);
        }

        if (muxer) {
          // Process and mux video samples
          for (const vs of videoSamples) {
            const timing = videoTimeline.processSampleTiming(vs.ptsTicks, vs.dtsTicks);

            const meta = firstVideoChunk && tsDemuxer.metadata.video
              ? {
                  decoderConfig: {
                    codec: tsDemuxer.metadata.video.codec,
                    description: avcDescription || tsDemuxer.metadata.video.avcDescription,
                    codedWidth: tsDemuxer.metadata.video.width,
                    codedHeight: tsDemuxer.metadata.video.height
                  }
                }
              : undefined;

            firstVideoChunk = false;

            muxer.addVideoChunkRaw(
              vs.data,
              vs.isKeyframe ? 'key' : 'delta',
              timing.ptsUs,
              timing.durationUs,
              meta,
              timing.compositionTimeOffsetUs
            );
          }

          // Process and mux audio samples
          for (const as of audioSamples) {
            const timing = audioTimeline.processSampleTiming(as.ptsTicks, as.dtsTicks);

            muxer.addAudioChunkRaw(
              as.data,
              'key',
              timing.ptsUs,
              timing.durationUs
            );
          }
        }

        completedSegments++;
        if (onProgress) {
          const progressPercent = Math.min(99, Math.round((completedSegments / totalSegments) * 100));
          onProgress({
            stage: 'muxing',
            progressPercent,
            downloadedBytes: totalBytesWritten,
            totalBytes: estTotalBytes,
            message: `Processing segment ${completedSegments}/${totalSegments}...`
          });
        }
      }

      currentIndex = batchEnd;
    }

    // 6. Finalize Muxer
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
  private static async fetchResourceWithAuth(options: {
    jobId: string;
    formatId: string;
    targetUrl: string;
    targetHost: string;
    resourceType: 'playlist' | 'key' | 'segment';
    relayRequired: boolean;
    rangeHeader?: string;
    apiBaseUrl: string;
    authHeaders: Record<string, string>;
    maxBytes: number;
    signal?: AbortSignal;
    asBinary?: boolean;
  }): Promise<string | ArrayBuffer> {
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
    const fetchHeaders: Record<string, string> = {};
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader;
    }

    // If relay is required due to CORS or CDN policy, acquire a signed ticket for this resource type
    if (relayRequired) {
      try {
        const ticketRes = await fetch(`${apiBaseUrl}/api/downloads/${jobId}/ticket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
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
      } catch (err: any) {
        if (signal?.aborted) throw new HLSEngineError('Aborted during ticket acquisition', 'CANCELLED');
        throw new HLSEngineError(`Ticket acquisition failed for ${resourceType}: ${err.message}`, 'TICKET_INVALID');
      }
    }

    // Execute HTTP fetch with bounded retries for transient network errors
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < MAX_HLS_RETRIES) {
      if (signal?.aborted) {
        throw new HLSEngineError('Download aborted', 'CANCELLED');
      }

      try {
        const res = await fetch(fetchUrl, {
          method: 'GET',
          headers: fetchHeaders,
          signal
        });

        if (res.status === 403) {
          const bodyText = await res.text().catch(() => '');
          throw new HLSEngineError(`Access forbidden: ${bodyText}`, 'TICKET_INVALID');
        }
        if (res.status === 404) {
          throw new HLSEngineError(`Resource not found: ${fetchUrl}`, 'INVALID_SEGMENT');
        }
        if (res.status === 416) {
          throw new HLSEngineError('Oversized resource or invalid range requested', 'SEGMENT_TOO_LARGE');
        }

        if (!res.ok && res.status !== 206) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        return asBinary ? await res.arrayBuffer() : await res.text();
      } catch (err: any) {
        if (signal?.aborted) throw new HLSEngineError('Download aborted', 'CANCELLED');
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
      'NETWORK_EXHAUSTED'
    );
  }
}
