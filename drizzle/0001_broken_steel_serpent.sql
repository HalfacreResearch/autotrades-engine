CREATE TABLE `active_positions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`client_id` int NOT NULL,
	`pair` varchar(20) NOT NULL,
	`size_percent` decimal(5,2) NOT NULL,
	`entry_price` decimal(20,8) NOT NULL,
	`current_price` decimal(20,8),
	`unrealized_pnl_percent` decimal(10,4),
	`peak_pnl_percent` decimal(10,4),
	`trailing_stop_percent` decimal(5,2) DEFAULT '5.00',
	`trailing_stop_triggered` boolean NOT NULL DEFAULT false,
	`open_execution_id` varchar(36),
	`status` enum('open','closing','closed') NOT NULL DEFAULT 'open',
	`opened_at` timestamp NOT NULL DEFAULT (now()),
	`closed_at` timestamp,
	`exit_price` decimal(20,8),
	`realized_pnl_percent` decimal(10,4),
	CONSTRAINT `active_positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `client_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`client_name` varchar(255) NOT NULL,
	`client_email` varchar(320) NOT NULL,
	`sfox_api_key_encrypted` text,
	`sfox_api_key_iv` varchar(64),
	`sfox_api_key_auth_tag` varchar(64),
	`is_active` boolean NOT NULL DEFAULT true,
	`last_verified_at` timestamp,
	`connection_status` enum('connected','error','pending','unconfigured') NOT NULL DEFAULT 'unconfigured',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `client_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `client_connections_client_email_unique` UNIQUE(`client_email`)
);
--> statement-breakpoint
CREATE TABLE `execution_log` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`execution_id` varchar(36) NOT NULL,
	`client_id` int NOT NULL,
	`recommendation_id` varchar(36),
	`trade_type` enum('DCA_BUY','ROTATION_ENTRY','ROTATION_EXIT') NOT NULL,
	`pair` varchar(20) NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`position_size_percent` decimal(5,2) NOT NULL,
	`quantity` decimal(20,8),
	`execution_price` decimal(20,8),
	`usd_value` decimal(20,2),
	`sfox_order_id` varchar(64),
	`status` enum('pending','executed','failed','cancelled') NOT NULL DEFAULT 'pending',
	`is_test_account` boolean NOT NULL DEFAULT true,
	`error_message` text,
	`realized_pnl_btc` decimal(20,8),
	`realized_pnl_percent` decimal(10,4),
	`entry_price` decimal(20,8),
	`executed_by` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`executed_at` timestamp,
	CONSTRAINT `execution_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `execution_log_execution_id_unique` UNIQUE(`execution_id`)
);
--> statement-breakpoint
ALTER TABLE `active_positions` ADD CONSTRAINT `active_positions_client_id_client_connections_id_fk` FOREIGN KEY (`client_id`) REFERENCES `client_connections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `execution_log` ADD CONSTRAINT `execution_log_client_id_client_connections_id_fk` FOREIGN KEY (`client_id`) REFERENCES `client_connections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `execution_log` ADD CONSTRAINT `execution_log_executed_by_users_id_fk` FOREIGN KEY (`executed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_pos_client` ON `active_positions` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_pos_status` ON `active_positions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_pos_pair` ON `active_positions` (`pair`);--> statement-breakpoint
CREATE INDEX `idx_exec_client` ON `execution_log` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_exec_status` ON `execution_log` (`status`);--> statement-breakpoint
CREATE INDEX `idx_exec_type` ON `execution_log` (`trade_type`);--> statement-breakpoint
CREATE INDEX `idx_exec_created` ON `execution_log` (`createdAt`);