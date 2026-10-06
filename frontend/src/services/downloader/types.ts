export type PlatformType =
  | 'youtube'
  | 'tiktok'
  | 'instagram'
  | 'vimeo'
  | 'twitter'
  | 'reddit'
  | 'pinterest'
  | 'soundcloud'
  | 'generic';

export type MediaFormatType = 'video' | 'audio';
export type VideoContainer = 'mp4' | 'webm' | 'mkv';
export type AudioContainer = 'mp3' | 'm4a' | 'wav';

export interface QualityOption {
  id: string;
  label: string; // e.g., "4K 2160p", "1080p Full HD", "720p HD", "480p", "320 kbps"
  resolution?: string;
  fps?: number;
  bitrate?: string;
  fileSizeApprox: string; // e.g. "142.5 MB"
  fileSizeBytes: number;
  container: VideoContainer | AudioContainer;
  type: MediaFormatType;
  isRecommended?: boolean;
  hasAudio: boolean;
  hdr?: boolean;
  streamUrl?: string;
}

export type FlowPipelineStatus =
  | 'METADATA_DETECTED'
  | 'STREAM_CANDIDATE_AVAILABLE'
  | 'STREAM_SOURCE_UNRESOLVED'
  | 'BROWSER_SOURCE_UNAVAILABLE'
  | 'BROWSER_EXTENSION_READY'
  | 'PLAYER_STREAM_OBSERVED'
  | 'BROWSER_MEDIA_ACQUISITION_STARTED'
  | 'BROWSER_MEDIA_BYTES_ACQUIRED'
  | 'BROWSER_MEDIA_BYTES_VERIFIED'
  | 'FFMPEG_INPUT_VERIFIED'
  | 'FFMPEG_OUTPUT_VERIFIED'
  | 'BROWSER_ACQUISITION_READY'
  | 'BROWSER_ACQUISITION_ACTIVE'
  | 'BROWSER_ACQUISITION_SUCCESS'
  | 'SERVER_FALLBACK'
  | 'RATE_LIMITED'
  | 'BLOCKED'
  | 'DOWNLOAD_READY';

export interface VideoMetadata {
  id: string;
  url: string;
  canonicalUrl: string;
  platform: PlatformType;
  platformName: string;
  title: string;
  description?: string;
  author: {
    name: string;
    handle?: string;
    avatarUrl?: string;
    verified?: boolean;
  };
  durationSeconds: number;
  durationFormatted: string;
  thumbnailUrl: string;
  viewsFormatted?: string;
  uploadedAtFormatted?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5';
  availableVideoQualities: QualityOption[];
  availableAudioQualities: QualityOption[];
  manifest?: any;
  pipelineStatus?: FlowPipelineStatus;
  upstreamDiagnostics?: {
    statusCode?: number;
    errorDetail?: string;
    rateLimited?: boolean;
    provider?: string;
  };
}

export type AnalysisStep = 
  | 'idle'
  | 'validating_url'
  | 'fetching_metadata'
  | 'detecting_formats'
  | 'preparing_options'
  | 'complete'
  | 'error';

export interface AnalysisStateData {
  step: AnalysisStep;
  progress: number; // 0 - 100
  message: string;
  error?: string;
  pipelineStatus?: FlowPipelineStatus;
}

export interface DownloadSession {
  id: string;
  metadata: VideoMetadata;
  selectedQuality: QualityOption;
  selectedFormat: MediaFormatType;
  status: 'idle' | 'preparing' | 'downloading' | 'converting' | 'ready' | 'error';
  progress: number; // 0 - 100
  downloadedBytes: number;
  totalBytes: number;
  speedFormatted?: string; // e.g. "14.2 MB/s"
  timeRemainingFormatted?: string; // e.g. "4s"
  downloadUrl?: string;
  errorMessage?: string;
  acquisitionSource?: 'BROWSER_NETWORK' | 'SERVER' | 'UNKNOWN';
  route?: 'browser' | 'server';
  pipelineStatus?: FlowPipelineStatus;
}

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  subtitle?: string;
  platform: PlatformType;
  platformName: string;
  thumbnailUrl: string;
  durationFormatted: string;
  qualityLabel: string;
  format: MediaFormatType;
  container: string;
  fileSizeApprox: string;
  createdAt: string; // ISO string
  authorName: string;
  authorAvatarUrl?: string;
}

export interface UserPreferences {
  defaultFormat: MediaFormatType;
  preferredQuality: string;
  autoAnalyzeOnPaste: boolean;
  theme: 'cinematic-dark';
  saveHistory: boolean;
  soundEffects: boolean;
}
