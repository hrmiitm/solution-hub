export interface Env {
  DB: D1Database;
  /** Static assets (Flutter web build). Provided by Pages / Workers Static Assets. */
  ASSETS: Fetcher;
  /** Comma-separated Google OAuth client IDs accepted as ID-token audiences. */
  GOOGLE_CLIENT_IDS?: string;
  /** Comma-separated extra origins allowed for cross-origin API calls. */
  ALLOWED_ORIGINS?: string;
}

/**
 * The authenticated principal performing an operation. Services receive an
 * Actor rather than an HTTP request so that the same business logic can be
 * reused by other transports (e.g. the planned MCP server).
 */
export interface Actor {
  userId: string;
  username: string;
  /** Verified Google Workspace domain (`hd` claim); null for personal accounts. */
  orgDomain: string | null;
}
