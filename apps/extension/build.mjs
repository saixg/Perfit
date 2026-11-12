// Builds the unpacked extension into dist/ with three Vite builds:
//   1. options page (HTML app; also copies public/ → manifest.json)
//   2. content script: ONE classic IIFE file, because MV3 content scripts can't be ES modules
//   3. service worker: an ES module ("type": "module" in the manifest)
// `node build.mjs --watch` rebuilds on change; reload the extension in chrome://extensions afterwards.

import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const watch = process.argv.includes('--watch') ? {} : null;
const outDir = resolve(here, 'dist');
const common = {
  configFile: false,
  logLevel: 'warn',
  plugins: [preact()],
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
};

await build({
  ...common,
  root: resolve(here, 'src'),
  publicDir: resolve(here, 'public'),
  base: './',
  build: { outDir, emptyOutDir: true, watch, rollupOptions: { input: resolve(here, 'src/options.html') } },
});

for (const [entry, file, format] of [
  ['src/content/main.tsx', 'content', 'iife'],
  ['src/background/sw.ts', 'sw', 'es'],
]) {
  await build({
    ...common,
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      watch,
      // Readable stack traces while dogfooding; `--minify` for store/beta zips.
      minify: process.argv.includes('--minify'),
      lib: { entry: resolve(here, entry), formats: [format], name: 'perfit', fileName: () => `${file}.js` },
    },
  });
}

console.log(`perfit extension built → ${outDir}${watch ? ' (watching)' : ''}`);
