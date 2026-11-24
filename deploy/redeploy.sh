#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

if [[ $# -ne 1 ]]; then
  echo "用法：bash deploy/redeploy.sh {all|server|admin|employee|client|site|mongodb}" >&2
  exit 2
fi
target=$1
case "$target" in
  all|server|admin|employee|client|site|mongodb) ;;
  *) echo "未知部署目标：$target" >&2; exit 2 ;;
esac

if [[ ${DEPLOY_SKIP_PULL:-0} != 1 ]]; then
  if branch=$(git symbolic-ref --quiet --short HEAD) && git config --get "branch.$branch.merge" >/dev/null; then
    git pull --ff-only
  else
    echo "当前检出没有配置上游分支，使用本地代码部署。"
  fi
fi
GIT_SHA=$(git rev-parse --short=12 HEAD)
export GIT_SHA

# 显式指定 profile 中的服务会隐式启用它，先确认部署配置已选用内置数据库。
if [[ $target == mongodb ]]; then
  enabled_services=$(docker compose config --services)
  if ! grep -Fxq mongodb <<< "$enabled_services"; then
    echo "请先在部署环境或 .env 设置 COMPOSE_PROFILES=mongo 以启用内置 MongoDB。" >&2
    exit 1
  fi
fi

services=()
options=(--detach --build --force-recreate --wait --wait-timeout 120)
if [[ $target != all ]]; then
  services=("$target")
  options+=(--no-deps)
fi

if docker compose up "${options[@]}" "${services[@]}"; then
  docker compose ps "${services[@]}"
  printf '部署完成（%s，Git %s）。\n' "$target" "$GIT_SHA"
else
  status=$?
  docker compose ps --all "${services[@]}" >&2 || true
  docker compose logs --tail=100 "${services[@]}" >&2 || true
  exit "$status"
fi
