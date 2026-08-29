#!/usr/bin/env bash
set -Eeuo pipefail

readonly COMPOSE_DIR="/opt/haolo/services/haolo-binance-gateway"
readonly COMPOSE_FILE="${COMPOSE_DIR}/deploy/single-node/docker-compose.production.yml"
readonly RUNTIME_ENV="/opt/haolo/secrets/gateway-runtime.env"

ready() {
  curl --fail --silent --show-error --max-time 4 http://127.0.0.1:8787/ready >/dev/null \
    && curl --fail --silent --show-error --max-time 4 http://127.0.0.1:8788/ready >/dev/null
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
  echo "Redis health is ${redis_health}; restarting Redis and gateway" >&2
  docker compose --env-file "${RUNTIME_ENV}" -f "${COMPOSE_FILE}" restart redis gateway
else
  echo "Gateway readiness failed while Redis is healthy; restarting gateway" >&2
  docker compose --env-file "${RUNTIME_ENV}" -f "${COMPOSE_FILE}" restart gateway
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
