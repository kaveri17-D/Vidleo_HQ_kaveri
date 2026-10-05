'use client';

import React, { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, 
  Users, 
  Film, 
  Download, 
  KeyRound,
  Globe,
  Activity,
  BarChart3,
  FileText, 
  Settings, 
  ShieldCheck,
  ClipboardList,
  LogOut, 
  ChevronLeft, 
  ChevronRight, 
  X,
  Menu,
  Sparkles
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { VidleoLogo, VidleoSymbol } from '@/components/brand/VidleoLogo';
import { cn } from '@/lib/utils';

export interface AdminNavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { label: 'Overview', href: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Users', href: '/admin/dashboard/users', icon: Users },
  { label: 'Downloads', href: '/admin/dashboard/downloads', icon: Download },
  { label: 'Jobs', href: '/admin/dashboard/jobs', icon: Film },
  { label: 'Platforms', href: '/admin/platforms', icon: Globe },
  { label: 'System', href: '/admin/system', icon: Activity },
  { label: 'Security', href: '/admin/security', icon: ShieldCheck },
  { label: 'Settings', href: '/admin/settings', icon: Settings },
  { label: 'Audit Logs', href: '/admin/audit-logs', icon: ClipboardList },
];

interface AdminSidebarProps {
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function AdminSidebar({ isMobileOpen = false, onCloseMobile }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleAdminLogout = async () => {
    await signOut();
    router.push('/admin/login');
  };

  const adminEmail = user?.email || 'admin@vidleo.com';
  const adminName = user?.user_metadata?.full_name || 'Vidleo Admin';

  const sidebarContent = (
    <div className="flex flex-col justify-between h-full p-4 relative z-10 text-white font-sans">
      
      {/* 1. BRAND & LOGO */}
      <div className="space-y-6">
        <div className={cn(
          "flex items-center justify-between pt-1 px-1",
          isCollapsed && "flex-col gap-4"
        )}>
          <a href="/admin/dashboard" className="inline-flex items-center gap-2">
            {isCollapsed ? (
              <VidleoSymbol size={28} />
            ) : (
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <VidleoLogo size="sm" isLight={false} />
                  <span className="px-1.5 py-0.2 rounded bg-[#5B4BFF]/20 text-[#5B4BFF] border border-[#5B4BFF]/40 text-[9px] font-mono font-bold uppercase tracking-wider">
                    Admin
                  </span>
                </div>
                <span className="text-[9.5px] font-mono tracking-wider text-white/50 uppercase mt-1 font-semibold">
                  Admin Control Center
                </span>
              </div>
            )}
          </a>

          {/* Desktop Collapse Toggle */}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden md:flex w-7 h-7 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white/70 hover:text-white items-center justify-center transition-all cursor-pointer shadow-sm active:scale-95"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          {/* Mobile Close */}
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="md:hidden w-8 h-8 rounded-xl bg-white/10 text-white flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 2. NAVIGATION LIST */}
        <div className="space-y-1.5">
          {!isCollapsed && (
            <p className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-white/40 px-3 mb-2">
              Management
            </p>
          )}

          {ADMIN_NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/admin/dashboard' && pathname.startsWith(item.href));
            const Icon = item.icon;

            return (
              <a
                key={item.label}
                href={item.href}
                onClick={() => onCloseMobile?.()}
                className={cn(
                  "relative flex items-center h-11 rounded-2xl transition-all duration-150 cursor-pointer select-none",
                  isCollapsed ? "justify-center px-0 w-11 mx-auto" : "px-3.5 w-full gap-3",
                  isActive
                    ? "bg-[#5B4BFF] text-white shadow-lg shadow-[#5B4BFF]/30 font-semibold"
                    : "text-white/65 hover:text-white hover:bg-white/[0.06]"
                )}
              >
                <Icon className={cn("w-4 h-4 shrink-0", isActive ? "stroke-[2.5]" : "stroke-[2]")} />

                {!isCollapsed && (
                  <span className="text-[13.5px] tracking-tight truncate">
                    {item.label}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </div>

      {/* 3. BOTTOM ADMIN PROFILE & LOGOUT */}
      <div className="pt-4 border-t border-white/[0.08] space-y-2">
        {/* Admin Card */}
        <div className={cn(
          "rounded-2xl bg-white/[0.05] border border-white/10 p-2.5 flex items-center gap-3",
          isCollapsed && "justify-center p-2"
        )}>
          <div className="w-8 h-8 rounded-xl bg-[#5B4BFF] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-md">
            <ShieldCheck className="w-4 h-4" />
          </div>

          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <span className="text-xs font-bold text-white block truncate leading-tight">
                {adminName}
              </span>
              <span className="text-[10px] font-mono text-white/50 block truncate leading-tight mt-0.5">
                {adminEmail}
              </span>
            </div>
          )}
        </div>

        {/* Admin Logout */}
        <button
          type="button"
          onClick={handleAdminLogout}
          className={cn(
            "w-full flex items-center rounded-xl text-white/50 hover:text-red-400 hover:bg-white/[0.06] transition-all py-2 text-left cursor-pointer",
            isCollapsed ? "justify-center px-0" : "px-3 gap-2.5"
          )}
          title="Log Out of Admin Portal"
        >
          <LogOut className="w-4 h-4 text-white/40 group-hover:text-red-400 transition-colors" />
          {!isCollapsed && (
            <span className="text-xs font-medium tracking-tight">
              Sign Out
            </span>
          )}
        </button>
      </div>

    </div>
  );

  return (
    <>
      {/* DESKTOP SIDEBAR */}
      <aside
        className={cn(
          "hidden md:flex flex-col shrink-0 sticky top-0 h-screen overflow-y-auto z-40 transition-all duration-300 ease-out select-none",
          "bg-[#0E0E14] border-r border-white/[0.08] shadow-2xl",
          isCollapsed ? "w-[76px]" : "w-[250px]"
        )}
      >
        {sidebarContent}
      </aside>

      {/* MOBILE DRAWER */}
      <AnimatePresence>
        {isMobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onCloseMobile}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 md:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 240 }}
              className="fixed top-0 bottom-0 left-0 w-[270px] bg-[#0E0E14] border-r border-white/10 z-50 md:hidden flex flex-col shadow-2xl"
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
