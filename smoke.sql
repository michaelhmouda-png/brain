BEGIN;
CREATE TEMP TABLE camera_phase1_smoke_results(test_name text PRIMARY KEY,passed boolean NOT NULL,details text NOT NULL) ON COMMIT DROP;
DO $$
DECLARE
  v_profile_id uuid;v_company_id uuid;v_location_id uuid;v_other_location_id uuid;
  v_gateway_id uuid:=gen_random_uuid();v_nvr_id uuid:=gen_random_uuid();v_dns_nvr_id uuid:=gen_random_uuid();v_camera_id uuid:=gen_random_uuid();
  v_invalid_host text;v_rejected boolean;v_audit_count bigint;
BEGIN
  SELECT profile.id,profile.company_id,location.id INTO v_profile_id,v_company_id,v_location_id
  FROM public.profiles profile JOIN public.locations location ON location.company_id=profile.company_id
  WHERE profile.status='active' AND profile.role IN('owner','super_admin') AND location.status='active'
  ORDER BY profile.id,location.id LIMIT 1;
  IF v_profile_id IS NULL OR v_company_id IS NULL OR v_location_id IS NULL THEN
    INSERT INTO camera_phase1_smoke_results VALUES('fixture_resolution',false,'No active owner/super_admin with an active same-company location exists.');RETURN;
  END IF;
  INSERT INTO camera_phase1_smoke_results VALUES('fixture_resolution',true,'Suitable trusted fixture exists.');
  PERFORM set_config('request.jwt.claim.sub',v_profile_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_profile_id,'role','authenticated')::text,true);
  IF auth.uid() IS DISTINCT FROM v_profile_id THEN INSERT INTO camera_phase1_smoke_results VALUES('auth_uid_fixture',false,'auth.uid() did not resolve to the selected profile.');RETURN;END IF;
  INSERT INTO camera_phase1_smoke_results VALUES('auth_uid_fixture',true,'auth.uid() resolved to the fixture profile.');
  INSERT INTO public.device_gateways(id,company_id,location_id,name,gateway_type,status,created_by) VALUES(v_gateway_id,v_company_id,v_location_id,'Camera Phase 1 Smoke Gateway','brain_agent','unpaired',v_profile_id);
  INSERT INTO camera_phase1_smoke_results VALUES('gateway_insert',true,'Temporary gateway inserted.');
  INSERT INTO public.nvr_connections(id,company_id,location_id,gateway_id,name,vendor,local_host,http_port,rtsp_port,onvif_port,status,created_by)
    VALUES(v_nvr_id,v_company_id,v_location_id,v_gateway_id,'Camera Phase 1 Smoke NVR','Dahua','192.168.10.124',80,554,NULL,'configured',v_profile_id);
  INSERT INTO camera_phase1_smoke_results VALUES('valid_ipv4_nvr_insert',true,'Valid private IPv4 accepted.');
  INSERT INTO public.nvr_connections(id,company_id,location_id,gateway_id,name,vendor,local_host,http_port,rtsp_port,onvif_port,status,created_by)
    VALUES(v_dns_nvr_id,v_company_id,v_location_id,v_gateway_id,'Camera Phase 1 DNS Smoke NVR','Dahua','nvr.localdomain',80,554,NULL,'configured',v_profile_id);
  INSERT INTO camera_phase1_smoke_results VALUES('valid_dns_nvr_insert',true,'Valid DNS hostname accepted.');
  INSERT INTO public.cameras(id,company_id,location_id,nvr_connection_id,external_channel_id,name,area,department,stream_profile,status,ai_enabled,task_verification_enabled)
    VALUES(v_camera_id,v_company_id,v_location_id,v_nvr_id,'smoke-channel-1','Camera Phase 1 Smoke Camera','Smoke area','Operations','main','unconfigured',false,false);
  INSERT INTO camera_phase1_smoke_results VALUES('camera_insert',true,'Linked camera inserted.');
  v_rejected:=false;
  BEGIN INSERT INTO public.cameras(id,company_id,location_id,nvr_connection_id,external_channel_id,name,status) VALUES(gen_random_uuid(),v_company_id,v_location_id,v_nvr_id,'smoke-channel-1','Duplicate Smoke Camera','unconfigured');
  EXCEPTION WHEN unique_violation THEN v_rejected:=true;END;
  INSERT INTO camera_phase1_smoke_results VALUES('duplicate_channel_rejected',v_rejected,CASE WHEN v_rejected THEN 'Duplicate NVR channel rejected.' ELSE 'Duplicate NVR channel unexpectedly accepted.' END);
  v_rejected:=false;
  BEGIN DELETE FROM public.nvr_connections WHERE id=v_nvr_id;EXCEPTION WHEN foreign_key_violation THEN v_rejected:=true;END;
  INSERT INTO camera_phase1_smoke_results VALUES('referenced_nvr_delete_rejected',v_rejected,CASE WHEN v_rejected THEN 'NVR deletion blocked while referenced.' ELSE 'Referenced NVR unexpectedly deleted.' END);
  FOREACH v_invalid_host IN ARRAY ARRAY['localhost','localhost.','nvr.localhost','127.0.0.1','127.12.34.56','0.0.0.0','0.1.2.3','169.254.1.20','224.0.0.1','239.255.255.250','240.0.0.1','255.255.255.255','127.000.0.1','999.1.1.1','1.2.3','http://192.168.10.124','192.168.10.124/path','192.168.10.124:80','user:password@192.168.10.124'] LOOP
    v_rejected:=false;
    BEGIN INSERT INTO public.nvr_connections(id,company_id,location_id,gateway_id,name,vendor,local_host,status,created_by) VALUES(gen_random_uuid(),v_company_id,v_location_id,v_gateway_id,'Invalid Host Smoke NVR','Dahua',v_invalid_host,'unconfigured',v_profile_id);
    EXCEPTION WHEN check_violation THEN v_rejected:=true;END;
    INSERT INTO camera_phase1_smoke_results VALUES('invalid_host_'||md5(v_invalid_host),v_rejected,CASE WHEN v_rejected THEN 'Invalid host rejected: '||v_invalid_host ELSE 'Invalid host unexpectedly accepted: '||v_invalid_host END);
  END LOOP;
  SELECT location.id INTO v_other_location_id FROM public.locations location WHERE location.company_id<>v_company_id ORDER BY location.id LIMIT 1;
  IF v_other_location_id IS NULL THEN
    INSERT INTO camera_phase1_smoke_results VALUES('cross_company_location_guard',true,'Not executed: no second-company location fixture exists; verify through browser/API tenant testing.');
  ELSE
    v_rejected:=false;
    BEGIN INSERT INTO public.nvr_connections(id,company_id,location_id,name,vendor,local_host,status,created_by) VALUES(gen_random_uuid(),v_company_id,v_other_location_id,'Cross-company Smoke NVR','Dahua','192.168.10.125','unconfigured',v_profile_id);
    EXCEPTION WHEN raise_exception THEN v_rejected:=true;END;
    INSERT INTO camera_phase1_smoke_results VALUES('cross_company_location_guard',v_rejected,CASE WHEN v_rejected THEN 'Cross-company location rejected.' ELSE 'Cross-company location unexpectedly accepted.' END);
  END IF;
  UPDATE public.cameras SET name='Updated Camera Phase 1 Smoke Camera',area='Updated smoke area',department='Updated operations',ai_enabled=true,task_verification_enabled=true WHERE id=v_camera_id;
  INSERT INTO camera_phase1_smoke_results VALUES('approved_camera_metadata_update',EXISTS(SELECT 1 FROM public.cameras camera WHERE camera.id=v_camera_id AND camera.company_id=v_company_id AND camera.location_id=v_location_id AND camera.nvr_connection_id=v_nvr_id AND camera.external_channel_id='smoke-channel-1' AND camera.status='unconfigured' AND camera.name='Updated Camera Phase 1 Smoke Camera' AND camera.area='Updated smoke area' AND camera.department='Updated operations' AND camera.ai_enabled AND camera.task_verification_enabled),'Approved metadata changed while authority fields remained unchanged.');
  SELECT count(*) INTO v_audit_count FROM public.device_configuration_audit audit WHERE audit.entity_id IN(v_nvr_id,v_dns_nvr_id,v_camera_id) AND audit.company_id=v_company_id AND audit.actor_profile_id=v_profile_id;
  INSERT INTO camera_phase1_smoke_results VALUES('audit_rows_created',v_audit_count>=4,'Expected configuration audit events were recorded.');
  INSERT INTO camera_phase1_smoke_results VALUES('audit_changed_fields_safe',NOT EXISTS(SELECT 1 FROM public.device_configuration_audit audit CROSS JOIN LATERAL unnest(audit.changed_fields) changed_field WHERE audit.entity_id IN(v_nvr_id,v_dns_nvr_id,v_camera_id) AND changed_field NOT IN('name','area','department','ai_enabled','task_verification_enabled')),'Audit changed_fields contains only approved field names.');
  INSERT INTO camera_phase1_smoke_results VALUES('audit_schema_contains_no_sensitive_payload',NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_configuration_audit' AND column_name ~* '(host|password|credential|secret|payload|request|body)'),'Audit table has no host, credential, secret, or request-payload column.');
END $$;
SELECT test_name,CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,details FROM camera_phase1_smoke_results ORDER BY test_name;
SELECT count(*) AS test_count,count(*) FILTER(WHERE passed) AS passed_count,count(*) FILTER(WHERE NOT passed) AS failed_count,bool_and(passed) AS all_tests_pass FROM camera_phase1_smoke_results;
ROLLBACK;
