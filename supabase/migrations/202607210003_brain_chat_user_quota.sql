-- Durable per-auth-user Brain chat quota: 100 admitted OpenAI requests per
-- fixed 60-minute window beginning with the first admitted request.

CREATE TABLE public.brain_chat_user_quotas (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 100),
  window_started_at timestamptz NOT NULL,
  window_resets_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT brain_chat_quota_window_exact CHECK (
    window_resets_at = window_started_at + interval '60 minutes'
  )
);

CREATE INDEX brain_chat_user_quotas_reset_idx
  ON public.brain_chat_user_quotas(window_resets_at);

ALTER TABLE public.brain_chat_user_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_chat_user_quotas FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brain_chat_user_quotas FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admit_brain_chat_request()
RETURNS TABLE (
  admitted boolean,
  quota_limit integer,
  remaining integer,
  reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_row public.brain_chat_user_quotas%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  LOOP
    SELECT q.*
      INTO v_row
      FROM public.brain_chat_user_quotas AS q
     WHERE q.user_id = v_user_id
     FOR UPDATE;

    v_now := clock_timestamp();

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.brain_chat_user_quotas AS q (
          user_id, request_count, window_started_at, window_resets_at, updated_at
        ) VALUES (
          v_user_id, 1, v_now, v_now + interval '60 minutes', v_now
        )
        RETURNING q.* INTO v_row;

        RETURN QUERY SELECT true, 100, 99, v_row.window_resets_at;
        RETURN;
      EXCEPTION WHEN unique_violation THEN
        -- A parallel first request created the row. Retry and lock it.
      END;
    ELSIF v_row.window_resets_at <= v_now THEN
      UPDATE public.brain_chat_user_quotas AS q
         SET request_count = 1,
             window_started_at = v_now,
             window_resets_at = v_now + interval '60 minutes',
             updated_at = v_now
       WHERE q.user_id = v_user_id
       RETURNING q.* INTO v_row;

      RETURN QUERY SELECT true, 100, 99, v_row.window_resets_at;
      RETURN;
    ELSIF v_row.request_count >= 100 THEN
      RETURN QUERY SELECT false, 100, 0, v_row.window_resets_at;
      RETURN;
    ELSE
      UPDATE public.brain_chat_user_quotas AS q
         SET request_count = q.request_count + 1,
             updated_at = v_now
       WHERE q.user_id = v_user_id
       RETURNING q.* INTO v_row;

      RETURN QUERY SELECT true, 100, 100 - v_row.request_count, v_row.window_resets_at;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_brain_chat_quota_status()
RETURNS TABLE (
  quota_limit integer,
  remaining integer,
  reset_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := statement_timestamp();
  v_row public.brain_chat_user_quotas%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT q.*
    INTO v_row
    FROM public.brain_chat_user_quotas AS q
   WHERE q.user_id = v_user_id;

  IF NOT FOUND OR v_row.window_resets_at <= v_now THEN
    RETURN QUERY SELECT 100, 100, NULL::timestamptz;
  ELSE
    RETURN QUERY SELECT 100, 100 - v_row.request_count, v_row.window_resets_at;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admit_brain_chat_request() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_brain_chat_quota_status() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_brain_chat_request() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_brain_chat_quota_status() TO authenticated;

COMMENT ON TABLE public.brain_chat_user_quotas IS
  'Server-managed fixed-window Brain chat quota keyed only by auth.uid(); direct client table access is prohibited.';
COMMENT ON FUNCTION public.admit_brain_chat_request() IS
  'Atomically admits at most 100 authenticated Brain OpenAI requests per user per 60-minute database-time window.';
COMMENT ON FUNCTION public.get_brain_chat_quota_status() IS
  'Returns the authenticated user current Brain chat quota without consuming allowance.';
