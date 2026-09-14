import { digest, randomSecret, validSecret } from "@/lib/security/crypto-box";
import { AppError } from "@/lib/security/errors";
import { validAdminSession } from "@/lib/db/conditional-writes";
import { validatePasswordHash } from "./password";

export const SESSION_COOKIE = "__Host-realms_session";
export type AdminContext = { tokenDigest: string; credentialVersion: number; csrfDigest: string; username: string; expiresAt: number };

export function sessionCookie(token: string, maxAge = 43200): string {
  return `${SESSION_COOKIE}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function requestSessionToken(request: Request): string {
  const matches = (request.headers.get("Cookie") || "").split(";").map((s) => s.trim()).filter((s) => s.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) throw new AppError("unauthorized", 401);
  return matches[0].slice(SESSION_COOKIE.length + 1);
}

export async function createSession(db: D1Database, expectedVersion: number, now: number) {
  const token = randomSecret(); const csrfToken = randomSecret();
  const result = await db.prepare(`INSERT INTO admin_sessions(token_digest,admin_id,credential_version,csrf_digest,created_at,last_seen_at,expires_at)
    SELECT ?,1,credential_version,?,?,?,? FROM admin_accounts WHERE id=1 AND credential_version=? RETURNING token_digest`)
    .bind(await digest(token), await digest(csrfToken), now, now, now + 43200000, expectedVersion).first();
  if (!result) throw new AppError("unauthorized", 401);
  return { token, csrfToken, expiresAt: now + 43200000 };
}

export async function requireSession(db: D1Database, token: string, now: number): Promise<AdminContext> {
  if (!validSecret(token)) throw new AppError("unauthorized", 401);
  const tokenDigest = await digest(token);
  const result = await db.prepare(`UPDATE admin_sessions SET last_seen_at=?
    WHERE token_digest=? AND expires_at>? AND last_seen_at>? AND ${validAdminSession}
    RETURNING credential_version,csrf_digest,expires_at,(SELECT username FROM admin_accounts WHERE id=1) AS username`)
    .bind(now, tokenDigest, now, now - 1800000).first<{ credential_version: number; csrf_digest: string; username: string; expires_at: number }>();
  if (!result) {
    await db.prepare(`DELETE FROM admin_sessions WHERE token_digest=? AND (expires_at<=? OR last_seen_at<=? OR NOT (${validAdminSession}))`).bind(tokenDigest, now, now - 1800000).run();
    throw new AppError("unauthorized", 401);
  }
  return { tokenDigest, credentialVersion: result.credential_version, csrfDigest: result.csrf_digest, username: result.username, expiresAt: result.expires_at };
}

export async function rotateCsrf(db: D1Database, context: AdminContext, now: number): Promise<string> {
  const csrfToken = randomSecret();
  const result = await db.prepare(`UPDATE admin_sessions SET csrf_digest=? WHERE token_digest=? AND credential_version=?
    AND expires_at>? AND last_seen_at>? AND ${validAdminSession} RETURNING token_digest`)
    .bind(await digest(csrfToken), context.tokenDigest, context.credentialVersion, now, now - 1800000).first();
  if (!result) throw new AppError("unauthorized", 401);
  return csrfToken;
}

export async function changePassword(db: D1Database, expectedVersion: number, passwordHash: string, now: number) {
  validatePasswordHash(passwordHash);
  const results = await db.batch([
    db.prepare("UPDATE admin_accounts SET password_hash=?,credential_version=credential_version+1,updated_at=? WHERE id=1 AND credential_version=? RETURNING credential_version").bind(passwordHash, now, expectedVersion),
    db.prepare("DELETE FROM admin_sessions WHERE admin_id=1 AND credential_version<=?").bind(expectedVersion),
  ]);
  if (!results[0].success) throw new AppError("database_unavailable", 503);
  if (!results[0].results.length) throw new AppError("conflict", 409);
  return { credentialVersion: expectedVersion + 1 };
}
