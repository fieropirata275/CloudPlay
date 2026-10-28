/*
 * libpcap.so.0.8 de CloudPlay para PCSX2: el adaptador de red de la PS2 (DEV9, modo "PCAP Switched") queda
 * enchufado al cable virtual de la sesión (lanlink.py) en vez de a una interfaz del sistema. Mismo protocolo que el
 * "tapserver" de Dolphin: socket local de flujo, cada trama Ethernet precedida de su longitud (2 bytes, little endian).
 *
 *   $CLOUDPLAY_LAN_SOCK (por defecto /tmp/cloudplay-lan.sock)
 *
 * Implementa las funciones de libpcap que importa PCSX2 2.x. Sin sesión LAN el cable está "desenchufado": lo que
 * se manda se pierde y no llega nada. Si el socket aún no existe, se reintenta solo.
 *   cc -O2 -shared -fPIC -fvisibility=hidden -Wl,-soname,libpcap.so.0.8 -o libpcap.so.0.8 lanpcap.c
 */
#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

#define API __attribute__((visibility("default")))
#define MAX_FRAME 1518
#define RBUF (64 * 1024)

typedef unsigned int bpf_u_int32;
struct pcap_pkthdr {
	struct timeval ts;
	bpf_u_int32 caplen;
	bpf_u_int32 len;
};
struct bpf_program {
	unsigned int bf_len;
	void *bf_insns;
};
typedef struct pcap_if {
	struct pcap_if *next;
	char *name;
	char *description;
	void *addresses;
	bpf_u_int32 flags;
} pcap_if_t;

typedef struct pcap {
	int fd;
	int nonblock;
	int timeout_ms;
	double last_try;
	unsigned char rbuf[RBUF];
	size_t rlen;
	unsigned char pkt[MAX_FRAME + 2];
	struct pcap_pkthdr hdr;
	unsigned char mac[6];
	int has_mac;
	char err[256];
} pcap_t;

static double now(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec + ts.tv_nsec / 1e9;
}

static const char *lan_sock(void)
{
	const char *p = getenv("CLOUDPLAY_LAN_SOCK");
	return (p && *p) ? p : "/tmp/cloudplay-lan.sock";
}

static void try_connect(pcap_t *p)
{
	if (p->fd >= 0 || now() - p->last_try < 1.0)
		return;
	p->last_try = now();
	struct sockaddr_un addr = {.sun_family = AF_UNIX};
	const char *path = lan_sock();
	if (strlen(path) >= sizeof(addr.sun_path))
		return;
	strcpy(addr.sun_path, path);
	int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
	if (fd < 0)
		return;
	if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
		close(fd);
		return;
	}
	p->fd = fd;
	p->rlen = 0;
}

static void drop(pcap_t *p)
{
	if (p->fd >= 0)
		close(p->fd);
	p->fd = -1;
	p->rlen = 0;
}

API int pcap_findalldevs(pcap_if_t **alldevs, char *errbuf)
{
	(void)errbuf;
	pcap_if_t *d = calloc(1, sizeof(*d));
	if (!d)
		return -1;
	d->name = strdup("lo");
	d->description = strdup("CloudPlay LAN");
	*alldevs = d;
	return 0;
}

API void pcap_freealldevs(pcap_if_t *alldevs)
{
	while (alldevs) {
		pcap_if_t *n = alldevs->next;
		free(alldevs->name);
		free(alldevs->description);
		free(alldevs);
		alldevs = n;
	}
}

API pcap_t *pcap_open_live(const char *device, int snaplen, int promisc, int to_ms, char *errbuf)
{
	(void)device; (void)snaplen; (void)promisc;
	pcap_t *p = calloc(1, sizeof(*p));
	if (!p) {
		if (errbuf)
			snprintf(errbuf, 256, "sin memoria");
		return NULL;
	}
	p->fd = -1;
	p->timeout_ms = to_ms;
	p->last_try = -10;
	try_connect(p);
	return p;
}

API void pcap_close(pcap_t *p)
{
	if (!p)
		return;
	drop(p);
	free(p);
}

API int pcap_setnonblock(pcap_t *p, int nonblock, char *errbuf)
{
	(void)errbuf;
	p->nonblock = nonblock;
	return 0;
}

API int pcap_datalink(pcap_t *p) { (void)p; return 1; /* DLT_EN10MB */ }
API const char *pcap_datalink_val_to_name(int dlt) { return dlt == 1 ? "EN10MB" : "UNKNOWN"; }
API char *pcap_geterr(pcap_t *p) { return p ? p->err : (char *)""; }
API const char *pcap_lib_version(void) { return "CloudPlay LAN (libpcap compatible)"; }

/* PCSX2 solo usa "ether broadcast or ether dst xx:xx:xx:xx:xx:xx": se guarda la MAC y se filtra al leer */
API int pcap_compile(pcap_t *p, struct bpf_program *fp, const char *str, int optimize, bpf_u_int32 netmask)
{
	(void)optimize; (void)netmask;
	if (fp) {
		fp->bf_len = 0;
		fp->bf_insns = NULL;
	}
	const char *d = str ? strstr(str, "ether dst ") : NULL;
	unsigned int m[6];
	if (d && sscanf(d + 10, "%x:%x:%x:%x:%x:%x", &m[0], &m[1], &m[2], &m[3], &m[4], &m[5]) == 6) {
		for (int i = 0; i < 6; i++)
			p->mac[i] = (unsigned char)m[i];
		p->has_mac = 1;
	}
	return 0;
}

API int pcap_setfilter(pcap_t *p, struct bpf_program *fp) { (void)p; (void)fp; return 0; }
API void pcap_freecode(struct bpf_program *fp) { (void)fp; }

API int pcap_sendpacket(pcap_t *p, const unsigned char *buf, int size)
{
	try_connect(p);
	if (p->fd < 0 || size < 14 || size > MAX_FRAME)
		return 0; /* cable desenchufado: se pierde, como en una red de verdad */
	unsigned char out[MAX_FRAME + 2];
	out[0] = (unsigned char)(size & 0xff);
	out[1] = (unsigned char)(size >> 8);
	memcpy(out + 2, buf, (size_t)size);
	size_t off = 0, total = (size_t)size + 2;
	while (off < total) {
		ssize_t n = send(p->fd, out + off, total - off, MSG_NOSIGNAL);
		if (n < 0) {
			if (errno == EINTR)
				continue;
			if (errno == EAGAIN || errno == EWOULDBLOCK) {
				struct pollfd w = {.fd = p->fd, .events = POLLOUT};
				poll(&w, 1, 50);
				continue;
			}
			drop(p);
			return 0;
		}
		off += (size_t)n;
	}
	return 0;
}

static int wanted(pcap_t *p, const unsigned char *f)
{
	return !p->has_mac || (f[0] & 1) || memcmp(f, p->mac, 6) == 0;
}

/* 1 = trama, 0 = nada ahora mismo (modo no bloqueante de PCSX2) */
API int pcap_next_ex(pcap_t *p, struct pcap_pkthdr **header, const unsigned char **data)
{
	try_connect(p);
	if (p->fd < 0)
		return 0;
	for (;;) {
		/* ¿hay una trama completa en el búfer? */
		while (p->rlen >= 2) {
			size_t n = p->rbuf[0] | (p->rbuf[1] << 8);
			if (p->rlen < n + 2)
				break;
			int ok = n >= 14 && n <= MAX_FRAME && wanted(p, p->rbuf + 2);
			if (ok) {
				memcpy(p->pkt, p->rbuf + 2, n);
				gettimeofday(&p->hdr.ts, NULL);
				p->hdr.caplen = p->hdr.len = (bpf_u_int32)n;
			}
			memmove(p->rbuf, p->rbuf + 2 + n, p->rlen - 2 - n);
			p->rlen -= 2 + n;
			if (ok) {
				*header = &p->hdr;
				*data = p->pkt;
				return 1;
			}
		}
		if (p->rlen >= sizeof(p->rbuf)) { /* basura: se descarta todo */
			p->rlen = 0;
		}
		int timeout = p->nonblock ? 0 : (p->timeout_ms > 0 ? p->timeout_ms : 100);
		struct pollfd r = {.fd = p->fd, .events = POLLIN};
		int pr = poll(&r, 1, timeout);
		if (pr <= 0)
			return 0;
		ssize_t got = recv(p->fd, p->rbuf + p->rlen, sizeof(p->rbuf) - p->rlen, MSG_DONTWAIT);
		if (got == 0 || (got < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) {
			drop(p);
			return 0;
		}
		if (got > 0)
			p->rlen += (size_t)got;
	}
}
