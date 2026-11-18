# Interview demo

## 80-second presentation

| Time | On screen | Say |
| --- | --- | --- |
| 0–10 s | Open Mission Control. Select Atlas and show the two routes. | “This is AMR Forge. Two delivery robots share a warehouse map. What you see here is the local simulator running on my Mac.” |
| 10–23 s | Press **Run scenario**. Leave the incident banner, Atlas route, and perception panel visible. | “Atlas has a direct route to Dock 04. At five simulated seconds a forklift blocks the aisle. The nearest LiDAR returns put that obstacle into the fleet's shared occupancy map.” |
| 23–38 s | Point to **Safety stop**, **Alternate route found**, and the previous route. | “The controller brakes first. Then A* expands the occupied area by the robot's footprint and plans around it. The red dashed line is the earlier route.” |
| 38–55 s | Follow the robots through the traffic holds. Point to both completed deliveries. | “The detour sends Atlas into Vega's corridor. The coordinator reserves projected positions, holds traffic when routes overlap, and can route around a robot holding a corridor.” |
| 55–70 s | Open **Replay**, choose **Replay local run**, scrub to 6 s, and switch to **Robot POV**. | “Replay uses the same recorded timestamps for poses, measurements, and decisions. I can inspect a stop from the robot's camera or from above.” |
| 70–80 s | Open **Benchmarks**, run the comparison. | “With reservations and replanning, both deliveries finish in 42.43 simulated seconds with zero contact events. The fixed-window comparison shows where each simpler policy gets stuck.” |

## GitHub description

Interactive warehouse digital twin with two differential-drive AMRs, A* replanning, fleet traffic reservations, measured LiDAR telemetry, and offline incident replay. The headless Isaac Sim 6.2.0 scenario passed on an RTX 6000 Ada.

## CV description

Built a React/Three.js robotics mission control and 30 Hz two-AMR simulator. Implemented A* obstacle replanning, differential-drive control, LiDAR-based obstruction detection, fleet reservations, and replay. In a deterministic forklift benchmark, the coordinated policy completed both deliveries in 42.43 simulated seconds with zero contact events.
