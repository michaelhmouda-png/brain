import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import manifest from '../app/manifest.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const layout = read('app/layout.tsx');

const expectedIcons = [
  { src: '/icons/icon-192.png', sizes: '192x192', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', purpose: 'any' },
  { src: '/icons/icon-maskable-192.png', sizes: '192x192', purpose: 'maskable' },
  { src: '/icons/icon-maskable-512.png', sizes: '512x512', purpose: 'maskable' },
];

function pngDimensions(path) {
  const buffer = readFileSync(new URL(`../${path}`, import.meta.url));
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('existing App Router manifest retains one canonical standalone PWA contract', () => {
  const value = manifest();
  assert.equal(value.name, 'Brain');
  assert.equal(value.short_name, 'Brain');
  assert.equal(value.start_url, '/dashboard');
  assert.equal(value.display, 'standalone');
  assert.equal(value.theme_color, '#020617');
  assert.equal(value.background_color, '#020617');
});

test('manifest publishes exact any and maskable PNG icon entries', () => {
  const icons = manifest().icons ?? [];
  assert.equal(icons.length, expectedIcons.length);
  for (const expected of expectedIcons) {
    const icon = icons.find((candidate) => candidate.src === expected.src);
    assert.ok(icon, `missing ${expected.src}`);
    assert.equal(icon.sizes, expected.sizes);
    assert.equal(icon.type, 'image/png');
    assert.equal(icon.purpose, expected.purpose);
  }
});

test('every approved PNG exists and has its canonical dimensions', () => {
  const dimensions = {
    'public/icons/brain-icon-master-1024.png': 1024,
    'public/icons/icon-192.png': 192,
    'public/icons/icon-512.png': 512,
    'public/icons/icon-maskable-192.png': 192,
    'public/icons/icon-maskable-512.png': 512,
    'public/icons/apple-touch-icon.png': 180,
  };
  for (const [path, size] of Object.entries(dimensions)) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `missing ${path}`);
    assert.deepEqual(pngDimensions(path), { width: size, height: size });
  }
});

test('root metadata publishes the Apple touch icon without changing viewport or locale behavior', () => {
  assert.match(layout, /icons:\s*\{[\s\S]*apple:\s*\[[\s\S]*url:\s*"\/icons\/apple-touch-icon\.png"/);
  assert.match(layout, /sizes:\s*"180x180"/);
  assert.match(layout, /type:\s*"image\/png"/);
  assert.match(layout, /themeColor:\s*"#020617"/);
  assert.match(layout, /lang=\{language\}/);
  assert.match(layout, /dir=\{language === "ar" \? "rtl" : "ltr"\}/);
});

test('notification service worker remains independent and no PWA caching layer is added', () => {
  const serviceWorker = read('public/notification-sw.js');
  assert.match(serviceWorker, /self\.addEventListener\('push'/);
  assert.doesNotMatch(read('app/manifest.ts'), /serviceWorker|cache|workbox/i);
});
