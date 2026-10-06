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

    const inputSelector = 'input[placeholder="Paste a video link here..."]';
    await page.waitForSelector(inputSelector);
    await page.type(inputSelector, VIDEO_URL);
    await page.keyboard.press('Enter');

    console.log('[2] Waiting for analysis to transition to detected card (up to 40s)...');
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('Select Output Format') || 
             text.includes('New Link') || 
             text.includes('DIRECT SOURCE UNAVAILABLE') ||
             text.includes('Browser Playback Capture') ||
             text.includes('Download 10s Demo');
    }, { timeout: 40000 });

    console.log('[PASS] Detected card rendered!');
    await new Promise(r => setTimeout(r, 2000));

    const analysisInfo = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasTitle: text.includes('Me at the zoo'),
        hasDirectSourceUnavailable: text.includes('DIRECT SOURCE UNAVAILABLE'),
        hasBrowserPlaybackCapture: text.includes('Browser Playback Capture'),
        hasDownload10sDemo: text.includes('Download 10s Demo'),
        hasDownloadFullVideo: text.includes('Download Full Video'),
        hasExtensionReady: text.includes('EXTENSION READY'),
        hasExtensionConnected: text.includes('EXTENSION CONNECTED'),
        hasExtensionRequired: text.includes('Vidleo Companion Extension is required'),
        textSnippet: text.slice(text.indexOf('Me at the zoo'), text.indexOf('Me at the zoo') + 800),
      };
    });

    console.log('Analysis Info:', JSON.stringify(analysisInfo, null, 2));

  } finally {
    await browser.close();
  }
})();
