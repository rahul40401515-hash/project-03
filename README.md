# PROJECT 01 — Vision Tracking System

Experimental in-browser computer-vision laboratory.

Live camera + real object / face / body tracking + a cinematic HUD.  
All video processing runs **locally in the browser**. Nothing is uploaded.

## Run

Serve the folder over HTTPS (or localhost):

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

1. Wait for **TRACKING READY**
2. Click **START VISION**
3. Allow camera access

## Modes

| Mode | What it tracks |
| --- | --- |
| MODE 01 HUMAN | Body pose (MediaPipe) |
| MODE 02 FACE | Faces |
| MODE 03 OBJECT | COCO objects + geometric / high-contrast shapes |

## Stack

- HTML / CSS / JavaScript
- MediaDevices camera API
- MediaPipe Tasks Vision (WASM)
- Canvas HUD overlay
- Local contour / contrast detector for MODE 03
