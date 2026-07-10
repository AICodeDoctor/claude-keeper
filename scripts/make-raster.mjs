#!/usr/bin/env node
/**
 * make-raster — renders docs/assets/demo.gif (animated) and demo.png (hero still)
 * from the shared demo scene, for platforms that reject animated SVG (Dev.to,
 * Reddit, Product Hunt, X, Discord).
 *
 * Pipeline: renderFrameSvg(t) -> qlmanage (SVG->PNG) -> gifenc (GIF) / upng (PNG).
 *
 * Requirements (not project deps — install ad hoc when regenerating):
 *   - macOS `qlmanage` (built in) for SVG rasterisation
 *   - `npm i -g gifenc upng-js`  OR run from a dir where they're installed, e.g.
 *       npm i --no-save gifenc upng-js && node scripts/make-raster.mjs
 *
 * The animated SVG (docs/assets/demo.svg) is produced separately by `npm run demo`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderFrameSvg, T, W, H } from './demo-scene.mjs';

const CROP_W = W, CROP_H = H;
const FRAMES = 30;
const DELAY_MS = 500;

let gifenc, UPNG;
try {
  gifenc = (await import('gifenc')).default;
  UPNG = (await import('upng-js')).default;
} catch {
  console.error(
    'Missing encoders. Run:\n  npm i --no-save gifenc upng-js\nthen re-run this script.',
  );
  process.exit(1);
}
const { GIFEncoder, quantize, applyPalette } = gifenc;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'docs', 'assets');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-raster-'));
const svgDir = path.join(tmp, 'svg');
const pngDir = path.join(tmp, 'png');
fs.mkdirSync(svgDir);
fs.mkdirSync(pngDir);

// 1) frame SVGs
const step = T / FRAMES;
for (let i = 0; i < FRAMES; i++) {
  const name = 'f' + String(i).padStart(2, '0');
  fs.writeFileSync(path.join(svgDir, name + '.svg'), renderFrameSvg(i * step));
}

// 2) rasterise with qlmanage (renders into a square canvas; we crop below)
execFileSync('qlmanage', ['-t', '-s', String(W), '-o', pngDir, ...fs.readdirSync(svgDir).map((f) => path.join(svgDir, f))], { stdio: 'ignore' });

// 3) decode + crop top CROP_H rows, flatten onto solid bg
function loadRGBA(file) {
  const img = UPNG.decode(fs.readFileSync(path.join(pngDir, file)));
  const src = new Uint8Array(UPNG.toRGBA8(img)[0]);
  const w = img.width;
  const out = new Uint8Array(CROP_W * CROP_H * 4);
  const bg = [13, 17, 23];
  for (let y = 0; y < CROP_H; y++) {
    for (let x = 0; x < CROP_W; x++) {
      const si = (y * w + x) * 4, di = (y * CROP_W + x) * 4;
      const a = src[si + 3] / 255;
      out[di] = Math.round(src[si] * a + bg[0] * (1 - a));
      out[di + 1] = Math.round(src[si + 1] * a + bg[1] * (1 - a));
      out[di + 2] = Math.round(src[si + 2] * a + bg[2] * (1 - a));
      out[di + 3] = 255;
    }
  }
  return out;
}
const files = fs.readdirSync(pngDir).filter((f) => f.endsWith('.png')).sort();
const frames = files.map(loadRGBA);

// 4) global palette across all frames (keeps yellow/blue/green stable, no flicker)
const sample = [];
for (const f of frames) for (let i = 0; i < f.length; i += 4 * 7) sample.push(f[i], f[i + 1], f[i + 2], 255);
const palette = quantize(new Uint8Array(sample), 256);

const gif = GIFEncoder();
for (const f of frames) gif.writeFrame(applyPalette(f, palette), CROP_W, CROP_H, { palette, delay: DELAY_MS });
gif.finish();
fs.writeFileSync(path.join(outDir, 'demo.gif'), gif.bytes());

// 5) hero still = end-state frame
const hero = frames[frames.length - 2];
fs.writeFileSync(path.join(outDir, 'demo.png'), Buffer.from(UPNG.encode([hero.buffer], CROP_W, CROP_H, 0)));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('wrote docs/assets/demo.gif and docs/assets/demo.png');
