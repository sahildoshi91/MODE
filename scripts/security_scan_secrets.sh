#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

echo "[security] secret scan starting in ${REPO_ROOT}"

SCAN_GLOBS=(
  --glob '!.git/**'
  --glob '!node_modules/**'
  --glob '!backend/venv/**'
  --glob '!*.snap'
)

if [[ "${MODE_SECURITY_SCAN_INCLUDE_ENV:-0}" != "1" ]]; then
  SCAN_GLOBS+=(--glob '!.env' --glob '!backend/.env')
  echo "[security] skipping local .env files (set MODE_SECURITY_SCAN_INCLUDE_ENV=1 to include)"
fi

if command -v gitleaks >/dev/null 2>&1; then
  echo "[security] running gitleaks filesystem scan"
  gitleaks detect \
    --no-git \
    --source . \
    --redact \
    --verbose
  exit 0
fi

if command -v trufflehog >/dev/null 2>&1; then
  echo "[security] running trufflehog filesystem scan"
  trufflehog filesystem . --only-verified --json
  exit 0
fi

echo "[security] gitleaks/trufflehog not installed; running baseline regex scan"
if rg -n \
  --hidden \
  "${SCAN_GLOBS[@]}" \
  '(sk-[A-Za-z0-9]{32,}|sb_(publishable|secret|service_role)_[A-Za-z0-9._-]{20,}|AIza[0-9A-Za-z\\-_]{35}|AKIA[0-9A-Z]{16}|-----BEGIN[[:space:]]+([A-Z]+[[:space:]]+)?PRIVATE[[:space:]]+KEY-----)' \
  .; then
  echo "[security] potential secret-like content detected (see matches above)"
  exit 1
fi

if rg -n \
  --hidden \
  "${SCAN_GLOBS[@]}" \
  '(OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET|WEBHOOK_SECRET|SIGNING_SECRET|STRIPE_SECRET_KEY|FIREBASE_PRIVATE_KEY)[[:space:]]*=[[:space:]]*[^[:space:]]{24,}' \
  .; then
  echo "[security] high-privilege environment variable assignment detected (see matches above)"
  exit 1
fi

echo "[security] no baseline secret patterns detected"
