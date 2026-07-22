-- Durable, server-only Arabic task localization cache and retry queue.
-- Canonical task content, K8 events, N1/N2 timing, and event keys are unchanged.
BEGIN;

CREATE TABLE public.task_localizations (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language = 'ar'),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (task_id, language)
);
CREATE INDEX task_localizations_company_language_idx ON public.task_localizations(company_id, language, task_id);
ALTER TABLE public.task_localizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_localizations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.task_localizations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.task_localizations TO service_role;

CREATE TABLE public.task_localization_jobs (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language = 'ar'),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  safe_failure_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (task_id, language),
  CHECK ((status = 'processing') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX task_localization_jobs_pending_idx ON public.task_localization_jobs(available_at, created_at)
  WHERE status IN ('pending','processing');
ALTER TABLE public.task_localization_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_localization_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.task_localization_jobs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.task_localization_jobs TO service_role;

CREATE FUNCTION public.enqueue_arabic_task_localization() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_hash text;
BEGIN
  IF NEW.assigned_employee_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.employees AS employee
    JOIN public.profiles AS profile ON profile.employee_id = employee.id
      AND profile.company_id = employee.company_id
    WHERE employee.id = NEW.assigned_employee_id AND employee.company_id = NEW.company_id
      AND employee.status = 'active' AND profile.status = 'active' AND profile.preferred_language = 'ar'
  ) THEN RETURN NEW; END IF;
  v_hash := encode(extensions.digest(convert_to(NEW.title || E'\n' || coalesce(NEW.description, ''), 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.task_localization_jobs(task_id, company_id, language, source_hash)
  VALUES (NEW.id, NEW.company_id, 'ar', v_hash)
  ON CONFLICT (task_id, language) DO UPDATE SET
    company_id = EXCLUDED.company_id, source_hash = EXCLUDED.source_hash,
    status = CASE WHEN public.task_localization_jobs.source_hash = EXCLUDED.source_hash
      AND public.task_localization_jobs.status = 'completed' THEN 'completed' ELSE 'pending' END,
    attempt_count = CASE WHEN public.task_localization_jobs.source_hash = EXCLUDED.source_hash
      THEN public.task_localization_jobs.attempt_count ELSE 0 END,
    available_at = clock_timestamp(), lease_token = NULL, lease_expires_at = NULL,
    safe_failure_code = NULL, updated_at = clock_timestamp();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_arabic_task_localization() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tasks_enqueue_arabic_localization
AFTER INSERT OR UPDATE OF title, description, assigned_employee_id ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.enqueue_arabic_task_localization();

CREATE FUNCTION public.claim_task_localization_job(p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(task_id uuid, company_id uuid, language text, source_hash text, title text, description text, lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_job public.task_localization_jobs%ROWTYPE; v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
  SELECT job.* INTO v_job FROM public.task_localization_jobs AS job
  WHERE ((job.status = 'pending' AND job.available_at <= clock_timestamp()) OR
         (job.status = 'processing' AND job.lease_expires_at < clock_timestamp()))
    AND job.attempt_count < 5 ORDER BY job.available_at, job.created_at
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.task_localization_jobs AS job SET status='processing', attempt_count=job.attempt_count+1,
    lease_token=v_token, lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds), updated_at=clock_timestamp()
  WHERE job.task_id=v_job.task_id AND job.language=v_job.language;
  RETURN QUERY SELECT task.id, task.company_id, v_job.language, v_job.source_hash,
    task.title, task.description, v_token FROM public.tasks AS task
    WHERE task.id=v_job.task_id AND task.company_id=v_job.company_id;
END $$;

CREATE FUNCTION public.complete_task_localization_job(
  p_task_id uuid, p_language text, p_source_hash text, p_lease_token uuid,
  p_title text, p_description text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_job public.task_localization_jobs%ROWTYPE; v_live_hash text;
BEGIN
  SELECT job.* INTO v_job FROM public.task_localization_jobs AS job
  WHERE job.task_id=p_task_id AND job.language=p_language AND job.status='processing'
    AND job.lease_token=p_lease_token AND job.lease_expires_at>=clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED'; END IF;
  SELECT encode(extensions.digest(convert_to(task.title || E'\n' || coalesce(task.description,''),'UTF8'),'sha256'),'hex')
    INTO v_live_hash FROM public.tasks AS task WHERE task.id=p_task_id AND task.company_id=v_job.company_id;
  IF v_live_hash IS DISTINCT FROM p_source_hash OR v_job.source_hash IS DISTINCT FROM p_source_hash OR btrim(p_title)='' THEN
    RAISE EXCEPTION 'LOCALIZATION_SOURCE_CHANGED';
  END IF;
  INSERT INTO public.task_localizations(task_id,company_id,language,source_hash,title,description)
  VALUES(p_task_id,v_job.company_id,p_language,p_source_hash,btrim(p_title),p_description)
  ON CONFLICT(task_id,language) DO UPDATE SET source_hash=EXCLUDED.source_hash,title=EXCLUDED.title,
    description=EXCLUDED.description,updated_at=clock_timestamp();
  UPDATE public.task_localization_jobs AS job SET status='completed',lease_token=NULL,lease_expires_at=NULL,
    safe_failure_code=NULL,updated_at=clock_timestamp() WHERE job.task_id=p_task_id AND job.language=p_language;
END $$;

CREATE FUNCTION public.fail_task_localization_job(p_task_id uuid,p_language text,p_lease_token uuid,p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_job public.task_localization_jobs%ROWTYPE; v_retry boolean;
BEGIN
  SELECT job.* INTO v_job FROM public.task_localization_jobs AS job WHERE job.task_id=p_task_id
    AND job.language=p_language AND job.status='processing' AND job.lease_token=p_lease_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED'; END IF;
  v_retry := v_job.attempt_count < 5;
  UPDATE public.task_localization_jobs AS job SET status=CASE WHEN v_retry THEN 'pending' ELSE 'failed' END,
    available_at=CASE WHEN v_retry THEN clock_timestamp()+make_interval(secs=>power(2,v_job.attempt_count)::integer*30) ELSE job.available_at END,
    lease_token=NULL,lease_expires_at=NULL,safe_failure_code=left(p_code,80),updated_at=clock_timestamp()
  WHERE job.task_id=p_task_id AND job.language=p_language;
END $$;

REVOKE ALL ON FUNCTION public.claim_task_localization_job(integer),
  public.complete_task_localization_job(uuid,text,text,uuid,text,text),
  public.fail_task_localization_job(uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_task_localization_job(integer),
  public.complete_task_localization_job(uuid,text,text,uuid,text,text),
  public.fail_task_localization_job(uuid,text,uuid,text) TO service_role;

-- Localize future in-app notification labels at insertion without changing
-- event identity, recipient routing, timing, or delivery jobs.
CREATE FUNCTION public.localize_employee_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_language text;
BEGIN
  SELECT profile.preferred_language INTO v_language FROM public.profiles AS profile
  WHERE profile.id=NEW.recipient_id AND profile.company_id=NEW.company_id AND profile.status='active';
  IF v_language='ar' THEN
    NEW.title := CASE NEW.notification_type
      WHEN 'task.assigned' THEN 'تم إسناد مهمة'
      WHEN 'task.reassigned' THEN 'تم تغيير إسناد المهمة'
      WHEN 'task.due_30m' THEN 'المهمة مستحقة خلال 30 دقيقة'
      WHEN 'task.completed' THEN 'اكتملت المهمة'
      ELSE NEW.title END;
    NEW.message := CASE WHEN NEW.category='tasks' THEN 'افتح HospiBrain لعرض تفاصيل المهمة.' ELSE NEW.message END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.localize_employee_notification() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER notifications_localize_employee
BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.localize_employee_notification();

COMMIT;

-- This migration intentionally does not enqueue existing tasks. A legacy
-- backfill requires separate approval and must insert bounded job rows only.
