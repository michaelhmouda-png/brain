# Windows Brain Agent service runbook

## Supported installation

Use a dedicated Windows account with `Log on as a batch job`, no interactive administrator duties, and a stable profile. Pairing and the scheduled task must run as that same identity because DPAPI ciphertext is identity-bound. The installer requires administrator rights only to create the protected ProgramData directory and startup task.

1. Build a release archive from the accepted revision. Include `agent/`, `package.json`, `package-lock.json`, and installed production dependencies or the approved offline dependency package. Sign all PowerShell scripts with the organization code-signing certificate.
2. Calculate SHA-256 out of band and transfer archive plus checksum through the approved channel.
3. Run `Install-BrainAgent.ps1` as administrator, passing the archive, expected hash, and a securely obtained `PSCredential`. The installer never prints the password.
4. Start an interactive shell as the service identity and run the agent pairing command. Enter the one-time code only into the hidden prompt. Never place it in command history.
5. Reboot. Verify `Get-BrainAgentStatus.ps1`, then verify the cloud Agent page reports a recent heartbeat. Test recorder access only after heartbeat health is green.

The `HospiBrainAgent` Scheduled Task starts at boot and uses restart settings plus the supervisor loop. Runtime status contains only state, safe code, timestamps, and restart count. Credentials and NVR passwords remain in the service identity's DPAPI-protected, ACL-verified local state.

## Update and rollback

1. Pass Release Gate and Agent acceptance on a test host. Obtain release approval.
2. Sign the release scripts and verify the archive checksum on a second machine.
3. Run `Update-BrainAgent.ps1` with the archive and expected checksum. Releases are content-addressed; the pointer changes atomically and retains the previous release.
4. Verify local task status and cloud heartbeat within ten minutes. If startup fails, the script restores the prior pointer. To roll back an otherwise unhealthy update, run `Update-BrainAgent.ps1 -Rollback`.
5. Never delete the previous release until the new version has survived a reboot and the agreed observation window.

## Outage recovery

- `AGENT_PROCESS_FAILED`: inspect Windows Task Scheduler history and safe Agent logs; restart the task. Do not copy credentials into tickets.
- `AGENT_RELEASE_INVALID` or hash failure: restore the previous signed release; do not disable checksum enforcement.
- DPAPI/ACL failure: stop the task, preserve no plaintext, repair the service profile/ACL, and re-pair through an approved one-time code.
- Cloud offline alert with a locally running process: verify outbound HTTPS/DNS/time, then credential revocation status. The cloud never initiates inbound venue connections.
- Hardware/NVR outage: keep the Agent paired, record the venue incident, and restore local network access. Never expose NVR ports publicly.

Real Windows acceptance—reboot startup, forced process failure, DPAPI round-trip, ACL inspection, update, rollback, and offline recovery—is a launch gate and cannot be proven by repository tests alone.
