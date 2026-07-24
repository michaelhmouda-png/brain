WITH
expected_tables(table_name) AS (VALUES ('device_gateways'),('nvr_connections'),('cameras'),('device_configuration_audit')),
expected_camera_select(column_name) AS (VALUES ('id'),('company_id'),('location_id'),('nvr_connection_id'),('external_channel_id'),('name'),('area'),('department'),('stream_profile'),('status'),('ai_enabled'),('task_verification_enabled'),('last_seen_at'),('created_at'),('updated_at')),
expected_nvr_select(column_name) AS (VALUES ('id'),('company_id'),('location_id'),('gateway_id'),('name'),('vendor'),('local_host'),('http_port'),('rtsp_port'),('onvif_port'),('status'),('last_tested_at'),('created_at'),('updated_at')),
actual_camera_select AS (
  SELECT DISTINCT column_name FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='cameras' AND grantee='authenticated' AND privilege_type='SELECT'
),
actual_nvr_select AS (
  SELECT DISTINCT column_name FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='nvr_connections' AND grantee='authenticated' AND privilege_type='SELECT'
),
function_evidence AS (
  SELECT namespace.nspname AS schema_name,procedure.proname,pg_get_function_identity_arguments(procedure.oid) AS arguments,
    language.lanname AS language,owner_role.rolname AS owner,procedure.provolatile AS volatility,
    procedure.proisstrict AS strict,procedure.prosecdef AS security_definer,procedure.proconfig AS configuration,
    EXISTS (SELECT 1 FROM aclexplode(COALESCE(procedure.proacl,acldefault('f',procedure.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute,
    has_function_privilege('anon',procedure.oid,'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated',procedure.oid,'EXECUTE') AS authenticated_execute,
    has_function_privilege('service_role',procedure.oid,'EXECUTE') AS service_role_execute,
    pg_get_functiondef(procedure.oid) AS definition
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
  JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
  JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=procedure.proowner
  WHERE namespace.nspname='private' AND procedure.proname IN('is_valid_camera_local_host','can_view_camera_manager','can_administer_camera_manager','validate_device_tenant_relationships','touch_device_updated_at','audit_device_configuration')
),
checks(check_name,passed,details) AS (
  SELECT 'all_four_tables_exist',count(*) FILTER(WHERE to_regclass(format('public.%I',table_name)) IS NOT NULL)=4,
    jsonb_agg(jsonb_build_object('table',table_name,'exists',to_regclass(format('public.%I',table_name)) IS NOT NULL) ORDER BY table_name) FROM expected_tables
  UNION ALL
  SELECT 'rls_enabled_and_forced',count(*)=4 AND bool_and(class_row.relrowsecurity) AND bool_and(class_row.relforcerowsecurity),
    jsonb_agg(jsonb_build_object('table',class_row.relname,'enabled',class_row.relrowsecurity,'forced',class_row.relforcerowsecurity) ORDER BY class_row.relname)
    FROM pg_catalog.pg_class class_row JOIN pg_catalog.pg_namespace namespace ON namespace.oid=class_row.relnamespace WHERE namespace.nspname='public' AND class_row.relname IN('device_gateways','nvr_connections','cameras','device_configuration_audit')
  UNION ALL
  SELECT 'expected_policies',count(*)=6 AND bool_and(COALESCE(policy.qual,'') !~* 'role[[:space:]]+IN' AND COALESCE(policy.with_check,'') !~* 'role[[:space:]]+IN'),
    jsonb_agg(jsonb_build_object('table',policy.tablename,'policy',policy.policyname,'command',policy.cmd,'roles',policy.roles,'using',policy.qual,'with_check',policy.with_check) ORDER BY policy.tablename,policy.policyname)
    FROM pg_catalog.pg_policies policy WHERE policy.schemaname='public' AND policy.policyname IN('nvr_connections_management_select','nvr_connections_owner_insert','nvr_connections_owner_update','nvr_connections_owner_delete','cameras_management_select','cameras_management_update')
  UNION ALL
  SELECT 'shared_helpers_and_validator',count(*)=6 AND bool_and(configuration @> ARRAY['search_path=""']::text[]) AND bool_and(NOT public_execute) AND bool_and(NOT anon_execute),
    jsonb_agg(jsonb_build_object('function',schema_name||'.'||proname,'arguments',arguments,'language',language,'owner',owner,'volatility',volatility,'strict',strict,'security_definer',security_definer,'configuration',configuration,'public_execute',public_execute,'anon_execute',anon_execute,'authenticated_execute',authenticated_execute,'service_role_execute',service_role_execute) ORDER BY proname) FROM function_evidence
  UNION ALL
  SELECT 'local_host_validator_contract',count(*)=1 AND bool_and(volatility='i') AND bool_and(strict) AND bool_and(NOT security_definer) AND bool_and(configuration @> ARRAY['search_path=""']::text[]) AND bool_and(NOT public_execute) AND bool_and(NOT anon_execute) AND bool_and(authenticated_execute) AND bool_and(service_role_execute),
    jsonb_agg(jsonb_build_object('owner',owner,'language',language,'volatility',volatility,'strict',strict,'security_definer',security_definer,'configuration',configuration,'public_execute',public_execute,'anon_execute',anon_execute,'authenticated_execute',authenticated_execute,'service_role_execute',service_role_execute)) FROM function_evidence WHERE proname='is_valid_camera_local_host'
  UNION ALL
  SELECT 'local_host_constraint',count(*)=1 AND bool_and(pg_get_constraintdef(constraint_row.oid,true) ~ 'private\.is_valid_camera_local_host\(local_host\)') AND bool_and(pg_get_constraintdef(constraint_row.oid,true) !~ 'char_length\(btrim\(local_host\)\)'),
    jsonb_agg(jsonb_build_object('name',constraint_row.conname,'definition',pg_get_constraintdef(constraint_row.oid,true),'validated',constraint_row.convalidated)) FROM pg_catalog.pg_constraint constraint_row WHERE constraint_row.conrelid=to_regclass('public.nvr_connections') AND constraint_row.conname='nvr_connections_local_host_valid'
  UNION ALL
  SELECT 'representative_host_validation',bool_and(actual=expected),jsonb_agg(jsonb_build_object('host',host,'expected',expected,'actual',actual) ORDER BY host)
    FROM (SELECT fixture.host,fixture.expected,private.is_valid_camera_local_host(fixture.host) AS actual FROM (VALUES
      ('192.168.10.124',true),('10.0.0.5',true),('172.16.1.20',true),('nvr-gateway',true),('nvr.localdomain',true),('cameras.internal.example',true),
      ('localhost',false),('localhost.',false),('nvr.localhost',false),('127.0.0.1',false),('127.12.34.56',false),('0.0.0.0',false),('0.1.2.3',false),
      ('169.254.1.20',false),('224.0.0.1',false),('239.255.255.250',false),('240.0.0.1',false),('255.255.255.255',false),('127.000.0.1',false),
      ('http://nvr.local',false),('nvr.local:80',false),('nvr.local/path',false),('user@nvr.local',false)
    ) fixture(host,expected)) evaluated
  UNION ALL
  SELECT 'explicit_camera_select_columns',NOT has_table_privilege('authenticated','public.cameras','SELECT') AND NOT EXISTS((SELECT column_name FROM actual_camera_select EXCEPT SELECT column_name FROM expected_camera_select) UNION ALL (SELECT column_name FROM expected_camera_select EXCEPT SELECT column_name FROM actual_camera_select)),
    jsonb_build_object('table_wide_select',has_table_privilege('authenticated','public.cameras','SELECT'),'actual_columns',(SELECT jsonb_agg(column_name ORDER BY column_name) FROM actual_camera_select),'expected_columns',(SELECT jsonb_agg(column_name ORDER BY column_name) FROM expected_camera_select))
  UNION ALL
  SELECT 'explicit_nvr_select_columns',NOT has_table_privilege('authenticated','public.nvr_connections','SELECT') AND NOT EXISTS((SELECT column_name FROM actual_nvr_select EXCEPT SELECT column_name FROM expected_nvr_select) UNION ALL (SELECT column_name FROM expected_nvr_select EXCEPT SELECT column_name FROM actual_nvr_select)) AND NOT has_column_privilege('authenticated','public.nvr_connections','username_secret_reference','SELECT') AND NOT has_column_privilege('authenticated','public.nvr_connections','password_secret_reference','SELECT') AND NOT has_column_privilege('authenticated','public.nvr_connections','last_error_code','SELECT'),
    jsonb_build_object('table_wide_select',has_table_privilege('authenticated','public.nvr_connections','SELECT'),'actual_columns',(SELECT jsonb_agg(column_name ORDER BY column_name) FROM actual_nvr_select),'expected_columns',(SELECT jsonb_agg(column_name ORDER BY column_name) FROM expected_nvr_select),'username_secret_reference_select',has_column_privilege('authenticated','public.nvr_connections','username_secret_reference','SELECT'),'password_secret_reference_select',has_column_privilege('authenticated','public.nvr_connections','password_secret_reference','SELECT'),'last_error_code_select',has_column_privilege('authenticated','public.nvr_connections','last_error_code','SELECT'))
  UNION ALL
  SELECT 'camera_update_columns',(SELECT COALESCE(array_agg(column_name::text ORDER BY column_name::text),ARRAY[]::text[]) FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='cameras' AND grantee='authenticated' AND privilege_type='UPDATE')=ARRAY['ai_enabled','area','department','name','task_verification_enabled']::text[],
    jsonb_build_object('actual_update_columns',(SELECT COALESCE(jsonb_agg(column_name ORDER BY column_name),'[]'::jsonb) FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='cameras' AND grantee='authenticated' AND privilege_type='UPDATE'))
  UNION ALL
  SELECT 'no_camera_events',to_regclass('public.camera_events') IS NULL,jsonb_build_object('camera_events_exists',to_regclass('public.camera_events') IS NOT NULL)
  UNION ALL
  SELECT 'no_plaintext_credential_columns',count(*)=0,jsonb_build_object('unexpected_columns',COALESCE(jsonb_agg(jsonb_build_object('table',table_name,'column',column_name) ORDER BY table_name,column_name),'[]'::jsonb)) FROM information_schema.columns WHERE table_schema='public' AND table_name IN('device_gateways','nvr_connections','cameras') AND column_name ~* '(^|_)(password|credential|secret|username)(_|$)' AND column_name !~* '_secret_reference$'
  UNION ALL
  SELECT 'foreign_keys_and_delete_restrictions',count(*)>=12 AND bool_and(constraint_row.confdeltype='r'),jsonb_agg(jsonb_build_object('table',constraint_row.conrelid::regclass::text,'name',constraint_row.conname,'definition',pg_get_constraintdef(constraint_row.oid,true),'delete_action',constraint_row.confdeltype) ORDER BY constraint_row.conrelid::regclass::text,constraint_row.conname) FROM pg_catalog.pg_constraint constraint_row WHERE constraint_row.contype='f' AND constraint_row.conrelid IN(to_regclass('public.device_gateways'),to_regclass('public.nvr_connections'),to_regclass('public.cameras'),to_regclass('public.device_configuration_audit'))
  UNION ALL
  SELECT 'duplicate_channel_constraint',count(*)=1 AND bool_and(constraint_row.contype='u') AND bool_and(constraint_row.convalidated),jsonb_agg(jsonb_build_object('name',constraint_row.conname,'definition',pg_get_constraintdef(constraint_row.oid,true),'validated',constraint_row.convalidated)) FROM pg_catalog.pg_constraint constraint_row WHERE constraint_row.conrelid=to_regclass('public.cameras') AND constraint_row.conname='cameras_nvr_channel_unique'
  UNION ALL
  SELECT 'expected_triggers',count(*)=8,jsonb_agg(jsonb_build_object('table',trigger_row.tgrelid::regclass::text,'trigger',trigger_row.tgname,'enabled',trigger_row.tgenabled,'definition',pg_get_triggerdef(trigger_row.oid,true)) ORDER BY trigger_row.tgrelid::regclass::text,trigger_row.tgname) FROM pg_catalog.pg_trigger trigger_row WHERE NOT trigger_row.tgisinternal AND trigger_row.tgname IN('device_gateways_tenant_guard','nvr_connections_tenant_guard','cameras_tenant_guard','device_gateways_updated_at','nvr_connections_updated_at','cameras_updated_at','nvr_connections_audit','cameras_audit')
  UNION ALL
  SELECT 'expected_indexes',count(*)=13 AND bool_and(index_row.indisvalid) AND bool_and(index_row.indisready),jsonb_agg(jsonb_build_object('name',index_class.relname,'table',table_class.relname,'valid',index_row.indisvalid,'ready',index_row.indisready,'unique',index_row.indisunique,'definition',pg_get_indexdef(index_row.indexrelid)) ORDER BY index_class.relname) FROM pg_catalog.pg_index index_row JOIN pg_catalog.pg_class index_class ON index_class.oid=index_row.indexrelid JOIN pg_catalog.pg_class table_class ON table_class.oid=index_row.indrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=table_class.relnamespace WHERE namespace.nspname='public' AND index_class.relname IN('device_gateways_company_idx','device_gateways_location_idx','device_gateways_status_idx','nvr_connections_company_idx','nvr_connections_location_idx','nvr_connections_gateway_idx','nvr_connections_status_idx','cameras_company_idx','cameras_location_idx','cameras_nvr_idx','cameras_status_idx','cameras_external_channel_idx','device_configuration_audit_company_created_idx')
  UNION ALL
  SELECT 'audit_shape_is_safe',(SELECT array_agg(column_name::text ORDER BY ordinal_position)::text[] FROM information_schema.columns WHERE table_schema='public' AND table_name='device_configuration_audit')=ARRAY['id','company_id','actor_profile_id','entity_type','entity_id','action','changed_fields','created_at']::text[],jsonb_build_object('columns',(SELECT jsonb_agg(jsonb_build_object('column',column_name,'type',data_type) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='device_configuration_audit'))
),
summary AS (SELECT count(*) AS check_count,count(*) FILTER(WHERE passed) AS passed_count,count(*) FILTER(WHERE NOT passed) AS failed_count,bool_and(passed) AS all_checks_pass FROM checks)
SELECT jsonb_build_object('migration','202607220014_camera_manager_foundation.sql','summary',to_jsonb(summary),'checks',(SELECT jsonb_agg(jsonb_build_object('check_name',check_name,'passed',passed,'details',details) ORDER BY check_name) FROM checks)) FROM summary;
