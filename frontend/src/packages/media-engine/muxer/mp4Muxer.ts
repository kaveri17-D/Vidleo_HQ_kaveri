/**
 * NEXUS Streaming In-Browser MP4 Remuxer
 * 
 * Multiplexes separate video (H.264/AVC) and audio (AAC) streams into a single
 * valid fragmented MP4 container in real-time, streaming output directly to a MediaSink
 * with bounded memory consumption.
 */

import * as MP4BoxModule from 'mp4box';
import { Muxer, StreamTarget } from 'mp4-muxer';
import { MediaSink } from '../sink/sink';
import { EngineProgressCallback } from '../types';
import { filterSafeBrowserHeaders } from '../fetcher';

const MP4Box: any = (MP4BoxModule as any).default || MP4BoxModule;

export interface RemuxStreamSource {
  url: string;
  totalBytes?: number;
  headers?: Record<string, string>;
}

export interface StreamingRemuxOptions {
  video: RemuxStreamSource;
  audio: RemuxStreamSource;
  sink: MediaSink;
  chunkSize?: number;
  signal?: AbortSignal;
  onProgress?: EngineProgressCallback;
}

export class StreamingMP4Muxer {
  public static async remux(options: StreamingRemuxOptions): Promise<number> {
    const {
      video,
      audio,
      sink,
      chunkSize = 512 * 1024,
      signal,
      onProgress,
    } = options;

    const vDemux = MP4Box.createFile();
    const aDemux = MP4Box.createFile();

    let vReady = false;
    let aReady = false;
    let vInfo: any = null;
    let aInfo: any = null;

    let muxer: any = null;
    let firstVideoSample = true;
    let avcDescription: Uint8Array | null = null;
    let bytesWritten = 0;

    const pendingWrites: Promise<void>[] = [];
    const pendingVideoSamples: any[] = [];
    const pendingAudioSamples: any[] = [];

    let vSampleCount = 0;
    let aSampleCount = 0;
    let firstVideoPts = -1;
    let lastVideoPts = -1;
    let firstAudioPts = -1;
    let lastAudioPts = -1;

    let vActualTotal: number | null = video.totalBytes || null;
    let aActualTotal: number | null = audio.totalBytes || null;

    const processVideoSample = (s: any) => {
      vSampleCount++;
      const timestampUs = Math.round((s.cts / s.timescale) * 1e6);
      const durationUs = Math.round((s.duration / s.timescale) * 1e6);
      const compositionTimeOffsetUs = Math.round(((s.cts - s.dts) / s.timescale) * 1e6);

      if (firstVideoPts === -1) firstVideoPts = timestampUs;
      lastVideoPts = timestampUs + durationUs;

      const meta = firstVideoSample
        ? {
            decoderConfig: {
              codec: vInfo.tracks[0]?.codec || 'avc1.4d401f',
              description: avcDescription || undefined,
              codedWidth: vInfo.tracks[0]?.video?.width,
              codedHeight: vInfo.tracks[0]?.video?.height,
            },
          }
        : undefined;

      firstVideoSample = false;

      muxer.addVideoChunkRaw(
        s.data,
        s.is_sync ? 'key' : 'delta',
        timestampUs,
        durationUs,
        meta,
        compositionTimeOffsetUs
      );
    };

    const processAudioSample = (s: any) => {
      aSampleCount++;
      const timestampUs = Math.round((s.cts / s.timescale) * 1e6);
      const durationUs = Math.round((s.duration / s.timescale) * 1e6);

      if (firstAudioPts === -1) firstAudioPts = timestampUs;
      lastAudioPts = timestampUs + durationUs;

      muxer.addAudioChunkRaw(s.data, 'key', timestampUs, durationUs);
    };

    vDemux.onReady = (info: any) => {
      vInfo = info;
      vReady = true;
      vDemux.setExtractionOptions(info.tracks[0].id, null, { nbSamples: 1000 });
      vDemux.start();
      initMuxerIfReady();
    };

    aDemux.onReady = (info: any) => {
      aInfo = info;
      aReady = true;
      aDemux.setExtractionOptions(info.tracks[0].id, null, { nbSamples: 1000 });
      aDemux.start();
      initMuxerIfReady();
    };

    const initMuxerIfReady = () => {
      if (muxer || !vReady || !aReady) return;

      const vTrack = vInfo.tracks[0];
      const aTrack = aInfo.tracks[0];

      // Extract avcC description buffer from demuxer moov
      try {
        const avcCBox = vDemux.moov.traks[0].mdia.minf.stbl.stsd.entries[0].avcC;
        const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
        avcCBox.write(stream);
        avcDescription = new Uint8Array(stream.buffer.slice(8));
      } catch {
        avcDescription = null;
      }

      muxer = new Muxer({
        target: new StreamTarget({
          onData: (dataChunk: Uint8Array, position: number) => {
            const p = (async () => {
              await sink.write(dataChunk, position);
              bytesWritten += dataChunk.byteLength;
            })();
            pendingWrites.push(p);
          },
        }),
        video: {
          codec: 'avc',
          width: vTrack.video?.width || 1280,
          height: vTrack.video?.height || 720,
        },
        audio: {
          codec: 'aac',
          numberOfChannels: aTrack.audio?.channel_count || 2,
          sampleRate: aTrack.audio?.sample_rate || 44100,
        },
        fastStart: 'fragmented',
        firstTimestampBehavior: 'cross-track-offset',
      });

      // Drain all pending samples queued before muxer initialization
      while (pendingVideoSamples.length > 0) {
        processVideoSample(pendingVideoSamples.shift());
      }
      while (pendingAudioSamples.length > 0) {
        processAudioSample(pendingAudioSamples.shift());
      }
    };

    vDemux.onSamples = (id: any, user: any, samples: any[]) => {
      for (const s of samples) {
        if (!muxer) {
          pendingVideoSamples.push(s);
        } else {
          processVideoSample(s);
        }
      }
    };

    aDemux.onSamples = (id: any, user: any, samples: any[]) => {
      for (const s of samples) {
        if (!muxer) {
          pendingAudioSamples.push(s);
        } else {
          processAudioSample(s);
        }
      }
    };

    const fetchRange = async (
      url: string,
      start: number,
      end: number,
      headers: Record<string, string> = {},
      isVideo: boolean = true
    ): Promise<Uint8Array> => {
      const safeHeaders = filterSafeBrowserHeaders(headers);
      const res = await fetch(url, {
        headers: {
          ...safeHeaders,
          Range: `bytes=${start}-${end}`,
        },
        signal,
      });

      if (res.status === 416) {
        return new Uint8Array(0);
      }

      if (res.status !== 206 && res.status !== 200) {
        throw new Error(`Upstream returned HTTP ${res.status}`);
      }

      const cr = res.headers.get('content-range');
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

    // Range-chunk parallel stream pump
    const totalEst = (video.totalBytes || 10 * 1024 * 1024) + (audio.totalBytes || 2 * 1024 * 1024);
    let vOffset = 0;
    let aOffset = 0;
    let vDone = false;
    let aDone = false;

    // Phase 1: Fetch moov headers to initialize demuxers and muxer
    // MP4 header is typically within first 256KB
    const initSize = 256 * 1024;
    const [vHeader, aHeader] = await Promise.all([
      fetchRange(video.url, 0, initSize - 1, video.headers, true),
      fetchRange(audio.url, 0, initSize - 1, audio.headers, false),
    ]);

    const vBuf = vHeader.buffer.slice(vHeader.byteOffset, vHeader.byteOffset + vHeader.byteLength) as any;
    vBuf.fileStart = 0;
    vDemux.appendBuffer(vBuf);
    vOffset = vHeader.byteLength;

    const aBuf = aHeader.buffer.slice(aHeader.byteOffset, aHeader.byteOffset + aHeader.byteLength) as any;
    aBuf.fileStart = 0;
    aDemux.appendBuffer(aBuf);
    aOffset = aHeader.byteLength;

    initMuxerIfReady();

    // Phase 2: Stream remaining media chunks concurrently
    while (!vDone || !aDone) {
      if (signal?.aborted) {
        throw new Error('Download aborted by user');
      }

      const tasks: Promise<void>[] = [];

      if (!vDone) {
        const vEnd = (vActualTotal && vOffset + chunkSize >= vActualTotal)
          ? vActualTotal - 1
          : vOffset + chunkSize - 1;

        tasks.push(
          fetchRange(video.url, vOffset, vEnd, video.headers, true).then((data) => {
            if (data.length === 0 || (vActualTotal && vOffset >= vActualTotal)) {
              vDone = true;
              return;
            }
            const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as any;
            buf.fileStart = vOffset;
            vDemux.appendBuffer(buf);
            vOffset += data.length;
            if (data.length < (vEnd - vOffset + data.length + 1) && !vActualTotal) {
              vDone = true;
            }
            if (vActualTotal && vOffset >= vActualTotal) {
              vDone = true;
            }
          })
        );
      }

      if (!aDone) {
        const aEnd = (aActualTotal && aOffset + chunkSize >= aActualTotal)
          ? aActualTotal - 1
          : aOffset + chunkSize - 1;

        tasks.push(
          fetchRange(audio.url, aOffset, aEnd, audio.headers, false).then((data) => {
            if (data.length === 0 || (aActualTotal && aOffset >= aActualTotal)) {
              aDone = true;
              return;
            }
            const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as any;
            buf.fileStart = aOffset;
            aDemux.appendBuffer(buf);
            aOffset += data.length;
            if (data.length < (aEnd - aOffset + data.length + 1) && !aActualTotal) {
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
        const pct = Math.min(99, Math.round((currentBytes / totalEst) * 100));
        onProgress({
          stage: 'muxing',
          progressPercent: pct,
          downloadedBytes: currentBytes,
          totalBytes: totalEst,
          message: `Streaming & remuxing: ${pct}%`,
        });
      }
    }

    // Phase 3: Finalize demuxers and muxer
    vDemux.flush();
    aDemux.flush();
    if (muxer) {
      muxer.finalize();
    }

    // Await all pending writes from onData to be safely flushed to the sink
    await Promise.all(pendingWrites);

    if (bytesWritten === 0) {
      throw new Error('MEDIA_INTEGRITY: FAIL_EMPTY_STREAM (StreamingMP4Muxer wrote 0 bytes to sink)');
    }

    // Phase 10: Final Media Integrity Gate
    const videoDuration = firstVideoPts >= 0 ? (lastVideoPts - firstVideoPts) / 1e6 : 0;
    const audioDuration = firstAudioPts >= 0 ? (lastAudioPts - firstAudioPts) / 1e6 : 0;

    if (vSampleCount === 0 || aSampleCount === 0) {
      throw new Error(
        `MEDIA_INTEGRITY: FAIL_AV_SYNC (missing stream samples: video=${vSampleCount} frames, audio=${aSampleCount} samples)`
      );
    }

    const delta = Math.abs(videoDuration - audioDuration);
    if (Math.max(videoDuration, audioDuration) > 5.0 && delta > 3.0) {
      throw new Error(
        `MEDIA_INTEGRITY: FAIL_AV_SYNC (video: ${videoDuration.toFixed(2)}s [${vSampleCount} frames], audio: ${audioDuration.toFixed(2)}s [${aSampleCount} samples], delta: ${delta.toFixed(2)}s exceeds 3.0s threshold)`
      );
    }

    console.log(
      `[NEXUS MediaEngine] MEDIA_INTEGRITY: PASS (video: ${videoDuration.toFixed(3)}s [${vSampleCount} frames], audio: ${audioDuration.toFixed(3)}s [${aSampleCount} samples], delta: ${(delta * 1000).toFixed(1)}ms)`
    );

    return bytesWritten;
  }
}
