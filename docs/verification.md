# Technical verification

Local verification **November 17, 2026** on **Apple Silicon macOS 27.0.1, Node.js 26.13.0, Python 3.14.8, Google Chrome**. Runpod GPU verification **November 18, 2026**.

| Capability | Status | Evidence |
| --- | --- | --- |
| Local warehouse and navigation | Tested locally | Chrome loaded WebGL and rendered the procedural warehouse. Browser tests exercised the drill, robot selection, destination changes, overlays, manual incident injection, reset and mobile layout. |
| Incident recovery and fleet coordination | Tested locally | 30 Hz deterministic scenario. Both jobs delivered at 42.43 s. One safety stop, two replans, three holds and zero modeled footprint contacts. |
| Benchmark comparison | Tested locally | Three policies ran for the same 50 simulated seconds. JSON and CSV were written by the benchmark CLI. |
| Telemetry and offline replay | Tested locally | Chrome exported a recording and scrubbed into the incident. Unit tests cover schema, monotonic timing, source validation and point-in-time selection. Chrome imported `recordings/warehouse-local.json` with networking disabled and scrubbed to both completed deliveries. |
| Isaac bridge transport | Tested locally with a mock driver | Loopback binding, packet sequencing, command acknowledgement, and refusal to emit a recording without captured sensors. |
| Isaac Python and cloud scripts | Syntax checked on macOS | Python compilation and Bash syntax checks passed. The preflight rejected the unsupported Apple Silicon/macOS host as designed. |
| PhysX articulation, RGB, RTX LiDAR and Isaac recording | Verified on Runpod RTX 6000 Ada | Isaac Sim 6.2.0 measured 1.97 m of wheel-driven motion in the smoke test and captured RGB and 640 points per robot. The 55 s scenario recorded two deliveries, one safety stop, three replans and zero footprint contacts. The 276-frame recording passed offline validation. |
| Lightning Linux run | Blocked before allocation | SDK 2026.11.13 public catalog returned L40S. VM and account commands reported temporary unavailability during provider recovery. No resources were provisioned or started. |
| Replicator dataset and ML training | Deferred | Hardware validation and an authentic incident capture take priority. |

## Commands executed

```sh
npm test                 # 10 passed
npm run test:bridge      # 1 passed, mock driver
npm run benchmark        # 3 policy results emitted
npm run build            # TypeScript and Vite build passed
AMR_TEST_BUILD=1 AMR_RECORD=1 npm run test:browser  # 2 passed in Chrome
python3 -m py_compile sim/isaac/warehouse.py
bash -n infra/lightning/preflight.sh
bash -n infra/lightning/run-isaac.sh
```

The Vite build reported dependency bundling warnings for Radix's client directives and the size of the 3D bundle. Chrome exercised the resulting bundle successfully.

## Boundaries of the demonstration

The local fleet has two robots, pre-mapped static racks, and geometric range measurements. Dynamic obstacles are scenario objects; after the first range hit, the planner uses their configured footprint. The controller models bounded motion and conservative clearance. It is an experimental autonomy implementation for simulation. The benchmark covers one deterministic scenario and compares policy behavior over a fixed time window.

The Isaac runner configures RTX LiDAR for world-space XYZ and submits downsampled real returns and JPEG frames. The detection association uses scenario obstacle boxes and measured points. Playback synchronizes by the simulation time attached during capture. The offline validator checks the schema, sensor samples and recovery sequence. The Runpod capture includes 275 distinct RGB and RTX LiDAR samples for each robot.

- [Standby screenshot](../output/playwright/mission-control.png)
- [Incident screenshot](../output/playwright/incident.png)
- [Chrome demo video](../output/playwright/warehouse-under-pressure.mp4)
- [Benchmark JSON](../benchmarks/results/local.json)
- [Runpod trial and reproduction steps](runpod.md)
- [Lightning runbook](lightning.md)
