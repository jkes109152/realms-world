import { waitUntil } from "cloudflare:workers";
import { AppError, safeHeaders } from "@/lib/security/errors";
import { clientVersion, downloadPolicy, type AppEnv } from "@/lib/security/env";
import { readKeyring, seal, unseal } from "@/lib/security/crypto-box";
import { createJob, visibleJob, claimDownloadStep, savePending, forceAuthRetry, failStep, readyJob, consumeTicket, beginStreaming, type DownloadJob } from "@/lib/db/downloads";
import { getValidRealmsAuthorization } from "@/lib/realms/authorization";
import { listBackupsForVerifiedSlot, listWorldSlots, prepareWorldDownload, type VerifiedSelection } from "@/lib/realms/client";
import { latestSlotIdentity } from "@/lib/realms/ownership";
import type { DownloadDescriptor, Selection, VerifiedSlot } from "@/lib/realms/types";
import { openValidatedDownload } from "./stream";
import { finishTransfer, recentDownloadAttempt } from "@/lib/audit/writer";

type StoredWorld = { id: number; source_realm_id: string; source_slot_id: string; source_identity: string; display_name: string; fetched_at: number; public_id: string; publication_scope: string };
async function publishedWorld(env: AppEnv, worldId: string): Promise<StoredWorld> {
  const world = await env.DB.prepare(`SELECT w.*,r.source_realm_id FROM world_slots w JOIN realms r ON r.id=w.realm_id JOIN realm_connections c ON c.id=r.connection_id
    WHERE w.public_id=? AND w.published=1 AND w.association_status='verified' AND w.source_identity IS NOT NULL AND c.status='connected'
    AND c.generation=w.connection_generation AND c.generation=r.connection_generation AND c.owner_xuid=r.verified_owner_xuid`).bind(worldId).first<StoredWorld>();
  if (!world) throw new AppError("not_found", 404);
  return world;
}
function verifiedSlot(world: StoredWorld): VerifiedSlot {
  return { sourceRealmId: world.source_realm_id, sourceSlotId: world.source_slot_id, sourceIdentity: world.source_identity, associationStatus: "verified", associationEvidence: world.source_identity, name: world.display_name, fetchedAt: world.fetched_at };
}
export async function verificationArchives(env: AppEnv, worldId: string) {
  const world = await publishedWorld(env, worldId);
  if (world.publication_scope !== "all_archives") throw new AppError("not_found", 404);
  const auth = await getValidRealmsAuthorization(env);
  if (auth.kind !== "ready") throw new AppError("unavailable", 503, 2);
  return listBackupsForVerifiedSlot(auth.authorization, verifiedSlot(world), worldId, clientVersion(env), Date.now());
}
export async function createVerificationDownload(env: AppEnv, worldId: string, selection: Selection) {
  const world = await publishedWorld(env, worldId);
  let sourceBackupId: string | null = null; let evidence = world.source_identity;
  if (selection.kind === "backup") {
    const archives = await verificationArchives(env, worldId);
    const archive = archives.find((item) => item.archiveId === selection.archiveId);
    if (!archive) throw new AppError("not_found", 404);
    sourceBackupId = archive.sourceBackupId; evidence = archive.associationEvidence;
  }
  return createJob(env.DB, { worldPublicId: worldId, kind: selection.kind, sourceBackupId, associationEvidence: evidence, archiveLabel: selection.kind }, Date.now());
}
export async function verificationStatus(env: AppEnv, id: string, secret: string) {
  const job = await visibleJob(env.DB, id, secret, Date.now());
  const observation = await recentDownloadAttempt(env.DB, id, Date.now());
  return { jobId: id, state: job.state, stage: job.stage, outcome: observation?.outcome ?? "unknown", error: job.safe_error_code,
    prepareExpiresAt: new Date(job.expires_at).toISOString(), statusExpiresAt: new Date(job.status_expires_at).toISOString() };
}
async function worldForJob(env: AppEnv, job: DownloadJob) {
  const row = await env.DB.prepare("SELECT public_id FROM world_slots WHERE id=?").bind(job.world_slot_id).first<{public_id:string}>();
  if (!row) throw new AppError("not_found", 404);
  return publishedWorld(env, row.public_id);
}
export async function stepVerificationDownload(env: AppEnv, id: string, secret: string) {
  const current = await visibleJob(env.DB, id, secret, Date.now());
  if (current.state !== "preparing") return verificationStatus(env, id, secret);
  const authClaim = await claimDownloadStep(env.DB, id, crypto.randomUUID(), Date.now(), "authorization");
  if (!authClaim) {
    const latest = await visibleJob(env.DB, id, secret, Date.now());
    if (latest.safe_error_code === "preparation_limit_reached") throw new AppError("preparation_limit_reached", 503);
    throw new AppError("rate_limited", 429, Math.max(1, Math.ceil((Math.max(latest.next_poll_at, latest.step_until ?? 0) - Date.now()) / 1000)));
  }
  try {
    const auth = await getValidRealmsAuthorization(env, { forceRefresh: authClaim.stage === "reauthorizing" });
    if (auth.kind === "pending") { await savePending(env.DB, authClaim, auth.nextPollAt, "authorizing", Date.now()); return { ...await verificationStatus(env, id, secret), retryAfterSeconds: Math.max(1, Math.ceil((auth.nextPollAt - Date.now()) / 1000)) }; }
    if (auth.advanced) {
      await savePending(env.DB, authClaim, Date.now(), "authorizing", Date.now());
      return verificationStatus(env, id, secret);
    }
    const world = await worldForJob(env, authClaim);
    if (authClaim.selector_kind === "latest") {
      const slots = await listWorldSlots(auth.authorization, world.source_realm_id, clientVersion(env), Date.now());
      const matching = slots.filter((slot) => slot.sourceSlotId === world.source_slot_id && slot.associationStatus !== "empty");
      if (matching.length !== 1 || world.source_identity !== latestSlotIdentity(world.source_realm_id, world.source_slot_id)) throw new AppError("slot_unverifiable", 409);
    }
    let selection: VerifiedSelection = { kind: "latest" };
    if (authClaim.selector_kind === "backup" && authClaim.stage !== "preparing") {
      const archives = await listBackupsForVerifiedSlot(auth.authorization, verifiedSlot(world), world.public_id, clientVersion(env), Date.now());
      const archive = archives.find((item) => item.sourceBackupId === authClaim.source_backup_id && item.associationEvidence === authClaim.association_evidence);
      if (!archive?.sourceBackupId) throw new AppError("not_found", 404);
      selection = { kind: "backup", archiveId: archive.archiveId, sourceBackupId: archive.sourceBackupId, associationEvidence: archive.associationEvidence };
      await savePending(env.DB, authClaim, Date.now(), "preparing", Date.now());
      return verificationStatus(env, id, secret);
    }
    if (authClaim.selector_kind === "backup") selection = { kind: "backup", archiveId: "verified-selection", sourceBackupId: authClaim.source_backup_id!, associationEvidence: authClaim.association_evidence };
    // 取得授權未發世界準備 HTTP，不消耗次數；真正送出前另取原子準備租約。
    if (!await savePending(env.DB, authClaim, Date.now(), "preparing", Date.now())) throw new AppError("not_found", 404);
    const job = await claimDownloadStep(env.DB, id, crypto.randomUUID(), Date.now(), "prepare");
    if (!job) throw new AppError("rate_limited", 429, 2);
    const result = await prepareWorldDownload(auth.authorization, verifiedSlot(world), selection, clientVersion(env), Date.now());
    if (result.kind === "ready") {
      const box = await seal(result.descriptor, { purpose: `download:${job.id}`, connectionId: 1, generation: job.connection_generation }, readKeyring(env.AUTH_KEYRING), env.AUTH_ACTIVE_KEY_ID || "");
      return { jobId: id, state: "ready", prepareExpiresAt: new Date(job.expires_at).toISOString(), statusExpiresAt: new Date(job.status_expires_at).toISOString(), ...await readyJob(env.DB, job, box, Date.now()) };
    }
    if (result.kind === "pending") await savePending(env.DB, job, result.nextPollAt, "preparing", Date.now());
    else if (result.kind === "reauth_required") {
      if (!await forceAuthRetry(env.DB, job, Date.now())) await failStep(env.DB, job, job.prepare_attempts === 20 ? "preparation_limit_reached" : "reauth_required", Date.now());
    } else await failStep(env.DB, job, result.code, Date.now());
    const status = await verificationStatus(env, id, secret);
    if (status.error === "preparation_limit_reached") throw new AppError("preparation_limit_reached", 503);
    return { ...status, retryAfterSeconds: result.kind === "pending" ? Math.max(1, Math.ceil((result.nextPollAt - Date.now()) / 1000)) : 1 };
  } catch (error) {
    await savePending(env.DB, authClaim, Date.now() + 5000, "authorizing", Date.now()).catch(() => undefined);
    throw error;
  }
}

export async function redeemVerificationDownload(env: AppEnv, ticket: string, signal: AbortSignal) {
  const job = await consumeTicket(env.DB, ticket, Date.now());
  let opened: Awaited<ReturnType<typeof openValidatedDownload>> | undefined;
  try {
    const world = await worldForJob(env, job);
    const descriptor = await unseal<DownloadDescriptor>(job.encrypted_descriptor!, { purpose: `download:${job.id}`, connectionId: 1, generation: job.connection_generation }, readKeyring(env.AUTH_KEYRING));
    opened = await openValidatedDownload(descriptor, downloadPolicy(env), signal);
    if (!await beginStreaming(env.DB, job.id, Date.now())) throw new AppError("not_found", 404);
    waitUntil(opened.completion.then((result) => finishTransfer(env.DB, job.id, result, Date.now())).catch(() => undefined));
    const filename = `${world.display_name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_")}-${job.selector_kind === "latest" ? "latest" : `backup-${job.id.slice(0, 8)}`}.mcworld`;
    return new Response(opened.body, { headers: { ...safeHeaders, "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="world-backup.mcworld"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      ...(opened.contentLength ? { "Content-Length": opened.contentLength } : {}) } });
  } catch (error) {
    await opened?.cancel();
    await env.DB.prepare("UPDATE download_jobs SET state='failed',safe_error_code='invalid_source',encrypted_descriptor=NULL WHERE id=? AND state='redeeming'").bind(job.id).run().catch(() => undefined);
    throw error;
  }
}
