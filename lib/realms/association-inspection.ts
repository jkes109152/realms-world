import { AppError } from "@/lib/security/errors";
import { clientVersion, type AppEnv } from "@/lib/security/env";
import { readRealmsRecord } from "./client";
import { getValidRealmsAuthorization } from "./authorization";
import { sourceId } from "./ownership";
import { record } from "./http";
import type { RealmsAuthorization } from "./types";

// 僅保留結構；不回傳備份 ID、名稱、權杖或 metadata 的原始值。
function shape(value: unknown, prefix = "", depth = 0): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) return [];
  return Object.entries(value).slice(0, 64).flatMap(([key, item]) => {
    if (!/^[A-Za-z][A-Za-z0-9_ -]{0,63}$/.test(key)) return [];
    const path = `${prefix}${key}`;
    return [`${path}:${item === null ? "null" : Array.isArray(item) ? "array" : typeof item}`, ...shape(item, `${path}.`, depth + 1)];
  });
}
function values(value: unknown, prefix = "", depth = 0): [string, unknown][] {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) return [];
  return Object.entries(value).slice(0, 64).flatMap(([key, item]): [string, unknown][] => {
    if (!/^[A-Za-z][A-Za-z0-9_ -]{0,63}$/.test(key)) return [];
    const path = `${prefix}${key}`;
    return typeof item === "string" || typeof item === "number" ? [[path, item]] : values(item, `${path}.`, depth + 1);
  });
}
export async function inspectRealmAssociation(auth: RealmsAuthorization, realmId: string, version: string, fetcher: typeof fetch = fetch) {
  const path = `/worlds/${encodeURIComponent(sourceId(realmId))}`;
  const realm = await readRealmsRecord(path, auth, version, fetcher);
  if (realm.ownerUUID !== auth.ownerXuid || sourceId(realm.id) !== realmId) throw new AppError("forbidden", 403);
  if (!Array.isArray(realm.slots) || realm.slots.length > 16) throw new AppError("slot_unverifiable", 409);
  const slots = realm.slots.map((raw) => {
    const slot = record(raw); let options: unknown = slot.options;
    if (typeof options === "string") { try { options = JSON.parse(options); } catch { options = null; } }
    const parsed = options && typeof options === "object" && !Array.isArray(options) ? options as Record<string, unknown> : {};
    return { slotId: sourceId(slot.slotId), active: String(realm.activeSlot) === String(slot.slotId),
      empty: typeof parsed.empty === "boolean" ? parsed.empty : null, fields: shape(slot), optionFields: shape(options) };
  });
  const backupData = await readRealmsRecord(`${path}/backups`, auth, version, fetcher);
  if (!Array.isArray(backupData.backups)) throw new AppError("slot_unverifiable", 409);
  const fields = new Set<string>(); const links = new Map<string, { field: string; slotId: string; count: number }>();
  for (const backup of backupData.backups) {
    for (const field of shape(backup)) fields.add(field);
    for (const [field, value] of values(backup)) for (const slot of slots) {
      if (!/slot/i.test(field) || String(value) !== slot.slotId) continue;
      const key = `${field}:${slot.slotId}`; const previous = links.get(key);
      links.set(key, { field, slotId: slot.slotId, count: (previous?.count ?? 0) + 1 });
    }
  }
  return { ownerMatches: true, realmFields: shape(realm), slots, backupCount: backupData.backups.length,
    backupEnvelopeFields: shape(backupData), backupFields: [...fields].sort(), slotLinks: [...links.values()],
    paginationAdvertised: !!(backupData.nextCursor || backupData.nextPage || backupData.hasMore) };
}

export async function inspectStoredWorldAssociation(env: AppEnv, worldId: string) {
  const world = await env.DB.prepare(`SELECT r.source_realm_id,c.generation FROM world_slots w
    JOIN realms r ON r.id=w.realm_id JOIN realm_connections c ON c.id=r.connection_id
    WHERE w.public_id=? AND c.status='connected' AND c.generation=w.connection_generation
    AND c.generation=r.connection_generation AND c.owner_xuid=r.verified_owner_xuid`).bind(worldId).first<{source_realm_id:string;generation:number}>();
  if (!world) throw new AppError("not_found", 404);
  const auth = await getValidRealmsAuthorization(env);
  if (auth.kind !== "ready") throw new AppError("unavailable", 503, 2);
  if (auth.generation !== world.generation) throw new AppError("conflict", 409);
  const result = await inspectRealmAssociation(auth.authorization, world.source_realm_id, clientVersion(env));
  console.info(JSON.stringify({ event: "realms_association_shape", ...result }));
  return { backupCount: result.backupCount, message: result.paginationAdvertised
    ? "官方回應含後續頁面，需完成完整列表核對後才能發布。"
    : "已讀取官方備份資訊；存檔歸屬仍需完成核對，暫時無法發布。" };
}
