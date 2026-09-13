CREATE TABLE `admin_accounts` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`credential_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "admin_singleton" CHECK("admin_accounts"."id" = 1),
	CONSTRAINT "admin_username" CHECK(length("admin_accounts"."username") BETWEEN 2 AND 64 AND "admin_accounts"."username" NOT GLOB '*[^a-z0-9_.-]*'),
	CONSTRAINT "admin_version" CHECK(typeof("admin_accounts"."credential_version") = 'integer' AND "admin_accounts"."credential_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_accounts_username_unique` ON `admin_accounts` (`username`);--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`token_digest` text PRIMARY KEY NOT NULL,
	`admin_id` integer NOT NULL,
	`credential_version` integer NOT NULL,
	`csrf_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`admin_id`) REFERENCES `admin_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_admin" CHECK("admin_sessions"."admin_id" = 1),
	CONSTRAINT "session_version" CHECK("admin_sessions"."credential_version" > 0),
	CONSTRAINT "session_digest" CHECK(length("admin_sessions"."token_digest") = 64 AND length("admin_sessions"."csrf_digest") = 64),
	CONSTRAINT "session_lifetime" CHECK("admin_sessions"."expires_at" = "admin_sessions"."created_at" + 43200000 AND "admin_sessions"."last_seen_at" >= "admin_sessions"."created_at")
);
--> statement-breakpoint
CREATE INDEX `session_expiry` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `session_idle` ON `admin_sessions` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `session_admin_version` ON `admin_sessions` (`admin_id`,`credential_version`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`category` text NOT NULL,
	`actor` text NOT NULL,
	`world_public_id` text,
	`archive_label` text,
	`result` text NOT NULL,
	`safe_error_code` text,
	`correlation_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_time` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_world_time` ON `audit_events` (`world_public_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_session_digest` text NOT NULL,
	`credential_version` integer NOT NULL,
	`connection_generation` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stage` text DEFAULT 'requesting_code' NOT NULL,
	`encrypted_state` text,
	`expires_at` integer NOT NULL,
	`next_poll_at` integer NOT NULL,
	`poll_owner` text,
	`poll_until` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`admin_session_digest`) REFERENCES `admin_sessions`(`token_digest`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_status" CHECK("auth_attempts"."status" IN ('pending','authorized','cancelled','denied','expired','failed')),
	CONSTRAINT "auth_stage" CHECK("auth_attempts"."stage" IN ('requesting_code','waiting_for_user','exchanging_tokens')),
	CONSTRAINT "auth_lease" CHECK(("auth_attempts"."poll_owner" IS NULL) = ("auth_attempts"."poll_until" IS NULL)),
	CONSTRAINT "auth_terminal_secret" CHECK("auth_attempts"."status" = 'pending' OR "auth_attempts"."encrypted_state" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `auth_expiry` ON `auth_attempts` (`expires_at`);--> statement-breakpoint
CREATE INDEX `auth_session` ON `auth_attempts` (`admin_session_digest`);--> statement-breakpoint
CREATE INDEX `auth_generation_status` ON `auth_attempts` (`connection_generation`,`status`);--> statement-breakpoint
CREATE TABLE `download_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`world_public_id` text NOT NULL,
	`world_display_name` text NOT NULL,
	`archive_label` text NOT NULL,
	`requested_at` integer NOT NULL,
	`stream_started_at` integer,
	`observed_end_at` integer,
	`observed_bytes` text DEFAULT '0' NOT NULL,
	`outcome` text DEFAULT 'unknown' NOT NULL,
	`safe_error_code` text,
	FOREIGN KEY (`job_id`) REFERENCES `download_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attempt_outcome" CHECK("download_attempts"."outcome" IN ('unknown','transfer_ended','transfer_failed')),
	CONSTRAINT "attempt_bytes" CHECK(length("download_attempts"."observed_bytes") > 0 AND "download_attempts"."observed_bytes" NOT GLOB '*[^0-9]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `download_attempts_job_id_unique` ON `download_attempts` (`job_id`);--> statement-breakpoint
CREATE INDEX `attempt_time` ON `download_attempts` (`requested_at`);--> statement-breakpoint
CREATE INDEX `attempt_world_time` ON `download_attempts` (`world_public_id`,`requested_at`);--> statement-breakpoint
CREATE TABLE `download_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status_secret_digest` text NOT NULL,
	`world_slot_id` integer NOT NULL,
	`connection_generation` integer NOT NULL,
	`publication_version` integer NOT NULL,
	`selector_kind` text NOT NULL,
	`source_backup_id` text,
	`association_evidence` text NOT NULL,
	`state` text DEFAULT 'preparing' NOT NULL,
	`stage` text DEFAULT 'authorizing' NOT NULL,
	`encrypted_descriptor` text,
	`prepare_attempts` integer DEFAULT 0 NOT NULL,
	`prepare_auth_retry_used` integer DEFAULT false NOT NULL,
	`next_poll_at` integer NOT NULL,
	`step_owner` text,
	`step_until` integer,
	`expires_at` integer NOT NULL,
	`status_expires_at` integer NOT NULL,
	`safe_error_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_slot_id`) REFERENCES `world_slots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_selector" CHECK(("download_jobs"."selector_kind" = 'latest' AND "download_jobs"."source_backup_id" IS NULL) OR ("download_jobs"."selector_kind" = 'backup' AND "download_jobs"."source_backup_id" IS NOT NULL)),
	CONSTRAINT "job_state" CHECK("download_jobs"."state" IN ('preparing','ready','redeeming','streaming','transfer_ended','transfer_failed','failed','expired','invalidated')),
	CONSTRAINT "job_prepare_attempts" CHECK(typeof("download_jobs"."prepare_attempts") = 'integer' AND "download_jobs"."prepare_attempts" BETWEEN 0 AND 20),
	CONSTRAINT "job_auth_retry" CHECK("download_jobs"."prepare_auth_retry_used" IN (0,1)),
	CONSTRAINT "job_digest" CHECK(length("download_jobs"."status_secret_digest") = 64),
	CONSTRAINT "job_lifetimes" CHECK("download_jobs"."expires_at" = "download_jobs"."created_at" + 600000 AND "download_jobs"."status_expires_at" = "download_jobs"."created_at" + 2592000000),
	CONSTRAINT "job_lease" CHECK(("download_jobs"."step_owner" IS NULL) = ("download_jobs"."step_until" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `job_expiry` ON `download_jobs` (`expires_at`);--> statement-breakpoint
CREATE INDEX `job_status_expiry` ON `download_jobs` (`status_expires_at`);--> statement-breakpoint
CREATE INDEX `job_state_lease` ON `download_jobs` (`state`,`step_until`);--> statement-breakpoint
CREATE INDEX `job_world_generation` ON `download_jobs` (`world_slot_id`,`connection_generation`,`publication_version`);--> statement-breakpoint
CREATE TABLE `download_tickets` (
	`ticket_digest` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`connection_generation` integer NOT NULL,
	`publication_version` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `download_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ticket_digest" CHECK(length("download_tickets"."ticket_digest") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `download_tickets_job_id_unique` ON `download_tickets` (`job_id`);--> statement-breakpoint
CREATE INDEX `ticket_expiry` ON `download_tickets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `maintenance_operations` (
	`operation_digest` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`performed_at` integer NOT NULL,
	`guard_passed` integer NOT NULL,
	CONSTRAINT "maintenance_guard" CHECK("maintenance_operations"."guard_passed" = 1),
	CONSTRAINT "maintenance_action" CHECK("maintenance_operations"."action" IN ('bootstrap','reset')),
	CONSTRAINT "maintenance_digest" CHECK(length("maintenance_operations"."operation_digest") = 64)
);
--> statement-breakpoint
CREATE TABLE `maintenance_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner` text,
	`expires_at` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cleanup_singleton" CHECK("maintenance_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `rate_limit_windows` (
	`scope` text NOT NULL,
	`key_digest` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key_digest`, `window_start`),
	CONSTRAINT "rate_count" CHECK(typeof("rate_limit_windows"."count") = 'integer' AND "rate_limit_windows"."count" > 0)
);
--> statement-breakpoint
CREATE INDEX `rate_expiry` ON `rate_limit_windows` (`expires_at`);--> statement-breakpoint
CREATE TABLE `realm_connections` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`owner_xuid` text,
	`credential_box` text,
	`token_version` integer DEFAULT 0 NOT NULL,
	`refresh_owner` text,
	`refresh_until` integer,
	`last_verified_at` integer,
	`last_error_code` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "connection_singleton" CHECK("realm_connections"."id" = 1),
	CONSTRAINT "connection_versions" CHECK(typeof("realm_connections"."generation") = 'integer' AND "realm_connections"."generation" >= 0 AND "realm_connections"."token_version" >= 0),
	CONSTRAINT "connection_status" CHECK("realm_connections"."status" IN ('disconnected','authorizing','connected','reauth_required')),
	CONSTRAINT "connection_lease" CHECK(("realm_connections"."refresh_owner" IS NULL) = ("realm_connections"."refresh_until" IS NULL)),
	CONSTRAINT "connection_disconnected" CHECK("realm_connections"."status" != 'disconnected' OR ("realm_connections"."owner_xuid" IS NULL AND "realm_connections"."credential_box" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `realms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_realm_id` text NOT NULL,
	`connection_id` integer NOT NULL,
	`connection_generation` integer NOT NULL,
	`verified_owner_xuid` text NOT NULL,
	`source_name` text NOT NULL,
	`availability` text NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `realm_connections`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "realm_connection" CHECK("realms"."connection_id" = 1),
	CONSTRAINT "realm_availability" CHECK("realms"."availability" IN ('available','unavailable','unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `realm_generation_source` ON `realms` (`connection_generation`,`source_realm_id`);--> statement-breakpoint
CREATE TABLE `world_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`realm_id` integer NOT NULL,
	`source_slot_id` text NOT NULL,
	`connection_generation` integer NOT NULL,
	`source_identity` text,
	`association_status` text DEFAULT 'unverifiable' NOT NULL,
	`display_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`publication_version` integer DEFAULT 0 NOT NULL,
	`fetched_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`realm_id`) REFERENCES `realms`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "world_association" CHECK("world_slots"."association_status" IN ('verified','empty','unverifiable','unavailable')),
	CONSTRAINT "world_text" CHECK(length("world_slots"."display_name") BETWEEN 1 AND 100 AND length("world_slots"."description") <= 2000),
	CONSTRAINT "world_published" CHECK("world_slots"."published" IN (0,1)),
	CONSTRAINT "world_publishable" CHECK("world_slots"."published" = 0 OR ("world_slots"."association_status" = 'verified' AND "world_slots"."source_identity" IS NOT NULL)),
	CONSTRAINT "world_version" CHECK("world_slots"."publication_version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `world_slots_public_id_unique` ON `world_slots` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `world_realm_slot` ON `world_slots` (`realm_id`,`source_slot_id`);--> statement-breakpoint
CREATE INDEX `world_publication_generation` ON `world_slots` (`published`,`connection_generation`);