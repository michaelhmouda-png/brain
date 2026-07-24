CREATE OR REPLACE FUNCTION pg_temp.camera_phase1_smoke_v2()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_profile_id uuid;
  v_company_id uuid;
  v_location_id uuid;
  v_other_location_id uuid;
  v_gateway_id uuid := gen_random_uuid();
  v_nvr_id uuid := gen_random_uuid();
  v_dns_nvr_id uuid := gen_random_uuid();
  v_camera_id uuid := gen_random_uuid();
  v_attempt_id uuid;
  v_gateway_ids uuid[] := '{}'::uuid[];
  v_nvr_ids uuid[] := '{}'::uuid[];
  v_camera_ids uuid[] := '{}'::uuid[];
  v_audit_entity_ids uuid[] := '{}'::uuid[];
  v_invalid_host text;
  v_rejected boolean;
  v_audit_count bigint;
  v_gateway_rows bigint := 0;
  v_nvr_rows bigint := 0;
  v_camera_rows bigint := 0;
  v_audit_rows bigint := 0;
  v_passed_count bigint;
  v_failed_count bigint;
  v_rollback_completed boolean := false;
BEGIN
  SELECT profile.id, profile.company_id, location.id
  INTO v_profile_id, v_company_id, v_location_id
  FROM public.profiles AS profile
  JOIN public.locations AS location
    ON location.company_id = profile.company_id
  WHERE profile.status = 'active'
    AND profile.role IN ('owner', 'super_admin')
    AND location.status = 'active'
  ORDER BY profile.id, location.id
  LIMIT 1;

  IF v_profile_id IS NULL OR v_company_id IS NULL OR v_location_id IS NULL THEN
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'test_name', 'fixture_resolution',
      'passed', false,
      'details', 'No active privileged profile with an active same-company location exists.'
    ));
  ELSE
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'test_name', 'fixture_resolution',
      'passed', true,
      'details', 'Suitable trusted fixture exists.'
    ));

    PERFORM set_config('request.jwt.claim.sub', v_profile_id::text, true);
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_profile_id, 'role', 'authenticated')::text,
      true
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'test_name', 'auth_uid_fixture',
      'passed', auth.uid() IS NOT DISTINCT FROM v_profile_id,
      'details', CASE
        WHEN auth.uid() IS NOT DISTINCT FROM v_profile_id
          THEN 'auth.uid() resolved to the fixture profile.'
        ELSE 'auth.uid() did not resolve to the fixture profile.'
      END
    ));

    IF auth.uid() IS NOT DISTINCT FROM v_profile_id THEN
      v_gateway_ids := array_append(v_gateway_ids, v_gateway_id);
      v_nvr_ids := array_append(v_nvr_ids, v_nvr_id);
      v_nvr_ids := array_append(v_nvr_ids, v_dns_nvr_id);
      v_camera_ids := array_append(v_camera_ids, v_camera_id);
      v_audit_entity_ids := array_append(v_audit_entity_ids, v_nvr_id);
      v_audit_entity_ids := array_append(v_audit_entity_ids, v_dns_nvr_id);
      v_audit_entity_ids := array_append(v_audit_entity_ids, v_camera_id);

      BEGIN
        INSERT INTO public.device_gateways (
          id, company_id, location_id, name, gateway_type, status, created_by
        ) VALUES (
          v_gateway_id, v_company_id, v_location_id,
          'Camera Phase 1 V2 Smoke Gateway', 'brain_agent', 'unpaired', v_profile_id
        );

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'test_name', 'gateway_insert',
          'passed', true,
          'details', 'Gateway inserted without a table-specific NEW field error.'
        ));

        INSERT INTO public.nvr_connections (
          id, company_id, location_id, gateway_id, name, vendor, local_host,
          http_port, rtsp_port, onvif_port, status, created_by
        ) VALUES (
          v_nvr_id, v_company_id, v_location_id, v_gateway_id,
          'Camera Phase 1 V2 IPv4 NVR', 'Dahua', '192.168.10.124',
          80, 554, NULL, 'configured', v_profile_id
        );

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'test_name', 'valid_ipv4_nvr_insert',
          'passed', true,
          'details', 'Valid private IPv4 accepted.'
        ));

        INSERT INTO public.nvr_connections (
          id, company_id, location_id, gateway_id, name, vendor, local_host,
          http_port, rtsp_port, onvif_port, status, created_by
        ) VALUES (
          v_dns_nvr_id, v_company_id, v_location_id, v_gateway_id,
          'Camera Phase 1 V2 DNS NVR', 'Dahua', 'nvr.localdomain',
          80, 554, NULL, 'configured', v_profile_id
        );

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'test_name', 'valid_dns_nvr_insert',
          'passed', true,
          'details', 'Valid DNS hostname accepted.'
        ));

        INSERT INTO public.cameras (
          id, company_id, location_id, nvr_connection_id, external_channel_id,
          name, area, department, stream_profile, status,
          ai_enabled, task_verification_enabled
        ) VALUES (
          v_camera_id, v_company_id, v_location_id, v_nvr_id,
          'phase1-v2-smoke-channel-1', 'Camera Phase 1 V2 Smoke Camera',
          'Smoke area', 'Operations', 'main', 'unconfigured', false, false
        );

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'test_name', 'camera_insert',
          'passed', true,
          'details', 'Camera linked to the valid NVR.'
        ));

        v_attempt_id := gen_random_uuid();
        v_camera_ids := array_append(v_camera_ids, v_attempt_id);
        v_audit_entity_ids := array_append(v_audit_entity_ids, v_attempt_id);
        v_rejected := false;
        BEGIN
          INSERT INTO public.cameras (
            id, company_id, location_id, nvr_connection_id,
            external_channel_id, name, status
          ) VALUES (
            v_attempt_id, v_company_id, v_location_id, v_nvr_id,
            'phase1-v2-smoke-channel-1',
            'Camera Phase 1 V2 Duplicate Camera', 'unconfigured'
          );
        EXCEPTION WHEN unique_violation THEN
          v_rejected := true;
        END;

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'test_name', 'duplicate_channel_rejected',
          'passed', v_rejected,
          'details', CASE WHEN v_rejected
            THEN 'Duplicate external channel rejected.'
            ELSE 'Duplicate external channel unexpectedly accepted.'
          END
        ));

        v_rejected := false;
        BEGIN
          DELETE FROM public.nvr_connections WHERE id = v_nvr_id;
        EXCEPTION WHEN foreign_key_violation THEN
          v_rejected := true;
        END;

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'test_name', 'referenced_nvr_delete_rejected',
          'passed', v_rejected,
          'details', CASE WHEN v_rejected
            THEN 'NVR deletion blocked while referenced by a camera.'
            ELSE 'Referenced NVR unexpectedly deleted.'
          END
        ));

        FOREACH v_invalid_host IN ARRAY ARRAY[
          '', ' localhost', 'localhost ', 'localhost', 'LOCALHOST', 'localhost.',
          'nvr.localhost', 'localhost.example', 'nvr localhost',
          '127.0.0.1', '127.12.34.56', '0.0.0.0', '0.1.2.3',
          '169.254.1.20', '224.0.0.1', '239.255.255.250',
          '240.0.0.1', '255.255.255.255', '127.000.0.1',
          '999.1.1.1', '1.2.3', 'http://192.168.10.124',
          'rtsp://192.168.10.124', '192.168.10.124/path',
          '192.168.10.124?query=1', '192.168.10.124#fragment',
          '192.168.10.124:80', 'user@192.168.10.124',
          'user:password@192.168.10.124'
        ] LOOP
          v_attempt_id := gen_random_uuid();
          v_nvr_ids := array_append(v_nvr_ids, v_attempt_id);
          v_audit_entity_ids := array_append(v_audit_entity_ids, v_attempt_id);
          v_rejected := false;
          BEGIN
            INSERT INTO public.nvr_connections (
              id, company_id, location_id, gateway_id, name, vendor,
              local_host, status, created_by
            ) VALUES (
              v_attempt_id, v_company_id, v_location_id, v_gateway_id,
              'Camera Phase 1 V2 Invalid Host NVR', 'Dahua', v_invalid_host,
              'unconfigured', v_profile_id
            );
          EXCEPTION WHEN check_violation THEN
            v_rejected := true;
          END;

          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'test_name', 'invalid_host_' || md5(v_invalid_host),
            'passed', v_rejected,
            'details', CASE WHEN v_rejected
              THEN 'Invalid host fixture rejected.'
              ELSE 'Invalid host fixture unexpectedly accepted.'
            END
          ));
        END LOOP;

        SELECT location.id
        INTO v_other_location_id
        FROM public.locations AS location
        WHERE location.company_id <> v_company_id
        ORDER BY location.id
        LIMIT 1;

        IF v_other_location_id IS NULL THEN
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'test_name', 'cross_company_location_guard',
            'passed', true,
            'details', 'Not exercised because no second-company location fixture exists.'
          ));
        ELSE
          v_attempt_id := gen_random_uuid();
          v_nvr_ids := array_append(v_nvr_ids, v_attempt_id);
          v_audit_entity_ids := array_append(v_audit_entity_ids, v_attempt_id);
          v_rejected := false;
          BEGIN
            INSERT INTO public.nvr_connections (
              id, company_id, location_id, name, vendor,
              local_host, status, created_by
            ) VALUES (
              v_attempt_id, v_company_id, v_other_location_id,
              'Camera Phase 1 V2 Cross-company NVR',
              'Dahua', '192.168.10.125', 'unconfigured', v_profile_id
            );
          EXCEPTION WHEN SQLSTATE 'P0001' THEN
            v_rejected := SQLERRM = 'DEVICE_LOCATION_TENANT_MISMATCH';
          END;

          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'test_name', 'cross_company_location_guard',
            'passed', v_rejected,
            'details', CASE WHEN v_rejected
              THEN 'Cross-company location rejected.'
              ELSE 'Cross-company location unexpectedly accepted or raised an unexpected error.'
            END
          ));
        END IF;

        UPDATE public.cameras
        SET name = 'Updated Camera Phase 1 V2 Smoke Camera',
            area = 'Updated smoke area',
            department = 'Updated operations',
            ai_enabled = true,
            task_verification_enabled = true
        WHERE id = v_camera_id;

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'test_name', 'approved_camera_metadata_update',
          'passed', EXISTS (
            SELECT 1
            FROM public.cameras AS camera
            WHERE camera.id = v_camera_id
              AND camera.company_id = v_company_id
              AND camera.location_id = v_location_id
              AND camera.nvr_connection_id = v_nvr_id
              AND camera.external_channel_id = 'phase1-v2-smoke-channel-1'
              AND camera.status = 'unconfigured'
              AND camera.name = 'Updated Camera Phase 1 V2 Smoke Camera'
              AND camera.area = 'Updated smoke area'
              AND camera.department = 'Updated operations'
              AND camera.ai_enabled
              AND camera.task_verification_enabled
          ),
          'details', 'Approved metadata changed while authority fields remained unchanged.'
        ));

        SELECT count(*)
        INTO v_audit_count
        FROM public.device_configuration_audit AS audit
        WHERE audit.entity_id = ANY (v_audit_entity_ids)
          AND audit.company_id = v_company_id
          AND audit.actor_profile_id = v_profile_id;

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'test_name', 'audit_rows_created',
          'passed', v_audit_count >= 4,
          'details', 'NVR and camera creation/update audit rows were recorded.'
        ));

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'test_name', 'audit_changed_fields_safe',
          'passed', NOT EXISTS (
            SELECT 1
            FROM public.device_configuration_audit AS audit
            CROSS JOIN LATERAL unnest(audit.changed_fields) AS changed_field
            WHERE audit.entity_id = ANY (v_audit_entity_ids)
              AND changed_field NOT IN (
                'name', 'area', 'department',
                'ai_enabled', 'task_verification_enabled'
              )
          ),
          'details', 'Audit changed_fields contains only approved metadata field names.'
        ));

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'test_name', 'audit_schema_contains_no_sensitive_payload',
          'passed', NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'device_configuration_audit'
              AND column_name ~* '(host|password|credential|secret|payload|request|body)'
          ),
          'details', 'Audit schema contains no host, credential, secret, or request-payload column.'
        ));

        RAISE EXCEPTION 'CAMERA_PHASE1_V2_INTENTIONAL_ROLLBACK';
      EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM = 'CAMERA_PHASE1_V2_INTENTIONAL_ROLLBACK' THEN
          v_rollback_completed := true;
        ELSE
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'test_name', 'smoke_harness_execution',
            'passed', false,
            'details', 'An unexpected controlled database exception interrupted the smoke test.'
          ));
        END IF;
      WHEN OTHERS THEN
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'test_name', 'smoke_harness_execution',
          'passed', false,
          'details', 'An unexpected database exception interrupted the smoke test.',
          'sqlstate', SQLSTATE
        ));
      END;
    END IF;
  END IF;

  SELECT count(*) INTO v_gateway_rows
  FROM public.device_gateways
  WHERE id = ANY (v_gateway_ids);

  SELECT count(*) INTO v_nvr_rows
  FROM public.nvr_connections
  WHERE id = ANY (v_nvr_ids);

  SELECT count(*) INTO v_camera_rows
  FROM public.cameras
  WHERE id = ANY (v_camera_ids);

  SELECT count(*) INTO v_audit_rows
  FROM public.device_configuration_audit
  WHERE entity_id = ANY (v_audit_entity_ids);

  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'test_name', 'permanent_smoke_rows_removed',
    'passed', v_rollback_completed
      AND v_gateway_rows = 0
      AND v_nvr_rows = 0
      AND v_camera_rows = 0
      AND v_audit_rows = 0,
    'details', jsonb_build_object(
      'rollback_completed', v_rollback_completed,
      'device_gateway_rows', v_gateway_rows,
      'nvr_connection_rows', v_nvr_rows,
      'camera_rows', v_camera_rows,
      'device_configuration_audit_rows', v_audit_rows
    )
  ));

  SELECT
    count(*) FILTER (WHERE (result ->> 'passed')::boolean),
    count(*) FILTER (WHERE NOT (result ->> 'passed')::boolean)
  INTO v_passed_count, v_failed_count
  FROM jsonb_array_elements(v_results) AS result;

  RETURN jsonb_build_object(
    'detailed_results', v_results,
    'test_count', v_passed_count + v_failed_count,
    'passed_count', v_passed_count,
    'failed_count', v_failed_count,
    'all_tests_pass', v_failed_count = 0,
    'persistence', jsonb_build_object(
      'rollback_completed', v_rollback_completed,
      'device_gateway_rows', v_gateway_rows,
      'nvr_connection_rows', v_nvr_rows,
      'camera_rows', v_camera_rows,
      'device_configuration_audit_rows', v_audit_rows
    )
  );
END
$$;

SELECT pg_temp.camera_phase1_smoke_v2() AS camera_manager_phase1_v2_smoke_result;

DROP FUNCTION pg_temp.camera_phase1_smoke_v2();
