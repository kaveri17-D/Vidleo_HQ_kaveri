import React from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { HeroAndPlatformsSection } from '@/components/home/HeroAndPlatformsSection';
import { HowItWorks } from '@/components/home/HowItWorks';
import { VideoFormatShowcase } from '@/components/home/VideoFormatShowcase';
import { FeatureTestimonialSection } from '@/components/home/FeatureTestimonialSection';
import { GeometricVideoWall } from '@/components/home/GeometricVideoWall';
import { DownloadedVideoExperience } from '@/components/home/DownloadedVideoExperience';
import { FeatureBlocks } from '@/components/home/FeatureBlocks';
import { PricingSection } from '@/components/home/PricingSection';
import { FaqSection } from '@/components/home/FaqSection';
import { FinalCtaSection } from '@/components/home/FinalCtaSection';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] flex flex-col font-sans antialiased">
      {/* 1. Global Modular Navbar */}
      <Navbar />

      <main className="flex-1">
        {/* 2. Top Light Hero Section */}
        <HeroAndPlatformsSection />

        {/* 3. How Vidleo Works (01, 02, 03 Connected Workflow) */}
        <HowItWorks />

        {/* 4. Interactive Video Format System Showcase ("The all-in-one video platform for modern creators.") */}
        <VideoFormatShowcase />

        {/* 5. NEW: Vidleo Feature + Editorial Testimonial Section */}
        <FeatureTestimonialSection />

        {/* 6. Geometric Triangular Video Media Wall (Editorial Showcase) */}
        <GeometricVideoWall />

        {/* 6. Downloaded Video Experience Section */}
        <DownloadedVideoExperience />

        {/* 7. Core Capabilities Feature Blocks ("Engineered For Zero Friction") */}
        <FeatureBlocks />

        {/* 8. Vidleo Pricing Section */}
        <PricingSection />

        {/* 9. Technical FAQ Section */}
        <FaqSection />

        {/* 10. Final Modular CTA Section */}
        <FinalCtaSection />
      </main>

      {/* Global Modular Footer */}
      <Footer />
    </div>
  );
}
