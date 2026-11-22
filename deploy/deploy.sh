#!/usr/bin/env bash
# Ship a stable version to production (Docker + Cloudflare Tunnel).
#
#   pnpm ship              build and deploy the latest commit on main
#   pnpm ship <ref>        deploy a tag, branch or commit (also how you roll back)
#   pnpm ship status       what's running, and which commit
#   pnpm ship logs         follow the server logs
#   pnpm ship url          print the public address
#   pnpm ship stop         stop production
#
# Only committed code is deployed: the image is built from `git archive`, so whatever
# you are editing in dev never reaches production.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f deploy/compose.yaml --env-file deploy/.env)
[ -f deploy/.env ] || cp deploy/.env.example deploy/.env

profile() {
  # Own domain if a tunnel token is set, otherwise a free temporary address.
  if grep -qE '^TUNNEL_TOKEN=.+' deploy/.env; then echo named; else echo quick; fi
}

url() {
  if [ "$(profile)" = named ]; then
    grep -E '^PUBLIC_URL=.+' deploy/.env | cut -d= -f2- ||
      echo "Your tunnel's hostname (set PUBLIC_URL in deploy/.env to show it here)"
  else
    local u=""
    for _ in $(seq 30); do
      u=$("${COMPOSE[@]}" --profile quick logs quick-tunnel 2>/dev/null |
        grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
      [ -n "$u" ] && break
      sleep 1
    done
    echo "${u:-Address not ready yet; try: pnpm ship url}"
  fi
}

deploy() {
  local ref="${1:-main}"
  local sha
  sha=$(git rev-parse --short "${ref}^{commit}")
  if [ -n "$(git status --porcelain)" ]; then
    echo "Note: you have uncommitted changes. They are NOT included; deploying ${ref} @ ${sha}."
  fi

  echo "Building tactical-tiles:${sha} from ${ref}…"
  git archive --format=tar "$sha" | docker build -t "tactical-tiles:${sha}" -t tactical-tiles:latest -

  local p
  p=$(profile)
  echo "Starting ${sha} (tunnel: ${p})…"
  TILES_TAG="$sha" "${COMPOSE[@]}" --profile "$p" up -d --remove-orphans --wait app
  TILES_TAG="$sha" "${COMPOSE[@]}" --profile "$p" up -d --remove-orphans
  echo "$sha" >deploy/.deployed

  echo
  echo "Deployed ${ref} @ ${sha}"
  echo "  Local check: http://localhost:2770"
  echo "  Public:      $(url)"
}

case "${1:-}" in
  status)
    echo "Deployed commit: $(cat deploy/.deployed 2>/dev/null || echo none)"
    "${COMPOSE[@]}" --profile "$(profile)" ps
    ;;
  logs) "${COMPOSE[@]}" logs -f app ;;
  url) url ;;
  stop) "${COMPOSE[@]}" --profile named --profile quick down ;;
  *) deploy "${1:-}" ;;
esac
