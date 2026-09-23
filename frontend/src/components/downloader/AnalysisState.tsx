'use client';

import React from 'react';
import { Loader2, Check } from 'lucide-react';
import { AnalysisStateData } from '@/services/downloader/types';

interface AnalysisStateProps {
  state: AnalysisStateData;
  onCancel?: () => void;
}

interface StepItem {
  id: string;
  label: string;
  sublabel: string;
}

const STEPS: StepItem[] = [
  {
    id: 'analyzing_source',
    label: 'ANALYZING SOURCE',
    sublabel: 'Resolving endpoint manifest & security handshake',
  },
  {
    id: 'detecting_streams',
    label: 'DETECTING STREAMS',
    sublabel: 'Probing raw video feeds & codec containers',
  },
  {
    id: 'video_found',
    label: 'VIDEO FOUND',
    sublabel: '4K UHD, 1080p 60fps & adaptive resolutions ready',
  },
  {
    id: 'audio_found',
    label: 'AUDIO FOUND',
    sublabel: '320kbps studio MP3 & lossless AAC stems parsed',
  },
  {
    id: 'quality_verified',
    label: 'QUALITY VERIFIED',
    sublabel: 'Assembling uncompressed direct CDN payload',
  },
];

export function AnalysisState({ state, onCancel }: AnalysisStateProps) {
  const currentProgress = state.progress || 0;

  const getStepStatus = (index: number) => {
    const threshold = (index + 1) * 20;
    if (currentProgress >= threshold) return 'completed';
    if (currentProgress >= index * 20) return 'active';
    return 'pending';
  };

  return (
    <div className="w-full bg-white border border-black/[0.12] rounded-[28px] p-6 sm:p-7 space-y-6 shadow-[0_16px_45px_rgba(0,0,0,0.08)] relative overflow-hidden animate-in fade-in duration-150 text-[#0A0A0C]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#0A0A0C] text-white flex items-center justify-center shadow-xs">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
          <div>
            <h3 className="font-display font-[800] text-sm tracking-tight text-[#0A0A0C]">
              Processing Stream Manifest
            </h3>
            <p className="text-xs text-[#7A7A82] font-mono">{state.message || 'Connecting to CDN...'}</p>
          </div>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-[#7A7A82] hover:text-[#0A0A0C] font-sans font-medium px-3.5 py-1.5 rounded-full hover:bg-black/[0.05] transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Progress line */}
      <div className="w-full bg-[#EBEBEF] rounded-full h-1.5 overflow-hidden">
        <div
          className="bg-[#0A0A0C] h-full transition-all duration-300 ease-out"
          style={{ width: `${Math.max(5, currentProgress)}%` }}
        />
      </div>

      {/* Step Sequence */}
      <div className="space-y-2 pt-1">
        {STEPS.map((step, idx) => {
          const status = getStepStatus(idx);

          return (
            <div
              key={step.id}
              className={`flex items-center justify-between p-3 rounded-2xl border transition-all duration-200 ${
                status === 'completed'
                  ? 'bg-[#F8FAF6] border-emerald-200 text-[#0A0A0C]'
                  : status === 'active'
                  ? 'bg-white border-black/[0.2] shadow-2xs text-[#0A0A0C]'
                  : 'bg-[#FAFAFB] border-black/[0.04] text-[#A0A0AA]'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
                    status === 'completed'
                      ? 'bg-emerald-600 text-white'
                      : status === 'active'
                      ? 'bg-[#0A0A0C] text-white'
                      : 'bg-[#E5E5EB] text-[#8E8E98]'
                  }`}
                >
                  {status === 'completed' ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>

                <div className="min-w-0">
                  <span
                    className={`text-xs font-mono font-bold block truncate tracking-wide ${
                      status === 'completed' || status === 'active'
                        ? 'text-[#0A0A0C]'
                        : 'text-[#8E8E98]'
                    }`}
                  >
                    {step.label}
                  </span>
                  <span className="text-[11px] text-[#7A7A82] block truncate font-sans">
                    {step.sublabel}
                  </span>
                </div>
              </div>

              <div className="text-right shrink-0 pl-2">
                {status === 'completed' && (
                  <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md">
                    DONE
                  </span>
                )}
                {status === 'active' && (
                  <span className="text-[10px] font-mono font-bold text-white bg-[#0A0A0C] px-2 py-0.5 rounded-md animate-pulse">
                    PROBING...
                  </span>
                )}
                {status === 'pending' && (
                  <span className="text-[10px] font-mono text-[#A0A0AA]">
                    QUEUED
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
