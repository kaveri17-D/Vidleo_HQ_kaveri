import type { MediaManifest, EngineProgressState } from '../../../frontend/src/packages/media-engine/types';

export type NexusMessageType =
  | 'PING'
  | 'PONG'
  | 'RESOLVE_MEDIA'
  | 'RESOLVE_MEDIA_SUCCESS'
  | 'RESOLVE_MEDIA_ERROR'
  | 'START_DOWNLOAD'
  | 'DOWNLOAD_PROGRESS'
  | 'DOWNLOAD_COMPLETE'
  | 'DOWNLOAD_CANCEL'
  | 'DOWNLOAD_FAILED'
  | 'START_DIRECT_ACQUISITION'
  | 'ACQUISITION_STARTED'
  | 'ACQUISITION_PROGRESS'
  | 'ACQUISITION_COMPLETE'
  | 'ACQUISITION_FAILED'
  | 'START_PLAYBACK_CAPTURE'
  | 'START_TAB_PLAYBACK_CAPTURE'
  | 'PLAYBACK_CAPTURE_STARTED'
  | 'PLAYBACK_CAPTURE_PROGRESS'
  | 'PLAYBACK_CAPTURE_COMPLETE'
  | 'PLAYBACK_CAPTURE_FAILED'
  | 'PROCESS_PLAYBACK_CAPTURE_FFMPEG'
  | 'YOUTUBE_MEDIA_OBSERVED'
  | 'NEXUS_CDP_DOWNLOAD_START'
  | 'NEXUS_CDP_STATUS'
  | 'NEXUS_CDP_PROGRESS'
  | 'NEXUS_CDP_RESULT'
  | 'NEXUS_CDP_ERROR'
  | 'NEXUS_CDP_CANCEL'
  | 'PROCESS_CDP_MEDIA_FFMPEG';

export interface StartDirectAcquisitionPayload {
  sessionId: string;
  streamUrl: string;
  targetFilename: string;
  expectedBytes?: number;
  mimeType?: string;
  targetContainer?: string;
}

export interface DirectAcquisitionProgressPayload {
  sessionId: string;
  percent: number;
  bytesReceived: number;
  totalBytes: number;
  speedFormatted?: string;
  etaFormatted?: string;
}

export interface DirectAcquisitionCompletePayload {
  sessionId: string;
  filename: string;
  totalBytes: number;
  mimeType: string;
  blobUrl?: string;
}

export interface StartDownloadPayload {
  jobId: string;
  manifest: MediaManifest;
  targetFormatId: string;
  targetFormatType?: 'video' | 'audio';
  apiBaseUrl?: string;
  authHeaders?: Record<string, string>;
}

export interface DownloadProgressPayload extends EngineProgressState {
  jobId: string;
}

export interface DownloadCompletePayload {
  jobId: string;
  filename: string;
  totalBytes: number;
  deliveryMode: string;
  blobUrl?: string;
}

export interface DownloadCancelPayload {
  jobId: string;
  reason?: string;
}

export interface DownloadFailedPayload {
  jobId: string;
  error: string;
  code?: string;
}

export interface ResolveMediaPayload {
  url: string;
  apiBaseUrl?: string;
}

export interface ResolveMediaSuccessPayload {
  jobId: string;
  manifest: MediaManifest;
}

export interface ResolveMediaErrorPayload {
  error: string;
  code?: string;
}

export interface StartPlaybackCapturePayload {
  sessionId: string;
  videoId?: string;
  videoUrl?: string;
  durationSeconds?: number;
  mode?: 'demo_10s' | 'full_video';
  targetFilename?: string;
}

export interface PlaybackCaptureProgressPayload {
  sessionId: string;
  stage: 'locating_player' | 'recording' | 'processing_ffmpeg' | 'verifying_output' | 'downloading';
  recordedSeconds: number;
  targetSeconds?: number;
  percent: number;
  bytesReceived: number;
}

export interface PlaybackCaptureCompletePayload {
  sessionId: string;
  filename: string;
  captureBytes: number;
  captureSha256: string;
  ffmpegInputSha256: string;
  ffmpegOutputSha256: string;
  outputBytes: number;
  outputDuration: number;
  outputWidth: number;
  outputHeight: number;
  videoTracksCount: number;
  audioTracksCount: number;
  mimeType: string;
  blobUrl?: string;
  downloadStarted?: boolean;
}

export interface ProcessPlaybackCaptureFfmpegPayload {
  sessionId: string;
  filename: string;
  base64Data: string;
  captureBytes: number;
  captureSha256: string;
  mimeType: string;
  videoTracksCount: number;
  audioTracksCount: number;
  videoWidth: number;
  videoHeight: number;
}

export interface StartCdpDownloadPayload {
  sessionId: string;
  videoId?: string;
  videoUrl: string;
  targetFilename?: string;
  durationSeconds?: number;
}

export interface CdpDownloadProgressPayload {
  sessionId: string;
  state:
    | 'EXTENSION_READY'
    | 'YOUTUBE_TAB_READY'
    | 'CDP_ATTACHING'
    | 'NETWORK_LISTENING'
    | 'MEDIA_DETECTED'
    | 'RESPONSE_BODY_ACQUIRING'
    | 'MEDIA_BYTES_ACQUIRED'
    | 'UMP_DEMUXING'
    | 'VIDEO_ASSEMBLY'
    | 'AUDIO_ASSEMBLY'
    | 'MUXING'
    | 'FINALIZING'
    | 'DOWNLOAD_READY'
    | 'COMPLETE';
  percent: number;
  message: string;
  bytesAcquired?: number;
  videoBytes?: number;
  audioBytes?: number;
  requestId?: string;
}

export interface CdpDownloadResultPayload {
  success: boolean;
  sessionId: string;
  filename: string;
  totalBytes: number;
  rawUmpBytes: number;
  videoBytes: number;
  audioBytes: number;
  duration: number;
  videoCodec: string;
  audioCodec: string;
  resolution: string;
  sha256: string;
  blobUrl?: string;
  downloadStarted: boolean;
  provenance: 'CDP_ACTIVE_PLAYER_MEDIA_RESPONSE_BODY';
}

export interface ProcessCdpMediaFfmpegPayload {
  sessionId: string;
  filename: string;
  videoBase64: string;
  audioBase64: string;
  videoBytesCount: number;
  audioBytesCount: number;
}

export interface NexusMessage<T = any> {
  type: NexusMessageType;
  payload: T;
  timestamp?: number;
}

