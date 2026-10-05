'use client';

import React from 'react';
import { DownloadSession } from '@/services/downloader/types';
import { 
  CheckCircle2, 
  Download, 
  RotateCcw, 
  FileVideo, 
  FileAudio, 
  ArrowDownToLine, 
  ArrowRight
} from 'lucide-react';
import { formatBytes } from '@/lib/utils';

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

  const handleSaveToDisk = () => {
    if (!session.downloadUrl) {
      alert('The file was saved directly to your chosen folder during extraction.');
      return;
    }
    const a = document.createElement('a');
    a.href = session.downloadUrl;
    const ext = session.selectedQuality.container;
    const sanitizedTitle = session.metadata.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    a.download = `VIDLEO_${sanitizedTitle}_${session.selectedQuality.label}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
            <p className="text-xs text-[#7A7A82] font-mono">
              {session.status === 'converting'
                ? 'Muxing video & audio codec layers...'
                : session.status === 'downloading'
                ? `Transmitting stream (${session.progress}%)`
                : 'Asset verified and ready for disk storage'}
            </p>
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
              {formatBytes(session.downloadedBytes)} / {session.selectedQuality.fileSizeApprox}
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
                  {session.selectedQuality.label}
                </span>
                <span>·</span>
                <span>{session.selectedQuality.container.toUpperCase()}</span>
                <span>·</span>
                <span>{session.selectedQuality.fileSizeApprox}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={handleSaveToDisk}
              className={`w-full flex items-center justify-center gap-2 ${
                session.downloadUrl
                  ? 'bg-[#0A0A0C] hover:bg-black text-white'
                  : 'bg-emerald-700 hover:bg-emerald-800 text-white'
              } py-3.5 px-5 rounded-full font-sans font-semibold text-xs tracking-wider uppercase transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-black/15 cursor-pointer`}
            >
              {session.downloadUrl ? (
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
        </div>
      )}
    </div>
  );
}
