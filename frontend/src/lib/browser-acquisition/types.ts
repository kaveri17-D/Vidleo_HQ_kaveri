/**
 * Types and interfaces for Browser-First Media Acquisition and NEXUS Integration
 */

export type ConsentState = 
  | 'NOT_ASKED'
  | 'CONSENT_DIALOG'
  | 'DECLINED'
  | 'GRANTED'
  | 'ACQUISITION_ACTIVE'
  | 'CANCELLED'
  | 'FAILED'
  | 'COMPLETED';

export type AcquisitionSource = 
  | 'BROWSER_NETWORK'
  | 'SERVER'
  | 'UNKNOWN';

export type AcquisitionStatus =
  | 'SUPPORTED'
  | 'UNSUPPORTED'
  | 'BLOCKED'
  | 'CORS_BLOCKED'
  | 'AUTH_REQUIRED'
  | 'NETWORK_ERROR'
  | 'SOURCE_RESTRICTED'
  | 'ABORTED'
  | 'UNKNOWN_ERROR';

export type AcquisitionStage =
  | 'idle'
  | 'checking_consent'
  | 'evaluating_capabilities'
  | 'acquiring'
  | 'processing'
  | 'finalizing'
  | 'complete'
  | 'fallback_to_server'
  | 'failed'
  | 'cancelled';

export interface AcquisitionProgress {
  stage: AcquisitionStage;
  percent: number; // 0 - 100
  bytesReceived: number;
  totalBytes: number;
  speedBps?: number;
  speedFormatted?: string;
  etaFormatted?: string;
  message: string;
  source: AcquisitionSource;
}

export type AcquisitionProgressCallback = (progress: AcquisitionProgress) => void;

export interface ResourceBudget {
  maxBrowserFileSizeBytes: number;
  maxProcessingTimeMs: number;
  maxMemoryEstimateMb: number;
  maxConcurrentJobs: number;
}

export interface FeatureFlags {
  browserMediaEnabled: boolean;
  browserYoutubeAcquisitionEnabled: boolean;
  browserFfmpegEnabled: boolean;
  browserServerFallbackEnabled: boolean;
}

export interface AcquisitionDiagnostics {
  sessionId: string;
  route: 'browser' | 'server';
  acquisitionSource: AcquisitionSource;
  acquisitionStatus: AcquisitionStatus;
  sourceDomain: string;
  bytesReceived: number;
  totalExpectedBytes: number;
  chunksCount: number;
  rangeSupported: boolean;
  mimeType?: string;
  durationMs: number;
  deviceClass: 'desktop' | 'mobile';
  ffmpegProcessingApplied: boolean;
  mediaIntegrityVerified: boolean;
  playbackVerified: boolean;
  errorMessage?: string;
}

export interface AcquisitionResult {
  success: boolean;
  sessionId: string;
  acquisitionSource: AcquisitionSource;
  mediaBuffer?: Uint8Array;
  mediaBlob?: Blob;
  mediaUrl?: string;
  filename: string;
  mimeType: string;
  totalBytes: number;
  diagnostics: AcquisitionDiagnostics;
}

export interface BrowserAcquireOptions {
  sourceUrl: string;
  targetFilename: string;
  expectedBytes?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: AcquisitionProgressCallback;
  enableFfmpegProcessing?: boolean;
  targetContainer?: 'mp4' | 'webm' | 'mp3' | 'm4a';
}
