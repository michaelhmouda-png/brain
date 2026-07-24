# Phase 2A Preview acceptance runbook

Production remains stopped throughout this runbook. Confirm the Supabase project and Vercel deployment are Preview-only before every operation.

## Preview environment

| Variable | Preview requirement |
|---|---|
| `BRAIN_AGENT_TOKEN_PEPPER` | Present. Exactly 64 hexadecimal characters decoding to 32 bytes. Must differ from the rate pepper and every Production pepper. |
| `BRAIN_AGENT_RATE_LIMIT_PEPPER` | Present. Exactly 64 hexadecimal characters decoding to 32 bytes. Must differ from the token pepper and every Production pepper. |
| `BRAIN_AGENT_ALLOW_INSECURE_LOCALHOST` | Absent or `false`. |
| `BRAIN_AGENT_ALLOW_DEVELOPMENT_RATE_ADDRESS` | Absent or `false`. |
| `BRAIN_AGENT_DEVELOPMENT_RATE_ADDRESS` | Absent. |

Do not view, replace, or otherwise touch Production variables. Configure the two Preview peppers only through the Vercel Preview environment UI.

Generate each secret separately in PowerShell without embedding its value in source or command history:

```powershell
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
(-join ($bytes | ForEach-Object { $_.ToString('x2') })) | Set-Clipboard
[Array]::Clear($bytes, 0, $bytes.Length)
Remove-Variable bytes
```

Paste the clipboard directly into the appropriate Preview-only Vercel variable, clear the clipboard with `Set-Clipboard -Value ''`, then repeat for the second pepper. Confirm visually only that each value has 64 hexadecimal characters; never record the values in the evidence report.

## Migration sequence

1. In Supabase, confirm the project reference is the dedicated Preview project—not `brain-production`.
2. Run `phase2a-preflight.sql` as one statement. Continue only for `GO`. Investigate `REVIEW`; stop for `NO-GO`.
3. Copy the complete contents of `apply-202607220016.sql` into Preview SQL Editor and run it once.
4. Run `phase2a-verify.sql`. Require every check and the overall decision to be `PASS`.
5. Run `phase2a-smoke.sql`. It is one anonymous block whose inner subtransaction is deliberately rolled back. Require the final notice to report every test passed and zero persisted rows.
6. Run `phase2a-concurrency.sql` to confirm concurrency-runner readiness. It does not claim to prove concurrency.

`apply-202607220016.sql` must be byte-for-byte identical to `supabase/migrations/202607220016_brain_agent_secure_pairing.sql` before use.

## Real concurrency

A single SQL Editor session cannot prove parallel behavior. On a trusted test workstation, populate these process-scoped variables with Preview-only values. Do not put values in a script or commit them:

```powershell
$env:PREVIEW_SUPABASE_URL = Read-Host 'Preview Supabase URL'
$env:PREVIEW_ANON_KEY = Read-Host 'Preview anon key'
$env:PREVIEW_SERVICE_ROLE_KEY = Read-Host 'Preview service-role key' -MaskInput
$env:PREVIEW_OWNER_ACCESS_TOKEN = Read-Host 'Short-lived Preview owner access token' -MaskInput
$env:PREVIEW_LOCATION_ID = Read-Host 'Preview active location UUID'
node phase2a-concurrency-runner.mjs
```

The runner performs real parallel RPC calls for simultaneous first admissions, the exact limit boundary, the first rejection, key isolation, pairing consumption, heartbeat/revocation, and stable-ID re-pairing. It prints no pairing code, credential hash, token, or personal data. Record its temporary gateway UUID only for cleanup.

Immediately remove the temporary Preview fixture in SQL Editor after confirming its generated name begins `Phase2A concurrency `. Substitute the recorded UUID only after independently checking the name:

```sql
BEGIN;
DO $$
DECLARE v_gateway uuid := 'REPLACE_WITH_RECORDED_PREVIEW_GATEWAY_UUID'::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.device_gateways WHERE id=v_gateway AND name LIKE 'Phase2A concurrency %') THEN
    RAISE EXCEPTION 'PHASE2A_CLEANUP_GATEWAY_NOT_CONFIRMED';
  END IF;
  DELETE FROM public.device_agent_audit WHERE gateway_id=v_gateway;
  DELETE FROM public.device_gateway_capabilities WHERE gateway_id=v_gateway;
  DELETE FROM public.device_agent_credentials WHERE gateway_id=v_gateway;
  DELETE FROM public.device_pairing_requests WHERE gateway_id=v_gateway;
  DELETE FROM public.device_gateways WHERE id=v_gateway;
  DELETE FROM public.device_agent_rate_limits WHERE scope='pairing' AND identifier_hash IN (
    'REPLACE_WITH_FIRST_RECORDED_LIMITER_HASH','REPLACE_WITH_SECOND_RECORDED_LIMITER_HASH'
  );
END $$;
COMMIT;
```

Clear all five local environment variables and close the terminal afterward.

## Vercel trusted-header acceptance

The temporary endpoint `/api/agent/header-acceptance` exists only for this Preview test, is disabled outside `VERCEL_ENV=preview`, requires an HMAC proof derived from the Preview token pepper, and returns only presence, single-IP parsing, and a 12-character HMAC fingerprint.

Use a trusted PowerShell 7 session. Read the Preview pepper without echoing it, derive the short-lived proof in memory, and issue both requests from the same network:

```powershell
$deployment = Read-Host 'Exact Preview deployment origin, without trailing slash'
$secure = Read-Host 'Preview token pepper' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $pepper = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
$key = [Convert]::FromHexString($pepper)
$hmac = [Security.Cryptography.HMACSHA256]::new($key)
$proof = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes('phase2a-preview-header-acceptance-v1'))).TrimEnd('=').Replace('+','-').Replace('/','_')
$normal = Invoke-RestMethod "$deployment/api/agent/header-acceptance" -Headers @{ 'x-phase2a-acceptance-proof'=$proof }
$spoof = Invoke-RestMethod "$deployment/api/agent/header-acceptance" -Headers @{ 'x-phase2a-acceptance-proof'=$proof; 'x-forwarded-for'='203.0.113.99' }
[pscustomobject]@{ normalPresent=$normal.trustedAddressPresent; normalSingle=$normal.parsedAsSingleIp; spoofPresent=$spoof.trustedAddressPresent; spoofSingle=$spoof.parsedAsSingleIp; fingerprintsMatch=($normal.fingerprintPrefix -eq $spoof.fingerprintPrefix) }
[Array]::Clear($key,0,$key.Length);$hmac.Dispose();$pepper=$null;$proof=$null
```

Pass requires both presence fields, both single-IP fields, and `fingerprintsMatch` to be true. Stop immediately if the spoof changes the fingerprint, produces a forwarding chain, or makes the endpoint unavailable. Remove the temporary endpoint before any Production deployment.

## Windows acceptance

Use a dedicated, non-administrator Windows account on a disposable Preview workstation.

1. Install the reviewed source and dependencies with `npm ci`. Do not install global services or hardware packages.
2. Confirm the Preview URL is HTTPS and is not Production. Leave all insecure-localhost variables absent.
3. In the Preview owner UI, create a gateway and generate one pairing code.
4. Run `npm run agent:pair`. Enter the Preview URL visibly. Confirm the pairing-code input is hidden and the code never appears in terminal output or history.
5. Inspect ACLs without printing state content:

   ```powershell
   $dir = Join-Path $env:LOCALAPPDATA 'HospiBrain'
   $state = Join-Path $dir 'brain-agent.json'
   Get-Acl $dir | Format-List Owner,AccessToString
   Get-Acl $state | Format-List Owner,AccessToString
   (Get-Acl $dir).Access.Count
   (Get-Acl $state).Access.Count
   ```

   Require the dedicated account to own both objects and exactly one allow/full-control rule on each.
6. Prove plaintext absence without printing the file: `if (Select-String -LiteralPath $state -Pattern 'brain_agent_v1_' -Quiet) { 'FAIL' } else { 'PASS' }`.
7. Run `npm run agent:status`; confirm only safe IDs/status metadata appear.
8. Run `npm run agent:start`; confirm bounded heartbeat output and no credential output. Stop it normally, restart it, and confirm DPAPI decrypts under the same account.
9. Revoke the agent in Preview. Confirm the next authenticated operation reaches `REPAIR_REQUIRED` and terminates instead of producing a retry storm.
10. In the UI select “Prepare for re-pairing,” generate a new code, and run `npm run agent:pair` again. Compare only a SHA-256 prefix of the persisted public UUID before/after if evidence is required; never print the UUID.
11. Confirm the prior credential remains rejected using the database smoke/concurrency evidence; do not extract the old token from memory or files.
12. Run `npm run agent:unpair-local`; require `Test-Path $state` to return `False`.

## Browser and API acceptance

- Owner: create gateway, generate a one-time code, revoke, prepare for re-pairing, and regenerate.
- Super-admin: same authorized management behavior within the persisted company.
- Manager: read-only agent state; every management POST/DELETE returns 403.
- Employee: navigation hidden; direct page/API access denied safely.
- Two-company test: company A cannot view or mutate company B gateway/location identifiers; responses must not disclose existence.
- Unauthorized-location IDs fail closed.
- The pairing code appears only in the successful creation response and cannot be retrieved on refresh.
- Arabic renders RTL with understandable status/action labels; mobile controls remain usable at 320px and 390px widths.
- No response or UI exposes code hashes, credential hashes, credentials, throttle rows, raw addresses, audit internals, hostname labels, or service credentials.
- No camera, NVR, RTSP, ONVIF, FFmpeg, private-host, command, plugin, sensor, POS, printer, or controller interaction occurs.

## Decision

Production remains **STOP** unless migration verification, rollback smoke, real concurrency, Vercel trusted-header, real Windows DPAPI/ACL, all browser roles, revocation, and stable-ID re-pairing pass; no secret appears anywhere; and no hardware/private-network traffic occurs.
