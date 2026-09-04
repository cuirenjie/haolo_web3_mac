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

if [[ ! -s "${ACTIVE_STATE}" || ! -r "${ACTIVE_STATE}" ]]; then
  echo "Active gateway state is missing or unreadable; refusing legacy fallback" >&2
  exit 1
fi
# Never source state as shell code, and do not silently choose one of duplicate
# fields. Validate the complete target before health checks or any restart.
active_public_port="$(sed -n 's/^PUBLIC_PORT=//p' "${ACTIVE_STATE}")"
active_private_port="$(sed -n 's/^PRIVATE_PORT=//p' "${ACTIVE_STATE}")"
active_container="$(sed -n 's/^CONTAINER=//p' "${ACTIVE_STATE}")"
if [[ ! "${active_public_port}" =~ ^[1-9][0-9]{0,4}$ \
   || ! "${active_private_port}" =~ ^[1-9][0-9]{0,4}$ \
   || ! "${active_container}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  echo "Active gateway state is incomplete or invalid; refusing legacy fallback" >&2
  exit 1
fi
if (( active_public_port > 65535 || active_private_port > 65535 || active_public_port == active_private_port )); then
  echo "Active gateway ports are invalid; refusing legacy fallback" >&2
  exit 1
fi
if ! docker inspect "${active_container}" >/dev/null 2>&1; then
  echo "Active gateway container ${active_container} is missing; refusing legacy fallback" >&2
  exit 1
fi

ready() {
  curl --fail --silent --show-error --max-time 4 "http://127.0.0.1:${active_public_port}/ready" >/dev/null \
    && curl --fail --silent --show-error --max-time 4 "http://127.0.0.1:${active_private_port}/ready" >/dev/null
}

restart_active() {
  if docker inspect "${active_container}" >/dev/null 2>&1; then
    docker restart "${active_container}"
    return
  fi
  echo "Active gateway container ${active_container} is missing; refusing legacy fallback" >&2
  return 1
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
