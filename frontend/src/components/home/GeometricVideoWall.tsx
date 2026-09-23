'use client';

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { 
  Play, 
  Pause, 
  ChevronUp, 
  ChevronDown, 
  ArrowRight, 
  Sparkles, 
  Volume2, 
  VolumeX, 
  Maximize, 
  X,
  Menu
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TriangleItem {
  id: string;
  type: 'up' | 'down';
  title: string;
  badge: string;
  resolution: string;
  imgUrl: string;
  videoUrl?: string;
}

interface SceneData {
  id: string;
  index: string;
  name: string;
  subtitle: string;
  description: string;
  triangles: TriangleItem[];
}

const SCENES: SceneData[] = [
  {
    id: 'cinema',
    index: '01',
    name: 'CINEMA',
    subtitle: 'High-Fidelity 4K & Film Pipeline',
    description: 'Extract, transform and preserve raw 4K UHD and ProRes streams with direct manifest chunking.',
    triangles: [
      // Top Row (5 items)
      { id: 'c1', type: 'up', title: 'Alpine Dawn', badge: '4K UHD', resolution: '3840×2160', imgUrl: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?q=80&w=600&auto=format&fit=crop' },
      { id: 'c2', type: 'down', title: 'Cyber Lighting', badge: '60 FPS', resolution: '3840×2160', imgUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=600&auto=format&fit=crop' },
      { id: 'c3', type: 'up', title: 'Color Grading', badge: 'RAW DCI', resolution: '4096×2160', imgUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=600&auto=format&fit=crop' },
      { id: 'c4', type: 'down', title: 'Studio Rig', badge: 'PRORES', resolution: '3840×2160', imgUrl: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=600&auto=format&fit=crop' },
      { id: 'c5', type: 'up', title: 'Anamorphic Frame', badge: '2.39:1', resolution: '4K CINEMA', imgUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?q=80&w=600&auto=format&fit=crop' },
      // Middle Row Left (4 items)
      { id: 'c6', type: 'down', title: 'Tokyo Night', badge: 'HDR10', resolution: '3840×2160', imgUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=600&auto=format&fit=crop' },
      { id: 'c7', type: 'up', title: 'Master Shot', badge: '60 FPS', resolution: '3840×2160', imgUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=600&auto=format&fit=crop' },
      { id: 'c8', type: 'down', title: 'Lens Flares', badge: '4K UHD', resolution: '3840×2160', imgUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=600&auto=format&fit=crop' },
      { id: 'c9', type: 'up', title: 'Aerial Horizon', badge: '60 FPS', resolution: '3840×2160', imgUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=600&auto=format&fit=crop' },
      // Bottom Row (5 items)
      { id: 'c10', type: 'up', title: 'Nordic Winter', badge: '4K UHD', resolution: '3840×2160', imgUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=600&auto=format&fit=crop' },
      { id: 'c11', type: 'down', title: 'Studio Sound', badge: '320K', resolution: '48.0 kHz', imgUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=600&auto=format&fit=crop' },
      { id: 'c12', type: 'up', title: 'Camera Optics', badge: 'MASTER', resolution: '3840×2160', imgUrl: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=600&auto=format&fit=crop' },
      { id: 'c13', type: 'down', title: 'Monochrome Film', badge: '35MM', resolution: '4K RAW', imgUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?q=80&w=600&auto=format&fit=crop' },
      { id: 'c14', type: 'up', title: 'Golden Hour', badge: '60 FPS', resolution: '3840×2160', imgUrl: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?q=80&w=600&auto=format&fit=crop' },
    ],
  },
  {
    id: 'social',
    index: '02',
    name: 'SOCIAL',
    subtitle: 'Vertical Reels & Multi-Feed Mux',
    description: 'Clean vertical media extraction without intrusive watermarks, synchronized for Reels, Shorts & TikTok.',
    triangles: [
      { id: 's1', type: 'up', title: 'Street Movement', badge: '9:16', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=600&auto=format&fit=crop' },
      { id: 's2', type: 'down', title: 'Fashion Reel', badge: '60 FPS', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=600&auto=format&fit=crop' },
      { id: 's3', type: 'up', title: 'Urban Flow', badge: '1:1', resolution: '1080×1080', imgUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=600&auto=format&fit=crop' },
      { id: 's4', type: 'down', title: 'Micro Clip', badge: '9:16', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=600&auto=format&fit=crop' },
      { id: 's5', type: 'up', title: 'Story Stream', badge: '60 FPS', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=600&auto=format&fit=crop' },
      { id: 's6', type: 'down', title: 'Creator Feed', badge: 'SYNCED', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=600&auto=format&fit=crop' },
      { id: 's7', type: 'up', title: 'Viral Audio', badge: '320K', resolution: 'AUDIO MUX', imgUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=600&auto=format&fit=crop' },
      { id: 's8', type: 'down', title: 'Short Format', badge: '9:16', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?q=80&w=600&auto=format&fit=crop' },
      { id: 's9', type: 'up', title: 'Dynamic Beat', badge: '60 FPS', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=600&auto=format&fit=crop' },
      { id: 's10', type: 'up', title: 'TikTok Feed', badge: '9:16', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=600&auto=format&fit=crop' },
      { id: 's11', type: 'down', title: 'Insta Reel', badge: 'FHD', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?q=80&w=600&auto=format&fit=crop' },
      { id: 's12', type: 'up', title: 'Mobile Canvas', badge: '60 FPS', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=600&auto=format&fit=crop' },
      { id: 's13', type: 'down', title: 'Shorts Track', badge: 'SYNC', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=600&auto=format&fit=crop' },
      { id: 's14', type: 'up', title: 'Visual Impact', badge: '9:16', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=600&auto=format&fit=crop' },
    ],
  },
  {
    id: 'creator',
    index: '03',
    name: 'CREATOR',
    subtitle: 'Studio Audio & Video Stems',
    description: 'Isolate crystal-clear commentary, soundscapes, background music, and lossless audio tracks.',
    triangles: [
      { id: 'cr1', type: 'up', title: 'Studio Podcast', badge: '320K', resolution: '48.0 kHz', imgUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr2', type: 'down', title: 'Tape Session', badge: 'LOSSLESS', resolution: '24-BIT', imgUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr3', type: 'up', title: 'Voice Iso', badge: 'STEM', resolution: 'WAV MASTER', imgUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr4', type: 'down', title: 'Equalizer Node', badge: 'AAC', resolution: '256 KBPS', imgUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr5', type: 'up', title: 'Audio Clean', badge: 'FLAC', resolution: 'LOSSLESS', imgUrl: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr6', type: 'down', title: 'Soundscape', badge: '48kHz', resolution: 'STEREO', imgUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr7', type: 'up', title: 'Audio Sync', badge: '320K', resolution: 'MP3 PRO', imgUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr8', type: 'down', title: 'Broadcast Voice', badge: 'WAV', resolution: '48.0 kHz', imgUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr9', type: 'up', title: 'Acoustic Stem', badge: 'STEM', resolution: 'LOSSLESS', imgUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr10', type: 'up', title: 'Master Console', badge: 'DAW', resolution: '24-BIT', imgUrl: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr11', type: 'down', title: 'Studio Mic', badge: '320K', resolution: 'AUDIO', imgUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr12', type: 'up', title: 'Harmonic Mix', badge: 'FLAC', resolution: 'LOSSLESS', imgUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr13', type: 'down', title: 'Sound Design', badge: 'PRO', resolution: '48.0 kHz', imgUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=600&auto=format&fit=crop' },
      { id: 'cr14', type: 'up', title: 'Clean Audio', badge: '320K', resolution: 'MP3', imgUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=600&auto=format&fit=crop' },
    ],
  },
  {
    id: 'media',
    index: '04',
    name: 'MEDIA',
    subtitle: 'Unified Multi-Platform Destination',
    description: 'One single ingestion pipeline transforming videos across YouTube, Vimeo, Instagram, X, TikTok, and Reddit.',
    triangles: [
      { id: 'm1', type: 'up', title: 'Cross Engine', badge: 'MULTI', resolution: '4K/FHD', imgUrl: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=600&auto=format&fit=crop' },
      { id: 'm2', type: 'down', title: 'Buffer Sync', badge: 'CDN', resolution: 'FAST CHUNK', imgUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=600&auto=format&fit=crop' },
      { id: 'm3', type: 'up', title: 'Video Format', badge: 'MP4', resolution: 'CONTAINER', imgUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=600&auto=format&fit=crop' },
      { id: 'm4', type: 'down', title: 'Audio Stream', badge: 'MP3', resolution: '320 KBPS', imgUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=600&auto=format&fit=crop' },
      { id: 'm5', type: 'up', title: 'Social Stream', badge: '9:16', resolution: '1080×1920', imgUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=600&auto=format&fit=crop' },
      { id: 'm6', type: 'down', title: 'Cinema Feed', badge: '4K', resolution: '3840×2160', imgUrl: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?q=80&w=600&auto=format&fit=crop' },
      { id: 'm7', type: 'up', title: 'Direct Node', badge: 'ZERO LOSS', resolution: 'UNCOMPRESSED', imgUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=600&auto=format&fit=crop' },
      { id: 'm8', type: 'down', title: 'Format Mux', badge: 'NATIVE', resolution: 'PRORES', imgUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?q=80&w=600&auto=format&fit=crop' },
      { id: 'm9', type: 'up', title: 'Web Pipeline', badge: '60 FPS', resolution: '1080P', imgUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=600&auto=format&fit=crop' },
      { id: 'm10', type: 'up', title: 'Platform Engine', badge: 'GLOBAL', resolution: '7 NETWORKS', imgUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=600&auto=format&fit=crop' },
      { id: 'm11', type: 'down', title: 'Fast Routing', badge: 'CHUNK', resolution: '100% RAW', imgUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=600&auto=format&fit=crop' },
      { id: 'm12', type: 'up', title: 'Instant Media', badge: '4K UHD', resolution: 'READY', imgUrl: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=600&auto=format&fit=crop' },
      { id: 'm13', type: 'down', title: 'Audio Master', badge: '320K', resolution: 'FLAC', imgUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=600&auto=format&fit=crop' },
      { id: 'm14', type: 'up', title: 'Extraction Wall', badge: 'MEDIA', resolution: 'COMPLETE', imgUrl: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?q=80&w=600&auto=format&fit=crop' },
    ],
  },
];

export function GeometricVideoWall() {
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0);
  const [hoveredTriangle, setHoveredTriangle] = useState<string | null>(null);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [mouseParallax, setMouseParallax] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  const currentScene = SCENES[currentSceneIdx];

  const handleNextScene = () => {
    setCurrentSceneIdx((prev) => (prev + 1) % SCENES.length);
  };

  const handlePrevScene = () => {
    setCurrentSceneIdx((prev) => (prev - 1 + SCENES.length) % SCENES.length);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || shouldReduceMotion) return;
    const rect = containerRef.current.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    setMouseParallax({ x: nx * 18, y: ny * 18 });
  };

  return (
    <section className="relative w-full pt-14 sm:pt-20 pb-8 sm:pb-12 px-4 sm:px-6 lg:px-8 bg-[#F6F6F8] overflow-hidden">
      <div className="max-w-[1340px] mx-auto relative z-10">
        
        {/* ===================================================================
            MAIN EDITORIAL BLACK CANVAS / ARTBOARD
            Exact reproduction of the reference composition:
            - Crisp dark artboard with subtle border
            - Internal top navigation
            - Geometric triangular video mosaic
            - Oversized "VIDEO" typography
            - Left vertical scene switcher (01, 02, 03, 04)
            - Bottom editorial description & platform links
            =================================================================== */}
        <div
          ref={containerRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setMouseParallax({ x: 0, y: 0 })}
          className="relative w-full rounded-[20px] sm:rounded-[28px] bg-[#07070A] border border-black/[0.15] shadow-2xl p-6 sm:p-10 lg:p-12 overflow-hidden text-white select-none"
        >
          {/* Subtle Canvas Grid Texture */}
          <div 
            className="absolute inset-0 pointer-events-none opacity-15"
            style={{
              backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.15) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          />

          {/* =================================================================
              1. TOP NAVIGATION INSIDE ARTBOARD (Reference Match)
              ================================================================= */}
          <div className="flex items-center justify-between pb-8 sm:pb-12 border-b border-white/[0.08] relative z-20">
            {/* Left Brand Identity */}
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-[#CCFF00] shadow-[0_0_10px_#CCFF00]" />
              <span className="font-display font-[850] text-sm sm:text-base tracking-wider text-white">
                VIDLEO
              </span>
              <span className="hidden sm:inline text-[10px] font-mono text-white/40 tracking-widest pl-2 border-l border-white/10 uppercase">
                MEDIA EXTRACTION ENGINE
              </span>
            </div>

            {/* Right Navigation Links */}
            <div className="flex items-center gap-6 sm:gap-8 text-xs font-mono font-medium text-white/70">
              <a href="/supported-sites" className="hover:text-white transition-colors hidden sm:inline">
                SUPPORTED SITES
              </a>
              <a href="/#how-it-works" className="hover:text-white transition-colors hidden md:inline">
                HOW IT WORKS
              </a>
              <a href="/about" className="hover:text-white transition-colors hidden md:inline">
                ABOUT
              </a>
              <a href="/#faq" className="hover:text-white transition-colors hidden sm:inline">
                FAQ
              </a>
              <div className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors">
                <Menu className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* =================================================================
              2. MAIN INTERACTIVE GEOMETRIC STAGE
              Left: Vertical 01-04 Scene Switcher
              Center: Interlocking Triangular Video Mosaic
              Right: Oversized "VIDEO" Typography & Integrated Play Action
              ================================================================= */}
          <div className="relative z-20 py-8 sm:py-12 flex flex-col lg:flex-row items-center justify-between gap-8 lg:gap-12 min-h-[520px]">
            
            {/* LEFT: VERTICAL SCENE CONTROLLER (Reference Match: ↑ 01 02 03 04 ↓) */}
            <div className="hidden lg:flex flex-col items-center gap-4 text-xs font-mono text-white/50 shrink-0 select-none">
              <button
                type="button"
                onClick={handlePrevScene}
                className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/20 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                title="Previous scene"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>

              <div className="flex flex-col items-center gap-3 py-2">
                {SCENES.map((scene, idx) => (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => setCurrentSceneIdx(idx)}
                    className={cn(
                      "text-xs font-mono transition-all cursor-pointer flex items-center gap-2",
                      currentSceneIdx === idx 
                        ? "text-white font-bold scale-125" 
                        : "text-white/30 hover:text-white/70"
                    )}
                  >
                    <span>{scene.index}</span>
                    {currentSceneIdx === idx && (
                      <span className="w-1 h-1 rounded-full bg-[#CCFF00]" />
                    )}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleNextScene}
                className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/20 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                title="Next scene"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* CENTER & RIGHT COMPOSITION: TRIANGULAR MOSAIC + OVERSIZED TYPOGRAPHY */}
            <div className="flex-1 w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              
              {/* TRIANGULAR GEOMETRIC MOSAIC (8 COLS ON DESKTOP) */}
              <div className="lg:col-span-8 relative">
                
                {/* Mathematical Interlocking Triangular Grid using CSS clip-path */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentScene.id}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    style={{
                      transform: shouldReduceMotion ? undefined : `translate3d(${mouseParallax.x}px, ${mouseParallax.y}px, 0px)`,
                    }}
                    className="relative w-full max-w-[620px] mx-auto flex flex-col items-center gap-1 sm:gap-1.5"
                  >
                    
                    {/* TOP ROW: 5 Interlocking Triangles (▲ ▼ ▲ ▼ ▲) */}
                    <div className="flex items-center justify-center -space-x-4 sm:-space-x-6 w-full">
                      {currentScene.triangles.slice(0, 5).map((tri) => (
                        <div
                          key={tri.id}
                          onMouseEnter={() => setHoveredTriangle(tri.id)}
                          onMouseLeave={() => setHoveredTriangle(null)}
                          className={cn(
                            "relative w-20 sm:w-28 md:w-32 aspect-square transition-all duration-300 cursor-pointer group",
                            hoveredTriangle === tri.id ? "z-30 scale-110 filter drop-shadow-[0_0_12px_rgba(204,255,0,0.5)]" : "z-10"
                          )}
                          style={{
                            clipPath: tri.type === 'up' 
                              ? 'polygon(50% 0%, 100% 100%, 0% 100%)' 
                              : 'polygon(0% 0%, 100% 0%, 50% 100%)',
                          }}
                        >
                          <img 
                            src={tri.imgUrl} 
                            alt={tri.title} 
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" 
                          />
                          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />

                          {/* Hover Tooltip Metadata */}
                          {hoveredTriangle === tri.id && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[1px] text-[8.5px] font-mono text-center p-1">
                              <div className="space-y-0.5">
                                <span className="text-[#CCFF00] font-bold block">{tri.badge}</span>
                                <span className="text-white/80 block">{tri.resolution}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* MIDDLE ROW: 4 Interlocking Triangles (▼ ▲ ▼ ▲) */}
                    <div className="flex items-center justify-center -space-x-4 sm:-space-x-6 w-full -my-3 sm:-my-5">
                      {currentScene.triangles.slice(5, 9).map((tri) => (
                        <div
                          key={tri.id}
                          onMouseEnter={() => setHoveredTriangle(tri.id)}
                          onMouseLeave={() => setHoveredTriangle(null)}
                          className={cn(
                            "relative w-20 sm:w-28 md:w-32 aspect-square transition-all duration-300 cursor-pointer group",
                            hoveredTriangle === tri.id ? "z-30 scale-110 filter drop-shadow-[0_0_12px_rgba(204,255,0,0.5)]" : "z-10"
                          )}
                          style={{
                            clipPath: tri.type === 'up' 
                              ? 'polygon(50% 0%, 100% 100%, 0% 100%)' 
                              : 'polygon(0% 0%, 100% 0%, 50% 100%)',
                          }}
                        >
                          <img 
                            src={tri.imgUrl} 
                            alt={tri.title} 
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" 
                          />
                          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />

                          {hoveredTriangle === tri.id && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[1px] text-[8.5px] font-mono text-center p-1">
                              <div className="space-y-0.5">
                                <span className="text-[#CCFF00] font-bold block">{tri.badge}</span>
                                <span className="text-white/80 block">{tri.resolution}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* BOTTOM ROW: 5 Interlocking Triangles (▲ ▼ ▲ ▼ ▲) */}
                    <div className="flex items-center justify-center -space-x-4 sm:-space-x-6 w-full">
                      {currentScene.triangles.slice(9, 14).map((tri) => (
                        <div
                          key={tri.id}
                          onMouseEnter={() => setHoveredTriangle(tri.id)}
                          onMouseLeave={() => setHoveredTriangle(null)}
                          className={cn(
                            "relative w-20 sm:w-28 md:w-32 aspect-square transition-all duration-300 cursor-pointer group",
                            hoveredTriangle === tri.id ? "z-30 scale-110 filter drop-shadow-[0_0_12px_rgba(204,255,0,0.5)]" : "z-10"
                          )}
                          style={{
                            clipPath: tri.type === 'up' 
                              ? 'polygon(50% 0%, 100% 100%, 0% 100%)' 
                              : 'polygon(0% 0%, 100% 0%, 50% 100%)',
                          }}
                        >
                          <img 
                            src={tri.imgUrl} 
                            alt={tri.title} 
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" 
                          />
                          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />

                          {hoveredTriangle === tri.id && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[1px] text-[8.5px] font-mono text-center p-1">
                              <div className="space-y-0.5">
                                <span className="text-[#CCFF00] font-bold block">{tri.badge}</span>
                                <span className="text-white/80 block">{tri.resolution}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                  </motion.div>
                </AnimatePresence>

              </div>

              {/* OVERSIZED TYPOGRAPHY & PLAY ACTION (4 COLS ON DESKTOP) */}
              <div className="lg:col-span-4 flex flex-col items-center lg:items-start text-center lg:text-left space-y-4">
                
                {/* Eyebrow Label */}
                <div className="text-[11px] font-mono tracking-widest text-white/50 uppercase font-semibold">
                  A SYNAPVO MEDIA SYSTEM
                </div>

                {/* Massive Hero Wordmark with Integrated Circular Play Button */}
                <div className="relative flex items-center">
                  <h2 className="font-display font-[900] text-6xl sm:text-7xl md:text-8xl lg:text-[100px] text-white tracking-[-0.05em] leading-none select-none">
                    V<span className="text-white">I</span>D
                  </h2>

                  {/* Circular Interactive Play Button embedded in Typography */}
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setVideoModalOpen(true)}
                    className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white text-black flex items-center justify-center mx-1 sm:mx-2 shadow-[0_0_30px_rgba(255,255,255,0.4)] hover:bg-[#CCFF00] transition-colors cursor-pointer group"
                    title="Play Media Reel"
                  >
                    <Play className="w-6 h-6 fill-black text-black ml-1 group-hover:scale-110 transition-transform" />
                  </motion.button>

                  <h2 className="font-display font-[900] text-6xl sm:text-7xl md:text-8xl lg:text-[100px] text-white tracking-[-0.05em] leading-none select-none">
                    EO
                  </h2>
                </div>

                {/* Active Scene Badge */}
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-mono text-[#CCFF00]">
                  <Sparkles className="w-3.5 h-3.5 text-[#CCFF00]" />
                  <span>SCENE {currentScene.index} — {currentScene.name}</span>
                </div>

                <p className="text-xs text-white/55 font-sans leading-relaxed max-w-xs">
                  {currentScene.subtitle}. High-bitrate transformation engine designed for cinematic resolution preservation.
                </p>

              </div>

            </div>

          </div>

          {/* =================================================================
              3. BOTTOM EDITORIAL METADATA & PLATFORM LINKS (Reference Match)
              ================================================================= */}
          <div className="pt-8 sm:pt-12 border-t border-white/[0.08] flex flex-col sm:flex-row items-center justify-between gap-6 relative z-20 text-xs font-mono">
            
            {/* Bottom-Left Editorial Description */}
            <div className="space-y-1 text-center sm:text-left max-w-md">
              <div 
                onClick={handleNextScene}
                className="inline-flex items-center gap-1.5 text-white font-bold hover:text-[#CCFF00] transition-colors cursor-pointer"
              >
                <span>Shift In Focus</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
              <p className="text-[11px] text-white/40 leading-relaxed font-sans">
                {currentScene.description}
              </p>
            </div>

            {/* Bottom Scene Counter */}
            <div className="text-xs font-mono text-white/60 font-semibold px-3 py-1 rounded-full bg-white/[0.04] border border-white/10">
              <span className="text-[#CCFF00] font-bold">{currentScene.index}</span>
              <span className="text-white/30 mx-1">/</span>
              <span>04</span>
            </div>

            {/* Bottom-Right Social / Platform Indicators */}
            <div className="flex items-center gap-4 text-white/40 text-xs">
              <span className="hover:text-white transition-colors cursor-pointer font-bold">YouTube</span>
              <span>·</span>
              <span className="hover:text-white transition-colors cursor-pointer font-bold">Instagram</span>
              <span>·</span>
              <span className="hover:text-white transition-colors cursor-pointer font-bold">Vimeo</span>
              <span>·</span>
              <span className="hover:text-white transition-colors cursor-pointer font-bold">𝕏</span>
            </div>

          </div>

        </div>

      </div>

      {/* Interactive Video Modal Preview */}
      <AnimatePresence>
        {videoModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-4xl rounded-[24px] bg-[#0A0A0E] border border-white/20 overflow-hidden shadow-2xl"
            >
              {/* Modal Top Bar */}
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#CCFF00] animate-pulse" />
                  <span className="text-xs font-mono font-bold text-white uppercase">
                    LIVE PIPELINE REEL — {currentScene.name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setVideoModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Video Element */}
              <div className="aspect-video w-full bg-black relative">
                <video
                  src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
                  autoPlay
                  controls
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </section>
  );
}
