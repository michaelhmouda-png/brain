import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  ACTIVE_EMPLOYEE_STATUS,
  EMPLOYEE_PROFILE_REQUIRED_FIELDS,
  isEmployeeProfileComplete,
  isIncompleteActiveEmployeeProfile,
  loadActiveEmployeeProfileSnapshot,
} from '../lib/employee-profile-completeness.ts';

const base = {
  id: 'employee-1',
  company_id: 'company-a',
  first_name: 'Amina',
  last_name: 'Saad',
  role: 'manager',
  status: ACTIVE_EMPLOYEE_STATUS,
  phone: '+961 1 555 010',
  email: 'amina@example.com',
  department_id: 'department-1',
  location_id: 'location-1',
};

test('canonical completeness contains only schema and business-rule required fields', () => {
  assert.deepEqual(EMPLOYEE_PROFILE_REQUIRED_FIELDS, [
    'company_id',
    'first_name',
    'last_name',
    'role',
  ]);
});

test('phone present and email missing remains complete', () => {
  assert.equal(isEmployeeProfileComplete({ ...base, email: null }), true);
});

test('email present and phone missing remains complete', () => {
  assert.equal(isEmployeeProfileComplete({ ...base, phone: null }), true);
});

test('both phone and email present remains complete', () => {
  assert.equal(isEmployeeProfileComplete(base), true);
});

test('unassigned department and location remain complete', () => {
  assert.equal(isEmployeeProfileComplete({
    ...base,
    department_id: null,
    location_id: null,
  }), true);
});

test('inactive employees are never counted as incomplete', () => {
  assert.equal(isIncompleteActiveEmployeeProfile({
    ...base,
    role: '',
    status: 'inactive',
  }), false);
});

test('active employees missing a required field are incomplete', () => {
  assert.equal(isIncompleteActiveEmployeeProfile({ ...base, role: '  ' }), true);
});

test('snapshot query uses canonical lowercase active status and isolates the authenticated company', async () => {
  const calls = [];
  const rows = [{ ...base }];
  const query = {
    select(value) {
      calls.push(['select', value]);
      return this;
    },
    eq(field, value) {
      calls.push(['eq', field, value]);
      return this;
    },
    then(resolve) {
      resolve({ data: rows, error: null });
    },
  };
  const supabase = {
    from(table) {
      calls.push(['from', table]);
      return query;
    },
  };

  assert.deepEqual(
    await loadActiveEmployeeProfileSnapshot(supabase, 'company-a'),
    rows,
  );
  assert.ok(calls.some((call) =>
    call[0] === 'eq' && call[1] === 'company_id' && call[2] === 'company-a'));
  assert.ok(calls.some((call) =>
    call[0] === 'eq' && call[1] === 'status' && call[2] === 'active'));
  assert.ok(!calls.some((call) => call.includes('company-b')));
});

test('dashboard count and explanation derive from one canonical employee snapshot', () => {
  const dailyBriefing = fs.readFileSync(
    new URL('../lib/dailyBriefingService.ts', import.meta.url),
    'utf8',
  );
  assert.match(dailyBriefing, /loadActiveEmployeeProfileSnapshot/);
  assert.match(dailyBriefing, /activeEmployees = employeeSnapshot\.length/);
  assert.match(dailyBriefing, /employeesWithMissingData = employeeSnapshot\.filter/);
  assert.doesNotMatch(dailyBriefing, /missing contact information/);
  assert.doesNotMatch(dailyBriefing, /!emp\.email|!emp\.phone/);
});

test('all employee-profile metric consumers use the canonical rule', () => {
  for (const relativePath of [
    '../lib/dailyBriefingService.ts',
    '../lib/brainScoreService.ts',
    '../app/api/brain/chat/route.ts',
    '../app/dashboard/employees/page.tsx',
  ]) {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /employee-profile-completeness/);
  }
});
