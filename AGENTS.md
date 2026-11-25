# AGENTS.md

SolutionHub: Flutter app (web + Android) on one Cloudflare Worker with D1.
Live: https://solutionhub-hrm.pages.dev. Setup and deploy details: README.md.

## Layout

- `app/`: Flutter. `lib/api` (REST client, models), `lib/auth`, `lib/pages`, `lib/widgets`, `lib/util`.
- `worker/src/`: Worker. `index.ts` routes `/api/*` to `api.ts` and everything else to static assets (SPA).
  - `services/`: business logic. `access.ts` holds the visibility and ownership rules.
  - `auth/`: Google token check, sessions. `lib/`: validation, URLs, errors, rate limits.
- `worker/migrations/`: D1 SQL. Never edit an applied migration; add a new file.
- `tests/unit`, `tests/integration`, `scripts/` (build, dev env, dev-only seed).

## Rules

1. **Authorization only via `services/access.ts`** (`canView`, `canModify`, `assertCanAssign`, `visibleSql`).
   - Services take a `Viewer` (`Actor`, or `null` for anonymous), never a `Request`.
   - Future MCP tools must call these services; don't re-implement checks.
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
7. **Scope:** no file uploads, AI features or extra services. Resource type detection is duplicated in TS and Dart; keep both in sync.

## Commands

```bash
(cd worker && npm install && npm run db:migrate:local)   # first run
scripts/dev-env.sh && node scripts/seed.mjs   # local env + sample data
scripts/build.sh web                          # Flutter web + worker -> worker/dist
cd worker && npm run dev                      # http://localhost:8788
cd worker && npm run typecheck && npm test && npm run test:integration   # integration needs `npm run dev`
cd app && flutter analyze && flutter test
cd worker && npm run db:migrate:remote && npx wrangler pages deploy --project-name solutionhub-hrm --branch main
```

If Flutter hangs, use `flutter --no-version-check`.
