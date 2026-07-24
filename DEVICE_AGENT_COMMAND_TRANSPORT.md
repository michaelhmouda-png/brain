# Device Agent command transport

This phase adds the cloud-to-venue command envelope and stops before any
vendor-specific NVR adapter.

## Trust boundary

- An active `manager`, `owner`, or `super_admin` may enqueue an allowlisted
  read-only command through the authenticated cloud application service.
- PostgreSQL derives the company and profile from `auth.uid()`. It verifies the
  gateway, active location, assigned NVR, active credential, and approved
  `brain.command.transport.v1` capability in the same transaction.
- The Brain Agent initiates every connection to Brain over HTTPS. The cloud
  application never connects to a private NVR address.
- Agent claim and completion calls use the paired gateway credential. The
  credential hash, lease token, private host, and port metadata are never
  returned through the browser command-status API.
- NVR username/password values are not part of this transport. Neither secret
  values nor secret references are included in command claims.

## Durable state machine

`device_commands` stores the durable intent and terminal result.
`device_command_attempts` stores every short-lived lease and its completion
fingerprint. `device_command_audit` records enqueue, lease, retry, expiry,
completion, and duplicate-completion events without request or result content.

The canonical states are:

`pending -> leased -> succeeded`

`pending -> leased -> pending` for a bounded retry

`pending|leased -> expired`

`leased -> failed` for a non-retryable error or exhausted attempts

Company-scoped UUID idempotency keys return the original command for identical
retries and fail closed if reused for a different request. Claims use
`FOR UPDATE SKIP LOCKED`, a maximum 45-second lease, at most three attempts by
default, exponential retry delay capped at 30 seconds, and an absolute lifetime
of 30–600 seconds.

## Command types

- `agent_health`: implemented locally without NVR access.
- `network_reachability`: opens a TCP connection from the venue agent to one
  configured NVR port. DNS is resolved locally and the socket connects only to
  an RFC1918 IPv4 or IPv6 ULA address.
- `nvr_capability_probe`: transport contract only; returns
  `NVR_ADAPTER_NOT_AVAILABLE`.
- `channel_discovery`: transport contract only; returns
  `NVR_ADAPTER_NOT_AVAILABLE`.
- `snapshot_request`: transport contract only; returns
  `NVR_ADAPTER_NOT_AVAILABLE`.

PTZ, configuration changes, deletion, reboot, firmware operations, credential
retrieval, arbitrary URLs, arbitrary ports, and remote execution are outside
the allowlist.

## Forward migration

The phase is introduced only by
`supabase/migrations/202607240001_device_agent_command_transport.sql`, after the
frozen `202607240000_current_state_baseline.sql`. The archived pre-baseline
migrations and their manifest remain immutable. Cron scheduling remains outside
the executable baseline, and the camera-evidence cron provenance mismatch
remains unresolved.
