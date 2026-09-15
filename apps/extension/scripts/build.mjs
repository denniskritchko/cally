import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const watch = process.argv.includes('--watch');
// Default API the extension talks to. Override at build time: CALLY_API_URL=https://cally.example.com pnpm build
const apiUrl = process.env.CALLY_API_URL ?? 'http://localhost:3000';
const canvasUrl = process.env.CANVAS_BASE_URL ?? 'https://canvas.sfu.ca';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
if (!existsSync('dist/icons/icon128.png')) execFileSync('node', ['scripts/make-icons.mjs', 'dist/icons']);

const ctx = await esbuild.context({
  entryPoints: { background: 'src/background.ts', popup: 'src/popup.ts' },
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outdir: 'dist',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  define: {
    __CALLY_API_URL__: JSON.stringify(apiUrl),
    __CANVAS_BASE_URL__: JSON.stringify(canvasUrl),
  },
  logLevel: 'info',
});

if (watch) await ctx.watch();
else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log(`built extension → dist/  (API: ${apiUrl}, Canvas: ${canvasUrl})`);
}
