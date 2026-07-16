create extension if not exists pgcrypto;

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  type text not null,
  country text not null,
  city text not null,
  address text,
  timezone text not null,
  phone text,
  email text,
  capacity integer not null default 0,
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

create trigger locations_update_timestamp
  before update on locations
  for each row
  execute function update_timestamp();
