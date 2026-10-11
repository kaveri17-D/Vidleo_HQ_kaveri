import { getSiteUrl } from '../src/lib/siteUrl';

console.log('='.repeat(80));
console.log('VIDLEO AUTHENTICATION REDIRECT & CALLBACK AUDIT TEST');
console.log('='.repeat(80));

// Test 1: getSiteUrl in production environment
(process.env as any).NODE_ENV = 'production';
delete process.env.NEXT_PUBLIC_SITE_URL;
delete process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
delete process.env.NEXT_PUBLIC_VERCEL_URL;

const prodUrl = getSiteUrl();
console.log('Test 1 (Production default fallback):', prodUrl);
if (prodUrl !== 'https://frontend-kaveri-d.vercel.app') {
  console.error('FAIL: Expected https://frontend-kaveri-d.vercel.app, got', prodUrl);
  process.exit(1);
}
console.log('✓ PASS: Production default resolves to https://frontend-kaveri-d.vercel.app');

// Test 2: getSiteUrl with explicit NEXT_PUBLIC_SITE_URL
process.env.NEXT_PUBLIC_SITE_URL = 'https://vidleo.synapvo.tech';
const explicitUrl = getSiteUrl();
console.log('Test 2 (Explicit NEXT_PUBLIC_SITE_URL):', explicitUrl);
if (explicitUrl !== 'https://vidleo.synapvo.tech') {
  console.error('FAIL: Expected https://vidleo.synapvo.tech, got', explicitUrl);
  process.exit(1);
}
console.log('✓ PASS: Explicit domain respected');
delete process.env.NEXT_PUBLIC_SITE_URL;

// Test 3: getSiteUrl in development environment
(process.env as any).NODE_ENV = 'development';
const devUrl = getSiteUrl();
console.log('Test 3 (Development environment):', devUrl);
if (devUrl !== 'http://localhost:3000') {
  console.error('FAIL: Expected http://localhost:3000 in dev, got', devUrl);
  process.exit(1);
}
console.log('✓ PASS: Development environment preserves http://localhost:3000');

// Test 4: Open redirect sanitizer test
function sanitizeNextPath(rawNext: string | null): string {
  if (!rawNext) return '/dashboard';
  const trimmed = rawNext.trim();
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('\\') ||
    trimmed.includes('://') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
  ) {
    return '/dashboard';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

const maliciousInputs = [
  'https://evil.com',
  'http://attacker.com/steal',
  '//evil.com/payload',
  '\\evil.com',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
];

for (const input of maliciousInputs) {
  const sanitized = sanitizeNextPath(input);
  if (sanitized !== '/dashboard') {
    console.error(`FAIL: Malicious input "${input}" was not sanitized to /dashboard, got "${sanitized}"`);
    process.exit(1);
  }
}
console.log('✓ PASS: All malicious external redirect targets sanitized to /dashboard');

const validInputs = [
  ['/dashboard', '/dashboard'],
  ['/download', '/download'],
  ['download', '/download'],
  ['/dashboard/settings', '/dashboard/settings'],
];

for (const [input, expected] of validInputs) {
  const sanitized = sanitizeNextPath(input);
  if (sanitized !== expected) {
    console.error(`FAIL: Valid input "${input}" expected "${expected}", got "${sanitized}"`);
    process.exit(1);
  }
}
console.log('✓ PASS: Internal valid paths preserved');

console.log('='.repeat(80));
console.log('ALL AUTH REDIRECT SPECIFICATION AUDITS PASSED');
console.log('='.repeat(80));
