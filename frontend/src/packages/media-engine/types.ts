export type StreamType = 'progressive' | 'video' | 'audio' | 'hls';

export interface StreamMediaItem {
  id: string;
  url: string;
  host: string;
  format_id: string;
  container: string;
  codec: string;
  type: StreamType;
  bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  filesize?: number;
  range_supported: boolean;
  cors_accessible?: boolean;
  relay_required?: boolean;
  relay_url?: string;
  headers_required: Record<string, string>;
  expires_at?: string;
  is_preferred?: boolean;
  protocol?: string;
  is_hls?: boolean;
  hls_type?: 'master' | 'media';
  encryption?: 'NONE' | 'AES-128' | 'SAMPLE-AES';
  target_duration?: number;
}

export interface MediaStreams {
  progressive: StreamMediaItem[];
  video: StreamMediaItem[];
  audio: StreamMediaItem[];
  hls?: StreamMediaItem[];
}

export interface SourceMetadata {
  url: string;
  canonical_url: string;
  provider: string;
  title: string;
  duration?: number;
  thumbnail?: string;
  uploader?: string;
}

export interface AccessRequirements {
  method: string;
  headers_required: Record<string, string>;
  cookies_required: boolean;
  range_supported: boolean;
  ip_binding: boolean;
  expires_at?: string;
}

export interface ManifestRefreshConfig {
  refresh_supported: boolean;
  refresh_url: string;
  expires_at?: string;
}

export interface ManifestFallbackConfig {
  server_fallback_allowed: boolean;
  reason?: string;
}

export interface ManifestSecurity {
  ticket_required: boolean;
  allowed_hosts: string[];
}

export interface MediaManifest {
  manifest_version: string;
  job_id: string;
  source: SourceMetadata;
  media: MediaStreams;
  access: AccessRequirements;
  refresh: ManifestRefreshConfig;
  fallback: ManifestFallbackConfig;
  security: ManifestSecurity;
  created_at: string;
}

export type StrategyType =
  | 'DIRECT_PROGRESSIVE'
  | 'DIRECT_RANGE'
  | 'BROWSER_ADAPTIVE_MUX'
  | 'BROWSER_HLS'
  | 'SIGNED_WORKER_RANGE'
  | 'SERVER_FALLBACK'
  | 'UNSUPPORTED';

export interface StrategyDecision {
  strategy: StrategyType;
  reason: string;
  target_format_id: string;
  video_stream?: StreamMediaItem;
  audio_stream?: StreamMediaItem;
  progressive_stream?: StreamMediaItem;
  hls_stream?: StreamMediaItem;
  ticket_required?: boolean;
  estimated_bytes: number;
}

export interface ClientCapabilities {
  fsa_supported: boolean;
  opfs_supported: boolean;
  remux_supported: boolean;
  hls_supported: boolean;
}

export interface EngineProgressState {
  stage: 'preparing' | 'fetching' | 'muxing' | 'saving' | 'complete' | 'error';
  progressPercent: number; // 0 - 100
  downloadedBytes: number;
  totalBytes: number;
  speedBps?: number;
  speedFormatted?: string;
  etaSeconds?: number;
  etaFormatted?: string;
  message?: string;
  error?: string;
  downloadUrl?: string;
  blob?: Blob;
}

export type EngineProgressCallback = (state: EngineProgressState) => void;

export interface EngineDownloadResult {
  jobId: string;
  filename: string;
  totalBytes: number;
  deliveryMode: string;
  downloadUrl?: string;
  blob?: Blob;
}

export interface HLSKeyMetadata {
  method: 'NONE' | 'AES-128' | 'SAMPLE-AES';
  uri?: string;
  iv?: Uint8Array;
  keyFormat?: string;
}

export interface HLSSegment {
  index: number;
  uri: string;
  duration: number;
  title?: string;
  byteRange?: { length: number; offset: number };
  discontinuity: boolean;
  key?: HLSKeyMetadata;
  map?: { uri: string; byteRange?: { length: number; offset: number } };
}

export interface HLSVariant {
  uri: string;
  bandwidth: number;
  averageBandwidth?: number;
  resolution?: { width: number; height: number };
  frameRate?: number;
  codecs?: string;
  audioGroup?: string;
  videoGroup?: string;
}

export interface HLSPlaylist {
  type: 'master' | 'media';
  version?: number;
  targetDuration?: number;
  mediaSequence?: number;
  discontinuitySequence?: number;
  endlist: boolean;
  variants: HLSVariant[];
  segments: HLSSegment[];
}

export type HLSErrorCategory =
  | 'UNSUPPORTED_CODEC'
  | 'UNSUPPORTED_ENCRYPTION'
  | 'INVALID_PLAYLIST'
  | 'INVALID_SEGMENT'
  | 'TICKET_EXPIRED'
  | 'TICKET_INVALID'
  | 'SSRF_VIOLATION'
  | 'SEGMENT_TOO_LARGE'
  | 'PLAYLIST_TOO_LARGE'
  | 'DURATION_LIMIT'
  | 'SEGMENT_LIMIT'
  | 'NETWORK_EXHAUSTED'
  | 'TIMESTAMP_ERROR'
  | 'MUX_ERROR'
  | 'CANCELLED';

export type ExecutionMode =
  | 'NORMAL_CLIENT_FIRST'
  | 'GPU_PREFERRED'
  | 'GPU_REQUIRED'
  | 'SERVER_ONLY';

export type ExecutionLocation =
  | 'CLIENT_HARDWARE'
  | 'CLIENT_SOFTWARE'
  | 'CLIENT_PLUS_WORKER'
  | 'SERVER_GPU'
  | 'SERVER_CPU'
  | 'GPU_EXECUTION_UNAVAILABLE'
  | 'UNSUPPORTED'
  | 'NOT_PROVEN'
  | 'UNTESTED'
  | 'NOT_AVAILABLE_IN_LAB';

export interface PlatformCapabilities {
  browser: string;
  browser_version: string;
  os: string;
  os_version: string;
  architecture: string;
  cpu: string;
  gpu_vendor: string;
  gpu_name: string;
  gpu_type: string;
  device_class: string;
  video_decoders: string[];
  video_encoders: string[];
  webcodecs: boolean;
  webgpu: boolean;
  webgl2: boolean;
  mediacapabilities: boolean;
  storage_available: number;
  memory_available: number;
  hardware_decode: boolean;
  hardware_encode: boolean;
  gpu_compute: boolean;
  client_remux: boolean;
}

export interface GovernorDecision {
  execution_mode: string;
  execution_location: string;
  client_execution: boolean;
  client_hardware_requested: string;
  client_hardware_capable: boolean;
  client_hardware_proven: boolean;
  client_software_available: boolean;
  server_gpu_allowed: boolean;
  server_gpu_available: boolean;
  server_gpu_selected: boolean;
  server_cpu_available: boolean;
  fallback_reason?: string | null;
  fallback_level: number;
  codec: string;
  profile?: string | null;
  level?: string | null;
  bit_depth: number;
  resolution: string;
  framerate: number;
  container: string;
  duration: number;
  size: number;
  memory_estimate: number;
  storage_available: number;
  storage_supported: boolean;
  browser: string;
  browser_version: string;
  os: string;
  os_version: string;
  architecture: string;
  cpu: string;
  gpu_vendor: string;
  gpu_name: string;
  gpu_type: string;
  device_class: string;
  hardware_decoder?: string | null;
  hardware_encoder?: string | null;
  webcodecs_supported: boolean;
  webgpu_supported: boolean;
  media_capabilities_supported: boolean;
  confidence: string;
  evidence_sources: string[];
  decision_timestamp: number;
  job_id?: string | null;
}


