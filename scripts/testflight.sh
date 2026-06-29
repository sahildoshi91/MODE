#!/usr/bin/env bash
# testflight.sh — Build and optionally submit a MODE iOS release via EAS.
#
# Usage: bash scripts/testflight.sh [flags]
#   --submit              Build then submit to TestFlight (two separate EAS calls)
#   --preflight-only      Run checks only; do not queue a build
#   --skip-security       Skip release security gate
#   --full-security       Run all gates including live-service gates (default: --local)
#   --allow-dirty         Downgrade dirty-git check from fail to warning
#   --allow-any-branch    Downgrade branch check from fail to warning
#   --skip-version-check  Skip autoIncrement check (CI escape hatch)

set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}▶${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
fail() { echo -e "${RED}✗${NC}  $*" >&2; exit 1; }
step() { echo -e "\n${BOLD}$*${NC}"; }

# ── Flags ─────────────────────────────────────────────────────────────────────
SUBMIT=false
PREFLIGHT_ONLY=false
SKIP_SECURITY=false
FULL_SECURITY=false
ALLOW_DIRTY=false
ALLOW_ANY_BRANCH=false
SKIP_VERSION_CHECK=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --submit)             SUBMIT=true ;;
    --preflight-only)     PREFLIGHT_ONLY=true ;;
    --skip-security)      SKIP_SECURITY=true ;;
    --full-security)      FULL_SECURITY=true ;;
    --allow-dirty)        ALLOW_DIRTY=true ;;
    --allow-any-branch)   ALLOW_ANY_BRANCH=true ;;
    --skip-version-check) SKIP_VERSION_CHECK=true ;;
    *) fail "Unknown flag: $1" ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# ── 1. Git state ──────────────────────────────────────────────────────────────
step "1/5  Git state"

DIRTY=$(git status --porcelain 2>/dev/null || true)
if [[ -n "${DIRTY}" ]]; then
  if [[ "${ALLOW_DIRTY}" == "true" ]]; then
    warn "Uncommitted changes detected (--allow-dirty, continuing)."
  else
    fail "Uncommitted changes detected. Commit or stash first.\n       Pass --allow-dirty to override (not recommended for releases)."
  fi
else
  log "Working tree clean."
fi

BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
if [[ "${BRANCH}" != "main" ]]; then
  if [[ "${ALLOW_ANY_BRANCH}" == "true" ]]; then
    warn "On branch '${BRANCH}' (--allow-any-branch, continuing)."
  else
    fail "Not on main (current: '${BRANCH}').\n       Pass --allow-any-branch to build from this branch."
  fi
else
  log "On main."
fi

# ── 2. Security pre-flight ────────────────────────────────────────────────────
step "2/5  Security pre-flight"

if [[ "${SKIP_SECURITY}" == "true" ]]; then
  warn "Security gate skipped (--skip-security)."
else
  SECURITY_ARGS=()
  if [[ "${FULL_SECURITY}" != "true" ]]; then
    SECURITY_ARGS=("--" "--local")
  fi
  log "Running: npm run release:security ${SECURITY_ARGS[*]+"${SECURITY_ARGS[*]}"}"
  npm run release:security "${SECURITY_ARGS[@]}" || fail "Security gate failed. Fix issues before building."
  log "Security gate passed."
fi

# ── 3. EAS auth ───────────────────────────────────────────────────────────────
step "3/5  EAS auth"

EAS_USER=$(npx eas-cli whoami 2>&1) || fail "EAS auth failed. Run: npx eas-cli login"
log "Authenticated as: ${EAS_USER}"

# ── 4. Build number strategy ──────────────────────────────────────────────────
step "4/5  Build number strategy"

AUTO_INCREMENT=$(node -e "
  try {
    const c = require('./eas.json');
    process.stdout.write(c?.build?.production?.autoIncrement === true ? 'true' : 'false');
  } catch(e) { process.stdout.write('false'); }
" 2>/dev/null || echo "false")

if [[ "${AUTO_INCREMENT}" == "true" ]]; then
  log "autoIncrement: true — EAS manages build numbers automatically."
else
  MSG="eas.json → build.production.autoIncrement is not set.\n"
  MSG+="  Add this to eas.json to enable automatic build number management:\n\n"
  MSG+='    "production": { "autoIncrement": true, "environment": "production" }'
  if [[ "${SKIP_VERSION_CHECK}" == "true" ]]; then
    warn "${MSG}\n  Continuing with --skip-version-check."
  elif [[ -t 0 ]]; then
    warn "${MSG}"
    read -r -p "  Continue anyway? [y/N] " CONFIRM
    [[ "${CONFIRM}" =~ ^[Yy]$ ]] || fail "Aborted. Set autoIncrement: true in eas.json first."
  else
    fail "${MSG}\n  Non-interactive: pass --skip-version-check to override."
  fi
fi

if [[ "${PREFLIGHT_ONLY}" == "true" ]]; then
  echo ""
  echo -e "${GREEN}${BOLD}All pre-flight checks passed.${NC} No build was queued (--preflight-only)."
  exit 0
fi

# ── 5. Build ──────────────────────────────────────────────────────────────────
step "5/5  EAS build"

log "Queueing EAS production build..."
BUILD_TMP=$(mktemp)
npx eas-cli build --platform ios --profile production --non-interactive 2>&1 | tee "${BUILD_TMP}"
BUILD_URL=$(grep -oE 'https://expo\.dev/[^[:space:]]+' "${BUILD_TMP}" | head -1 || true)
rm -f "${BUILD_TMP}"

# ── Submit ────────────────────────────────────────────────────────────────────
if [[ "${SUBMIT}" == "true" ]]; then
  echo ""
  log "Submitting to TestFlight..."
  npx eas-cli submit --platform ios --profile production --latest --non-interactive
fi

# ── Human next-step block ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [[ -n "${BUILD_URL}" ]]; then
  echo -e "  ${BOLD}Build queued:${NC} ${BUILD_URL}"
else
  echo -e "  ${BOLD}Build queued.${NC} Check expo.dev for build status."
fi
echo ""
echo -e "  ${BOLD}Next:${NC}"
echo    "  1. Wait for EAS build to finish (~10-20 min)."
if [[ "${SUBMIT}" == "true" ]]; then
  echo "  2. Wait for App Store Connect / TestFlight processing (~15 min)."
  echo "  3. Check TestFlight build number and internal tester availability."
else
  echo "  2. To submit to TestFlight: bash scripts/testflight.sh --submit"
fi
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
