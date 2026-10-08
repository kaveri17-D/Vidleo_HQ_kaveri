import puppeteer from 'puppeteer-core';
import path from 'node:path';

const extDistPath = '/workspace/extension/dist';

async function testFfmpegCodecs() {
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
    ],
  });

  // Find extension ID
  let extId = '';
  for (let i = 0; i < 30; i++) {
    const targets = browser.targets();
    const sw = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
    if (sw) {
      extId = sw.url().split('/')[2];
      break;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('Extension ID:', extId);

  const offscreenUrl = `chrome-extension://${extId}/offscreen.html`;
  const page = await browser.newPage();
  page.on('console', msg => console.log('  [OFFSCREEN LOG]', msg.text()));
  await page.goto(offscreenUrl, { waitUntil: 'load' });

  const result = await page.evaluate(async () => {
    if (typeof window.__queryFfmpegCodecs === 'function') {
      return await window.__queryFfmpegCodecs();
    }
    return { error: '__queryFfmpegCodecs not found' };
  });

  const decodersLog = result.decoders || '';
  const encodersLog = result.encoders || '';
  const summary = {
    hasAv1Decoder: decodersLog.includes('av1') || decodersLog.includes('dav1d') || decodersLog.includes('libdav1d'),
    hasH264Decoder: decodersLog.includes('h264'),
    hasAacEncoder: encodersLog.includes('aac'),
    hasOpusDecoder: decodersLog.includes('opus'),
    av1Matches: decodersLog.split('\n').filter(l => l.toLowerCase().includes('av1')),
    h264Matches: decodersLog.split('\n').filter(l => l.toLowerCase().includes('h264')),
    aacMatches: encodersLog.split('\n').filter(l => l.toLowerCase().includes('aac')),
    opusMatches: decodersLog.split('\n').filter(l => l.toLowerCase().includes('opus')),
  };

  console.log('FFmpeg WASM Codec Capabilities:', JSON.stringify(summary, null, 2));
  await browser.close();
}

testFfmpegCodecs().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
