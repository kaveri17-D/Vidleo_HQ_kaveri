import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extDistPath = path.resolve(__dirname, '../../extension/dist');

console.log('='.repeat(70));
console.log('PHASE 2: VERIFY EXTENSION BRIDGE & HANDSHAKE');
console.log('Extension Dist Path:', extDistPath);
console.log('='.repeat(70));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--load-extension=${extDistPath}`,
      `--disable-extensions-except=${extDistPath}`,
    ],
  });

  try {
    // 1. Check Service Worker
    console.log('\n[1] Checking Extension Service Worker target...');
    let swTarget = null;
    for (let i = 0; i < 25; i++) {
      const targets = browser.targets();
      swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
      if (swTarget) break;
      await new Promise(r => setTimeout(r, 200));
    }

    if (!swTarget) {
      console.error('[FAIL] Extension service worker not spotted in targets!');
      process.exit(1);
    }
    console.log('[PASS] Service Worker Target found:', swTarget.url());

    // 2. Open production webpage
    console.log('\n[2] Navigating to https://frontend-kaveri-d.vercel.app/ ...');
    const page = await browser.newPage();
    
    // Capture console messages
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('NEXUS') || text.includes('Extension') || text.includes('Bridge')) {
        console.log(`[Browser Console] ${text}`);
      }
    });

    await page.goto('https://frontend-kaveri-d.vercel.app/', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('[PASS] Webpage loaded:', await page.title());

    // 3. Test Handshake: PAGE -> CONTENT SCRIPT -> SERVICE WORKER -> CONTENT SCRIPT -> PAGE
    console.log('\n[3] Testing Handshake via window.postMessage(PING)...');
    const handshakeResult = await page.evaluate(async () => {
      const startTime = performance.now();
      
      // Check DOM markers first
      const domInstalled = document.documentElement.getAttribute('data-nexus-extension-installed') === 'true' ||
                           document.documentElement.dataset?.nexusExtensionInstalled === 'true';
      const domVersion = document.documentElement.getAttribute('data-nexus-extension-version') || 
                         document.documentElement.dataset?.nexusExtensionVersion;

      // Now perform active postMessage ping
      return new Promise((resolve) => {
        let pongReceived = false;

        function handleMessage(event) {
          if (event.data?.source === 'nexus-extension' && event.data?.type === 'PONG') {
            pongReceived = true;
            window.removeEventListener('message', handleMessage);
            const elapsedMs = performance.now() - startTime;
            resolve({
              pongReceived: true,
              version: event.data.version,
              capabilities: event.data.capabilities,
              domInstalled,
              domVersion,
              elapsedMs,
              diagnostic: window.__NEXUS_DIAGNOSTIC__ || null,
            });
          }
        }

        window.addEventListener('message', handleMessage);
        window.postMessage({ source: 'nexus-webpage', type: 'PING' }, '*');

        setTimeout(() => {
          if (!pongReceived) {
            window.removeEventListener('message', handleMessage);
            resolve({
              pongReceived: false,
              domInstalled,
              domVersion,
              elapsedMs: performance.now() - startTime,
              diagnostic: window.__NEXUS_DIAGNOSTIC__ || null,
            });
          }
        }, 3000);
      });
    });

    console.log('\n--- HANDSHAKE RESULTS ---');
    console.log('PONG RECEIVED:       ', handshakeResult.pongReceived);
    console.log('EXTENSION VERSION:   ', handshakeResult.version);
    console.log('DOM MARKER INSTALLED:', handshakeResult.domInstalled);
    console.log('DOM MARKER VERSION:  ', handshakeResult.domVersion);
    console.log('ROUNDTRIP TIME:      ', `${handshakeResult.elapsedMs.toFixed(2)} ms`);
    console.log('CAPABILITIES:        ', JSON.stringify(handshakeResult.capabilities, null, 2));

    if (!handshakeResult.pongReceived) {
      console.error('[FAIL] PONG NOT RECEIVED!');
      process.exit(1);
    }

    console.log('\n[PASS] Extension handshake fully verified!');
  } finally {
    await browser.close();
  }
})();
