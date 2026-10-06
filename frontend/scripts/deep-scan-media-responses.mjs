import puppeteer from 'puppeteer-core';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extDistPath = path.resolve(__dirname, '../../extension/dist');

const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

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

    const responses = [];

    client.on('Network.responseReceived', (p) => {
      responses.push({
        requestId: p.requestId,
        url: p.response.url,
        status: p.response.status,
        mimeType: p.response.mimeType,
        headers: p.response.headers,
      });
    });

    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForSelector('video', { timeout: 20000 });

    await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (v) { v.currentTime = 0; try { v.muted = true; await v.play(); } catch {} }
    });

    // Wait 15 seconds of playback
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`Inspecting ${responses.length} total responses received...`);

    const mediaCandidates = responses.filter(r => 
      r.status === 200 && (
        r.url.includes('googlevideo') || 
        r.mimeType.includes('video') || 
        r.mimeType.includes('audio') || 
        r.mimeType.includes('ump') ||
        r.mimeType.includes('octet-stream')
      )
    );

    console.log(`Found ${mediaCandidates.length} HTTP 200 media candidates:`);

    for (const cand of mediaCandidates) {
      console.log('='.repeat(70));
      console.log(`Request ID: ${cand.requestId}`);
      console.log(`URL:        ${cand.url.slice(0, 100)}...`);
      console.log(`MIME:       ${cand.mimeType}`);

      try {
        const bodyRes = await client.send('Network.getResponseBody', { requestId: cand.requestId });
        const buf = bodyRes.base64Encoded ? Buffer.from(bodyRes.body, 'base64') : Buffer.from(bodyRes.body, 'utf-8');
        const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

        console.log(`Body Size:  ${buf.length} bytes`);
        console.log(`SHA-256:    ${sha256}`);
        console.log(`Hex Header: ${buf.slice(0, 32).toString('hex').match(/.{1,2}/g)?.join(' ')}`);
        console.log(`Ascii:      ${buf.slice(0, 32).toString('ascii').replace(/[^\x20-\x7E]/g, '.')}`);

        // Scan for MP4 ftyp/moof/mdat or WebM
        const hasWebM = buf.indexOf(Buffer.from('1a45dfa3', 'hex')) !== -1;
        const hasFtyp = buf.indexOf(Buffer.from('ftyp', 'ascii')) !== -1;
        const hasMoof = buf.indexOf(Buffer.from('moof', 'ascii')) !== -1;
        const hasMdat = buf.indexOf(Buffer.from('mdat', 'ascii')) !== -1;

        console.log(`Has WebM EBML: ${hasWebM}`);
        console.log(`Has MP4 ftyp:  ${hasFtyp}`);
        console.log(`Has MP4 moof:  ${hasMoof}`);
        console.log(`Has MP4 mdat:  ${hasMdat}`);

      } catch (err) {
        console.log(`getResponseBody Error: ${err.message}`);
      }
    }

  } finally {
    await browser.close();
  }
})();
