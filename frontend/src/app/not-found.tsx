import React from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';

export const metadata = {
  title: '404 — Page Not Found | Vidleo',
  description: 'The page you are looking for does not exist.',
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] flex flex-col font-sans antialiased">
      <Navbar />

      <main className="flex-1 flex flex-col items-center justify-center px-4 text-center py-20">
        <p className="text-[11px] font-mono font-bold tracking-widest uppercase text-[#9A9AA2] mb-4">
          ERROR 404
        </p>
        <h1 className="font-display font-[850] text-5xl sm:text-6xl lg:text-7xl text-[#0A0A0C] tracking-[-0.04em] leading-none mb-4">
          Page not found.
        </h1>
        <p className="text-[15px] text-[#6A6A72] font-sans leading-relaxed max-w-sm mb-8">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Link
            href="/"
            className="px-6 py-2.5 rounded-xl bg-[#0A0A0C] text-white text-[13.5px] font-[650] hover:bg-[#1a1a22] transition-all shadow-sm"
          >
            Back to home
          </Link>
          <Link
            href="/download"
            className="px-6 py-2.5 rounded-xl border border-[#D8D8D8] text-[#0A0A0C] text-[13.5px] font-[600] hover:border-black/40 transition-all"
          >
            Open Vidleo
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
