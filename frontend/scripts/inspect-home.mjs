import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extDistPath = path.resolve(__dirname, '../../extension/dist');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.goto('https://frontend-kaveri-d.vercel.app/', { waitUntil: 'networkidle2' });

  const info = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
      tag: i.tagName,
      type: i.type,
      placeholder: i.placeholder,
      value: i.value,
      className: i.className,
    }));
    const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.innerText,
      type: b.type,
      className: b.className,
    }));
    return { inputs, buttons, forms: document.querySelectorAll('form').length };
  });

  console.log('Page elements on /:', JSON.stringify(info, null, 2));
  await browser.close();
})();
