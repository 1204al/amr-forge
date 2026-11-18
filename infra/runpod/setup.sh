#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

stage="${1:-}"
case "$stage" in
  system|checker|install) ;;
  *) echo 'Usage: setup.sh {system|checker|install}' >&2; exit 2 ;;
esac
export AMR_EXPECTED_GPU="${AMR_EXPECTED_GPU:-RTX 6000 Ada}"
bash infra/isaac/preflight.sh driver
tools_dir="$root/.venv-runpod-tools"
isaac_env="$root/.venv-isaac-runpod"

if [[ "$stage" == system ]]; then
  . /etc/os-release
  [[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo 'Use the Ubuntu 24.04 Runpod template.' >&2; exit 2; }
  [[ "$(id -u)" == 0 ]] || { echo 'Run the system dependency setup as root in the Pod.' >&2; exit 2; }
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl libegl1 libgl1 libglib2.0-0t64 \
    libvulkan1 openssl python3.12 python3.12-venv vulkan-tools xz-utils
  bash infra/isaac/preflight.sh hardware
  if [[ ! -x "$tools_dir/node/bin/node" ]]; then
    archive='node-v22.22.0-linux-x64.tar.xz'
    checksum='9aa8e9d2298ab68c600bd6fb86a6c13bce11a4eca1ba9b39d79fa021755d7c37'
    mkdir -p "$tools_dir"
    staging="$(mktemp -d "$tools_dir/.node.XXXXXX")"
    trap 'rm -rf -- "$staging"' EXIT
    curl -fSL --retry 2 --max-time 120 "https://nodejs.org/dist/v22.22.0/$archive" -o "$staging/$archive"
    printf '%s  %s\n' "$checksum" "$staging/$archive" | sha256sum -c -
    mkdir -p "$staging/node"
    tar -xJf "$staging/$archive" -C "$staging/node" --strip-components=1
    mv "$staging/node" "$tools_dir/node"
  fi
  "$tools_dir/node/bin/node" --version
  exit
fi

bash infra/isaac/preflight.sh hardware
[[ "${OMNI_KIT_ACCEPT_EULA:-}" == YES ]] || { echo 'After accepting the NVIDIA terms, export OMNI_KIT_ACCEPT_EULA=YES.' >&2; exit 2; }
if [[ ! -x "$isaac_env/bin/python" ]]; then
  [[ "$(df -Pk . | awk 'NR == 2 {print $4}')" -ge 52428800 ]] || { echo 'At least 50 GiB free space is required for installation.' >&2; exit 2; }
  python3.12 -m venv "$isaac_env"
fi
pip=("$isaac_env/bin/python" -m pip --disable-pip-version-check)
if [[ "$stage" == checker ]]; then
  "${pip[@]}" install --no-cache-dir --upgrade pip
  "${pip[@]}" install --no-cache-dir packaging 'isaacsim[compatibility-check]==6.2.0.0' --extra-index-url https://pypi.nvidia.com
  exit
fi
"${pip[@]}" install --no-cache-dir torch==2.11.0 --index-url https://download.pytorch.org/whl/cu130
"${pip[@]}" install --no-cache-dir 'isaacsim[all,extscache]==6.2.0.0' --extra-index-url https://pypi.nvidia.com
"${pip[@]}" check
