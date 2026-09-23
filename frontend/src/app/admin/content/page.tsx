'use client';

import React, { useState } from 'react';
import { FileText, ToggleLeft, ToggleRight, Sparkles, Megaphone, ShieldAlert, Save } from 'lucide-react';

export default function AdminContentPage() {
  const [flags, setFlags] = useState({
    enable4KDownloads: true,
    enableBatchPlaylist: true,
    enableAudioExtractor: true,
    maintenanceNotice: false,
  });

  const [announcement, setAnnouncement] = useState('Vidleo v2.0 extraction engine is online with 4K support.');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const toggleFlag = (key: keyof typeof flags) => {
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = () => {
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="space-y-6 text-white font-sans max-w-4xl">
      
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
            Content & Feature Control
          </h1>
          <p className="text-xs text-white/60 pt-1">
            Toggle platform features, site announcements, and system notices dynamically.
          </p>
        </div>

        <button
          onClick={handleSave}
          className="px-4 py-2 rounded-xl bg-[#5B4BFF] hover:bg-[#4B3BFF] text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-[#5B4BFF]/30 transition-all cursor-pointer"
        >
          <Save className="w-4 h-4" />
          <span>Save Changes</span>
        </button>
      </div>

      {savedSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          <span>Content configurations saved successfully.</span>
        </div>
      )}

      {/* Feature Flags Card */}
      <div className="p-6 rounded-2xl bg-[#12121A] border border-white/10 space-y-6">
        <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-white/70">
          Global Feature Toggles
        </h2>

        <div className="space-y-4 divide-y divide-white/[0.06]">
          <div className="pt-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">4K Video Extraction (2160p)</p>
              <p className="text-xs text-white/50">Allow high-bandwidth 4K video downloads for YouTube and Vimeo.</p>
            </div>
            <button
              type="button"
              onClick={() => toggleFlag('enable4KDownloads')}
              className="text-[#5B4BFF] cursor-pointer"
            >
              {flags.enable4KDownloads ? (
                <ToggleRight className="w-8 h-8 text-[#5B4BFF]" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-white/30" />
              )}
            </button>
          </div>

          <div className="pt-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Batch Playlist Downloader</p>
              <p className="text-xs text-white/50">Enable bulk downloading for full channel playlists.</p>
            </div>
            <button
              type="button"
              onClick={() => toggleFlag('enableBatchPlaylist')}
              className="text-[#5B4BFF] cursor-pointer"
            >
              {flags.enableBatchPlaylist ? (
                <ToggleRight className="w-8 h-8 text-[#5B4BFF]" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-white/30" />
              )}
            </button>
          </div>

          <div className="pt-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">MP3 Audio Converter</p>
              <p className="text-xs text-white/50">Allow direct audio extraction to MP3 320kbps format.</p>
            </div>
            <button
              type="button"
              onClick={() => toggleFlag('enableAudioExtractor')}
              className="text-[#5B4BFF] cursor-pointer"
            >
              {flags.enableAudioExtractor ? (
                <ToggleRight className="w-8 h-8 text-[#5B4BFF]" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-white/30" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Homepage Announcement Banner Card */}
      <div className="p-6 rounded-2xl bg-[#12121A] border border-white/10 space-y-4">
        <div className="flex items-center gap-2 text-white">
          <Megaphone className="w-4 h-4 text-[#5B4BFF]" />
          <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-white/70">
            System Banner Announcement
          </h2>
        </div>

        <input
          type="text"
          value={announcement}
          onChange={(e) => setAnnouncement(e.target.value)}
          className="w-full h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white text-xs focus:outline-none focus:border-[#5B4BFF]"
        />
        <p className="text-[11px] text-white/50">
          This message appears as an eyebrow badge on the Vidleo homepage.
        </p>
      </div>

    </div>
  );
}
