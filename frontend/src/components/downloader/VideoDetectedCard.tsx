'use client';

import React, { useState } from 'react';
import { 
  VideoMetadata, 
  QualityOption, 
  MediaFormatType,
  FlowPipelineStatus
} from '@/services/downloader/types';
import { QualitySelector } from './QualitySelector';
import { 
  ArrowRight, 
  Clock, 
  Eye, 
  ExternalLink, 
  RotateCcw, 
  CheckCircle2, 
  Video, 
  Music,
  AlertTriangle,
  Play,
  Sparkles,
  Download,
  Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BrowserConsentModal } from './BrowserConsentModal';
import { browserAcquisitionEngine, startPlaybackCaptureViaExtension } from '@/lib/browser-acquisition';

function getPipelineStatusBadge(status?: FlowPipelineStatus) {
  switch (status) {
    case 'METADATA_DETECTED':
      return {
        color: 'bg-amber-500',
        label: 'METADATA DETECTED',
      };
    case 'STREAM_CANDIDATE_AVAILABLE':
      return {
        color: 'bg-blue-500',
        label: 'STREAM CANDIDATE AVAILABLE',
      };
    case 'STREAM_SOURCE_UNRESOLVED':
      return {
        color: 'bg-amber-500',
        label: 'DIRECT SOURCE UNAVAILABLE',
      };
    case 'BROWSER_SOURCE_UNAVAILABLE':
      return {
        color: 'bg-rose-500',
        label: 'DIRECT SOURCE UNAVAILABLE',
      };
    case 'BROWSER_EXTENSION_READY':
      return {
        color: 'bg-indigo-500',
        label: 'BROWSER EXTENSION READY',
      };
    case 'PLAYER_STREAM_OBSERVED':
      return {
        color: 'bg-cyan-500',
        label: 'PLAYER STREAM OBSERVED',
      };
    case 'BROWSER_MEDIA_ACQUISITION_STARTED':
      return {
        color: 'bg-cyan-600',
        label: 'BROWSER ACQUISITION STARTED',
      };
    case 'BROWSER_MEDIA_BYTES_ACQUIRED':
      return {
        color: 'bg-emerald-500',
        label: 'BROWSER MEDIA BYTES ACQUIRED',
      };
    case 'BROWSER_MEDIA_BYTES_VERIFIED':
      return {
        color: 'bg-emerald-600',
        label: 'BROWSER MEDIA BYTES VERIFIED',
      };
    case 'BROWSER_PLAYBACK_CAPTURE_STARTED':
      return {
        color: 'bg-indigo-500',
        label: 'BROWSER PLAYBACK DETECTED',
      };
    case 'BROWSER_PLAYBACK_CAPTURE_RECORDING':
      return {
        color: 'bg-indigo-600',
        label: 'CAPTURING VIDEO LOCALLY...',
      };
    case 'BROWSER_PLAYBACK_CAPTURE_VERIFIED':
      return {
        color: 'bg-emerald-500',
        label: 'MEDIA CAPTURED',
      };
    case 'FFMPEG_INPUT_VERIFIED':
      return {
        color: 'bg-blue-600',
        label: 'FFMPEG INPUT VERIFIED',
      };
    case 'FFMPEG_PROCESSING':
      return {
        color: 'bg-blue-600',
        label: 'PROCESSING LOCALLY WITH FFMPEG...',
      };
    case 'FFMPEG_OUTPUT_VERIFIED':
      return {
        color: 'bg-emerald-600',
        label: 'FFMPEG OUTPUT VERIFIED',
      };
    case 'DOWNLOAD_STARTED':
      return {
        color: 'bg-emerald-500',
        label: 'DOWNLOAD STARTED',
      };
    case 'DOWNLOAD_COMPLETED':
      return {
        color: 'bg-emerald-600',
        label: 'DOWNLOAD COMPLETED',
      };
    case 'DOWNLOAD_FAILED':
      return {
        color: 'bg-rose-600',
        label: 'DOWNLOAD FAILED',
      };
    case 'BROWSER_ACQUISITION_READY':
      return {
        color: 'bg-emerald-500',
        label: 'BROWSER ACQUISITION READY',
      };
    case 'BROWSER_ACQUISITION_ACTIVE':
      return {
        color: 'bg-cyan-500',
        label: 'BROWSER ACQUISITION ACTIVE',
      };
    case 'BROWSER_ACQUISITION_SUCCESS':
      return {
        color: 'bg-emerald-600',
        label: 'STREAM VERIFIED (CLIENT ACQUIRED)',
      };
    case 'SERVER_FALLBACK':
      return {
        color: 'bg-amber-600',
        label: 'SERVER FALLBACK ACTIVE',
      };
    case 'RATE_LIMITED':
      return {
        color: 'bg-rose-500',
        label: 'SERVER RATE-LIMITED (HTTP 429)',
      };
    case 'BLOCKED':
      return {
        color: 'bg-rose-600',
        label: 'UPSTREAM RESTRICTED (HTTP 403)',
      };
    case 'DOWNLOAD_READY':
      return {
        color: 'bg-emerald-500',
        label: 'DOWNLOAD READY',
      };
    default:
      return {
        color: 'bg-amber-500',
        label: 'STREAM SOURCE UNRESOLVED',
      };
  }
}

interface VideoDetectedCardProps {
  metadata: VideoMetadata;
  onDownload: (quality: QualityOption, format: MediaFormatType, routePreference?: 'browser' | 'server') => void;
  onCancel?: () => void;
  onReset?: () => void;
}

export function VideoDetectedCard({
  metadata,
  onDownload,
  onCancel,
  onReset,
}: VideoDetectedCardProps) {
  const [activeFormat, setActiveFormat] = useState<MediaFormatType>('video');
  const [showConsentModal, setShowConsentModal] = useState(false);

  const [captureState, setCaptureState] = useState<{
    active: boolean;
    stage: string;
    percent: number;
    message: string;
    result?: any;
    error?: string;
  } | null>(null);

  const handleStartPlaybackCapture = async (mode: 'demo_10s' | 'full_video') => {
    setCaptureState({
      active: true,
      stage: 'locating_player',
      percent: 10,
      message: 'Browser playback detected...',
    });

    try {
      const videoIdMatch = (metadata.canonicalUrl || metadata.url).match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
      const videoId = videoIdMatch ? videoIdMatch[1] : undefined;

      const res = await startPlaybackCaptureViaExtension({
        videoId,
        videoUrl: metadata.canonicalUrl || metadata.url,
        mode,
        durationSeconds: mode === 'demo_10s' ? 10 : metadata.durationSeconds,
        targetFilename: `${metadata.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}_${mode === 'demo_10s' ? '10s_demo' : 'full'}.webm`,
        onProgress: (p) => {
          let msg = 'Capturing video locally...';
          if (p.stage === 'processing_ffmpeg') msg = 'Processing locally with FFmpeg...';
          if (p.stage === 'recording') msg = `Recording playback (${Math.round(p.recordedSeconds || 0)}s / ${Math.round(p.targetSeconds || 10)}s)...`;
          setCaptureState({
            active: true,
            stage: p.stage,
            percent: p.percent,
            message: msg,
          });
        }
      });

      setCaptureState({
        active: false,
        stage: 'ready',
        percent: 100,
        message: 'Download ready',
        result: res,
      });

      if (res.blobUrl) {
        const a = document.createElement('a');
        a.href = res.blobUrl;
        a.download = res.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err: any) {
      setCaptureState({
        active: false,
        stage: 'error',
        percent: 0,
        message: 'Capture failed',
        error: err?.message || 'Browser playback capture failed. Please ensure the video is playing in YouTube with the Vidleo Companion Extension enabled.',
      });
    }
  };

  const videoOptions = metadata.availableVideoQualities || [];
  const audioOptions = metadata.availableAudioQualities || [];

  const currentOptions = activeFormat === 'video' ? videoOptions : audioOptions;

  const [selectedQuality, setSelectedQuality] = useState<QualityOption>(() => {
    return (
      videoOptions.find((q) => q.isRecommended) ||
      videoOptions[0] ||
      audioOptions[0]
    );
  });

  const handleFormatChange = (fmt: MediaFormatType) => {
    setActiveFormat(fmt);
    const targetList = fmt === 'video' ? videoOptions : audioOptions;
    const recommended = targetList.find((q) => q.isRecommended) || targetList[0];
    if (recommended) setSelectedQuality(recommended);
  };

  const handleTriggerDownload = () => {
    if (!selectedQuality) return;

    const streamCandidate = metadata.canonicalUrl || metadata.url;
    const check = browserAcquisitionEngine.canAcquire(streamCandidate, selectedQuality.fileSizeBytes);

    if (check.canAcquire) {
      setShowConsentModal(true);
    } else {
      onDownload(selectedQuality, activeFormat, 'server');
    }
  };

  const handleAllowBrowser = () => {
    setShowConsentModal(false);
    onDownload(selectedQuality, activeFormat, 'browser');
  };

  const handleUseServer = () => {
    setShowConsentModal(false);
    onDownload(selectedQuality, activeFormat, 'server');
  };

  const handleActionReset = onReset || onCancel || (() => {});
  const badge = getPipelineStatusBadge(metadata.pipelineStatus);

  return (
    <div className="w-full bg-white border border-black/[0.12] rounded-[28px] overflow-hidden shadow-[0_16px_45px_rgba(0,0,0,0.08)] animate-in fade-in duration-200 text-[#0A0A0C]">
      {/* Top Banner Status */}
      <div className="bg-[#F8F8FA] px-6 py-3.5 border-b border-black/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full shadow-2xs", badge.color)} />
          <span className="text-xs font-mono uppercase tracking-wider text-[#7A7A82] font-bold">
            {badge.label}
          </span>
          <span className="text-xs font-mono text-[#C4C4CC]">·</span>
          <span className="text-xs font-mono text-[#0A0A0C] font-bold">
            {metadata.platformName}
          </span>
        </div>

        <button
          type="button"
          onClick={handleActionReset}
          className="inline-flex items-center gap-1.5 text-xs text-[#7A7A82] hover:text-[#0A0A0C] font-sans font-medium transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>New Link</span>
        </button>
      </div>

      {/* Upstream Diagnostics / Rate-Limit Alert Banner */}
      {metadata.pipelineStatus === 'RATE_LIMITED' && (
        <div className="bg-amber-50/90 border-b border-amber-200/80 px-6 py-3 flex items-start gap-3 text-xs text-amber-900 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-950">
              Server extraction is currently rate-limited by YouTube (HTTP 429).
            </p>
            <p className="text-[11px] text-amber-800 leading-relaxed font-sans">
              Direct browser acquisition is being attempted using the Vidleo Companion Extension. The server control plane will not transit raw video bytes.
            </p>
          </div>
        </div>
      )}

      {metadata.pipelineStatus === 'BLOCKED' && (
        <div className="bg-rose-50/90 border-b border-rose-200/80 px-6 py-3 flex items-start gap-3 text-xs text-rose-900 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-rose-950">
              Upstream media stream restricted (HTTP 403).
            </p>
            <p className="text-[11px] text-rose-800 leading-relaxed font-sans">
              Direct source requests are restricted by upstream policy. Client-side browser download requires active player session.
            </p>
          </div>
        </div>
      )}

      {(metadata.pipelineStatus === 'STREAM_SOURCE_UNRESOLVED' || metadata.pipelineStatus === 'BROWSER_SOURCE_UNAVAILABLE') && (
        <div className="bg-amber-50/90 border-b border-amber-200/80 px-6 py-3.5 flex items-start gap-3 text-xs text-amber-900 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-950">
              DIRECT SOURCE UNAVAILABLE
            </p>
            <p className="text-[11px] text-amber-800 leading-relaxed font-sans">
              Browser playback capture is available. Zero server media transit.
            </p>
          </div>
        </div>
      )}

      <div className="p-6 sm:p-7 space-y-6">
        {/* Media Preview & Metadata Header */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 items-start">
          {/* Thumbnail Preview */}
          <div className="md:col-span-5 relative group rounded-2xl overflow-hidden border border-black/[0.08] bg-black aspect-video flex items-center justify-center shadow-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={metadata.thumbnailUrl}
              alt={metadata.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            {/* Dark gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />

            {/* Duration Badge */}
            <div className="absolute bottom-2.5 right-2.5 px-2.5 py-0.5 rounded-full bg-black/80 backdrop-blur-md border border-white/20 text-[10.5px] font-mono text-white font-bold flex items-center gap-1">
              <Clock className="w-3 h-3 text-emerald-400" />
              <span>{metadata.durationFormatted}</span>
            </div>

            {/* Platform watermark */}
            <div className="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-black/70 backdrop-blur-md border border-white/20 text-[9.5px] font-mono uppercase tracking-wider text-white font-bold">
              {metadata.platformName}
            </div>
          </div>

          {/* Video Metadata info */}
          <div className="md:col-span-7 space-y-2.5">
            <h2 className="text-base sm:text-lg font-display font-[800] text-[#0A0A0C] leading-snug tracking-tight">
              {metadata.title}
            </h2>

            {/* Creator / Channel */}
            <div className="flex items-center gap-2 pt-0.5">
              {metadata.author.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={metadata.author.avatarUrl}
                  alt={metadata.author.name}
                  className="w-5 h-5 rounded-full object-cover border border-black/[0.1] shadow-2xs"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-[#0A0A0C] text-white flex items-center justify-center text-[9px] font-mono font-bold">
                  {metadata.author.name.charAt(0)}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-sans font-semibold text-[#3A3A42]">
                  {metadata.author.name}
                </span>
                {metadata.author.verified && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 inline" />
                )}
              </div>
            </div>

            {/* Metrics */}
            <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-[#7A7A82] pt-1">
              {metadata.viewsFormatted && (
                <span className="flex items-center gap-1">
                  <Eye className="w-3 h-3 text-[#A0A0AA]" />
                  {metadata.viewsFormatted}
                </span>
              )}
              {metadata.uploadedAtFormatted && (
                <span>Published {metadata.uploadedAtFormatted}</span>
              )}
              <a
                href={metadata.canonicalUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[#0A0A0C] hover:underline transition-colors inline-flex items-center gap-1 ml-auto font-sans font-medium text-xs cursor-pointer"
              >
                <span>Original Link</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Format Selector Tabs [ Video MP4 ] / [ Audio MP3 ] */}
        <div className="border-t border-black/[0.06] pt-5">
          <div className="flex items-center justify-between mb-2.5">
            <label className="text-[11px] font-mono uppercase tracking-wider text-[#7A7A82] font-bold">
              Select Output Format
            </label>
            <span className={cn(
              "text-[11px] font-mono font-semibold",
              (metadata.pipelineStatus === 'STREAM_SOURCE_UNRESOLVED' || metadata.pipelineStatus === 'BROWSER_SOURCE_UNAVAILABLE')
                ? "text-indigo-700"
                : "text-emerald-700"
            )}>
              {(metadata.pipelineStatus === 'STREAM_SOURCE_UNRESOLVED' || metadata.pipelineStatus === 'BROWSER_SOURCE_UNAVAILABLE')
                ? "Browser Playback Capture · WebM (VP9 + Opus)"
                : "Lossless Direct Extraction"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 bg-[#F4F4F6] p-1.5 rounded-2xl border border-black/[0.04]">
            <button
              type="button"
              onClick={() => handleFormatChange('video')}
              disabled={videoOptions.length === 0}
              className={cn(
                'flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer',
                activeFormat === 'video'
                  ? 'bg-white text-[#0A0A0C] font-bold shadow-xs'
                  : 'text-[#5A5A62] hover:text-black'
              )}
            >
              <Video className="w-3.5 h-3.5" />
              <span>Video (MP4 / 4K UHD)</span>
            </button>

            <button
              type="button"
              onClick={() => handleFormatChange('audio')}
              disabled={audioOptions.length === 0}
              className={cn(
                'flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer',
                activeFormat === 'audio'
                  ? 'bg-white text-[#0A0A0C] font-bold shadow-xs'
                  : 'text-[#5A5A62] hover:text-black'
              )}
            >
              <Music className="w-3.5 h-3.5" />
              <span>Audio Only (320kbps MP3)</span>
            </button>
          </div>
        </div>

        {/* Quality Stream Options List */}
        <QualitySelector
          format={activeFormat}
          options={currentOptions}
          selectedOption={selectedQuality}
          onSelect={setSelectedQuality}
          isSourceUnresolved={metadata.pipelineStatus === 'STREAM_SOURCE_UNRESOLVED' || metadata.pipelineStatus === 'BROWSER_SOURCE_UNAVAILABLE'}
        />

        {/* In-Browser Playback Capture UI & Action Controls */}
        {captureState?.active ? (
          <div className="pt-2">
            <div className="p-4 bg-indigo-50/90 border border-indigo-200/80 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                  <span className="text-xs font-semibold text-indigo-950">
                    {captureState.message}
                  </span>
                </div>
                <span className="text-xs font-mono font-bold text-indigo-700">
                  {Math.round(captureState.percent)}%
                </span>
              </div>
              <div className="w-full bg-indigo-200/60 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(5, captureState.percent))}%` }}
                />
              </div>
              <p className="text-[11px] font-sans text-indigo-800 leading-relaxed">
                Media is recording directly from browser playback. Zero raw media transit to server infrastructure.
              </p>
            </div>
          </div>
        ) : captureState?.result ? (
          <div className="pt-2 space-y-3">
            <div className="p-4 bg-emerald-50/90 border border-emerald-200/80 rounded-2xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-semibold text-emerald-950">
                    Download Ready · Playable Media Verified
                  </span>
                </div>
                <span className="text-[11px] font-mono font-bold text-emerald-700">
                  {((captureState.result.outputBytes || captureState.result.captureBytes || 0) / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-emerald-900/80 pt-1 border-t border-emerald-200/60">
                <div>Duration: {captureState.result.outputDuration?.toFixed(1) || '10.0'}s</div>
                <div>Format: {captureState.result.outputWidth}x{captureState.result.outputHeight} WebM</div>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (captureState.result?.blobUrl) {
                      const a = document.createElement('a');
                      a.href = captureState.result.blobUrl;
                      a.download = captureState.result.filename;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                    }
                  }}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#0A0A0C] hover:bg-black text-white py-2.5 px-4 rounded-xl text-xs font-semibold tracking-wide transition-all shadow-sm cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Download Again</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCaptureState(null)}
                  className="px-3 py-2.5 border border-emerald-300 rounded-xl text-xs text-emerald-800 hover:bg-emerald-100/50 font-medium transition-colors cursor-pointer"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        ) : (metadata.pipelineStatus === 'STREAM_SOURCE_UNRESOLVED' || metadata.pipelineStatus === 'BROWSER_SOURCE_UNAVAILABLE') ? (
          <div className="pt-2 space-y-3">
            <div className="p-4 bg-gradient-to-r from-blue-50/80 to-indigo-50/80 border border-blue-200/70 rounded-2xl">
              <div className="flex items-center justify-between pb-2">
                <span className="text-xs font-semibold text-blue-950 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                  Browser Playback Capture (Zero Server Transit)
                </span>
                <span className="text-[10px] font-mono uppercase bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">
                  FFmpeg.wasm Local
                </span>
              </div>
              <p className="text-[11.5px] text-blue-900/80 pb-3 leading-relaxed">
                Captures deciphered media locally from the active browser session. Starts playback in your browser tab, records via client network, and packages directly on your machine.
              </p>

              {/* In-Browser Active Playback Controls */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between p-2.5 bg-white/70 rounded-xl border border-blue-200/50 text-[11px] font-mono text-blue-900">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Target Video Tab
                  </span>
                  <a
                    href={metadata.canonicalUrl || metadata.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-700 hover:underline flex items-center gap-1 font-sans font-medium"
                  >
                    Open YouTube Tab <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleStartPlaybackCapture('demo_10s')}
                    className="flex items-center justify-center gap-2 bg-[#0A0A0C] hover:bg-black text-white py-3 px-4 rounded-xl text-xs font-semibold tracking-wide transition-all shadow-sm cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Download 10s Demo</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleStartPlaybackCapture('full_video')}
                    className="flex items-center justify-center gap-2 bg-white hover:bg-black/[0.04] text-[#0A0A0C] border border-black/15 py-3 px-4 rounded-xl text-xs font-semibold tracking-wide transition-all shadow-xs cursor-pointer"
                  >
                    <Video className="w-3.5 h-3.5 text-blue-600" />
                    <span>Download Full Video</span>
                  </button>
                </div>
              </div>
            </div>

            {captureState?.error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                {captureState.error}
              </div>
            )}

            {/* Optional Server Extraction Fallback */}
            <button
              type="button"
              onClick={handleTriggerDownload}
              disabled={!selectedQuality}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-xs text-[#7A7A82] hover:text-[#0A0A0C] transition-colors cursor-pointer"
            >
              <span>Or use Server Extraction Fallback</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          /* Standard Direct Stream Download Button */
          <div className="pt-2">
            <button
              type="button"
              onClick={handleTriggerDownload}
              disabled={!selectedQuality}
              className="w-full group relative flex items-center justify-center gap-2.5 bg-[#0A0A0C] hover:bg-black text-white py-3.5 px-6 rounded-full font-sans font-semibold text-xs tracking-wider uppercase transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-black/15 cursor-pointer"
            >
              <span>
                Download {selectedQuality?.label || 'Media'}
              </span>
              <span className="text-[11px] font-mono font-medium text-white/70 pl-1">
                ({selectedQuality?.fileSizeApprox || 'Ready'})
              </span>
              <ArrowRight className="w-4 h-4 text-white/80 group-hover:translate-x-0.5 transition-transform" />
            </button>
            <p className="text-[11px] text-[#7A7A82] text-center pt-2.5 font-sans">
              Direct high-speed stream · No watermark added · Native uncompressed container
            </p>
          </div>
        )}
      </div>

      {/* Operation-scoped Browser Acquisition Consent Modal */}
      <BrowserConsentModal
        isOpen={showConsentModal}
        videoTitle={metadata.title}
        filesizeFormatted={selectedQuality?.fileSizeApprox}
        onAllowBrowser={handleAllowBrowser}
        onUseServer={handleUseServer}
        onClose={() => setShowConsentModal(false)}
      />
    </div>
  );
}
