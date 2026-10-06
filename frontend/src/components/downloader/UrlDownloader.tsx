'use client';

import React, { useState, useRef } from 'react';
import { 
  ArrowRight, 
  Clipboard, 
  X, 
  AlertCircle, 
  Check, 
  Link as LinkIcon,
  ChevronDown
} from 'lucide-react';
import { 
  VideoMetadata, 
  QualityOption, 
  MediaFormatType, 
  AnalysisStateData, 
  DownloadSession 
} from '@/services/downloader/types';
import { parseAndValidateVideoUrl } from '@/services/downloader/urlParser';
import { DownloaderService } from '@/services/downloader/downloaderService';
import { AnalysisState } from './AnalysisState';
import { VideoDetectedCard } from './VideoDetectedCard';
import { DownloadReadyState } from './DownloadReadyState';
import { cn } from '@/lib/utils';

interface UrlDownloaderProps {
  initialUrl?: string;
  className?: string;
  variant?: 'light' | 'dark';
  onDownloadComplete?: () => void;
}

const SAMPLE_URLS = [
  { label: 'YouTube 4K Film', url: 'https://youtube.com/watch?v=dQw4w9WgXcQ', platform: 'YouTube' },
  { label: 'X Clip', url: 'https://x.com/cinema/status/17892019283', platform: 'X' },
  { label: 'Instagram Reel', url: 'https://instagram.com/reel/C9Xk2LpB123', platform: 'Instagram' },
  { label: 'Vimeo Staff Pick', url: 'https://vimeo.com/76979871', platform: 'Vimeo' },
];

export function UrlDownloader({
  initialUrl = '',
  className,
  variant = 'light',
  onDownloadComplete,
}: UrlDownloaderProps) {
  const [url, setUrl] = useState(initialUrl);
  const [stage, setStage] = useState<'idle' | 'analyzing' | 'detected' | 'downloading' | 'ready' | 'error'>('idle');
  
  const [analysisState, setAnalysisState] = useState<AnalysisStateData>({
    step: 'idle',
    progress: 0,
    message: '',
  });

  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [downloadSession, setDownloadSession] = useState<DownloadSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pastedFeedback, setPastedFeedback] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Live detected platform indicator
  const parsedInfo = url.trim() ? parseAndValidateVideoUrl(url) : null;

  const isDark = variant === 'dark';

  const handlePaste = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setUrl(text);
          setPastedFeedback(true);
          setTimeout(() => setPastedFeedback(false), 2000);
          inputRef.current?.focus();
        }
      }
    } catch {
      inputRef.current?.focus();
    }
  };

  const handleAnalyze = async (overrideUrl?: string) => {
    const targetUrl = overrideUrl || url;
    if (!targetUrl.trim()) {
      setErrorMessage('Please paste or type a video link to analyze.');
      return;
    }

    setErrorMessage(null);
    setStage('analyzing');

    try {
      const result = await DownloaderService.analyzeVideo(targetUrl, (stateUpdate) => {
        setAnalysisState(stateUpdate);
      });
      setMetadata(result);
      setStage('detected');
    } catch (err: any) {
      setStage('error');
      setErrorMessage(err?.message || 'Could not analyze video. Please verify the link and try again.');
    }
  };

  const handleDownloadTrigger = async (
    quality: QualityOption, 
    format: MediaFormatType, 
    routePreference: 'browser' | 'server' = 'browser'
  ) => {
    if (!metadata) return;

    setStage('downloading');
    abortControllerRef.current = new AbortController();

    try {
      const session = await DownloaderService.executeDownload(
        metadata,
        quality,
        format,
        (progressSession) => {
          setDownloadSession(progressSession);
        },
        abortControllerRef.current.signal,
        routePreference
      );

      if (session) {
        setDownloadSession(session);
      }
      setStage('ready');
      if (onDownloadComplete) onDownloadComplete();
    } catch (err: any) {
      if (err.message !== 'Download aborted by user') {
        setErrorMessage(err.message || 'Download stream interrupted');
        setStage('detected');
      }
    }
  };

  const handleReset = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setStage('idle');
    setMetadata(null);
    setDownloadSession(null);
    setErrorMessage(null);
    setAnalysisState({ step: 'idle', progress: 0, message: '' });
  };

  const handleSampleClick = (sampleUrl: string) => {
    setUrl(sampleUrl);
    handleAnalyze(sampleUrl);
  };

  return (
    <div className={cn('w-full space-y-4', className)}>
      {/* 1. IDLE / INPUT STAGE */}
      {stage === 'idle' && (
        <div className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAnalyze();
            }}
            className={cn(
              "group relative flex items-center p-2 sm:p-2.5 transition-all duration-200",
              isDark
                ? "rounded-2xl sm:rounded-full bg-[#060D1F]/80 border border-blue-500/30 hover:border-blue-400/50 focus-within:border-[#388BFD] focus-within:ring-4 focus-within:ring-[#388BFD]/20 shadow-[0_0_30px_rgba(0,102,255,0.25)] backdrop-blur-xl"
                : "rounded-2xl bg-white border border-[#D8D8D8] hover:border-[#B0B0B0] focus-within:border-[#0A0A0C] focus-within:ring-2 focus-within:ring-black/5 shadow-[0_4px_24px_rgba(0,0,0,0.07)]"
            )}
          >
            {/* Left Link Icon & Platform Tag */}
            <div className="flex items-center gap-2 pl-3.5 sm:pl-4 shrink-0">
              <LinkIcon className={cn(
                "w-5 h-5 transition-colors",
                isDark ? "text-blue-300/60 group-focus-within:text-[#388BFD]" : "text-[#9CA3AF] group-focus-within:text-[#0A0A0C]"
              )} />
              {parsedInfo && parsedInfo.isValid && (
                <span className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider shadow-2xs",
                  isDark ? "bg-[#388BFD] text-white" : "bg-[#0A0A0C] text-white"
                )}>
                  {parsedInfo.platformName}
                </span>
              )}
            </div>

            {/* Input Element */}
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder="Paste a video link here..."
              className={cn(
                "w-full bg-transparent px-3 py-3 sm:py-3.5 text-[15px] sm:text-[17px] focus:outline-none font-sans font-medium leading-tight",
                isDark
                  ? "text-white placeholder:text-blue-200/40"
                  : "text-[#0A0A0C] placeholder:text-[#9CA3AF]"
              )}
              autoComplete="off"
              spellCheck="false"
            />

            {/* Right Controls: Quality Selector + Paste + Download */}
            <div className="flex items-center gap-1.5 sm:gap-2 pr-1 shrink-0 justify-end">
              {url && (
                <button
                  type="button"
                  onClick={() => {
                    setUrl('');
                    setErrorMessage(null);
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    "p-1.5 rounded-lg transition-colors cursor-pointer",
                    isDark ? "text-blue-200/40 hover:text-white hover:bg-blue-900/40" : "text-[#9CA3AF] hover:text-[#0A0A0C] hover:bg-black/[0.04]"
                  )}
                  title="Clear input"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              {/* Quality Dropdown Selector (Reference Match) */}
              {!isDark && (
                <div className="hidden sm:flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#F4F4F6] hover:bg-[#EDEDF0] border border-[#E5E7EB] text-[13px] font-semibold text-[#374151] cursor-pointer transition-colors whitespace-nowrap">
                  <span>Best Quality</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                </div>
              )}

              <button
                type="submit"
                className={cn(
                  "inline-flex items-center justify-center gap-2 px-6 sm:px-7 py-3 sm:py-3.5 rounded-xl font-sans font-semibold text-[13.5px] tracking-tight transition-all duration-200 transform hover:-translate-y-[1px] hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-sm hover:shadow-md",
                  isDark
                    ? "bg-white hover:bg-blue-50 text-[#050814] shadow-blue-500/20 hover:shadow-blue-500/40"
                    : "bg-[#0A0A0C] hover:bg-black text-white"
                )}
              >
                <span>Download</span>
              </button>
            </div>
          </form>

          {/* Clean Modular Sample URL Links */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 text-xs font-sans pt-0.5">
            <span className={cn(
              "text-[11px] font-sans font-semibold whitespace-nowrap",
              isDark ? "text-blue-200/50" : "text-[#7A7A82]"
            )}>
              Try sample:
            </span>
            <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
              {SAMPLE_URLS.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  onClick={() => handleSampleClick(sample.url)}
                  className={cn(
                    "px-3 py-1 rounded-full text-[11px] font-sans font-medium transition-all cursor-pointer shadow-2xs whitespace-nowrap",
                    isDark
                      ? "bg-[#0A132B]/60 hover:bg-blue-900/60 text-blue-200/80 hover:text-white border border-blue-500/20 hover:border-blue-400/40"
                      : "bg-white border border-black/[0.08] hover:border-black/[0.25] text-[#5A5A62] hover:text-black"
                  )}
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ERROR MESSAGE BAR */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-700 hover:text-red-900 text-xs font-mono font-bold uppercase tracking-wider px-2 py-1 rounded hover:bg-red-100 transition-colors cursor-pointer"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* 2. ANALYZING / PROGRESS STAGE */}
      {stage === 'analyzing' && (
        <AnalysisState
          state={analysisState}
          onCancel={handleReset}
        />
      )}

      {/* 3. DETECTED / QUALITY SELECTOR STAGE */}
      {stage === 'detected' && metadata && (
        <VideoDetectedCard
          metadata={metadata}
          onDownload={handleDownloadTrigger}
          onCancel={handleReset}
          onReset={handleReset}
        />
      )}

      {/* 4. DOWNLOADING / READY STAGE */}
      {(stage === 'downloading' || stage === 'ready') && downloadSession && (
        <DownloadReadyState
          session={downloadSession}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
