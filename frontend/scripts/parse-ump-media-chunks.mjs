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
console.log('EXTRACTING & DEMUXING MEDIA CHUNKS FROM REAL YT-UMP PAYLOAD');
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

    let rawUmp = null;

    client.on('Network.loadingFinished', async (p) => {
      if (rawUmp) return;
      try {
        const bodyRes = await client.send('Network.getResponseBody', { requestId: p.requestId });
        const buf = bodyRes.base64Encoded ? Buffer.from(bodyRes.body, 'base64') : Buffer.from(bodyRes.body, 'utf-8');
        if (buf.length > 50000 && buf.indexOf(Buffer.from('moof', 'ascii')) !== -1) {
          rawUmp = buf;
          console.log(`[PASS] Acquired UMP body with moof boxes: ${buf.length} bytes`);
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
      console.error('[FAIL] Could not capture UMP payload with moof');
      process.exit(1);
    }

    console.log(`\nAnalyzing UMP buffer: ${rawUmp.length} bytes`);

    // UMP protocol framing analysis:
    // A UMP payload is a stream of UMP parts.
    // Each part begins with a UMP header containing the part type and part length.
    // Let's locate the ISO BMFF boxes:
    const boxes = ['ftyp', 'moov', 'moof', 'mdat', 'styp', 'sidx'];
    const foundBoxes = [];

    for (const box of boxes) {
      const target = Buffer.from(box, 'ascii');
      let offset = 0;
      while ((offset = rawUmp.indexOf(target, offset)) !== -1) {
        // In ISO BMFF, box size is a 32-bit big-endian integer immediately preceding the 4-byte box type
        if (offset >= 4) {
          const boxSize = rawUmp.readUInt32BE(offset - 4);
          foundBoxes.push({
            type: box,
            boxStart: offset - 4,
            boxSize,
            typeOffset: offset,
          });
        }
        offset += 4;
      }
    }

    foundBoxes.sort((a, b) => a.boxStart - b.boxStart);
    console.log(`\nDiscovered ${foundBoxes.length} ISO BMFF boxes inside UMP stream:`);
    for (const b of foundBoxes.slice(0, 20)) {
      console.log(` - Box [${b.type}] at offset 0x${b.boxStart.toString(16).padStart(6, '0')} (${b.boxStart}) size=${b.boxSize} bytes`);
    }

    // Check if the ISO BMFF boxes form a continuous stream or if they are enclosed in UMP parts
    // Let's test extracting the boxes from the first ftyp/styp or moof to mdat:
    if (foundBoxes.length > 0) {
      const firstBox = foundBoxes[0];
      console.log(`\nFirst box is [${firstBox.type}] at offset ${firstBox.boxStart}`);

      // Let's extract from the start of the first box:
      const extractedMedia = rawUmp.slice(firstBox.boxStart);
      const tmpPath = '/tmp/extracted_ump_media.mp4';
      fs.writeFileSync(tmpPath, extractedMedia);

      console.log(`Written ${extractedMedia.length} bytes to ${tmpPath}`);

      // Probe with ffprobe
      try {
        const probeOut = execSync(`ffprobe -v error -show_format -show_streams ${tmpPath}`).toString();
        console.log('\n[FFPROBE RESULT ON EXTRACTED UMP MEDIA]:');
        console.log(probeOut);
      } catch (e) {
        console.log('\n[FFPROBE Note]:', e.message.slice(0, 300));
      }
    }

  } finally {
    await browser.close();
  }
})();
