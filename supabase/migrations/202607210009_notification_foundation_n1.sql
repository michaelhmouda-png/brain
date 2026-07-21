/* Notification Foundation N1: tenant-safe in-app and Web Push delivery. */

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'unread';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'system';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS route text NOT NULL DEFAULT '/dashboard';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS event_key text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS archived_at timestamptz;
UPDATE public.notifications SET status=CASE WHEN is_read THEN 'read' ELSE 'unread' END WHERE status='unread' AND is_read;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_n1_status_check CHECK(status IN('unread','read','archived'));
ALTER TABLE public.notifications ADD CONSTRAINT notifications_n1_category_check CHECK(category IN('tasks','announcements','maintenance','incidents','evidence','system'));
ALTER TABLE public.notifications ADD CONSTRAINT notifications_n1_route_check CHECK(route IN('/dashboard','/dashboard/tasks','/dashboard/announcements','/dashboard/maintenance','/dashboard/incidents','/dashboard/evidence-review','/dashboard/settings'));
CREATE UNIQUE INDEX notifications_recipient_event_key_idx ON public.notifications(recipient_id,event_key) WHERE event_key IS NOT NULL;
CREATE INDEX notifications_recipient_status_created_idx ON public.notifications(recipient_id,status,created_at DESC);

CREATE TABLE public.notification_preferences(
 profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 in_app_enabled boolean NOT NULL DEFAULT true,push_enabled boolean NOT NULL DEFAULT false,
 task_assignments boolean NOT NULL DEFAULT true,task_updates boolean NOT NULL DEFAULT true,due_reminders boolean NOT NULL DEFAULT true,
 announcements boolean NOT NULL DEFAULT true,maintenance boolean NOT NULL DEFAULT true,incidents boolean NOT NULL DEFAULT true,evidence_review boolean NOT NULL DEFAULT true,
 quiet_hours_enabled boolean NOT NULL DEFAULT false,quiet_hours_start time,quiet_hours_end time,timezone text NOT NULL DEFAULT 'UTC',updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(NOT quiet_hours_enabled OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL))
);
CREATE TABLE public.push_subscriptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,endpoint text NOT NULL,p256dh text NOT NULL,auth_key text NOT NULL,
 user_agent_family text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),revoked_at timestamptz,
 UNIQUE(profile_id,endpoint),CHECK(length(endpoint)<=2048 AND length(p256dh)<=512 AND length(auth_key)<=512),
 CHECK(endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[^/]+\.notify\.windows\.com)/')
);
CREATE TABLE public.notification_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 event_key text NOT NULL,event_type text NOT NULL,aggregate_type text NOT NULL,aggregate_id uuid NOT NULL,actor_profile_id uuid,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','completed','failed')),attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_token uuid,lease_expires_at timestamptz,last_failure_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,UNIQUE(company_id,event_key),
 CHECK((status='processing')=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX notification_outbox_claim_idx ON public.notification_outbox(available_at,created_at) WHERE status IN('pending','processing');
CREATE TABLE public.notification_delivery_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE RESTRICT,
 subscription_id uuid NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE RESTRICT,company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','delivered','failed')),attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_token uuid,lease_expires_at timestamptz,last_failure_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),delivered_at timestamptz,UNIQUE(notification_id,subscription_id),
 CHECK((status='processing')=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX notification_delivery_claim_idx ON public.notification_delivery_jobs(available_at,created_at) WHERE status IN('pending','processing');
CREATE TABLE public.notification_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 notification_id uuid,profile_id uuid,event_type text NOT NULL,safe_details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY; ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY; ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.push_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY; ALTER TABLE public.notification_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_jobs ENABLE ROW LEVEL SECURITY; ALTER TABLE public.notification_delivery_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_audit ENABLE ROW LEVEL SECURITY; ALTER TABLE public.notification_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications,public.notification_preferences,public.push_subscriptions,public.notification_outbox,public.notification_delivery_jobs,public.notification_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.notifications,public.notification_preferences,public.push_subscriptions,public.notification_outbox,public.notification_delivery_jobs TO service_role;
GRANT SELECT,INSERT ON public.notification_audit TO service_role;

CREATE OR REPLACE FUNCTION private.queue_notification_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_type text;v_key text;v_actor uuid;v_company uuid;v_id uuid;
BEGIN
 v_company:=NEW.company_id;v_id:=NEW.id;
 IF TG_TABLE_NAME='tasks' THEN
  IF TG_OP='INSERT' AND NEW.assigned_employee_id IS NOT NULL THEN v_type:='task.assigned';
  ELSIF TG_OP='UPDATE' AND NEW.assigned_employee_id IS DISTINCT FROM OLD.assigned_employee_id THEN v_type:='task.reassigned';
  ELSIF TG_OP='UPDATE' AND NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status THEN v_type:='task.completed';
  ELSIF TG_OP='UPDATE' AND (NEW.title,NEW.description,NEW.priority,NEW.due_date,NEW.status) IS DISTINCT FROM (OLD.title,OLD.description,OLD.priority,OLD.due_date,OLD.status) THEN v_type:='task.updated'; END IF;
  v_actor:=NEW.created_by;
 ELSIF TG_TABLE_NAME='announcements' AND TG_OP='INSERT' THEN v_type:='announcement.published';v_actor:=NEW.created_by_id;
 ELSIF TG_TABLE_NAME='maintenance_tickets' THEN
  IF TG_OP='INSERT' AND NEW.priority IN('high','critical') THEN v_type:='maintenance.urgent_created';
  ELSIF TG_OP='UPDATE' AND NEW.assigned_to_id IS DISTINCT FROM OLD.assigned_to_id THEN v_type:='maintenance.assigned';
  ELSIF TG_OP='UPDATE' AND (NEW.priority,NEW.status) IS DISTINCT FROM (OLD.priority,OLD.status) THEN v_type:='maintenance.updated'; END IF;v_actor:=NEW.created_by_id;
 ELSIF TG_TABLE_NAME='incident_reports' THEN
  IF TG_OP='INSERT' THEN v_type:='incident.reported';
  ELSIF (NEW.severity,NEW.status) IS DISTINCT FROM (OLD.severity,OLD.status) THEN v_type:='incident.updated'; END IF;v_actor:=NEW.reported_by_id;
 ELSIF TG_TABLE_NAME='task_evidence' AND TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
  IF NEW.status='pending_review' THEN v_type:='evidence.submitted';
  ELSIF NEW.status='needs_human_review' THEN v_type:='evidence.needs_human_review';
  ELSIF NEW.status='verification_failed' THEN v_type:='evidence.verification_failed';
  ELSIF NEW.status='human_approved' THEN v_type:='evidence.human_approved';
  ELSIF NEW.status='human_rejected' THEN v_type:='evidence.human_rejected'; END IF;v_actor:=NEW.submitted_by_profile_id;
 ELSIF TG_TABLE_NAME='profiles' AND NEW.company_id IS NOT NULL AND NEW.status='active' AND TG_OP='INSERT' THEN
  v_type:='system.account_ready';v_actor:=NEW.id;
 ELSIF TG_TABLE_NAME='profiles' AND NEW.company_id IS NOT NULL AND NEW.status='active' AND TG_OP='UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
  v_type:='system.account_ready';v_actor:=NEW.id;
 END IF;
 IF v_type IS NULL THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='task_evidence' THEN v_key:=v_type||':'||v_id::text||':'||NEW.status;
 ELSIF TG_TABLE_NAME='profiles' THEN v_key:=v_type||':'||v_id::text||':'||NEW.status;
 ELSE v_key:=v_type||':'||v_id::text||':'||coalesce(NEW.updated_at::text,NEW.created_at::text);END IF;
 INSERT INTO public.notification_outbox(company_id,event_key,event_type,aggregate_type,aggregate_id,actor_profile_id)
 VALUES(v_company,v_key,v_type,TG_TABLE_NAME,v_id,v_actor) ON CONFLICT(company_id,event_key) DO NOTHING;
 INSERT INTO public.notification_audit(company_id,event_type,safe_details) VALUES(v_company,'obligation.created',jsonb_build_object('eventType',v_type));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notification_tasks_event ON public.tasks;CREATE TRIGGER notification_tasks_event AFTER INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION private.queue_notification_event();
DROP TRIGGER IF EXISTS notification_announcements_event ON public.announcements;CREATE TRIGGER notification_announcements_event AFTER INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION private.queue_notification_event();
DROP TRIGGER IF EXISTS notification_maintenance_event ON public.maintenance_tickets;CREATE TRIGGER notification_maintenance_event AFTER INSERT OR UPDATE ON public.maintenance_tickets FOR EACH ROW EXECUTE FUNCTION private.queue_notification_event();
DROP TRIGGER IF EXISTS notification_incidents_event ON public.incident_reports;CREATE TRIGGER notification_incidents_event AFTER INSERT OR UPDATE ON public.incident_reports FOR EACH ROW EXECUTE FUNCTION private.queue_notification_event();
DROP TRIGGER IF EXISTS notification_evidence_event ON public.task_evidence;CREATE TRIGGER notification_evidence_event AFTER UPDATE ON public.task_evidence FOR EACH ROW EXECUTE FUNCTION private.queue_notification_event();
DROP TRIGGER IF EXISTS notification_profile_event ON public.profiles;CREATE TRIGGER notification_profile_event AFTER INSERT OR UPDATE OF status ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.queue_notification_event();

CREATE OR REPLACE FUNCTION public.list_my_notifications(p_limit integer DEFAULT 30,p_before timestamptz DEFAULT NULL)
RETURNS TABLE(id uuid,title text,message text,category text,status text,route text,created_at timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path='' STABLE AS $$
 SELECT n.id,n.title,n.message,n.category,n.status,n.route,n.created_at FROM public.notifications n JOIN public.profiles p ON p.id=auth.uid() AND p.status='active' AND p.company_id=n.company_id
 WHERE n.recipient_id=auth.uid() AND n.status<>'archived' AND (p_before IS NULL OR n.created_at<p_before) ORDER BY n.created_at DESC LIMIT least(greatest(p_limit,1),50)
$$;
CREATE OR REPLACE FUNCTION public.get_my_notification_state() RETURNS TABLE(unread_count bigint,preferences jsonb,subscription_count bigint) LANGUAGE sql SECURITY DEFINER SET search_path='' STABLE AS $$
 SELECT count(n.id) FILTER(WHERE n.status='unread'),to_jsonb(pref),count(DISTINCT s.id) FILTER(WHERE s.revoked_at IS NULL)
 FROM public.profiles p LEFT JOIN public.notifications n ON n.recipient_id=p.id AND n.company_id=p.company_id
 LEFT JOIN public.notification_preferences pref ON pref.profile_id=p.id LEFT JOIN public.push_subscriptions s ON s.profile_id=p.id AND s.company_id=p.company_id
 WHERE p.id=auth.uid() AND p.status='active' GROUP BY pref.*
$$;
CREATE OR REPLACE FUNCTION public.update_my_notification(p_notification_id uuid,p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_company uuid;
BEGIN SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;
 UPDATE public.notifications n SET status=CASE p_action WHEN 'read' THEN 'read' WHEN 'archive' THEN 'archived' ELSE n.status END,is_read=CASE WHEN p_action IN('read','archive') THEN true ELSE n.is_read END,
 read_at=CASE WHEN p_action IN('read','archive') THEN coalesce(n.read_at,clock_timestamp()) ELSE n.read_at END,archived_at=CASE WHEN p_action='archive' THEN clock_timestamp() ELSE n.archived_at END,updated_at=clock_timestamp()
 WHERE n.id=p_notification_id AND n.recipient_id=auth.uid() AND n.company_id=v_company;IF NOT FOUND OR p_action NOT IN('read','archive') THEN RAISE EXCEPTION 'NOT_AVAILABLE';END IF;
 INSERT INTO public.notification_audit(company_id,notification_id,profile_id,event_type) VALUES(v_company,p_notification_id,auth.uid(),CASE p_action WHEN 'read' THEN 'notification.read' ELSE 'notification.archived' END);
END $$;
CREATE OR REPLACE FUNCTION public.mark_all_my_notifications_read() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;v_company uuid;BEGIN SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;
 UPDATE public.notifications n SET status='read',is_read=true,read_at=coalesce(n.read_at,clock_timestamp()),updated_at=clock_timestamp() WHERE n.recipient_id=auth.uid() AND n.company_id=v_company AND n.status='unread';GET DIAGNOSTICS v_count=ROW_COUNT;INSERT INTO public.notification_audit(company_id,profile_id,event_type,safe_details) VALUES(v_company,auth.uid(),'notification.read_all',jsonb_build_object('count',v_count));RETURN v_count;END $$;

CREATE OR REPLACE FUNCTION public.save_my_notification_preferences(p_preferences jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE;v_timezone text:=coalesce(nullif(p_preferences->>'timezone',''),'UTC');BEGIN SELECT pr.* INTO p FROM public.profiles pr WHERE pr.id=auth.uid() AND pr.status='active';IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=v_timezone) THEN RAISE EXCEPTION 'INVALID_TIMEZONE';END IF;
 INSERT INTO public.notification_preferences(profile_id,company_id,in_app_enabled,push_enabled,task_assignments,task_updates,due_reminders,announcements,maintenance,incidents,evidence_review,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,timezone)
 VALUES(p.id,p.company_id,coalesce((p_preferences->>'inAppEnabled')::boolean,true),coalesce((p_preferences->>'pushEnabled')::boolean,false),coalesce((p_preferences->>'taskAssignments')::boolean,true),coalesce((p_preferences->>'taskUpdates')::boolean,true),coalesce((p_preferences->>'dueReminders')::boolean,true),coalesce((p_preferences->>'announcements')::boolean,true),coalesce((p_preferences->>'maintenance')::boolean,true),coalesce((p_preferences->>'incidents')::boolean,true),coalesce((p_preferences->>'evidenceReview')::boolean,true),coalesce((p_preferences->>'quietHoursEnabled')::boolean,false),(p_preferences->>'quietHoursStart')::time,(p_preferences->>'quietHoursEnd')::time,v_timezone)
 ON CONFLICT(profile_id) DO UPDATE SET in_app_enabled=excluded.in_app_enabled,push_enabled=excluded.push_enabled,task_assignments=excluded.task_assignments,task_updates=excluded.task_updates,due_reminders=excluded.due_reminders,announcements=excluded.announcements,maintenance=excluded.maintenance,incidents=excluded.incidents,evidence_review=excluded.evidence_review,quiet_hours_enabled=excluded.quiet_hours_enabled,quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,timezone=excluded.timezone,updated_at=clock_timestamp();END $$;
CREATE OR REPLACE FUNCTION public.save_my_push_subscription(p_endpoint text,p_p256dh text,p_auth text,p_device text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE;v_id uuid;BEGIN SELECT pr.* INTO p FROM public.profiles pr WHERE pr.id=auth.uid() AND pr.status='active';IF NOT FOUND OR length(p_endpoint)>2048 OR length(p_p256dh)>512 OR length(p_auth)>512 OR p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[^/]+\.notify\.windows\.com)/' THEN RAISE EXCEPTION 'INVALID_SUBSCRIPTION';END IF;
 INSERT INTO public.push_subscriptions(company_id,profile_id,endpoint,p256dh,auth_key,user_agent_family) VALUES(p.company_id,p.id,p_endpoint,p_p256dh,p_auth,left(p_device,80)) ON CONFLICT(profile_id,endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth_key=excluded.auth_key,user_agent_family=excluded.user_agent_family,revoked_at=NULL,last_seen_at=clock_timestamp() RETURNING id INTO v_id;
 INSERT INTO public.notification_preferences(profile_id,company_id,push_enabled) VALUES(p.id,p.company_id,true) ON CONFLICT(profile_id) DO UPDATE SET push_enabled=true,updated_at=clock_timestamp();INSERT INTO public.notification_audit(company_id,profile_id,event_type) VALUES(p.company_id,p.id,'subscription.created');RETURN v_id;END $$;
CREATE OR REPLACE FUNCTION public.revoke_my_push_subscription(p_endpoint text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_company uuid;BEGIN SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;UPDATE public.push_subscriptions s SET revoked_at=clock_timestamp() WHERE s.profile_id=auth.uid() AND s.company_id=v_company AND s.endpoint=p_endpoint;INSERT INTO public.notification_audit(company_id,profile_id,event_type) VALUES(v_company,auth.uid(),'subscription.revoked');END $$;

CREATE OR REPLACE FUNCTION public.generate_task_reminder_obligations() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;BEGIN
 INSERT INTO public.notification_outbox(company_id,event_key,event_type,aggregate_type,aggregate_id)
 SELECT t.company_id,CASE WHEN t.due_date<current_date THEN 'task.overdue:' ELSE 'task.due_soon:' END||t.id::text||':'||t.due_date::text,
 CASE WHEN t.due_date<current_date THEN 'task.overdue' ELSE 'task.due_soon' END,'tasks',t.id FROM public.tasks t WHERE t.due_date IS NOT NULL AND t.status NOT IN('completed','cancelled') AND t.assigned_employee_id IS NOT NULL AND t.due_date<=current_date+1
 ON CONFLICT(company_id,event_key) DO NOTHING;GET DIAGNOSTICS v_count=ROW_COUNT;RETURN v_count;END $$;

REVOKE ALL ON FUNCTION public.list_my_notifications(integer,timestamptz),public.get_my_notification_state(),public.update_my_notification(uuid,text),public.mark_all_my_notifications_read(),public.save_my_notification_preferences(jsonb),public.save_my_push_subscription(text,text,text,text),public.revoke_my_push_subscription(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_my_notifications(integer,timestamptz),public.get_my_notification_state(),public.update_my_notification(uuid,text),public.mark_all_my_notifications_read(),public.save_my_notification_preferences(jsonb),public.save_my_push_subscription(text,text,text,text),public.revoke_my_push_subscription(text) TO authenticated;
REVOKE ALL ON FUNCTION public.generate_task_reminder_obligations() FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.generate_task_reminder_obligations() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_notification_outbox(p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(outbox_id uuid,lease_token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.notification_outbox%ROWTYPE;v_token uuid:=gen_random_uuid();BEGIN IF p_lease_seconds<30 OR p_lease_seconds>300 THEN RAISE EXCEPTION 'INVALID_LEASE';END IF;
 SELECT x.* INTO o FROM public.notification_outbox x WHERE ((x.status='pending' AND x.available_at<=clock_timestamp()) OR (x.status='processing' AND x.lease_expires_at<clock_timestamp())) AND x.attempt_count<5 ORDER BY x.available_at,x.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN;END IF;UPDATE public.notification_outbox x SET status='processing',attempt_count=x.attempt_count+1,lease_token=v_token,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds) WHERE x.id=o.id;RETURN QUERY SELECT o.id,v_token;END $$;

CREATE OR REPLACE FUNCTION public.materialize_notification_outbox(p_outbox_id uuid,p_lease_token uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.notification_outbox%ROWTYPE;r record;v_notification uuid;v_count integer:=0;v_category text;v_title text;v_message text;v_route text;v_allowed boolean;v_in_app boolean;BEGIN
 SELECT x.* INTO o FROM public.notification_outbox x WHERE x.id=p_outbox_id AND x.status='processing' AND x.lease_token=p_lease_token AND x.lease_expires_at>=clock_timestamp() FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED';END IF;
 v_category:=CASE WHEN o.event_type LIKE 'task.%' THEN 'tasks' WHEN o.event_type LIKE 'announcement.%' THEN 'announcements' WHEN o.event_type LIKE 'maintenance.%' THEN 'maintenance' WHEN o.event_type LIKE 'incident.%' THEN 'incidents' WHEN o.event_type LIKE 'evidence.%' THEN 'evidence' ELSE 'system' END;
 v_route:=CASE v_category WHEN 'tasks' THEN '/dashboard/tasks' WHEN 'announcements' THEN '/dashboard/announcements' WHEN 'maintenance' THEN '/dashboard/maintenance' WHEN 'incidents' THEN '/dashboard/incidents' WHEN 'evidence' THEN CASE WHEN o.event_type IN('evidence.needs_human_review','evidence.verification_failed') THEN '/dashboard/evidence-review' ELSE '/dashboard/tasks' END ELSE '/dashboard' END;
 v_title:=CASE o.event_type WHEN 'task.assigned' THEN 'Task assigned' WHEN 'task.reassigned' THEN 'Task assignment changed' WHEN 'task.due_soon' THEN 'Task due soon' WHEN 'task.overdue' THEN 'Task overdue' WHEN 'task.completed' THEN 'Task completed' WHEN 'announcement.published' THEN 'New announcement' WHEN 'maintenance.assigned' THEN 'Maintenance ticket assigned' WHEN 'maintenance.urgent_created' THEN 'Urgent maintenance alert' WHEN 'incident.reported' THEN 'Incident reported' WHEN 'evidence.submitted' THEN 'Task evidence submitted' WHEN 'evidence.needs_human_review' THEN 'Evidence needs review' WHEN 'evidence.verification_failed' THEN 'Evidence verification failed' WHEN 'evidence.human_approved' THEN 'Evidence approved' WHEN 'evidence.human_rejected' THEN 'Evidence requires resubmission' ELSE 'Operational update' END;
 v_message:=CASE WHEN o.event_type='evidence.human_rejected' THEN 'Open HospiBrain to review and resubmit evidence.' ELSE 'Open HospiBrain to view this update.' END;
 FOR r IN
  SELECT DISTINCT p.id AS profile_id FROM public.profiles p
  WHERE p.company_id=o.company_id AND p.status='active' AND p.role IN('employee','manager','owner','super_admin') AND (
   (o.event_type LIKE 'task.%' AND EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=o.aggregate_id AND t.company_id=o.company_id AND t.assigned_employee_id=p.employee_id)) OR
   (o.event_type='announcement.published' AND EXISTS(SELECT 1 FROM public.announcements a WHERE a.id=o.aggregate_id AND a.company_id=o.company_id AND (a.expires_at IS NULL OR a.expires_at>clock_timestamp()) AND a.created_by_id<>p.id AND (coalesce(cardinality(a.target_roles),0)=0 OR p.role=ANY(a.target_roles)))) OR
   (o.event_type='maintenance.assigned' AND EXISTS(SELECT 1 FROM public.maintenance_tickets m WHERE m.id=o.aggregate_id AND m.company_id=o.company_id AND m.assigned_to_id=p.employee_id)) OR
   (o.event_type IN('maintenance.urgent_created','maintenance.updated','incident.reported','incident.updated','evidence.needs_human_review','evidence.verification_failed') AND p.role IN('manager','owner','super_admin')) OR
   (o.event_type='evidence.submitted' AND EXISTS(SELECT 1 FROM public.task_evidence e JOIN public.tasks t ON t.id=e.task_id AND t.company_id=e.company_id WHERE e.id=o.aggregate_id AND e.company_id=o.company_id AND t.assigned_employee_id=p.employee_id)) OR
   (o.event_type IN('evidence.human_approved','evidence.human_rejected') AND EXISTS(SELECT 1 FROM public.task_evidence e JOIN public.tasks t ON t.id=e.task_id AND t.company_id=e.company_id WHERE e.id=o.aggregate_id AND e.company_id=o.company_id AND (e.submitted_by_profile_id=p.id OR t.assigned_employee_id=p.employee_id)))
   OR (o.event_type='system.account_ready' AND p.id=o.aggregate_id)
  )
 LOOP
  SELECT CASE v_category WHEN 'tasks' THEN CASE WHEN o.event_type IN('task.assigned','task.reassigned') THEN coalesce(pref.task_assignments,true) WHEN o.event_type IN('task.due_soon','task.overdue') THEN coalesce(pref.due_reminders,true) ELSE coalesce(pref.task_updates,true) END WHEN 'announcements' THEN coalesce(pref.announcements,true) WHEN 'maintenance' THEN coalesce(pref.maintenance,true) WHEN 'incidents' THEN coalesce(pref.incidents,true) WHEN 'evidence' THEN coalesce(pref.evidence_review,true) ELSE true END,coalesce(pref.in_app_enabled,true) INTO v_allowed,v_in_app FROM public.profiles p LEFT JOIN public.notification_preferences pref ON pref.profile_id=p.id WHERE p.id=r.profile_id;
  IF v_allowed THEN
   INSERT INTO public.notifications(company_id,recipient_id,title,message,notification_type,related_entity_type,related_entity_id,status,category,route,event_key,is_read)
   VALUES(o.company_id,r.profile_id,v_title,v_message,o.event_type,o.aggregate_type,o.aggregate_id,CASE WHEN v_in_app THEN 'unread' ELSE 'archived' END,v_category,v_route,o.event_key,NOT v_in_app) ON CONFLICT(recipient_id,event_key) WHERE event_key IS NOT NULL DO NOTHING RETURNING id INTO v_notification;
   IF v_notification IS NOT NULL THEN v_count:=v_count+1;INSERT INTO public.notification_audit(company_id,notification_id,profile_id,event_type) VALUES(o.company_id,v_notification,r.profile_id,'recipient.resolved'),(o.company_id,v_notification,r.profile_id,'notification.created');
    INSERT INTO public.notification_delivery_jobs(notification_id,subscription_id,company_id)
    SELECT v_notification,s.id,o.company_id FROM public.push_subscriptions s JOIN public.notification_preferences pref ON pref.profile_id=s.profile_id WHERE s.profile_id=r.profile_id AND s.company_id=o.company_id AND s.revoked_at IS NULL AND pref.push_enabled
      AND NOT(pref.quiet_hours_enabled AND CASE WHEN pref.quiet_hours_start<=pref.quiet_hours_end THEN (clock_timestamp() AT TIME ZONE pref.timezone)::time>=pref.quiet_hours_start AND (clock_timestamp() AT TIME ZONE pref.timezone)::time<pref.quiet_hours_end ELSE (clock_timestamp() AT TIME ZONE pref.timezone)::time>=pref.quiet_hours_start OR (clock_timestamp() AT TIME ZONE pref.timezone)::time<pref.quiet_hours_end END) ON CONFLICT(notification_id,subscription_id) DO NOTHING;
    IF FOUND THEN INSERT INTO public.notification_audit(company_id,notification_id,profile_id,event_type) VALUES(o.company_id,v_notification,r.profile_id,'push.queued');END IF;
   END IF;
  END IF;v_notification:=NULL;
 END LOOP;
 IF v_count=0 THEN INSERT INTO public.notification_audit(company_id,event_type,safe_details) VALUES(o.company_id,'recipient.unresolved',jsonb_build_object('eventType',o.event_type));END IF;
 UPDATE public.notification_outbox x SET status='completed',lease_token=NULL,lease_expires_at=NULL,completed_at=clock_timestamp() WHERE x.id=o.id;RETURN v_count;
END $$;
CREATE OR REPLACE FUNCTION public.fail_notification_outbox(p_outbox_id uuid,p_lease_token uuid,p_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.notification_outbox%ROWTYPE;v_retry boolean;BEGIN SELECT x.* INTO o FROM public.notification_outbox x WHERE x.id=p_outbox_id AND x.status='processing' AND x.lease_token=p_lease_token FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED';END IF;v_retry:=o.attempt_count<5;UPDATE public.notification_outbox x SET status=CASE WHEN v_retry THEN 'pending' ELSE 'failed' END,available_at=CASE WHEN v_retry THEN clock_timestamp()+make_interval(secs=>power(2,o.attempt_count)::integer*30) ELSE x.available_at END,lease_token=NULL,lease_expires_at=NULL,last_failure_code=left(p_code,80) WHERE x.id=o.id;INSERT INTO public.notification_audit(company_id,event_type,safe_details) VALUES(o.company_id,'obligation.failed',jsonb_build_object('retryable',v_retry,'code',left(p_code,80)));END $$;

CREATE OR REPLACE FUNCTION public.claim_notification_delivery(p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(job_id uuid,lease_token uuid,endpoint text,p256dh text,auth_key text,notification_id uuid,title text,summary text,route text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.notification_delivery_jobs%ROWTYPE;v_token uuid:=gen_random_uuid();BEGIN SELECT x.* INTO j FROM public.notification_delivery_jobs x JOIN public.push_subscriptions s ON s.id=x.subscription_id AND s.revoked_at IS NULL WHERE ((x.status='pending' AND x.available_at<=clock_timestamp()) OR(x.status='processing' AND x.lease_expires_at<clock_timestamp())) AND x.attempt_count<5 ORDER BY x.available_at,x.created_at FOR UPDATE OF x SKIP LOCKED LIMIT 1;IF NOT FOUND THEN RETURN;END IF;
 UPDATE public.notification_delivery_jobs x SET status='processing',attempt_count=x.attempt_count+1,lease_token=v_token,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds) WHERE x.id=j.id;
 RETURN QUERY SELECT j.id,v_token,s.endpoint,s.p256dh,s.auth_key,n.id,n.title,'Open HospiBrain to view this notification.'::text,n.route FROM public.push_subscriptions s JOIN public.notifications n ON n.id=j.notification_id WHERE s.id=j.subscription_id;END $$;
CREATE OR REPLACE FUNCTION public.complete_notification_delivery(p_job_id uuid,p_lease_token uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.notification_delivery_jobs%ROWTYPE;BEGIN SELECT x.* INTO j FROM public.notification_delivery_jobs x WHERE x.id=p_job_id AND x.status='processing' AND x.lease_token=p_lease_token FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED';END IF;UPDATE public.notification_delivery_jobs x SET status='delivered',lease_token=NULL,lease_expires_at=NULL,delivered_at=clock_timestamp() WHERE x.id=j.id;INSERT INTO public.notification_audit(company_id,notification_id,event_type) VALUES(j.company_id,j.notification_id,'push.delivered');END $$;
CREATE OR REPLACE FUNCTION public.fail_notification_delivery(p_job_id uuid,p_lease_token uuid,p_code text,p_permanent boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.notification_delivery_jobs%ROWTYPE;v_retry boolean;BEGIN SELECT x.* INTO j FROM public.notification_delivery_jobs x WHERE x.id=p_job_id AND x.status='processing' AND x.lease_token=p_lease_token FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED';END IF;v_retry:=NOT p_permanent AND j.attempt_count<5;UPDATE public.notification_delivery_jobs x SET status=CASE WHEN v_retry THEN 'pending' ELSE 'failed' END,available_at=CASE WHEN v_retry THEN clock_timestamp()+make_interval(secs=>power(2,j.attempt_count)::integer*30) ELSE x.available_at END,lease_token=NULL,lease_expires_at=NULL,last_failure_code=left(p_code,80) WHERE x.id=j.id;IF p_permanent THEN UPDATE public.push_subscriptions s SET revoked_at=clock_timestamp() WHERE s.id=j.subscription_id;END IF;INSERT INTO public.notification_audit(company_id,notification_id,event_type,safe_details) VALUES(j.company_id,j.notification_id,CASE WHEN v_retry THEN 'push.retry' ELSE 'push.permanently_failed' END,jsonb_build_object('code',left(p_code,80)));END $$;

CREATE OR REPLACE FUNCTION public.get_company_notification_diagnostics() RETURNS TABLE(unread bigint,pending_obligations bigint,pending_push bigint,failed_push bigint) LANGUAGE sql SECURITY DEFINER SET search_path='' STABLE AS $$
 SELECT count(DISTINCT n.id) FILTER(WHERE n.status='unread'),count(DISTINCT o.id) FILTER(WHERE o.status IN('pending','processing')),count(DISTINCT d.id) FILTER(WHERE d.status IN('pending','processing')),count(DISTINCT d.id) FILTER(WHERE d.status='failed') FROM public.profiles p LEFT JOIN public.notifications n ON n.company_id=p.company_id LEFT JOIN public.notification_outbox o ON o.company_id=p.company_id LEFT JOIN public.notification_delivery_jobs d ON d.company_id=p.company_id WHERE p.id=auth.uid() AND p.status='active' AND p.role IN('manager','owner','super_admin')
$$;
REVOKE ALL ON FUNCTION public.claim_notification_outbox(integer),public.materialize_notification_outbox(uuid,uuid),public.fail_notification_outbox(uuid,uuid,text),public.claim_notification_delivery(integer),public.complete_notification_delivery(uuid,uuid),public.fail_notification_delivery(uuid,uuid,text,boolean),public.generate_task_reminder_obligations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_outbox(integer),public.materialize_notification_outbox(uuid,uuid),public.fail_notification_outbox(uuid,uuid,text),public.claim_notification_delivery(integer),public.complete_notification_delivery(uuid,uuid),public.fail_notification_delivery(uuid,uuid,text,boolean),public.generate_task_reminder_obligations() TO service_role;
REVOKE ALL ON FUNCTION public.get_company_notification_diagnostics() FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.get_company_notification_diagnostics() TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
DO $vault$ DECLARE c bigint;BEGIN SELECT count(*) INTO c FROM vault.secrets s WHERE s.name='notification_worker_secret';IF c<>1 THEN RAISE EXCEPTION 'Notification worker requires exactly one Vault secret named notification_worker_secret; found %.',c;END IF;END $vault$;
DO $cron$ DECLARE j bigint;BEGIN FOR j IN SELECT jobid FROM cron.job WHERE jobname='notification-worker-every-minute' LOOP PERFORM cron.unschedule(j);END LOOP;END $cron$;
SELECT cron.schedule('notification-worker-every-minute','* * * * *',$cmd$SELECT net.http_post(url:='https://www.hospibrain.com/api/internal/notification-worker',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='notification_worker_secret')),body:='{}'::jsonb);$cmd$);

/* No UPDATE public.tasks statement exists in N1. */
