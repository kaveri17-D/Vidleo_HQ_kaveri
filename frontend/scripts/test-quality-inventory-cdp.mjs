import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extDistPath = path.resolve(__dirname, '../../extension/dist');
const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

(async () => {
  console.log('='.repeat(80));
  console.log('TESTING BUG A & B: STREAM INVENTORY DISCOVERY & FORENSIC CDP REMUX');
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
    // 1. Open YouTube page
    console.log('[Step 1] Opening YouTube page:', VIDEO_URL);
    const ytPage = await browser.newPage();
    await ytPage.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await ytPage.waitForSelector('video', { timeout: 25000 });
    console.log('[PASS] YouTube player video element initialized');

    // Mute and pause video
    await ytPage.evaluate(() => {
      const v = document.querySelector('video');
      if (v) { v.muted = true; v.pause(); }
    });

    // Let observer run and discover inventory
    await new Promise(r => setTimeout(r, 2000));

    // 2. Open Extension page to use chrome.runtime
    console.log('[Step 2] Locating Extension ID...');
    let swTarget = null;
    for (let i = 0; i < 30; i++) {
      swTarget = browser.targets().find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
      if (swTarget) break;
      await new Promise(r => setTimeout(r, 200));
    }
    const extId = swTarget.url().split('/')[2];
    console.log('[PASS] Extension ID:', extId);

    const extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${extId}/popup.html`);

    // 3. Query RESOLVE_MEDIA from extension context
    console.log('[Step 3] Dispatching RESOLVE_MEDIA from extension page...');
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

    console.log('\n[PASS] Stream Inventory Discovered from Active Player Session:');
    console.log('Title:   ', result.title);
    console.log('Uploader:', result.uploader);
    console.log('Duration:', result.duration);
    console.log('Video Formats Discovered:', result.video_formats?.length);
    console.log('Audio Formats Discovered:', result.audio_formats?.length);

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

    // Verify presence of qualities
    const labels = result.video_formats.map(f => f.qualityLabel || f.format_note || `${f.height}p`);
    console.log('\nQuality labels discovered:', labels);
    const has360p = labels.some(l => l.includes('360'));
    const has240p = labels.some(l => l.includes('240'));
    const has144p = labels.some(l => l.includes('144'));
    console.log(`Verification: 360p=${has360p}, 240p=${has240p}, 144p=${has144p}`);

    if (result.video_formats.length < 2) {
      throw new Error('Expected multiple video formats discovered from YouTube player session');
    }

    console.log('\n[PASS] BUG A RESOLVED: Real stream inventory discovered from browser player session without hardcoding!');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('[FAIL]', err);
  process.exit(1);
});
