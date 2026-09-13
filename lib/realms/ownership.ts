import { AppError } from "@/lib/security/errors";
import type { OwnedRealm, WorldSlot } from "./types";
import { record } from "./http";

export function sourceId(value: unknown): string {
  const id = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new AppError("invalid_request");
  return id;
}

export function selectOwnedRealms(input: unknown[], ownerXuid: string, now: number): OwnedRealm[] {
  return input.flatMap((value) => {
    const realm = record(value);
    if (typeof realm.ownerUUID !== "string" || realm.ownerUUID !== ownerXuid) return [];
    return [{ sourceRealmId: sourceId(realm.id), ownerXuid, name: typeof realm.name === "string" ? realm.name : "未命名 Realm",
      availability: realm.expired === true ? "unavailable" : realm.state === "OPEN" && realm.expired === false ? "available" : "unknown", fetchedAt: now }];
  });
}

export function projectSlots(input: unknown, ownerXuid: string, now: number): WorldSlot[] {
  const realm = record(input);
  if (realm.ownerUUID !== ownerXuid) throw new AppError("forbidden", 403);
  if (!Array.isArray(realm.slots)) throw new AppError("slot_unverifiable", 409);
  return realm.slots.map((value) => {
    const slot = record(value);
    let options: Record<string, unknown>;
    try { options = record(typeof slot.options === "string" ? JSON.parse(slot.options) : slot.options); }
    catch { options = {}; }
    return { sourceRealmId: sourceId(realm.id), sourceSlotId: sourceId(slot.slotId), sourceIdentity: null,
      associationStatus: options.empty === true ? "empty" : "unverifiable",
      name: typeof options.slotName === "string" && options.slotName ? options.slotName : `世界欄位 ${sourceId(slot.slotId)}`, fetchedAt: now };
  });
}
