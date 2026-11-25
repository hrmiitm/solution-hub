# SolutionHub

A GitHub-style hub to create, track, showcase and discover projects, demos and
business solutions.

- **Live:** https://solutionhub-hrm.pages.dev (Cloudflare Pages + D1, free plan)
- **Stack:** Flutter (web + Android) · one Cloudflare Worker (TypeScript) · D1 (SQLite)
- **Shareable URLs:** `/<username>/<solution-slug>`, like GitHub repositories

See [AGENTS.md](AGENTS.md) for architecture, security rules and conventions.
See [TEST_REPORT.md](TEST_REPORT.md) for what was tested.

## Features (Phase 1)

- Google sign-in (web and Android), verified on the server; revocable sessions.
  Browsing public solutions needs no sign-in. Creating and editing do.
- Three visibility levels:

  | Level | Who can view |
  |---|---|
  | Public | Anyone, including visitors who are not signed in |
  | Organization | Signed-in users whose Google Workspace domain (the verified `hd` ID-token claim) matches the owner's. Not available to personal Google accounts. |
  | Private | The owner only |

  Only owners can edit or delete. New solutions default to Organization
  (Workspace accounts) or Private (personal accounts); the API defaults to
  Private.
- Profiles with ongoing/completed counts, counting only what the viewer can see.
- Create/edit/delete solutions with a Markdown description, keywords
  (suggested automatically from the text, fully editable), multiple named
  resource links, a thumbnail, client, type, industry, function, category and
  technology.
- Resource previews: YouTube, images, Google Slides, PDFs, Markdown and text
  files, each with a fallback link. Repositories, models, demos and docs show
  as links.
- Lifecycle: every solution starts *Ongoing*. It can be marked *Completed*,
  reopened, and updated after completion. Creation, edits (including resource
  changes), visibility changes, status changes and progress updates are all
  recorded in the history.
- Explore: keyword search (case-insensitive, multi-term, partial,
  relevance-ranked), filters (status and type by default; category,
  technology, industry and function can be added via "Customize filters"),
  sorting and pagination.
- MCP button: shows that agent integration is planned (Phase 2). Nothing is
  simulated.

## Repository layout

```
app/        Flutter app (web + Android)
worker/     Cloudflare Worker, D1 migrations, wrangler.jsonc
tests/      Backend unit + integration tests
scripts/    build.sh, dev-env.sh, seed.mjs (dev only)
```

## Prerequisites

Flutter 3.47+, Node 20+ (tested on 24), JDK 17 and the Android SDK (for the
APK), and a Cloudflare account (`npx wrangler login`).

## Configuration

Copy `.env.example` to `.env` (git-ignored) and fill in:

| Variable | Purpose |
|---|---|
| `GOOGLE_OAUTH_WEB_CLIENT_ID` | OAuth **Web** client ID. Identifies the web button. It is also the audience of Android ID tokens. |
| `GOOGLE_OAUTH_ANDROID_CLIENT_ID` | Optional extra accepted audience. |
| `APP_URL` | Deployed HTTPS origin the Android build talks to. |

Nothing secret is compiled into the apps. OAuth client IDs are public
identifiers, and no client secret is used anywhere.

### Google Cloud OAuth setup

In Google Cloud Console → *APIs & Services → Credentials*, in the project that
owns the web client:

1. **Web client:** add these to *Authorized JavaScript origins*:
   - `https://solutionhub-hrm.pages.dev`
   - `http://localhost:8788` (local development)

   No redirect URIs are needed, because the button flow uses popups.
2. **Android client:** *Create credentials → OAuth client ID → Android*:
   - Package name: `com.solutionhub.app`
   - SHA-1 (release key): `4C:76:25:29:B3:A4:23:3F:FC:74:D3:4C:45:EE:69:AB:7C:69:FA:91`
   - Add a second Android client with the debug SHA-1 if you run debug
     builds (`keytool -list -v -keystore ~/.android/debug.keystore -storepass android`).

   The app requests ID tokens for the *web* client ID (`serverClientId`), so
   the Android client ID does not need to be configured anywhere else.
3. The OAuth consent screen must be published, or list your testers.

## Local development

```bash
cd worker && npm install                               # wrangler, esbuild, typescript
npx wrangler d1 migrations apply solutionhub --local   # local SQLite in worker/.wrangler
cd .. && scripts/dev-env.sh                            # worker/.dev.vars from .env
node scripts/seed.mjs                                  # optional: fictional sample data
scripts/build.sh web                                   # Flutter web + Worker bundle -> worker/dist
cd worker && npm run dev                               # http://localhost:8788
```

The seed's four users have no Google identity, so they can never sign in. They
only populate Explore. After changing Dart code, run `scripts/build.sh web`
again. After changing only Worker code, `cd worker && npm run bundle` is enough.

## Tests

```bash
cd worker && npm run typecheck && npm test   # unit: token verification, validation, URLs, search terms
cd worker && npm run test:integration        # end-to-end API tests; needs `npm run dev` running
cd app && flutter analyze && flutter test    # Dart analysis + unit tests
```

The integration suite creates throwaway users and sessions directly in the
target database and deletes them afterwards. To run it as a post-deploy check
against production:

```bash
cd worker && BASE_URL=https://solutionhub-hrm.pages.dev D1_TARGET=remote npm run test:integration
```

## Build and deploy

```bash
scripts/build.sh all     # worker/dist (web + _worker.js) and build/solutionhub.apk
cd worker
npx wrangler d1 migrations apply solutionhub --remote
npx wrangler pages deploy --project-name solutionhub-hrm --branch main
```

One-time setup, already done for the live deployment:

```bash
npx wrangler d1 create solutionhub                    # put the id in wrangler.jsonc
npx wrangler pages project create solutionhub-hrm --production-branch main
printf '%s' "<web-client-id>[,<android-client-id>]" | npx wrangler pages secret put GOOGLE_CLIENT_IDS --project-name solutionhub-hrm
```

### Android

`scripts/build.sh apk` builds a release APK (`build/solutionhub.apk`) pointed
at `APP_URL`. Release signing reads `app/android/key.properties` (git-ignored).
It points to a keystore outside the repo
(`~/.config/solutionhub/solutionhub-release.jks`). Back that keystore up: its
SHA-1 is registered with Google, so losing it means registering a new one.
Without `key.properties`, release builds fall back to the debug key.

## Known limitations

- `solutionhub.pages.dev` and `solution-hub.pages.dev` belong to other
  Cloudflare accounts, so the project is `solutionhub-hrm`. Add a custom domain
  in Cloudflare if needed, and add it to the OAuth origins.
- Organization membership is refreshed at each sign-in. Someone who leaves a
  Workspace keeps organization access until their session expires (30 days)
  or they log out.
- Migration `0002` made every existing *public* solution *private*, because
  "public" used to mean "signed-in users only". Production had no data at the
  time.
- Search uses weighted SQL `instr()` matching rather than FTS5. That is fine
  for thousands of solutions; FTS5 would be the next step at larger scale.
- Read-request rate limiting is per Worker isolate (best effort). Sign-in and
  writes are rate-limited in D1.
- Embeds depend on the remote host. Sites that forbid framing or cross-origin
  reads show a fallback link instead.
- Slugs stay the same when a title changes, so shared links keep working.
