export type LocationCompany = {
  id: string;
  name: string;
};

export type Location = {
  id: string;
  company_id: string;
  name: string;
  type: string;
  country: string;
  city: string;
  address: string | null;
  timezone: string;
  phone: string | null;
  email: string | null;
  capacity: number;
  status: string;
  created_at: string;
  updated_at: string;
  company?: LocationCompany | null;
};
