#!/usr/bin/env bash
set -Eeuo pipefail

readonly COMPOSE_DIR="/opt/haolo/services/haolo-binance-gateway"
readonly COMPOSE_FILE="${COMPOSE_DIR}/deploy/single-node/docker-compose.production.yml"
readonly RUNTIME_ENV="/opt/haolo/secrets/gateway-runtime.env"
readonly DEPLOY_LOCK="/run/lock/haolo-gateway-deploy.lock"
readonly ACTIVE_STATE="/var/lib/haolo/gateway-active.env"

# A release owns this same advisory lock while it prepares, switches and
# retires an instance.  Skipping one watchdog tick is safer than letting the
# old Compose service recreate itself over a candidate or a draining socket.
install -d -m 0755 "$(dirname "${DEPLOY_LOCK}")"
exec 9>"${DEPLOY_LOCK}"
if ! flock -n 9; then
  echo "Gateway deployment lock is held; skipping watchdog run"
  exit 0
fi

active_public_port=8787
active_private_port=8788
active_container=""
if [[ -r "${ACTIVE_STATE}" ]]; then
  # The state file is root-owned and contains only validated scalar values.
  # Never source it as shell code.
  value="$(sed -n 's/^PUBLIC_PORT=\([0-9][0-9]*\)$/\1/p' "${ACTIVE_STATE}" | head -n 1)"
  [[ "${value}" =~ ^[0-9]{1,5}$ ]] && active_public_port="${value}"
  value="$(sed -n 's/^PRIVATE_PORT=\([0-9][0-9]*\)$/\1/p' "${ACTIVE_STATE}" | head -n 1)"
  [[ "${value}" =~ ^[0-9]{1,5}$ ]] && active_private_port="${value}"
  active_container="$(sed -n 's/^CONTAINER=\([A-Za-z0-9_.-][A-Za-z0-9_.-]*\)$/\1/p' "${ACTIVE_STATE}" | head -n 1)"
fi

ready() {
  curl --fail --silent --show-error --max-time 4 "http://127.0.0.1:${active_public_port}/ready" >/dev/null \
    && curl --fail --silent --show-error --max-time 4 "http://127.0.0.1:${active_private_port}/ready" >/dev/null
}

restart_active() {
  if [[ -n "${active_container}" ]] && docker inspect "${active_container}" >/dev/null 2>&1; then
    docker restart "${active_container}"
    return
  fi
  if [[ -n "${active_container}" ]]; then
    echo "Active gateway container ${active_container} is missing; refusing legacy fallback" >&2
    return 1
  fi
  docker compose --env-file "${RUNTIME_ENV}" -f "${COMPOSE_FILE}" restart gateway
}

if ready; then
  exit 0
fi

sleep 5
if ready; then
  exit 0
fi

cd "${COMPOSE_DIR}"
redis_container="$(docker compose --env-file "${RUNTIME_ENV}" -f "${COMPOSE_FILE}" ps -q redis)"
redis_health="unknown"
if [[ -n "${redis_container}" ]]; then
  redis_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${redis_container}")"
fi

if [[ "${redis_health}" != "healthy" ]]; then
  echo "Redis health is ${redis_health}; restarting Redis and active gateway" >&2
  docker compose --env-file "${RUNTIME_ENV}" -f "${COMPOSE_FILE}" restart redis
  restart_active
else
  echo "Gateway readiness failed while Redis is healthy; restarting active gateway" >&2
  restart_active
fi

for _ in $(seq 1 30); do
  if ready; then
    echo "Gateway readiness recovered"
    exit 0
  fi
  sleep 1
done

echo "Gateway readiness did not recover after restart" >&2
exit 1
