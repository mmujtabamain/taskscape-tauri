-- Create "projects" table
CREATE TABLE `projects` (
  `id` text NOT NULL,
  `name` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`id`)
);
-- Create "lists" table
CREATE TABLE `lists` (
  `id` text NOT NULL,
  `project_id` text NOT NULL,
  `name` text NOT NULL,
  `sort_order` real NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_lists_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
);
-- Create index "idx_lists_project" to table: "lists"
CREATE INDEX `idx_lists_project` ON `lists` (`project_id`);
-- Create "tasks" table
CREATE TABLE `tasks` (
  `id` text NOT NULL,
  `list_id` text NOT NULL,
  `parent_id` text NULL,
  `title` text NOT NULL,
  `notes` text NULL,
  `done` integer NOT NULL DEFAULT 0,
  `sort_order` real NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_tasks_list` FOREIGN KEY (`list_id`) REFERENCES `lists` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tasks_parent` FOREIGN KEY (`parent_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE
);
-- Create index "idx_tasks_list" to table: "tasks"
CREATE INDEX `idx_tasks_list` ON `tasks` (`list_id`);
-- Create index "idx_tasks_parent" to table: "tasks"
CREATE INDEX `idx_tasks_parent` ON `tasks` (`parent_id`);
-- Create "attachments" table
CREATE TABLE `attachments` (
  `id` text NOT NULL,
  `task_id` text NOT NULL,
  `name` text NOT NULL,
  `link_type` text NOT NULL,
  `location` text NOT NULL,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_attachments_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE
);
-- Create index "idx_attachments_task" to table: "attachments"
CREATE INDEX `idx_attachments_task` ON `attachments` (`task_id`);
-- Create "task_notes" table
CREATE TABLE `task_notes` (
  `id` text NOT NULL,
  `task_id` text NOT NULL,
  `content` text NOT NULL,
  `sort_order` real NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_task_notes_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE
);
-- Create index "idx_task_notes_task" to table: "task_notes"
CREATE INDEX `idx_task_notes_task` ON `task_notes` (`task_id`);
-- Create "settings" table
CREATE TABLE `settings` (
  `key` text NOT NULL,
  `value` text NOT NULL,
  PRIMARY KEY (`key`)
);
