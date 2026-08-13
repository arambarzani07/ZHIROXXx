CREATE TABLE `pos_sync_changes` (
	`tenant_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`store_name` text NOT NULL,
	`record_id` text NOT NULL,
	`operation` text DEFAULT 'upsert' NOT NULL,
	`payload_json` text NOT NULL,
	`digest` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `mutation_id`, `store_name`, `record_id`)
);
--> statement-breakpoint
CREATE INDEX `pos_sync_changes_record_idx` ON `pos_sync_changes` (`tenant_id`,`store_name`,`record_id`);--> statement-breakpoint
CREATE TABLE `pos_sync_mutations` (
	`tenant_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`base_revision` integer NOT NULL,
	`revision` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`device_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	PRIMARY KEY(`tenant_id`, `mutation_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pos_sync_mutations_revision_unique` ON `pos_sync_mutations` (`tenant_id`,`revision`);--> statement-breakpoint
CREATE INDEX `pos_sync_mutations_status_revision_idx` ON `pos_sync_mutations` (`tenant_id`,`status`,`revision`);