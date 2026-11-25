-- Adds organization visibility (Google Workspace domain from the verified `hd`
-- ID-token claim) and makes "public" mean "anyone, without signing in".
--
-- Safety: before this migration "public" meant "any signed-in user". To avoid
-- exposing existing solutions to the open internet, every existing public
-- solution becomes PRIVATE; owners can re-share deliberately. Each conversion
-- is recorded in the solution's history.

ALTER TABLE users ADD COLUMN org_domain TEXT;   -- NULL for personal Google accounts
CREATE INDEX idx_users_org_domain ON users (org_domain);

-- SQLite cannot alter a CHECK constraint, so the table is rebuilt.
-- Dropping `solutions` cascades to `solution_updates`, so history is backed up
-- first and restored afterwards.
CREATE TABLE _updates_backup AS SELECT * FROM solution_updates;

CREATE TABLE solutions_new (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  slug             TEXT NOT NULL CHECK (length(slug) BETWEEN 1 AND 80 AND slug NOT GLOB '*[^a-z0-9-]*'),
  summary          TEXT NOT NULL DEFAULT '',
  description_md   TEXT NOT NULL,
  client           TEXT,
  type             TEXT NOT NULL DEFAULT 'other'
                   CHECK (type IN ('demo', 'design', 'document', 'video', 'other')),
  industry         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(industry) AND json_type(industry) = 'array'),
  function         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(function) AND json_type(function) = 'array'),
  category         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(category) AND json_type(category) = 'array'),
  technologies     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(technologies) AND json_type(technologies) = 'array'),
  keywords         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(keywords) AND json_type(keywords) = 'array'),
  resources        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(resources) AND json_type(resources) = 'array'),
  thumbnail_url    TEXT,
  primary_resource TEXT,
  visibility       TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'organization', 'private')),
  status           TEXT NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'completed')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  completed_at     TEXT,
  UNIQUE (owner_id, slug)
);

INSERT INTO solutions_new (id, owner_id, title, slug, summary, description_md, client, type, industry, function,
  category, technologies, keywords, resources, thumbnail_url, primary_resource, visibility, status,
  created_at, updated_at, completed_at)
SELECT id, owner_id, title, slug, summary, description_md, client, type, industry, function,
  category, technologies, keywords, resources, thumbnail_url, primary_resource, 'private', status,
  created_at, updated_at, completed_at
FROM solutions;

-- Audit trail for the conversion (only rows that were public).
INSERT INTO _updates_backup (id, solution_id, author_id, event_type, message, changes, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-8'
             || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       id, owner_id, 'visibility_changed',
       'Made private (public now means visible without sign-in; re-share if intended)',
       '{"from":"public","to":"private","reason":"migration"}',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM solutions WHERE visibility = 'public';

DROP TABLE solutions;
ALTER TABLE solutions_new RENAME TO solutions;

CREATE INDEX idx_solutions_visibility_updated ON solutions (visibility, updated_at DESC);
CREATE INDEX idx_solutions_visibility_created ON solutions (visibility, created_at DESC);
CREATE INDEX idx_solutions_owner_updated ON solutions (owner_id, updated_at DESC);
CREATE INDEX idx_solutions_status ON solutions (status);

INSERT INTO solution_updates (id, solution_id, author_id, event_type, message, changes, created_at)
SELECT id, solution_id, author_id, event_type, message, changes, created_at
FROM _updates_backup WHERE id NOT IN (SELECT id FROM solution_updates);
DROP TABLE _updates_backup;
