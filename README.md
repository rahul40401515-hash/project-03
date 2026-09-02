# PROJECT 02 — Visual Analysis System

Experimental in-browser computer-vision HUD.

Live camera + existing MediaPipe face / body / object detection + a cinematic analysis overlay.  
All video processing runs **locally in the browser**. Nothing is uploaded.

## Run

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

1. Wait for **ANALYSIS READY**
2. Click **START VISION**
3. Allow camera access

## What is new

PROJECT 02 keeps the original detection engine and adds:

- Separated L-brackets that follow real tracks
- Live X/Y/W/H/confidence from detections
- Lock sequence: SCANNING → TARGET DETECTED → TARGET ACQUIRED → TRACKING LOCKED
- Speed / direction from consecutive frames
- Geometry mode: paper/card quad corners, width, height, rotation, perspective
- Real frame counter and FPS

## Modes

| Mode | Detector |
| --- | --- |
| HUMAN | MediaPipe pose |
| FACE | MediaPipe face |
| OBJECT | COCO + local geometry |

GEOMETRY can be toggled on top of any mode so a person and a sheet of paper can be tracked together.
