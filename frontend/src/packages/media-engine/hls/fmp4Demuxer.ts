/**
 * NEXUS Browser HLS — Fragmented MP4 (fMP4) Demuxer
 * 
 * Reuses existing mp4box infrastructure to process HLS fMP4 initialization
 * segments (#EXT-X-MAP) and fragmented media segments (moof + mdat).
 */

import * as MP4BoxModule from 'mp4box';
const MP4Box = (MP4BoxModule as any).default || MP4BoxModule;

export interface FMP4Sample {
  type: 'video' | 'audio';
  data: Uint8Array;
  isKeyframe: boolean;
  cts: number;
  dts: number;
  duration: number;
  timescale: number;
}

export class FMP4Demuxer {
  private mp4boxFile: any;
  private currentOffset: number = 0;
  private pendingSamples: FMP4Sample[] = [];

  public videoTrackId: number | null = null;
  public audioTrackId: number | null = null;
  public trackInfo: any = null;
  public avcDescription: Uint8Array | null = null;

  constructor() {
    this.mp4boxFile = (MP4Box.createFile || (MP4BoxModule as any).createFile)();

    this.mp4boxFile.onReady = (info: any) => {
      this.trackInfo = info;
      const vTrack = info.tracks.find((t: any) => t.video);
      const aTrack = info.tracks.find((t: any) => t.audio);

      if (vTrack) {
        this.videoTrackId = vTrack.id;
        this.mp4boxFile.setExtractionOptions(vTrack.id, null, { nbSamples: 1000 });
        if (this.mp4boxFile.moov?.traks) {
          const trak = this.mp4boxFile.moov.traks.find((t: any) => t.tkhd.track_id === vTrack.id);
          const avcC = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]?.avcC;
          if (avcC) {
            const DataStream = MP4Box.DataStream || (MP4BoxModule as any).DataStream;
            const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
            avcC.write(stream);
            this.avcDescription = new Uint8Array(stream.buffer.slice(8));
          }
        }
      }

      if (aTrack) {
        this.audioTrackId = aTrack.id;
        this.mp4boxFile.setExtractionOptions(aTrack.id, null, { nbSamples: 1000 });
      }

      this.mp4boxFile.start();
    };

    this.mp4boxFile.onSamples = (id: number, user: any, samples: any[]) => {
      const isVideo = id === this.videoTrackId;
      const isAudio = id === this.audioTrackId;
      if (!isVideo && !isAudio) return;

      for (const s of samples) {
        this.pendingSamples.push({
          type: isVideo ? 'video' : 'audio',
          data: s.data,
          isKeyframe: !!s.is_sync,
          cts: s.cts,
          dts: s.dts,
          duration: s.duration,
          timescale: s.timescale
        });
      }
    };
  }

  /**
   * Appends an initialization segment (#EXT-X-MAP) or media fragment segment.
   */
  public appendBuffer(buffer: Uint8Array): FMP4Sample[] {
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as any;
    ab.fileStart = this.currentOffset;
    this.currentOffset += buffer.byteLength;

    this.pendingSamples = [];
    this.mp4boxFile.appendBuffer(ab);
    this.mp4boxFile.flush();

    const result = [...this.pendingSamples];
    this.pendingSamples = [];
    return result;
  }

  public reset(): void {
    this.currentOffset = 0;
    this.pendingSamples = [];
  }
}
