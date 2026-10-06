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
    await page.goto('https://frontend-kaveri-d.vercel.app/', { waitUntil: 'networkidle2', timeout: 30000 });

    const inputSelector = 'input[placeholder="Paste a video link here..."]';
    await page.waitForSelector(inputSelector);
    await page.type(inputSelector, VIDEO_URL);
    await page.keyboard.press('Enter');

    await page.waitForFunction(() => document.body.innerText.includes('Me at the zoo'), { timeout: 20000 });
    await new Promise(r => setTimeout(r, 1000));

    const cardText = await page.evaluate(() => {
      // Find the card container
      const cards = Array.from(document.querySelectorAll('div')).filter(d => d.innerText.includes('Me at the zoo') && d.innerText.includes('YouTube'));
      return cards.map(c => c.innerText)[0] || document.body.innerText;
    });

    console.log('Card text on Vercel:');
    console.log(cardText);
  } finally {
    await browser.close();
  }
})();
