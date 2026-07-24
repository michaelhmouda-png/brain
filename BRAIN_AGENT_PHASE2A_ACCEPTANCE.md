# Brain Agent Phase 2A acceptance gates

- Migration `202607220016_brain_agent_secure_pairing.sql` remains unapplied and must be reviewed and applied alone.
- Vercel Preview must prove that direct requests cannot spoof `x-forwarded-for`; the implementation relies on Vercel overwriting it as documented. No proxy may sit in front unless its Vercel trusted-proxy contract is separately approved.
- Preview and Production must each receive distinct, independently generated 32-byte hexadecimal values for `BRAIN_AGENT_TOKEN_PEPPER` and `BRAIN_AGENT_RATE_LIMIT_PEPPER`. The two values within one environment must also differ.
- Rotating the token pepper invalidates every active credential and requires controlled re-pairing. Rotating the rate pepper resets limiter identity continuity.
- A real Supabase test must send simultaneous first requests for one limiter key and verify exact admission at the boundary. It must also exercise pairing consumption, revocation/heartbeat races, stable-ID re-pairing, RLS, and grants.
- A supported Windows host must verify DPAPI round-trip under the intended service user; user-only directory and file ACLs before/after restart; failure cleanup; hidden pairing input; redirect rejection; revocation; and bounded reconnect backoff. Structural tests do not prove Windows ACL correctness.
- Development HTTP is limited to `localhost:3000` and `localhost:3100` and requires `BRAIN_AGENT_ALLOW_INSECURE_LOCALHOST=true`. Development address throttling separately requires `BRAIN_AGENT_ALLOW_DEVELOPMENT_RATE_ADDRESS=true` and a valid `BRAIN_AGENT_DEVELOPMENT_RATE_ADDRESS` IP.
