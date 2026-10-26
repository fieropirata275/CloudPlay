/*
 * libhidapi-hidraw.so.0 de CloudPlay: Dolphin cree que tiene Wiimotes y Balance Boards conectados por HID,
 * pero cada "dispositivo" es un socket local (SOCK_SEQPACKET, un mensaje = un informe HID) que session.py
 * conecta con el Wiimote REAL que el jugador tiene en su ordenador (WebHID / app de escritorio).
 *
 *   $CLOUDPLAY_HID_DIR/wiimote-<n>.sock  ->  "Nintendo RVL-CNT-01" (057e:0306)
 *   $CLOUDPLAY_HID_DIR/board-<n>.sock    ->  "Nintendo RVL-WBC-01" (Balance Board)
 *
 * Implementa exactamente las funciones de hidapi que importa Dolphin (Debian lo enlaza con BIND_NOW).
 * No necesita uhid, hidraw ni privilegios. Se compila con:  cc -O2 -shared -fPIC -Wl,-soname,libhidapi-hidraw.so.0
 */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <wchar.h>

#define API __attribute__((visibility("default")))

typedef enum { HID_API_BUS_UNKNOWN = 0, HID_API_BUS_USB = 1, HID_API_BUS_BLUETOOTH = 2 } hid_bus_type;

/* Misma disposición que hidapi 0.13/0.14 (la de Debian trixie) */
struct hid_device_info {
	char *path;
	unsigned short vendor_id;
	unsigned short product_id;
	wchar_t *serial_number;
	unsigned short release_number;
	wchar_t *manufacturer_string;
	wchar_t *product_string;
	unsigned short usage_page;
	unsigned short usage;
	int interface_number;
	struct hid_device_info *next;
	hid_bus_type bus_type;
};

typedef struct hid_device_ {
	int fd;
	int nonblocking;
} hid_device;

static const char *hid_dir(void)
{
	const char *d = getenv("CLOUDPLAY_HID_DIR");
	return (d && *d) ? d : "/tmp/cloudplay-hid";
}

API int hid_init(void) { return 0; }
API int hid_exit(void) { return 0; }

API struct hid_device_info *hid_enumerate(unsigned short vendor_id, unsigned short product_id)
{
	const char *dir = hid_dir();
	DIR *d = opendir(dir);
	if (!d)
		return NULL;
	struct hid_device_info *head = NULL, **tail = &head;
	struct dirent *e;
	while ((e = readdir(d)) != NULL) {
		size_t n = strlen(e->d_name);
		if (n < 6 || strcmp(e->d_name + n - 5, ".sock") != 0)
			continue;
		int board = strncmp(e->d_name, "board-", 6) == 0;
		if (!board && strncmp(e->d_name, "wiimote-", 8) != 0)
			continue;
		if ((vendor_id && vendor_id != 0x057e) || (product_id && product_id != 0x0306))
			continue;
		struct hid_device_info *info = calloc(1, sizeof(*info));
		if (!info)
			break;
		if (asprintf(&info->path, "%s/%s", dir, e->d_name) < 0) {
			free(info);
			break;
		}
		info->vendor_id = 0x057e;
		info->product_id = 0x0306;
		info->serial_number = wcsdup(L"");
		info->manufacturer_string = wcsdup(L"Nintendo");
		info->product_string = wcsdup(board ? L"Nintendo RVL-WBC-01" : L"Nintendo RVL-CNT-01");
		info->usage_page = 0x01;
		info->usage = 0x05;
		info->interface_number = -1;
		info->bus_type = HID_API_BUS_BLUETOOTH;
		*tail = info;
		tail = &info->next;
	}
	closedir(d);
	return head;
}

API void hid_free_enumeration(struct hid_device_info *devs)
{
	while (devs) {
		struct hid_device_info *next = devs->next;
		free(devs->path);
		free(devs->serial_number);
		free(devs->manufacturer_string);
		free(devs->product_string);
		free(devs);
		devs = next;
	}
}

API hid_device *hid_open_path(const char *path)
{
	struct sockaddr_un addr = {.sun_family = AF_UNIX};
	if (!path || strlen(path) >= sizeof(addr.sun_path))
		return NULL;
	strcpy(addr.sun_path, path);
	int fd = socket(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0);
	if (fd < 0)
		return NULL;
	if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
		close(fd);
		return NULL;
	}
	hid_device *dev = calloc(1, sizeof(*dev));
	if (!dev) {
		close(fd);
		return NULL;
	}
	dev->fd = fd;
	return dev;
}

API void hid_close(hid_device *dev)
{
	if (!dev)
		return;
	close(dev->fd);
	free(dev);
}

API int hid_write(hid_device *dev, const unsigned char *data, size_t length)
{
	if (!dev || !data || !length)
		return -1;
	ssize_t n = send(dev->fd, data, length, MSG_NOSIGNAL);
	return n < 0 ? -1 : (int)n;
}

/* 0 = nada en el plazo; -1 = el Wiimote se ha ido (el jugador lo desconectó o se cortó la sesión) */
API int hid_read_timeout(hid_device *dev, unsigned char *data, size_t length, int milliseconds)
{
	if (!dev || !data)
		return -1;
	struct pollfd p = {.fd = dev->fd, .events = POLLIN};
	int r;
	do {
		r = poll(&p, 1, milliseconds);
	} while (r < 0 && errno == EINTR);
	if (r < 0)
		return -1;
	if (r == 0)
		return 0;
	if (!(p.revents & POLLIN))
		return -1;
	ssize_t n = recv(dev->fd, data, length, MSG_DONTWAIT);
	if (n < 0)
		return (errno == EAGAIN || errno == EWOULDBLOCK) ? 0 : -1;
	if (n == 0)
		return -1;
	return (int)n;
}

API int hid_read(hid_device *dev, unsigned char *data, size_t length)
{
	return hid_read_timeout(dev, data, length, dev && dev->nonblocking ? 0 : -1);
}

API int hid_set_nonblocking(hid_device *dev, int nonblock)
{
	if (!dev)
		return -1;
	dev->nonblocking = nonblock;
	return 0;
}

API int hid_send_feature_report(hid_device *dev, const unsigned char *data, size_t length)
{
	(void)dev; (void)data; (void)length;
	return -1;
}

/* No las importa Dolphin, pero así la biblioteca se comporta como hidapi si alguien más las pide */
API const wchar_t *hid_error(hid_device *dev) { (void)dev; return L"CloudPlay HID bridge"; }
API hid_device *hid_open(unsigned short v, unsigned short p, const wchar_t *s)
{
	(void)s;
	struct hid_device_info *l = hid_enumerate(v, p);
	hid_device *d = l ? hid_open_path(l->path) : NULL;
	hid_free_enumeration(l);
	return d;
}
