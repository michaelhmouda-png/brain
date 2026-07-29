import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('authenticated pages share one calm Brain workspace and design-token system', async () => {
  const [layout, globals, shell] = await Promise.all([
    read('app/dashboard/layout.tsx'),
    read('app/globals.css'),
    read('components/brain-experience/BrainExperienceShell.tsx'),
  ]);
  assert.match(layout, /<BrainExperienceShell profile=\{profile\}/);
  for (const token of ['--brain-canvas', '--brain-surface', '--brain-line', '--brain-success', '--brain-attention', '--brain-danger', '--brain-blue']) {
    assert.match(globals, new RegExp(token));
  }
  assert.match(globals, /\.brain-content/);
  assert.match(globals, /\.brain-surface/);
  assert.match(shell, /className="brain-workspace"/);
});

test('navigation exposes five calm primary destinations and keeps the rest contextual', async () => {
  const sidebar = await read('components/DashboardSidebar.tsx');
  for (const key of ['home', 'operations', 'reservations', 'guests']) {
    assert.match(sidebar, new RegExp(`translationKey: '${key}'`));
  }
  assert.match(sidebar, /group: 'operations'/);
  assert.match(sidebar, /group: 'organization'/);
  assert.match(sidebar, /aria-label=\{t\.navigation\.quickLabel\}/);
  assert.match(sidebar, /dispatch\('brain:open'\)/);
});

test('Brain Orb is the single persistent assistant and receives safe page context', async () => {
  const [shell, assistant, route, reservations, cameras] = await Promise.all([
    read('components/brain-experience/BrainExperienceShell.tsx'),
    read('components/brain-experience/BrainAssistant.tsx'),
    read('app/dashboard/ai-assistant/page.tsx'),
    read('components/reservations/ReservationConsole.tsx'),
    read('app/dashboard/cameras/page.tsx'),
  ]);
  assert.match(shell, /className="brain-orb"/);
  assert.match(shell, /t\.shell\.currentPageContext/);
  assert.match(shell, /route: pathname/);
  assert.match(shell, /module: currentModule/);
  assert.match(shell, /entity: activeContextOverride\?\.entity \?\? deriveEntity\(pathname\)/);
  assert.match(assistant, /contextualizeMessage/);
  assert.match(assistant, /Current module:/);
  assert.match(shell, /brain:context/);
  assert.match(reservations, /new CustomEvent\('brain:context'/);
  assert.match(cameras, /new CustomEvent\('brain:context'/);
  assert.match(route, /router\.replace\('\/dashboard\?brain=open'\)/);
  assert.doesNotMatch(route, /fetch\('\/api\/brain\/chat'/);
});

test('global search and contextual Brain controls are keyboard and screen-reader reachable', async () => {
  const [shell, globals] = await Promise.all([
    read('components/brain-experience/BrainExperienceShell.tsx'),
    read('app/globals.css'),
  ]);
  assert.match(shell, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(shell, /event\.key\.toLowerCase\(\) === 'k'/);
  assert.match(shell, /role="dialog" aria-modal="true"/);
  assert.match(shell, /aria-labelledby="brain-drawer-title"/);
  assert.match(shell, /aria-expanded=\{brainOpen\}/);
  assert.match(globals, /focus-visible/);
  assert.match(globals, /min-height: 2\.75rem/);
});

test('global search federates only existing authenticated company-scoped APIs', async () => {
  const shell = await read('components/brain-experience/BrainExperienceShell.tsx');
  for (const route of ['/api/tasks', '/api/reservations', '/api/incidents', '/api/maintenance']) {
    assert.match(shell, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(shell, /credentials: 'same-origin'/);
  assert.match(shell, /cache: 'no-store'/);
  assert.match(shell, /profile\.role !== 'employee'/);
  assert.doesNotMatch(shell, /service_role|SUPABASE_SERVICE_ROLE_KEY|companyId:/);
});

test('module-specific assistant entry points open the shared Brain drawer', async () => {
  const sources = await Promise.all([
    read('components/PremiumCommandCenter.tsx'),
    read('components/EmployeeHome.tsx'),
    read('components/DailyBriefingWidget.tsx'),
    read('app/dashboard/operations/page.tsx'),
    read('components/reservations/ReservationConsole.tsx'),
  ]);
  const combined = sources.join('\n');
  assert.match(combined, /new Event\('brain:open'\)/);
  assert.doesNotMatch(combined, /href="\/dashboard\/ai-assistant"/);
  assert.doesNotMatch(combined, /Reservation operator navigation/);
});

test('home is a briefing that communicates priorities and next actions at a glance', async () => {
  const home = await read('components/PremiumCommandCenter.tsx');
  assert.match(home, /What matters now/);
  assert.match(home, /At a glance/);
  assert.match(home, /Brain recommends/);
  assert.match(home, /Recent activity/);
  assert.match(home, /briefing\.priorities\.length/);
  assert.match(home, /briefing\.brain_score\.categories/);
});

test('mobile shell has no horizontal overflow primitives and respects safe areas', async () => {
  const globals = await read('app/globals.css');
  assert.match(globals, /overflow-x: clip/);
  assert.match(globals, /env\(safe-area-inset-bottom\)/);
  assert.match(globals, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(globals, /\.brain-mobile-nav-item/);
  assert.match(globals, /min-width: 0/);
});
