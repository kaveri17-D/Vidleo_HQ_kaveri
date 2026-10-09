import assert from 'node:assert/strict';
import {
  durationToleranceSeconds,
  durationMatchesExpected,
  validateDurationMetrics,
} from '../src/utils/duration-validation.ts';
import { groupVideoQualityOptions } from '../../frontend/src/services/downloader/qualityGrouping.ts';

// -----------------------------------------------------------------------------
// Test 1: 197-second source versus 20-second partial acquisition
// -----------------------------------------------------------------------------
{
  const expected = 197;
  const observed = 20.021;
  assert.equal(durationMatchesExpected(expected, observed), false, '197s vs 20.021s must fail');
  const res = validateDurationMetrics({
    mode: 'FULL',
    expectedDuration: expected,
    observedPlayerDuration: observed,
  });
  assert.equal(res.valid, false);
  assert.equal(res.code, 'PLAYER_DURATION_MISMATCH');
  assert.match(res.message, /Player duration mismatch: expected=197s observed=20.021s/);
}

// -----------------------------------------------------------------------------
// Test 2: FULL mode not inheriting DEMO limits
// -----------------------------------------------------------------------------
{
  const expected = 197;
  // In DEMO mode, an arbitrary partial duration is accepted as valid demo preview
  const demoRes = validateDurationMetrics({
    mode: 'DEMO',
    expectedDuration: expected,
    observedPlayerDuration: 20.021,
  });
  assert.equal(demoRes.valid, true, 'DEMO mode allows partial snippet');

  // In FULL mode, the partial duration MUST be rejected
  const fullRes = validateDurationMetrics({
    mode: 'FULL',
    expectedDuration: expected,
    observedPlayerDuration: 20.021,
  });
  assert.equal(fullRes.valid, false, 'FULL mode rejects partial snippet');
}

// -----------------------------------------------------------------------------
// Test 3: Player duration not being confused with currentTime
// -----------------------------------------------------------------------------
{
  const expected = 197;
  const currentTime = 196.8;
  const observedDuration = 197.0;
  const res = validateDurationMetrics({
    mode: 'FULL',
    expectedDuration: expected,
    observedPlayerDuration: observedDuration,
    playerCurrentTime: currentTime,
  });
  assert.equal(res.valid, true);
  assert.equal(res.observedDuration, 197.0);
}

// -----------------------------------------------------------------------------
// Test 4: Duration within allowable tolerance passes
// -----------------------------------------------------------------------------
{
  const expected = 197;
  // 5% of 197 is 9.85s. 195s is within tolerance.
  assert.equal(durationMatchesExpected(expected, 195.5), true);
  assert.equal(durationMatchesExpected(expected, 204.0), true);
  // 170s is outside tolerance
  assert.equal(durationMatchesExpected(expected, 170.0), false);
}

// -----------------------------------------------------------------------------
// Test 5: Quality grouping by effective resolution (one choice per height)
// -----------------------------------------------------------------------------
{
  const rawQualities = [
    { id: '137', label: '1080p', resolution: '1920x1080', vcodec: 'avc1.640028', container: 'mp4', availability: 'ACTUAL_MEDIA_AVAILABLE', bitrate: '4000000' },
    { id: '248', label: '1080p', resolution: '1920x1080', vcodec: 'vp9', container: 'webm', availability: 'ACTUAL_MEDIA_AVAILABLE', bitrate: '3500000' },
    { id: '136', label: '720p', resolution: '1280x720', vcodec: 'avc1.4d401f', container: 'mp4', availability: 'ACTUAL_MEDIA_AVAILABLE', bitrate: '2000000' },
    { id: '247', label: '720p', resolution: '1280x720', vcodec: 'vp9', container: 'webm', availability: 'ACTUAL_MEDIA_AVAILABLE', bitrate: '1800000' },
    { id: '135', label: '480p', resolution: '854x480', vcodec: 'avc1.4d401e', container: 'mp4', availability: 'METADATA_ONLY', bitrate: '1000000' },
    { id: '134', label: '360p', resolution: '640x360', vcodec: 'avc1.4d401e', container: 'mp4', availability: 'ACTUAL_MEDIA_AVAILABLE', bitrate: '600000' },
  ];

  const grouped = groupVideoQualityOptions(rawQualities);

  // Must have exactly 4 choices: 1080p, 720p, 480p, 360p
  assert.equal(grouped.length, 4);
  assert.equal(grouped[0].label, '1080p (Full HD)');
  assert.equal(grouped[1].label, '720p (HD)');
  assert.equal(grouped[2].label, '480p (SD)');
  assert.equal(grouped[3].label, '360p');

  // Verify preferred variant selected H.264 / MP4 over WebM/VP9
  assert.equal(grouped[0].id, '137');
  assert.equal(grouped[0].vcodec, 'avc1.640028');
  assert.equal(grouped[1].id, '136');
  assert.equal(grouped[1].vcodec, 'avc1.4d401f');

  // Verify all source variants are preserved for diagnostics
  assert.equal(grouped[0].sourceVariants.length, 2);
  assert.equal(grouped[1].sourceVariants.length, 2);
}

console.log('duration-and-quality tests: PASS');
