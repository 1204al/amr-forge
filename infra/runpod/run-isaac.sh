#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export AMR_EXPECTED_GPU="${AMR_EXPECTED_GPU:-RTX 6000 Ada}"
export AMR_ISAAC_PYTHON="$root/.venv-isaac-runpod/bin/python"
export PATH="$root/.venv-runpod-tools/node/bin:$PATH"
if [[ "$EUID" == 0 ]]; then
  export OMNI_KIT_ALLOW_ROOT=1
fi
exec bash "$root/infra/isaac/run.sh" python "$@"
