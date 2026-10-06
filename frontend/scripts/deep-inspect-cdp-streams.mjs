import puppeteer from 'puppeteer-core';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extDistPath = path.resolve(__dirname, '../../extension/dist');

const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

console.log('='.repeat(75));
console.log('DEEP INSPECT ALL CDP CAPTURED MEDIA STREAMS');
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

    client.on('Network.responseReceived', (e) => {
      requests.set(e.requestId, {
        url: e.response.url,
        mimeType: e.response.mimeType,
        headers: e.response.headers,
        status: e.response.status,
      });
    });

    const capturedMedia = [];

    client.on('Network.loadingFinished', async (p) => {
      const meta = requests.get(p.requestId);
      if (!meta) return;

      try {
        const bodyRes = await client.send('Network.getResponseBody', { requestId: p.requestId });
        const buf = bodyRes.base64Encoded ? Buffer.from(bodyRes.body, 'base64') : Buffer.from(bodyRes.body, 'utf-8');

        if (buf.length > 2000) {
          const ftypIdx = buf.indexOf(Buffer.from('ftyp', 'ascii'));
          const stypIdx = buf.indexOf(Buffer.from('styp', 'ascii'));
          const moofIdx = buf.indexOf(Buffer.from('moof', 'ascii'));
          const webmIdx = buf.indexOf(Buffer.from('1a45dfa3', 'hex'));

          if (ftypIdx !== -1 || stypIdx !== -1 || moofIdx !== -1 || webmIdx !== -1) {
            console.log(`[MEDIA RESP] Req: ${p.requestId} | Bytes: ${buf.length} | mime: ${meta.mimeType} | url: ${meta.url.slice(0, 70)}...`);
            console.log(`             Boxes: ftyp=${ftypIdx}, styp=${stypIdx}, moof=${moofIdx}, webm=${webmIdx}`);

            capturedMedia.push({
              requestId: p.requestId,
              meta,
              buf,
              ftypIdx,
              stypIdx,
              moofIdx,
              webmIdx,
            });
          }
        }
      } catch {}
    });

    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForSelector('video', { timeout: 20000 });

    // Unmute and let it play so audio segments are fetched
    await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (v) {
        v.currentTime = 0;
        v.muted = false;
        v.volume = 1.0;
        try { await v.play(); } catch {}
      }
    });

    // Let it play for 20 seconds to cover the full 19s video
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\nCaptured ${capturedMedia.length} media responses total.`);

    // Analyze each captured media response
    for (let i = 0; i < capturedMedia.length; i++) {
      const item = capturedMedia[i];
      let sliceStart = 0;
      let ext = 'bin';
      if (item.ftypIdx !== -1) {
        sliceStart = Math.max(0, item.ftypIdx - 4);
        ext = 'mp4';
      } else if (item.stypIdx !== -1) {
        sliceStart = Math.max(0, item.stypIdx - 4);
        ext = 'm4s';
      } else if (item.moofIdx !== -1) {
        sliceStart = Math.max(0, item.moofIdx - 4);
        ext = 'm4s';
      } else if (item.webmIdx !== -1) {
        sliceStart = item.webmIdx;
        ext = 'webm';
      }

      const mediaSlice = item.buf.slice(sliceStart);
      const testPath = `/tmp/test_media_${i}.${ext}`;
      fs.writeFileSync(testPath, mediaSlice);

      try {
        const probe = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams ${testPath}`).toString();
        const info = JSON.parse(probe);
        const s = info.streams?.[0];
        console.log(`[PROBE #${i}] Req ${item.requestId}: ${s?.codec_type} (${s?.codec_name}) - ${s?.width}x${s?.height || ''} dur=${info.format?.duration}s size=${mediaSlice.length} bytes`);
      } catch (err) {
        console.log(`[PROBE #${i} Note] ${testPath} (${mediaSlice.length} bytes): not standalone container (${err.message.slice(0, 100)})`);
      }
    }

  } finally {
    await browser.close();
  }
})();
