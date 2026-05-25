#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/security_scan_secrets.sh

Runs a redacted baseline secret scan. Local ignored env files are skipped by
default; set MODE_SECURITY_SCAN_INCLUDE_ENV=1 to include them. External tools
are disabled by default; set MODE_SECURITY_SCAN_USE_EXTERNAL_TOOLS=1 to allow
gitleaks/trufflehog when installed.
EOF
  exit 0
fi

echo "[security] secret scan starting in ${REPO_ROOT}"

SCAN_GLOBS=(
  --glob '!.git/**'
  --glob '!node_modules/**'
  --glob '!backend/venv/**'
  --glob '!.expo/**'
  --glob '!build/**'
  --glob '!dist/**'
  --glob '!security_artifacts/**'
  --glob '!**/__pycache__/**'
  --glob '!backend/scripts/temp_token.txt'
  --glob '!*.snap'
)

if [[ "${MODE_SECURITY_SCAN_INCLUDE_ENV:-0}" != "1" ]]; then
  SCAN_GLOBS+=(
    --glob '!.env'
    --glob '!.env.local'
    --glob '!.env.development'
    --glob '!.env.production'
    --glob '!.env.release'
    --glob '!.env.staging'
    --glob '!backend/.env'
    --glob '!backend/.env.local'
    --glob '!backend/.env.development'
    --glob '!backend/.env.production'
    --glob '!backend/.env.release'
    --glob '!backend/.env.staging'
  )
  echo "[security] skipping ignored local env files (set MODE_SECURITY_SCAN_INCLUDE_ENV=1 to include)"
else
  echo "[security] including ignored local env files with redacted output"
fi

_redact_stream() {
  python3 -c '
import re
import sys

REDACTIONS = [
    (re.compile(r"sk-[A-Za-z0-9_-]{16,}"), "sk-[redacted]"),
    (re.compile(r"sb_(publishable|secret|service_role)_[A-Za-z0-9._-]{12,}"), r"sb_\1_[redacted]"),
    (re.compile(r"AIza[0-9A-Za-z_-]{20,}"), "AIza[redacted]"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "AKIA[redacted]"),
    (
        re.compile(
            r"((?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET|WEBHOOK_SECRET|SIGNING_SECRET|STRIPE_SECRET_KEY|FIREBASE_PRIVATE_KEY)[\s]*=[\s]*)(?![\"'\'']?<)[^\s]+",
            re.IGNORECASE,
        ),
        r"\1[redacted]",
    ),
    (
        re.compile(
            r"(\"(?:raw|rawv2|secret|token|password|private[_-]?key|api[_-]?key)\"[\s]*:[\s]*)\"[^\"]*\"",
            re.IGNORECASE,
        ),
        r"\1\"[redacted]\"",
    ),
]

for line in sys.stdin:
    redacted = line
    for pattern, replacement in REDACTIONS:
        redacted = pattern.sub(replacement, redacted)
    sys.stdout.write(redacted)
'
}

_run_tool_with_redaction() {
  set +e
  "$@" 2>&1 | _redact_stream
  local statuses=("${PIPESTATUS[@]}")
  set -e

  local tool_status="${statuses[0]}"
  local redactor_status="${statuses[1]}"
  if [[ "${redactor_status}" -ne 0 ]]; then
    echo "[security] output redactor failed"
    exit "${redactor_status}"
  fi
  exit "${tool_status}"
}

_run_redacted_rg() {
  local label="$1"
  local pattern="$2"
  local replacement="$3"
  local output
  local rg_status
  local rg_args=(rg -n --pcre2 --hidden)

  if [[ "${MODE_SECURITY_SCAN_INCLUDE_ENV:-0}" == "1" ]]; then
    rg_args+=(--no-ignore)
  fi

  set +e
  output="$(
    "${rg_args[@]}" \
      "${SCAN_GLOBS[@]}" \
      --only-matching \
      --replace "${replacement}" \
      "${pattern}" \
      .
  )"
  rg_status="$?"
  set -e

  if [[ "${rg_status}" -eq 0 ]]; then
    while IFS= read -r line; do
      [[ -n "${line}" ]] || continue
      echo "[security] ${label}:${line}"
    done <<< "${output}"
    return 100
  fi

  if [[ "${rg_status}" -eq 1 ]]; then
    return 0
  fi

  echo "[security] rg scan failed for ${label}"
  return "${rg_status}"
}

_is_safe_env_template_path() {
  local path="$1"
  case "${path}" in
    .env.example|*.env.example|*.example|backend/.env.example)
      return 0
      ;;
  esac
  return 1
}

_check_tracked_risky_env_files() {
  local path
  local found_path=0

  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    if _is_safe_env_template_path "${path}"; then
      continue
    fi
    echo "[security] tracked_risky_env_file:${path}"
    found_path=1
  done < <(git ls-files '.env' '.env.*' 'backend/.env' 'backend/.env.*' 2>/dev/null)

  if [[ "${found_path}" -eq 1 ]]; then
    return 100
  fi
  return 0
}

_check_suspicious_secret_paths() {
  local path
  local found_path=0

  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    if [[ "${path}" =~ (^|/)(temp[_-]?token|token|tokens|secret|secrets|service[_-]?role)(\.[A-Za-z0-9_-]+)?$ ]] \
      || [[ "${path}" =~ (^|/).*(token|secret|service[_-]?role).*\.(txt|env|json|pem|key)$ ]]; then
      echo "[security] suspicious_secret_path:${path}"
      found_path=1
    fi
  done < <(git ls-files --others --exclude-standard 2>/dev/null)

  if [[ "${found_path}" -eq 1 ]]; then
    return 100
  fi
  return 0
}

if [[ "${MODE_SECURITY_SCAN_USE_EXTERNAL_TOOLS:-0}" == "1" ]]; then
  if command -v gitleaks >/dev/null 2>&1; then
    echo "[security] running gitleaks filesystem scan with redacted output"
    _run_tool_with_redaction gitleaks detect \
      --no-git \
      --source . \
      --redact
  fi

  if command -v trufflehog >/dev/null 2>&1; then
    echo "[security] running trufflehog filesystem scan with redacted output"
    _run_tool_with_redaction trufflehog filesystem . --only-verified --json
  fi

  echo "[security] external scanner mode requested but gitleaks/trufflehog not installed; running baseline regex scan"
else
  echo "[security] external scanner mode disabled; running baseline regex scan with repo exclusions"
fi

found=0
_check_tracked_risky_env_files || status="$?"
if [[ "${status:-0}" -eq 100 ]]; then
  found=1
elif [[ "${status:-0}" -ne 0 ]]; then
  exit "${status}"
fi
unset status

_check_suspicious_secret_paths || status="$?"
if [[ "${status:-0}" -eq 100 ]]; then
  found=1
elif [[ "${status:-0}" -ne 0 ]]; then
  exit "${status}"
fi
unset status

_run_redacted_rg \
  "secret_like_content" \
  '(sk-[A-Za-z0-9_-]{16,}|sb_(publishable|secret|service_role)_[A-Za-z0-9._-]{20,}|AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|-----BEGIN[[:space:]]+([A-Z]+[[:space:]]+)?PRIVATE[[:space:]]+KEY-----)' \
  '[redacted]' || status="$?"
if [[ "${status:-0}" -eq 100 ]]; then
  found=1
elif [[ "${status:-0}" -ne 0 ]]; then
  exit "${status}"
fi
unset status

_run_redacted_rg \
  "high_privilege_env_assignment" \
  '(OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET|WEBHOOK_SECRET|SIGNING_SECRET|STRIPE_SECRET_KEY|FIREBASE_PRIVATE_KEY)[[:space:]]*=[[:space:]]*(?!["'\'']?<)[^[:space:]]{24,}' \
  '$1=[redacted]' || status="$?"
if [[ "${status:-0}" -eq 100 ]]; then
  found=1
elif [[ "${status:-0}" -ne 0 ]]; then
  exit "${status}"
fi
unset status

if [[ "${found}" -eq 1 ]]; then
  echo "[security] potential secret-like content detected (redacted matches above)"
  exit 1
fi

echo "[security] no baseline secret patterns detected"
