'use client';

import React from 'react';
import { ShieldCheck, HardDrive, Server, Sparkles, X } from 'lucide-react';

interface BrowserConsentModalProps {
  isOpen: boolean;
  videoTitle?: string;
  filesizeFormatted?: string;
  onAllowBrowser: () => void;
  onUseServer: () => void;
  onClose?: () => void;
}

export function BrowserConsentModal({
  isOpen,
  videoTitle = 'Selected Media',
  filesizeFormatted,
  onAllowBrowser,
  onUseServer,
  onClose,
}: BrowserConsentModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="w-full max-w-md bg-white border border-black/10 rounded-3xl p-6 shadow-2xl space-y-5 text-[#0A0A0C] relative"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-50 border border-purple-200/60 flex items-center justify-center text-purple-600">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 id="consent-title" className="text-base font-semibold leading-tight text-[#0A0A0C]">
                Browser-Side Download
              </h3>
              <p className="text-xs text-[#7A7A82] mt-0.5">
                Client-First Media Processing (NEXUS)
              </p>
            </div>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="text-[#7A7A82] hover:text-[#0A0A0C] p-1 rounded-lg transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Video context badge */}
        <div className="bg-[#F8F8FA] rounded-2xl p-3 border border-black/5 flex items-center justify-between text-xs">
          <span className="font-medium text-[#0A0A0C] truncate max-w-[240px]">
            {videoTitle}
          </span>
          {filesizeFormatted && (
            <span className="text-[#7A7A82] font-mono shrink-0">
              {filesizeFormatted}
            </span>
          )}
        </div>

        {/* Informational Copy */}
        <div className="text-xs text-[#4A4A52] leading-relaxed space-y-2">
          <p>
            Vidleo can attempt to retrieve this media directly in your browser. This means your browser will make the media request using your current network connection. Media processing will happen locally on your device.
          </p>
          <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-2.5 flex items-center gap-2 text-emerald-900 text-[11px]">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Zero media bytes are transferred through Vidleo servers when browser acquisition succeeds.</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={onAllowBrowser}
            className="w-full py-3 px-4 rounded-2xl bg-[#0A0A0C] hover:bg-black text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md hover:shadow-lg"
          >
            <HardDrive className="w-4 h-4 text-purple-300" />
            <span>Allow Browser Download</span>
          </button>

          <button
            type="button"
            onClick={onUseServer}
            className="w-full py-2.5 px-4 rounded-2xl bg-gray-100 hover:bg-gray-200 text-[#0A0A0C] text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Server className="w-4 h-4 text-[#7A7A82]" />
            <span>Use Server Download</span>
          </button>
        </div>

        <p className="text-[10px] text-center text-[#9CA3AF]">
          Consent applies to this action only and can be changed anytime.
        </p>
      </div>
    </div>
  );
}
