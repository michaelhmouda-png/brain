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

function scopedCssToken(selector, name) {
  const block = css.match(new RegExp(`${selector.replaceAll('.', '\\.')}\\s*\\{([^}]+)\\}`));
  assert.ok(block, `Missing CSS block ${selector}`);
  const match = block[1].match(new RegExp(`--${name}:\\s*(#[\\da-fA-F]{3,6})\\s*;`));
  assert.ok(match, `Missing hexadecimal CSS token --${name} in ${selector}`);
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

test('primary, secondary, muted, inverse, link, and disabled text meet normal-text contrast', () => {
  for (const background of ['ui-surface-page', 'ui-surface-card']) {
    expectContrast('ui-text-primary', background);
  }
  expectContrast('ui-text-secondary', 'ui-surface-page');
  expectContrast('ui-text-muted', 'ui-surface-page');
  expectContrast('ui-text-link', 'ui-surface-card');
  expectContrast('ui-text-inverse', 'ui-surface-inverse');
  expectContrast('ui-text-inverse-secondary', 'ui-surface-inverse');
  expectContrast('ui-text-inverse-muted', 'ui-surface-inverse');
  expectContrast('ui-text-disabled', 'ui-surface-disabled');
});

test('actions, form values, placeholders, focus, and meaningful borders meet their thresholds', () => {
  expectContrast('ui-action-primary-text', 'ui-action-primary');
  expectContrast('ui-action-destructive-text', 'ui-action-destructive');
  expectContrast('ui-action-secondary-text', 'ui-action-secondary');
  expectContrast('ui-text-primary', 'ui-surface-elevated');
  expectContrast('ui-text-muted', 'ui-surface-elevated');
  expectContrast('ui-border-default', 'ui-surface-elevated', 3);
  expectContrast('ui-border-focus', 'ui-surface-elevated', 3);
  expectContrast('ui-border-disabled', 'ui-surface-disabled', 3);
});

test('inverse inputs and disabled controls retain measurable contrast in dark drawers', () => {
  const inverse = (name) => scopedCssToken('.ui-inverse', name);
  assert.ok(contrastRatio(inverse('ui-text-primary'), inverse('ui-surface-inset')) >= 4.5);
  assert.ok(contrastRatio(inverse('ui-text-muted'), inverse('ui-surface-inset')) >= 4.5);
  assert.ok(contrastRatio(inverse('ui-border-default'), inverse('ui-surface-inset')) >= 3);
  assert.ok(contrastRatio(inverse('ui-border-focus'), inverse('ui-surface-inset')) >= 3);
  assert.ok(contrastRatio(inverse('ui-text-disabled'), inverse('ui-surface-disabled')) >= 4.5);
  assert.ok(contrastRatio(inverse('ui-border-disabled'), inverse('ui-surface-disabled')) >= 3);
});

test('every semantic alert, status, and priority pair has readable text and a visible boundary', () => {
  const statuses = ['success', 'warning', 'error', 'info', 'pending', 'processing', 'offline', 'review', 'failed'];
  for (const status of statuses) {
    expectContrast(`ui-status-${status}-fg`, `ui-status-${status}-bg`);
    expectContrast(`ui-status-${status}-border`, `ui-status-${status}-bg`, 3);
  }

  assert.match(css, /\.ui-status-approved[\s\S]*--ui-status-fg: var\(--ui-status-success-fg\)/);
  assert.match(css, /\.ui-status-rejected[\s\S]*--ui-status-fg: var\(--ui-status-error-fg\)/);
  assert.match(css, /\.ui-priority-critical[\s\S]*--ui-status-fg: var\(--ui-status-error-fg\)/);
  assert.match(css, /\.ui-priority-high[\s\S]*--ui-status-fg: var\(--ui-status-warning-fg\)/);
  assert.match(css, /\.ui-priority-medium[\s\S]*--ui-status-fg: var\(--ui-status-info-fg\)/);
  assert.match(css, /\.ui-priority-low[\s\S]*--ui-status-fg: var\(--ui-status-success-fg\)/);
});

test('navigation and notification states use measured semantic pairs', () => {
  expectContrast('ui-text-secondary', 'ui-surface-page');
  expectContrast('ui-text-primary', 'ui-surface-selected');
  expectContrast('ui-notification-badge-fg', 'ui-notification-badge-bg');
  assert.match(css, /\.brain-nav-item\s*\{[\s\S]*color: var\(--ui-text-secondary\)/);
  assert.match(css, /\.brain-mobile-nav-item\s*\{[\s\S]*color: var\(--ui-text-secondary\)/);
  assert.match(css, /\.ui-notification-badge\s*\{/);
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

test('observed task, evidence, camera, drawer, and notification failures consume semantic primitives', async () => {
  const [tasks, evidence, cameras, agents, taskEditor, quickBooking, bell] = await Promise.all([
    read('app/dashboard/tasks/page.tsx'),
    read('app/dashboard/evidence-review/page.tsx'),
    read('app/dashboard/cameras/page.tsx'),
    read('components/camera-manager/BrainAgentManager.tsx'),
    read('components/tasks/TaskEditPanel.tsx'),
    read('components/reservations/ReservationConsole.tsx'),
    read('components/NotificationBell.tsx'),
  ]);

  assert.match(tasks, /<StatusBadge label=\{t\.priority\[task\.priority\]\}/);
  assert.match(tasks, /ui-button-secondary/);
  assert.match(evidence, /human_approved:\s*'approved'/);
  assert.match(evidence, /verification_failed:\s*'failed'/);
  assert.match(cameras, /deviceStatusTone\(item\.status\)/);
  assert.match(agents, /gatewayStatusTone\(item\.status\)/);
  assert.match(taskEditor, /ui-inverse/);
  assert.match(quickBooking, /ui-inverse/);
  assert.match(quickBooking, /<StatusBadge[\s\S]*tone=\{statusTone\[row\.status\]/);
  assert.match(bell, /ui-notification-badge/);
  assert.match(bell, /t\.notifications\.offline/);
});

test('disabled controls retain explicit readable colors instead of whole-control opacity', () => {
  assert.match(css, /\.ui-button-primary:disabled,[\s\S]*opacity: 1 !important/);
  assert.match(css, /\.brain-v3 :where\(button, input, select, textarea\):disabled,[\s\S]*opacity: 1 !important/);
});
