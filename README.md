# PROJECT 03 — Visual Analysis

In-browser fingertip tracking.

Tracks only:

- right thumb
- right index
- left thumb
- left index

Each detected fingertip is a black dot. Two or more dots connect with a thick neon line. Four dots form a box; the camera inside that box is inverted (negative).

All processing runs locally in the browser.

## Run

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`, wait for **TRACKING READY**, then click **START VISION**.
