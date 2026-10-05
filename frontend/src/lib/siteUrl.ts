/**
 * Resolves the canonical base URL for the application.
 *
 * Rules:
 * 1. In browser environments (window !== 'undefined'):
 *    - If running on localhost / 127.0.0.1, use window.location.origin to preserve local development.
 * 2. If NEXT_PUBLIC_SITE_URL is explicitly configured, use it (canonical production domain).
 * 3. In browser environments on public hosts, fallback to window.location.origin.
 * 4. In server environments (SSR / Route Handlers):
 *    - If NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL is present, format as https://...
 *    - If NEXT_PUBLIC_VERCEL_URL is present, format as https://...
 * 5. Default fallback:
 *    - In production (NODE_ENV === 'production'): 'https://frontend-kaveri-d.vercel.app'
 *    - In local dev: 'http://localhost:3000'
 */
export function getSiteUrl(): string {
  // 1. Browser check for local development
  if (typeof window !== 'undefined' && window.location?.origin) {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return window.location.origin.replace(/\/+$/, '');
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

  // 3. Browser origin on non-localhost hosts (production domain, preview domain, etc.)
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin;
    if (origin.startsWith('http://') || origin.startsWith('https://')) {
      return origin.replace(/\/+$/, '');
    }
  }

  // 4. Vercel system environment variables (available in SSR)
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

  // 5. Canonical production domain fallback vs local development
  if (process.env.NODE_ENV === 'production') {
    return 'https://frontend-kaveri-d.vercel.app';
  }

  return 'http://localhost:3000';
}
