'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { VidleoLogo } from '@/components/brand/VidleoLogo';
import {
  Menu,
  X,
  ArrowRight,
  ChevronDown,
  Scissors,
  Cpu,
  ArrowUpRight,
  Download,
  Layers,
  Zap,
  Users,
  BookOpen,
  MessageSquare,
  HelpCircle,
  FileText,
  Video,
  Globe,
  Star,
  Shield,
  Headphones,
  Code2,
  PlayCircle,
  BarChart3,
  Share2,
  Info,
  Tag,
  History,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EXTERNAL_LINKS } from '@/config/links';

// --- Types -------------------------------------------------------------------

interface MegaMenuItem {
  iconName: string;
  label: string;
  description: string;
  href: string;
  badge?: string;
  badgeColor?: string;
  external?: boolean;
}

interface MegaMenuSection {
  title?: string;
  items: MegaMenuItem[];
}

interface MegaMenuData {
  sections: MegaMenuSection[];
  featured?: {
    label: string;
    description: string;
    href: string;
    cta: string;
  };
}

// --- Menu Data ----------------------------------------------------------------

const PRODUCTS_MENU: MegaMenuData = {
  sections: [
    {
      title: 'SYNAPVO SUITE',
      items: [
        {
          iconName: 'PlayCircle',
          label: 'Vidleo',
          description: 'Fast, 4K video downloader for 50+ platforms',
          href: '/',
          badge: 'Active',
          badgeColor: 'bg-[#0A0A0C] text-white',
        },
        {
          iconName: 'Scissors',
          label: 'ClipperX AI',
          description: 'AI-powered highlight clipping and short-form content',
          href: EXTERNAL_LINKS.CLIPPER_X,
          badge: 'AI Lab',
          badgeColor: 'bg-amber-100 text-amber-800',
          external: true,
        },
        {
          iconName: 'Cpu',
          label: 'Nexus Media',
          description: 'High-throughput transcoding pipelines and CDN delivery',
          href: 'https://nexusmedia.io',
          badge: 'Infra',
          badgeColor: 'bg-blue-100 text-blue-800',
          external: true,
        },
      ],
    },
    {
      title: 'FEATURES',
      items: [
        {
          iconName: 'Download',
          label: 'Video Downloader',
          description: 'Download from YouTube, Instagram, X, Reddit & more',
          href: '/download',
        },
        {
          iconName: 'BarChart3',
          label: 'Download History',
          description: 'Track, manage, and re-download past videos',
          href: '/history',
        },
        {
          iconName: 'Globe',
          label: 'Supported Sites',
          description: 'Browse all 50+ supported streaming platforms',
          href: '/supported-sites',
        },
      ],
    },
  ],
};

const SOLUTIONS_MENU: MegaMenuData = {
  sections: [
    {
      title: 'BY USE CASE',
      items: [
        {
          iconName: 'Video',
          label: 'Content Creators',
          description: 'Build a research library and repurpose content fast',
          href: '/#how-it-works',
        },
        {
          iconName: 'Users',
          label: 'Teams & Agencies',
          description: 'Manage video assets and download history at scale',
          href: '/#how-it-works',
        },
        {
          iconName: 'Globe',
          label: 'Media Publishers',
          description: 'Source and manage video content from any platform',
          href: '/#how-it-works',
        },
      ],
    },
    {
      title: 'BY PLATFORM',
      items: [
        {
          iconName: 'PlayCircle',
          label: 'YouTube & Shorts',
          description: 'Download any video, playlist, or Shorts at up to 4K',
          href: '/supported-sites',
        },
        {
          iconName: 'Share2',
          label: 'Social Platforms',
          description: 'Instagram, X (Twitter), Reddit, Pinterest & more',
          href: '/supported-sites',
        },
        {
          iconName: 'Layers',
          label: 'All Platforms',
          description: 'See the full list of 50+ supported sites',
          href: '/supported-sites',
          badge: 'View All',
          badgeColor: 'bg-[#F4F4F6] text-[#0A0A0C]',
        },
      ],
    },
  ],
};

const COMMUNITY_MENU: MegaMenuData = {
  sections: [
    {
      title: 'VIDLEO',
      items: [
        {
          iconName: 'Info',
          label: 'About Vidleo',
          description: 'Our mission, story, and the team behind Vidleo',
          href: '/about',
        },
        {
          iconName: 'Tag',
          label: 'Pricing',
          description: 'Free, Creator, Pro, and Studio plans',
          href: '/pricing',
        },
        {
          iconName: 'Globe',
          label: 'Supported Platforms',
          description: 'Browse all 50+ platforms Vidleo supports',
          href: '/supported-sites',
        },
        {
          iconName: 'Headphones',
          label: 'Contact Us',
          description: 'Get in touch with the Vidleo team',
          href: '/contact',
        },
      ],
    },
  ],
};

const RESOURCES_MENU: MegaMenuData = {
  sections: [
    {
      title: 'LEARN',
      items: [
        {
          iconName: 'HelpCircle',
          label: 'FAQ',
          description: 'Answers to the most frequently asked questions',
          href: '/#faq',
        },
        {
          iconName: 'Globe',
          label: 'Supported Sites',
          description: 'Every platform Vidleo can extract from',
          href: '/supported-sites',
        },
        {
          iconName: 'Info',
          label: 'About Vidleo',
          description: 'How Vidleo works and who it is built for',
          href: '/about',
        },
      ],
    },
    {
      title: 'SUPPORT',
      items: [
        {
          iconName: 'Headphones',
          label: 'Contact Support',
          description: 'Get help from the Vidleo team',
          href: '/contact',
        },
        {
          iconName: 'Tag',
          label: 'Pricing',
          description: 'Compare plans and find the right tier',
          href: '/pricing',
        },
        {
          iconName: 'Scissors',
          label: 'ClipperX AI',
          description: 'Our AI clipping tool — explore the full suite',
          href: EXTERNAL_LINKS.CLIPPER_X,
          external: true,
        },
      ],
    },
  ],
};

const NAV_ITEMS = [
  { label: 'Products', menu: PRODUCTS_MENU },
  { label: 'Solutions', menu: SOLUTIONS_MENU },
  { label: 'Community', menu: COMMUNITY_MENU },
  { label: 'Resources', menu: RESOURCES_MENU },
];

// --- Icon Resolver ------------------------------------------------------------

function NavIcon({ name }: { name: string }) {
  const cls = 'w-4 h-4';
  switch (name) {
    case 'PlayCircle':    return <PlayCircle className={cls} />;
    case 'Scissors':      return <Scissors className={cls} />;
    case 'Cpu':           return <Cpu className={cls} />;
    case 'Download':      return <Download className={cls} />;
    case 'BarChart3':     return <BarChart3 className={cls} />;
    case 'History':       return <History className={cls} />;
    case 'Video':         return <Video className={cls} />;
    case 'Users':         return <Users className={cls} />;
    case 'Globe':         return <Globe className={cls} />;
    case 'Code2':         return <Code2 className={cls} />;
    case 'Share2':        return <Share2 className={cls} />;
    case 'Layers':        return <Layers className={cls} />;
    case 'MessageSquare': return <MessageSquare className={cls} />;
    case 'Star':          return <Star className={cls} />;
    case 'Zap':           return <Zap className={cls} />;
    case 'Shield':        return <Shield className={cls} />;
    case 'BookOpen':      return <BookOpen className={cls} />;
    case 'FileText':      return <FileText className={cls} />;
    case 'HelpCircle':    return <HelpCircle className={cls} />;
    case 'Headphones':    return <Headphones className={cls} />;
    case 'Info':          return <Info className={cls} />;
    case 'Tag':           return <Tag className={cls} />;
    default:              return <PlayCircle className={cls} />;
  }
}

// --- Mega Menu Panel ----------------------------------------------------------

function MegaMenuPanel({
  data,
  isOpen,
  onClose,
}: {
  data: MegaMenuData;
  isOpen: boolean;
  onClose: () => void;
}) {
  const colCount = data.sections.length;

  return (
    <div
      className="absolute z-[200] overflow-hidden"
      style={{
        top: 'calc(100% + 2px)',
        left: '50%',
        width: colCount > 1 ? 'min(820px, calc(100vw - 32px))' : 'min(380px, calc(100vw - 32px))',
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? 'auto' : 'none',
        transform: isOpen
          ? 'translateX(-50%) translateY(0px) scale(1)'
          : 'translateX(-50%) translateY(-8px) scale(0.97)',
        transition: 'opacity 220ms cubic-bezier(0.22,1,0.36,1), transform 220ms cubic-bezier(0.22,1,0.36,1)',
      }}
      onMouseLeave={onClose}
    >
      {/* 2px invisible bridge so mouse can travel from trigger to panel */}
      <div className="h-[2px] w-full" />

      <div
        className="bg-white border border-black/[0.08] rounded-[20px] shadow-[0_16px_48px_rgba(0,0,0,0.11),0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden"
      >
        <div
          className="p-5 grid gap-5"
          style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
        >
          {data.sections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-0.5">
              {section.title && (
                <p className="text-[10px] font-mono font-bold tracking-[0.12em] uppercase text-[#9A9AA2] px-2.5 pb-2">
                  {section.title}
                </p>
              )}
              {section.items.map((item, iIdx) => (
                <a
                  key={iIdx}
                  href={item.href}
                  target={item.external ? '_blank' : undefined}
                  rel={item.external ? 'noopener noreferrer' : undefined}
                  onClick={onClose}
                  className="group flex items-start gap-3 px-2.5 py-2 rounded-xl hover:bg-[#F6F6F8] transition-all duration-150 cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg bg-[#F0F0F3] group-hover:bg-white group-hover:shadow-sm flex items-center justify-center shrink-0 text-[#5A5A62] group-hover:text-[#0A0A0C] transition-all duration-150">
                    <NavIcon name={item.iconName} />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-[600] text-[#0A0A0C] leading-tight">
                        {item.label}
                      </span>
                      {item.badge && (
                        <span className={cn('text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-full leading-none', item.badgeColor)}>
                          {item.badge}
                        </span>
                      )}
                      {item.external && (
                        <ArrowUpRight className="w-3 h-3 text-[#9A9AA2] group-hover:text-[#5B4BFF] transition-colors" />
                      )}
                    </div>
                    <p className="text-[11.5px] text-[#6A6A72] leading-snug mt-0.5">
                      {item.description}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          ))}
        </div>

        {data.featured && (
          <div className="mx-4 mb-4 p-3.5 rounded-xl bg-[#F6F6F8] border border-black/[0.06] flex items-center justify-between gap-4">
            <div>
              <p className="text-[12px] font-[650] text-[#0A0A0C]">{data.featured.label}</p>
              <p className="text-[11px] text-[#6A6A72] mt-0.5">{data.featured.description}</p>
            </div>
            <a
              href={data.featured.href}
              onClick={onClose}
              className="shrink-0 text-[11px] font-[650] text-[#5B4BFF] hover:text-[#4537e8] whitespace-nowrap transition-colors"
            >
              {data.featured.cta}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Navbar Component ---------------------------------------------------------

export function Navbar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileOpenSections, setMobileOpenSections] = useState<string[]>([]);
  const navRef = useRef<HTMLElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
    setActiveMenu(null);
    setMobileOpenSections([]);
  }, [pathname]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setActiveMenu(null);
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  const handleMenuEnter = useCallback((label: string) => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setActiveMenu(label);
  }, []);

  const handleMenuLeave = useCallback(() => {
    closeTimeoutRef.current = setTimeout(() => setActiveMenu(null), 120);
  }, []);

  const handleMenuClose = useCallback(() => setActiveMenu(null), []);

  const toggleMobileSection = (label: string) => {
    setMobileOpenSections((prev) =>
      prev.includes(label) ? prev.filter((s) => s !== label) : [...prev, label]
    );
  };

  const isDashboard = pathname?.startsWith('/download') || pathname?.startsWith('/history');
  if (isDashboard) return null;

  return (
    <>
      {/* Desktop Navbar */}
      <header
        ref={navRef}
        className={cn(
          'sticky top-0 left-0 right-0 z-50 transition-all duration-300',
          scrolled
            ? 'bg-white/95 backdrop-blur-md border-b border-black/[0.07] shadow-[0_2px_24px_rgba(0,0,0,0.06)]'
            : 'bg-white border-b border-black/[0.06]'
        )}
      >
        <div className="max-w-[1440px] mx-auto px-5 lg:px-10 h-[60px] flex lg:grid lg:grid-cols-[1fr_auto_1fr] items-center justify-between relative">

          {/* Left: Logo */}
          <div className="flex items-center justify-start">
            <a
              href="/"
              aria-label="Vidleo homepage"
            >
              <VidleoLogo size="md" isLight={true} />
            </a>
          </div>

          {/* Center nav */}
          <nav className="hidden lg:flex items-center justify-center gap-0.5" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => (
              <div
                key={item.label}
                className="relative"
                onMouseEnter={() => handleMenuEnter(item.label)}
                onMouseLeave={handleMenuLeave}
              >
                <button
                  type="button"
                  onClick={() => setActiveMenu(activeMenu === item.label ? null : item.label)}
                  aria-expanded={activeMenu === item.label}
                  aria-haspopup="true"
                  className={cn(
                    'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[13.5px] font-[540] tracking-tight transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B4BFF]/50 cursor-pointer select-none',
                    activeMenu === item.label
                      ? 'text-[#0A0A0C] bg-black/[0.05]'
                      : 'text-[#4A4A52] hover:text-[#0A0A0C] hover:bg-black/[0.04]'
                  )}
                >
                  {item.label}
                  <ChevronDown
                    className={cn(
                      'w-3.5 h-3.5 text-[#9A9AA2] transition-transform duration-200',
                      activeMenu === item.label ? 'rotate-180 text-[#0A0A0C]' : ''
                    )}
                  />
                </button>

                <MegaMenuPanel
                  data={item.menu}
                  isOpen={activeMenu === item.label}
                  onClose={handleMenuClose}
                />
              </div>
            ))}

            <a
              href="/pricing"
              className={cn(
                'px-3 py-1.5 rounded-lg text-[13.5px] font-[540] tracking-tight transition-all duration-150 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B4BFF]/50',
                pathname === '/pricing'
                  ? 'text-[#0A0A0C] bg-black/[0.05] font-[600]'
                  : 'text-[#4A4A52] hover:text-[#0A0A0C] hover:bg-black/[0.04]'
              )}
            >
              Pricing
            </a>
          </nav>

          {/* Right side actions */}
          <div className="flex items-center justify-end gap-2 lg:gap-2.5">
            {user ? (
              <div className="hidden sm:flex items-center gap-2 lg:gap-3">
                <a
                  href="/dashboard"
                  className="px-3.5 py-1.5 rounded-lg bg-[#0A0A0C] hover:bg-[#1a1a22] text-white text-[13px] font-[600] tracking-tight transition-all duration-150 shadow-sm flex items-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5 text-[#5B4BFF]" />
                  <span>Dashboard</span>
                </a>

                <a
                  href="/dashboard"
                  className="flex items-center gap-2 p-1 rounded-full border border-black/10 hover:border-black/30 transition-all bg-white"
                  title={user.email || 'User Profile'}
                  aria-label="Go to dashboard"
                >
                  {user.user_metadata?.avatar_url || user.user_metadata?.picture ? (
                    <img
                      src={user.user_metadata.avatar_url || user.user_metadata.picture}
                      alt="User Avatar"
                      className="w-7 h-7 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-[#5B4BFF] text-white flex items-center justify-center font-bold text-[11px]">
                      {(user.user_metadata?.full_name || user.email || 'V')[0].toUpperCase()}
                    </div>
                  )}
                </a>

                <button
                  type="button"
                  onClick={() => signOut()}
                  className="text-[12.5px] font-[550] text-[#5A5A62] hover:text-red-600 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                >
                  Log out
                </button>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-2 lg:gap-2.5">
                <a
                  href="/contact"
                  className="text-[13px] font-[550] text-[#4A4A52] hover:text-[#0A0A0C] transition-colors px-2.5 py-1.5 rounded-lg hover:bg-black/[0.04] hidden lg:block"
                >
                  Contact sales
                </a>
                <a
                  href="/login"
                  className="px-3.5 py-1.5 rounded-lg border border-[#D8D8D8] hover:border-black/50 bg-white text-[#0A0A0C] text-[13px] font-[600] tracking-tight transition-all duration-150 shadow-[0_1px_3px_rgba(0,0,0,0.07)] hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B4BFF]/50"
                >
                  Log in
                </a>
                <a
                  href="/login"
                  className="px-3.5 py-1.5 rounded-lg bg-[#0A0A0C] hover:bg-[#1a1a22] text-white text-[13px] font-[600] tracking-tight transition-all duration-150 shadow-sm hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B4BFF]/50"
                >
                  Get started for free
                </a>
              </div>
            )}

            {/* Mobile buttons */}
            <div className="flex sm:hidden items-center gap-2">
              <a
                href={user ? '/dashboard' : '/login'}
                className="bg-[#0A0A0C] text-white px-3 py-1.5 rounded-lg text-[12px] font-semibold"
              >
                {user ? 'Dashboard' : 'Get started'}
              </a>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded-lg border border-[#E5E7EB] text-[#0A0A0C] focus:outline-none hover:border-black/30 transition-colors"
                aria-label="Toggle Navigation Menu"
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm sm:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-[min(85vw,380px)] bg-white sm:hidden flex flex-col transition-transform duration-300',
          mobileMenuOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full'
        )}
        aria-label="Mobile navigation"
        role="dialog"
        aria-modal="true"
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.07]">
          <a href="/" onClick={() => setMobileMenuOpen(false)}>
            <VidleoLogo size="sm" isLight={true} />
          </a>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="p-2 rounded-lg border border-[#E5E7EB] text-[#0A0A0C] hover:border-black/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B4BFF]/50"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable nav items */}
        <div className="flex-1 overflow-y-auto py-3 px-3 space-y-1">
          {NAV_ITEMS.map((navItem) => {
            const isOpen = mobileOpenSections.includes(navItem.label);
            return (
              <div key={navItem.label}>
                <button
                  type="button"
                  onClick={() => toggleMobileSection(navItem.label)}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 text-[13.5px] font-[600] text-[#0A0A0C] hover:bg-[#F6F6F8] rounded-xl transition-colors focus:outline-none"
                  aria-expanded={isOpen}
                >
                  <span>{navItem.label}</span>
                  <ChevronDown
                    className={cn(
                      'w-4 h-4 text-[#9A9AA2] transition-transform duration-200',
                      isOpen ? 'rotate-180' : ''
                    )}
                  />
                </button>

                {isOpen && (
                  <div className="mx-1 mb-1 bg-[#F8F8FA] rounded-xl border border-black/[0.06] overflow-hidden">
                    {navItem.menu.sections.map((section, sIdx) => (
                      <div key={sIdx} className="px-3 py-2">
                        {section.title && (
                          <p className="text-[9.5px] font-mono font-bold tracking-widest uppercase text-[#9A9AA2] px-1 pb-1.5 pt-0.5">
                            {section.title}
                          </p>
                        )}
                        <div className="space-y-0.5">
                          {section.items.map((item, iIdx) => (
                            <a
                              key={iIdx}
                              href={item.href}
                              target={item.external ? '_blank' : undefined}
                              rel={item.external ? 'noopener noreferrer' : undefined}
                              onClick={() => setMobileMenuOpen(false)}
                              className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white transition-colors group"
                            >
                              <div className="w-7 h-7 rounded-lg bg-white border border-black/[0.07] flex items-center justify-center shrink-0 text-[#6A6A72] group-hover:text-[#0A0A0C] transition-colors">
                                <NavIcon name={item.iconName} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[12.5px] font-[600] text-[#0A0A0C] truncate">
                                    {item.label}
                                  </span>
                                  {item.external && (
                                    <ArrowUpRight className="w-3 h-3 text-[#9A9AA2] shrink-0" />
                                  )}
                                </div>
                                <p className="text-[11px] text-[#7A7A82] truncate">{item.description}</p>
                              </div>
                            </a>
                          ))}
                        </div>
                        {sIdx < navItem.menu.sections.length - 1 && (
                          <div className="h-px bg-black/[0.06] my-1.5 mx-1" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Static links */}
          <div className="pt-1 space-y-0.5">
            {[
              { label: 'Pricing', href: '/pricing' },
              { label: 'Contact', href: '/contact' },
              { label: 'About', href: '/about' },
              { label: 'Supported Sites', href: '/supported-sites' },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'flex items-center px-3.5 py-2.5 rounded-xl text-[13.5px] font-[550] transition-colors',
                  pathname === link.href
                    ? 'text-[#0A0A0C] bg-[#F6F6F8] font-[650]'
                    : 'text-[#4A4A52] hover:text-[#0A0A0C] hover:bg-[#F6F6F8]'
                )}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* Drawer footer */}
        <div className="px-4 py-4 border-t border-black/[0.07] space-y-2.5">
          {user ? (
            <>
              <a
                href="/dashboard"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#0A0A0C] text-white text-[13.5px] font-[650] hover:bg-[#1a1a22] transition-all"
              >
                Dashboard
                <ArrowRight className="w-4 h-4" />
              </a>
              <button
                type="button"
                onClick={() => { signOut(); setMobileMenuOpen(false); }}
                className="w-full flex items-center justify-center py-2.5 rounded-xl border border-[#D8D8D8] text-red-600 text-[13.5px] font-[600] hover:bg-red-50 hover:border-red-200 transition-all"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <a
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center justify-center py-2.5 rounded-xl border border-[#D8D8D8] text-[#0A0A0C] text-[13.5px] font-[600] hover:border-black/40 transition-all"
              >
                Log in
              </a>
              <a
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#0A0A0C] text-white text-[13.5px] font-[650] hover:bg-[#1a1a22] transition-all"
              >
                Get started for free
                <ArrowRight className="w-4 h-4" />
              </a>
            </>
          )}
        </div>
      </div>
    </>
  );
}
