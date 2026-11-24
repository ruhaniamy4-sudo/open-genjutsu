# Kinetix ComfyUI Workflow Setup (`workflows/kinetix_pro.api.json`)

The Kinetix GPU Bridge expects your production ComfyUI workflow exported in **API format** at:

```text
deploy/workflows/kinetix_pro.api.json
```

(Or at the path specified by the `WORKFLOW_PATH` environment variable.)

## How to export your workflow from ComfyUI

1. Open ComfyUI in your browser.
2. Click the **Settings** gear icon and enable **Enable Dev mode Options** (or **Dev Mode**).
3. Close settings and click **Save (API Format)** in the menu.
4. Save the exported JSON file as `workflows/kinetix_pro.api.json`.
5. Replace the dynamic node inputs in `kinetix_pro.api.json` with the placeholders listed below.

## Placeholders reference

When a job is submitted to `POST /api/kinetix/submit`, `kinetix_bridge.py` recursively walks the workflow JSON and substitutes these placeholders before posting the prompt to ComfyUI.

### Integer placeholders (exact string match -> replaced with `int`)

Put these as the exact string value of a node input (for example `"seed": "{{SEED}}"` -> `"seed": 48151623`):

| Placeholder | Type after replacement | Meaning |
| :--- | :--- | :--- |
| `"{{SEED}}"` | `int` | User-supplied seed, or a random integer from `0` to `2^31 - 1`. |
| `"{{WIDTH}}"` | `int` | Frame width in pixels derived from `aspect` (`16:9` -> `1376`, `9:16` -> `768`, `2.39:1` -> `1376`, `1:1` -> `1024`). |
| `"{{HEIGHT}}"` | `int` | Frame height in pixels derived from `aspect` (`16:9` -> `768`, `9:16` -> `1376`, `2.39:1` -> `576`, `1:1` -> `1024`). |
| `"{{FRAMES}}"` | `int` | Frame count at 24 fps (`FPS * seconds + 1`: `5s` -> `121`, `7s` -> `169`, `8s` -> `193`). |
| `"{{FPS}}"` | `int` | Frame rate (`24`). |

### String placeholders (replaced inside any string value)

These can be used as full string values or embedded inside longer strings:

| Placeholder | Type after replacement | Meaning |
| :--- | :--- | :--- |
| `{{PROMPT}}` | `str` | The user prompt text (1 to 4000 characters). |
| `{{CLIP}}` | `str` | Filename of the downloaded reference clip/image saved in `ComfyUI/input/` (e.g. `kinetix_<uuid>_clip.mp4`), or `""` if `clipUrl` was omitted. |
| `{{FACE}}` | `str` | Filename of the downloaded face reference image saved in `ComfyUI/input/` (e.g. `kinetix_<uuid>_face.png`), or `""` if `faceUrl` was omitted. |
| `{{FILENAME_PREFIX}}` | `str` | Output prefix `kinetix/<job_uuid>` for video/image save nodes (e.g. `VHS_VideoCombine` or `SaveImage`). |

### Booster boolean placeholders (exact string match -> replaced with `bool`)

Put these as the exact string value of a boolean switch/toggle input (for example `"fp16_vae": "{{FP16_VAE}}"` -> `"fp16_vae": true`):

| Placeholder | Type after replacement | Meaning |
| :--- | :--- | :--- |
| `"{{FP16_VAE}}"` | `bool` | Value of `boosters.fp16Vae` (`true` / `false`). |
| `"{{FACE_REFINE}}"` | `bool` | Value of `boosters.faceRefine` (`true` / `false`). |
| `"{{ORION_DCTL}}"` | `bool` | Value of `boosters.orionDctl` (`true` / `false`). |
