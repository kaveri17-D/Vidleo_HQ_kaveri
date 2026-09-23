import type { Metadata, Viewport } from 'next';
import { Inter_Tight, Plus_Jakarta_Sans, Playfair_Display, Caveat } from 'next/font/google';
import './globals.css';

// Modern Editorial Grotesk Display Font
const displayFont = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700', '800'],
  style: ['normal', 'italic'],
  display: 'swap',
});

// Clean, neutral modern UI and body font
const sansFont = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

// Elegant Editorial Serif Font for classic italic highlights (like reference image)
const serifFont = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
});

// Subtle Editorial Script Font for annotations
const scriptFont = Caveat({
  subsets: ['latin'],
  variable: '--font-script',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#F8F7F2',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'Vidleo — Video Downloader | Synapvo Tech',
  description:
    'Vidleo is a fast, simple video downloader for supported platforms. Paste a video URL, choose your quality and download.',
  keywords: [
    'video downloader',
    '4k video download',
    'youtube 1080p downloader',
    'vimeo downloader',
    'mp3 audio extractor',
    'synapvo tech',
    'vidleo',
  ],
  authors: [{ name: 'Synapvo Tech', url: 'https://synapvo.tech' }],
  creator: 'Synapvo Tech',
  publisher: 'Synapvo Tech',
};

import { SmoothScrollProvider } from '@/components/providers/SmoothScrollProvider';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { cn } from "@/lib/utils";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={cn(displayFont.variable, serifFont.variable, scriptFont.variable, "font-sans", sansFont.variable)}
    >
      <body className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] font-sans antialiased selection:bg-[#0A0A0C] selection:text-white">
        <AuthProvider>
          <SmoothScrollProvider>{children}</SmoothScrollProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
