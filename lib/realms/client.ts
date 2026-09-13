import { AppError } from "@/lib/security/errors";
import { upstreamJson, record, nonempty, retryAt } from "./http";
import { sourceId, selectOwnedRealms, projectSlots } from "./ownership";
import { collectVerifiedBackups, verifiedBackupAssociation, knownSize } from "./archives";
import type { RealmsAuthorization, VerifiedSlot, PrepareResult, Selection } from "./types";

const ORIGIN = "https://pocket.realms.minecraft.net";
function headers(auth: RealmsAuthorization, version: string) {
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version) || /^0(?:\.0)+$/.test(version)) throw new AppError("source_not_configured", 503);
  return { Authorization: `XBL3.0 x=${auth.userHash};${auth.xstsToken}`, "Client-Version": version, Accept: "application/json" };
}

async function read(path: string, auth: RealmsAuthorization, version: string, fetcher: typeof fetch) {
  const result = await upstreamJson(`${ORIGIN}${path}`, { headers: headers(auth, version) }, fetcher);
  if (result.response.status === 401 || result.response.status === 403) throw new AppError("reauth_required", 409);
  if (!result.response.ok) throw new AppError("unavailable", 503);
  return record(result.data);
}

export async function listOwnedRealms(auth: RealmsAuthorization, version: string, now: number, fetcher: typeof fetch = fetch) {
  const data = await read("/worlds", auth, version, fetcher);
  if (!Array.isArray(data.servers)) throw new AppError("unavailable", 503);
  return selectOwnedRealms(data.servers, auth.ownerXuid, now);
}

export async function listWorldSlots(auth: RealmsAuthorization, realmId: string, version: string, now: number, fetcher: typeof fetch = fetch) {
  const data = await read(`/worlds/${encodeURIComponent(sourceId(realmId))}`, auth, version, fetcher);
  if (sourceId(data.id) !== realmId) throw new AppError("slot_unverifiable", 409);
  return projectSlots(data, auth.ownerXuid, now);
}

export async function listBackupsForVerifiedSlot(auth: RealmsAuthorization, slot: VerifiedSlot, worldId: string, version: string, now: number, fetcher: typeof fetch = fetch) {
  if (slot.associationStatus !== "verified" || !slot.sourceIdentity) throw new AppError("slot_unverifiable", 409);
  return collectVerifiedBackups(async (cursor) => {
    // 凍結參考沒有分頁協定；若服務新增游標，先拒絕，待 G0 核對後再實作。
    if (cursor) throw new AppError("slot_unverifiable", 409);
    const data = await read(`/worlds/${encodeURIComponent(sourceId(slot.sourceRealmId))}/backups`, auth, version, fetcher);
    if (!Array.isArray(data.backups) || data.nextCursor || data.nextPage || data.hasMore) throw new AppError("slot_unverifiable", 409);
    return { items: data.backups, nextCursor: null };
  }, verifiedBackupAssociation, slot.sourceSlotId, worldId, now);
}

export type VerifiedSelection = { kind: "latest" } | { kind: "backup"; archiveId: string; sourceBackupId: string; associationEvidence: string };

export async function prepareWorldDownload(auth: RealmsAuthorization, slot: VerifiedSlot, selection: Selection | VerifiedSelection, version: string, now: number, fetcher: typeof fetch = fetch): Promise<PrepareResult> {
  if (slot.associationStatus !== "verified" || !slot.sourceIdentity || !slot.associationEvidence) return { kind: "incompatible", code: "slot_unverifiable", retryable: false };
  let backupId = "latest";
  if (selection.kind === "backup") {
    if (!("sourceBackupId" in selection) || !selection.associationEvidence) return { kind: "incompatible", code: "slot_unverifiable", retryable: false };
    backupId = sourceId(selection.sourceBackupId);
  }
  const path = [slot.sourceRealmId, slot.sourceSlotId, backupId].map((id) => encodeURIComponent(sourceId(id))).join("/");
  const { response, data } = await upstreamJson(`${ORIGIN}/archive/download/world/${path}`, { headers: headers(auth, version) }, fetcher);
  if (response.status === 401 || response.status === 403) return { kind: "reauth_required" };
  if (response.status === 202 || response.status === 429 || response.status >= 500) return { kind: "pending", nextPollAt: retryAt(response, now) };
  if (response.status === 404) return { kind: "unavailable", code: selection.kind === "backup" ? "archive_gone" : "unavailable", retryable: false };
  if (!response.ok) return { kind: "unavailable", code: "unavailable", retryable: false };
  const raw = record(data);
  return { kind: "ready", descriptor: { url: nonempty(raw.downloadLink ?? raw.downloadUrl, 8192), ...(raw.token ? { bearerToken: nonempty(raw.token) } : {}),
    sizeBytes: knownSize(raw.size), expiresAt: null, sourceIdentity: slot.sourceIdentity, sourceBackupId: selection.kind === "backup" ? backupId : null } };
}
