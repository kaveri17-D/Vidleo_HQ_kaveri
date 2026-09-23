'use client';

import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Sparkles, Zap, Shield, Flame, Crown, Layers, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VidleoSymbol } from '@/components/brand/VidleoLogo';

interface PricingPlan {
  id: string;
  name: string;
  popular?: boolean;
  headerBg: string;
  headerText: string;
  monthlyPrice: number;
  yearlyPrice: number;
  description: string;
  badge?: string;
  ctaText: string;
  ctaVariant: 'light' | 'coral' | 'pro' | 'dark';
  features: {
    label: string;
    value: string;
  }[];
}

const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    headerBg: 'bg-[#ECE7DC]',
    headerText: 'text-[#3E382E]',
    monthlyPrice: 0,
    yearlyPrice: 0,
    description: 'For trying Vidleo and occasional downloads.',
    ctaText: 'Start Free',
    ctaVariant: 'light',
    features: [
      { label: 'DOWNLOADS', value: '10 / month' },
      { label: 'QUALITY', value: 'Up to 1080p' },
      { label: 'AUDIO', value: 'Standard Audio' },
      { label: 'PROCESSING', value: 'Standard Speed' },
    ],
  },
  {
    id: 'creator',
    name: 'Creator',
    headerBg: 'bg-[#FCE1D6]',
    headerText: 'text-[#4A261A]',
    monthlyPrice: 299,
    yearlyPrice: 239,
    description: 'For creators who download and create regularly.',
    ctaText: 'Choose Creator',
    ctaVariant: 'coral',
    features: [
      { label: 'DOWNLOADS', value: '100 / month' },
      { label: 'QUALITY', value: 'Up to 4K' },
      { label: 'AUDIO', value: 'High Quality' },
      { label: 'PROCESSING', value: 'Faster Engine' },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    popular: true,
    badge: 'MOST POPULAR',
    headerBg: 'bg-[#E5DAFB]',
    headerText: 'text-[#331B61]',
    monthlyPrice: 699,
    yearlyPrice: 559,
    description: 'For serious creators and frequent media workflows.',
    ctaText: 'Go Pro',
    ctaVariant: 'pro',
    features: [
      { label: 'DOWNLOADS', value: '500 / month' },
      { label: 'QUALITY', value: '4K Video' },
      { label: 'AUDIO', value: 'High Quality Audio' },
      { label: 'PROCESSING', value: 'Priority Speed' },
    ],
  },
  {
    id: 'studio',
    name: 'Studio',
    headerBg: 'bg-[#D2E6FC]',
    headerText: 'text-[#183654]',
    monthlyPrice: 1499,
    yearlyPrice: 1199,
    description: 'For teams and high-volume media workflows.',
    ctaText: 'Choose Studio',
    ctaVariant: 'dark',
    features: [
      { label: 'DOWNLOADS', value: 'Unlimited downloads*' },
      { label: 'QUALITY', value: '4K Video' },
      { label: 'AUDIO', value: 'High Quality Audio' },
      { label: 'PROCESSING', value: 'Maximum Speed' },
    ],
  },
];

export function PricingSection() {
  const [isYearly, setIsYearly] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 24 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.55,
        ease: [0.22, 1, 0.36, 1],
      },
    },
  };

  return (
    <section id="pricing" className="w-full py-12 sm:py-16 lg:py-20 px-4 sm:px-6 lg:px-8 bg-[#F6F6F8] text-[#0A0A0C] font-sans overflow-hidden select-none">
      <div className="max-w-[1280px] mx-auto">
        
        {/* SECTION HEADER */}
        <motion.div
          initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="text-center space-y-3 max-w-2xl mx-auto mb-8 sm:mb-10"
        >
          {/* Eyebrow Label */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white border border-black/[0.08] text-[11px] font-mono font-bold tracking-widest text-[#5A5A62] uppercase shadow-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5B4BFF]" />
            <span>VIDLEO PLANS</span>
          </div>

          {/* Main Editorial Headline */}
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold font-display tracking-[-0.035em] text-[#0A0A0C] leading-[1.05]">
            Choose your way to create.
          </h2>

          {/* Subtitle */}
          <p className="text-sm text-[#5A5A62] font-sans leading-relaxed">
            Simple plans for downloading, extracting, and creating with Vidleo.
          </p>

          {/* BILLING TOGGLE */}
          <div className="pt-4 flex items-center justify-center">
            <div className="inline-flex items-center gap-3 p-1.5 rounded-2xl bg-white border border-black/[0.08] shadow-2xs">
              <button
                type="button"
                onClick={() => setIsYearly(false)}
                className={cn(
                  'px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer select-none',
                  !isYearly
                    ? 'bg-[#0A0A0C] text-white shadow-sm'
                    : 'text-[#5A5A62] hover:text-[#0A0A0C]'
                )}
              >
                Monthly
              </button>

              <button
                type="button"
                onClick={() => setIsYearly(true)}
                className={cn(
                  'px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer select-none flex items-center gap-1.5',
                  isYearly
                    ? 'bg-[#0A0A0C] text-white shadow-sm'
                    : 'text-[#5A5A62] hover:text-[#0A0A0C]'
                )}
              >
                <span>Yearly</span>
                <span className="px-2 py-0.5 rounded-full bg-[#5B4BFF] text-white text-[9.5px] font-mono font-extrabold uppercase tracking-wide">
                  Save 20%
                </span>
              </button>
            </div>
          </div>
        </motion.div>

        {/* PRICING CARDS GRID */}
        <motion.div
          variants={containerVariants}
          initial={shouldReduceMotion ? "visible" : "hidden"}
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-6 items-stretch"
        >
          {PRICING_PLANS.map((plan) => {
            const currentPrice = isYearly ? plan.yearlyPrice : plan.monthlyPrice;

            return (
              <motion.div
                key={plan.id}
                variants={itemVariants}
                className={cn(
                  'relative rounded-[24px] bg-white border border-black/[0.09] shadow-[0_10px_30px_-8px_rgba(0,0,0,0.05)] transition-all duration-300 flex flex-col justify-between overflow-hidden group hover:-translate-y-1.5 hover:shadow-xl hover:border-black/20',
                  plan.popular && 'ring-2 ring-[#5B4BFF] shadow-lg -translate-y-1.5 lg:-translate-y-2'
                )}
              >
                {/* Popular Badge */}
                {plan.popular && (
                  <div className="absolute top-3 right-4 z-20">
                    <span className="px-2.5 py-1 rounded-full bg-[#5B4BFF] text-white text-[9px] font-mono font-extrabold uppercase tracking-wider shadow-xs flex items-center gap-1">
                      <Sparkles className="w-2.5 h-2.5" />
                      <span>{plan.badge}</span>
                    </span>
                  </div>
                )}

                <div>
                  {/* Colored Header Block (Reference Inspired) */}
                  <div className={cn('p-4 sm:p-5 relative transition-colors duration-200', plan.headerBg)}>
                    <div className="flex items-center justify-between">
                      <h3 className={cn('font-display font-[800] text-xl tracking-tight', plan.headerText)}>
                        {plan.name}
                      </h3>
                      {!plan.popular && (
                        <div className="opacity-40 group-hover:opacity-70 transition-opacity">
                          <VidleoSymbol size={22} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-4 sm:p-5 space-y-4">
                    {/* Price & Billing */}
                    <div className="space-y-0.5 border-b border-black/[0.07] pb-3">
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight text-[#0A0A0C]">
                          ₹{currentPrice.toLocaleString()}
                        </span>
                        <span className="text-xs text-[#5A5A62] font-semibold">/ month</span>
                      </div>
                      <p className="text-[11px] font-mono text-[#8E8E98]">
                        {isYearly && plan.yearlyPrice > 0
                          ? `Billed annually (₹${(plan.yearlyPrice * 12).toLocaleString()}/yr)`
                          : plan.monthlyPrice === 0
                          ? 'Free forever'
                          : 'Billed monthly'}
                      </p>
                      <p className="text-xs text-[#5A5A62] pt-2 font-medium leading-relaxed">
                        {plan.description}
                      </p>
                    </div>

                    {/* Stacked Feature Rows */}
                    <div className="space-y-2">
                      {plan.features.map((feat, fIdx) => (
                        <div
                          key={fIdx}
                          className="flex flex-col space-y-0 border-b border-black/[0.05] pb-1.5 last:border-b-0 last:pb-0"
                        >
                          <span className="text-[9.5px] font-mono font-bold tracking-wider uppercase text-[#8E8E98]">
                            {feat.label}
                          </span>
                          <span className="text-xs font-semibold text-[#0A0A0C]">
                            {feat.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Card CTA Button */}
                <div className="p-4 sm:p-5 pt-0">
                  <a
                    href={plan.monthlyPrice === 0 ? '/login' : '/download'}
                    className={cn(
                      'w-full h-11 rounded-xl text-xs font-bold tracking-tight transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs hover:shadow-md active:scale-[0.99]',
                      plan.ctaVariant === 'light'
                        ? 'bg-white border border-[#DCDCE2] text-[#0A0A0C] hover:border-black/40 hover:bg-[#FAF9FC]'
                        : plan.ctaVariant === 'coral'
                        ? 'bg-[#E56A49] hover:bg-[#D45938] text-white'
                        : plan.ctaVariant === 'pro'
                        ? 'bg-[#5B4BFF] hover:bg-[#4B3BFF] text-white shadow-md shadow-[#5B4BFF]/25'
                        : 'bg-[#0A0A0C] hover:bg-[#1A1A22] text-white'
                    )}
                  >
                    <span>{plan.ctaText}</span>
                  </a>
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Disclaimer Footer */}
        <div className="mt-6 text-center">
          <p className="text-[11.5px] font-mono text-[#8E8E98]">
            *Fair-use limits may apply to studio unlimited extractions. Prices inclusive of all applicable taxes.
          </p>
        </div>

      </div>
    </section>
  );
}
