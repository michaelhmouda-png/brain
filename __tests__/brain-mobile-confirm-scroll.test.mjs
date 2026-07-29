import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalizeProposalArguments } from '../lib/brain/action-proposals.ts';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const cssRule = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
};

const task = (index) => ({
  item_index: index,
  title: `A deliberately long task title ${index} that must remain readable without truncation`,
  description: `Complete description ${index} with confirmation-critical information`,
  assigned_employee_id: '11111111-1111-4111-8111-111111111111',
  assigned_employee_name: 'Employee',
  location_id: '22222222-2222-4222-8222-222222222222',
  location_name: 'Location',
  priority: 'medium',
  status: 'pending',
  due_local: `2026-08-${String(index + 1).padStart(2, '0')}T12:00`,
  due_at: `2026-08-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
  due_date: `2026-08-${String(index + 1).padStart(2, '0')}`,
});

test('Brain drawer is bounded by the dynamic viewport and iPhone safe areas', async () => {
  const css = await read('app/globals.css');
  const overlay = cssRule(css, '.brain-overlay');
  const drawer = cssRule(css, '.brain-drawer');
  const header = cssRule(css, '.brain-drawer-header');

  assert.match(overlay, /height:\s*100vh/);
  assert.match(overlay, /height:\s*100dvh/);
  assert.match(overlay, /max-height:\s*100dvh/);
  assert.match(overlay, /overflow:\s*hidden/);
  assert.match(drawer, /height:\s*100%/);
  assert.match(drawer, /max-height:\s*100%/);
  assert.match(drawer, /min-height:\s*0/);
  assert.match(drawer, /width:\s*min\(100%,\s*31rem\)/);
  assert.match(header, /safe-area-inset-top/);
  assert.match(header, /flex:\s*0 0 auto/);
});

test('confirmation uses one min-height-zero flex chain and one independent scroll owner', async () => {
  const [assistant, css] = await Promise.all([
    read('components/brain-experience/BrainAssistant.tsx'),
    read('app/globals.css'),
  ]);
  const layout = cssRule(css, '.brain-assistant-layout');
  const scroll = cssRule(css, '.brain-assistant-scroll');
  const touchScroll = cssRule(css, '.mobile-scroll-region');

  assert.match(assistant, /className="brain-assistant-layout"/);
  assert.match(assistant, /className="brain-assistant-scroll mobile-scroll-region"/);
  assert.match(layout, /min-height:\s*0/);
  assert.match(layout, /overflow:\s*hidden/);
  assert.match(scroll, /min-height:\s*0/);
  assert.match(scroll, /overflow-x:\s*hidden/);
  assert.match(scroll, /overflow-y:\s*auto/);
  assert.match(touchScroll, /overscroll-behavior:\s*contain/);
  assert.match(touchScroll, /-webkit-overflow-scrolling:\s*touch/);

  const scrollStart = assistant.indexOf('className="brain-assistant-scroll mobile-scroll-region"');
  const proposal = assistant.indexOf('className="brain-proposal-preview"');
  const footer = assistant.indexOf('className="brain-confirmation-footer"');
  assert.ok(scrollStart < proposal && proposal < footer, 'proposal details must scroll above the action footer');
});

test('confirmation footer is sticky, opaque, separated, and safe-area aware', async () => {
  const [assistant, css] = await Promise.all([
    read('components/brain-experience/BrainAssistant.tsx'),
    read('app/globals.css'),
  ]);
  const footer = cssRule(css, '.brain-confirmation-footer');

  assert.match(footer, /position:\s*sticky/);
  assert.match(footer, /inset-block-end:\s*0/);
  assert.match(footer, /flex:\s*0 0 auto/);
  assert.match(footer, /border-top:/);
  assert.match(footer, /background:\s*var\(--brain-navigation\)/);
  assert.match(footer, /safe-area-inset-bottom/);
  assert.match(assistant, /disabled=\{state === 'executing'\}/);
  assert.match(css, /\.brain-button-primary:disabled,[\s\S]*background:\s*var\(--brain-surface-disabled\)[\s\S]*opacity:\s*1/);
});

test('long, two-item, ten-item, and maximum batch proposals remain complete and wrap safely', async () => {
  const [assistant, css, route] = await Promise.all([
    read('components/brain-experience/BrainAssistant.tsx'),
    read('app/globals.css'),
    read('app/api/brain/chat/route.ts'),
  ]);
  const row = cssRule(css, '.brain-proposal-row');
  const rowChildren = cssRule(css, '.brain-proposal-row > *');

  assert.match(route, /maxItems:\s*25/);
  for (const size of [2, 10, 25]) {
    const proposal = canonicalizeProposalArguments('create_task_batch', {
      timezone: 'Asia/Beirut',
      tasks: Array.from({ length: size }, (_, index) => task(index)),
    });
    assert.equal(proposal.payload.tasks.length, size);
  }
  assert.match(assistant, /pendingAction\.rows\.map/);
  assert.doesNotMatch(assistant, /pendingAction\.rows\.slice/);
  assert.match(row, /minmax\(0,\s*1fr\)/);
  assert.match(rowChildren, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(assistant, /line-clamp|truncate/);
});

test('RTL keeps semantic action order and logical positioning without overlap regressions', async () => {
  const [assistant, css] = await Promise.all([
    read('components/brain-experience/BrainAssistant.tsx'),
    read('app/globals.css'),
  ]);
  const cancel = assistant.indexOf('{t.assistant.cancel}');
  const confirm = assistant.indexOf('{t.assistant.confirm}');
  const overlay = cssRule(css, '.brain-overlay');
  const orb = cssRule(css, '.brain-orb');

  assert.ok(cancel > -1 && cancel < confirm, 'Cancel then Confirm must remain the semantic DOM order');
  assert.match(css, /\[dir='rtl'\] \.brain-drawer/);
  assert.match(css, /inset-inline-end:\s*0/);
  assert.match(overlay, /z-index:\s*70/);
  assert.match(orb, /z-index:\s*60/);
  assert.match(css, /\.brain-mobile-nav\s*\{[\s\S]*?z-index:\s*50/);
});

test('keyboard, focus, reduced-motion, and desktop contracts remain present', async () => {
  const [assistant, shell, rootLayout, css] = await Promise.all([
    read('components/brain-experience/BrainAssistant.tsx'),
    read('components/brain-experience/BrainExperienceShell.tsx'),
    read('app/layout.tsx'),
    read('app/globals.css'),
  ]);

  assert.match(assistant, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.brain-drawer[\s\S]*?animation:\s*none/);
  assert.match(rootLayout, /interactiveWidget:\s*"resizes-content"/);
  assert.match(rootLayout, /viewportFit:\s*"cover"/);
  assert.match(css, /:where\(button, a, input, select, textarea\):focus-visible/);
  assert.match(shell, /event\.key === 'Escape'/);
  assert.match(shell, /aria-modal="true"/);
  assert.match(shell, /brainDrawerRef/);
  assert.doesNotMatch(`${shell}\n${assistant}`, /\binert\b|aria-hidden=/);
  assert.match(cssRule(css, '.brain-drawer'), /width:\s*min\(100%,\s*31rem\)/);
});
