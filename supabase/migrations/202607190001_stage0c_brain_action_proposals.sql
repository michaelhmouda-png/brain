-- Stage 0C: durable, server-only Brain action proposals.
-- Prerequisites: auth.users, public.profiles, and public.companies exist.
-- Availability risk: additive table/functions only; no existing rows are rewritten.
-- Recovery: stop application traffic using proposals, then drop these functions and table.

create table public.brain_action_proposals (
  id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  tenant_id uuid not null references public.companies(id) on delete restrict,
  canonical_action text not null,
  canonical_payload jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version integer not null check (schema_version > 0),
  risk text not null check (risk in ('medium', 'high')),
  required_role text,
  safe_preview jsonb not null,
  status text not null check (status in ('pending','executing','executed','rejected','expired','failed')),
  correlation_id uuid not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  execution_started_at timestamptz,
  executed_at timestamptz,
  rejected_at timestamptz,
  failed_at timestamptz,
  safe_result text,
  safe_error_code text,
  check (expires_at > created_at),
  unique (id, payload_hash)
);

create index brain_action_proposals_actor_tenant_status_idx on public.brain_action_proposals(actor_id, tenant_id, status);
create index brain_action_proposals_pending_expiry_idx on public.brain_action_proposals(expires_at) where status = 'pending';
create index brain_action_proposals_executing_started_idx on public.brain_action_proposals(execution_started_at) where status = 'executing';
-- Operational signal for Stage 0C: trusted server monitoring should alert when
-- this index contains executions older than the normal command latency. Such
-- rows must be reconciled manually; they must never be automatically replayed.

alter table public.brain_action_proposals enable row level security;
alter table public.brain_action_proposals force row level security;
revoke all on public.brain_action_proposals from public, anon, authenticated;
grant all on public.brain_action_proposals to service_role;

create or replace function public.claim_brain_action_proposal(p_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.brain_action_proposals;
begin
  update public.brain_action_proposals
     set status = case when expires_at <= p_now then 'expired' else 'executing' end,
         execution_started_at = case when expires_at > p_now then p_now else execution_started_at end
   where id=p_id and actor_id=p_actor_id and profile_id=p_profile_id and tenant_id=p_tenant_id and status='pending'
   returning * into p;
  if found then
    if p.status='expired' then return jsonb_build_object('outcome','expired'); end if;
    return jsonb_build_object('outcome','claimed','proposal',to_jsonb(p));
  end if;
  select * into p from public.brain_action_proposals where id=p_id and actor_id=p_actor_id and profile_id=p_profile_id and tenant_id=p_tenant_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if p.status='executed' then return jsonb_build_object('outcome','executed','safe_result',p.safe_result); end if;
  if p.status='pending' and p.expires_at <= p_now then
    update public.brain_action_proposals set status='expired' where id=p.id and status='pending';
    return jsonb_build_object('outcome','expired');
  end if;
  return jsonb_build_object('outcome','invalid_status');
end $$;

create or replace function public.reject_brain_action_proposal(p_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.brain_action_proposals set status='expired'
   where id=p_id and actor_id=p_actor_id and profile_id=p_profile_id and tenant_id=p_tenant_id and status='pending' and expires_at <= now();
  update public.brain_action_proposals set status='rejected', rejected_at=now()
   where id=p_id and actor_id=p_actor_id and profile_id=p_profile_id and tenant_id=p_tenant_id and status='pending' and expires_at > now();
  if found then return 'rejected'; end if;
  if exists(select 1 from public.brain_action_proposals where id=p_id and actor_id=p_actor_id and profile_id=p_profile_id and tenant_id=p_tenant_id) then return 'invalid_status'; end if;
  return 'not_found';
end $$;

create or replace function public.complete_brain_action_proposal(p_id uuid, p_payload_hash text, p_safe_result text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.brain_action_proposals set status='executed', executed_at=now(), safe_result=left(p_safe_result,500)
   where id=p_id and payload_hash=p_payload_hash and status='executing';
  return found;
end $$;

create or replace function public.fail_brain_action_proposal(p_id uuid, p_payload_hash text, p_error_code text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.brain_action_proposals set status='failed', failed_at=now(), safe_error_code=left(p_error_code,100)
   where id=p_id and payload_hash=p_payload_hash and status='executing';
  return found;
end $$;

revoke all on function public.claim_brain_action_proposal(uuid,uuid,uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.reject_brain_action_proposal(uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.complete_brain_action_proposal(uuid,text,text) from public, anon, authenticated;
revoke all on function public.fail_brain_action_proposal(uuid,text,text) from public, anon, authenticated;
grant execute on function public.claim_brain_action_proposal(uuid,uuid,uuid,uuid,timestamptz) to service_role;
grant execute on function public.reject_brain_action_proposal(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.complete_brain_action_proposal(uuid,text,text) to service_role;
grant execute on function public.fail_brain_action_proposal(uuid,text,text) to service_role;

comment on table public.brain_action_proposals is 'Server-only Brain chat approvals. Retain executed/terminal rows for an operationally defined audit period; add a scheduled purge after retention policy approval.';
