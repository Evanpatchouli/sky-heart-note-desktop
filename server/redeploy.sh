#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
compose=(docker compose -f docker-compose.yml)
service=webapp-template-server

if "${compose[@]}" up -d --build --force-recreate --no-deps "$service"; then
  for ((attempt=1; attempt<=60; attempt++)); do
    if "${compose[@]}" exec -T "$service" node -e "fetch('http://127.0.0.1:8793/api/site').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
      "${compose[@]}" ps "$service"
      echo "服务端部署完成。"
      exit 0
    fi
    sleep 1
  done
fi
"${compose[@]}" ps --all "$service" >&2 || true
"${compose[@]}" logs --tail=100 "$service" >&2 || true
exit 1
