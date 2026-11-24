import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
}

export function zodMessage(err: ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'Invalid request';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** fetch with a hard timeout, no caching, and no redirects (redirects could point at internal hosts). */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { redirect: 'error', ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

export function clientIp(req: Request): string {
  // The leftmost X-Forwarded-For entry is client-controlled (spoofable); trust the platform header, then the proxy-appended last hop.
  const platform = req.headers.get('x-vercel-forwarded-for') || req.headers.get('x-real-ip');
  if (platform) return platform.split(',')[0].trim();
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',').pop()?.trim() : '') || 'anon';
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.name === 'AbortError' ? 'Upstream timed out' : err.message;
  return fallback;
}
