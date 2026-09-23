'use client';

import React from 'react';
import { DashboardSidebar } from '@/components/dashboard/Sidebar';
import { HistoryList } from '@/components/history/HistoryList';
import { 
  Menu, 
  X, 
  Download,
  ArrowLeft
} from 'lucide-react';
import { VidleoLogo } from '@/components/brand/VidleoLogo';

export default function HistoryPage() {
  const [mobileMenu, setMobileMenu] = React.useState(false);

  return (
    <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] flex selection:bg-[#0A0A0C] selection:text-white font-sans antialiased">
      {/* Desktop Modular Sidebar */}
      <DashboardSidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-y-auto relative dot-grid-light">
        
        {/* Top Header */}
        <header className="h-16 border-b border-black/[0.08] px-6 sm:px-8 flex items-center justify-between bg-white/90 backdrop-blur-md sticky top-0 z-30 shadow-2xs">
          <div className="flex items-center gap-3">
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
              <span className="text-[#0A0A0C] font-semibold tracking-tight">Extraction History</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-[#0A0A0C] px-3.5 py-1.5 rounded-full bg-[#F4F4F6] border border-black/[0.06] hover:bg-[#EBEBEF] transition-all font-sans font-semibold shadow-2xs group"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-[#8E8E98] group-hover:-translate-x-0.5 transition-transform" />
              <span>Exit to Home</span>
            </a>

            <a
              href="/download"
              className="inline-flex items-center gap-1.5 bg-[#0A0A0C] hover:bg-black text-white px-4 py-1.5 rounded-full text-xs font-bold font-sans tracking-wide uppercase transition-all shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-white" />
              <span>New Download</span>
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
              <a href="/download" className="block px-3 py-2 text-[#5A5A62] hover:text-black font-medium">
                New Download
              </a>
              <a href="/history" className="block px-3 py-2 font-bold text-white bg-[#0A0A0C] rounded-xl">
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

        {/* Main History Workspace */}
        <main className="flex-1 p-6 sm:p-8 lg:p-10 w-full space-y-8 relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-black/[0.08] pb-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white border border-black/[0.08] shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-[#0A0A0C]" />
                <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-[#5A5A62]">
                  LOCAL MEDIA REPOSITORY
                </span>
              </div>

              <h1 className="font-display font-[850] text-3xl sm:text-5xl text-[#0A0A0C] tracking-[-0.035em] leading-[0.98]">
                Download<br />
                <span className="font-serif italic font-normal text-[#5A5A62]">Archive.</span>
              </h1>
              <p className="text-xs sm:text-[14.5px] text-[#5A5A62] max-w-lg font-sans leading-relaxed">
                Review, filter, and re-download previously analyzed and saved media files stored in your local browser cache.
              </p>
            </div>
          </div>

          {/* Full History List Component */}
          <HistoryList />
        </main>
      </div>
    </div>
  );
}
