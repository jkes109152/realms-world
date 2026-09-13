export type Selection = { kind: "latest" } | { kind: "backup"; archiveId: string };
export type AssociationStatus = "verified" | "empty" | "unverifiable" | "unavailable";
export type OwnedRealm = {
  sourceRealmId: string; ownerXuid: string; name: string;
  availability: "available" | "unavailable" | "unknown"; fetchedAt: number;
};
export type WorldSlot = {
  sourceSlotId: string; sourceRealmId: string; sourceIdentity: string | null;
  associationStatus: AssociationStatus; name: string; fetchedAt: number;
};
export type VerifiedSlot = WorldSlot & {
  sourceIdentity: string; associationStatus: "verified"; associationEvidence: string;
};
export type Archive = {
  archiveId: string; worldPublicId: string; kind: "latest" | "backup";
  sourceBackupId: string | null; associationEvidence: string;
  savedAt: number | null; sizeBytes: string | null; gameVersion: string | null; fetchedAt: number;
};
export type RealmsAuthorization = { userHash: string; xstsToken: string; ownerXuid: string; expiresAt: number };
export type DownloadDescriptor = {
  url: string; bearerToken?: string; sizeBytes: string | null; expiresAt: number | null;
  sourceIdentity: string; sourceBackupId: string | null;
};
export type PrepareResult =
  | { kind: "ready"; descriptor: DownloadDescriptor }
  | { kind: "pending"; nextPollAt: number }
  | { kind: "reauth_required" }
  | { kind: "unavailable" | "incompatible"; code: string; retryable: boolean };
