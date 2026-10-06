import puppeteer from 'puppeteer-core';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extDistPath = path.resolve(__dirname, '../../extension/dist');

const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

console.log('='.repeat(75));
console.log('PHASE 1 & 2: CDP Network.getResponseBody INVESTIGATION ON REAL YOUTUBE');
console.log('Target Video URL:', VIDEO_URL);
console.log('='.repeat(75));

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
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  try {
    const page = await browser.newPage();
    const client = await page.target().createCDPSession();

    await client.send('Network.enable', {
      maxResourceBufferSize: 100 * 1024 * 1024,
      maxTotalBufferSize: 200 * 1024 * 1024,
    });

    const requests = new Map();
    const completedResponses = [];

    client.on('Network.requestWillBeSent', (params) => {
      requests.set(params.requestId, {
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers,
        timestamp: params.timestamp,
        type: params.type,
      });
    });

    client.on('Network.responseReceived', (params) => {
      const req = requests.get(params.requestId) || {};
      req.status = params.response.status;
      req.mimeType = params.response.mimeType;
      req.headers = params.response.headers;
      req.encodedDataLength = params.response.encodedDataLength;
      req.fromDiskCache = params.response.fromDiskCache;
      req.fromServiceWorker = params.response.fromServiceWorker;
      requests.set(params.requestId, req);
    });

    client.on('Network.loadingFinished', async (params) => {
      const req = requests.get(params.requestId);
      if (!req) return;

      const url = req.url || '';
      const isMediaCandidate = url.includes('/videoplayback') || 
                               url.includes('googlevideo.com') ||
                               req.mimeType?.includes('video') || 
                               req.mimeType?.includes('audio') ||
                               req.mimeType?.includes('yt-ump') ||
                               req.mimeType?.includes('octet-stream');

      if (!isMediaCandidate) return;

      console.log(`\n[loadingFinished] requestId=${params.requestId} encodedDataLength=${params.encodedDataLength}`);
      console.log(` - URL:      ${url.slice(0, 100)}...`);
      console.log(` - MIME:     ${req.mimeType}`);
      console.log(` - Status:   ${req.status}`);

      try {
        const bodyRes = await client.send('Network.getResponseBody', { requestId: params.requestId });
        let buf;
        if (bodyRes.base64Encoded) {
          buf = Buffer.from(bodyRes.body, 'base64');
        } else {
          buf = Buffer.from(bodyRes.body, 'utf-8');
        }

        const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
        const first32Hex = buf.slice(0, 32).toString('hex').match(/.{1,2}/g)?.join(' ') || '';
        const first32Ascii = buf.slice(0, 32).toString('ascii').replace(/[^\x20-\x7E]/g, '.');

        // Magic bytes classification
        let magic = 'UNKNOWN';
        if (buf.length >= 4) {
          if (buf.slice(0, 4).toString('hex') === '1a45dfa3') magic = 'EBML_WEBM';
          else if (buf.slice(4, 8).toString('ascii') === 'ftyp' || buf.slice(4, 8).toString('ascii') === 'moof' || buf.slice(4, 8).toString('ascii') === 'styp') magic = 'ISO_BMFF_MP4';
          else if (buf.slice(0, 4).toString('hex').startsWith('fff1') || buf.slice(0, 4).toString('hex').startsWith('fff9')) magic = 'AAC_ADTS';
          else if (buf.slice(0, 3).toString('ascii') === 'ID3') magic = 'MP3_ID3';
          else if (req.mimeType?.includes('yt-ump')) magic = 'SABR_YT_UMP';
        }

        const summary = {
          requestId: params.requestId,
          url: url.slice(0, 120),
          status: req.status,
          mimeType: req.mimeType,
          encodedDataLength: params.encodedDataLength,
          bodyBytes: buf.length,
          sha256,
          magic,
          first32Hex,
          first32Ascii,
          base64Encoded: bodyRes.base64Encoded,
        };

        completedResponses.push(summary);
        console.log(`[PASS getResponseBody SUCCESS]:`);
        console.log(` - Body Bytes:    ${buf.length}`);
        console.log(` - Magic Class:   ${magic}`);
        console.log(` - First 32 Hex:  ${first32Hex}`);
        console.log(` - First 32 Text: ${first32Ascii}`);
        console.log(` - SHA256:        ${sha256}`);
      } catch (err) {
        console.warn(`[FAIL getResponseBody]: requestId=${params.requestId} error:`, err.message);
      }
    });

    console.log('\n[1] Navigating to YouTube watch page...');
    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForSelector('video', { timeout: 20000 });
    console.log('[PASS] Video element discovered on DOM');

    console.log('\n[2] Ensuring playback to trigger media network requests...');
    await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (v) {
        v.currentTime = 0;
        try { v.muted = true; await v.play(); } catch {}
      }
    });

    // Let the player stream media for 12 seconds
    console.log('\n[3] Observing player network traffic for 12 seconds...');
    for (let sec = 1; sec <= 12; sec++) {
      await new Promise(r => setTimeout(r, 1000));
      const currentTime = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? v.currentTime : 0;
      });
      process.stdout.write(`... ${sec}s (currentTime=${currentTime.toFixed(2)}s, completedResponses=${completedResponses.length})\r`);
    }
    console.log('\n');

    console.log('='.repeat(75));
    console.log('INVESTIGATION SUMMARY:');
    console.log(`Total Media Responses Acquired via CDP: ${completedResponses.length}`);
    console.log('='.repeat(75));

    for (const r of completedResponses) {
      console.log(`\n- Request ID:    ${r.requestId}`);
      console.log(`  MIME Type:     ${r.mimeType}`);
      console.log(`  Body Bytes:    ${r.bodyBytes}`);
      console.log(`  Magic Class:   ${r.magic}`);
      console.log(`  First 32 Hex:  ${r.first32Hex}`);
      console.log(`  First 32 Text: ${r.first32Ascii}`);
      console.log(`  SHA-256:       ${r.sha256}`);
    }

    if (completedResponses.length === 0) {
      console.log('\n[DIAGNOSTIC]: Zero media response bodies were acquired.');
    }

  } finally {
    await browser.close();
  }
})();
