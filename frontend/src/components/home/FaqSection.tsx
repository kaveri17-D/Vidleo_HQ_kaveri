'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

const FAQS = [
  {
    q: 'What is Vidleo?',
    a: 'Vidleo is a fast, standalone media stream analyzer and high-fidelity video downloader created by Synapvo Tech. It allows you to paste a media link, inspect raw stream manifests, pick your preferred resolution or uncompressed audio format, and download the clean media asset directly.',
  },
  {
    q: 'How does Vidleo work?',
    a: 'When you paste a URL, Vidleo probes the source endpoint manifest in real time to locate all available codec streams (H.264, VP9, AV1, AAC, MP3). You select your desired resolution, and Vidleo extracts the clean CDN stream at full network throughput without watermarks or intrusive re-encoding.',
  },
  {
    q: 'Which platforms are supported?',
    a: 'Vidleo supports over 40+ media platforms including YouTube (Standard videos, Shorts, 4K 60fps), Instagram (Reels & Feed videos), Vimeo (Staff Picks & 4K masters), X (Twitter), Reddit, SoundCloud, Pinterest, Twitch Clips, and direct media URLs.',
  },
  {
    q: 'What video quality can I download?',
    a: 'Vidleo allows downloading whatever maximum resolution is provided by the source. This includes 4K UHD (2160p), 1440p QHD, 1080p Full HD (60fps), 720p HD, and 480p SD containers.',
  },
  {
    q: 'Can I download audio only?',
    a: 'Yes. Vidleo includes a dedicated audio extraction engine. You can toggle to Audio Mode to extract studio-grade 320 kbps MP3, 256 kbps Apple AAC (M4A), or standard 128 kbps audio tracks directly from music videos and podcasts.',
  },
  {
    q: 'Is Vidleo free to use?',
    a: 'Yes. Vidleo is 100% free with no subscription walls, no download limits, and no deceptive advert redirects. Synapvo Tech operates Vidleo as part of its open creator media ecosystem.',
  },
  {
    q: 'Where are downloaded files stored?',
    a: 'Downloaded files are saved directly to your device’s default Downloads folder (or the destination chosen in your browser prompt). Vidleo does not retain copies of your downloaded files on external servers once transmission completes.',
  },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const shouldReduceMotion = useReducedMotion();

  const toggleFaq = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="pt-8 sm:pt-12 pb-8 sm:pb-12 relative bg-[#F6F6F8] dot-grid-light">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12 space-y-3">
          <h2 className="font-display font-[850] text-3xl sm:text-5xl lg:text-6xl text-[#0A0A0C] tracking-[-0.035em] leading-[0.98]">
            Common Inquiries &<br />
            <span className="font-serif italic font-normal text-[#5A5A62]">Technical Answers.</span>
          </h2>
          <p className="text-xs sm:text-sm text-[#5A5A62] font-sans pt-1">
            Everything you need to know about extracting and acquiring high-definition media with Vidleo.
          </p>
        </div>

        {/* Accordion List */}
        <div className="space-y-3">
          {FAQS.map((faq, idx) => {
            const isOpen = openIndex === idx;

            return (
              <motion.div
                key={faq.q}
                initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
                whileInView={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{
                  duration: 0.45,
                  delay: idx * 0.05,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className={cn(
                  'modular-card-light rounded-[24px] transition-all duration-200 overflow-hidden',
                  isOpen
                    ? 'border-black/[0.2] shadow-md ring-1 ring-black/[0.05]'
                    : 'hover:border-black/[0.18]'
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(idx)}
                  className="w-full flex items-center justify-between p-6 sm:p-7 text-left focus:outline-none cursor-pointer"
                  aria-expanded={isOpen}
                >
                  <span
                    className={cn(
                      'font-sans font-bold text-sm sm:text-base tracking-tight transition-colors',
                      isOpen ? 'text-[#0A0A0C]' : 'text-[#3A3A42] group-hover:text-[#0A0A0C]'
                    )}
                  >
                    {faq.q}
                  </span>

                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-200',
                      isOpen
                        ? 'bg-[#0A0A0C] text-white'
                        : 'bg-[#F4F4F6] text-[#7A7A82] group-hover:bg-[#EBEBEF] group-hover:text-black'
                    )}
                  >
                    <motion.div
                      animate={{ rotate: isOpen ? 45 : 0 }}
                      transition={{
                        duration: shouldReduceMotion ? 0 : 0.25,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="flex items-center justify-center"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[2.4]" />
                    </motion.div>
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <div className="px-6 sm:px-7 pb-6 pt-0 text-xs sm:text-sm text-[#5A5A62] font-sans leading-relaxed border-t border-black/[0.04]">
                        <p className="pt-4">{faq.a}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
