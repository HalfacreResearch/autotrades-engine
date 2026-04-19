#!/usr/bin/env node
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Plugin to intercept any import that resolves to vite.config and replace it
// with an empty stub. This prevents the vite.config absolute path from being
// bundled into dist/index.js, which causes ERR_MODULE_NOT_FOUND on Hostinger.
const stubViteConfigPlugin = {
  name: 'stub-vite-config',
  setup(build) {
    // Match any import path that ends with vite.config (with or without extension)
    build.onResolve({ filter: /vite\.config/ }, args => {
      return { path: args.path, namespace: 'vite-config-stub' };
    });
    build.onLoad({ filter: /.*/, namespace: 'vite-config-stub' }, () => {
      return {
        contents: 'export default {};',
        loader: 'js',
      };
    });
  },
};

await build({
  entryPoints: [join(root, 'server/_core/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: join(root, 'dist/index.js'),
  plugins: [stubViteConfigPlugin],
  external: [
    // Vite and its ecosystem -- dev-only, never needed in production bundle
    'vite',
    '@tailwindcss/vite',
    'jiti',
    'lightningcss',
    'fsevents',
    '@babel/preset-typescript',
    // Manus-specific dev plugins -- only exist in Manus sandbox, not on Hostinger
    '@builder.io/vite-plugin-jsx-loc',
    'vite-plugin-manus-runtime',
  ],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
console.log('Build complete.');
