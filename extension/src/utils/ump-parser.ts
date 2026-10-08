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

  while (offset < rawUmp.length) {
    const [partType, afterType] = readVarInt(rawUmp, offset);
    if (partType < 0) break;
    offset = afterType;

    const [partSize, afterSize] = readVarInt(rawUmp, offset);
    if (partSize < 0) break;
    offset = afterSize;

    if (offset + partSize > rawUmp.length) break;

    if (partType === 21 && partSize > 1) { // MEDIA part
      const streamId = rawUmp[offset];
      const payload = rawUmp.subarray(offset + 1, offset + partSize);
      if (!streamTracks.has(streamId)) streamTracks.set(streamId, []);
      streamTracks.get(streamId)!.push(payload);
    }
    offset += partSize;
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

  const audioInitChunks: Uint8Array[] = [];
  const audioClusters: Uint8Array[] = [];
  const videoInitChunks: Uint8Array[] = [];
  const videoFrags: Uint8Array[] = [];

  const sortedTrackIds = Array.from(streamTracks.keys()).sort((a, b) => a - b);
  for (const id of sortedTrackIds) {
    const chunks = streamTracks.get(id) || [];
    for (const chunk of chunks) {
      if (isWebm(chunk)) {
        if (chunk[0] === 0x1A && chunk[1] === 0x45 && chunk[2] === 0xDF && chunk[3] === 0xA3) {
          audioInitChunks.push(chunk);
        } else {
          audioClusters.push(chunk);
        }
      } else if (isMp4(chunk)) {
        const tag = String.fromCharCode(chunk[4], chunk[5], chunk[6], chunk[7]);
        if (tag === 'ftyp' || tag === 'moov') {
          videoInitChunks.push(chunk);
        } else {
          videoFrags.push(chunk);
        }
      }
    }
  }

  const audioChunks = [...audioInitChunks, ...audioClusters];
  const videoChunks = [...videoInitChunks, ...videoFrags];

  const audioWebm = audioChunks.length > 0 ? concatByteArrays(audioChunks) : null;
  const videoMp4 = videoChunks.length > 0 ? concatByteArrays(videoChunks) : null;

  let videoCodec = 'h264';
  if (videoMp4) {
    const headerStr = String.fromCharCode(...videoMp4.subarray(0, Math.min(256, videoMp4.length)));
    if (headerStr.includes('av01')) videoCodec = 'av1';
    else if (headerStr.includes('vp09') || headerStr.includes('vp9')) videoCodec = 'vp9';
  }

  let audioCodec = 'opus';
  if (audioWebm && audioInitChunks.length > 0) {
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
