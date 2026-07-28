import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  contrastRatio,
  linearizeSrgbChannel,
  parseHexColor,
  relativeLuminance,
} from '../lib/ui/contrast.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const css = await read('app/globals.css');

function cssToken(name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[\\da-fA-F]{3,6})\\s*;`));
  assert.ok(match, `Missing hexadecimal CSS token --${name}`);
  return match[1];
}

function expectContrast(foregroundToken, backgroundToken, minimum = 4.5) {
  const ratio = contrastRatio(cssToken(foregroundToken), cssToken(backgroundToken));
  assert.ok(
    ratio >= minimum,
    `--${foregroundToken} on --${backgroundToken} is ${ratio.toFixed(2)}:1; expected at least ${minimum}:1`,
  );
  return ratio;
}

test('contrast utility follows the WCAG sRGB luminance algorithm', () => {
  assert.deepEqual(parseHexColor('#fff'), { red: 255, green: 255, blue: 255 });
  assert.equal(linearizeSrgbChannel(0), 0);
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#ffffff'), 1);
  assert.equal(contrastRatio('#000', '#fff'), 21);
  assert.throws(() => parseHexColor('transparent'), /hexadecimal color/);
});

test('light surfaces use dark text and dark surfaces use light text', () => {
  for (const background of ['ui-surface-page', 'ui-surface-card', 'ui-surface-elevated']) {
    expectContrast('ui-text-primary', background);
    expectContrast('ui-text-secondary', background);
    expectContrast('ui-text-muted', background);
  }
  expectContrast('ui-text-link', 'ui-surface-card');
  expectContrast('ui-text-inverse', 'ui-surface-inverse');
  expectContrast('ui-text-inverse-secondary', 'ui-surface-inverse');
  expectContrast('ui-text-inverse-muted', 'ui-surface-inverse');
});

test('every text field is white with black values and a readable placeholder', () => {
  assert.equal(cssToken('ui-field-bg').toLowerCase(), '#ffffff');
  assert.equal(cssToken('ui-field-text').toLowerCase(), '#090909');
  expectContrast('ui-field-text', 'ui-field-bg');
  expectContrast('ui-field-placeholder', 'ui-field-bg');
  expectContrast('ui-field-border', 'ui-field-bg', 3);

  assert.match(css, /\.ui-inverse :where\([\s\S]*background-color: var\(--ui-field-bg\);[\s\S]*color: var\(--ui-field-text\)/);
  assert.match(css, /\.ui-inverse :where\(select option, datalist option\)[\s\S]*background-color: var\(--ui-field-bg\);[\s\S]*color: var\(--ui-field-text\)/);
});

test('primary, secondary, destructive, disabled, border, and focus pairs are measurable', () => {
  expectContrast('ui-action-primary-text', 'ui-action-primary');
  expectContrast('ui-action-secondary-text', 'ui-action-secondary');
  expectContrast('ui-action-destructive-text', 'ui-action-destructive');
  expectContrast('ui-action-disabled-text', 'ui-action-disabled-bg');
  expectContrast('ui-action-disabled-border', 'ui-action-disabled-bg', 3);
  expectContrast('ui-field-disabled-text', 'ui-field-disabled-bg');
  expectContrast('ui-field-disabled-border', 'ui-field-disabled-bg', 3);
  expectContrast('ui-border-default', 'ui-surface-elevated', 3);
  expectContrast('ui-border-focus', 'ui-surface-elevated', 3);

  assert.match(css, /\.ui-inverse \.ui-button-primary[\s\S]*background: #ffffff;[\s\S]*color: #000000/);
  assert.match(css, /\.ui-inverse \.ui-button-secondary[\s\S]*border-color: var\(--ui-border-strong\);[\s\S]*color: var\(--ui-text-primary\)/);
});

test('status badges stay white and black on light pages with color limited to an accent', () => {
  const statuses = ['success', 'warning', 'error', 'info', 'pending', 'processing', 'offline', 'review', 'failed'];
  for (const status of statuses) {
    assert.equal(cssToken(`ui-status-${status}-fg`).toLowerCase(), '#090909');
    assert.equal(cssToken(`ui-status-${status}-bg`).toLowerCase(), '#ffffff');
    assert.equal(cssToken(`ui-status-${status}-border`).toLowerCase(), '#333333');
    expectContrast(`ui-status-${status}-fg`, `ui-status-${status}-bg`);
    expectContrast(`ui-status-${status}-border`, `ui-status-${status}-bg`, 3);
    assert.ok(
      contrastRatio(cssToken(`ui-status-${status}-accent`), cssToken(`ui-status-${status}-bg`)) >= 3,
      `${status} accent must remain visible against the white badge`,
    );
  }
  assert.match(css, /\.ui-status[\s\S]*border-inline-start: 4px solid var\(--ui-status-accent\)/);
  assert.match(css, /\.ui-inverse \.ui-status[\s\S]*--ui-status-fg: #ffffff;[\s\S]*--ui-status-bg: #070b12;[\s\S]*--ui-status-border: #d1d5db/);
});

test('shared status badges include visible text and an icon, not color alone', async () => {
  const component = await read('components/ui/StatusBadge.tsx');
  assert.match(component, /<Icon aria-hidden="true"/);
  assert.match(component, /<span>\{label\}<\/span>/);
  assert.match(component, /aria-label=\{label\}/);
  for (const tone of ['offline', 'failed', 'review', 'approved', 'rejected', 'pending', 'processing']) {
    assert.match(component, new RegExp(`${tone}:\\s*'ui-(?:status|priority)-`));
  }
});

test('observed pages use explicit high-contrast cards, actions, fields, and inverse drawers', async () => {
  const [
    tasks,
    evidence,
    cameras,
    taskEditor,
    quickBooking,
    reservationInputs,
    evidenceAttachment,
    assistant,
  ] = await Promise.all([
    read('app/dashboard/tasks/page.tsx'),
    read('app/dashboard/evidence-review/page.tsx'),
    read('app/dashboard/cameras/page.tsx'),
    read('components/tasks/TaskEditPanel.tsx'),
    read('components/reservations/ReservationConsole.tsx'),
    read('components/reservations/ReservationInputs.tsx'),
    read('components/brain/TaskEvidenceAttachment.tsx'),
    read('components/brain-experience/BrainAssistant.tsx'),
  ]);

  assert.match(tasks, /border border-black bg-white p-4 text-black/);
  assert.match(tasks, /className="ui-button-primary mt-4 text-sm"/);
  assert.match(evidence, /border border-black bg-white p-4 text-black/);
  assert.match(evidence, /ui-button-destructive">Reject/);
  assert.match(evidence, /ui-button-primary">Approve/);
  assert.match(cameras, /border border-black bg-white p-5 text-black/);
  assert.match(cameras, /className="ui-button-primary mt-4 min-h-11 rounded-xl px-4">\{c\.edit\}/);
  assert.match(taskEditor, /ui-inverse/);
  assert.match(taskEditor, /ui-field/);
  assert.match(quickBooking, /ui-inverse absolute inset-0/);
  assert.match(quickBooking, /const inputClass = 'ui-field/);
  assert.match(reservationInputs, /ui-field mt-1\.5 min-h-12/);
  assert.match(evidenceAttachment, /ui-inverse/);
  assert.match(evidenceAttachment, /ui-field/);
  assert.match(assistant, /'brain-message-user'/);
  assert.match(assistant, /'brain-message-assistant'/);
});

test('source contract rejects the visually failed patterns on semantic controls', async () => {
  const sources = await Promise.all([
    read('components/ui/StatusBadge.tsx'),
    read('components/tasks/TaskEditPanel.tsx'),
    read('components/brain/TaskEvidenceAttachment.tsx'),
    read('components/camera-manager/CameraInspectionControl.tsx'),
    read('components/camera-manager/CameraSkillControl.tsx'),
    read('components/reservations/ReservationInputs.tsx'),
  ]);
  const observed = sources.join('\n');

  assert.doesNotMatch(observed, /ui-status[^'"]*(?:bg-(?:cyan|amber|green|red|rose|violet)-[^'"]*\/)/);
  assert.doesNotMatch(observed, /disabled:opacity-/);
  assert.doesNotMatch(observed, /<(?:input|select|textarea)[^>]*className="[^"]*bg-slate-(?:8|9)/);
  assert.doesNotMatch(observed, /bg-(?:cyan|amber|green|red|rose|violet)-\d+\/(?:5|10|20)[^'"]*text-white/);
  assert.doesNotMatch(css, /color-mix\(/);
});

test('disabled form controls keep explicit readable colors without whole-control opacity', () => {
  assert.match(css, /\.brain-v3 :where\(input, select, textarea\):disabled[\s\S]*opacity: 1 !important/);
  assert.match(css, /\.brain-v3 :where\(button\):disabled,[\s\S]*opacity: 1 !important/);
  assert.doesNotMatch(css, /:disabled\s*\{[^}]*opacity:\s*(?:0|\\.)/);
});

test('navigation is high contrast and the mobile drawer is explicitly inverse', () => {
  assert.match(css, /\.brain-sidebar[\s\S]*background: #ffffff/);
  assert.match(css, /\.brain-nav-item\.is-active[\s\S]*background: #000000;[\s\S]*color: #ffffff/);
  assert.match(css, /\.brain-mobile-menu[\s\S]*background: #070b12;[\s\S]*color: #ffffff/);
  assert.match(css, /\.brain-mobile-menu \.brain-mobile-nav-item\.is-active[\s\S]*background: #ffffff;[\s\S]*color: #000000/);
  expectContrast('ui-notification-badge-fg', 'ui-notification-badge-bg');
});
