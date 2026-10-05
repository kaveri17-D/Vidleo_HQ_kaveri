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
  | 'DOWNLOAD_FAILED';

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

export interface NexusMessage<T = any> {
  type: NexusMessageType;
  payload: T;
  timestamp?: number;
}
