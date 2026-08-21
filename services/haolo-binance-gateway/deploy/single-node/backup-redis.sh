#!/usr/bin/env bash
set -Eeuo pipefail

readonly COMPOSE_DIR="/opt/haolo/services/haolo-binance-gateway"
readonly COMPOSE_FILE="${COMPOSE_DIR}/deploy/single-node/docker-compose.production.yml"
readonly RUNTIME_ENV="/opt/haolo/secrets/gateway-runtime.env"
readonly BACKUP_DIR="/opt/haolo/backups/redis"
readonly RETENTION_DAYS=7

mkdir -p "${BACKUP_DIR}"
chmod 0700 "${BACKUP_DIR}"

cd "${COMPOSE_DIR}"
redis_container="$(docker compose --env-file "${RUNTIME_ENV}" -f "${COMPOSE_FILE}" ps -q redis)"
if [[ -z "${redis_container}" ]]; then
  echo "Redis container is not running" >&2
  exit 1
fi

before_save="$(docker exec "${redis_container}" redis-cli LASTSAVE)"
save_result="$(docker exec "${redis_container}" redis-cli BGSAVE 2>&1 || true)"
if [[ "${save_result}" != "Background saving started" && "${save_result}" != "Background saving scheduled" ]]; then
  echo "Redis BGSAVE failed: ${save_result}" >&2
  exit 1
fi

for _ in $(seq 1 60); do
  in_progress="$(docker exec "${redis_container}" redis-cli --raw INFO persistence | sed -n 's/^rdb_bgsave_in_progress:\([0-9]\)\r\{0,1\}$/\1/p')"
  after_save="$(docker exec "${redis_container}" redis-cli LASTSAVE)"
  if [[ "${in_progress}" == "0" && "${after_save}" -ge "${before_save}" ]]; then
    break
  fi
  sleep 1
done

if [[ "${in_progress:-1}" != "0" ]]; then
  echo "Redis BGSAVE did not finish within 60 seconds" >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${BACKUP_DIR}/redis-${timestamp}.rdb"
docker cp "${redis_container}:/data/dump.rdb" "${backup_file}.partial"
chmod 0600 "${backup_file}.partial"
mv "${backup_file}.partial" "${backup_file}"
sha256sum "${backup_file}" > "${backup_file}.sha256"
chmod 0600 "${backup_file}.sha256"

find "${BACKUP_DIR}" -xdev -type f \
  \( -name 'redis-*.rdb' -o -name 'redis-*.rdb.sha256' \) \
  -mtime "+${RETENTION_DAYS}" -delete

echo "Redis backup completed: ${backup_file}"
