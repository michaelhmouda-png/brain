WITH expected_functions(signature, exposure, expected_definer, expected_volatility) AS (
  VALUES
    ('public.create_device_gateway(uuid,text)','authenticated',true,'v'),
    ('public.create_device_pairing_request(uuid)','authenticated',true,'v'),
    ('public.revoke_device_pairing_request(uuid)','authenticated',true,'v'),
    ('public.consume_device_pairing_request(text,uuid,text,text,text,text,text,jsonb)','service_role',true,'v'),
    ('public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb)','service_role',true,'v'),
    ('public.resolve_device_agent_rate_identity(uuid,text)','service_role',true,'v'),
    ('public.revoke_device_agent(uuid)','authenticated',true,'v'),
    ('public.prepare_device_gateway_repair(uuid)','authenticated',true,'v'),
    ('public.admit_device_agent_request(text,text,integer,integer)','service_role',true,'v'),
    ('private.valid_agent_capability_declarations(jsonb)','none',false,'i')
), trusted_owner AS (
  SELECT (
    SELECT pg_get_userbyid(p.proowner)
    FROM pg_proc p
    WHERE p.oid=to_regprocedure('private.validate_device_tenant_relationships()')
  ) AS owner
), function_state AS (
  SELECT
    e.signature,
    e.exposure,
    e.expected_definer,
    e.expected_volatility,
    p.oid IS NOT NULL AS function_exists,
    coalesce(p.prosecdef,false) AS security_definer,
    coalesce(p.provolatile::text,'') AS volatility,
    pg_get_userbyid(p.proowner) AS owner,
    trusted_owner.owner AS expected_owner,
    coalesce(array_to_string(p.proconfig,','),'') AS config,
    coalesce(has_function_privilege('anon',p.oid,'EXECUTE'),false) AS anon_execute,
    coalesce(has_function_privilege('authenticated',p.oid,'EXECUTE'),false) AS authenticated_execute,
    coalesce(has_function_privilege('service_role',p.oid,'EXECUTE'),false) AS service_execute
  FROM expected_functions e
  CROSS JOIN trusted_owner
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
), function_definitions(signature, definition) AS (
  SELECT requested.signature,coalesce(pg_get_functiondef(p.oid),'')
  FROM (VALUES
    ('public.admit_device_agent_request(text,text,integer,integer)'),
    ('public.prepare_device_gateway_repair(uuid)'),
    ('private.valid_agent_capability_declarations(jsonb)')
  ) AS requested(signature)
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(requested.signature)
), checks(check_name,passed,details) AS (
  SELECT
    'six_tables_exist',
    count(*)=6,
    jsonb_build_object('found',coalesce(jsonb_agg(c.relname ORDER BY c.relname),'[]'::jsonb))
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
    AND c.relkind='r'
    AND c.relname=ANY(ARRAY['device_pairing_requests','device_agent_credentials','device_capability_catalog','device_gateway_capabilities','device_agent_audit','device_agent_rate_limits'])

  UNION ALL
  SELECT
    'gateway_columns_and_tenant_uniqueness',
    count(*)=5,
    jsonb_build_object('objects',coalesce(jsonb_agg(object_name ORDER BY object_name),'[]'::jsonb))
  FROM (
    SELECT a.attname AS object_name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='device_gateways'
      AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname=ANY(ARRAY['platform','os_version','hostname_label','paired_at'])
    UNION ALL
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='device_gateways'
      AND con.conname='device_gateways_company_id_id_unique'
  ) objects

  UNION ALL
  SELECT
    'all_tables_forced_rls',
    count(*)=6 AND coalesce(bool_and(c.relrowsecurity AND c.relforcerowsecurity),false),
    jsonb_build_object('states',coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'enabled',c.relrowsecurity,'forced',c.relforcerowsecurity) ORDER BY c.relname),'[]'::jsonb))
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
    AND c.relname=ANY(ARRAY['device_pairing_requests','device_agent_credentials','device_capability_catalog','device_gateway_capabilities','device_agent_audit','device_agent_rate_limits'])

  UNION ALL
  SELECT
    'browser_table_grants_absent',
    count(*)=0,
    jsonb_build_object('unexpected',coalesce(jsonb_agg(jsonb_build_object('table',table_name,'role',grantee,'privilege',privilege_type) ORDER BY table_name,grantee,privilege_type),'[]'::jsonb))
  FROM information_schema.role_table_grants
  WHERE table_schema='public'
    AND table_name=ANY(ARRAY['device_pairing_requests','device_agent_credentials','device_capability_catalog','device_gateway_capabilities','device_agent_audit','device_agent_rate_limits'])
    AND grantee IN ('PUBLIC','anon','authenticated')

  UNION ALL
  SELECT
    'service_role_table_grants_select_only',
    count(*)=6 AND coalesce(bool_and(privileges=ARRAY['SELECT']::text[]),false),
    jsonb_build_object('tables',coalesce(jsonb_agg(jsonb_build_object('table',table_name,'privileges',privileges) ORDER BY table_name),'[]'::jsonb))
  FROM (
    SELECT table_name,array_agg(privilege_type::text ORDER BY privilege_type::text)::text[] AS privileges
    FROM information_schema.role_table_grants
    WHERE table_schema='public'
      AND table_name=ANY(ARRAY['device_pairing_requests','device_agent_credentials','device_capability_catalog','device_gateway_capabilities','device_agent_audit','device_agent_rate_limits'])
      AND grantee='service_role'
    GROUP BY table_name
  ) grants

  UNION ALL
  SELECT
    'phase2a_tables_have_no_browser_policies',
    count(*)=0,
    jsonb_build_object('unexpected',coalesce(jsonb_agg(policyname ORDER BY policyname),'[]'::jsonb))
  FROM pg_policies
  WHERE schemaname='public'
    AND tablename=ANY(ARRAY['device_pairing_requests','device_agent_credentials','device_capability_catalog','device_gateway_capabilities','device_agent_audit','device_agent_rate_limits'])

  UNION ALL
  SELECT
    'rpc_signatures_security_owner_search_path_grants',
    count(*)=10 AND coalesce(bool_and(
      function_exists
      AND security_definer=expected_definer
      AND volatility=expected_volatility
      AND owner IS NOT DISTINCT FROM expected_owner
      AND expected_owner IS NOT NULL
      AND config='search_path=""'
      AND NOT anon_execute
      AND authenticated_execute=(exposure='authenticated')
      AND service_execute=(exposure='service_role')
    ),false),
    jsonb_build_object('functions',coalesce(jsonb_agg(to_jsonb(function_state) ORDER BY signature),'[]'::jsonb))
  FROM function_state

  UNION ALL
  SELECT
    'active_partial_unique_indexes',
    count(*)=2 AND coalesce(bool_and(i.indisunique AND i.indisvalid AND pg_get_expr(i.indpred,i.indrelid)='(revoked_at IS NULL)'),false),
    jsonb_build_object('indexes',coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY c.relname),'[]'::jsonb))
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_index i ON i.indexrelid=c.oid
  WHERE n.nspname='public'
    AND c.relname=ANY(ARRAY['device_agent_credentials_active_gateway_unique','device_agent_credentials_active_public_agent_unique'])

  UNION ALL
  SELECT
    'capability_seed_exact',
    count(*)=1
      AND coalesce(min(capability_code)='brain.heartbeat.v1',false)
      AND coalesce(bool_and(protocol_version=1 AND risk_class='core' AND enabled),false),
    jsonb_build_object('row_count',count(*),'codes',coalesce(jsonb_agg(capability_code ORDER BY capability_code),'[]'::jsonb))
  FROM public.device_capability_catalog

  UNION ALL
  SELECT
    'no_plaintext_secret_columns',
    count(*)=0,
    jsonb_build_object(
      'unexpected',coalesce(jsonb_agg(table_name||'.'||column_name ORDER BY table_name,column_name),'[]'::jsonb),
      'allowed_metadata',jsonb_build_array('token_version','issued_at','revoked_at','last_authenticated_at'),
      'allowed_one_way_values',jsonb_build_array('credential_hash','code_hash','code_digest','identifier_hash')
    )
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name=ANY(ARRAY['device_pairing_requests','device_agent_credentials','device_capability_catalog','device_gateway_capabilities','device_agent_audit','device_agent_rate_limits'])
    AND (
      lower(column_name)=ANY(ARRAY[
        'token','plaintext_token','access_token','bearer_token',
        'credential_secret','credential_text','pairing_code','plaintext_code',
        'password','secret','authorization','authorization_header','raw_ip'
      ]::text[])
      OR lower(column_name) ~ '(^|_)(plaintext|cleartext)(_|$)'
      OR lower(column_name) ~ '(^|_)(password|secret)(_|$)'
    )

  UNION ALL
  SELECT
    'rate_limiter_atomic_upsert',
    definition<>''
      AND definition ~ 'ON CONFLICT\s*\(scope,identifier_hash\) DO UPDATE'
      AND definition ~ 'request_count=CASE WHEN limits\.window_resets_at<=v_now THEN 1 ELSE limits\.request_count\+1 END'
      AND definition ~ 'RETURNING limits\.\*'
      AND definition !~ 'FOR UPDATE',
    jsonb_build_object(
      'function_found',definition<>'',
      'atomic_upsert',definition ~ 'ON CONFLICT\s*\(scope,identifier_hash\) DO UPDATE',
      'atomic_count_transition',definition ~ 'request_count=CASE WHEN limits\.window_resets_at<=v_now THEN 1 ELSE limits\.request_count\+1 END',
      'returning_row',definition ~ 'RETURNING limits\.\*',
      'legacy_read_then_lock_absent',definition !~ 'FOR UPDATE'
    )
  FROM function_definitions
  WHERE signature='public.admit_device_agent_request(text,text,integer,integer)'

  UNION ALL
  SELECT
    'rate_limiter_cleanup_bounded',
    definition<>''
      AND strpos(definition,'substr(p_identifier_hash,1,2)=''00''')>0
      AND definition ~ 'ORDER BY candidate\.window_resets_at LIMIT 100',
    jsonb_build_object(
      'function_found',definition<>'',
      'probabilistic',strpos(definition,'substr(p_identifier_hash,1,2)=''00''')>0,
      'limit_100',definition ~ 'ORDER BY candidate\.window_resets_at LIMIT 100'
    )
  FROM function_definitions
  WHERE signature='public.admit_device_agent_request(text,text,integer,integer)'

  UNION ALL
  SELECT
    'repair_rpc_revokes_and_unpairs',
    definition<>''
      AND strpos(definition,'UPDATE public.device_agent_credentials')>0
      AND strpos(definition,'UPDATE public.device_pairing_requests')>0
      AND strpos(definition,'status=''unpaired''')>0
      AND strpos(definition,'agent.repair_prepared')>0,
    jsonb_build_object(
      'function_found',definition<>'',
      'credentials_revoked',strpos(definition,'UPDATE public.device_agent_credentials')>0,
      'pairing_requests_revoked',strpos(definition,'UPDATE public.device_pairing_requests')>0,
      'gateway_unpaired',strpos(definition,'status=''unpaired''')>0,
      'audit_recorded',strpos(definition,'agent.repair_prepared')>0
    )
  FROM function_definitions
  WHERE signature='public.prepare_device_gateway_repair(uuid)'

  UNION ALL
  SELECT
    'capability_sql_bounds',
    definition<>''
      AND strpos(definition,'jsonb_array_length(p_value) > 16')>0
      AND strpos(definition,'pg_column_size(p_value) > 2048')>0
      AND strpos(definition,'jsonb_typeof(item.value) <> ''string''')>0
      AND strpos(definition,'^[a-z][a-z0-9_.-]{2,79}$')>0,
    jsonb_build_object(
      'function_found',definition<>'',
      'maximum_16',strpos(definition,'jsonb_array_length(p_value) > 16')>0,
      'payload_bounded',strpos(definition,'pg_column_size(p_value) > 2048')>0,
      'strings_only',strpos(definition,'jsonb_typeof(item.value) <> ''string''')>0,
      'format_bounded',strpos(definition,'^[a-z][a-z0-9_.-]{2,79}$')>0
    )
  FROM function_definitions
  WHERE signature='private.valid_agent_capability_declarations(jsonb)'

  UNION ALL
  SELECT
    'unknown_capability_audit_deduplicated',
    count(*)=1
      AND coalesce(bool_and(i.indisunique AND i.indisvalid),false)
      AND coalesce(bool_and(pg_get_expr(i.indpred,i.indrelid) ~ 'capability\.unknown_declared'),false),
    jsonb_build_object(
      'index_count',count(*),
      'definitions',coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid)),'[]'::jsonb)
    )
  FROM pg_index i
  JOIN pg_class c ON c.oid=i.indexrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
    AND c.relname='device_agent_audit_unknown_capability_bucket_unique'
), normalized_checks AS (
  SELECT check_name,coalesce(passed,false) AS passed,details
  FROM checks
), summary AS (
  SELECT
    count(*) AS check_count,
    count(*) FILTER(WHERE passed) AS passed_count,
    count(*) FILTER(WHERE NOT passed) AS failed_count
  FROM normalized_checks
)
SELECT jsonb_build_object(
  'decision',CASE WHEN failed_count=0 THEN 'PASS' ELSE 'FAIL' END,
  'summary',jsonb_build_object(
    'check_count',check_count,
    'passed_count',passed_count,
    'failed_count',failed_count
  ),
  'checks',(
    SELECT jsonb_agg(
      jsonb_build_object(
        'check_name',check_name,
        'passed',passed,
        'details',details
      )
      ORDER BY check_name
    )
    FROM normalized_checks
  )
)
FROM summary;
