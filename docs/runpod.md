# Runpod RTX 6000 Ada trial

## Verified run on November 18, 2026

Runpod CLI provisioned one Secure Cloud RTX 6000 Ada with the configuration below. SSH, Vulkan and the NVIDIA compatibility checker passed with driver `595.112.07`. The headless Isaac Sim 6.2.0 smoke test measured 1.97 m of wheel-driven motion and captured RGB and 640 RTX LiDAR points per robot.

The 55-second acceptance run recorded two deliveries, one safety stop, three replans and zero footprint contacts. The second delivery occurred at simulation time 50.00 s. The first 50-second run's last sampled frame was at 49.83 s and showed one completed delivery. The recorder now includes the final simulation state in the exported recording.

The recording, validation report, camera images, point clouds and OpenUSD scene are in `recordings/runpod-trial-2026-11-18/`. Runpod confirmed the trial Pod stopped. At the quoted rates, around 15 minutes cost an estimated $0.27.

## Deployment draft

Verified in the Runpod console on November 17, 2026. The console reported **Out of capacity** for this configuration. The draft was prepared without deploying a Pod or enabling automatic deployment.

| Setting | Value |
| --- | --- |
| Pod name | `amr-forge-isaac-trial` |
| Cloud and pricing | Secure Cloud, On-Demand, any region |
| GPU | 1 × NVIDIA RTX 6000 Ada, 48 GB VRAM |
| SSH template | Runpod PyTorch 2.8.0, Ubuntu 24.04, CUDA 13.2 template |
| Container image | `runpod/pytorch:2.1.0-cu1320-torch280-ubuntu2404` |
| Host filter | CUDA 13.2, 13.3, or 13.4, as selected by the template |
| Application runtime | Isaac Sim 6.2.0 Python package, Python 3.12 virtual environment, headless |
| Storage | Temporary container disk 100 GB, no persistent or network volume |
| Access | Full SSH, exposed TCP 22, SSH key authentication, Jupyter off |
| NVIDIA container capabilities | `NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics` |

The console showed **$1.09/hour GPU + $0.014/hour container disk**, rounded to **$1.10/hour**. At those components, 60 minutes costs about **$1.10**, and 90 minutes costs about **$1.66**, before any applicable taxes. Recheck capacity and the quote before paid deployment. Start the 90-minute session clock at deployment and reserve the last 10 minutes for artifact transfer and shutdown. [Runpod console](https://console.runpod.io/deploy) · [Runpod Pod pricing](https://docs.runpod.io/pods/pricing)

The NVIDIA driver and Vulkan devices are properties of the assigned host. The first remote check requires an RTX 6000 Ada, a Linux driver at least as recent as the version NVIDIA tested with Isaac Sim 6.2.0, and visibility of the card through Vulkan. If a check fails, save the diagnostic output and stop the Pod. [Isaac Sim requirements](https://docs.isaacsim.omniverse.nvidia.com/6.2.0/installation/requirements.html) · [NVIDIA container capabilities](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/docker-specialized.html)

## RTX 5090 fallback

Runpod showed an RTX 5090 (32 GB VRAM) at $1.39/hour in Secure Cloud with CUDA 13.2. The quote with an 80 GB temporary disk was $1.40/hour, about $1.52 for a 65-minute trial before any applicable tax. The console returned to the deployment form after each attempt. The account dashboard showed zero active GPUs and a $0/hour spend rate afterward. No Isaac Sim measurements were captured.

On an approved RTX 5090 Pod, run `export AMR_EXPECTED_GPU='RTX 5090'` before the commands below. Use the same driver and Vulkan checks and reserve the last 10 minutes for transfer and shutdown.

## Connect after approval

Ensure the public SSH key for this Mac is available in Runpod before deployment. Open **Pods → Connect → SSH over exposed TCP** and take the user, IP, and mapped port shown by Runpod. Use the corresponding local private key through OpenSSH. [Runpod SSH setup](https://docs.runpod.io/pods/configuration/use-ssh)

From the project root on the Mac, keep the same terminal for uploading and downloading:

```bash
pod_host='root@POD_IP'
pod_port='SSH_PORT'
pod_key="$HOME/.ssh/id_ed25519"
ssh -p "$pod_port" -i "$pod_key" "$pod_host" 'mkdir -p /workspace/amr-forge'
tar -czf - package.json autonomy scenarios sim telemetry infra | \
  ssh -p "$pod_port" -i "$pod_key" "$pod_host" 'tar -xzf - -C /workspace/amr-forge'
ssh -p "$pod_port" -i "$pod_key" "$pod_host"
```

## Run the probe and scenario

Once connected, review and accept the NVIDIA terms before exporting the acceptance variable. The system stage checks the assigned GPU and driver before installing tools, then checks Vulkan. The checker stage installs NVIDIA's compatibility-check bundle before the full Isaac Sim runtime. The environment scripts start no paid resources. [NVIDIA license](https://docs.omniverse.nvidia.com/platform/latest/common/NVIDIA_Omniverse_License_Agreement.html) · [NVIDIA Python installation](https://docs.isaacsim.omniverse.nvidia.com/6.2.0/installation/install_python.html)

```bash
cd /workspace/amr-forge
out="$PWD/recordings/runpod-trial"
mkdir -p "$out"
set -o pipefail
timeout --kill-after=15s 8m bash infra/runpod/setup.sh system 2>&1 | tee "$out/system.log"
export OMNI_KIT_ACCEPT_EULA=YES
timeout --kill-after=15s 12m bash infra/runpod/setup.sh checker 2>&1 | tee "$out/checker-install.log"
bash infra/runpod/run-isaac.sh probe "$out"
```

Review `compatibility.log` before installing the full runtime. Proceed only when the system and compatibility stages pass and the session has time for capture and transfer.

```bash
timeout --kill-after=15s 30m bash infra/runpod/setup.sh install 2>&1 | tee "$out/install.log"
AMR_MAX_RUNTIME=8m bash infra/runpod/run-isaac.sh smoke "$out"
AMR_SCENARIO_SECONDS=55 AMR_MAX_RUNTIME=15m bash infra/runpod/run-isaac.sh scenario "$out"
```

The smoke test checks wheel-driven motion, the RGB camera, and RTX LiDAR. The scenario collects the warehouse run and writes a validation report. The telemetry bridge listens on loopback. The recording is available for offline playback in Mission Control after the transfer.

## Retrieve artifacts and stop compute

Return to the Mac terminal. Copy the recording and logs from the temporary disk while the Pod is running:

```bash
mkdir -p recordings/runpod-trial
ssh -p "$pod_port" -i "$pod_key" "$pod_host" \
  'tar -czf - --exclude=cache -C /workspace/amr-forge/recordings/runpod-trial .' | \
  tar -xzf - -C recordings/runpod-trial
```

Confirm the expected local files are present. Use **Stop** on this Pod in the Runpod console and verify its stopped state. The container disk is cleared when the Pod stops. When the recording is present, validate it locally and import it into Mission Control Replay. [Stop a Runpod Pod](https://docs.runpod.io/pods/manage-pods#stop-a-pod)

```bash
node sim/isaac/verify-recording.ts recordings/runpod-trial/isaac-recording.json
```
