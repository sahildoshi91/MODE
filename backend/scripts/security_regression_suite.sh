#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKEND_ROOT}/.." && pwd)"

PYTHON_BIN="${PYTHON_BIN:-${BACKEND_ROOT}/venv/bin/python}"
PYTEST_BIN="${PYTEST_BIN:-${BACKEND_ROOT}/venv/bin/pytest}"
TARGET_ENV="${MODE_SECURITY_TARGET_ENV:-production}"

cd "${BACKEND_ROOT}"

"${PYTHON_BIN}" scripts/check_personal_data_inventory.py
"${PYTHON_BIN}" scripts/security_release_preflight.py --env "${TARGET_ENV}"
APP_ENV=development RATE_LIMIT_BACKEND=memory "${PYTEST_BIN}" -q \
  tests/test_personal_data_inventory_contract.py \
  tests/test_account_deletion_service.py \
  tests/test_storage_private_api.py \
  tests/test_storage_orphan_cleanup_service.py \
  tests/test_security_release_preflight_static.py \
  tests/test_startup_guards.py \
  tests/test_staging_db_security_check_static.py \
  tests/test_ios_security_scripts_static.py \
  tests/test_storage_access_audit_static.py \
  tests/test_storage_orphan_cleanup_script_static.py

"${PYTHON_BIN}" "${REPO_ROOT}/scripts/storage_access_audit.py"

if [[ "${MODE_REQUIRE_STAGING_DB_SECURITY_CHECK:-0}" == "1" ]]; then
  "${PYTHON_BIN}" scripts/staging_db_security_check.py
fi

if [[ "${MODE_REQUIRE_IOS_LINT:-0}" == "1" ]]; then
  "${PYTHON_BIN}" "${REPO_ROOT}/scripts/ios_hardening_lint.py" --require-prebuild
fi

if [[ "${MODE_REQUIRE_IOS_ARTIFACT_SCAN:-0}" == "1" ]]; then
  "${PYTHON_BIN}" "${REPO_ROOT}/scripts/ios_artifact_scan.py" --require-ipa
fi

echo "Security regression suite: PASSED"
