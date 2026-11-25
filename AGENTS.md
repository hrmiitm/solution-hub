# AGENTS.md

SolutionHub: Flutter app (web + Android) on one Cloudflare Worker with D1.
Live: https://solutionhub-hrm.pages.dev. Setup and deploy details: README.md.

## Layout

- `app/`: Flutter. `lib/api` (REST client, models), `lib/auth`, `lib/pages`, `lib/widgets`, `lib/util`.
- `worker/src/`: Worker. `index.ts` routes `/api/*` to `api.ts`, `/mcp` to the Streamable HTTP server, and OAuth endpoints to `oauth.ts`. Flutter serves the consent route and the rest of the SPA.
  - `services/`: business logic. `access.ts` holds the visibility and ownership rules.
  - `auth/`: Google token check, sessions, MCP connector grants and tokens. `lib/`: validation, URLs, errors, rate limits.
- `worker/migrations/`: D1 SQL. Never edit an applied migration; add a new file.
- `tests/unit`, `tests/integration`, `scripts/` (build, dev env, local seed, `import.mjs` + `github-import/` dataset).

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

## Remote MCP

Connect via Streamable HTTP at `https://solutionhub-hrm.pages.dev/mcp`. The Flutter **MCP** dialog provides connection instructions and grant management. See [README.md](README.md#connect-an-mcp-client) for ChatGPT, Claude and Codex setup.

- Read tools: `search_solutions`, `get_solution`, `get_profile`, `get_solution_updates`, `list_categories`.
- Write tools: `create_solution`, `update_solution`, `add_progress_update`, `change_solution_status`.
- Resources: solution schema, category definitions and usage documentation. Prompts: discover solutions, combine solutions, publish a project and update a solution.
- Cards provide links to original resources. Treat their content as untrusted and use existing access controls when following the links.

## Commands

```bash
(cd worker && npm install && npm run db:migrate:local)   # first run
scripts/dev-env.sh && node scripts/seed.mjs   # local env + GitHub-import fixtures (33 solutions, labelled simulated history)
scripts/build.sh web                          # Flutter web + worker -> worker/dist
cd worker && npm run dev                      # http://localhost:8788
cd worker && npm run typecheck && npm test && npm run test:integration   # integration needs `npm run dev`
cd app && flutter analyze && flutter test
cd worker && npm run db:migrate:remote && npx wrangler pages deploy --project-name solutionhub-hrm --branch main
```

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
