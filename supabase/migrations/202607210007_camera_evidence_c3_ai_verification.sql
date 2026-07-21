/*
 * Camera Evidence C3: durable AI verification jobs and append-only human review.
 * This migration never mutates task status and never widens original-object access.
 */

ALTER TABLE public.task_evidence DROP CONSTRAINT IF EXISTS task_evidence_status_check;
ALTER TABLE public.task_evidence ADD CONSTRAINT task_evidence_status_check CHECK (status IN (
  'pending_upload','upload_failed','pending_review','queued','processing','ai_verified','ai_rejected',
  'needs_human_review','verification_failed','human_approved','human_rejected'
));

ALTER TABLE public.task_evidence_audit DROP CONSTRAINT IF EXISTS task_evidence_audit_event_type_check;
ALTER TABLE public.task_evidence_audit ALTER COLUMN actor_profile_id DROP NOT NULL;
ALTER TABLE public.task_evidence_audit ADD COLUMN actor_type text NOT NULL DEFAULT 'human'
  CHECK (actor_type IN ('human','system'));
ALTER TABLE public.task_evidence_audit ADD CONSTRAINT task_evidence_audit_event_type_check CHECK (event_type IN (
  'upload.prepared','upload.failed','upload.completed','verification.queued','verification.started',
  'verification.succeeded','verification.failed','review.approved','review.rejected'
));

CREATE TABLE public.task_evidence_verification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES public.task_evidence(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  cycle_number integer NOT NULL DEFAULT 1 CHECK (cycle_number BETWEEN 1 AND 3),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts = 3),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_failure_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'processing') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  UNIQUE(evidence_id, cycle_number)
);
CREATE INDEX task_evidence_verification_jobs_claim_idx ON public.task_evidence_verification_jobs(available_at, created_at)
  WHERE status IN ('queued','processing');
CREATE UNIQUE INDEX task_evidence_verification_jobs_one_active_idx ON public.task_evidence_verification_jobs(evidence_id)
  WHERE status IN ('queued','processing');

CREATE TABLE public.task_evidence_verification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.task_evidence_verification_jobs(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES public.task_evidence(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  provider text NOT NULL DEFAULT 'openai' CHECK (provider = 'openai'),
  model_name text NOT NULL,
  model_version text,
  status text NOT NULL CHECK (status IN ('processing','succeeded','failed')),
  verdict text CHECK (verdict IN ('verified','rejected','needs_human_review')),
  confidence numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  explanation text CHECK (explanation IS NULL OR length(explanation) <= 600),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  visible_observations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(visible_observations) = 'array'),
  uncertainty_flags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(uncertainty_flags) = 'array'),
  usage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(usage_metadata) = 'object'),
  failure_code text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE(job_id, attempt_number)
);
CREATE INDEX task_evidence_verification_attempts_evidence_idx ON public.task_evidence_verification_attempts(evidence_id, attempt_number DESC);

CREATE TABLE public.task_evidence_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES public.task_evidence(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  reviewer_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(evidence_id)
);

CREATE TABLE public.task_evidence_derivatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES public.task_evidence(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  derivative_type text NOT NULL CHECK (derivative_type = 'ai_jpeg_preview'),
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type = 'image/jpeg'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  generator text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(evidence_id, derivative_type)
);

ALTER TABLE public.task_evidence_verification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_verification_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_verification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_verification_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_derivatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_derivatives FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_evidence_verification_jobs, public.task_evidence_verification_attempts, public.task_evidence_reviews, public.task_evidence_derivatives FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.task_evidence_verification_jobs, public.task_evidence_verification_attempts TO service_role;
GRANT SELECT, INSERT ON public.task_evidence_reviews TO service_role;
GRANT SELECT, INSERT ON public.task_evidence_derivatives TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_task_evidence_verification(p_evidence_id uuid)
RETURNS TABLE(evidence_id uuid, verification_status text, duplicate boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_ev public.task_evidence%ROWTYPE; v_job public.task_evidence_verification_jobs%ROWTYPE; v_cycle integer; v_insert_count bigint;
BEGIN
  SELECT pr.* INTO v_profile FROM public.profiles pr WHERE pr.id=auth.uid() AND pr.status='active';
  IF NOT FOUND OR v_profile.company_id IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_PROVISIONED'; END IF;
  SELECT ev.* INTO v_ev FROM public.task_evidence ev JOIN public.tasks t ON t.id=ev.task_id AND t.company_id=ev.company_id
   WHERE ev.id=p_evidence_id AND ev.company_id=v_profile.company_id AND
    (v_profile.role IN ('manager','owner','super_admin') OR
     (v_profile.role='employee' AND v_profile.employee_id IS NOT NULL AND (ev.submitted_by_profile_id=v_profile.id OR t.assigned_employee_id=v_profile.employee_id))) FOR UPDATE OF ev;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_NOT_AVAILABLE'; END IF;
  IF v_ev.status NOT IN ('pending_review','queued','processing','verification_failed') THEN RAISE EXCEPTION 'EVIDENCE_NOT_QUEUEABLE'; END IF;
  SELECT j.* INTO v_job FROM public.task_evidence_verification_jobs j WHERE j.evidence_id=v_ev.id ORDER BY j.cycle_number DESC LIMIT 1;
  IF FOUND AND v_job.status IN ('queued','processing') THEN
    v_insert_count := 0;
  ELSE
    v_cycle := coalesce(v_job.cycle_number,0)+1;
    IF v_cycle > 3 THEN RAISE EXCEPTION 'VERIFICATION_RETRY_LIMIT_REACHED'; END IF;
    INSERT INTO public.task_evidence_verification_jobs(evidence_id,company_id,cycle_number) VALUES(v_ev.id,v_ev.company_id,v_cycle);
    GET DIAGNOSTICS v_insert_count = ROW_COUNT;
  END IF;
  IF v_ev.status IN ('pending_review','verification_failed') THEN UPDATE public.task_evidence SET status='queued' WHERE id=v_ev.id; END IF;
  IF v_insert_count = 1 THEN INSERT INTO public.task_evidence_audit(evidence_id,company_id,actor_profile_id,event_type)
    VALUES(v_ev.id,v_ev.company_id,v_profile.id,'verification.queued'); END IF;
  RETURN QUERY SELECT v_ev.id, (SELECT ev.status FROM public.task_evidence ev WHERE ev.id=v_ev.id), v_insert_count = 0;
END $$;

CREATE OR REPLACE FUNCTION public.claim_task_evidence_verification_job(p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(job_id uuid, lease_token uuid, evidence_id uuid, company_id uuid, task_id uuid, storage_path text,
  mime_type text, original_sha256 text, task_title text, task_description text, task_priority text, attempt_number integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.task_evidence_verification_jobs%ROWTYPE; v_token uuid:=gen_random_uuid();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
  SELECT j.* INTO v_job FROM public.task_evidence_verification_jobs j
   WHERE ((j.status='queued' AND j.available_at<=clock_timestamp()) OR (j.status='processing' AND j.lease_expires_at<clock_timestamp()))
     AND j.attempt_count<j.max_attempts ORDER BY j.available_at,j.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.task_evidence_verification_jobs j SET status='processing',attempt_count=j.attempt_count+1,
    lease_token=v_token,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),updated_at=clock_timestamp() WHERE j.id=v_job.id;
  UPDATE public.task_evidence ev SET status='processing' WHERE ev.id=v_job.evidence_id;
  INSERT INTO public.task_evidence_verification_attempts(job_id,evidence_id,company_id,attempt_number,model_name,status)
    VALUES(v_job.id,v_job.evidence_id,v_job.company_id,v_job.attempt_count+1,'pending-worker-config','processing');
  INSERT INTO public.task_evidence_audit(evidence_id,company_id,actor_profile_id,actor_type,event_type)
    VALUES(v_job.evidence_id,v_job.company_id,NULL,'system','verification.started');
  RETURN QUERY SELECT v_job.id,v_token,ev.id,ev.company_id,ev.task_id,ev.original_storage_path,ev.original_mime_type,ev.original_sha256,
    t.title,t.description,t.priority,v_job.attempt_count+1 FROM public.task_evidence ev JOIN public.tasks t ON t.id=ev.task_id WHERE ev.id=v_job.evidence_id;
END $$;

CREATE OR REPLACE FUNCTION public.complete_task_evidence_verification_job(p_job_id uuid,p_lease_token uuid,p_model_name text,p_model_version text,
 p_verdict text,p_confidence numeric,p_explanation text,p_reason_codes jsonb,p_visible_observations jsonb,p_uncertainty_flags jsonb,p_usage_metadata jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job public.task_evidence_verification_jobs%ROWTYPE; v_status text;
BEGIN
 SELECT j.* INTO v_job FROM public.task_evidence_verification_jobs j WHERE j.id=p_job_id AND j.status='processing' AND j.lease_token=p_lease_token AND j.lease_expires_at>=clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED'; END IF;
 IF p_verdict NOT IN ('verified','rejected','needs_human_review') OR p_confidence<0 OR p_confidence>1 OR jsonb_typeof(p_reason_codes)<>'array' OR jsonb_typeof(p_visible_observations)<>'array' OR jsonb_typeof(p_uncertainty_flags)<>'array' THEN RAISE EXCEPTION 'INVALID_VERIFICATION_RESULT'; END IF;
 v_status:=CASE p_verdict WHEN 'verified' THEN 'ai_verified' WHEN 'rejected' THEN 'ai_rejected' ELSE 'needs_human_review' END;
 UPDATE public.task_evidence_verification_attempts a SET model_name=p_model_name,model_version=p_model_version,status='succeeded',verdict=p_verdict,confidence=p_confidence,
 explanation=left(p_explanation,600),reason_codes=p_reason_codes,visible_observations=p_visible_observations,uncertainty_flags=p_uncertainty_flags,usage_metadata=p_usage_metadata,completed_at=clock_timestamp()
 WHERE a.job_id=v_job.id AND a.attempt_number=v_job.attempt_count;
 UPDATE public.task_evidence_verification_jobs j SET status='completed',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE j.id=v_job.id;
 UPDATE public.task_evidence ev SET status=v_status WHERE ev.id=v_job.evidence_id;
 INSERT INTO public.task_evidence_audit(evidence_id,company_id,actor_profile_id,actor_type,event_type,safe_details) VALUES(v_job.evidence_id,v_job.company_id,NULL,'system','verification.succeeded',jsonb_build_object('verdict',p_verdict,'attempt',v_job.attempt_count));
END $$;

CREATE OR REPLACE FUNCTION public.fail_task_evidence_verification_job(p_job_id uuid,p_lease_token uuid,p_failure_code text,p_retryable boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job public.task_evidence_verification_jobs%ROWTYPE; v_retry boolean;
BEGIN
 SELECT j.* INTO v_job FROM public.task_evidence_verification_jobs j WHERE j.id=p_job_id AND j.status='processing' AND j.lease_token=p_lease_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED'; END IF; v_retry:=p_retryable AND v_job.attempt_count<v_job.max_attempts;
 UPDATE public.task_evidence_verification_attempts a SET status='failed',failure_code=p_failure_code,completed_at=clock_timestamp() WHERE a.job_id=v_job.id AND a.attempt_number=v_job.attempt_count;
 UPDATE public.task_evidence_verification_jobs j SET status=CASE WHEN v_retry THEN 'queued' ELSE 'failed' END,available_at=CASE WHEN v_retry THEN clock_timestamp()+make_interval(secs=>power(2,v_job.attempt_count)::integer*30) ELSE j.available_at END,
 lease_token=NULL,lease_expires_at=NULL,last_failure_code=p_failure_code,updated_at=clock_timestamp() WHERE j.id=v_job.id;
 UPDATE public.task_evidence ev SET status=CASE WHEN v_retry THEN 'queued' ELSE 'verification_failed' END WHERE ev.id=v_job.evidence_id;
 INSERT INTO public.task_evidence_audit(evidence_id,company_id,actor_profile_id,actor_type,event_type,safe_details) VALUES(v_job.evidence_id,v_job.company_id,NULL,'system','verification.failed',jsonb_build_object('code',p_failure_code,'retryable',v_retry,'attempt',v_job.attempt_count));
END $$;

CREATE OR REPLACE FUNCTION public.list_task_evidence_reviews()
RETURNS TABLE(evidence_id uuid,evidence_status text,task_id uuid,task_title text,task_description text,task_status text,submitter_profile_id uuid,
 submitter_name text,ai_verdict text,confidence numeric,explanation text,reason_codes jsonb,visible_observations jsonb,uncertainty_flags jsonb,
 attempt_number integer,attempts jsonb,audit_history jsonb,created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path='' STABLE AS $$
 SELECT ev.id,ev.status,ev.task_id,t.title,t.description,t.status,ev.submitted_by_profile_id,coalesce(nullif(sp.full_name,''),'Team member'),
 a.verdict,a.confidence,a.explanation,a.reason_codes,a.visible_observations,a.uncertainty_flags,a.attempt_number,
 coalesce((SELECT jsonb_agg(jsonb_build_object('cycleNumber',vj.cycle_number,'attemptNumber',va.attempt_number,'status',va.status,'verdict',va.verdict,'confidence',va.confidence,'failureCode',va.failure_code,'startedAt',va.started_at,'completedAt',va.completed_at) ORDER BY va.started_at) FROM public.task_evidence_verification_attempts va JOIN public.task_evidence_verification_jobs vj ON vj.id=va.job_id WHERE va.evidence_id=ev.id),'[]'::jsonb),
 coalesce((SELECT jsonb_agg(jsonb_build_object('eventType',au.event_type,'actorType',au.actor_type,'createdAt',au.created_at,'safeDetails',au.safe_details) ORDER BY au.created_at) FROM public.task_evidence_audit au WHERE au.evidence_id=ev.id),'[]'::jsonb),ev.created_at
 FROM public.task_evidence ev JOIN public.profiles pr ON pr.id=auth.uid() AND pr.status='active' AND pr.company_id=ev.company_id AND pr.role IN ('manager','owner','super_admin')
 JOIN public.tasks t ON t.id=ev.task_id AND t.company_id=ev.company_id JOIN public.profiles sp ON sp.id=ev.submitted_by_profile_id
 LEFT JOIN LATERAL(SELECT x.* FROM public.task_evidence_verification_attempts x WHERE x.evidence_id=ev.id ORDER BY x.started_at DESC LIMIT 1)a ON true
 WHERE ev.status IN ('queued','processing','ai_verified','ai_rejected','needs_human_review','verification_failed','human_approved','human_rejected') ORDER BY ev.created_at DESC LIMIT 100;
$$;

CREATE OR REPLACE FUNCTION public.review_task_evidence(p_evidence_id uuid,p_decision text,p_note text,p_confirm boolean)
RETURNS TABLE(evidence_id uuid,evidence_status text,task_status_unchanged boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_ev public.task_evidence%ROWTYPE; v_task_status text;
BEGIN
 IF p_confirm IS NOT TRUE OR p_decision NOT IN ('approved','rejected') OR length(coalesce(p_note,''))>1000 THEN RAISE EXCEPTION 'INVALID_REVIEW'; END IF;
 SELECT pr.* INTO v_profile FROM public.profiles pr WHERE pr.id=auth.uid() AND pr.status='active' AND pr.role IN ('manager','owner','super_admin');
 IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_NOT_AUTHORIZED'; END IF;
 SELECT ev.* INTO v_ev FROM public.task_evidence ev WHERE ev.id=p_evidence_id AND ev.company_id=v_profile.company_id AND ev.status IN ('ai_verified','ai_rejected','needs_human_review','verification_failed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_NOT_REVIEWABLE'; END IF;
 SELECT t.status INTO v_task_status FROM public.tasks t WHERE t.id=v_ev.task_id AND t.company_id=v_ev.company_id;
 INSERT INTO public.task_evidence_reviews(evidence_id,company_id,reviewer_profile_id,decision,note) VALUES(v_ev.id,v_ev.company_id,v_profile.id,p_decision,nullif(btrim(p_note),''));
 UPDATE public.task_evidence SET status=CASE p_decision WHEN 'approved' THEN 'human_approved' ELSE 'human_rejected' END WHERE id=v_ev.id;
 INSERT INTO public.task_evidence_audit(evidence_id,company_id,actor_profile_id,event_type,safe_details) VALUES(v_ev.id,v_ev.company_id,v_profile.id,CASE p_decision WHEN 'approved' THEN 'review.approved' ELSE 'review.rejected' END,jsonb_build_object('has_note',nullif(btrim(p_note),'') IS NOT NULL));
 RETURN QUERY SELECT v_ev.id,(SELECT ev.status FROM public.task_evidence ev WHERE ev.id=v_ev.id),(SELECT t.status=v_task_status FROM public.tasks t WHERE t.id=v_ev.task_id);
END $$;

-- Preserve C2 authorization while allowing signed reads throughout the C3 lifecycle.
-- C2 returned TABLE(storage_path text). PostgreSQL cannot change a function's
-- TABLE return definition with CREATE OR REPLACE, so replace this exact RPC
-- signature without CASCADE. No Storage policy depends on this public RPC.
DROP FUNCTION IF EXISTS public.get_task_evidence_access(uuid);
CREATE OR REPLACE FUNCTION public.get_task_evidence_access(p_evidence_id uuid)
RETURNS TABLE(storage_path text, mime_type text)
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT ev.original_storage_path, ev.original_mime_type
  FROM public.task_evidence ev
  JOIN public.profiles pr ON pr.id = auth.uid() AND pr.status = 'active' AND pr.company_id = ev.company_id
  JOIN public.tasks t ON t.id = ev.task_id AND t.company_id = ev.company_id
  WHERE ev.id = p_evidence_id
    AND ev.status IN ('pending_review','queued','processing','ai_verified','ai_rejected','needs_human_review','verification_failed','human_approved','human_rejected')
    AND (pr.role IN ('manager','owner','super_admin') OR
      (pr.role = 'employee' AND pr.employee_id IS NOT NULL AND
       (ev.submitted_by_profile_id = pr.id OR t.assigned_employee_id = pr.employee_id)));
$$;

REVOKE ALL ON FUNCTION public.enqueue_task_evidence_verification(uuid),public.claim_task_evidence_verification_job(integer),
 public.complete_task_evidence_verification_job(uuid,uuid,text,text,text,numeric,text,jsonb,jsonb,jsonb,jsonb),public.fail_task_evidence_verification_job(uuid,uuid,text,boolean),
 public.list_task_evidence_reviews(),public.review_task_evidence(uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_task_evidence_verification(uuid),public.list_task_evidence_reviews(),public.review_task_evidence(uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_task_evidence_verification_job(integer),public.complete_task_evidence_verification_job(uuid,uuid,text,text,text,numeric,text,jsonb,jsonb,jsonb,jsonb),public.fail_task_evidence_verification_job(uuid,uuid,text,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.get_task_evidence_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_task_evidence_access(uuid) TO authenticated;

-- Intentionally no UPDATE public.tasks statement exists in C3.
