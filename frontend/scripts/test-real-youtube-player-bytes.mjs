import http from 'http';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const extDistPath = path.resolve(rootDir, '../extension/dist');

const PORT = 8095;
const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

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
  const cleanUrl = req.url.split('?')[0];
  const filePath = path.join(rootDir, cleanUrl);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  }
});

server.listen(PORT, async () => {
  console.log('='.repeat(70));
  console.log('NEXUS AUDIT — REAL YOUTUBE PLAYER-INITIATED MEDIA BYTE ACQUISITION');
  console.log('Target Video:', VIDEO_URL);
  console.log('='.repeat(70));

  let browser;
  try {
    console.log('[Step 1] Launching Chromium 153 with Extension...');
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--load-extension=${extDistPath}`,
        `--disable-extensions-except=${extDistPath}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    });

    // 1. Locate Extension Service Worker
    console.log('[Step 2] Locating MV3 Extension Service Worker...');
    let swTarget = null;
    for (let i = 0; i < 30; i++) {
      const targets = browser.targets();
      swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
      if (swTarget) break;
      await new Promise(r => setTimeout(r, 200));
    }

    if (!swTarget) {
      throw new Error('Extension Service Worker not found');
    }
    const extId = swTarget.url().split('/')[2];
    console.log(`[PASS] Extension active (ID: ${extId})`);

    // 2. Open Extension Popup to communicate with extension
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
    console.log('[PASS] Connected to Extension context');

    // 3. Open Real YouTube Watch Page in Chromium
    console.log(`[Step 3] Opening real YouTube watch page in Chromium: ${VIDEO_URL} ...`);
    const ytPage = await browser.newPage();
    
    // Capture all requests to googlevideo.com
    const observedRequests = [];
    ytPage.on('request', (req) => {
      const reqUrl = req.url();
      if (reqUrl.includes('googlevideo.com/videoplayback')) {
        observedRequests.push({
          url: reqUrl,
          method: req.method(),
          headers: req.headers(),
          resourceType: req.resourceType(),
          timestamp: Date.now(),
        });
      }
    });

    ytPage.on('response', (res) => {
      const resUrl = res.url();
      if (resUrl.includes('googlevideo.com/videoplayback')) {
        console.log(`[YouTube Player Network Response] HTTP ${res.status()} for itag=${new URL(resUrl).searchParams.get('itag')}`);
      }
    });

    try {
      await ytPage.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log('[PASS] YouTube watch page DOM loaded');
    } catch (e) {
      console.warn('[YouTube Page Load Warning]:', e.message);
    }

    // Attempt to start/play video if video element is present
    console.log('[Step 4] Checking for HTML5 video element and initiating playback...');
    try {
      await ytPage.evaluate(async () => {
        const video = document.querySelector('video');
        if (video) {
          video.muted = true;
          try { await video.play(); } catch {}
        }
      });
    } catch {}

    // Wait up to 10 seconds for player media requests
    console.log('[Step 5] Waiting for player-initiated googlevideo requests...');
    const startTime = Date.now();
    while (observedRequests.length === 0 && (Date.now() - startTime) < 10000) {
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[Result] Player googlevideo requests observed directly in page: ${observedRequests.length}`);

    // Also check extension service worker's observed streams
    const extObserved = await popupPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'RESOLVE_MEDIA',
          payload: { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }
        }, (res) => resolve(res));
      });
    });

    console.log('[Extension Observed Status]:', extObserved?.payload?.manifest?.pipeline_status);
    console.log('[Extension Candidate URL]:', extObserved?.payload?.manifest?.candidate_stream_url ? extObserved.payload.manifest.candidate_stream_url.substring(0, 100) + '...' : 'null');

    // Select the best candidate URL to test acquisition:
    // Either from in-page intercepted request or from extension cache
    let candidateUrl = observedRequests[0]?.url || extObserved?.payload?.manifest?.candidate_stream_url;

    if (!candidateUrl) {
      console.log('----------------------------------------------------');
      console.log('[FINDING]: No player-initiated videoplayback request was captured.');
      console.log('Reason: In headless mode without consent/interaction or without full player init,');
      console.log('YouTube web player did not fire plain un-chunked videoplayback requests, or');
      console.log('only metadata was loaded.');
      console.log('----------------------------------------------------');
    } else {
      console.log('----------------------------------------------------');
      console.log('[Step 6] Attempting ACTUAL BYTE ACQUISITION of observed googlevideo URL:');
      console.log(candidateUrl.substring(0, 120) + '...');
      console.log('----------------------------------------------------');

      // Attempt acquisition via extension fetch (which has host_permissions for *://*.googlevideo.com/*)
      const acqResult = await popupPage.evaluate(async (url) => {
        try {
          const res = await fetch(url, {
            headers: {
              'Accept': '*/*',
              'Range': 'bytes=0-100000', // Request first 100KB chunk
            }
          });

          const status = res.status;
          const statusText = res.statusText;
          const contentType = res.headers.get('content-type');
          const contentLength = res.headers.get('content-length');

          if (!res.ok) {
            const errText = await res.text();
            return {
              success: false,
              status,
              statusText,
              error: errText.slice(0, 500),
              contentType,
            };
          }

          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          const len = bytes.byteLength;
          for (let i = 0; i < len; i += 8192) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, len)));
          }

          return {
            success: true,
            status,
            statusText,
            contentType,
            contentLength,
            byteLength: len,
            base64: btoa(binary),
          };
        } catch (err) {
          return {
            success: false,
            error: err.message,
          };
        }
      }, candidateUrl);

      console.log('[Byte Acquisition Result]:');
      console.log('  Success:', acqResult.success);
      console.log('  HTTP Status:', acqResult.status, acqResult.statusText);
      console.log('  Content-Type:', acqResult.contentType);
      console.log('  Byte Length:', acqResult.byteLength);

      if (acqResult.success && acqResult.base64) {
        const buffer = Buffer.from(acqResult.base64, 'base64');
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        console.log('  SHA-256:', hash);
        console.log('  First 16 bytes (hex):', buffer.subarray(0, 16).toString('hex'));

        // Save raw acquired bytes
        const outPath = path.join(rootDir, 'scripts/real-youtube-acquired-bytes.bin');
        fs.writeFileSync(outPath, buffer);
        console.log(`[PASS] Real YouTube media bytes written to: ${outPath} (${buffer.byteLength} bytes)`);

        // Now test passing THOSE EXACT BYTES to FFmpeg.wasm in popupPage!
        console.log('[Step 7] Feeding exact acquired YouTube bytes to FFmpeg.wasm...');
        const ffmpegResult = await popupPage.evaluate(async (base64Data) => {
          try {
            const { FFmpeg } = await import('/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js');
            const { toBlobURL } = await import('/node_modules/@ffmpeg/util/dist/esm/index.js');

            const ffmpeg = new FFmpeg();
            const coreURL = await toBlobURL('/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', 'text/javascript');
            const wasmURL = await toBlobURL('/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'application/wasm');
            const classWorkerURL = '/node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js';

            await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });

            const binaryStr = atob(base64Data);
            const len = binaryStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);

            await ffmpeg.writeFile('input.mp4', bytes);
            const code = await ffmpeg.exec(['-i', 'input.mp4', '-c', 'copy', 'output.mp4']);
            const outData = await ffmpeg.readFile('output.mp4');

            return {
              success: code === 0,
              code,
              outputBytes: outData.byteLength,
            };
          } catch (e) {
            return {
              success: false,
              error: e.message,
            };
          }
        }, acqResult.base64);

        console.log('[FFmpeg Processing Result]:', ffmpegResult);
      } else {
        console.log('  Failure Detail:', acqResult.error);
      }
    }

    // Step 8: Verify Backend Media Accounting
    console.log('[Step 8] Verifying Railway backend media transit during test...');
    try {
      const accRes = await fetch('https://backend-production-2ff30.up.railway.app/api/accounting/media');
      if (accRes.ok) {
        const acc = await accRes.json();
        console.log('[Railway Accounting]:', acc);
        console.log(`  backend_media_bytes: ${acc.backend_media_bytes}`);
        console.log(`  backend_media_bytes_received: ${acc.backend_media_bytes_received}`);
      }
    } catch (e) {
      console.warn('[Railway Accounting Check Warning]:', e.message);
    }

  } finally {
    if (browser) await browser.close();
    server.close();
    console.log('='.repeat(70));
    console.log('NEXUS AUDIT COMPLETED');
    console.log('='.repeat(70));
  }
});
