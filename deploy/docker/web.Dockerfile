# Cliente web (+ landing compilada) servido por Caddy, para Kubernetes.
#   mkdir -p landing/out        # vacía si no compilas la web comercial
#   docker build -f deploy/docker/web.Dockerfile -t cloudplay/web:TAG .
FROM caddy:2.8
COPY clients/web /srv/web
COPY landing/out /srv/landing
