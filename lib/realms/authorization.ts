import { AppError } from "@/lib/security/errors";
import type { AppEnv } from "@/lib/security/env";
import { readKeyring, seal, unseal } from "@/lib/security/crypto-box";
import { connection, claimRefresh, saveRefresh, type ConnectionRow } from "@/lib/db/connections";
import { advanceDeviceLoginOnce, type DeviceState } from "./microsoft-auth";
import type { RealmsAuthorization } from "./types";

export type AuthResult = { kind: "ready"; authorization: RealmsAuthorization; generation: number; advanced?: boolean } | { kind: "pending"; nextPollAt: number };
export async function getValidRealmsAuthorization(env: AppEnv, options: { forceRefresh?: boolean; fetcher?: typeof fetch; now?: () => number } = {}): Promise<AuthResult> {
  const now = options.now ?? Date.now; const fetcher = options.fetcher ?? fetch;
  const current = await connection(env.DB, now());
  if (current.status !== "connected" || !current.credential_box) throw new AppError("reauth_required", 409);
  const context = { purpose: "connection", connectionId: 1, generation: current.generation };
  const keyring = readKeyring(env.AUTH_KEYRING);
  let state = await unseal<DeviceState>(current.credential_box, context, keyring);
  if (state.status === "authorized" && state.authorization && state.authorization.ownerXuid === current.owner_xuid && state.authorization.expiresAt > now() + 60000 && !options.forceRefresh) {
    return { kind: "ready", authorization: state.authorization, generation: current.generation };
  }
  if (state.status === "pending" && state.nextPollAt > now()) return { kind: "pending", nextPollAt: state.nextPollAt };
  const claimed = await claimRefresh(env.DB, current, crypto.randomUUID(), now());
  if (!claimed) return { kind: "pending", nextPollAt: Math.max(now() + 1000, current.refresh_until ?? 0) };
  try {
    if (state.status === "authorized") state = { ...state, status: "pending", stage: "exchanging_tokens", exchangeStage: "refresh_microsoft", authorization: undefined, expiresAt: now() + 600000, nextPollAt: now() };
    const advanced = await advanceDeviceLoginOnce(state, now(), fetcher);
    if (!["pending", "authorized"].includes(advanced.status) || (advanced.authorization && advanced.authorization.ownerXuid !== current.owner_xuid)) {
      await saveRefresh(env.DB, claimed, null, "reauth_required", now());
      throw new AppError("reauth_required", 409);
    }
    const box = await seal(advanced, context, keyring, env.AUTH_ACTIVE_KEY_ID || "");
    if (!await saveRefresh(env.DB, claimed, box, "connected", now())) throw new AppError("reauth_required", 409);
    return advanced.status === "authorized" && advanced.authorization
      ? { kind: "ready", authorization: advanced.authorization, generation: current.generation, advanced: true }
      : { kind: "pending", nextPollAt: advanced.nextPollAt };
  } catch (error) {
    await releaseRefresh(env.DB, claimed).catch(() => undefined);
    throw error;
  }
}

async function releaseRefresh(db: D1Database, claimed: ConnectionRow) {
  await db.prepare("UPDATE realm_connections SET refresh_owner=NULL,refresh_until=NULL WHERE id=1 AND generation=? AND token_version=? AND refresh_owner=?").bind(claimed.generation, claimed.token_version, claimed.refresh_owner).run();
}
