import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPLOYEE_LIST_PROJECTION,
  employeeRelationshipName,
  projectEmployeeListRow,
} from '../lib/employees/list-projection.ts';

const companyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const departmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const locationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const base = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  company_id: companyId,
  department_id: departmentId,
  location_id: locationId,
  first_name: 'Amjad',
  last_name: 'Abou Chaaban',
  department: 'legacy text must not be used',
  company: { id: companyId, name: 'Bistrhaut' },
};

test('employee list selects explicitly aliased UUID joins with tenant identity', () => {
  assert.match(EMPLOYEE_LIST_PROJECTION, /location:locations!employees_location_id_fkey\(id, company_id, name\)/);
  assert.match(EMPLOYEE_LIST_PROJECTION, /department:departments!employees_department_id_fkey\(id, company_id, name\)/);
  assert.doesNotMatch(EMPLOYEE_LIST_PROJECTION, /(?:^|, )department(?:,|$)/);
});

test('valid same-company joins project and render department and location names', () => {
  const employee = projectEmployeeListRow({
    ...base,
    department: { id: departmentId, company_id: companyId, name: 'kitchen' },
    location: { id: locationId, company_id: companyId, name: "Bistr'haut  Faraya" },
  }, companyId);

  assert.equal(employeeRelationshipName(employee.department, 'Unassigned'), 'kitchen');
  assert.equal(employeeRelationshipName(employee.location, 'Unassigned'), "Bistr'haut  Faraya");
});

test('null UUID relationships project and render as Unassigned', () => {
  const employee = projectEmployeeListRow({
    ...base,
    department_id: null,
    location_id: null,
    department: null,
    location: null,
  }, companyId);

  assert.equal(employeeRelationshipName(employee.department, 'Unassigned'), 'Unassigned');
  assert.equal(employeeRelationshipName(employee.location, 'Unassigned'), 'Unassigned');
});

test('missing, mismatched, and cross-company joins fail closed as Unassigned', () => {
  const employee = projectEmployeeListRow({
    ...base,
    department: { id: departmentId, company_id: 'other-company', name: 'stolen' },
    location: { id: 'other-location', company_id: companyId, name: 'wrong location' },
  }, companyId);

  assert.equal(employeeRelationshipName(employee.department, 'Unassigned'), 'Unassigned');
  assert.equal(employeeRelationshipName(employee.location, 'Unassigned'), 'Unassigned');
});
