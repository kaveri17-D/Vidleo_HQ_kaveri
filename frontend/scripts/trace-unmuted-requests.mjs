import puppeteer from 'puppeteer-core';
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

    const requests = new Map();

    client.on('Network.responseReceived', (e) => {
      requests.set(e.requestId, {
        url: e.response.url,
        mimeType: e.response.mimeType,
        status: e.response.status,
      });
    });

    const finished = [];

    client.on('Network.loadingFinished', async (p) => {
      const meta = requests.get(p.requestId);
      if (!meta) return;
      try {
        const bodyRes = await client.send('Network.getResponseBody', { requestId: p.requestId });
        const buf = bodyRes.base64Encoded ? Buffer.from(bodyRes.body, 'base64') : Buffer.from(bodyRes.body, 'utf-8');
        finished.push({
          requestId: p.requestId,
          url: meta.url,
          mimeType: meta.mimeType,
          status: meta.status,
          bytes: buf.length,
          buf,
        });
      } catch {}
    });

    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForSelector('video', { timeout: 20000 });

    // Enable audio and play
    await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (v) {
        v.currentTime = 0;
        v.muted = false;
        v.volume = 1.0;
        try { await v.play(); } catch {}
      }
    });

    await new Promise(r => setTimeout(r, 12000));

    console.log(`\nCaptured ${finished.length} finished responses:`);
    for (const f of finished) {
      if (f.url.includes('googlevideo.com') || f.mimeType.includes('video') || f.mimeType.includes('audio') || f.mimeType.includes('ump') || f.bytes > 10000) {
        console.log(`- Req: ${f.requestId.padEnd(8)} | Bytes: ${String(f.bytes).padStart(8)} | Mime: ${f.mimeType.padEnd(25)} | URL: ${f.url.slice(0, 90)}`);
      }
    }

  } finally {
    await browser.close();
  }
})();
