/**
 * NEXUS Browser HLS — Deterministic Variant Selector
 * 
 * Selects the optimal HLS variant based on supported codecs (H.264 + AAC),
 * resolution, bandwidth, and client processing budget.
 */

import { HLSVariant } from '../types';

export class HLSVariantError extends Error {
  public code: string;
  constructor(message: string, code: string = 'UNSUPPORTED_CODEC') {
    super(message);
    this.name = 'HLSVariantError';
    this.code = code;
  }
}

/**
 * Checks whether the given CODECS string is supported by the in-browser HLS engine.
 * Supported: H.264/AVC (avc1.*) and AAC (mp4a.40.*).
 * Rejected: HEVC (hvc1, hev1), VP9 (vp09), AV1 (av01), AC-3, E-AC-3.
 */
export function isCodecSupported(codecStr?: string): boolean {
  if (!codecStr) {
    // If codec string omitted in playlist, allow as candidate (will be validated in demuxer)
    return true;
  }

  const codecs = codecStr.toLowerCase().split(',').map((c) => c.trim());
  let hasSupportedVideo = false;
  let hasSupportedAudio = false;

  for (const c of codecs) {
    // Unsupported video/audio immediately invalidates this variant
    if (c.startsWith('hvc1') || c.startsWith('hev1') || c.startsWith('vp09') || c.startsWith('av01') || c.startsWith('ac-3') || c.startsWith('ec-3')) {
      return false;
    }

    if (c.startsWith('avc1') || c.includes('h264')) {
      hasSupportedVideo = true;
    }
    if (c.startsWith('mp4a') || c.includes('aac')) {
      hasSupportedAudio = true;
    }
  }

  // Variant is acceptable if it contains at least one supported stream and no unsupported streams
  return hasSupportedVideo || hasSupportedAudio;
}

export interface VariantSelectionOptions {
  preferredHeight?: number;
  maxHeight?: number;
  maxBandwidth?: number;
}

/**
 * Deterministically selects the optimal variant from a Master Playlist.
 */
export function selectHLSVariant(
  variants: HLSVariant[],
  options: VariantSelectionOptions = {}
): HLSVariant {
  if (!variants || variants.length === 0) {
    throw new HLSVariantError('No stream variants available in master playlist', 'INVALID_PLAYLIST');
  }

  // 1. Filter variants with supported codecs
  const compatibleVariants = variants.filter((v) => isCodecSupported(v.codecs));
  if (compatibleVariants.length === 0) {
    throw new HLSVariantError(
      `No compatible H.264/AAC variants found among ${variants.length} stream variants`,
      'UNSUPPORTED_CODEC'
    );
  }

  // 2. Filter by max constraints if specified
  let candidateVariants = compatibleVariants;
  if (options.maxHeight) {
    const heightFiltered = candidateVariants.filter((v) => !v.resolution || v.resolution.height <= options.maxHeight!);
    if (heightFiltered.length > 0) {
      candidateVariants = heightFiltered;
    }
  }

  if (options.maxBandwidth) {
    const bwFiltered = candidateVariants.filter((v) => v.bandwidth <= options.maxBandwidth!);
    if (bwFiltered.length > 0) {
      candidateVariants = bwFiltered;
    }
  }

  // 3. Sort deterministically:
  //    Primary: height descending
  //    Secondary: bandwidth descending
  //    Tertiary: URI alphabetical (to ensure 100% deterministic tie-breaking)
  candidateVariants.sort((a, b) => {
    const hA = a.resolution?.height || 0;
    const hB = b.resolution?.height || 0;
    if (hA !== hB) return hB - hA;

    if (a.bandwidth !== b.bandwidth) return b.bandwidth - a.bandwidth;

    return a.uri.localeCompare(b.uri);
  });

  // 4. If a preferred height was requested (e.g. 720p), find exact or nearest match
  if (options.preferredHeight) {
    const exact = candidateVariants.find((v) => v.resolution?.height === options.preferredHeight);
    if (exact) return exact;
  }

  return candidateVariants[0];
}
