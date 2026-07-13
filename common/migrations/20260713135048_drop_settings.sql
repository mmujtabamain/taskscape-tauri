-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Drop "settings" table
DROP TABLE `settings`;
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
