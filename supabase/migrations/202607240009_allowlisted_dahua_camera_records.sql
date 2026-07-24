-- Allow the documented Dahua camera[] channel-list response variant.
BEGIN;

CREATE OR REPLACE FUNCTION private.valid_channel_discovery_diagnostic(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
  v_known jsonb;
BEGIN
  IF jsonb_typeof(p_value) <> 'object'
     OR NOT (p_value ?& ARRAY[
       'httpStatus','contentType','responseByteLength','responseLineCount',
       'responseFormat','sanitizedKeys','sections','repeatedChannelLikeRecords',
       'knownFields','parserBranch','safeParseFailureCode','responseTimeMs','requestId'
     ])
     OR p_value - ARRAY[
       'httpStatus','contentType','responseByteLength','responseLineCount',
       'responseFormat','sanitizedKeys','sections','repeatedChannelLikeRecords',
       'knownFields','parserBranch','safeParseFailureCode','responseTimeMs','requestId'
     ] <> '{}'::jsonb
     OR jsonb_typeof(p_value->'httpStatus') <> 'number'
     OR p_value->>'httpStatus' !~ '^[0-9]+$'
     OR (p_value->>'httpStatus')::integer NOT BETWEEN 100 AND 599
     OR p_value->>'contentType' NOT IN (
       'text/plain','application/json','text/html','application/octet-stream','unknown'
     )
     OR jsonb_typeof(p_value->'responseByteLength') <> 'number'
     OR p_value->>'responseByteLength' !~ '^[0-9]+$'
     OR (p_value->>'responseByteLength')::integer NOT BETWEEN 0 AND 1048576
     OR jsonb_typeof(p_value->'responseLineCount') <> 'number'
     OR p_value->>'responseLineCount' !~ '^[0-9]+$'
     OR (p_value->>'responseLineCount')::integer NOT BETWEEN 0 AND 1048576
     OR p_value->>'responseFormat' NOT IN (
       'key_value_lines','json','xml','html','unknown_text','binary'
     )
     OR jsonb_typeof(p_value->'sanitizedKeys') <> 'array'
     OR jsonb_array_length(p_value->'sanitizedKeys') > 64
     OR jsonb_typeof(p_value->'sections') <> 'array'
     OR jsonb_array_length(p_value->'sections') > 16
     OR jsonb_typeof(p_value->'repeatedChannelLikeRecords') <> 'number'
     OR p_value->>'repeatedChannelLikeRecords' !~ '^[0-9]+$'
     OR (p_value->>'repeatedChannelLikeRecords')::integer NOT BETWEEN 0 AND 256
     OR p_value->>'parserBranch' NOT IN (
       'result_records_v1','camera_records_v1','no_supported_records','unknown_response'
     )
     OR NOT (
       jsonb_typeof(p_value->'safeParseFailureCode') = 'null'
       OR p_value->>'safeParseFailureCode' IN (
         'NO_SUPPORTED_CHANNEL_RECORDS','UNKNOWN_CHANNEL_RESPONSE_FORMAT'
       )
     )
     OR jsonb_typeof(p_value->'responseTimeMs') <> 'number'
     OR p_value->>'responseTimeMs' !~ '^[0-9]+$'
     OR (p_value->>'responseTimeMs')::integer NOT BETWEEN 0 AND 60000
     OR p_value->>'requestId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_value->'sanitizedKeys') LOOP
    IF jsonb_typeof(v_item) <> 'string'
       OR v_item #>> '{}' !~ '^[A-Za-z][A-Za-z0-9]{0,63}$'
       OR v_item #>> '{}' ~* '(password|username|address|ip|mac|serial|url|uri|token|credential)' THEN
      RETURN false;
    END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_value->'sections') LOOP
    IF jsonb_typeof(v_item) <> 'string'
       OR v_item #>> '{}' NOT IN (
         'result[*]','camera[*]','table.All[*]','table.Channel[*]'
       ) THEN
      RETURN false;
    END IF;
  END LOOP;

  v_known := p_value->'knownFields';
  IF jsonb_typeof(v_known) <> 'object'
     OR NOT (v_known ?& ARRAY[
       'uniqueChannel','deviceName','channelName','name','enabled',
       'connectionState','state','resolution','codec'
     ])
     OR v_known - ARRAY[
       'uniqueChannel','deviceName','channelName','name','enabled',
       'connectionState','state','resolution','codec'
     ] <> '{}'::jsonb THEN
    RETURN false;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_each(v_known) LOOP
    IF jsonb_typeof(v_item) <> 'boolean' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;

ALTER FUNCTION private.valid_channel_discovery_diagnostic(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.valid_channel_discovery_diagnostic(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
