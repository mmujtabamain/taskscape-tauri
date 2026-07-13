// Desired schema — the single source of truth (the "models"). Hand-edit this,
// then `atlas migrate diff <name> --env local` autogenerates the SQL migration.
//
// Enforces the full "perfect" shape (referential integrity in the DB, no
// nullable ordering keys) since we start from an empty database — see
// .plans/orm-migration.md §6.

schema "main" {
}

table "projects" {
  schema = schema.main
  column "id" {
    null = false
    type = text
  }
  column "name" {
    null = false
    type = text
  }
  column "created_at" {
    null = false
    type = integer
  }
  column "updated_at" {
    null = false
    type = integer
  }
  primary_key {
    columns = [column.id]
  }
}

table "lists" {
  schema = schema.main
  column "id" {
    null = false
    type = text
  }
  column "project_id" {
    null = false
    type = text
  }
  column "name" {
    null = false
    type = text
  }
  column "sort_order" {
    null = false
    type = real
  }
  column "created_at" {
    null = false
    type = integer
  }
  column "updated_at" {
    null = false
    type = integer
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_lists_project" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_delete   = CASCADE
  }
  index "idx_lists_project" {
    columns = [column.project_id]
  }
}

table "tasks" {
  schema = schema.main
  column "id" {
    null = false
    type = text
  }
  column "list_id" {
    null = false
    type = text
  }
  column "parent_id" {
    null = true
    type = text
  }
  column "title" {
    null = false
    type = text
  }
  column "notes" {
    null = true
    type = text
  }
  column "done" {
    null    = false
    type    = integer
    default = 0
  }
  column "sort_order" {
    null = false
    type = real
  }
  column "created_at" {
    null = false
    type = integer
  }
  column "updated_at" {
    null = false
    type = integer
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_tasks_list" {
    columns     = [column.list_id]
    ref_columns = [table.lists.column.id]
    on_delete   = CASCADE
  }
  foreign_key "fk_tasks_parent" {
    columns     = [column.parent_id]
    ref_columns = [table.tasks.column.id]
    on_delete   = CASCADE
  }
  index "idx_tasks_list" {
    columns = [column.list_id]
  }
  index "idx_tasks_parent" {
    columns = [column.parent_id]
  }
}

table "attachments" {
  schema = schema.main
  column "id" {
    null = false
    type = text
  }
  column "task_id" {
    null = false
    type = text
  }
  column "name" {
    null = false
    type = text
  }
  column "link_type" {
    null = false
    type = text
  }
  column "location" {
    null = false
    type = text
  }
  column "created_at" {
    null = false
    type = integer
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_attachments_task" {
    columns     = [column.task_id]
    ref_columns = [table.tasks.column.id]
    on_delete   = CASCADE
  }
  index "idx_attachments_task" {
    columns = [column.task_id]
  }
}

table "task_notes" {
  schema = schema.main
  column "id" {
    null = false
    type = text
  }
  column "task_id" {
    null = false
    type = text
  }
  column "content" {
    null = false
    type = text
  }
  column "sort_order" {
    null = false
    type = real
  }
  column "created_at" {
    null = false
    type = integer
  }
  column "updated_at" {
    null = false
    type = integer
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_task_notes_task" {
    columns     = [column.task_id]
    ref_columns = [table.tasks.column.id]
    on_delete   = CASCADE
  }
  index "idx_task_notes_task" {
    columns = [column.task_id]
  }
}
