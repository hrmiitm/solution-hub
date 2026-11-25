#!/usr/bin/env bash
# Builds release artifacts.
#   scripts/build.sh web      Flutter web (release) + Worker bundle -> worker/dist
#   scripts/build.sh apk      Android release APK -> build/solutionhub.apk
#   scripts/build.sh all      both
#
# Configuration comes from the git-ignored root .env:
#   GOOGLE_OAUTH_WEB_CLIENT_ID  OAuth web client ID (public identifier, not a secret)
#   APP_URL                     Deployed HTTPS origin the Android app talks to
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
[[ -f .env ]] || { echo "Missing .env" >&2; exit 1; }
set -a; source .env; set +a
: "${GOOGLE_OAUTH_WEB_CLIENT_ID:?GOOGLE_OAUTH_WEB_CLIENT_ID must be set in .env}"
flutter_cmd=(flutter --no-version-check)
target="${1:-all}"

build_web() {
  echo "==> Flutter web (release)"
  (cd app && "${flutter_cmd[@]}" build web --release --no-web-resources-cdn --no-source-maps \
    --dart-define=GOOGLE_WEB_CLIENT_ID="$GOOGLE_OAUTH_WEB_CLIENT_ID")
  echo "==> Worker bundle"
  rm -rf worker/dist
  cp -r app/build/web worker/dist
  # Pages serves the static files in _routes.json "exclude" without invoking the
  # Worker (no request quota or rate-limit budget used); _headers secures them.
  cp worker/static/_routes.json worker/static/_headers worker/dist/
  (cd worker && npm run -s bundle)
}

build_apk() {
  : "${APP_URL:?APP_URL (deployed https origin) must be set in .env to build the APK}"
  [[ "$APP_URL" == https://* ]] || { echo "APP_URL must be https" >&2; exit 1; }
  echo "==> Android APK (release) -> $APP_URL"
  (cd app && "${flutter_cmd[@]}" build apk --release \
    --dart-define=API_BASE_URL="$APP_URL" \
    --dart-define=GOOGLE_WEB_CLIENT_ID="$GOOGLE_OAUTH_WEB_CLIENT_ID")
  mkdir -p build
  cp app/build/app/outputs/flutter-apk/app-release.apk build/solutionhub.apk
  echo "APK: build/solutionhub.apk"
}

case "$target" in
  web) build_web ;;
  apk) build_apk ;;
  all) build_web; build_apk ;;
  *) echo "usage: $0 [web|apk|all]" >&2; exit 2 ;;
esac
