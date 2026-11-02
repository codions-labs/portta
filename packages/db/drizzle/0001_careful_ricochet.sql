CREATE TABLE `project_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`key` text DEFAULT '' NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_tags_value_check" CHECK(trim("project_tags"."value") <> ''),
	CONSTRAINT "project_tags_key_check" CHECK("project_tags"."key" = trim("project_tags"."key") AND "project_tags"."key" NOT LIKE '%:%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_tags_unique` ON `project_tags` (`project_id`,`key`,`value`);