import React from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';

export const metadata = {
  title: 'Privacy Policy — Vidleo',
  description: 'Vidleo Privacy Policy and data protection standards.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] flex flex-col font-sans antialiased">
      <Navbar />

      <main className="flex-1 pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full space-y-10">
        <div className="space-y-4 border-b border-black/[0.08] pb-8">
          <span className="text-[11px] font-mono font-bold tracking-widest text-[#7A7A82] uppercase">
            LEGAL & PRIVACY
          </span>
          <h1 className="font-display font-[850] text-3xl sm:text-5xl text-[#0A0A0C] tracking-tight">
            Privacy Policy
          </h1>
          <p className="text-xs font-mono text-[#7A7A82]">
            Last updated: September 2026 · Vidleo (A Synapvo Product)
          </p>
        </div>

        <div className="space-y-8 text-sm text-[#3A3A42] leading-relaxed">
          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg text-[#0A0A0C]">1. Zero Data Retention</h2>
            <p>
              Vidleo operates as a direct stream extraction proxy and media format utility. We do not store downloaded videos, user browsing logs, or personal identity records on persistent storage.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg text-[#0A0A0C]">2. Client-Side History</h2>
            <p>
              Your download history is saved strictly to your local browser storage (<code className="bg-black/5 px-1.5 py-0.5 rounded font-mono text-xs">localStorage</code>). You can clear this cache at any time from the History page.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg text-[#0A0A0C]">3. External Platforms</h2>
            <p>
              Vidleo parses publicly accessible media manifests from supported video providers. All interaction occurs in compliance with public web standards and stream container formats.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg text-[#0A0A0C]">4. Contact & Compliance</h2>
            <p>
              For legal inquiries or security notices, reach out directly through Synapvo Tech communication channels.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
