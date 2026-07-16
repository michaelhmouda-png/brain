export type DepartmentCompany = {
  id: string;
  name: string;
};

export type DepartmentLocation = {
  id: string;
  company_id: string;
  name: string;
};

export type DepartmentManager = {
  id: string;
  first_name: string;
  last_name: string;
};

export type Department = {
  id: string;
  company_id: string;
  location_id: string | null;
  name: string;
  description: string | null;
  manager_employee_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  company?: DepartmentCompany | null;
  location?: DepartmentLocation | null;
  manager?: DepartmentManager | null;
  employee_count?: number;
};
