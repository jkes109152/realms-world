import { database, bindings } from "@/lib/db/client";
import { AppError, errorResponse, jsonResponse } from "@/lib/security/errors";
import { assertOrigin, readJson, objectInput } from "@/lib/security/request-policy";
import { siteOrigin } from "@/lib/security/env";
import { consumeLimits, sourceDigest } from "@/lib/security/rate-limit";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, sessionCookie } from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    const env = bindings(); const db = database(); const now = Date.now();
    assertOrigin(request, siteOrigin(env));
    const rate = await consumeLimits(db, await sourceDigest(request, env.RATE_LIMIT_HMAC_KEY, now), "login", now);
    if (!rate.allowed) throw new AppError("rate_limited", 429, rate.retryAfterSeconds);
    const input = objectInput(await readJson(request), ["username", "password"]);
    if (typeof input.username !== "string" || typeof input.password !== "string") throw new AppError("invalid_request");
    const account = await db.prepare("SELECT username,password_hash,credential_version FROM admin_accounts WHERE id=1").first<{username:string;password_hash:string;credential_version:number}>();
    // 已初始化時，不因 username 不同跳過固定成本的密碼比對。
    const dummyHash = "scrypt$v1$16384$8$5$33554432$32$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const matches = await verifyPassword(input.password, account?.password_hash ?? dummyHash);
    if (!account || account.username !== input.username || !matches) throw new AppError("login_failed", 401);
    const session = await createSession(db, account.credential_version, Date.now());
    return jsonResponse({ username: account.username, csrfToken: session.csrfToken, expiresAt: new Date(session.expiresAt).toISOString() }, 200, { "Set-Cookie": sessionCookie(session.token) });
  } catch (error) { return errorResponse(error); }
}
