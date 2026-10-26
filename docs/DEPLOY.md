# Desplegar CloudPlay

Dos tipos de máquina:

| Rol | Qué lleva | Cuántas |
|---|---|---|
| **Orquestador (master)** | API (2 réplicas), Postgres, Redis, S3 de partidas guardadas, web, Cloudflare Tunnel | 1 (o Kubernetes) |
| **Nodo gaming (slave)** | Agente + un contenedor por partida (emulador, GPU, WebRTC) | Las que necesites, añadir y quitar en caliente |

Todo arranca con una animación que dice qué es cada máquina (orquestador, nodo gaming o ambos) y
la consola muestra el rol, la IP y la URL.

### Todo sale de GitHub, gratis

Cada versión publicada en GitHub trae el código (Release, verificado con SHA256) y las imágenes ya compiladas
en GHCR (`ghcr.io/fieropirata275/cloudplay-{control-plane,agent,session,web}`). Un único comando vale para todo:

```bash
GET="curl -fsSL https://github.com/fieropirata275/cloudplay/releases/latest/download/get.sh"
$GET | sudo bash -s -- orchestrator --domain play.empresa.com            # orquestador
$GET | sudo bash -s -- node --cp-url https://play.empresa.com --join-token T  # nodo gaming
$GET | sudo bash -s -- all --domain play.empresa.com                     # los dos en una máquina
$GET | sudo bash -s -- proxmox node-template --cp-url https://play.empresa.com --join-token T
$GET | sudo bash -s -- iso --role node --cp-url https://play.empresa.com --join-token T
$GET | bash -s -- helm --domain play.empresa.com --tunnel-token T        # Kubernetes
```

Fija una versión con `CLOUDPLAY_VERSION=v1.0.0` (por defecto, la última). `sudo cloudplay update` actualiza
sin cortes a la última Release. Para publicar una versión nueva: `git tag v1.1.0 && git push origin v1.1.0`
(GitHub Actions compila, sube las imágenes y crea la Release).

---

## Publicar al mundo en 2 pasos (Cloudflare Tunnel)

Sin abrir puertos, sin IP fija y con TLS de Cloudflare.

**Paso 1 · en Cloudflare (2 minutos)**

1. *Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared*. Copia el **token** que aparece.
2. En *Public hostnames* del túnel añade:

   | Hostname | Servicio |
   |---|---|
   | `play.empresa.com` | `HTTP` · `caddy:80` |
   | `www.empresa.com` (opcional, web comercial) | `HTTP` · `caddy:80` |
   | `s3.play.empresa.com` (si hay nodos en otras redes) | `HTTP` · `s3:8333` |

3. Para el vídeo sin puertos UDP: *Realtime → TURN → Create* y copia el **Key ID** y el **API token**.

**Paso 2 · en el servidor**

```bash
curl -fsSL https://github.com/fieropirata275/cloudplay/releases/latest/download/get.sh | sudo bash -s -- \
  orchestrator --domain play.empresa.com --tunnel-token <TOKEN> --cf-turn-key-id <KEY_ID> --cf-turn-token <API_TOKEN>
```

O, sin tocar la terminal, con la ISO (abajo) creada con esas mismas opciones.
Al acabar, el instalador enseña la URL, el administrador y **la línea para añadir nodos gaming**.

> Sin el TURN de Cloudflare el vídeo necesita que los nodos tengan su rango UDP accesible.
> Se puede añadir después: `sudo cloudplay turn-cloudflare <KEY_ID> <API_TOKEN>`.
> Y si ya tienes el orquestador instalado sin túnel: `sudo cloudplay tunnel <TOKEN>`.

---

## Opción A · ISO de Ubuntu que se instala sola

```bash
# Paso 1: crear la ISO (en cualquier Linux con xorriso; descarga y verifica Ubuntu 24.04 la primera vez)
./deploy/iso/build-iso.sh --role orchestrator --domain play.empresa.com --tunnel-token <TOKEN> \
  --cf-turn-key-id <KEY_ID> --cf-turn-token <API_TOKEN>
./deploy/iso/build-iso.sh --role node --cp-url https://play.empresa.com --join-token <TOKEN_DE_UNIÓN>

# Paso 2: arrancar la máquina con la ISO (USB con Rufus/Ventoy/dd, o súbela a Proxmox, VMware, Hyper-V)
```

- Instala Ubuntu Server 24.04, reinicia y en el primer arranque instala CloudPlay con su rol.
  Con GPU NVIDIA instala el driver, reinicia una vez y sigue solo.
- Pide **una única confirmación** antes de borrar el disco. Con `--unattended` no pregunta: útil para
  desplegar muchos nodos a la vez, peligroso en la máquina equivocada.
- Usuario `cloudplay` con contraseña generada (va en `cloudplay-<rol>-acceso.txt`) o tu clave SSH (`--ssh-key`).
- **La ISO lleva los tokens dentro: trátala como un secreto.**

## Opción B · Un comando en un Ubuntu ya instalado

```bash
# Orquestador
curl -fsSL https://github.com/fieropirata275/cloudplay/releases/latest/download/get.sh | sudo bash -s -- orchestrator --domain play.empresa.com [--tunnel-token ...]

# Nodo gaming: el orquestador sirve su propio instalador
curl -fsSL https://play.empresa.com/install/node.sh | sudo bash -s -- --join-token <TOKEN_DE_UNIÓN>
```

`sudo cloudplay node-command` en el orquestador imprime esa línea con el token ya puesto.

## Opción C · Proxmox VE (plantilla + clones)

```bash
# En el host de Proxmox
./deploy/proxmox/cloudplay-pve.sh orchestrator-vm --iso local:iso/cloudplay-orchestrator.iso
./deploy/proxmox/cloudplay-pve.sh node-template --cp-url https://play.empresa.com --join-token <TOKEN>
./deploy/proxmox/cloudplay-pve.sh scale 3 --gpu-pci 0000:01:00.0,0000:02:00.0,0000:03:00.0
./deploy/proxmox/cloudplay-pve.sh retire 9103 --cp-url https://play.empresa.com --admin-email A --admin-password P
```

- La plantilla es Ubuntu 24.04 cloud image + cloud-init: cada clon se llama `cloudplay-node-<vmid>`,
  se instala y **se da de alta solo** con el token de unión.
- `--gpu-pci` asigna una GPU en passthrough a cada clon (activa IOMMU en el host antes).
- Todas las VMs llevan `onboot=1`: vuelven solas cuando vuelve la luz al host.
- `retire` drena el nodo, espera a que terminen sus partidas y entonces borra la VM.

## Opción D · Kubernetes (Helm)

```bash
docker build -t registro/cloudplay-control-plane:1.0.0 control-plane
mkdir -p landing/out && docker build -f deploy/docker/web.Dockerfile -t registro/cloudplay-web:1.0.0 .
helm install cloudplay deploy/helm/cloudplay -n cloudplay --create-namespace \
  --set domain=play.empresa.com --set cloudflared.token=<TOKEN> \
  --set turn.cloudflareKeyId=<KEY_ID> --set turn.cloudflareApiToken=<API_TOKEN> \
  --set images.controlPlane=registro/cloudplay-control-plane:1.0.0 --set images.web=registro/cloudplay-web:1.0.0
```

- API y web con 2 réplicas, *rolling updates* sin indisponibilidad (`maxUnavailable: 0`), PodDisruptionBudget
  y reparto entre máquinas. Cloudflare Tunnel con 2 conectores.
- Postgres interno de 1 réplica para empezar; en producción usa uno gestionado o CloudNativePG con `postgres.externalUrl`.
- Los **nodos gaming** necesitan GPU, `uinput`, red del host y miles de puertos UDP: lo normal es tenerlos fuera
  del clúster (ISO, Proxmox o instalador). Si tus nodos de Kubernetes tienen Docker y GPU, `gaming.enabled=true`
  despliega el agente como DaemonSet en los que lleven la etiqueta `cloudplay.io/gaming=true`.

## Opción E · Autoescalado con n8n

`deploy/n8n/cloudplay-autoscale-proxmox.json` se importa en n8n (*Workflows → Import from file*):

1. Edita el nodo **Configuración**: URL y administrador de CloudPlay, URL y API token de Proxmox, plantilla y reglas
   (mínimo y máximo de nodos, huecos libres que quieres de colchón, webhook de avisos opcional).
2. Pulsa **Probar ahora** y mira qué decide. Actívalo y se ejecuta cada minuto:
   - **Sube**: hay gente en cola o quedan pocos huecos → clona la plantilla y la arranca (o reactiva un nodo drenado).
   - **Baja**: sobra capacidad → drena un nodo vacío; en la siguiente pasada, si sigue vacío, apaga y borra su VM.
   - **Avisa** al webhook de nodos caídos y de cada cambio.

---

## Sin cortes, con apagones y con cortes de red

| Situación | Qué pasa |
|---|---|
| Actualizar el orquestador | `sudo cloudplay update`: renueva las dos réplicas de la API de una en una; Caddy manda a la sana. |
| Actualizar un nodo | Las partidas abiertas siguen con la imagen vieja; el agente nuevo las adopta al volver. |
| Mantenimiento de un nodo | `sudo cloudplay drain --wait` (o *Drenar* en el panel): no recibe partidas nuevas y avisa cuando está vacío. |
| Añadir capacidad | Un nodo nuevo con el token de unión aparece solo en el panel, sin reiniciar nada. |
| Apagón del orquestador | Todo tiene `restart: always` + servicio systemd; Postgres se recupera con su WAL. Los nodos y los jugadores reconectan solos. |
| Apagón de un nodo | El orquestador lo marca caído y cierra sus partidas; el jugador recupera la partida desde el **autoguardado** (cada 5 minutos) en otro nodo. |
| Con SAI (NUT) | `cloudplay-ups`: con batería drena el nodo; con batería baja cierra y guarda todas las partidas antes de que NUT apague. |
| Se corta Internet | El agente reconecta con espera creciente; cloudflared reconecta solo y tiene 2 conectores; el cliente vuelve a enlazar el vídeo. |
| Copias de seguridad | Diarias a las 4:20 (base de datos, partidas guardadas y configuración), 7 días en `/var/backups/cloudplay`. `cloudplay restore`. |

## Comando `cloudplay`

```
status · logs [servicio] · update · backup · restore · credentials · join-token · node-command
tunnel TOKEN · turn-cloudflare ID TOKEN · drain [--wait] · resume · stop-sessions
```
