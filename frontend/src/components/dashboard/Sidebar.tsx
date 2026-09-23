'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Home, 
  Download, 
  History, 
  Globe, 
  HelpCircle, 
  ArrowUpRight, 
  ChevronLeft, 
  ChevronRight, 
  LogOut, 
  User, 
  Sparkles,
  Layers,
  X
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { VidleoLogo, VidleoSymbol } from '@/components/brand/VidleoLogo';
import { cn } from '@/lib/utils';
import { EXTERNAL_LINKS } from '@/config/links';

export interface NavItemConfig {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  accentGlow: string;
  external?: boolean;
  badge?: string;
}

const PRIMARY_NAV_ITEMS: NavItemConfig[] = [
  {
    label: 'Home',
    href: '/',
    icon: Home,
    accentColor: '#FF6B35', // Vibrant Orange
    accentGlow: 'rgba(255, 107, 53, 0.35)',
  },
  {
    label: 'New Download',
    href: '/download',
    icon: Download,
    accentColor: '#3B82F6', // Vibrant Royal Blue
    accentGlow: 'rgba(59, 130, 246, 0.35)',
  },
  {
    label: 'History',
    href: '/history',
    icon: History,
    accentColor: '#A855F7', // Vibrant Violet
    accentGlow: 'rgba(168, 85, 247, 0.35)',
  },
  {
    label: 'Supported Sites',
    href: '/supported-sites',
    icon: Globe,
    accentColor: '#06B6D4', // Vibrant Cyan / Teal
    accentGlow: 'rgba(6, 182, 212, 0.35)',
  },
];

const SECONDARY_NAV_ITEMS: NavItemConfig[] = [
  {
    label: 'ClipperX AI',
    href: EXTERNAL_LINKS.CLIPPER_X,
    icon: ArrowUpRight,
    accentColor: '#EC4899', // Pink
    accentGlow: 'rgba(236, 72, 153, 0.35)',
    external: true,
    badge: 'AI',
  },
  {
    label: 'FAQ & Help',
    href: '/#faq',
    icon: HelpCircle,
    accentColor: '#F59E0B', // Amber
    accentGlow: 'rgba(245, 158, 11, 0.35)',
  },
];

interface DashboardSidebarProps {
  className?: string;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function DashboardSidebar({
  className,
  isMobileOpen = false,
  onCloseMobile,
}: DashboardSidebarProps) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  // Restore collapsed state from localStorage if available
  useEffect(() => {
    const saved = localStorage.getItem('vidleo_sidebar_collapsed');
    if (saved !== null) {
      setIsCollapsed(saved === 'true');
    }
  }, []);

  const toggleCollapse = () => {
    const nextState = !isCollapsed;
    setIsCollapsed(nextState);
    localStorage.setItem('vidleo_sidebar_collapsed', String(nextState));
  };

  const renderNavList = (items: NavItemConfig[], sectionTitle?: string) => {
    return (
      <div className="space-y-1.5 relative">
        {sectionTitle && !isCollapsed && (
          <p className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-white/40 px-3.5 mb-2">
            {sectionTitle}
          </p>
        )}

        <div className="space-y-1.5">
          {items.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            const isHovered = hoveredItem === item.label;

            return (
              <div key={item.label} className="relative group">
                <a
                  href={item.href}
                  target={item.external ? '_blank' : undefined}
                  rel={item.external ? 'noopener noreferrer' : undefined}
                  onClick={() => onCloseMobile?.()}
                  onMouseEnter={() => setHoveredItem(item.label)}
                  onMouseLeave={() => setHoveredItem(null)}
                  className={cn(
                    "relative flex items-center h-12 rounded-[20px] transition-all duration-200 cursor-pointer select-none",
                    isCollapsed ? "justify-center px-0 w-12 mx-auto" : "px-3.5 w-full",
                    isActive
                      ? "bg-white/[0.08] text-white shadow-[0_4px_20px_rgba(0,0,0,0.4)] border border-white/[0.12]"
                      : "text-white/65 hover:text-white hover:bg-white/[0.04]"
                  )}
                  style={{
                    boxShadow: isActive ? `0 0 25px ${item.accentGlow}` : undefined,
                  }}
                >
                  {/* Left Active Glow Indicator Line */}
                  {isActive && (
                    <motion.div 
                      layoutId="activeSidePill"
                      className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full"
                      style={{ backgroundColor: item.accentColor }}
                    />
                  )}

                  {/* Icon Container with Custom Accent Circle when Active */}
                  <div
                    className={cn(
                      "flex items-center justify-center rounded-full transition-all duration-200 shrink-0",
                      isActive
                        ? "w-8 h-8 text-white shadow-md scale-105"
                        : "w-8 h-8 text-white/70 group-hover:text-white group-hover:scale-105"
                    )}
                    style={{
                      backgroundColor: isActive ? item.accentColor : isHovered ? 'rgba(255,255,255,0.06)' : 'transparent',
                      boxShadow: isActive ? `0 0 16px ${item.accentGlow}` : undefined,
                    }}
                  >
                    <Icon className={cn("w-4 h-4", isActive ? "stroke-[2.5]" : "stroke-[2]")} />
                  </div>

                  {/* Label (Hidden in collapsed mode) */}
                  {!isCollapsed && (
                    <div className="ml-3 flex items-center justify-between min-w-0 flex-1">
                      <span className={cn(
                        "font-sans text-[13.5px] tracking-tight truncate transition-colors",
                        isActive ? "font-bold text-white" : "font-medium text-white/70 group-hover:text-white"
                      )}>
                        {item.label}
                      </span>

                      {item.badge && (
                        <span 
                          className="px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold tracking-wider uppercase text-white shadow-xs"
                          style={{ backgroundColor: item.accentColor }}
                        >
                          {item.badge}
                        </span>
                      )}

                      {item.external && !item.badge && (
                        <ArrowUpRight className="w-3.5 h-3.5 text-white/40 group-hover:text-white transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      )}
                    </div>
                  )}

                  {/* Collapsed Tooltip */}
                  {isCollapsed && (
                    <div className="absolute left-full ml-3.5 px-3 py-1.5 rounded-xl bg-[#1A1A22] text-white text-xs font-medium tracking-tight shadow-xl border border-white/10 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 whitespace-nowrap z-50 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.accentColor }} />
                      <span>{item.label}</span>
                    </div>
                  )}
                </a>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col justify-between h-full p-4 relative z-10">
      
      {/* 1. TOP HEADER & BRANDING */}
      <div className="space-y-6">
        <div className={cn(
          "flex items-center justify-between pt-1 px-1",
          isCollapsed && "flex-col gap-4"
        )}>
          <a href="/" className="inline-flex items-center group">
            {isCollapsed ? (
              <VidleoSymbol size={28} />
            ) : (
              <VidleoLogo size="md" isLight={false} />
            )}
          </a>

          {/* Desktop Collapse Toggle */}
          <button
            type="button"
            onClick={toggleCollapse}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden md:flex w-7 h-7 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white/70 hover:text-white items-center justify-center transition-all cursor-pointer shadow-sm active:scale-95"
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          {/* Mobile Close Button */}
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close menu"
              className="md:hidden w-8 h-8 rounded-xl bg-white/10 text-white flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 2. PRIMARY WORKSPACE NAVIGATION */}
        {renderNavList(PRIMARY_NAV_ITEMS, 'Workspace')}

        {/* 3. DIVIDER */}
        <div className="border-t border-white/[0.08] mx-1" />

        {/* 4. SECONDARY RESOURCES NAVIGATION */}
        {renderNavList(SECONDARY_NAV_ITEMS, 'Resources')}
      </div>

      {/* 5. BOTTOM PROFILE & LOGOUT SECTION */}
      <div className="pt-4 border-t border-white/[0.08] space-y-2">
        
        {/* User Card */}
        <div className={cn(
          "rounded-2xl bg-white/[0.04] border border-white/[0.08] transition-all group cursor-default",
          isCollapsed ? "p-2 flex justify-center" : "p-2.5 flex items-center justify-between"
        )}>
          <div className="flex items-center gap-3 min-w-0">
            {/* User Avatar with gradient halo */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#FF6B35] via-[#A855F7] to-[#3B82F6] p-[1.5px] shrink-0 shadow-md">
              {user?.user_metadata?.avatar_url || user?.user_metadata?.picture ? (
                <img
                  src={user.user_metadata.avatar_url || user.user_metadata.picture}
                  alt="User Avatar"
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <div className="w-full h-full rounded-full bg-[#0E0E14] flex items-center justify-center text-white font-sans font-bold text-xs">
                  {(user?.user_metadata?.full_name || user?.email || 'V')[0].toUpperCase()}
                </div>
              )}
            </div>

            {!isCollapsed && (
              <div className="min-w-0">
                <span className="text-xs font-semibold text-white block truncate leading-tight">
                  {user?.user_metadata?.full_name || user?.user_metadata?.name || 'Vidleo User'}
                </span>
                <span className="text-[10px] font-mono text-white/50 block truncate leading-tight mt-0.5">
                  {user?.email || 'Logged In'}
                </span>
              </div>
            )}
          </div>

          {!isCollapsed && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] shrink-0" />
          )}
        </div>

        {/* Exit / Logout Link */}
        <button
          type="button"
          onClick={() => signOut()}
          className={cn(
            "w-full flex items-center rounded-xl text-white/50 hover:text-red-400 hover:bg-white/[0.06] transition-all group py-2 text-left cursor-pointer",
            isCollapsed ? "justify-center px-0" : "px-3 gap-2.5"
          )}
          title="Sign Out"
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
      {/* DESKTOP STICKY SIDEBAR */}
      <aside
        className={cn(
          "hidden md:flex flex-col shrink-0 sticky top-0 h-screen overflow-y-auto z-40 transition-all duration-300 ease-out select-none",
          "bg-[#0B0B0F]/95 backdrop-blur-2xl border-r border-white/[0.08] shadow-[4px_0_30px_rgba(0,0,0,0.5)]",
          isCollapsed ? "w-[80px]" : "w-[268px]",
          className
        )}
      >
        {/* Subtle Ambient Glow inside dark sidebar */}
        <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-black to-transparent pointer-events-none" />
        
        {sidebarContent}
      </aside>

      {/* MOBILE SLIDE-OUT DRAWER */}
      <AnimatePresence>
        {isMobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onCloseMobile}
              className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 md:hidden"
            />

            {/* Drawer */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 240 }}
              className="fixed top-0 bottom-0 left-0 w-[280px] bg-[#0B0B0F] border-r border-white/10 z-50 md:hidden flex flex-col shadow-2xl"
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// Export default alias for flexible imports
export default DashboardSidebar;
