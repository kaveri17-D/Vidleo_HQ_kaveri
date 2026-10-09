'use client';

import React from 'react';
import { QualityOption, MediaFormatType } from '@/services/downloader/types';
import { Check, Volume2, Video as VideoIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QualitySelectorProps {
  format: MediaFormatType;
  options: QualityOption[];
  selectedOption: QualityOption;
  onSelect: (option: QualityOption) => void;
  isSourceUnresolved?: boolean;
}

export function QualitySelector({
  format,
  options,
  selectedOption,
  onSelect,
  isSourceUnresolved,
}: QualitySelectorProps) {
  if (!options || options.length === 0) {
    return (
      <div className="p-4 rounded-xl bg-[#F4F4F6] border border-black/[0.06] text-xs text-[#7A7A82] text-center font-sans">
        No specific {format} qualities found for this media stream.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Explicit Architecture Separation Banner */}
      <div className="bg-[#F8F8FA] border border-black/[0.06] rounded-xl px-3 py-2 space-y-1">
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#7A7A82] overflow-x-auto whitespace-nowrap">
          <span className="font-semibold text-[#0A0A0C]">SOURCE METADATA</span>
          <span>→</span>
          <span className="font-semibold text-emerald-700">AVAILABLE MEDIA</span>
          <span>→</span>
          <span className="font-semibold text-indigo-700">SELECT QUALITY</span>
          <span>→</span>
          <span>ACQUISITION</span>
          <span>→</span>
          <span>COMPATIBLE MP4</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-[#7A7A82] font-mono">
          <span>Verified Media Streams</span>
          <span>Actual Stream Size</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {options.map((opt) => {
          const isSelected = selectedOption?.id === opt.id;
          const isActualAvailable = opt.availability === 'ACTUAL_MEDIA_AVAILABLE' || opt.availability === 'ACTUAL_MEDIA_ACQUIRABLE';
          const isMetadataOnly = opt.availability === 'METADATA_ONLY';
          const isUnavailable = opt.availability === 'UNAVAILABLE';

          return (
            <button
              key={opt.id}
              type="button"
              disabled={isUnavailable}
              onClick={() => onSelect(opt)}
              className={cn(
                'group relative flex items-center justify-between p-3.5 rounded-2xl border text-left transition-all duration-150 cursor-pointer',
                isSelected
                  ? 'bg-white border-[#0A0A0C] text-[#0A0A0C] shadow-sm ring-1 ring-[#0A0A0C] -translate-y-0.5'
                  : 'bg-[#F8F8FA] hover:bg-white border-black/[0.06] hover:border-black/[0.18] text-[#3A3A42]',
                isUnavailable && 'opacity-50 cursor-not-allowed hover:bg-[#F8F8FA] hover:border-black/[0.06]'
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-6 h-6 rounded-lg flex items-center justify-center text-xs transition-colors shrink-0',
                    isSelected
                      ? 'bg-[#0A0A0C] text-white font-bold'
                      : 'bg-white border border-black/[0.08] text-[#7A7A82] group-hover:text-black'
                  )}
                >
                  {isSelected ? (
                    <Check className="w-3.5 h-3.5 stroke-[3] text-white" />
                  ) : format === 'video' ? (
                    <VideoIcon className="w-3.5 h-3.5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-display font-bold text-[#0A0A0C] tracking-tight">
                      {opt.label}
                    </span>
                    {opt.isRecommended && (
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded-full bg-[#0A0A0C] text-white font-bold">
                        BEST
                      </span>
                    )}
                    {opt.hdr && (
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold border border-blue-200">
                        HDR
                      </span>
                    )}
                    {isActualAvailable && (
                      <span className="text-[8.5px] font-mono uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-200">
                        {opt.availability === 'ACTUAL_MEDIA_ACQUIRABLE' ? 'ACTUAL MEDIA ACQUIRABLE' : 'ACTUAL MEDIA AVAILABLE'}
                      </span>
                    )}
                    {isMetadataOnly && (
                      <span className="text-[8.5px] font-mono uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold border border-amber-200">
                        METADATA ONLY
                      </span>
                    )}
                    {isUnavailable && (
                      <span className="text-[8.5px] font-mono uppercase px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold border border-slate-200">
                        UNAVAILABLE
                      </span>
                    )}
                  </div>

                  <p className="text-[10.5px] text-[#7A7A82] font-mono pt-0.5">
                    {opt.container.toUpperCase()} {opt.fps ? `· ${opt.fps}fps` : ''} {opt.bitrate ? `· ${opt.bitrate}` : ''}
                  </p>
                </div>
              </div>

              <div className="text-right pl-2 shrink-0">
                <span className="text-xs font-mono font-semibold text-[#0A0A0C]">
                  {opt.fileSizeApprox}
                </span>
                <p className="text-[9.5px] font-mono text-[#7A7A82]">
                  {isActualAvailable ? 'Verified size' : 'Stream size'}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
