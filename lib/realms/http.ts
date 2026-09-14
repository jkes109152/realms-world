import { AppError } from "@/lib/security/errors";
import { boundedBody } from "@/lib/security/request-policy";

export async function upstreamJson(url: string, init: RequestInit, fetcher: typeof fetch = fetch) {
  try {
    const response = await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(10000) });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new AppError("unavailable", 503);
    }
    const text = await boundedBody(response, 262144);
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = null; }
    return { response, data };
  } catch { throw new AppError("unavailable", 503); }
}

export function retryAt(response: Response, now: number, fallbackSeconds = 5): number {
  const raw = response.headers.get("Retry-After");
  const delay = raw && /^\d+$/.test(raw) ? Number(raw) * 1000 : raw ? Date.parse(raw) - now : NaN;
  return now + Math.max(fallbackSeconds * 1000, Number.isFinite(delay) ? delay : 0);
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("unavailable", 503);
  return value as Record<string, unknown>;
}

export function nonempty(value: unknown, limit = 32768): string {
  if (typeof value !== "string" || !value.length || value.length > limit) throw new AppError("unavailable", 503);
  return value;
}
