import { AppError } from "@/lib/security/errors";
import { clientVersion, type AppEnv } from "@/lib/security/env";
import { randomSecret } from "@/lib/security/crypto-box";
import { getValidRealmsAuthorization } from "./authorization";
import { listOwnedRealms, listWorldSlots } from "./client";
import { latestSlotIdentity } from "./ownership";
import { currentPublishedJob } from "@/lib/db/conditional-writes";

// 只有完整讀完擁有者列表及每個 Realm 的欄位後，才以「未出現」撤銷舊資料。
export async function invalidateMissingSlots(db: D1Database, generation: number, ownerXuid: string, present: { realmId: string; slotId: string }[], now: number) {
  const result = await db.batch([
    db.prepare(`UPDATE world_slots SET published=0,source_identity=NULL,association_status='unavailable',publication_version=publication_version+1,updated_at=?
      WHERE connection_generation=? AND (published=1 OR association_status!='unavailable' OR source_identity IS NOT NULL)
      AND EXISTS(SELECT 1 FROM realm_connections c WHERE c.id=1 AND c.generation=? AND c.owner_xuid=? AND c.status='connected')
      AND NOT EXISTS(SELECT 1 FROM json_each(?) snapshot JOIN realms r ON r.id=world_slots.realm_id
        WHERE json_extract(snapshot.value,'$.realmId')=r.source_realm_id AND json_extract(snapshot.value,'$.slotId')=world_slots.source_slot_id)`)
      .bind(now, generation, generation, ownerXuid, JSON.stringify(present)),
    db.prepare(`UPDATE download_jobs SET state=CASE WHEN state IN ('preparing','ready','redeeming') THEN 'invalidated' ELSE state END,
      encrypted_descriptor=NULL,step_owner=NULL,step_until=NULL WHERE connection_generation=? AND NOT (${currentPublishedJob})`).bind(generation),
    db.prepare(`DELETE FROM download_tickets WHERE job_id IN (SELECT id FROM download_jobs WHERE connection_generation=? AND NOT (${currentPublishedJob}))`).bind(generation),
  ]);
  if (result.some((row) => !row.success)) throw new AppError("database_unavailable", 503);
}

export async function refreshWorlds(env: AppEnv) {
  const version = clientVersion(env);
  const auth = await getValidRealmsAuthorization(env);
  if (auth.kind !== "ready") throw new AppError("authorization_refreshing", 503, Math.max(1, Math.ceil((auth.nextPollAt - Date.now()) / 1000)));
  const owned = await listOwnedRealms(auth.authorization, version, Date.now());
  const present: { realmId: string; slotId: string }[] = [];
  for (const realm of owned) {
    const slots = await listWorldSlots(auth.authorization, realm.sourceRealmId, version, Date.now());
    const saved = await env.DB.prepare(`INSERT INTO realms(source_realm_id,connection_id,connection_generation,verified_owner_xuid,source_name,availability,fetched_at)
      SELECT ?,1,generation,?,?,?,? FROM realm_connections WHERE id=1 AND generation=? AND status='connected' AND owner_xuid=?
      ON CONFLICT(connection_generation,source_realm_id) DO UPDATE SET source_name=excluded.source_name,availability=excluded.availability,fetched_at=excluded.fetched_at RETURNING id`)
      .bind(realm.sourceRealmId, auth.authorization.ownerXuid, realm.name, realm.availability, Date.now(), auth.generation, auth.authorization.ownerXuid).first<{id:number}>();
    if (!saved) throw new AppError("conflict", 409);
    for (const slot of slots) {
      present.push({ realmId: realm.sourceRealmId, slotId: slot.sourceSlotId });
      const previous = await env.DB.prepare("SELECT source_identity,association_status FROM world_slots WHERE realm_id=? AND source_slot_id=?")
        .bind(saved.id, slot.sourceSlotId).first<{source_identity:string|null;association_status:string}>();
      const keepLatest = realm.availability === "available" && slot.associationStatus !== "empty"
        && previous?.association_status === "verified" && previous.source_identity === latestSlotIdentity(realm.sourceRealmId, slot.sourceSlotId);
      const identity = keepLatest ? previous.source_identity : slot.sourceIdentity;
      const association = realm.availability !== "available" ? "unavailable" : keepLatest ? "verified" : slot.associationStatus;
      await env.DB.prepare(`INSERT INTO world_slots(public_id,realm_id,source_slot_id,connection_generation,source_identity,association_status,display_name,fetched_at,updated_at)
        SELECT ?,?,?,generation,?,?,?,?,? FROM realm_connections WHERE id=1 AND generation=? AND status='connected' AND owner_xuid=?
        ON CONFLICT(realm_id,source_slot_id) DO UPDATE SET source_identity=excluded.source_identity,association_status=excluded.association_status,fetched_at=excluded.fetched_at,
        published=CASE WHEN world_slots.source_identity IS excluded.source_identity AND excluded.association_status='verified' THEN world_slots.published ELSE 0 END,
        publication_version=world_slots.publication_version+CASE WHEN world_slots.source_identity IS excluded.source_identity AND excluded.association_status='verified' THEN 0 ELSE 1 END`)
        .bind(randomSecret(), saved.id, slot.sourceSlotId, identity, association, [...slot.name].slice(0, 100).join(""), slot.fetchedAt, Date.now(), auth.generation, auth.authorization.ownerXuid).run();
    }
  }
  await invalidateMissingSlots(env.DB, auth.generation, auth.authorization.ownerXuid, present, Date.now());
  return env.DB.prepare(`SELECT w.public_id AS worldId,w.display_name AS displayName,w.association_status AS associationStatus,w.published,w.publication_version AS publicationVersion,
    w.publication_scope AS publicationScope,w.source_slot_id AS slotId,r.source_name AS realmName FROM world_slots w JOIN realms r ON r.id=w.realm_id JOIN realm_connections c ON c.id=1
    WHERE w.connection_generation=c.generation AND r.connection_generation=c.generation AND c.status='connected' ORDER BY r.id,w.source_slot_id`).all();
}
