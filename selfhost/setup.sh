#!/usr/bin/env sh
# Creates selfhost/.env for you: asks for your domain and Groq key, generates
# the three secrets. Safe to run once; it refuses to overwrite an existing .env.
set -eu

cd "$(dirname "$0")"

if [ -f .env ]; then
  echo "There is already a .env here. Delete or rename it first if you want to start over."
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is missing. Install it (Ubuntu: apt install -y openssl) and run this again."
  exit 1
fi

printf 'Your domain, without https:// (for example whisper.example.com): '
read -r DOMAIN
DOMAIN=$(printf '%s' "$DOMAIN" | sed -e 's#^https\?://##' -e 's#/.*$##' -e 's/[[:space:]]//g' | tr 'A-Z' 'a-z')
if [ -z "$DOMAIN" ]; then
  echo "A domain is required."
  exit 1
fi

printf 'Your Groq API key (starts with gsk_): '
read -r GROQ_API_KEY
GROQ_API_KEY=$(printf '%s' "$GROQ_API_KEY" | sed -e 's/[[:space:]]//g')
case "$GROQ_API_KEY" in
  gsk_*) ;;
  *) echo "That does not look like a Groq key (it should start with gsk_)."; exit 1 ;;
esac

umask 077
{
  echo "DOMAIN=$DOMAIN"
  echo "GROQ_API_KEY=$GROQ_API_KEY"
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
  echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
} > .env

echo
echo "Done. Your settings are saved in $(pwd)/.env"
echo "Next:  docker compose up -d --build"
