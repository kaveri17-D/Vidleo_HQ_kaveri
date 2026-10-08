import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extDistPath = path.resolve(__dirname, '../../extension/dist');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--load-extension=${extDistPath}`,
      `--disable-extensions-except=${extDistPath}`,
    ],
  });

  browser.on('targetcreated', async (t) => {
    const p = await t.page().catch(() => null);
    if (p) p.on('console', m => console.log(`[TARGET ${t.type()} ${t.url().split('/').pop()}]`, m.text()));
  });

  let swTarget = null;
  for (let i = 0; i < 30; i++) {
    const targets = browser.targets();
    swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
    if (swTarget) break;
    await new Promise(r => setTimeout(r, 200));
  }

  const extUrl = swTarget.url();
  const extId = new URL(extUrl).hostname;
  console.log('Extension ID:', extId);

  // Trigger offscreen creation by pinging SW or calling ensureOffscreenDocument
  const swWorker = await swTarget.worker();
  swWorker.on('console', m => console.log('[SW LOG]', m.text()));

  // Read buffers
  const videoBase64 = fs.readFileSync('downloads/complete_av1_video.mp4').toString('base64');
  const audioBase64 = fs.readFileSync('downloads/ump_audio_itag251.webm').toString('base64');

  // Open offscreen document directly so we have a target
  const offscreenPage = await browser.newPage();
  offscreenPage.on('console', m => console.log('[OFFSCREEN LOG]', m.text()));
  await offscreenPage.goto(`chrome-extension://${extId}/offscreen.html`);

  console.log('Dispatching message from SW to offscreen...');
  const res = await swWorker.evaluate(async (vB64, aB64) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'PROCESS_CDP_MEDIA_FFMPEG',
        payload: {
          sessionId: 'debug-session',
          filename: 'debug_test.mp4',
          videoBase64: vB64,
          audioBase64: aB64,
          videoBytesCount: vB64.length,
          audioBytesCount: aB64.length,
        }
      }, (resp) => {
        resolve({ lastError: chrome.runtime.lastError?.message, resp });
      });
    });
  }, videoBase64, audioBase64);

  console.log('SW Response:', JSON.stringify(res, null, 2));

  await browser.close();
})();
