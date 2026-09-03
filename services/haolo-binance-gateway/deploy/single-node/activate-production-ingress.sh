#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "activate-production-ingress.sh must run as root" >&2
  exit 1
fi

# This script is the one-time ingress bootstrap. Once a rolling release has
# recorded an active gateway, regenerating HAProxy from the bootstrap ports
# would silently move traffic back to the legacy instance. Fail closed and use
# the release procedure instead.
ACTIVE_GATEWAY_STATE="/var/lib/haolo/gateway-active.env"
if [[ -s "${ACTIVE_GATEWAY_STATE}" ]]; then
  echo "an active gateway release exists at ${ACTIVE_GATEWAY_STATE}; refusing bootstrap overwrite" >&2
  exit 1
fi

PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-market.youle.pro}"
PRIVATE_DOMAIN="${PRIVATE_DOMAIN:-sg-a.binance-egress.waduo.com}"
CERT_NAME="${CERT_NAME:-haolo-binance-gateway}"
MANAGEMENT_IPV4_CIDRS="${MANAGEMENT_IPV4_CIDRS:-120.229.21.115/32 133.169.10.18/32}"
SSH_DROPIN="/etc/ssh/sshd_config.d/99-codex-temp.conf"
HAPROXY_CONFIG="/etc/haproxy/haproxy.cfg"
CERT_PEM="/etc/haproxy/certs/${CERT_NAME}.pem"
RUNTIME_ENV="/opt/haolo/secrets/gateway-runtime.env"
COMPOSE_FILE="/opt/haolo/services/haolo-binance-gateway/deploy/single-node/docker-compose.production.yml"
STATE_DIR="/var/lib/haolo/ingress-activation"

for domain in "${PUBLIC_DOMAIN}" "${PRIVATE_DOMAIN}"; do
  if [[ ! "${domain}" =~ ^[a-z0-9.-]+$ ]]; then
    echo "invalid domain: ${domain}" >&2
    exit 1
  fi
done

install -d -o root -g root -m 0700 "${STATE_DIR}"
install -d -o root -g root -m 0700 /etc/haproxy/certs
install -d -o root -g root -m 0755 /var/lib/haolo/acme/.well-known/acme-challenge

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
ssh_backup="${STATE_DIR}/sshd-${timestamp}.conf"
haproxy_backup="${STATE_DIR}/haproxy-${timestamp}.cfg"
if [[ -f "${SSH_DROPIN}" ]]; then
  cp -a "${SSH_DROPIN}" "${ssh_backup}"
else
  : >"${ssh_backup}.missing"
fi
if [[ -f "${HAPROXY_CONFIG}" ]]; then
  cp -a "${HAPROXY_CONFIG}" "${haproxy_backup}"
else
  : >"${haproxy_backup}.missing"
fi

rollback() {
  local exit_code=$?
  trap - ERR
  echo "Ingress activation failed; restoring SSH access" >&2
  systemctl stop haproxy.service >/dev/null 2>&1 || true
  if [[ -f "${ssh_backup}.missing" ]]; then
    rm -f "${SSH_DROPIN}"
  else
    cp -a "${ssh_backup}" "${SSH_DROPIN}"
  fi
  if [[ -f "${haproxy_backup}.missing" ]]; then
    rm -f "${HAPROXY_CONFIG}"
  else
    cp -a "${haproxy_backup}" "${HAPROXY_CONFIG}"
  fi
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl restart ssh.socket >/dev/null 2>&1 || true
  systemctl restart ssh.service >/dev/null 2>&1 || true
  exit "${exit_code}"
}
trap rollback ERR

management_acl=""
for cidr in ${MANAGEMENT_IPV4_CIDRS}; do
  management_acl+=" ${cidr}"
done

write_base_config() {
  cat >"${HAPROXY_CONFIG}" <<EOF
global
  log /dev/log local0
  log /dev/log local1 notice
  user haproxy
  group haproxy
  daemon
  maxconn 20000
  stats socket /run/haproxy/admin.sock mode 660 level admin expose-fd listeners
  ssl-default-bind-options ssl-min-ver TLSv1.2

defaults
  log global
  option dontlognull
  timeout connect 5s
  timeout client 60s
  timeout server 60s
  timeout http-request 15s
  timeout http-keep-alive 15s
  timeout tunnel 26h
  timeout client-fin 30s
  timeout server-fin 30s

frontend public_port_80
  bind :80
  mode tcp
  tcp-request inspect-delay 5s
  tcp-request content accept if { req.len gt 0 }
  acl is_ssh payload(0,4) -m str SSH-
  acl management_source src${management_acl}
  tcp-request content reject if is_ssh !management_source
  use_backend local_ssh if is_ssh management_source
  default_backend local_http_router

backend local_ssh
  mode tcp
  server sshd 127.0.0.1:22 check

backend local_http_router
  mode tcp
  server http_router 127.0.0.1:18080 check

frontend internal_http_router
  bind 127.0.0.1:18080
  mode http
  option httplog
  acl acme_challenge path_beg /.well-known/acme-challenge/
  http-request redirect scheme https code 308 unless acme_challenge
  use_backend acme_web if acme_challenge

backend acme_web
  mode http
  server acme 127.0.0.1:8089 check
EOF
}

append_https_config() {
  cat >>"${HAPROXY_CONFIG}" <<EOF

frontend public_tls_gateway
  bind :443 ssl crt ${CERT_PEM} alpn h2,http/1.1
  mode http
  option httplog
  option http-keep-alive
  acl public_sni ssl_fc_sni -i ${PUBLIC_DOMAIN}
  acl private_sni ssl_fc_sni -i ${PRIVATE_DOMAIN}
  http-request deny deny_status 421 unless public_sni or private_sni
  http-request set-header X-Forwarded-Proto https
  http-request set-header X-Forwarded-For %[src]
  http-request set-header X-Real-IP %[src]
  use_backend public_gateway if public_sni
  use_backend private_gateway if private_sni

backend public_gateway
  mode http
  option httpchk GET /ready
  http-check expect status 200
  server gateway_public 127.0.0.1:8787 check

backend private_gateway
  mode http
  option httpchk GET /ready
  http-check expect status 200
  server gateway_private 127.0.0.1:8788 check
EOF
}

write_base_config
haproxy -c -f "${HAPROXY_CONFIG}"

# Free public ports 80/443 from sshd while keeping port 22 for the cloud console
# and the security-group-restricted management path.
printf 'Port 22\n' >"${SSH_DROPIN}"
chmod 0644 "${SSH_DROPIN}"
sshd -t
systemctl daemon-reload
systemctl restart ssh.socket
systemctl restart ssh.service
systemctl enable --now haproxy.service

curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8089/ >/dev/null
curl --fail --silent --show-error --max-time 5 -H "Host: ${PUBLIC_DOMAIN}" http://127.0.0.1:18080/.well-known/acme-challenge/ >/dev/null

certbot certonly \
  --cert-name "${CERT_NAME}" \
  --webroot -w /var/lib/haolo/acme \
  --preferred-challenges http \
  --non-interactive --agree-tos --register-unsafely-without-email \
  --keep-until-expiring --expand \
  -d "${PUBLIC_DOMAIN}" -d "${PRIVATE_DOMAIN}"

cat "/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem" "/etc/letsencrypt/live/${CERT_NAME}/privkey.pem" >"${CERT_PEM}"
chown root:root "${CERT_PEM}"
chmod 0600 "${CERT_PEM}"

write_base_config
append_https_config
haproxy -c -f "${HAPROXY_CONFIG}"
systemctl reload haproxy.service

cat >/etc/letsencrypt/renewal-hooks/deploy/haolo-haproxy-cert.sh <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
cat /etc/letsencrypt/live/${CERT_NAME}/fullchain.pem /etc/letsencrypt/live/${CERT_NAME}/privkey.pem >${CERT_PEM}.new
chown root:root ${CERT_PEM}.new
chmod 0600 ${CERT_PEM}.new
mv ${CERT_PEM}.new ${CERT_PEM}
haproxy -c -f ${HAPROXY_CONFIG}
systemctl reload haproxy.service
EOF
chmod 0750 /etc/letsencrypt/renewal-hooks/deploy/haolo-haproxy-cert.sh

python3 - "${RUNTIME_ENV}" "${PRIVATE_DOMAIN}" <<'PY'
import json
import os
import sys
import tempfile

path, private_domain = sys.argv[1:]
updates = {
    "HAOLO_PRIVATE_EGRESS_SHARDS_JSON": json.dumps([{
        "id": "sg-a",
        "proxyUrl": f"https://{private_domain}",
        "spotWeightLimitPerMinute": 6000,
        "futuresWeightLimitPerMinute": 2400,
        "enabled": True,
    }], separators=(",", ":")),
    "HAOLO_PRIVATE_EGRESS_SHARD_ID": "sg-a",
    "HAOLO_PRIVATE_PROXY_ALLOW_INSECURE": "true",
    "HAOLO_GATEWAY_TRUST_PROXY": "true",
}

with open(path, "r", encoding="utf-8") as handle:
    original = handle.read().splitlines()

written = set()
result = []
for line in original:
    key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
    if key in updates:
        if key not in written:
            result.append(f"{key}={updates[key]}")
            written.add(key)
    else:
        result.append(line)
for key, value in updates.items():
    if key not in written:
        result.append(f"{key}={value}")

directory = os.path.dirname(path)
fd, temporary = tempfile.mkstemp(prefix="gateway-runtime.", dir=directory, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(result) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.chown(temporary, 0, 0)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY

chmod 0644 "${COMPOSE_FILE}"
docker compose -f "${COMPOSE_FILE}" up -d --force-recreate gateway

gateway_ready=0
trap - ERR
for _ in $(seq 1 60); do
  public_ready=1
  private_ready=1
  if curl --fail --silent --max-time 3 http://127.0.0.1:8787/ready >/dev/null 2>&1; then
    public_ready=0
  fi
  if curl --fail --silent --max-time 3 http://127.0.0.1:8788/ready >/dev/null 2>&1; then
    private_ready=0
  fi
  if [[ ${public_ready} -eq 0 && ${private_ready} -eq 0 ]]; then
    gateway_ready=1
    break
  fi
  sleep 2
done
trap rollback ERR
if [[ ${gateway_ready} -ne 1 ]]; then
  echo "gateway did not become ready within 120 seconds" >&2
  false
fi
https_ready=0
trap - ERR
for _ in $(seq 1 60); do
  public_https_ready=1
  private_https_ready=1
  if curl --fail --silent --max-time 5 --resolve "${PUBLIC_DOMAIN}:443:127.0.0.1" "https://${PUBLIC_DOMAIN}/ready" >/dev/null 2>&1; then
    public_https_ready=0
  fi
  if curl --fail --silent --max-time 5 --resolve "${PRIVATE_DOMAIN}:443:127.0.0.1" "https://${PRIVATE_DOMAIN}/ready" >/dev/null 2>&1; then
    private_https_ready=0
  fi
  if [[ ${public_https_ready} -eq 0 && ${private_https_ready} -eq 0 ]]; then
    https_ready=1
    break
  fi
  sleep 2
done
trap rollback ERR
if [[ ${https_ready} -ne 1 ]]; then
  echo "HTTPS ingress did not become ready within 120 seconds" >&2
  false
fi

systemctl enable --now certbot.timer >/dev/null
systemctl is-active --quiet haproxy.service
systemctl is-active --quiet certbot.timer
trap - ERR
echo "PRODUCTION_INGRESS_READY public=${PUBLIC_DOMAIN} private=${PRIVATE_DOMAIN}"
