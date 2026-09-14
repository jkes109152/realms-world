import { AppError } from "@/lib/security/errors";
import { validatePasswordHash } from "./password";

export type MaintenanceInput = { action: "bootstrap" | "reset"; username: string; passwordHash: string; expectedCredentialVersion: number | null };

export async function maintainAdmin(db: D1Database, operationDigest: string, input: MaintenanceInput, now: number) {
  if (!/^[a-f0-9]{64}$/.test(operationDigest) || typeof input.username !== "string" || !/^[a-z0-9_.-]{2,64}$/.test(input.username) ||
      !["bootstrap", "reset"].includes(input.action) ||
      (input.action === "bootstrap" ? input.expectedCredentialVersion !== null : !Number.isSafeInteger(input.expectedCredentialVersion) || input.expectedCredentialVersion! < 1)) throw new AppError("invalid_request");
  validatePasswordHash(input.passwordHash);
  const bootstrap = input.action === "bootstrap";
  const version = bootstrap ? 1 : input.expectedCredentialVersion! + 1;
  const guard = bootstrap ? "NOT EXISTS (SELECT 1 FROM admin_accounts WHERE id=1)"
    : "EXISTS (SELECT 1 FROM admin_accounts WHERE id=1 AND credential_version=?)";
  const first = db.prepare(`INSERT INTO maintenance_operations(operation_digest,action,performed_at,guard_passed)
    VALUES(?,?,?,CASE WHEN ${guard} THEN 1 ELSE 0 END)`);
  const statements = [bootstrap ? first.bind(operationDigest, input.action, now) : first.bind(operationDigest, input.action, now, input.expectedCredentialVersion)];
  statements.push(bootstrap
    ? db.prepare("INSERT INTO admin_accounts(id,username,password_hash,credential_version,created_at,updated_at) VALUES(1,?,?,1,?,?)").bind(input.username, input.passwordHash, now, now)
    : db.prepare("UPDATE admin_accounts SET username=?,password_hash=?,credential_version=credential_version+1,updated_at=? WHERE id=1 AND credential_version=?").bind(input.username, input.passwordHash, now, input.expectedCredentialVersion));
  if (!bootstrap) statements.push(db.prepare("DELETE FROM admin_sessions WHERE admin_id=1"));
  statements.push(db.prepare("INSERT INTO audit_events(id,created_at,category,actor,result,correlation_id) VALUES(?,?,'account_maintenance','maintenance','success',?)").bind(crypto.randomUUID(), now, crypto.randomUUID()));
  try {
    const results = await db.batch(statements);
    if (results.some((r) => !r.success)) throw new Error("uncertain_commit");
  } catch (error) {
    if (error instanceof Error && /constraint/i.test(error.message)) throw new AppError("conflict", 409);
    // 結果不明只讀取此操作的持久證據；不重播寫入。
    try {
      const committed = await db.prepare("SELECT action,performed_at FROM maintenance_operations WHERE operation_digest=?").bind(operationDigest).first<{action:string;performed_at:number}>();
      if (committed?.action === input.action && committed.performed_at === now) return { action: input.action, credentialVersion: version };
    } catch { /* 保持結果不明，由操作者查版本後處理。 */ }
    throw new AppError("database_unavailable", 503);
  }
  return { action: input.action, credentialVersion: version };
}
