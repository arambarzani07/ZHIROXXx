CREATE TABLE `pos_market_memberships` (
	`market_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`market_id`, `actor_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pos_market_memberships_email_unique` ON `pos_market_memberships` (`market_id`,`email`);--> statement-breakpoint
CREATE INDEX `pos_market_memberships_actor_idx` ON `pos_market_memberships` (`actor_id`,`active`);--> statement-breakpoint
CREATE TABLE `pos_markets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'trial' NOT NULL,
	`owner_actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pos_markets_slug_unique` ON `pos_markets` (`slug`);--> statement-breakpoint
CREATE INDEX `pos_markets_owner_idx` ON `pos_markets` (`owner_actor_id`);