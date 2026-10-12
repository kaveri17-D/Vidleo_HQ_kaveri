import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '..');

console.log('='.repeat(80));
console.log('VIDLEO REGRESSION SUITE: SAVE TO DISK FLOW & PRICING REMOVAL AUDIT');
console.log('='.repeat(80));

import https from 'https';

function fetchPage(urlPath) {
  const targetBase = process.env.TARGET_URL || 'https://frontend-kaveri-d.vercel.app';
  const client = targetBase.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    client.get(`${targetBase}${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    }).on('error', reject);
  });
}

async function runTests() {
  const testResults = [];

  // TEST 1: Public Download Route Status
  try {
    const res = await fetchPage('/download');
    if (res.statusCode === 200) {
      console.log('✓ TEST 1: /download is public (HTTP 200, no login redirect)');
      testResults.push({ test: 'Public /download', passed: true });
    } else {
      throw new Error(`Expected HTTP 200 on /download, got ${res.statusCode}`);
    }
  } catch (err) {
    console.error('✗ TEST 1 FAILED:', err.message);
    testResults.push({ test: 'Public /download', passed: false, error: err.message });
  }

  // TEST 2: Pricing Removal on Homepage
  try {
    const res = await fetchPage('/');
    const body = res.body;
    const hasPaidPlanPricing = body.includes('Choose your way to create') || body.includes('PRICING_PLANS') || body.includes('Choose Creator');
    const hasPaidDollarRupee = body.includes('₹299') || body.includes('₹239') || body.includes('Save 20%');
    if (!hasPaidPlanPricing && !hasPaidDollarRupee) {
      console.log('✓ TEST 2: Homepage has zero paid plan cards, prices (₹299/₹239), or billing toggles');
      testResults.push({ test: 'Homepage Pricing Removal', passed: true });
    } else {
      throw new Error('Homepage still contains paid pricing text or plan cards');
    }
  } catch (err) {
    console.error('✗ TEST 2 FAILED:', err.message);
    testResults.push({ test: 'Homepage Pricing Removal', passed: false, error: err.message });
  }

  // TEST 3: Pricing Page shows Free Product Messaging
  try {
    const res = await fetchPage('/pricing');
    const body = res.body;
    const hasFreeMessage = body.includes('Vidleo is free to use') || body.includes('COMPLETELY FREE UTILITY');
    const hasPaidPrices = body.includes('₹299') || (body.includes('Creator') && body.includes('/ month'));
    if (hasFreeMessage && !hasPaidPrices) {
      console.log('✓ TEST 3: /pricing route communicates "Vidleo is free to use" with zero paid tiers');
      testResults.push({ test: 'Free Product Messaging on /pricing', passed: true });
    } else {
      throw new Error('Pricing route missing free product messaging or contains paid tiers');
    }
  } catch (err) {
    console.error('✗ TEST 3 FAILED:', err.message);
    testResults.push({ test: 'Free Product Messaging on /pricing', passed: false, error: err.message });
  }

  // TEST 4: Navbar & Footer contain no Pricing navigation link
  try {
    const res = await fetchPage('/');
    const body = res.body;
    // Check main nav
    const hasDesktopPricingLink = body.includes('href="/pricing"');
    if (!hasDesktopPricingLink) {
      console.log('✓ TEST 4: Navbar and Footer public navigation items contain no /pricing link');
      testResults.push({ test: 'Navigation Clean of Pricing Links', passed: true });
    } else {
      throw new Error('Found /pricing link still present in Navbar or Footer');
    }
  } catch (err) {
    console.error('✗ TEST 4 FAILED:', err.message);
    testResults.push({ test: 'Navigation Clean of Pricing Links', passed: false, error: err.message });
  }

  // TEST 5: Protected Routes Security Verification
  try {
    const dashRes = await fetchPage('/dashboard');
    const isRedirectOrProtected = dashRes.statusCode === 307 || dashRes.statusCode === 302 || dashRes.headers.location?.includes('/login');
    if (isRedirectOrProtected) {
      console.log('✓ TEST 5: Protected route /dashboard strictly enforces auth (HTTP ' + dashRes.statusCode + ' -> ' + dashRes.headers.location + ')');
      testResults.push({ test: 'Protected Routes Enforcement', passed: true });
    } else {
      throw new Error(`Expected redirect on /dashboard, got ${dashRes.statusCode}`);
    }
  } catch (err) {
    console.error('✗ TEST 5 FAILED:', err.message);
    testResults.push({ test: 'Protected Routes Enforcement', passed: false, error: err.message });
  }

  // TEST 6: Admin Routes Security Verification
  try {
    const adminRes = await fetchPage('/admin/dashboard');
    const isRedirectOrProtected = adminRes.statusCode === 307 || adminRes.statusCode === 302 || adminRes.headers.location?.includes('/admin/login') || adminRes.headers.location?.includes('/login');
    if (isRedirectOrProtected) {
      console.log('✓ TEST 6: Admin route /admin/dashboard strictly enforces auth (HTTP ' + adminRes.statusCode + ' -> ' + adminRes.headers.location + ')');
      testResults.push({ test: 'Admin Routes Enforcement', passed: true });
    } else {
      throw new Error(`Expected redirect on /admin/dashboard, got ${adminRes.statusCode}`);
    }
  } catch (err) {
    console.error('✗ TEST 6 FAILED:', err.message);
    testResults.push({ test: 'Admin Routes Enforcement', passed: false, error: err.message });
  }

  // TEST 7: DownloadReadyState In-Memory Fetch Logic Audit
  try {
    const readyStateSrc = fs.readFileSync(path.resolve(frontendDir, 'src/components/downloader/DownloadReadyState.tsx'), 'utf8');
    const hasWindowLocation = readyStateSrc.includes('window.location') || readyStateSrc.includes('location.href');
    const handlesAuthHeaders = readyStateSrc.includes('DownloaderService.getAuthHeaders()');
    const handles401 = readyStateSrc.includes('response.status === 401');
    const handlesBlobUrl = readyStateSrc.includes('session.downloadUrl.startsWith(\'blob:\')');
    const validatesContentType = readyStateSrc.includes('contentType.includes(\'application/json\')');

    if (!hasWindowLocation && handlesAuthHeaders && handles401 && handlesBlobUrl && validatesContentType) {
      console.log('✓ TEST 7: DownloadReadyState handles blob URLs directly, fetches server URLs with auth headers, validates content-type, and does not navigate window');
      testResults.push({ test: 'DownloadReadyState In-Memory Download Logic', passed: true });
    } else {
      throw new Error('DownloadReadyState logic missing critical safeguards');
    }
  } catch (err) {
    console.error('✗ TEST 7 FAILED:', err.message);
    testResults.push({ test: 'DownloadReadyState In-Memory Download Logic', passed: false, error: err.message });
  }

  console.log('='.repeat(80));
  console.log('TEST SUMMARY:');
  const allPassed = testResults.every(r => r.passed);
  testResults.forEach(r => {
    console.log(`- ${r.passed ? 'PASS' : 'FAIL'}: ${r.test}`);
  });
  console.log('='.repeat(80));

  if (!allPassed) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
