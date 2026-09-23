'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { 
  Link as LinkIcon, 
  ChevronDown, 
  ArrowRight, 
  Search, 
  LayoutGrid, 
  List, 
  Download, 
  Clock, 
  FolderHeart, 
  Heart, 
  Repeat, 
  Settings, 
  MoreVertical,
  HardDrive
} from 'lucide-react';
import { UrlDownloader } from '@/components/downloader/UrlDownloader';
import { cn } from '@/lib/utils';

// ============================================================================
// 8 REALISTIC DESKTOP DEMO VIDEO CARDS
// ============================================================================
const DEMO_VIDEOS = [
  {
    id: 'vid-1',
    title: 'A Day in the Mountains',
    platform: 'YouTube',
    platformIcon: (
      <svg className="w-3.5 h-3.5 fill-[#FF0000]" viewBox="0 0 24 24">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
    quality: '1080p · MP4',
    size: '120 MB',
    duration: '12:34',
    timestamp: '2 hours ago',
    thumbnail: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=400&auto=format&fit=crop',
  },
  {
    id: 'vid-2',
    title: 'Study With Me',
    platform: 'Instagram',
    platformIcon: (
      <div className="w-3.5 h-3.5 rounded-[3px] bg-gradient-to-tr from-[#FFD600] via-[#FF0169] to-[#D300C5] flex items-center justify-center">
        <svg className="w-2.5 h-2.5 fill-white" viewBox="0 0 24 24">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069z" />
        </svg>
      </div>
    ),
    quality: '720p · MP4',
    size: '85 MB',
    duration: '08:21',
    timestamp: '5 hours ago',
    thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=400&auto=format&fit=crop',
  },
  {
    id: 'vid-3',
    title: 'Chill Vibes Playlist',
    platform: 'YouTube',
    platformIcon: (
      <svg className="w-3.5 h-3.5 fill-[#FF0000]" viewBox="0 0 24 24">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
    quality: '1080p · MP4',
    size: '240 MB',
    duration: '15:06',
    timestamp: '1 day ago',
    thumbnail: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=400&auto=format&fit=crop',
  },
  {
    id: 'vid-4',
    title: 'Tokyo Night Walk',
    platform: 'TikTok',
    platformIcon: (
      <svg className="w-3.5 h-3.5 fill-black" viewBox="0 0 24 24">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 3 15.68a6.34 6.34 0 0 0 10.86 4.43c1.7-1.7 1.7-4.44 1.7-4.44V8.65a8.28 8.28 0 0 0 4.03 1.25V6.69z" />
      </svg>
    ),
    quality: '1080p · MP4',
    size: '60 MB',
    duration: '03:45',
    timestamp: '2 days ago',
    thumbnail: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=400&auto=format&fit=crop',
  },
  {
    id: 'vid-5',
    title: 'Nature Sounds',
    platform: 'YouTube',
    platformIcon: (
      <svg className="w-3.5 h-3.5 fill-[#FF0000]" viewBox="0 0 24 24">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
    quality: '1080p · MP4',
    size: '310 MB',
    duration: '20:18',
    timestamp: '3 days ago',
    thumbnail: 'https://images.unsplash.com/photo-1448375240586-882707db888b?q=80&w=400&auto=format&fit=crop',
  },
  {
    id: 'vid-6',
    title: 'Cafe Aesthetic',
    platform: 'Instagram',
    platformIcon: (
      <div className="w-3.5 h-3.5 rounded-[3px] bg-gradient-to-tr from-[#FFD600] via-[#FF0169] to-[#D300C5] flex items-center justify-center">
        <svg className="w-2.5 h-2.5 fill-white" viewBox="0 0 24 24">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069z" />
        </svg>
      </div>
    ),
    quality: '720p · MP4',
    size: '52 MB',
    duration: '07:12',
    timestamp: '4 days ago',
    thumbnail: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?q=80&w=400&auto=format&fit=crop',
  },
  {
    id: 'vid-7',
    title: 'Live Concert',
    platform: 'X',
    platformIcon: (
      <svg className="w-3.5 h-3.5 fill-black" viewBox="0 0 24 24">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
    quality: '1080p · MP4',
    size: '180 MB',
    duration: '09:47',
    timestamp: '5 days ago',
    thumbnail: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=400&auto=format&fit=crop',
  },
  {
    id: 'vid-8',
    title: 'Travel Edit',
    platform: 'YouTube',
    platformIcon: (
      <svg className="w-3.5 h-3.5 fill-[#FF0000]" viewBox="0 0 24 24">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
    quality: '1080p · MP4',
    size: '210 MB',
    duration: '11:25',
    timestamp: '1 week ago',
    thumbnail: 'https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?q=80&w=400&auto=format&fit=crop',
  },
];

const CATEGORY_TABS = ['All', 'YouTube', 'Instagram', 'TikTok', 'Shorts', 'Reels', 'Playlists', 'Converted'];

export function HeroSection() {
  const shouldReduceMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [featureTab, setFeatureTab] = useState('Download');
  const [showMorePlatforms, setShowMorePlatforms] = useState(false);

  return (
    <section className="relative w-full bg-white text-[#0A0A0C] pt-0 pb-20 sm:pb-28 px-4 sm:px-6 lg:px-8 overflow-hidden select-none font-sans">
      
      {/* =====================================================================
          1. ABSTRACT GEOMETRIC ARTWORK (LEFT & RIGHT - EXACT COLOR PALETTE)
          ===================================================================== */}
      {/* LEFT ABSTRACT ARTWORK (~50% off-canvas) */}
      <div 
        className="absolute top-8 left-[-160px] sm:left-[-140px] lg:left-[-120px] w-[340px] sm:w-[420px] pointer-events-none z-10 select-none hidden md:block"
        aria-hidden="true"
      >
        {/* Layered Concentric Rounded Arch / Rectangle */}
        <div className="w-[320px] h-[340px] rounded-[110px] p-6 bg-[#5B4BFF] shadow-sm flex items-center justify-center">
          <div className="w-full h-full rounded-[90px] p-5 bg-[#388BFD] flex items-center justify-center">
            <div className="w-full h-full rounded-[70px] p-5 bg-[#FF2ED1] flex items-center justify-center">
              <div className="w-full h-full rounded-[50px] p-5 bg-[#65F27C] flex items-center justify-center">
                <div className="w-full h-full rounded-[35px] bg-[#FF6268]" />
              </div>
            </div>
          </div>
        </div>

        {/* Coral/Red 4-Lobed Flower with Mustard Plus Star */}
        <div className="relative mt-8 ml-8 w-[240px] h-[240px] flex items-center justify-center">
          <div className="absolute inset-0 bg-[#FF6268] rounded-[50px] rotate-45 shadow-sm" />
          <div className="absolute inset-0 bg-[#FF6268] rounded-[50px] shadow-sm" />
          {/* Center Mustard Star/Plus */}
          <div className="relative z-10 w-16 h-16 flex items-center justify-center">
            <div className="w-6 h-16 bg-[#E1B500] rounded-full absolute" />
            <div className="w-16 h-6 bg-[#E1B500] rounded-full absolute" />
          </div>
        </div>
      </div>

      {/* RIGHT ABSTRACT ARTWORK (~50% off-canvas) */}
      <div 
        className="absolute top-10 right-[-180px] sm:right-[-140px] lg:right-[-100px] w-[360px] sm:w-[440px] pointer-events-none z-10 select-none hidden md:block"
        aria-hidden="true"
      >
        {/* Mustard Yellow Curved Block with Maroon Oval */}
        <div className="relative w-[340px] h-[380px] rounded-[120px] bg-[#E1B500] p-7 shadow-sm overflow-hidden flex items-start justify-center">
          {/* Deep Maroon Rounded Arch */}
          <div className="w-[180px] h-[260px] rounded-[90px] bg-[#7A1F25] p-5 flex items-start justify-center mt-4">
            <div className="w-16 h-28 rounded-full bg-[#E1B500]" />
          </div>

          {/* Lime Green Accent Pill */}
          <div className="absolute bottom-6 right-8 w-24 h-44 rounded-full bg-[#65F27C] -rotate-12" />
        </div>

        {/* Diagonal Green & Purple Shapes Below */}
        <div className="relative mt-6 mr-6 flex items-center gap-4 justify-end">
          <div className="w-44 h-24 rounded-[40px] bg-[#65F27C] rotate-[-25deg] shadow-sm flex items-center justify-center">
            <div className="w-20 h-10 rounded-full bg-[#22C55E]" />
          </div>
          <div className="w-28 h-28 bg-[#5B4BFF] clip-path-triangle rotate-12 rounded-2xl" />
        </div>
      </div>

      {/* =====================================================================
          2. CENTERED HERO CONTENT (TYPOGRAPHY + DOWNLOADER + SHORTCUTS)
          ===================================================================== */}
      <div className="max-w-[1240px] mx-auto relative z-20 flex flex-col items-center text-center">
        
        {/* Eyebrow Label */}
        <motion.div
          initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FAFAFC] border border-[#E5E7EB] text-[12px] font-sans font-semibold text-[#4B5563] tracking-wide mb-6 sm:mb-7 shadow-2xs"
        >
          <span className="w-2 h-2 rounded-full bg-[#5B4BFF]" />
          <span>Fast. Simple. Free.</span>
        </motion.div>

        {/* Main Bold Headline */}
        <motion.div
          initial={shouldReduceMotion ? "visible" : "hidden"}
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: {
                staggerChildren: 0.09,
                delayChildren: 0.04,
              },
            },
          }}
          className="space-y-4 max-w-4xl"
        >
          <h1 className="font-display font-[800] text-[48px] sm:text-[72px] lg:text-[88px] text-[#0A0A0C] tracking-[-0.04em] leading-[0.98] text-balance">
            <span className="block">
              {['Download', 'Faster.'].map((word, idx) => (
                <motion.span
                  key={`h1-${idx}`}
                  variants={{
                    hidden: { opacity: 0, y: 20, filter: 'blur(5px)' },
                    visible: {
                      opacity: 1,
                      y: 0,
                      filter: 'blur(0px)',
                      transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
                    },
                  }}
                  className="inline-block mr-[0.22em] last:mr-0"
                >
                  {word}
                </motion.span>
              ))}
            </span>
            <span className="block">
              {['Create', 'Better.'].map((word, idx) => (
                <motion.span
                  key={`h2-${idx}`}
                  variants={{
                    hidden: { opacity: 0, y: 20, filter: 'blur(5px)' },
                    visible: {
                      opacity: 1,
                      y: 0,
                      filter: 'blur(0px)',
                      transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
                    },
                  }}
                  className="inline-block mr-[0.22em] last:mr-0"
                >
                  {word}
                </motion.span>
              ))}
            </span>
          </h1>

          {/* Supporting Description */}
          <motion.p
            variants={{
              hidden: { opacity: 0, y: 14 },
              visible: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
              },
            }}
            className="text-base sm:text-[19px] text-[#4B5563] font-sans font-normal leading-relaxed max-w-[660px] mx-auto pt-1 text-balance"
          >
            Vidleo helps you download, organize and manage videos from your favorite platforms, all in one place.
          </motion.p>
        </motion.div>

        {/* Primary Video Download Input Component */}
        <motion.div
          initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[880px] mx-auto mt-8 sm:mt-10"
        >
          <UrlDownloader variant="light" />
        </motion.div>

        {/* Supported Platform Shortcuts Bar */}
        <motion.div
          initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-wrap items-center justify-center gap-2 sm:gap-3.5 pt-5 pb-12 text-xs font-sans text-[#4B5563]"
        >
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8F8FA] border border-[#E5E7EB] hover:border-[#D1D5DB] transition-colors cursor-pointer">
            <svg className="w-3.5 h-3.5 fill-[#FF0000]" viewBox="0 0 24 24">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
            <span className="font-semibold text-[#1F2937]">YouTube</span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8F8FA] border border-[#E5E7EB] hover:border-[#D1D5DB] transition-colors cursor-pointer">
            <div className="w-3.5 h-3.5 rounded-[3px] bg-gradient-to-tr from-[#FFD600] via-[#FF0169] to-[#D300C5] flex items-center justify-center">
              <svg className="w-2.5 h-2.5 fill-white" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069z" />
              </svg>
            </div>
            <span className="font-semibold text-[#1F2937]">Instagram</span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8F8FA] border border-[#E5E7EB] hover:border-[#D1D5DB] transition-colors cursor-pointer">
            <svg className="w-3.5 h-3.5 fill-black" viewBox="0 0 24 24">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 3 15.68a6.34 6.34 0 0 0 10.86 4.43c1.7-1.7 1.7-4.44 1.7-4.44V8.65a8.28 8.28 0 0 0 4.03 1.25V6.69z" />
            </svg>
            <span className="font-semibold text-[#1F2937]">TikTok</span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8F8FA] border border-[#E5E7EB] hover:border-[#D1D5DB] transition-colors cursor-pointer">
            <svg className="w-3.5 h-3.5 fill-black" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span className="font-semibold text-[#1F2937]">X (Twitter)</span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8F8FA] border border-[#E5E7EB] hover:border-[#D1D5DB] transition-colors cursor-pointer">
            <svg className="w-3.5 h-3.5 fill-[#1877F2]" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            <span className="font-semibold text-[#1F2937]">Facebook</span>
          </div>

          <AnimatePresence>
            {showMorePlatforms && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: 'auto' }}
                exit={{ opacity: 0, scale: 0.9, width: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-wrap items-center gap-2 sm:gap-3.5 overflow-hidden"
              >
                {/* Vimeo */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8F8FA] border border-[#E5E7EB] hover:border-[#D1D5DB] transition-colors cursor-pointer">
                  <svg className="w-3.5 h-3.5 fill-[#1AB7EA]" viewBox="0 0 24 24">
                    <path d="M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.409 0-2.578-1.294-3.553-3.881L4.57 8.687C3.82 6.012 3.003 4.674 2.122 4.674c-.187 0-.842.392-1.964 1.176L0 4.39C1.22 3.315 2.457 2.19 3.71 1.016 5.435-.584 6.643-1.042 7.337-1.042c1.624 0 2.628.989 3.012 2.969.414 2.128.707 3.447.88 3.957.518 1.94 1.085 2.91 1.701 2.91.483 0 1.077-.311 1.782-.933.705-.622 1.09-1.455 1.155-2.5.138-1.802-.628-2.703-2.298-2.703-.787 0-1.603.178-2.45.534 1.626-5.32 4.676-7.854 9.15-7.603 3.32.186 4.887 1.905 4.706 5.156z" />
                  </svg>
                  <span className="font-semibold text-[#1F2937]">Vimeo</span>
                </div>

                {/* Reddit */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8F8FA] border border-[#E5E7EB] hover:border-[#D1D5DB] transition-colors cursor-pointer">
                  <svg className="w-3.5 h-3.5 fill-[#FF4500]" viewBox="0 0 24 24">
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.344 6.315 3.516 8.484l-1.393 2.787a.75.75 0 00.975 1.015l3.21-1.427C7.818 23.504 9.855 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm.75 16.5c-2.485 0-4.5-1.007-4.5-2.25 0-.414.336-.75.75-.75s.75.336.75.75c0 .414 1.343.75 3 0 .414-.75.336-.75.75s-.336.75-.75.75z" />
                  </svg>
                  <span className="font-semibold text-[#1F2937]">Reddit</span>
                </div>

                {/* Pinterest */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8F8FA] border border-[#E5E7EB] hover:border-[#D1D5DB] transition-colors cursor-pointer">
                  <svg className="w-3.5 h-3.5 fill-[#E60023]" viewBox="0 0 24 24">
                    <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.62 0 12.017 0z" />
                  </svg>
                  <span className="font-semibold text-[#1F2937]">Pinterest</span>
                </div>

                {/* Twitch */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8F8FA] border border-[#E5E7EB] hover:border-[#D1D5DB] transition-colors cursor-pointer">
                  <svg className="w-3.5 h-3.5 fill-[#9146FF]" viewBox="0 0 24 24">
                    <path d="M11.571 1.429L1.429 4.286v15.714h5.714V24l4.286-4h4.286l7.143-7.143V1.429zm6 10l-2.857 2.857h-4.286l-2.571 2.571v-2.571H4.714V5.714h12.857zM15 8.286h-2.143v4.286H15zm-5.714 0H7.143v4.286h2.143z" />
                  </svg>
                  <span className="font-semibold text-[#1F2937]">Twitch</span>
                </div>

                {/* SoundCloud */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8F8FA] border border-[#E5E7EB] hover:border-[#D1D5DB] transition-colors cursor-pointer">
                  <svg className="w-3.5 h-3.5 fill-[#FF5500]" viewBox="0 0 24 24">
                    <path d="M1.175 12.225c-.047 0-.083.036-.083.083v6.333c0 .047.036.083.083.083h.584c.047 0 .083-.036.083-.083v-6.333c0-.047-.036-.083-.083-.083zm1.5 0c-.047 0-.083.036-.083.083v6.333c0 .047.036.083.083.083h.584c.047 0 .083-.036.083-.083v-6.333c0-.047-.036-.083-.083-.083zm1.5-1.5c-.047 0-.083.036-.083.083v7.833c0 .047.036.083.083.083h.584c.047 0 .083-.036.083-.083V10.808c0-.047-.036-.083-.083-.083zm1.5-.75c-.047 0-.083.036-.083.083v8.583c0 .047.036.083.083.083h.584c.047 0 .083-.036.083-.083V10.058c0-.047-.036-.083-.083-.083zm1.5-1.25c-.047 0-.083.036-.083.083v9.833c0 .047.036.083.083.083h.584c.047 0 .083-.036.083-.083V8.808c0-.047-.036-.083-.083-.083z" />
                  </svg>
                  <span className="font-semibold text-[#1F2937]">SoundCloud</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="button"
            onClick={() => setShowMorePlatforms(!showMorePlatforms)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all cursor-pointer select-none active:scale-95",
              showMorePlatforms
                ? "bg-[#F0F0F3] border-[#D1D5DB] text-[#0A0A0C]"
                : "bg-[#F8F8FA] border-[#E5E7EB] hover:border-[#D1D5DB] text-[#6B7280] hover:text-[#0A0A0C]"
            )}
          >
            {!showMorePlatforms ? (
              <>
                <span>•••</span>
                <span className="font-semibold text-[#4B5563]">More</span>
              </>
            ) : (
              <span className="font-semibold text-[11.5px] text-[#0A0A0C] uppercase tracking-wider px-0.5">Show less</span>
            )}
          </button>
        </motion.div>

        {/* ===================================================================
            3. MAIN MACOS DESKTOP APPLICATION WINDOW (REFERENCE REPRODUCTION)
            =================================================================== */}
        <motion.div
          initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 30, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[1040px] rounded-[18px] sm:rounded-[22px] bg-white border border-[#D8D8D8] shadow-[0_20px_60px_rgba(0,0,0,0.08)] overflow-hidden text-left"
        >
          {/* macOS Window Top Bar with Traffic Light Controls */}
          <div className="h-10 sm:h-11 px-4 sm:px-5 bg-[#F9FAFB] border-b border-[#E5E7EB] flex items-center justify-between">
            {/* Traffic Lights */}
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]" />
              <span className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]" />
              <span className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]" />
            </div>

            {/* App Window Brand Center */}
            <div className="flex items-center gap-2 text-xs font-semibold text-[#374151]">
              <div className="w-4 h-4 rounded-xs bg-[#5B4BFF] flex items-center justify-center">
                <div className="w-0 h-0 border-t-[2.5px] border-t-transparent border-b-[2.5px] border-b-transparent border-l-[4px] border-l-white" />
              </div>
              <span>Vidleo Workspace</span>
            </div>

            <div className="w-12" />
          </div>

          {/* Desktop App Layout: Sidebar + Main Content */}
          <div className="flex flex-col md:flex-row min-h-[460px]">
            
            {/* LEFT SIDEBAR (~185px) */}
            <div className="w-full md:w-[185px] bg-[#F9FAFB] border-r border-[#E5E7EB] p-4 flex flex-col justify-between shrink-0">
              <div className="space-y-6">
                
                {/* Sidebar Brand Header */}
                <div className="flex items-center gap-2 px-2 pt-1">
                  <div className="w-6 h-6 rounded-md bg-[#5B4BFF] flex items-center justify-center">
                    <div className="w-0 h-0 border-t-[3.5px] border-t-transparent border-b-[3.5px] border-b-transparent border-l-[6px] border-l-white ml-0.5" />
                  </div>
                  <span className="font-display font-bold text-sm text-[#0A0A0C]">
                    Vidleo
                  </span>
                </div>

                {/* Sidebar Nav Items */}
                <nav className="space-y-1 text-[13px] font-medium text-[#4B5563]">
                  <a
                    href="#download"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[#ECE8FF] text-[#5B4BFF] font-semibold transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download</span>
                  </a>

                  <a
                    href="/history"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-black/[0.04] text-[#4B5563] hover:text-[#0A0A0C] transition-colors"
                  >
                    <Clock className="w-4 h-4 text-[#9CA3AF]" />
                    <span>History</span>
                  </a>

                  <a
                    href="#playlists"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-black/[0.04] text-[#4B5563] hover:text-[#0A0A0C] transition-colors"
                  >
                    <FolderHeart className="w-4 h-4 text-[#9CA3AF]" />
                    <span>Playlists</span>
                  </a>

                  <a
                    href="#favorites"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-black/[0.04] text-[#4B5563] hover:text-[#0A0A0C] transition-colors"
                  >
                    <Heart className="w-4 h-4 text-[#9CA3AF]" />
                    <span>Favorites</span>
                  </a>

                  <a
                    href="#convert"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-black/[0.04] text-[#4B5563] hover:text-[#0A0A0C] transition-colors"
                  >
                    <Repeat className="w-4 h-4 text-[#9CA3AF]" />
                    <span>Convert</span>
                  </a>

                  <a
                    href="#settings"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-black/[0.04] text-[#4B5563] hover:text-[#0A0A0C] transition-colors"
                  >
                    <Settings className="w-4 h-4 text-[#9CA3AF]" />
                    <span>Settings</span>
                  </a>
                </nav>
              </div>

              {/* Bottom Storage Widget */}
              <div className="pt-4 border-t border-[#E5E7EB] space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[#374151]">
                  <div className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-[#6B7280]" />
                    <span>Storage</span>
                  </div>
                </div>

                <div className="text-[11px] text-[#6B7280]">
                  12.4 GB <span className="text-[#9CA3AF]">of 50 GB used</span>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
                  <div className="h-full w-[25%] bg-[#5B4BFF] rounded-full" />
                </div>

                <button
                  type="button"
                  className="w-full py-1.5 mt-1 rounded-md bg-white border border-[#D1D5DB] hover:border-[#9CA3AF] text-[11.5px] font-semibold text-[#1F2937] shadow-2xs transition-colors"
                >
                  Upgrade
                </button>
              </div>
            </div>

            {/* MAIN APP CONTENT AREA */}
            <div className="flex-1 p-5 sm:p-6 bg-white flex flex-col justify-between">
              <div>
                
                {/* Content Header: "Your Videos" + Search & Toggle */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#F3F4F6]">
                  <h3 className="font-display font-[800] text-lg sm:text-xl text-[#0A0A0C]">
                    Your Videos
                  </h3>

                  <div className="flex items-center gap-2.5">
                    {/* Search Bar */}
                    <div className="relative flex items-center">
                      <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-3 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search videos..."
                        className="pl-8 pr-3 py-1.5 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-xs focus:outline-none focus:border-[#5B4BFF] text-[#1F2937] placeholder:text-[#9CA3AF] w-36 sm:w-48 transition-colors"
                      />
                    </div>

                    {/* View Switcher Toggle */}
                    <div className="flex items-center rounded-lg border border-[#E5E7EB] p-0.5 bg-[#F9FAFB]">
                      <button className="p-1 rounded-md bg-white shadow-2xs text-[#1F2937]">
                        <LayoutGrid className="w-3.5 h-3.5" />
                      </button>
                      <button className="p-1 rounded-md text-[#9CA3AF] hover:text-[#1F2937]">
                        <List className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Filter Tabs Row */}
                <div className="flex items-center gap-1.5 overflow-x-auto py-3 no-scrollbar text-xs font-semibold">
                  {CATEGORY_TABS.map((tab) => {
                    const isActive = activeTab === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                          'px-3 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer',
                          isActive
                            ? 'bg-[#ECE8FF] text-[#5B4BFF] font-bold'
                            : 'text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6]'
                        )}
                      >
                        {tab}
                      </button>
                    );
                  })}
                </div>

                {/* 4x2 Video Card Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 pt-2">
                  {DEMO_VIDEOS.map((vid) => (
                    <div
                      key={vid.id}
                      className="group/card rounded-xl border border-[#E5E7EB] hover:border-[#D1D5DB] bg-white p-2 transition-all duration-200 hover:shadow-sm"
                    >
                      {/* Video Thumbnail with duration badge */}
                      <div className="relative aspect-[16/10] w-full rounded-lg overflow-hidden bg-black/5">
                        <img
                          src={vid.thumbnail}
                          alt={vid.title}
                          className="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[9.5px] font-mono font-medium text-white">
                          {vid.duration}
                        </div>
                      </div>

                      {/* Video Details */}
                      <div className="pt-2 px-1 space-y-1">
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {vid.platformIcon}
                            <h4 className="font-sans font-bold text-xs text-[#111827] truncate">
                              {vid.title}
                            </h4>
                          </div>
                          <button className="text-[#9CA3AF] hover:text-[#111827] p-0.5">
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-[#6B7280] font-sans">
                          <span>{vid.quality} · {vid.size}</span>
                        </div>

                        <div className="text-[9.5px] text-[#9CA3AF] font-sans">
                          {vid.timestamp}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

              </div>
            </div>

          </div>
        </motion.div>

        {/* ===================================================================
            4. LOWER FEATURE NAVIGATION & EXPLORE CALLOUT
            =================================================================== */}
        <div className="mt-12 sm:mt-16 flex flex-col items-center space-y-4">
          {/* Feature Navigation Tabs */}
          <div className="inline-flex items-center gap-1.5 p-1 rounded-xl bg-[#F3F4F6] border border-[#E5E7EB] text-xs font-semibold">
            {['Download', 'Organize', 'Convert', 'Create'].map((tab) => {
              const isActive = featureTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFeatureTab(tab)}
                  className={cn(
                    'px-4 py-1.5 rounded-lg transition-all cursor-pointer',
                    isActive
                      ? 'bg-white text-[#0A0A0C] shadow-2xs font-bold'
                      : 'text-[#6B7280] hover:text-[#111827]'
                  )}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {/* Subtitle Message */}
          <p className="text-sm text-[#4B5563] font-sans">
            Download and manage videos from your favorite platforms, in one simple workspace.
          </p>

          {/* Explore Link */}
          <a
            href="/download"
            className="text-xs font-semibold text-[#0A0A0C] hover:text-[#5B4BFF] underline underline-offset-4 transition-colors flex items-center gap-1 group"
          >
            <span>Explore Vidleo</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </a>
        </div>

      </div>
    </section>
  );
}
