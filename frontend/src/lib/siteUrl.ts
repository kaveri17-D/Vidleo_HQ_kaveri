/**
 * Resolves the canonical base URL for the application.
 *
 * Rules:
 * 1. In browser environments (window !== 'undefined'):
 *    - If running on localhost / 127.0.0.1, use window.location.origin to preserve local development.
 *    - On non-localhost hosts (e.g. production domain, preview domain), use window.location.origin.
 * 2. If NEXT_PUBLIC_SITE_URL is explicitly configured, use it.
 * 3. In server environments (SSR / Route Handlers):
 *    - If NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL is present, format as https://...
 *    - If NEXT_PUBLIC_VERCEL_URL is present, format as https://...
 * 4. Default fallback:
 *    - Always default to production domain 'https://frontend-kaveri-d.vercel.app' unless explicitly in development mode ('development').
 */
export function getSiteUrl(): string {
  // 1. Browser check: always honor actual browser location if running in client
  if (typeof window !== 'undefined' && window.location?.origin) {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return window.location.origin.replace(/\/+$/, '');
    }
    const origin = window.location.origin;
    if (origin.startsWith('http://') || origin.startsWith('https://')) {
      return origin.replace(/\/+$/, '');
    }
  }

  // 2. Explicit site URL from environment
  let siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl && siteUrl.trim() !== '') {
    siteUrl = siteUrl.trim().replace(/\/+$/, '');
    return siteUrl.startsWith('http://') || siteUrl.startsWith('https://')
      ? siteUrl
      : `https://${siteUrl}`;
  }

  // 3. Vercel system environment variables (available in SSR)
  const vercelProd = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd && vercelProd.trim() !== '') {
    const trimmed = vercelProd.trim().replace(/\/+$/, '');
    return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
  }

  const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL;
  if (vercelUrl && vercelUrl.trim() !== '') {
    const trimmed = vercelUrl.trim().replace(/\/+$/, '');
    return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
  }

  // 4. In development mode (only when NODE_ENV is strictly 'development' without production flags), allow localhost fallback
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000';
  }

  // 5. Canonical production domain fallback
  return 'https://frontend-kaveri-d.vercel.app';
}
