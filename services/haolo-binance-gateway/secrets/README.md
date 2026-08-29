# TLS files

`docker-compose.tls.yml` expects the private proxy certificate chain at `tls.crt`
and its private key at `tls.key`. These files are deployment secrets and must not
be committed. The certificate SAN must match the desktop client's private proxy
hostname.
