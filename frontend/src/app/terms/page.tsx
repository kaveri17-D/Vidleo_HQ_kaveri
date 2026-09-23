import React from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';

export const metadata = {
  title: 'Terms & Conditions — Vidleo',
  description: 'Vidleo Terms and Conditions of service.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] flex flex-col font-sans antialiased">
      <Navbar />

      <main className="flex-1 pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full space-y-10">
        <div className="space-y-4 border-b border-black/[0.08] pb-8">
          <span className="text-[11px] font-mono font-bold tracking-widest text-[#7A7A82] uppercase">
            LEGAL & COMPLIANCE
          </span>
          <h1 className="font-display font-[850] text-3xl sm:text-5xl text-[#0A0A0C] tracking-tight">
            Terms & Conditions
          </h1>
          <p className="text-xs font-mono text-[#7A7A82]">
            Last updated: September 2026 · Vidleo (A Synapvo Product)
          </p>
        </div>

        <div className="space-y-8 text-sm text-[#3A3A42] leading-relaxed">
          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg text-[#0A0A0C]">1. Acceptance of Terms</h2>
            <p>
              By accessing or using Vidleo, you agree to comply with these terms, applicable copyright laws, and the terms of service of origin content providers.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg text-[#0A0A0C]">2. Permitted Use</h2>
            <p>
              Vidleo is intended for personal media backup, archival of creative work, educational usage, and offline viewing where permitted by the original content owner.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg text-[#0A0A0C]">3. Intellectual Property</h2>
            <p>
              Users are solely responsible for ensuring they possess necessary rights or fair-use permissions for media extracted via Vidleo.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg text-[#0A0A0C]">4. Limitation of Liability</h2>
            <p>
              Vidleo and Synapvo Tech provide services on an "as is" and "as available" basis without express or implied warranties.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
