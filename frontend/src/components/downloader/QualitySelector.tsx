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
      <div className="flex items-center justify-between text-xs text-[#7A7A82] font-mono px-1">
        <span className={cn(isSourceUnresolved ? "text-amber-800 font-semibold flex items-center gap-1.5" : "")}>
          {isSourceUnresolved ? 'Metadata format — direct media source unresolved' : 'Available Codec Streams'}
        </span>
        <span>{isSourceUnresolved ? 'Catalog Size' : 'Est. Size'}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {options.map((opt) => {
          const isSelected = selectedOption?.id === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt)}
              className={cn(
                'group relative flex items-center justify-between p-3.5 rounded-2xl border text-left transition-all duration-150 cursor-pointer',
                isSelected
                  ? 'bg-white border-[#0A0A0C] text-[#0A0A0C] shadow-sm ring-1 ring-[#0A0A0C] -translate-y-0.5'
                  : 'bg-[#F8F8FA] hover:bg-white border-black/[0.06] hover:border-black/[0.18] text-[#3A3A42]'
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
                  <div className="flex items-center gap-1.5">
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
                    {isSourceUnresolved && (
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold border border-amber-200">
                        METADATA ONLY
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
                {isSourceUnresolved && (
                  <p className="text-[9.5px] font-mono text-[#7A7A82]">
                    Catalog est.
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
