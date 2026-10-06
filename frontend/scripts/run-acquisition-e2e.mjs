import http from 'http';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = 8092;
let testResult = null;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const cleanUrl = req.url.split('?')[0];

  if (req.method === 'POST' && cleanUrl === '/api/acquisition-test-result') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        testResult = JSON.parse(body);
        console.log('[Server] Received Acquisition Test Report:\n', JSON.stringify(testResult, null, 2));
      } catch (e) {
        console.error('[Server] Failed to parse JSON test result:', e);
        testResult = { success: false, error: 'Malformed JSON' };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    return;
  }

  let filePath;
  if (cleanUrl === '/' || cleanUrl === '/test-acquisition-runner.html') {
    filePath = path.join(__dirname, 'test-acquisition-runner.html');
  } else if (cleanUrl.startsWith('/scripts/')) {
    filePath = path.join(rootDir, cleanUrl);
  } else if (cleanUrl.startsWith('/node_modules/')) {
    filePath = path.join(rootDir, cleanUrl);
  } else if (cleanUrl.startsWith('/public/')) {
    filePath = path.join(rootDir, cleanUrl);
  } else {
    filePath = path.join(rootDir, cleanUrl);
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Accept-Ranges': 'bytes'
    });
    res.end(content);
  } else {
    console.warn('[Server 404]', cleanUrl);
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, async () => {
  console.log(`[Acquisition Runner] Test server listening on http://localhost:${PORT}`);

  try {
    console.log('[Acquisition Runner] Launching Chromium with puppeteer-core...');
    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    page.on('console', msg => {
      console.log(`[BROWSER ${msg.type().toUpperCase()}]`, msg.text());
    });

    page.on('pageerror', err => {
      console.error('[BROWSER PAGE ERROR]', err.message);
    });

    console.log(`[Acquisition Runner] Navigating to http://localhost:${PORT}/test-acquisition-runner.html ...`);
    await page.goto(`http://localhost:${PORT}/test-acquisition-runner.html`, {
      waitUntil: 'load',
      timeout: 120000,
    });

    console.log('[Acquisition Runner] Waiting for test suites to complete...');

    // Wait until testResult is populated or timeout (90s)
    const startTime = Date.now();
    while (!testResult && (Date.now() - startTime) < 90000) {
      await new Promise(r => setTimeout(r, 1000));
    }

    await browser.close();
    server.close();

    if (testResult && testResult.success) {
      console.log('====================================================');
      console.log('✅ ALL BROWSER ACQUISITION TEST SUITES PASSED!');
      console.log('Summary:');
      console.log('- Suite 1 (Real Fixture Acquisition): PASSED');
      console.log('- Suite 2 (YouTube CORS Policy Verification): PASSED (Identified CORS Block)');
      console.log('- Suite 3 (Consent State Machine): PASSED');
      console.log('- Suite 4 (Resource Budget Thresholds): PASSED');
      console.log('- Suite 5 (SSRF & Security Isolation): PASSED');
      console.log('====================================================');

      const outPath = path.join(__dirname, 'acquisition-test-result.json');
      fs.writeFileSync(outPath, JSON.stringify(testResult, null, 2));

      process.exit(0);
    } else {
      console.error('❌ BROWSER ACQUISITION TEST SUITES FAILED:', JSON.stringify(testResult, null, 2));
      process.exit(1);
    }
  } catch (err) {
    console.error('[Acquisition Runner] Fatal runner error:', err);
    server.close();
    process.exit(1);
  }
});
