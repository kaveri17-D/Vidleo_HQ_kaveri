/**
 * NEXUS Browser HLS — Bounded MPEG-TS Demuxer
 * 
 * Complies with ISO/IEC 13818-1 (MPEG-2 Systems), ISO/IEC 14496-10 (AVC/H.264),
 * and ISO/IEC 13818-7 (AAC ADTS).
 * Bounded zero-copy packet iteration, PAT/PMT mapping, PES reassembly,
 * Annex B NAL unit extraction, and ADTS frame parsing.
 */

export class HLSDemuxError extends Error {
  public code: string;
  constructor(message: string, code: string = 'INVALID_SEGMENT') {
    super(message);
    this.name = 'HLSDemuxError';
    this.code = code;
  }
}

export interface VideoSample {
  data: Uint8Array;
  isKeyframe: boolean;
  ptsTicks: number;
  dtsTicks: number;
}

export interface AudioSample {
  data: Uint8Array;
  ptsTicks: number;
  dtsTicks: number;
}

export interface TrackMetadata {
  video?: {
    codec: string;
    width: number;
    height: number;
    sps?: Uint8Array;
    pps?: Uint8Array;
    avcDescription?: Uint8Array;
  };
  audio?: {
    codec: string;
    sampleRate: number;
    channelCount: number;
    profile: number;
    audioDescription?: Uint8Array;
  };
}

const TS_PACKET_SIZE = 188;
const SYNC_BYTE = 0x47;

const AAC_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350
];

export class MPEGTSDemuxer {
  private pmtPid: number | null = null;
  private videoPid: number | null = null;
  private audioPid: number | null = null;

  // PES reassembly buffers
  private videoPesBuffer: Uint8Array[] = [];
  private videoPesLength: number = 0;
  private audioPesBuffer: Uint8Array[] = [];
  private audioPesLength: number = 0;

  // Track metadata
  public metadata: TrackMetadata = {};
  private sps: Uint8Array | null = null;
  private pps: Uint8Array | null = null;

  /**
   * Resets demuxer state for a new timeline.
   */
  public reset(): void {
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
  public demuxSegment(segmentData: Uint8Array): {
    videoSamples: VideoSample[];
    audioSamples: AudioSample[];
  } {
    const videoSamples: VideoSample[] = [];
    const audioSamples: AudioSample[] = [];

    if (!segmentData || segmentData.length === 0) {
      throw new HLSDemuxError('Segment data is empty', 'INVALID_SEGMENT');
    }

    // Support Audio-Only HLS segments (raw AAC ADTS with optional ID3v2 metadata prefix)
    if (segmentData.length >= 10 && segmentData[0] === 0x49 && segmentData[1] === 0x44 && segmentData[2] === 0x33) {
      const id3PayloadLen =
        ((segmentData[6] & 0x7f) << 21) |
        ((segmentData[7] & 0x7f) << 14) |
        ((segmentData[8] & 0x7f) << 7) |
        (segmentData[9] & 0x7f);
      const audioStart = 10 + id3PayloadLen;
      if (audioStart < segmentData.length) {
        const audioEs = segmentData.subarray(audioStart);
        const adtsSamples = this.parseADTS(audioEs, 0);
        if (adtsSamples.length > 0) {
          audioSamples.push(...adtsSamples);
          return { videoSamples, audioSamples };
        }
      }
    } else if (
      segmentData.length >= 7 &&
      segmentData[0] === 0xff &&
      (segmentData[1] & 0xf6) === 0xf0 &&
      ((segmentData[2] & 0x3c) >> 2) < 13
    ) {
      const adtsSamples = this.parseADTS(segmentData, 0);
      if (adtsSamples.length > 0) {
        audioSamples.push(...adtsSamples);
        return { videoSamples, audioSamples };
      }
    }

    if (segmentData.length < TS_PACKET_SIZE) {
      throw new HLSDemuxError(
        `Segment data too small (${segmentData.length} bytes, minimum ${TS_PACKET_SIZE})`,
        'INVALID_SEGMENT'
      );
    }

    let offset = 0;
    // Find first sync byte
    while (offset < segmentData.length && segmentData[offset] !== SYNC_BYTE) {
      offset++;
    }

    if (offset + TS_PACKET_SIZE > segmentData.length) {
      throw new HLSDemuxError('No valid MPEG-TS sync byte (0x47) found in segment', 'INVALID_SEGMENT');
    }

    while (offset + TS_PACKET_SIZE <= segmentData.length) {
      if (segmentData[offset] !== SYNC_BYTE) {
        // Resync to next 0x47
        offset++;
        continue;
      }

      const p1 = segmentData[offset + 1];
      const p2 = segmentData[offset + 2];
      const p3 = segmentData[offset + 3];

      const tei = (p1 & 0x80) !== 0; // Transport Error Indicator
      if (tei) {
        offset += TS_PACKET_SIZE;
        continue;
      }

      const pusi = (p1 & 0x40) !== 0; // Payload Unit Start Indicator
      const pid = ((p1 & 0x1f) << 8) | p2;
      const afc = (p3 & 0x30) >> 4; // Adaptation field control

      let payloadOffset = offset + 4;
      if (afc === 0b10 || afc === 0b11) {
        // Adaptation field present
        const afLength = segmentData[offset + 4];
        payloadOffset += 1 + afLength;
      }

      const payloadEnd = offset + TS_PACKET_SIZE;
      if (payloadOffset > payloadEnd) {
        offset += TS_PACKET_SIZE;
        continue;
      }

      const hasPayload = afc === 0b01 || afc === 0b11;
      if (!hasPayload || payloadOffset >= payloadEnd) {
        offset += TS_PACKET_SIZE;
        continue;
      }

      const payload = segmentData.subarray(payloadOffset, payloadEnd);

      // Handle PAT (PID 0)
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

    // Flush any pending PES packets at end of segment
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

  private parsePAT(payload: Uint8Array, pusi: boolean): void {
    let offset = pusi ? 1 + payload[0] : 0; // pointer field
    if (offset + 8 > payload.length) return;

    const tableId = payload[offset];
    if (tableId !== 0x00) return;

    const sectionLength = ((payload[offset + 1] & 0x0f) << 8) | payload[offset + 2];
    const end = offset + 3 + sectionLength - 4; // exclude 4-byte CRC

    offset += 8; // skip table_id, section_length, ts_id, version/cni, section_num, last_section_num
    while (offset + 4 <= end && offset + 4 <= payload.length) {
      const programNum = (payload[offset] << 8) | payload[offset + 1];
      const programPid = ((payload[offset + 2] & 0x1f) << 8) | payload[offset + 3];
      if (programNum !== 0) {
        this.pmtPid = programPid;
        break;
      }
      offset += 4;
    }
  }

  private parsePMT(payload: Uint8Array, pusi: boolean): void {
    let offset = pusi ? 1 + payload[0] : 0;
    if (offset + 12 > payload.length) return;

    const tableId = payload[offset];
    if (tableId !== 0x02) return;

    const sectionLength = ((payload[offset + 1] & 0x0f) << 8) | payload[offset + 2];
    const progInfoLength = ((payload[offset + 10] & 0x0f) << 8) | payload[offset + 11];

    offset += 12 + progInfoLength;
    const end = offset + sectionLength - 9 - progInfoLength - 4; // exclude CRC

    while (offset + 5 <= end && offset + 5 <= payload.length) {
      const streamType = payload[offset];
      const elementaryPid = ((payload[offset + 1] & 0x1f) << 8) | payload[offset + 2];
      const esInfoLength = ((payload[offset + 3] & 0x0f) << 8) | payload[offset + 4];

      if (streamType === 0x1b && this.videoPid === null) {
        // H.264 / AVC Video
        this.videoPid = elementaryPid;
      } else if ((streamType === 0x0f || streamType === 0x11) && this.audioPid === null) {
        // AAC Audio
        this.audioPid = elementaryPid;
      }

      offset += 5 + esInfoLength;
    }
  }

  private flushVideoPes(): VideoSample[] | null {
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

  private parseVideoPES(data: Uint8Array): VideoSample[] | null {
    if (data.length < 9) return null;
    // Prefix 0x000001
    if (data[0] !== 0x00 || data[1] !== 0x00 || data[2] !== 0x01) return null;

    const ptsDtsFlags = (data[7] & 0xc0) >> 6;
    const headerDataLen = data[8];

    let ptsTicks = 0;
    let dtsTicks = 0;

    if (ptsDtsFlags === 0b10 && headerDataLen >= 5 && data.length >= 14) {
      ptsTicks =
        ((data[9] & 0x0e) << 29) |
        (data[10] << 22) |
        ((data[11] & 0xfe) << 14) |
        (data[12] << 7) |
        ((data[13] & 0xfe) >> 1);
      dtsTicks = ptsTicks;
    } else if (ptsDtsFlags === 0b11 && headerDataLen >= 10 && data.length >= 19) {
      ptsTicks =
        ((data[9] & 0x0e) << 29) |
        (data[10] << 22) |
        ((data[11] & 0xfe) << 14) |
        (data[12] << 7) |
        ((data[13] & 0xfe) >> 1);
      dtsTicks =
        ((data[14] & 0x0e) << 29) |
        (data[15] << 22) |
        ((data[16] & 0xfe) << 14) |
        (data[17] << 7) |
        ((data[18] & 0xfe) >> 1);
    }

    const payloadOffset = 9 + headerDataLen;
    if (payloadOffset >= data.length) return null;

    const esData = data.subarray(payloadOffset);

    // Extract NAL units from Annex B byte stream
    return this.parseAnnexBToSample(esData, ptsTicks, dtsTicks);
  }

  private parseAnnexBToSample(esData: Uint8Array, ptsTicks: number, dtsTicks: number): VideoSample[] | null {
    // Find NAL unit start codes: 0x000001 or 0x00000001
    const nalUnits: Uint8Array[] = [];
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
    const sampleNals: Uint8Array[] = [];

    for (const nal of nalUnits) {
      if (nal.length === 0) continue;
      const nalType = nal[0] & 0x1f;

      if (nalType === 7) {
        // SPS
        this.sps = nal;
        this.updateAvcMetadata();
      } else if (nalType === 8) {
        // PPS
        this.pps = nal;
        this.updateAvcMetadata();
      } else if (nalType === 5) {
        // IDR slice (Keyframe)
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
        // Non-IDR slice
        sampleNals.push(nal);
        sampleLength += 4 + nal.length;
      }
    }

    if (sampleNals.length === 0) return null;

    // Convert Annex B NALs to 4-byte length-prefixed AVC format
    const sampleData = new Uint8Array(sampleLength);
    let pos = 0;
    const view = new DataView(sampleData.buffer);

    for (const nal of sampleNals) {
      view.setUint32(pos, nal.length, false);
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

  private updateAvcMetadata(): void {
    if (!this.sps || this.sps.length < 4) return;
    const profileIdc = this.sps[1];
    const profileCompat = this.sps[2];
    const levelIdc = this.sps[3];

    const pps = this.pps || new Uint8Array([0x68, 0xce, 0x3c, 0x80]);
    const avcLen = 11 + this.sps.length + pps.length;
    const avc = new Uint8Array(avcLen);

    avc[0] = 0x01; // configurationVersion
    avc[1] = profileIdc; // AVCProfileIndication
    avc[2] = profileCompat; // profile_compatibility
    avc[3] = levelIdc; // AVCLevelIndication
    avc[4] = 0xff; // lengthSizeMinusOne (3 = 4 bytes)
    avc[5] = 0xe1; // numOfSequenceParameterSets (1)
    avc[6] = (this.sps.length >> 8) & 0xff;
    avc[7] = this.sps.length & 0xff;
    avc.set(this.sps, 8);

    const ppsOffset = 8 + this.sps.length;
    avc[ppsOffset] = 0x01; // numOfPictureParameterSets (1)
    avc[ppsOffset + 1] = (pps.length >> 8) & 0xff;
    avc[ppsOffset + 2] = pps.length & 0xff;
    avc.set(pps, ppsOffset + 3);

    const codec = `avc1.${profileIdc.toString(16).padStart(2, '0')}${profileCompat.toString(16).padStart(2, '0')}${levelIdc.toString(16).padStart(2, '0')}`;

    this.metadata.video = {
      codec,
      width: this.metadata.video?.width || 1280,
      height: this.metadata.video?.height || 720,
      sps: this.sps,
      pps: this.pps || undefined,
      avcDescription: avc
    };
  }

  private flushAudioPes(): AudioSample[] | null {
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

  private parseAudioPES(data: Uint8Array): AudioSample[] | null {
    if (data.length < 9) return null;
    if (data[0] !== 0x00 || data[1] !== 0x00 || data[2] !== 0x01) return null;

    const ptsDtsFlags = (data[7] & 0xc0) >> 6;
    const headerDataLen = data[8];

    let ptsTicks = 0;
    if (ptsDtsFlags >= 0b10 && headerDataLen >= 5 && data.length >= 14) {
      ptsTicks =
        ((data[9] & 0x0e) << 29) |
        (data[10] << 22) |
        ((data[11] & 0xfe) << 14) |
        (data[12] << 7) |
        ((data[13] & 0xfe) >> 1);
    }

    const payloadOffset = 9 + headerDataLen;
    if (payloadOffset >= data.length) return null;

    const esData = data.subarray(payloadOffset);
    return this.parseADTS(esData, ptsTicks);
  }

  private parseADTS(data: Uint8Array, basePtsTicks: number): AudioSample[] {
    const samples: AudioSample[] = [];
    let offset = 0;
    let currentPts = basePtsTicks;

    while (offset + 7 <= data.length) {
      // Syncword 0xFFF
      if (data[offset] !== 0xff || (data[offset + 1] & 0xf0) !== 0xf0) {
        offset++;
        continue;
      }

      const profile = ((data[offset + 2] & 0xc0) >> 6) + 1; // 1 = AAC LC
      const freqIdx = (data[offset + 2] & 0x3c) >> 2;
      const channelCount = ((data[offset + 2] & 0x01) << 2) | ((data[offset + 3] & 0xc0) >> 6);
      const frameLength =
        ((data[offset + 3] & 0x03) << 11) |
        (data[offset + 4] << 3) |
        ((data[offset + 5] & 0xe0) >> 5);
      const protectionAbsent = (data[offset + 1] & 0x01) !== 0;
      const headerLength = protectionAbsent ? 7 : 9;

      if (offset + frameLength > data.length || frameLength <= headerLength) {
        break;
      }

      const sampleRate = AAC_SAMPLE_RATES[freqIdx] || 44100;
      if (!this.metadata.audio) {
        // AudioSpecificConfig (2 bytes: profile 5 bits, freqIdx 4 bits, channelCount 4 bits)
        const audioDesc = new Uint8Array(2);
        audioDesc[0] = (profile << 3) | (freqIdx >> 1);
        audioDesc[1] = ((freqIdx & 1) << 7) | (channelCount << 3);

        this.metadata.audio = {
          codec: 'mp4a.40.2',
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

      // 1024 samples per AAC frame at 90kHz ticks: 1024 * 90000 / sampleRate
      const durationTicks = Math.round((1024 * 90000) / sampleRate);
      currentPts += durationTicks;
      offset += frameLength;
    }

    return samples;
  }
}
