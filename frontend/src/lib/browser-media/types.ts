/**
 * Core type definitions for browser-side media processing via ffmpeg.wasm
 */

export type BrowserOperationType = 
  | 'remux' 
  | 'trim' 
  | 'convert' 
  | 'extract_audio' 
  | 'custom';

export type BrowserMediaStage =
  | 'idle'
  | 'checking_capabilities'
  | 'loading_engine'
  | 'writing_input'
  | 'processing'
  | 'reading_output'
  | 'finalizing'
  | 'ready'
  | 'error'
  | 'cancelled';

export interface BrowserMediaProgress {
  stage: BrowserMediaStage;
  percent: number; // 0 - 100
  message: string;
  bytesProcessed?: number;
  totalBytes?: number;
  timeRemainingEstimateSeconds?: number;
}

export type BrowserMediaProgressCallback = (progress: BrowserMediaProgress) => void;

export interface BrowserMediaCapabilities {
  webAssemblySupported: boolean;
  webWorkersSupported: boolean;
  sharedArrayBufferSupported: boolean;
  crossOriginIsolated: boolean;
  isMobileDevice: boolean;
  estimatedMemoryMB: number;
  maxSafeInputBytes: number;
  maxSafeDurationSeconds: number;
  browserProcessingRecommended: boolean;
  reasons: string[];
}

export type MediaSourceInput = Blob | File | ArrayBuffer | Uint8Array | string;

export interface BrowserProcessRequest {
  operation: BrowserOperationType;
  input: MediaSourceInput;
  inputFilename?: string;
  outputFilename?: string;
  targetContainer?: 'mp4' | 'webm' | 'mp3' | 'm4a' | 'wav';
  trimStartSeconds?: number;
  trimDurationSeconds?: number;
  customArgs?: string[];
  signal?: AbortSignal;
  onProgress?: BrowserMediaProgressCallback;
}

export interface BrowserProcessResult {
  outputBlob: Blob;
  downloadUrl: string;
  outputFilename: string;
  mimeType: string;
  sizeBytes: number;
  processingTimeMs: number;
  revokeUrl: () => void;
}

export type RoutingRecommendation = 
  | 'RECOMMENDED_BROWSER'
  | 'RECOMMENDED_SERVER'
  | 'BROWSER_ONLY'
  | 'SERVER_ONLY'
  | 'UNSUPPORTED';

export interface MediaRoutingDecision {
  mode: RoutingRecommendation;
  reason: string;
  browserSupported: boolean;
  serverSupported: boolean;
  estimatedBytes?: number;
  sourceUrl?: string;
}
