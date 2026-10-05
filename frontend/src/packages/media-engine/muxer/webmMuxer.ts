/**
 * NEXUS Streaming In-Browser WebM Remuxer
 * 
 * Multiplexes separate 4K/UHD video (VP9 / AV1) and audio (Opus) streams into a single
 * valid WebM container in real-time without transcoding, streaming output directly to a MediaSink.
 */

import { Muxer, StreamTarget } from 'webm-muxer';
import { MediaSink } from '../sink/sink';
import { EngineProgressCallback } from '../types';
import { filterSafeBrowserHeaders } from '../fetcher';
import { RemuxStreamSource, StreamingRemuxOptions } from './mp4Muxer';

export class StreamingWebMDemuxer {
  public type: 'video' | 'audio';
  private buffer: Uint8Array = new Uint8Array(0);
  private offset: number = 0;
  public timecodeScale: number = 1000000;
  public clusterTimecode: number = 0;
  public trackCodec: string = '';
  public width: number = 0;
  public height: number = 0;
  public sampleRate: number = 48000;
  public channels: number = 2;
  public codecPrivate: Uint8Array | null = null;
  public ready: boolean = false;
  public onReady: ((info: any) => void) | null = null;
  public onSample: ((sample: any) => void) | null = null;

  constructor(type: 'video' | 'audio') {
    this.type = type;
  }

  public appendBuffer(chunk: Uint8Array): void {
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

  private readVint(offset: number = this.offset): { val: number; len: number } | null {
    if (offset >= this.buffer.length) return null;
    const b = this.buffer[offset];
    let len = 1;
    let mask = 0x80;
    while (len <= 8 && !(b & mask)) {
      len++;
      mask >>= 1;
    }
    if (len > 8 || offset + len > this.buffer.length) return null;
    let val = b & ~mask;
    for (let i = 1; i < len; i++) {
      val = (val * 256) + this.buffer[offset + i];
    }
    return { val, len };
  }

  private readElementId(offset: number = this.offset): { id: number; len: number } | null {
    if (offset >= this.buffer.length) return null;
    const b = this.buffer[offset];
    let len = 1;
    let mask = 0x80;
    while (len <= 4 && !(b & mask)) {
      len++;
      mask >>= 1;
    }
    if (len > 4 || offset + len > this.buffer.length) return null;
    let id = 0;
    for (let i = 0; i < len; i++) {
      id = (id * 256) + this.buffer[offset + i];
    }
    return { id, len };
  }

  private parse(): void {
    while (this.offset < this.buffer.length) {
      const el = this.readElementId(this.offset);
      if (!el) break;
      const sz = this.readVint(this.offset + el.len);
      if (!sz) break;

      const headerLen = el.len + sz.len;
      const dataSize = sz.val;
      const elemStart = this.offset + headerLen;

      // Master elements we descend into
      if (
        el.id === 0x1A45DFA3 || // EBML
        el.id === 0x18538067 || // Segment
        el.id === 0x1549A966 || // Info
        el.id === 0x1654AE6B || // Tracks
        el.id === 0xAE ||       // TrackEntry
        el.id === 0xE0 ||       // Video
        el.id === 0xE1 ||       // Audio
        el.id === 0x1F43B675    // Cluster
      ) {
        this.offset += headerLen;
        continue;
      }

      if (elemStart + dataSize > this.buffer.length) {
        break; // Wait for next buffer chunk
      }

      // Process leaf elements
      if (el.id === 0x2AD7B1) { // TimecodeScale
        let ts = 0;
        for (let i = 0; i < dataSize; i++) ts = (ts * 256) + this.buffer[elemStart + i];
        this.timecodeScale = ts || 1000000;
      } else if (el.id === 0x86) { // CodecID
        let s = '';
        for (let i = 0; i < dataSize; i++) s += String.fromCharCode(this.buffer[elemStart + i]);
        if (!this.trackCodec) this.trackCodec = s;
      } else if (el.id === 0xB0) { // PixelWidth
        let w = 0;
        for (let i = 0; i < dataSize; i++) w = (w * 256) + this.buffer[elemStart + i];
        this.width = w;
      } else if (el.id === 0xBA) { // PixelHeight
        let h = 0;
        for (let i = 0; i < dataSize; i++) h = (h * 256) + this.buffer[elemStart + i];
        this.height = h;
      } else if (el.id === 0xB5) { // SamplingFrequency
        const dv = new DataView(this.buffer.buffer, this.buffer.byteOffset + elemStart, dataSize);
        if (dataSize === 4) this.sampleRate = dv.getFloat32(0, false);
        else if (dataSize === 8) this.sampleRate = dv.getFloat64(0, false);
        else this.sampleRate = 48000;
      } else if (el.id === 0x9F) { // Channels
        let ch = 0;
        for (let i = 0; i < dataSize; i++) ch = (ch * 256) + this.buffer[elemStart + i];
        this.channels = ch || 2;
      } else if (el.id === 0x63A2) { // CodecPrivate (OpusHead)
        this.codecPrivate = this.buffer.slice(elemStart, elemStart + dataSize);
      } else if (el.id === 0xE7) { // Cluster Timecode
        let tc = 0;
        for (let i = 0; i < dataSize; i++) tc = (tc * 256) + this.buffer[elemStart + i];
        this.clusterTimecode = tc;
        if (!this.ready && (this.width > 0 || this.sampleRate > 0)) {
          this.ready = true;
          if (this.onReady) {
            this.onReady({
              type: this.type,
              codec: this.trackCodec,
              width: this.width || 3840,
              height: this.height || 2160,
              sampleRate: this.sampleRate || 48000,
              channels: this.channels || 2,
              codecPrivate: this.codecPrivate,
            });
          }
        }
      } else if (el.id === 0xA3) { // SimpleBlock
        const trackVint = this.readVint(elemStart);
        if (trackVint) {
          const relTimeOffset = elemStart + trackVint.len;
          const dv = new DataView(this.buffer.buffer, this.buffer.byteOffset + relTimeOffset, 2);
          const relTime = dv.getInt16(0, false);
          const flags = this.buffer[relTimeOffset + 2];
          const isKeyframe = (flags & 0x80) !== 0;
          const payload = this.buffer.slice(relTimeOffset + 3, elemStart + dataSize);

          const timecodeMs = this.clusterTimecode + relTime;
          const timestampUs = Math.round(timecodeMs * (this.timecodeScale / 1000));

          if (this.onSample) {
            this.onSample({
              data: payload,
              is_sync: isKeyframe,
              timestampUs,
            });
          }
        }
      }

      this.offset = elemStart + dataSize;
    }
  }
}

export class StreamingWebMMuxer {
  public static async remux(options: StreamingRemuxOptions): Promise<number> {
    const {
      video,
      audio,
      sink,
      chunkSize = 512 * 1024,
      signal,
      onProgress,
    } = options;

    const vDemux = new StreamingWebMDemuxer('video');
    const aDemux = new StreamingWebMDemuxer('audio');

    let vReady = false;
    let aReady = false;
    let vInfo: any = null;
    let aInfo: any = null;

    let muxer: any = null;
    let bytesWritten = 0;
    let baseTimestampUs = -1;

    const pendingWrites: Promise<void>[] = [];
    const pendingVideoSamples: any[] = [];
    const pendingAudioSamples: any[] = [];

    let vSampleCount = 0;
    let aSampleCount = 0;
    let firstVideoPts = -1;
    let lastVideoPts = -1;
    let firstAudioPts = -1;
    let lastAudioPts = -1;
    let firstAudioSample = true;

    let vActualTotal: number | null = video.totalBytes || null;
    let aActualTotal: number | null = audio.totalBytes || null;

    const processVideoSample = (s: any) => {
      vSampleCount++;
      if (firstVideoPts === -1) firstVideoPts = s.timestampUs;
      lastVideoPts = s.timestampUs;

      if (baseTimestampUs === -1) {
        baseTimestampUs = Math.min(firstVideoPts, firstAudioPts >= 0 ? firstAudioPts : firstVideoPts);
      }

      const normalizedTs = Math.max(0, s.timestampUs - baseTimestampUs);
      muxer.addVideoChunkRaw(
        s.data,
        s.is_sync ? 'key' : 'delta',
        normalizedTs
      );
    };

    const processAudioSample = (s: any) => {
      aSampleCount++;
      if (firstAudioPts === -1) firstAudioPts = s.timestampUs;
      lastAudioPts = s.timestampUs;

      if (baseTimestampUs === -1) {
        baseTimestampUs = Math.min(firstVideoPts >= 0 ? firstVideoPts : firstAudioPts, firstAudioPts);
      }

      const normalizedTs = Math.max(0, s.timestampUs - baseTimestampUs);
      const meta = firstAudioSample && aInfo?.codecPrivate
        ? { decoderConfig: { description: aInfo.codecPrivate } }
        : undefined;
      firstAudioSample = false;

      muxer.addAudioChunkRaw(s.data, 'key', normalizedTs, meta);
    };

    const initMuxerIfReady = () => {
      if (muxer || !vReady || !aReady) return;

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
          codec: vInfo.codec?.includes('AV1') || vInfo.codec?.includes('av01') ? 'V_AV1' : 'V_VP9',
          width: vInfo.width || 3840,
          height: vInfo.height || 2160,
          frameRate: 30,
        },
        audio: {
          codec: 'A_OPUS',
          numberOfChannels: aInfo.channels || 2,
          sampleRate: Math.round(aInfo.sampleRate) || 48000,
        },
        firstTimestampBehavior: 'permissive',
      });

      while (pendingVideoSamples.length > 0) {
        processVideoSample(pendingVideoSamples.shift());
      }
      while (pendingAudioSamples.length > 0) {
        processAudioSample(pendingAudioSamples.shift());
      }
    };

    vDemux.onReady = (info: any) => {
      vInfo = info;
      vReady = true;
      initMuxerIfReady();
    };

    aDemux.onReady = (info: any) => {
      aInfo = info;
      aReady = true;
      initMuxerIfReady();
    };

    vDemux.onSample = (s: any) => {
      if (!muxer) pendingVideoSamples.push(s);
      else processVideoSample(s);
    };

    aDemux.onSample = (s: any) => {
      if (!muxer) pendingAudioSamples.push(s);
      else processAudioSample(s);
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

      if (res.status === 416) return new Uint8Array(0);
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

    const totalEst = (video.totalBytes || 20 * 1024 * 1024) + (audio.totalBytes || 2 * 1024 * 1024);
    let vOffset = 0;
    let aOffset = 0;
    let vDone = false;
    let aDone = false;

    // Header 256KB
    const initSize = 256 * 1024;
    const [vHeader, aHeader] = await Promise.all([
      fetchRange(video.url, 0, initSize - 1, video.headers, true),
      fetchRange(audio.url, 0, initSize - 1, audio.headers, false),
    ]);

    vDemux.appendBuffer(vHeader);
    vOffset = vHeader.byteLength;

    aDemux.appendBuffer(aHeader);
    aOffset = aHeader.byteLength;

    initMuxerIfReady();

    const startTime = Date.now();
    let lastProgressTime = 0;

    while (!vDone || !aDone) {
      if (signal?.aborted) throw new Error('Remuxing aborted by user');

      const vFetchEnd = Math.min(vOffset + chunkSize - 1, (vActualTotal || Infinity) - 1);
      const aFetchEnd = Math.min(aOffset + chunkSize - 1, (aActualTotal || Infinity) - 1);

      const fetches: Promise<any>[] = [];

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
        const percent = Math.min(99, Math.round((totalProcessed / effectiveTotal) * 100));
        const elapsedSec = (now - startTime) / 1000;
        const bytesPerSec = elapsedSec > 0 ? totalProcessed / elapsedSec : 0;
        const remainingBytes = Math.max(0, effectiveTotal - totalProcessed);
        const etaSec = bytesPerSec > 0 ? Math.round(remainingBytes / bytesPerSec) : 0;

        if (onProgress) {
          onProgress({
            stage: 'muxing',
            progressPercent: percent,
            downloadedBytes: totalProcessed,
            totalBytes: effectiveTotal,
            speedFormatted: bytesPerSec > 1024 * 1024 ? `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s` : `${Math.round(bytesPerSec / 1024)} KB/s`,
            etaFormatted: etaSec > 0 ? `${etaSec}s` : 'Finishing...',
            message: `Remuxing 4K streams in-browser (${percent}%)...`,
          });
        }
      }
    }

    if (muxer) {
      muxer.finalize();
    }

    // Await all pending writes from onData to be safely flushed to the sink
    await Promise.all(pendingWrites);

    if (bytesWritten === 0) {
      throw new Error('MEDIA_INTEGRITY: FAIL_EMPTY_STREAM (StreamingWebMMuxer wrote 0 bytes to sink)');
    }

    // Media Integrity Gate
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
      `[NEXUS MediaEngine] 4K WebM MEDIA_INTEGRITY: PASS (video: ${videoDuration.toFixed(3)}s [${vSampleCount} frames], audio: ${audioDuration.toFixed(3)}s [${aSampleCount} samples], delta: ${(delta * 1000).toFixed(1)}ms)`
    );

    return bytesWritten;
  }
}
