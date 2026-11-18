# Isaac Sim 6.2.0 on Lightning AI

## Provider status

The Lightning SDK installed on macOS is **2026.11.13**. Its public machine catalog returns the single-GPU **L40S** SKU. The account and VM CLI commands returned “Temporarily unavailable” on November 17, 2026. Teamspace capacity, quotas, usable credits, and the actual hourly quote need a signed-in check after recovery. Lightning's public pricing showed **$3.54/hour** for a one-GPU 48 GB L40S on AWS. Use the team's quoted total, including storage and other fees, for approval. [Lightning status](https://status.lightning.ai/) · [Lightning pricing](https://support.lightning.ai/pricing/)

NVIDIA publishes the 6.2.0 Linux x86_64 container and lists tested Linux driver 595.58.03. Prefer Ubuntu 24.04 with a single L40S and a host that exposes NVIDIA graphics and Vulkan. A successful CUDA probe is only an initial check. [NVIDIA requirements](https://docs.isaacsim.omniverse.nvidia.com/6.2.0/installation/requirements.html) · [Container installation](https://docs.isaacsim.omniverse.nvidia.com/6.2.0/installation/install_container.html)

## Local CLI and account checks

```sh
python3.12 -m venv .venv-lightning
.venv-lightning/bin/python -m pip install lightning-sdk==2026.11.13
lightning_cli="$PWD/.venv-lightning/bin/lightning"
"$lightning_cli" --version
"$lightning_cli" login --help
"$lightning_cli" login
"$lightning_cli" auth whoami
"$lightning_cli" machine list --json
"$lightning_cli" studio list --teamspace OWNER/TEAMSPACE --json
"$lightning_cli" vm list --teamspace OWNER/TEAMSPACE
```

`login` is interactive and opens the browser. On macOS, use the default Keychain-backed flow. Lightning publishes an optional [official Codex skills installation command](https://lightning.ai/docs/platform/overview/getting-started). The project is usable with the documented CLI alone.

## After explicit GPU approval

Check the actual allocation and quote in the selected teamspace. Set a wall-time cutoff based on the approved total and reserve time to retrieve artifacts and confirm shutdown. At the public $3.54/hour rate, a one-hour compute window is about $3.54 before fees. For an initial session, target a 45-minute run window with the remainder for artifact transfer and shutdown. The preferred path is a guest with control of Docker, NVIDIA Container Toolkit and Vulkan. A Studio is usable only if it passes the same preflight.

The installed CLI help supports the following lifecycle for an approved Studio:

```sh
teamspace=OWNER/TEAMSPACE
studio=amr-forge-rtx

"$lightning_cli" studio start --name "$studio" --teamspace "$teamspace" --machine L40S --create
"$lightning_cli" ssh configure --name "$studio" --teamspace "$teamspace"
```

Use the hostname printed by SSH configuration. Supply an existing Studio by dropping `--create`. For a standalone VM, inspect the restored `lightning vm --help` and confirm the provider's stop and disk lifecycle on the account before creating it. The inspected CLI listed VM deletion as a disk-discarding operation.

```sh
ssh "$studio" 'mkdir -p ~/amr-forge'
rsync -az --exclude .git --exclude node_modules --exclude '.venv*' \
  --exclude dist --exclude recordings --exclude output --exclude test-results \
  ./ "$studio:amr-forge/"
ssh "$studio"
```

On the Linux host, install the NVIDIA driver, Container Toolkit, Docker, Vulkan tools, Node.js 22.18+, curl, OpenSSL, and GNU coreutils through the host's supported package workflow. Set the output directory to persistent storage.

```sh
cd ~/amr-forge
out="$PWD/recordings/first-l40s"
bash infra/lightning/preflight.sh
export ACCEPT_EULA=Y   # After accepting NVIDIA's container terms
bash infra/lightning/run-isaac.sh pull
bash infra/lightning/run-isaac.sh probe "$out"
```

Inspect `compatibility.log` for GPU, driver, and RTX compatibility. Then run the wheel and sensor smoke checks. The smoke writes a JPEG, an NPZ point cloud, and a summary measuring motion and samples.

```sh
AMR_MAX_RUNTIME=8m bash infra/lightning/run-isaac.sh smoke "$out"
AMR_MAX_RUNTIME=15m bash infra/lightning/run-isaac.sh scenario "$out"
```

The scenario saves `isaac-recording.json`, `warehouse.usda`, logs, and `validation.json`. A passing report requires two complete deliveries, recovery events in order, zero configured-footprint contact events, and distinct RGB and LiDAR samples from both robots. Review the JPG and NPZ evidence and check `scenario.log` for sensor warnings.

For live control, run `bash infra/lightning/run-isaac.sh live "$out"` on the host and open this tunnel from the Mac:

```sh
ssh -N -L 8765:127.0.0.1:8765 "$studio"
```

Choose **Live Isaac Sim** at the top of your local Mission Control app. Vite proxies the bridge through the tunnel. The bridge only listens on loopback. In live mode, the runner exits at 50 simulated seconds or at its bounded process timeout. Headless capture is the primary workflow. The UI receives telemetry and RGB frames via SSE.

## Retrieve and stop

From the Mac, copy artifacts before stopping compute. Exclude the render cache.

```sh
mkdir -p recordings/first-l40s
rsync -az --exclude cache "$studio:amr-forge/recordings/first-l40s/" recordings/first-l40s/
"$lightning_cli" studio stop --name "$studio" --teamspace "$teamspace" --json
"$lightning_cli" studio list --teamspace "$teamspace" --json
```

Confirm the Studio reports stopped and inspect the billing view for separately charged storage or resources. If the shell budget expires or SSH fails, stop compute from the Lightning control plane and verify the status there. Ending the container only ends the simulator process. Preserve logs when a probe fails so a later session can start at the failed stage.

Run the local validator and open **Replay → Import recording** with `recordings/first-l40s/isaac-recording.json`.

```sh
node sim/isaac/verify-recording.ts recordings/first-l40s/isaac-recording.json
```

[Lightning CLI documentation](https://lightning.ai/docs/cli/stable) · [NVIDIA wheeled robot API](https://docs.isaacsim.omniverse.nvidia.com/6.2.0/py/source/extensions/isaacsim.robot.experimental.wheeled_robots/docs/index.html) · [NVIDIA RTX sensors API](https://docs.isaacsim.omniverse.nvidia.com/6.2.0/py/source/extensions/isaacsim.sensors.experimental.rtx/docs/api.html)
