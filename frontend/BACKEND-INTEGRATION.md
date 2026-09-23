# VIDLEO — Complete Backend Integration & Handoff Guide

Welcome to the backend integration guide for **Vidleo**, a modern media extraction and management application built with Next.js, React, TypeScript, TailwindCSS, and Supabase.

This document outlines the architecture, database schema, authentication mechanisms, media processing pipelines, and integration points for backend developers.

---

## 📑 Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Directory Structure](#3-project-directory-structure)
4. [Installation & Local Execution](#4-installation--local-execution)
5. [Environment Variables](#5-environment-variables)
6. [Supabase & Database Architecture](#6-supabase--database-architecture)
7. [Authentication Architecture](#7-authentication-architecture)
   - [User Authentication (Google OAuth & Email)](#user-authentication-google-oauth--email)
   - [Admin Authentication & Authorization](#admin-authentication--authorization)
   - [Server-Side & Middleware Security](#server-side--middleware-security)
8. [Database Schema & RLS Policies](#8-database-schema--rls-policies)
9. [Media Extraction Pipeline](#9-media-extraction-pipeline)
10. [Frontend & Backend Integration Points](#10-frontend--backend-integration-points)
11. [Implemented Features vs. Backend Required Work](#11-implemented-features-vs-backend-required-work)
12. [Testing & Verification](#12-testing--verification)

---

## 1. Project Overview

Vidleo enables creators, researchers, and media professionals to parse, extract, organize, and download video and audio media across major platforms (YouTube, Vimeo, Instagram, X/Twitter, Reddit, Pinterest, SoundCloud, Bandcamp, Mixcloud).

The application features:
- **Public Landing Page & Editorial About Page**
- **Media Download Engine UI**
- **User Dashboard & Download History**
- **Dedicated Admin Authentication (`/admin/login`) & Admin Control Panel (`/admin/dashboard`)**
- **Role-Based Access Control (RBAC)** enforced server-side.

---

## 2. Tech Stack

- **Framework:** Next.js 14+ (App Router, React 19)
- **Language:** TypeScript (`strict: true`)
- **Styling:** TailwindCSS, CSS Modules, Lucide React Icons
- **Animations:** Framer Motion (with `prefers-reduced-motion` compliance)
- **Database & Auth:** Supabase Auth & PostgreSQL
- **Server Utilities:** Next.js Server Components, API Middleware

---

## 3. Project Directory Structure

```text
VIDLEO/
├── BACKEND-INTEGRATION.md        # Comprehensive backend handoff documentation (THIS FILE)
├── README.md                     # General setup & overview documentation
├── .env.local                    # Active environment credentials (PRIVATE)
├── .env.example                  # Environment variable name template
├── supabase-admin-setup.sql      # Supabase database schema, RLS policies, and admin roles
├── next.config.mjs               # Next.js configuration
├── tailwind.config.ts            # Tailwind design tokens & utility classes
├── tsconfig.json                 # TypeScript compiler options
├── package.json                  # Dependencies & npm scripts
│
├── public/                       # Static public assets (images, logos, icons, SVGs)
│   └── images/                   # Platform cards, editorial backgrounds, hero artwork
│
└── src/
    ├── app/                      # Next.js App Router routes & API endpoints
    │   ├── (auth)/               # Auth pages (login, signup, admin/login)
    │   ├── about/                # Editorial About page
    │   ├── admin/                # Secure Admin Dashboard & User/Media controls
    │   ├── api/                  # API routes (download, auth, user history)
    │   ├── contact/              # Support & contact form page
    │   ├── dashboard/            # User dashboard & media history
    │   ├── download/             # Main media extraction utility interface
    │   ├── history/              # Media history page
    │   ├── pricing/              # Pricing tiers
    │   └── supported-sites/      # Platform directory
    │
    ├── components/               # Modular UI components
    │   ├── brand/                # Vidleo Logo & symbol SVG components
    │   ├── layout/               # Navbar & Footer
    │   ├── providers/            # Auth & smooth-scroll providers
    │   └── ui/                   # Shared UI primitives (buttons, inputs, cards)
    │
    ├── config/                   # Global configuration & link constants
    │
    ├── lib/                      # Supabase client/server/admin wrappers & utilities
    │   ├── supabase/
    │   │   ├── admin.ts          # Server-side admin verification logic
    │   │   ├── client.ts         # Browser Supabase client
    │   │   ├── middleware.ts     # Supabase session refresh middleware
    │   │   └── server.ts         # Server-side Supabase client (cookies)
    │   └── utils.ts              # Class name mergers (clsx + tailwind-merge)
    │
    ├── services/                 # Media parsing & extraction service layer
    │   └── downloader/
    │       └── downloaderService.ts
    │
    └── types/                    # TypeScript interfaces & database definitions
```

---

## 4. Installation & Local Execution

### 1. Install Dependencies
```bash
npm install
```

### 2. Verify `.env.local`
Ensure `.env.local` contains valid Supabase project credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://wwqvwparufhspudjpubl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 5. Environment Variables

| Variable Name | Purpose | Scope |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL | Public (Client & Server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anonymous Key | Public (Client & Server) |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin / Service Role Key | Private (Server-side ONLY) |
| `NEXT_PUBLIC_VIDLEO_API_URL` | Custom Extraction Microservice URL | Public (Client & Server) |
| `INITIAL_ADMIN_EMAIL` | Initial Dev Admin Email Fallback | Private (Server-side ONLY) |

---

## 6. Supabase & Database Architecture

Vidleo uses Supabase for authentication, PostgreSQL storage, and Row Level Security (RLS).

All setup queries are provided in `supabase-admin-setup.sql`:
- Executing `supabase-admin-setup.sql` creates necessary schema tables, triggers, and RLS policies.

---

## 7. Authentication Architecture

### User Authentication (Google OAuth & Email)
- **Implementation:** `src/app/(auth)/login/page.tsx` & `src/app/(auth)/signup/page.tsx`.
- **Google OAuth:** Calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: ... } })`.
- **Callback Handling:** `src/app/auth/callback/route.ts` exchanges auth code for user session cookie.

### Admin Authentication & Authorization
- **Dedicated Route:** `/admin/login` (email + password form).
- **Admin Verification:** `src/lib/supabase/admin.ts` provides `verifyAdminUser(supabase)`.
  - Checks `app_metadata.role === 'admin'`.
  - Checks `user_metadata.role === 'admin'`.
  - Checks `user_roles` database table (`role === 'admin'`).
  - Checks `profiles` database table (`role === 'admin'`).
- **Authorization Guard:** Client and server routes redirect non-admin users to `/login` or `/download`.

### Server-Side & Middleware Security
- **Middleware:** `src/lib/supabase/middleware.ts` runs on protected routes (`/admin/*`, `/dashboard/*`).
- **Cookie Synchronization:** Uses `@supabase/ssr` to keep sessions alive securely.

---

## 8. Database Schema & RLS Policies

### 1. `profiles` Table
```sql
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. `user_roles` Table
```sql
CREATE TABLE public.user_roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, role)
);
```

### 3. `media_history` Table
```sql
CREATE TABLE public.media_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  platform TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  format TEXT NOT NULL,
  quality TEXT NOT NULL,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 9. Media Extraction Pipeline

The frontend triggers media parsing via `src/services/downloader/downloaderService.ts`:
- Accepts URL input (e.g. YouTube, Vimeo, Instagram, X, Reddit, Pinterest, SoundCloud, Bandcamp, Mixcloud).
- Parses metadata, format choices (4K MP4, 1080p, 320kbps MP3, FLAC), and stream links.
- Stores user extraction history in Supabase `media_history`.

---

## 10. Frontend & Backend Integration Points

1. **Extraction Microservice (`BACKEND REQUIRED`)**:
   - Connect custom `yt-dlp` / FFmpeg extraction worker or API microservice via `NEXT_PUBLIC_VIDLEO_API_URL`.
2. **Webhooks / Event Stream (`BACKEND REQUIRED`)**:
   - Optional webhook handler for batch extraction completion notifications.
3. **Storage Bucket & File Proxying (`BACKEND REQUIRED`)**:
   - Supabase Storage bucket or S3 proxying for cached download streams.

---

## 11. Implemented Features vs. Backend Required Work

| Feature | Implementation Status | Notes |
| :--- | :--- | :--- |
| **Landing & Editorial About Pages** | ✅ Fully Implemented | Complete UI & responsive layout |
| **Google OAuth & Email Signup** | ✅ Fully Implemented | Supabase Auth integrated |
| **Admin Login & RBAC Middleware** | ✅ Fully Implemented | Server-side role validation |
| **Admin Dashboard UI** | ✅ Fully Implemented | Overview, users, system controls |
| **User Dashboard & History UI** | ✅ Fully Implemented | Connected to `media_history` |
| **Media URL Parsing Frontend** | ✅ Fully Implemented | Client UI & validation |
| **Custom Stream Extraction Engine** | ⚠️ `BACKEND REQUIRED` | Connect custom yt-dlp API microservice |
| **Stripe / Payment Billing Webhooks** | ⚠️ `BACKEND REQUIRED` | Integrate payment provider webhooks |

---

## 12. Testing & Verification

1. **Test User Auth:**
   Navigate to `/login`, test Google login or Email/Password registration.
2. **Test Admin Access:**
   Execute `supabase-admin-setup.sql` in Supabase, sign in at `/admin/login`.
3. **Verify Protected Routes:**
   Attempt accessing `/admin/dashboard` while logged out to confirm redirect to `/admin/login`.

---

*Handoff document generated for Vidleo Backend Engineering Integration.*
