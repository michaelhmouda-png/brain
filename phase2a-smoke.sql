BEGIN;

DO $phase2a$
DECLARE
  v_profile_id uuid; v_company_id uuid; v_location_id uuid; v_gateway_id uuid; v_public_agent_id uuid:=gen_random_uuid();
  v_code text; v_expiry timestamptz; v_hash_one text:=repeat('a',64); v_hash_two text:=repeat('b',64);
  v_context record; v_boolean boolean; v_failed boolean; v_count integer; v_results jsonb:='[]'::jsonb; v_persisted jsonb;
BEGIN
  BEGIN
    SELECT p.id,p.company_id,l.id INTO v_profile_id,v_company_id,v_location_id
    FROM public.profiles p JOIN public.locations l ON l.company_id=p.company_id AND l.status='active'
    WHERE p.status='active' AND p.role::text IN ('owner','super_admin') ORDER BY p.created_at,p.id,l.id LIMIT 1;
    IF v_profile_id IS NULL THEN RAISE EXCEPTION 'PHASE2A_SMOKE_OWNER_FIXTURE_MISSING'; END IF;
    PERFORM set_config('request.jwt.claim.sub',v_profile_id::text,true);
    SELECT public.create_device_gateway(v_location_id,'Phase2A rollback smoke '||substr(gen_random_uuid()::text,1,8)) INTO v_gateway_id;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('test','gateway_insert','passed',v_gateway_id IS NOT NULL));

    SELECT gateway_id,pairing_code,expires_at INTO v_context FROM public.create_device_pairing_request(v_gateway_id);
    v_code:=v_context.pairing_code; v_expiry:=v_context.expires_at;
    SELECT count(*) INTO v_count FROM public.device_pairing_requests r WHERE r.gateway_id=v_gateway_id AND r.code_hash=encode(extensions.digest(convert_to(v_code,'UTF8'),'sha256'),'hex');
    IF v_count<>1 OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_pairing_requests' AND column_name IN ('pairing_code','code','secret')) THEN RAISE EXCEPTION 'PHASE2A_SMOKE_PAIRING_DIGEST_FAILED'; END IF;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('test','pairing_code_returned_once_digest_only','passed',true,'expires_in_future',v_expiry>clock_timestamp()));

    SELECT * INTO v_context FROM public.consume_device_pairing_request(encode(extensions.digest(convert_to(v_code,'UTF8'),'sha256'),'hex'),v_public_agent_id,v_hash_one,'0.1.0','win32','preview','preview-agent',jsonb_build_array('brain.heartbeat.v1','unknown.preview'));
    IF v_context.gateway_id<>v_gateway_id OR v_context.company_id<>v_company_id OR v_context.location_id<>v_location_id THEN RAISE EXCEPTION 'PHASE2A_SMOKE_CONTEXT_MISMATCH'; END IF;
    SELECT count(*) INTO v_count FROM public.device_agent_credentials WHERE gateway_id=v_gateway_id AND revoked_at IS NULL;
    IF v_count<>1 THEN RAISE EXCEPTION 'PHASE2A_SMOKE_ACTIVE_CREDENTIAL_COUNT'; END IF;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('test','pairing_consumed_with_trusted_context','passed',true));

    v_failed:=false; BEGIN PERFORM public.consume_device_pairing_request(encode(extensions.digest(convert_to(v_code,'UTF8'),'sha256'),'hex'),gen_random_uuid(),repeat('c',64),'0.1.0','win32',NULL,NULL,'[]'::jsonb); EXCEPTION WHEN OTHERS THEN v_failed:=true; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'PHASE2A_SMOKE_PAIRING_REUSE_ACCEPTED'; END IF;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('test','pairing_request_single_use','passed',true));

    SELECT * INTO v_context FROM public.authenticate_device_agent_heartbeat(v_public_agent_id,v_hash_one,'0.1.0','win32','preview','preview-agent',jsonb_build_array('brain.heartbeat.v1','unknown.preview','unknown.preview'));
    IF v_context.gateway_id<>v_gateway_id OR v_context.company_id<>v_company_id OR v_context.location_id<>v_location_id THEN RAISE EXCEPTION 'PHASE2A_SMOKE_HEARTBEAT_CONTEXT'; END IF;
    IF position('company' IN pg_get_function_identity_arguments('public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb)'::regprocedure))>0 OR position('location' IN pg_get_function_identity_arguments('public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb)'::regprocedure))>0 OR position('gateway' IN pg_get_function_identity_arguments('public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb)'::regprocedure))>0 THEN RAISE EXCEPTION 'PHASE2A_SMOKE_AUTHORITY_PARAMETER'; END IF;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('test','heartbeat_trusted_context_no_authority_override','passed',true));

    IF EXISTS(SELECT 1 FROM public.device_gateway_capabilities WHERE gateway_id=v_gateway_id AND capability_code<>'brain.heartbeat.v1') THEN RAISE EXCEPTION 'PHASE2A_SMOKE_UNKNOWN_CAPABILITY_GRANTED'; END IF;
    SELECT count(*) INTO v_count FROM public.device_agent_audit WHERE gateway_id=v_gateway_id AND event_type='capability.unknown_declared';
    IF v_count<>1 THEN RAISE EXCEPTION 'PHASE2A_SMOKE_UNKNOWN_AUDIT_UNBOUNDED'; END IF;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('test','unknown_capability_not_granted_and_audit_bounded','passed',true));

    UPDATE public.device_gateways SET status='disabled' WHERE id=v_gateway_id;
    v_failed:=false; BEGIN PERFORM public.authenticate_device_agent_heartbeat(v_public_agent_id,v_hash_one,'0.1.0','win32',NULL,NULL,'[]'::jsonb); EXCEPTION WHEN OTHERS THEN v_failed:=true; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'PHASE2A_SMOKE_DISABLED_CREDENTIAL_ACCEPTED'; END IF;
    UPDATE public.device_gateways SET status='offline' WHERE id=v_gateway_id;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('test','disabled_gateway_credential_denied','passed',true));

    SELECT public.revoke_device_agent(v_gateway_id) INTO v_boolean;
    v_failed:=false; BEGIN PERFORM public.authenticate_device_agent_heartbeat(v_public_agent_id,v_hash_one,'0.1.0','win32',NULL,NULL,'[]'::jsonb); EXCEPTION WHEN OTHERS THEN v_failed:=true; END;
    IF NOT v_boolean OR NOT v_failed THEN RAISE EXCEPTION 'PHASE2A_SMOKE_REVOKED_CREDENTIAL_ACCEPTED'; END IF;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('test','revoked_credential_denied','passed',true));

    SELECT public.prepare_device_gateway_repair(v_gateway_id) INTO v_boolean;
    IF NOT v_boolean OR (SELECT status FROM public.device_gateways WHERE id=v_gateway_id)<>'unpaired' OR EXISTS(SELECT 1 FROM public.device_agent_credentials WHERE gateway_id=v_gateway_id AND revoked_at IS NULL) THEN RAISE EXCEPTION 'PHASE2A_SMOKE_REPAIR_PREPARATION_FAILED'; END IF;
    SELECT pairing_code INTO v_code FROM public.create_device_pairing_request(v_gateway_id);
    PERFORM public.consume_device_pairing_request(encode(extensions.digest(convert_to(v_code,'UTF8'),'sha256'),'hex'),v_public_agent_id,v_hash_two,'0.1.0','win32','preview','preview-agent','["brain.heartbeat.v1"]'::jsonb);
    SELECT count(*) INTO v_count FROM public.device_agent_credentials WHERE gateway_id=v_gateway_id AND public_agent_id=v_public_agent_id;
    IF v_count<>2 OR (SELECT count(*) FROM public.device_agent_credentials WHERE gateway_id=v_gateway_id AND public_agent_id=v_public_agent_id AND revoked_at IS NULL)<>1 THEN RAISE EXCEPTION 'PHASE2A_SMOKE_STABLE_ID_HISTORY_FAILED'; END IF;
    v_failed:=false; BEGIN PERFORM public.authenticate_device_agent_heartbeat(v_public_agent_id,v_hash_one,'0.1.0','win32',NULL,NULL,'[]'::jsonb); EXCEPTION WHEN OTHERS THEN v_failed:=true; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'PHASE2A_SMOKE_OLD_CREDENTIAL_REACTIVATED'; END IF;
    PERFORM public.authenticate_device_agent_heartbeat(v_public_agent_id,v_hash_two,'0.1.0','win32',NULL,NULL,'["brain.heartbeat.v1"]'::jsonb);
    v_results:=v_results||jsonb_build_array(jsonb_build_object('test','stable_public_id_repaired_old_credential_denied','passed',true));

    RAISE EXCEPTION USING ERRCODE='P2A01',MESSAGE='PHASE2A_ROLLBACK_MARKER';
  EXCEPTION WHEN SQLSTATE 'P2A01' THEN NULL;
  END;

  v_persisted:=jsonb_build_object(
    'device_gateways',(SELECT count(*) FROM public.device_gateways WHERE id=v_gateway_id),
    'pairing_requests',(SELECT count(*) FROM public.device_pairing_requests WHERE gateway_id=v_gateway_id),
    'credentials',(SELECT count(*) FROM public.device_agent_credentials WHERE gateway_id=v_gateway_id),
    'capabilities',(SELECT count(*) FROM public.device_gateway_capabilities WHERE gateway_id=v_gateway_id),
    'audit',(SELECT count(*) FROM public.device_agent_audit WHERE gateway_id=v_gateway_id)
  );
  IF v_persisted<>jsonb_build_object('device_gateways',0,'pairing_requests',0,'credentials',0,'capabilities',0,'audit',0) THEN RAISE EXCEPTION 'PHASE2A_SMOKE_PERSISTENCE_FAILURE'; END IF;
  v_results:=v_results||jsonb_build_array(jsonb_build_object('test','rollback_left_no_rows','passed',true,'counts',v_persisted));
  PERFORM set_config(
    'brain.phase2a_smoke_result',
    jsonb_build_object(
      'test_count',jsonb_array_length(v_results),
      'passed_count',jsonb_array_length(v_results),
      'failed_count',0,
      'all_tests_pass',true,
      'rollback_completed',true,
      'remaining_fixture_rows',v_persisted,
      'results',v_results
    )::text,
    true
  );
END
$phase2a$;

SELECT current_setting('brain.phase2a_smoke_result',true)::jsonb AS phase2a_smoke;

ROLLBACK;
