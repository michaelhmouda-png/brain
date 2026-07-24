-- Stage K5: immutable server-recorded domain facts.
CREATE TABLE IF NOT EXISTS public.brain_domain_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  command_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brain_domain_events_one_type_per_command UNIQUE (command_id, event_type)
);

CREATE INDEX IF NOT EXISTS brain_domain_events_company_occurred_idx
  ON public.brain_domain_events(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS brain_domain_events_aggregate_idx
  ON public.brain_domain_events(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS brain_domain_events_correlation_idx
  ON public.brain_domain_events(correlation_id);

ALTER TABLE public.brain_domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_domain_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.brain_domain_events FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.brain_domain_events TO service_role;

COMMENT ON TABLE public.brain_domain_events IS
  'Server-only immutable domain events. No client policies; service-role recording only.';
