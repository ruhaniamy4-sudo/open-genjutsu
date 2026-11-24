# Kinetix GPU Bridge — build spec

Write these files inside this `deploy/` folder. Edit only files in `deploy/`.

## 1. `kinetix_bridge.py` (FastAPI, Python 3.10+)
Runs next to ComfyUI and is exposed to the internet with a Cloudflare quick tunnel. The Next.js server calls it.

Env vars:
- `COMFY_URL` (default `http://127.0.0.1:8188`)
- `COMFY_DIR` (default: `/content/ComfyUI` if it exists, else `/workspace/ComfyUI`)
- `KINETIX_BRIDGE_TOKEN` (optional). When set, every route except `/health` and `/api/kinetix/output/...` needs `Authorization: Bearer <token>`. Compare with `hmac.compare_digest`. Wrong or missing token: 401.
- `WORKFLOW_PATH` (default `workflows/kinetix_pro.api.json` next to the bridge file)
- `MAX_DOWNLOAD_MB` (default 500)

CORS: allow all origins (GET/POST).

Routes. All JSON. Errors: `{"error": "<message>"}` with a proper status code.
- `GET /health` -> `{"ok": true, "engine": "kinetix-fp16-v2", "comfy": <bool reachable>, "workflow_loaded": <bool file exists and parses>, "gpu": {"name", "vram_total_mb", "vram_used_mb"} or null, "queue": {"running": n, "pending": n}}`. Use `nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits`, guarded with try/except.
- `POST /api/kinetix/submit` body: `{"prompt": str (required, max 4000 chars), "aspect": "16:9"|"9:16"|"2.39:1"|"1:1", "duration": "5s"|"7s"|"8s", "boosters": {"fp16Vae": bool, "faceRefine": bool, "orionDctl": bool}, "clipUrl": str|null, "faceUrl": str|null, "seed": int|null}`. Validate with pydantic.
  - If the workflow file is missing or invalid: 503 with a message that says how to add it (see workflows/README.md).
  - Download `clipUrl` / `faceUrl` if given. Only `https://` URLs. Stream to `COMFY_DIR/input/kinetix_<uuid>_clip.<ext>` / `_face.<ext>`. Stop above `MAX_DOWNLOAD_MB`. 60 s timeout. Keep the extension only from an allowlist (mp4, mov, webm, jpg, jpeg, png, webp); default by content-type.
  - Load the workflow JSON (ComfyUI API format). Walk every value recursively. Replace placeholders:
    - A string equal to exactly `"{{SEED}}"`, `"{{WIDTH}}"`, `"{{HEIGHT}}"`, `"{{FRAMES}}"`, `"{{FPS}}"` becomes an int.
    - Inside other strings, replace `{{PROMPT}}`, `{{CLIP}}` (input filename, or empty string), `{{FACE}}` (input filename, or empty), `{{FILENAME_PREFIX}}` (`kinetix/<job uuid>`).
    - Booster flags: a string exactly `"{{FP16_VAE}}"`, `"{{FACE_REFINE}}"`, `"{{ORION_DCTL}}"` becomes a bool.
  - Sizes from aspect (long side 1376, multiples of 16): 16:9 -> 1376x768, 9:16 -> 768x1376, 2.39:1 -> 1376x576, 1:1 -> 1024x1024. FPS 24. FRAMES = fps * seconds + 1.
  - Seed: given or `random.randint(0, 2**31-1)`.
  - POST `{COMFY_URL}/prompt` with `{"prompt": wf, "client_id": <bridge client id>}`. If ComfyUI returns `node_errors` or a non-200: 502 with its message.
  - Return `{"job_id": prompt_id, "status": "queued"}`.
- `GET /api/kinetix/status/{job_id}` ->
  `{"status": "queued"|"running"|"completed"|"failed"|"not_found", "progress": float 0..1 or null, "stage": str or null, "queue_position": int or null, "output_url": str or null, "output_type": "video"|"image"|null, "error": str or null}`.
  - Check `GET /history/{id}` first. If present: `status.status_str == "error"` -> failed (take the message from `status.messages`). Else completed: collect outputs in node output keys `videos`, `gifs`, `images` (each item has filename/subfolder/type). Prefer video files (.mp4/.webm/.mov/.gif). `output_url` = `/api/kinetix/output/{job_id}/{index}` (relative path).
  - Else check `GET /queue`: in `queue_running` -> running; in `queue_pending` -> queued with 1-based position.
  - Else not_found.
  - Progress: a background thread connects to `ws://<comfy host>/ws?clientId=<bridge client id>` with `websocket-client`. Track per prompt_id the `progress` events (value/max) and the `executing` node. Map to stage labels by fraction: <0.25 "Tracking", <0.6 "Synthesis", <0.85 "FaceRefine", else "Color Grade". Reconnect on failure with backoff. If websocket-client is not installed, progress stays null and the bridge still works.
- `GET /api/kinetix/output/{job_id}/{index}` (no auth; prompt ids are unguessable UUIDs). Look up the job in `/history`, pick the output by index, stream it from `{COMFY_URL}/view?filename=..&subfolder=..&type=..` with the right Content-Type. 404 if not found.
- `POST /api/kinetix/cancel/{job_id}`: if running -> `POST /interrupt`; if pending -> `POST /queue` with `{"delete": [id]}`. Return `{"status": "canceled"}`.

Run with: `uvicorn kinetix_bridge:app --host 0.0.0.0 --port 8000`.
Add a `if __name__ == "__main__":` block that runs uvicorn the same way.

## 2. `workflows/README.md`
Explain in short, plain English: export your ComfyUI workflow in API format (Settings -> enable Dev mode -> "Save (API Format)"), save it as `workflows/kinetix_pro.api.json`, and put the placeholders above in the node inputs. List every placeholder and its meaning. Do NOT create a fake workflow JSON.

## 3. `Kinetix_Colab_GPU_Worker.ipynb` (replace the existing file)
Valid nbformat 4 JSON. Markdown intro + code cells:
1. Settings cell: `SITE_URL = "https://your-kinetix-site.vercel.app"`, `BRIDGE_TOKEN = ""` (if empty, try `google.colab.userdata.get("KINETIX_BRIDGE_TOKEN")`, else generate with `secrets.token_urlsafe(24)` and print it once with a note to set the same value as `KINETIX_GPU_TOKEN` on Vercel).
2. GPU detect -> `VRAM_FLAG` (`--highvram` if >= 31 GB else `--normalvram`).
3. Mount Drive. Ensure `/content/drive/MyDrive/kinetix_models/` and `/content/drive/MyDrive/kinetix_deploy/` exist. Clone ComfyUI (depth 1) if missing. `pip install -r requirements.txt fastapi uvicorn requests websocket-client python-multipart pydantic`. For each subfolder of `kinetix_models` (diffusion_models, text_encoders, vae, checkpoints, loras, ultralytics, sams), symlink its files into `ComfyUI/models/<same>/` (skip files that already exist).
4. Copy `kinetix_bridge.py` and `workflows/` from `MyDrive/kinetix_deploy/` to `/content/`. If the bridge file is missing, raise a clear error telling the user to upload the repo `deploy/` folder contents there.
5. Start ComfyUI with `subprocess.Popen` (log to `/content/comfyui.log`), wait up to 180 s for port 8188. Start the bridge with uvicorn on port 8000 (env vars set: COMFY_DIR, KINETIX_BRIDGE_TOKEN, WORKFLOW_PATH), log to `/content/bridge.log`, wait for `/health`.
6. Download `cloudflared` (linux amd64 binary from GitHub releases latest), run `cloudflared tunnel --url http://localhost:8000 --no-autoupdate`, read its output until a `https://*.trycloudflare.com` URL appears (timeout 60 s). Print the tunnel URL and the share link `f"{SITE_URL}/studio?gpu={url}"`.
7. Keep-alive cell that prints `/health` every 60 s.

## 4. `vast_onstart.sh` (replace the existing file)
Bash, `set -euo pipefail`. Same flow as the notebook for Vast.ai / RunPod:
- VRAM flag detection (keep the existing logic).
- Clone ComfyUI if missing, pip install the same packages.
- Bridge source: `/workspace/kinetix_deploy/kinetix_bridge.py`, or download from `$KINETIX_BRIDGE_SRC` (a URL) if set. Fail with a clear message if neither.
- If `$MODELS_DIR` is set, symlink its subfolders' files into ComfyUI/models like the notebook.
- nohup ComfyUI (port 8188), wait for it; nohup uvicorn bridge on 8000 with env vars; wait for `/health`.
- `KINETIX_BRIDGE_TOKEN` from env; if empty, generate one with `openssl rand -hex 24` and print it.
- Download cloudflared if missing, start the quick tunnel, grep the trycloudflare URL from its log (timeout 60 s), print it and `${SITE_URL:-https://your-kinetix-site.vercel.app}/studio?gpu=<url>`.
- Optional ntfy notification with the URL (keep the existing `NTFY_TOPIC` logic). Do not send the token in the notification.

## Checks before you finish
- `python -m py_compile kinetix_bridge.py`
- `python -c "import json; json.load(open('Kinetix_Colab_GPU_Worker.ipynb'))"`
- `bash -n vast_onstart.sh`
Report in 5 lines max: files written, checks run, any limits.
