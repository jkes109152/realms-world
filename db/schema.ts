// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

export const adminAccounts = sqliteTable("admin_accounts", {
  id: integer("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  credentialVersion: integer("credential_version").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  check("admin_singleton", sql`${t.id} = 1`),
  check("admin_username", sql`length(${t.username}) BETWEEN 2 AND 64 AND ${t.username} NOT GLOB '*[^a-z0-9_.-]*'`),
  check("admin_version", sql`typeof(${t.credentialVersion}) = 'integer' AND ${t.credentialVersion} > 0`),
]);

export const adminSessions = sqliteTable("admin_sessions", {
  tokenDigest: text("token_digest").primaryKey().notNull(),
  adminId: integer("admin_id").notNull().references(() => adminAccounts.id, { onDelete: "cascade" }),
  credentialVersion: integer("credential_version").notNull(),
  csrfDigest: text("csrf_digest").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [
  check("session_admin", sql`${t.adminId} = 1`),
  check("session_version", sql`${t.credentialVersion} > 0`),
  check("session_digest", sql`length(${t.tokenDigest}) = 64 AND length(${t.csrfDigest}) = 64`),
  check("session_lifetime", sql`${t.expiresAt} = ${t.createdAt} + 43200000 AND ${t.lastSeenAt} >= ${t.createdAt}`),
  index("session_expiry").on(t.expiresAt),
  index("session_idle").on(t.lastSeenAt),
  index("session_admin_version").on(t.adminId, t.credentialVersion),
]);

export const maintenanceOperations = sqliteTable("maintenance_operations", {
  operationDigest: text("operation_digest").primaryKey().notNull(),
  action: text("action", { enum: ["bootstrap", "reset"] }).notNull(),
  performedAt: integer("performed_at").notNull(),
  guardPassed: integer("guard_passed").notNull(),
}, (t) => [
  check("maintenance_guard", sql`${t.guardPassed} = 1`),
  check("maintenance_action", sql`${t.action} IN ('bootstrap','reset')`),
  check("maintenance_digest", sql`length(${t.operationDigest}) = 64`),
]);

export const realmConnections = sqliteTable("realm_connections", {
  id: integer("id").primaryKey(),
  generation: integer("generation").notNull().default(0),
  status: text("status", { enum: ["disconnected", "authorizing", "connected", "reauth_required"] }).notNull().default("disconnected"),
  ownerXuid: text("owner_xuid"),
  credentialBox: text("credential_box"),
  tokenVersion: integer("token_version").notNull().default(0),
  refreshOwner: text("refresh_owner"),
  refreshUntil: integer("refresh_until"),
  lastVerifiedAt: integer("last_verified_at"),
  lastErrorCode: text("last_error_code"),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  check("connection_singleton", sql`${t.id} = 1`),
  check("connection_versions", sql`typeof(${t.generation}) = 'integer' AND ${t.generation} >= 0 AND ${t.tokenVersion} >= 0`),
  check("connection_status", sql`${t.status} IN ('disconnected','authorizing','connected','reauth_required')`),
  check("connection_lease", sql`(${t.refreshOwner} IS NULL) = (${t.refreshUntil} IS NULL)`),
  check("connection_disconnected", sql`${t.status} != 'disconnected' OR (${t.ownerXuid} IS NULL AND ${t.credentialBox} IS NULL)`),
]);

export const authAttempts = sqliteTable("auth_attempts", {
  id: text("id").primaryKey().notNull(),
  adminSessionDigest: text("admin_session_digest").notNull().references(() => adminSessions.tokenDigest, { onDelete: "cascade" }),
  credentialVersion: integer("credential_version").notNull(),
  connectionGeneration: integer("connection_generation").notNull(),
  status: text("status").notNull().default("pending"),
  stage: text("stage").notNull().default("requesting_code"),
  encryptedState: text("encrypted_state"),
  expiresAt: integer("expires_at").notNull(),
  nextPollAt: integer("next_poll_at").notNull(),
  pollOwner: text("poll_owner"),
  pollUntil: integer("poll_until"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  check("auth_status", sql`${t.status} IN ('pending','authorized','cancelled','denied','expired','failed')`),
  check("auth_stage", sql`${t.stage} IN ('requesting_code','waiting_for_user','exchanging_tokens')`),
  check("auth_lease", sql`(${t.pollOwner} IS NULL) = (${t.pollUntil} IS NULL)`),
  check("auth_terminal_secret", sql`${t.status} = 'pending' OR ${t.encryptedState} IS NULL`),
  index("auth_expiry").on(t.expiresAt),
  index("auth_session").on(t.adminSessionDigest),
  index("auth_generation_status").on(t.connectionGeneration, t.status),
]);

export const realms = sqliteTable("realms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceRealmId: text("source_realm_id").notNull(),
  connectionId: integer("connection_id").notNull().references(() => realmConnections.id),
  connectionGeneration: integer("connection_generation").notNull(),
  verifiedOwnerXuid: text("verified_owner_xuid").notNull(),
  sourceName: text("source_name").notNull(),
  availability: text("availability").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
}, (t) => [
  check("realm_connection", sql`${t.connectionId} = 1`),
  check("realm_availability", sql`${t.availability} IN ('available','unavailable','unknown')`),
  uniqueIndex("realm_generation_source").on(t.connectionGeneration, t.sourceRealmId),
]);

export const worldSlots = sqliteTable("world_slots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("public_id").notNull().unique(),
  realmId: integer("realm_id").notNull().references(() => realms.id),
  sourceSlotId: text("source_slot_id").notNull(),
  connectionGeneration: integer("connection_generation").notNull(),
  sourceIdentity: text("source_identity"),
  associationStatus: text("association_status").notNull().default("unverifiable"),
  displayName: text("display_name").notNull(),
  description: text("description").notNull().default(""),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  publicationVersion: integer("publication_version").notNull().default(0),
  fetchedAt: integer("fetched_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  uniqueIndex("world_realm_slot").on(t.realmId, t.sourceSlotId),
  check("world_association", sql`${t.associationStatus} IN ('verified','empty','unverifiable','unavailable')`),
  check("world_text", sql`length(${t.displayName}) BETWEEN 1 AND 100 AND length(${t.description}) <= 2000`),
  check("world_published", sql`${t.published} IN (0,1)`),
  check("world_publishable", sql`${t.published} = 0 OR (${t.associationStatus} = 'verified' AND ${t.sourceIdentity} IS NOT NULL)`),
  check("world_version", sql`${t.publicationVersion} >= 0`),
  index("world_publication_generation").on(t.published, t.connectionGeneration),
]);

export const downloadJobs = sqliteTable("download_jobs", {
  id: text("id").primaryKey().notNull(),
  statusSecretDigest: text("status_secret_digest").notNull(),
  worldSlotId: integer("world_slot_id").notNull().references(() => worldSlots.id),
  connectionGeneration: integer("connection_generation").notNull(),
  publicationVersion: integer("publication_version").notNull(),
  selectorKind: text("selector_kind").notNull(),
  sourceBackupId: text("source_backup_id"),
  associationEvidence: text("association_evidence").notNull(),
  state: text("state").notNull().default("preparing"),
  stage: text("stage").notNull().default("authorizing"),
  encryptedDescriptor: text("encrypted_descriptor"),
  prepareAttempts: integer("prepare_attempts").notNull().default(0),
  prepareAuthRetryUsed: integer("prepare_auth_retry_used", { mode: "boolean" }).notNull().default(false),
  nextPollAt: integer("next_poll_at").notNull(),
  stepOwner: text("step_owner"),
  stepUntil: integer("step_until"),
  expiresAt: integer("expires_at").notNull(),
  statusExpiresAt: integer("status_expires_at").notNull(),
  safeErrorCode: text("safe_error_code"),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  check("job_selector", sql`(${t.selectorKind} = 'latest' AND ${t.sourceBackupId} IS NULL) OR (${t.selectorKind} = 'backup' AND ${t.sourceBackupId} IS NOT NULL)`),
  check("job_state", sql`${t.state} IN ('preparing','ready','redeeming','streaming','transfer_ended','transfer_failed','failed','expired','invalidated')`),
  check("job_prepare_attempts", sql`typeof(${t.prepareAttempts}) = 'integer' AND ${t.prepareAttempts} BETWEEN 0 AND 20`),
  check("job_auth_retry", sql`${t.prepareAuthRetryUsed} IN (0,1)`),
  check("job_digest", sql`length(${t.statusSecretDigest}) = 64`),
  check("job_lifetimes", sql`${t.expiresAt} = ${t.createdAt} + 600000 AND ${t.statusExpiresAt} = ${t.createdAt} + 2592000000`),
  check("job_lease", sql`(${t.stepOwner} IS NULL) = (${t.stepUntil} IS NULL)`),
  index("job_expiry").on(t.expiresAt),
  index("job_status_expiry").on(t.statusExpiresAt),
  index("job_state_lease").on(t.state, t.stepUntil),
  index("job_world_generation").on(t.worldSlotId, t.connectionGeneration, t.publicationVersion),
]);

export const downloadTickets = sqliteTable("download_tickets", {
  ticketDigest: text("ticket_digest").primaryKey().notNull(),
  jobId: text("job_id").notNull().unique().references(() => downloadJobs.id, { onDelete: "cascade" }),
  connectionGeneration: integer("connection_generation").notNull(),
  publicationVersion: integer("publication_version").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
}, (t) => [
  check("ticket_digest", sql`length(${t.ticketDigest}) = 64`),
  index("ticket_expiry").on(t.expiresAt),
]);

export const downloadAttempts = sqliteTable("download_attempts", {
  id: text("id").primaryKey().notNull(),
  jobId: text("job_id").notNull().unique().references(() => downloadJobs.id, { onDelete: "restrict" }),
  worldPublicId: text("world_public_id").notNull(),
  worldDisplayName: text("world_display_name").notNull(),
  archiveLabel: text("archive_label").notNull(),
  requestedAt: integer("requested_at").notNull(),
  streamStartedAt: integer("stream_started_at"),
  observedEndAt: integer("observed_end_at"),
  observedBytes: text("observed_bytes").notNull().default("0"),
  outcome: text("outcome").notNull().default("unknown"),
  safeErrorCode: text("safe_error_code"),
}, (t) => [
  check("attempt_outcome", sql`${t.outcome} IN ('unknown','transfer_ended','transfer_failed')`),
  check("attempt_bytes", sql`length(${t.observedBytes}) > 0 AND ${t.observedBytes} NOT GLOB '*[^0-9]*'`),
  index("attempt_time").on(t.requestedAt),
  index("attempt_world_time").on(t.worldPublicId, t.requestedAt),
]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey().notNull(),
  createdAt: integer("created_at").notNull(),
  category: text("category").notNull(),
  actor: text("actor").notNull(),
  worldPublicId: text("world_public_id"),
  archiveLabel: text("archive_label"),
  result: text("result").notNull(),
  safeErrorCode: text("safe_error_code"),
  correlationId: text("correlation_id").notNull(),
}, (t) => [index("audit_time").on(t.createdAt), index("audit_world_time").on(t.worldPublicId, t.createdAt)]);

export const rateLimitWindows = sqliteTable("rate_limit_windows", {
  scope: text("scope").notNull(), keyDigest: text("key_digest").notNull(), windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(), expiresAt: integer("expires_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.scope, t.keyDigest, t.windowStart] }),
  check("rate_count", sql`typeof(${t.count}) = 'integer' AND ${t.count} > 0`),
  index("rate_expiry").on(t.expiresAt),
]);

export const maintenanceState = sqliteTable("maintenance_state", {
  id: integer("id").primaryKey(), owner: text("owner"), expiresAt: integer("expires_at").notNull().default(0),
}, (t) => [check("cleanup_singleton", sql`${t.id} = 1`)]);
