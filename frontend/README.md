# VIDLEO — Media Extraction & Management Platform

Vidleo is a modern, high-performance web application built for discovering, parsing, organizing, and managing media streams across multiple digital platforms (YouTube, Vimeo, Instagram, X/Twitter, Reddit, Pinterest, SoundCloud, Bandcamp, Mixcloud).

---

## 🚀 Tech Stack

- **Framework:** Next.js (App Router, React 19)
- **Language:** TypeScript
- **Styling:** TailwindCSS with CSS custom properties & Vanilla CSS tokens
- **Animations:** Framer Motion (with `prefers-reduced-motion` compliance)
- **Database & Auth:** Supabase Auth & PostgreSQL
- **Icons:** Lucide React & inline branded SVGs

---

## 📁 Folder Structure Overview

```text
VIDLEO/
├── src/
│   ├── app/                      # Next.js App Router pages and API routes
│   │   ├── (auth)/               # Auth routes (login, signup, admin/login)
│   │   ├── about/                # Editorial About page
│   │   ├── admin/                # Secure Admin Dashboard & User/Media controls
│   │   ├── contact/              # Contact & Support page
│   │   ├── dashboard/            # User Dashboard & Media History
│   │   ├── download/             # Media Extractor & Download Engine UI
│   │   ├── history/              # Personal Download History
│   │   ├── pricing/              # Pricing Plans & Subscription tiers
│   │   ├── products/clipper-x/   # ClipperX ecosystem detail page
│   │   └── supported-sites/      # Supported Platforms directory
│   ├── components/               # Reusable UI components
│   │   ├── brand/                # Vidleo SVG logos, symbols, and badges
│   │   ├── layout/               # Navbar & Footer components
│   │   ├── providers/            # React providers (Smooth scroll, auth context)
│   │   └── ui/                   # Modular UI design elements (buttons, inputs, cards)
│   ├── config/                   # Global link mappings & constants
│   ├── lib/                      # Supabase client/server/admin helpers & utility functions
│   ├── services/                 # Media parsing and download service abstraction layer
│   └── types/                    # TypeScript interfaces & type definitions
├── public/                       # Static public assets (images, icons, SVGs)
├── supabase-admin-setup.sql      # Supabase database schema, RLS policies, and admin roles
├── .env.example                  # Environment variable name template
├── next.config.mjs               # Next.js configuration
├── tailwind.config.ts            # Tailwind design tokens & custom utility classes
├── tsconfig.json                 # TypeScript compiler setup
└── package.json                  # Dependencies & npm scripts
```

---

## ⚡ Quick Start & Setup

### 1. Prerequisites
- Node.js 18.x or later
- npm or yarn / pnpm

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Fill in your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

### 4. Database & Admin Setup (Supabase)
Run the SQL script located in `supabase-admin-setup.sql` in your Supabase SQL Editor:
- Creates `profiles`, `user_roles`, and `media_history` tables.
- Enables Row Level Security (RLS).
- Grants secure admin privileges to designated admin users.

### 5. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🔐 Admin Dashboard & Security

- **Admin Login Route:** `/admin/login`
- **Admin Dashboard Route:** `/admin/dashboard`
- Admin authorization is strictly enforced server-side via Supabase metadata and `user_roles` database checks in `src/lib/supabase/admin.ts` and `src/lib/supabase/middleware.ts`.

---

## 📦 Production Build

To test a production bundle:
```bash
npm run build
npm run start
```

---

## 📄 License & Attribution

Powered by Vidleo Tech & Synapvo Infrastructure. All rights reserved.
