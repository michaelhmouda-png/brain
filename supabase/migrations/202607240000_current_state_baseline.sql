/*
 * Phase B2 current-state Production baseline.
 *
 * STAGED, NON-EXECUTABLE LOCATION: this file is intentionally outside
 * supabase/migrations until B3 validation and explicit adoption approval.
 *
 * Target: an empty fresh Supabase database only.
 * Never apply this object-creating baseline to the existing Production database.
 *
 * Authoritative B0 SHA-256: 51ace3fcb4cac1b84380ce83c89ad86847e13499feecd7c01017b38f154d86dc
 * Authoritative B1 SHA-256: bb16865d4ba9b2695b3aae5feb0ae38a144873c98809884c63190a494b68b188
 *
 * Cron scheduling is intentionally excluded and documented separately.
 * Historical migration versions are not reconstructed or marked.
 */

BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL check_function_bodies = off;

-- Required managed extension schemas and captured application schemas.
CREATE SCHEMA IF NOT EXISTS "extensions";
CREATE SCHEMA IF NOT EXISTS "vault";
CREATE SCHEMA IF NOT EXISTS "private" AUTHORIZATION "postgres";
ALTER SCHEMA "private" OWNER TO "postgres";
ALTER SCHEMA "public" OWNER TO "pg_database_owner";

-- Required captured extensions.
CREATE EXTENSION IF NOT EXISTS "pg_cron" VERSION '1.6.4';
CREATE EXTENSION IF NOT EXISTS "pg_net" VERSION '0.20.4';
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions" VERSION '1.11';
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions" VERSION '1.3';
CREATE EXTENSION IF NOT EXISTS "plpgsql" VERSION '1.0';
CREATE EXTENSION IF NOT EXISTS "supabase_vault" VERSION '0.3.1';
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions" VERSION '1.1';

-- Captured tables and columns. Constraints are added after all tables exist.
CREATE TABLE "public"."activity_timeline" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "action_by_id" uuid NOT NULL,
  "action_type" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "entity_name" text,
  "details" jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "public"."activity_timeline" OWNER TO "postgres";

CREATE TABLE "public"."announcement_acknowledgments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "announcement_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "acknowledged_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "public"."announcement_acknowledgments" OWNER TO "postgres";

CREATE TABLE "public"."announcements" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "priority" text DEFAULT 'normal'::text,
  "created_by_id" uuid NOT NULL,
  "published_at" timestamp with time zone DEFAULT now(),
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "target_roles" text[] DEFAULT '{}'::text[] NOT NULL
);
ALTER TABLE "public"."announcements" OWNER TO "postgres";

CREATE TABLE "public"."attendance_records" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "shift_date" date NOT NULL,
  "clock_in_time" timestamp with time zone,
  "clock_out_time" timestamp with time zone,
  "notes" text,
  "location" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "public"."attendance_records" OWNER TO "postgres";

CREATE TABLE "public"."brain_action_proposals" (
  "id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "canonical_action" text NOT NULL,
  "canonical_payload" jsonb NOT NULL,
  "payload_hash" text NOT NULL,
  "schema_version" integer NOT NULL,
  "risk" text NOT NULL,
  "required_role" text,
  "safe_preview" jsonb NOT NULL,
  "status" text NOT NULL,
  "correlation_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "execution_started_at" timestamp with time zone,
  "executed_at" timestamp with time zone,
  "rejected_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "safe_result" text,
  "safe_error_code" text
);
ALTER TABLE "public"."brain_action_proposals" OWNER TO "postgres";

CREATE TABLE "public"."brain_chat_user_quotas" (
  "user_id" uuid NOT NULL,
  "request_count" integer NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "window_resets_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
ALTER TABLE "public"."brain_chat_user_quotas" OWNER TO "postgres";

CREATE TABLE "public"."brain_domain_events" (
  "id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "schema_version" integer NOT NULL,
  "company_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "command_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,
  "causation_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "public"."brain_domain_events" OWNER TO "postgres";

CREATE TABLE "public"."brain_event_outbox" (
  "id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "schema_version" integer NOT NULL,
  "company_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "command_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,
  "causation_id" uuid NOT NULL,
  "proposal_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "delivery_status" text DEFAULT 'pending'::text NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "delivered_at" timestamp with time zone,
  "last_safe_error_code" text
);
ALTER TABLE "public"."brain_event_outbox" OWNER TO "postgres";

CREATE TABLE "public"."cameras" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "nvr_connection_id" uuid NOT NULL,
  "external_channel_id" text NOT NULL,
  "name" text NOT NULL,
  "area" text,
  "department" text,
  "stream_profile" text,
  "status" text DEFAULT 'unconfigured'::text NOT NULL,
  "ai_enabled" boolean DEFAULT false NOT NULL,
  "task_verification_enabled" boolean DEFAULT false NOT NULL,
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."cameras" OWNER TO "postgres";

CREATE TABLE "public"."companies" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "logo_url" text,
  "industry" text NOT NULL,
  "country" text NOT NULL,
  "currency" text NOT NULL,
  "timezone" text NOT NULL,
  "locations" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "public"."companies" OWNER TO "postgres";

CREATE TABLE "public"."d1_employee_migration_checkpoints" (
  "migration_name" text NOT NULL,
  "baseline_version" integer NOT NULL,
  "catalog_fingerprint" text NOT NULL,
  "aggregate_counts" jsonb NOT NULL,
  "approval_reference" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."d1_employee_migration_checkpoints" OWNER TO "postgres";

CREATE TABLE "public"."departments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "location_id" uuid,
  "name" text NOT NULL,
  "description" text,
  "manager_employee_id" uuid,
  "status" text DEFAULT 'active'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "public"."departments" OWNER TO "postgres";

CREATE TABLE "public"."device_agent_audit" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "gateway_id" uuid NOT NULL,
  "actor_profile_id" uuid,
  "event_type" text NOT NULL,
  "outcome_code" text NOT NULL,
  "event_bucket" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."device_agent_audit" OWNER TO "postgres";

CREATE TABLE "public"."device_agent_credentials" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gateway_id" uuid NOT NULL,
  "public_agent_id" uuid NOT NULL,
  "credential_hash" text NOT NULL,
  "token_version" integer DEFAULT 1 NOT NULL,
  "issued_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" uuid,
  "last_authenticated_at" timestamp with time zone
);
ALTER TABLE "public"."device_agent_credentials" OWNER TO "postgres";

CREATE TABLE "public"."device_agent_rate_limits" (
  "scope" text NOT NULL,
  "identifier_hash" text NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "window_resets_at" timestamp with time zone NOT NULL,
  "request_count" integer NOT NULL
);
ALTER TABLE "public"."device_agent_rate_limits" OWNER TO "postgres";

CREATE TABLE "public"."device_capability_catalog" (
  "capability_code" text NOT NULL,
  "protocol_version" integer NOT NULL,
  "risk_class" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."device_capability_catalog" OWNER TO "postgres";

CREATE TABLE "public"."device_configuration_audit" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "actor_profile_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "action" text NOT NULL,
  "changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."device_configuration_audit" OWNER TO "postgres";

CREATE TABLE "public"."device_gateway_capabilities" (
  "gateway_id" uuid NOT NULL,
  "capability_code" text NOT NULL,
  "declared_version" integer NOT NULL,
  "approved" boolean DEFAULT false NOT NULL,
  "granted_by" uuid,
  "granted_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "last_declared_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."device_gateway_capabilities" OWNER TO "postgres";

CREATE TABLE "public"."device_gateways" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "location_id" uuid,
  "name" text NOT NULL,
  "gateway_type" text NOT NULL,
  "status" text DEFAULT 'unpaired'::text NOT NULL,
  "last_seen_at" timestamp with time zone,
  "agent_version" text,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "platform" text,
  "os_version" text,
  "hostname_label" text,
  "paired_at" timestamp with time zone
);
ALTER TABLE "public"."device_gateways" OWNER TO "postgres";

CREATE TABLE "public"."device_pairing_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "gateway_id" uuid NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "revoked_at" timestamp with time zone
);
ALTER TABLE "public"."device_pairing_requests" OWNER TO "postgres";

CREATE TABLE "public"."employee_migration_exceptions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "field_name" text NOT NULL,
  "source_value_hash" text NOT NULL,
  "resolution_status" text DEFAULT 'pending'::text NOT NULL,
  "approved_canonical_value" text,
  "reviewed_by_profile_id" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."employee_migration_exceptions" OWNER TO "postgres";

CREATE TABLE "public"."employees" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "location_id" uuid,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "role" text NOT NULL,
  "department" text NOT NULL,
  "phone" text,
  "email" text,
  "employment_type" text DEFAULT 'full-time'::text NOT NULL,
  "salary" numeric DEFAULT 0,
  "hire_date" date,
  "status" text DEFAULT 'active'::text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "department_id" uuid,
  "employee_number" text,
  "lifecycle_status" text,
  "version" bigint DEFAULT 1 NOT NULL,
  "lifecycle_effective_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "archived_by_profile_id" uuid,
  "termination_reason_code" text
);
ALTER TABLE "public"."employees" OWNER TO "postgres";

CREATE TABLE "public"."incident_reports" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "incident_type" text,
  "severity" text DEFAULT 'medium'::text,
  "incident_time" timestamp with time zone NOT NULL,
  "reported_by_id" uuid NOT NULL,
  "status" text DEFAULT 'open'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "location_id" uuid,
  "affected_area" text
);
ALTER TABLE "public"."incident_reports" OWNER TO "postgres";

CREATE TABLE "public"."locations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "country" text NOT NULL,
  "city" text NOT NULL,
  "address" text,
  "timezone" text NOT NULL,
  "phone" text,
  "email" text,
  "capacity" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "public"."locations" OWNER TO "postgres";

CREATE TABLE "public"."maintenance_tickets" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "priority" text DEFAULT 'medium'::text,
  "assigned_to_id" uuid,
  "due_date" date,
  "status" text DEFAULT 'open'::text,
  "created_by_id" uuid NOT NULL,
  "completed_at" timestamp with time zone,
  "completion_notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "location_id" uuid
);
ALTER TABLE "public"."maintenance_tickets" OWNER TO "postgres";

CREATE TABLE "public"."notification_audit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "company_id" uuid NOT NULL,
  "notification_id" uuid,
  "profile_id" uuid,
  "event_type" text NOT NULL,
  "safe_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."notification_audit" OWNER TO "postgres";

CREATE TABLE "public"."notification_delivery_jobs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "notification_id" uuid NOT NULL,
  "subscription_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "last_failure_code" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "delivered_at" timestamp with time zone
);
ALTER TABLE "public"."notification_delivery_jobs" OWNER TO "postgres";

CREATE TABLE "public"."notification_outbox" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "event_key" text NOT NULL,
  "event_type" text NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "actor_profile_id" uuid,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "last_failure_code" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "completed_at" timestamp with time zone
);
ALTER TABLE "public"."notification_outbox" OWNER TO "postgres";

CREATE TABLE "public"."notification_preferences" (
  "profile_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "in_app_enabled" boolean DEFAULT true NOT NULL,
  "push_enabled" boolean DEFAULT false NOT NULL,
  "task_assignments" boolean DEFAULT true NOT NULL,
  "task_updates" boolean DEFAULT true NOT NULL,
  "due_reminders" boolean DEFAULT true NOT NULL,
  "announcements" boolean DEFAULT true NOT NULL,
  "maintenance" boolean DEFAULT true NOT NULL,
  "incidents" boolean DEFAULT true NOT NULL,
  "evidence_review" boolean DEFAULT true NOT NULL,
  "quiet_hours_enabled" boolean DEFAULT false NOT NULL,
  "quiet_hours_start" time without time zone,
  "quiet_hours_end" time without time zone,
  "timezone" text DEFAULT 'UTC'::text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";

CREATE TABLE "public"."notifications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "recipient_id" uuid NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "notification_type" text NOT NULL,
  "related_entity_type" text,
  "related_entity_id" uuid,
  "is_read" boolean DEFAULT false,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "status" text DEFAULT 'unread'::text NOT NULL,
  "category" text DEFAULT 'system'::text NOT NULL,
  "route" text DEFAULT '/dashboard'::text NOT NULL,
  "event_key" text,
  "archived_at" timestamp with time zone
);
ALTER TABLE "public"."notifications" OWNER TO "postgres";

CREATE TABLE "public"."nvr_connections" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "gateway_id" uuid,
  "name" text NOT NULL,
  "vendor" text NOT NULL,
  "local_host" text NOT NULL,
  "http_port" integer,
  "rtsp_port" integer,
  "onvif_port" integer,
  "username_secret_reference" text,
  "password_secret_reference" text,
  "status" text DEFAULT 'unconfigured'::text NOT NULL,
  "last_tested_at" timestamp with time zone,
  "last_error_code" text,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."nvr_connections" OWNER TO "postgres";

CREATE TABLE "public"."open_shifts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "shift_template_id" uuid NOT NULL,
  "shift_date" date NOT NULL,
  "quantity" integer DEFAULT 1,
  "filled_by_employee_id" uuid,
  "status" text DEFAULT 'open'::text,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "public"."open_shifts" OWNER TO "postgres";

CREATE TABLE "public"."profiles" (
  "id" uuid NOT NULL,
  "company_id" uuid,
  "employee_id" uuid,
  "full_name" text,
  "role" text DEFAULT 'employee'::text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "preferred_language" text DEFAULT 'en'::text NOT NULL
);
ALTER TABLE "public"."profiles" OWNER TO "postgres";

CREATE TABLE "public"."push_subscriptions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth_key" text NOT NULL,
  "user_agent_family" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "revoked_at" timestamp with time zone
);
ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";

CREATE TABLE "public"."recurring_shifts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "shift_template_id" uuid NOT NULL,
  "day_of_week" integer NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "public"."recurring_shifts" OWNER TO "postgres";

CREATE TABLE "public"."roles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "permissions" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "public"."roles" OWNER TO "postgres";

CREATE TABLE "public"."shift_swaps" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "requestor_id" uuid NOT NULL,
  "target_employee_id" uuid NOT NULL,
  "requestor_shift_date" date NOT NULL,
  "target_shift_date" date NOT NULL,
  "status" text DEFAULT 'pending'::text,
  "approved_by_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "public"."shift_swaps" OWNER TO "postgres";

CREATE TABLE "public"."shift_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "start_time" time without time zone NOT NULL,
  "end_time" time without time zone NOT NULL,
  "break_minutes" integer DEFAULT 0,
  "department_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by_id" uuid
);
ALTER TABLE "public"."shift_templates" OWNER TO "postgres";

CREATE TABLE "public"."shifts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "shift_date" date NOT NULL,
  "start_time" time without time zone NOT NULL,
  "end_time" time without time zone NOT NULL,
  "shift_type" text DEFAULT 'custom'::text,
  "department_id" uuid,
  "notes" text,
  "status" text DEFAULT 'scheduled'::text,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "public"."shifts" OWNER TO "postgres";

CREATE TABLE "public"."task_evidence" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "location_id" uuid,
  "submitted_by_profile_id" uuid NOT NULL,
  "submitted_by_employee_id" uuid,
  "source_type" text NOT NULL,
  "status" text DEFAULT 'pending_upload'::text NOT NULL,
  "original_storage_path" text NOT NULL,
  "original_mime_type" text NOT NULL,
  "original_size_bytes" bigint NOT NULL,
  "original_sha256" text NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "uploaded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."task_evidence" OWNER TO "postgres";

CREATE TABLE "public"."task_evidence_audit" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "evidence_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "actor_profile_id" uuid,
  "event_type" text NOT NULL,
  "safe_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "actor_type" text DEFAULT 'human'::text NOT NULL
);
ALTER TABLE "public"."task_evidence_audit" OWNER TO "postgres";

CREATE TABLE "public"."task_evidence_derivatives" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "evidence_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "derivative_type" text NOT NULL,
  "storage_path" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" text NOT NULL,
  "source_sha256" text NOT NULL,
  "generator" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."task_evidence_derivatives" OWNER TO "postgres";

CREATE TABLE "public"."task_evidence_reviews" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "evidence_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "reviewer_profile_id" uuid NOT NULL,
  "decision" text NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."task_evidence_reviews" OWNER TO "postgres";

CREATE TABLE "public"."task_evidence_verification_attempts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "evidence_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "attempt_number" integer NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "provider" text DEFAULT 'openai'::text NOT NULL,
  "model_name" text NOT NULL,
  "model_version" text,
  "status" text NOT NULL,
  "verdict" text,
  "confidence" numeric(4,3),
  "explanation" text,
  "reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "visible_observations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "uncertainty_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "usage_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "failure_code" text,
  "started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "completed_at" timestamp with time zone
);
ALTER TABLE "public"."task_evidence_verification_attempts" OWNER TO "postgres";

CREATE TABLE "public"."task_evidence_verification_jobs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "evidence_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "cycle_number" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "last_failure_code" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."task_evidence_verification_jobs" OWNER TO "postgres";

CREATE TABLE "public"."task_localization_jobs" (
  "task_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "language" text NOT NULL,
  "source_hash" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "safe_failure_code" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."task_localization_jobs" OWNER TO "postgres";

CREATE TABLE "public"."task_localizations" (
  "task_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "language" text NOT NULL,
  "source_hash" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
ALTER TABLE "public"."task_localizations" OWNER TO "postgres";

CREATE TABLE "public"."tasks" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "assigned_employee_id" uuid,
  "priority" text DEFAULT 'medium'::text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "due_date" date,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "due_at" timestamp with time zone,
  "location_id" uuid
);
ALTER TABLE "public"."tasks" OWNER TO "postgres";

CREATE TABLE "public"."time_off_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "reason" text,
  "status" text DEFAULT 'pending'::text,
  "approved_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "public"."time_off_requests" OWNER TO "postgres";

CREATE TABLE "public"."weekly_schedules" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "week_start_date" date NOT NULL,
  "monday_shift_id" uuid,
  "tuesday_shift_id" uuid,
  "wednesday_shift_id" uuid,
  "thursday_shift_id" uuid,
  "friday_shift_id" uuid,
  "saturday_shift_id" uuid,
  "sunday_shift_id" uuid,
  "notes" text,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "public"."weekly_schedules" OWNER TO "postgres";

-- Exact B1 server-rendered application function definitions.
CREATE OR REPLACE FUNCTION private.audit_device_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company_id uuid; v_entity_id uuid; v_fields text[] := '{}';
BEGIN
  IF TG_OP='DELETE' THEN v_company_id:=OLD.company_id; v_entity_id:=OLD.id;
  ELSE v_company_id:=NEW.company_id; v_entity_id:=NEW.id; END IF;
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='cameras' THEN
    IF OLD.name IS DISTINCT FROM NEW.name THEN v_fields:=array_append(v_fields,'name'); END IF;
    IF OLD.area IS DISTINCT FROM NEW.area THEN v_fields:=array_append(v_fields,'area'); END IF;
    IF OLD.department IS DISTINCT FROM NEW.department THEN v_fields:=array_append(v_fields,'department'); END IF;
    IF OLD.ai_enabled IS DISTINCT FROM NEW.ai_enabled THEN v_fields:=array_append(v_fields,'ai_enabled'); END IF;
    IF OLD.task_verification_enabled IS DISTINCT FROM NEW.task_verification_enabled THEN v_fields:=array_append(v_fields,'task_verification_enabled'); END IF;
  END IF;
  INSERT INTO public.device_configuration_audit(company_id,actor_profile_id,entity_type,entity_id,action,changed_fields)
  VALUES(v_company_id,auth.uid(),CASE WHEN TG_TABLE_NAME='cameras' THEN 'camera' ELSE 'nvr_connection' END,v_entity_id,
    CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END,v_fields);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $function$;
ALTER FUNCTION "private"."audit_device_configuration"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.can_administer_camera_manager(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = auth.uid() AND profile.status = 'active'
      AND profile.company_id = p_company_id
      AND profile.role IN ('owner','super_admin')
  )
$function$;
ALTER FUNCTION "private"."can_administer_camera_manager"(p_company_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.can_manage_company(target_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND company_id = target_company_id
      AND role IN ('admin', 'super_admin')
      AND status = 'active'
  );
$function$;
ALTER FUNCTION "private"."can_manage_company"(target_company_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.can_read_task_evidence_object(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.task_evidence AS ev
    JOIN public.tasks AS t ON t.id = ev.task_id AND t.company_id = ev.company_id
    JOIN public.profiles AS pr ON pr.id = auth.uid() AND pr.status = 'active' AND pr.company_id = ev.company_id
    WHERE ev.original_storage_path = p_name
      AND (pr.role IN ('manager', 'owner', 'super_admin')
        OR (pr.role = 'employee' AND pr.employee_id IS NOT NULL
          AND (ev.submitted_by_profile_id = pr.id OR t.assigned_employee_id = pr.employee_id)))
  );
$function$;
ALTER FUNCTION "private"."can_read_task_evidence_object"(p_name text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.can_upload_task_evidence_object(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.task_evidence AS ev
    JOIN public.profiles AS pr ON pr.id = auth.uid()
    WHERE ev.original_storage_path = p_name AND ev.submitted_by_profile_id = auth.uid()
      AND ev.status IN ('pending_upload', 'upload_failed')
      AND pr.status = 'active' AND pr.company_id = ev.company_id
  );
$function$;
ALTER FUNCTION "private"."can_upload_task_evidence_object"(p_name text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.can_view_camera_manager(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = auth.uid() AND profile.status = 'active'
      AND profile.company_id = p_company_id
      AND profile.role IN ('manager','owner','super_admin')
  )
$function$;
ALTER FUNCTION "private"."can_view_camera_manager"(p_company_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.current_user_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT company_id
  FROM public.profiles
  WHERE id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$function$;
ALTER FUNCTION "private"."current_user_company_id"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.current_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select role from public.profiles where id = auth.uid();
$function$;
ALTER FUNCTION "private"."current_user_role"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.is_active_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'active'
  );
$function$;
ALTER FUNCTION "private"."is_active_user"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
      AND status = 'active'
  );
$function$;
ALTER FUNCTION "private"."is_super_admin"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.is_valid_camera_local_host(p_value text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
DECLARE
  v_host text;
  v_labels text[];
  v_label text;
  v_parts text[];
  v_part text;
  v_octets integer[] := '{}';
BEGIN
  IF p_value = '' OR length(p_value) > 253 OR p_value IS DISTINCT FROM btrim(p_value)
     OR p_value ~ '[[:space:]]'
     OR position(':' IN p_value) > 0 OR position('/' IN p_value) > 0
     OR position('@' IN p_value) > 0 OR position('?' IN p_value) > 0
     OR position('#' IN p_value) > 0 OR position(E'\\' IN p_value) > 0 THEN
    RETURN false;
  END IF;

  v_host := lower(p_value);
  IF v_host ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' THEN
    v_parts := string_to_array(v_host, '.');
    FOREACH v_part IN ARRAY v_parts LOOP
      IF (length(v_part) > 1 AND left(v_part, 1) = '0') OR v_part::integer > 255 THEN
        RETURN false;
      END IF;
      v_octets := array_append(v_octets, v_part::integer);
    END LOOP;
    IF v_octets[1] IN (0, 127)
       OR (v_octets[1] = 169 AND v_octets[2] = 254)
       OR v_octets[1] >= 224
       OR v_octets = ARRAY[255,255,255,255] THEN
      RETURN false;
    END IF;
    RETURN true;
  END IF;

  -- Numeric dotted input that is not one canonical IPv4 address must never be
  -- reinterpreted as a DNS hostname.
  IF v_host ~ '^[0-9.]+$' THEN RETURN false; END IF;
  IF right(v_host, 1) = '.' THEN v_host := left(v_host, length(v_host) - 1); END IF;
  IF v_host = '' THEN RETURN false; END IF;

  v_labels := string_to_array(v_host, '.');
  FOREACH v_label IN ARRAY v_labels LOOP
    IF v_label = 'localhost' OR length(v_label) NOT BETWEEN 1 AND 63
       OR v_label !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $function$;
ALTER FUNCTION "private"."is_valid_camera_local_host"(p_value text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.queue_notification_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_type text;v_key text;v_actor uuid;v_company uuid;v_id uuid;
BEGIN
 v_company:=NEW.company_id;v_id:=NEW.id;
 IF TG_TABLE_NAME='tasks' THEN
  IF TG_OP='INSERT' AND NEW.assigned_employee_id IS NOT NULL THEN v_type:='task.assigned';
  ELSIF TG_OP='UPDATE' AND NEW.assigned_employee_id IS DISTINCT FROM OLD.assigned_employee_id THEN v_type:='task.reassigned';
  ELSIF TG_OP='UPDATE' AND NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status THEN v_type:='task.completed';
  ELSIF TG_OP='UPDATE' AND (NEW.title,NEW.description,NEW.priority,NEW.due_date,NEW.status) IS DISTINCT FROM (OLD.title,OLD.description,OLD.priority,OLD.due_date,OLD.status) THEN v_type:='task.updated'; END IF;
  v_actor:=NEW.created_by;
 ELSIF TG_TABLE_NAME='announcements' AND TG_OP='INSERT' THEN v_type:='announcement.published';v_actor:=NEW.created_by_id;
 ELSIF TG_TABLE_NAME='maintenance_tickets' THEN
  IF TG_OP='INSERT' AND NEW.priority IN('high','critical') THEN v_type:='maintenance.urgent_created';
  ELSIF TG_OP='UPDATE' AND NEW.assigned_to_id IS DISTINCT FROM OLD.assigned_to_id THEN v_type:='maintenance.assigned';
  ELSIF TG_OP='UPDATE' AND (NEW.priority,NEW.status) IS DISTINCT FROM (OLD.priority,OLD.status) THEN v_type:='maintenance.updated'; END IF;v_actor:=NEW.created_by_id;
 ELSIF TG_TABLE_NAME='incident_reports' THEN
  IF TG_OP='INSERT' THEN v_type:='incident.reported';
  ELSIF (NEW.severity,NEW.status) IS DISTINCT FROM (OLD.severity,OLD.status) THEN v_type:='incident.updated'; END IF;v_actor:=NEW.reported_by_id;
 ELSIF TG_TABLE_NAME='task_evidence' AND TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
  IF NEW.status='pending_review' THEN v_type:='evidence.submitted';
  ELSIF NEW.status='needs_human_review' THEN v_type:='evidence.needs_human_review';
  ELSIF NEW.status='verification_failed' THEN v_type:='evidence.verification_failed';
  ELSIF NEW.status='human_approved' THEN v_type:='evidence.human_approved';
  ELSIF NEW.status='human_rejected' THEN v_type:='evidence.human_rejected'; END IF;v_actor:=NEW.submitted_by_profile_id;
 ELSIF TG_TABLE_NAME='profiles' AND NEW.company_id IS NOT NULL AND NEW.status='active' AND TG_OP='INSERT' THEN
  v_type:='system.account_ready';v_actor:=NEW.id;
 ELSIF TG_TABLE_NAME='profiles' AND NEW.company_id IS NOT NULL AND NEW.status='active' AND TG_OP='UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
  v_type:='system.account_ready';v_actor:=NEW.id;
 END IF;
 IF v_type IS NULL THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='task_evidence' THEN v_key:=v_type||':'||v_id::text||':'||NEW.status;
 ELSIF TG_TABLE_NAME='profiles' THEN v_key:=v_type||':'||v_id::text||':'||NEW.status;
 ELSE v_key:=v_type||':'||v_id::text||':'||coalesce(NEW.updated_at::text,NEW.created_at::text);END IF;
 INSERT INTO public.notification_outbox(company_id,event_key,event_type,aggregate_type,aggregate_id,actor_profile_id)
 VALUES(v_company,v_key,v_type,TG_TABLE_NAME,v_id,v_actor) ON CONFLICT(company_id,event_key) DO NOTHING;
 INSERT INTO public.notification_audit(company_id,event_type,safe_details) VALUES(v_company,'obligation.created',jsonb_build_object('eventType',v_type));
 RETURN NEW;
END $function$;
ALTER FUNCTION "private"."queue_notification_event"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.touch_device_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $function$;
ALTER FUNCTION "private"."touch_device_updated_at"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.valid_agent_capability_declarations(p_value jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN jsonb_typeof(p_value) <> 'array' THEN false
    WHEN jsonb_array_length(p_value) > 16 OR pg_column_size(p_value) > 2048 THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_value) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'string'
         OR (item.value #>> '{}') !~ '^[a-z][a-z0-9_.-]{2,79}$'
    )
  END
$function$;
ALTER FUNCTION "private"."valid_agent_capability_declarations"(p_value jsonb) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION private.validate_device_tenant_relationships()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'device_gateways' THEN
    IF NEW.location_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.locations AS location
      WHERE location.id = NEW.location_id AND location.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'DEVICE_LOCATION_TENANT_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'nvr_connections' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.locations AS location
      WHERE location.id = NEW.location_id AND location.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'DEVICE_LOCATION_TENANT_MISMATCH';
    END IF;
    IF NEW.gateway_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.device_gateways AS gateway
      WHERE gateway.id = NEW.gateway_id
        AND gateway.company_id = NEW.company_id
        AND (gateway.location_id IS NULL OR gateway.location_id = NEW.location_id)
    ) THEN
      RAISE EXCEPTION 'NVR_GATEWAY_TENANT_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'cameras' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.locations AS location
      WHERE location.id = NEW.location_id AND location.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'DEVICE_LOCATION_TENANT_MISMATCH';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.nvr_connections AS nvr
      WHERE nvr.id = NEW.nvr_connection_id
        AND nvr.company_id = NEW.company_id
        AND nvr.location_id = NEW.location_id
    ) THEN
      RAISE EXCEPTION 'CAMERA_NVR_TENANT_MISMATCH';
    END IF;
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_DEVICE_TENANT_TRIGGER_TABLE: %', TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END
$function$;
ALTER FUNCTION "private"."validate_device_tenant_relationships"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.admit_brain_chat_request()
 RETURNS TABLE(admitted boolean, quota_limit integer, remaining integer, reset_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_row public.brain_chat_user_quotas%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  LOOP
    SELECT q.*
      INTO v_row
      FROM public.brain_chat_user_quotas AS q
     WHERE q.user_id = v_user_id
     FOR UPDATE;

    v_now := clock_timestamp();

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.brain_chat_user_quotas AS q (
          user_id, request_count, window_started_at, window_resets_at, updated_at
        ) VALUES (
          v_user_id, 1, v_now, v_now + interval '60 minutes', v_now
        )
        RETURNING q.* INTO v_row;

        RETURN QUERY SELECT true, 100, 99, v_row.window_resets_at;
        RETURN;
      EXCEPTION WHEN unique_violation THEN
        -- A parallel first request created the row. Retry and lock it.
      END;
    ELSIF v_row.window_resets_at <= v_now THEN
      UPDATE public.brain_chat_user_quotas AS q
         SET request_count = 1,
             window_started_at = v_now,
             window_resets_at = v_now + interval '60 minutes',
             updated_at = v_now
       WHERE q.user_id = v_user_id
       RETURNING q.* INTO v_row;

      RETURN QUERY SELECT true, 100, 99, v_row.window_resets_at;
      RETURN;
    ELSIF v_row.request_count >= 100 THEN
      RETURN QUERY SELECT false, 100, 0, v_row.window_resets_at;
      RETURN;
    ELSE
      UPDATE public.brain_chat_user_quotas AS q
         SET request_count = q.request_count + 1,
             updated_at = v_now
       WHERE q.user_id = v_user_id
       RETURNING q.* INTO v_row;

      RETURN QUERY SELECT true, 100, 100 - v_row.request_count, v_row.window_resets_at;
      RETURN;
    END IF;
  END LOOP;
END;
$function$;
ALTER FUNCTION "public"."admit_brain_chat_request"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.admit_device_agent_request(p_scope text, p_identifier_hash text, p_limit integer, p_window_seconds integer)
 RETURNS TABLE(admitted boolean, retry_after_seconds integer, resulting_count integer, window_resets_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_row public.device_agent_rate_limits%ROWTYPE; v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_scope NOT IN ('pairing','credential','heartbeat') OR p_identifier_hash !~ '^[0-9a-f]{64}$'
     OR p_limit NOT BETWEEN 1 AND 1000 OR p_window_seconds NOT BETWEEN 1 AND 3600 THEN RAISE EXCEPTION 'RATE_LIMIT_INVALID'; END IF;
  INSERT INTO public.device_agent_rate_limits AS limits(scope,identifier_hash,window_started_at,window_resets_at,request_count)
  VALUES(p_scope,p_identifier_hash,v_now,v_now+make_interval(secs=>p_window_seconds),1)
  ON CONFLICT(scope,identifier_hash) DO UPDATE SET
    window_started_at=CASE WHEN limits.window_resets_at<=v_now THEN v_now ELSE limits.window_started_at END,
    window_resets_at=CASE WHEN limits.window_resets_at<=v_now THEN v_now+make_interval(secs=>p_window_seconds) ELSE limits.window_resets_at END,
    request_count=CASE WHEN limits.window_resets_at<=v_now THEN 1 ELSE limits.request_count+1 END
  RETURNING limits.* INTO v_row;
  IF substr(p_identifier_hash,1,2)='00' THEN
    DELETE FROM public.device_agent_rate_limits stale
    WHERE stale.ctid IN (
      SELECT candidate.ctid FROM public.device_agent_rate_limits candidate
      WHERE candidate.window_resets_at < v_now-interval '1 hour' ORDER BY candidate.window_resets_at LIMIT 100
    );
  END IF;
  RETURN QUERY SELECT v_row.request_count<=p_limit,
    CASE WHEN v_row.request_count<=p_limit THEN 0 ELSE greatest(1,ceil(extract(epoch FROM v_row.window_resets_at-v_now))::integer) END,
    v_row.request_count,v_row.window_resets_at;
END $function$;
ALTER FUNCTION "public"."admit_device_agent_request"(p_scope text, p_identifier_hash text, p_limit integer, p_window_seconds integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.authenticate_device_agent_heartbeat(p_public_agent_id uuid, p_credential_hash text, p_agent_version text, p_platform text, p_os_version text, p_hostname_label text, p_declared_capabilities jsonb)
 RETURNS TABLE(gateway_id uuid, company_id uuid, location_id uuid, polling_interval_seconds integer, approved_capabilities jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_credential public.device_agent_credentials%ROWTYPE; v_gateway public.device_gateways%ROWTYPE; v_cap text; v_event_bucket timestamptz;
BEGIN
  IF p_credential_hash !~ '^[0-9a-f]{64}$' OR p_agent_version IS NULL OR p_platform IS NULL
     OR private.valid_agent_capability_declarations(p_declared_capabilities) IS NOT TRUE THEN RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED'; END IF;
  SELECT credential_row.* INTO v_credential FROM public.device_agent_credentials AS credential_row
  WHERE credential_row.public_agent_id=p_public_agent_id AND credential_row.revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_credential.revoked_at IS NOT NULL OR v_credential.credential_hash<>p_credential_hash THEN RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED'; END IF;
  SELECT gateway_row.* INTO v_gateway FROM public.device_gateways AS gateway_row
  WHERE gateway_row.id=v_credential.gateway_id FOR UPDATE;
  IF NOT FOUND OR v_gateway.status='disabled' OR v_gateway.location_id IS NULL THEN RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED'; END IF;
  IF char_length(btrim(p_agent_version)) NOT BETWEEN 1 AND 80 OR char_length(btrim(p_platform)) NOT BETWEEN 1 AND 40
     OR p_os_version IS NOT NULL AND char_length(btrim(p_os_version)) NOT BETWEEN 1 AND 80
     OR p_hostname_label IS NOT NULL AND p_hostname_label !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$' THEN RAISE EXCEPTION 'AGENT_AUTHENTICATION_FAILED'; END IF;
  FOR v_cap IN SELECT DISTINCT jsonb_array_elements_text(p_declared_capabilities) LOOP
    IF v_cap='brain.heartbeat.v1' THEN
      UPDATE public.device_gateway_capabilities AS capability_row
      SET last_declared_at=clock_timestamp()
      WHERE capability_row.gateway_id=v_gateway.id AND capability_row.capability_code=v_cap;
    ELSE
      v_event_bucket := date_trunc('hour',clock_timestamp());
      BEGIN
        INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,event_type,outcome_code,event_bucket)
        SELECT v_gateway.company_id,v_gateway.location_id,v_gateway.id,
          'capability.unknown_declared','UNKNOWN_CAPABILITIES_IGNORED',v_event_bucket
        WHERE NOT EXISTS (
          SELECT 1 FROM public.device_agent_audit AS audit_row
          WHERE audit_row.gateway_id=v_gateway.id
            AND audit_row.event_type='capability.unknown_declared'
            AND audit_row.event_bucket=v_event_bucket
        );
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;
  END LOOP;
  UPDATE public.device_agent_credentials AS credential_row SET last_authenticated_at=clock_timestamp()
  WHERE credential_row.id=v_credential.id;
  UPDATE public.device_gateways AS gateway_row
  SET last_seen_at=clock_timestamp(),status='online',agent_version=btrim(p_agent_version),
    platform=btrim(p_platform),os_version=nullif(btrim(p_os_version),''),hostname_label=nullif(btrim(p_hostname_label),'')
  WHERE gateway_row.id=v_gateway.id;
  RETURN QUERY SELECT v_gateway.id,v_gateway.company_id,v_gateway.location_id,60,
    coalesce((SELECT jsonb_agg(jsonb_build_object('code',capability_row.capability_code,'version',capability_row.declared_version) ORDER BY capability_row.capability_code)
      FROM public.device_gateway_capabilities AS capability_row
      JOIN public.device_capability_catalog AS catalog_row ON catalog_row.capability_code=capability_row.capability_code
      WHERE capability_row.gateway_id=v_gateway.id AND capability_row.approved AND capability_row.revoked_at IS NULL AND catalog_row.enabled),'[]'::jsonb);
END $function$;
ALTER FUNCTION "public"."authenticate_device_agent_heartbeat"(p_public_agent_id uuid, p_credential_hash text, p_agent_version text, p_platform text, p_os_version text, p_hostname_label text, p_declared_capabilities jsonb) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.claim_brain_action_proposal(p_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare p public.brain_action_proposals;
begin
  update public.brain_action_proposals
     set status = case when expires_at <= p_now then 'expired' else 'executing' end,
         execution_started_at = case when expires_at > p_now then p_now else execution_started_at end
   where id=p_id and actor_id=p_actor_id and profile_id=p_profile_id and tenant_id=p_tenant_id and status='pending'
   returning * into p;
  if found then
    if p.status='expired' then return jsonb_build_object('outcome','expired'); end if;
    return jsonb_build_object('outcome','claimed','proposal',to_jsonb(p));
  end if;
  select * into p from public.brain_action_proposals where id=p_id and actor_id=p_actor_id and profile_id=p_profile_id and tenant_id=p_tenant_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if p.status='executed' then return jsonb_build_object('outcome','executed','safe_result',p.safe_result); end if;
  if p.status='pending' and p.expires_at <= p_now then
    update public.brain_action_proposals set status='expired' where id=p.id and status='pending';
    return jsonb_build_object('outcome','expired');
  end if;
  return jsonb_build_object('outcome','invalid_status');
end $function$;
ALTER FUNCTION "public"."claim_brain_action_proposal"(p_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_now timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.claim_notification_delivery(p_lease_seconds integer DEFAULT 120)
 RETURNS TABLE(job_id uuid, lease_token uuid, endpoint text, p256dh text, auth_key text, notification_id uuid, title text, summary text, route text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_job public.notification_delivery_jobs%ROWTYPE;
  v_stale record;
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'INVALID_LEASE';
  END IF;

  -- Recheck N2 eligibility before Web Push claim. Stale jobs are terminally
  -- suppressed and their already-created in-app record is archived.
  FOR v_stale IN
    SELECT
      delivery.id AS job_id,
      notification.id AS notification_id,
      notification.company_id
    FROM public.notification_delivery_jobs AS delivery
    JOIN public.notifications AS notification
      ON notification.id = delivery.notification_id
    LEFT JOIN public.tasks AS task
      ON task.id = notification.related_entity_id
      AND task.company_id = notification.company_id
    WHERE notification.notification_type = 'task.due_30m'
      AND (
        delivery.status = 'pending'
        OR (
          delivery.status = 'processing'
          AND delivery.lease_expires_at < clock_timestamp()
        )
      )
      AND (
        task.id IS NULL
        OR task.status NOT IN ('pending', 'in_progress')
        OR task.due_at IS NULL
        OR clock_timestamp() >= task.due_at
        OR notification.event_key IS DISTINCT FROM
          'task.due_30m:' || task.id::text || ':' ||
          to_char(
            task.due_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
      )
    ORDER BY delivery.created_at
    FOR UPDATE OF delivery SKIP LOCKED
    LIMIT 50
  LOOP
    UPDATE public.notification_delivery_jobs AS delivery
    SET
      status = 'failed',
      lease_token = NULL,
      lease_expires_at = NULL,
      last_failure_code = 'REMINDER_NO_LONGER_ELIGIBLE'
    WHERE delivery.id = v_stale.job_id;

    UPDATE public.notifications AS notification
    SET
      status = 'archived',
      is_read = true,
      archived_at = coalesce(notification.archived_at, clock_timestamp()),
      updated_at = clock_timestamp()
    WHERE notification.id = v_stale.notification_id;

    INSERT INTO public.notification_audit (
      company_id,
      notification_id,
      event_type,
      safe_details
    ) VALUES (
      v_stale.company_id,
      v_stale.notification_id,
      'reminder.suppressed',
      jsonb_build_object('reason', 'no_longer_eligible')
    );
  END LOOP;

  SELECT delivery.*
  INTO v_job
  FROM public.notification_delivery_jobs AS delivery
  JOIN public.push_subscriptions AS subscription
    ON subscription.id = delivery.subscription_id
    AND subscription.revoked_at IS NULL
  JOIN public.notifications AS notification
    ON notification.id = delivery.notification_id
  WHERE (
      (
        delivery.status = 'pending'
        AND delivery.available_at <= clock_timestamp()
      )
      OR (
        delivery.status = 'processing'
        AND delivery.lease_expires_at < clock_timestamp()
      )
    )
    AND delivery.attempt_count < 5
    AND (
      notification.notification_type <> 'task.due_30m'
      OR EXISTS (
        SELECT 1
        FROM public.tasks AS task
        WHERE task.id = notification.related_entity_id
          AND task.company_id = notification.company_id
          AND task.status IN ('pending', 'in_progress')
          AND task.due_at IS NOT NULL
          AND clock_timestamp() < task.due_at
          AND notification.event_key =
            'task.due_30m:' || task.id::text || ':' ||
            to_char(
              task.due_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
      )
    )
  ORDER BY delivery.available_at, delivery.created_at
  FOR UPDATE OF delivery SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.notification_delivery_jobs AS delivery
  SET
    status = 'processing',
    attempt_count = delivery.attempt_count + 1,
    lease_token = v_token,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  WHERE delivery.id = v_job.id;

  RETURN QUERY
  SELECT
    v_job.id,
    v_token,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_key,
    notification.id,
    notification.title,
    'Open HospiBrain to view this notification.'::text,
    notification.route
  FROM public.push_subscriptions AS subscription
  JOIN public.notifications AS notification
    ON notification.id = v_job.notification_id
  WHERE subscription.id = v_job.subscription_id;
END
$function$;
ALTER FUNCTION "public"."claim_notification_delivery"(p_lease_seconds integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.claim_notification_outbox(p_lease_seconds integer DEFAULT 120)
 RETURNS TABLE(outbox_id uuid, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o public.notification_outbox%ROWTYPE;v_token uuid:=gen_random_uuid();BEGIN IF p_lease_seconds<30 OR p_lease_seconds>300 THEN RAISE EXCEPTION 'INVALID_LEASE';END IF;
 SELECT x.* INTO o FROM public.notification_outbox x WHERE ((x.status='pending' AND x.available_at<=clock_timestamp()) OR (x.status='processing' AND x.lease_expires_at<clock_timestamp())) AND x.attempt_count<5 ORDER BY x.available_at,x.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN;END IF;UPDATE public.notification_outbox x SET status='processing',attempt_count=x.attempt_count+1,lease_token=v_token,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds) WHERE x.id=o.id;RETURN QUERY SELECT o.id,v_token;END $function$;
ALTER FUNCTION "public"."claim_notification_outbox"(p_lease_seconds integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.claim_task_evidence_verification_job(p_lease_seconds integer DEFAULT 120)
 RETURNS TABLE(job_id uuid, lease_token uuid, evidence_id uuid, company_id uuid, task_id uuid, storage_path text, mime_type text, original_sha256 text, task_title text, task_description text, task_priority text, attempt_number integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_job public.task_evidence_verification_jobs%ROWTYPE; v_token uuid:=gen_random_uuid();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
  SELECT j.* INTO v_job FROM public.task_evidence_verification_jobs j
   WHERE ((j.status='queued' AND j.available_at<=clock_timestamp()) OR (j.status='processing' AND j.lease_expires_at<clock_timestamp()))
     AND j.attempt_count<j.max_attempts ORDER BY j.available_at,j.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.task_evidence_verification_jobs j SET status='processing',attempt_count=j.attempt_count+1,
    lease_token=v_token,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),updated_at=clock_timestamp() WHERE j.id=v_job.id;
  UPDATE public.task_evidence ev SET status='processing' WHERE ev.id=v_job.evidence_id;
  INSERT INTO public.task_evidence_verification_attempts(job_id,evidence_id,company_id,attempt_number,model_name,status)
    VALUES(v_job.id,v_job.evidence_id,v_job.company_id,v_job.attempt_count+1,'pending-worker-config','processing');
  INSERT INTO public.task_evidence_audit(evidence_id,company_id,actor_profile_id,actor_type,event_type)
    VALUES(v_job.evidence_id,v_job.company_id,NULL,'system','verification.started');
  RETURN QUERY SELECT v_job.id,v_token,ev.id,ev.company_id,ev.task_id,ev.original_storage_path,ev.original_mime_type,ev.original_sha256,
    t.title,t.description,t.priority,v_job.attempt_count+1 FROM public.task_evidence ev JOIN public.tasks t ON t.id=ev.task_id WHERE ev.id=v_job.evidence_id;
END $function$;
ALTER FUNCTION "public"."claim_task_evidence_verification_job"(p_lease_seconds integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.claim_task_localization_job(p_lease_seconds integer DEFAULT 120)
 RETURNS TABLE(task_id uuid, company_id uuid, language text, source_hash text, title text, description text, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_job public.task_localization_jobs%ROWTYPE; v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
  SELECT job.* INTO v_job FROM public.task_localization_jobs AS job
  WHERE ((job.status = 'pending' AND job.available_at <= clock_timestamp()) OR
         (job.status = 'processing' AND job.lease_expires_at < clock_timestamp()))
    AND job.attempt_count < 5 ORDER BY job.available_at, job.created_at
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.task_localization_jobs AS job SET status='processing', attempt_count=job.attempt_count+1,
    lease_token=v_token, lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds), updated_at=clock_timestamp()
  WHERE job.task_id=v_job.task_id AND job.language=v_job.language;
  RETURN QUERY SELECT task.id, task.company_id, v_job.language, v_job.source_hash,
    task.title, task.description, v_token FROM public.tasks AS task
    WHERE task.id=v_job.task_id AND task.company_id=v_job.company_id;
END $function$;
ALTER FUNCTION "public"."claim_task_localization_job"(p_lease_seconds integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.complete_brain_action_proposal(p_id uuid, p_payload_hash text, p_safe_result text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.brain_action_proposals set status='executed', executed_at=now(), safe_result=left(p_safe_result,500)
   where id=p_id and payload_hash=p_payload_hash and status='executing';
  return found;
end $function$;
ALTER FUNCTION "public"."complete_brain_action_proposal"(p_id uuid, p_payload_hash text, p_safe_result text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.complete_my_assigned_task(p_task_id uuid)
 RETURNS TABLE(task_id uuid, task_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile FROM public.profiles AS p
  WHERE p.id=auth.uid() AND p.status='active' FOR UPDATE;
  IF NOT FOUND OR v_profile.role<>'employee' OR v_profile.employee_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_ACCESS_REQUIRED' USING ERRCODE='42501';
  END IF;
  UPDATE public.tasks AS t SET status='completed',updated_at=clock_timestamp()
  WHERE t.id=p_task_id AND t.company_id=v_profile.company_id
    AND t.assigned_employee_id=v_profile.employee_id
    AND t.status IN ('pending','in_progress');
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_COMPLETABLE' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p_task_id,'completed'::text;
END;
$function$;
ALTER FUNCTION "public"."complete_my_assigned_task"(p_task_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.complete_notification_delivery(p_job_id uuid, p_lease_token uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE j public.notification_delivery_jobs%ROWTYPE;BEGIN SELECT x.* INTO j FROM public.notification_delivery_jobs x WHERE x.id=p_job_id AND x.status='processing' AND x.lease_token=p_lease_token FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED';END IF;UPDATE public.notification_delivery_jobs x SET status='delivered',lease_token=NULL,lease_expires_at=NULL,delivered_at=clock_timestamp() WHERE x.id=j.id;INSERT INTO public.notification_audit(company_id,notification_id,event_type) VALUES(j.company_id,j.notification_id,'push.delivered');END $function$;
ALTER FUNCTION "public"."complete_notification_delivery"(p_job_id uuid, p_lease_token uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.complete_task_evidence_upload(p_evidence_id uuid, p_verified_sha256 text)
 RETURNS TABLE(evidence_id uuid, task_id uuid, evidence_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_evidence public.task_evidence%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles AS pr WHERE pr.id = auth.uid() AND pr.status = 'active') THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_PROVISIONED';
  END IF;
  SELECT ev.* INTO v_evidence FROM public.task_evidence AS ev
   WHERE ev.id = p_evidence_id AND ev.submitted_by_profile_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_NOT_AVAILABLE'; END IF;
  IF v_evidence.status = 'pending_review' THEN
    RETURN QUERY SELECT v_evidence.id, v_evidence.task_id, v_evidence.status; RETURN;
  END IF;
  IF lower(p_verified_sha256) <> v_evidence.original_sha256 THEN RAISE EXCEPTION 'EVIDENCE_HASH_MISMATCH'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects AS obj
     WHERE obj.bucket_id = 'task-evidence' AND obj.name = v_evidence.original_storage_path
  ) THEN RAISE EXCEPTION 'EVIDENCE_OBJECT_MISSING'; END IF;

  UPDATE public.task_evidence AS ev SET status = 'pending_review', uploaded_at = clock_timestamp()
   WHERE ev.id = v_evidence.id;
  INSERT INTO public.task_evidence_audit (evidence_id, company_id, actor_profile_id, event_type)
  VALUES (v_evidence.id, v_evidence.company_id, auth.uid(), 'upload.completed');
  RETURN QUERY SELECT v_evidence.id, v_evidence.task_id, 'pending_review'::text;
END;
$function$;
ALTER FUNCTION "public"."complete_task_evidence_upload"(p_evidence_id uuid, p_verified_sha256 text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.complete_task_evidence_verification_job(p_job_id uuid, p_lease_token uuid, p_model_name text, p_model_version text, p_verdict text, p_confidence numeric, p_explanation text, p_reason_codes jsonb, p_visible_observations jsonb, p_uncertainty_flags jsonb, p_usage_metadata jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_job public.task_evidence_verification_jobs%ROWTYPE; v_status text;
BEGIN
 SELECT j.* INTO v_job FROM public.task_evidence_verification_jobs j WHERE j.id=p_job_id AND j.status='processing' AND j.lease_token=p_lease_token AND j.lease_expires_at>=clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED'; END IF;
 IF p_verdict NOT IN ('verified','rejected','needs_human_review') OR p_confidence<0 OR p_confidence>1 OR jsonb_typeof(p_reason_codes)<>'array' OR jsonb_typeof(p_visible_observations)<>'array' OR jsonb_typeof(p_uncertainty_flags)<>'array' THEN RAISE EXCEPTION 'INVALID_VERIFICATION_RESULT'; END IF;
 v_status:=CASE p_verdict WHEN 'verified' THEN 'ai_verified' WHEN 'rejected' THEN 'ai_rejected' ELSE 'needs_human_review' END;
 UPDATE public.task_evidence_verification_attempts a SET model_name=p_model_name,model_version=p_model_version,status='succeeded',verdict=p_verdict,confidence=p_confidence,
 explanation=left(p_explanation,600),reason_codes=p_reason_codes,visible_observations=p_visible_observations,uncertainty_flags=p_uncertainty_flags,usage_metadata=p_usage_metadata,completed_at=clock_timestamp()
 WHERE a.job_id=v_job.id AND a.attempt_number=v_job.attempt_count;
 UPDATE public.task_evidence_verification_jobs j SET status='completed',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE j.id=v_job.id;
 UPDATE public.task_evidence ev SET status=v_status WHERE ev.id=v_job.evidence_id;
 INSERT INTO public.task_evidence_audit(evidence_id,company_id,actor_profile_id,actor_type,event_type,safe_details) VALUES(v_job.evidence_id,v_job.company_id,NULL,'system','verification.succeeded',jsonb_build_object('verdict',p_verdict,'attempt',v_job.attempt_count));
END $function$;
ALTER FUNCTION "public"."complete_task_evidence_verification_job"(p_job_id uuid, p_lease_token uuid, p_model_name text, p_model_version text, p_verdict text, p_confidence numeric, p_explanation text, p_reason_codes jsonb, p_visible_observations jsonb, p_uncertainty_flags jsonb, p_usage_metadata jsonb) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.complete_task_localization_job(p_task_id uuid, p_language text, p_source_hash text, p_lease_token uuid, p_title text, p_description text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_job public.task_localization_jobs%ROWTYPE; v_live_hash text;
BEGIN
  SELECT job.* INTO v_job FROM public.task_localization_jobs AS job
  WHERE job.task_id=p_task_id AND job.language=p_language AND job.status='processing'
    AND job.lease_token=p_lease_token AND job.lease_expires_at>=clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED'; END IF;
  SELECT encode(extensions.digest(convert_to(task.title || E'\n' || coalesce(task.description,''),'UTF8'),'sha256'),'hex')
    INTO v_live_hash FROM public.tasks AS task WHERE task.id=p_task_id AND task.company_id=v_job.company_id;
  IF v_live_hash IS DISTINCT FROM p_source_hash OR v_job.source_hash IS DISTINCT FROM p_source_hash OR btrim(p_title)='' THEN
    RAISE EXCEPTION 'LOCALIZATION_SOURCE_CHANGED';
  END IF;
  INSERT INTO public.task_localizations(task_id,company_id,language,source_hash,title,description)
  VALUES(p_task_id,v_job.company_id,p_language,p_source_hash,btrim(p_title),p_description)
  ON CONFLICT(task_id,language) DO UPDATE SET source_hash=EXCLUDED.source_hash,title=EXCLUDED.title,
    description=EXCLUDED.description,updated_at=clock_timestamp();
  UPDATE public.task_localization_jobs AS job SET status='completed',lease_token=NULL,lease_expires_at=NULL,
    safe_failure_code=NULL,updated_at=clock_timestamp() WHERE job.task_id=p_task_id AND job.language=p_language;
END $function$;
ALTER FUNCTION "public"."complete_task_localization_job"(p_task_id uuid, p_language text, p_source_hash text, p_lease_token uuid, p_title text, p_description text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.consume_device_pairing_request(p_code_hash text, p_public_agent_id uuid, p_credential_hash text, p_agent_version text, p_platform text, p_os_version text, p_hostname_label text, p_declared_capabilities jsonb)
 RETURNS TABLE(gateway_id uuid, company_id uuid, location_id uuid, approved_capabilities jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_request public.device_pairing_requests%ROWTYPE; v_gateway public.device_gateways%ROWTYPE; v_cap text; v_event_bucket timestamptz;
BEGIN
  IF p_code_hash !~ '^[0-9a-f]{64}$' OR p_credential_hash !~ '^[0-9a-f]{64}$'
     OR p_agent_version IS NULL OR p_platform IS NULL
     OR char_length(btrim(p_agent_version)) NOT BETWEEN 1 AND 80
     OR char_length(btrim(p_platform)) NOT BETWEEN 1 AND 40
     OR p_os_version IS NOT NULL AND char_length(btrim(p_os_version)) NOT BETWEEN 1 AND 80
     OR p_hostname_label IS NOT NULL AND p_hostname_label !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$'
     OR private.valid_agent_capability_declarations(p_declared_capabilities) IS NOT TRUE THEN RAISE EXCEPTION 'PAIRING_INVALID'; END IF;
  SELECT request_row.* INTO v_request FROM public.device_pairing_requests AS request_row
  WHERE request_row.code_hash=p_code_hash FOR UPDATE;
  IF NOT FOUND OR v_request.used_at IS NOT NULL OR v_request.revoked_at IS NOT NULL OR v_request.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'PAIRING_INVALID';
  END IF;
  SELECT gateway_row.* INTO v_gateway FROM public.device_gateways AS gateway_row
  WHERE gateway_row.id=v_request.gateway_id FOR UPDATE;
  IF NOT FOUND OR v_gateway.company_id<>v_request.company_id OR v_gateway.location_id IS DISTINCT FROM v_request.location_id OR v_gateway.status='disabled'
     OR EXISTS(SELECT 1 FROM public.device_agent_credentials AS credential_row
       WHERE credential_row.gateway_id=v_gateway.id AND credential_row.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'PAIRING_INVALID';
  END IF;
  INSERT INTO public.device_agent_credentials(gateway_id,public_agent_id,credential_hash)
  VALUES(v_gateway.id,p_public_agent_id,p_credential_hash);
  UPDATE public.device_pairing_requests AS request_row SET used_at=clock_timestamp()
  WHERE request_row.id=v_request.id;
  UPDATE public.device_gateways AS gateway_row
  SET status='offline',paired_at=clock_timestamp(),agent_version=btrim(p_agent_version),
    platform=btrim(p_platform),os_version=nullif(btrim(p_os_version),''),hostname_label=nullif(btrim(p_hostname_label),'')
  WHERE gateway_row.id=v_gateway.id;
  FOR v_cap IN SELECT DISTINCT jsonb_array_elements_text(p_declared_capabilities) LOOP
    IF v_cap='brain.heartbeat.v1' THEN
      INSERT INTO public.device_gateway_capabilities(gateway_id,capability_code,declared_version,approved,granted_by,granted_at)
      VALUES(v_gateway.id,v_cap,1,true,v_request.created_by,clock_timestamp())
      ON CONFLICT ON CONSTRAINT device_gateway_capabilities_pkey DO UPDATE SET declared_version=1,approved=true,
        granted_by=EXCLUDED.granted_by,granted_at=EXCLUDED.granted_at,revoked_at=NULL,last_declared_at=clock_timestamp();
    ELSE
      v_event_bucket := date_trunc('hour',clock_timestamp());
      BEGIN
        INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,event_type,outcome_code,event_bucket)
        SELECT v_gateway.company_id,v_gateway.location_id,v_gateway.id,
          'capability.unknown_declared','UNKNOWN_CAPABILITIES_IGNORED',v_event_bucket
        WHERE NOT EXISTS (
          SELECT 1 FROM public.device_agent_audit AS audit_row
          WHERE audit_row.gateway_id=v_gateway.id
            AND audit_row.event_type='capability.unknown_declared'
            AND audit_row.event_bucket=v_event_bucket
        );
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;
  END LOOP;
  INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,event_type,outcome_code)
  VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,'agent.paired','PAIRED');
  RETURN QUERY SELECT v_gateway.id,v_gateway.company_id,v_gateway.location_id,
    coalesce((SELECT jsonb_agg(jsonb_build_object('code',capability_row.capability_code,'version',capability_row.declared_version) ORDER BY capability_row.capability_code)
      FROM public.device_gateway_capabilities AS capability_row
      WHERE capability_row.gateway_id=v_gateway.id AND capability_row.approved AND capability_row.revoked_at IS NULL),'[]'::jsonb);
END $function$;
ALTER FUNCTION "public"."consume_device_pairing_request"(p_code_hash text, p_public_agent_id uuid, p_credential_hash text, p_agent_version text, p_platform text, p_os_version text, p_hostname_label text, p_declared_capabilities jsonb) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.create_device_gateway(p_location_id uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_profile public.profiles%ROWTYPE; v_gateway_id uuid;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';
  IF NOT FOUND OR v_profile.role NOT IN ('owner','super_admin') THEN RAISE EXCEPTION 'GATEWAY_FORBIDDEN'; END IF;
  IF char_length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR NOT EXISTS(
    SELECT 1 FROM public.locations l WHERE l.id=p_location_id AND l.company_id=v_profile.company_id AND l.status='active'
  ) THEN RAISE EXCEPTION 'GATEWAY_INVALID'; END IF;
  INSERT INTO public.device_gateways(company_id,location_id,name,gateway_type,status,created_by)
  VALUES(v_profile.company_id,p_location_id,btrim(p_name),'brain_agent','unpaired',v_profile.id) RETURNING id INTO v_gateway_id;
  INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,actor_profile_id,event_type,outcome_code)
  VALUES(v_profile.company_id,p_location_id,v_gateway_id,v_profile.id,'gateway.created','CREATED');
  RETURN v_gateway_id;
END $function$;
ALTER FUNCTION "public"."create_device_gateway"(p_location_id uuid, p_name text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.create_device_pairing_request(p_gateway_id uuid)
 RETURNS TABLE(gateway_id uuid, pairing_code text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_profile public.profiles%ROWTYPE; v_gateway public.device_gateways%ROWTYPE; v_code text; v_expiry timestamptz;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';
  IF NOT FOUND OR v_profile.role NOT IN ('owner','super_admin') THEN RAISE EXCEPTION 'PAIRING_FORBIDDEN'; END IF;
  SELECT * INTO v_gateway FROM public.device_gateways g
    WHERE g.id=p_gateway_id AND g.company_id=v_profile.company_id FOR UPDATE;
  IF NOT FOUND OR v_gateway.location_id IS NULL OR v_gateway.status='disabled' THEN RAISE EXCEPTION 'PAIRING_GATEWAY_UNAVAILABLE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locations l WHERE l.id=v_gateway.location_id AND l.company_id=v_gateway.company_id AND l.status='active') THEN
    RAISE EXCEPTION 'PAIRING_LOCATION_UNAVAILABLE';
  END IF;
  UPDATE public.device_pairing_requests r SET revoked_at=clock_timestamp()
    WHERE r.gateway_id=v_gateway.id AND r.used_at IS NULL AND r.revoked_at IS NULL;
  v_code := encode(extensions.gen_random_bytes(16),'hex'); v_expiry := clock_timestamp()+interval '10 minutes';
  INSERT INTO public.device_pairing_requests(company_id,location_id,gateway_id,code_hash,expires_at,created_by)
  VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,
    encode(extensions.digest(convert_to(v_code,'UTF8'),'sha256'),'hex'),v_expiry,v_profile.id);
  UPDATE public.device_gateways SET status='pairing' WHERE id=v_gateway.id;
  INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,actor_profile_id,event_type,outcome_code)
  VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,v_profile.id,'pairing.created','CREATED');
  RETURN QUERY SELECT v_gateway.id,v_code,v_expiry;
END $function$;
ALTER FUNCTION "public"."create_device_pairing_request"(p_gateway_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.create_task_batch_with_outbox_events(p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_proposal_id uuid, p_items jsonb)
 RETURNS TABLE(created_count integer, task_ids uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text;
  v_timezone text;
  v_proposal_status text;
  v_proposal_payload jsonb;
  v_count integer;
  v_existing integer;
  v_item jsonb;
  v_index integer;
  v_task_ids uuid[] := ARRAY[]::uuid[];
  v_expected_event_payload jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_profile_id IS NULL OR p_tenant_id IS NULL OR
     p_proposal_id IS NULL OR p_actor_id <> p_profile_id THEN
    RAISE EXCEPTION 'INVALID_ACTOR_CONTEXT' USING ERRCODE = '22023';
  END IF;

  SELECT p.role INTO v_role
    FROM public.profiles AS p
   WHERE p.id = p_profile_id
     AND p.company_id = p_tenant_id
     AND p.status = 'active';
  IF v_role IS NULL OR v_role NOT IN ('manager', 'owner', 'super_admin') THEN
    RAISE EXCEPTION 'BATCH_TASK_ROLE_DENIED' USING ERRCODE = '42501';
  END IF;

  SELECT c.timezone INTO v_timezone
    FROM public.companies AS c
   WHERE c.id = p_tenant_id;
  IF v_timezone IS NULL OR btrim(v_timezone) = '' THEN
    RAISE EXCEPTION 'COMPANY_TIMEZONE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT bap.status, bap.canonical_payload
    INTO v_proposal_status, v_proposal_payload
    FROM public.brain_action_proposals AS bap
   WHERE bap.id = p_proposal_id
     AND bap.actor_id = p_actor_id
     AND bap.profile_id = p_profile_id
     AND bap.tenant_id = p_tenant_id
     AND bap.canonical_action = 'create_task_batch'
     AND bap.schema_version = 1;
  IF v_proposal_status IS NULL THEN
    RAISE EXCEPTION 'INVALID_BATCH_PROPOSAL' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_BATCH_ITEMS' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_items);
  IF v_count < 1 OR v_count > 25 OR jsonb_array_length(v_proposal_payload->'tasks') <> v_count THEN
    RAISE EXCEPTION 'INVALID_BATCH_SIZE' USING ERRCODE = '22023';
  END IF;
  IF v_proposal_payload->>'timezone' IS DISTINCT FROM v_timezone OR
     (SELECT count(DISTINCT entry.value->>'task_id') FROM jsonb_array_elements(p_items) AS entry(value)) <> v_count OR
     (SELECT count(DISTINCT entry.value->>'event_id') FROM jsonb_array_elements(p_items) AS entry(value)) <> v_count OR
     (SELECT count(DISTINCT entry.value->>'command_id') FROM jsonb_array_elements(p_items) AS entry(value)) <> v_count OR
     (SELECT count(DISTINCT entry.value->>'idempotency_key') FROM jsonb_array_elements(p_items) AS entry(value)) <> v_count THEN
    RAISE EXCEPTION 'INVALID_BATCH_IDENTITY' USING ERRCODE = '22023';
  END IF;

  -- Validate the complete batch and its exact proposal relationship before any insert.
  FOR v_item, v_index IN
    SELECT entry.value, (entry.ordinality - 1)::integer
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entry(value, ordinality)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' OR
       (SELECT count(*) FROM jsonb_object_keys(v_item)) <> 17 OR
       (v_item->>'item_index')::integer <> v_index OR
       (v_item - ARRAY['task_id','event_id','command_id','correlation_id','idempotency_key']::text[])
         IS DISTINCT FROM (v_proposal_payload->'tasks'->v_index) OR
       nullif(btrim(v_item->>'title'), '') IS NULL OR
       nullif(btrim(v_item->>'description'), '') IS NULL OR
       v_item->>'priority' NOT IN ('low','medium','high','critical') OR
       v_item->>'status' <> 'pending' OR
       (v_item->>'due_date')::date IS DISTINCT FROM
         ((v_item->>'due_at')::timestamptz AT TIME ZONE v_timezone)::date OR
       (v_item->>'correlation_id')::uuid IS DISTINCT FROM
         (SELECT bap.correlation_id FROM public.brain_action_proposals AS bap WHERE bap.id = p_proposal_id) OR
       v_item->>'idempotency_key' !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'INVALID_CANONICAL_BATCH_ITEM' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.employees AS e
       WHERE e.id = (v_item->>'assigned_employee_id')::uuid
         AND e.company_id = p_tenant_id AND e.status = 'active'
         AND btrim(concat_ws(' ', e.first_name, e.last_name)) = v_item->>'assigned_employee_name'
    ) THEN
      RAISE EXCEPTION 'INVALID_BATCH_ASSIGNEE' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.locations AS l
       WHERE l.id = (v_item->>'location_id')::uuid
         AND l.company_id = p_tenant_id
         AND (l.status IS NULL OR l.status = 'active')
         AND l.name = v_item->>'location_name'
    ) THEN
      RAISE EXCEPTION 'INVALID_BATCH_LOCATION' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  SELECT count(*) INTO v_existing
    FROM public.tasks AS t
   WHERE t.id IN (SELECT (entry.value->>'task_id')::uuid FROM jsonb_array_elements(p_items) AS entry(value));
  IF v_existing > 0 THEN
    IF v_existing <> v_count OR v_proposal_status NOT IN ('executing','executed') OR
       (SELECT count(*) FROM public.brain_event_outbox AS beo
         WHERE beo.proposal_id = p_proposal_id
           AND beo.aggregate_id IN (SELECT (entry.value->>'task_id')::uuid FROM jsonb_array_elements(p_items) AS entry(value))) <> v_count THEN
      RAISE EXCEPTION 'CONFLICTING_BATCH_RETRY' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_count, array_agg((entry.value->>'task_id')::uuid ORDER BY entry.ordinality)
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entry(value, ordinality);
    RETURN;
  END IF;
  IF v_proposal_status <> 'executing' THEN
    RAISE EXCEPTION 'BATCH_PROPOSAL_NOT_EXECUTING' USING ERRCODE = '42501';
  END IF;

  FOR v_item, v_index IN
    SELECT entry.value, (entry.ordinality - 1)::integer
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entry(value, ordinality)
  LOOP
    INSERT INTO public.tasks (
      id, company_id, location_id, assigned_employee_id, title, description,
      priority, status, due_date, due_at, created_by
    ) VALUES (
      (v_item->>'task_id')::uuid, p_tenant_id, (v_item->>'location_id')::uuid,
      (v_item->>'assigned_employee_id')::uuid, btrim(v_item->>'title'), v_item->>'description',
      v_item->>'priority', 'pending', (v_item->>'due_date')::date,
      (v_item->>'due_at')::timestamptz, p_profile_id
    );

    v_expected_event_payload := jsonb_build_object(
      'taskId', (v_item->>'task_id')::uuid,
      'title', btrim(v_item->>'title'),
      'priority', v_item->>'priority',
      'status', 'pending',
      'assignedEmployeeId', (v_item->>'assigned_employee_id')::uuid,
      'dueDate', v_item->>'due_date'
    );
    INSERT INTO public.brain_event_outbox (
      id, event_type, schema_version, company_id, actor_id, profile_id,
      aggregate_type, aggregate_id, command_id, correlation_id, causation_id,
      proposal_id, idempotency_key, payload, occurred_at
    ) VALUES (
      (v_item->>'event_id')::uuid, 'task.created', 1, p_tenant_id, p_actor_id, p_profile_id,
      'task', (v_item->>'task_id')::uuid, (v_item->>'command_id')::uuid,
      (v_item->>'correlation_id')::uuid, (v_item->>'command_id')::uuid,
      p_proposal_id, v_item->>'idempotency_key', v_expected_event_payload, clock_timestamp()
    );
    v_task_ids := array_append(v_task_ids, (v_item->>'task_id')::uuid);
  END LOOP;

  RETURN QUERY SELECT v_count, v_task_ids;
END;
$function$;
ALTER FUNCTION "public"."create_task_batch_with_outbox_events"(p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_proposal_id uuid, p_items jsonb) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.create_task_with_outbox_event_due_at(p_task_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_title text, p_description text, p_priority text, p_status text, p_assigned_employee_id uuid, p_due_date date, p_due_at timestamp with time zone, p_event_id uuid, p_event_type text, p_event_schema_version integer, p_aggregate_type text, p_aggregate_id uuid, p_command_id uuid, p_correlation_id uuid, p_event_causation_id uuid, p_proposal_id uuid, p_idempotency_key text, p_event_payload jsonb, p_occurred_at timestamp with time zone)
 RETURNS TABLE(task_id uuid, title text, priority text, status text, assigned_employee_id uuid, due_date date, due_at timestamp with time zone, outbox_event_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expected_payload jsonb;
  v_proposal_payload jsonb;
  v_timezone text;
BEGIN
  IF p_actor_id IS NULL OR p_profile_id IS NULL OR p_tenant_id IS NULL OR
     p_actor_id <> p_profile_id THEN
    RAISE EXCEPTION 'INVALID_ACTOR_CONTEXT' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS pr
    WHERE pr.id = p_profile_id AND pr.company_id = p_tenant_id AND pr.status = 'active'
  ) THEN
    RAISE EXCEPTION 'INVALID_ACTIVE_PROFILE' USING ERRCODE = '42501';
  END IF;

  SELECT bap.canonical_payload
    INTO v_proposal_payload
    FROM public.brain_action_proposals AS bap
   WHERE bap.id = p_proposal_id
     AND bap.actor_id = p_actor_id
     AND bap.profile_id = p_profile_id
     AND bap.tenant_id = p_tenant_id
     AND bap.canonical_action = 'create_task'
     AND bap.status = 'executing';
  IF v_proposal_payload IS NULL THEN
    RAISE EXCEPTION 'INVALID_EXECUTING_PROPOSAL' USING ERRCODE = '42501';
  END IF;

  IF p_assigned_employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.employees AS emp
    WHERE emp.id = p_assigned_employee_id AND emp.company_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'CROSS_TENANT_ASSIGNEE' USING ERRCODE = '42501';
  END IF;

  SELECT company.timezone INTO v_timezone
    FROM public.companies AS company
   WHERE company.id = p_tenant_id;
  IF v_timezone IS NULL OR p_due_date IS NULL OR p_due_at IS NULL OR
     v_proposal_payload->>'timezone' IS DISTINCT FROM v_timezone OR
     (v_proposal_payload->>'due_at')::timestamptz IS DISTINCT FROM p_due_at OR
     v_proposal_payload->>'due_date' IS DISTINCT FROM to_char(p_due_date, 'YYYY-MM-DD') OR
     v_proposal_payload->>'due_local' IS DISTINCT FROM to_char(p_due_at AT TIME ZONE v_timezone, 'YYYY-MM-DD"T"HH24:MI') OR
     (p_due_at AT TIME ZONE v_timezone)::date IS DISTINCT FROM p_due_date THEN
    RAISE EXCEPTION 'INVALID_DUE_TIME' USING ERRCODE = '22023';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' OR
     p_priority NOT IN ('low','medium','high','critical') OR
     p_status NOT IN ('pending','in_progress','completed','cancelled') THEN
    RAISE EXCEPTION 'INVALID_TASK_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  IF p_event_type <> 'task.created' OR p_event_schema_version <> 1 OR
     p_aggregate_type <> 'task' OR p_aggregate_id <> p_task_id OR
     p_event_causation_id <> p_command_id OR
     p_idempotency_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_EVENT_RELATIONSHIP' USING ERRCODE = '22023';
  END IF;

  v_expected_payload := jsonb_build_object(
    'taskId', p_task_id,
    'title', btrim(p_title),
    'priority', p_priority,
    'status', p_status,
    'assignedEmployeeId', p_assigned_employee_id,
    'dueDate', to_char(p_due_date, 'YYYY-MM-DD')
  );
  IF p_event_payload IS DISTINCT FROM v_expected_payload THEN
    RAISE EXCEPTION 'INVALID_EVENT_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tasks AS task (
    id, company_id, assigned_employee_id, title, description,
    priority, status, due_date, due_at, created_by
  ) VALUES (
    p_task_id, p_tenant_id, p_assigned_employee_id, btrim(p_title), p_description,
    p_priority, p_status, p_due_date, p_due_at, p_profile_id
  );

  INSERT INTO public.brain_event_outbox AS outbox (
    id, event_type, schema_version, company_id, actor_id, profile_id,
    aggregate_type, aggregate_id, command_id, correlation_id, causation_id,
    proposal_id, idempotency_key, payload, occurred_at
  ) VALUES (
    p_event_id, p_event_type, p_event_schema_version, p_tenant_id, p_actor_id, p_profile_id,
    p_aggregate_type, p_aggregate_id, p_command_id, p_correlation_id, p_event_causation_id,
    p_proposal_id, p_idempotency_key, p_event_payload, p_occurred_at
  );

  RETURN QUERY SELECT
    p_task_id, btrim(p_title), p_priority, p_status,
    p_assigned_employee_id, p_due_date, p_due_at, p_event_id;
END;
$function$;
ALTER FUNCTION "public"."create_task_with_outbox_event_due_at"(p_task_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_title text, p_description text, p_priority text, p_status text, p_assigned_employee_id uuid, p_due_date date, p_due_at timestamp with time zone, p_event_id uuid, p_event_type text, p_event_schema_version integer, p_aggregate_type text, p_aggregate_id uuid, p_command_id uuid, p_correlation_id uuid, p_event_causation_id uuid, p_proposal_id uuid, p_idempotency_key text, p_event_payload jsonb, p_occurred_at timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.create_task_with_outbox_event(p_task_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_title text, p_description text, p_priority text, p_status text, p_assigned_employee_id uuid, p_due_date date, p_event_id uuid, p_event_type text, p_event_schema_version integer, p_aggregate_type text, p_aggregate_id uuid, p_command_id uuid, p_correlation_id uuid, p_event_causation_id uuid, p_proposal_id uuid, p_idempotency_key text, p_event_payload jsonb, p_occurred_at timestamp with time zone)
 RETURNS TABLE(task_id uuid, title text, priority text, status text, assigned_employee_id uuid, due_date date, outbox_event_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expected_payload jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_profile_id IS NULL OR p_tenant_id IS NULL OR
     p_actor_id <> p_profile_id THEN
    RAISE EXCEPTION 'INVALID_ACTOR_CONTEXT' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles AS pr
     WHERE pr.id = p_profile_id
       AND pr.company_id = p_tenant_id
       AND pr.status = 'active'
  ) THEN
    RAISE EXCEPTION 'INVALID_ACTIVE_PROFILE' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.brain_action_proposals AS bap
     WHERE bap.id = p_proposal_id
       AND bap.actor_id = p_actor_id
       AND bap.profile_id = p_profile_id
       AND bap.tenant_id = p_tenant_id
       AND bap.canonical_action = 'create_task'
       AND bap.status = 'executing'
  ) THEN
    RAISE EXCEPTION 'INVALID_EXECUTING_PROPOSAL' USING ERRCODE = '42501';
  END IF;

  IF p_assigned_employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.employees AS emp
     WHERE emp.id = p_assigned_employee_id
       AND emp.company_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'CROSS_TENANT_ASSIGNEE' USING ERRCODE = '42501';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' OR
     p_priority NOT IN ('low','medium','high','critical') OR
     p_status NOT IN ('pending','in_progress','completed','cancelled') THEN
    RAISE EXCEPTION 'INVALID_TASK_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  IF p_event_type <> 'task.created' OR p_event_schema_version <> 1 OR
     p_aggregate_type <> 'task' OR p_aggregate_id <> p_task_id OR
     p_event_causation_id <> p_command_id OR
     p_idempotency_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_EVENT_RELATIONSHIP' USING ERRCODE = '22023';
  END IF;

  v_expected_payload := jsonb_build_object(
    'taskId', p_task_id,
    'title', btrim(p_title),
    'priority', p_priority,
    'status', p_status,
    'assignedEmployeeId', p_assigned_employee_id,
    'dueDate', CASE WHEN p_due_date IS NULL THEN NULL ELSE to_char(p_due_date, 'YYYY-MM-DD') END
  );
  IF p_event_payload IS DISTINCT FROM v_expected_payload THEN
    RAISE EXCEPTION 'INVALID_EVENT_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tasks (
    id, company_id, assigned_employee_id, title, description,
    priority, status, due_date, created_by
  ) VALUES (
    p_task_id, p_tenant_id, p_assigned_employee_id, btrim(p_title), p_description,
    p_priority, p_status, p_due_date, p_profile_id
  );

  INSERT INTO public.brain_event_outbox (
    id, event_type, schema_version, company_id, actor_id, profile_id,
    aggregate_type, aggregate_id, command_id, correlation_id, causation_id,
    proposal_id, idempotency_key, payload, occurred_at
  ) VALUES (
    p_event_id, p_event_type, p_event_schema_version, p_tenant_id, p_actor_id, p_profile_id,
    p_aggregate_type, p_aggregate_id, p_command_id, p_correlation_id, p_event_causation_id,
    p_proposal_id, p_idempotency_key, p_event_payload, p_occurred_at
  );

  RETURN QUERY SELECT
    p_task_id, btrim(p_title), p_priority, p_status,
    p_assigned_employee_id, p_due_date, p_event_id;
END;
$function$;
ALTER FUNCTION "public"."create_task_with_outbox_event"(p_task_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_title text, p_description text, p_priority text, p_status text, p_assigned_employee_id uuid, p_due_date date, p_event_id uuid, p_event_type text, p_event_schema_version integer, p_aggregate_type text, p_aggregate_id uuid, p_command_id uuid, p_correlation_id uuid, p_event_causation_id uuid, p_proposal_id uuid, p_idempotency_key text, p_event_payload jsonb, p_occurred_at timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.enqueue_arabic_task_localization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_hash text;
BEGIN
  IF NEW.assigned_employee_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.employees AS employee
    JOIN public.profiles AS profile ON profile.employee_id = employee.id
      AND profile.company_id = employee.company_id
    WHERE employee.id = NEW.assigned_employee_id AND employee.company_id = NEW.company_id
      AND employee.status = 'active' AND profile.status = 'active' AND profile.preferred_language = 'ar'
  ) THEN RETURN NEW; END IF;
  v_hash := encode(extensions.digest(convert_to(NEW.title || E'\n' || coalesce(NEW.description, ''), 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.task_localization_jobs(task_id, company_id, language, source_hash)
  VALUES (NEW.id, NEW.company_id, 'ar', v_hash)
  ON CONFLICT (task_id, language) DO UPDATE SET
    company_id = EXCLUDED.company_id, source_hash = EXCLUDED.source_hash,
    status = CASE WHEN public.task_localization_jobs.source_hash = EXCLUDED.source_hash
      AND public.task_localization_jobs.status = 'completed' THEN 'completed' ELSE 'pending' END,
    attempt_count = CASE WHEN public.task_localization_jobs.source_hash = EXCLUDED.source_hash
      THEN public.task_localization_jobs.attempt_count ELSE 0 END,
    available_at = clock_timestamp(), lease_token = NULL, lease_expires_at = NULL,
    safe_failure_code = NULL, updated_at = clock_timestamp();
  RETURN NEW;
END $function$;
ALTER FUNCTION "public"."enqueue_arabic_task_localization"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.enqueue_legacy_arabic_task_localizations(p_limit integer DEFAULT 25)
 RETURNS TABLE(scanned bigint, enqueued bigint, already_current bigint, already_queued bigint, unresolved bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_task record;
  v_affected integer;
  v_live_hash text;
  v_live_recipient_resolved boolean;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'INVALID_BACKFILL_BATCH_LIMIT';
  END IF;

  scanned := 0;
  enqueued := 0;
  already_current := 0;
  already_queued := 0;
  unresolved := 0;

  FOR v_task IN
    WITH assessed AS (
      SELECT
        task.id,
        task.company_id,
        encode(extensions.digest(
          convert_to(task.title || E'\n' || coalesce(task.description, ''), 'UTF8'),
          'sha256'
        ), 'hex') AS source_hash,
        btrim(task.title) <> '' AS has_content,
        EXISTS (
          SELECT 1
          FROM public.employees AS employee
          JOIN public.profiles AS profile
            ON profile.employee_id = employee.id
           AND profile.company_id = employee.company_id
          WHERE employee.id = task.assigned_employee_id
            AND employee.company_id = task.company_id
            AND employee.status = 'active'
            AND profile.status = 'active'
            AND profile.preferred_language = 'ar'
        ) AS recipient_resolved
      FROM public.tasks AS task
      WHERE task.status IN ('pending', 'in_progress')
      ORDER BY task.created_at, task.id
    ), classified AS (
      SELECT
        assessed.*,
        EXISTS (
          SELECT 1 FROM public.task_localizations AS localization
          WHERE localization.task_id = assessed.id
            AND localization.company_id = assessed.company_id
            AND localization.language = 'ar'
            AND localization.source_hash = assessed.source_hash
        ) AS is_current,
        EXISTS (
          SELECT 1 FROM public.task_localization_jobs AS job
          WHERE job.task_id = assessed.id
            AND job.company_id = assessed.company_id
            AND job.language = 'ar'
            AND job.source_hash = assessed.source_hash
            AND job.status IN ('pending', 'processing')
        ) AS is_queued
      FROM assessed
    )
    SELECT classified.*
    FROM classified
    ORDER BY
      CASE
        WHEN classified.has_content AND classified.recipient_resolved
          AND NOT classified.is_current AND NOT classified.is_queued THEN 0
        WHEN classified.has_content AND classified.recipient_resolved AND classified.is_current THEN 1
        WHEN classified.has_content AND classified.recipient_resolved AND classified.is_queued THEN 2
        ELSE 3
      END,
      classified.id
    LIMIT p_limit
  LOOP
    scanned := scanned + 1;

    IF NOT v_task.has_content OR NOT v_task.recipient_resolved THEN
      unresolved := unresolved + 1;
      CONTINUE;
    END IF;

    IF v_task.is_current THEN
      already_current := already_current + 1;
      CONTINUE;
    END IF;

    IF v_task.is_queued THEN
      already_queued := already_queued + 1;
      CONTINUE;
    END IF;

    -- Lock and revalidate the canonical source immediately before the upsert.
    -- This prevents an edit or reassignment racing the bounded scan from
    -- replacing a newer job with a stale source hash.
    SELECT
      encode(extensions.digest(
        convert_to(task.title || E'\n' || coalesce(task.description, ''), 'UTF8'),
        'sha256'
      ), 'hex'),
      btrim(task.title) <> '' AND EXISTS (
        SELECT 1
        FROM public.employees AS employee
        JOIN public.profiles AS profile
          ON profile.employee_id = employee.id
         AND profile.company_id = employee.company_id
        WHERE employee.id = task.assigned_employee_id
          AND employee.company_id = task.company_id
          AND employee.status = 'active'
          AND profile.status = 'active'
          AND profile.preferred_language = 'ar'
      )
    INTO v_live_hash, v_live_recipient_resolved
    FROM public.tasks AS task
    WHERE task.id = v_task.id
      AND task.company_id = v_task.company_id
      AND task.status IN ('pending', 'in_progress')
    FOR UPDATE;

    IF NOT FOUND OR v_live_hash IS DISTINCT FROM v_task.source_hash
       OR v_live_recipient_resolved IS DISTINCT FROM true THEN
      unresolved := unresolved + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.task_localization_jobs AS job (
      task_id, company_id, language, source_hash, status, attempt_count,
      available_at, lease_token, lease_expires_at, safe_failure_code, updated_at
    ) VALUES (
      v_task.id, v_task.company_id, 'ar', v_task.source_hash, 'pending', 0,
      clock_timestamp(), NULL, NULL, NULL, clock_timestamp()
    )
    ON CONFLICT (task_id, language) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      source_hash = EXCLUDED.source_hash,
      status = 'pending',
      attempt_count = 0,
      available_at = clock_timestamp(),
      lease_token = NULL,
      lease_expires_at = NULL,
      safe_failure_code = NULL,
      updated_at = clock_timestamp()
    WHERE job.source_hash IS DISTINCT FROM EXCLUDED.source_hash
      AND job.status <> 'processing';

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 1 THEN
      enqueued := enqueued + 1;
    ELSE
      already_queued := already_queued + 1;
    END IF;
  END LOOP;

  RETURN NEXT;
END $function$;
ALTER FUNCTION "public"."enqueue_legacy_arabic_task_localizations"(p_limit integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.enqueue_task_evidence_verification(p_evidence_id uuid)
 RETURNS TABLE(evidence_id uuid, verification_status text, duplicate boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_profile public.profiles%ROWTYPE; v_ev public.task_evidence%ROWTYPE; v_job public.task_evidence_verification_jobs%ROWTYPE; v_cycle integer; v_insert_count bigint;
BEGIN
  SELECT pr.* INTO v_profile FROM public.profiles pr WHERE pr.id=auth.uid() AND pr.status='active';
  IF NOT FOUND OR v_profile.company_id IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_PROVISIONED'; END IF;
  SELECT ev.* INTO v_ev FROM public.task_evidence ev JOIN public.tasks t ON t.id=ev.task_id AND t.company_id=ev.company_id
   WHERE ev.id=p_evidence_id AND ev.company_id=v_profile.company_id AND
    (v_profile.role IN ('manager','owner','super_admin') OR
     (v_profile.role='employee' AND v_profile.employee_id IS NOT NULL AND (ev.submitted_by_profile_id=v_profile.id OR t.assigned_employee_id=v_profile.employee_id))) FOR UPDATE OF ev;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_NOT_AVAILABLE'; END IF;
  IF v_ev.status NOT IN ('pending_review','queued','processing','verification_failed') THEN RAISE EXCEPTION 'EVIDENCE_NOT_QUEUEABLE'; END IF;
  SELECT j.* INTO v_job FROM public.task_evidence_verification_jobs j WHERE j.evidence_id=v_ev.id ORDER BY j.cycle_number DESC LIMIT 1;
  IF FOUND AND v_job.status IN ('queued','processing') THEN
    v_insert_count := 0;
  ELSE
    v_cycle := coalesce(v_job.cycle_number,0)+1;
    IF v_cycle > 3 THEN RAISE EXCEPTION 'VERIFICATION_RETRY_LIMIT_REACHED'; END IF;
    INSERT INTO public.task_evidence_verification_jobs(evidence_id,company_id,cycle_number) VALUES(v_ev.id,v_ev.company_id,v_cycle);
    GET DIAGNOSTICS v_insert_count = ROW_COUNT;
  END IF;
  IF v_ev.status IN ('pending_review','verification_failed') THEN UPDATE public.task_evidence SET status='queued' WHERE id=v_ev.id; END IF;
  IF v_insert_count = 1 THEN INSERT INTO public.task_evidence_audit(evidence_id,company_id,actor_profile_id,event_type)
    VALUES(v_ev.id,v_ev.company_id,v_profile.id,'verification.queued'); END IF;
  RETURN QUERY SELECT v_ev.id, (SELECT ev.status FROM public.task_evidence ev WHERE ev.id=v_ev.id), v_insert_count = 0;
END $function$;
ALTER FUNCTION "public"."enqueue_task_evidence_verification"(p_evidence_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.fail_brain_action_proposal(p_id uuid, p_payload_hash text, p_error_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.brain_action_proposals set status='failed', failed_at=now(), safe_error_code=left(p_error_code,100)
   where id=p_id and payload_hash=p_payload_hash and status='executing';
  return found;
end $function$;
ALTER FUNCTION "public"."fail_brain_action_proposal"(p_id uuid, p_payload_hash text, p_error_code text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.fail_notification_delivery(p_job_id uuid, p_lease_token uuid, p_code text, p_permanent boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE j public.notification_delivery_jobs%ROWTYPE;v_retry boolean;BEGIN SELECT x.* INTO j FROM public.notification_delivery_jobs x WHERE x.id=p_job_id AND x.status='processing' AND x.lease_token=p_lease_token FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED';END IF;v_retry:=NOT p_permanent AND j.attempt_count<5;UPDATE public.notification_delivery_jobs x SET status=CASE WHEN v_retry THEN 'pending' ELSE 'failed' END,available_at=CASE WHEN v_retry THEN clock_timestamp()+make_interval(secs=>power(2,j.attempt_count)::integer*30) ELSE x.available_at END,lease_token=NULL,lease_expires_at=NULL,last_failure_code=left(p_code,80) WHERE x.id=j.id;IF p_permanent THEN UPDATE public.push_subscriptions s SET revoked_at=clock_timestamp() WHERE s.id=j.subscription_id;END IF;INSERT INTO public.notification_audit(company_id,notification_id,event_type,safe_details) VALUES(j.company_id,j.notification_id,CASE WHEN v_retry THEN 'push.retry' ELSE 'push.permanently_failed' END,jsonb_build_object('code',left(p_code,80)));END $function$;
ALTER FUNCTION "public"."fail_notification_delivery"(p_job_id uuid, p_lease_token uuid, p_code text, p_permanent boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.fail_notification_outbox(p_outbox_id uuid, p_lease_token uuid, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o public.notification_outbox%ROWTYPE;v_retry boolean;BEGIN SELECT x.* INTO o FROM public.notification_outbox x WHERE x.id=p_outbox_id AND x.status='processing' AND x.lease_token=p_lease_token FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED';END IF;v_retry:=o.attempt_count<5;UPDATE public.notification_outbox x SET status=CASE WHEN v_retry THEN 'pending' ELSE 'failed' END,available_at=CASE WHEN v_retry THEN clock_timestamp()+make_interval(secs=>power(2,o.attempt_count)::integer*30) ELSE x.available_at END,lease_token=NULL,lease_expires_at=NULL,last_failure_code=left(p_code,80) WHERE x.id=o.id;INSERT INTO public.notification_audit(company_id,event_type,safe_details) VALUES(o.company_id,'obligation.failed',jsonb_build_object('retryable',v_retry,'code',left(p_code,80)));END $function$;
ALTER FUNCTION "public"."fail_notification_outbox"(p_outbox_id uuid, p_lease_token uuid, p_code text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.fail_task_evidence_upload(p_evidence_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_evidence public.task_evidence%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles AS pr WHERE pr.id = auth.uid() AND pr.status = 'active') THEN RETURN; END IF;
  SELECT ev.* INTO v_evidence FROM public.task_evidence AS ev
   WHERE ev.id = p_evidence_id AND ev.submitted_by_profile_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_evidence.status = 'pending_review' THEN RETURN; END IF;
  UPDATE public.task_evidence AS ev SET status = 'upload_failed' WHERE ev.id = v_evidence.id;
  INSERT INTO public.task_evidence_audit (evidence_id, company_id, actor_profile_id, event_type, safe_details)
  VALUES (v_evidence.id, v_evidence.company_id, auth.uid(), 'upload.failed', '{"retryable":true}'::jsonb);
END;
$function$;
ALTER FUNCTION "public"."fail_task_evidence_upload"(p_evidence_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.fail_task_evidence_verification_job(p_job_id uuid, p_lease_token uuid, p_failure_code text, p_retryable boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_job public.task_evidence_verification_jobs%ROWTYPE; v_retry boolean;
BEGIN
 SELECT j.* INTO v_job FROM public.task_evidence_verification_jobs j WHERE j.id=p_job_id AND j.status='processing' AND j.lease_token=p_lease_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED'; END IF; v_retry:=p_retryable AND v_job.attempt_count<v_job.max_attempts;
 UPDATE public.task_evidence_verification_attempts a SET status='failed',failure_code=p_failure_code,completed_at=clock_timestamp() WHERE a.job_id=v_job.id AND a.attempt_number=v_job.attempt_count;
 UPDATE public.task_evidence_verification_jobs j SET status=CASE WHEN v_retry THEN 'queued' ELSE 'failed' END,available_at=CASE WHEN v_retry THEN clock_timestamp()+make_interval(secs=>power(2,v_job.attempt_count)::integer*30) ELSE j.available_at END,
 lease_token=NULL,lease_expires_at=NULL,last_failure_code=p_failure_code,updated_at=clock_timestamp() WHERE j.id=v_job.id;
 UPDATE public.task_evidence ev SET status=CASE WHEN v_retry THEN 'queued' ELSE 'verification_failed' END WHERE ev.id=v_job.evidence_id;
 INSERT INTO public.task_evidence_audit(evidence_id,company_id,actor_profile_id,actor_type,event_type,safe_details) VALUES(v_job.evidence_id,v_job.company_id,NULL,'system','verification.failed',jsonb_build_object('code',p_failure_code,'retryable',v_retry,'attempt',v_job.attempt_count));
END $function$;
ALTER FUNCTION "public"."fail_task_evidence_verification_job"(p_job_id uuid, p_lease_token uuid, p_failure_code text, p_retryable boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.fail_task_localization_job(p_task_id uuid, p_language text, p_lease_token uuid, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_job public.task_localization_jobs%ROWTYPE; v_retry boolean;
BEGIN
  SELECT job.* INTO v_job FROM public.task_localization_jobs AS job WHERE job.task_id=p_task_id
    AND job.language=p_language AND job.status='processing' AND job.lease_token=p_lease_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_OWNED'; END IF;
  v_retry := v_job.attempt_count < 5;
  UPDATE public.task_localization_jobs AS job SET status=CASE WHEN v_retry THEN 'pending' ELSE 'failed' END,
    available_at=CASE WHEN v_retry THEN clock_timestamp()+make_interval(secs=>power(2,v_job.attempt_count)::integer*30) ELSE job.available_at END,
    lease_token=NULL,lease_expires_at=NULL,safe_failure_code=left(p_code,80),updated_at=clock_timestamp()
  WHERE job.task_id=p_task_id AND job.language=p_language;
END $function$;
ALTER FUNCTION "public"."fail_task_localization_job"(p_task_id uuid, p_language text, p_lease_token uuid, p_code text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.generate_task_reminder_obligations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_database_now timestamptz := clock_timestamp();
  v_count integer;
BEGIN
  INSERT INTO public.notification_outbox (
    company_id,
    event_key,
    event_type,
    aggregate_type,
    aggregate_id
  )
  SELECT
    task.company_id,
    'task.due_30m:' || task.id::text || ':' ||
      to_char(
        task.due_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
    'task.due_30m',
    'tasks',
    task.id
  FROM public.tasks AS task
  WHERE task.due_at IS NOT NULL
    AND task.assigned_employee_id IS NOT NULL
    AND task.status IN ('pending', 'in_progress')
    AND v_database_now >= task.due_at - interval '30 minutes'
    AND v_database_now < task.due_at
  ON CONFLICT (company_id, event_key) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;
ALTER FUNCTION "public"."generate_task_reminder_obligations"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.get_brain_chat_quota_status()
 RETURNS TABLE(quota_limit integer, remaining integer, reset_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := statement_timestamp();
  v_row public.brain_chat_user_quotas%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT q.*
    INTO v_row
    FROM public.brain_chat_user_quotas AS q
   WHERE q.user_id = v_user_id;

  IF NOT FOUND OR v_row.window_resets_at <= v_now THEN
    RETURN QUERY SELECT 100, 100, NULL::timestamptz;
  ELSE
    RETURN QUERY SELECT 100, 100 - v_row.request_count, v_row.window_resets_at;
  END IF;
END;
$function$;
ALTER FUNCTION "public"."get_brain_chat_quota_status"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.get_company_notification_diagnostics()
 RETURNS TABLE(unread bigint, pending_obligations bigint, pending_push bigint, failed_push bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT count(DISTINCT n.id) FILTER(WHERE n.status='unread'),count(DISTINCT o.id) FILTER(WHERE o.status IN('pending','processing')),count(DISTINCT d.id) FILTER(WHERE d.status IN('pending','processing')),count(DISTINCT d.id) FILTER(WHERE d.status='failed') FROM public.profiles p LEFT JOIN public.notifications n ON n.company_id=p.company_id LEFT JOIN public.notification_outbox o ON o.company_id=p.company_id LEFT JOIN public.notification_delivery_jobs d ON d.company_id=p.company_id WHERE p.id=auth.uid() AND p.status='active' AND p.role IN('manager','owner','super_admin')
$function$;
ALTER FUNCTION "public"."get_company_notification_diagnostics"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.get_my_notification_state()
 RETURNS TABLE(unread_count bigint, preferences jsonb, subscription_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT count(n.id) FILTER(WHERE n.status='unread'),to_jsonb(pref),count(DISTINCT s.id) FILTER(WHERE s.revoked_at IS NULL)
 FROM public.profiles p LEFT JOIN public.notifications n ON n.recipient_id=p.id AND n.company_id=p.company_id
 LEFT JOIN public.notification_preferences pref ON pref.profile_id=p.id LEFT JOIN public.push_subscriptions s ON s.profile_id=p.id AND s.company_id=p.company_id
 WHERE p.id=auth.uid() AND p.status='active' GROUP BY pref.*
$function$;
ALTER FUNCTION "public"."get_my_notification_state"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.get_my_task_visibility_diagnostic()
 RETURNS TABLE(persisted_role text, employee_linked boolean, assigned_task_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    pr.role,
    (pr.employee_id IS NOT NULL AND emp.id IS NOT NULL),
    CASE
      WHEN pr.employee_id IS NULL OR emp.id IS NULL THEN 0::bigint
      ELSE (
        SELECT count(*)
          FROM public.tasks AS t
         WHERE t.company_id = pr.company_id
           AND t.assigned_employee_id = pr.employee_id
      )
    END
  FROM public.profiles AS pr
  LEFT JOIN public.employees AS emp
    ON emp.id = pr.employee_id
   AND emp.company_id = pr.company_id
  WHERE pr.id = auth.uid()
    AND pr.status = 'active';
$function$;
ALTER FUNCTION "public"."get_my_task_visibility_diagnostic"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.get_task_evidence_access(p_evidence_id uuid)
 RETURNS TABLE(storage_path text, mime_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT ev.original_storage_path, ev.original_mime_type
  FROM public.task_evidence ev
  JOIN public.profiles pr ON pr.id = auth.uid() AND pr.status = 'active' AND pr.company_id = ev.company_id
  JOIN public.tasks t ON t.id = ev.task_id AND t.company_id = ev.company_id
  WHERE ev.id = p_evidence_id
    AND ev.status IN ('pending_review','queued','processing','ai_verified','ai_rejected','needs_human_review','verification_failed','human_approved','human_rejected')
    AND (pr.role IN ('manager','owner','super_admin') OR
      (pr.role = 'employee' AND pr.employee_id IS NOT NULL AND
       (ev.submitted_by_profile_id = pr.id OR t.assigned_employee_id = pr.employee_id)));
$function$;
ALTER FUNCTION "public"."get_task_evidence_access"(p_evidence_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.get_task_evidence_upload(p_evidence_id uuid)
 RETURNS TABLE(storage_path text, expected_mime_type text, expected_size_bytes bigint, expected_sha256 text, upload_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT ev.original_storage_path, ev.original_mime_type, ev.original_size_bytes, ev.original_sha256, ev.status
    FROM public.task_evidence AS ev
    JOIN public.profiles AS pr ON pr.id = auth.uid()
   WHERE ev.id = p_evidence_id AND ev.submitted_by_profile_id = auth.uid()
     AND pr.status = 'active' AND pr.company_id = ev.company_id;
$function$;
ALTER FUNCTION "public"."get_task_evidence_upload"(p_evidence_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.list_my_notifications(p_limit integer DEFAULT 30, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, title text, message text, category text, status text, route text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT n.id,n.title,n.message,n.category,n.status,n.route,n.created_at FROM public.notifications n JOIN public.profiles p ON p.id=auth.uid() AND p.status='active' AND p.company_id=n.company_id
 WHERE n.recipient_id=auth.uid() AND n.status<>'archived' AND (p_before IS NULL OR n.created_at<p_before) ORDER BY n.created_at DESC LIMIT least(greatest(p_limit,1),50)
$function$;
ALTER FUNCTION "public"."list_my_notifications"(p_limit integer, p_before timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.list_task_evidence_reviews()
 RETURNS TABLE(evidence_id uuid, evidence_status text, task_id uuid, task_title text, task_description text, task_status text, submitter_profile_id uuid, submitter_name text, ai_verdict text, confidence numeric, explanation text, reason_codes jsonb, visible_observations jsonb, uncertainty_flags jsonb, attempt_number integer, attempts jsonb, audit_history jsonb, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT ev.id,ev.status,ev.task_id,t.title,t.description,t.status,ev.submitted_by_profile_id,coalesce(nullif(sp.full_name,''),'Team member'),
 a.verdict,a.confidence,a.explanation,a.reason_codes,a.visible_observations,a.uncertainty_flags,a.attempt_number,
 coalesce((SELECT jsonb_agg(jsonb_build_object('cycleNumber',vj.cycle_number,'attemptNumber',va.attempt_number,'status',va.status,'verdict',va.verdict,'confidence',va.confidence,'failureCode',va.failure_code,'startedAt',va.started_at,'completedAt',va.completed_at) ORDER BY va.started_at) FROM public.task_evidence_verification_attempts va JOIN public.task_evidence_verification_jobs vj ON vj.id=va.job_id WHERE va.evidence_id=ev.id),'[]'::jsonb),
 coalesce((SELECT jsonb_agg(jsonb_build_object('eventType',au.event_type,'actorType',au.actor_type,'createdAt',au.created_at,'safeDetails',au.safe_details) ORDER BY au.created_at) FROM public.task_evidence_audit au WHERE au.evidence_id=ev.id),'[]'::jsonb),ev.created_at
 FROM public.task_evidence ev JOIN public.profiles pr ON pr.id=auth.uid() AND pr.status='active' AND pr.company_id=ev.company_id AND pr.role IN ('manager','owner','super_admin')
 JOIN public.tasks t ON t.id=ev.task_id AND t.company_id=ev.company_id JOIN public.profiles sp ON sp.id=ev.submitted_by_profile_id
 LEFT JOIN LATERAL(SELECT x.* FROM public.task_evidence_verification_attempts x WHERE x.evidence_id=ev.id ORDER BY x.started_at DESC LIMIT 1)a ON true
 WHERE ev.status IN ('queued','processing','ai_verified','ai_rejected','needs_human_review','verification_failed','human_approved','human_rejected') ORDER BY ev.created_at DESC LIMIT 100;
$function$;
ALTER FUNCTION "public"."list_task_evidence_reviews"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.localize_employee_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_language text;
BEGIN
  SELECT profile.preferred_language INTO v_language FROM public.profiles AS profile
  WHERE profile.id=NEW.recipient_id AND profile.company_id=NEW.company_id AND profile.status='active';
  IF v_language='ar' THEN
    NEW.title := CASE NEW.notification_type
      WHEN 'task.assigned' THEN 'تم إسناد مهمة'
      WHEN 'task.reassigned' THEN 'تم تغيير إسناد المهمة'
      WHEN 'task.due_30m' THEN 'المهمة مستحقة خلال 30 دقيقة'
      WHEN 'task.completed' THEN 'اكتملت المهمة'
      ELSE NEW.title END;
    NEW.message := CASE WHEN NEW.category='tasks' THEN 'افتح HospiBrain لعرض تفاصيل المهمة.' ELSE NEW.message END;
  END IF;
  RETURN NEW;
END $function$;
ALTER FUNCTION "public"."localize_employee_notification"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.mark_all_my_notifications_read()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_count integer;v_company uuid;BEGIN SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;
 UPDATE public.notifications n SET status='read',is_read=true,read_at=coalesce(n.read_at,clock_timestamp()),updated_at=clock_timestamp() WHERE n.recipient_id=auth.uid() AND n.company_id=v_company AND n.status='unread';GET DIAGNOSTICS v_count=ROW_COUNT;INSERT INTO public.notification_audit(company_id,profile_id,event_type,safe_details) VALUES(v_company,auth.uid(),'notification.read_all',jsonb_build_object('count',v_count));RETURN v_count;END $function$;
ALTER FUNCTION "public"."mark_all_my_notifications_read"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.materialize_notification_outbox(p_outbox_id uuid, p_lease_token uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_outbox public.notification_outbox%ROWTYPE;
  v_recipient record;
  v_notification_id uuid;
  v_count integer := 0;
  v_category text;
  v_title text;
  v_message text;
  v_route text;
  v_allowed boolean;
  v_in_app boolean;
BEGIN
  SELECT outbox.*
  INTO v_outbox
  FROM public.notification_outbox AS outbox
  WHERE outbox.id = p_outbox_id
    AND outbox.status = 'processing'
    AND outbox.lease_token = p_lease_token
    AND outbox.lease_expires_at >= clock_timestamp()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEASE_NOT_OWNED';
  END IF;

  -- N2 supersedes undelivered N1 calendar-day reminder obligations without
  -- fabricating a recipient-resolution failure or mutating the task.
  IF v_outbox.event_type IN ('task.due_soon', 'task.overdue') THEN
    INSERT INTO public.notification_audit (
      company_id,
      event_type,
      safe_details
    ) VALUES (
      v_outbox.company_id,
      'obligation.superseded',
      jsonb_build_object('eventType', v_outbox.event_type)
    );

    UPDATE public.notification_outbox AS outbox
    SET
      status = 'completed',
      lease_token = NULL,
      lease_expires_at = NULL,
      completed_at = clock_timestamp()
    WHERE outbox.id = v_outbox.id;

    RETURN 0;
  END IF;

  v_category := CASE
    WHEN v_outbox.event_type LIKE 'task.%' THEN 'tasks'
    WHEN v_outbox.event_type LIKE 'announcement.%' THEN 'announcements'
    WHEN v_outbox.event_type LIKE 'maintenance.%' THEN 'maintenance'
    WHEN v_outbox.event_type LIKE 'incident.%' THEN 'incidents'
    WHEN v_outbox.event_type LIKE 'evidence.%' THEN 'evidence'
    ELSE 'system'
  END;

  v_route := CASE v_category
    WHEN 'tasks' THEN '/dashboard/tasks'
    WHEN 'announcements' THEN '/dashboard/announcements'
    WHEN 'maintenance' THEN '/dashboard/maintenance'
    WHEN 'incidents' THEN '/dashboard/incidents'
    WHEN 'evidence' THEN CASE
      WHEN v_outbox.event_type IN (
        'evidence.needs_human_review',
        'evidence.verification_failed'
      ) THEN '/dashboard/evidence-review'
      ELSE '/dashboard/tasks'
    END
    ELSE '/dashboard'
  END;

  v_title := CASE v_outbox.event_type
    WHEN 'task.assigned' THEN 'Task assigned'
    WHEN 'task.reassigned' THEN 'Task assignment changed'
    WHEN 'task.due_30m' THEN 'Task due in 30 minutes.'
    WHEN 'task.completed' THEN 'Task completed'
    WHEN 'announcement.published' THEN 'New announcement'
    WHEN 'maintenance.assigned' THEN 'Maintenance ticket assigned'
    WHEN 'maintenance.urgent_created' THEN 'Urgent maintenance alert'
    WHEN 'incident.reported' THEN 'Incident reported'
    WHEN 'evidence.submitted' THEN 'Task evidence submitted'
    WHEN 'evidence.needs_human_review' THEN 'Evidence needs review'
    WHEN 'evidence.verification_failed' THEN 'Evidence verification failed'
    WHEN 'evidence.human_approved' THEN 'Evidence approved'
    WHEN 'evidence.human_rejected' THEN 'Evidence requires resubmission'
    ELSE 'Operational update'
  END;

  v_message := CASE
    WHEN v_outbox.event_type = 'evidence.human_rejected'
      THEN 'Open HospiBrain to review and resubmit evidence.'
    ELSE 'Open HospiBrain to view this update.'
  END;

  FOR v_recipient IN
    SELECT DISTINCT profile.id AS profile_id
    FROM public.profiles AS profile
    WHERE profile.company_id = v_outbox.company_id
      AND profile.status = 'active'
      AND profile.role IN ('employee', 'manager', 'owner', 'super_admin')
      AND (
        (
          v_outbox.event_type LIKE 'task.%'
          AND v_outbox.event_type <> 'task.due_30m'
          AND EXISTS (
            SELECT 1
            FROM public.tasks AS task
            WHERE task.id = v_outbox.aggregate_id
              AND task.company_id = v_outbox.company_id
              AND task.assigned_employee_id = profile.employee_id
          )
        )
        OR (
          v_outbox.event_type = 'task.due_30m'
          AND EXISTS (
            SELECT 1
            FROM public.tasks AS task
            JOIN public.employees AS employee
              ON employee.id = task.assigned_employee_id
              AND employee.company_id = task.company_id
              AND employee.status = 'active'
            WHERE task.id = v_outbox.aggregate_id
              AND task.company_id = v_outbox.company_id
              AND profile.employee_id = employee.id
              AND profile.company_id = employee.company_id
              AND task.status IN ('pending', 'in_progress')
              AND task.due_at IS NOT NULL
              AND clock_timestamp() < task.due_at
              AND v_outbox.event_key =
                'task.due_30m:' || task.id::text || ':' ||
                to_char(
                  task.due_at AT TIME ZONE 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                )
          )
        )
        OR (
          v_outbox.event_type = 'announcement.published'
          AND EXISTS (
            SELECT 1
            FROM public.announcements AS announcement
            WHERE announcement.id = v_outbox.aggregate_id
              AND announcement.company_id = v_outbox.company_id
              AND (
                announcement.expires_at IS NULL
                OR announcement.expires_at > clock_timestamp()
              )
              AND announcement.created_by_id <> profile.id
              AND (
                coalesce(cardinality(announcement.target_roles), 0) = 0
                OR profile.role = ANY (announcement.target_roles)
              )
          )
        )
        OR (
          v_outbox.event_type = 'maintenance.assigned'
          AND EXISTS (
            SELECT 1
            FROM public.maintenance_tickets AS maintenance
            WHERE maintenance.id = v_outbox.aggregate_id
              AND maintenance.company_id = v_outbox.company_id
              AND maintenance.assigned_to_id = profile.employee_id
          )
        )
        OR (
          v_outbox.event_type IN (
            'maintenance.urgent_created',
            'maintenance.updated',
            'incident.reported',
            'incident.updated',
            'evidence.needs_human_review',
            'evidence.verification_failed'
          )
          AND profile.role IN ('manager', 'owner', 'super_admin')
        )
        OR (
          v_outbox.event_type = 'evidence.submitted'
          AND EXISTS (
            SELECT 1
            FROM public.task_evidence AS evidence
            JOIN public.tasks AS task
              ON task.id = evidence.task_id
              AND task.company_id = evidence.company_id
            WHERE evidence.id = v_outbox.aggregate_id
              AND evidence.company_id = v_outbox.company_id
              AND task.assigned_employee_id = profile.employee_id
          )
        )
        OR (
          v_outbox.event_type IN (
            'evidence.human_approved',
            'evidence.human_rejected'
          )
          AND EXISTS (
            SELECT 1
            FROM public.task_evidence AS evidence
            JOIN public.tasks AS task
              ON task.id = evidence.task_id
              AND task.company_id = evidence.company_id
            WHERE evidence.id = v_outbox.aggregate_id
              AND evidence.company_id = v_outbox.company_id
              AND (
                evidence.submitted_by_profile_id = profile.id
                OR task.assigned_employee_id = profile.employee_id
              )
          )
        )
        OR (
          v_outbox.event_type = 'system.account_ready'
          AND profile.id = v_outbox.aggregate_id
        )
      )
  LOOP
    SELECT
      CASE v_category
        WHEN 'tasks' THEN CASE
          WHEN v_outbox.event_type IN ('task.assigned', 'task.reassigned')
            THEN coalesce(preference.task_assignments, true)
          WHEN v_outbox.event_type = 'task.due_30m'
            THEN coalesce(preference.due_reminders, true)
          ELSE coalesce(preference.task_updates, true)
        END
        WHEN 'announcements' THEN coalesce(preference.announcements, true)
        WHEN 'maintenance' THEN coalesce(preference.maintenance, true)
        WHEN 'incidents' THEN coalesce(preference.incidents, true)
        WHEN 'evidence' THEN coalesce(preference.evidence_review, true)
        ELSE true
      END,
      coalesce(preference.in_app_enabled, true)
    INTO v_allowed, v_in_app
    FROM public.profiles AS profile
    LEFT JOIN public.notification_preferences AS preference
      ON preference.profile_id = profile.id
    WHERE profile.id = v_recipient.profile_id;

    IF v_allowed THEN
      INSERT INTO public.notifications (
        company_id,
        recipient_id,
        title,
        message,
        notification_type,
        related_entity_type,
        related_entity_id,
        status,
        category,
        route,
        event_key,
        is_read
      ) VALUES (
        v_outbox.company_id,
        v_recipient.profile_id,
        v_title,
        v_message,
        v_outbox.event_type,
        v_outbox.aggregate_type,
        v_outbox.aggregate_id,
        CASE WHEN v_in_app THEN 'unread' ELSE 'archived' END,
        v_category,
        v_route,
        v_outbox.event_key,
        NOT v_in_app
      )
      ON CONFLICT (recipient_id, event_key)
        WHERE event_key IS NOT NULL
        DO NOTHING
      RETURNING id INTO v_notification_id;

      IF v_notification_id IS NOT NULL THEN
        v_count := v_count + 1;

        INSERT INTO public.notification_audit (
          company_id,
          notification_id,
          profile_id,
          event_type
        ) VALUES
          (
            v_outbox.company_id,
            v_notification_id,
            v_recipient.profile_id,
            'recipient.resolved'
          ),
          (
            v_outbox.company_id,
            v_notification_id,
            v_recipient.profile_id,
            'notification.created'
          );

        INSERT INTO public.notification_delivery_jobs (
          notification_id,
          subscription_id,
          company_id
        )
        SELECT
          v_notification_id,
          subscription.id,
          v_outbox.company_id
        FROM public.push_subscriptions AS subscription
        JOIN public.notification_preferences AS preference
          ON preference.profile_id = subscription.profile_id
        WHERE subscription.profile_id = v_recipient.profile_id
          AND subscription.company_id = v_outbox.company_id
          AND subscription.revoked_at IS NULL
          AND preference.push_enabled
          AND NOT (
            preference.quiet_hours_enabled
            AND CASE
              WHEN preference.quiet_hours_start <= preference.quiet_hours_end
                THEN
                  (clock_timestamp() AT TIME ZONE preference.timezone)::time
                    >= preference.quiet_hours_start
                  AND
                  (clock_timestamp() AT TIME ZONE preference.timezone)::time
                    < preference.quiet_hours_end
              ELSE
                (clock_timestamp() AT TIME ZONE preference.timezone)::time
                  >= preference.quiet_hours_start
                OR
                (clock_timestamp() AT TIME ZONE preference.timezone)::time
                  < preference.quiet_hours_end
            END
          )
        ON CONFLICT (notification_id, subscription_id) DO NOTHING;

        IF FOUND THEN
          INSERT INTO public.notification_audit (
            company_id,
            notification_id,
            profile_id,
            event_type
          ) VALUES (
            v_outbox.company_id,
            v_notification_id,
            v_recipient.profile_id,
            'push.queued'
          );
        END IF;
      END IF;
    END IF;

    v_notification_id := NULL;
  END LOOP;

  IF v_count = 0 THEN
    INSERT INTO public.notification_audit (
      company_id,
      event_type,
      safe_details
    ) VALUES (
      v_outbox.company_id,
      'recipient.unresolved',
      jsonb_build_object('eventType', v_outbox.event_type)
    );
  END IF;

  UPDATE public.notification_outbox AS outbox
  SET
    status = 'completed',
    lease_token = NULL,
    lease_expires_at = NULL,
    completed_at = clock_timestamp()
  WHERE outbox.id = v_outbox.id;

  RETURN v_count;
END
$function$;
ALTER FUNCTION "public"."materialize_notification_outbox"(p_outbox_id uuid, p_lease_token uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.prepare_device_gateway_repair(p_gateway_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_profile public.profiles%ROWTYPE; v_gateway public.device_gateways%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';
  IF NOT FOUND OR v_profile.role NOT IN ('owner','super_admin') THEN RAISE EXCEPTION 'AGENT_REPAIR_FORBIDDEN'; END IF;
  SELECT * INTO v_gateway FROM public.device_gateways g
    WHERE g.id=p_gateway_id AND g.company_id=v_profile.company_id FOR UPDATE;
  IF NOT FOUND OR v_gateway.location_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.locations l WHERE l.id=v_gateway.location_id AND l.company_id=v_profile.company_id AND l.status='active'
  ) THEN RAISE EXCEPTION 'AGENT_NOT_FOUND'; END IF;
  UPDATE public.device_agent_credentials SET revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_by=coalesce(revoked_by,v_profile.id)
    WHERE gateway_id=v_gateway.id AND revoked_at IS NULL;
  UPDATE public.device_pairing_requests SET revoked_at=clock_timestamp()
    WHERE gateway_id=v_gateway.id AND used_at IS NULL AND revoked_at IS NULL;
  UPDATE public.device_gateway_capabilities SET approved=false,revoked_at=coalesce(revoked_at,clock_timestamp())
    WHERE gateway_id=v_gateway.id AND (approved OR revoked_at IS NULL);
  UPDATE public.device_gateways SET status='unpaired',last_seen_at=NULL,paired_at=NULL,
    agent_version=NULL,platform=NULL,os_version=NULL,hostname_label=NULL WHERE id=v_gateway.id;
  INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,actor_profile_id,event_type,outcome_code)
  VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,v_profile.id,'agent.repair_prepared','PREPARED');
  RETURN true;
END $function$;
ALTER FUNCTION "public"."prepare_device_gateway_repair"(p_gateway_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.prepare_task_evidence_upload(p_task_id uuid, p_location_id uuid, p_source_type text, p_original_mime_type text, p_original_size_bytes bigint, p_original_sha256 text, p_idempotency_key uuid)
 RETURNS TABLE(evidence_id uuid, storage_path text, upload_status text, is_duplicate boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_task public.tasks%ROWTYPE;
  v_existing public.task_evidence%ROWTYPE;
  v_evidence_id uuid := gen_random_uuid();
  v_extension text;
  v_path text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT pr.* INTO v_profile
    FROM public.profiles AS pr
   WHERE pr.id = auth.uid() AND pr.status = 'active';
  IF NOT FOUND OR v_profile.role NOT IN ('employee', 'manager', 'owner', 'super_admin') OR v_profile.company_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_PROVISIONED';
  END IF;

  SELECT t.* INTO v_task
    FROM public.tasks AS t
   WHERE t.id = p_task_id AND t.company_id = v_profile.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_AVAILABLE'; END IF;

  IF v_profile.role = 'employee' AND (
    v_profile.employee_id IS NULL OR v_task.assigned_employee_id IS DISTINCT FROM v_profile.employee_id
  ) THEN RAISE EXCEPTION 'TASK_NOT_ASSIGNED'; END IF;

  IF v_profile.employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.employees AS emp
     WHERE emp.id = v_profile.employee_id AND emp.company_id = v_profile.company_id
  ) THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_LINK'; END IF;

  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations AS loc
     WHERE loc.id = p_location_id AND loc.company_id = v_profile.company_id
  ) THEN RAISE EXCEPTION 'LOCATION_NOT_AVAILABLE'; END IF;

  IF p_source_type NOT IN ('mobile_camera', 'gallery_upload')
     OR p_original_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
     OR p_original_size_bytes <= 0 OR p_original_size_bytes > 20971520
     OR p_original_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE_METADATA';
  END IF;

  SELECT ev.* INTO v_existing
    FROM public.task_evidence AS ev
   WHERE ev.submitted_by_profile_id = auth.uid() AND ev.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.task_id <> p_task_id OR v_existing.location_id IS DISTINCT FROM p_location_id
       OR v_existing.source_type <> p_source_type OR v_existing.original_mime_type <> p_original_mime_type
       OR v_existing.original_size_bytes <> p_original_size_bytes OR v_existing.original_sha256 <> lower(p_original_sha256) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.original_storage_path, v_existing.status, true;
    RETURN;
  END IF;

  SELECT ev.* INTO v_existing
    FROM public.task_evidence AS ev
   WHERE ev.company_id = v_profile.company_id AND ev.task_id = p_task_id
     AND ev.original_sha256 = lower(p_original_sha256)
     AND ev.submitted_by_profile_id = auth.uid();
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.original_storage_path, v_existing.status, true;
    RETURN;
  END IF;

  v_extension := CASE p_original_mime_type
    WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp'
    WHEN 'image/heic' THEN 'heic' WHEN 'image/heif' THEN 'heif' END;
  v_path := v_profile.company_id::text || '/' || p_task_id::text || '/' || v_evidence_id::text || '/original.' || v_extension;

  INSERT INTO public.task_evidence (
    id, company_id, task_id, location_id, submitted_by_profile_id, submitted_by_employee_id,
    source_type, original_storage_path, original_mime_type, original_size_bytes,
    original_sha256, idempotency_key
  ) VALUES (
    v_evidence_id, v_profile.company_id, p_task_id, p_location_id, v_profile.id, v_profile.employee_id,
    p_source_type, v_path, p_original_mime_type, p_original_size_bytes,
    lower(p_original_sha256), p_idempotency_key
  );
  INSERT INTO public.task_evidence_audit (evidence_id, company_id, actor_profile_id, event_type)
  VALUES (v_evidence_id, v_profile.company_id, v_profile.id, 'upload.prepared');

  RETURN QUERY SELECT v_evidence_id, v_path, 'pending_upload'::text, false;
END;
$function$;
ALTER FUNCTION "public"."prepare_task_evidence_upload"(p_task_id uuid, p_location_id uuid, p_source_type text, p_original_mime_type text, p_original_size_bytes bigint, p_original_sha256 text, p_idempotency_key uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.reject_brain_action_proposal(p_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.brain_action_proposals set status='expired'
   where id=p_id and actor_id=p_actor_id and profile_id=p_profile_id and tenant_id=p_tenant_id and status='pending' and expires_at <= now();
  update public.brain_action_proposals set status='rejected', rejected_at=now()
   where id=p_id and actor_id=p_actor_id and profile_id=p_profile_id and tenant_id=p_tenant_id and status='pending' and expires_at > now();
  if found then return 'rejected'; end if;
  if exists(select 1 from public.brain_action_proposals where id=p_id and actor_id=p_actor_id and profile_id=p_profile_id and tenant_id=p_tenant_id) then return 'invalid_status'; end if;
  return 'not_found';
end $function$;
ALTER FUNCTION "public"."reject_brain_action_proposal"(p_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.resolve_device_agent_rate_identity(p_public_agent_id uuid, p_credential_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_credential_id uuid;
BEGIN
  IF p_credential_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT c.id INTO v_credential_id FROM public.device_agent_credentials c
  WHERE c.public_agent_id=p_public_agent_id AND c.credential_hash=p_credential_hash AND c.revoked_at IS NULL;
  RETURN v_credential_id;
END $function$;
ALTER FUNCTION "public"."resolve_device_agent_rate_identity"(p_public_agent_id uuid, p_credential_hash text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.review_task_evidence(p_evidence_id uuid, p_decision text, p_note text, p_confirm boolean)
 RETURNS TABLE(evidence_id uuid, evidence_status text, task_status_unchanged boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_profile public.profiles%ROWTYPE; v_ev public.task_evidence%ROWTYPE; v_task_status text;
BEGIN
 IF p_confirm IS NOT TRUE OR p_decision NOT IN ('approved','rejected') OR length(coalesce(p_note,''))>1000 THEN RAISE EXCEPTION 'INVALID_REVIEW'; END IF;
 SELECT pr.* INTO v_profile FROM public.profiles pr WHERE pr.id=auth.uid() AND pr.status='active' AND pr.role IN ('manager','owner','super_admin');
 IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_NOT_AUTHORIZED'; END IF;
 SELECT ev.* INTO v_ev FROM public.task_evidence ev WHERE ev.id=p_evidence_id AND ev.company_id=v_profile.company_id AND ev.status IN ('ai_verified','ai_rejected','needs_human_review','verification_failed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_NOT_REVIEWABLE'; END IF;
 SELECT t.status INTO v_task_status FROM public.tasks t WHERE t.id=v_ev.task_id AND t.company_id=v_ev.company_id;
 INSERT INTO public.task_evidence_reviews(evidence_id,company_id,reviewer_profile_id,decision,note) VALUES(v_ev.id,v_ev.company_id,v_profile.id,p_decision,nullif(btrim(p_note),''));
 UPDATE public.task_evidence SET status=CASE p_decision WHEN 'approved' THEN 'human_approved' ELSE 'human_rejected' END WHERE id=v_ev.id;
 INSERT INTO public.task_evidence_audit(evidence_id,company_id,actor_profile_id,event_type,safe_details) VALUES(v_ev.id,v_ev.company_id,v_profile.id,CASE p_decision WHEN 'approved' THEN 'review.approved' ELSE 'review.rejected' END,jsonb_build_object('has_note',nullif(btrim(p_note),'') IS NOT NULL));
 RETURN QUERY SELECT v_ev.id,(SELECT ev.status FROM public.task_evidence ev WHERE ev.id=v_ev.id),(SELECT t.status=v_task_status FROM public.tasks t WHERE t.id=v_ev.task_id);
END $function$;
ALTER FUNCTION "public"."review_task_evidence"(p_evidence_id uuid, p_decision text, p_note text, p_confirm boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.revoke_device_agent(p_gateway_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_profile public.profiles%ROWTYPE; v_gateway public.device_gateways%ROWTYPE; v_count integer;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';
  IF NOT FOUND OR v_profile.role NOT IN ('owner','super_admin') THEN RAISE EXCEPTION 'AGENT_REVOCATION_FORBIDDEN'; END IF;
  SELECT * INTO v_gateway FROM public.device_gateways g WHERE g.id=p_gateway_id AND g.company_id=v_profile.company_id FOR UPDATE;
  IF NOT FOUND OR v_gateway.location_id IS NULL THEN RAISE EXCEPTION 'AGENT_NOT_FOUND'; END IF;
  UPDATE public.device_agent_credentials SET revoked_at=clock_timestamp(),revoked_by=v_profile.id WHERE gateway_id=v_gateway.id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  UPDATE public.device_gateway_capabilities SET approved=false,revoked_at=clock_timestamp() WHERE gateway_id=v_gateway.id AND approved;
  UPDATE public.device_gateways SET status='disabled' WHERE id=v_gateway.id;
  INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,actor_profile_id,event_type,outcome_code)
  VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,v_profile.id,'agent.revoked',CASE WHEN v_count>0 THEN 'REVOKED' ELSE 'ALREADY_REVOKED' END);
  RETURN v_count>0;
END $function$;
ALTER FUNCTION "public"."revoke_device_agent"(p_gateway_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.revoke_device_pairing_request(p_gateway_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_profile public.profiles%ROWTYPE; v_gateway public.device_gateways%ROWTYPE; v_count integer;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';
  IF NOT FOUND OR v_profile.role NOT IN ('owner','super_admin') THEN RAISE EXCEPTION 'PAIRING_FORBIDDEN'; END IF;
  SELECT * INTO v_gateway FROM public.device_gateways g WHERE g.id=p_gateway_id AND g.company_id=v_profile.company_id FOR UPDATE;
  IF NOT FOUND OR v_gateway.location_id IS NULL THEN RAISE EXCEPTION 'PAIRING_GATEWAY_UNAVAILABLE'; END IF;
  UPDATE public.device_pairing_requests SET revoked_at=clock_timestamp()
    WHERE gateway_id=v_gateway.id AND used_at IS NULL AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count>0 THEN
    UPDATE public.device_gateways SET status='unpaired' WHERE id=v_gateway.id AND status='pairing';
    INSERT INTO public.device_agent_audit(company_id,location_id,gateway_id,actor_profile_id,event_type,outcome_code)
    VALUES(v_gateway.company_id,v_gateway.location_id,v_gateway.id,v_profile.id,'pairing.revoked','REVOKED');
  END IF;
  RETURN v_count>0;
END $function$;
ALTER FUNCTION "public"."revoke_device_pairing_request"(p_gateway_id uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.revoke_my_push_subscription(p_endpoint text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid;BEGIN SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;UPDATE public.push_subscriptions s SET revoked_at=clock_timestamp() WHERE s.profile_id=auth.uid() AND s.company_id=v_company AND s.endpoint=p_endpoint;INSERT INTO public.notification_audit(company_id,profile_id,event_type) VALUES(v_company,auth.uid(),'subscription.revoked');END $function$;
ALTER FUNCTION "public"."revoke_my_push_subscription"(p_endpoint text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.save_my_notification_preferences(p_preferences jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.profiles%ROWTYPE;v_timezone text:=coalesce(nullif(p_preferences->>'timezone',''),'UTC');BEGIN SELECT pr.* INTO p FROM public.profiles pr WHERE pr.id=auth.uid() AND pr.status='active';IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=v_timezone) THEN RAISE EXCEPTION 'INVALID_TIMEZONE';END IF;
 INSERT INTO public.notification_preferences(profile_id,company_id,in_app_enabled,push_enabled,task_assignments,task_updates,due_reminders,announcements,maintenance,incidents,evidence_review,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,timezone)
 VALUES(p.id,p.company_id,coalesce((p_preferences->>'inAppEnabled')::boolean,true),coalesce((p_preferences->>'pushEnabled')::boolean,false),coalesce((p_preferences->>'taskAssignments')::boolean,true),coalesce((p_preferences->>'taskUpdates')::boolean,true),coalesce((p_preferences->>'dueReminders')::boolean,true),coalesce((p_preferences->>'announcements')::boolean,true),coalesce((p_preferences->>'maintenance')::boolean,true),coalesce((p_preferences->>'incidents')::boolean,true),coalesce((p_preferences->>'evidenceReview')::boolean,true),coalesce((p_preferences->>'quietHoursEnabled')::boolean,false),(p_preferences->>'quietHoursStart')::time,(p_preferences->>'quietHoursEnd')::time,v_timezone)
 ON CONFLICT(profile_id) DO UPDATE SET in_app_enabled=excluded.in_app_enabled,push_enabled=excluded.push_enabled,task_assignments=excluded.task_assignments,task_updates=excluded.task_updates,due_reminders=excluded.due_reminders,announcements=excluded.announcements,maintenance=excluded.maintenance,incidents=excluded.incidents,evidence_review=excluded.evidence_review,quiet_hours_enabled=excluded.quiet_hours_enabled,quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,timezone=excluded.timezone,updated_at=clock_timestamp();END $function$;
ALTER FUNCTION "public"."save_my_notification_preferences"(p_preferences jsonb) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.save_my_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.profiles%ROWTYPE;v_id uuid;BEGIN SELECT pr.* INTO p FROM public.profiles pr WHERE pr.id=auth.uid() AND pr.status='active';IF NOT FOUND OR length(p_endpoint)>2048 OR length(p_p256dh)>512 OR length(p_auth)>512 OR p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[^/]+\.notify\.windows\.com)/' THEN RAISE EXCEPTION 'INVALID_SUBSCRIPTION';END IF;
 INSERT INTO public.push_subscriptions(company_id,profile_id,endpoint,p256dh,auth_key,user_agent_family) VALUES(p.company_id,p.id,p_endpoint,p_p256dh,p_auth,left(p_device,80)) ON CONFLICT(profile_id,endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth_key=excluded.auth_key,user_agent_family=excluded.user_agent_family,revoked_at=NULL,last_seen_at=clock_timestamp() RETURNING id INTO v_id;
 INSERT INTO public.notification_preferences(profile_id,company_id,push_enabled) VALUES(p.id,p.company_id,true) ON CONFLICT(profile_id) DO UPDATE SET push_enabled=true,updated_at=clock_timestamp();INSERT INTO public.notification_audit(company_id,profile_id,event_type) VALUES(p.company_id,p.id,'subscription.created');RETURN v_id;END $function$;
ALTER FUNCTION "public"."save_my_push_subscription"(p_endpoint text, p_p256dh text, p_auth text, p_device text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.update_my_notification(p_notification_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid;
BEGIN SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id=auth.uid() AND p.status='active';IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;
 UPDATE public.notifications n SET status=CASE p_action WHEN 'read' THEN 'read' WHEN 'archive' THEN 'archived' ELSE n.status END,is_read=CASE WHEN p_action IN('read','archive') THEN true ELSE n.is_read END,
 read_at=CASE WHEN p_action IN('read','archive') THEN coalesce(n.read_at,clock_timestamp()) ELSE n.read_at END,archived_at=CASE WHEN p_action='archive' THEN clock_timestamp() ELSE n.archived_at END,updated_at=clock_timestamp()
 WHERE n.id=p_notification_id AND n.recipient_id=auth.uid() AND n.company_id=v_company;IF NOT FOUND OR p_action NOT IN('read','archive') THEN RAISE EXCEPTION 'NOT_AVAILABLE';END IF;
 INSERT INTO public.notification_audit(company_id,notification_id,profile_id,event_type) VALUES(v_company,p_notification_id,auth.uid(),CASE p_action WHEN 'read' THEN 'notification.read' ELSE 'notification.archived' END);
END $function$;
ALTER FUNCTION "public"."update_my_notification"(p_notification_id uuid, p_action text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.update_my_preferred_language(p_language text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_language text := lower(btrim(p_language));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF v_language NOT IN ('en', 'ar') THEN
    RAISE EXCEPTION 'INVALID_LANGUAGE' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles AS p
  SET preferred_language = v_language, updated_at = clock_timestamp()
  WHERE p.id = auth.uid() AND p.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_PROVISIONED' USING ERRCODE = '42501';
  END IF;
  RETURN v_language;
END;
$function$;
ALTER FUNCTION "public"."update_my_preferred_language"(p_language text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.update_own_full_name(new_full_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  user_id uuid;
begin
  user_id := auth.uid();
  if user_id is null then
    raise exception 'Not authenticated';
  end if;
  
  -- Verify user is active before allowing update
  if not exists(select 1 from public.profiles where id = user_id and status = 'active') then
    raise exception 'User account is not active';
  end if;
  
  -- Update ONLY full_name for the current user
  update public.profiles 
  set full_name = new_full_name, updated_at = now()
  where id = user_id;
end;
$function$;
ALTER FUNCTION "public"."update_own_full_name"(new_full_name text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.update_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
ALTER FUNCTION "public"."update_timestamp"() OWNER TO "postgres";

-- Captured primary, unique, check, and exclusion constraints.
ALTER TABLE "public"."activity_timeline" ADD CONSTRAINT "activity_timeline_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."announcement_acknowledgments" ADD CONSTRAINT "announcement_acknowledgments_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."announcements" ADD CONSTRAINT "announcements_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."attendance_records" ADD CONSTRAINT "attendance_records_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."brain_action_proposals" ADD CONSTRAINT "brain_action_proposals_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."brain_chat_user_quotas" ADD CONSTRAINT "brain_chat_user_quotas_pkey" PRIMARY KEY (user_id);
ALTER TABLE "public"."brain_domain_events" ADD CONSTRAINT "brain_domain_events_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."cameras" ADD CONSTRAINT "cameras_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."d1_employee_migration_checkpoints" ADD CONSTRAINT "d1_employee_migration_checkpoints_pkey" PRIMARY KEY (migration_name);
ALTER TABLE "public"."departments" ADD CONSTRAINT "departments_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."device_agent_audit" ADD CONSTRAINT "device_agent_audit_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."device_agent_credentials" ADD CONSTRAINT "device_agent_credentials_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."device_agent_rate_limits" ADD CONSTRAINT "device_agent_rate_limits_pkey" PRIMARY KEY (scope, identifier_hash);
ALTER TABLE "public"."device_capability_catalog" ADD CONSTRAINT "device_capability_catalog_pkey" PRIMARY KEY (capability_code);
ALTER TABLE "public"."device_configuration_audit" ADD CONSTRAINT "device_configuration_audit_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."device_gateway_capabilities" ADD CONSTRAINT "device_gateway_capabilities_pkey" PRIMARY KEY (gateway_id, capability_code);
ALTER TABLE "public"."device_gateways" ADD CONSTRAINT "device_gateways_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."device_pairing_requests" ADD CONSTRAINT "device_pairing_requests_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."employee_migration_exceptions" ADD CONSTRAINT "employee_migration_exceptions_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."incident_reports" ADD CONSTRAINT "incident_reports_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."locations" ADD CONSTRAINT "locations_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."notification_audit" ADD CONSTRAINT "notification_audit_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."notification_delivery_jobs" ADD CONSTRAINT "notification_delivery_jobs_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."notification_outbox" ADD CONSTRAINT "notification_outbox_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY (profile_id);
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."open_shifts" ADD CONSTRAINT "open_shifts_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."recurring_shifts" ADD CONSTRAINT "recurring_shifts_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."roles" ADD CONSTRAINT "roles_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."shift_swaps" ADD CONSTRAINT "shift_swaps_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."shift_templates" ADD CONSTRAINT "shift_templates_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."shifts" ADD CONSTRAINT "shifts_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."task_evidence_audit" ADD CONSTRAINT "task_evidence_audit_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."task_evidence_derivatives" ADD CONSTRAINT "task_evidence_derivatives_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."task_evidence_reviews" ADD CONSTRAINT "task_evidence_reviews_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."task_evidence_verification_jobs" ADD CONSTRAINT "task_evidence_verification_jobs_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."task_localization_jobs" ADD CONSTRAINT "task_localization_jobs_pkey" PRIMARY KEY (task_id, language);
ALTER TABLE "public"."task_localizations" ADD CONSTRAINT "task_localizations_pkey" PRIMARY KEY (task_id, language);
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."time_off_requests" ADD CONSTRAINT "time_off_requests_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "weekly_schedules_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."announcement_acknowledgments" ADD CONSTRAINT "announcement_acknowledgments_announcement_id_employee_id_key" UNIQUE (announcement_id, employee_id);
ALTER TABLE "public"."brain_action_proposals" ADD CONSTRAINT "brain_action_proposals_id_payload_hash_key" UNIQUE (id, payload_hash);
ALTER TABLE "public"."brain_action_proposals" ADD CONSTRAINT "brain_action_proposals_idempotency_key_key" UNIQUE (idempotency_key);
ALTER TABLE "public"."brain_domain_events" ADD CONSTRAINT "brain_domain_events_one_type_per_command" UNIQUE (command_id, event_type);
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_one_type_per_command" UNIQUE (command_id, event_type);
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_tenant_idempotency" UNIQUE (company_id, idempotency_key);
ALTER TABLE "public"."cameras" ADD CONSTRAINT "cameras_nvr_channel_unique" UNIQUE (nvr_connection_id, external_channel_id);
ALTER TABLE "public"."device_gateways" ADD CONSTRAINT "device_gateways_company_id_id_unique" UNIQUE (company_id, id);
ALTER TABLE "public"."employee_migration_exceptions" ADD CONSTRAINT "employee_migration_exceptions_employee_field_key" UNIQUE (employee_id, field_name);
ALTER TABLE "public"."notification_delivery_jobs" ADD CONSTRAINT "notification_delivery_jobs_notification_id_subscription_id_key" UNIQUE (notification_id, subscription_id);
ALTER TABLE "public"."notification_outbox" ADD CONSTRAINT "notification_outbox_company_id_event_key_key" UNIQUE (company_id, event_key);
ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_profile_id_endpoint_key" UNIQUE (profile_id, endpoint);
ALTER TABLE "public"."roles" ADD CONSTRAINT "roles_company_id_name_key" UNIQUE (company_id, name);
ALTER TABLE "public"."task_evidence_derivatives" ADD CONSTRAINT "task_evidence_derivatives_evidence_id_derivative_type_key" UNIQUE (evidence_id, derivative_type);
ALTER TABLE "public"."task_evidence_derivatives" ADD CONSTRAINT "task_evidence_derivatives_storage_path_key" UNIQUE (storage_path);
ALTER TABLE "public"."task_evidence_reviews" ADD CONSTRAINT "task_evidence_reviews_evidence_id_key" UNIQUE (evidence_id);
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_job_id_attempt_number_key" UNIQUE (job_id, attempt_number);
ALTER TABLE "public"."task_evidence_verification_jobs" ADD CONSTRAINT "task_evidence_verification_jobs_evidence_id_cycle_number_key" UNIQUE (evidence_id, cycle_number);
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_company_id_task_id_original_sha256_key" UNIQUE (company_id, task_id, original_sha256);
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_original_storage_path_key" UNIQUE (original_storage_path);
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_submitted_by_profile_id_idempotency_key_key" UNIQUE (submitted_by_profile_id, idempotency_key);
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "weekly_schedules_company_id_employee_id_week_start_date_key" UNIQUE (company_id, employee_id, week_start_date);
ALTER TABLE "public"."activity_timeline" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."announcement_acknowledgments" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."announcements" ADD CONSTRAINT "announcements_priority_check" CHECK (priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]));
ALTER TABLE "public"."announcements" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."attendance_records" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."brain_action_proposals" ADD CONSTRAINT "brain_action_proposals_check" CHECK (expires_at > created_at);
ALTER TABLE "public"."brain_action_proposals" ADD CONSTRAINT "brain_action_proposals_payload_hash_check" CHECK (payload_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."brain_action_proposals" ADD CONSTRAINT "brain_action_proposals_risk_check" CHECK (risk = ANY (ARRAY['medium'::text, 'high'::text]));
ALTER TABLE "public"."brain_action_proposals" ADD CONSTRAINT "brain_action_proposals_schema_version_check" CHECK (schema_version > 0);
ALTER TABLE "public"."brain_action_proposals" ADD CONSTRAINT "brain_action_proposals_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'executing'::text, 'executed'::text, 'rejected'::text, 'expired'::text, 'failed'::text]));
ALTER TABLE "public"."brain_chat_user_quotas" ADD CONSTRAINT "brain_chat_quota_window_exact" CHECK (window_resets_at = (window_started_at + '01:00:00'::interval));
ALTER TABLE "public"."brain_chat_user_quotas" ADD CONSTRAINT "brain_chat_user_quotas_request_count_check" CHECK (request_count >= 1 AND request_count <= 100);
ALTER TABLE "public"."brain_domain_events" ADD CONSTRAINT "brain_domain_events_schema_version_check" CHECK (schema_version > 0);
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_aggregate_type_check" CHECK (aggregate_type = 'task'::text);
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_delivery_state" CHECK (delivery_status = 'pending'::text AND delivered_at IS NULL OR delivery_status = 'delivered'::text AND delivered_at IS NOT NULL);
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_delivery_status_check" CHECK (delivery_status = ANY (ARRAY['pending'::text, 'delivered'::text]));
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_event_type_check" CHECK (event_type = 'task.created'::text);
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_idempotency_key_check" CHECK (idempotency_key ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_schema_version_check" CHECK (schema_version = 1);
ALTER TABLE "public"."cameras" ADD CONSTRAINT "cameras_area_check" CHECK (area IS NULL OR char_length(area) <= 120);
ALTER TABLE "public"."cameras" ADD CONSTRAINT "cameras_department_check" CHECK (department IS NULL OR char_length(department) <= 120);
ALTER TABLE "public"."cameras" ADD CONSTRAINT "cameras_external_channel_id_check" CHECK (char_length(btrim(external_channel_id)) >= 1 AND char_length(btrim(external_channel_id)) <= 120);
ALTER TABLE "public"."cameras" ADD CONSTRAINT "cameras_name_check" CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 120);
ALTER TABLE "public"."cameras" ADD CONSTRAINT "cameras_status_check" CHECK (status = ANY (ARRAY['unconfigured'::text, 'offline'::text, 'online'::text, 'disabled'::text, 'error'::text]));
ALTER TABLE "public"."cameras" ADD CONSTRAINT "cameras_stream_profile_check" CHECK (stream_profile IS NULL OR (stream_profile = ANY (ARRAY['main'::text, 'sub'::text])));
ALTER TABLE "public"."d1_employee_migration_checkpoints" ADD CONSTRAINT "d1_employee_migration_checkpoints_aggregate_counts_check" CHECK (jsonb_typeof(aggregate_counts) = 'object'::text);
ALTER TABLE "public"."d1_employee_migration_checkpoints" ADD CONSTRAINT "d1_employee_migration_checkpoints_approval_reference_check" CHECK (btrim(approval_reference) <> ''::text);
ALTER TABLE "public"."d1_employee_migration_checkpoints" ADD CONSTRAINT "d1_employee_migration_checkpoints_baseline_version_check" CHECK (baseline_version = 1);
ALTER TABLE "public"."d1_employee_migration_checkpoints" ADD CONSTRAINT "d1_employee_migration_checkpoints_catalog_fingerprint_check" CHECK (catalog_fingerprint ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."device_agent_audit" ADD CONSTRAINT "device_agent_audit_event_type_check" CHECK (event_type = ANY (ARRAY['gateway.created'::text, 'pairing.created'::text, 'pairing.revoked'::text, 'agent.paired'::text, 'agent.revoked'::text, 'agent.authentication_failed'::text, 'agent.repair_prepared'::text, 'capability.unknown_declared'::text]));
ALTER TABLE "public"."device_agent_audit" ADD CONSTRAINT "device_agent_audit_outcome_code_check" CHECK (outcome_code ~ '^[A-Z0-9_]{2,80}$'::text);
ALTER TABLE "public"."device_agent_credentials" ADD CONSTRAINT "device_agent_credentials_credential_hash_check" CHECK (credential_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."device_agent_credentials" ADD CONSTRAINT "device_agent_credentials_token_version_check" CHECK (token_version = 1);
ALTER TABLE "public"."device_agent_rate_limits" ADD CONSTRAINT "device_agent_rate_limits_identifier_hash_check" CHECK (identifier_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."device_agent_rate_limits" ADD CONSTRAINT "device_agent_rate_limits_request_count_check" CHECK (request_count > 0);
ALTER TABLE "public"."device_agent_rate_limits" ADD CONSTRAINT "device_agent_rate_limits_scope_check" CHECK (scope = ANY (ARRAY['pairing'::text, 'credential'::text, 'heartbeat'::text]));
ALTER TABLE "public"."device_agent_rate_limits" ADD CONSTRAINT "device_agent_rate_window" CHECK (window_resets_at > window_started_at);
ALTER TABLE "public"."device_capability_catalog" ADD CONSTRAINT "device_capability_catalog_capability_code_check" CHECK (capability_code ~ '^[a-z][a-z0-9_.-]{2,79}$'::text);
ALTER TABLE "public"."device_capability_catalog" ADD CONSTRAINT "device_capability_catalog_protocol_version_check" CHECK (protocol_version > 0);
ALTER TABLE "public"."device_capability_catalog" ADD CONSTRAINT "device_capability_catalog_risk_class_check" CHECK (risk_class = ANY (ARRAY['core'::text, 'read'::text, 'write'::text, 'sensitive'::text]));
ALTER TABLE "public"."device_configuration_audit" ADD CONSTRAINT "device_configuration_audit_action_check" CHECK (action = ANY (ARRAY['created'::text, 'updated'::text, 'deleted'::text]));
ALTER TABLE "public"."device_configuration_audit" ADD CONSTRAINT "device_configuration_audit_entity_type_check" CHECK (entity_type = ANY (ARRAY['nvr_connection'::text, 'camera'::text]));
ALTER TABLE "public"."device_gateway_capabilities" ADD CONSTRAINT "device_gateway_capabilities_declared_version_check" CHECK (declared_version > 0);
ALTER TABLE "public"."device_gateway_capabilities" ADD CONSTRAINT "device_gateway_capability_grant_state" CHECK (approved AND granted_at IS NOT NULL AND revoked_at IS NULL OR NOT approved);
ALTER TABLE "public"."device_gateways" ADD CONSTRAINT "device_gateways_agent_version_check" CHECK (agent_version IS NULL OR char_length(agent_version) <= 80);
ALTER TABLE "public"."device_gateways" ADD CONSTRAINT "device_gateways_gateway_type_check" CHECK (gateway_type = 'brain_agent'::text);
ALTER TABLE "public"."device_gateways" ADD CONSTRAINT "device_gateways_hostname_label_check" CHECK (hostname_label IS NULL OR hostname_label ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$'::text);
ALTER TABLE "public"."device_gateways" ADD CONSTRAINT "device_gateways_name_check" CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 120);
ALTER TABLE "public"."device_gateways" ADD CONSTRAINT "device_gateways_os_version_check" CHECK (os_version IS NULL OR char_length(os_version) >= 1 AND char_length(os_version) <= 80);
ALTER TABLE "public"."device_gateways" ADD CONSTRAINT "device_gateways_platform_check" CHECK (platform IS NULL OR char_length(platform) >= 1 AND char_length(platform) <= 40);
ALTER TABLE "public"."device_gateways" ADD CONSTRAINT "device_gateways_status_check" CHECK (status = ANY (ARRAY['unpaired'::text, 'pairing'::text, 'online'::text, 'offline'::text, 'disabled'::text, 'error'::text]));
ALTER TABLE "public"."device_pairing_requests" ADD CONSTRAINT "device_pairing_request_expiry" CHECK (expires_at > created_at);
ALTER TABLE "public"."device_pairing_requests" ADD CONSTRAINT "device_pairing_request_terminal" CHECK (used_at IS NULL OR revoked_at IS NULL);
ALTER TABLE "public"."device_pairing_requests" ADD CONSTRAINT "device_pairing_requests_code_hash_check" CHECK (code_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."employee_migration_exceptions" ADD CONSTRAINT "employee_migration_exceptions_field_name_check" CHECK (field_name = ANY (ARRAY['status'::text, 'employment_type'::text, 'role'::text, 'department'::text]));
ALTER TABLE "public"."employee_migration_exceptions" ADD CONSTRAINT "employee_migration_exceptions_resolution_status_check" CHECK (resolution_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]));
ALTER TABLE "public"."employee_migration_exceptions" ADD CONSTRAINT "employee_migration_exceptions_source_value_hash_check" CHECK (source_value_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_archive_shape" CHECK (lifecycle_status IS DISTINCT FROM 'archived'::text OR archived_at IS NOT NULL);
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_lifecycle_status_check" CHECK (lifecycle_status IS NULL OR (lifecycle_status = ANY (ARRAY['draft'::text, 'active'::text, 'on_leave'::text, 'inactive'::text, 'terminated'::text, 'archived'::text])));
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_version_positive" CHECK (version > 0);
ALTER TABLE "public"."incident_reports" ADD CONSTRAINT "incident_reports_incident_type_check" CHECK (incident_type = ANY (ARRAY['guest_injury'::text, 'employee_injury'::text, 'fight'::text, 'power_outage'::text, 'equipment_failure'::text, 'lost_item'::text, 'other'::text]));
ALTER TABLE "public"."incident_reports" ADD CONSTRAINT "incident_reports_severity_check" CHECK (severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]));
ALTER TABLE "public"."incident_reports" ADD CONSTRAINT "incident_reports_status_check" CHECK (status = ANY (ARRAY['open'::text, 'investigating'::text, 'resolved'::text, 'closed'::text]));
ALTER TABLE "public"."incident_reports" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_priority_check" CHECK (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]));
ALTER TABLE "public"."maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_status_check" CHECK (status = ANY (ARRAY['open'::text, 'assigned'::text, 'in_progress'::text, 'waiting_parts'::text, 'completed'::text, 'cancelled'::text]));
ALTER TABLE "public"."maintenance_tickets" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."notification_delivery_jobs" ADD CONSTRAINT "notification_delivery_jobs_attempt_count_check" CHECK (attempt_count >= 0 AND attempt_count <= 5);
ALTER TABLE "public"."notification_delivery_jobs" ADD CONSTRAINT "notification_delivery_jobs_check" CHECK ((status = 'processing'::text) = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL));
ALTER TABLE "public"."notification_delivery_jobs" ADD CONSTRAINT "notification_delivery_jobs_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'delivered'::text, 'failed'::text]));
ALTER TABLE "public"."notification_outbox" ADD CONSTRAINT "notification_outbox_attempt_count_check" CHECK (attempt_count >= 0 AND attempt_count <= 5);
ALTER TABLE "public"."notification_outbox" ADD CONSTRAINT "notification_outbox_check" CHECK ((status = 'processing'::text) = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL));
ALTER TABLE "public"."notification_outbox" ADD CONSTRAINT "notification_outbox_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]));
ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "notification_preferences_check" CHECK (NOT quiet_hours_enabled OR quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL);
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_n1_category_check" CHECK (category = ANY (ARRAY['tasks'::text, 'announcements'::text, 'maintenance'::text, 'incidents'::text, 'evidence'::text, 'system'::text]));
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_n1_route_check" CHECK (route = ANY (ARRAY['/dashboard'::text, '/dashboard/tasks'::text, '/dashboard/announcements'::text, '/dashboard/maintenance'::text, '/dashboard/incidents'::text, '/dashboard/evidence-review'::text, '/dashboard/settings'::text]));
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_n1_status_check" CHECK (status = ANY (ARRAY['unread'::text, 'read'::text, 'archived'::text]));
ALTER TABLE "public"."notifications" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_http_port_check" CHECK (http_port >= 1 AND http_port <= 65535);
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_last_error_code_check" CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 80);
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_local_host_valid" CHECK (private.is_valid_camera_local_host(local_host));
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_name_check" CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 120);
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_onvif_port_check" CHECK (onvif_port >= 1 AND onvif_port <= 65535);
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_password_secret_reference_check" CHECK (password_secret_reference IS NULL OR password_secret_reference ~ '^[A-Za-z0-9][A-Za-z0-9/_-]{2,127}$'::text);
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_rtsp_port_check" CHECK (rtsp_port >= 1 AND rtsp_port <= 65535);
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_status_check" CHECK (status = ANY (ARRAY['unconfigured'::text, 'configured'::text, 'offline'::text, 'online'::text, 'error'::text]));
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_username_secret_reference_check" CHECK (username_secret_reference IS NULL OR username_secret_reference ~ '^[A-Za-z0-9][A-Za-z0-9/_-]{2,127}$'::text);
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_vendor_check" CHECK (char_length(btrim(vendor)) >= 1 AND char_length(btrim(vendor)) <= 80);
ALTER TABLE "public"."open_shifts" ADD CONSTRAINT "open_shifts_status_check" CHECK (status = ANY (ARRAY['open'::text, 'filled'::text, 'cancelled'::text]));
ALTER TABLE "public"."open_shifts" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_preferred_language_check" CHECK (preferred_language = ANY (ARRAY['en'::text, 'ar'::text]));
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_role_check" CHECK (role = ANY (ARRAY['super_admin'::text, 'owner'::text, 'manager'::text, 'employee'::text]));
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_status_check" CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'suspended'::text]));
ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_check" CHECK (length(endpoint) <= 2048 AND length(p256dh) <= 512 AND length(auth_key) <= 512);
ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_endpoint_check" CHECK (endpoint ~ '^[REDACTED_URL_OR_CONNECTION_STRING]\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[^/]+\.notify\.windows\.com)/'::text);
ALTER TABLE "public"."recurring_shifts" ADD CONSTRAINT "recurring_shifts_day_of_week_check" CHECK (day_of_week >= 0 AND day_of_week <= 6);
ALTER TABLE "public"."recurring_shifts" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."roles" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."shift_swaps" ADD CONSTRAINT "shift_swaps_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]));
ALTER TABLE "public"."shift_swaps" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."shift_templates" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."shifts" ADD CONSTRAINT "shifts_shift_type_check" CHECK (shift_type = ANY (ARRAY['morning'::text, 'afternoon'::text, 'evening'::text, 'night'::text, 'custom'::text]));
ALTER TABLE "public"."shifts" ADD CONSTRAINT "shifts_status_check" CHECK (status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text]));
ALTER TABLE "public"."shifts" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."task_evidence_audit" ADD CONSTRAINT "task_evidence_audit_actor_type_check" CHECK (actor_type = ANY (ARRAY['human'::text, 'system'::text]));
ALTER TABLE "public"."task_evidence_audit" ADD CONSTRAINT "task_evidence_audit_event_type_check" CHECK (event_type = ANY (ARRAY['upload.prepared'::text, 'upload.failed'::text, 'upload.completed'::text, 'verification.queued'::text, 'verification.started'::text, 'verification.succeeded'::text, 'verification.failed'::text, 'review.approved'::text, 'review.rejected'::text]));
ALTER TABLE "public"."task_evidence_audit" ADD CONSTRAINT "task_evidence_audit_safe_details_check" CHECK (jsonb_typeof(safe_details) = 'object'::text);
ALTER TABLE "public"."task_evidence_derivatives" ADD CONSTRAINT "task_evidence_derivatives_derivative_type_check" CHECK (derivative_type = 'ai_jpeg_preview'::text);
ALTER TABLE "public"."task_evidence_derivatives" ADD CONSTRAINT "task_evidence_derivatives_mime_type_check" CHECK (mime_type = 'image/jpeg'::text);
ALTER TABLE "public"."task_evidence_derivatives" ADD CONSTRAINT "task_evidence_derivatives_sha256_check" CHECK (sha256 ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."task_evidence_derivatives" ADD CONSTRAINT "task_evidence_derivatives_size_bytes_check" CHECK (size_bytes > 0 AND size_bytes <= 20971520);
ALTER TABLE "public"."task_evidence_derivatives" ADD CONSTRAINT "task_evidence_derivatives_source_sha256_check" CHECK (source_sha256 ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."task_evidence_reviews" ADD CONSTRAINT "task_evidence_reviews_decision_check" CHECK (decision = ANY (ARRAY['approved'::text, 'rejected'::text]));
ALTER TABLE "public"."task_evidence_reviews" ADD CONSTRAINT "task_evidence_reviews_note_check" CHECK (note IS NULL OR length(note) <= 1000);
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_attempt_number_check" CHECK (attempt_number >= 1 AND attempt_number <= 3);
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_confidence_check" CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_explanation_check" CHECK (explanation IS NULL OR length(explanation) <= 600);
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_provider_check" CHECK (provider = 'openai'::text);
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_reason_codes_check" CHECK (jsonb_typeof(reason_codes) = 'array'::text);
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_schema_version_check" CHECK (schema_version = 1);
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_status_check" CHECK (status = ANY (ARRAY['processing'::text, 'succeeded'::text, 'failed'::text]));
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_uncertainty_flags_check" CHECK (jsonb_typeof(uncertainty_flags) = 'array'::text);
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_usage_metadata_check" CHECK (jsonb_typeof(usage_metadata) = 'object'::text);
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_verdict_check" CHECK (verdict = ANY (ARRAY['verified'::text, 'rejected'::text, 'needs_human_review'::text]));
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_visible_observations_check" CHECK (jsonb_typeof(visible_observations) = 'array'::text);
ALTER TABLE "public"."task_evidence_verification_jobs" ADD CONSTRAINT "task_evidence_verification_jobs_attempt_count_check" CHECK (attempt_count >= 0 AND attempt_count <= 3);
ALTER TABLE "public"."task_evidence_verification_jobs" ADD CONSTRAINT "task_evidence_verification_jobs_check" CHECK ((status = 'processing'::text) = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL));
ALTER TABLE "public"."task_evidence_verification_jobs" ADD CONSTRAINT "task_evidence_verification_jobs_cycle_number_check" CHECK (cycle_number >= 1 AND cycle_number <= 3);
ALTER TABLE "public"."task_evidence_verification_jobs" ADD CONSTRAINT "task_evidence_verification_jobs_max_attempts_check" CHECK (max_attempts = 3);
ALTER TABLE "public"."task_evidence_verification_jobs" ADD CONSTRAINT "task_evidence_verification_jobs_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'processing'::text, 'completed'::text, 'failed'::text]));
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_original_mime_type_check" CHECK (original_mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text, 'image/heic'::text, 'image/heif'::text]));
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_original_sha256_check" CHECK (original_sha256 ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_original_size_bytes_check" CHECK (original_size_bytes > 0 AND original_size_bytes <= 20971520);
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_source_type_check" CHECK (source_type = ANY (ARRAY['mobile_camera'::text, 'gallery_upload'::text]));
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_status_check" CHECK (status = ANY (ARRAY['pending_upload'::text, 'upload_failed'::text, 'pending_review'::text, 'queued'::text, 'processing'::text, 'ai_verified'::text, 'ai_rejected'::text, 'needs_human_review'::text, 'verification_failed'::text, 'human_approved'::text, 'human_rejected'::text]));
ALTER TABLE "public"."task_localization_jobs" ADD CONSTRAINT "task_localization_jobs_attempt_count_check" CHECK (attempt_count >= 0 AND attempt_count <= 5);
ALTER TABLE "public"."task_localization_jobs" ADD CONSTRAINT "task_localization_jobs_check" CHECK ((status = 'processing'::text) = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL));
ALTER TABLE "public"."task_localization_jobs" ADD CONSTRAINT "task_localization_jobs_language_check" CHECK (language = 'ar'::text);
ALTER TABLE "public"."task_localization_jobs" ADD CONSTRAINT "task_localization_jobs_source_hash_check" CHECK (source_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."task_localization_jobs" ADD CONSTRAINT "task_localization_jobs_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]));
ALTER TABLE "public"."task_localizations" ADD CONSTRAINT "task_localizations_language_check" CHECK (language = 'ar'::text);
ALTER TABLE "public"."task_localizations" ADD CONSTRAINT "task_localizations_source_hash_check" CHECK (source_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."task_localizations" ADD CONSTRAINT "task_localizations_title_check" CHECK (btrim(title) <> ''::text);
ALTER TABLE "public"."time_off_requests" ADD CONSTRAINT "dates_valid" CHECK (end_date >= start_date);
ALTER TABLE "public"."time_off_requests" ADD CONSTRAINT "time_off_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]));
ALTER TABLE "public"."time_off_requests" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "valid_company" CHECK (company_id IS NOT NULL);

-- Captured standalone unique indexes required by foreign keys.
CREATE UNIQUE INDEX "employees_company_id_id_uidx" ON "public"."employees" USING btree (company_id, id);

-- Captured foreign keys after every referenced primary/unique key exists.
ALTER TABLE "public"."activity_timeline" ADD CONSTRAINT "activity_timeline_action_by_id_fkey" FOREIGN KEY (action_by_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."activity_timeline" ADD CONSTRAINT "activity_timeline_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."announcement_acknowledgments" ADD CONSTRAINT "announcement_acknowledgments_announcement_id_fkey" FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE;
ALTER TABLE "public"."announcement_acknowledgments" ADD CONSTRAINT "announcement_acknowledgments_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."announcement_acknowledgments" ADD CONSTRAINT "announcement_acknowledgments_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE "public"."announcements" ADD CONSTRAINT "announcements_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."announcements" ADD CONSTRAINT "announcements_created_by_id_fkey" FOREIGN KEY (created_by_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."attendance_records" ADD CONSTRAINT "attendance_records_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."attendance_records" ADD CONSTRAINT "attendance_records_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE "public"."brain_action_proposals" ADD CONSTRAINT "brain_action_proposals_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE "public"."brain_action_proposals" ADD CONSTRAINT "brain_action_proposals_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."brain_action_proposals" ADD CONSTRAINT "brain_action_proposals_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."brain_chat_user_quotas" ADD CONSTRAINT "brain_chat_user_quotas_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."brain_domain_events" ADD CONSTRAINT "brain_domain_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE "public"."brain_domain_events" ADD CONSTRAINT "brain_domain_events_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_aggregate_id_fkey" FOREIGN KEY (aggregate_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."brain_event_outbox" ADD CONSTRAINT "brain_event_outbox_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES brain_action_proposals(id) ON DELETE RESTRICT;
ALTER TABLE "public"."cameras" ADD CONSTRAINT "cameras_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."cameras" ADD CONSTRAINT "cameras_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;
ALTER TABLE "public"."cameras" ADD CONSTRAINT "cameras_nvr_connection_id_fkey" FOREIGN KEY (nvr_connection_id) REFERENCES nvr_connections(id) ON DELETE RESTRICT;
ALTER TABLE "public"."departments" ADD CONSTRAINT "departments_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."departments" ADD CONSTRAINT "departments_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE "public"."departments" ADD CONSTRAINT "departments_manager_employee_id_fkey" FOREIGN KEY (manager_employee_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE "public"."device_agent_audit" ADD CONSTRAINT "device_agent_audit_actor_profile_id_fkey" FOREIGN KEY (actor_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_agent_audit" ADD CONSTRAINT "device_agent_audit_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_agent_audit" ADD CONSTRAINT "device_agent_audit_gateway_id_fkey" FOREIGN KEY (gateway_id) REFERENCES device_gateways(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_agent_audit" ADD CONSTRAINT "device_agent_audit_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_agent_credentials" ADD CONSTRAINT "device_agent_credentials_gateway_id_fkey" FOREIGN KEY (gateway_id) REFERENCES device_gateways(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_agent_credentials" ADD CONSTRAINT "device_agent_credentials_revoked_by_fkey" FOREIGN KEY (revoked_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_configuration_audit" ADD CONSTRAINT "device_configuration_audit_actor_profile_id_fkey" FOREIGN KEY (actor_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_configuration_audit" ADD CONSTRAINT "device_configuration_audit_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_gateway_capabilities" ADD CONSTRAINT "device_gateway_capabilities_capability_code_fkey" FOREIGN KEY (capability_code) REFERENCES device_capability_catalog(capability_code) ON DELETE RESTRICT;
ALTER TABLE "public"."device_gateway_capabilities" ADD CONSTRAINT "device_gateway_capabilities_gateway_id_fkey" FOREIGN KEY (gateway_id) REFERENCES device_gateways(id) ON DELETE CASCADE;
ALTER TABLE "public"."device_gateway_capabilities" ADD CONSTRAINT "device_gateway_capabilities_granted_by_fkey" FOREIGN KEY (granted_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_gateways" ADD CONSTRAINT "device_gateways_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_gateways" ADD CONSTRAINT "device_gateways_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_gateways" ADD CONSTRAINT "device_gateways_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_pairing_requests" ADD CONSTRAINT "device_pairing_request_tenant_fk" FOREIGN KEY (company_id, gateway_id) REFERENCES device_gateways(company_id, id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_pairing_requests" ADD CONSTRAINT "device_pairing_requests_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_pairing_requests" ADD CONSTRAINT "device_pairing_requests_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_pairing_requests" ADD CONSTRAINT "device_pairing_requests_gateway_id_fkey" FOREIGN KEY (gateway_id) REFERENCES device_gateways(id) ON DELETE RESTRICT;
ALTER TABLE "public"."device_pairing_requests" ADD CONSTRAINT "device_pairing_requests_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;
ALTER TABLE "public"."employee_migration_exceptions" ADD CONSTRAINT "employee_migration_exceptions_employee_company_fkey" FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT;
ALTER TABLE "public"."employee_migration_exceptions" ADD CONSTRAINT "employee_migration_exceptions_reviewed_by_profile_id_fkey" FOREIGN KEY (reviewed_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_archived_by_profile_id_fkey" FOREIGN KEY (archived_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE "public"."incident_reports" ADD CONSTRAINT "incident_reports_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."incident_reports" ADD CONSTRAINT "incident_reports_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE "public"."incident_reports" ADD CONSTRAINT "incident_reports_reported_by_id_fkey" FOREIGN KEY (reported_by_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."locations" ADD CONSTRAINT "locations_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_assigned_to_id_fkey" FOREIGN KEY (assigned_to_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE "public"."maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_created_by_id_fkey" FOREIGN KEY (created_by_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE "public"."notification_audit" ADD CONSTRAINT "notification_audit_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."notification_delivery_jobs" ADD CONSTRAINT "notification_delivery_jobs_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."notification_delivery_jobs" ADD CONSTRAINT "notification_delivery_jobs_notification_id_fkey" FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE RESTRICT;
ALTER TABLE "public"."notification_delivery_jobs" ADD CONSTRAINT "notification_delivery_jobs_subscription_id_fkey" FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE RESTRICT;
ALTER TABLE "public"."notification_outbox" ADD CONSTRAINT "notification_outbox_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "notification_preferences_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "notification_preferences_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_gateway_id_fkey" FOREIGN KEY (gateway_id) REFERENCES device_gateways(id) ON DELETE RESTRICT;
ALTER TABLE "public"."nvr_connections" ADD CONSTRAINT "nvr_connections_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;
ALTER TABLE "public"."open_shifts" ADD CONSTRAINT "open_shifts_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."open_shifts" ADD CONSTRAINT "open_shifts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."open_shifts" ADD CONSTRAINT "open_shifts_filled_by_employee_id_fkey" FOREIGN KEY (filled_by_employee_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE "public"."open_shifts" ADD CONSTRAINT "open_shifts_shift_template_id_fkey" FOREIGN KEY (shift_template_id) REFERENCES shift_templates(id) ON DELETE CASCADE;
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "public"."recurring_shifts" ADD CONSTRAINT "recurring_shifts_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."recurring_shifts" ADD CONSTRAINT "recurring_shifts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."recurring_shifts" ADD CONSTRAINT "recurring_shifts_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE "public"."recurring_shifts" ADD CONSTRAINT "recurring_shifts_shift_template_id_fkey" FOREIGN KEY (shift_template_id) REFERENCES shift_templates(id) ON DELETE CASCADE;
ALTER TABLE "public"."roles" ADD CONSTRAINT "roles_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."shift_swaps" ADD CONSTRAINT "shift_swaps_approved_by_id_fkey" FOREIGN KEY (approved_by_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE "public"."shift_swaps" ADD CONSTRAINT "shift_swaps_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."shift_swaps" ADD CONSTRAINT "shift_swaps_requestor_id_fkey" FOREIGN KEY (requestor_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE "public"."shift_swaps" ADD CONSTRAINT "shift_swaps_target_employee_id_fkey" FOREIGN KEY (target_employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE "public"."shift_templates" ADD CONSTRAINT "shift_templates_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."shift_templates" ADD CONSTRAINT "shift_templates_created_by_id_fkey" FOREIGN KEY (created_by_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE "public"."shift_templates" ADD CONSTRAINT "shift_templates_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE "public"."shifts" ADD CONSTRAINT "shifts_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."shifts" ADD CONSTRAINT "shifts_created_by_id_fkey" FOREIGN KEY (created_by_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE "public"."shifts" ADD CONSTRAINT "shifts_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE "public"."shifts" ADD CONSTRAINT "shifts_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE "public"."task_evidence_audit" ADD CONSTRAINT "task_evidence_audit_actor_profile_id_fkey" FOREIGN KEY (actor_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence_audit" ADD CONSTRAINT "task_evidence_audit_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence_audit" ADD CONSTRAINT "task_evidence_audit_evidence_id_fkey" FOREIGN KEY (evidence_id) REFERENCES task_evidence(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence_derivatives" ADD CONSTRAINT "task_evidence_derivatives_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence_derivatives" ADD CONSTRAINT "task_evidence_derivatives_evidence_id_fkey" FOREIGN KEY (evidence_id) REFERENCES task_evidence(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence_reviews" ADD CONSTRAINT "task_evidence_reviews_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence_reviews" ADD CONSTRAINT "task_evidence_reviews_evidence_id_fkey" FOREIGN KEY (evidence_id) REFERENCES task_evidence(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence_reviews" ADD CONSTRAINT "task_evidence_reviews_reviewer_profile_id_fkey" FOREIGN KEY (reviewer_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_evidence_id_fkey" FOREIGN KEY (evidence_id) REFERENCES task_evidence(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence_verification_attempts" ADD CONSTRAINT "task_evidence_verification_attempts_job_id_fkey" FOREIGN KEY (job_id) REFERENCES task_evidence_verification_jobs(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence_verification_jobs" ADD CONSTRAINT "task_evidence_verification_jobs_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence_verification_jobs" ADD CONSTRAINT "task_evidence_verification_jobs_evidence_id_fkey" FOREIGN KEY (evidence_id) REFERENCES task_evidence(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_submitted_by_employee_id_fkey" FOREIGN KEY (submitted_by_employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_submitted_by_profile_id_fkey" FOREIGN KEY (submitted_by_profile_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_evidence" ADD CONSTRAINT "task_evidence_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE RESTRICT;
ALTER TABLE "public"."task_localization_jobs" ADD CONSTRAINT "task_localization_jobs_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."task_localization_jobs" ADD CONSTRAINT "task_localization_jobs_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE "public"."task_localizations" ADD CONSTRAINT "task_localizations_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."task_localizations" ADD CONSTRAINT "task_localizations_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;
ALTER TABLE "public"."time_off_requests" ADD CONSTRAINT "time_off_requests_approved_by_id_fkey" FOREIGN KEY (approved_by_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE "public"."time_off_requests" ADD CONSTRAINT "time_off_requests_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."time_off_requests" ADD CONSTRAINT "time_off_requests_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "weekly_schedules_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "weekly_schedules_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "weekly_schedules_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "weekly_schedules_friday_shift_id_fkey" FOREIGN KEY (friday_shift_id) REFERENCES shift_templates(id) ON DELETE SET NULL;
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "weekly_schedules_monday_shift_id_fkey" FOREIGN KEY (monday_shift_id) REFERENCES shift_templates(id) ON DELETE SET NULL;
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "weekly_schedules_saturday_shift_id_fkey" FOREIGN KEY (saturday_shift_id) REFERENCES shift_templates(id) ON DELETE SET NULL;
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "weekly_schedules_sunday_shift_id_fkey" FOREIGN KEY (sunday_shift_id) REFERENCES shift_templates(id) ON DELETE SET NULL;
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "weekly_schedules_thursday_shift_id_fkey" FOREIGN KEY (thursday_shift_id) REFERENCES shift_templates(id) ON DELETE SET NULL;
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "weekly_schedules_tuesday_shift_id_fkey" FOREIGN KEY (tuesday_shift_id) REFERENCES shift_templates(id) ON DELETE SET NULL;
ALTER TABLE "public"."weekly_schedules" ADD CONSTRAINT "weekly_schedules_wednesday_shift_id_fkey" FOREIGN KEY (wednesday_shift_id) REFERENCES shift_templates(id) ON DELETE SET NULL;

-- Remaining captured non-constraint indexes. Another
-- 72 indexes are created by the captured
-- primary/unique constraints above.
CREATE INDEX "idx_activity_timeline_company" ON "public"."activity_timeline" USING btree (company_id);
CREATE INDEX "idx_activity_timeline_created" ON "public"."activity_timeline" USING btree (created_at);
CREATE INDEX "idx_activity_timeline_entity" ON "public"."activity_timeline" USING btree (entity_type, entity_id);
CREATE INDEX "idx_announcement_acknowledgments_announcement" ON "public"."announcement_acknowledgments" USING btree (announcement_id);
CREATE INDEX "idx_announcement_acknowledgments_company" ON "public"."announcement_acknowledgments" USING btree (company_id);
CREATE INDEX "idx_announcements_company" ON "public"."announcements" USING btree (company_id);
CREATE INDEX "idx_announcements_published" ON "public"."announcements" USING btree (published_at);
CREATE INDEX "idx_attendance_records_company" ON "public"."attendance_records" USING btree (company_id);
CREATE INDEX "idx_attendance_records_date" ON "public"."attendance_records" USING btree (shift_date);
CREATE INDEX "idx_attendance_records_employee" ON "public"."attendance_records" USING btree (employee_id);
CREATE INDEX "brain_action_proposals_actor_tenant_status_idx" ON "public"."brain_action_proposals" USING btree (actor_id, tenant_id, status);
CREATE INDEX "brain_action_proposals_executing_started_idx" ON "public"."brain_action_proposals" USING btree (execution_started_at) WHERE status = 'executing'::text;
CREATE INDEX "brain_action_proposals_pending_expiry_idx" ON "public"."brain_action_proposals" USING btree (expires_at) WHERE status = 'pending'::text;
CREATE INDEX "brain_chat_user_quotas_reset_idx" ON "public"."brain_chat_user_quotas" USING btree (window_resets_at);
CREATE INDEX "brain_domain_events_aggregate_idx" ON "public"."brain_domain_events" USING btree (aggregate_type, aggregate_id);
CREATE INDEX "brain_domain_events_company_occurred_idx" ON "public"."brain_domain_events" USING btree (company_id, occurred_at DESC);
CREATE INDEX "brain_domain_events_correlation_idx" ON "public"."brain_domain_events" USING btree (correlation_id);
CREATE INDEX "brain_event_outbox_aggregate_idx" ON "public"."brain_event_outbox" USING btree (aggregate_type, aggregate_id);
CREATE INDEX "brain_event_outbox_company_created_idx" ON "public"."brain_event_outbox" USING btree (company_id, created_at DESC);
CREATE INDEX "brain_event_outbox_correlation_idx" ON "public"."brain_event_outbox" USING btree (correlation_id);
CREATE INDEX "brain_event_outbox_pending_available_idx" ON "public"."brain_event_outbox" USING btree (available_at, created_at) WHERE delivery_status = 'pending'::text;
CREATE INDEX "cameras_company_idx" ON "public"."cameras" USING btree (company_id);
CREATE INDEX "cameras_external_channel_idx" ON "public"."cameras" USING btree (external_channel_id);
CREATE INDEX "cameras_location_idx" ON "public"."cameras" USING btree (location_id);
CREATE INDEX "cameras_nvr_idx" ON "public"."cameras" USING btree (nvr_connection_id);
CREATE INDEX "cameras_status_idx" ON "public"."cameras" USING btree (company_id, status);
CREATE INDEX "device_agent_audit_gateway_created_idx" ON "public"."device_agent_audit" USING btree (gateway_id, created_at DESC);
CREATE UNIQUE INDEX "device_agent_audit_unknown_capability_bucket_unique" ON "public"."device_agent_audit" USING btree (gateway_id, event_type, event_bucket) WHERE event_type = 'capability.unknown_declared'::text AND event_bucket IS NOT NULL;
CREATE UNIQUE INDEX "device_agent_credentials_active_gateway_unique" ON "public"."device_agent_credentials" USING btree (gateway_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX "device_agent_credentials_active_public_agent_unique" ON "public"."device_agent_credentials" USING btree (public_agent_id) WHERE revoked_at IS NULL;
CREATE INDEX "device_agent_rate_limits_reset_idx" ON "public"."device_agent_rate_limits" USING btree (window_resets_at);
CREATE INDEX "device_configuration_audit_company_created_idx" ON "public"."device_configuration_audit" USING btree (company_id, created_at DESC);
CREATE INDEX "device_gateways_company_idx" ON "public"."device_gateways" USING btree (company_id);
CREATE INDEX "device_gateways_location_idx" ON "public"."device_gateways" USING btree (location_id);
CREATE INDEX "device_gateways_status_idx" ON "public"."device_gateways" USING btree (company_id, status);
CREATE UNIQUE INDEX "device_pairing_requests_active_gateway_unique" ON "public"."device_pairing_requests" USING btree (gateway_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX "device_pairing_requests_code_hash_unique" ON "public"."device_pairing_requests" USING btree (code_hash);
CREATE INDEX "device_pairing_requests_expiry_idx" ON "public"."device_pairing_requests" USING btree (expires_at) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX "employees_company_employee_number_uidx" ON "public"."employees" USING btree (company_id, employee_number) WHERE employee_number IS NOT NULL;
CREATE INDEX "idx_incident_reports_company" ON "public"."incident_reports" USING btree (company_id);
CREATE INDEX "idx_incident_reports_severity" ON "public"."incident_reports" USING btree (severity);
CREATE INDEX "idx_incident_reports_time" ON "public"."incident_reports" USING btree (incident_time);
CREATE INDEX "idx_maintenance_tickets_assigned" ON "public"."maintenance_tickets" USING btree (assigned_to_id);
CREATE INDEX "idx_maintenance_tickets_company" ON "public"."maintenance_tickets" USING btree (company_id);
CREATE INDEX "idx_maintenance_tickets_due" ON "public"."maintenance_tickets" USING btree (due_date);
CREATE INDEX "idx_maintenance_tickets_status" ON "public"."maintenance_tickets" USING btree (status);
CREATE INDEX "notification_delivery_claim_idx" ON "public"."notification_delivery_jobs" USING btree (available_at, created_at) WHERE status = ANY (ARRAY['pending'::text, 'processing'::text]);
CREATE INDEX "notification_outbox_claim_idx" ON "public"."notification_outbox" USING btree (available_at, created_at) WHERE status = ANY (ARRAY['pending'::text, 'processing'::text]);
CREATE INDEX "idx_notifications_company" ON "public"."notifications" USING btree (company_id);
CREATE INDEX "idx_notifications_is_read" ON "public"."notifications" USING btree (is_read);
CREATE INDEX "idx_notifications_recipient" ON "public"."notifications" USING btree (recipient_id);
CREATE UNIQUE INDEX "notifications_recipient_event_key_idx" ON "public"."notifications" USING btree (recipient_id, event_key) WHERE event_key IS NOT NULL;
CREATE INDEX "notifications_recipient_status_created_idx" ON "public"."notifications" USING btree (recipient_id, status, created_at DESC);
CREATE INDEX "nvr_connections_company_idx" ON "public"."nvr_connections" USING btree (company_id);
CREATE INDEX "nvr_connections_gateway_idx" ON "public"."nvr_connections" USING btree (gateway_id);
CREATE INDEX "nvr_connections_location_idx" ON "public"."nvr_connections" USING btree (location_id);
CREATE INDEX "nvr_connections_status_idx" ON "public"."nvr_connections" USING btree (company_id, status);
CREATE INDEX "idx_open_shifts_company" ON "public"."open_shifts" USING btree (company_id);
CREATE INDEX "idx_open_shifts_date" ON "public"."open_shifts" USING btree (shift_date);
CREATE INDEX "idx_profiles_company_id" ON "public"."profiles" USING btree (company_id);
CREATE INDEX "idx_profiles_employee_id" ON "public"."profiles" USING btree (employee_id);
CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING btree (role);
CREATE INDEX "idx_profiles_status" ON "public"."profiles" USING btree (status);
CREATE INDEX "idx_recurring_shifts_company" ON "public"."recurring_shifts" USING btree (company_id);
CREATE INDEX "idx_recurring_shifts_date_range" ON "public"."recurring_shifts" USING btree (company_id, start_date, end_date);
CREATE INDEX "idx_recurring_shifts_employee" ON "public"."recurring_shifts" USING btree (employee_id);
CREATE INDEX "idx_roles_company" ON "public"."roles" USING btree (company_id);
CREATE INDEX "idx_shift_swaps_company" ON "public"."shift_swaps" USING btree (company_id);
CREATE INDEX "idx_shift_swaps_requestor" ON "public"."shift_swaps" USING btree (requestor_id);
CREATE INDEX "idx_shift_swaps_target" ON "public"."shift_swaps" USING btree (target_employee_id);
CREATE INDEX "idx_shift_templates_company" ON "public"."shift_templates" USING btree (company_id);
CREATE INDEX "idx_shift_templates_department" ON "public"."shift_templates" USING btree (department_id);
CREATE INDEX "idx_shifts_company_id" ON "public"."shifts" USING btree (company_id);
CREATE INDEX "idx_shifts_created_at" ON "public"."shifts" USING btree (created_at);
CREATE INDEX "idx_shifts_employee_id" ON "public"."shifts" USING btree (employee_id);
CREATE INDEX "idx_shifts_shift_date" ON "public"."shifts" USING btree (shift_date);
CREATE INDEX "idx_shifts_status" ON "public"."shifts" USING btree (status);
CREATE INDEX "task_evidence_audit_evidence_created_idx" ON "public"."task_evidence_audit" USING btree (evidence_id, created_at);
CREATE INDEX "task_evidence_verification_attempts_evidence_idx" ON "public"."task_evidence_verification_attempts" USING btree (evidence_id, attempt_number DESC);
CREATE INDEX "task_evidence_verification_jobs_claim_idx" ON "public"."task_evidence_verification_jobs" USING btree (available_at, created_at) WHERE status = ANY (ARRAY['queued'::text, 'processing'::text]);
CREATE UNIQUE INDEX "task_evidence_verification_jobs_one_active_idx" ON "public"."task_evidence_verification_jobs" USING btree (evidence_id) WHERE status = ANY (ARRAY['queued'::text, 'processing'::text]);
CREATE INDEX "task_evidence_company_task_created_idx" ON "public"."task_evidence" USING btree (company_id, task_id, created_at DESC);
CREATE INDEX "task_evidence_pending_review_idx" ON "public"."task_evidence" USING btree (company_id, created_at) WHERE status = 'pending_review'::text;
CREATE INDEX "task_localization_jobs_pending_idx" ON "public"."task_localization_jobs" USING btree (available_at, created_at) WHERE status = ANY (ARRAY['pending'::text, 'processing'::text]);
CREATE INDEX "task_localizations_company_language_idx" ON "public"."task_localizations" USING btree (company_id, language, task_id);
CREATE INDEX "tasks_active_assignee_due_at_idx" ON "public"."tasks" USING btree (company_id, assigned_employee_id, due_at) WHERE status = ANY (ARRAY['pending'::text, 'in_progress'::text]);
CREATE INDEX "tasks_assigned_employee_id_idx" ON "public"."tasks" USING btree (assigned_employee_id);
CREATE INDEX "tasks_company_id_idx" ON "public"."tasks" USING btree (company_id);
CREATE INDEX "tasks_company_location_due_at_idx" ON "public"."tasks" USING btree (company_id, location_id, due_at);
CREATE INDEX "tasks_due_at_reminder_scan_idx" ON "public"."tasks" USING btree (due_at, id) WHERE due_at IS NOT NULL AND assigned_employee_id IS NOT NULL AND (status = ANY (ARRAY['pending'::text, 'in_progress'::text]));
CREATE INDEX "idx_time_off_requests_company" ON "public"."time_off_requests" USING btree (company_id);
CREATE INDEX "idx_time_off_requests_dates" ON "public"."time_off_requests" USING btree (start_date, end_date);
CREATE INDEX "idx_time_off_requests_employee" ON "public"."time_off_requests" USING btree (employee_id);
CREATE INDEX "idx_weekly_schedules_company" ON "public"."weekly_schedules" USING btree (company_id);
CREATE INDEX "idx_weekly_schedules_employee" ON "public"."weekly_schedules" USING btree (employee_id);
CREATE INDEX "idx_weekly_schedules_week" ON "public"."weekly_schedules" USING btree (week_start_date);

-- Captured triggers and enabled states.
CREATE TRIGGER notification_announcements_event AFTER INSERT ON announcements FOR EACH ROW EXECUTE FUNCTION private.queue_notification_event();
CREATE TRIGGER cameras_audit AFTER INSERT OR DELETE OR UPDATE ON cameras FOR EACH ROW EXECUTE FUNCTION private.audit_device_configuration();
CREATE TRIGGER cameras_tenant_guard BEFORE INSERT OR UPDATE ON cameras FOR EACH ROW EXECUTE FUNCTION private.validate_device_tenant_relationships();
CREATE TRIGGER cameras_updated_at BEFORE UPDATE ON cameras FOR EACH ROW EXECUTE FUNCTION private.touch_device_updated_at();
CREATE TRIGGER companies_update_timestamp BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER departments_update_timestamp BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER device_gateways_tenant_guard BEFORE INSERT OR UPDATE ON device_gateways FOR EACH ROW EXECUTE FUNCTION private.validate_device_tenant_relationships();
CREATE TRIGGER device_gateways_updated_at BEFORE UPDATE ON device_gateways FOR EACH ROW EXECUTE FUNCTION private.touch_device_updated_at();
CREATE TRIGGER employees_update_timestamp BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER notification_incidents_event AFTER INSERT OR UPDATE ON incident_reports FOR EACH ROW EXECUTE FUNCTION private.queue_notification_event();
CREATE TRIGGER locations_update_timestamp BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER notification_maintenance_event AFTER INSERT OR UPDATE ON maintenance_tickets FOR EACH ROW EXECUTE FUNCTION private.queue_notification_event();
CREATE TRIGGER notifications_localize_employee BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION localize_employee_notification();
CREATE TRIGGER nvr_connections_audit AFTER INSERT OR DELETE OR UPDATE ON nvr_connections FOR EACH ROW EXECUTE FUNCTION private.audit_device_configuration();
CREATE TRIGGER nvr_connections_tenant_guard BEFORE INSERT OR UPDATE ON nvr_connections FOR EACH ROW EXECUTE FUNCTION private.validate_device_tenant_relationships();
CREATE TRIGGER nvr_connections_updated_at BEFORE UPDATE ON nvr_connections FOR EACH ROW EXECUTE FUNCTION private.touch_device_updated_at();
CREATE TRIGGER notification_profile_event AFTER INSERT OR UPDATE OF status ON profiles FOR EACH ROW EXECUTE FUNCTION private.queue_notification_event();
CREATE TRIGGER notification_evidence_event AFTER UPDATE ON task_evidence FOR EACH ROW EXECUTE FUNCTION private.queue_notification_event();
CREATE TRIGGER notification_tasks_event AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION private.queue_notification_event();
CREATE TRIGGER tasks_enqueue_arabic_localization AFTER INSERT OR UPDATE OF title, description, assigned_employee_id ON tasks FOR EACH ROW EXECUTE FUNCTION enqueue_arabic_task_localization();

-- Captured RLS enabled/forced state.
ALTER TABLE "public"."activity_timeline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."activity_timeline" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."announcement_acknowledgments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."announcement_acknowledgments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."announcements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."announcements" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."attendance_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."attendance_records" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."brain_action_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."brain_action_proposals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."brain_chat_user_quotas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."brain_chat_user_quotas" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."brain_domain_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."brain_domain_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."brain_event_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."brain_event_outbox" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."cameras" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."cameras" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."companies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."d1_employee_migration_checkpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."d1_employee_migration_checkpoints" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."departments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_agent_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_agent_audit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_agent_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_agent_credentials" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_agent_rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_agent_rate_limits" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_capability_catalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_capability_catalog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_configuration_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_configuration_audit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_gateway_capabilities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_gateway_capabilities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_gateways" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_gateways" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_pairing_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."device_pairing_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."employee_migration_exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."employee_migration_exceptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."employees" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."incident_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."incident_reports" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."locations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."maintenance_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."maintenance_tickets" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_audit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_delivery_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_delivery_jobs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_outbox" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_preferences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notifications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."nvr_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."nvr_connections" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."open_shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."open_shifts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."profiles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."push_subscriptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."recurring_shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."recurring_shifts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."roles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."shift_swaps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."shift_swaps" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."shift_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."shift_templates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."shifts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_evidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_evidence_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_evidence_audit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_evidence_derivatives" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_evidence_derivatives" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_evidence_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_evidence_reviews" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_evidence_verification_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_evidence_verification_attempts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_evidence_verification_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_evidence_verification_jobs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_localization_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_localization_jobs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_localizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_localizations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tasks" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."time_off_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."time_off_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."weekly_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."weekly_schedules" NO FORCE ROW LEVEL SECURITY;

-- Captured application policies.
CREATE POLICY "activity_timeline_insert" ON "public"."activity_timeline"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "activity_timeline_select" ON "public"."activity_timeline"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "announcement_acknowledgments_insert" ON "public"."announcement_acknowledgments"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "announcement_acknowledgments_select" ON "public"."announcement_acknowledgments"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "announcement_acknowledgments_update" ON "public"."announcement_acknowledgments"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user())
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "announcements_delete" ON "public"."announcements"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "announcements_insert" ON "public"."announcements"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "announcements_select" ON "public"."announcements"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "announcements_update" ON "public"."announcements"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "attendance_records_delete" ON "public"."attendance_records"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "attendance_records_insert" ON "public"."attendance_records"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "attendance_records_select" ON "public"."attendance_records"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "attendance_records_update" ON "public"."attendance_records"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "cameras_management_select" ON "public"."cameras"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (private.can_view_camera_manager(company_id));

CREATE POLICY "cameras_management_update" ON "public"."cameras"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING (private.can_view_camera_manager(company_id))
  WITH CHECK (private.can_view_camera_manager(company_id));

CREATE POLICY "companies_delete" ON "public"."companies"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (private.is_super_admin() AND private.is_active_user());

CREATE POLICY "companies_insert" ON "public"."companies"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (private.is_super_admin() AND private.is_active_user());

CREATE POLICY "companies_select" ON "public"."companies"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (private.is_active_user() AND (private.is_super_admin() OR id = private.current_user_company_id()));

CREATE POLICY "companies_update" ON "public"."companies"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (private.is_super_admin() AND private.is_active_user())
  WITH CHECK (private.is_super_admin() AND private.is_active_user());

CREATE POLICY "departments_delete" ON "public"."departments"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (private.can_manage_company(company_id));

CREATE POLICY "departments_insert" ON "public"."departments"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (private.can_manage_company(company_id));

CREATE POLICY "departments_select" ON "public"."departments"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (private.is_active_user() AND (private.is_super_admin() OR company_id = private.current_user_company_id()));

CREATE POLICY "departments_update" ON "public"."departments"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (private.can_manage_company(company_id))
  WITH CHECK (private.can_manage_company(company_id));

CREATE POLICY "employees_delete" ON "public"."employees"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (private.can_manage_company(company_id));

CREATE POLICY "employees_insert" ON "public"."employees"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (private.can_manage_company(company_id));

CREATE POLICY "employees_select" ON "public"."employees"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (private.is_active_user() AND (private.is_super_admin() OR company_id = private.current_user_company_id()));

CREATE POLICY "employees_update" ON "public"."employees"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (private.can_manage_company(company_id))
  WITH CHECK (private.can_manage_company(company_id));

CREATE POLICY "incident_reports_delete" ON "public"."incident_reports"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "incident_reports_insert" ON "public"."incident_reports"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK (status = 'open'::text AND reported_by_id = auth.uid() AND (EXISTS ( SELECT 1
   FROM profiles pr
  WHERE pr.id = auth.uid() AND pr.id = incident_reports.reported_by_id AND pr.status = 'active'::text AND (pr.role = ANY (ARRAY['employee'::text, 'manager'::text, 'owner'::text, 'super_admin'::text])) AND pr.company_id = incident_reports.company_id)) AND (location_id IS NULL OR (EXISTS ( SELECT 1
   FROM locations loc
  WHERE loc.id = incident_reports.location_id AND loc.company_id = incident_reports.company_id))));

CREATE POLICY "incident_reports_select" ON "public"."incident_reports"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "incident_reports_update" ON "public"."incident_reports"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "locations_delete" ON "public"."locations"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (private.can_manage_company(company_id));

CREATE POLICY "locations_insert" ON "public"."locations"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (private.can_manage_company(company_id));

CREATE POLICY "locations_select" ON "public"."locations"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (private.is_active_user() AND (private.is_super_admin() OR company_id = private.current_user_company_id()));

CREATE POLICY "locations_update" ON "public"."locations"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (private.can_manage_company(company_id))
  WITH CHECK (private.can_manage_company(company_id));

CREATE POLICY "maintenance_tickets_delete" ON "public"."maintenance_tickets"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "maintenance_tickets_insert" ON "public"."maintenance_tickets"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "maintenance_tickets_select" ON "public"."maintenance_tickets"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "maintenance_tickets_update" ON "public"."maintenance_tickets"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "notifications_insert" ON "public"."notifications"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "notifications_select" ON "public"."notifications"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND (recipient_id = auth.uid() OR private.is_super_admin()));

CREATE POLICY "notifications_update" ON "public"."notifications"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND (recipient_id = auth.uid() OR private.can_manage_company(company_id)))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND (recipient_id = auth.uid() OR private.can_manage_company(company_id)));

CREATE POLICY "nvr_connections_management_select" ON "public"."nvr_connections"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (private.can_view_camera_manager(company_id));

CREATE POLICY "nvr_connections_owner_delete" ON "public"."nvr_connections"
  AS PERMISSIVE
  FOR DELETE
  TO "authenticated"
  USING (private.can_administer_camera_manager(company_id));

CREATE POLICY "nvr_connections_owner_insert" ON "public"."nvr_connections"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK (created_by = auth.uid() AND private.can_administer_camera_manager(company_id));

CREATE POLICY "nvr_connections_owner_update" ON "public"."nvr_connections"
  AS PERMISSIVE
  FOR UPDATE
  TO "authenticated"
  USING (private.can_administer_camera_manager(company_id))
  WITH CHECK (private.can_administer_camera_manager(company_id));

CREATE POLICY "open_shifts_delete" ON "public"."open_shifts"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "open_shifts_insert" ON "public"."open_shifts"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "open_shifts_select" ON "public"."open_shifts"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "open_shifts_update" ON "public"."open_shifts"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "profiles_delete_deny" ON "public"."profiles"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (false);

CREATE POLICY "profiles_insert_deny" ON "public"."profiles"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (false);

CREATE POLICY "profiles_select_company" ON "public"."profiles"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (private.is_active_user() AND (private.is_super_admin() OR private.current_user_company_id() IS NOT NULL AND private.current_user_company_id() = company_id));

CREATE POLICY "profiles_select_own" ON "public"."profiles"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (auth.uid() = id AND private.is_active_user());

CREATE POLICY "profiles_update_deny" ON "public"."profiles"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

CREATE POLICY "recurring_shifts_delete" ON "public"."recurring_shifts"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "recurring_shifts_insert" ON "public"."recurring_shifts"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "recurring_shifts_select" ON "public"."recurring_shifts"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "recurring_shifts_update" ON "public"."recurring_shifts"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "roles_delete" ON "public"."roles"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "roles_insert" ON "public"."roles"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "roles_select" ON "public"."roles"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "roles_update" ON "public"."roles"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "shift_swaps_delete" ON "public"."shift_swaps"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "shift_swaps_insert" ON "public"."shift_swaps"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "shift_swaps_select" ON "public"."shift_swaps"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "shift_swaps_update" ON "public"."shift_swaps"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "shift_templates_delete" ON "public"."shift_templates"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "shift_templates_insert" ON "public"."shift_templates"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "shift_templates_select" ON "public"."shift_templates"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "shift_templates_update" ON "public"."shift_templates"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "shifts_delete" ON "public"."shifts"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "shifts_insert" ON "public"."shifts"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "shifts_select" ON "public"."shifts"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "shifts_update" ON "public"."shifts"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "tasks_insert" ON "public"."tasks"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK (private.can_manage_company(company_id));

CREATE POLICY "tasks_select" ON "public"."tasks"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (private.is_active_user() AND company_id = private.current_user_company_id() AND ((private.current_user_role() = ANY (ARRAY['super_admin'::text, 'owner'::text, 'manager'::text])) OR (EXISTS ( SELECT 1
   FROM profiles pr
     JOIN employees emp ON emp.id = pr.employee_id AND emp.company_id = pr.company_id
  WHERE pr.id = auth.uid() AND pr.status = 'active'::text AND pr.company_id = tasks.company_id AND pr.employee_id = tasks.assigned_employee_id))));

CREATE POLICY "time_off_requests_delete" ON "public"."time_off_requests"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "time_off_requests_insert" ON "public"."time_off_requests"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "time_off_requests_select" ON "public"."time_off_requests"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "time_off_requests_update" ON "public"."time_off_requests"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "weekly_schedules_delete" ON "public"."weekly_schedules"
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "weekly_schedules_insert" ON "public"."weekly_schedules"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

CREATE POLICY "weekly_schedules_select" ON "public"."weekly_schedules"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user());

CREATE POLICY "weekly_schedules_update" ON "public"."weekly_schedules"
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id))
  WITH CHECK (company_id = (( SELECT private.current_user_company_id() AS current_user_company_id)) AND private.is_active_user() AND private.can_manage_company(company_id));

-- Captured effective schema privileges.
REVOKE ALL PRIVILEGES ON SCHEMA "private" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON SCHEMA "public" FROM PUBLIC, "anon", "authenticated", "service_role", "postgres";
GRANT USAGE ON SCHEMA "private" TO "authenticated";
GRANT CREATE, USAGE ON SCHEMA "private" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT CREATE, USAGE ON SCHEMA "public" TO "pg_database_owner";
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO PUBLIC;
GRANT USAGE ON SCHEMA "public" TO "service_role";

-- Captured effective table and sequence privileges.
REVOKE ALL PRIVILEGES ON TABLE "public"."activity_timeline" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."announcement_acknowledgments" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."announcements" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."attendance_records" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."brain_action_proposals" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."brain_chat_user_quotas" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."brain_domain_events" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."brain_event_outbox" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."cameras" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."companies" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."d1_employee_migration_checkpoints" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."departments" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."device_agent_audit" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."device_agent_credentials" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."device_agent_rate_limits" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."device_capability_catalog" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."device_configuration_audit" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."device_gateway_capabilities" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."device_gateways" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."device_pairing_requests" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."employee_migration_exceptions" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."employees" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."incident_reports" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."locations" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."maintenance_tickets" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."notification_audit" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON SEQUENCE "public"."notification_audit_id_seq" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."notification_delivery_jobs" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."notification_outbox" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."notification_preferences" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."notifications" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."nvr_connections" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."open_shifts" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."profiles" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."push_subscriptions" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."recurring_shifts" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."roles" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."shift_swaps" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."shift_templates" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."shifts" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."task_evidence" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."task_evidence_audit" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."task_evidence_derivatives" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."task_evidence_reviews" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."task_evidence_verification_attempts" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."task_evidence_verification_jobs" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."task_localization_jobs" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."task_localizations" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."tasks" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."time_off_requests" FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON TABLE "public"."weekly_schedules" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."activity_timeline" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."activity_timeline" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."activity_timeline" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."announcement_acknowledgments" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."announcement_acknowledgments" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."announcement_acknowledgments" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."announcements" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."announcements" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."announcements" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."attendance_records" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."attendance_records" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."attendance_records" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brain_action_proposals" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brain_chat_user_quotas" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brain_domain_events" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brain_event_outbox" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cameras" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."companies" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."companies" TO "service_role";
GRANT INSERT, SELECT ON TABLE "public"."d1_employee_migration_checkpoints" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."departments" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."departments" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."departments" TO "service_role";
GRANT SELECT ON TABLE "public"."device_agent_audit" TO "service_role";
GRANT SELECT ON TABLE "public"."device_agent_credentials" TO "service_role";
GRANT SELECT ON TABLE "public"."device_agent_rate_limits" TO "service_role";
GRANT SELECT ON TABLE "public"."device_capability_catalog" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."device_configuration_audit" TO "service_role";
GRANT SELECT ON TABLE "public"."device_gateway_capabilities" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."device_gateways" TO "service_role";
GRANT SELECT ON TABLE "public"."device_pairing_requests" TO "service_role";
GRANT INSERT, SELECT, UPDATE ON TABLE "public"."employee_migration_exceptions" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."employees" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."employees" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."employees" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."incident_reports" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."incident_reports" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."incident_reports" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."locations" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."locations" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."locations" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."maintenance_tickets" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."maintenance_tickets" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."maintenance_tickets" TO "service_role";
GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."notification_audit_id_seq" TO "anon";
GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."notification_audit_id_seq" TO "authenticated";
GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."notification_audit_id_seq" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notification_audit" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notification_delivery_jobs" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notification_outbox" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notification_preferences" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notifications" TO "service_role";
GRANT DELETE ON TABLE "public"."nvr_connections" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."nvr_connections" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."open_shifts" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."open_shifts" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."open_shifts" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_subscriptions" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."recurring_shifts" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."recurring_shifts" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."recurring_shifts" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."roles" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."roles" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."roles" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shift_swaps" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shift_swaps" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shift_swaps" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shift_templates" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shift_templates" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shift_templates" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shifts" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shifts" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shifts" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."task_evidence_audit" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."task_evidence_derivatives" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."task_evidence_reviews" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."task_evidence_verification_attempts" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."task_evidence_verification_jobs" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."task_evidence" TO "service_role";
GRANT INSERT, SELECT, UPDATE ON TABLE "public"."task_localization_jobs" TO "service_role";
GRANT INSERT, SELECT, UPDATE ON TABLE "public"."task_localizations" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tasks" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tasks" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tasks" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."time_off_requests" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."time_off_requests" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."time_off_requests" TO "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."weekly_schedules" TO "anon";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."weekly_schedules" TO "authenticated";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."weekly_schedules" TO "service_role";

-- Captured effective routine privileges.
REVOKE ALL PRIVILEGES ON FUNCTION "private"."audit_device_configuration"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."can_administer_camera_manager"(p_company_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."can_manage_company"(target_company_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."can_read_task_evidence_object"(p_name text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."can_upload_task_evidence_object"(p_name text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."can_view_camera_manager"(p_company_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."current_user_company_id"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."current_user_role"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."is_active_user"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."is_super_admin"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."is_valid_camera_local_host"(p_value text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."queue_notification_event"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."touch_device_updated_at"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."valid_agent_capability_declarations"(p_value jsonb) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "private"."validate_device_tenant_relationships"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."admit_brain_chat_request"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."admit_device_agent_request"(p_scope text, p_identifier_hash text, p_limit integer, p_window_seconds integer) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."authenticate_device_agent_heartbeat"(p_public_agent_id uuid, p_credential_hash text, p_agent_version text, p_platform text, p_os_version text, p_hostname_label text, p_declared_capabilities jsonb) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."claim_brain_action_proposal"(p_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_now timestamp with time zone) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."claim_notification_delivery"(p_lease_seconds integer) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."claim_notification_outbox"(p_lease_seconds integer) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."claim_task_evidence_verification_job"(p_lease_seconds integer) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."claim_task_localization_job"(p_lease_seconds integer) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."complete_brain_action_proposal"(p_id uuid, p_payload_hash text, p_safe_result text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."complete_my_assigned_task"(p_task_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."complete_notification_delivery"(p_job_id uuid, p_lease_token uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."complete_task_evidence_upload"(p_evidence_id uuid, p_verified_sha256 text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."complete_task_evidence_verification_job"(p_job_id uuid, p_lease_token uuid, p_model_name text, p_model_version text, p_verdict text, p_confidence numeric, p_explanation text, p_reason_codes jsonb, p_visible_observations jsonb, p_uncertainty_flags jsonb, p_usage_metadata jsonb) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."complete_task_localization_job"(p_task_id uuid, p_language text, p_source_hash text, p_lease_token uuid, p_title text, p_description text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."consume_device_pairing_request"(p_code_hash text, p_public_agent_id uuid, p_credential_hash text, p_agent_version text, p_platform text, p_os_version text, p_hostname_label text, p_declared_capabilities jsonb) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."create_device_gateway"(p_location_id uuid, p_name text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."create_device_pairing_request"(p_gateway_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."create_task_batch_with_outbox_events"(p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_proposal_id uuid, p_items jsonb) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."create_task_with_outbox_event_due_at"(p_task_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_title text, p_description text, p_priority text, p_status text, p_assigned_employee_id uuid, p_due_date date, p_due_at timestamp with time zone, p_event_id uuid, p_event_type text, p_event_schema_version integer, p_aggregate_type text, p_aggregate_id uuid, p_command_id uuid, p_correlation_id uuid, p_event_causation_id uuid, p_proposal_id uuid, p_idempotency_key text, p_event_payload jsonb, p_occurred_at timestamp with time zone) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."create_task_with_outbox_event"(p_task_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_title text, p_description text, p_priority text, p_status text, p_assigned_employee_id uuid, p_due_date date, p_event_id uuid, p_event_type text, p_event_schema_version integer, p_aggregate_type text, p_aggregate_id uuid, p_command_id uuid, p_correlation_id uuid, p_event_causation_id uuid, p_proposal_id uuid, p_idempotency_key text, p_event_payload jsonb, p_occurred_at timestamp with time zone) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."enqueue_arabic_task_localization"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."enqueue_legacy_arabic_task_localizations"(p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."enqueue_task_evidence_verification"(p_evidence_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."fail_brain_action_proposal"(p_id uuid, p_payload_hash text, p_error_code text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."fail_notification_delivery"(p_job_id uuid, p_lease_token uuid, p_code text, p_permanent boolean) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."fail_notification_outbox"(p_outbox_id uuid, p_lease_token uuid, p_code text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."fail_task_evidence_upload"(p_evidence_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."fail_task_evidence_verification_job"(p_job_id uuid, p_lease_token uuid, p_failure_code text, p_retryable boolean) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."fail_task_localization_job"(p_task_id uuid, p_language text, p_lease_token uuid, p_code text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."generate_task_reminder_obligations"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."get_brain_chat_quota_status"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."get_company_notification_diagnostics"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."get_my_notification_state"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."get_my_task_visibility_diagnostic"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."get_task_evidence_access"(p_evidence_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."get_task_evidence_upload"(p_evidence_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."list_my_notifications"(p_limit integer, p_before timestamp with time zone) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."list_task_evidence_reviews"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."localize_employee_notification"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."mark_all_my_notifications_read"() FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."materialize_notification_outbox"(p_outbox_id uuid, p_lease_token uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."prepare_device_gateway_repair"(p_gateway_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."prepare_task_evidence_upload"(p_task_id uuid, p_location_id uuid, p_source_type text, p_original_mime_type text, p_original_size_bytes bigint, p_original_sha256 text, p_idempotency_key uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."reject_brain_action_proposal"(p_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."resolve_device_agent_rate_identity"(p_public_agent_id uuid, p_credential_hash text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."review_task_evidence"(p_evidence_id uuid, p_decision text, p_note text, p_confirm boolean) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."revoke_device_agent"(p_gateway_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."revoke_device_pairing_request"(p_gateway_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."revoke_my_push_subscription"(p_endpoint text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."save_my_notification_preferences"(p_preferences jsonb) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."save_my_push_subscription"(p_endpoint text, p_p256dh text, p_auth text, p_device text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."update_my_notification"(p_notification_id uuid, p_action text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."update_my_preferred_language"(p_language text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."update_own_full_name"(new_full_name text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL PRIVILEGES ON FUNCTION "public"."update_timestamp"() FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "private"."can_administer_camera_manager"(p_company_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."can_manage_company"(target_company_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."can_read_task_evidence_object"(p_name text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."can_upload_task_evidence_object"(p_name text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."can_view_camera_manager"(p_company_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."current_user_company_id"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."current_user_role"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."is_active_user"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."is_super_admin"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."is_valid_camera_local_host"(p_value text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."is_valid_camera_local_host"(p_value text) TO "service_role";
GRANT EXECUTE ON FUNCTION "private"."queue_notification_event"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."admit_brain_chat_request"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admit_brain_chat_request"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."admit_device_agent_request"(p_scope text, p_identifier_hash text, p_limit integer, p_window_seconds integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."authenticate_device_agent_heartbeat"(p_public_agent_id uuid, p_credential_hash text, p_agent_version text, p_platform text, p_os_version text, p_hostname_label text, p_declared_capabilities jsonb) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."claim_brain_action_proposal"(p_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_now timestamp with time zone) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."claim_notification_delivery"(p_lease_seconds integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."claim_notification_outbox"(p_lease_seconds integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."claim_task_evidence_verification_job"(p_lease_seconds integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."claim_task_localization_job"(p_lease_seconds integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."complete_brain_action_proposal"(p_id uuid, p_payload_hash text, p_safe_result text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."complete_my_assigned_task"(p_task_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."complete_my_assigned_task"(p_task_id uuid) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."complete_notification_delivery"(p_job_id uuid, p_lease_token uuid) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."complete_task_evidence_upload"(p_evidence_id uuid, p_verified_sha256 text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."complete_task_evidence_upload"(p_evidence_id uuid, p_verified_sha256 text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."complete_task_evidence_verification_job"(p_job_id uuid, p_lease_token uuid, p_model_name text, p_model_version text, p_verdict text, p_confidence numeric, p_explanation text, p_reason_codes jsonb, p_visible_observations jsonb, p_uncertainty_flags jsonb, p_usage_metadata jsonb) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."complete_task_localization_job"(p_task_id uuid, p_language text, p_source_hash text, p_lease_token uuid, p_title text, p_description text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."consume_device_pairing_request"(p_code_hash text, p_public_agent_id uuid, p_credential_hash text, p_agent_version text, p_platform text, p_os_version text, p_hostname_label text, p_declared_capabilities jsonb) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."create_device_gateway"(p_location_id uuid, p_name text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."create_device_pairing_request"(p_gateway_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."create_task_batch_with_outbox_events"(p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_proposal_id uuid, p_items jsonb) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."create_task_with_outbox_event_due_at"(p_task_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_title text, p_description text, p_priority text, p_status text, p_assigned_employee_id uuid, p_due_date date, p_due_at timestamp with time zone, p_event_id uuid, p_event_type text, p_event_schema_version integer, p_aggregate_type text, p_aggregate_id uuid, p_command_id uuid, p_correlation_id uuid, p_event_causation_id uuid, p_proposal_id uuid, p_idempotency_key text, p_event_payload jsonb, p_occurred_at timestamp with time zone) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."create_task_with_outbox_event"(p_task_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid, p_title text, p_description text, p_priority text, p_status text, p_assigned_employee_id uuid, p_due_date date, p_event_id uuid, p_event_type text, p_event_schema_version integer, p_aggregate_type text, p_aggregate_id uuid, p_command_id uuid, p_correlation_id uuid, p_event_causation_id uuid, p_proposal_id uuid, p_idempotency_key text, p_event_payload jsonb, p_occurred_at timestamp with time zone) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."enqueue_arabic_task_localization"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."enqueue_legacy_arabic_task_localizations"(p_limit integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."enqueue_task_evidence_verification"(p_evidence_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."enqueue_task_evidence_verification"(p_evidence_id uuid) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."fail_brain_action_proposal"(p_id uuid, p_payload_hash text, p_error_code text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."fail_notification_delivery"(p_job_id uuid, p_lease_token uuid, p_code text, p_permanent boolean) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."fail_notification_outbox"(p_outbox_id uuid, p_lease_token uuid, p_code text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."fail_task_evidence_upload"(p_evidence_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."fail_task_evidence_upload"(p_evidence_id uuid) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."fail_task_evidence_verification_job"(p_job_id uuid, p_lease_token uuid, p_failure_code text, p_retryable boolean) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."fail_task_localization_job"(p_task_id uuid, p_language text, p_lease_token uuid, p_code text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."generate_task_reminder_obligations"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."get_brain_chat_quota_status"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_brain_chat_quota_status"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."get_company_notification_diagnostics"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_company_notification_diagnostics"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."get_my_notification_state"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_my_notification_state"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."get_my_task_visibility_diagnostic"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_my_task_visibility_diagnostic"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."get_task_evidence_access"(p_evidence_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_task_evidence_access"(p_evidence_id uuid) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."get_task_evidence_upload"(p_evidence_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_task_evidence_upload"(p_evidence_id uuid) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."list_my_notifications"(p_limit integer, p_before timestamp with time zone) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."list_my_notifications"(p_limit integer, p_before timestamp with time zone) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."list_task_evidence_reviews"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."list_task_evidence_reviews"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."localize_employee_notification"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."mark_all_my_notifications_read"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."mark_all_my_notifications_read"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."materialize_notification_outbox"(p_outbox_id uuid, p_lease_token uuid) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."prepare_device_gateway_repair"(p_gateway_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."prepare_task_evidence_upload"(p_task_id uuid, p_location_id uuid, p_source_type text, p_original_mime_type text, p_original_size_bytes bigint, p_original_sha256 text, p_idempotency_key uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."prepare_task_evidence_upload"(p_task_id uuid, p_location_id uuid, p_source_type text, p_original_mime_type text, p_original_size_bytes bigint, p_original_sha256 text, p_idempotency_key uuid) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."reject_brain_action_proposal"(p_id uuid, p_actor_id uuid, p_profile_id uuid, p_tenant_id uuid) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."resolve_device_agent_rate_identity"(p_public_agent_id uuid, p_credential_hash text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."review_task_evidence"(p_evidence_id uuid, p_decision text, p_note text, p_confirm boolean) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."review_task_evidence"(p_evidence_id uuid, p_decision text, p_note text, p_confirm boolean) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."revoke_device_agent"(p_gateway_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."revoke_device_pairing_request"(p_gateway_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."revoke_my_push_subscription"(p_endpoint text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."revoke_my_push_subscription"(p_endpoint text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."save_my_notification_preferences"(p_preferences jsonb) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."save_my_notification_preferences"(p_preferences jsonb) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."save_my_push_subscription"(p_endpoint text, p_p256dh text, p_auth text, p_device text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."save_my_push_subscription"(p_endpoint text, p_p256dh text, p_auth text, p_device text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."update_my_notification"(p_notification_id uuid, p_action text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."update_my_notification"(p_notification_id uuid, p_action text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."update_my_preferred_language"(p_language text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."update_my_preferred_language"(p_language text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."update_own_full_name"(new_full_name text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."update_own_full_name"(new_full_name text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."update_timestamp"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."update_timestamp"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."update_timestamp"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."update_timestamp"() TO "service_role";

-- Captured private task-evidence bucket and storage policies.
INSERT INTO storage.buckets
  (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types, type)
VALUES
  ('task-evidence', 'task-evidence', false, false, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[], 'STANDARD');

CREATE POLICY "task_evidence_original_insert" ON "storage"."objects"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK (bucket_id = 'task-evidence'::text AND private.can_upload_task_evidence_object(name));

CREATE POLICY "task_evidence_original_select" ON "storage"."objects"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING (bucket_id = 'task-evidence'::text AND private.can_read_task_evidence_object(name));

COMMIT;
