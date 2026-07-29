import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const rootTokens = (css) => {
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  return new Map(
    [...root.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)]
      .map((match) => [match[1], match[2].toLowerCase()]),
  );
};

const luminance = (hex) => {
  const channels = hex.slice(1).match(/../g).map((value) => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
};

const contrast = (foreground, background) => {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

test('canonical Brain V3 tokens restore the recovered navy and cyan identity', async () => {
  const css = await read('app/globals.css');
  const tokens = rootTokens(css);
  const expected = {
    background: '#020617',
    foreground: '#f8fafc',
    'brain-canvas': '#020617',
    'brain-navigation': '#080b12',
    'brain-surface': '#0f172a',
    'brain-surface-muted': '#1e293b',
    'brain-surface-inset': '#0b1018',
    'brain-assistant-deep': '#0a0e27',
    'brain-assistant-mid': '#1a1f3a',
    'brain-assistant-edge': '#0d1117',
    'brain-ink': '#f8fafc',
    'brain-text-secondary': '#cbd5e1',
    'brain-muted': '#94a3b8',
    'brain-cyan': '#22d3ee',
    'brain-cyan-soft': '#67e8f9',
  };

  for (const [name, value] of Object.entries(expected)) {
    assert.equal(tokens.get(name), value, `--${name} must remain ${value}`);
  }
  assert.doesNotMatch(css, /--brain-canvas:\s*#(?:000000|ffffff|f4f3ef)/i);
  assert.doesNotMatch(css, /--brain-surface:\s*#ffffff/i);
});

test('actual dark token pairs meet WCAG text and control contrast thresholds', async () => {
  const tokens = rootTokens(await read('app/globals.css'));
  const get = (name) => {
    const value = tokens.get(name);
    assert.ok(value, `Missing --${name}`);
    return value;
  };
  const textPairs = [
    ['brain-ink', 'brain-canvas'],
    ['brain-text-secondary', 'brain-canvas'],
    ['brain-muted', 'brain-canvas'],
    ['brain-ink', 'brain-surface'],
    ['brain-text-secondary', 'brain-surface'],
    ['brain-muted', 'brain-surface'],
    ['brain-cyan-soft', 'brain-canvas'],
    ['brain-text-disabled', 'brain-surface-disabled'],
    ['brain-success', 'brain-surface'],
    ['brain-attention', 'brain-surface'],
    ['brain-danger', 'brain-surface'],
  ];

  for (const [foreground, background] of textPairs) {
    assert.ok(
      contrast(get(foreground), get(background)) >= 4.5,
      `${foreground}/${background} must be at least 4.5:1`,
    );
  }
  assert.ok(
    contrast(get('brain-action-primary-text'), get('brain-action-primary')) >= 4.5,
    'primary action text must be at least 4.5:1',
  );
  assert.ok(
    contrast(get('brain-line-strong'), get('brain-surface')) >= 3,
    'strong control borders must be at least 3:1',
  );
});

test('shell, navigation, dashboard, cards, and Brain Score use centralized dark surfaces', async () => {
  const [css, shell, dashboard] = await Promise.all([
    read('app/globals.css'),
    read('components/brain-experience/BrainExperienceShell.tsx'),
    read('components/PremiumCommandCenter.tsx'),
  ]);
  assert.match(css, /\.brain-v3\s*\{[\s\S]*background:\s*var\(--brain-canvas\)/);
  assert.match(css, /\.brain-sidebar\s*\{[\s\S]*background:\s*var\(--brain-navigation\)/);
  assert.match(css, /\.brain-nav-item\.is-active\s*\{[\s\S]*var\(--brain-surface-selected\)/);
  assert.match(css, /\.brain-surface\s*\{[\s\S]*background:\s*var\(--brain-surface\)/);
  assert.match(css, /\.brain-metric-card\s*\{[\s\S]*background:\s*var\(--brain-surface\)/);
  assert.match(css, /\.brain-score\s*\{[\s\S]*border-inline-start:\s*1px solid var\(--brain-line\)/);
  assert.match(css, /\.brain-score circle:first-of-type\s*\{[\s\S]*stroke:\s*var\(--brain-line\)/);
  assert.match(shell, /className="brain-v3 min-h-\[100dvh\] bg-\[var\(--brain-canvas\)\]/);
  assert.match(dashboard, /<BrainSurface className="brain-briefing-hero">/);
  assert.match(dashboard, /bg-\[var\(--brain-action-primary\)\][\s\S]*text-\[var\(--brain-action-primary-text\)\]/);
});

test('legacy management modules resolve hard-coded light and dark utilities through one scoped layer', async () => {
  const css = await read('app/globals.css');
  const compatibility = css.slice(css.indexOf('/* Compatibility layer:'));
  for (const token of [
    'bg-white',
    'bg-slate-50',
    'bg-slate-950',
    'bg-gray-50',
    'bg-gray-900',
    'bg-[#fbfbf8]',
    'text-slate-950',
    'text-gray-950',
    'border-slate-200',
    'border-gray-300',
  ]) {
    assert.match(compatibility, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(compatibility, /background-color:\s*var\(--brain-surface\)/);
  assert.match(compatibility, /color:\s*var\(--brain-ink\)/);
  assert.doesNotMatch(compatibility, /background(?:-color)?:\s*#(?:fff|ffffff|f4f3ef)\b/i);
});

test('tasks, evidence, reservations, cameras, notifications, and management dialogs remain in the themed shell', async () => {
  const sources = await Promise.all([
    read('app/dashboard/tasks/page.tsx'),
    read('components/tasks/TaskEditPanel.tsx'),
    read('app/dashboard/evidence-review/page.tsx'),
    read('components/reservations/ReservationConsole.tsx'),
    read('components/reservations/ReservationEditPanel.tsx'),
    read('components/reservations/ReservationRebookPanel.tsx'),
    read('app/dashboard/cameras/page.tsx'),
    read('components/camera-manager/BrainAgentManager.tsx'),
    read('app/dashboard/notifications/page.tsx'),
  ]);
  const combined = sources.join('\n');
  for (const contract of [
    'bg-white',
    'bg-slate-950',
    'bg-[#fbfbf8]',
    'border-white/10',
    'text-slate-950',
  ]) {
    assert.match(combined, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const css = await read('app/globals.css');
  assert.match(css, /\.brain-v3 \[class~="bg-white"\]/);
  assert.match(css, /\.brain-v3 \[class~="bg-slate-950"\]/);
  assert.match(css, /\.brain-v3 \[class\*="bg-\[#fbfbf8\]"\]/);
});

test('forms, native options, autofill, errors, and disabled controls have explicit dark contracts', async () => {
  const css = await read('app/globals.css');
  assert.match(css, /\.brain-v3 :where\([\s\S]*input:not\(\[type='checkbox'\]\)[\s\S]*background-color:\s*var\(--brain-surface-inset\)/);
  assert.match(css, /select option, select optgroup, datalist option/);
  assert.match(css, /color-scheme:\s*dark/);
  assert.match(css, /:-webkit-autofill[\s\S]*-webkit-text-fill-color:\s*var\(--brain-ink\)/);
  assert.match(css, /:disabled,[\s\S]*\[aria-disabled='true'\][\s\S]*opacity:\s*1 !important/);
  assert.match(css, /--brain-status-error-bg:\s*#4c0519/);
  assert.match(css, /--brain-status-error-border:\s*#f43f5e/);
});

test('semantic statuses remain distinct instead of collapsing to cyan', async () => {
  const css = await read('app/globals.css');
  const statusContracts = [
    ['green', '--brain-status-success-bg'],
    ['amber', '--brain-status-warning-bg'],
    ['red', '--brain-status-error-bg'],
    ['blue', '--brain-status-info-bg'],
    ['violet', '--brain-status-review-bg'],
  ];
  for (const [family, token] of statusContracts) {
    assert.match(css, new RegExp(`bg-${family}-[\\s\\S]*?var\\(${token}\\)`));
  }
  assert.notEqual(rootTokens(css).get('brain-success'), rootTokens(css).get('brain-cyan'));
  assert.notEqual(rootTokens(css).get('brain-danger'), rootTokens(css).get('brain-cyan'));
});

test('Brain Assistant keeps the mobile confirmation geometry and changes colors only', async () => {
  const [css, assistant] = await Promise.all([
    read('app/globals.css'),
    read('components/brain-experience/BrainAssistant.tsx'),
  ]);
  assert.match(css, /\.brain-overlay\s*\{[\s\S]*height:\s*100dvh/);
  assert.match(css, /\.brain-drawer\s*\{[\s\S]*min-height:\s*0/);
  assert.match(css, /\.brain-assistant-scroll\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.brain-confirmation-footer\s*\{[\s\S]*position:\s*sticky[\s\S]*safe-area-inset-bottom/);
  assert.match(css, /--brain-assistant-deep:\s*#0a0e27/);
  assert.match(css, /--brain-assistant-mid:\s*#1a1f3a/);
  assert.match(css, /--brain-assistant-edge:\s*#0d1117/);
  assert.match(assistant, /pendingAction\.rows\.map/);
  assert.doesNotMatch(assistant, /pendingAction\.rows\.slice/);
});

test('RTL, responsive breakpoints, desktop bounds, and media color integrity remain unchanged', async () => {
  const [css, rootLayout] = await Promise.all([
    read('app/globals.css'),
    read('app/layout.tsx'),
  ]);
  assert.match(rootLayout, /dir=\{language === "ar" \? "rtl" : "ltr"\}/);
  assert.match(css, /\[dir='rtl'\] \.brain-workspace/);
  assert.match(css, /@media \(max-width: 1023px\)/);
  assert.match(css, /@media \(max-width: 374px\)/);
  assert.match(css, /width:\s*min\(100%,\s*31rem\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(css, /(?:img|video|canvas|picture)[^{]*\{[^}]*\bfilter\s*:/s);
  assert.doesNotMatch(css, /\binvert\(/);
});

test('root viewport metadata and authentication surfaces advertise the dark theme', async () => {
  const [layout, login, forgot, reset] = await Promise.all([
    read('app/layout.tsx'),
    read('app/login/page.tsx'),
    read('app/forgot-password/page.tsx'),
    read('app/reset-password/page.tsx'),
  ]);
  assert.match(layout, /themeColor:\s*"#020617"/);
  assert.match(layout, /colorScheme:\s*"dark"/);
  assert.match(layout, /bg-\[var\(--brain-canvas\)\] text-\[var\(--brain-ink\)\]/);
  for (const source of [login, forgot, reset]) {
    assert.match(source, /bg-\[#020202\] text-white/);
  }
});
