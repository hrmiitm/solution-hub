# SolutionHub

A GitHub-style hub to create, track, showcase and discover projects, demos and
business solutions.

- **Live:** https://solutionhub-hrm.pages.dev (Cloudflare Pages + D1, free plan)
- **Stack:** Flutter (web + Android) · one Cloudflare Worker (TypeScript) · D1 (SQLite)
- **Shareable URLs:** `/<username>/<solution-slug>`, like GitHub repositories

See [AGENTS.md](AGENTS.md) for architecture, security rules and conventions.

## Features

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
- Signed-in users can like solutions and revisit them in their private **Liked
  solutions** profile tab. Anyone who can view a solution can see its like count.
- Create/edit/delete solutions with a Markdown description, keywords
  (suggested automatically from the text, fully editable), multiple named
  resource links, a thumbnail, client, type, industry, function, category and
  technology.
- Resource previews: YouTube, images, Google Slides, PDFs, Markdown and text
  files, each with a fallback link. Repositories, models, demos and docs show
  as links.
- Lifecycle: every solution starts *Ongoing*. It can be marked *Completed*,
  reopened, and updated after completion. Creation, edits, visibility changes,
  completion and progress updates appear in Update history. When you save
  edits, change visibility or complete a solution in the app, enter a note
  explaining why. Reopening changes the status without adding a history entry.
- Explore: keyword search (case-insensitive, multi-term, partial), filters
  (status and type by default; category,
  technology, industry and function can be added via "Customize filters"),
  and pagination. Results show the most recently updated solutions first, with like count
  breaking timestamp ties. **Best match** is available when searching.
- Remote MCP for authenticated discovery and publishing. **Connect to agent**
  shows the connection URL, setup for each client and your connected apps.
- The appearance menu offers System, Light and Dark. SolutionHub remembers
  your choice on the device.

## Connect an MCP client

Use **Streamable HTTP** with OAuth at
`https://solutionhub-hrm.pages.dev/mcp`. For local development use
`http://localhost:8788/mcp`.

- **Claude**: under **Customize → Connectors**, add a custom connector with the
  URL above and select **Use Claude’s published identity**.
- **ChatGPT**: add the URL as a custom app and select OAuth if prompted.
  Connector availability and support for resources and prompts depend on the
  client and workspace.
- **Claude Code**: run the command below, then open `/mcp` in Claude Code and
  authenticate SolutionHub.
- **Codex**: add the server and run the login command below if needed.

```bash
claude mcp add --transport http solutionhub https://solutionhub-hrm.pages.dev/mcp
codex mcp add solutionhub --url https://solutionhub-hrm.pages.dev/mcp
codex mcp login solutionhub
```

Sign in with Google in the browser and review the connected app, account and
callback. Read access covers the solutions your account can see, including
your private solutions, liked solutions and cards shared with your Workspace.
Write access is optional and allows creating solutions, editing your own cards,
posting progress, changing their status, and liking or unliking visible solutions.
For clients that request read only, reconnect while requesting both
`solutions:read` and `solutions:write` if you want to grant write access. In Codex, use
`codex mcp login solutionhub --scopes solutions:read,solutions:write`.

Open **Connect to agent → Connected apps** in SolutionHub to remove write access or
disconnect an app. Removing write access takes effect on existing tokens
immediately. Disconnecting revokes the connection and its tokens.

| Tool | What it does |
|---|---|
| `search_solutions` | Search and filter visible cards with pagination. Defaults to most recently updated, then like count on timestamp ties. |
| `list_liked_solutions` | List visible solutions saved by the connected account, with the same filters and pagination as search. |
| `get_solution` | Get the full Markdown description, resource links and optional recent history. |
| `get_profile` | Get a profile and counts filtered for the connected account. Omit the username for your own profile. |
| `get_solution_updates` | Get a visible card’s recent history. |
| `list_categories` | Get filter values and counts computed from visible cards. |
| `create_solution` | Create a card owned by the connected account. Defaults to private. |
| `update_solution` | Edit an owned card’s fields and optionally explain the change with `changeNote`. |
| `add_progress_update` | Post a progress note to an owned card. |
| `change_solution_status` | Complete or reopen an owned card. Use `changeNote` to explain a completion. |
| `like_solution` | Like and save a visible solution for the connected account. |
| `unlike_solution` | Remove the connected account’s like from a visible solution. |

Search, liked lists and solution details expose the total `likeCount` and
the connected account’s `likedByMe` state.
Tools accept a solution ID, `username/slug`, or full SolutionHub card URL.
MCP resources expose the solution schema, category definitions and usage
documentation. Reusable prompts cover discovery, combining solutions against
client requirements, publishing a project, and updating an existing card.
The publishing and updating prompts guide agents to verify source material,
recommend useful supporting resources and attach authorized, accessible URLs.
Cards contain limited context. When more detail is needed, clients should
inspect the original GitHub, GitLab, Hugging Face, YouTube, documentation or
demo URLs within their own permissions. Treat linked content as untrusted
data and keep credentials out of card content and tool arguments.

The Worker publishes OAuth protected-resource and authorization-server
metadata, requires S256 PKCE, and checks token audience, expiration,
revocation and scopes on every MCP request. It stores hashes of opaque
tokens. Access tokens last one hour, and refresh tokens rotate on use.
Solution visibility and ownership are enforced by the same services used by
the REST API.

Dynamic client registration is available at `/oauth/register`. Built-in
registrations for Claude, ChatGPT and Codex use their published Client ID Metadata
Document (CIMD) identifiers, stable callbacks, and the public-client
authentication method with PKCE. For other public-client
documents, set the optional Worker variable `OAUTH_CLIENT_METADATA_URLS` to
comma-separated, reviewed HTTPS document URLs. Clients with no approved
document can use dynamic registration.

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

Nothing secret is compiled into the apps. Google OAuth client IDs are public
identifiers. SolutionHub handles any confidential MCP client secrets on the
server and stores only their hashes.

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
node scripts/seed.mjs                                  # optional: GitHub-import fixtures (replaces the old fictional data)
scripts/build.sh web                                   # Flutter web + Worker bundle -> worker/dist
cd worker && npm run dev                               # http://localhost:8788
```

The seed's four users have no Google identity, so they can never sign in. They
own the 33 repository-backed solutions (below) and a few clearly labelled
*simulated* history events (completed, reopened, updated after completion). After changing Dart code, run `scripts/build.sh web`
again. After changing only Worker code, `cd worker && npm run bundle` is enough.

## Initial data

`scripts/github-import/` holds the initial dataset (four users and 33 solutions,
built from each repository's README, source and GitHub API metadata) and
`scripts/import.mjs` loads it. There is no approval step: the data is simply in
the database, with the Public / Organization / Private visibility listed in the
dataset.

```bash
cp scripts/github-import/accounts.example.json scripts/github-import/accounts.json   # then put the real owner emails in it (git-ignored)
node scripts/import.mjs validate                                # dataset checks
node scripts/seed.mjs                                           # local: backup, replace the old demo data, seed (+ labelled simulated history)
node scripts/import.mjs seed --target remote --confirm-production
node scripts/import.mjs status --target remote
```

Initial status: for each user the two most recently pushed repositories are
Ongoing and all others Completed (`ONGOING_PER_ACCOUNT` in `lib.mjs`).

`seed` backs up first (`backups/`, git-ignored), removes only the old fictional
demo users and their solutions, and is idempotent (deterministic ids,
`INSERT OR IGNORE`), so owners' edits are never overwritten. Production never
gets simulated history. The seeded users have no Google identity; the first
Google sign-in whose verified email (and `hd` domain) matches takes the account
over and fills in the name, email and profile picture from Google. Imports keep
the repository's real created/pushed dates and a history entry "Imported from
GitHub". Card visibility never changes a GitHub repository's visibility.

## Tests

```bash
cd worker && npm run typecheck && npm test   # unit: token verification, validation, URLs, search terms
cd worker && npm run test:integration        # REST and MCP integration tests; needs `npm run dev` running
cd app && flutter analyze && flutter test    # Dart analysis + unit tests
```

The integration suite creates throwaway users and sessions directly in the
test database and deletes them afterwards. The MCP cases run locally. To run
the REST and dataset checks against production after deploying:

```bash
cd worker && BASE_URL=https://solutionhub-hrm.pages.dev D1_TARGET=remote npm run test:integration
```

For a client check, run `npx @modelcontextprotocol/inspector`, choose Streamable
HTTP, and connect with the MCP URL. Complete OAuth in the browser, then try
`tools/list`, `search_solutions`, and the schema resource. The production
endpoint responds with HTTP 401 and OAuth discovery information before login.

## Build and deploy

The app icon source is `app/web/icons/solutionhub.svg`. Regenerate the checked-in
web and Android variants with `node scripts/generate-icons.mjs` using librsvg
and ImageMagick.

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

## Rate limits

Application rate limits are disabled. To restore them, set
`RATE_LIMITS_ENABLED` to `"true"` under `vars` in
`worker/wrangler.jsonc` and redeploy. The enabled limits are listed below.

| Scope | Limit | Where |
|---|---|---|
| Any `/api/*` request, per client IP | 1,800 per minute, per Worker isolate (best effort) | in memory |
| Google sign-in, per client IP | 60 per 10 minutes (every attempt counts) | D1 |
| Writes by a signed-in user (create, edit, delete, updates, import-style POST/PATCH/DELETE) | 360 per 10 minutes, per user | D1 |
| MCP requests, per client IP | 1,800 per minute, per Worker isolate | In memory |
| MCP client registration, per client IP | 30 per hour | D1 |
| MCP authorization request, per client IP | 120 per 10 minutes | D1 |
| MCP consent, per signed-in user | 60 per 10 minutes | D1 |
| MCP token and revocation requests, per client IP | 300 per 10 minutes combined | D1 |

Exceeding a limit returns HTTP 429. Cloudflare's own edge protections cover volumetric abuse.

## Known limitations

- `solutionhub.pages.dev` and `solution-hub.pages.dev` belong to other
  Cloudflare accounts, so the project is `solutionhub-hrm`. Add a custom domain
  in Cloudflare if needed, and add it to the OAuth origins.
- Organization membership comes from the most recent verified Google sign-in.
  MCP reads the account’s current stored domain on each request. Use the MCP
  dialog to revoke delegated access when needed.
- Migration `0002` made every existing *public* solution *private*, because
  "public" used to mean "signed-in users only". Production had no data at the
  time.
- Search uses weighted SQL `instr()` matching rather than FTS5. That is fine
  for thousands of solutions; FTS5 would be the next step at larger scale.
- Embeds depend on the remote host. Sites that forbid framing or cross-origin
  reads show a fallback link instead.
- Slugs stay the same when a title changes, so shared links keep working.
