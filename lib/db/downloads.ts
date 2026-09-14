import { currentPublishedJob } from "./conditional-writes";
import { AppError } from "@/lib/security/errors";
import { digest, randomSecret, validSecret } from "@/lib/security/crypto-box";

export type DownloadJob = {
  id: string; status_secret_digest: string; world_slot_id: number; connection_generation: number; publication_version: number;
  selector_kind: "latest" | "backup"; source_backup_id: string | null; association_evidence: string;
  state: string; stage: string; encrypted_descriptor: string | null; prepare_attempts: number; prepare_auth_retry_used: number;
  next_poll_at: number; step_owner: string | null; step_until: number | null; expires_at: number; status_expires_at: number; safe_error_code: string | null; created_at: number;
};

export async function createJob(db: D1Database, input: { worldPublicId: string; kind: "latest" | "backup"; sourceBackupId: string | null; associationEvidence: string; archiveLabel: string }, now: number) {
  const id = crypto.randomUUID(); const secret = randomSecret();
  const results = await db.batch([
    db.prepare(`INSERT INTO download_jobs(id,status_secret_digest,world_slot_id,connection_generation,publication_version,selector_kind,source_backup_id,association_evidence,next_poll_at,expires_at,status_expires_at,created_at)
      SELECT ?,?,w.id,c.generation,w.publication_version,?,?,?,?,?,?,? FROM world_slots w JOIN realms r ON r.id=w.realm_id JOIN realm_connections c ON c.id=r.connection_id
      WHERE w.public_id=? AND w.published=1 AND w.association_status='verified' AND w.source_identity IS NOT NULL
      AND (?='latest' OR w.publication_scope='all_archives')
      AND (?!='latest' OR w.source_identity=?)
      AND w.connection_generation=c.generation AND r.connection_generation=c.generation AND c.status='connected' AND c.owner_xuid=r.verified_owner_xuid RETURNING id`)
      .bind(id, await digest(secret), input.kind, input.sourceBackupId, input.associationEvidence, now, now + 600000, now + 2592000000, now, input.worldPublicId, input.kind, input.kind, input.associationEvidence),
    db.prepare(`INSERT INTO download_attempts(id,job_id,world_public_id,world_display_name,archive_label,requested_at)
      SELECT ?,j.id,w.public_id,w.display_name,?,j.created_at FROM download_jobs j JOIN world_slots w ON w.id=j.world_slot_id WHERE j.id=?`).bind(id, input.archiveLabel, id),
  ]);
  if (results.some((r) => !r.success)) throw new AppError("database_unavailable", 503);
  if (!results[0].results.length) throw new AppError("not_found", 404);
  return { jobId: id, statusSecret: secret, state: "preparing", retryAfterSeconds: 1, prepareExpiresAt: new Date(now + 600000).toISOString(), statusExpiresAt: new Date(now + 2592000000).toISOString() };
}

export async function visibleJob(db: D1Database, id: string, secret: string, now: number): Promise<DownloadJob> {
  if (!validSecret(secret)) throw new AppError("not_found", 404);
  const job = await db.prepare(`SELECT * FROM download_jobs WHERE id=? AND status_secret_digest=? AND status_expires_at>? AND ${currentPublishedJob}`)
    .bind(id, await digest(secret), now).first<DownloadJob>();
  if (!job) throw new AppError("not_found", 404);
  if (["preparing", "ready", "redeeming"].includes(job.state) && job.expires_at <= now) {
    await expireJob(db, id, now);
    return visibleJob(db, id, secret, now);
  }
  return job;
}

export async function expireJob(db: D1Database, id: string, now: number) {
  await db.batch([
    db.prepare("UPDATE download_jobs SET state='expired',safe_error_code='preparation_expired',encrypted_descriptor=NULL,step_owner=NULL,step_until=NULL WHERE id=? AND expires_at<=? AND state IN ('preparing','ready','redeeming')").bind(id, now),
    db.prepare("DELETE FROM download_tickets WHERE job_id=? AND EXISTS(SELECT 1 FROM download_jobs j WHERE j.id=job_id AND j.state='expired')").bind(id),
  ]);
}

export async function claimDownloadStep(db: D1Database, id: string, owner: string, now: number, kind: "authorization" | "prepare"): Promise<DownloadJob | null> {
  await db.prepare(`UPDATE download_jobs SET state='failed',safe_error_code='preparation_limit_reached',encrypted_descriptor=NULL,step_owner=NULL,step_until=NULL
    WHERE id=? AND state='preparing' AND prepare_attempts=20 AND (step_until IS NULL OR step_until<=?) AND ${currentPublishedJob}`).bind(id, now).run();
  return db.prepare(`UPDATE download_jobs SET step_owner=?,step_until=?,prepare_attempts=prepare_attempts+?
    WHERE id=? AND state='preparing' AND expires_at>? AND next_poll_at<=? AND (step_until IS NULL OR step_until<=?)
    AND prepare_attempts<20 AND ${currentPublishedJob} RETURNING *`)
    .bind(owner, now + 30000, kind === "prepare" ? 1 : 0, id, now, now, now).first<DownloadJob>();
}

const saveStepGuard = `id=? AND state='preparing' AND step_owner=? AND step_until>? AND expires_at>? AND ${currentPublishedJob}`;
export async function savePending(db: D1Database, job: DownloadJob, nextPollAt: number, stage: string, now: number) {
  return db.prepare(`UPDATE download_jobs SET next_poll_at=?,stage=?,step_owner=NULL,step_until=NULL,
    state=CASE WHEN prepare_attempts=20 THEN 'failed' ELSE state END,
    safe_error_code=CASE WHEN prepare_attempts=20 THEN 'preparation_limit_reached' ELSE safe_error_code END
    WHERE ${saveStepGuard} RETURNING state`)
    .bind(nextPollAt, stage, job.id, job.step_owner, now, now).first();
}

export async function forceAuthRetry(db: D1Database, job: DownloadJob, now: number) {
  return db.prepare(`UPDATE download_jobs SET prepare_auth_retry_used=1,stage='reauthorizing',next_poll_at=?,step_owner=NULL,step_until=NULL
    WHERE ${saveStepGuard} AND prepare_auth_retry_used=0 AND prepare_attempts<20 RETURNING id`)
    .bind(now, job.id, job.step_owner, now, now).first();
}

export async function failStep(db: D1Database, job: DownloadJob, code: string, now: number) {
  return db.prepare(`UPDATE download_jobs SET state='failed',safe_error_code=?,encrypted_descriptor=NULL,step_owner=NULL,step_until=NULL WHERE ${saveStepGuard} RETURNING id`)
    .bind(code, job.id, job.step_owner, now, now).first();
}

export async function readyJob(db: D1Database, job: DownloadJob, encryptedDescriptor: string, now: number) {
  const ticket = randomSecret(); const ticketDigest = await digest(ticket);
  const results = await db.batch([
    db.prepare(`UPDATE download_jobs SET state='ready',stage='ready',encrypted_descriptor=? WHERE ${saveStepGuard} RETURNING id`)
      .bind(encryptedDescriptor, job.id, job.step_owner, now, now),
    db.prepare(`INSERT INTO download_tickets(ticket_digest,job_id,connection_generation,publication_version,expires_at)
      SELECT ?,id,connection_generation,publication_version,? FROM download_jobs WHERE id=? AND state='ready' AND step_owner=? AND step_until>? AND expires_at>? AND ${currentPublishedJob}`)
      .bind(ticketDigest, now + 60000, job.id, job.step_owner, now, now),
    db.prepare("UPDATE download_jobs SET step_owner=NULL,step_until=NULL WHERE id=? AND step_owner=?").bind(job.id, job.step_owner),
  ]);
  if (results.some((r) => !r.success)) throw new AppError("database_unavailable", 503);
  if (!results[0].results.length || results[1].meta.changes !== 1) throw new AppError("not_found", 404);
  return { ticket, ticketExpiresAt: new Date(now + 60000).toISOString() };
}

export async function consumeTicket(db: D1Database, raw: string, now: number): Promise<DownloadJob> {
  if (!validSecret(raw)) throw new AppError("not_found", 404);
  const key = await digest(raw);
  // 此 claim 是唯一的兌換權。後續失敗也不復活原票。
  const ticket = await db.prepare(`UPDATE download_tickets SET used_at=? WHERE ticket_digest=? AND used_at IS NULL AND expires_at>?
    AND EXISTS(SELECT 1 FROM download_jobs WHERE id=download_tickets.job_id AND state='ready' AND expires_at>?
      AND connection_generation=download_tickets.connection_generation AND publication_version=download_tickets.publication_version AND ${currentPublishedJob}) RETURNING job_id`)
    .bind(now, key, now, now).first<{job_id:string}>();
  if (!ticket) throw new AppError("not_found", 404);
  const job = await db.prepare(`UPDATE download_jobs SET state='redeeming',stage='opening_source' WHERE id=? AND state='ready' AND expires_at>? AND ${currentPublishedJob} RETURNING *`)
    .bind(ticket.job_id, now).first<DownloadJob>();
  if (!job) throw new AppError("not_found", 404);
  return job;
}

export async function beginStreaming(db: D1Database, jobId: string, now: number): Promise<boolean> {
  const result = await db.batch([
    db.prepare(`UPDATE download_jobs SET state='streaming',stage='streaming',encrypted_descriptor=NULL WHERE id=? AND state='redeeming' AND expires_at>? AND ${currentPublishedJob} RETURNING id`).bind(jobId, now),
    db.prepare("UPDATE download_attempts SET stream_started_at=? WHERE job_id=? AND requested_at>? AND EXISTS(SELECT 1 FROM download_jobs j WHERE j.id=job_id AND j.state='streaming')").bind(now, jobId, now - 2592000000),
  ]);
  if (result.some((r) => !r.success)) throw new AppError("database_unavailable", 503);
  return result[0].results.length === 1;
}
