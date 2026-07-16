create extension if not exists pgcrypto;

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid references locations(id) on delete set null,
  department_id uuid references departments(id) on delete set null,
  first_name text not null,
  last_name text not null,
  role text not null,
  phone text,
  email text,
  employment_type text not null default 'full-time',
  salary numeric default 0,
  hire_date date,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function update_timestamp()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger employees_update_timestamp
  before update on employees
  for each row
  execute function update_timestamp();
