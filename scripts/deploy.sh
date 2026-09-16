#!/usr/bin/env bash
#
# Steps 3 to 5 of DEPLOYMENT.md, as one command.
#
# Creating the database (step 2) needs a browser and an account, so it stays
# yours. Everything after it is mechanical, and mechanical steps done by hand at
# the end of a long day are where production deployments go wrong: a migration
# against the pooled URL instead of the direct one, a secret pasted with a
# trailing newline, APP_URL left at localhost so every quote link a customer
# receives points at a machine that is not on the internet.
#
#   ./scripts/deploy.sh \
#     --database-url "postgresql://…-pooler…" \
#     --direct-url   "postgresql://…direct…"  \
#     [--app-url https://yourdomain.com]
#
# Set VERCEL_TOKEN in the environment and it runs unattended — no prompts, which
# is what CI and an agent session need.
#
# What it does, in order, stopping at the first thing that is wrong:
#
#   1. Applies every migration, against the DIRECT url — a transaction pooler
#      cannot carry the advisory locks and DDL a migration needs.
#   2. Proves the tenant boundary is intact in the database it just created, and
#      refuses to go any further if it is not.
#   3. Generates AUTH_SECRET and CRON_SECRET if you have not supplied them, and
#      stores them in Vercel. They are never printed, and never written to disk.
#   4. Deploys to production. If you did not give it a domain, it reads the one
#      Vercel just assigned, sets APP_URL to that, and deploys again — because
#      the first deploy cannot know its own address, and every quote link,
#      review link and password reset is an absolute URL built from it.
#
# Re-running it is safe: migrations that have already run are skipped, and each
# variable is replaced rather than duplicated.

set -euo pipefail

DATABASE_URL_ARG=""
DIRECT_URL_ARG=""
APP_URL_ARG=""
SKIP_DEPLOY="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --database-url) DATABASE_URL_ARG="${2:-}"; shift 2 ;;
    --direct-url)   DIRECT_URL_ARG="${2:-}";   shift 2 ;;
    --app-url)      APP_URL_ARG="${2:-}";      shift 2 ;;
    # Migrations and the isolation check, without touching Vercel. Useful on its
    # own when you only want to bring a database up to date.
    --database-only) SKIP_DEPLOY="yes";        shift 1 ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

DATABASE_URL_ARG="${DATABASE_URL_ARG:-${DATABASE_URL:-}}"
DIRECT_URL_ARG="${DIRECT_URL_ARG:-${DIRECT_URL:-}}"
APP_URL_ARG="${APP_URL_ARG:-${APP_URL:-}}"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$DATABASE_URL_ARG" ] || fail "Missing --database-url (the POOLED connection string)."
[ -n "$DIRECT_URL_ARG" ]   || fail "Missing --direct-url (the UNPOOLED one, for migrations)."

# A pooled URL in the migration slot fails in a way that does not mention
# pooling — it hangs, or reports a lock it cannot take — so it is worth one
# sanity check here rather than twenty minutes of confusion later.
case "$DIRECT_URL_ARG" in
  *-pooler*|*:6543*)
    fail "--direct-url looks like a POOLED endpoint. Migrations need the direct one."
    ;;
esac

if [ "$DATABASE_URL_ARG" = "$DIRECT_URL_ARG" ]; then
  printf '\033[33mNote: the pooled and direct URLs are identical. That is fine for a single\n'
  printf 'Postgres server, but a managed host gives you two — use the pooled one for the\n'
  printf 'app, or serverless will exhaust its connection limit before it is busy.\033[0m\n'
fi

cd "$(dirname "$0")/.."

# ── 1. The schema ───────────────────────────────────────────────────────────
say "Applying migrations (direct connection)"
DIRECT_URL="$DIRECT_URL_ARG" DATABASE_URL="$DIRECT_URL_ARG" npx prisma migrate deploy

# ── 2. The one property that cannot be fixed afterwards ─────────────────────
say "Checking the tenant boundary in the database"
DATABASE_URL="$DIRECT_URL_ARG" npm run --silent db:check-constraints \
  || fail "The tenant boundary is NOT intact. Stop: a customer list shown to the wrong business cannot be un-shown."

if [ "$SKIP_DEPLOY" = "yes" ]; then
  say "Database is ready. Skipping the deploy, as asked."
  exit 0
fi

# ── 3. Secrets ──────────────────────────────────────────────────────────────
#
# Generated here and handed straight to Vercel. Not echoed, not written to a
# file, not left in your shell history.
AUTH_SECRET_VALUE="${AUTH_SECRET:-$(openssl rand -base64 48)}"
CRON_SECRET_VALUE="${CRON_SECRET:-$(openssl rand -hex 32)}"

command -v npx >/dev/null || fail "npx is required."

# `VERCEL_TOKEN` (and `VERCEL_SCOPE`, for a team account) are what make this
# runnable with nobody at the keyboard — from CI, or from an agent session. Set
# them as environment variables rather than passing them as arguments: an
# argument is visible in `ps` and lands in shell history.
#
# The flags go after the subcommand, which every Vercel subcommand accepts.
vercel() {
  local extra=()
  [ -n "${VERCEL_TOKEN:-}" ] && extra+=(--token "$VERCEL_TOKEN")
  [ -n "${VERCEL_SCOPE:-}" ] && extra+=(--scope "$VERCEL_SCOPE")
  npx --yes vercel@latest "$@" "${extra[@]+"${extra[@]}"}"
}

say "Linking this directory to a Vercel project"
# Interactive the first time; a no-op once .vercel/project.json exists. With a
# token there is nobody to answer the questions, so it takes the defaults.
if [ -n "${VERCEL_TOKEN:-}" ]; then
  vercel link --yes
else
  vercel link
fi

# Replace rather than add: `vercel env add` refuses a name that already exists,
# so a second run of this script would otherwise stop here.
put_env() {
  local name="$1" value="$2"
  vercel env rm "$name" production --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$name" production >/dev/null
  printf '  %s set\n' "$name"
}

say "Setting production environment variables"
put_env DATABASE_URL     "$DATABASE_URL_ARG"
put_env DIRECT_URL       "$DIRECT_URL_ARG"
put_env AUTH_SECRET      "$AUTH_SECRET_VALUE"
put_env CRON_SECRET      "$CRON_SECRET_VALUE"
put_env DATABASE_POOL_MAX "3"
# An `if`, not `[ … ] && …`: under `set -e` that idiom aborts the whole script
# when the test is false, which here means "you did not pass a domain".
if [ -n "$APP_URL_ARG" ]; then
  put_env APP_URL "$APP_URL_ARG"
fi

# ── 4. Deploy ───────────────────────────────────────────────────────────────
say "Deploying to production"
DEPLOYED_URL="$(vercel deploy --prod | tail -1 | tr -d '[:space:]')"

case "$DEPLOYED_URL" in
  https://*) ;;
  *) fail "Could not read the deployment URL from Vercel's output. Deploy may still have succeeded — check the dashboard." ;;
esac

if [ -z "$APP_URL_ARG" ]; then
  say "Setting APP_URL to $DEPLOYED_URL and redeploying"
  # The first deploy cannot know its own address, and every link the product
  # sends a customer is built from this one.
  put_env APP_URL "$DEPLOYED_URL"
  DEPLOYED_URL="$(vercel deploy --prod | tail -1 | tr -d '[:space:]')"
fi

say "Deployed: $DEPLOYED_URL"

cat <<NEXT

Two things to check, in this order:

  1. Health. It should report the database as ok:
       curl $DEPLOYED_URL/api/health

  2. The journey. Sign up, add a lead, send a quote, open the public link in a
     private window and accept it. That path touches every layer and needs no
     integration configured.

Then, when you attach a real domain, set APP_URL to it and deploy again —
otherwise customers get links to the deployment URL above.

Follow-ups will not run until the cron schedule matches your Vercel plan: the
committed vercel.json asks for a minutely pass, which is a paid feature. See
step 7 of DEPLOYMENT.md for the two ways round it.

Everything else — email, SMS, AI, Stripe, Maps — is optional and independently
switchable. Steps 5 to 9 of DEPLOYMENT.md say what each one turns on and what
breaks without it.
NEXT
