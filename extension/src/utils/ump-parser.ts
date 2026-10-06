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

  // Audio: chunks from stream 0 (WebM header), stream 2 (cluster 1), stream 5 (cluster 2)
  const audioChunks: Uint8Array[] = [];
  for (const id of [0, 2, 5]) {
    const chunks = streamTracks.get(id);
    if (chunks) {
      for (const c of chunks) audioChunks.push(c);
    }
  }

  // Video: stream 1 (init segment: strip non-contiguous sidx to 700 bytes), stream 3 (frag 1), stream 4 (frag 2), stream 6 (frag 3)
  const videoChunks: Uint8Array[] = [];
  const initChunks = streamTracks.get(1);
  if (initChunks && initChunks.length > 0) {
    videoChunks.push(initChunks[0].subarray(0, Math.min(700, initChunks[0].length)));
  }
  for (const id of [3, 4, 6]) {
    const chunks = streamTracks.get(id);
    if (chunks) {
      for (const c of chunks) videoChunks.push(c);
    }
  }

  const audioWebm = audioChunks.length > 0 ? concatByteArrays(audioChunks) : null;
  const videoMp4 = videoChunks.length > 0 ? concatByteArrays(videoChunks) : null;

  return {
    audioWebm,
    videoMp4,
    rawUmpBytes: rawUmp.length,
    audioBytes: audioWebm ? audioWebm.length : 0,
    videoBytes: videoMp4 ? videoMp4.length : 0,
    streamPartsCount: streamTracks.size,
  };
}
