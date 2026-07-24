-- Read-only Phase 2A Preview preflight.
-- The catalog-conflict check aggregates directly over its derived table; a derived-table
-- alias is not an independently addressable relation inside sibling scalar subqueries.
WITH checks(check_name, severity, passed, details) AS (
  SELECT 'phase1_tables_exist','required',count(*)=4,jsonb_build_object('found',coalesce(jsonb_agg(c.relname ORDER BY c.relname),'[]'::jsonb))
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY(ARRAY['device_gateways','nvr_connections','cameras','device_configuration_audit'])
  UNION ALL
  SELECT 'phase1_helpers_exist','required',to_regprocedure('private.is_valid_camera_local_host(text)') IS NOT NULL AND to_regprocedure('private.validate_device_tenant_relationships()') IS NOT NULL AND to_regprocedure('private.can_view_camera_manager(uuid)') IS NOT NULL AND to_regprocedure('private.can_administer_camera_manager(uuid)') IS NOT NULL,jsonb_build_object('local_host_validator',to_regprocedure('private.is_valid_camera_local_host(text)')::text,'tenant_trigger',to_regprocedure('private.validate_device_tenant_relationships()')::text,'view_helper',to_regprocedure('private.can_view_camera_manager(uuid)')::text,'admin_helper',to_regprocedure('private.can_administer_camera_manager(uuid)')::text)
  UNION ALL
  SELECT 'phase1_repair_triggers_intact','required',count(*)=3,jsonb_build_object('trigger_count',count(*))
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
  WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname=ANY(ARRAY['device_gateways','nvr_connections','cameras']) AND pn.nspname='private' AND p.proname='validate_device_tenant_relationships'
  UNION ALL
  SELECT 'phase2a_tables_absent','required',count(*)=0,jsonb_build_object('conflicts',coalesce(jsonb_agg(c.relname),'[]'::jsonb))
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=ANY(ARRAY['device_pairing_requests','device_agent_credentials','device_capability_catalog','device_gateway_capabilities','device_agent_audit','device_agent_rate_limits'])
  UNION ALL
  SELECT 'phase2a_gateway_columns_absent','required',count(*)=0,jsonb_build_object('conflicts',coalesce(jsonb_agg(a.attname),'[]'::jsonb))
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='device_gateways' AND a.attnum>0 AND NOT a.attisdropped AND a.attname=ANY(ARRAY['platform','os_version','hostname_label','paired_at'])
  UNION ALL
  SELECT 'phase2a_functions_absent','required',count(*)=0,jsonb_build_object('conflicts',coalesce(jsonb_agg(p.proname),'[]'::jsonb))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='public' AND p.proname=ANY(ARRAY['create_device_gateway','create_device_pairing_request','revoke_device_pairing_request','consume_device_pairing_request','authenticate_device_agent_heartbeat','resolve_device_agent_rate_identity','revoke_device_agent','prepare_device_gateway_repair','admit_device_agent_request'])) OR (n.nspname='private' AND p.proname='valid_agent_capability_declarations')
  UNION ALL
  SELECT 'phase2a_catalog_names_unused','required',count(*)=0,jsonb_build_object('conflicts',coalesce(jsonb_agg(name ORDER BY name),'[]'::jsonb))
  FROM (SELECT c.relname AS name FROM pg_class c WHERE c.relname=ANY(ARRAY['device_gateways_company_id_id_unique','device_pairing_requests_pkey','device_pairing_requests_active_gateway_unique','device_pairing_requests_code_hash_unique','device_pairing_requests_expiry_idx','device_agent_credentials_pkey','device_agent_credentials_active_gateway_unique','device_agent_credentials_active_public_agent_unique','device_capability_catalog_pkey','device_gateway_capabilities_pkey','device_agent_audit_pkey','device_agent_audit_gateway_created_idx','device_agent_audit_unknown_capability_bucket_unique','device_agent_rate_limits_pkey','device_agent_rate_limits_reset_idx']) UNION SELECT con.conname FROM pg_constraint con WHERE con.conname=ANY(ARRAY['device_gateways_company_id_id_unique','device_pairing_request_expiry','device_pairing_request_terminal','device_pairing_request_tenant_fk','device_gateway_capability_grant_state','device_agent_rate_window'])) conflicts
  UNION ALL
  SELECT 'required_roles_and_schemas_exist','required',count(*)=5,jsonb_build_object('found_count',count(*))
  FROM (SELECT rolname FROM pg_roles WHERE rolname=ANY(ARRAY['anon','authenticated','service_role']) UNION ALL SELECT nspname FROM pg_namespace WHERE nspname=ANY(ARRAY['private','auth'])) required
  UNION ALL
  SELECT 'required_relations_exist','required',count(*)=4,jsonb_build_object('found_count',count(*))
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='public' AND c.relname=ANY(ARRAY['companies','locations','profiles'])) OR (n.nspname='auth' AND c.relname='users')
  UNION ALL
  SELECT 'profile_auth_identity_contract','required',count(*)=1,jsonb_build_object('matching_fk_count',count(*))
  FROM pg_constraint con JOIN pg_class source ON source.oid=con.conrelid JOIN pg_namespace sn ON sn.oid=source.relnamespace JOIN pg_class target ON target.oid=con.confrelid JOIN pg_namespace tn ON tn.oid=target.relnamespace
  WHERE con.contype='f' AND sn.nspname='public' AND source.relname='profiles' AND tn.nspname='auth' AND target.relname='users' AND con.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=source.oid AND attname='id')]::smallint[]
  UNION ALL
  SELECT 'profile_dependency_columns','required',count(*)=4,jsonb_build_object('found',coalesce(jsonb_agg(a.attname ORDER BY a.attname),'[]'::jsonb))
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='profiles' AND a.attnum>0 AND NOT a.attisdropped AND a.attname=ANY(ARRAY['id','company_id','status','role'])
  UNION ALL
  SELECT 'crypto_dependencies','required',to_regprocedure('extensions.digest(bytea,text)') IS NOT NULL AND to_regprocedure('extensions.gen_random_bytes(integer)') IS NOT NULL,jsonb_build_object('digest',to_regprocedure('extensions.digest(bytea,text)')::text,'random_bytes',to_regprocedure('extensions.gen_random_bytes(integer)')::text)
  UNION ALL
  SELECT 'canonical_management_roles_observed','review',count(DISTINCT role::text)=3,jsonb_build_object('observed',coalesce(jsonb_agg(DISTINCT role::text ORDER BY role::text),'[]'::jsonb)) FROM public.profiles WHERE role::text=ANY(ARRAY['manager','owner','super_admin']::text[])
), summary AS (
  SELECT count(*) AS check_count,count(*) FILTER(WHERE passed) AS passed_count,count(*) FILTER(WHERE NOT passed) AS failed_count,count(*) FILTER(WHERE NOT passed AND severity='required') AS required_failed,count(*) FILTER(WHERE NOT passed AND severity='review') AS review_failed FROM checks
)
SELECT jsonb_build_object(
  'decision',CASE WHEN required_failed>0 THEN 'NO-GO' WHEN review_failed>0 THEN 'REVIEW' ELSE 'GO' END,
  'summary',jsonb_build_object('check_count',check_count,'passed_count',passed_count,'failed_count',failed_count),
  'checks',(SELECT jsonb_agg(jsonb_build_object('check_name',check_name,'severity',severity,'passed',passed,'details',details) ORDER BY check_name) FROM checks)
)
FROM summary;
