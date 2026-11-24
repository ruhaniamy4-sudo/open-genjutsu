# KINETIX Studio

AI cinema and VFX studio. Drop a clip and a portrait, describe the shot in English or Banglish, and the Middleman Director Agent writes a model-ready prompt for Kinetix Pro (your own GPU) or a partner engine via fal.ai: video (Kling 3.0, Veo 3.1, Seedance 2.5, WAN 2.6) and image (Nano Banana Pro, GPT Image, Seedream 4, FLUX Ultra). The Film Playground lets film makers plan and shoot a whole short film shot by shot with continuity.

Next.js 16 (App Router) · TypeScript strict · Framer Motion · Zod · Supabase · Stripe · Cloudflare R2.

## Run locally

```bash
cp .env.example .env.local   # optional: everything works with no keys (Demo Mode)
npm install
npm run dev                  # http://localhost:3000
```

Checks:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

## Pages

| Route | What it is |
| --- | --- |
| `/` | Explore: hero carousel with filmstrip, cinema presets, balanced masonry wall with hover playhead, Recreate and Inspect lightbox (before/after wipe), Director demo, engines strip |
| `/studio` | Video / Image mode, cinema monitor (live aspect resize), preset dock, drag-and-drop clip and portrait, floating composer with Engine and Format popovers, Director drawer, live progress, cancel with refund |
| `/playground` | Film Playground: projects, script import (INT./EXT. + NAME: dialogue), cast with portrait references, per-shot camera / lens / angle / movement / duration / dialogue, own footage or generation, continuity from the previous shot's last frame, rough-cut player. Saved in the browser |
| `/pipeline` | "How it works" for customers (no infrastructure details) plus the EN/Banglish compiler sandbox |
| `/library` | Your renders: hover playback, reopen in Studio, copy prompt, download. Keeps polling renders that were still running |
| `/pricing` | Free / Creator $19 / Pro Studio $49, Stripe checkout, unit economics and GPU cost tables |

## API

| Route | Notes |
| --- | --- |
| `POST /api/agent/enhance` | Gemini, then OpenRouter, then OpenAI, then local compiler. Replies with Banglish words are rejected |
| `POST /api/generate` | Charges credits atomically, routes to GPU worker, fal.ai, or demo; refunds if dispatch fails |
| `GET /api/jobs/:token` / `DELETE` | Live status (refund on failure) / cancel with refund |
| `GET /api/engine/ping?gpu=` | GPU worker health (SSRF-guarded) |
| `POST /api/upload/presign` | R2 presigned PUT + 24 h read URL. Type and size checks |
| `GET /api/config`, `GET /api/me` | Public feature flags / signed-in balance and renders |
| `POST /api/checkout`, `POST /api/stripe/webhook` | Stripe subscription checkout / signed webhook, idempotent credit grants |

## What turns on what

| You set | You get |
| --- | --- |
| nothing | Demo Mode: simulated renders, 120 demo credits per browser, local Director |
| `GEMINI_API_KEY` (or OpenRouter / OpenAI) | Vision Director (reads Frame 0 of the clip) |
| Supabase 3 keys + run `supabase/schema.sql` | Email sign-in, 30 free credits, atomic deduct + refund, synced Library |
| `FAL_KEY` (+ Supabase) | Live partner engines |
| `KINETIX_GPU_URL` + `KINETIX_GPU_TOKEN` | Live Kinetix Pro on your worker. Users can also paste their own `?gpu=` link |
| R2 4 keys | Real uploads for GPU and partner engines |
| Stripe 4 keys (+ Supabase) | Paid plans that top up credits monthly |
| Upstash 2 keys | Shared rate limits |

## Deploy to Vercel

1. Push this folder to a Git repo and import it in Vercel (framework: Next.js, root: this folder).
2. Add the env vars you want from `.env.example` in Project Settings, Environment Variables. Set `NEXT_PUBLIC_SITE_URL` to your domain.
3. Deploy. With no keys the site is live in Demo Mode.

Supabase: create a project, run `supabase/schema.sql` in the SQL editor, enable the Email provider, and in Authentication, URL Configuration set the Site URL to your domain and add `https://<your-domain>/**` to Redirect URLs (the magic link returns to the page the user signed in from).

Stripe: create two monthly prices ($19, $49), add a webhook to `https://<site>/api/stripe/webhook` for `checkout.session.completed`, `invoice.paid` and `customer.subscription.deleted`.

R2: create the bucket and add a CORS rule that allows `PUT` and `GET` from your site origin with the `Content-Type` header.

## GPU worker (Kinetix Pro)

Files in `deploy/`:

- `kinetix_bridge.py`: FastAPI bridge in front of ComfyUI (`/health`, submit, status, output, cancel). Bearer-token auth.
- `Kinetix_Colab_GPU_Worker.ipynb`: Colab. Upload `kinetix_bridge.py` and `workflows/` to `MyDrive/kinetix_deploy/`, run all cells. It prints a `?gpu=` share link and a token.
- `vast_onstart.sh`: same flow for Vast.ai / RunPod.
- `workflows/README.md`: export your ComfyUI workflow in API format as `workflows/kinetix_pro.api.json` with the placeholders listed there. Until it exists, the worker answers 503 with instructions.

Two ways to connect:

- **Your default worker for everyone:** set `KINETIX_GPU_URL` to the tunnel URL and `KINETIX_GPU_TOKEN` to the printed token on Vercel. The server sends this token only to that exact URL.
- **Per user (friend test):** open the `?gpu=` share link, or paste the tunnel URL and the printed token into the GPU pill in the Studio. The token stays in that browser and is forwarded only to that worker.

Media prep: `scripts/split_video.py` (zero-loss FFmpeg chunker / merger) and `scripts/prep_ref.py` (portrait pad/crop + sharpen).

## Notes

- Partner endpoint IDs for Kling v3 and Veo 3.1 are from fal's catalog. Check the Seedance 2.5 and WAN 2.6 IDs in the fal catalog and override with `FAL_ENDPOINT_*` if they differ.
- Demo credits, the Library and Playground projects live in the browser when Supabase is off.
- Customers never see GPU details. The worker pill in the Studio only appears for someone who opened a `?gpu=` link.
