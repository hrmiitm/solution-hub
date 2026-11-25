#!/usr/bin/env bash
# One-time setup for .github/workflows/release-android.yml.
# Reads your local, git-ignored files and stores them in the GitHub repository:
#   secrets   (from app/android/key.properties): the release keystore, its passwords and alias
#   variables (from .env): GOOGLE_OAUTH_WEB_CLIENT_ID and APP_URL (public identifiers)
# Nothing is printed. Run again after rotating the key. Needs `gh auth login`.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
props=app/android/key.properties
[[ -f "$props" && -f .env ]] || { echo "Need $props and .env" >&2; exit 1; }
prop() { sed -n "s/^$1=//p" "$props" | head -1; }

store="$(prop storeFile)"
[[ -f "$store" ]] || { echo "Keystore from key.properties not found" >&2; exit 1; }

base64 -w0 "$store"        | gh secret set ANDROID_KEYSTORE_BASE64
prop storePassword | tr -d '\n' | gh secret set ANDROID_KEYSTORE_PASSWORD
prop keyAlias      | tr -d '\n' | gh secret set ANDROID_KEY_ALIAS
prop keyPassword   | tr -d '\n' | gh secret set ANDROID_KEY_PASSWORD

set -a; source .env; set +a
gh variable set GOOGLE_OAUTH_WEB_CLIENT_ID --body "${GOOGLE_OAUTH_WEB_CLIENT_ID:?not set in .env}"
gh variable set APP_URL --body "${APP_URL:?not set in .env}"
echo "Done. Release with: gh workflow run release-android.yml -f tag=v0.1.0"
