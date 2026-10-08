import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const extDistPath = path.resolve(rootDir, '../extension/dist');

function computeSha256(filePath) {
  if (!fs.existsSync(filePath)) return 'MISSING';
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

(async () => {
  console.log('='.repeat(80));
  console.log('DIAGNOSE OFFSCREEN FFMPEG LOADING IN CHROMIUM');
  console.log('='.repeat(80));

  const filesToCheck = [
    'manifest.json',
    'background.js',
    'content.js',
    'offscreen.html',
    'offscreen.js',
    'ffmpeg-core.js',
    'ffmpeg-core.wasm',
    'ffmpeg-worker.js',
    'BUILD_MANIFEST.json'
  ];

  console.log('\n--- EXTENSION/DIST FILES AUDIT ---');
  for (const f of filesToCheck) {
    const p = path.join(extDistPath, f);
    const exists = fs.existsSync(p);
    const size = exists ? fs.statSync(p).size : 0;
    const sha = computeSha256(p);
    console.log(`${f.padEnd(20)}: exists=${exists}, size=${size}B, sha256=${sha.slice(0, 16)}...`);
  }

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

  const dummy = await browser.newPage();
  await dummy.goto('http://127.0.0.1:8000/').catch(() => {});

  // Poll for extension ID from service worker target
  let swTarget = null;
  for (let i = 0; i < 30; i++) {
    const targets = browser.targets();
    swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
    if (swTarget) break;
    await new Promise(r => setTimeout(r, 200));
  }

  const swUrl = swTarget ? swTarget.url() : '';
  const match = swUrl.match(/chrome-extension:\/\/([a-z0-9]+)\//);
  const extId = match ? match[1] : 'unknown';
  console.log(`\nExtension ID: ${extId}`);
  console.log(`Service Worker URL: ${swUrl}`);

  // Create or navigate to offscreen.html
  const page = await browser.newPage();
  page.on('console', msg => console.log('  [PAGE CONSOLE]', msg.text()));
  const offscreenUrl = `chrome-extension://${extId}/offscreen.html`;
  console.log(`Navigating to ${offscreenUrl}...`);
  await page.goto(offscreenUrl, { waitUntil: 'domcontentloaded' });

  // Evaluate tests in offscreen context
  const offscreenDiag = await page.evaluate(async (extId) => {
    const results = {};
    const coreUrl = `chrome-extension://${extId}/ffmpeg-core.js`;
    const wasmUrl = `chrome-extension://${extId}/ffmpeg-core.wasm`;
    const workerUrl = `chrome-extension://${extId}/ffmpeg-worker.js`;

    results.coreUrl = coreUrl;
    results.wasmUrl = wasmUrl;
    results.workerUrl = workerUrl;

    // Test 1: Fetch core
    try {
      const resp = await fetch(coreUrl);
      results.coreFetch = {
        status: resp.status,
        statusText: resp.statusText,
        ok: resp.ok,
        size: (await resp.arrayBuffer()).byteLength
      };
    } catch (e) {
      results.coreFetch = { error: e.name + ': ' + e.message };
    }

    // Test 2: Fetch wasm
    try {
      const resp = await fetch(wasmUrl);
      results.wasmFetch = {
        status: resp.status,
        statusText: resp.statusText,
        ok: resp.ok,
        size: (await resp.arrayBuffer()).byteLength
      };
    } catch (e) {
      results.wasmFetch = { error: e.name + ': ' + e.message };
    }

    // Test 3: Dynamic import core inside offscreen document
    try {
      const mod = await import(coreUrl);
      results.coreImportInDocument = {
        success: true,
        defaultType: typeof mod.default,
      };
    } catch (e) {
      results.coreImportInDocument = {
        success: false,
        error: e.name + ': ' + e.message,
        stack: e.stack
      };
    }

    // Test 4: Dynamic import core inside a module Web Worker
    try {
      const workerCode = `
        self.onmessage = async (e) => {
          try {
            const mod = await import(e.data.coreUrl);
            self.postMessage({ success: true, defaultType: typeof mod.default });
          } catch (err) {
            self.postMessage({ success: false, error: err.name + ': ' + err.message, stack: err.stack });
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      const w = new Worker(blobUrl, { type: 'module' });
      const workerRes = await new Promise((res) => {
        w.onmessage = (ev) => res(ev.data);
        w.onerror = (ev) => res({ success: false, error: 'Worker error: ' + ev.message });
        w.postMessage({ coreUrl });
        setTimeout(() => res({ success: false, error: 'timeout' }), 5000);
      });
      results.coreImportInBlobWorker = workerRes;
    } catch (e) {
      results.coreImportInBlobWorker = { error: e.name + ': ' + e.message };
    }

    // Test 5: Dynamic import core inside extension-hosted worker (ffmpeg-worker.js)
    try {
      const w = new Worker(workerUrl, { type: 'module' });
      // Send LOAD message to ffmpeg-worker.js as FFmpeg does
      const workerLoadRes = await new Promise((res) => {
        w.onmessage = (ev) => res(ev.data);
        w.onerror = (ev) => res({ success: false, error: 'Worker error: ' + ev.message });
        w.postMessage({
          id: 1,
          type: 'LOAD',
          data: {
            coreURL: coreUrl,
            wasmURL: wasmUrl,
          }
        });
        setTimeout(() => res({ success: false, error: 'LOAD timeout after 10s' }), 10000);
      });
      results.ffmpegWorkerLoad = workerLoadRes;
    } catch (e) {
      results.ffmpegWorkerLoad = { error: e.name + ': ' + e.message };
    }

    // Test 6: Call queryFfmpegCodecs
    try {
      if (typeof window.__queryFfmpegCodecs === 'function') {
        results.queryCodecs = await window.__queryFfmpegCodecs();
      } else {
        results.queryCodecs = 'not defined';
      }
    } catch (e) {
      results.queryCodecs = { error: e.name + ': ' + e.message, stack: e.stack };
    }

    return results;
  }, extId);

  console.log('\n--- OFFSCREEN DIAGNOSTIC RESULTS ---');
  console.log(JSON.stringify(offscreenDiag, null, 2));

  await browser.close();
})();
