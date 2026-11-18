#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Preflight failed: %s\n' "$*" >&2; exit 1; }
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || fail 'Use an x86_64 Linux RTX host.'
command -v nvidia-smi >/dev/null || fail 'nvidia-smi is missing.'
mode="${1:-hardware}"
case "$mode" in
  driver|hardware|docker) ;;
  *) fail 'Expected driver, hardware, or docker.' ;;
esac
[[ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -ge 30000000 ]] || fail 'Provision a host with at least 32 GB RAM.'
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
gpu="$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
[[ "$gpu" =~ (L40S|RTX) ]] || fail "Expected an NVIDIA RTX-class GPU, found $gpu."
if [[ -n "${AMR_EXPECTED_GPU:-}" && "$gpu" != *"$AMR_EXPECTED_GPU"* ]]; then
  fail "Expected $AMR_EXPECTED_GPU, found $gpu."
fi
memory="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1)"
[[ "$memory" -ge 16000 ]] || fail 'The GPU needs at least 16 GB VRAM.'
driver="$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1)"
version_minimum="$(printf '%s\n' "$driver" 595.58.03 | sort -V | head -1)"
[[ "$version_minimum" == 595.58.03 ]] || fail "Driver $driver is older than NVIDIA's tested 595.58.03 Linux branch."
if [[ "$mode" == driver ]]; then
  printf 'NVIDIA device and driver checks passed. Check Vulkan next.\n'
  exit
fi
command -v vulkaninfo >/dev/null || fail 'Install the vulkan-tools package.'
vulkan="$(vulkaninfo --summary 2>&1)" || fail "Vulkan enumeration failed: $vulkan"
printf '%s\n' "$vulkan" | grep -Ei 'Vulkan Instance Version|deviceName|driverInfo'
grep -Ei 'deviceName.*NVIDIA.*(L40S|RTX)' <<< "$vulkan" >/dev/null || fail 'The RTX device is unavailable to Vulkan.'
if [[ "$mode" == docker ]]; then
  command -v docker >/dev/null || fail 'Docker is missing.'
  [[ "$(df -Pk . | awk 'NR == 2 {print $4}')" -ge 52428800 ]] || fail 'At least 50 GiB free space is required.'
  docker info --format 'Docker server {{.ServerVersion}} · runtimes {{json .Runtimes}}'
fi
printf 'NVIDIA and Vulkan preflight passed. Run the Isaac Sim compatibility checker next.\n'
