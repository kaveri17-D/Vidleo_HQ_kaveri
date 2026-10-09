import type { Metadata, Viewport } from 'next';
import './globals.css';

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className="font-sans"
    >
      <body className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] font-sans antialiased selection:bg-[#0A0A0C] selection:text-white">
        <AuthProvider>
          <SmoothScrollProvider>{children}</SmoothScrollProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
