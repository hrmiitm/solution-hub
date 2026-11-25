#!/usr/bin/env bash
# Scans what is about to be committed (staged changes) for secrets and personal data.
#   scripts/check-secrets.sh          staged changes
#   scripts/check-secrets.sh --all    every tracked and staged file
# Exits non-zero if anything suspicious is found. Run it before every commit (see AGENTS.md "Security").
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
bad=0
flag() { echo "BLOCKED: $1"; bad=1; }

if [[ "${1:-}" == "--all" ]]; then
  files=$(git ls-files; git diff --cached --name-only --diff-filter=AM)
  text() { for f in $files; do [[ -f $f ]] && cat "$f"; done; }
else
  files=$(git diff --cached --name-only --diff-filter=AM)
  text() { git diff --cached -U0 --diff-filter=AM | grep '^+' | grep -v '^+++'; }
fi

# 1. Files that must never be committed.
while IFS= read -r f; do
  case "$f" in
    .env|.env.*|*/.env|*/.env.*|*.dev.vars|*/.dev.vars|.dev.vars) [[ "$f" == *.example ]] || flag "secret/config file staged: $f" ;;
    *.jks|*.keystore|*.pem|*.p12|*.pfx|*.key|*key.properties|*service-account*.json|*credentials*.json|*client_secret*.json|*token.pickle|*google-services.json) flag "key/credential file staged: $f" ;;
    backups/*|*.sql.bak) flag "database backup staged: $f" ;;
    scripts/github-import/accounts.json) flag "real owner emails staged: $f (only accounts.example.json is committed)" ;;
  esac
done <<< "$files"

# 2. Secret-looking content.
content=$(text)
check() { if grep -Eq "$2" <<< "$content"; then flag "$1"; grep -En "$2" <<< "$content" | head -3 | cut -c1-120 | sed 's/^/    /'; fi; }
check "private key block"                 'BEGIN ([A-Z]+ )?PRIVATE KEY'
check "Google API key (AIza...)"          'AIza[0-9A-Za-z_-]{35}'
check "Google OAuth client secret"        'GOCSPX-[0-9A-Za-z_-]{10,}'
check "Google OAuth access token"         'ya29\.[0-9A-Za-z_-]{20,}'
check "OpenAI/OpenRouter-style key"       '\bsk-(or-)?[A-Za-z0-9_-]{20,}'
check "GitHub token"                      '\bgh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}'
check "Cloudflare/API token assignment"   '(CLOUDFLARE_API_TOKEN|CF_API_TOKEN|API_KEY|SECRET|PASSWORD|AUTH_TOKEN)[A-Z_]*["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9_./+-]{16,}'
check "bearer token literal"              'Authorization: *Bearer +[A-Za-z0-9._-]{20,}'
check "session token literal"             'sh_session=[A-Za-z0-9_-]{20,}'

# 3. Personal data: any email address that is not an obvious placeholder (the four fake addresses are unit-test fixtures).
emails=$(grep -Eo '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' <<< "$content" | grep -Eiv '^(Ada\.Lovelace@gmail\.com|pw@host\.com|p@x\.com|x@y\.com)$' | grep -Eiv '@(example\.(com|org|test|invalid)|[a-z0-9.-]*\.test|[a-z0-9.-]*\.invalid|users\.noreply\.github\.com|noreply@anthropic\.com)$|^noreply@' | sort -u)
if [[ -n "$emails" ]]; then flag "real-looking email addresses (keep them in git-ignored files):"; sed 's/^/    /' <<< "$emails" | head -10; fi

[[ $bad -eq 0 ]] && echo "check-secrets: OK"
exit $bad
