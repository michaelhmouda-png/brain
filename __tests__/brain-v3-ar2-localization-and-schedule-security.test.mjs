import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { messages, validateTranslationCatalog } from '../lib/i18n.ts';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('persisted profile language is the only authenticated document locale authority', async () => {
  const [root, dashboard, loader, provider] = await Promise.all([
    read('app/layout.tsx'),
    read('app/dashboard/layout.tsx'),
    read('lib/persisted-locale.server.ts'),
    read('components/LocaleProvider.tsx'),
  ]);
  assert.match(loader, /\.from\('profiles'\)[\s\S]*\.select\('preferred_language'\)[\s\S]*\.eq\('id', user\.id\)/);
  assert.doesNotMatch(loader, /searchParams|localStorage|sessionStorage|navigator\.language|cookies?\(/);
  assert.match(root, /lang=\{language\}/);
  assert.match(root, /dir=\{language === "ar" \? "rtl" : "ltr"\}/);
  assert.match(dashboard, /normalizeLanguage\(profile\.preferred_language\)/);
  assert.match(dashboard, /<LocaleProvider language=\{language\} role=\{profile\.role\} companyTimezone=/);
  assert.match(provider, /document\.documentElement\.lang = language/);
  assert.match(provider, /document\.documentElement\.dir = language === 'ar' \? 'rtl' : 'ltr'/);
});

test('English and Arabic catalogs are structurally complete and known AR2 labels are translated', () => {
  assert.deepEqual(validateTranslationCatalog(), []);
  const incomplete = structuredClone(messages.ar);
  delete incomplete.navigation.searchBrain;
  assert.ok(validateTranslationCatalog(messages.en, incomplete).includes('navigation.searchBrain'));
  assert.equal(messages.en.navigation.destinations.home.label, 'Home');
  assert.equal(messages.ar.navigation.destinations.home.label, 'الرئيسية');
  assert.equal(messages.ar.navigation.workspace, 'مساحة العمل');
  assert.equal(messages.ar.navigation.organization, 'المؤسسة');
  assert.equal(messages.ar.navigation.searchBrain, 'البحث في برين');
  assert.equal(messages.ar.home.askBrain, 'اسأل برين');
  assert.equal(messages.ar.role.employee, 'موظف');
  assert.equal(messages.ar.schedule.personalTitle, 'جدولي');
  assert.equal(messages.ar.notificationSettings.title, 'إعدادات الإشعارات');
  for (const key of ['taskAssignments', 'taskUpdates', 'dueReminders', 'announcements', 'maintenance', 'incidents', 'evidenceReview']) {
    assert.notEqual(messages.ar.notificationSettings.categories[key], messages.en.notificationSettings.categories[key]);
  }
});

test('shared V3 shell renders catalog values instead of hard-coded English labels', async () => {
  const [sidebar, shell, assistant, compatibilityRoute, bell] = await Promise.all([
    read('components/DashboardSidebar.tsx'),
    read('components/brain-experience/BrainExperienceShell.tsx'),
    read('components/brain-experience/BrainAssistant.tsx'),
    read('app/dashboard/ai-assistant/page.tsx'),
    read('components/NotificationBell.tsx'),
  ]);
  const sidebarRender = sidebar.slice(sidebar.indexOf('export function DashboardSidebar'));
  const shellRender = shell.slice(shell.indexOf('export function BrainExperienceShell'));
  const assistantRender = assistant.slice(assistant.indexOf('export function BrainAssistant'));
  for (const source of [sidebarRender, shellRender, assistantRender]) {
    for (const label of ['Search Brain', '>Workspace<', '>Organization<', '>Ask Brain<', '>Employee<', 'How can I help?']) {
      assert.doesNotMatch(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
  assert.match(sidebar, /t\.navigation\.destinations\[item\.translationKey\]/);
  assert.doesNotMatch(sidebar, /translationKey: 'home'[\s\S]{0,100}label: 'Home'/);
  assert.match(sidebar, /t\.role\[profile\.role\]/);
  assert.match(shell, /t\.navigation\.searchBrain/);
  assert.match(shell, /t\.shell\.openBrain/);
  assert.match(assistant, /t\.assistant\.suggestions\[key\]/);
  assert.match(compatibilityRoute, /t\.assistant\.compatibilityOpening/);
  assert.doesNotMatch(compatibilityRoute, />Opening Brain/);
  assert.match(bell, /t\.notificationSettings\.unreadCount/);
});

test('RTL desktop, mobile drawer, Brain drawer and semantic direction are explicit', async () => {
  const css = await read('app/globals.css');
  assert.match(css, /\[dir='rtl'\] \.brain-workspace[\s\S]*padding-right: var\(--sidebar-width\)/);
  assert.match(css, /\.brain-sidebar[\s\S]*inset-inline-start: 0/);
  assert.match(css, /\.brain-mobile-menu[\s\S]*inset-inline-start: 0/);
  assert.match(css, /\[dir='rtl'\] \.brain-mobile-menu[\s\S]*brain-slide-menu-rtl/);
  assert.match(css, /\[dir='rtl'\] \.brain-drawer[\s\S]*brain-slide-in-rtl/);
  assert.match(css, /\[dir='rtl'\] \.brain-directional-icon[\s\S]*scaleX\(-1\)/);
});

test('employee schedule is personal, localized and formatted in the persisted company timezone', async () => {
  const page = await read('app/dashboard/shifts/page.tsx');
  assert.match(page, /const \{ language, role, companyTimezone, messages: t \} = useLocale\(\)/);
  assert.match(page, /const personal = role === 'employee'/);
  assert.match(page, /personal \? t\.schedule\.personalTitle : t\.schedule\.managementTitle/);
  assert.match(page, /t\.schedule\.days\[day\]/);
  assert.match(page, /timeZone: payload\?\.timezone \|\| companyTimezone/);
  assert.match(page, /dateAtTimezone\(new Date\(\), companyTimezone\)/);
  assert.doesNotMatch(page, /timezone: stringField\(value, 'timezone'\) \|\| 'UTC'/);
  assert.doesNotMatch(page, /Shift Management|Previous Week|Next Week|No schedules for this week|9 AM - 5 PM/);
});

test('schedule API derives employee scope from ActorContext and never returns company directory data to employees', async () => {
  const route = await read('app/api/shifts/route.ts');
  assert.match(route, /const employeeId = authorization\.role === 'employee' \? authorization\.employeeId!/);
  assert.match(route, /if \(employeeId\) scheduleQuery = scheduleQuery\.eq\('employee_id', employeeId\)/);
  assert.match(route, /authorization\.role === 'employee'\s*\? \{ data: \[\], error: null \}\s*: await supabase\.from\('employees'\)/);
  assert.match(route, /if \(employeeId\) concreteQuery = concreteQuery\.eq\('employee_id', employeeId\)/);
  assert.match(route, /employee: authorization\.role === 'employee' \? undefined/);
  assert.match(route, /stats = authorization\.role === 'employee' \? null|if \(authorization\.role !== 'employee'\)/);
  assert.match(route, /\.eq\('company_id', authorization\.companyId\)/);
  assert.match(route, /timezone: company\.timezone/);
  assert.match(route, /SCHEDULE_TIMEZONE_QUERY_FAILED/);
  assert.doesNotMatch(route, /companyId\s*=\s*url\.searchParams|employeeId\s*=\s*url\.searchParams[\s\S]*authorization\.role === 'employee'/);
});

test('schedule write and item routes enforce employee denial and own-item reads server-side', async () => {
  const [collection, item, proxy] = await Promise.all([
    read('app/api/shifts/route.ts'),
    read('app/api/shifts/[id]/route.ts'),
    read('proxy.ts'),
  ]);
  assert.equal((collection.match(/authorization\.role === 'employee'\) return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/g) ?? []).length, 2);
  assert.match(collection, /resolveActorContext\(supabase\)/);
  assert.match(collection, /if \(!canManageShifts\(actor\.role\)\)/);
  assert.match(item, /authorization\.role === 'employee' && shift\.employee_id !== authorization\.employeeId/);
  assert.equal((item.match(/authorization\.role === 'employee'\) return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/g) ?? []).length, 2);
  assert.match(proxy, /pathname\.startsWith\('\/api\/shifts'\) && request\.method !== 'GET'/);
  assert.doesNotMatch(item, /\.eq\('user_id', user\.id\)/);
});

test('notification settings are fully localized without browser-timezone authority', async () => {
  const [settings, notifications] = await Promise.all([
    read('components/NotificationSettings.tsx'),
    read('app/dashboard/notifications/page.tsx'),
  ]);
  for (const key of ['title', 'description', 'permissionState', 'unsupported', 'denied', 'iphone', 'enable', 'disable', 'inApp', 'quietHours', 'start', 'end', 'save']) {
    assert.match(settings, new RegExp(`t\\.notificationSettings\\.${key}`));
  }
  assert.match(settings, /t\.notificationSettings\.states\[state\]/);
  assert.match(settings, /t\.notificationSettings\.categories\[category\]/);
  assert.match(settings, /defaults\(companyTimezone\)/);
  assert.doesNotMatch(settings, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  assert.match(notifications, /timeZone:companyTimezone/);
  assert.match(notifications, /t\.notificationCategory\[/);
});

test('task UI uses the durable localized projection and never renders canonical raw states', async () => {
  const [tasks, evidence] = await Promise.all([
    read('app/dashboard/tasks/page.tsx'),
    read('components/brain/TaskEvidenceAttachment.tsx'),
  ]);
  assert.match(tasks, /task\.displayTitle/);
  assert.match(tasks, /task\.displayDescription/);
  assert.match(tasks, /translationState/);
  assert.match(tasks, /t\.status\[task\.status\]/);
  assert.match(evidence, /task\.displayTitle \?\? t\.tasks\.translationPending/);
  assert.match(evidence, /t\.status\[task\.status as 'pending' \| 'in_progress'\]/);
  const taskMarkup = tasks.slice(tasks.indexOf('return ('));
  assert.doesNotMatch(taskMarkup, />\s*(?:in_progress|human_approved|needs_human_review|verification_failed)\s*</);
});

test('employee allowlists retain the documented authorization matrix', async () => {
  const access = await read('lib/employee-access.ts');
  for (const route of ['/dashboard', '/dashboard/tasks', '/dashboard/notifications', '/dashboard/shifts', '/dashboard/ai-assistant', '/dashboard/settings']) {
    assert.match(access, new RegExp(route.replaceAll('/', '\\/')));
  }
  for (const forbidden of ['/dashboard/analytics', '/dashboard/evidence-review', '/dashboard/employees', '/dashboard/operations']) {
    assert.doesNotMatch(access, new RegExp(`'${forbidden.replaceAll('/', '\\/')}'`));
  }
  assert.match(access, /EMPLOYEE_BRAIN_TOOLS = \['get_current_user_profile', 'get_tasks', 'complete_task'\]/);
});

test('AR2 is application-only and introduces no migration', async () => {
  const statusFixture = await read('lib/i18n.ts');
  assert.match(statusFixture, /I18N_CATALOG_INCOMPLETE/);
  assert.match(statusFixture, /validateTranslationCatalog/);
});
