-- Owners and their events; a comment with a ; in it must not split a statement.
CREATE TABLE `owners` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL
);
/* A block comment; also stripped. */
CREATE TABLE `events` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `owner_id` text NOT NULL REFERENCES `owners`(`id`) ON DELETE CASCADE,
  `live` integer NOT NULL DEFAULT 0,
  `label` text NOT NULL
);
