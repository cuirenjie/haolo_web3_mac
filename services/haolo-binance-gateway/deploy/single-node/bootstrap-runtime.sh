#!/usr/bin/env bash
set -Eeuo pipefail

readonly HAOLO_ROOT="/opt/haolo"
readonly GATEWAY_ROOT="${HAOLO_ROOT}/services/haolo-binance-gateway"
readonly SECRETS_DIR="${HAOLO_ROOT}/secrets"
readonly RUNTIME_ENV="${SECRETS_DIR}/gateway-runtime.env"
readonly COMPOSE_FILE="${GATEWAY_ROOT}/deploy/single-node/docker-compose.production.yml"
readonly PRIVATE_PROXY_ORIGIN="${PRIVATE_PROXY_ORIGIN:-https://sg-a.binance-egress.waduo.com}"
readonly ACTIVE_GATEWAY_STATE="/var/lib/haolo/gateway-active.env"

if [[ "${EUID}" -ne 0 ]]; then
  echo "bootstrap-runtime.sh must run as root" >&2
  exit 1
fi

if [[ -s "${ACTIVE_GATEWAY_STATE}" ]]; then
  echo "an active gateway release exists at ${ACTIVE_GATEWAY_STATE}; refusing bootstrap overwrite" >&2
  exit 1
fi

if [[ ! "${PRIVATE_PROXY_ORIGIN}" =~ ^https://[^[:space:]/]+(:[0-9]+)?$ ]]; then
  echo "PRIVATE_PROXY_ORIGIN must be an HTTPS origin without a path" >&2
  exit 1
fi

install -d -m 0700 "${SECRETS_DIR}"

if [[ ! -s "${RUNTIME_ENV}" ]]; then
  umask 077
  jwt_secret="$(openssl rand -hex 32)"
  metrics_token="$(openssl rand -hex 32)"
  shard_hash_secret="$(openssl rand -hex 32)"

  cat >"${RUNTIME_ENV}" <<EOF
NODE_ENV=production
HAOLO_GATEWAY_ROLE=all
HAOLO_GATEWAY_JWT_SECRET=${jwt_secret}
HAOLO_GATEWAY_JWT_ISSUER=
HAOLO_GATEWAY_JWT_AUDIENCE=
HAOLO_AUTH_API_ORIGIN=https://haolo.com
HAOLO_AUTH_PROFILE_PATH=/api/auth/me
HAOLO_AUTH_REQUEST_TIMEOUT_MS=5000
HAOLO_AUTH_CACHE_TTL_MS=15000
HAOLO_GATEWAY_JWT_AUDIENCE=haolo-binance-gateway
HAOLO_GATEWAY_METRICS_TOKEN=${metrics_token}
HAOLO_PRIVATE_SHARD_HASH_SECRET=${shard_hash_secret}
HAOLO_MARKET_GATEWAY_HOST=0.0.0.0
HAOLO_MARKET_GATEWAY_PORT=8787
HAOLO_MARKET_REDIS_URL=redis://redis:6379/0
HAOLO_GATEWAY_ALLOW_ANONYMOUS_PUBLIC=false
HAOLO_GATEWAY_TRUST_PROXY=true
HAOLO_MARKET_REQUESTS_PER_MINUTE=300
HAOLO_MARKET_MAX_SUBSCRIPTIONS_PER_CLIENT=50
HAOLO_MARKET_MAX_STREAMS_PER_UPSTREAM=300
HAOLO_MARKET_MAX_WS_CLIENTS_PER_USER=8
HAOLO_MARKET_MAX_WS_CLIENTS_TOTAL=10000
HAOLO_PRIVATE_PROXY_HOST=0.0.0.0
HAOLO_PRIVATE_PROXY_PORT=8788
HAOLO_PRIVATE_PROXY_MAX_CONNECTIONS_PER_USER=6
HAOLO_PRIVATE_PROXY_CONNECTS_PER_MINUTE=60
HAOLO_PRIVATE_PROXY_IDLE_TIMEOUT_MS=180000
HAOLO_PRIVATE_PROXY_MAX_TUNNEL_MS=30000
HAOLO_PRIVATE_PROXY_ALLOWED_HOSTS=api.binance.com,fapi.binance.com
HAOLO_PRIVATE_PROXY_ALLOW_LEGACY_JWT=false
HAOLO_PRIVATE_EGRESS_SHARD_ID=sg-a
HAOLO_PRIVATE_EGRESS_SHARDS_JSON=[{"id":"sg-a","proxyUrl":"${PRIVATE_PROXY_ORIGIN}","spotWeightLimitPerMinute":6000,"futuresWeightLimitPerMinute":2400,"enabled":true}]
HAOLO_PRIVATE_PERMIT_TTL_MS=15000
HAOLO_PRIVATE_TOTAL_SAFETY_PERCENT=60
HAOLO_PRIVATE_BACKGROUND_SAFETY_PERCENT=35
HAOLO_PRIVATE_USER_SPOT_WEIGHT_PER_MINUTE=120
HAOLO_PRIVATE_USER_FUTURES_WEIGHT_PER_MINUTE=240
HAOLO_PRIVATE_PROXY_ALLOW_INSECURE=true
EOF

  unset jwt_secret metrics_token shard_hash_secret
fi

chown root:root "${RUNTIME_ENV}"
chmod 0600 "${RUNTIME_ENV}"

docker compose -f "${COMPOSE_FILE}" config --quiet
docker compose -f "${COMPOSE_FILE}" up -d --no-build
docker compose -f "${COMPOSE_FILE}" ps
