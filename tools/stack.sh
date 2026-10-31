#!/usr/bin/env bash
# Isolated Compose stacks for parallel executors (PLAT-2 decision 2.4;
# platform §1, data §11.7, handbook 03).
#
#   tools/stack.sh up a|b      start profile stack-a|stack-b as project elx-stack-a|b, wait for healthy
#   tools/stack.sh clone a|b   (re)create database elx_stack_a|b in that stack's postgres:
#                              from the template elx_seed once PLAT-5 builds it, else empty
#   tools/stack.sh ports a|b   print the host port of every service
#   tools/stack.sh down a|b    stop the stack and delete its volumes (the clone goes with them)
#
# Each stack has its own containers, network and volumes; ports are the dev
# ports +100 (a) and +200 (b), fixed in compose.yaml.
set -euo pipefail

SEED_DB=elx_seed # the template database PLAT-5 builds (data §11.7); reserved here

usage() {
  echo "usage: $0 up|down|clone|ports a|b" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
command=$1
stack=$2
[[ $stack == a || $stack == b ]] || usage

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed; tools/native-stack.sh runs the dev stack without it" >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo ".env is missing: cp .env.example .env" >&2
  exit 1
fi

project="elx-stack-$stack"
compose=(docker compose --project-name "$project" --profile "stack-$stack")
clone_db="elx_stack_$stack"

case $command in
  up)
    "${compose[@]}" up --detach --wait --wait-timeout 300
    "$0" ports "$stack"
    ;;
  down)
    "${compose[@]}" down --volumes --remove-orphans
    ;;
  clone)
    # Names go in as psql variables and are quoted by psql (:"clone", :'seed').
    "${compose[@]}" exec -T "postgres-$stack" \
      psql --username postgres --dbname postgres --no-psqlrc --quiet \
      -v ON_ERROR_STOP=1 -v clone="$clone_db" -v seed="$SEED_DB" <<'SQL'
SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'seed') AS has_seed \gset
DROP DATABASE IF EXISTS :"clone" WITH (FORCE);
\if :has_seed
CREATE DATABASE :"clone" TEMPLATE :"seed" OWNER elx_owner;
\echo created :clone from :seed
\else
CREATE DATABASE :"clone" OWNER elx_owner;
\echo created empty :clone (no :seed yet; PLAT-5 builds it)
\endif
SQL
    ;;
  ports)
    for service in postgres redis vroom minio mailpit whatsapp-stub; do
      case $service in
        postgres) port=5432 ;;
        redis) port=6379 ;;
        vroom) port=3000 ;;
        minio) port=9000 ;;
        mailpit) port=8025 ;;
        whatsapp-stub) port=8080 ;;
      esac
      printf '%-14s %s\n' "$service" "$("${compose[@]}" port "$service-$stack" "$port")"
    done
    ;;
  *)
    usage
    ;;
esac
