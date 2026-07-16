create extension if not exists pgcrypto;

create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid references locations(id) on delete set null,
  name text not null,
  description text,
  manager_employee_id uuid references employees(id) on delete set null,
  status text not null default 'active',
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

create trigger departments_update_timestamp
  before update on departments
  for each row
  execute function update_timestamp();
