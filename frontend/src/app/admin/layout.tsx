'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Menu, ShieldCheck, Activity } from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // If on admin login page, don't show admin dashboard shell
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#0A0A0E] text-white flex font-sans antialiased selection:bg-[#5B4BFF] selection:text-white">
      {/* Admin Sidebar */}
      <AdminSidebar
        isMobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main Admin Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-y-auto relative">
        
        {/* Top Header Bar */}
        <header className="h-16 border-b border-white/[0.08] px-6 sm:px-8 flex items-center justify-between bg-[#0E0E14]/90 backdrop-blur-md sticky top-0 z-30 shadow-md">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 -ml-2 rounded-xl text-white/70 hover:text-white md:hidden hover:bg-white/10"
              aria-label="Toggle admin menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-xs font-mono text-white/60">
              <span className="text-white font-semibold">Vidleo Control Center</span>
              <span>/</span>
              <span className="text-[#5B4BFF] font-bold capitalize">
                {pathname.replace('/admin/', '').replace('/', ' ') || 'Dashboard'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-mono font-bold text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Admin Auth Active</span>
            </div>

            <div className="px-3 py-1.5 rounded-xl bg-white/[0.05] border border-white/10 text-xs font-mono text-white/80 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#5B4BFF]" />
              <span className="hidden md:inline">Server Enforced RLS</span>
            </div>
          </div>
        </header>

        {/* Content View */}
        <main className="flex-1 p-6 sm:p-8 max-w-7xl mx-auto w-full space-y-8">
          {children}
        </main>
      </div>
    </div>
  );
}
