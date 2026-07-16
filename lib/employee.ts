export type EmployeeCompany = {
  id: string;
  name: string;
};

export type EmployeeLocation = {
  id: string;
  company_id: string;
  name: string;
};

export type Employee = {
  id: string;
  company_id: string;
  location_id: string | null;
  department_id: string | null;
  first_name: string;
  last_name: string;
  role: string;
  phone: string | null;
  email: string | null;
  employment_type: string;
  salary: number;
  hire_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  company?: EmployeeCompany | null;
  location?: EmployeeLocation | null;
  department?: { id: string; name: string } | null;
};
