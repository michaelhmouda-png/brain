export type Profile = {
  id: string;
  company_id: string | null;
  employee_id: string | null;
  full_name: string | null;
  role: 'super_admin' | 'owner' | 'manager' | 'employee';
  status: 'active' | 'inactive' | 'suspended';
  created_at: string;
  updated_at: string;
};

export type AuthUser = {
  id: string;
  email: string;
  aud: string;
  created_at: string;
};

export type AuthSession = {
  user: AuthUser;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
};
