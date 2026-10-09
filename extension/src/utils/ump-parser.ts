/**
 * Zero-dependency UMP (YouTube Media Protocol / application/vnd.yt-ump) demuxer
 * Splits multiplexed UMP parts into pure Audio and Video media streams.
 */

function readVarInt(buf: Uint8Array, offset: number): [number, number] {
  if (offset >= buf.length) return [-1, offset];
  const firstByte = buf[offset];
  const byteLength = firstByte < 128 ? 1 : firstByte < 192 ? 2 : firstByte < 224 ? 3 : firstByte < 240 ? 4 : 5;
  if (offset + byteLength > buf.length) return [-1, offset];
  let value = 0;
  switch (byteLength) {
    case 1:
      value = buf[offset++];
      break;
    case 2:
      value = (buf[offset] & 0x3f) + 64 * buf[offset + 1];
      offset += 2;
      break;
    case 3:
      value = (buf[offset] & 0x1f) + 32 * (buf[offset + 1] + 256 * buf[offset + 2]);
      offset += 3;
      break;
    case 4:
      value = (buf[offset] & 0x0f) + 16 * (buf[offset + 1] + 256 * (buf[offset + 2] + 256 * buf[offset + 3]));
      offset += 4;
      break;
    default:
      value = buf[offset + 1] + 256 * (buf[offset + 2] + 256 * (buf[offset + 3] + 256 * buf[offset + 4]));
      offset += 5;
      break;
  }
  return [value, offset];
}

function concatByteArrays(arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const a of arrays) totalLen += a.length;
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const a of arrays) {
    result.set(a, pos);
    pos += a.length;
  }
  return result;
}

export interface UmpDemuxResult {
  audioWebm: Uint8Array | null;
  videoMp4: Uint8Array | null;
  rawUmpBytes: number;
  audioBytes: number;
  videoBytes: number;
  streamPartsCount: number;
  videoCodec?: string;
  audioCodec?: string;
}

export function parseUmpMediaStreams(rawUmp: Uint8Array): UmpDemuxResult {
  let offset = 0;
  const streamTracks = new Map<number, Uint8Array[]>();
  let mediaPartCount = 0;

  while (offset < rawUmp.length) {
    const [partType, afterType] = readVarInt(rawUmp, offset);
    if (partType < 0) throw new Error(`UMP_TRUNCATED_PART_TYPE offset=${offset}`);
    offset = afterType;

    const [partSize, afterSize] = readVarInt(rawUmp, offset);
    if (partSize < 0) throw new Error(`UMP_TRUNCATED_PART_SIZE offset=${offset}`);
    offset = afterSize;

    if (offset + partSize > rawUmp.length) {
      throw new Error(`UMP_TRUNCATED_PART payloadOffset=${offset} declared=${partSize} available=${rawUmp.length - offset}`);
    }

    if (partType === 21 && partSize > 1) { // MEDIA part
      mediaPartCount++;
      const streamId = rawUmp[offset];
      const payload = rawUmp.subarray(offset + 1, offset + partSize);
      if (!streamTracks.has(streamId)) streamTracks.set(streamId, []);
      streamTracks.get(streamId)!.push(payload);
    }
    offset += partSize;
  }

  if (offset !== rawUmp.length) {
    throw new Error(`UMP_TRAILING_BYTES offset=${offset} total=${rawUmp.length}`);
  }
  if (mediaPartCount === 0) {
    throw new Error('UMP_MEDIA_PARTS_MISSING');
  }

  function isWebm(buf: Uint8Array): boolean {
    if (buf.length < 4) return false;
    return (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) ||
           (buf[0] === 0x1F && buf[1] === 0x43 && buf[2] === 0xB6 && buf[3] === 0x75);
  }

  function isMp4(buf: Uint8Array): boolean {
    if (buf.length < 8) return false;
    const tag = String.fromCharCode(buf[4], buf[5], buf[6], buf[7]);
    return tag === 'ftyp' || tag === 'moov' || tag === 'moof' || tag === 'sidx' || tag === 'styp' || tag === 'emsg';
  }

  function boxType(box: Uint8Array): string {
    return String.fromCharCode(box[4], box[5], box[6], box[7]);
  }

  /**
   * UMP MEDIA payload boundaries are transport boundaries, not MP4 box
   * boundaries. A moof/mdat may be split across several payloads. The old
   * parser classified each payload independently and silently discarded a
   * continuation whose first bytes were not an MP4 header, producing malformed
   * H.264 samples. Join each track first, then validate and de-duplicate only
   * complete initialization boxes.
   */
  function parseMp4Track(chunks: Uint8Array[], streamId: number): Uint8Array {
    const joined = concatByteArrays(chunks);
    const boxes: Uint8Array[] = [];
    let cursor = 0;
    while (cursor < joined.length) {
      if (joined.length - cursor < 8) {
        throw new Error(`UMP_MP4_BOX_HEADER_TRUNCATED stream=${streamId} offset=${cursor}`);
      }
      const size32 = new DataView(joined.buffer, joined.byteOffset + cursor, 4).getUint32(0, false);
      let headerSize = 8;
      let boxSize = size32;
      if (size32 === 1) {
        if (joined.length - cursor < 16) {
          throw new Error(`UMP_MP4_LARGE_BOX_HEADER_TRUNCATED stream=${streamId} offset=${cursor}`);
        }
        const high = new DataView(joined.buffer, joined.byteOffset + cursor + 8, 4).getUint32(0, false);
        const low = new DataView(joined.buffer, joined.byteOffset + cursor + 12, 4).getUint32(0, false);
        boxSize = high * 0x100000000 + low;
        headerSize = 16;
      } else if (size32 === 0) {
        boxSize = joined.length - cursor;
      }
      if (!Number.isSafeInteger(boxSize) || boxSize < headerSize || cursor + boxSize > joined.length) {
        throw new Error(`UMP_MP4_BOX_TRUNCATED stream=${streamId} offset=${cursor} declared=${boxSize} available=${joined.length - cursor}`);
      }
      boxes.push(joined.slice(cursor, cursor + boxSize));
      cursor += boxSize;
    }

    const seenInit = new Set<string>();
    const output: Uint8Array[] = [];
    for (const box of boxes) {
      const type = boxType(box);
      if (type === 'ftyp' || type === 'moov') {
        const key = `${type}:${box.byteLength}:${Array.from(box.subarray(0, Math.min(32, box.length))).join(',')}`;
        if (seenInit.has(key)) continue;
        seenInit.add(key);
      }
      output.push(box);
    }
    if (!output.some((box) => boxType(box) === 'moov' || boxType(box) === 'moof')) {
      throw new Error(`UMP_MP4_MEDIA_BOXES_MISSING stream=${streamId}`);
    }
    return concatByteArrays(output);
  }

  const sortedTrackIds = Array.from(streamTracks.keys()).sort((a, b) => a - b);
  const audioTracks: Uint8Array[] = [];
  const videoTracks: Uint8Array[] = [];
  for (const id of sortedTrackIds) {
    const chunks = streamTracks.get(id) || [];
    const joined = concatByteArrays(chunks);
    if (isWebm(joined)) {
      audioTracks.push(joined);
    } else if (isMp4(joined)) {
      videoTracks.push(parseMp4Track(chunks, id));
    }
  }

  const audioWebm = audioTracks.length > 0 ? concatByteArrays(audioTracks) : null;
  const videoMp4 = videoTracks.length > 0 ? concatByteArrays(videoTracks) : null;

  let videoCodec = 'h264';
  if (videoMp4) {
    const headerStr = String.fromCharCode(...videoMp4.subarray(0, Math.min(256, videoMp4.length)));
    if (headerStr.includes('av01')) videoCodec = 'av1';
    else if (headerStr.includes('vp09') || headerStr.includes('vp9')) videoCodec = 'vp9';
  }

  let audioCodec = 'opus';
  if (audioWebm) {
    audioCodec = 'opus';
  }

  return {
    audioWebm,
    videoMp4,
    rawUmpBytes: rawUmp.length,
    audioBytes: audioWebm ? audioWebm.length : 0,
    videoBytes: videoMp4 ? videoMp4.length : 0,
    streamPartsCount: streamTracks.size,
    videoCodec,
    audioCodec,
  };
}
