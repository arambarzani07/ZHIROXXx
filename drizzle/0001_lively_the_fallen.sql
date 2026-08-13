CREATE TABLE `pos_devices` (
	`tenant_id` text NOT NULL,
	`device_id` text NOT NULL,
	`label` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`app_version` integer NOT NULL,
	`last_revision` integer DEFAULT 0 NOT NULL,
	`pending_count` integer DEFAULT 0 NOT NULL,
	`conflict_count` integer DEFAULT 0 NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `device_id`)
);
--> statement-breakpoint
CREATE INDEX `pos_devices_seen_idx` ON `pos_devices` (`tenant_id`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `pos_restore_points` (
	`tenant_id` text NOT NULL,
	`day` text NOT NULL,
	`revision` integer NOT NULL,
	`record_count` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `day`)
);
--> statement-breakpoint
CREATE INDEX `pos_restore_points_revision_idx` ON `pos_restore_points` (`tenant_id`,`revision`);--> statement-breakpoint
CREATE TABLE `pos_staff` (
	`tenant_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `actor_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pos_staff_email_unique` ON `pos_staff` (`tenant_id`,`email`);