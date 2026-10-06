import puppeteer from 'puppeteer-core';
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

    await client.send('Network.enable');

    const requests = [];

    client.on('Network.requestWillBeSent', (p) => {
      if (p.request.url.includes('/videoplayback') || p.request.url.includes('googlevideo.com')) {
        requests.push({
          requestId: p.requestId,
          url: p.request.url,
          method: p.request.method,
          headers: p.request.headers,
        });
      }
    });

    client.on('Network.responseReceived', (p) => {
      const r = requests.find(x => x.requestId === p.requestId);
      if (r) {
        r.status = p.response.status;
        r.mimeType = p.response.mimeType;
        r.responseHeaders = p.response.headers;
      }
    });

    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForSelector('video', { timeout: 20000 });

    await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (v) { v.currentTime = 0; try { v.muted = true; await v.play(); } catch {} }
    });

    await new Promise(r => setTimeout(r, 6000));

    console.log(`Captured ${requests.length} googlevideo requests:`);
    for (const req of requests) {
      console.log('='.repeat(70));
      console.log('Request ID: ', req.requestId);
      console.log('URL:        ', req.url);
      console.log('Status:     ', req.status);
      console.log('MIME:       ', req.mimeType);
      const parsedUrl = new URL(req.url);
      console.log('URL Params:');
      for (const [k, v] of parsedUrl.searchParams) {
        if (['itag', 'expire', 'range', 'rn', 'rbuf', 'c', 'cver', 'ump', 'sabr', 'mime'].includes(k)) {
          console.log(`  ${k} = ${v}`);
        }
      }
    }

  } finally {
    await browser.close();
  }
})();
