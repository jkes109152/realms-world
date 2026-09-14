import type { AdminContext } from "@/lib/auth/session";
import { AppError } from "@/lib/security/errors";

export type ConnectionRow = {
  id: number; generation: number; status: "disconnected" | "authorizing" | "connected" | "reauth_required";
  owner_xuid: string | null; credential_box: string | null; token_version: number;
  refresh_owner: string | null; refresh_until: number | null; last_verified_at: number | null; last_error_code: string | null;
};
export type AttemptRow = {
  id: string; admin_session_digest: string; credential_version: number; connection_generation: number;
  status: string; stage: string; encrypted_state: string | null; expires_at: number; next_poll_at: number;
  poll_owner: string | null; poll_until: number | null; created_at: number;
};

export async function connection(db: D1Database, now: number): Promise<ConnectionRow> {
  await db.prepare("INSERT OR IGNORE INTO realm_connections(id,updated_at) VALUES(1,?)").bind(now).run();
  const row = await db.prepare("SELECT * FROM realm_connections WHERE id=1").first<ConnectionRow>();
  if (!row) throw new AppError("database_unavailable", 503);
  return row;
}

const activeAttemptSession = `EXISTS (SELECT 1 FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id
  WHERE s.token_digest=auth_attempts.admin_session_digest AND s.credential_version=auth_attempts.credential_version
  AND a.credential_version=s.credential_version AND s.expires_at>? AND s.last_seen_at>?)`;
const activeAttemptConnection = `EXISTS (SELECT 1 FROM realm_connections c WHERE c.id=1
  AND c.generation=auth_attempts.connection_generation AND c.status='authorizing')`;

export async function insertAttempt(db: D1Database, context: AdminContext, expectedGeneration: number, id: string, encryptedState: string, now: number) {
  const next = expectedGeneration + 1;
  const results = await db.batch([
    db.prepare(`UPDATE realm_connections SET generation=?,status='authorizing',updated_at=? WHERE id=1 AND generation=? AND status='disconnected'
      AND EXISTS(SELECT 1 FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id WHERE s.token_digest=? AND s.credential_version=? AND a.credential_version=s.credential_version AND s.expires_at>? AND s.last_seen_at>?) RETURNING generation`)
      .bind(next, now, expectedGeneration, context.tokenDigest, context.credentialVersion, now, now - 1800000),
    db.prepare(`INSERT INTO auth_attempts(id,admin_session_digest,credential_version,connection_generation,status,stage,encrypted_state,expires_at,next_poll_at,created_at)
      SELECT ?,?,?,generation,'pending','requesting_code',?,?,?,? FROM realm_connections
      WHERE id=1 AND generation=? AND status='authorizing' AND NOT EXISTS(SELECT 1 FROM auth_attempts WHERE connection_generation=?)
      AND EXISTS(SELECT 1 FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id WHERE s.token_digest=? AND s.credential_version=? AND a.credential_version=s.credential_version AND s.expires_at>? AND s.last_seen_at>?)`)
      .bind(id, context.tokenDigest, context.credentialVersion, encryptedState, now + 600000, now, now, next, next, context.tokenDigest, context.credentialVersion, now, now - 1800000),
  ]);
  if (!results[0].results.length || results[1].meta.changes !== 1) throw new AppError("conflict", 409);
  return next;
}

export async function claimAttempt(db: D1Database, id: string, context: AdminContext, owner: string, now: number) {
  return db.prepare(`UPDATE auth_attempts SET poll_owner=?,poll_until=? WHERE id=? AND admin_session_digest=? AND credential_version=?
    AND status='pending' AND expires_at>? AND next_poll_at<=? AND (poll_until IS NULL OR poll_until<=?)
    AND ${activeAttemptSession} AND ${activeAttemptConnection} RETURNING *`)
    .bind(owner, now + 30000, id, context.tokenDigest, context.credentialVersion, now, now, now, now, now - 1800000).first<AttemptRow>();
}

export async function saveAttempt(db: D1Database, attempt: AttemptRow, result: { status: string; stage: string; encryptedState: string | null; expiresAt: number; nextPollAt: number; credentialBox?: string; ownerXuid?: string }, now: number) {
  const statements = [db.prepare(`UPDATE auth_attempts SET status=?,stage=?,encrypted_state=?,expires_at=?,next_poll_at=?
    WHERE id=? AND status='pending' AND connection_generation=? AND poll_owner=? AND poll_until>? AND expires_at>?
    AND ${activeAttemptSession} AND ${activeAttemptConnection} RETURNING id`)
    .bind(result.status, result.stage, result.encryptedState, result.expiresAt, result.nextPollAt, attempt.id, attempt.connection_generation, attempt.poll_owner, now, now, now, now - 1800000)];
  if (result.status === "authorized") {
    statements.push(db.prepare(`UPDATE realm_connections SET status='connected',owner_xuid=?,credential_box=?,token_version=token_version+1,last_verified_at=?,last_error_code=NULL,updated_at=?
      WHERE id=1 AND generation=? AND status='authorizing' AND EXISTS(SELECT 1 FROM auth_attempts WHERE id=? AND status='authorized' AND poll_owner=? AND poll_until>?)`)
      .bind(result.ownerXuid, result.credentialBox, now, now, attempt.connection_generation, attempt.id, attempt.poll_owner, now));
  } else if (result.status !== "pending") {
    statements.push(db.prepare(`UPDATE realm_connections SET status='disconnected',generation=generation+1,credential_box=NULL,owner_xuid=NULL,updated_at=?
      WHERE id=1 AND generation=? AND status='authorizing' AND EXISTS(SELECT 1 FROM auth_attempts WHERE id=? AND status=? AND poll_owner=? AND poll_until>?)`)
      .bind(now, attempt.connection_generation, attempt.id, result.status, attempt.poll_owner, now));
  }
  statements.push(db.prepare("UPDATE auth_attempts SET poll_owner=NULL,poll_until=NULL WHERE id=? AND poll_owner=?").bind(attempt.id, attempt.poll_owner));
  const saved = await db.batch(statements);
  return saved[0].results.length === 1;
}

export async function disconnect(db: D1Database, expectedGeneration: number, now: number) {
  const results = await db.batch([
    db.prepare(`UPDATE realm_connections SET generation=generation+1,status='disconnected',owner_xuid=NULL,credential_box=NULL,refresh_owner=NULL,refresh_until=NULL,last_verified_at=NULL,last_error_code=NULL,updated_at=? WHERE id=1 AND generation=? RETURNING generation`).bind(now, expectedGeneration),
    db.prepare("UPDATE auth_attempts SET status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END,encrypted_state=NULL,poll_owner=NULL,poll_until=NULL WHERE connection_generation<=?").bind(expectedGeneration),
    db.prepare("UPDATE world_slots SET published=0,publication_version=publication_version+1,updated_at=? WHERE connection_generation<=?").bind(now, expectedGeneration),
    db.prepare("UPDATE download_jobs SET state=CASE WHEN state IN ('preparing','ready','redeeming') THEN 'invalidated' ELSE state END,encrypted_descriptor=NULL,step_owner=NULL,step_until=NULL WHERE connection_generation<=?").bind(expectedGeneration),
    db.prepare("DELETE FROM download_tickets WHERE connection_generation<=?").bind(expectedGeneration),
    db.prepare("INSERT INTO audit_events(id,created_at,category,actor,result,correlation_id) VALUES(?,?,'disconnect','admin','completed',?)").bind(crypto.randomUUID(), now, crypto.randomUUID()),
  ]);
  if (!results[0].results.length) throw new AppError("conflict", 409);
}

export async function claimRefresh(db: D1Database, expected: ConnectionRow, owner: string, now: number) {
  return db.prepare(`UPDATE realm_connections SET refresh_owner=?,refresh_until=? WHERE id=1 AND status='connected'
    AND generation=? AND token_version=? AND (refresh_until IS NULL OR refresh_until<=?) RETURNING *`)
    .bind(owner, now + 30000, expected.generation, expected.token_version, now).first<ConnectionRow>();
}

export async function saveRefresh(db: D1Database, previous: ConnectionRow, box: string | null, status: "connected" | "reauth_required", now: number) {
  return db.prepare(`UPDATE realm_connections SET credential_box=?,status=?,token_version=token_version+1,refresh_owner=NULL,refresh_until=NULL,
    last_error_code=?,updated_at=? WHERE id=1 AND generation=? AND token_version=? AND refresh_owner=? AND refresh_until>? AND status='connected' RETURNING token_version`)
    .bind(box, status, status === "reauth_required" ? "reauth_required" : null, now, previous.generation, previous.token_version, previous.refresh_owner, now).first();
}
