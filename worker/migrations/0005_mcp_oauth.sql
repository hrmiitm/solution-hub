-- OAuth 2.1 for the remote MCP server (/mcp). SolutionHub is its own
-- authorization server; people prove who they are with the existing Google
-- sign-in, then explicitly consent per connector (read, or read + write).
--
-- A scope only narrows what a connector may do on its user's behalf. It never
-- adds rights: every request still goes through services/access.ts as that user.
-- Tokens are random; only their SHA-256 hashes are stored (like sessions).

-- Connector apps. DCR clients get a random id; Client ID Metadata Document
-- (CIMD) clients use their https metadata URL as the id and are cached here.
CREATE TABLE oauth_clients (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('dcr', 'cimd')),
  name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  client_uri     TEXT,
  redirect_uris  TEXT NOT NULL CHECK (json_valid(redirect_uris) AND json_type(redirect_uris) = 'array'),
  auth_method    TEXT NOT NULL CHECK (auth_method IN ('none', 'client_secret_basic', 'client_secret_post')),
  secret_hash    TEXT,                       -- sha256(client_secret) for confidential DCR clients
  created_at     TEXT NOT NULL,
  fetched_at     TEXT                        -- CIMD: when the metadata document was last fetched
);

-- One grant per (user, connector, resource): the consent the user gave. Revoking deletes
-- it, which cascades to every code and token issued under it.
CREATE TABLE oauth_grants (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id     TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  scopes        TEXT NOT NULL,               -- space-separated: 'solutions:read' or 'solutions:read solutions:write'
  resource      TEXT NOT NULL,               -- audience: the canonical MCP endpoint URL
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_used_at  TEXT,
  UNIQUE (user_id, client_id, resource)
);
CREATE INDEX idx_oauth_grants_client ON oauth_grants (client_id);

-- Single-use authorization codes (PKCE S256), valid for a few minutes.
CREATE TABLE oauth_codes (
  id              TEXT PRIMARY KEY,          -- sha256(code)
  grant_id        TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  redirect_uri    TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,
  scopes          TEXT NOT NULL,
  resource        TEXT NOT NULL,
  expires_at      TEXT NOT NULL
);
CREATE INDEX idx_oauth_codes_grant ON oauth_codes (grant_id);
CREATE INDEX idx_oauth_codes_expires ON oauth_codes (expires_at);

-- Access tokens (short-lived) and refresh tokens (rotated on every use).
CREATE TABLE oauth_tokens (
  id          TEXT PRIMARY KEY,              -- sha256(token)
  grant_id    TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  family_id   TEXT NOT NULL,                 -- tokens descended from the same code exchange
  spent_at    TEXT,                          -- retained on rotated refresh tokens to detect replay
  scopes      TEXT NOT NULL,
  resource    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_oauth_tokens_grant ON oauth_tokens (grant_id);
CREATE INDEX idx_oauth_tokens_family ON oauth_tokens (family_id);
CREATE INDEX idx_oauth_tokens_expires ON oauth_tokens (expires_at);
