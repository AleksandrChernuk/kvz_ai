#!/usr/bin/env bash
set -euo pipefail

SUPABASE_ROOT="${SUPABASE_ROOT:-/opt/supabase}"
SUPABASE_PROJECT_NAME="${SUPABASE_PROJECT_NAME:-kvz-ai}"
SUPABASE_PROJECT="$SUPABASE_ROOT/$SUPABASE_PROJECT_NAME"
SUPABASE_DOMAIN="${SUPABASE_DOMAIN:-}"
SITE_DOMAIN="${SITE_DOMAIN:-}"
SUPABASE_SCHEME="${SUPABASE_SCHEME:-https}"
SITE_SCHEME="${SITE_SCHEME:-https}"

if [[ -z "$SUPABASE_DOMAIN" || -z "$SITE_DOMAIN" ]]; then
  echo "SUPABASE_DOMAIN and SITE_DOMAIN are required." >&2
  echo "Example: SUPABASE_DOMAIN=supabase.example.com SITE_DOMAIN=ai.example.com $0" >&2
  exit 1
fi

if [[ -e "$SUPABASE_PROJECT" ]]; then
  echo "$SUPABASE_PROJECT already exists. Clean/archive it first with ops/server/clean-kvz-ai.sh." >&2
  exit 1
fi

mkdir -p "$SUPABASE_ROOT"
cd "$SUPABASE_ROOT"

curl -fsSL https://supabase.link/setup.sh -o /tmp/supabase-setup.sh
chmod +x /tmp/supabase-setup.sh
/tmp/supabase-setup.sh --project-dir "$SUPABASE_PROJECT_NAME" -y

cd "$SUPABASE_PROJECT"

public_url="$SUPABASE_SCHEME://$SUPABASE_DOMAIN"
site_url="$SITE_SCHEME://$SITE_DOMAIN"

sed -i \
  -e "s|^SUPABASE_PUBLIC_URL=.*$|SUPABASE_PUBLIC_URL=$public_url|" \
  -e "s|^API_EXTERNAL_URL=.*$|API_EXTERNAL_URL=$public_url|" \
  -e "s|^SITE_URL=.*$|SITE_URL=$site_url|" \
  -e "s|^PROXY_DOMAIN=.*$|PROXY_DOMAIN=$SUPABASE_DOMAIN|" \
  .env

sh run.sh start
sh run.sh secrets

echo "Self-hosted Supabase is running at $public_url"
echo "Use SUPABASE_PUBLISHABLE_KEY as NEXT_PUBLIC_SUPABASE_ANON_KEY."
echo "Use SUPABASE_SECRET_KEY as SUPABASE_SERVICE_ROLE_KEY."
