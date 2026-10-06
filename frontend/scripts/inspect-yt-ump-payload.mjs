import puppeteer from 'puppeteer-core';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extDistPath = path.resolve(__dirname, '../../extension/dist');

const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

console.log('='.repeat(75));
console.log('INVESTIGATING YT-UMP / SABR PAYLOAD STRUCTURE');
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

    let umpPayload = null;
    let umpUrl = '';

    client.on('Network.loadingFinished', async (params) => {
      if (umpPayload) return;
      try {
        const bodyRes = await client.send('Network.getResponseBody', { requestId: params.requestId });
        const buf = bodyRes.base64Encoded ? Buffer.from(bodyRes.body, 'base64') : Buffer.from(bodyRes.body, 'utf-8');
        if (buf.length > 50000) {
          umpPayload = buf;
          umpUrl = params.requestId;
          console.log(`[Acquired Target Payload]: ${buf.length} bytes`);
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
      if (umpPayload) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!umpPayload) {
      console.error('[FAIL] Could not capture UMP payload');
      process.exit(1);
    }

    console.log(`\nAnalyzing ${umpPayload.length} bytes of UMP data...`);

    // Scan for known media signatures inside the UMP payload
    const signatures = [
      { name: 'EBML Header (WebM)', hex: '1a45dfa3' },
      { name: 'MP4 ftyp box', ascii: 'ftyp' },
      { name: 'MP4 moof box', ascii: 'moof' },
      { name: 'MP4 mdat box', ascii: 'mdat' },
      { name: 'MP4 styp box', ascii: 'styp' },
      { name: 'VP9 Keyframe sync', hex: '498342' },
      { name: 'OpusHead tag', ascii: 'OpusHead' },
      { name: 'OpusTags tag', ascii: 'OpusTags' },
      { name: 'ID3 tag', ascii: 'ID3' },
    ];

    console.log('\nScanning for embedded media signatures:');
    const findings = [];

    for (const sig of signatures) {
      const occurrences = [];
      let targetBuf;
      if (sig.hex) targetBuf = Buffer.from(sig.hex, 'hex');
      else targetBuf = Buffer.from(sig.ascii, 'ascii');

      let idx = 0;
      while ((idx = umpPayload.indexOf(targetBuf, idx)) !== -1) {
        occurrences.push(idx);
        idx += targetBuf.length;
        if (occurrences.length >= 10) break;
      }

      console.log(` - ${sig.name.padEnd(25)}: ${occurrences.length} occurrences (offsets: ${occurrences.slice(0, 5).join(', ')}${occurrences.length > 5 ? '...' : ''})`);
      if (occurrences.length > 0) {
        findings.push({ sig: sig.name, offsets: occurrences });
      }
    }

    // Save a sample of the UMP payload to scratch for further inspection
    const scratchDir = '/workspace/scratch';
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
    fs.writeFileSync(path.join(scratchDir, 'ump_sample.bin'), umpPayload);
    console.log(`\nSample payload saved to ${scratchDir}/ump_sample.bin`);

    // Inspect UMP header framing structure
    console.log('\nUMP Frame Header Parsing:');
    let offset = 0;
    let partNum = 0;
    while (offset < Math.min(umpPayload.length, 2048) && partNum < 15) {
      // UMP parts are typically varint-encoded or length-prefixed chunks
      const b0 = umpPayload[offset];
      console.log(`Part #${partNum}: offset=0x${offset.toString(16).padStart(4, '0')} (${offset}) byte=0x${b0.toString(16)} (ascii: ${b0 >= 32 && b0 <= 126 ? String.fromCharCode(b0) : '.'})`);
      offset += 16;
      partNum++;
    }

  } finally {
    await browser.close();
  }
})();
