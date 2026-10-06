import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { UmpReader } from '../../scratch/gv/package/dist/src/core/UmpReader.js';
import { CompositeBuffer } from '../../scratch/gv/package/dist/src/core/CompositeBuffer.js';

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

    let rawUmp = null;

    client.on('Network.loadingFinished', async (p) => {
      if (rawUmp) return;
      try {
        const bodyRes = await client.send('Network.getResponseBody', { requestId: p.requestId });
        const buf = bodyRes.base64Encoded ? Buffer.from(bodyRes.body, 'base64') : Buffer.from(bodyRes.body, 'utf-8');
        if (buf.length > 50000 && buf.indexOf(Buffer.from('moof', 'ascii')) !== -1) {
          rawUmp = buf;
          console.log(`[PASS] Acquired Real UMP payload: ${buf.length} bytes`);
        }
      } catch {}
    });

    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForSelector('video', { timeout: 20000 });

    await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (v) { v.currentTime = 0; try { v.muted = true; await v.play(); } catch {} }
    });

    for (let i = 0; i < 15; i++) {
      if (rawUmp) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!rawUmp) {
      console.error('[FAIL] No UMP captured');
      process.exit(1);
    }

    // Save exact raw UMP to disk
    fs.writeFileSync('/workspace/scratch/real_raw_ump.bin', rawUmp);

    const cb = new CompositeBuffer();
    cb.append(new Uint8Array(rawUmp));
    const reader = new UmpReader(cb);

    const parts = [];
    const mediaChunks = [];

    reader.read((part) => {
      const bytes = Buffer.concat(part.data.chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
      parts.push({
        type: part.type,
        size: part.size,
        firstBytes: bytes.slice(0, 8).toString("hex"),
        ascii: bytes.slice(0, 8).toString("ascii").replace(/[^\x20-\x7E]/g, ".")
      });
      if (part.type === 21) { // MEDIA
        mediaChunks.push(bytes);
      }
    });

    console.log(`Total UMP parts parsed: ${parts.length}`);
    for (const p of parts) {
      console.log(` - Part type ${p.type} (${p.type === 21 ? 'MEDIA' : p.type === 20 ? 'HEADER' : p.type === 22 ? 'END' : p.type}): size=${p.size}, firstBytes=${p.firstBytes} (${p.ascii})`);
    }

    console.log(`\nMedia chunks (type 21) collected: ${mediaChunks.length}`);
    if (mediaChunks.length > 0) {
      const pureMedia = Buffer.concat(mediaChunks);
      console.log(`Pure Media bytes: ${pureMedia.length}`);
      fs.writeFileSync('/workspace/downloads/ump_pure_video.mp4', pureMedia);
    }

  } finally {
    await browser.close();
  }
})();
