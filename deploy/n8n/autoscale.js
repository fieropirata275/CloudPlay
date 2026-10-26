// Autoescalado de nodos gaming de CloudPlay en Proxmox, sin cortar partidas:
//  · Sube: si hay gente en cola o quedan menos huecos libres de los que quieres, clona la plantilla y la arranca.
//    El nodo nuevo se da de alta solo (token de unión) y aparece en el panel en unos minutos.
//  · Baja: si sobra capacidad, DRENA un nodo vacío (no recibe partidas nuevas). En la siguiente pasada,
//    si sigue vacío, apaga y borra su VM. Nunca se apaga un nodo con partidas.
const c = $input.first().json;
const http = (opts) => this.helpers.httpRequest({ json: true, timeout: 20000, ...opts });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];

// ---------------------------------------------------------------- CloudPlay
const login = await http({ method: "POST", url: `${c.cloudplayUrl}/api/auth/login`, body: { email: c.adminEmail, password: c.adminPassword } });
const cp = (method, path, body) =>
  http({ method, url: `${c.cloudplayUrl}${path}`, body, headers: { Authorization: `Bearer ${login.access_token}` } });
const stats = await cp("GET", "/api/admin/stats");
const nodes = await cp("GET", "/api/admin/nodes");

// ---------------------------------------------------------------- Proxmox
const pveHeaders = { Authorization: `PVEAPIToken=${c.proxmoxToken}` };
const pve = (method, path, body) =>
  http({ method, url: `${c.proxmoxUrl}/api2/json${path}`, body, headers: pveHeaders, skipSslCertificateValidation: !!c.proxmoxInsecureTls }).then((r) => r.data);
const waitTask = async (upid) => {
  for (let i = 0; i < 90; i++) {
    const st = await pve("GET", `/nodes/${c.proxmoxNode}/tasks/${encodeURIComponent(upid)}/status`);
    if (st.status === "stopped") {
      if (st.exitstatus && st.exitstatus !== "OK") throw new Error(`Tarea de Proxmox falló: ${st.exitstatus}`);
      return;
    }
    await wait(2000);
  }
  throw new Error("La tarea de Proxmox tarda demasiado");
};
const vms = (await pve("GET", `/nodes/${c.proxmoxNode}/qemu`)).filter((v) => v.name && v.name.startsWith(c.vmPrefix + "-") && !v.template);

const online = nodes.filter((n) => n.status === "online");
const free = stats.capacity_online - stats.placed;
const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
// VMs encendidas que aún no se han dado de alta: están arrancando (instalación, driver...). Mientras haya alguna, no clonamos más.
const booting = vms.filter((v) => v.status === "running" && !(byName[v.name] && byName[v.name].status === "online"));

let action = "nada";
let reason = `libres ${free}, en cola ${stats.queued}, nodos ${online.length}`;

// 1) Retirar VMs de nodos drenados que ya están vacíos
for (const n of nodes.filter((x) => x.draining && x.load === 0)) {
  const vm = vms.find((v) => v.name === n.name);
  if (!vm) continue;
  if (vm.status === "running") await waitTask(await pve("POST", `/nodes/${c.proxmoxNode}/qemu/${vm.vmid}/status/shutdown`, { timeout: 120, forceStop: 1 }));
  await waitTask(await pve("DELETE", `/nodes/${c.proxmoxNode}/qemu/${vm.vmid}?purge=1&destroy-unreferenced-disks=1`));
  await cp("DELETE", `/api/admin/nodes/${n.id}`);
  log.push(`retirado ${n.name} (VM ${vm.vmid})`);
  action = "retirar";
}

// 2) Subir capacidad
const needUp = stats.queued > 0 || free < c.minFreeSlots || online.length < c.minNodes;
if (action === "nada" && needUp) {
  // Antes de clonar, si hay un nodo drenando con hueco, lo devolvemos al servicio (más rápido que una VM nueva)
  const drained = nodes.find((n) => n.draining && n.status === "online");
  if (drained) {
    await cp("POST", `/api/admin/nodes/${drained.id}/drain`, { on: false });
    action = "reactivar"; log.push(`reactivado ${drained.name}`);
  } else if (booting.length) {
    action = "esperar"; log.push(`esperando a ${booting.map((v) => v.name).join(", ")}`);
  } else if (vms.length >= c.maxNodes) {
    action = "tope"; log.push(`ya hay ${vms.length} VMs (máximo ${c.maxNodes})`);
  } else {
    const newid = Number(await pve("GET", "/cluster/nextid"));
    const name = `${c.vmPrefix}-${newid}`;
    await waitTask(await pve("POST", `/nodes/${c.proxmoxNode}/qemu/${c.templateId}/clone`, { newid, name, full: 1 }));
    await waitTask(await pve("POST", `/nodes/${c.proxmoxNode}/qemu/${newid}/status/start`));
    action = "subir"; log.push(`clonado y arrancado ${name} (VM ${newid})`);
  }
}

// 3) Bajar capacidad: drenar un nodo vacío si, sin él, seguimos con el colchón y el mínimo de nodos
if (action === "nada" && !needUp) {
  const idle = online
    .filter((n) => !n.draining && n.load === 0 && vms.some((v) => v.name === n.name))
    .sort((a, b) => a.capacity - b.capacity)[0];
  if (idle && free - idle.capacity >= c.minFreeSlots && online.length - 1 >= c.minNodes) {
    await cp("POST", `/api/admin/nodes/${idle.id}/drain`, { on: true });
    action = "bajar"; log.push(`drenado ${idle.name}: se apagará en la próxima pasada si sigue vacío`);
  }
}

// 4) Nodos caídos: aviso
const offline = nodes.filter((n) => n.status !== "online" && !n.draining).map((n) => n.name);
if (c.webhookUrl && (action !== "nada" && action !== "esperar" || offline.length)) {
  const text = `CloudPlay · ${action}: ${log.join("; ") || reason}${offline.length ? ` · sin conexión: ${offline.join(", ")}` : ""}`;
  await http({ method: "POST", url: c.webhookUrl, body: { text, content: text } }).catch(() => null);
}

return [{ json: { action, reason, detail: log, stats, offline } }];
