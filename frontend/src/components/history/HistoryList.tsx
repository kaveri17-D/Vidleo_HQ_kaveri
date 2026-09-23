'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { HistoryItem } from '@/services/downloader/types';
import { StorageService } from '@/services/downloader/storageService';
import { 
  Search, 
  Trash2, 
  ArrowRight, 
  Inbox, 
  Download,
  Video,
  Music,
  Film,
  FileText,
  HardDrive,
  Play
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface HistoryListProps {
  onReDownloadSelect?: (url: string) => void;
  limit?: number;
  compact?: boolean;
}

export function HistoryList({
  onReDownloadSelect,
  limit,
  compact = false,
}: HistoryListProps) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [reDownloadingId, setReDownloadingId] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    setItems(StorageService.getHistory());
  }, []);

  useEffect(() => {
    loadHistory();

    const handleHistoryUpdate = () => {
      loadHistory();
    };

    window.addEventListener('vidleo:history-updated', handleHistoryUpdate);
    window.addEventListener('storage', handleHistoryUpdate);

    return () => {
      window.removeEventListener('vidleo:history-updated', handleHistoryUpdate);
      window.removeEventListener('storage', handleHistoryUpdate);
    };
  }, [loadHistory]);

  const handleDelete = (id: string) => {
    StorageService.removeHistoryItem(id);
    loadHistory();
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to clear your entire local download history?')) {
      StorageService.clearHistory();
      loadHistory();
    }
  };

  const handleDownloadAgain = (item: HistoryItem) => {
    setReDownloadingId(item.id);
    
    const dummyBlobContent = `VIDLEO_EXTRACTED_MEDIA: ${item.title} - ${item.qualityLabel}`;
    const blob = new Blob([dummyBlobContent], {
      type: item.format === 'video' ? 'video/mp4' : 'audio/mpeg',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ext = item.container || (item.format === 'video' ? 'mp4' : 'mp3');
    const sanitizedTitle = item.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    a.download = `VIDLEO_${sanitizedTitle}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
      setReDownloadingId(null);
    }, 1200);

    if (onReDownloadSelect) {
      onReDownloadSelect(item.url);
    }
  };

  const renderPlatformBadge = (platform: string) => {
    switch (platform.toLowerCase()) {
      case 'youtube':
        return (
          <div className="w-6 h-6 rounded-lg bg-[#FF0000] flex items-center justify-center text-white shadow-xs">
            <Play className="w-3 h-3 fill-white translate-x-[0.5px]" />
          </div>
        );
      case 'x':
      case 'twitter':
        return (
          <div className="w-6 h-6 rounded-lg bg-[#0A0A0C] border border-black flex items-center justify-center text-white font-mono font-bold text-[10px] shadow-xs">
            𝕏
          </div>
        );
      case 'soundcloud':
        return (
          <div className="w-6 h-6 rounded-lg bg-[#FF5500] flex items-center justify-center text-white shadow-xs">
            <Music className="w-3.5 h-3.5" />
          </div>
        );
      case 'instagram':
        return (
          <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-[#FD1D1D] to-[#833AB4] flex items-center justify-center text-white shadow-xs">
            <Film className="w-3.5 h-3.5" />
          </div>
        );
      case 'vimeo':
        return (
          <div className="w-6 h-6 rounded-lg bg-[#1AB7EA] flex items-center justify-center text-white shadow-xs">
            <Video className="w-3.5 h-3.5" />
          </div>
        );
      default:
        return (
          <div className="w-6 h-6 rounded-lg bg-[#0A0A0C] flex items-center justify-center text-white shadow-xs">
            <Video className="w-3.5 h-3.5" />
          </div>
        );
    }
  };

  const filteredItems = items
    .filter((item) => {
      const matchSearch =
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.authorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.platformName.toLowerCase().includes(searchQuery.toLowerCase());

      const matchPlatform =
        platformFilter === 'all' || item.platform.toLowerCase() === platformFilter.toLowerCase();

      const matchFormat =
        formatFilter === 'all' || item.format.toLowerCase() === formatFilter.toLowerCase();

      return matchSearch && matchPlatform && matchFormat;
    })
    .slice(0, limit || items.length);

  return (
    <div className="space-y-6 text-[#0A0A0C]">
      {/* Search & Filter Header (if not compact) */}
      {!compact && (
        <div className="space-y-3 pb-1">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#8E8E98] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search download archive by title, creator, platform..."
                className="w-full bg-white border border-black/[0.1] focus:border-black rounded-2xl pl-10 pr-4 py-2.5 text-xs text-[#0A0A0C] placeholder:text-[#8E8E98] focus:outline-none font-sans shadow-2xs transition-all"
              />
            </div>

            {/* Clear All action */}
            {items.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-2xl bg-white border border-black/[0.08] hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-[#7A7A82] text-xs font-mono transition-colors shrink-0 cursor-pointer shadow-2xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Archive</span>
              </button>
            )}
          </div>

          {/* Filter Chips */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[11px] font-mono text-[#8E8E98] mr-1">PLATFORM:</span>
            {['all', 'youtube', 'instagram', 'x', 'vimeo', 'soundcloud'].map((plat) => (
              <button
                key={plat}
                type="button"
                onClick={() => setPlatformFilter(plat)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-mono transition-all uppercase cursor-pointer',
                  platformFilter === plat
                    ? 'bg-[#0A0A0C] text-white font-bold shadow-2xs'
                    : 'bg-white border border-black/[0.06] text-[#5A5A62] hover:text-black hover:border-black/[0.18]'
                )}
              >
                {plat === 'all' ? 'All Sites' : plat}
              </button>
            ))}

            <span className="text-[#C4C4CC] mx-1">|</span>

            {['all', 'video', 'audio'].map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setFormatFilter(fmt)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-mono transition-all uppercase cursor-pointer',
                  formatFilter === fmt
                    ? 'bg-[#0A0A0C] text-white font-bold shadow-2xs'
                    : 'bg-white border border-black/[0.06] text-[#5A5A62] hover:text-black hover:border-black/[0.18]'
                )}
              >
                {fmt === 'all' ? 'All Types' : fmt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Item Grid */}
      {filteredItems.length === 0 ? (
        <div className="modular-card-light p-8 sm:p-12 rounded-[28px] text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-[#F4F4F6] border border-black/[0.06] flex items-center justify-center mx-auto text-[#7A7A82]">
            <Inbox className="w-5 h-5" />
          </div>
          <h4 className="font-display font-bold text-sm text-[#0A0A0C] tracking-tight">
            {items.length === 0 ? 'No extractions yet.' : 'No Matching Downloads'}
          </h4>
          <p className="text-xs text-[#7A7A82] max-w-sm mx-auto font-sans leading-relaxed">
            {items.length === 0
              ? 'Your analyzed videos will appear here.'
              : 'Try clearing your search query or switching your platform filters.'}
          </p>
          {items.length === 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  const input = document.querySelector('input[type="url"], input[type="text"]') as HTMLInputElement;
                  if (input) {
                    input.focus();
                    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }}
                className="inline-flex items-center gap-1.5 text-xs font-sans font-semibold text-[#0A0A0C] hover:underline transition-colors cursor-pointer group"
              >
                <span>Start a new extraction</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#0A0A0C] group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="modular-card-light p-4 sm:p-5 rounded-[26px] hover:-translate-y-1 transition-all duration-200 flex flex-col justify-between space-y-4 group"
            >
              {/* Top: Thumbnail with duration badge */}
              <div className="relative w-full aspect-[16/10] overflow-hidden rounded-[20px] bg-black shrink-0 border border-black/[0.08]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.thumbnailUrl}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                />

                {item.durationFormatted && (
                  <div className="absolute top-2.5 right-2.5 px-2.5 py-0.5 rounded-full bg-black/80 backdrop-blur-md text-white font-mono text-[10px] font-bold shadow-xs z-20">
                    {item.durationFormatted}
                  </div>
                )}

                <div className="absolute bottom-2.5 left-2.5 z-20 flex items-center">
                  {renderPlatformBadge(item.platform)}
                </div>
              </div>

              {/* Middle: Content & Metadata */}
              <div className="space-y-1.5 min-w-0 flex-1">
                <h4 
                  className="font-display font-bold text-[15px] sm:text-[16px] text-[#0A0A0C] tracking-tight leading-snug truncate" 
                  title={item.title}
                >
                  {item.title}
                </h4>
                <p className="text-xs text-[#7A7A82] font-sans truncate">
                  {item.subtitle || `${item.platformName} ${item.format === 'video' ? 'Stream' : 'Audio'}`}
                </p>

                {/* Technical Specs Row */}
                <div className="flex flex-wrap items-center gap-3 text-xs font-sans text-[#5A5A62] font-medium pt-1">
                  <span className="flex items-center gap-1.5">
                    {item.format === 'video' ? (
                      <Video className="w-3.5 h-3.5 text-[#8E8E98]" />
                    ) : (
                      <Music className="w-3.5 h-3.5 text-[#8E8E98]" />
                    )}
                    <span>{item.qualityLabel}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#8E8E98]" />
                    <span>{item.container?.toUpperCase() || (item.format === 'video' ? 'MP4' : 'MP3')}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-[#8E8E98]" />
                    <span>{item.fileSizeApprox}</span>
                  </span>
                </div>

                {/* Author and Date Row */}
                <div className="flex items-center gap-2 pt-2 border-t border-black/[0.06]">
                  <div className="relative w-5.5 h-5.5 rounded-full overflow-hidden border border-black/[0.1] shrink-0 bg-[#0A0A0C] flex items-center justify-center">
                    {item.authorAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.authorAvatarUrl}
                        alt={item.authorName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[10px] font-bold text-white uppercase">
                        {item.authorName?.charAt(0) || 'V'}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-semibold text-[#3A3A42] truncate">
                    {item.authorName}
                  </span>
                  <span className="text-[#C4C4CC]">·</span>
                  <span className="text-xs text-[#8E8E98] shrink-0">
                    {formatRelativeTime(item.createdAt)}
                  </span>
                </div>
              </div>

              {/* Bottom: Action Buttons */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleDownloadAgain(item)}
                  disabled={reDownloadingId === item.id}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-[#0A0A0C] hover:bg-black text-white py-2.5 px-4 rounded-full font-sans font-bold text-xs tracking-wide transition-all transform hover:scale-[1.01] active:scale-[0.99] shadow-xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-white" />
                  <span>{reDownloadingId === item.id ? 'Saving...' : 'Download'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  className="w-9 h-9 rounded-full bg-[#F4F4F6] hover:bg-red-50 hover:text-red-600 text-[#7A7A82] flex items-center justify-center transition-colors shrink-0 cursor-pointer border border-black/[0.06]"
                  title="Delete from history"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
