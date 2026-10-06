import fs from 'node:fs';
import path from 'node:path';
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

  console.log('[NEXUS Extension Build] Build completed successfully into extension/dist!');
}

build().catch((err) => {
  console.error('[NEXUS Extension Build] Build failed:', err);
  process.exit(1);
});
