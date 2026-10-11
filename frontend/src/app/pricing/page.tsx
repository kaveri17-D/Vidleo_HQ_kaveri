import React from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { FaqSection } from '@/components/home/FaqSection';
import { CheckCircle2, ArrowRight } from 'lucide-react';

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] flex flex-col font-sans antialiased">
      <Navbar />
      <main className="flex-1">
        <section className="w-full py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-[#F6F6F8] text-[#0A0A0C] font-sans">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-mono font-bold tracking-widest text-emerald-800 uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>COMPLETELY FREE UTILITY</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-extrabold font-display tracking-tight text-[#0A0A0C]">
              Vidleo is free to use.
            </h1>

            <p className="text-base text-[#5A5A62] font-sans max-w-xl mx-auto leading-relaxed">
              No subscriptions, no paid plans, and no paywalls. Acquire and extract videos directly with uncompressed quality and zero subscription barriers.
            </p>

            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
              <div className="flex items-center gap-2 text-xs font-mono font-semibold text-emerald-800 bg-white border border-emerald-200/80 px-4 py-2 rounded-xl shadow-2xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>100% Free Core Extraction</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono font-semibold text-emerald-800 bg-white border border-emerald-200/80 px-4 py-2 rounded-xl shadow-2xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Direct Browser Network Mode</span>
              </div>
            </div>

            <div className="pt-6">
              <Link
                href="/download"
                className="inline-flex items-center justify-center gap-2 bg-[#0A0A0C] hover:bg-black text-white px-8 py-3.5 rounded-full font-sans font-semibold text-xs tracking-wider uppercase transition-all shadow-md hover:scale-[1.02] cursor-pointer"
              >
                <span>Start Downloading Now</span>
                <ArrowRight className="w-4 h-4 text-white" />
              </Link>
            </div>
          </div>
        </section>

        <FaqSection />
      </main>
      <Footer />
    </div>
  );
}
