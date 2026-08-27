/* Re-exports the home screen PNGs from icon.svg.
 *
 *   node tools/render-icons.mjs
 *
 * The artwork lives in one place — icon.svg — because keeping five drawings
 * in sync by hand is how an app ends up with an old logo on somebody's home
 * screen. The PNGs exist anyway because not every browser reads the SVG:
 * Firefox on Android only offers to install the app when the manifest names
 * a raster icon whose size it can parse, and iOS ignores an SVG in
 * apple-touch-icon. Run this after editing icon.svg and commit the output.
 *
 * It renders with the same headless Chromium the smoke tests already use.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'icon.svg'), 'utf8');
/* Everything between the <svg> tags, so it can be re-wrapped at any size. */
const art = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

const page = size => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${art}</svg>`;

/* The maskable copy is the same drawing at 80%: an Android adaptive icon
   only guarantees the inner ~66% circle, and the bar at full size sits right
   on that line, so a round mask could shave a plate off. */
const masked = size => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#17191C"/>
<g transform="translate(256 256) scale(0.8) translate(-256 -256)">${art}</g></svg>`;

const jobs = [
  ['icon-192.png', 192, page],           // the smallest size Firefox accepts
  ['icon-512.png', 512, page],           // splash screens and app listings
  ['icon-maskable-512.png', 512, masked],// Android home screen, under a mask
  ['icon-180.png', 180, page],           // apple-touch-icon
];

const browser = await chromium.launch();
const tab = await browser.newPage();
for (const [name, size, tpl] of jobs) {
  await tab.setViewportSize({ width: size, height: size });
  await tab.setContent(tpl(size));
  writeFileSync(join(root, name), await tab.locator('svg').screenshot());
  console.log(name + '  ' + size + 'x' + size);
}
await browser.close();
