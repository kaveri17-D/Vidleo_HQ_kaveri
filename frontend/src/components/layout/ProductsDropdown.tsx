'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { 
  ChevronDown, 
  ArrowRight, 
  ArrowUpRight, 
  Scissors, 
  Cpu, 
  Sparkles 
} from 'lucide-react';
import { VidleoLogo } from '@/components/brand/VidleoLogo';
import { cn } from '@/lib/utils';
import { EXTERNAL_LINKS } from '@/config/links';

export function ProductsDropdown({ isLightHero = true }: { isLightHero?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  return (
    <div
      ref={dropdownRef}
      className="relative"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      {/* Navbar Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className={cn(
          'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-[550] tracking-tight transition-all duration-150 focus:outline-none cursor-pointer',
          isOpen || pathname.startsWith('/products')
            ? 'text-[#0A0A0C] bg-white font-semibold shadow-xs'
            : 'text-[#5A5A62] hover:text-[#0A0A0C] hover:bg-black/[0.04]'
        )}
      >
        <span>Products</span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 text-[#8E8E98] transition-transform duration-200',
            isOpen ? 'rotate-180 text-black' : ''
          )}
        />
      </button>

      {/* Desktop Mega-Menu Dropdown with Modular Card styling */}
      {isOpen && (
        <div
          className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-[540px] sm:w-[580px] bg-white border border-black/[0.09] rounded-[26px] p-5 shadow-[0_24px_50px_rgba(0,0,0,0.12)] animate-in fade-in slide-in-from-top-2 duration-150 z-50 overflow-hidden text-[#0A0A0C]"
          role="menu"
          aria-orientation="vertical"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-black/[0.06] mb-4">
            <span className="text-[10px] font-mono font-bold tracking-[0.14em] uppercase text-[#7A7A82]">
              SYNAPVO PRODUCT SUITE
            </span>
            <span className="text-[10px] font-mono text-[#0A0A0C] font-semibold flex items-center gap-1.5 bg-[#F4F4F6] px-2.5 py-0.5 rounded-full border border-black/[0.06]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0C]" />
              Media Engine
            </span>
          </div>

          {/* Product Cards Grid */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Card 1: VIDLEO */}
              <a
                href="/"
                className="group relative p-4 rounded-2xl bg-[#F8F8FA] border border-black/[0.06] hover:border-black/[0.18] hover:bg-white transition-all duration-200 flex flex-col justify-between space-y-3 shadow-2xs hover:shadow-md"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <VidleoLogo size="sm" isLight={true} />
                    </div>
                    <span className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-[#0A0A0C] text-white">
                      ACTIVE
                    </span>
                  </div>

                  <div>
                    <span className="text-xs font-bold text-[#0A0A0C] block">
                      Video Downloader
                    </span>
                    <p className="text-[11px] text-[#6A6A72] font-sans leading-relaxed pt-0.5">
                      Fast, 4K video extraction for supported streaming platforms.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-xs font-semibold text-[#0A0A0C] group-hover:text-black transition-colors pt-1">
                  <span>Open Vidleo</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform text-[#0A0A0C]" />
                </div>
              </a>

              {/* Card 2: CLIPPER X */}
              <a
                href={EXTERNAL_LINKS.CLIPPER_X}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative p-4 rounded-2xl bg-[#F8F8FA] border border-black/[0.06] hover:border-black/[0.18] hover:bg-white transition-all duration-200 flex flex-col justify-between space-y-3 shadow-2xs hover:shadow-md"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-5.5 h-5.5 rounded-lg bg-amber-500 text-white flex items-center justify-center">
                        <Scissors className="w-3 h-3" />
                      </div>
                      <span className="font-display font-bold text-sm text-[#0A0A0C] tracking-tight">
                        ClipperX AI
                      </span>
                    </div>
                    <span className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
                      AI LAB ↗
                    </span>
                  </div>

                  <div>
                    <span className="text-xs font-bold text-[#0A0A0C] block">
                      Automated Clips
                    </span>
                    <p className="text-[11px] text-[#6A6A72] font-sans leading-relaxed pt-0.5">
                      Extract high-converting viral shorts and subtitles with AI.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-xs font-semibold text-[#0A0A0C] group-hover:text-black transition-colors pt-1">
                  <span>Visit ClipperX</span>
                  <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform text-amber-600" />
                </div>
              </a>
            </div>

            {/* Bottom Row: Nexus Media */}
            <a
              href="https://nexusmedia.io"
              target="_blank"
              rel="noopener noreferrer"
              className="group p-3 rounded-2xl bg-[#F8F8FA] border border-black/[0.06] hover:border-black/[0.16] hover:bg-white transition-all duration-200 flex items-center justify-between shadow-2xs"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#0A0A0C] text-white flex items-center justify-center shrink-0">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#0A0A0C] flex items-center gap-1.5">
                    <span>Nexus Media Infrastructure</span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-800">
                      Infra
                    </span>
                  </div>
                  <p className="text-[10px] text-[#7A7A82] font-sans">
                    High-throughput transcoding pipelines and CDN delivery.
                  </p>
                </div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-[#7A7A82] group-hover:text-black transition-colors shrink-0 mr-1" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
