#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${RELEASE_SECURITY_PYTHON_BIN:-python3}"

exec "${PYTHON_BIN}" "${SCRIPT_DIR}/release_security_runner.py" "$@"
