'use client';

import React, { useState } from 'react';
import { 
  VideoMetadata, 
  QualityOption, 
  MediaFormatType 
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
  Music
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface VideoDetectedCardProps {
  metadata: VideoMetadata;
  onDownload: (quality: QualityOption, format: MediaFormatType) => void;
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
    if (selectedQuality) {
      onDownload(selectedQuality, activeFormat);
    }
  };

  const handleActionReset = onReset || onCancel || (() => {});

  return (
    <div className="w-full bg-white border border-black/[0.12] rounded-[28px] overflow-hidden shadow-[0_16px_45px_rgba(0,0,0,0.08)] animate-in fade-in duration-200 text-[#0A0A0C]">
      {/* Top Banner Status */}
      <div className="bg-[#F8F8FA] px-6 py-3.5 border-b border-black/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-2xs" />
          <span className="text-xs font-mono uppercase tracking-wider text-[#7A7A82] font-bold">
            STREAM DETECTED & VERIFIED
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
            <span className="text-[11px] font-mono text-emerald-700 font-semibold">
              Lossless Direct Extraction
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
        />

        {/* Primary Download Button */}
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
      </div>
    </div>
  );
}
