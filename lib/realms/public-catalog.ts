import type { AppEnv } from "@/lib/security/env";
import { AppError } from "@/lib/security/errors";

export type PublicWorld = { id: string; displayName: string; description: string; availability: "available" | "temporarily_unavailable"; fetchedAt: string };

export async function publicCatalog(env: AppEnv, worldId?: string) {
  const rows = await env.DB.prepare(`SELECT w.public_id,w.display_name,w.description,w.fetched_at,c.status,r.availability
    FROM world_slots w JOIN realms r ON r.id=w.realm_id JOIN realm_connections c ON c.id=r.connection_id
    WHERE w.published=1 AND w.association_status='verified' AND w.source_identity IS NOT NULL
    AND w.connection_generation=c.generation AND r.connection_generation=c.generation AND c.owner_xuid=r.verified_owner_xuid
    AND (? IS NULL OR w.public_id=?) ORDER BY w.id`).bind(worldId ?? null, worldId ?? null)
    .all<{public_id:string;display_name:string;description:string;fetched_at:number;status:string;availability:string}>();
  if (!rows.success) throw new AppError("database_unavailable", 503);
  const items: PublicWorld[] = rows.results.map(row => ({ id: row.public_id, displayName: row.display_name, description: row.description,
    availability: row.status === "connected" && row.availability === "available" ? "available" : "temporarily_unavailable", fetchedAt: new Date(row.fetched_at).toISOString() }));
  if (worldId && !items.length) throw new AppError("not_found", 404);
  return { items, fetchedAt: new Date().toISOString() };
}
