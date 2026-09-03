#!/usr/bin/env bash
set -Eeuo pipefail

readonly COMPOSE_FILE="/opt/haolo/services/haolo-binance-gateway/deploy/single-node/docker-compose.production.yml"
readonly RUNTIME_ENV="/opt/haolo/secrets/gateway-runtime.env"
readonly ACTIVE_STATE="/var/lib/haolo/gateway-active.env"

public_port=8787
private_port=8788
active_container=""
if [[ -r "${ACTIVE_STATE}" ]]; then
  value="$(sed -n 's/^PUBLIC_PORT=\([0-9][0-9]*\)$/\1/p' "${ACTIVE_STATE}" | head -n 1)"
  [[ "${value}" =~ ^[0-9]{1,5}$ ]] && public_port="${value}"
  value="$(sed -n 's/^PRIVATE_PORT=\([0-9][0-9]*\)$/\1/p' "${ACTIVE_STATE}" | head -n 1)"
  [[ "${value}" =~ ^[0-9]{1,5}$ ]] && private_port="${value}"
  active_container="$(sed -n 's/^CONTAINER=\([A-Za-z0-9_.-][A-Za-z0-9_.-]*\)$/\1/p' "${ACTIVE_STATE}" | head -n 1)"
fi

docker compose -f "${COMPOSE_FILE}" ps
echo "ACTIVE_GATEWAY"
if [[ -n "${active_container}" ]] && docker inspect "${active_container}" >/dev/null 2>&1; then
  docker inspect -f '{{.Name}} image={{.Config.Image}} status={{.State.Status}} restarts={{.RestartCount}} restart={{.HostConfig.RestartPolicy.Name}} started={{.State.StartedAt}}' "${active_container}"
else
  echo "No active gateway container is recorded"
fi

echo "PUBLIC_READY"
curl --fail --silent --show-error \
  --retry 20 --retry-all-errors --retry-delay 1 --max-time 5 \
  "http://127.0.0.1:${public_port}/ready"
echo

echo "PRIVATE_READY"
curl --fail --silent --show-error \
  --retry 20 --retry-all-errors --retry-delay 1 --max-time 5 \
  "http://127.0.0.1:${private_port}/ready"
echo

echo "BINANCE_SPOT"
curl --silent --show-error --max-time 10 \
  --output /tmp/binance-spot.out \
  --write-out '%{http_code} %{time_total}\n' \
  https://api.binance.com/api/v3/time
head -c 300 /tmp/binance-spot.out
echo

echo "BINANCE_FUTURES"
curl --silent --show-error --max-time 10 \
  --output /tmp/binance-futures.out \
  --write-out '%{http_code} %{time_total}\n' \
  https://fapi.binance.com/fapi/v1/time
head -c 300 /tmp/binance-futures.out
echo

echo "UNAUTH_CONNECT"
exec 3<>/dev/tcp/127.0.0.1/${private_port}
printf 'CONNECT api.binance.com:443 HTTP/1.1\r\nHost: api.binance.com:443\r\n\r\n' >&3
IFS= read -r connect_status_line <&3
exec 3>&-
connect_status_line="${connect_status_line%$'\r'}"
echo "${connect_status_line}"
if [[ "${connect_status_line}" != "HTTP/1.1 407 Proxy Authentication Required" ]]; then
  echo "Expected unauthenticated CONNECT to return 407" >&2
  exit 1
fi

stat -c 'SECRET_MODE=%a SECRET_OWNER=%U:%G' "${RUNTIME_ENV}"
echo "SECRET_KEYS"
cut -d= -f1 "${RUNTIME_ENV}"
