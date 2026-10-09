export interface MediaResponseBody {
  sequence: number;
  requestId: string;
  bytes: Uint8Array;
  streamKey: string;
  rangeStart?: number;
  rangeEnd?: number;
  rangeTotal?: number;
}

export interface MediaResponseAssembly {
  bytes: Uint8Array;
  responseCount: number;
  duplicateCount: number;
  rangeCount: number;
  rangeGroups: Array<{
    streamKey: string;
    ranges: Array<{ start: number; end: number; total?: number }>;
  }>;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function bodyFingerprint(bytes: Uint8Array): string {
  const sample = Math.min(64, bytes.byteLength);
  let head = '';
  let tail = '';
  for (let i = 0; i < sample; i++) head += bytes[i].toString(16).padStart(2, '0');
  for (let i = Math.max(0, bytes.byteLength - sample); i < bytes.byteLength; i++) {
    tail += bytes[i].toString(16).padStart(2, '0');
  }
  return `${bytes.byteLength}:${head}:${tail}`;
}

/**
 * Reconstructs CDP media response bodies without silently duplicating or
 * skipping byte ranges. UMP responses normally have no Content-Range and are
 * retained in response order; range-bearing responses are reconstructed per
 * stream before the resulting byte streams are combined for UMP demuxing.
 */
export function assembleMediaResponseBodies(
  input: MediaResponseBody[],
): MediaResponseAssembly {
  const bodies = input
    .filter((body) => body.bytes.byteLength > 0)
    .slice()
    .sort((a, b) => a.sequence - b.sequence);

  const ranged = new Map<string, MediaResponseBody[]>();
  const unranged: MediaResponseBody[] = [];
  for (const body of bodies) {
    if (Number.isFinite(body.rangeStart) && Number.isFinite(body.rangeEnd)) {
      const group = ranged.get(body.streamKey) || [];
      group.push(body);
      ranged.set(body.streamKey, group);
    } else {
      unranged.push(body);
    }
  }

  let duplicateCount = 0;
  const reconstructed: Array<{ firstSequence: number; bytes: Uint8Array; streamKey: string; ranges: Array<{ start: number; end: number; total?: number }> }> = [];

  for (const [streamKey, group] of ranged) {
    const byStart = group.slice().sort((a, b) => (a.rangeStart! - b.rangeStart!) || (a.rangeEnd! - b.rangeEnd!));
    const unique: MediaResponseBody[] = [];
    for (const body of byStart) {
      const previous = unique[unique.length - 1];
      if (previous && body.rangeStart === previous.rangeStart && body.rangeEnd === previous.rangeEnd) {
        if (!sameBytes(previous.bytes, body.bytes)) {
          throw new Error(`MEDIA_RANGE_CONFLICT stream=${streamKey} range=${body.rangeStart}-${body.rangeEnd}`);
        }
        duplicateCount++;
        continue;
      }
      unique.push(body);
    }

    for (let i = 0; i < unique.length; i++) {
      const body = unique[i];
      const declaredLength = body.rangeEnd! - body.rangeStart! + 1;
      if (declaredLength !== body.bytes.byteLength) {
        throw new Error(`MEDIA_RANGE_LENGTH_MISMATCH stream=${streamKey} range=${body.rangeStart}-${body.rangeEnd} body=${body.bytes.byteLength}`);
      }
      const next = unique[i + 1];
      if (next && next.rangeStart! <= body.rangeEnd!) {
        throw new Error(`MEDIA_RANGE_OVERLAP stream=${streamKey} ranges=${body.rangeStart}-${body.rangeEnd},${next.rangeStart}-${next.rangeEnd}`);
      }
      if (next && next.rangeStart! > body.rangeEnd! + 1) {
        throw new Error(`MEDIA_RANGE_GAP stream=${streamKey} after=${body.rangeEnd} before=${next.rangeStart}`);
      }
    }

    const total = unique.find((body) => Number.isFinite(body.rangeTotal))?.rangeTotal;
    if (total !== undefined && unique.length > 0) {
      if (unique[0].rangeStart !== 0 || unique[unique.length - 1].rangeEnd !== total - 1) {
        throw new Error(`MEDIA_RANGE_INCOMPLETE stream=${streamKey} expected=0-${total - 1}`);
      }
    }

    reconstructed.push({
      firstSequence: unique[0]?.sequence ?? Number.MAX_SAFE_INTEGER,
      streamKey,
      bytes: concatBytes(unique.map((body) => body.bytes)),
      ranges: unique.map((body) => ({ start: body.rangeStart!, end: body.rangeEnd!, total: body.rangeTotal })),
    });
  }

  const seenUnranged = new Map<string, MediaResponseBody>();
  const uniqueUnranged: MediaResponseBody[] = [];
  for (const body of unranged) {
    const key = `${body.streamKey}:${bodyFingerprint(body.bytes)}`;
    const previous = seenUnranged.get(key);
    if (previous && sameBytes(previous.bytes, body.bytes)) {
      duplicateCount++;
      continue;
    }
    seenUnranged.set(key, body);
    uniqueUnranged.push(body);
  }

  const parts = [
    ...reconstructed.map((item) => ({ sequence: item.firstSequence, bytes: item.bytes })),
    ...uniqueUnranged.map((body) => ({ sequence: body.sequence, bytes: body.bytes })),
  ].sort((a, b) => a.sequence - b.sequence);

  return {
    bytes: concatBytes(parts.map((part) => part.bytes)),
    responseCount: bodies.length,
    duplicateCount,
    rangeCount: ranged.size,
    rangeGroups: reconstructed.map(({ streamKey, ranges }) => ({ streamKey, ranges })),
  };
}
