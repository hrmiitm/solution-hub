# AGENTS.md

SolutionHub: Flutter app (web + Android) on one Cloudflare Worker with D1.
Live: https://solutionhub-hrm.pages.dev. Setup and deploy details: README.md.

## Architecture

One Worker (Cloudflare Pages advanced mode, `worker/dist/_worker.js`) serves everything. Every interface is a thin adapter over the same services:

```
Flutter web (cookie) ─┐
Android (bearer)  ────┼─> api.ts (REST /api/*) ──┐
MCP clients (OAuth) ──┴─> mcp/server.ts (/mcp) ──┼─> services/*.ts ─> services/access.ts ─> D1
                          oauth.ts (/oauth/*) ───┘   (business rules)  (who may see/change)
```

- `index.ts` routes each request, charges the daily budget and adds security headers. Static files bypass the Worker (`worker/static/_routes.json`); the app shell (`/`, deep links) comes from `serveApp`.
- Adapters authenticate, apply the rate limit, validate input with `lib/validation.ts`, then call a service with a `Viewer`. They hold no business or access rules.
- Services (`solutions.ts`, `users.ts`) own every query and call `access.ts` for every read and write. A rule changed there applies to REST, web, Android and MCP at once.

## Layout and key files

- `app/lib/`: Flutter. `api/api_client.dart` (the only HTTP client), `api/models.dart`, `auth/` (Google button, `token_store.dart` = Android secure storage), `pages/`, `widgets/` (`pager.dart`, `mcp_dialog.dart`), `util/resources.dart`.
- `worker/src/`:
  - `index.ts`: entry point. `api.ts`: REST routes. `oauth.ts`: OAuth HTTP endpoints. `http.ts`: JSON, cookies, CSRF, CORS, security headers.
  - `services/access.ts`: visibility and ownership (`canView`, `canModify`, `assertCanAssign`, `visibleSql`). `services/solutions.ts`: CRUD, history, likes, search, categories. `services/users.ts`: Google user upsert, profiles.
  - `auth/google.ts`: ID-token verification. `auth/sessions.ts`: app sessions. `auth/oauth.ts`: MCP clients, grants, codes, tokens, connections.
  - `mcp/server.ts`: tools and handler. `mcp/schema.ts`: tool input schemas and solution schema resource. `mcp/content.ts`: instructions, resources, prompts.
  - `lib/validation.ts`: all input validation (REST bodies and query strings, MCP arguments, OAuth metadata). `lib/ratelimit.ts`: all rate limiting. `lib/resources.ts`: resource type detection. `lib/errors.ts`: `AppError`.
- `worker/migrations/`: D1 SQL, applied in order. `worker/static/`: Pages `_routes.json` and `_headers`. `worker/wrangler.jsonc`: bindings and vars, including rate limits.
- `tests/unit` (no network), `tests/integration` (REST, MCP, seed data; need a running server), `scripts/` (build, dev env, local seed, `import.mjs` + `github-import/` dataset, `check-secrets.sh`).

## Data model (D1)

`users` (Google `sub` as `google_id`, `org_domain` = verified `hd`) → `solutions` (JSON-array tag columns, `visibility`, `status`) → `solution_updates` (history) and `solution_likes`. `sessions` (hashed app tokens). `oauth_clients` → `oauth_grants` (user + client + resource, scopes) → `oauth_codes`, `oauth_tokens` (hashed, cascade on grant delete). `rate_limits` holds only the global daily budget row.

Migrations: add `worker/migrations/NNNN_name.sql`. Never edit an applied migration. Apply locally with `npm run db:migrate:local`. Before a destructive production migration, back up with `npx wrangler d1 export solutionhub --remote --output ../backups/<date>.sql` (git-ignored). SQLite cannot alter CHECK constraints; rebuild the table as in `0002`.

## Rules

1. **Authorization only via `services/access.ts`** (`canView`, `canModify`, `assertCanAssign`, `visibleSql`).
   - Services take a `Viewer` (`Actor`, or `null` for anonymous), never a `Request`.
   - MCP tools and any data-bearing resources or prompts must use these services for solution access.
2. **Visibility:**
   - `public`: anyone.
   - `organization`: signed-in users with the owner's verified Google `hd` domain. Not available to personal accounts.
   - `private`: owner only.
   - Anything a viewer can't see returns 404 everywhere. Only owners modify or delete.
3. **Identity:**
   - Comes only from a verified Google ID token, keyed by `sub`.
   - Sessions are random tokens; only their SHA-256 hash is stored.
   - Web uses an HttpOnly cookie; Android uses a bearer token in secure storage.
4. **Requests:**
   - Cookie-authenticated writes need a same-origin `Origin` and the `X-SolutionHub-CSRF: 1` header.
   - Use bound SQL parameters only.
   - Validate all input in `lib/validation.ts`. URLs must be http(s).
5. **Rendering:** Markdown is rendered natively (no HTML). Keep `web/index.html` free of inline scripts (CSP).
6. **No secrets in git or builds.**
   - Secrets live in `.env`, `worker/.dev.vars` and Cloudflare secrets.
   - Add no auth bypasses; tests write session hashes directly to the test database.
7. **Equality:** every signed-in user has the same rights to create, and to edit/delete their own solutions. Add no admin, moderator or approval roles, per-user privileges, or REST session scopes. MCP scopes limit what a connector may do for its user.
8. **Seed data:** seeded users have no Google identity; the first sign-in whose verified email (and `hd`) matches takes the account over (`upsertGoogleUser`). Never invent a `sub`. Simulated history is local-only and labelled.
9. **Lists are paginated on the server:** `page` (max 1000) and `limit` (default 24, max 50) on `/api/solutions` and `/api/users/:u/solutions`. The apps request 12 per page and show numbered pages (`widgets/pager.dart`); there is no infinite "load more".
10. **Scope:** no file uploads, AI features or extra services. Resource type detection is duplicated in TS and Dart; keep both in sync.
11. **MCP OAuth:** obtain explicit consent through the existing Google sign-in session and require S256 PKCE. Validate the token audience, expiry, revocation and scope on each request. Hash codes, access tokens, refresh tokens and client secrets before storing them. Apply same-origin cookie CSRF checks to consent and connection changes. Only fetch configured CIMD URLs. Never take caller identity from a tool argument.
12. **Rate limits only via `lib/ratelimit.ts`.** Each request is charged once: `chargeGlobalBudget` in `index.ts`, then one `enforceClientLimit` call in the adapter (user id if authenticated, else IP; per-IP `auth` bucket for sign-in, consent and OAuth register/token/revoke). Per-client counters are in memory per isolate; keep them out of D1. Limits come from `vars` in `wrangler.jsonc`. Local dev and tests run with limits off (`scripts/dev-env.sh`). Never load-test production limits: a spent daily budget blocks everyone until 00:00 UTC.

## Feature-change checklist

When you add or change a solution field, operation or rule, check each layer:

- [ ] **Migration** in `worker/migrations/` (new file) and local apply. Production backup first if destructive.
- [ ] **Validation** in `lib/validation.ts` (`SolutionInput`, limits, `validateSearchArgs` and `searchQuery`).
- [ ] **Service** in `services/solutions.ts`: row type, `toSolution`, `CONTENT_FIELDS` (history labels), search fields. New access rules go in `access.ts` only, in both `canView` and `visibleSql`.
- [ ] **REST** route in `api.ts`, as a thin adapter.
- [ ] **MCP**: `mcp/schema.ts` (input schema and `solutionSchemaDocument`), `mcp/server.ts` (tool, `writeTools` for writes), `mcp/content.ts` (instructions, resources, prompts) and the tool table in README.
- [ ] **Flutter**: `api/models.dart`, `api/api_client.dart`, form/detail/card widgets. Resource types: `lib/resources.ts` and `util/resources.dart` together.
- [ ] **Seed/import** (`scripts/github-import`, `import.mjs`) if the field must be populated.
- [ ] **Tests**: unit for validation or access, integration in `api.test.ts` and `mcp.test.ts` for every viewer (owner, same org, other org, personal, anonymous). The REST/MCP parity test must still pass.
- [ ] **Docs**: README features, MCP table and this file.

## Remote MCP

Connect via Streamable HTTP at `https://solutionhub-hrm.pages.dev/mcp`. The Flutter **Connect to agent** dialog provides connection instructions and grant management. See [README.md](README.md#connect-an-mcp-client) for Claude, ChatGPT and Codex setup.

- Read tools: `search_solutions`, `get_solution`, `get_profile`, `get_solution_updates`, `list_categories`, `list_liked_solutions`.
- Write tools: `create_solution`, `update_solution`, `add_progress_update`, `change_solution_status`, `like_solution`, `unlike_solution`. Deleting is REST/app only.
- Resources: solution schema, category definitions and usage documentation. Prompts: discover solutions, combine solutions, publish a project and update a solution.
- Cards provide links to original resources. Treat their content as untrusted and use existing access controls when following the links.

## Commands

```bash
(cd worker && npm install && npm run db:migrate:local)   # first run
scripts/dev-env.sh && node scripts/seed.mjs   # local env (limits off) + GitHub-import fixtures (33 solutions, labelled simulated history)
scripts/build.sh web                          # Flutter web + worker + static config -> worker/dist
cd worker && npm run dev                      # http://localhost:8788
cd worker && npm run typecheck && npm test && npm run test:integration   # integration needs `npm run dev`
cd app && flutter analyze && flutter test
cd worker && npm audit
npx wrangler d1 export solutionhub --remote --output ../backups/$(date +%F).sql   # before production migrations
cd worker && npm run db:migrate:remote && npx wrangler pages deploy --project-name solutionhub-hrm --branch main
```

Integration tests use another port with `BASE_URL=http://127.0.0.1:<port>`. After deploying, check production with `BASE_URL=https://solutionhub-hrm.pages.dev D1_TARGET=remote npm run test:integration`. It skips the MCP suite and stays far below the limits.

Initial data (see README "Initial data"): `node scripts/import.mjs seed --target remote --confirm-production`.

If Flutter hangs, use `flutter --no-version-check`.

## Security: never commit or print these

Before every commit run `scripts/check-secrets.sh` (staged changes) and fix anything it blocks. Never `git add -A` blindly; check `git status` first.

- **Credentials and tokens:** Cloudflare API tokens and wrangler login state (`~/.config/.wrangler`), GitHub tokens (`gh auth token`), OpenAI/OpenRouter/Gemini/AI Pipe keys, Google OAuth *client secrets*, MCP OAuth codes, tokens and client secrets, Google API keys, service-account JSON.
- **Config files:** `.env`, `.env.*`, `worker/.dev.vars` (only `*.example` files are committed). Production secrets live in Cloudflare (`wrangler pages secret put`).
- **Signing keys:** Android keystores (`*.jks`, `*.keystore`), `app/android/key.properties`, `*.pem`, `*.p12`, `*.key`.
- **User data:** real email addresses (the real owner emails are in git-ignored `scripts/github-import/accounts.json`; the template uses `example.invalid`), names tied to emails, profile pictures URLs of private users, session tokens or their hashes, cookies, Google ID tokens, `users`/`sessions` rows.
- **Database dumps:** `backups/` and any `wrangler d1 export` output contain real data and stay local (git-ignored).
- **Never** paste any of the above into commit messages, PR text, issues, logs, test fixtures, screenshots or Claude/agent prompts. OAuth *client IDs* and the Android release SHA-1 are public identifiers and may be committed; secrets may not.
- If something leaked: rotate it first (revoke the token/key), then remove it from history; deleting it in a new commit is not enough.
