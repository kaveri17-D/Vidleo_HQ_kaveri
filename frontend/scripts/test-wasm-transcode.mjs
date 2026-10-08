import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));

  await page.setContent(`
    <!DOCTYPE html>
    <html><body>
    <script type="module">
      import { FFmpeg } from 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
      window.FFmpeg = FFmpeg;
      console.log('FFmpeg script tag loaded');
    </script>
    </body></html>
  `);
  await page.waitForFunction(() => window.FFmpeg, { timeout: 30000 });

  const videoBase64 = fs.readFileSync('downloads/complete_av1_video.mp4').toString('base64');
  const audioBase64 = fs.readFileSync('downloads/ump_audio_itag251.webm').toString('base64');

  const result = await page.evaluate(async (vB64, aB64) => {
    const ffmpeg = new window.FFmpeg();
    const logs = [];
    ffmpeg.on('log', ({ message }) => { logs.push(message); console.log('FFMPEG:', message); });
    console.log('Loading ffmpeg...');
    await ffmpeg.load({
      coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
      wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
    });
    console.log('ffmpeg loaded successfully');

    const vBin = atob(vB64);
    const vBytes = new Uint8Array(vBin.length);
    for (let i = 0; i < vBin.length; i++) vBytes[i] = vBin.charCodeAt(i);

    const aBin = atob(aB64);
    const aBytes = new Uint8Array(aBin.length);
    for (let i = 0; i < aBin.length; i++) aBytes[i] = aBin.charCodeAt(i);

    await ffmpeg.writeFile('v.mp4', vBytes);
    await ffmpeg.writeFile('a.webm', aBytes);

    console.log('Starting exec...');
    const code = await ffmpeg.exec([
      '-i', 'v.mp4',
      '-i', 'a.webm',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      'out.mp4'
    ]);

    return { code, logs };
  }, videoBase64, audioBase64);

  console.log('Result code:', result.code);
  console.log('All Logs:\n' + result.logs.join('\n'));
  await browser.close();
})();
