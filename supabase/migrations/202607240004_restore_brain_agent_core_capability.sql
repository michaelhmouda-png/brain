-- Restore required reference configuration omitted when business rows were excluded from the baseline capture.
BEGIN;

INSERT INTO public.device_capability_catalog(
  capability_code,
  protocol_version,
  risk_class,
  enabled
)
VALUES ('brain.heartbeat.v1', 1, 'core', true)
ON CONFLICT (capability_code) DO NOTHING;

COMMIT;
