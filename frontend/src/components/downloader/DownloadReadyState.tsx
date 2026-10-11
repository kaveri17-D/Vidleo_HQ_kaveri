'use client';

import React, { useState } from 'react';
import { DownloadSession } from '@/services/downloader/types';
import { 
  CheckCircle2, 
  Download, 
  RotateCcw, 
  FileVideo, 
  FileAudio, 
  ArrowDownToLine, 
  ArrowRight,
  Cpu,
  Sparkles,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import { BrowserMediaProcessor } from './BrowserMediaProcessor';
import { DownloaderService } from '@/services/downloader/downloaderService';

interface DownloadReadyStateProps {
  session: DownloadSession;
  onReset: () => void;
  onRedownload?: () => void;
}

export function DownloadReadyState({
  session,
  onReset,
}: DownloadReadyStateProps) {
  const isComplete = session.status === 'ready';
  const [showStudio, setShowStudio] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSaveToDisk = async () => {
    setSaveError(null);

    if (!session.downloadUrl) {
      alert('The file was saved directly to your chosen folder during extraction.');
      return;
    }

    const ext = session.selectedQuality?.container || 'mp4';
    const sanitizedTitle = session.metadata.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const label = session.selectedQuality?.label || 'download';
    const filename = `VIDLEO_${sanitizedTitle}_${label}.${ext}`;

    // A. Blob URL or data URL -> download directly
    if (session.downloadUrl.startsWith('blob:') || session.downloadUrl.startsWith('data:')) {
      try {
        const a = document.createElement('a');
        a.href = session.downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setSavedSuccess(true);
      } catch (err: any) {
        setSaveError(`Failed to save file: ${err?.message || 'Download error'}`);
      }
      return;
    }

    // B. Server-backed URL -> authenticated in-memory fetch
    setIsSaving(true);
    try {
      const headers = await DownloaderService.getAuthHeaders();
      const response = await fetch(session.downloadUrl, {
        headers,
      });

      if (!response.ok) {
        let errMessage = `Server returned HTTP ${response.status} ${response.statusText}`;
        try {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const errJson = await response.json();
            if (typeof errJson.detail === 'string') {
              errMessage = errJson.detail;
            } else if (errJson.detail?.message) {
              errMessage = errJson.detail.message;
            }
          }
        } catch {
          // ignore json parse error
        }

        if (response.status === 401 || response.status === 403) {
          throw new Error(`Authentication required: ${errMessage}. Please sign in to download this server-generated file.`);
        } else if (response.status === 404) {
          throw new Error('The requested download file is no longer available or has expired.');
        } else {
          throw new Error(errMessage);
        }
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const errJson = await response.json();
        throw new Error(errJson.detail || 'Received JSON response instead of a media file.');
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 30000);

      setSavedSuccess(true);
    } catch (err: any) {
      console.error('[DownloadReadyState] Save to Disk failed:', err);
      setSaveError(err?.message || 'Failed to download file from server.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full bg-white border border-black/[0.12] rounded-[28px] p-6 sm:p-7 space-y-6 shadow-[0_16px_45px_rgba(0,0,0,0.08)] animate-in fade-in duration-200 text-[#0A0A0C]">
      {/* Status banner */}
      <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              isComplete
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                : 'bg-[#F4F4F6] text-[#0A0A0C] animate-pulse border border-black/[0.08]'
            }`}
          >
            {isComplete ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <ArrowDownToLine className="w-4 h-4 animate-bounce text-[#0A0A0C]" />
            )}
          </div>

          <div>
            <h3 className="font-display font-[800] text-sm tracking-tight text-[#0A0A0C]">
              {isComplete ? 'Extraction Complete & Ready' : 'Processing Media Stream'}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-[#7A7A82] font-mono">
                {session.status === 'converting'
                  ? 'Muxing video & audio codec layers...'
                  : session.status === 'downloading'
                  ? `Transmitting stream (${session.progress}%)`
                  : 'Asset verified and ready for disk storage'}
              </p>
              {session.acquisitionSource === 'BROWSER_NETWORK' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-100 text-purple-900 border border-purple-200">
                  BROWSER ACQUISITION (ZERO SERVER BYTES)
                </span>
              )}
              {session.acquisitionSource === 'SERVER' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-gray-100 text-gray-700 border border-gray-200">
                  SERVER FALLBACK
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 text-xs text-[#7A7A82] hover:text-[#0A0A0C] font-sans font-medium transition-colors px-3 py-1.5 rounded-full hover:bg-black/[0.05] cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>New Link</span>
        </button>
      </div>

      {/* Progress or Completion View */}
      {!isComplete ? (
        <div className="space-y-4 py-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-[#7A7A82]">
              {formatBytes(session.downloadedBytes)} / {session.selectedQuality?.fileSizeApprox || 'calculating...'}
            </span>
            <span className="text-[#0A0A0C] font-bold">{session.progress}%</span>
          </div>

          <div className="w-full bg-[#EBEBEF] rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-[#0A0A0C] h-full transition-all duration-150 ease-out"
              style={{ width: `${session.progress}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-[#A0A0AA]">
            <span>Throughput: {session.speedFormatted || '38.4 MB/s'}</span>
            <span>{session.timeRemainingFormatted || 'Few seconds...'}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-6 pt-1">
          {/* File Card Preview */}
          <div className="flex items-start gap-4 p-4 rounded-2xl bg-[#F8F8FA] border border-black/[0.06] shadow-2xs">
            <div className="w-11 h-11 rounded-xl bg-white border border-black/[0.08] flex items-center justify-center shrink-0 shadow-2xs">
              {session.selectedFormat === 'video' ? (
                <FileVideo className="w-5 h-5 text-[#0A0A0C]" />
              ) : (
                <FileAudio className="w-5 h-5 text-[#0A0A0C]" />
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <h4 className="text-sm font-display font-bold text-[#0A0A0C] truncate">
                {session.metadata.title}
              </h4>
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#7A7A82]">
                <span className="px-2 py-0.5 rounded-full bg-white border border-black/[0.08] text-[#0A0A0C] font-bold">
                  {session.selectedQuality?.label || 'Direct'}
                </span>
                <span>·</span>
                <span>{(session.selectedQuality?.container || 'mp4').toUpperCase()}</span>
                <span>·</span>
                <span>{session.selectedQuality?.fileSizeApprox || 'Dynamic'}</span>
              </div>
            </div>
          </div>

          {/* Inline Save Error Message if any */}
          {saveError && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs flex items-start gap-2.5 animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="font-semibold text-amber-900">Download couldn't be saved</p>
                <p className="text-amber-800/90 leading-relaxed">{saveError}</p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={handleSaveToDisk}
              disabled={isSaving}
              className={`w-full flex items-center justify-center gap-2 ${
                isSaving
                  ? 'bg-[#7A7A82] text-white cursor-wait'
                  : savedSuccess
                  ? 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer'
                  : session.downloadUrl
                  ? 'bg-[#0A0A0C] hover:bg-black text-white cursor-pointer'
                  : 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer'
              } py-3.5 px-5 rounded-full font-sans font-semibold text-xs tracking-wider uppercase transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-black/15`}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                  <span>Transferring File to Disk...</span>
                </>
              ) : savedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  <span>File Saved Successfully</span>
                </>
              ) : session.downloadUrl ? (
                <>
                  <Download className="w-4 h-4 text-white" />
                  <span>Save File to Disk</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  <span>File Saved Directly to Disk</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onReset}
              className="w-full flex items-center justify-center gap-2 bg-[#F4F4F6] hover:bg-[#EBEBEF] text-[#0A0A0C] border border-black/[0.06] py-3.5 px-5 rounded-full font-sans font-semibold text-xs tracking-wider uppercase transition-colors cursor-pointer"
            >
              <span>Extract Another Link</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#0A0A0C]" />
            </button>
          </div>

          {/* Optional Client-Side Media Studio (ffmpeg.wasm) */}
          {session.downloadUrl && (
            <div className="pt-2 border-t border-black/[0.06]">
              {!showStudio ? (
                <button
                  type="button"
                  onClick={() => setShowStudio(true)}
                  className="w-full py-2.5 px-4 rounded-2xl bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  <span>Open Client Media Studio (Trim / Remux / Convert in Browser)</span>
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-purple-900 flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-purple-600" />
                      Client Media Studio (ffmpeg.wasm)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowStudio(false)}
                      className="text-xs text-[#7A7A82] hover:text-[#0A0A0C]"
                    >
                      Hide Studio
                    </button>
                  </div>

                  <BrowserMediaProcessor
                    mediaSource={session.downloadUrl}
                    sourceFilename={`VIDLEO_${session.metadata.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30)}.${session.selectedQuality?.container || 'mp4'}`}
                    operation="remux"
                    targetContainer="mp4"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
