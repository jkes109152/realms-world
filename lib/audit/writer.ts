export type AuditCategory = "connection" | "disconnect" | "publication" | "unpublication" | "account_maintenance" | "download";
export type SafeAudit = { category: AuditCategory; actor: "admin" | "maintenance" | "anonymous" | "system"; worldPublicId?: string; archiveLabel?: "latest" | "backup";
  result: "requested" | "success" | "failed" | "unknown"; safeErrorCode?: string; correlationId: string };
const safeCodes = new Set(["reauth_required", "slot_unverifiable", "archive_gone", "unavailable", "preparation_limit_reached", "preparation_expired", "invalid_source", "transfer_cancelled", "transfer_error", "length_mismatch"]);
export async function writeAudit(db: D1Database, event: SafeAudit, now: number) {
  await db.prepare("INSERT INTO audit_events(id,created_at,category,actor,world_public_id,archive_label,result,safe_error_code,correlation_id) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), now, event.category, event.actor, event.worldPublicId ?? null, event.archiveLabel ?? null, event.result, event.safeErrorCode && safeCodes.has(event.safeErrorCode) ? event.safeErrorCode : null, event.correlationId).run();
}

export async function finishTransfer(db: D1Database, jobId: string, result: { outcome: "transfer_ended" | "transfer_failed"; bytes: string; code: string | null }, now: number) {
  // 不重試 INSERT；30 天後已清除的觀察不能被晚到結果重建。
  await db.batch([
    db.prepare("UPDATE download_jobs SET state=?,stage='ended',safe_error_code=?,encrypted_descriptor=NULL WHERE id=? AND state='streaming' AND status_expires_at>?")
      .bind(result.outcome, result.code && safeCodes.has(result.code) ? result.code : null, jobId, now),
    db.prepare("UPDATE download_attempts SET outcome=?,observed_bytes=?,observed_end_at=?,safe_error_code=? WHERE job_id=? AND requested_at>? AND stream_started_at IS NOT NULL AND outcome='unknown'")
      .bind(result.outcome, result.bytes, now, result.code && safeCodes.has(result.code) ? result.code : null, jobId, now - 2592000000),
  ]);
}

export async function recentDownloadAttempt(db: D1Database, jobId: string, now: number) {
  return db.prepare("SELECT outcome,stream_started_at,observed_end_at,observed_bytes,safe_error_code FROM download_attempts WHERE job_id=? AND requested_at>?").bind(jobId, now - 2592000000).first();
}
