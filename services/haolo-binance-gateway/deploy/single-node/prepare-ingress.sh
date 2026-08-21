#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "prepare-ingress.sh must run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq haproxy certbot

install -d -o root -g root -m 0755 /var/lib/haolo/acme/.well-known/acme-challenge

cat >/etc/systemd/system/haolo-acme-web.service <<'EOF'
[Unit]
Description=Haolo ACME HTTP-01 webroot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nobody
Group=nogroup
ExecStart=/usr/bin/python3 -m http.server 8089 --bind 127.0.0.1 --directory /var/lib/haolo/acme
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/var/lib/haolo/acme

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now haolo-acme-web.service
systemctl disable --now haproxy.service >/dev/null 2>&1 || true

cat >/tmp/haolo-haproxy-connect-test.cfg <<'EOF'
global
  log stdout format raw local0

defaults
  log global
  mode http
  option httplog
  timeout connect 5s
  timeout client 15s
  timeout server 15s
  timeout tunnel 30s

frontend connect_test
  bind 127.0.0.1:18080
  default_backend private_proxy

backend private_proxy
  server gateway 127.0.0.1:8788 check
EOF

haproxy -c -f /tmp/haolo-haproxy-connect-test.cfg
haproxy -db -f /tmp/haolo-haproxy-connect-test.cfg >/tmp/haolo-haproxy-connect-test.log 2>&1 &
haproxy_pid=$!
trap 'kill "${haproxy_pid}" >/dev/null 2>&1 || true' EXIT
sleep 1

exec 3<>/dev/tcp/127.0.0.1/18080
printf 'CONNECT api.binance.com:443 HTTP/1.1\r\nHost: api.binance.com:443\r\n\r\n' >&3
IFS= read -r status_line <&3
exec 3>&-
status_line="${status_line%$'\r'}"
echo "HAProxy CONNECT test: ${status_line}"
if [[ "${status_line}" != "HTTP/1.1 407 Proxy Authentication Required" ]]; then
  echo "HAProxy did not preserve the CONNECT request" >&2
  exit 1
fi

kill "${haproxy_pid}"
wait "${haproxy_pid}" 2>/dev/null || true
trap - EXIT

curl --fail --silent --show-error http://127.0.0.1:8089/ >/dev/null
echo "Ingress prerequisites are ready"
