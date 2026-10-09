import assert from 'node:assert/strict';
import { assembleMediaResponseBodies } from '../src/utils/media-response-accumulator.ts';

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

console.log('media-response-accumulator tests: PASS');
