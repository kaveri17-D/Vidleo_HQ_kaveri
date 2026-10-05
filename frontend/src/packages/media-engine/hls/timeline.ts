/**
 * NEXUS Browser HLS — Timestamp Normalization & Discontinuity Engine
 * 
 * Converts 90kHz MPEG-TS PTS/DTS to monotonic microsecond timeline.
 * Handles 33-bit rollover (2^33), discontinuities (#EXT-X-DISCONTINUITY),
 * and maintains continuous audio/video synchronization across segment boundaries.
 */

const MPEG_CLOCK_HZ = 90000;
const ROLLOVER_THRESHOLD_TICKS = 4294967296; // 2^32
const MAX_33BIT_TICKS = 8589934592; // 2^33

export interface NormalizedSampleTiming {
  ptsUs: number;
  dtsUs: number;
  durationUs: number;
  compositionTimeOffsetUs: number;
}

export class HLSTimelineManager {
  private initialDtsTicks: number | null = null;
  private lastPtsTicks: number = 0;
  private rolloverOffsetTicks: number = 0;

  // Discontinuity rebasing
  private timelineBaseUs: number = 0;
  private lastOutputDtsUs: number = -1;
  private lastOutputPtsUs: number = -1;
  private lastDurationUs: number = 0;

  private isFirstSample: boolean = true;

  /**
   * Called when an #EXT-X-DISCONTINUITY boundary is encountered in the playlist.
   * Rebases the timeline so that subsequent samples continue smoothly without
   * overlapping previous samples or jumping unpredictably.
   */
  public signalDiscontinuity(expectedPreviousDurationUs?: number): void {
    const fallbackStepUs = this.lastDurationUs || 33333; // ~30fps default
    const nextBaseUs = Math.max(
      this.lastOutputDtsUs + (expectedPreviousDurationUs || fallbackStepUs),
      this.lastOutputPtsUs + fallbackStepUs,
      0
    );

    this.timelineBaseUs = nextBaseUs;
    this.initialDtsTicks = null;
    this.lastPtsTicks = 0;
    this.rolloverOffsetTicks = 0;
  }

  /**
   * Normalizes a raw 90kHz MPEG PTS/DTS pair into continuous microseconds.
   * Handles 33-bit rollover and offsets.
   */
  public normalizeTicks(rawPtsTicks: number, rawDtsTicks?: number): { ptsTicks: number; dtsTicks: number } {
    let pts = rawPtsTicks;
    let dts = rawDtsTicks !== undefined ? rawDtsTicks : rawPtsTicks;

    // Detect 33-bit rollover: sudden drop > 2^32 ticks (~13 hours)
    if (this.lastPtsTicks > 0 && this.lastPtsTicks - pts > ROLLOVER_THRESHOLD_TICKS) {
      this.rolloverOffsetTicks += MAX_33BIT_TICKS;
    }

    pts += this.rolloverOffsetTicks;
    dts += this.rolloverOffsetTicks;
    this.lastPtsTicks = rawPtsTicks;

    return { ptsTicks: pts, dtsTicks: dts };
  }

  /**
   * Normalizes sample timing, ensuring monotonic DTS and valid CTS offsets.
   */
  public processSampleTiming(
    rawPtsTicks: number,
    rawDtsTicks?: number,
    durationTicks?: number,
    fallbackDurationUs: number = 33333
  ): NormalizedSampleTiming {
    const { ptsTicks, dtsTicks } = this.normalizeTicks(rawPtsTicks, rawDtsTicks);

    const durationUs = durationTicks ? Math.round((durationTicks / MPEG_CLOCK_HZ) * 1e6) : fallbackDurationUs;

    if (this.initialDtsTicks === null) {
      this.initialDtsTicks = dtsTicks;
    }

    const relPtsTicks = ptsTicks - this.initialDtsTicks;
    const relDtsTicks = dtsTicks - this.initialDtsTicks;

    let ptsUs = this.timelineBaseUs + Math.round((relPtsTicks / MPEG_CLOCK_HZ) * 1e6);
    let dtsUs = this.timelineBaseUs + Math.round((relDtsTicks / MPEG_CLOCK_HZ) * 1e6);

    if (this.isFirstSample) {
      // First sample must start at >= 0
      if (dtsUs < 0) {
        const offset = -dtsUs;
        ptsUs += offset;
        dtsUs = 0;
      }
      this.isFirstSample = false;
    } else {
      // Ensure strictly monotonic DTS (DTS must strictly increase)
      if (dtsUs <= this.lastOutputDtsUs) {
        const stepUs = Math.max(1000, durationUs > 0 ? durationUs : 16666);
        dtsUs = this.lastOutputDtsUs + stepUs;
      }
    }

    // PTS cannot precede DTS in video decoding
    if (ptsUs < dtsUs) {
      ptsUs = dtsUs;
    }

    const compositionTimeOffsetUs = ptsUs - dtsUs;

    this.lastOutputDtsUs = dtsUs;
    this.lastOutputPtsUs = ptsUs;
    this.lastDurationUs = durationUs;

    return {
      ptsUs,
      dtsUs,
      durationUs,
      compositionTimeOffsetUs
    };
  }

  public reset(): void {
    this.initialDtsTicks = null;
    this.lastPtsTicks = 0;
    this.rolloverOffsetTicks = 0;
    this.timelineBaseUs = 0;
    this.lastOutputDtsUs = -1;
    this.lastOutputPtsUs = -1;
    this.lastDurationUs = 0;
    this.isFirstSample = true;
  }
}
