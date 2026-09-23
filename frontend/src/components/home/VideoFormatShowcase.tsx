'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Play, 
  Pause, 
  ArrowDown, 
  Link2, 
  FolderDown,
  Youtube
} from 'lucide-react';

export function VideoFormatShowcase() {
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);

  const togglePlay = (id: string) => {
    setPlayingVideo(prev => prev === id ? null : id);
  };

  return (
    <section className="relative w-full pt-8 sm:pt-10 pb-0 px-4 sm:px-6 lg:px-8 bg-white text-[#0A0A0C] font-sans select-none overflow-hidden">
      <div className="max-w-[1360px] mx-auto space-y-10 sm:space-y-14">
        
        {/* ===================================================================
            1. TOP EDITORIAL HEADER
            Left: Main black title + gray supporting subtitle
            Right: Outlined rounded CTA button ("Contact sales")
            =================================================================== */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 sm:gap-8">
          <div className="max-w-2xl space-y-2.5">
            {/* Main Title */}
            <h2 className="font-display font-[850] sm:font-[900] text-3xl sm:text-5xl lg:text-[54px] text-[#0A0A0C] tracking-[-0.035em] leading-[1.06]">
              The all-in-one video platform<br />
              for modern creators.
            </h2>

            {/* Gray Subtitle */}
            <p className="font-display font-normal text-xl sm:text-2xl lg:text-[28px] text-[#71717A] tracking-[-0.015em] leading-snug">
              Download, organize and manage<br className="hidden sm:inline" /> videos from anywhere.
            </p>
          </div>

          {/* Right-side Outlined CTA */}
          <div className="self-start md:self-auto pt-1 sm:pt-2">
            <button 
              type="button"
              className="inline-flex items-center justify-center px-6 sm:px-8 py-2.5 sm:py-3 rounded-full border border-black/80 hover:border-black bg-white hover:bg-black/5 text-[#0A0A0C] font-medium text-sm sm:text-base tracking-tight transition-all duration-200 active:scale-95 shadow-sm"
            >
              Contact sales
            </button>
          </div>
        </div>

        {/* ===================================================================
            2. MAIN HORIZONTAL EDITORIAL COLLAGE
            One continuous composition matching the reference image layout.
            Left area (gray neutral): Download interaction + Mountain video + Yellow tag + Canopy
            Right area (soft blue): Main editorial highlight + City Lights + Central Ocean video + Study With Me + Nature Sounds + Color palette bar
            =================================================================== */}
        <div className="w-full rounded-2xl sm:rounded-3xl border border-black/5 bg-[#ECECED] shadow-[0_20px_50px_rgba(0,0,0,0.06)] overflow-hidden">
          
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[460px] lg:min-h-[500px]">
            
            {/* -------------------------------------------------------------
                LEFT SECTION (cols 1-5): Gray neutral canvas with download
                interaction widget, vertical mountain card, and yellow label
                ------------------------------------------------------------- */}
            <div className="lg:col-span-5 bg-[#E7E7E9] p-4 sm:p-6 lg:p-7 relative flex flex-col justify-between overflow-hidden border-b lg:border-b-0 lg:border-r border-black/5">
              
              {/* Top Row: Cloud download interaction + Mountain video card */}
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5">
                
                {/* Far Left: Sky/Cloud interaction with 3 frosted circular icons */}
                <div className="relative w-full sm:w-[170px] lg:w-[190px] h-[110px] sm:h-[120px] rounded-xl overflow-hidden shadow-md group shrink-0">
                  <img 
                    src="https://images.unsplash.com/photo-1534088568595-a066f410bcda?q=80&w=400&auto=format&fit=crop" 
                    alt="Cloud Sky" 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                  />
                  
                  {/* Frosted Control Bar with 3 Icons */}
                  <div className="absolute inset-0 flex items-center justify-center p-2">
                    <div className="flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-full bg-white/35 backdrop-blur-md border border-white/50 shadow-lg">
                      {/* Download Icon */}
                      <button 
                        aria-label="Download"
                        className="w-7 h-7 rounded-full bg-white/40 hover:bg-white/80 flex items-center justify-center text-[#0A0A0C] transition-colors"
                      >
                        <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                      </button>

                      {/* Center Link Icon (Prominent Pill) */}
                      <button 
                        aria-label="Paste Link"
                        className="w-9 h-7 rounded-full bg-white/70 hover:bg-white flex items-center justify-center text-[#0A0A0C] shadow-sm transition-colors"
                      >
                        <Link2 className="w-4 h-4 stroke-[2.5]" />
                      </button>

                      {/* Folder / Save Icon */}
                      <button 
                        aria-label="Save to Folder"
                        className="w-7 h-7 rounded-full bg-white/40 hover:bg-white/80 flex items-center justify-center text-[#0A0A0C] transition-colors"
                      >
                        <FolderDown className="w-3.5 h-3.5 stroke-[2.5]" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Vertical Mountain Video Card */}
                <motion.div 
                  whileHover={{ y: -4 }}
                  className="w-full sm:w-[200px] lg:w-[220px] rounded-2xl bg-white p-2.5 shadow-xl border border-black/5 shrink-0"
                >
                  <div className="relative aspect-[16/10] w-full rounded-xl overflow-hidden bg-black/10">
                    <img 
                      src="https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=400&auto=format&fit=crop" 
                      alt="A Day in the Mountains" 
                      className="w-full h-full object-cover" 
                    />
                    {/* Duration Badge */}
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-white font-mono text-[10px] font-bold">
                      12:34
                    </span>
                  </div>

                  {/* Card Meta */}
                  <div className="pt-2.5 px-0.5 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-4 rounded-sm bg-red-600 flex items-center justify-center shrink-0">
                        <Youtube className="w-3 h-3 text-white fill-white" />
                      </div>
                      <h4 className="font-display font-bold text-xs text-[#0A0A0C] truncate">
                        A Day in the Mountains
                      </h4>
                    </div>
                    <p className="text-[10px] font-medium text-black/50 pl-5.5 font-mono">
                      1080p · MP4 · 120 MB
                    </p>
                  </div>
                </motion.div>

              </div>

              {/* Bottom Row: DOWNLOAD ANY VIDEO Highlight Tag + Overlapping Canopy Thumbnail */}
              <div className="mt-6 sm:mt-8 flex items-end justify-between gap-4">
                
                {/* Yellow Highlight Label */}
                <div className="space-y-1">
                  <div className="inline-block bg-[#D7F538] text-[#0A0A0C] font-display font-[950] text-lg sm:text-xl lg:text-2xl uppercase tracking-[-0.03em] px-2.5 py-0.5 leading-tight shadow-sm">
                    DOWNLOAD
                  </div>
                  <br />
                  <div className="inline-block bg-[#D7F538] text-[#0A0A0C] font-display font-[950] text-lg sm:text-xl lg:text-2xl uppercase tracking-[-0.03em] px-2.5 py-0.5 leading-tight shadow-sm">
                    ANY VIDEO
                  </div>
                </div>

                {/* Overlapping Architectural Canopy Image with Play Button */}
                <div className="relative w-[130px] sm:w-[150px] lg:w-[165px] h-[100px] sm:h-[110px] rounded-xl overflow-hidden shadow-lg border border-white/40 group">
                  <img 
                    src="https://images.unsplash.com/photo-1513694203232-719a280e022f?q=80&w=400&auto=format&fit=crop" 
                    alt="Canopy Architecture" 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                  />
                  
                  {/* Play Button */}
                  <button 
                    onClick={() => togglePlay('canopy')}
                    aria-label="Play Video"
                    className="absolute inset-0 m-auto w-9 h-9 rounded-full bg-white/95 text-[#0A0A0C] flex items-center justify-center shadow-md hover:scale-110 active:scale-95 transition-all"
                  >
                    {playingVideo === 'canopy' ? (
                      <Pause className="w-3.5 h-3.5 fill-black" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                    )}
                  </button>
                </div>

              </div>

            </div>

            {/* -------------------------------------------------------------
                RIGHT SECTION (cols 6-12): Sky blue canvas with main headline,
                central video focal feature, supporting cards, and color stripe
                ------------------------------------------------------------- */}
            <div className="lg:col-span-7 bg-[#DBECFD] p-4 sm:p-6 lg:p-7 relative flex flex-col justify-between overflow-hidden">
              
              {/* Top: Large Editorial Highlight "YOUR VIDEOS ONE PLACE" */}
              <div className="space-y-1">
                <div className="inline-block bg-[#D7F538] text-[#0A0A0C] font-display font-[950] text-2xl sm:text-4xl lg:text-[42px] uppercase tracking-[-0.035em] px-3 sm:px-4 py-0.5 leading-none shadow-sm">
                  YOUR VIDEOS
                </div>
                <br />
                <div className="inline-block bg-[#D7F538] text-[#0A0A0C] font-display font-[950] text-2xl sm:text-4xl lg:text-[42px] uppercase tracking-[-0.035em] px-3 sm:px-4 py-0.5 leading-none shadow-sm">
                  ONE PLACE
                </div>
              </div>

              {/* Middle/Bottom Row: Video Cards Composition (City Lights + Chill Vibes + Study With Me + Nature Sounds) */}
              <div className="mt-6 sm:mt-8 flex flex-wrap lg:flex-nowrap items-end gap-3 sm:gap-4 pr-7 sm:pr-8">
                
                {/* 1. City Lights Card */}
                <div className="w-[110px] sm:w-[125px] shrink-0 space-y-1.5">
                  <div className="relative aspect-[3/4] w-full rounded-xl overflow-hidden bg-black/10 shadow-md group">
                    <img 
                      src="https://images.unsplash.com/photo-1519501025264-65ba15a82390?q=80&w=300&auto=format&fit=crop" 
                      alt="City Lights" 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                    />
                    <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white font-mono text-[9px] font-bold">
                      03:45
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    <h5 className="font-display font-bold text-xs text-[#0A0A0C] truncate">
                      City Lights
                    </h5>
                    <p className="text-[10px] font-mono text-black/60 font-medium">
                      4K · MP4<br />320 MB
                    </p>
                  </div>
                </div>

                {/* 2. Central Focal Feature: Chill Vibes Playlist (Ocean Sunset) */}
                <motion.div 
                  whileHover={{ y: -4 }}
                  className="w-full sm:w-[260px] lg:w-[280px] shrink-0 space-y-1.5"
                >
                  <div className="relative aspect-[16/10] w-full rounded-2xl overflow-hidden bg-black/10 shadow-xl border border-white/60 group">
                    <img 
                      src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=600&auto=format&fit=crop" 
                      alt="Chill Vibes Ocean Sunset" 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" 
                    />
                    
                    {/* Big Center Play Button */}
                    <button 
                      onClick={() => togglePlay('chill')}
                      aria-label="Play Chill Vibes Video"
                      className="absolute inset-0 m-auto w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white/95 text-[#0A0A0C] flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all group-hover:bg-white"
                    >
                      {playingVideo === 'chill' ? (
                        <Pause className="w-5 h-5 fill-black" />
                      ) : (
                        <Play className="w-5 h-5 fill-black ml-0.5" />
                      )}
                    </button>

                    {/* Duration Badge */}
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-white font-mono text-[10px] font-bold">
                      15:06
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    <h5 className="font-display font-bold text-xs sm:text-sm text-[#0A0A0C]">
                      Chill Vibes Playlist
                    </h5>
                    <p className="text-[10px] sm:text-[11px] font-mono text-black/60 font-medium">
                      1080p · MP4 · 240 MB
                    </p>
                  </div>
                </motion.div>

                {/* 3. Study With Me (Person with Headphones) */}
                <div className="w-[105px] sm:w-[120px] shrink-0 space-y-1.5">
                  <div className="relative aspect-[3/4] w-full rounded-xl overflow-hidden bg-black/10 shadow-md group">
                    <img 
                      src="https://images.unsplash.com/photo-1516280440614-37939bbacd81?q=80&w=300&auto=format&fit=crop" 
                      alt="Study With Me" 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                    />
                    <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white font-mono text-[9px] font-bold">
                      08:21
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    <h5 className="font-display font-bold text-xs text-[#0A0A0C] truncate">
                      Study With Me
                    </h5>
                    <p className="text-[10px] font-mono text-black/60 font-medium">
                      720p · MP4<br />85 MB
                    </p>
                  </div>
                </div>

                {/* 4. Nature Sounds (Forest) */}
                <div className="w-[105px] sm:w-[120px] shrink-0 space-y-1.5">
                  <div className="relative aspect-[3/4] w-full rounded-xl overflow-hidden bg-black/10 shadow-md group">
                    <img 
                      src="https://images.unsplash.com/photo-1448375240586-882707db888b?q=80&w=300&auto=format&fit=crop" 
                      alt="Nature Sounds" 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                    />
                    <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white font-mono text-[9px] font-bold">
                      20:18
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    <h5 className="font-display font-bold text-xs text-[#0A0A0C] truncate">
                      Nature Sounds
                    </h5>
                    <p className="text-[10px] font-mono text-black/60 font-medium">
                      1080p · MP4<br />310 MB
                    </p>
                  </div>
                </div>

              </div>

              {/* Far Right Vertical Color Swatch Bar (Matching Reference) */}
              <div className="absolute top-0 right-0 bottom-0 w-4 sm:w-5 flex flex-col">
                <div className="flex-1 bg-[#B4F842]" />
                <div className="flex-1 bg-[#22C55E]" />
                <div className="flex-1 bg-[#0F766E]" />
                <div className="flex-1 bg-[#3B82F6]" />
                <div className="flex-1 bg-[#6366F1]" />
              </div>

            </div>

          </div>

        </div>

      </div>
    </section>
  );
}

