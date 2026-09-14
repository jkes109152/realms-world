import { AppError } from "./errors";
import type { RedirectRule } from "./env";

export type SourcePolicy = { hosts: Set<string>; redirects: RedirectRule[] };
export function validateDownloadUrl(value: string, policy: SourcePolicy): URL {
  try {
    if (value.length > 8192 || /[\u0000-\u0020\\]/.test(value)) throw new Error();
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash ||
        !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(url.hostname) || !policy.hosts.has(url.hostname)) throw new Error();
    return url;
  } catch { throw new AppError("invalid_source", 502); }
}
