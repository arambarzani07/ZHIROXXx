CREATE TABLE `pos_manager_permissions` (
	`market_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`permission` text NOT NULL,
	`granted_by_actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`market_id`, `actor_id`, `permission`)
);
--> statement-breakpoint
CREATE INDEX `pos_manager_permissions_actor_idx` ON `pos_manager_permissions` (`actor_id`,`market_id`);