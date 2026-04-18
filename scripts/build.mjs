#!/usr/bin/env node
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
await build({
  entryPoints: [join(root, 'server/_core/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: join(root, 'dist/index.js'),
  external: [
    // Vite and its ecosystem — dev-only, never needed in production bundle
    'vite',
    '@tailwindcss/vite',
    'jiti',
    'lightningcss',
    'fsevents',
    '@babel/preset-typescript',
    // Manus-specific dev plugins — only exist in Manus sandbox, not on VPS
    '@builder.io/vite-plugin-jsx-loc',
    'vite-plugin-manus-runtime',
    // vite.config itself — dev-only, setupVite() is never called in production
    '../../vite.config',
    '../../../vite.config',
  ],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
console.log('Build complete.');
