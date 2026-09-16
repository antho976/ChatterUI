CREATE TABLE `chat_preset_links` (
	`preset_id` integer NOT NULL,
	`chat_id` integer NOT NULL,
	PRIMARY KEY(`preset_id`, `chat_id`),
	FOREIGN KEY (`preset_id`) REFERENCES `chat_presets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_chat_id` integer NOT NULL,
	`name` text DEFAULT 'New Preset' NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`persona` text DEFAULT '' NOT NULL,
	`rules` text DEFAULT '' NOT NULL,
	`create_date` integer NOT NULL,
	FOREIGN KEY (`owner_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `chats` ADD `background_image` integer;--> statement-breakpoint
ALTER TABLE `chats` ADD `active_preset_id` integer;