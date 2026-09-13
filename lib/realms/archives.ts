import { AppError } from "@/lib/security/errors";
import { digest } from "@/lib/security/crypto-box";
import { record } from "./http";
import { sourceId } from "./ownership";
import type { Archive } from "./types";

export type BackupPage = { items: unknown[]; nextCursor: string | null };
export type BackupVerifier = (backup: unknown, slotId: string) => string | null;

export function knownSize(value: unknown): string | null {
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) && value.length <= 30) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

export async function collectVerifiedBackups(readPage: (cursor: string | null) => Promise<BackupPage>, verify: BackupVerifier, slotId: string, worldPublicId: string, now: number): Promise<Archive[]> {
  const cursors = new Set<string>(); const items = new Map<string, Archive>();
  let cursor: string | null = null;
  do {
    const page = await readPage(cursor);
    if (!page || !Array.isArray(page.items) || !(page.nextCursor === null || typeof page.nextCursor === "string")) throw new AppError("slot_unverifiable", 409);
    for (const raw of page.items) {
      const evidence = verify(raw, slotId);
      if (!evidence) throw new AppError("slot_unverifiable", 409);
      const backup = record(raw); const id = sourceId(backup.backupId);
      const time = backup.lastModifiedDate;
      const savedAt = typeof time === "number" && Number.isSafeInteger(time) && time >= 0 && time <= 8640000000000000 ? time : null;
      const projected: Archive = { archiveId: `b_${await digest(`${worldPublicId}\n${slotId}\n${id}`)}`, worldPublicId, kind: "backup", sourceBackupId: id, associationEvidence: evidence,
        savedAt, sizeBytes: knownSize(backup.size), gameVersion: null, fetchedAt: now };
      const existing = items.get(id);
      if (existing && (existing.associationEvidence !== evidence || existing.savedAt !== savedAt || existing.sizeBytes !== projected.sizeBytes)) throw new AppError("slot_unverifiable", 409);
      items.set(id, projected);
    }
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (!cursor.length || cursors.has(cursor) || cursors.size >= 1000) throw new AppError("unavailable", 503);
      cursors.add(cursor);
    }
  } while (cursor !== null);
  return [...items.values()].sort((a, b) => (b.savedAt ?? -1) - (a.savedAt ?? -1) || a.archiveId.localeCompare(b.archiveId));
}

/** G0 尚未證實映射，正式流程沒有可回傳人工歸屬證據的路徑。 */
export const verifiedBackupAssociation: BackupVerifier = () => null;
