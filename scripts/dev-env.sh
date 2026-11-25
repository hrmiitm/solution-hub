#!/usr/bin/env bash
# Generates worker/.dev.vars (git-ignored) from the root .env so that
# `wrangler pages dev` can verify Google ID tokens locally. Prints no secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Missing .env (copy .env.example and fill it in)" >&2; exit 1; }
# shellcheck disable=SC1091
set -a; source .env; set +a
: "${GOOGLE_OAUTH_WEB_CLIENT_ID:?GOOGLE_OAUTH_WEB_CLIENT_ID must be set in .env}"
ids="$GOOGLE_OAUTH_WEB_CLIENT_ID"
[[ -n "${GOOGLE_OAUTH_ANDROID_CLIENT_ID:-}" ]] && ids="$ids,$GOOGLE_OAUTH_ANDROID_CLIENT_ID"
umask 077
# Local development and the integration suite run without rate limits, so tests
# never exercise (or exhaust) them. Production uses the vars in wrangler.jsonc.
printf 'GOOGLE_CLIENT_IDS=%s\nRATE_LIMITS_ENABLED=false\nRATE_LIMIT_GLOBAL_PER_DAY=0\n' "$ids" > worker/.dev.vars
echo "Wrote worker/.dev.vars"
