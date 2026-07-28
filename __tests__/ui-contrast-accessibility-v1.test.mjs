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

function compositeHex(foreground, background, alpha) {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);
  const channel = (foregroundChannel, backgroundChannel) =>
    Math.round(foregroundChannel * alpha + backgroundChannel * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(fg.red, bg.red)}${channel(fg.green, bg.green)}${channel(fg.blue, bg.blue)}`;
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

test('light management surfaces reuse the canonical Brain V3 surface, text, border, and shadow tokens', () => {
  assert.match(css, /\.ui-management-surface\s*\{[\s\S]*border-color: var\(--ui-border-default\)/);
  assert.match(css, /\.ui-management-surface\s*\{[\s\S]*background: var\(--ui-surface-elevated\)/);
  assert.match(css, /\.ui-management-surface\s*\{[\s\S]*color: var\(--ui-text-primary\)/);
  assert.match(css, /\.ui-management-surface\s*\{[\s\S]*color-scheme: light/);
  assert.match(css, /\.ui-management-inset\s*\{[\s\S]*background: var\(--ui-surface-inset\)/);
  assert.match(css, /\.ui-management-inset\s*\{[\s\S]*border-color: var\(--brain-line\)/);
  assert.match(css, /\.ui-management-divider\s*\{[\s\S]*border-color: var\(--brain-line\)/);
  expectContrast('ui-text-primary', 'ui-surface-elevated');
  expectContrast('ui-text-secondary', 'ui-surface-elevated');
  expectContrast('ui-text-muted', 'ui-surface-elevated');
  expectContrast('ui-border-default', 'ui-surface-elevated', 3);
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

test('observed task, evidence, camera, management, and notification surfaces consume semantic primitives', async () => {
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
  assert.match(taskEditor, /ui-management-surface/);
  assert.match(quickBooking, /ui-management-surface/);
  assert.match(quickBooking, /<StatusBadge[\s\S]*tone=\{statusTone\[row\.status\]/);
  assert.match(bell, /ui-notification-badge/);
  assert.match(bell, /t\.notifications\.offline/);
});

test('task and reservation management drawers use the shared light system without inverse leakage', async () => {
  const [taskEditor, quickBooking, reservationEditor, reservationInputs, incomingCall, assistant] = await Promise.all([
    read('components/tasks/TaskEditPanel.tsx'),
    read('components/reservations/ReservationConsole.tsx'),
    read('components/reservations/ReservationEditPanel.tsx'),
    read('components/reservations/ReservationInputs.tsx'),
    read('components/reservations/IncomingCallPopup.tsx'),
    read('components/brain-experience/BrainAssistant.tsx'),
  ]);

  assert.match(taskEditor, /ui-management-surface/);
  assert.match(taskEditor, /id="task-edit-title" className="[^"]*ui-text-primary/);
  assert.match(taskEditor, /ui-management-inset/);
  assert.match(taskEditor, /className="ui-field/);
  assert.doesNotMatch(taskEditor, /disabled:opacity-/);
  assert.doesNotMatch(taskEditor, /ui-inverse|bg-slate-9\d\d|border-white/);

  assert.match(quickBooking, /ui-management-surface absolute inset-0/);
  assert.match(quickBooking, /const inputClass = 'ui-field/);
  assert.match(quickBooking, /const labelClass = '[^']*ui-text-secondary/);
  assert.match(quickBooking, />Quick booking<\/h2>/);
  assert.match(quickBooking, /sm:start-auto sm:end-3/);
  assert.doesNotMatch(quickBooking.slice(quickBooking.indexOf('aria-label="New reservation"')), /ui-inverse/);

  assert.match(reservationEditor, /ui-management-surface/);
  assert.match(reservationEditor, /const inputClass = 'ui-field/);
  assert.match(reservationEditor, /sm:border-e-0/);
  assert.doesNotMatch(reservationEditor, /ui-inverse|bg-\[#0a0e14\]|border-white/);

  assert.match(reservationInputs, /ui-management-surface/);
  assert.match(reservationInputs, /ui-field[^"]*text-lg font-bold/);
  assert.match(reservationInputs, /ui-field[^"]*text-center text-2xl font-black/);
  assert.equal((reservationInputs.match(/brain-directional-icon/g) ?? []).length, 2);
  assert.doesNotMatch(reservationInputs, /ui-inverse|bg-white\/\[0\.04\]|border-white/);
  assert.match(incomingCall, /ui-management-surface/);
  assert.match(incomingCall, /sm:start-auto sm:end-4/);
  assert.doesNotMatch(incomingCall, /bg-\[#090e15\]|border-white/);

  assert.match(assistant, /placeholder:text-slate-600/);
  assert.match(assistant, /ui-muted mt-2 flex items-center justify-between/);
});

test('all management dialogs use the light primitive while intentional auth and media contexts stay contained', async () => {
  const [evidence, cameras, agents, login, taskEvidence] = await Promise.all([
    read('app/dashboard/evidence-review/page.tsx'),
    read('app/dashboard/cameras/page.tsx'),
    read('components/camera-manager/BrainAgentManager.tsx'),
    read('components/LoginForm.tsx'),
    read('components/brain/TaskEvidenceAttachment.tsx'),
  ]);

  assert.match(evidence, /confirming[\s\S]*ui-management-surface/);
  assert.match(cameras, /saveNvr[\s\S]*ui-management-surface/);
  assert.match(cameras, /saveCamera[\s\S]*ui-management-surface/);
  assert.doesNotMatch(cameras.slice(cameras.indexOf('{form &&')), /ui-inverse|bg-slate-900/);
  assert.match(agents, /code&&[\s\S]*ui-management-surface/);
  assert.match(agents, /creating&&[\s\S]*ui-management-surface/);
  assert.doesNotMatch(agents.slice(agents.indexOf('{code&&')), /ui-inverse|bg-slate-900/);

  assert.match(login, /ui-inverse/, 'public authentication may retain its contained identity');
  assert.match(taskEvidence, /ui-inverse/, 'camera/evidence capture may retain a contained media surface');
  assert.doesNotMatch(css, /\.brain-drawer[^{]*\{[^}]*--ui-surface-elevated:/);
});

test('Tasks and Evidence Review keep their accepted card and status language', async () => {
  const [tasks, evidence] = await Promise.all([
    read('app/dashboard/tasks/page.tsx'),
    read('app/dashboard/evidence-review/page.tsx'),
  ]);
  assert.match(tasks, /rounded-2xl border border-white\/10 bg-slate-950\/60/);
  assert.match(tasks, /<StatusBadge label=\{t\.priority\[task\.priority\]\}/);
  assert.match(evidence, /overflow-hidden rounded-2xl border border-white\/10 bg-slate-950\/60/);
  assert.match(evidence, /<StatusBadge className="h-fit"/);
});

test('management drawers retain bounded responsive layouts, safe footers, and logical RTL edges', async () => {
  const [taskEditor, quickBooking, reservationEditor, incomingCall] = await Promise.all([
    read('components/tasks/TaskEditPanel.tsx'),
    read('components/reservations/ReservationConsole.tsx'),
    read('components/reservations/ReservationEditPanel.tsx'),
    read('components/reservations/IncomingCallPopup.tsx'),
  ]);
  assert.match(taskEditor, /max-h-\[96dvh\][^"]*overflow-y-auto/);
  assert.match(taskEditor, /pb-\[max\(1\.25rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(quickBooking, /w-full min-w-0 max-w-full/);
  assert.match(quickBooking, /sm:w-\[min\(560px,calc\(100vw-1\.5rem\)\)\]/);
  assert.match(quickBooking, /mobile-scroll-region min-w-0 flex-1 overflow-y-auto/);
  assert.match(quickBooking, /pb-\[max\(0\.875rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(reservationEditor, /max-h-\[92dvh\][^"]*sm:w-\[min\(560px,calc\(100vw-2rem\)\)\]/);
  assert.match(reservationEditor, /mobile-scroll-region flex-1 overflow-y-auto/);
  assert.match(incomingCall, /inset-x-3[^"]*sm:start-auto sm:end-4/);
  assert.match(css, /html,\s*body\s*\{[\s\S]*max-width: 100%[\s\S]*overflow-x: clip/);
});

test('balanced visual hierarchy remains and rejected strict global styling cannot return', () => {
  assert.notEqual(cssToken('ui-action-primary').toLowerCase(), '#000000');
  assert.notEqual(cssToken('ui-surface-page').toLowerCase(), '#ffffff');
  assert.ok(new Set([
    'success',
    'warning',
    'error',
    'info',
    'pending',
    'processing',
    'offline',
    'review',
    'failed',
  ].map((status) => cssToken(`ui-status-${status}-bg`).toLowerCase())).size > 4);

  assert.doesNotMatch(
    css,
    /\.brain-v3 \.dashboard-main [^{]+\{[^}]*border(?:-color)?:\s*#(?:000000|000)\b/,
  );
  assert.doesNotMatch(
    css,
    /\.brain-v3 \.dashboard-main :is\(button, a\)[^{]+\{[^}]*background(?:-color)?:\s*#(?:000000|000)\b/,
  );
});

test('pale actions keep dark text and offline states remain readable without manual dark badges', async () => {
  const [quickBooking, cameras, agents] = await Promise.all([
    read('components/reservations/ReservationConsole.tsx'),
    read('app/dashboard/cameras/page.tsx'),
    read('components/camera-manager/BrainAgentManager.tsx'),
  ]);
  assert.doesNotMatch(quickBooking, /bg-cyan-(?:200|300|400)[^'"]*text-white/);
  assert.match(quickBooking, /bg-cyan-300 text-slate-950/);
  assert.doesNotMatch(quickBooking, /text-[a-z]+-\d+\/\d+/);
  assert.doesNotMatch(quickBooking, /disabled:opacity-/);
  assert.match(cameras, /deviceStatusTone\(item\.status\)/);
  assert.match(agents, /gatewayStatusTone\(item\.status\)/);

  const offlineForeground = cssToken('ui-status-offline-fg');
  const offlineBackground = cssToken('ui-status-offline-bg');
  assert.ok(contrastRatio(offlineForeground, offlineBackground) >= 4.5);
  if (relativeLuminance(offlineBackground) < 0.18) {
    assert.ok(relativeLuminance(offlineForeground) > 0.5, 'dark offline badges require light text');
  }

  const paleCyanPanel = compositeHex('#67e8f9', '#ffffff', 0.05);
  const paleAmberPanel = compositeHex('#fde68a', '#ffffff', 0.045);
  assert.ok(contrastRatio('#155e75', paleCyanPanel) >= 4.5);
  assert.ok(contrastRatio('#78350f', paleAmberPanel) >= 4.5);
});

test('disabled controls retain explicit readable colors instead of whole-control opacity', () => {
  assert.match(css, /\.ui-button-primary:disabled,[\s\S]*opacity: 1 !important/);
  assert.match(css, /\.brain-v3 :where\(button, input, select, textarea\):disabled,[\s\S]*opacity: 1 !important/);
});
