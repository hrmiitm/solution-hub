-- SolutionHub initial schema.
-- UUIDs are TEXT, timestamps are UTC ISO-8601 TEXT (lexicographically sortable).
-- Multi-value metadata is stored as JSON arrays (validated by CHECK constraints)
-- rather than normalized tables, which keeps the prototype small.
-- D1 enforces foreign keys by default.


CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  -- Google's stable account identifier ("sub" claim). NULL only for
  -- development seed users, which therefore can never sign in.
  google_id   TEXT UNIQUE,
  username    TEXT NOT NULL UNIQUE
              CHECK (length(username) BETWEEN 2 AND 40 AND username NOT GLOB '*[^a-z0-9-]*'),
  name        TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  avatar_url  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE solutions (
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
  visibility       TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  status           TEXT NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'completed')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  completed_at     TEXT,
  UNIQUE (owner_id, slug)
);

CREATE INDEX idx_solutions_visibility_updated ON solutions (visibility, updated_at DESC);
CREATE INDEX idx_solutions_visibility_created ON solutions (visibility, created_at DESC);
CREATE INDEX idx_solutions_owner_updated ON solutions (owner_id, updated_at DESC);
CREATE INDEX idx_solutions_status ON solutions (status);

CREATE TABLE solution_updates (
  id           TEXT PRIMARY KEY,
  solution_id  TEXT NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL CHECK (event_type IN
                 ('created', 'edited', 'progress_updated', 'status_changed', 'visibility_changed')),
  message      TEXT NOT NULL DEFAULT '',
  changes      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(changes)),
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_updates_solution_created ON solution_updates (solution_id, created_at DESC);
CREATE INDEX idx_updates_author ON solution_updates (author_id);

-- Revocable application sessions. Only a SHA-256 hash of the bearer token is
-- stored, so a database leak does not leak usable session tokens.
-- `scopes` is reserved for future MCP tokens with explicit read/write grants.
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,          -- sha256(token), hex
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client      TEXT NOT NULL CHECK (client IN ('web', 'native')),
  scopes      TEXT NOT NULL DEFAULT 'read write',
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- Fixed-window counters for rate limiting sign-in and write operations.
CREATE TABLE rate_limits (
  key           TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL
);
