# Test report — SolutionHub Phase 1 (2026-11-25)

## Update: three visibility levels and the new hostname

- **Live URL is now `https://solutionhub-hrm.pages.dev`.**
- **Backend unit tests (20/20):** these add the full visibility matrix
  (anonymous, owner, same-org colleague, other-org user, personal account ×
  public/organization/private), fail-closed organization checks, scope checks,
  `visibleSql`, and `hd` claim extraction.
- **Integration tests (31/31), both locally and against production:**
  - every viewer sees exactly the allowed set via detail, path, history,
    search, profile list, profile counts and category facets;
  - the organization domain is shown only to those who can see it;
  - the visibility filter narrows results but never widens them;
  - colleagues, other organizations and anonymous visitors cannot modify;
  - personal accounts get 422 for organization visibility;
  - an omitted visibility defaults to private, and changes are recorded in
    the history;
  - anonymous visitors can read but not write.
- **Migration `0002`:** tested locally on seeded data. All 13 solutions and
  33 history rows were kept, 10 public → private conversions were recorded
  as audit events, and there were no foreign-key violations. Applied to
  production, which had no data.
- **Browser (local):**
  - anonymous Explore shows public solutions only, and an organization link
    prompts sign-in;
  - a same-org member sees the organization solution with its domain badge;
  - the form defaults to Organization for Workspace accounts, and for
    personal accounts Organization is disabled and the form defaults to
    Private;
  - the owner's visibility menu works and is applied server-side.
- **Fixed during testing:** menus and dialogs that overlapped embedded
  previews (YouTube/PDF iframes) did not receive clicks on web. Fixed with
  `pointer_interceptor`.
- `flutter analyze` is clean and `flutter test` passes 9/9. The APK was
  rebuilt for the new URL.

Earlier results follow; some counts (14 unit, 23 integration tests) predate
this update.

## Automated

| Suite | Where | Result |
|---|---|---|
| Backend typecheck (`tsc`, strict) | worker + tests | pass |
| Backend unit tests (`node --test`), 14 | Google ID-token verification (valid; wrong audience/issuer; expired; unverified email; tampered payload; `alg: none`; unknown key; JWKS caching; fails closed with no client ID), URL safety, resource-type detection, slugs, usernames, input validation, summaries, search-term normalization | 14/14 pass |
| Integration tests, 23 (local `wrangler pages dev` + local D1) | see below | 23/23 pass |
| Integration tests, 23, **against production** (the first deployment, since replaced by `solutionhub-hrm`, + remote D1, test data removed afterwards) | same suite | 23/23 pass |
| `flutter analyze` | app | no issues |
| `flutter test`, 9 | keyword suggestion, URL safety/detection, embed URLs, query params, formatting, model parsing | 9/9 pass |

The integration suite covers:

- **Authentication:** unauthenticated requests are 401. A forged session is
  401. Invalid Google tokens are 401. Cross-origin web logins are 403. Logout
  revokes the session.
- **CSRF and CORS:** cookie writes without `Origin`, with a foreign `Origin`,
  or without the CSRF header are 403. Preflights from other origins get no
  CORS grant.
- **Multiple users and ownership:** non-owners get 403 on PATCH, DELETE and
  posting updates. The owner is taken from the session, never from the
  request body.
- **Lifecycle:** create (always ongoing, unique slug per owner, derived
  summary), edit (slug stays stable, no-op edits don't bump `updated_at`),
  progress update, complete, update after completion, reopen, delete with
  history cascade. History order and change details are asserted.
- **Privacy:** private solutions are 404 to others via id, path and history.
  They are absent from others' search, profile lists and counts, and their
  values are absent from category facets.
- **Search:** case and whitespace handling, multiple terms (AND), partial
  terms, ranking (title over description and client), matches on technology
  and owner, filters (status, type, case-insensitive technology), sorting
  (updated, created, oldest), pagination without overlap.
- **Injection:** SQL-injection strings in the search, filter and sort
  parameters are treated as plain text. Stored markup comes back as inert
  JSON with `nosniff`.
- **Limits:** a non-JSON body is 400, a 300 KB body is 413, invalid fields
  are 422 with per-field details.
- **Routing and headers:** deep links serve the SPA shell with CSP and no
  wildcard CORS. Unknown endpoints are 404 and wrong methods are 405.

## Manual (browser, Chrome, local release build)

Using fictional seed users with sessions written into the local database:

- Deep link while signed out → sign-in page with return path. Google button
  renders under the strict CSP, with no CSP violations in the console.
- Solution details: PDF preview (arXiv), YouTube embed, Markdown rendering
  (headings, lists, tables), the remote README rendered from
  raw.githubusercontent.com (including relative images), resource list with
  previews, metadata, timeline.
- Owner posted a progress update after completion. Edited the title, removed
  a resource and added a technology via autocomplete. The history shows
  "Edited title, technologies, resources · Removed: …".
- Created a solution with `<script>` in the title and
  `javascript:`/`<img onerror>` in the description. The payloads appear as
  text, the raw HTML is not executed, and the `javascript:` link does
  nothing.
- Form validation messages, keyword suggestions (add one / add all), primary
  preview selection, automatic resource-type detection.
- Second user: the other user's private solution URL shows "Not found". Their
  profile shows only public counts and cards, and their own profile shows a
  private count.
- Explore: search with mixed case and extra spaces, the status filter with
  removable chips, "Best match" sort, the MCP dialog.
- Mobile width (400 px): icon navigation, a stacked toolbar, a filter
  bottom-sheet button, single-column cards.
- Logout returns to sign-in, and the old session no longer works.

## Production smoke tests

- Root and deep links return 200 with the CSP/HSTS headers. `/_worker.js` and
  `/.env` return only the SPA shell (no source or secrets).
- `/api/me` without a session is 401. An invalid Google credential is 401. A
  cross-origin login is 403.
- The bundled `main.dart.js` and the APK contain no client secret. The APK is
  signed with the release key and targets `https://solutionhub-hrm.pages.dev`.

## Not verified here (needs the account owner)

- **Interactive Google sign-in** (web and Android). The Google account
  chooser opens in a popup window that the test browser could not control.
  Server-side token verification is covered by the unit tests with real
  RS256 signatures.
- **Android app on a device or emulator.** The local Android emulator crashed
  on startup (segfault) in this environment. The APK builds and is signed,
  and the native bearer-token path is covered by the integration tests
  against production. Install `build/solutionhub.apk` on a device after
  registering the Android OAuth client (see README).
