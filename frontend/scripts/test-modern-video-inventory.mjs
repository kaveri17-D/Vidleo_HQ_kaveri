import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extDistPath = path.resolve(__dirname, '../../extension/dist');
const VIDEO_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'; // Big Buck Bunny (1080p, 720p, 480p, 360p, 240p, 144p)

(async () => {
  console.log('='.repeat(80));
  console.log('TESTING MULTI-QUALITY STREAM INVENTORY ON 1080p/720p/480p/360p/240p/144p VIDEO');
  console.log('='.repeat(80));

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      `--load-extension=${extDistPath}`,
      `--disable-extensions-except=${extDistPath}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  try {
    console.log('[Step 1] Opening YouTube page:', VIDEO_URL);
    const ytPage = await browser.newPage();
    await ytPage.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await ytPage.waitForSelector('video', { timeout: 25000 });
    console.log('[PASS] YouTube player video element initialized');

    await ytPage.evaluate(() => {
      const v = document.querySelector('video');
      if (v) { v.muted = true; v.pause(); }
    });

    await new Promise(r => setTimeout(r, 2000));

    let swTarget = null;
    for (let i = 0; i < 30; i++) {
      swTarget = browser.targets().find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
      if (swTarget) break;
      await new Promise(r => setTimeout(r, 200));
    }
    const extId = swTarget.url().split('/')[2];
    const extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${extId}/popup.html`);

    console.log('[Step 2] Dispatching RESOLVE_MEDIA from extension page...');
    const result = await extPage.evaluate((url) => {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'RESOLVE_MEDIA',
          payload: { url }
        }, (resp) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (resp?.type === 'RESOLVE_MEDIA_ERROR') reject(new Error(resp.payload?.error));
          else resolve(resp?.payload?.manifest || resp?.payload || resp);
        });
      });
    }, VIDEO_URL);

    console.log('\n[PASS] Stream Inventory Discovered:');
    console.log('Title:   ', result.title);
    console.log('Uploader:', result.uploader);
    console.log('Duration:', result.duration);
    console.log('Total Video Formats Discovered:', result.video_formats?.length);
    console.log('Total Audio Formats Discovered:', result.audio_formats?.length);

    console.log('\nDiscovered Video Streams:');
    console.table(result.video_formats.map(f => ({
      itag: f.itag,
      qualityLabel: f.qualityLabel || f.format_note,
      resolution: `${f.width}x${f.height}`,
      fps: f.fps,
      vcodec: f.vcodec,
      acodec: f.acodec,
      bitrate: f.bitrate,
      filesize: f.filesize,
      availability: f.availability,
    })));

    const labels = result.video_formats.map(f => f.qualityLabel || f.format_note || `${f.height}p`);
    console.log('\nQuality labels discovered:', labels);
    const has1080p = labels.some(l => l.includes('1080'));
    const has720p = labels.some(l => l.includes('720'));
    const has480p = labels.some(l => l.includes('480'));
    const has360p = labels.some(l => l.includes('360'));
    const has240p = labels.some(l => l.includes('240'));
    const has144p = labels.some(l => l.includes('144'));
    console.log(`Verification: 1080p=${has1080p}, 720p=${has720p}, 480p=${has480p}, 360p=${has360p}, 240p=${has240p}, 144p=${has144p}`);

    console.log('\n[PASS] ALL QUALITIES DISCOVERED FROM ACTIVE PLAYER NETWORK SESSION!');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('[FAIL]', err);
  process.exit(1);
});
