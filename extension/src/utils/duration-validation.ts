/**
 * Duration Validation & Metric Distinction Utilities
 * 
 * Distinctly separates:
 * - Expected Source Duration (from video metadata / player source)
 * - Observed Player Duration (from active player element / API at end of playback)
 * - Current Time (current playhead position, NOT duration)
 * - Media Coverage (accumulated byte ranges coverage)
 * - Reconstructed Track Duration (duration from demuxed elementary streams)
 * - Final Output Duration (verified duration of the output MP4 container)
 */

export function durationToleranceSeconds(expectedDuration: number): number {
  if (!(expectedDuration > 0)) return 2;
  return Math.max(2, expectedDuration * 0.05);
}

export function durationMatchesExpected(
  expectedDuration: number,
  observedDuration: number,
): boolean {
  if (!(expectedDuration > 0)) return true;
  if (!(observedDuration > 0)) return false;
  const tolerance = durationToleranceSeconds(expectedDuration);
  return Math.abs(observedDuration - expectedDuration) <= tolerance;
}

export interface AcquisitionDurationMetrics {
  mode: 'FULL' | 'DEMO';
  expectedDuration: number;
  observedPlayerDuration: number;
  playerCurrentTime?: number;
  reconstructedVideoDuration?: number;
  reconstructedAudioDuration?: number;
  outputDuration?: number;
}

export interface DurationValidationResult {
  valid: boolean;
  code?: string;
  message?: string;
  expectedDuration: number;
  observedDuration: number;
  tolerance: number;
  delta: number;
}

export function validateDurationMetrics(
  metrics: AcquisitionDurationMetrics,
): DurationValidationResult {
  const { mode, expectedDuration, observedPlayerDuration } = metrics;
  const tolerance = durationToleranceSeconds(expectedDuration);

  // DEMO mode is intentionally capped and does not require full duration match
  if (mode === 'DEMO') {
    return {
      valid: observedPlayerDuration > 0,
      expectedDuration,
      observedDuration: observedPlayerDuration,
      tolerance,
      delta: Math.abs(observedPlayerDuration - expectedDuration),
    };
  }

  // FULL mode strictly requires the observed player duration to match the expected source duration
  if (expectedDuration > 0) {
    if (!(observedPlayerDuration > 0)) {
      return {
        valid: false,
        code: 'PLAYER_DURATION_ZERO',
        message: `Observed player duration is zero or invalid: observed=${observedPlayerDuration}s`,
        expectedDuration,
        observedDuration: observedPlayerDuration,
        tolerance,
        delta: expectedDuration,
      };
    }

    const delta = Math.abs(observedPlayerDuration - expectedDuration);
    if (delta > tolerance) {
      return {
        valid: false,
        code: 'PLAYER_DURATION_MISMATCH',
        message: `Player duration mismatch: expected=${expectedDuration}s observed=${observedPlayerDuration}s tolerance=${tolerance}s delta=${delta.toFixed(3)}s`,
        expectedDuration,
        observedDuration: observedPlayerDuration,
        tolerance,
        delta,
      };
    }
  }

  return {
    valid: true,
    expectedDuration,
    observedDuration: observedPlayerDuration,
    tolerance,
    delta: Math.abs(observedPlayerDuration - expectedDuration),
  };
}
