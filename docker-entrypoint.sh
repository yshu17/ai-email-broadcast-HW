#!/bin/sh
set -e

# Migrations are NOT applied on every start: with several replicas they would race each other.
# Run them once per deploy, as their own step (the `migrate` service in compose.yaml, or
# `node dist-scripts/migrate.cjs`). A single-container deployment can opt in with AUTO_MIGRATE=true;
# the migrations are idempotent, so a repeat is harmless, but two containers must not do it at once.
if [ "$AUTO_MIGRATE" = "true" ]; then
  echo "[boot] applying database migrations"
  node dist-scripts/migrate.cjs
fi

# A single-container deployment has no external cron and no worker service, so it can ask for the
# ticker to run beside the web server. The ticker is a plain HTTP client of the worker endpoint and
# holds no state (every schedule and the queue live in Postgres), so if it ever exits, starting it
# again loses nothing: the next tick finds whatever came due. With the worker as its own service
# (see compose.yaml), leave this off.
if [ "$RUN_INTERNAL_WORKER" = "true" ]; then
  echo "[boot] starting internal worker ticker"
  (
    while true; do
      node dist-scripts/worker-loop.cjs || true
      echo "[boot] worker ticker exited; restarting in 5s"
      sleep 5
    done
  ) &
fi

# exec: the command becomes this process's replacement, so it receives the stop signal itself.
exec "$@"
