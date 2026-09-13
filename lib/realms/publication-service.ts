import { AppError } from "@/lib/security/errors";

export async function setPublication(db: D1Database, publicId: string, published: boolean, expectedVersion: number, acknowledgeAllArchives: boolean, now: number) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || (published && !acknowledgeAllArchives)) throw new AppError("invalid_request");
  const target = `public_id=? AND publication_version=? AND (?=0 OR (association_status='verified' AND source_identity IS NOT NULL AND EXISTS (
    SELECT 1 FROM realms r JOIN realm_connections c ON c.id=r.connection_id WHERE r.id=world_slots.realm_id AND c.status='connected'
    AND c.owner_xuid=r.verified_owner_xuid AND r.connection_generation=c.generation AND world_slots.connection_generation=c.generation)))`;
  const values = [publicId, expectedVersion, published ? 1 : 0];
  const results = await db.batch([
    db.prepare(`INSERT INTO audit_events(id,created_at,category,actor,world_public_id,result,correlation_id)
      SELECT ?,?,?,'admin',public_id,'success',? FROM world_slots WHERE ${target}`).bind(crypto.randomUUID(), now, published ? "publication" : "unpublication", crypto.randomUUID(), ...values),
    db.prepare(`UPDATE download_jobs SET state=CASE WHEN state IN ('preparing','ready','redeeming') THEN 'invalidated' ELSE state END,encrypted_descriptor=NULL,step_owner=NULL,step_until=NULL
      WHERE world_slot_id IN (SELECT id FROM world_slots WHERE ${target})`).bind(...values),
    db.prepare(`DELETE FROM download_tickets WHERE job_id IN (SELECT id FROM download_jobs WHERE world_slot_id IN (SELECT id FROM world_slots WHERE ${target}))`).bind(...values),
    db.prepare(`UPDATE world_slots SET published=?,publication_version=publication_version+1,updated_at=? WHERE ${target} RETURNING public_id,published,publication_version`).bind(published ? 1 : 0, now, ...values),
  ]);
  if (results.some((r) => !r.success)) throw new AppError("database_unavailable", 503);
  if (!results[3].results.length) throw new AppError("conflict", 409);
  return { worldId: publicId, published, publicationVersion: expectedVersion + 1 };
}
