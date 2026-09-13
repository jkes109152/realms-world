import { AppError } from "./errors";

type RateKind = "login" | "create" | "status" | "public";
export async function sourceDigest(request: Request, keyValue?: string, now = Date.now()): Promise<string> {
  try {
    const raw = Buffer.from(keyValue || "", "base64");
    if (raw.length !== 32) throw new Error();
    // CF-Connecting-IP 由部署平台供應；不信任使用者提供的 X-Forwarded-For。
    const ip = request.headers.get("CF-Connecting-IP") || "unknown-source";
    const date = new Date(now).toISOString().slice(0, 10);
    const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${date}\n${ip}`))).toString("hex");
  } catch { throw new AppError("unavailable", 503); }
}

export async function consumeLimits(db: D1Database, source: string, kind: RateKind, now: number, jobId?: string) {
  const duration = kind === "login" ? 900000 : 60000;
  const start = Math.floor(now / duration) * duration;
  const limits = kind === "login" ? [["login-source", source, 5], ["login-global", "global", 20]] as const
    : kind === "create" ? [["create-source", source, 6], ["create-global", "global", 30]] as const
    : kind === "status" ? [["status-job", jobId || source, 30]] as const
    : [["public-source", source, 120]] as const;
  const results = await db.batch<{ count: number }>(limits.map(([scope, key]) => db.prepare(`
    INSERT INTO rate_limit_windows(scope,key_digest,window_start,count,expires_at) VALUES(?,?,?,1,?)
    ON CONFLICT(scope,key_digest,window_start) DO UPDATE SET count=count+1 RETURNING count
  `).bind(scope, key, start, start + duration + 86400000)));
  if (results.some((r) => !r.success || !r.results.length)) throw new AppError("database_unavailable", 503);
  return { allowed: results.every((r, i) => Number(r.results[0].count) <= limits[i][2]), retryAfterSeconds: Math.max(1, Math.ceil((start + duration - now) / 1000)) };
}
