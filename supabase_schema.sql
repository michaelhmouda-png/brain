-- Supabase schema for Brain companies module

create extension if not exists pgcrypto;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  industry text not null,
  country text not null,
  currency text not null,
  timezone text not null,
  locations int not null default 1,
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

create trigger companies_update_timestamp
  before update on companies
  for each row
  execute function update_timestamp();
