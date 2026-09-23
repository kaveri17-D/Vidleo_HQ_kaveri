import React from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { PricingSection } from '@/components/home/PricingSection';
import { FaqSection } from '@/components/home/FaqSection';

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] flex flex-col font-sans antialiased">
      <Navbar />
      <main className="flex-1">
        <PricingSection />
        <FaqSection />
      </main>
      <Footer />
    </div>
  );
}
