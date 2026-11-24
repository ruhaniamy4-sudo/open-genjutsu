#!/usr/bin/env bash
set -euo pipefail

# KINETIX Studio v2 — 1-Click Vast.ai / RunPod GPU Bootstrapper
# Auto-selects --highvram on A100/RTX 5090 (>=32GB) or --normalvram on L4/RTX 4090 (24GB).

WORKDIR="${WORKDIR:-/workspace}"
COMFY_DIR="${COMFY_DIR:-${WORKDIR}/ComfyUI}"
DEPLOY_DIR="${WORKDIR}/kinetix_deploy"
MODELS_DIR="${MODELS_DIR:-}"
KINETIX_BRIDGE_SRC="${KINETIX_BRIDGE_SRC:-}"
KINETIX_BRIDGE_TOKEN="${KINETIX_BRIDGE_TOKEN:-}"
SITE_URL="${SITE_URL:-https://your-kinetix-site.vercel.app}"
NTFY_TOPIC="${NTFY_TOPIC:-}"

VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d ' ' || true)
if [ "${VRAM_MB:-24000}" -ge 31000 ]; then
  VRAM_FLAG="--highvram"
else
  VRAM_FLAG="--normalvram"
fi
echo "[KINETIX] Detected ${VRAM_MB:-24000} MB VRAM -> using ${VRAM_FLAG}"

mkdir -p "${WORKDIR}" "${DEPLOY_DIR}/workflows"

if [ -f "${DEPLOY_DIR}/kinetix_bridge.py" ]; then
  echo "[KINETIX] Using bridge at ${DEPLOY_DIR}/kinetix_bridge.py"
elif [ -n "${KINETIX_BRIDGE_SRC}" ]; then
  echo "[KINETIX] Downloading kinetix_bridge.py from ${KINETIX_BRIDGE_SRC}..."
  curl -fsSL "${KINETIX_BRIDGE_SRC}" -o "${DEPLOY_DIR}/kinetix_bridge.py"
else
  echo "[KINETIX] ERROR: Neither ${DEPLOY_DIR}/kinetix_bridge.py nor KINETIX_BRIDGE_SRC is available." >&2
  echo "[KINETIX] Upload deploy/kinetix_bridge.py to ${DEPLOY_DIR}/ or export KINETIX_BRIDGE_SRC=<https-url>." >&2
  exit 1
fi

if [ ! -d "${COMFY_DIR}" ]; then
  git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git "${COMFY_DIR}"
fi

cd "${COMFY_DIR}"
pip install -q -r requirements.txt fastapi uvicorn requests websocket-client python-multipart pydantic

MODEL_SUBFOLDERS=(diffusion_models text_encoders vae checkpoints loras ultralytics sams)
for sub in "${MODEL_SUBFOLDERS[@]}"; do
  mkdir -p "${COMFY_DIR}/models/${sub}"
  if [ -n "${MODELS_DIR}" ] && [ -d "${MODELS_DIR}/${sub}" ]; then
    for src_file in "${MODELS_DIR}/${sub}"/*; do
      [ -f "${src_file}" ] || continue
      base_name="$(basename "${src_file}")"
      dst_file="${COMFY_DIR}/models/${sub}/${base_name}"
      if [ ! -e "${dst_file}" ] && [ ! -L "${dst_file}" ]; then
        ln -s "${src_file}" "${dst_file}"
      fi
    done
  fi
done

if [ -z "${KINETIX_BRIDGE_TOKEN}" ]; then
  KINETIX_BRIDGE_TOKEN="$(openssl rand -hex 24)"
  echo "[KINETIX] Generated KINETIX_BRIDGE_TOKEN: ${KINETIX_BRIDGE_TOKEN}"
  echo "[KINETIX] Paste it into the Studio GPU pill, or set KINETIX_GPU_URL + KINETIX_GPU_TOKEN on Vercel."
  echo "[KINETIX] Set this value as KINETIX_GPU_TOKEN in your Vercel environment."
fi

echo "[KINETIX] Starting ComfyUI on port 8188 (${VRAM_FLAG})..."
nohup python3 main.py --listen 127.0.0.1 --port 8188 ${VRAM_FLAG} > "${WORKDIR}/comfyui.log" 2>&1 &

COMFY_READY=0
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:8188/queue" >/dev/null 2>&1; then
    COMFY_READY=1
    break
  fi
  sleep 2
done

if [ "${COMFY_READY}" -ne 1 ]; then
  echo "[KINETIX] ERROR: ComfyUI failed to start on port 8188 within 180s. Check ${WORKDIR}/comfyui.log." >&2
  exit 1
fi
echo "[KINETIX] ComfyUI is ready on port 8188."

export COMFY_DIR="${COMFY_DIR}"
export COMFY_URL="http://127.0.0.1:8188"
export KINETIX_BRIDGE_TOKEN="${KINETIX_BRIDGE_TOKEN}"
export WORKFLOW_PATH="${WORKFLOW_PATH:-${DEPLOY_DIR}/workflows/kinetix_pro.api.json}"

echo "[KINETIX] Starting Kinetix FastAPI Bridge on port 8000..."
cd "${DEPLOY_DIR}"
nohup uvicorn kinetix_bridge:app --host 0.0.0.0 --port 8000 > "${WORKDIR}/bridge.log" 2>&1 &

BRIDGE_READY=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
    BRIDGE_READY=1
    break
  fi
  sleep 1
done

if [ "${BRIDGE_READY}" -ne 1 ]; then
  echo "[KINETIX] ERROR: Kinetix Bridge failed to start on port 8000. Check ${WORKDIR}/bridge.log." >&2
  exit 1
fi
echo "[KINETIX] Kinetix Bridge is healthy on port 8000."

CLOUDFLARED_BIN="${WORKDIR}/cloudflared"
if [ ! -x "${CLOUDFLARED_BIN}" ]; then
  echo "[KINETIX] Downloading cloudflared..."
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" -o "${CLOUDFLARED_BIN}"
  chmod +x "${CLOUDFLARED_BIN}"
fi

CF_LOG="${WORKDIR}/cloudflared.log"
rm -f "${CF_LOG}"
nohup "${CLOUDFLARED_BIN}" tunnel --url http://localhost:8000 --no-autoupdate > "${CF_LOG}" 2>&1 &

TUNNEL_URL=""
for _ in $(seq 1 60); do
  if [ -f "${CF_LOG}" ]; then
    TUNNEL_URL="$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "${CF_LOG}" | head -n1 || true)"
    if [ -n "${TUNNEL_URL}" ]; then
      break
    fi
  fi
  sleep 1
done

if [ -z "${TUNNEL_URL}" ]; then
  echo "[KINETIX] ERROR: Timed out waiting 60s for Cloudflare Quick Tunnel URL. Check ${CF_LOG}." >&2
  exit 1
fi

SHARE_URL="${SITE_URL%/}/studio?gpu=${TUNNEL_URL}"
echo "[KINETIX] Tunnel URL : ${TUNNEL_URL}"
echo "[KINETIX] Share Link : ${SHARE_URL}"

if [ -n "${NTFY_TOPIC}" ]; then
  curl -fsS -d "KINETIX GPU Worker Ready (${VRAM_MB:-24000}MB, ${VRAM_FLAG}): ${SHARE_URL}" "https://ntfy.sh/${NTFY_TOPIC}" >/dev/null 2>&1 || true
fi

echo "[KINETIX] Bootstrap complete."
