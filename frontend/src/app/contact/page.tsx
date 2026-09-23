'use client';

import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { ArrowRight, Mail, Building2, User, MessageSquare, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type FormStatus = 'idle' | 'loading' | 'success' | 'error';

interface FormData {
  name: string;
  email: string;
  company: string;
  message: string;
}

const INITIAL_FORM: FormData = { name: '', email: '', company: '', message: '' };

function validate(data: FormData): Partial<Record<keyof FormData, string>> {
  const errors: Partial<Record<keyof FormData, string>> = {};
  if (!data.name.trim()) errors.name = 'Name is required';
  if (!data.email.trim()) {
    errors.email = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.email = 'Please enter a valid email address';
  }
  if (!data.message.trim()) errors.message = 'Message is required';
  else if (data.message.trim().length < 10) errors.message = 'Message must be at least 10 characters';
  return errors;
}

export default function ContactPage() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [status, setStatus] = useState<FormStatus>('idle');
  const shouldReduceMotion = useReducedMotion();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validate(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setStatus('loading');
    // Simulate a short delay — no email backend is currently connected.
    // When a backend (Resend, etc.) is added, replace this with the real API call.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    setStatus('success');
  };

  const handleReset = () => {
    setForm(INITIAL_FORM);
    setErrors({});
    setStatus('idle');
  };

  return (
    <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] flex flex-col font-sans antialiased">
      <Navbar />

      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
        <div className="max-w-5xl mx-auto">

          {/* Header */}
          <motion.div
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="text-center mb-12 space-y-3"
          >
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white border border-black/[0.08] text-[11px] font-mono font-bold tracking-widest text-[#5A5A62] uppercase shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[#5B4BFF]" />
              <span>GET IN TOUCH</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold font-display tracking-[-0.035em] text-[#0A0A0C] leading-tight">
              Contact Vidleo
            </h1>
            <p className="text-base text-[#6A6A72] font-sans leading-relaxed max-w-md mx-auto">
              Have a question about plans, a technical issue, or a partnership? We&apos;d love to hear from you.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12 items-start">

            {/* Left — info cards */}
            <motion.div
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              className="lg:col-span-2 space-y-4"
            >
              {[
                {
                  icon: Mail,
                  title: 'General Enquiries',
                  desc: 'Questions about Vidleo, pricing, features, or your account.',
                },
                {
                  icon: Building2,
                  title: 'Business & Partnerships',
                  desc: 'Team plans, API integrations, and commercial enquiries.',
                },
                {
                  icon: MessageSquare,
                  title: 'Support',
                  desc: 'Having trouble? Describe your issue and we\'ll help you out.',
                },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="bg-white rounded-2xl border border-black/[0.07] p-5 flex items-start gap-4 shadow-sm">
                  <div className="w-9 h-9 rounded-xl bg-[#F0F0F3] flex items-center justify-center shrink-0 text-[#5A5A62]">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-[13.5px] font-[650] text-[#0A0A0C]">{title}</p>
                    <p className="text-[12px] text-[#7A7A82] leading-snug mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}

              {/* Response time note */}
              <div className="rounded-2xl bg-[#0A0A0C] text-white p-5">
                <p className="text-[12px] font-mono font-bold tracking-wide uppercase text-white/50 mb-1">Response time</p>
                <p className="text-[13px] text-white/80 leading-relaxed">
                  We typically respond within <span className="text-white font-semibold">1–2 business days</span>.
                </p>
              </div>
            </motion.div>

            {/* Right — form */}
            <motion.div
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.55, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="lg:col-span-3"
            >
              <div className="bg-white rounded-[24px] border border-black/[0.07] shadow-sm overflow-hidden">

                {/* Success state */}
                {status === 'success' ? (
                  <div className="p-10 flex flex-col items-center text-center gap-5">
                    <div className="w-14 h-14 rounded-2xl bg-[#ECFDF5] flex items-center justify-center">
                      <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-[750] text-[#0A0A0C] font-display tracking-tight mb-1">
                        Message received!
                      </h2>
                      <p className="text-[13.5px] text-[#6A6A72] leading-relaxed max-w-sm">
                        Thanks for reaching out, <strong className="text-[#0A0A0C]">{form.name}</strong>. We&apos;ve received your message and will get back to you within 1–2 business days.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleReset}
                      className="mt-2 px-5 py-2.5 rounded-xl border border-[#D8D8D8] text-[13px] font-[600] text-[#4A4A52] hover:border-black/40 hover:text-[#0A0A0C] transition-all"
                    >
                      Send another message
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} noValidate className="p-6 sm:p-8 space-y-5">
                    <p className="text-[13px] font-mono font-bold tracking-widest uppercase text-[#9A9AA2]">Send a message</p>

                    {/* Name + Email */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label htmlFor="contact-name" className="block text-[12px] font-[600] text-[#4A4A52]">
                          Name <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9A9AA2] pointer-events-none" />
                          <input
                            id="contact-name"
                            type="text"
                            name="name"
                            value={form.name}
                            onChange={handleChange}
                            placeholder="Your name"
                            autoComplete="name"
                            className={cn(
                              'w-full pl-9 pr-3.5 py-2.5 rounded-xl border bg-[#F8F8FA] text-[13px] text-[#0A0A0C] placeholder:text-[#B0B0B8] transition-colors focus:outline-none focus:ring-2',
                              errors.name
                                ? 'border-red-300 focus:ring-red-300/50 bg-red-50/40'
                                : 'border-black/[0.08] focus:border-[#5B4BFF]/50 focus:ring-[#5B4BFF]/20'
                            )}
                          />
                        </div>
                        {errors.name && (
                          <p className="text-[11px] text-red-500 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />{errors.name}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="contact-email" className="block text-[12px] font-[600] text-[#4A4A52]">
                          Email <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9A9AA2] pointer-events-none" />
                          <input
                            id="contact-email"
                            type="email"
                            name="email"
                            value={form.email}
                            onChange={handleChange}
                            placeholder="your@email.com"
                            autoComplete="email"
                            className={cn(
                              'w-full pl-9 pr-3.5 py-2.5 rounded-xl border bg-[#F8F8FA] text-[13px] text-[#0A0A0C] placeholder:text-[#B0B0B8] transition-colors focus:outline-none focus:ring-2',
                              errors.email
                                ? 'border-red-300 focus:ring-red-300/50 bg-red-50/40'
                                : 'border-black/[0.08] focus:border-[#5B4BFF]/50 focus:ring-[#5B4BFF]/20'
                            )}
                          />
                        </div>
                        {errors.email && (
                          <p className="text-[11px] text-red-500 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />{errors.email}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Company */}
                    <div className="space-y-1.5">
                      <label htmlFor="contact-company" className="block text-[12px] font-[600] text-[#4A4A52]">
                        Company <span className="text-[#B0B0B8] font-normal">(optional)</span>
                      </label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9A9AA2] pointer-events-none" />
                        <input
                          id="contact-company"
                          type="text"
                          name="company"
                          value={form.company}
                          onChange={handleChange}
                          placeholder="Your company or organization"
                          autoComplete="organization"
                          className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-black/[0.08] bg-[#F8F8FA] text-[13px] text-[#0A0A0C] placeholder:text-[#B0B0B8] transition-colors focus:outline-none focus:ring-2 focus:border-[#5B4BFF]/50 focus:ring-[#5B4BFF]/20"
                        />
                      </div>
                    </div>

                    {/* Message */}
                    <div className="space-y-1.5">
                      <label htmlFor="contact-message" className="block text-[12px] font-[600] text-[#4A4A52]">
                        Message <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        id="contact-message"
                        name="message"
                        value={form.message}
                        onChange={handleChange}
                        placeholder="Describe your question, issue, or request..."
                        rows={5}
                        className={cn(
                          'w-full px-3.5 py-2.5 rounded-xl border bg-[#F8F8FA] text-[13px] text-[#0A0A0C] placeholder:text-[#B0B0B8] transition-colors focus:outline-none focus:ring-2 resize-none',
                          errors.message
                            ? 'border-red-300 focus:ring-red-300/50 bg-red-50/40'
                            : 'border-black/[0.08] focus:border-[#5B4BFF]/50 focus:ring-[#5B4BFF]/20'
                        )}
                      />
                      {errors.message && (
                        <p className="text-[11px] text-red-500 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />{errors.message}
                        </p>
                      )}
                      <p className="text-[11px] text-[#B0B0B8]">
                        {form.message.length} characters
                      </p>
                    </div>

                    {/* Error banner */}
                    {status === 'error' && (
                      <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[12.5px]">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>Something went wrong. Please try again in a moment.</span>
                      </div>
                    )}

                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={status === 'loading'}
                      className={cn(
                        'w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13.5px] font-[650] tracking-tight transition-all duration-200 shadow-sm',
                        status === 'loading'
                          ? 'bg-[#0A0A0C]/70 text-white cursor-not-allowed'
                          : 'bg-[#0A0A0C] hover:bg-[#1a1a22] text-white hover:shadow-md active:scale-[0.99]'
                      )}
                    >
                      {status === 'loading' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Sending...</span>
                        </>
                      ) : (
                        <>
                          <span>Send message</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>

                    <p className="text-center text-[11px] text-[#B0B0B8]">
                      No email system is currently connected — we&apos;ll be in touch via the details you provide when our support is ready.
                    </p>
                  </form>
                )}
              </div>
            </motion.div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
