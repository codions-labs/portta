CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`issuer` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_issuer_account_id_idx` ON `accounts` (`issuer`,`account_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`prefix` text,
	`key` text NOT NULL,
	`reference_id` text NOT NULL,
	`enabled` integer DEFAULT true,
	`expires_at` integer,
	`last_request` integer,
	`request_count` integer DEFAULT 0,
	`remaining` integer,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`rate_limit_enabled` integer DEFAULT false,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`permissions` text,
	`metadata` text,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`reference_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `api_keys_reference_idx` ON `api_keys` (`reference_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`impersonated_by` text,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `two_factors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`verified` integer DEFAULT false,
	`failed_verification_count` integer DEFAULT 0,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'viewer' NOT NULL,
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer,
	`two_factor_enabled` integer DEFAULT false,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" IS NULL OR "users"."role" IN ('owner', 'admin', 'developer', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_single_owner` ON `users` (`role`) WHERE "users"."role" = 'owner';--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`granted_by` text,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_members_user_idx` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `instance` (
	`id` text PRIMARY KEY NOT NULL,
	`singleton` integer DEFAULT true NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	CONSTRAINT "instance_singleton_check" CHECK("instance"."singleton" = 1),
	CONSTRAINT "instance_name_check" CHECK(trim("instance"."name") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instance_singleton_unique` ON `instance` (`singleton`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	CONSTRAINT "settings_key_check" CHECK(trim("settings"."key") <> '')
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`archived` integer DEFAULT false NOT NULL,
	`task_provider` text,
	`linear_team` text,
	`relative_path` text,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	CONSTRAINT "projects_task_provider_check" CHECK("projects"."task_provider" IS NULL OR "projects"."task_provider" IN ('github', 'linear')),
	CONSTRAINT "projects_slug_check" CHECK(trim("projects"."slug") <> ''),
	CONSTRAINT "projects_linear_team_check" CHECK("projects"."linear_team" IS NULL OR ("projects"."linear_team" GLOB '[A-Z]*' AND length("projects"."linear_team") BETWEEN 1 AND 10)),
	CONSTRAINT "projects_name_check" CHECK(trim("projects"."name") <> ''),
	CONSTRAINT "projects_relative_path_check" CHECK("projects"."relative_path" IS NULL OR (trim("projects"."relative_path") <> '' AND "projects"."relative_path" NOT LIKE '/%' AND "projects"."relative_path" NOT LIKE '%..%' AND "projects"."relative_path" NOT LIKE '%/%'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_relative_path_unique` ON `projects` (`relative_path`) WHERE "projects"."relative_path" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`local_path` text,
	`relative_path` text,
	`remote_url` text,
	`provider` text DEFAULT 'local' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "repositories_provider_check" CHECK("repositories"."provider" IS NULL OR "repositories"."provider" IN ('local', 'github', 'gitlab', 'bitbucket', 'other')),
	CONSTRAINT "repositories_name_check" CHECK(trim("repositories"."name") <> ''),
	CONSTRAINT "repositories_local_path_check" CHECK("repositories"."local_path" IS NULL OR ("repositories"."local_path" LIKE '/%' AND "repositories"."local_path" NOT LIKE '%/../%' AND "repositories"."local_path" NOT LIKE '%/..')),
	CONSTRAINT "repositories_relative_path_check" CHECK("repositories"."relative_path" IS NULL OR (trim("repositories"."relative_path") <> '' AND "repositories"."relative_path" NOT LIKE '/%' AND "repositories"."relative_path" NOT LIKE '%..%'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_local_path_unique` ON `repositories` (`local_path`) WHERE "repositories"."local_path" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `repositories_project_idx` ON `repositories` (`project_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_project_id_name_key` ON `repositories` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `environment_issues` (
	`environment_id` integer PRIMARY KEY NOT NULL,
	`issue_ref` text NOT NULL,
	`source` text NOT NULL,
	`branch` text,
	`linked_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "environment_issues_source_check" CHECK("environment_issues"."source" IS NULL OR "environment_issues"."source" IN ('manual', 'label', 'branch', 'namespace')),
	CONSTRAINT "environment_issues_ref_check" CHECK(trim("environment_issues"."issue_ref") <> '' AND instr("environment_issues"."issue_ref", ':') > 1)
);
--> statement-breakpoint
CREATE INDEX `environment_issues_ref_idx` ON `environment_issues` (`issue_ref`);--> statement-breakpoint
CREATE TABLE `environment_settings` (
	`environment_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	PRIMARY KEY(`environment_id`, `key`),
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "environment_settings_key_check" CHECK(trim("environment_settings"."key") <> '')
);
--> statement-breakpoint
CREATE TABLE `environments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`compose_project` text NOT NULL,
	`working_dir` text,
	`config_files` text DEFAULT ('[]') NOT NULL,
	`repo_url` text,
	`repo_subpath` text,
	`first_seen_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`last_seen_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	CONSTRAINT "environments_compose_project_check" CHECK(trim("environments"."compose_project") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `environments_compose_project_unique` ON `environments` (`compose_project`);--> statement-breakpoint
CREATE INDEX `environments_last_seen_idx` ON `environments` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `environments_repo_coordinate_idx` ON `environments` (`repo_url`,`repo_subpath`) WHERE "environments"."repo_url" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `project_environments` (
	`project_id` integer NOT NULL,
	`environment_id` integer NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`project_id`, `environment_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_environments_source_check" CHECK("project_environments"."source" IS NULL OR "project_environments"."source" IN ('manual', 'label', 'repo-match', 'path'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_environments_one_project_per_env` ON `project_environments` (`environment_id`);--> statement-breakpoint
CREATE TABLE `service_settings` (
	`environment_id` integer NOT NULL,
	`service` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	PRIMARY KEY(`environment_id`, `service`, `key`),
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "service_settings_service_check" CHECK(trim("service_settings"."service") <> ''),
	CONSTRAINT "service_settings_key_check" CHECK(trim("service_settings"."key") <> '')
);
--> statement-breakpoint
CREATE TABLE `activity_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`kind` text NOT NULL,
	`actor` text,
	`actor_kind` text,
	`user_id` text,
	`source` text,
	`project_id` integer,
	`issue_ref` text,
	`repository_id` integer,
	`environment_id` integer,
	`session_id` integer,
	`summary` text NOT NULL,
	`data` text DEFAULT ('{}') NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "activity_events_actor_kind_check" CHECK("activity_events"."actor_kind" IS NULL OR "activity_events"."actor_kind" IN ('human', 'agent', 'system')),
	CONSTRAINT "activity_events_source_check" CHECK("activity_events"."source" IS NULL OR "activity_events"."source" IN ('web', 'cli', 'mcp', 'api', 'github', 'system')),
	CONSTRAINT "activity_events_kind_check" CHECK(trim("activity_events"."kind") <> '')
);
--> statement-breakpoint
CREATE INDEX `activity_events_project_at_idx` ON `activity_events` (`project_id`,`at`);--> statement-breakpoint
CREATE INDEX `activity_events_at_idx` ON `activity_events` (`at`);--> statement-breakpoint
CREATE INDEX `activity_events_issue_idx` ON `activity_events` (`issue_ref`,`at`) WHERE "activity_events"."issue_ref" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `work_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`issue_ref` text,
	`repository_id` integer,
	`environment_id` integer,
	`actor` text NOT NULL,
	`actor_kind` text NOT NULL,
	`user_id` text,
	`agent` text,
	`status` text DEFAULT 'active' NOT NULL,
	`started_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`last_activity_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`ended_at` integer,
	`summary` text,
	`head_before` text,
	`head_after` text,
	`commits` text DEFAULT ('[]') NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "work_sessions_actor_kind_check" CHECK("work_sessions"."actor_kind" IS NULL OR "work_sessions"."actor_kind" IN ('human', 'agent')),
	CONSTRAINT "work_sessions_status_check" CHECK("work_sessions"."status" IS NULL OR "work_sessions"."status" IN ('active', 'ended', 'abandoned')),
	CONSTRAINT "work_sessions_actor_check" CHECK(trim("work_sessions"."actor") <> '')
);
--> statement-breakpoint
CREATE INDEX `work_sessions_project_status_idx` ON `work_sessions` (`project_id`,`status`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `work_sessions_issue_idx` ON `work_sessions` (`issue_ref`) WHERE "work_sessions"."issue_ref" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`user_id` text,
	`user_email` text,
	`principal_kind` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`resource_name` text,
	`project_id` integer,
	`ip_address` text,
	`metadata` text DEFAULT ('{}') NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "audit_log_principal_kind_check" CHECK("audit_log"."principal_kind" IS NULL OR "audit_log"."principal_kind" IN ('local', 'user', 'token'))
);
--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_log_user_at_idx` ON `audit_log` (`user_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_log_project_at_idx` ON `audit_log` (`project_id`,`at`);--> statement-breakpoint
CREATE TABLE `ssh_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`algorithm` text NOT NULL,
	`bits` integer,
	`fingerprint` text NOT NULL,
	`public_key` text NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instance`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ssh_keys_name_check" CHECK(trim("ssh_keys"."name") <> ''),
	CONSTRAINT "ssh_keys_algorithm_check" CHECK("ssh_keys"."algorithm" IN ('ed25519', 'rsa')),
	CONSTRAINT "ssh_keys_bits_check" CHECK("ssh_keys"."bits" IS NULL OR "ssh_keys"."bits" >= 2048),
	CONSTRAINT "ssh_keys_origin_check" CHECK("ssh_keys"."origin" IN ('generated', 'imported')),
	CONSTRAINT "ssh_keys_fingerprint_check" CHECK(trim("ssh_keys"."fingerprint") <> ''),
	CONSTRAINT "ssh_keys_public_key_check" CHECK(trim("ssh_keys"."public_key") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ssh_keys_instance_name_unique` ON `ssh_keys` (`instance_id`,`name`);