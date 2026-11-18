#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

runtime="${1:-}"
mode="${2:-}"
run_dir="${3:-}"
image='nvcr.io/nvidia/isaac-sim:6.2.0'
case "$runtime/$mode" in
  docker/pull|docker/probe|docker/smoke|docker/scenario|docker/live|python/probe|python/smoke|python/scenario|python/live) ;;
  *) echo 'Usage: run.sh {docker|python} {pull|probe|smoke|scenario|live} [absolute output directory]' >&2; exit 2 ;;
esac

if [[ "$runtime" == docker ]]; then
  [[ "${ACCEPT_EULA:-}" == "Y" ]] || { echo 'Review the NVIDIA terms, then set ACCEPT_EULA=Y to run.' >&2; exit 2; }
  bash infra/isaac/preflight.sh docker
  if [[ "$mode" == pull ]]; then
    timeout --signal=TERM --kill-after=10s 20m docker pull "$image"
    exit
  fi
  docker image inspect "$image" >/dev/null
else
  [[ "${OMNI_KIT_ACCEPT_EULA:-}" == YES ]] || { echo 'After accepting the NVIDIA terms, export OMNI_KIT_ACCEPT_EULA=YES.' >&2; exit 2; }
  bash infra/isaac/preflight.sh hardware
  isaac_python="${AMR_ISAAC_PYTHON:-}"
  if [[ "$isaac_python" != /* || ! -x "$isaac_python" ]]; then
    echo 'Set AMR_ISAAC_PYTHON to the absolute path to the Isaac Sim virtual environment Python.' >&2
    exit 2
  fi
fi

for exe in node curl openssl timeout; do command -v "$exe" >/dev/null || { echo "$exe is required." >&2; exit 2; }; done
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(Number(major < 22 || (major === 22 && minor < 18)));' ||
  { echo 'Node.js 22.18+ is required for the bridge.' >&2; exit 2; }
[[ "$run_dir" == /* ]] || { echo 'Provide an absolute output directory.' >&2; exit 2; }
mkdir -p "$run_dir/cache"
run_dir="$(cd "$run_dir" && pwd)"
[[ -w "$run_dir" ]] || { echo 'Output directory is not writable.' >&2; exit 2; }

container="amr-forge-isaac-$mode-$$"
export AMR_DRIVER_TOKEN="${AMR_DRIVER_TOKEN:-$(openssl rand -hex 32)}"
export AMR_BRIDGE_PORT=8765
bridge_url=http://127.0.0.1:8765
if [[ "$runtime" == docker ]]; then
  mkdir -p "$run_dir/cache/"{main,kit,logs,config}
  container_args=(
    --rm --init --name "$container" --gpus "device=0" --network host
    --user "$(id -u):$(id -g)" -e ACCEPT_EULA -e AMR_DRIVER_TOKEN
    -e HOME=/output/cache -e NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute
    -e XDG_CACHE_HOME=/output/cache
    -v "$root:/workspace/amr-forge:ro" -v "$run_dir:/output:rw"
    -v "$run_dir/cache/main:/isaac-sim/.cache:rw"
    -v "$run_dir/cache/kit:/isaac-sim/kit/cache:rw"
    -v "$run_dir/cache/logs:/isaac-sim/.nvidia-omniverse/logs:rw"
    -v "$run_dir/cache/config:/isaac-sim/.nvidia-omniverse/config:rw"
    --entrypoint /bin/bash "$image"
  )
  probe=(docker run "${container_args[@]}" -c 'cd /isaac-sim && ./isaac-sim.compatibility_check.sh --/app/quitAfter=10 --no-window')
  runner=(docker run "${container_args[@]}" -c 'cd /isaac-sim && exec ./python.sh /workspace/amr-forge/sim/isaac/warehouse.py --output /output "$@"' bash)
else
  export XDG_CACHE_HOME="$run_dir/cache"
  probe=("$(dirname "$isaac_python")/isaacsim" isaacsim.exp.compatibility_check --/app/quitAfter=10 --no-window)
  runner=("$isaac_python" "$root/sim/isaac/warehouse.py" --output "$run_dir")
fi

bridge=''
launcher=''
container_started=false
recording_saved=false
export_recording() {
  if curl -fsS --max-time 6 "$bridge_url/recording" -o "$run_dir/recording.tmp"; then
    mv "$run_dir/recording.tmp" "$run_dir/isaac-recording.json"
    recording_saved=true
  else
    rm -f "$run_dir/recording.tmp"
    return 1
  fi
}
cleanup() {
  if [[ "$container_started" == true ]]; then docker stop -t 10 "$container" >/dev/null 2>&1 || true; fi
  if [[ -n "$launcher" ]]; then
    kill -TERM "$launcher" 2>/dev/null || true
    wait "$launcher" 2>/dev/null || true
  fi
  if [[ ( "$mode" == scenario || "$mode" == live ) && -n "$bridge" && "$recording_saved" == false ]]; then
    export_recording || true
  fi
  if [[ -n "$bridge" ]]; then kill "$bridge" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$mode" == probe ]]; then
  if [[ "$runtime" == docker ]]; then container_started=true; fi
  timeout --signal=TERM --kill-after=15s 6m "${probe[@]}" 2>&1 | tee "$run_dir/compatibility.log"
  if ! grep -q 'System checking result: PASSED' "$run_dir/compatibility.log"; then
    printf 'Compatibility checker did not report PASSED. Review %s/compatibility.log.\n' "$run_dir" >&2
    exit 1
  fi
  exit
fi

if curl -fsS --max-time 2 "$bridge_url/health" >/dev/null 2>&1; then
  echo 'An Isaac telemetry bridge is already running on port 8765.' >&2
  exit 2
fi
node sim/isaac/bridge.ts >"$run_dir/bridge.log" 2>&1 &
bridge=$!
ready=false
for _ in {1..25}; do
  if curl -fsS --max-time 2 "$bridge_url/health" >/dev/null 2>&1; then ready=true; break; fi
  kill -0 "$bridge" 2>/dev/null || { cat "$run_dir/bridge.log" >&2; exit 1; }
  sleep .2
done
[[ "$ready" == true ]] || { cat "$run_dir/bridge.log" >&2; exit 1; }

if [[ "$mode" == smoke ]]; then runner+=(--smoke); fi
if [[ "$mode" == scenario && -n "${AMR_SCENARIO_SECONDS:-}" ]]; then
  runner+=(--limit "$AMR_SCENARIO_SECONDS")
fi
if [[ "$runtime" == docker ]]; then container_started=true; fi
timeout --signal=TERM --kill-after=15s "${AMR_MAX_RUNTIME:-20m}" "${runner[@]}"   >"$run_dir/$mode.log" 2>&1 &
launcher=$!

if [[ "$mode" == scenario ]]; then
  ready=false
  for _ in {1..180}; do
    if curl -fsS --max-time 2 "$bridge_url/health" | grep -q '"connected":true'; then ready=true; break; fi
    if ! kill -0 "$launcher" 2>/dev/null; then tail -40 "$run_dir/$mode.log"; exit 1; fi
    sleep 1
  done
  [[ "$ready" == true ]] || { echo "Driver did not come online. See $run_dir/$mode.log" >&2; exit 1; }
  curl -fsS --max-time 7 -H 'Content-Type: application/json' -d '{"type":"scenario"}'     "$bridge_url/commands" | grep -q '"ok":true'
fi

if ! wait "$launcher"; then
  launcher=''
  tail -40 "$run_dir/$mode.log" >&2
  exit 1
fi
launcher=''
if [[ "$mode" == scenario ]]; then
  export_recording
  node sim/isaac/verify-recording.ts "$run_dir/isaac-recording.json" | tee "$run_dir/validation.json"
fi
