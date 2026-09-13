import type { AdminContext } from "@/lib/auth/session";
import { AppError } from "@/lib/security/errors";
import type { AppEnv } from "@/lib/security/env";
import { readKeyring, seal, unseal } from "@/lib/security/crypto-box";
import { connection, insertAttempt, claimAttempt, saveAttempt, disconnect, type AttemptRow } from "@/lib/db/connections";
import { advanceDeviceLoginOnce, initialDeviceState, type DeviceState } from "./microsoft-auth";

function projection(id: string, state: DeviceState, now: number) {
  return { attemptId: id, state: state.status, stage: state.stage, userCode: state.userCode ?? null, verificationUri: state.verificationUri ?? null,
    expiresAt: new Date(state.expiresAt).toISOString(), retryAfterSeconds: Math.max(0, Math.ceil((state.nextPollAt - now) / 1000)) };
}

export async function readConnectionState(env: AppEnv, admin: AdminContext, now = Date.now()) {
  const current = await connection(env.DB, now);
  const attempt = current.status === "authorizing" ? await env.DB.prepare(`SELECT a.* FROM auth_attempts a
    JOIN realm_connections c ON c.id=1 AND c.generation=a.connection_generation AND c.status='authorizing'
    JOIN admin_sessions s ON s.token_digest=a.admin_session_digest AND s.credential_version=a.credential_version
    JOIN admin_accounts account ON account.id=s.admin_id AND account.credential_version=s.credential_version
    WHERE a.connection_generation=? AND a.admin_session_digest=? AND a.credential_version=? AND a.status='pending'
    AND s.expires_at>? AND s.last_seen_at>? LIMIT 1`)
    .bind(current.generation, admin.tokenDigest, admin.credentialVersion, now, now - 1800000).first<AttemptRow>() : null;
  let pendingAttempt: ReturnType<typeof projection> | null = null;
  if (attempt?.encrypted_state) {
    const state = await unseal<DeviceState>(attempt.encrypted_state,
      { purpose: "device-attempt", connectionId: 1, generation: attempt.connection_generation }, readKeyring(env.AUTH_KEYRING));
    // 已到期的工作仍交由下一次受保護的 step 結束，但不再顯示無效代碼。
    pendingAttempt = projection(attempt.id, { ...state,
      ...(attempt.expires_at <= now ? { userCode: undefined, verificationUri: undefined } : {}),
      nextPollAt: attempt.expires_at <= now ? now : Math.max(attempt.next_poll_at, attempt.poll_until ?? 0),
    }, now);
  }
  return { state: current.status, generation: current.generation,
    lastVerifiedAt: current.last_verified_at === null ? null : new Date(current.last_verified_at).toISOString(),
    error: current.last_error_code, pendingAttempt };
}

export async function startConnection(env: AppEnv, admin: AdminContext, now = Date.now()) {
  const current = await connection(env.DB, now);
  if (current.status !== "disconnected") throw new AppError("conflict", 409);
  const id = crypto.randomUUID(); const state = initialDeviceState(now);
  const box = await seal(state, { purpose: "device-attempt", connectionId: 1, generation: current.generation + 1 }, readKeyring(env.AUTH_KEYRING), env.AUTH_ACTIVE_KEY_ID || "");
  await insertAttempt(env.DB, admin, current.generation, id, box, now);
  return projection(id, state, now);
}

export async function stepConnection(env: AppEnv, admin: AdminContext, id: string, options: { now?: () => number; fetcher?: typeof fetch } = {}) {
  const now = options.now ?? Date.now;
  const attempt = await claimAttempt(env.DB, id, admin, crypto.randomUUID(), now());
  if (!attempt) {
    const existing = await env.DB.prepare("SELECT * FROM auth_attempts WHERE id=? AND admin_session_digest=? AND credential_version=?").bind(id, admin.tokenDigest, admin.credentialVersion).first<AttemptRow>();
    if (!existing) throw new AppError("not_found", 404);
    if (existing.expires_at <= now() && existing.status === "pending") {
      const current = await connection(env.DB, now());
      if (current.generation === existing.connection_generation && current.status === "authorizing") await disconnect(env.DB, current.generation, now());
      return projection(id, { ...initialDeviceState(now()), status: "expired", expiresAt: existing.expires_at }, now());
    }
    if (existing.status !== "pending") return { attemptId: id, state: existing.status, stage: existing.stage, userCode: null, verificationUri: null, expiresAt: new Date(existing.expires_at).toISOString(), retryAfterSeconds: 0 };
    throw new AppError("rate_limited", 429, Math.max(1, Math.ceil((Math.max(existing.next_poll_at, existing.poll_until ?? 0) - now()) / 1000)));
  }
  const context = { purpose: "device-attempt", connectionId: 1, generation: attempt.connection_generation };
  const keyring = readKeyring(env.AUTH_KEYRING);
  try {
    const state = await unseal<DeviceState>(attempt.encrypted_state!, context, keyring);
    const next = await advanceDeviceLoginOnce(state, now(), options.fetcher);
    const pending = next.status === "pending";
    const saved = await saveAttempt(env.DB, attempt, {
      status: next.status, stage: next.stage, expiresAt: next.expiresAt, nextPollAt: next.nextPollAt,
      encryptedState: pending ? await seal(next, context, keyring, env.AUTH_ACTIVE_KEY_ID || "") : null,
      ...(next.status === "authorized" && next.authorization ? {
        credentialBox: await seal(next, { ...context, purpose: "connection" }, keyring, env.AUTH_ACTIVE_KEY_ID || ""), ownerXuid: next.authorization.ownerXuid,
      } : {}),
    }, now());
    if (!saved) throw new AppError("conflict", 409);
    return projection(id, next, now());
  } catch (error) {
    await env.DB.prepare("UPDATE auth_attempts SET poll_owner=NULL,poll_until=NULL,next_poll_at=? WHERE id=? AND poll_owner=? AND status='pending'").bind(now() + 5000, id, attempt.poll_owner).run().catch(() => undefined);
    throw error;
  }
}
