#!/usr/bin/env python3
"""Kinetix Studio v2 — ComfyUI FastAPI GPU Bridge."""

from __future__ import annotations

from contextlib import asynccontextmanager
import copy
import hmac
import json
import mimetypes
import os
from pathlib import Path
import random
import re
import subprocess
import threading
import time
from typing import Any, Iterator, Literal, Optional
from urllib.parse import urlparse
import uuid

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
import requests
from starlette.exceptions import HTTPException as StarletteHTTPException

try:
    import websocket  # type: ignore[import-untyped]

    HAS_WEBSOCKET = True
except ImportError:
    websocket = None  # type: ignore[assignment]
    HAS_WEBSOCKET = False


ENGINE_NAME = "kinetix-fp16-v2"
BRIDGE_CLIENT_ID = f"kinetix-bridge-{uuid.uuid4().hex[:12]}"

ALLOWED_EXTENSIONS = {"mp4", "mov", "webm", "jpg", "jpeg", "png", "webp"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".gif"}
CONTENT_TYPE_TO_EXT = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
EXT_TO_CONTENT_TYPE = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

ASPECT_DIMENSIONS: dict[str, tuple[int, int]] = {
    "16:9": (1376, 768),
    "9:16": (768, 1376),
    "2.39:1": (1376, 576),
    "1:1": (1024, 1024),
}
DURATION_SECONDS: dict[str, int] = {
    "5s": 5,
    "7s": 7,
    "8s": 8,
}
DEFAULT_FPS = 24


def get_comfy_url() -> str:
    return os.environ.get("COMFY_URL", "http://127.0.0.1:8188").rstrip("/")


def get_comfy_dir() -> Path:
    env_dir = os.environ.get("COMFY_DIR", "").strip()
    if env_dir:
        return Path(env_dir)
    if Path("/content/ComfyUI").exists():
        return Path("/content/ComfyUI")
    return Path("/workspace/ComfyUI")


def get_bridge_token() -> str:
    return os.environ.get("KINETIX_BRIDGE_TOKEN", "")


def get_workflow_path() -> Path:
    env_wf = os.environ.get("WORKFLOW_PATH", "").strip()
    if env_wf:
        return Path(env_wf)
    return Path(__file__).resolve().parent / "workflows" / "kinetix_pro.api.json"


def get_max_download_bytes() -> int:
    try:
        mb = int(os.environ.get("MAX_DOWNLOAD_MB", "500"))
    except ValueError:
        mb = 500
    return max(1, mb) * 1024 * 1024


class BridgeError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class BoostersPayload(BaseModel):
    fp16Vae: bool = True
    faceRefine: bool = False
    orionDctl: bool = False


class SubmitPayload(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    aspect: Literal["16:9", "9:16", "2.39:1", "1:1"] = "16:9"
    duration: Literal["5s", "7s", "8s"] = "5s"
    boosters: BoostersPayload = Field(default_factory=BoostersPayload)
    clipUrl: Optional[str] = None
    faceUrl: Optional[str] = None
    seed: Optional[int] = Field(default=None, ge=0, le=2**31 - 1)


def stage_for_fraction(fraction: float) -> str:
    if fraction < 0.25:
        return "Tracking"
    if fraction < 0.60:
        return "Synthesis"
    if fraction < 0.85:
        return "FaceRefine"
    return "Color Grade"


class ProgressTracker:
    """Thread-safe tracker for ComfyUI WebSocket progress events."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: dict[str, dict[str, Any]] = {}
        self._current_prompt_id: Optional[str] = None
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if not HAS_WEBSOCKET:
            return
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name="kinetix-comfy-ws",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def register_job(self, prompt_id: str) -> None:
        with self._lock:
            self._state.setdefault(
                prompt_id,
                {"progress": None, "stage": None, "node": None, "updated_at": time.time()},
            )

    def get(self, prompt_id: str) -> tuple[Optional[float], Optional[str]]:
        with self._lock:
            info = self._state.get(prompt_id)
            if not info:
                return None, None
            return info.get("progress"), info.get("stage")

    def _update_executing(self, prompt_id: Optional[str], node: Optional[str]) -> None:
        with self._lock:
            pid = prompt_id or self._current_prompt_id
            if not pid:
                return
            self._current_prompt_id = pid
            entry = self._state.setdefault(
                pid,
                {"progress": None, "stage": None, "node": None, "updated_at": time.time()},
            )
            entry["node"] = node
            entry["updated_at"] = time.time()
            if node is None and entry["progress"] is not None:
                entry["progress"] = 1.0
                entry["stage"] = stage_for_fraction(1.0)

    def _update_progress(
        self, prompt_id: Optional[str], value: float, max_value: float
    ) -> None:
        if max_value <= 0:
            return
        fraction = max(0.0, min(1.0, float(value) / float(max_value)))
        with self._lock:
            pid = prompt_id or self._current_prompt_id
            if not pid:
                return
            self._current_prompt_id = pid
            self._state[pid] = {
                "progress": round(fraction, 4),
                "stage": stage_for_fraction(fraction),
                "node": self._state.get(pid, {}).get("node"),
                "updated_at": time.time(),
            }
            if len(self._state) > 500:
                oldest = sorted(
                    self._state.items(), key=lambda kv: kv[1].get("updated_at", 0.0)
                )[:100]
                for old_key, _ in oldest:
                    self._state.pop(old_key, None)

    def _build_ws_url(self) -> str:
        comfy_url = get_comfy_url()
        parsed = urlparse(comfy_url)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        netloc = parsed.netloc or parsed.path
        base_path = parsed.path.rstrip("/") if parsed.netloc else ""
        return f"{scheme}://{netloc}{base_path}/ws?clientId={BRIDGE_CLIENT_ID}"

    def _run_loop(self) -> None:
        backoff = 1.0
        while not self._stop_event.is_set():
            ws_conn = None
            try:
                ws_url = self._build_ws_url()
                ws_conn = websocket.create_connection(ws_url, timeout=10)
                ws_conn.settimeout(30)
                backoff = 1.0
                while not self._stop_event.is_set():
                    try:
                        raw = ws_conn.recv()
                    except websocket.WebSocketTimeoutException:
                        continue
                    if not raw or not isinstance(raw, str):
                        continue
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(msg, dict):
                        continue
                    msg_type = msg.get("type")
                    data = msg.get("data")
                    if not isinstance(data, dict):
                        continue
                    if msg_type == "executing":
                        self._update_executing(data.get("prompt_id"), data.get("node"))
                    elif msg_type == "execution_start":
                        self._update_executing(data.get("prompt_id"), None)
                    elif msg_type == "progress":
                        val = data.get("value")
                        max_val = data.get("max")
                        if isinstance(val, (int, float)) and isinstance(max_val, (int, float)):
                            self._update_progress(data.get("prompt_id"), float(val), float(max_val))
                    elif msg_type in ("executed", "execution_success"):
                        self._update_progress(data.get("prompt_id"), 1.0, 1.0)
            except Exception:
                pass
            finally:
                if ws_conn is not None:
                    try:
                        ws_conn.close()
                    except Exception:
                        pass
            if self._stop_event.wait(backoff):
                break
            backoff = min(backoff * 2.0, 30.0)


tracker = ProgressTracker()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    tracker.start()
    try:
        yield
    finally:
        tracker.stop()


app = FastAPI(title="Kinetix GPU Bridge", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(BridgeError)
async def handle_bridge_error(_request: Request, exc: BridgeError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.message})


@app.exception_handler(StarletteHTTPException)
async def handle_http_exception(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": detail})


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = []
    for err in exc.errors():
        loc = ".".join(str(x) for x in err.get("loc", []) if x != "body")
        msg = err.get("msg", "Invalid value")
        errors.append(f"{loc}: {msg}" if loc else msg)
    summary = "; ".join(errors) if errors else "Invalid request payload"
    return JSONResponse(status_code=422, content={"error": summary})


@app.exception_handler(Exception)
async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"error": f"Internal bridge error: {exc}"})


def require_auth(request: Request) -> None:
    expected_token = get_bridge_token()
    if not expected_token:
        return
    auth_header = request.headers.get("Authorization", "")
    prefix = "Bearer "
    if not auth_header.startswith(prefix):
        raise BridgeError(401, "Missing or invalid Authorization Bearer token")
    provided_token = auth_header[len(prefix) :]
    if not hmac.compare_digest(
        provided_token.encode("utf-8"), expected_token.encode("utf-8")
    ):
        raise BridgeError(401, "Invalid bearer token")


def query_gpu_info() -> Optional[dict[str, Any]]:
    try:
        proc = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
        line = proc.stdout.strip().splitlines()[0].strip()
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3:
            return None
        return {
            "name": parts[0],
            "vram_total_mb": int(float(parts[1])),
            "vram_used_mb": int(float(parts[2])),
        }
    except Exception:
        return None


def load_workflow_template() -> dict[str, Any]:
    wf_path = get_workflow_path()
    if not wf_path.is_file():
        raise BridgeError(
            503,
            f"Workflow file not found at '{wf_path}'. Export your ComfyUI workflow in API format "
            "to workflows/kinetix_pro.api.json (see workflows/README.md).",
        )
    try:
        raw = wf_path.read_text(encoding="utf-8")
        parsed = json.loads(raw)
    except Exception as exc:
        raise BridgeError(
            503,
            f"Workflow file at '{wf_path}' is invalid JSON ({exc}). Export a valid API-format "
            "ComfyUI workflow to workflows/kinetix_pro.api.json (see workflows/README.md).",
        ) from exc
    if not isinstance(parsed, dict) or not parsed:
        raise BridgeError(
            503,
            f"Workflow file at '{wf_path}' must be a non-empty ComfyUI API JSON object "
            "(see workflows/README.md).",
        )
    return parsed


def is_workflow_valid() -> bool:
    try:
        load_workflow_template()
        return True
    except BridgeError:
        return False


def resolve_extension(url: str, content_type: str, kind: Literal["clip", "face"]) -> str:
    parsed = urlparse(url)
    ext = Path(parsed.path).suffix.lower().lstrip(".")
    if ext in ALLOWED_EXTENSIONS:
        return ext
    mime = content_type.split(";")[0].strip().lower()
    if mime in CONTENT_TYPE_TO_EXT:
        return CONTENT_TYPE_TO_EXT[mime]
    return "mp4" if kind == "clip" else "png"


def download_input_media(
    url: str, job_uuid: str, kind: Literal["clip", "face"]
) -> str:
    parsed = urlparse(url)
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        raise BridgeError(400, f"Invalid {kind}Url: only https:// URLs are allowed")

    max_bytes = get_max_download_bytes()
    input_dir = get_comfy_dir() / "input"
    input_dir.mkdir(parents=True, exist_ok=True)

    started = time.monotonic()
    try:
        with requests.get(url, stream=True, timeout=(15, 60)) as resp:
            if resp.status_code != 200:
                raise BridgeError(
                    400, f"Failed to download {kind}Url (HTTP {resp.status_code})"
                )
            content_length = resp.headers.get("Content-Length")
            if content_length and content_length.isdigit():
                if int(content_length) > max_bytes:
                    raise BridgeError(
                        413,
                        f"{kind}Url exceeds maximum download size of {max_bytes // (1024 * 1024)} MB",
                    )

            ext = resolve_extension(
                url, resp.headers.get("Content-Type", ""), kind
            )
            filename = f"kinetix_{job_uuid}_{kind}.{ext}"
            dest_path = input_dir / filename

            downloaded = 0
            try:
                with dest_path.open("wb") as out_file:
                    for chunk in resp.iter_content(chunk_size=65536):
                        if not chunk:
                            continue
                        if time.monotonic() - started > 60.0:
                            raise BridgeError(
                                408, f"Downloading {kind}Url timed out after 60s"
                            )
                        downloaded += len(chunk)
                        if downloaded > max_bytes:
                            raise BridgeError(
                                413,
                                f"{kind}Url exceeds maximum download size of {max_bytes // (1024 * 1024)} MB",
                            )
                        out_file.write(chunk)
            except Exception:
                dest_path.unlink(missing_ok=True)
                raise
    except BridgeError:
        raise
    except requests.RequestException as exc:
        raise BridgeError(400, f"Failed to download {kind}Url: {exc}") from exc

    return filename


def inject_placeholders(
    node: Any,
    int_map: dict[str, int],
    bool_map: dict[str, bool],
    str_map: dict[str, str],
    str_pattern: re.Pattern[str],
) -> Any:
    if isinstance(node, dict):
        return {
            k: inject_placeholders(v, int_map, bool_map, str_map, str_pattern)
            for k, v in node.items()
        }
    if isinstance(node, list):
        return [
            inject_placeholders(v, int_map, bool_map, str_map, str_pattern)
            for v in node
        ]
    if isinstance(node, str):
        if node in int_map:
            return int_map[node]
        if node in bool_map:
            return bool_map[node]
        return str_pattern.sub(lambda m: str_map[m.group(0)], node)
    return node


def extract_comfy_error(status_obj: dict[str, Any]) -> str:
    messages = status_obj.get("messages")
    if isinstance(messages, list):
        for item in messages:
            if (
                isinstance(item, (list, tuple))
                and len(item) >= 2
                and isinstance(item[1], dict)
            ):
                event_name = str(item[0])
                payload = item[1]
                if "error" in event_name.lower() or "exception_message" in payload:
                    exc_msg = str(payload.get("exception_message") or "").strip()
                    node_type = str(payload.get("node_type") or "").strip()
                    if exc_msg and node_type:
                        return f"{node_type}: {exc_msg}"
                    if exc_msg:
                        return exc_msg
        return json.dumps(messages)
    return "ComfyUI workflow execution failed"


def collect_job_outputs(history_entry: dict[str, Any]) -> list[dict[str, str]]:
    outputs_by_node = history_entry.get("outputs")
    if not isinstance(outputs_by_node, dict):
        return []

    videos: list[dict[str, str]] = []
    images: list[dict[str, str]] = []

    for _node_id, node_output in outputs_by_node.items():
        if not isinstance(node_output, dict):
            continue
        for key in ("videos", "gifs", "images"):
            items = node_output.get(key)
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                filename = str(item.get("filename") or "").strip()
                if not filename:
                    continue
                subfolder = str(item.get("subfolder") or "")
                folder_type = str(item.get("type") or "output")
                ext = Path(filename).suffix.lower()
                is_video = ext in VIDEO_EXTENSIONS or key in ("videos", "gifs")
                record = {
                    "filename": filename,
                    "subfolder": subfolder,
                    "type": folder_type,
                    "output_type": "video" if is_video else "image",
                }
                if is_video:
                    videos.append(record)
                else:
                    images.append(record)

    return videos + images


def match_queue_item(item: Any, job_id: str) -> bool:
    if isinstance(item, (list, tuple)):
        if len(item) > 1 and str(item[1]) == job_id:
            return True
        return any(str(part) == job_id for part in item[:3])
    if isinstance(item, dict):
        return str(item.get("prompt_id") or item.get("id") or "") == job_id
    return False


@app.get("/health")
def health() -> dict[str, Any]:
    comfy_reachable = False
    running_count = 0
    pending_count = 0

    try:
        resp = requests.get(f"{get_comfy_url()}/queue", timeout=5)
        if resp.status_code == 200:
            comfy_reachable = True
            data = resp.json()
            if isinstance(data, dict):
                q_run = data.get("queue_running")
                q_pend = data.get("queue_pending")
                running_count = len(q_run) if isinstance(q_run, list) else 0
                pending_count = len(q_pend) if isinstance(q_pend, list) else 0
    except Exception:
        comfy_reachable = False

    return {
        "ok": True,
        "engine": ENGINE_NAME,
        "comfy": comfy_reachable,
        "workflow_loaded": is_workflow_valid(),
        "gpu": query_gpu_info(),
        "queue": {
            "running": running_count,
            "pending": pending_count,
        },
    }


@app.post("/api/kinetix/submit", dependencies=[Depends(require_auth)])
def submit_job(payload: SubmitPayload) -> dict[str, str]:
    workflow_template = load_workflow_template()
    job_uuid = uuid.uuid4().hex

    clip_filename = ""
    if payload.clipUrl and payload.clipUrl.strip():
        clip_filename = download_input_media(payload.clipUrl.strip(), job_uuid, "clip")

    face_filename = ""
    if payload.faceUrl and payload.faceUrl.strip():
        face_filename = download_input_media(payload.faceUrl.strip(), job_uuid, "face")

    width, height = ASPECT_DIMENSIONS[payload.aspect]
    seconds = DURATION_SECONDS[payload.duration]
    fps = DEFAULT_FPS
    frames = fps * seconds + 1
    seed = payload.seed if payload.seed is not None else random.randint(0, 2**31 - 1)
    filename_prefix = f"kinetix/{job_uuid}"

    int_map: dict[str, int] = {
        "{{SEED}}": seed,
        "{{WIDTH}}": width,
        "{{HEIGHT}}": height,
        "{{FRAMES}}": frames,
        "{{FPS}}": fps,
    }
    bool_map: dict[str, bool] = {
        "{{FP16_VAE}}": bool(payload.boosters.fp16Vae),
        "{{FACE_REFINE}}": bool(payload.boosters.faceRefine),
        "{{ORION_DCTL}}": bool(payload.boosters.orionDctl),
    }
    str_map: dict[str, str] = {
        "{{PROMPT}}": payload.prompt,
        "{{CLIP}}": clip_filename,
        "{{FACE}}": face_filename,
        "{{FILENAME_PREFIX}}": filename_prefix,
        "{{SEED}}": str(seed),
        "{{WIDTH}}": str(width),
        "{{HEIGHT}}": str(height),
        "{{FRAMES}}": str(frames),
        "{{FPS}}": str(fps),
        "{{FP16_VAE}}": "true" if payload.boosters.fp16Vae else "false",
        "{{FACE_REFINE}}": "true" if payload.boosters.faceRefine else "false",
        "{{ORION_DCTL}}": "true" if payload.boosters.orionDctl else "false",
    }
    str_pattern = re.compile("|".join(re.escape(k) for k in str_map))

    workflow = inject_placeholders(
        copy.deepcopy(workflow_template), int_map, bool_map, str_map, str_pattern
    )

    try:
        resp = requests.post(
            f"{get_comfy_url()}/prompt",
            json={"prompt": workflow, "client_id": BRIDGE_CLIENT_ID},
            timeout=30,
        )
    except requests.RequestException as exc:
        raise BridgeError(502, f"Failed to reach ComfyUI /prompt: {exc}") from exc

    try:
        resp_data = resp.json()
    except ValueError:
        resp_data = {}

    node_errors = resp_data.get("node_errors") if isinstance(resp_data, dict) else None
    if resp.status_code != 200 or node_errors:
        err_detail = (
            resp_data.get("error")
            if isinstance(resp_data, dict) and resp_data.get("error")
            else node_errors or resp.text or f"HTTP {resp.status_code}"
        )
        if not isinstance(err_detail, str):
            err_detail = json.dumps(err_detail)
        raise BridgeError(502, f"ComfyUI rejected workflow: {err_detail}")

    prompt_id = str(resp_data.get("prompt_id") or "").strip() if isinstance(resp_data, dict) else ""
    if not prompt_id:
        raise BridgeError(502, "ComfyUI did not return a prompt_id")

    tracker.register_job(prompt_id)
    return {"job_id": prompt_id, "status": "queued"}


@app.get("/api/kinetix/status/{job_id}", dependencies=[Depends(require_auth)])
def get_job_status(job_id: str) -> dict[str, Any]:
    comfy_url = get_comfy_url()

    try:
        hist_resp = requests.get(f"{comfy_url}/history/{job_id}", timeout=10)
    except requests.RequestException as exc:
        raise BridgeError(502, f"Failed to query ComfyUI history: {exc}") from exc

    if hist_resp.status_code == 200:
        try:
            hist_data = hist_resp.json()
        except ValueError:
            hist_data = {}

        if isinstance(hist_data, dict) and job_id in hist_data:
            entry = hist_data[job_id]
            if isinstance(entry, dict):
                status_obj = entry.get("status")
                if isinstance(status_obj, dict) and status_obj.get("status_str") == "error":
                    return {
                        "status": "failed",
                        "progress": None,
                        "stage": None,
                        "queue_position": None,
                        "output_url": None,
                        "output_type": None,
                        "error": extract_comfy_error(status_obj),
                    }

                outputs = collect_job_outputs(entry)
                output_url = f"/api/kinetix/output/{job_id}/0" if outputs else None
                output_type = outputs[0]["output_type"] if outputs else None
                return {
                    "status": "completed",
                    "progress": 1.0,
                    "stage": "Color Grade",
                    "queue_position": None,
                    "output_url": output_url,
                    "output_type": output_type,
                    "error": None,
                }

    try:
        queue_resp = requests.get(f"{comfy_url}/queue", timeout=10)
    except requests.RequestException as exc:
        raise BridgeError(502, f"Failed to query ComfyUI queue: {exc}") from exc

    if queue_resp.status_code == 200:
        try:
            queue_data = queue_resp.json()
        except ValueError:
            queue_data = {}

        if isinstance(queue_data, dict):
            running_list = queue_data.get("queue_running")
            if isinstance(running_list, list):
                for item in running_list:
                    if match_queue_item(item, job_id):
                        progress, stage = tracker.get(job_id)
                        return {
                            "status": "running",
                            "progress": progress,
                            "stage": stage,
                            "queue_position": None,
                            "output_url": None,
                            "output_type": None,
                            "error": None,
                        }

            pending_list = queue_data.get("queue_pending")
            if isinstance(pending_list, list):
                for idx, item in enumerate(pending_list, start=1):
                    if match_queue_item(item, job_id):
                        return {
                            "status": "queued",
                            "progress": None,
                            "stage": None,
                            "queue_position": idx,
                            "output_url": None,
                            "output_type": None,
                            "error": None,
                        }

    return {
        "status": "not_found",
        "progress": None,
        "stage": None,
        "queue_position": None,
        "output_url": None,
        "output_type": None,
        "error": None,
    }


@app.get("/api/kinetix/output/{job_id}/{index}")
def stream_job_output(job_id: str, index: int) -> StreamingResponse:
    if index < 0:
        raise BridgeError(404, "Output index not found")

    comfy_url = get_comfy_url()
    try:
        hist_resp = requests.get(f"{comfy_url}/history/{job_id}", timeout=10)
    except requests.RequestException as exc:
        raise BridgeError(502, f"Failed to query ComfyUI history: {exc}") from exc

    if hist_resp.status_code != 200:
        raise BridgeError(404, "Job history not found")

    try:
        hist_data = hist_resp.json()
    except ValueError as exc:
        raise BridgeError(404, "Invalid history response from ComfyUI") from exc

    if not isinstance(hist_data, dict) or job_id not in hist_data:
        raise BridgeError(404, f"Job '{job_id}' not found in history")

    outputs = collect_job_outputs(hist_data[job_id])
    if index >= len(outputs):
        raise BridgeError(404, f"Output index {index} not found for job '{job_id}'")

    target = outputs[index]
    filename = target["filename"]
    subfolder = target.get("subfolder", "")
    folder_type = target.get("type", "output")

    try:
        upstream = requests.get(
            f"{comfy_url}/view",
            params={"filename": filename, "subfolder": subfolder, "type": folder_type},
            stream=True,
            timeout=(10, 60),
        )
    except requests.RequestException as exc:
        raise BridgeError(502, f"Failed to fetch output from ComfyUI /view: {exc}") from exc

    if upstream.status_code != 200:
        upstream.close()
        raise BridgeError(404, f"Output file '{filename}' not found in ComfyUI")

    ext = Path(filename).suffix.lower()
    content_type = (
        EXT_TO_CONTENT_TYPE.get(ext)
        or mimetypes.guess_type(filename)[0]
        or upstream.headers.get("Content-Type")
        or "application/octet-stream"
    )

    def iter_stream() -> Iterator[bytes]:
        try:
            for chunk in upstream.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    safe_name = Path(filename).name.replace('"', "")
    headers: dict[str, str] = {"Content-Disposition": f'inline; filename="{safe_name}"'}
    if "Content-Length" in upstream.headers:
        headers["Content-Length"] = upstream.headers["Content-Length"]

    return StreamingResponse(iter_stream(), media_type=content_type, headers=headers)


@app.post("/api/kinetix/cancel/{job_id}", dependencies=[Depends(require_auth)])
def cancel_job(job_id: str) -> dict[str, str]:
    comfy_url = get_comfy_url()
    is_running = False
    is_pending = False

    try:
        queue_resp = requests.get(f"{comfy_url}/queue", timeout=10)
        if queue_resp.status_code == 200:
            queue_data = queue_resp.json()
            if isinstance(queue_data, dict):
                running_list = queue_data.get("queue_running")
                if isinstance(running_list, list):
                    is_running = any(match_queue_item(item, job_id) for item in running_list)
                pending_list = queue_data.get("queue_pending")
                if isinstance(pending_list, list):
                    is_pending = any(match_queue_item(item, job_id) for item in pending_list)
    except requests.RequestException as exc:
        raise BridgeError(502, f"Failed to query ComfyUI queue: {exc}") from exc

    try:
        if is_running:
            requests.post(
                f"{comfy_url}/interrupt",
                json={"prompt_id": job_id},
                timeout=10,
            )
        if is_pending:
            requests.post(
                f"{comfy_url}/queue",
                json={"delete": [job_id]},
                timeout=10,
            )
    except requests.RequestException as exc:
        raise BridgeError(502, f"Failed to cancel job in ComfyUI: {exc}") from exc

    return {"status": "canceled"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("kinetix_bridge:app", host="0.0.0.0", port=8000)
