-- Staging area for imported solutions (e.g. the GitHub repository import).
--
-- Staged rows are NOT solutions: they are invisible to every read path until the
-- account owner signs in with Google, reviews them and accepts. Ownership is
-- never taken from this table; accepting always creates the solution under the
-- signed-in user. A row matches a user only when the *verified* Google email
-- equals `owner_email` and, if set, the verified `hd` claim equals
-- `owner_org_domain`. No Google subject IDs are stored or invented here.
--
-- `payload` holds the validated solution input plus source metadata
-- (see worker/src/services/imports.ts). Email addresses live only in this
-- table and are never returned by any API.
CREATE TABLE import_staging (
  id               TEXT PRIMARY KEY,                 -- becomes the solution id when accepted
  batch            TEXT NOT NULL,
  owner_email      TEXT NOT NULL CHECK (owner_email = lower(owner_email)),
  owner_org_domain TEXT,                             -- expected verified `hd`; NULL = personal account
  source_key       TEXT NOT NULL,                    -- e.g. github:sanand0/aipipe
  payload          TEXT NOT NULL CHECK (json_valid(payload)),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  solution_id      TEXT REFERENCES solutions(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  resolved_at      TEXT,
  UNIQUE (owner_email, source_key)
);

CREATE INDEX idx_import_staging_owner ON import_staging (owner_email, status);
