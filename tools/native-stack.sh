#!/usr/bin/env bash
# Native local stack for machines without a container runtime (PLAT-2 decision 2.9).
#
#   tools/native-stack.sh up       start the services, create roles, extensions and the bucket
#   tools/native-stack.sh status   show what runs, on which port, and how it was started
#   tools/native-stack.sh down     stop every process this script started (data is kept)
#   tools/native-stack.sh reset    down, then delete the data: .local/native-stack and, in
#                                  database mode, the elx database and the roles up created
#
# Same ports and the same .env as the Compose dev profile, so app settings work
# against either stack. VROOM has no native build here; use the Compose stack (or CI) for it.
#
# PostgreSQL (Homebrew postgresql@17 and postgis):
#   dedicated mode  5432 is free: a cluster of our own in .local/native-stack/postgres,
#                   superuser "postgres" with POSTGRES_PASSWORD, initialised with
#                   tools/postgres/init/*.sql exactly as the container does
#   database mode   5432 already serves the developer's own PostgreSQL: create the elx
#                   database and the four roles in it with the same scripts, but leave
#                   template1 and every other database alone. Needs a superuser login
#                   over 127.0.0.1 (default: the current OS user; ELX_NATIVE_PG_ADMIN overrides)
# The mode is chosen on the first up and kept until reset.
#
# Redis: reuses a server already answering on 6379, else starts one.
# MinIO, Mailpit and the WhatsApp stub always start here, with their data under
# .local/native-stack. Nothing is written outside the repository except by the
# developer's own servers that database mode and a reused Redis talk to.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

state=.local/native-stack
run="$state/run"
pg_bin=${ELX_NATIVE_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
pg_port=${ELX_NATIVE_PG_PORT:-5432} # override only to test dedicated mode while 5432 is taken
pg_data="$state/postgres"
pg_admin=${ELX_NATIVE_PG_ADMIN:-$(id -un)}
roles=(elx_owner elx_app elx_platform elx_maintenance)

usage() {
  echo "usage: $0 up|down|status|reset" >&2
  exit 2
}

log() { printf '%s\n' "$*"; }
die() {
  printf 'native-stack: %s\n' "$*" >&2
  exit 1
}

load_env() {
  [[ -f .env ]] || die ".env is missing: cp .env.example .env"
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
}

require() {
  local bin
  for bin in "$@"; do
    command -v "$bin" >/dev/null 2>&1 || [[ -x $bin ]] || die "$bin not found (brew install it)"
  done
}

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

wait_for() { # description, command...
  local what=$1
  shift
  for _ in $(seq 1 60); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  die "$what did not become ready; see $run/*.log"
}

pid_alive() { [[ -f $1 ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

start_bg() { # name, command...: run in the background, record its pid
  local name=$1
  shift
  if pid_alive "$run/$name.pid"; then
    log "$name already running (pid $(cat "$run/$name.pid"))"
    return 0
  fi
  nohup "$@" >"$run/$name.log" 2>&1 &
  echo $! >"$run/$name.pid"
}

stop_pid() { # name
  local file="$run/$1.pid" pid
  [[ -f $file ]] || return 0
  pid=$(cat "$file")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in $(seq 1 40); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid"; fi
    log "stopped $1 (pid $pid)"
  fi
  rm -f "$file"
}

port_free_or_ours() { # port, name
  if listening "$1" && ! pid_alive "$run/$2.pid"; then
    die "port $1 is taken by another process; stop it first (lsof -nP -iTCP:$1 -sTCP:LISTEN)"
  fi
}

# ------------------------------------------------------------ postgres

admin_psql() { # database, psql args...
  local db=$1
  shift
  if [[ $(cat "$state/postgres.mode") == dedicated ]]; then
    PGPASSWORD=$POSTGRES_PASSWORD "$pg_bin/psql" -h 127.0.0.1 -p "$pg_port" -U postgres \
      -d "$db" --no-psqlrc -v ON_ERROR_STOP=1 "$@"
  else
    "$pg_bin/psql" -h 127.0.0.1 -p "$pg_port" -U "$pg_admin" -d "$db" --no-psqlrc -v ON_ERROR_STOP=1 "$@"
  fi
}

run_init_scripts() { # extra psql args (database mode passes skip_template1)
  local file
  for file in tools/postgres/init/*.sql; do
    log "running $file"
    admin_psql elx --quiet "$@" <"$file"
  done
}

postgres_up() {
  if [[ ! -f $state/postgres.mode ]]; then
    if listening "$pg_port"; then
      echo database >"$state/postgres.mode"
    else
      echo dedicated >"$state/postgres.mode"
    fi
  fi
  local mode
  mode=$(cat "$state/postgres.mode")

  if [[ $mode == dedicated ]]; then
    local fresh=no
    if [[ ! -f $pg_data/PG_VERSION ]]; then
      fresh=yes
      local pwfile="$run/pgpass.tmp"
      (umask 077 && printf '%s\n' "$POSTGRES_PASSWORD" >"$pwfile")
      "$pg_bin/initdb" -D "$pg_data" -U postgres --pwfile="$pwfile" \
        --auth-local=scram-sha-256 --auth-host=scram-sha-256 --encoding=UTF8 >"$run/initdb.log"
      rm -f "$pwfile"
    fi
    if ! "$pg_bin/pg_ctl" -D "$pg_data" status >/dev/null 2>&1; then
      if listening "$pg_port"; then die "port $pg_port is taken; the dedicated cluster cannot start"; fi
      # TCP only: the repository path is too long for a Unix socket name.
      "$pg_bin/pg_ctl" -D "$pg_data" -l "$run/postgres.log" -w \
        -o "-p $pg_port -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start >/dev/null
    fi
    if [[ $fresh == yes ]]; then
      admin_psql postgres --quiet -c 'CREATE DATABASE elx'
      run_init_scripts
    fi
    log "postgres: dedicated cluster in $pg_data on 127.0.0.1:$pg_port"
  else
    listening "$pg_port" || die "database mode, but nothing listens on $pg_port; start your PostgreSQL"
    [[ $(admin_psql postgres -tAc 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user') == t ]] ||
      die "$pg_admin is not a superuser on 127.0.0.1:$pg_port; set ELX_NATIVE_PG_ADMIN"
    local has_elx
    has_elx=$(admin_psql postgres -tAc "SELECT count(*) FROM pg_database WHERE datname = 'elx'")
    if [[ $has_elx != 0 && ! -f $state/postgres.created-db ]]; then
      die "your server already has a database elx that this script did not create; it will not touch it"
    fi
    if [[ $has_elx == 0 ]]; then
      local existing
      existing=$(admin_psql postgres -tAc "SELECT string_agg(rolname, ',') FROM pg_roles WHERE rolname IN ('elx_owner','elx_app','elx_platform','elx_maintenance')")
      [[ -z $existing ]] || die "roles $existing already exist in this server but elx does not; drop them or use reset"
      admin_psql postgres --quiet -c 'CREATE DATABASE elx'
      touch "$state/postgres.created-db"
      printf '%s\n' "${roles[@]}" >"$state/postgres.created-roles"
      run_init_scripts -v skip_template1=1
    fi
    log "postgres: database elx in your server on 127.0.0.1:$pg_port (database mode)"
  fi
}

postgres_down() {
  [[ -f $state/postgres.mode && $(cat "$state/postgres.mode") == dedicated ]] || return 0
  if "$pg_bin/pg_ctl" -D "$pg_data" status >/dev/null 2>&1; then
    "$pg_bin/pg_ctl" -D "$pg_data" -m fast -w stop >/dev/null
    log "stopped postgres (dedicated cluster)"
  fi
}

postgres_reset() {
  [[ -f $state/postgres.mode && $(cat "$state/postgres.mode") == database ]] || return 0
  listening "$pg_port" || die "database mode reset needs your PostgreSQL running on $pg_port"
  if [[ -f $state/postgres.created-db ]]; then
    admin_psql postgres --quiet -c 'DROP DATABASE IF EXISTS elx WITH (FORCE)'
    log "dropped database elx"
  fi
  if [[ -f $state/postgres.created-roles ]]; then
    local role
    while read -r role; do
      admin_psql postgres --quiet -v role="$role" <<<'DROP ROLE IF EXISTS :"role";'
      log "dropped role $role"
    done <"$state/postgres.created-roles"
  fi
}

# ------------------------------------------------------------ redis

redis_up() {
  if pid_alive "$run/redis.pid"; then
    log "redis: started by this script on 127.0.0.1:6379"
  elif listening 6379; then
    [[ $(redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null) == PONG ]] ||
      die "port 6379 is taken by something that is not Redis"
    log "redis: reusing the server already on 127.0.0.1:6379 (not stopped by down)"
  else
    mkdir -p "$state/redis"
    redis-server --bind 127.0.0.1 --port 6379 --dir "$repo_root/$state/redis" \
      --daemonize yes --pidfile "$repo_root/$run/redis.pid" --logfile "$repo_root/$run/redis.log"
    wait_for redis redis-cli -h 127.0.0.1 -p 6379 ping
    log "redis: started on 127.0.0.1:6379, data in $state/redis"
  fi
}

# ------------------------------------------------------------ minio

minio_up() {
  port_free_or_ours 9000 minio
  port_free_or_ours 9001 minio
  mkdir -p "$state/minio" "$state/mc"
  # MINIO_ROOT_USER and MINIO_ROOT_PASSWORD come exported from .env.
  start_bg minio minio server "$state/minio" --address 127.0.0.1:9000 --console-address 127.0.0.1:9001
  wait_for minio curl -fsS http://127.0.0.1:9000/minio/health/live
  # MC_CONFIG_DIR keeps the alias out of ~/.mc.
  export MC_CONFIG_DIR="$repo_root/$state/mc"
  mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  mc mb --ignore-existing "local/$MINIO_BUCKET" >/dev/null
  mc version enable "local/$MINIO_BUCKET" >/dev/null
  log "minio: 127.0.0.1:9000 (console 9001), bucket $MINIO_BUCKET versioned; mc alias 'local' with MC_CONFIG_DIR=$state/mc"
}

# ------------------------------------------------------------ mailpit and the stub

mailpit_up() {
  port_free_or_ours 8025 mailpit
  port_free_or_ours 1025 mailpit
  mkdir -p "$state/mailpit"
  start_bg mailpit mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 \
    --database "$state/mailpit/mailpit.db"
  wait_for mailpit curl -fsS http://127.0.0.1:8025/readyz
  log "mailpit: UI and API 127.0.0.1:8025, SMTP 127.0.0.1:1025"
}

stub_up() {
  port_free_or_ours 8080 whatsapp-stub
  start_bg whatsapp-stub env WHATSAPP_STUB_HOST=127.0.0.1 WHATSAPP_STUB_PORT=8080 \
    WHATSAPP_STUB_LOG="$repo_root/$state/whatsapp-stub/sent.jsonl" \
    node tools/whatsapp-stub/server.mjs
  wait_for whatsapp-stub curl -fsS http://127.0.0.1:8080/health
  log "whatsapp-stub: 127.0.0.1:8080"
}

# ------------------------------------------------------------ commands

status() {
  local mode=none name
  [[ -f $state/postgres.mode ]] && mode=$(cat "$state/postgres.mode")
  if [[ $mode == dedicated ]] && "$pg_bin/pg_ctl" -D "$pg_data" status >/dev/null 2>&1; then
    log "postgres       running   dedicated cluster, 127.0.0.1:$pg_port"
  elif [[ $mode == database ]]; then
    log "postgres       database mode on your server, 127.0.0.1:$pg_port ($(listening "$pg_port" && echo up || echo down))"
  else
    log "postgres       stopped"
  fi
  if pid_alive "$run/redis.pid"; then
    log "redis          running   started here, pid $(cat "$run/redis.pid")"
  elif listening 6379; then
    log "redis          running   not ours (reused)"
  else
    log "redis          stopped"
  fi
  for name in minio mailpit whatsapp-stub; do
    if pid_alive "$run/$name.pid"; then
      printf '%-14s running   pid %s\n' "$name" "$(cat "$run/$name.pid")"
    else
      printf '%-14s stopped\n' "$name"
    fi
  done
}

down() {
  stop_pid whatsapp-stub
  stop_pid mailpit
  stop_pid minio
  if pid_alive "$run/redis.pid"; then
    redis-cli -h 127.0.0.1 -p 6379 shutdown nosave >/dev/null 2>&1 || true
    stop_pid redis
  fi
  rm -f "$run/redis.pid"
  postgres_down
}

[[ $# -eq 1 ]] || usage
case $1 in
  up)
    load_env
    require "$pg_bin/psql" "$pg_bin/initdb" "$pg_bin/pg_ctl" redis-server redis-cli minio mc mailpit node curl lsof
    mkdir -p "$run"
    postgres_up
    redis_up
    minio_up
    mailpit_up
    stub_up
    ;;
  status)
    status
    ;;
  down)
    down
    ;;
  reset)
    load_env
    down
    postgres_reset
    rm -rf "$state"
    log "removed $state"
    ;;
  *)
    usage
    ;;
esac
