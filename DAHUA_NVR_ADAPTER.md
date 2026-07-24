# Dahua NVR Adapter

## Security boundary

The Dahua integration runs only inside the paired Windows Brain Agent at the venue. Brain queues a durable, gateway-scoped command through the Device Agent command transport; the agent polls outbound, performs one fixed read-only Dahua CGI operation on the venue LAN, and returns a bounded result through the existing lease.

The browser and Brain cloud never connect to the NVR. NVR usernames and passwords never enter the database or a browser response. They are entered in a hidden local terminal prompt and stored in the agent state with Windows DPAPI and a user-only ACL.

The adapter resolves the configured NVR host locally, accepts only RFC1918 IPv4 or IPv6 ULA targets, connects to the resolved private address, rejects redirects, uses Digest authentication, and permits only these fixed `GET` requests:

- system information for capability detection and health diagnostics
- current NVR time for health diagnostics
- all-camera discovery
- JPEG snapshot for a numeric channel from 1 through 256

There is no generic HTTP request surface. PTZ, configuration, firmware, user management, credential export, deletion, reboot, and video streaming are not implemented.

## Supported command behavior

- `nvr_capability_probe`: returns a fixed Dahua capability list after a successful system-information probe.
- `nvr_health_diagnostics`: returns only vendor, model, software version, device time, health, and bounded latency.
- `channel_discovery`: returns channel ID, display name, enabled state, and status. The successful command result synchronizes the tenant- and location-bound Camera Manager inventory.
- `snapshot_request`: obtains a bounded JPEG and uploads it outbound to a private, expiring `camera-snapshots` artifact. Authorized Camera Manager users receive a 60-second signed URL; they never receive an NVR address or credential.

Inventory synchronization and snapshot acceptance occur only while completing a valid leased command whose company, location, gateway, and NVR relationships still match.

## Local credential setup

Run this on the paired venue agent in an interactive terminal:

```powershell
node --experimental-strip-types agent/src/cli.ts set-nvr-credentials <nvr-connection-uuid>
```

The username and password prompts are hidden. Remove the local credential with:

```powershell
node --experimental-strip-types agent/src/cli.ts remove-nvr-credentials <nvr-connection-uuid>
```

The CLI intentionally has no command for displaying or exporting a credential.

## Validation boundary

All adapter integration tests use injected mocked Dahua responses. No test or application path in this phase contacts a real NVR. Live hardware connection requires separate approval.
