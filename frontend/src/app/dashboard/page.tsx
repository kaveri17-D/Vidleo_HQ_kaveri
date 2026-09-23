'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { DashboardSidebar } from '@/components/dashboard/Sidebar';
import { UrlDownloader } from '@/components/downloader/UrlDownloader';
import { HistoryList } from '@/components/history/HistoryList';
import { 
  Menu, 
  X, 
  ArrowLeft, 
  Zap, 
  Sparkles, 
  User, 
  CheckCircle2, 
  LogOut,
  ShieldCheck,
  Film
} from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Redirect to login if unauthenticated
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[#F6F6F8] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-[#5B4BFF] border-t-transparent animate-spin" />
          <p className="text-xs font-semibold text-[#5A5A62]">Loading Dashboard...</p>
        </div>
      </div>
    );
  }

  // Extract Google Profile Info
  const fullName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Vidleo User';
  const email = user.email || '';
  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';

  // Fallback Initials
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] flex selection:bg-[#0A0A0C] selection:text-white font-sans antialiased">
      {/* Desktop Modular Sidebar */}
      <DashboardSidebar
        isMobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main App Workspace */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-y-auto relative dot-grid-light">
        
        {/* Top App Header */}
        <header className="h-16 border-b border-black/[0.08] px-6 sm:px-8 flex items-center justify-between bg-white/90 backdrop-blur-md sticky top-0 z-30 shadow-2xs">
          <div className="flex items-center gap-3">
            {/* Mobile menu trigger */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 -ml-2 rounded-lg text-[#5A5A62] md:hidden hover:text-black"
              aria-label="Toggle mobile menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="flex items-center gap-2 text-xs font-sans">
              <a
                href="/"
                className="inline-flex items-center gap-1.5 text-[#5A5A62] hover:text-black transition-colors group font-medium"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-[#8E8E98] group-hover:text-black group-hover:-translate-x-0.5 transition-all" />
                <span className="hover:underline">Home</span>
              </a>
              <span className="text-[#C4C4CC]">/</span>
              <span className="text-[#0A0A0C] font-semibold tracking-tight">Dashboard</span>
            </div>
          </div>

          {/* User Profile Quick Header Badge */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-white border border-black/[0.08] shadow-2xs">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={fullName}
                  className="w-6 h-6 rounded-full object-cover border border-black/10"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-[#5B4BFF] text-white flex items-center justify-center font-bold text-[10px]">
                  {getInitials(fullName)}
                </div>
              )}
              <span className="text-xs font-semibold text-[#0A0A0C] truncate max-w-[130px]">
                {fullName}
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-2xs" />
            </div>

            <button
              type="button"
              onClick={() => signOut()}
              className="px-3 py-1.5 rounded-xl border border-[#E5E7EB] hover:border-red-300 hover:bg-red-50 text-xs font-semibold text-[#5A5A62] hover:text-red-600 transition-all flex items-center gap-1.5"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>

        {/* Dashboard Content Container */}
        <main className="max-w-6xl mx-auto w-full p-6 sm:p-8 space-y-8">
          
          {/* Welcome User Profile Header Card */}
          <div className="bg-gradient-to-r from-[#0B0B0F] via-[#14141E] to-[#1E1E2C] text-white rounded-[24px] p-6 sm:p-8 border border-white/10 shadow-xl relative overflow-hidden">
            <div className="absolute -top-24 -right-24 w-72 h-72 bg-[#5B4BFF]/20 rounded-full blur-3xl pointer-events-none" />

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative z-10">
              <div className="flex items-center gap-4">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={fullName}
                    className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border-2 border-white/20 shadow-lg"
                  />
                ) : (
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-tr from-[#5B4BFF] to-[#388BFD] text-white flex items-center justify-center text-xl font-extrabold shadow-lg border border-white/20">
                    {getInitials(fullName)}
                  </div>
                )}

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white font-display">
                      {fullName}
                    </h1>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[10px] font-mono font-bold uppercase tracking-wider">
                      Google Verified
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-white/70 font-sans">
                    {email}
                  </p>
                  <p className="text-[11px] font-mono text-white/40 pt-1">
                    User ID: {user.id.substring(0, 18)}...
                  </p>
                </div>
              </div>

              {/* Status Pills */}
              <div className="flex items-center gap-3">
                <div className="px-4 py-2 rounded-2xl bg-white/10 border border-white/10 text-center">
                  <span className="block text-[10px] font-mono text-white/50 uppercase tracking-wider">Engine</span>
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 justify-center mt-0.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Active
                  </span>
                </div>
                <div className="px-4 py-2 rounded-2xl bg-white/10 border border-white/10 text-center">
                  <span className="block text-[10px] font-mono text-white/50 uppercase tracking-wider">Plan</span>
                  <span className="text-xs font-bold text-white flex items-center gap-1 justify-center mt-0.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Pro Unlocked
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Downloader Card */}
          <div className="bg-white border border-black/[0.08] rounded-[24px] p-6 sm:p-8 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Film className="w-5 h-5 text-[#5B4BFF]" />
                <h2 className="text-lg font-bold text-[#0A0A0C] font-display tracking-tight">
                  New Video Extraction
                </h2>
              </div>
              <span className="text-xs font-semibold text-[#5A5A62]">
                Supports 1000+ Platforms
              </span>
            </div>
            <UrlDownloader variant="light" />
          </div>

          {/* History Section */}
          <div className="bg-white border border-black/[0.08] rounded-[24px] p-6 sm:p-8 shadow-sm">
            <HistoryList />
          </div>

        </main>
      </div>
    </div>
  );
}
