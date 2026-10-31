# cloudplay-pve: el despliegue de CloudPlay en Proxmox VE, empaquetado en GHCR.
#
# En el host de Proxmox NO hace falta Docker: get.sh baja esta imagen de ghcr.io (comprobando el SHA256 de cada
# capa) y ejecuta su script directamente en el host, que es donde están qm y pvesh:
#   curl -fsSL https://github.com/fieropirata275/CloudPlay/releases/latest/download/get.sh | bash -s -- proxmox cluster --nodes 3
# Con Docker en otra máquina solo sirve para ver la ayuda: docker run --rm ghcr.io/fieropirata275/cloudplay-pve
FROM alpine:3.20
RUN apk add --no-cache bash curl jq coreutils
ARG VERSION=dev
COPY cloudplay-pve.sh /cloudplay-pve/cloudplay-pve.sh
RUN echo "$VERSION" > /cloudplay-pve/VERSION && chmod 755 /cloudplay-pve/cloudplay-pve.sh
ENTRYPOINT ["/cloudplay-pve/cloudplay-pve.sh"]
CMD ["help"]
