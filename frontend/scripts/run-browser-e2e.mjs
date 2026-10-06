import http from 'http';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = 8089;
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

  if (req.method === 'POST' && cleanUrl === '/api/test-result') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        testResult = JSON.parse(body);
        console.log('[Server] Received test result payload:', JSON.stringify(testResult, null, 2));
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
  if (cleanUrl === '/' || cleanUrl === '/test-browser-runner.html') {
    filePath = path.join(__dirname, 'test-browser-runner.html');
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
  console.log(`[E2E Runner] Test server listening on http://localhost:${PORT}`);

  try {
    console.log('[E2E Runner] Launching Chromium with puppeteer-core...');
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
      console.log(`[BROWSER CONSOLE ${msg.type().toUpperCase()}]`, msg.text());
    });

    page.on('pageerror', err => {
      console.error('[BROWSER PAGE ERROR]', err.message);
    });

    console.log(`[E2E Runner] Navigating to http://localhost:${PORT}/test-browser-runner.html ...`);
    await page.goto(`http://localhost:${PORT}/test-browser-runner.html`, {
      waitUntil: 'load',
      timeout: 120000,
    });

    console.log('[E2E Runner] Page loaded, waiting for test result...');

    // Wait until testResult is populated or timeout
    const startTime = Date.now();
    while (!testResult && (Date.now() - startTime) < 90000) {
      await new Promise(r => setTimeout(r, 1000));
    }

    await browser.close();
    server.close();

    if (testResult && testResult.success) {
      console.log('====================================================');
      console.log('✅ BROWSER MEDIA ENGINE REAL TEST PASSED!');
      console.log(`- Remux output: ${testResult.remuxBytes} bytes`);
      console.log(`- Trim output: ${testResult.trimBytes} bytes`);
      console.log(`- HTMLVideoElement validation: ${testResult.videoWidth}x${testResult.videoHeight}, duration: ${testResult.videoDuration}s`);
      console.log('====================================================');

      const outPath = path.join(__dirname, 'test-result.json');
      fs.writeFileSync(outPath, JSON.stringify(testResult, null, 2));

      // Also write remux and trim sample outputs for validation
      if (testResult.remuxBase64) {
        fs.writeFileSync(path.join(__dirname, 'output-remux.mp4'), Buffer.from(testResult.remuxBase64, 'base64'));
      }
      if (testResult.trimBase64) {
        fs.writeFileSync(path.join(__dirname, 'output-trim.mp4'), Buffer.from(testResult.trimBase64, 'base64'));
      }

      process.exit(0);
    } else {
      console.error('❌ BROWSER MEDIA ENGINE TEST FAILED:', testResult?.error || 'Timeout without result');
      process.exit(1);
    }
  } catch (err) {
    console.error('[E2E Runner] Fatal runner error:', err);
    server.close();
    process.exit(1);
  }
});
