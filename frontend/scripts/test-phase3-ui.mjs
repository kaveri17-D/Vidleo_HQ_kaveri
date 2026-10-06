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
    ],
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));

    console.log('[1] Loading https://frontend-kaveri-d.vercel.app/ ...');
    await page.goto('https://frontend-kaveri-d.vercel.app/', { waitUntil: 'networkidle2', timeout: 30000 });

    console.log('[2] Locating UrlDownloader input: input[placeholder="Paste a video link here..."]');
    const inputSelector = 'input[placeholder="Paste a video link here..."]';
    await page.waitForSelector(inputSelector, { timeout: 10000 });

    console.log(`[3] Entering video URL: ${VIDEO_URL} ...`);
    await page.type(inputSelector, VIDEO_URL);

    console.log('[4] Submitting analysis request via Enter key...');
    await page.keyboard.press('Enter');

    console.log('[5] Waiting for detection card on UI...');
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('Me at the zoo') || text.includes('DIRECT SOURCE UNAVAILABLE') || text.includes('STREAM SOURCE UNRESOLVED');
    }, { timeout: 25000 });

    console.log('[PASS] Video detected on UI!');

    // Wait a moment for React renders
    await new Promise(r => setTimeout(r, 2000));

    const pageText = await page.evaluate(() => document.body.innerText);
    console.log('\n--- UI DIAGNOSTICS ---');
    console.log('Contains "Me at the zoo":', pageText.includes('Me at the zoo'));
    console.log('Contains "DIRECT SOURCE UNAVAILABLE":', pageText.includes('DIRECT SOURCE UNAVAILABLE'));
    console.log('Contains "Browser Playback Capture":', pageText.includes('Browser Playback Capture'));
    console.log('Contains "Download 10s Demo":', pageText.includes('Download 10s Demo'));
    console.log('Contains "Download Full Video":', pageText.includes('Download Full Video'));
    console.log('Contains "EXTENSION READY":', pageText.includes('EXTENSION READY'));
    console.log('Contains "Vidleo Companion Extension is required":', pageText.includes('Vidleo Companion Extension is required'));

    // Check DOM markers
    const domStatus = await page.evaluate(() => ({
      domInstalled: document.documentElement.getAttribute('data-nexus-extension-installed'),
      domVersion: document.documentElement.getAttribute('data-nexus-extension-version'),
      windowFlag: window.__NEXUS_EXTENSION_INSTALLED__,
      diagnostic: window.__NEXUS_DIAGNOSTIC__,
    }));
    console.log('DOM Extension Markers:', JSON.stringify(domStatus, null, 2));

  } finally {
    await browser.close();
  }
})();
