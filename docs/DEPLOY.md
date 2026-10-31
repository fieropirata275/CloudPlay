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

## Publicar al mundo en un comando (Cloudflare, desde el máster)

En la consola del máster (también vale si está en modo red local, p. ej. el que crea el clúster de Proxmox):

```bash
sudo cloudplay cloudflare
```

Pide dos cosas: un **token de API de Cloudflare** y el **nombre** de la plataforma (`play.tudominio.com`, de un dominio
que ya tengas en Cloudflare). El token se crea en *Mi perfil → Tokens de API → Crear token personalizado* con:

| Permiso | Para qué |
|---|---|
| Cuenta · Cloudflare Tunnel · Editar | crear el túnel y sus rutas |
| Zona · DNS · Editar · y · Zona · Zona · Leer | los registros DNS (y los del correo) |
| Cuenta · Calls · Editar (recomendado) | TURN: que el vídeo llegue a jugadores de cualquier red sin abrir puertos UDP |

Con eso crea el túnel gestionado desde Cloudflare, sus rutas (`play…` → web, `s3.play…` → partidas guardadas), los
CNAME con proxy, una clave TURN, y pasa el máster a modo túnel **sin cortar partidas**. La red local sigue entrando por
la IP del máster (los nodos de casa no dependen de salir a Internet). Si el nombre ya apuntaba a otra cosa, pregunta
antes de sustituirlo. Repetirlo no duplica nada.

- `sudo cloudplay cloudflare status`: salud del túnel, si responde por HTTPS y si hay TURN.
- `sudo cloudplay cloudflare off [--delete]`: vuelve a solo red local (y con `--delete` borra túnel, DNS y clave TURN).
- Sin preguntas: `sudo cloudplay cloudflare --token T --hostname play.tudominio.com [--landing www.tudominio.com] --yes`.
- El panel (`/#/admin` → *Acceso desde Internet*) enseña cómo está publicada la plataforma.

## Correo en un comando (desde el máster)

```bash
sudo cloudplay mail setup
```

- **Resend** (recomendado, 3.000 correos/mes gratis): con su API key da de alta tu dominio (región UE), escribe SPF,
  DKIM y DMARC en Cloudflare si el máster está enlazado (si no, te enseña los registros), lo verifica, configura
  CloudPlay y te manda un correo de prueba.
- **SMTP**: Gmail (contraseña de aplicación), Brevo, Amazon SES, Mailgun o el de tu empresa (`--smtp-host … --smtp-port …`).
- `sudo cloudplay mail status` · `sudo cloudplay mail test [correo]` · `sudo cloudplay mail off`.

Qué sale: bienvenida al crear una cuenta, **recuperar la contraseña** (enlace de un solo uso, 60 min; aparece
"¿Has olvidado la contraseña?" en el login), aviso de contraseña cambiada, confirmación al que pide una demo, y al NOC:
nueva solicitud de demo y **nodo gaming caído** (como mucho uno por nodo y hora). En el panel (`/#/admin` → *Correo*) se
eligen los tipos, a quién avisar, el nombre del remitente y la dirección de respuesta; hay prueba, vista previa de cada
correo, estado del dominio con sus DNS y el registro de envíos.

## Publicar al mundo a mano (Cloudflare Tunnel)

Sin abrir puertos, sin IP fija y con TLS de Cloudflare. (Lo mismo que hace `cloudplay cloudflare`, paso a paso.)

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

### Sin dominio: modo red local (por IP)

Si no pasas `--domain`, el orquestador se queda en **modo red local**: la plataforma se abre por la IP de la máquina.

```bash
curl -fsSL https://github.com/fieropirata275/CloudPlay/releases/latest/download/get.sh | sudo bash -s -- orchestrator [--lan-ip 192.168.1.50]
```

- `http://IP`: entra cualquiera de la red (teles, nodos). No salta a HTTPS.
- `https://IP`: con un certificado de la CA interna de Caddy. El navegador avisa la primera vez. Hace falta HTTPS
  para usar desde el navegador el micro, la cámara y el Wiimote por WebHID (la app de escritorio no lo necesita).
- Los nodos se unen con `--cp-url http://IP`. `sudo cloudplay node-command` ya lo imprime así.
- Fija la IP del orquestador (reserva DHCP en el router o IP estática): los nodos la llevan apuntada.

## Opción C0 · Proxmox VE: todo el clúster en un comando

En el shell del host de Proxmox (Nodo → Shell), como root:

```bash
curl -fsSL https://github.com/fieropirata275/CloudPlay/releases/latest/download/get.sh | bash -s -- proxmox cluster --nodes 3
```

Crea **un máster** (orquestador) y **N nodos gaming** como VMs de Ubuntu 24.04 y lo deja todo funcionando:

1. Baja la imagen `ghcr.io/fieropirata275/cloudplay-pve` (sin Docker: get.sh descarga sus capas, comprueba el SHA256
   de cada una y ejecuta el script en el host, que es donde están `qm` y `pvesh`).
2. Elige solo el almacenamiento (local-lvm, local-zfs o el más libre), el puente (`vmbr0`), la puerta de enlace y las
   **GPUs libres** (NVIDIA/AMD con IOMMU; no toca la que usa la consola de Proxmox ni las que ya tenga otra VM).
3. Ajusta CPU y memoria de cada nodo a lo que tiene el host (hasta 8 núcleos y 16 GB) y enseña el plan antes de crear.
4. El máster se instala solo con cloud-init en modo red local (o con tu `--domain`), con un token de unión y una
   contraseña generados aquí. Mientras, se ve en directo qué está haciendo dentro de la VM.
5. Los nodos (una GPU en passthrough cada uno si hay; si no, codifican por CPU) se instalan y se unen solos.
6. Al final imprime la URL, el usuario y la contraseña, y los guarda en `/root/cloudplay-cluster.txt` (solo root).

| Opción | Por defecto | |
|---|---|---|
| `--nodes N` | 1 | nodos gaming |
| `--master-ip 192.168.1.50/24` | DHCP | IP fija del máster (recomendado); la puerta de enlace y el DNS salen del host |
| `--gpu-pci auto\|none\|0000:01:00,…` | auto | GPUs para los nodos, una por nodo |
| `--cores` / `--memory` / `--disk` | según el host / 64 GB | de cada nodo |
| `--master-cores` / `--master-memory` / `--master-disk` | 4 / 8192 / 48 | del máster |
| `--domain D [--tunnel-token T]` | — | plataforma con dominio en vez de por IP |
| `--storage` / `--bridge` | auto | dónde van los discos y la red |
| `--yes` | — | sin preguntar |

Para crecer más tarde: `… | bash -s -- proxmox cluster-add 2`.

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
# Usa las imágenes públicas de GHCR de la última versión
curl -fsSL https://github.com/fieropirata275/cloudplay/releases/latest/download/get.sh | bash -s -- \
  helm --domain play.empresa.com --tunnel-token <TOKEN> \
  --set turn.cloudflareKeyId=<KEY_ID> --set turn.cloudflareApiToken=<API_TOKEN>
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

## Juegos, BIOS y consolas sin juego

En cada nodo gaming (o en una carpeta compartida por NFS/SMB montada en todos):

```text
/srv/cloudplay/library/ps2/  *.iso *.chd *.cso …      → aparecen solos en el catálogo
/srv/cloudplay/library/gc/   *.iso *.rvz *.gcz …
/srv/cloudplay/library/wii/  *.wbfs *.rvz *.iso …
/srv/cloudplay/bios/ps2/     scph*.bin                 BIOS de PS2 (obligatoria para jugar a PS2)
/srv/cloudplay/bios/gc/EUR|USA|JAP/IPL.bin             IPL de GameCube (opcional)
/srv/cloudplay/bios/wii/                               carpeta "Wii" de Dolphin con el System Menu (opcional)
```

Con el firmware puesto, el catálogo muestra también **la consola sin juego**, como al encenderla sin disco:

| Entrada del catálogo | Qué arranca | Necesita |
|---|---|---|
| PlayStation 2 · Navegador del sistema | El OSDSYS: tarjetas de memoria, reloj, idioma, reproductor de CD | La BIOS de PS2 |
| GameCube · Menú principal | La IPL con su animación de arranque, tarjetas de memoria, calendario, ajustes | `IPL.bin` de la región (EUR = PAL) |
| Wii · Menú del sistema | El Wii Menu: canales instalados, Mii, ajustes de la consola | La NAND con el System Menu |

- **NAND de Wii:** vuelca la NAND de tu Wii con BootMii, impórtala en Dolphin en un PC (*Herramientas → Gestionar
  NAND → Importar copia de BootMii*) y copia la carpeta `Wii` de Dolphin a `/srv/cloudplay/bios/wii/`. El contenido de
  los títulos se comparte en solo lectura y los ajustes y Mii se copian a cada usuario, que los conserva entre partidas.
- **IPL de GameCube:** se vuelca de la consola con homebrew (por ejemplo, *ipl-dumper*). La región de la carpeta
  tiene que coincidir con la de la IPL (`EUR` = PAL, `USA` = NTSC-U, `JAP` = NTSC-J).
- **Legal:** CloudPlay no incluye ni descarga juegos ni firmware. Cada empresa usa los volcados de sus propias consolas
  y juegos.

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
