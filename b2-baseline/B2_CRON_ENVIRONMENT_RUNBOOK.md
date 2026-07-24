# B2 cron and environment-bound runbook

Cron scheduling is deliberately excluded from the core baseline.

- B0 SHA-256: `51ace3fcb4cac1b84380ce83c89ad86847e13499feecd7c01017b38f154d86dc`
- B1 SHA-256: `bb16865d4ba9b2695b3aae5feb0ae38a144873c98809884c63190a494b68b188`
- No command in this document contains an unredacted cron command, credential,
  token, URL, or Vault value.

## Offline exact-byte provenance

| Job | Result | Repository SHA-256 | Production SHA-256 | Repository/Production UTF-8 bytes |
|---|---|---|---|---:|
| `camera-evidence-worker-every-minute` | MISMATCH | `9ebc1a89f598cf0ea01e930f215126dc4f0a8df8f25b288082ff782b587e1937` | `c59208259ba36d2530affd7756795dd677dfbbf0cf44e0ac99a2c2a7b03331dc` | 456 / 469 |
| `notification-worker-every-minute` | MATCH | `d1abf5f692afc7157e99aeb2231caa5db7bc89f1aef9e732af7d10a0e218e0b4` | `d1abf5f692afc7157e99aeb2231caa5db7bc89f1aef9e732af7d10a0e218e0b4` | 292 / 292 |

The notification worker is an exact repository-byte match. The camera-evidence
worker is not an exact byte match. No semantic equivalence is inferred from its
redacted structure, and the repository command must not be silently substituted.

## Environment companion decision

No executable cron companion migration is generated in B2 because one of the
two Production commands lacks exact repository provenance.

Before creating a companion migration:

1. Resolve the camera-evidence mismatch through a separately approved,
   secret-safe provenance process.
2. Confirm required Vault entries exist without exporting their values.
3. Construct scheduling SQL from an approved source, never from redacted text.
4. Keep cron scheduling outside the core object baseline.
5. Validate job name, schedule, active state, exact command digest, and absence
   of duplicate jobs in B3 or a later approved environment phase.

Do not contact or modify Production or Preview as part of this runbook.
