'use client';

import React from 'react';
import { DashboardSidebar } from '@/components/dashboard/Sidebar';
import { UrlDownloader } from '@/components/downloader/UrlDownloader';
import { HistoryList } from '@/components/history/HistoryList';
import { 
  Menu,
  X,
  ArrowRight,
  ArrowLeft,
  Zap,
  Film,
  Music
} from 'lucide-react';
import { VidleoLogo } from '@/components/brand/VidleoLogo';

export default function DownloadDashboardPage() {
  const [mobileMenu, setMobileMenu] = React.useState(false);

  return (
    <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] flex selection:bg-[#0A0A0C] selection:text-white font-sans antialiased">
      {/* Desktop Modular Sidebar */}
      <DashboardSidebar />

      {/* Main App Workspace */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-y-auto relative dot-grid-light">
        
        {/* Top App Header */}
        <header className="h-16 border-b border-black/[0.08] px-6 sm:px-8 flex items-center justify-between bg-white/90 backdrop-blur-md sticky top-0 z-30 shadow-2xs">
          <div className="flex items-center gap-3">
            {/* Mobile menu trigger */}
            <button
              type="button"
              onClick={() => setMobileMenu(!mobileMenu)}
              className="p-2 -ml-2 rounded-lg text-[#5A5A62] md:hidden hover:text-black"
              aria-label="Toggle mobile menu"
            >
              {mobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="flex items-center gap-2 text-xs font-sans">
              <a
                href="/"
                className="inline-flex items-center gap-1.5 text-[#5A5A62] hover:text-black transition-colors group font-medium"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-[#8E8E98] group-hover:text-black group-hover:-translate-x-0.5 transition-all" />
                <span className="hover:underline">Landing Page</span>
              </a>
              <span className="text-[#C4C4CC]">/</span>
              <span className="text-[#0A0A0C] font-semibold tracking-tight">New Extraction</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-mono text-emerald-800 font-bold shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Engine Online</span>
            </span>

            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-[#0A0A0C] px-3.5 py-1.5 rounded-full bg-[#F4F4F6] border border-black/[0.06] hover:bg-[#EBEBEF] transition-all font-sans font-semibold shadow-2xs group"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-[#8E8E98] group-hover:-translate-x-0.5 transition-transform" />
              <span>Exit to Home</span>
            </a>
          </div>
        </header>

        {/* Mobile menu drawer */}
        {mobileMenu && (
          <div className="md:hidden bg-white border-b border-black/[0.08] p-5 space-y-3 animate-in fade-in shadow-2xl relative z-40 text-[#0A0A0C]">
            <div className="pb-3 border-b border-black/[0.06] flex items-center justify-between">
              <VidleoLogo size="sm" showSublabel={true} isLight={true} />
              <button
                type="button"
                onClick={() => setMobileMenu(false)}
                className="p-1.5 rounded-lg text-[#8E8E98] hover:text-black"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1 pt-1 text-xs">
              <a href="/download" className="block px-3 py-2 font-bold text-white bg-[#0A0A0C] rounded-xl">
                New Download
              </a>
              <a href="/history" className="block px-3 py-2 text-[#5A5A62] hover:text-black font-medium">
                History Archive
              </a>
              <a href="/supported-sites" className="block px-3 py-2 text-[#5A5A62] hover:text-black font-medium">
                Supported Sites
              </a>
              <a href="/#faq" className="block px-3 py-2 text-[#5A5A62] hover:text-black font-medium">
                FAQ & Help
              </a>
              <a href="/" className="flex items-center gap-1.5 px-3 py-2 text-[#5A5A62] hover:text-black font-medium">
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Landing Page</span>
              </a>
            </div>
          </div>
        )}

        {/* Workspace Content */}
        <main className="flex-1 p-6 sm:p-8 lg:p-10 w-full space-y-8 relative z-10">
          
          {/* Header Description */}
          <div className="space-y-2 pt-1 text-left">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white border border-black/[0.08] shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-[#0A0A0C]" />
              <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-[#5A5A62]">
                MEDIA EXTRACTION WORKSPACE
              </span>
            </div>

            <h1 className="font-display font-[850] text-3xl sm:text-5xl text-[#0A0A0C] tracking-[-0.035em] leading-[0.98]">
              New Media<br />
              <span className="font-serif italic font-normal text-[#5A5A62]">Extraction.</span>
            </h1>
            <p className="text-xs sm:text-[14.5px] text-[#5A5A62] max-w-xl font-sans font-normal leading-relaxed pt-1">
              Direct ingestion and decoding engine. Paste any supported URL below to probe and extract uncompressed video or audio streams.
            </p>
          </div>

          {/* 3 Modular Capability Status Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="modular-card-light p-4 rounded-2xl flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#0A0A0C] text-white flex items-center justify-center shrink-0 shadow-2xs">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <span className="font-display font-bold text-xs text-[#0A0A0C] block">
                  Uncapped 10Gbps
                </span>
                <span className="text-[10px] font-mono text-[#7A7A82] block">
                  Direct CDN Pipeline
                </span>
              </div>
            </div>

            <div className="modular-card-light p-4 rounded-2xl flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                <Film className="w-4 h-4" />
              </div>
              <div>
                <span className="font-display font-bold text-xs text-[#0A0A0C] block">
                  4K Ultra HD 60fps
                </span>
                <span className="text-[10px] font-mono text-[#7A7A82] block">
                  AV1 / VP9 / H.264
                </span>
              </div>
            </div>

            <div className="modular-card-light p-4 rounded-2xl flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                <Music className="w-4 h-4" />
              </div>
              <div>
                <span className="font-display font-bold text-xs text-[#0A0A0C] block">
                  320kbps Lossless
                </span>
                <span className="text-[10px] font-mono text-[#7A7A82] block">
                  Studio MP3 & AAC
                </span>
              </div>
            </div>
          </div>

          {/* Primary Downloader Box */}
          <div className="w-full">
            <UrlDownloader />
          </div>

          {/* Real Download History Section */}
          <div className="pt-6 border-t border-black/[0.08] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-display font-bold text-[#0A0A0C] tracking-tight">
                  Recent Extractions
                </h2>
                <p className="text-xs text-[#7A7A82] font-sans">
                  Local browser session history. Real downloads saved to your storage.
                </p>
              </div>

              <a
                href="/history"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#0A0A0C] hover:underline"
              >
                <span>View Full Archive</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* Live History component displaying real data only */}
            <HistoryList limit={4} />
          </div>

        </main>
      </div>
    </div>
  );
}
