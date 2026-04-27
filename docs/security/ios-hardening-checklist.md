# iOS Hardening Checklist

## Runtime Config
- ATS enabled (`NSAppTransportSecurity` present)
- `NSAllowsArbitraryLoads=false`
- no insecure HTTP exceptions in `NSExceptionDomains`
- custom scheme defined and non-generic (`expo.scheme`)
- associated domains configured (`expo.ios.associatedDomains`)
- auth callback is pinned to `mode://auth/callback`

## Logging Redaction
- no token logging
- no email logging
- no raw chat message logging
- no health/injury note logging
- no prompt logging
- no service key logging

Automated check:
```bash
python scripts/ios_hardening_lint.py --require-prebuild
```

## Release Artifact Scan (IPA)
- no `SUPABASE_SERVICE_ROLE_KEY` references
- no `sb_secret_...` values
- no private API key signatures
- no staging/local URLs
- no debug flags (`__DEV__`, dev diagnostics toggles)
- no test fixture tokens/users
- no verbose log signatures

Automated check:
```bash
python scripts/ios_artifact_scan.py --require-ipa
```

## CI Gate
- workflow: `.github/workflows/security-release-gates.yml`
- job: `ios-security-gate`
- command sequence:
  1. `python scripts/ios_hardening_lint.py --require-prebuild`
  2. `python scripts/ios_artifact_scan.py --require-ipa`
