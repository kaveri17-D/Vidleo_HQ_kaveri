import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import esbuild from '../worker/node_modules/esbuild/lib/main.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, 'dist');

async function build() {
  console.log('[NEXUS Extension Build] Starting build...');

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const frontendNodeModules = path.resolve(__dirname, '../frontend/node_modules');
  const defines = {
    'process.env.NEXT_PUBLIC_NEXUS_BROWSER_HLS_ENABLED': '"true"',
    'process.env.NEXT_PUBLIC_DISABLE_WORKER_RELAY': '"false"',
    'process.env.NODE_ENV': '"production"',
  };

  // Build Background Service Worker
  console.log('[NEXUS Extension Build] Bundling background service worker...');
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, 'src/background/service-worker.ts')],
    outfile: path.resolve(distDir, 'background.js'),
    bundle: true,
    format: 'esm',
    target: ['chrome110'],
    platform: 'browser',
    sourcemap: true,
    define: defines,
    nodePaths: [frontendNodeModules],
    logLevel: 'info',
  });

  // Build Offscreen Document Runner
  console.log('[NEXUS Extension Build] Bundling offscreen runner...');
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, 'src/offscreen/offscreen.ts')],
    outfile: path.resolve(distDir, 'offscreen.js'),
    bundle: true,
    format: 'esm',
    target: ['chrome110'],
    platform: 'browser',
    sourcemap: true,
    define: defines,
    nodePaths: [frontendNodeModules],
    logLevel: 'info',
  });

  // Build Popup UI
  console.log('[NEXUS Extension Build] Bundling popup UI script...');
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, 'src/ui/popup/popup.ts')],
    outfile: path.resolve(distDir, 'popup.js'),
    bundle: true,
    format: 'esm',
    target: ['chrome110'],
    platform: 'browser',
    sourcemap: true,
    define: defines,
    nodePaths: [frontendNodeModules],
    logLevel: 'info',
  });

  // Build Content Script Bridge
  console.log('[NEXUS Extension Build] Bundling content script bridge...');
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, 'src/content/content.ts')],
    outfile: path.resolve(distDir, 'content.js'),
    bundle: true,
    format: 'iife',
    target: ['chrome110'],
    platform: 'browser',
    sourcemap: true,
    define: defines,
    nodePaths: [frontendNodeModules],
    logLevel: 'info',
  });

  // Build YouTube Observer Content Script
  console.log('[NEXUS Extension Build] Bundling YouTube observer script...');
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, 'src/content/youtube-observer.ts')],
    outfile: path.resolve(distDir, 'youtube-observer.js'),
    bundle: true,
    format: 'iife',
    target: ['chrome110'],
    platform: 'browser',
    sourcemap: true,
    define: defines,
    nodePaths: [frontendNodeModules],
    logLevel: 'info',
  });

  // Copy HTML and manifest files
  console.log('[NEXUS Extension Build] Copying assets...');
  fs.copyFileSync(
    path.resolve(__dirname, 'src/offscreen/index.html'),
    path.resolve(distDir, 'offscreen.html')
  );
  fs.copyFileSync(
    path.resolve(__dirname, 'src/ui/popup/index.html'),
    path.resolve(distDir, 'popup.html')
  );
  fs.copyFileSync(
    path.resolve(__dirname, 'manifest.json'),
    path.resolve(distDir, 'manifest.json')
  );

  // Copy local FFmpeg.wasm assets into extension dist for zero-network offline execution
  const ffmpegCoreDist = path.resolve(frontendNodeModules, '@ffmpeg/core/dist/esm');
  const ffmpegPkgDist = path.resolve(frontendNodeModules, '@ffmpeg/ffmpeg/dist/esm');

  if (fs.existsSync(path.resolve(ffmpegCoreDist, 'ffmpeg-core.js'))) {
    fs.copyFileSync(
      path.resolve(ffmpegCoreDist, 'ffmpeg-core.js'),
      path.resolve(distDir, 'ffmpeg-core.js')
    );
  }
  if (fs.existsSync(path.resolve(ffmpegCoreDist, 'ffmpeg-core.wasm'))) {
    fs.copyFileSync(
      path.resolve(ffmpegCoreDist, 'ffmpeg-core.wasm'),
      path.resolve(distDir, 'ffmpeg-core.wasm')
    );
  }
  const workerSource = fs.existsSync(path.resolve(__dirname, 'src/ffmpeg/worker.ts'))
    ? path.resolve(__dirname, 'src/ffmpeg/worker.ts')
    : path.resolve(ffmpegPkgDist, 'worker.js');
  console.log('[NEXUS Extension Build] Bundling extension-safe FFmpeg worker from', workerSource);
  await esbuild.build({
    entryPoints: [workerSource],
    outfile: path.resolve(distDir, 'ffmpeg-worker.js'),
    bundle: true,
    format: 'esm',
    target: ['chrome110'],
    platform: 'browser',
    nodePaths: [frontendNodeModules],
    logLevel: 'info',
  });

  // Phase 16: Compute SHA256 hashes and generate BUILD_MANIFEST.json
  const hashFile = (p) => {
    if (!fs.existsSync(p)) return 'MISSING';
    const buf = fs.readFileSync(p);
    return crypto.createHash('sha256').update(buf).digest('hex');
  };

  let gitCommit = process.env.GIT_COMMIT || 'unknown';
  if (gitCommit === 'unknown') {
    try {
      gitCommit = execSync('git rev-parse HEAD', { cwd: __dirname, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    } catch {}
  }

  const buildManifest = {
    buildId: `build-${Date.now()}`,
    gitCommit,
    buildTimestamp: new Date().toISOString(),
    extensionVersion: '1.0.1',
    protocolVersion: '1.0.0',
    manifestSha256: hashFile(path.resolve(distDir, 'manifest.json')),
    backgroundSha256: hashFile(path.resolve(distDir, 'background.js')),
    contentSha256: hashFile(path.resolve(distDir, 'content.js')),
    offscreenSha256: hashFile(path.resolve(distDir, 'offscreen.js')),
    ffmpegCoreSha256: hashFile(path.resolve(distDir, 'ffmpeg-core.js')),
    ffmpegWasmSha256: hashFile(path.resolve(distDir, 'ffmpeg-core.wasm')),
    ffmpegWorkerSha256: hashFile(path.resolve(distDir, 'ffmpeg-worker.js')),
  };

  fs.writeFileSync(path.resolve(distDir, 'BUILD_MANIFEST.json'), JSON.stringify(buildManifest, null, 2));

  console.log('[NEXUS Extension Build] BUILD_MANIFEST.json created:');
  console.log(JSON.stringify(buildManifest, null, 2));

  console.log('[NEXUS Extension Build] Build completed successfully into extension/dist!');

  // Also sync dist files into extension root so either path can be loaded in chrome://extensions
  const rootFilesToSync = [
    'background.js', 'background.js.map',
    'offscreen.js', 'offscreen.js.map', 'offscreen.html',
    'content.js', 'content.js.map',
    'youtube-observer.js', 'youtube-observer.js.map',
    'popup.js', 'popup.js.map', 'popup.html',
    'ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-worker.js',
    'BUILD_MANIFEST.json'
  ];
  for (const f of rootFilesToSync) {
    const src = path.resolve(distDir, f);
    const dest = path.resolve(__dirname, f);
    if (fs.existsSync(src)) {
      try { fs.copyFileSync(src, dest); } catch {}
    }
  }
}

build().catch((err) => {
  console.error('[NEXUS Extension Build] Build failed:', err);
  process.exit(1);
});
