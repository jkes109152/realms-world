import { AppError } from "@/lib/security/errors";
import { clientVersion, downloadPolicy, type AppEnv } from "@/lib/security/env";
import { getValidRealmsAuthorization } from "./authorization";
import { readRealmsRecord, prepareWorldDownload } from "./client";
import { sourceId, latestSlotIdentity, projectSlots } from "./ownership";
import { setPublication } from "./publication-service";

export async function publishLatestWorld(env: AppEnv, worldId: string, expectedVersion: number, acknowledgeLatest: boolean,
  options: { now?: () => number; fetcher?: typeof fetch } = {}) {
  if (!acknowledgeLatest || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new AppError("invalid_request");
  const now = options.now ?? Date.now; const fetcher = options.fetcher ?? fetch;
  const world = await env.DB.prepare(`SELECT w.source_slot_id,w.display_name,r.source_realm_id,c.generation FROM world_slots w
    JOIN realms r ON r.id=w.realm_id JOIN realm_connections c ON c.id=r.connection_id
    WHERE w.public_id=? AND w.publication_version=? AND c.status='connected'
    AND c.generation=w.connection_generation AND c.generation=r.connection_generation AND c.owner_xuid=r.verified_owner_xuid`)
    .bind(worldId, expectedVersion).first<{source_slot_id:string;display_name:string;source_realm_id:string;generation:number}>();
  if (!world) throw new AppError("conflict", 409);
  const auth = await getValidRealmsAuthorization(env, { now, fetcher });
  if (auth.kind !== "ready") throw new AppError("unavailable", 503, 2);
  if (auth.generation !== world.generation) throw new AppError("conflict", 409);
  const version = clientVersion(env);
  const realm = await readRealmsRecord(`/worlds/${encodeURIComponent(sourceId(world.source_realm_id))}`, auth.authorization, version, fetcher);
  if (sourceId(realm.id) !== world.source_realm_id || realm.ownerUUID !== auth.authorization.ownerXuid) throw new AppError("forbidden", 403);
  if (realm.expired !== false || realm.state !== "OPEN") throw new AppError("not_available", 409);
  const slots = projectSlots(realm, auth.authorization.ownerXuid, now());
  const matching = slots.filter((slot) => slot.sourceSlotId === world.source_slot_id);
  if (matching.length !== 1 || matching[0].associationStatus === "empty") throw new AppError("slot_unverifiable", 409);
  const identity = latestSlotIdentity(world.source_realm_id, world.source_slot_id);
  // 發布前只查一次官方 latest 描述，不抓檔案、不發票、不自動重試。
  const result = await prepareWorldDownload(auth.authorization, { ...matching[0], associationStatus: "verified", sourceIdentity: identity, associationEvidence: identity }, { kind: "latest" }, version, now(), fetcher);
  if (result.kind === "pending") throw new AppError("world_preparing", 503, Math.max(1, Math.ceil((result.nextPollAt - now()) / 1000)));
  if (result.kind === "reauth_required") throw new AppError("reauth_required", 409);
  if (result.kind !== "ready") throw new AppError(result.code, 409);
  const url = new URL(result.descriptor.url);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(url.hostname)) throw new AppError("invalid_source", 409);
  console.info(JSON.stringify({ event: "realms_latest_source", host: url.hostname, hasDownloadToken: !!result.descriptor.bearerToken, sizeKnown: result.descriptor.sizeBytes !== null }));
  let policy: ReturnType<typeof downloadPolicy>;
  try { policy = downloadPolicy(env); } catch { throw new AppError("source_not_configured", 503); }
  if (!policy.hosts.has(url.hostname)) throw new AppError("source_not_configured", 503);
  const promoted = await env.DB.prepare(`UPDATE world_slots SET source_identity=?,association_status='verified',fetched_at=?,updated_at=?
    WHERE public_id=? AND publication_version=? AND connection_generation=? AND EXISTS(
    SELECT 1 FROM realm_connections c JOIN realms r ON r.connection_id=c.id WHERE r.id=world_slots.realm_id
      AND c.generation=? AND r.connection_generation=c.generation AND c.status='connected' AND c.owner_xuid=?) RETURNING id`)
    .bind(identity, now(), now(), worldId, expectedVersion, auth.generation, auth.generation, auth.authorization.ownerXuid).first();
  if (!promoted) throw new AppError("conflict", 409);
  return setPublication(env.DB, worldId, true, expectedVersion, true, now());
}
