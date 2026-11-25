export interface Env {
  DB: D1Database;
  /** Static assets (Flutter web build). Provided by Pages / Workers Static Assets. */
  ASSETS: Fetcher;
  /** Comma-separated Google OAuth client IDs accepted as ID-token audiences. */
  GOOGLE_CLIENT_IDS?: string;
  /** Comma-separated extra origins allowed for cross-origin API calls. */
  ALLOWED_ORIGINS?: string;
  /** Extra reviewed HTTPS Client ID Metadata Document URLs for MCP OAuth. */
  OAUTH_CLIENT_METADATA_URLS?: string;
  /** "false" turns off the per-client rate limits (user, anonymous, auth). See lib/ratelimit.ts. */
  RATE_LIMITS_ENABLED?: string;
  /** Per-client window length in seconds (default 300). */
  RATE_LIMIT_WINDOW_SECONDS?: string;
  /** Requests per window per signed-in user, shared by REST and MCP (default 2000; 0 = no limit). */
  RATE_LIMIT_USER?: string;
  /** Requests per window per IP without a valid session or token (default 300; 0 = no limit). */
  RATE_LIMIT_ANONYMOUS?: string;
  /** Requests per window per IP to sign-in, consent and OAuth endpoints (default 50; 0 = no limit). */
  RATE_LIMIT_AUTH?: string;
  /** Requests per UTC day across the whole app (default 80000; 0 = no budget). */
  RATE_LIMIT_GLOBAL_PER_DAY?: string;
}

/**
 * The authenticated principal performing an operation. Services receive an
 * Actor rather than an HTTP request so that the same business logic can be
 * reused by other transports, including MCP.
 */
export interface Actor {
  userId: string;
  username: string;
  /** Verified Google Workspace domain (`hd` claim); null for personal accounts. */
  orgDomain: string | null;
}
