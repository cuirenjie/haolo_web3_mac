#!/usr/bin/env bash
set -Eeuo pipefail

readonly COMPOSE_FILE="/opt/haolo/services/haolo-binance-gateway/deploy/single-node/docker-compose.production.yml"
readonly RUNTIME_ENV="/opt/haolo/secrets/gateway-runtime.env"

docker compose -f "${COMPOSE_FILE}" ps

echo "PUBLIC_READY"
curl --fail --silent --show-error \
  --retry 20 --retry-all-errors --retry-delay 1 --max-time 5 \
  http://127.0.0.1:8787/ready
echo

echo "PRIVATE_READY"
curl --fail --silent --show-error \
  --retry 20 --retry-all-errors --retry-delay 1 --max-time 5 \
  http://127.0.0.1:8788/ready
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
exec 3<>/dev/tcp/127.0.0.1/8788
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
