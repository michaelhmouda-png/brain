WITH
target_tables(object_name) AS (
  VALUES ('device_gateways'),('nvr_connections'),('cameras'),('device_configuration_audit')
),
target_functions(signature) AS (
  VALUES
    ('private.is_valid_camera_local_host(text)'),
    ('private.can_view_camera_manager(uuid)'),
    ('private.can_administer_camera_manager(uuid)'),
    ('private.validate_device_tenant_relationships()'),
    ('private.touch_device_updated_at()'),
    ('private.audit_device_configuration()')
),
target_indexes(object_name) AS (
  VALUES
    ('device_gateways_company_idx'),('device_gateways_location_idx'),('device_gateways_status_idx'),
    ('nvr_connections_company_idx'),('nvr_connections_location_idx'),('nvr_connections_gateway_idx'),('nvr_connections_status_idx'),
    ('cameras_company_idx'),('cameras_location_idx'),('cameras_nvr_idx'),('cameras_status_idx'),('cameras_external_channel_idx'),
    ('device_configuration_audit_company_created_idx')
),
target_triggers(object_name) AS (
  VALUES
    ('device_gateways_tenant_guard'),('nvr_connections_tenant_guard'),('cameras_tenant_guard'),
    ('device_gateways_updated_at'),('nvr_connections_updated_at'),('cameras_updated_at'),
    ('nvr_connections_audit'),('cameras_audit')
),
target_policies(object_name) AS (
  VALUES
    ('nvr_connections_management_select'),('nvr_connections_owner_insert'),
    ('nvr_connections_owner_update'),('nvr_connections_owner_delete'),
    ('cameras_management_select'),('cameras_management_update')
),
target_constraints(object_name) AS (
  VALUES ('nvr_connections_local_host_valid'),('cameras_nvr_channel_unique')
),
required_columns(table_schema,table_name,column_name,expected_type) AS (
  VALUES
    ('public','profiles','id','uuid'),('public','profiles','company_id','uuid'),
    ('public','profiles','status','text'),('public','profiles','role','text'),
    ('public','companies','id','uuid'),('public','locations','id','uuid'),
    ('public','locations','company_id','uuid'),('public','locations','status','text')
),
column_evidence AS (
  SELECT requirement.*,column_info.data_type,column_info.udt_name,column_info.is_nullable,
    column_info.data_type IS NOT NULL AS exists,
    (column_info.data_type=requirement.expected_type OR column_info.udt_name=requirement.expected_type) AS type_matches
  FROM required_columns requirement
  LEFT JOIN information_schema.columns column_info
    ON column_info.table_schema=requirement.table_schema
   AND column_info.table_name=requirement.table_name
   AND column_info.column_name=requirement.column_name
),
profile_auth_relationship AS (
  SELECT constraint_row.conname,pg_get_constraintdef(constraint_row.oid,true) AS definition
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.contype='f'
    AND constraint_row.conrelid=to_regclass('public.profiles')
    AND constraint_row.confrelid=to_regclass('auth.users')
    AND pg_get_constraintdef(constraint_row.oid,true) ~* 'FOREIGN KEY \(id\) REFERENCES auth\.users\(id\)'
),
private_helper_conventions AS (
  SELECT namespace.nspname AS schema_name,procedure.proname AS function_name,
    pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
    owner_role.rolname AS owner,procedure.prosecdef AS security_definer,
    procedure.provolatile AS volatility,procedure.proconfig AS configuration,
    EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(procedure.proacl,acldefault('f',procedure.proowner))) acl
      WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
    ) AS public_execute,
    CASE WHEN to_regrole('anon') IS NULL THEN NULL ELSE has_function_privilege('anon',procedure.oid,'EXECUTE') END AS anon_execute,
    CASE WHEN to_regrole('authenticated') IS NULL THEN NULL ELSE has_function_privilege('authenticated',procedure.oid,'EXECUTE') END AS authenticated_execute
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
  JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=procedure.proowner
  WHERE namespace.nspname='private' AND procedure.prosecdef
),
profile_role_contract AS (
  SELECT column_info.data_type,column_info.udt_name,
    COALESCE(jsonb_agg(DISTINCT pg_get_constraintdef(constraint_row.oid,true)) FILTER(WHERE constraint_row.oid IS NOT NULL),'[]'::jsonb) AS relevant_constraints,
    COALESCE((SELECT jsonb_agg(enum_row.enumlabel ORDER BY enum_row.enumsortorder)
      FROM pg_catalog.pg_type enum_type JOIN pg_catalog.pg_enum enum_row ON enum_row.enumtypid=enum_type.oid
      WHERE enum_type.typname=column_info.udt_name),'[]'::jsonb) AS enum_values
  FROM information_schema.columns column_info
  LEFT JOIN pg_catalog.pg_constraint constraint_row
    ON constraint_row.conrelid=to_regclass('public.profiles') AND constraint_row.contype='c'
   AND pg_get_constraintdef(constraint_row.oid,true) ~* 'role'
  WHERE column_info.table_schema='public' AND column_info.table_name='profiles' AND column_info.column_name='role'
  GROUP BY column_info.data_type,column_info.udt_name
),
checks(check_name,result,details) AS (
  SELECT 'target_tables_absent',CASE WHEN count(*) FILTER(WHERE to_regclass(format('public.%I',object_name)) IS NOT NULL)=0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('objects',jsonb_agg(jsonb_build_object('name',object_name,'exists',to_regclass(format('public.%I',object_name)) IS NOT NULL) ORDER BY object_name)) FROM target_tables
  UNION ALL
  SELECT 'target_functions_absent',CASE WHEN count(*) FILTER(WHERE to_regprocedure(signature) IS NOT NULL)=0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('objects',jsonb_agg(jsonb_build_object('signature',signature,'exists',to_regprocedure(signature) IS NOT NULL) ORDER BY signature)) FROM target_functions
  UNION ALL
  SELECT 'required_schemas_exist',CASE WHEN to_regnamespace('public') IS NOT NULL AND to_regnamespace('private') IS NOT NULL AND to_regnamespace('auth') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('public',to_regnamespace('public') IS NOT NULL,'private',to_regnamespace('private') IS NOT NULL,'auth',to_regnamespace('auth') IS NOT NULL)
  UNION ALL
  SELECT 'required_tables_exist',CASE WHEN to_regclass('public.companies') IS NOT NULL AND to_regclass('public.locations') IS NOT NULL AND to_regclass('public.profiles') IS NOT NULL AND to_regclass('auth.users') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('companies',to_regclass('public.companies') IS NOT NULL,'locations',to_regclass('public.locations') IS NOT NULL,'profiles',to_regclass('public.profiles') IS NOT NULL,'auth_users',to_regclass('auth.users') IS NOT NULL)
  UNION ALL
  SELECT 'required_columns_and_types',CASE WHEN bool_and(exists AND type_matches) THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('columns',jsonb_agg(jsonb_build_object('table',table_schema||'.'||table_name,'column',column_name,'expected_type',expected_type,'actual_type',COALESCE(data_type,udt_name),'exists',exists,'type_matches',COALESCE(type_matches,false)) ORDER BY table_schema,table_name,column_name)) FROM column_evidence
  UNION ALL
  SELECT 'profiles_id_auth_users_relationship',CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('matching_relationship_count',count(*),'relationships',COALESCE(jsonb_agg(jsonb_build_object('name',conname,'definition',definition)) FILTER(WHERE conname IS NOT NULL),'[]'::jsonb)) FROM profile_auth_relationship
  UNION ALL
  SELECT 'required_database_roles',CASE WHEN to_regrole('anon') IS NOT NULL AND to_regrole('authenticated') IS NOT NULL AND to_regrole('service_role') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('anon',to_regrole('anon') IS NOT NULL,'authenticated',to_regrole('authenticated') IS NOT NULL,'service_role',to_regrole('service_role') IS NOT NULL)
  UNION ALL
  SELECT 'profile_role_contract',CASE WHEN data_type IS NULL THEN 'FAIL' WHEN (relevant_constraints::text ~* 'manager' AND relevant_constraints::text ~* 'owner' AND relevant_constraints::text ~* 'super_admin') OR (enum_values ? 'manager' AND enum_values ? 'owner' AND enum_values ? 'super_admin') THEN 'PASS' ELSE 'REVIEW' END,
    jsonb_build_object('column_type',data_type,'udt_name',udt_name,'constraints',relevant_constraints,'enum_values',enum_values,'current_grouped_values',(SELECT COALESCE(jsonb_agg(jsonb_build_object('role',grouped.role,'count',grouped.role_count) ORDER BY grouped.role),'[]'::jsonb) FROM (SELECT profile.role::text AS role,count(*) AS role_count FROM public.profiles profile GROUP BY profile.role::text) grouped)) FROM profile_role_contract
  UNION ALL
  SELECT 'required_functions_exist',CASE WHEN to_regprocedure('auth.uid()') IS NOT NULL AND to_regprocedure('gen_random_uuid()') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('auth_uid',to_regprocedure('auth.uid()') IS NOT NULL,'gen_random_uuid',to_regprocedure('gen_random_uuid()') IS NOT NULL)
  UNION ALL
  SELECT 'index_names_unused',CASE WHEN count(*) FILTER(WHERE to_regclass(format('public.%I',object_name)) IS NOT NULL)=0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('conflicts',COALESCE(jsonb_agg(object_name ORDER BY object_name) FILTER(WHERE to_regclass(format('public.%I',object_name)) IS NOT NULL),'[]'::jsonb)) FROM target_indexes
  UNION ALL
  SELECT 'trigger_names_unused',CASE WHEN count(trigger_row.oid)=0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('conflicts',COALESCE(jsonb_agg(jsonb_build_object('name',trigger_row.tgname,'table',trigger_row.tgrelid::regclass::text) ORDER BY trigger_row.tgname) FILTER(WHERE trigger_row.oid IS NOT NULL),'[]'::jsonb))
    FROM target_triggers LEFT JOIN pg_catalog.pg_trigger trigger_row ON trigger_row.tgname=target_triggers.object_name AND NOT trigger_row.tgisinternal
  UNION ALL
  SELECT 'policy_names_unused',CASE WHEN count(policy_row.policyname)=0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('conflicts',COALESCE(jsonb_agg(jsonb_build_object('name',policy_row.policyname,'schema',policy_row.schemaname,'table',policy_row.tablename) ORDER BY policy_row.policyname) FILTER(WHERE policy_row.policyname IS NOT NULL),'[]'::jsonb))
    FROM target_policies LEFT JOIN pg_catalog.pg_policies policy_row ON policy_row.policyname=target_policies.object_name
  UNION ALL
  SELECT 'constraint_names_unused',CASE WHEN count(constraint_row.oid)=0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('conflicts',COALESCE(jsonb_agg(jsonb_build_object('name',constraint_row.conname,'relation',constraint_row.conrelid::regclass::text) ORDER BY constraint_row.conname) FILTER(WHERE constraint_row.oid IS NOT NULL),'[]'::jsonb))
    FROM target_constraints LEFT JOIN pg_catalog.pg_constraint constraint_row ON constraint_row.conname=target_constraints.object_name
  UNION ALL
  SELECT 'target_grants_absent',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('grant_count',count(*),'grants',COALESCE(jsonb_agg(jsonb_build_object('schema',grant_row.table_schema,'table',grant_row.table_name,'grantee',grant_row.grantee,'privilege',grant_row.privilege_type) ORDER BY grant_row.table_name,grant_row.grantee,grant_row.privilege_type),'[]'::jsonb))
    FROM information_schema.role_table_grants grant_row WHERE grant_row.table_schema='public' AND grant_row.table_name IN('device_gateways','nvr_connections','cameras','device_configuration_audit')
  UNION ALL
  SELECT 'existing_private_helper_conventions',CASE WHEN count(*)>0 THEN 'PASS' ELSE 'REVIEW' END,
    jsonb_build_object('helper_count',count(*),'helpers',COALESCE(jsonb_agg(jsonb_build_object('function',schema_name||'.'||function_name,'arguments',identity_arguments,'owner',owner,'security_definer',security_definer,'volatility',volatility,'configuration',configuration,'public_execute',public_execute,'anon_execute',anon_execute,'authenticated_execute',authenticated_execute) ORDER BY function_name,identity_arguments),'[]'::jsonb)) FROM private_helper_conventions
  UNION ALL
  SELECT 'migration_dependencies_available',CASE WHEN to_regnamespace('private') IS NOT NULL AND to_regclass('public.companies') IS NOT NULL AND to_regclass('public.locations') IS NOT NULL AND to_regclass('public.profiles') IS NOT NULL AND to_regclass('auth.users') IS NOT NULL AND to_regprocedure('auth.uid()') IS NOT NULL AND to_regprocedure('gen_random_uuid()') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('depends_on_pending_local_012_or_013',false,'note','Migration 014 references only established base objects and functions.')
),
summary AS (
  SELECT count(*) AS check_count,count(*) FILTER(WHERE result='PASS') AS passed_count,count(*) FILTER(WHERE result='FAIL') AS failed_count,count(*) FILTER(WHERE result='REVIEW') AS review_count,bool_and(result<>'FAIL') AS no_failed_checks FROM checks
)
SELECT jsonb_build_object(
  'migration','202607220014_camera_manager_foundation.sql',
  'summary',to_jsonb(summary),
  'checks',(SELECT jsonb_agg(jsonb_build_object('check_name',check_name,'result',result,'details',details) ORDER BY check_name) FROM checks),
  'go_no_go',CASE WHEN summary.failed_count>0 THEN 'NO-GO' WHEN summary.review_count>0 THEN 'REVIEW' ELSE 'GO' END
) FROM summary;
