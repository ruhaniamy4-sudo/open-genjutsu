import { getEffect, hasBanglishLeak, type BoostersConfig } from '@/lib/vfx-data';
import { fetchWithTimeout } from './http';

const SYSTEM_PROMPT = `You are the KINETIX Middleman Director Agent, a senior cinematographer and VFX supervisor.
The user writes a rough idea in English, Bangla, or Banglish (Bangla written in English letters). Translate the intent into ONE production-ready English prompt for a video model.
Rules:
- Output English only. Never copy Bangla or Banglish words.
- Describe: subject and identity lock (match Frame 0 / reference portrait), environment, lighting with colour temperature, lens and camera motion, finish/grade.
- End with negative constraints: no plastic skin, no banding, no identity drift, no warped hands, no watermark.
- 60 to 120 words in "prompt". No markdown.
Return JSON only: {"prompt": string, "camera": string, "lighting": string}`;

export interface DirectorResult {
  prompt: string;
  camera: string;
  lighting: string;
}

function userText(roughIdea: string, effectId: string, boosters: BoostersConfig) {
  const fx = getEffect(effectId);
  const on = Object.entries(boosters)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ');
  return `Effect preset: ${fx.title} (${fx.category}). Default camera: ${fx.camera}. Default lighting: ${fx.lighting}.
Quality boosters on: ${on || 'none'}.
User idea: ${roughIdea}`;
}

/** Parses the model reply and rejects anything that is not clean English JSON. */
export function parseDirectorReply(raw: string | undefined | null): DirectorResult | null {
  if (!raw) return null;
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const obj = JSON.parse(text) as Partial<DirectorResult>;
    const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : '';
    if (prompt.length < 20 || prompt.length > 4000 || hasBanglishLeak(prompt)) return null;
    return {
      prompt,
      camera: typeof obj.camera === 'string' ? obj.camera.trim().slice(0, 200) : '',
      lighting: typeof obj.lighting === 'string' ? obj.lighting.trim().slice(0, 200) : '',
    };
  } catch {
    return null;
  }
}

function splitDataUrl(dataUrl?: string) {
  if (!dataUrl) return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

async function callGemini(text: string, frame?: string): Promise<DirectorResult | null> {
  const parts: Array<Record<string, unknown>> = [{ text }];
  const img = splitDataUrl(frame);
  if (img) parts.push({ inlineData: img });
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
      }),
    },
    20_000,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return parseDirectorReply(data.candidates?.[0]?.content?.parts?.[0]?.text);
}

async function callOpenAiCompatible(
  url: string,
  key: string,
  model: string,
  text: string,
  frame?: string,
  extraHeaders: Record<string, string> = {},
): Promise<DirectorResult | null> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text }];
  if (frame && splitDataUrl(frame)) content.push({ type: 'image_url', image_url: { url: frame } });
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...extraHeaders },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
    },
    20_000,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return parseDirectorReply(data.choices?.[0]?.message?.content);
}

/** Tries the configured vision LLMs in order. Returns null when none is configured or all fail. */
export async function runDirector(
  roughIdea: string,
  effectId: string,
  boosters: BoostersConfig,
  frame0?: string,
): Promise<{ source: 'gemini' | 'openrouter' | 'openai'; result: DirectorResult } | null> {
  const text = userText(roughIdea, effectId, boosters);
  const tries: Array<['gemini' | 'openrouter' | 'openai', () => Promise<DirectorResult | null>]> = [];
  if (process.env.GEMINI_API_KEY) tries.push(['gemini', () => callGemini(text, frame0)]);
  if (process.env.OPENROUTER_API_KEY) {
    tries.push([
      'openrouter',
      () =>
        callOpenAiCompatible(
          'https://openrouter.ai/api/v1/chat/completions',
          process.env.OPENROUTER_API_KEY!,
          process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
          text,
          frame0,
          { 'X-Title': 'KINETIX Studio' },
        ),
    ]);
  }
  if (process.env.OPENAI_API_KEY) {
    tries.push([
      'openai',
      () =>
        callOpenAiCompatible(
          'https://api.openai.com/v1/chat/completions',
          process.env.OPENAI_API_KEY!,
          process.env.OPENAI_MODEL || 'gpt-4o-mini',
          text,
          frame0,
        ),
    ]);
  }
  for (const [source, run] of tries) {
    try {
      const result = await run();
      if (result) return { source, result };
    } catch {
      // try the next provider
    }
  }
  return null;
}
