ALTER TABLE `chats` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `ghost` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `memory` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `instructs` ADD `use_card_system_prompt` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `instructs` ADD `use_post_history` integer DEFAULT true NOT NULL;