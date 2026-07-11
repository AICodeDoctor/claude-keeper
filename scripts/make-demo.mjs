#!/usr/bin/env node
/**
 * make-demo — writes the animated SVG demo to docs/assets/demo.svg.
 *
 * The scene lives in demo-scene.mjs (shared with the PNG/GIF frame renderer).
 * The animation is pure CSS keyframes (no scripts, no external assets) so it
 * renders and animates when embedded as an <img> in a GitHub README or the site.
 *
 * Run: npm run demo
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAnimatedSvg } from './demo-scene.mjs';

const svg = renderAnimatedSvg();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'docs', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'demo.svg');
fs.writeFileSync(outPath, svg);
console.log(`wrote ${outPath} (${svg.length} bytes)`);
