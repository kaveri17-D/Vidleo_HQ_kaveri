import assert from 'node:assert/strict';
import { assembleMediaResponseBodies } from '../src/utils/media-response-accumulator.ts';
import { hasFatalDecodeDiagnostics } from '../src/utils/decode-diagnostics.ts';
import { parseUmpMediaStreams } from '../src/utils/ump-parser.ts';

const ranged = (sequence, start, values, total = 6) => ({
  sequence,
  requestId: String(sequence),
  bytes: new Uint8Array(values),
  streamKey: 'video',
  rangeStart: start,
  rangeEnd: start + values.length - 1,
  rangeTotal: total,
});

const ordered = assembleMediaResponseBodies([
  ranged(2, 3, [4, 5, 6]),
  ranged(1, 0, [1, 2, 3]),
]);
assert.deepEqual([...ordered.bytes], [1, 2, 3, 4, 5, 6]);

const duplicate = assembleMediaResponseBodies([
  ranged(1, 0, [1, 2, 3]),
  ranged(2, 0, [1, 2, 3]),
  ranged(3, 3, [4, 5, 6]),
]);
assert.equal(duplicate.duplicateCount, 1);

assert.throws(
  () => assembleMediaResponseBodies([ranged(1, 0, [1, 2, 3]), ranged(2, 4, [5, 6])]),
  /MEDIA_RANGE_GAP/,
);

assert.equal(hasFatalDecodeDiagnostics('frame=10 fps=30 time=00:00:01'), false);
assert.equal(hasFatalDecodeDiagnostics('Invalid NAL unit size (3707 > 1041)'), true);
assert.equal(hasFatalDecodeDiagnostics('Error splitting the input into NAL units'), true);
assert.equal(hasFatalDecodeDiagnostics(['warning: non-monotonous DTS', 'Decoding error']), true);

const minimalUmp = new Uint8Array([21, 9, 1, 0, 0, 0, 8, 102, 116, 121, 112]);
assert.equal(parseUmpMediaStreams(minimalUmp).videoBytes, 8);
assert.throws(() => parseUmpMediaStreams(minimalUmp.subarray(0, 9)), /UMP_TRUNCATED_PART/);

console.log('media-response-accumulator tests: PASS');
