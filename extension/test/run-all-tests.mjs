import esbuild from '../../worker/node_modules/esbuild/lib/main.js';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testFiles = [
  'media-response-accumulator.test.mjs',
  'duration-and-quality.test.mjs',
];

for (const testFile of testFiles) {
  const input = path.join(__dirname, testFile);
  const output = path.join(__dirname, `dist-${testFile}`);
  console.log(`\n[RUNNING TEST]: ${testFile}`);
  await esbuild.build({
    entryPoints: [input],
    bundle: true,
    outfile: output,
    format: 'esm',
    platform: 'node',
  });
  try {
    execSync(`node "${output}"`, { stdio: 'inherit' });
  } finally {
    try { fs.unlinkSync(output); } catch {}
  }
}

console.log('\n========================================');
console.log('ALL EXTENSION UNIT TESTS PASSED!');
console.log('========================================');
