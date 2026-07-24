WITH functions(signature) AS (VALUES
  ('public.admit_device_agent_request(text,text,integer,integer)'),
  ('public.consume_device_pairing_request(text,uuid,text,text,text,text,text,jsonb)'),
  ('public.authenticate_device_agent_heartbeat(uuid,text,text,text,text,text,jsonb)'),
  ('public.prepare_device_gateway_repair(uuid)'),
  ('public.revoke_device_agent(uuid)')
)
SELECT jsonb_build_object(
  'ready',bool_and(to_regprocedure(signature) IS NOT NULL AND has_function_privilege('service_role',signature,'EXECUTE')=(signature NOT IN ('public.prepare_device_gateway_repair(uuid)','public.revoke_device_agent(uuid)'))),
  'mode','Run phase2a-concurrency-runner.mjs against Preview; one SQL Editor session cannot prove concurrency.',
  'functions',jsonb_agg(jsonb_build_object('signature',signature,'exists',to_regprocedure(signature) IS NOT NULL) ORDER BY signature),
  'existing_test_gateways',(SELECT count(*) FROM public.device_gateways WHERE name LIKE 'Phase2A concurrency %')
)
FROM functions;
