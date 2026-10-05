'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Maximize, 
  Minimize, 
  Download, 
  Share2, 
  Copy, 
  Check, 
  Sparkles, 
  Clock, 
  Layers, 
  Film, 
  ExternalLink,
  ChevronRight,
  Settings,
  RotateCcw,
  CheckCircle2,
  FolderOpen
} from 'lucide-react';
import { StorageService } from '@/services/downloader/storageService';
import { HistoryItem } from '@/services/downloader/types';
import { cn, formatDuration } from '@/lib/utils';

interface MediaItem {
  id: string;
  title: string;
  description: string;
  source: string;
  authorName: string;
  authorAvatarUrl?: string;
  quality: string;
  frameRate: string;
  format: string;
  size: string;
  duration: string;
  durationSeconds: number;
  thumbnailUrl: string;
  videoUrl?: string;
  isReal?: boolean;
}

const DEFAULT_DEMO_MEDIA: MediaItem[] = [
  {
    id: 'demo-alpine',
    title: 'Cinematic 4K Landscape — Alpine Morning',
    description: 'Extract high-quality media directly from supported platforms without unnecessary complexity. Vidleo preserves the original media quality while giving you control over the format and resolution.',
    source: 'YouTube',
    authorName: 'Alpine Cinema Studio',
    authorAvatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=200&auto=format&fit=crop',
    quality: '4K UHD',
    frameRate: '60 FPS',
    format: 'MP4',
    size: '248 MB',
    duration: '06:24',
    durationSeconds: 384,
    thumbnailUrl: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?q=80&w=1200&auto=format&fit=crop',
    videoUrl: '/test-media/remux_4k_prof0.webm',
    isReal: false,
  },
  {
    id: 'demo-kyoto',
    title: 'Minimal Architecture — Kyoto Pavilions in Rain',
    description: 'Native stream extraction of 1080p 60fps video with balanced bitrate and accurate audio sync.',
    source: 'Vimeo',
    authorName: 'Kenzo Visuals',
    authorAvatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200&auto=format&fit=crop',
    quality: '1080p FHD',
    frameRate: '60 FPS',
    format: 'MP4',
    size: '94 MB',
    duration: '05:21',
    durationSeconds: 321,
    thumbnailUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=1200&auto=format&fit=crop',
    videoUrl: '/test-media/remux_1080p.mp4',
    isReal: false,
  },
  {
    id: 'demo-studio',
    title: 'Studio Session #04 — 432Hz Continuous Tape Loop',
    description: 'Lossless 320kbps MP3 audio stream parsed directly from high-fidelity source files.',
    source: 'SoundCloud',
    authorName: 'Synapvo Acoustic',
    authorAvatarUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=200&auto=format&fit=crop',
    quality: 'Lossless Audio',
    frameRate: '320 KBPS',
    format: 'MP3',
    size: '18.4 MB',
    duration: '08:42',
    durationSeconds: 522,
    thumbnailUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1200&auto=format&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    isReal: false,
  },
];

export function DownloadedVideoExperience() {
  const shouldReduceMotion = useReducedMotion();
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Active media item
  const [activeMedia, setActiveMedia] = useState<MediaItem>(DEFAULT_DEMO_MEDIA[0]);
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [hasRealHistory, setHasRealHistory] = useState(false);

  // Video playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(activeMedia.durationSeconds);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedQuality, setSelectedQuality] = useState('4K UHD · 60fps');
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const [downloadTriggered, setDownloadTriggered] = useState(false);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync real history from StorageService
  const loadUserHistory = useCallback(() => {
    const items = StorageService.getHistory();
    setHistoryList(items);
    if (items.length > 0) {
      setHasRealHistory(true);
      const latest = items[0];
      setActiveMedia({
        id: latest.id,
        title: latest.title,
        description: latest.subtitle || 'Direct stream extracted and preserved with native codec headers.',
        source: latest.platformName,
        authorName: latest.authorName || latest.platformName,
        authorAvatarUrl: latest.authorAvatarUrl,
        quality: latest.qualityLabel,
        frameRate: latest.qualityLabel.includes('60') ? '60 FPS' : '30 FPS',
        format: latest.container.toUpperCase(),
        size: latest.fileSizeApprox,
        duration: latest.durationFormatted,
        durationSeconds: 240, // standard duration approximation
        thumbnailUrl: latest.thumbnailUrl || DEFAULT_DEMO_MEDIA[0].thumbnailUrl,
        videoUrl: DEFAULT_DEMO_MEDIA[0].videoUrl,
        isReal: true,
      });
    }
  }, []);

  useEffect(() => {
    loadUserHistory();
    const onHistoryUpdate = () => loadUserHistory();
    window.addEventListener('vidleo:history-updated', onHistoryUpdate);
    return () => window.removeEventListener('vidleo:history-updated', onHistoryUpdate);
  }, [loadUserHistory]);

  // Video Event Handlers
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || activeMedia.durationSeconds);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    setIsMuted(newVol === 0);
    if (videoRef.current) {
      videoRef.current.volume = newVol;
      videoRef.current.muted = newVol === 0;
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const newMute = !isMuted;
    setIsMuted(newMute);
    videoRef.current.muted = newMute;
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    setShowSpeedMenu(false);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Auto-hide controls logic
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  // Keyboard Shortcuts (Space, ArrowLeft, ArrowRight, F, M)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (videoRef.current) {
          videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (videoRef.current) {
          videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 5);
        }
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, duration]);

  // Action Buttons Handlers
  const handleCopyLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopiedFeedback(true);
      setTimeout(() => setCopiedFeedback(false), 2200);
    }
  };

  const handleDownloadAgain = () => {
    setDownloadTriggered(true);
    setTimeout(() => setDownloadTriggered(false), 2500);

    // Create synthetic download trigger
    const dummyBlob = new Blob([`VIDLEO_MEDIA: ${activeMedia.title}`], { type: 'video/mp4' });
    const url = URL.createObjectURL(dummyBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeMedia.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${activeMedia.format.toLowerCase()}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Format seconds to mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <section className="pt-8 sm:pt-12 pb-8 sm:pb-12 relative overflow-hidden bg-gradient-to-b from-[#F6F6F8] via-[#F4F4F6] to-[#F6F6F8]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* ===================================================================
            SECTION INTRODUCTION
            =================================================================== */}
        <div className="max-w-3xl mb-8 sm:mb-10 space-y-4">
          <h2 className="font-display font-[850] text-3xl sm:text-5xl lg:text-6xl text-[#0A0A0C] tracking-[-0.035em] leading-[0.98]">
            Your Media.<br />
            <span className="font-serif italic font-normal text-[#5A5A62]">Your Way.</span>
          </h2>

          <p className="text-sm sm:text-base text-[#5A5A62] font-sans font-normal leading-relaxed max-w-xl">
            See what high-fidelity media looks and sounds like once extracted through Vidleo. Unthrottled playback with native containers and zero compression loss.
          </p>
        </div>

        {/* ===================================================================
            MAIN EXPERIENCE DASHBOARD (PLAYER 70% + SIDEBAR 30%)
            Inspired by reference layout, perfectly styled with Vidleo design system
            =================================================================== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT 8 COLS: LARGE VIDEO PLAYER & METADATA */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* 1. Main Video Player Pod */}
            <div 
              ref={playerContainerRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => isPlaying && setShowControls(false)}
              className="relative w-full aspect-video rounded-[24px] sm:rounded-[28px] bg-[#0A0A0E] overflow-hidden shadow-2xl border border-black/[0.12] group select-none"
            >
              {/* HTML5 Video Element with Fallback Poster */}
              <video
                ref={videoRef}
                src={activeMedia.videoUrl}
                poster={activeMedia.thumbnailUrl}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                onClick={togglePlay}
                playsInline
                className="w-full h-full object-cover cursor-pointer"
              />

              {/* Top Bar: Extraction Complete Badge & Quality Indicator */}
              <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none z-20">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/70 backdrop-blur-md border border-white/15 text-[10.5px] font-mono font-bold text-white shadow-lg">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#CCFF00] animate-pulse" />
                  <span className="text-[#CCFF00]">● VIDLEO EXTRACTION COMPLETE</span>
                  <span className="text-white/40">|</span>
                  <span className="text-white/80">{activeMedia.quality} · {activeMedia.frameRate} · {activeMedia.format}</span>
                </div>

                <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-mono text-white/70">
                  <span>UNCOMPRESSED BUFFER</span>
                </div>
              </div>

              {/* Center Play Button Overlay (when paused) */}
              {!isPlaying && (
                <div 
                  onClick={togglePlay}
                  className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[2px] z-10 cursor-pointer transition-opacity duration-300"
                >
                  <motion.div 
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.95 }}
                    className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/95 text-black flex items-center justify-center shadow-2xl transition-all"
                  >
                    <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-black text-black ml-1" />
                  </motion.div>
                </div>
              )}

              {/* Bottom Interactive Video Controls Pod */}
              <div 
                className={cn(
                  "absolute bottom-0 left-0 right-0 p-4 sm:p-5 bg-gradient-to-t from-black/90 via-black/60 to-transparent z-20 transition-opacity duration-300",
                  showControls || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
              >
                {/* Progress Bar / Scrubber */}
                <div className="relative group/scrubber mb-3 flex items-center cursor-pointer">
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    value={currentTime}
                    onChange={handleSeek}
                    className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#CCFF00] focus:outline-none hover:h-2.5 transition-all"
                  />
                </div>

                {/* Controls Row */}
                <div className="flex items-center justify-between text-white text-xs font-mono">
                  
                  {/* Left Controls: Play/Pause, Time */}
                  <div className="flex items-center gap-3 sm:gap-4">
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
                      title={isPlaying ? "Pause (Space)" : "Play (Space)"}
                    >
                      {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
                    </button>

                    {/* Volume Slider */}
                    <div className="flex items-center gap-2 group/vol">
                      <button 
                        type="button" 
                        onClick={toggleMute} 
                        className="text-white/80 hover:text-white cursor-pointer"
                        title="Mute (M)"
                      >
                        {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                        className="w-12 sm:w-16 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white hidden sm:block"
                      />
                    </div>

                    {/* Time Counter */}
                    <div className="text-[11px] text-white/70 tracking-wider">
                      <span className="text-white font-bold">{formatTime(currentTime)}</span>
                      <span className="text-white/40 mx-1">/</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

                  {/* Right Controls: Quality, Speed, Fullscreen */}
                  <div className="flex items-center gap-2 sm:gap-3">
                    
                    {/* Quality Selector */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowQualityMenu(!showQualityMenu)}
                        className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[10.5px] font-bold text-white transition-colors cursor-pointer"
                      >
                        {selectedQuality.split(' ')[0]}
                      </button>

                      {showQualityMenu && (
                        <div className="absolute right-0 bottom-full mb-2 w-36 bg-[#141419] border border-white/15 rounded-xl p-1.5 shadow-2xl z-30">
                          {['4K UHD · 60fps', '1080p FHD', '720p HD', '320k Audio'].map((q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => {
                                setSelectedQuality(q);
                                setShowQualityMenu(false);
                              }}
                              className={cn(
                                "w-full text-left px-2.5 py-1.5 rounded-lg text-[10px] font-mono transition-colors flex items-center justify-between cursor-pointer",
                                selectedQuality === q ? "bg-white/20 text-[#CCFF00] font-bold" : "text-white/70 hover:text-white hover:bg-white/10"
                              )}
                            >
                              <span>{q}</span>
                              {selectedQuality === q && <Check className="w-3 h-3 text-[#CCFF00]" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Speed Selector */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                        className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[10.5px] font-bold text-white transition-colors cursor-pointer"
                      >
                        {playbackSpeed}x
                      </button>

                      {showSpeedMenu && (
                        <div className="absolute right-0 bottom-full mb-2 w-28 bg-[#141419] border border-white/15 rounded-xl p-1.5 shadow-2xl z-30">
                          {[0.5, 1, 1.25, 1.5, 2].map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => handleSpeedChange(s)}
                              className={cn(
                                "w-full text-left px-2.5 py-1.5 rounded-lg text-[10px] font-mono transition-colors flex items-center justify-between cursor-pointer",
                                playbackSpeed === s ? "bg-white/20 text-[#CCFF00] font-bold" : "text-white/70 hover:text-white hover:bg-white/10"
                              )}
                            >
                              <span>{s}x</span>
                              {playbackSpeed === s && <Check className="w-3 h-3 text-[#CCFF00]" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Fullscreen Button */}
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
                      title="Fullscreen (F)"
                    >
                      {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                    </button>
                  </div>

                </div>
              </div>
            </div>

            {/* 2. Video Title, Creator Info & Description Pod */}
            <div className="p-6 sm:p-7 rounded-[26px] bg-white border border-black/[0.08] shadow-xs space-y-6">
              
              {/* Creator & Action Bar Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-black/[0.06]">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-full bg-[#0A0A0C] text-white flex items-center justify-center font-display font-bold text-sm overflow-hidden border border-black/[0.08] shrink-0">
                    {activeMedia.authorAvatarUrl ? (
                      <img src={activeMedia.authorAvatarUrl} alt={activeMedia.authorName} className="w-full h-full object-cover" />
                    ) : (
                      <span>{activeMedia.authorName.slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h4 className="font-display font-bold text-base text-[#0A0A0C]">
                        {activeMedia.authorName}
                      </h4>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 fill-emerald-100" />
                    </div>
                    <span className="text-xs text-[#7A7A82] font-sans">
                      Extracted from {activeMedia.source}
                    </span>
                  </div>
                </div>

                {/* Primary Action Controls */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleDownloadAgain}
                    className="inline-flex items-center gap-2 bg-[#0A0A0C] hover:bg-black text-white px-5 py-2.5 rounded-full text-xs font-semibold tracking-tight transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] shadow-xs cursor-pointer"
                  >
                    {downloadTriggered ? <Check className="w-3.5 h-3.5 text-[#CCFF00]" /> : <Download className="w-3.5 h-3.5 text-[#CCFF00]" />}
                    <span>{downloadTriggered ? 'Saved to Disk' : 'Download Again'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="inline-flex items-center gap-1.5 bg-[#F4F4F6] hover:bg-[#EBEBEF] text-[#0A0A0C] px-4 py-2.5 rounded-full text-xs font-semibold tracking-tight transition-colors border border-black/[0.06] cursor-pointer"
                  >
                    {copiedFeedback ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedFeedback ? 'Copied' : 'Copy Link'}</span>
                  </button>

                  <a
                    href="/download"
                    className="inline-flex items-center gap-1.5 bg-white hover:bg-[#F4F4F6] text-[#0A0A0C] px-4 py-2.5 rounded-full text-xs font-semibold tracking-tight transition-colors border border-black/[0.08] cursor-pointer shadow-2xs"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-[#7A7A82]" />
                    <span>New Extraction</span>
                  </a>
                </div>
              </div>

              {/* Video Title & Detailed Description */}
              <div className="space-y-2">
                <h3 className="font-display font-[850] text-xl sm:text-2xl text-[#0A0A0C] tracking-tight">
                  {activeMedia.title}
                </h3>
                <p className="text-xs sm:text-sm text-[#5A5A62] font-sans leading-relaxed">
                  {activeMedia.description}
                </p>
              </div>

              {/* 3. Extraction Metadata Row (Compact Architecture) */}
              <div className="pt-4 border-t border-black/[0.06] grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 text-xs font-mono">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-[#8C8C94] uppercase font-bold tracking-wider block">SOURCE</span>
                  <span className="text-[#0A0A0C] font-semibold">{activeMedia.source}</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-[#8C8C94] uppercase font-bold tracking-wider block">QUALITY</span>
                  <span className="text-[#0A0A0C] font-semibold">{activeMedia.quality}</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-[#8C8C94] uppercase font-bold tracking-wider block">FRAME RATE</span>
                  <span className="text-[#0A0A0C] font-semibold">{activeMedia.frameRate}</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-[#8C8C94] uppercase font-bold tracking-wider block">FORMAT</span>
                  <span className="text-[#0A0A0C] font-semibold">{activeMedia.format}</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-[#8C8C94] uppercase font-bold tracking-wider block">SIZE</span>
                  <span className="text-[#0A0A0C] font-semibold">{activeMedia.size}</span>
                </div>
              </div>

            </div>

          </div>

          {/* RIGHT 4 COLS: RELATED MEDIA / EXTRACTION QUEUE */}
          <div className="lg:col-span-4 space-y-4">
            
            <div className="p-6 rounded-[26px] bg-white border border-black/[0.08] shadow-xs space-y-5">
              
              <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
                <div className="space-y-0.5">
                  <h4 className="font-display font-[800] text-base text-[#0A0A0C] tracking-tight">
                    {hasRealHistory ? 'Recent Extractions' : 'More from this extraction'}
                  </h4>
                  <p className="text-[11px] font-sans text-[#7A7A82]">
                    {hasRealHistory ? 'Your active downloaded media files' : 'High-fidelity sample media profiles'}
                  </p>
                </div>

                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#F4F4F6] text-[#7A7A82]">
                  {hasRealHistory ? historyList.length : DEFAULT_DEMO_MEDIA.length}
                </span>
              </div>

              {/* Cards List */}
              <div className="space-y-3">
                {(hasRealHistory ? historyList.slice(0, 4) : DEFAULT_DEMO_MEDIA).map((item, idx) => {
                  const isCurrent = (hasRealHistory && item.id === activeMedia.id) || (!hasRealHistory && item.id === activeMedia.id);

                  return (
                    <motion.div
                      key={item.id}
                      initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 15 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.4, delay: idx * 0.08 }}
                      onClick={() => {
                        if (hasRealHistory) {
                          const real = item as HistoryItem;
                          setActiveMedia({
                            id: real.id,
                            title: real.title,
                            description: real.subtitle || 'Direct stream extracted and preserved with native codec headers.',
                            source: real.platformName,
                            authorName: real.authorName || real.platformName,
                            authorAvatarUrl: real.authorAvatarUrl,
                            quality: real.qualityLabel,
                            frameRate: real.qualityLabel.includes('60') ? '60 FPS' : '30 FPS',
                            format: real.container.toUpperCase(),
                            size: real.fileSizeApprox,
                            duration: real.durationFormatted,
                            durationSeconds: 240,
                            thumbnailUrl: real.thumbnailUrl || DEFAULT_DEMO_MEDIA[0].thumbnailUrl,
                            videoUrl: DEFAULT_DEMO_MEDIA[0].videoUrl,
                            isReal: true,
                          });
                        } else {
                          setActiveMedia(item as MediaItem);
                        }
                      }}
                      className={cn(
                        "p-3 rounded-2xl border transition-all duration-200 flex items-center gap-3.5 cursor-pointer group",
                        isCurrent 
                          ? "bg-[#F8F8FA] border-black/[0.2] shadow-2xs ring-1 ring-black/[0.05]"
                          : "bg-white border-black/[0.06] hover:bg-[#F8F8FA] hover:border-black/[0.14]"
                      )}
                    >
                      {/* Thumbnail with overlay duration */}
                      <div className="relative w-20 h-14 rounded-xl overflow-hidden bg-black/10 shrink-0 border border-black/[0.06]">
                        <img 
                          src={item.thumbnailUrl} 
                          alt={item.title} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                        />
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-mono font-bold text-white">
                          {'durationFormatted' in item ? item.durationFormatted : item.duration}
                        </span>
                      </div>

                      {/* Card Metadata */}
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <h5 className="font-display font-bold text-xs text-[#0A0A0C] line-clamp-1 group-hover:text-black">
                          {item.title}
                        </h5>
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#7A7A82]">
                          <span>{'platformName' in item ? item.platformName : item.source}</span>
                          <span>·</span>
                          <span className="text-[#0A0A0C] font-semibold">
                            {'qualityLabel' in item ? item.qualityLabel : item.quality}
                          </span>
                        </div>
                      </div>

                      <ChevronRight className="w-4 h-4 text-[#8C8C94] group-hover:text-black group-hover:translate-x-0.5 transition-all shrink-0" />
                    </motion.div>
                  );
                })}
              </div>

              {/* Bottom Action / View All History */}
              <div className="pt-2 border-t border-black/[0.06]">
                <a
                  href="/history"
                  className="w-full flex items-center justify-center gap-2 bg-[#F4F4F6] hover:bg-[#EBEBEF] text-[#0A0A0C] py-2.5 px-4 rounded-xl text-xs font-semibold tracking-tight transition-colors border border-black/[0.04] cursor-pointer"
                >
                  <span>{hasRealHistory ? 'View All Download History' : 'Explore Extraction Library'}</span>
                  <ExternalLink className="w-3.5 h-3.5 text-[#7A7A82]" />
                </a>
              </div>

            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
