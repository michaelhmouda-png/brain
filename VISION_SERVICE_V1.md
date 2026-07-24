# Vision Service v1

Vision Service v1 is Brain's shared server-side boundary for structured image observations. Camera Inspection v1 is its first consumer. The service does not contact cameras or NVRs; it accepts bytes retrieved server-side from an existing private snapshot artifact.

## Architecture

- `lib/vision/schema-registry.ts` owns versioned inspection schemas.
- `lib/vision/service.ts` owns image validation, provider-independent execution, strict result validation, duration measurement, warning normalization, and safe result/error contracts.
- `lib/vision/service.server.ts` is the server-only composition root.
- `lib/vision/providers/openai-vision.server.ts` contains all OpenAI-specific request logic.
- `lib/vision/camera-inspection.ts` owns authorization-independent application orchestration and durable success/failure behavior.
- `lib/vision/camera-inspection-infrastructure.server.ts` owns authenticated Supabase lookups, private Storage download, and service-role persistence.

Provider adapters receive transient image bytes, tenant/location context, a correlation ID, an optional bounded domain context, and the selected schema. They must return an untrusted result for validation by the shared service.

## API contract

`POST /api/cameras/inspections`

Request:

```json
{
  "snapshotId": "uuid",
  "inspectionVersion": "camera_inspection_v1"
}
```

Only these two properties are accepted. External URLs, signed URLs, storage paths, provider options, tenant identifiers, and arbitrary domain context are rejected.

Successful response:

```json
{
  "data": {
    "inspectionId": "uuid",
    "status": "succeeded",
    "inspectionVersion": "camera_inspection_v1",
    "model": "configured-model",
    "result": {},
    "warnings": [],
    "processingDurationMs": 0,
    "errorCode": null,
    "correlationId": "uuid",
    "createdAt": "timestamp",
    "completedAt": "timestamp"
  }
}
```

Failures return a normalized uppercase error code and, when a durable inspection was created, its safe metadata. Responses never include a signed URL, bucket name, storage path, credentials, provider token, raw provider output, or image bytes.

## Authorization and privacy

- The actor is resolved from the authenticated Supabase session.
- Active `manager`, `owner`, and `super_admin` profiles may request and read inspections within their persisted company.
- Employees are rejected before snapshot lookup, storage download, or provider execution.
- The existing authenticated snapshot RPC proves that the actor may access the artifact.
- The server cross-checks the artifact's company, active location, NVR, gateway, channel, MIME type, size, dimensions, readiness, and expiry before use.
- The database trigger independently binds every inspection to the same snapshot/company/location/NVR/gateway/channel and validates the creating management profile.
- Authenticated clients receive RLS-governed reads only. Inserts and terminal updates are service-role operations confined to server code.
- Storage remains private. The inspection path uses private server-side download and never creates a signed URL.
- OpenAI requests use transient data URLs, `store: false`, no automatic SDK retries, and a bounded timeout. Image bytes and provider payloads are never logged.

## Camera Inspection v1

The canonical schema and strict runtime parser live in `lib/vision/camera-inspection-v1.ts`. All objects reject extra properties. Confidence values are bounded to `0..1`; counts are non-negative bounded integers; strings and arrays have explicit limits. The parser rejects identity claims and sensitive-trait language. Unsupported conclusions must use `unknown` or `not_visible`.

Results are observations for human judgment only. Camera Inspection v1 does not create tasks, alerts, scores, attendance records, disciplinary decisions, payroll decisions, security decisions, or automation.

## Existing task-evidence vision

`lib/task-evidence-verification.server.ts` remains unchanged. It has its own task-specific queue, schema, verdict routing, retries, and human-review behavior. A later approved phase can migrate only its provider and schema execution behind Vision Service while preserving its current job lifecycle and decision rules. Vision Service v1 does not silently alter that behavior.

## Required environment variables

- `OPENAI_API_KEY`
- `OPENAI_VISION_MODEL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

No new environment values are created or changed by this implementation.

## Controlled rollout

1. Review the migration, schema, prompt, authorization boundary, and focused tests.
2. With separate approval, perform static migration validation and apply `202607250001_vision_service_camera_inspection_v1.sql` to a brand-new disposable Supabase project.
3. Recapture and compare the disposable catalog for the new table, trigger, indexes, RLS policy, ownership, and grants.
4. Run the full test, TypeScript, lint, and production-build gates against the exact release candidate.
5. Verify Production environment-variable names are present without exposing values.
6. Create a fresh logical Production backup and obtain explicit deployment approval.
7. Apply only the approved forward migration to Production, stopping on the first error.
8. Deploy the exact reviewed application commit and run authentication/Camera Manager health checks without invoking AI.
9. Obtain explicit approval for one Production inspection of one existing, unexpired private snapshot.
10. Verify the stored structured result and audit metadata. Do not create tasks, alerts, scores, or automations.
