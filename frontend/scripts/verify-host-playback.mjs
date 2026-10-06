import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const demoPath = '/downloads/Vidleo_YouTube_Demo_Me_At_The_Zoo.webm';
const fullPath = '/downloads/Vidleo_YouTube_Full_Me_At_The_Zoo.webm';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });

  const page = await browser.newPage();

  async function testPlayback(filePath, label) {
    const data = fs.readFileSync(filePath);
    const base64 = data.toString('base64');

    const result = await page.evaluate(async (b64, name) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const blob = new Blob([bytes.buffer], { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.src = url;

      return new Promise((resolve) => {
        video.onloadedmetadata = () => {
          const startMeta = {
            duration: video.duration,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            readyState: video.readyState,
          };

          video.play().then(() => {
            setTimeout(() => {
              resolve({
                name,
                playbackSuccess: video.currentTime > 0,
                currentTime: video.currentTime,
                readyState: video.readyState,
                ...startMeta,
              });
            }, 800);
          }).catch(err => resolve({ name, playbackSuccess: false, error: err.message }));
        };
        video.onerror = () => resolve({ name, playbackSuccess: false, error: 'Video element error' });
      });
    }, base64, label);

    return result;
  }

  const demoResult = await testPlayback(demoPath, '10s Demo');
  const fullResult = await testPlayback(fullPath, 'Full Video');

  console.log('Playback Verification Results:');
  console.log('10s Demo:', JSON.stringify(demoResult, null, 2));
  console.log('Full Video:', JSON.stringify(fullResult, null, 2));

  await browser.close();
})();
